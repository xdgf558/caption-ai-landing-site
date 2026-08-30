import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
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
const [readerMigration, passwordMigration, gameSaveMigration] = await Promise.all([
  read('../migrations/0003_reader_accounts.sql'),
  read('../migrations/0011_reader_password_credentials.sql'),
  read('../migrations/0031_reader_game_saves.sql')
]);

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readerMigration);
sqlite.exec(passwordMigration);
sqlite.exec(gameSaveMigration);
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
const makeSave = (coins, savedAt = '2026-08-30T01:00:00.000Z') => ({
  version: '1.17.0',
  meta: {
    createdAt: '2026-08-29T01:00:00.000Z',
    lastSavedAt: savedAt,
    lastSyncAt: '2026-08-30T01:00:01.000Z'
  },
  player: { coins, energy: 80 },
  cats: [{ id: 'cat-one', name: 'Momo' }],
  inventory: { food: 2 },
  settings: {
    language: 'en',
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

result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: 0, saveData: makeSave(5) }, { origin: '' }),
    env
  )
);
assert.equal(result.response.status, 403);
assert.equal(result.body.code, 'INVALID_ORIGIN');

const firstSave = makeSave(10);
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
assert.equal(result.body.save.data.player.coins, 10);
assert.equal(result.body.save.data.meta.lastSavedAt, undefined);
assert.equal(result.body.save.data.meta.lastSyncAt, undefined);
assert.equal(result.body.save.data.settings.customMusicData, '');
assert.equal(result.body.save.data.settings.customMusicName, '');
assert.equal(result.body.save.data.settings.customMusicEnabled, false);
assert.equal(result.body.save.digest, await hooks.sha256Hex(JSON.stringify(result.body.save.data)));

const secondSave = makeSave(20, '2026-08-30T02:00:00.000Z');
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
assert.equal(result.body.save.data.player.coins, 20);
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
assert.equal(result.body.save.data.player.coins, 20);

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
for (let coins = 30; coins <= 90; coins += 10) {
  result = await json(
    await hooks.handleReaderGameSavePut(
      request('PUT', firstSessionToken, { baseRevision: revision, saveData: makeSave(coins) }),
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

sqlite.prepare(
  `UPDATE reader_game_save_rate_limits
   SET write_count = 20, window_started_at = CURRENT_TIMESTAMP
   WHERE account_id = 1 AND game_key = 'cat-life'`
).run();
result = await json(
  await hooks.handleReaderGameSavePut(
    request('PUT', firstSessionToken, { baseRevision: revision, saveData: makeSave(100) }),
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

sqlite.close();
console.log('Cat Life Game cloud save tests passed.');
