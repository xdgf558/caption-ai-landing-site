import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { __readerTotpTestHooks as hooks } from '../src/worker.js';

class D1Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.database, this.sql, params);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.params) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) }, success: true };
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = statements.map((statement) => {
        const result = this.database.prepare(statement.sql).run(...statement.params);
        return { meta: { changes: Number(result.changes || 0) }, success: true };
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [readerMigration, passwordMigration, gameSaveMigration, gameSaveRecoveryMigration] = await Promise.all([
  read('../migrations/0003_reader_accounts.sql'),
  read('../migrations/0011_reader_password_credentials.sql'),
  read('../migrations/0031_reader_game_saves.sql'),
  read('../migrations/0032_reader_game_save_recovery.sql')
]);

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readerMigration);
sqlite.exec(passwordMigration);
sqlite.exec(gameSaveMigration);
sqlite.exec(gameSaveRecoveryMigration);
const db = new D1Database(sqlite);
const env = { WAITLIST_DB: db };

const firstSessionToken = 'cat-life-session-one';
const secondSessionToken = 'cat-life-session-two';
const firstSessionHash = await hooks.sha256Hex(firstSessionToken);
const secondSessionHash = await hooks.sha256Hex(secondSessionToken);

sqlite.prepare(
  `INSERT INTO reader_accounts (email, normalized_email, display_name)
   VALUES (?, ?, ?), (?, ?, ?)`
).run(
  'player-one@example.com',
  'player-one@example.com',
  'Player One',
  'player-two@example.com',
  'player-two@example.com',
  'Player Two'
);
sqlite.prepare(
  `INSERT INTO reader_password_credentials (
    account_id, username, normalized_username, password_hash, password_salt
  ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
).run(1, 'playerone', 'playerone', 'hash-one', 'salt-one', 2, 'playertwo', 'playertwo', 'hash-two', 'salt-two');
sqlite.prepare(
  `INSERT INTO reader_sessions (account_id, session_hash, expires_at)
   VALUES (?, ?, datetime('now', '+1 day')), (?, ?, datetime('now', '+1 day'))`
).run(1, firstSessionHash, 2, secondSessionHash);

const request = (method, token = '', body = null, headers = {}) => {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('cookie', `station_cat_reader_session=${token}`);
  if (body !== null) {
    requestHeaders.set('content-type', 'application/json');
    if (!requestHeaders.has('origin')) requestHeaders.set('origin', 'https://wwwstationcat.org');
  }
  return new Request('https://wwwstationcat.org/api/readers/game-saves/cat-life', {
    method,
    headers: requestHeaders,
    body: body === null ? undefined : JSON.stringify(body)
  });
};

const json = async (response) => ({ response, body: await response.json() });
const makeSave = (gold, savedAt = '2026-08-30T01:00:00.000Z') => ({
  version: '1.17.0',
  schemaVersion: 3,
  meta: {
    createdAt: '2026-08-29T01:00:00.000Z',
    lastSavedAt: savedAt,
    lastSyncAt: '2026-08-30T01:00:01.000Z'
  },
  player: { gold, energy: 80 },
  cats: [{ id: 'cat-one', name: 'Momo', careStatus: 'sheltered', careLastSyncAt: '2026-08-30T00:00:00.000Z', intimacy: 61 }],
  inventory: { food: 2 },
  settings: {
    language: 'en',
    bgmVolume: 60,
    sfxVolume: 70,
    customMusicData: 'data:audio/mpeg;base64,private-device-audio',
    customMusicName: 'local-song.mp3',
    customMusicEnabled: true
  }
});

let result = await json(await hooks.handleReaderGameSaveGet(request('GET'), env));
assert.equal(result.response.status, 200);
assert.equal(result.body.authenticated, false);
assert.equal(result.body.save, null);
assert.equal(result.response.headers.get('cache-control'), 'no-store');

result = await json(
  await hooks.handleReaderGameSavePut(request('PUT', '', { baseRevision: 0, saveData: makeSave(10) }), env)
);
assert.equal(result.response.status, 401);
assert.equal(result.body.code, 'SIGN_IN_REQUIRED');

result = await json(await hooks.handleReaderGameSaveGet(request('GET', firstSessionToken), env));
assert.equal(result.response.status, 200);
assert.equal(result.body.authenticated, true);
assert.equal(result.body.account.displayName, 'Player One');
assert.equal(result.body.account.username, 'playerone');
assert.equal(result.body.save, null);

const invalidRequest = new Request('https://wwwstationcat.org/api/readers/game-saves/cat-life', {
  method: 'PUT',
  headers: {
    cookie: `station_cat_reader_session=${firstSessionToken}`,
    origin: 'https://wwwstationcat.org',
    'content-type': 'application/json'
  },
  body: '{'
});
result = await json(await hooks.handleReaderGameSavePut(invalidRequest, env));
assert.equal(result.response.status, 400);
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM reader_game_save_rate_limits WHERE account_id = 1').get().count,
  0,
  'invalid JSON must not consume the valid-write rate limit'
);

result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, {
      baseRevision: 0,
      saveData: { ...makeSave(5), schemaVersion: 999 }
    }),
    env
  )
);
assert.equal(result.response.status, 400);
assert.equal(result.body.code, 'INVALID_GAME_SAVE');
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM reader_game_save_rate_limits WHERE account_id = 1').get().count,
  0,
  'unsupported schema versions must fail before rate limiting'
);

const mislabeledCurrentSave = makeSave(5);
delete mislabeledCurrentSave.player.gold;
mislabeledCurrentSave.player.coins = 5;
result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: 0, saveData: mislabeledCurrentSave }),
    env
  )
);
assert.equal(result.response.status, 400);
assert.equal(result.body.code, 'INVALID_GAME_SAVE');
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM reader_game_save_rate_limits WHERE account_id = 1').get().count,
  0,
  'schema 2 saves with legacy fields must fail before rate limiting'
);

result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, {
      baseRevision: 0,
      saveData: { ...makeSave(5), oversizedFixture: 'x'.repeat(751000) }
    }),
    env
  )
);
assert.equal(result.response.status, 413);
assert.equal(result.body.code, 'GAME_SAVE_TOO_LARGE');
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM reader_game_save_rate_limits WHERE account_id = 1').get().count,
  0,
  'oversized saves must fail before rate limiting'
);

const legacyServerSave = makeSave(5);
legacyServerSave.schemaVersion = 0;
legacyServerSave.player.coins = legacyServerSave.player.gold;
delete legacyServerSave.player.gold;
legacyServerSave.settings.musicVolume = 45;
delete legacyServerSave.settings.bgmVolume;
delete legacyServerSave.settings.sfxVolume;
result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: 0, saveData: legacyServerSave }),
    env
  )
);
assert.equal(result.response.status, 200);
assert.equal(result.body.save.schemaVersion, 3);
assert.equal(result.body.save.data.player.gold, 5);
assert.equal(result.body.save.data.player.coins, undefined);
assert.equal(result.body.save.data.settings.bgmVolume, 45);
assert.equal(result.body.save.data.settings.sfxVolume, 45);
sqlite.prepare('DELETE FROM reader_game_saves WHERE account_id = 1').run();
sqlite.prepare('DELETE FROM reader_game_save_rate_limits WHERE account_id = 1').run();

const versionTwoSave = { ...makeSave(7), schemaVersion: 2 };
versionTwoSave.cats[0].isAlive = false;
versionTwoSave.cats[0].name = 'Original companion';
result = await json(await hooks.handleReaderGameSavePut(
  request('PUT', firstSessionToken, { baseRevision: 0, saveData: versionTwoSave }), env
));
assert.equal(result.response.status, 200);
assert.equal(result.body.save.schemaVersion, 3);
assert.equal(result.body.save.data.cats[0].careLastSyncAt, versionTwoSave.meta.lastSyncAt);
assert.equal(result.body.save.data.cats[0].careStatus, 'home');
assert.equal(result.body.save.data.cats[0].isAlive, false, 'cloud migration does not choose legacy recovery for the player');
assert.equal(result.body.save.data.cats[0].intimacy, 61);
sqlite.prepare('DELETE FROM reader_game_saves WHERE account_id = 1').run();
sqlite.prepare('DELETE FROM reader_game_save_rate_limits WHERE account_id = 1').run();

// Golden parity fixtures: changing only global metadata must not mask old cat care.
const browserMigration = { window: {} };
vm.runInNewContext(await read('../public/games/cat-life/src/js/state/saveMigrations.js'), browserMigration);
const oldCare = '2026-08-29T01:00:00.000Z';
const recentCare = '2026-08-29T02:00:00.000Z';
for (const fixture of [
  { label: 'old trackers, fresh global/age/healthy disease timestamp', cat: { decayTracker: { hunger: oldCare, clean: oldCare, mood: oldCare, energy: oldCare }, ageUpdatedAt: '2026-08-30T01:00:00.000Z', diseaseProgressAt: '2026-08-30T01:00:00.000Z' }, expected: oldCare },
  { label: 'partial tracker record ignores malformed timestamps', cat: { decayTracker: { hunger: 'invalid', energy: oldCare, extensionField: '2026-08-30T01:00:00.000Z' } }, expected: oldCare },
  { label: 'active disease progress is cat-specific evidence', cat: { decayTracker: { hunger: oldCare }, diseaseId: 'cold', diseaseProgressAt: recentCare }, expected: recentCare },
  { label: 'missing trackers falls back to cat age sync before global save', cat: { ageUpdatedAt: oldCare }, expected: oldCare },
  { label: 'missing cat evidence falls back to global timestamp', cat: {}, expected: makeSave(7).meta.lastSyncAt },
]) {
  const saved = { ...makeSave(7), schemaVersion: 2 };
  saved.cats = [{ id: 'cat-one', name: 'Momo', ...fixture.cat }];
  const original = JSON.stringify(saved);
  const migrated = browserMigration.window.CatGameSaveMigrations.migrate(saved).data;
  const response = await json(await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: 0, saveData: saved }), env
  ));
  assert.equal(response.response.status, 200, fixture.label);
  assert.equal(response.body.save.data.cats[0].careLastSyncAt, fixture.expected, fixture.label);
  assert.deepEqual(response.body.save.data.cats, JSON.parse(JSON.stringify(migrated.cats)), fixture.label);
  assert.equal(JSON.stringify(saved), original, 'both migrations leave the source intact');
  sqlite.prepare('DELETE FROM reader_game_saves WHERE account_id = 1').run();
  sqlite.prepare('DELETE FROM reader_game_save_rate_limits WHERE account_id = 1').run();
}

result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: 0, saveData: makeSave(5) }, { origin: '' }),
    env
  )
);
assert.equal(result.response.status, 403);
assert.equal(result.body.code, 'INVALID_ORIGIN');

const firstSave = makeSave(10);
firstSave.player.careLearning = {
  version: 1, eligible: true, metCat: true, fed: true, played: false, worked: false,
  careDates: ['2026-08-29'], supplyClaims: [1, 2], treatmentUsed: true, protectedUntil: null
};
result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, {
      baseRevision: 0,
      clientUpdatedAt: firstSave.meta.lastSavedAt,
      saveData: firstSave
    }),
    env
  )
);
assert.equal(result.response.status, 200);
assert.equal(result.body.save.revision, 1);
assert.equal(result.body.save.schemaVersion, 3);
assert.equal(result.body.save.data.player.gold, 10);
assert.deepEqual(result.body.save.data.player.careLearning, firstSave.player.careLearning,
  'the deployed schema-3 Worker must preserve additive learning data, including reward deduplication');
assert.equal(result.body.save.data.cats[0].careStatus, 'sheltered');
assert.equal(result.body.save.data.cats[0].careLastSyncAt, firstSave.cats[0].careLastSyncAt);
assert.equal(result.body.save.data.cats[0].intimacy, 61);
assert.equal(result.body.save.data.meta.lastSavedAt, undefined);
assert.equal(result.body.save.data.meta.lastSyncAt, undefined);
assert.equal(result.body.save.data.settings.customMusicData, '');
assert.equal(result.body.save.data.settings.customMusicName, '');
assert.equal(result.body.save.data.settings.customMusicEnabled, false);
assert.equal(result.body.save.digest, await hooks.sha256Hex(JSON.stringify(result.body.save.data)));

const secondSave = makeSave(20, '2026-08-30T02:00:00.000Z');
const staleTabSave = { ...makeSave(999), schemaVersion: 2 };
result = await json(await hooks.handleReaderGameSavePut(
  request('PUT', firstSessionToken, { baseRevision: 1, saveData: staleTabSave }), env
));
assert.equal(result.response.status, 409, 'old clients cannot overwrite upgraded care state even with the current revision');
assert.equal(result.body.save.data.player.gold, 10);
sqlite.prepare('DELETE FROM reader_game_save_rate_limits WHERE account_id = 1').run();
result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, {
      baseRevision: 1,
      clientUpdatedAt: secondSave.meta.lastSavedAt,
      saveData: secondSave
    }),
    env
  )
);
assert.equal(result.response.status, 200);
assert.equal(result.body.save.revision, 2);
assert.equal(result.body.save.data.player.gold, 20);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reader_game_save_backups').get().count, 1);

result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: 1, saveData: makeSave(999) }),
    env
  )
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'GAME_SAVE_CONFLICT');
assert.equal(result.body.save.revision, 2);
assert.equal(result.body.save.data.player.gold, 20);

result = await json(
  await hooks.handleReaderGameSavePut(
    request(
      'PUT',
      firstSessionToken,
      { baseRevision: 2, saveData: makeSave(30) },
      { origin: 'https://attacker.example' }
    ),
    env
  )
);
assert.equal(result.response.status, 403);
assert.equal(result.body.code, 'INVALID_ORIGIN');

let revision = 2;
for (let gold = 30; gold <= 90; gold += 10) {
  result = await json(
    await hooks.handleReaderGameSavePut(
      request('PUT', firstSessionToken, { baseRevision: revision, saveData: makeSave(gold) }),
      env
    )
  );
  assert.equal(result.response.status, 200);
  revision = result.body.save.revision;
}
assert.equal(revision, 9);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reader_game_save_backups').get().count, 5);
assert.deepEqual(
  sqlite.prepare('SELECT revision FROM reader_game_save_backups ORDER BY revision').all().map((row) => row.revision),
  [4, 5, 6, 7, 8]
);

result = await json(await hooks.handleReaderGameSaveRecoveryGet(request('GET', firstSessionToken), env));
assert.equal(result.response.status, 200);
assert.equal(result.body.currentRevision, 9);
assert.deepEqual(result.body.backups.map((backup) => backup.revision), [8, 7, 6, 5, 4]);
assert.deepEqual(result.body.recoveryEvents, []);

result = await json(
  await hooks.handleReaderGameSaveRecoveryPost(
    request('POST', firstSessionToken, { baseRevision: 9, sourceRevision: 4 }),
    env
  )
);
assert.equal(result.response.status, 200);
assert.equal(result.body.recoveredFromRevision, 4);
assert.equal(result.body.save.revision, 10);
assert.equal(result.body.save.data.player.gold, 40);
assert.deepEqual(
  sqlite.prepare('SELECT revision FROM reader_game_save_backups ORDER BY revision').all().map((row) => row.revision),
  [5, 6, 7, 8, 9]
);

result = await json(await hooks.handleReaderGameSaveRecoveryGet(request('GET', firstSessionToken), env));
assert.equal(result.body.recoveryEvents.length, 1);
assert.deepEqual(result.body.recoveryEvents[0], {
  sourceRevision: 4,
  previousRevision: 9,
  restoredRevision: 10,
  createdAt: result.body.recoveryEvents[0].createdAt
});

result = await json(
  await hooks.handleReaderGameSaveRecoveryPost(
    request('POST', firstSessionToken, { baseRevision: 9, sourceRevision: 5 }),
    env
  )
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'GAME_SAVE_CONFLICT');
assert.equal(result.body.save.revision, 10);

result = await json(
  await hooks.handleReaderGameSaveRecoveryPost(
    request('POST', firstSessionToken, { baseRevision: 10, sourceRevision: 4 }),
    env
  )
);
assert.equal(result.response.status, 404);
assert.equal(result.body.code, 'GAME_SAVE_BACKUP_NOT_FOUND');

sqlite.prepare(
  `UPDATE reader_game_save_rate_limits
   SET write_count = 20, window_started_at = CURRENT_TIMESTAMP
   WHERE account_id = 1 AND game_key = 'cat-life'`
).run();
result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: 10, saveData: makeSave(100) }),
    env
  )
);
assert.equal(result.response.status, 429);
assert.equal(result.body.code, 'GAME_SAVE_RATE_LIMITED');
assert.ok(Number(result.response.headers.get('retry-after')) >= 1);
assert.equal(
  sqlite.prepare("SELECT write_count FROM reader_game_save_rate_limits WHERE account_id = 1 AND game_key = 'cat-life'").get().write_count,
  21
);

result = await json(await hooks.handleReaderGameSaveGet(request('GET', secondSessionToken), env));
assert.equal(result.response.status, 200);
assert.equal(result.body.authenticated, true);
assert.equal(result.body.account.id, 2);
assert.equal(result.body.save, null, 'one member must never see another member\'s cloud save');

const secondFirstSave = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', secondSessionToken, { baseRevision: 0, saveData: makeSave(200) }),
    env
  )
);
assert.equal(secondFirstSave.response.status, 200);
const concurrentResults = await Promise.all([
  hooks.handleReaderGameSavePut(
    request('PUT', secondSessionToken, { baseRevision: 1, saveData: makeSave(210) }),
    env
  ),
  hooks.handleReaderGameSavePut(
    request('PUT', secondSessionToken, { baseRevision: 1, saveData: makeSave(220) }),
    env
  )
]);
const concurrentBodies = await Promise.all(concurrentResults.map(json));
assert.deepEqual(
  concurrentBodies.map((entry) => entry.response.status).sort(),
  [200, 409],
  'two writes from the same base revision must produce exactly one winner'
);
assert.equal(
  sqlite.prepare("SELECT revision FROM reader_game_saves WHERE account_id = 2 AND game_key = 'cat-life'").get().revision,
  2
);

sqlite.close();
console.log('Cat Life Game cloud save tests passed.');
