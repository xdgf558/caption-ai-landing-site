import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { reportMigrationGroups, reportBindings } from './station-report-fixture.mjs';
import { seedLegacyFixture, insertFixture, legacyReads, databaseRows } from './station-redesign-database.mjs';
import { memberFixtureMigrations } from './station-member-runtime.mjs';
import { createContentObject, saveContentObject, contentPublication, saveContentRights, saveContentPlatform } from '../../src/redesign/contentAdmin.js';
import { readContentObject } from '../../src/redesign/contentAdminStore.js';
import { mediaFixture } from './station-content-fixture.mjs';
import { runStationEventRetention } from '../../src/redesign/analyticsStore.js';
import { runStationReportRetention } from '../../src/redesign/reportsSchedule.js';
import { event } from './station-event-fixture.mjs';
import { migrationFlags } from '../../src/redesign/routeMigrationPaths.js';
import { inspectMigrationRouting } from '../../src/redesign/routeMigrationProfile.js';
import { exportFixtureDatabase, restoreFixtureClone, exportFixtureObjects, restoreFixtureObjects, releaseHash } from './station-release-backup.mjs';

const root = new URL('../../', import.meta.url), actor = 't22-synthetic-publisher@example.test';
const context = (version = 1) => ({ actorId: actor, key: randomUUID(), ifMatch: '"edit-' + version + '"' });
const cookie = id => 'station_cat_reader_session=t22-synthetic-session-' + id;
const makeSave = gold => ({ version: '1.28.0', schemaVersion: 3, meta: { createdAt: new Date().toISOString(), lastSavedAt: new Date().toISOString() },
  player: { gold, energy: 80 }, cats: [{ id: 't22-synthetic-cat', name: 'Fixture', careStatus: 'sheltered', intimacy: 61 }], inventory: { food: 2 }, settings: { language: 'en' } });

// No config/database/remote arguments. Every binding below is fixed to a new,
// disposable local instance and every outbound fetch is rejected.
export async function rehearseStationRelease() {
  const config = JSON.parse(await readFile(new URL('ops/station-release-local.jsonc', root), 'utf8'));
  assert.equal(config.name, 'station-cat-t22-local-only'); assert.equal(config.account_id, undefined); assert.equal(config.routes, undefined);
  assert.equal(config.assets.run_worker_first, true); assert.ok(inspectMigrationRouting(config.assets.run_worker_first).satisfied);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('station-release-runtime-worker.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wasm': 'binary' } });
  const bindings = { ...config.vars, ...reportBindings, ...Object.fromEntries(migrationFlags.map(key => [key, 'true'])),
    STATION_SEARCH_INDEXING_ENABLED: 'false', MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true',
    MUSIC_RATE_LIMIT_SECRET: 't22-synthetic-only-no-production-credential', ALLOW_LOCAL_ADMIN: 'false' };
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: config.compatibility_date,
    host: '127.0.0.1', port: 0, log: new Log(LogLevel.ERROR), bindings,
    d1Databases: { WAITLIST_DB: 't22-ephemeral-readers', MUSIC_DB: 't22-ephemeral-music',
      BEFORE_READER_CLONE: 't22-before-reader-clone', BEFORE_MUSIC_CLONE: 't22-before-music-clone',
      AFTER_READER_CLONE: 't22-after-reader-clone', AFTER_MUSIC_CLONE: 't22-after-music-clone' },
    r2Buckets: { MUSIC_BUCKET: 't22-ephemeral-music', RESTORE_BUCKET: 't22-empty-object-clone', AFTER_RESTORE_BUCKET: 't22-after-object-clone' },
    assets: { directory: fileURLToPath(new URL('dist/', root)), binding: 'ASSETS',
      routerConfig: { invoke_user_worker_ahead_of_assets: config.assets.run_worker_first, has_user_worker: true },
      assetConfig: { not_found_handling: config.assets.not_found_handling } },
    outboundService: () => new Response('T22 fixture rejects all outbound requests', { status: 403 }) });
  try {
    const music = await mf.getD1Database('MUSIC_DB'), reader = await mf.getD1Database('WAITLIST_DB'), bucket = await mf.getR2Bucket('MUSIC_BUCKET');
    const groups = reportMigrationGroups(), applied = [], now = Date.now(), iso = new Date(now).toISOString();
    for (const group of groups.filter(row => Number(row.name.slice(0, 4)) <= 11)) await music.batch(group.statements.map(sql => music.prepare(sql)));
    await music.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT)').run();
    for (const group of groups.filter(row => Number(row.name.slice(0, 4)) <= 11)) await insertFixture(music, 'd1_migrations', { name: group.name, applied_at: iso });
    const parser = new DatabaseSync(':memory:');
    try {
      for (const name of ['0001_waitlist.sql', '0002_download_rate_limits.sql', ...memberFixtureMigrations]) {
        let remaining = await readFile(new URL('migrations/' + name, root), 'utf8'); const statements = [];
        while (remaining.trim()) { const statement = parser.prepare(remaining), sql = statement.sourceSQL; statement.run(); statements.push(sql); remaining = remaining.slice(sql.length); }
        await reader.batch(statements.map(sql => reader.prepare(sql)));
      }
    } finally { parser.close(); }
    const legacy = await seedLegacyFixture(music, { materializeAsset: async asset => {
      // Small synthetic object bytes test backup integrity and publication
      // identity only. They are NOT decodable music, imagery or a license.
      const bytes = new Uint8Array(100).fill(asset.id.charCodeAt(asset.id.length - 1));
      const object = await bucket.put(asset.object_key, bytes, { httpMetadata: { contentType: asset.content_type } });
      return { etag: object.etag, sha256: releaseHash(bytes) };
    } });
    for (const id of [1, 2]) {
      await insertFixture(reader, 'reader_accounts', { id, email: 't22-' + id + '@example.test', normalized_email: 't22-' + id + '@example.test', display_name: 'T22 Synthetic ' + id });
      await insertFixture(reader, 'reader_sessions', { account_id: id, session_hash: createHash('sha256').update('t22-synthetic-session-' + id).digest('hex'), expires_at: new Date(now + 86400000).toISOString() });
      await insertFixture(reader, 'reader_credit_accounts', { account_id: id, balance_credits: 125, currency_label: 'Station Points' });
    }
    await insertFixture(reader, 'reader_memberships', { account_id: 1, started_at: new Date(now - 60000).toISOString(), expires_at: new Date(now + 86400000).toISOString() });
    await insertFixture(reader, 'novel_entitlements', { account_id: 2, series_slug: 't22-history', scope: 'series', access_level: 'all', source: 'synthetic', source_ref: 'before-migration' });
    await insertFixture(reader, 'novel_orders', { order_token: 'T22-BEFORE-ORDER', account_id: 2, order_type: 'tip', price_amount: '2.00', status: 'finished' });
    // A discarded fixture row leaves a high-water mark above MAX(id). Clone
    // recovery must preserve it instead of reusing the old numeric identifier.
    await insertFixture(reader, 'novel_orders', { order_token: 'T22-DISCARDED-SYNTHETIC', account_id: 2, order_type: 'tip', status: 'draft' });
    await reader.prepare("DELETE FROM novel_orders WHERE order_token='T22-DISCARDED-SYNTHETIC'").run();
    const initialSave = JSON.stringify(makeSave(87));
    await insertFixture(reader, 'reader_game_saves', { account_id: 2, game_key: 'cat-life', save_version: '1.28.0', save_json: initialSave,
      save_hash: releaseHash(initialSave), save_bytes: Buffer.byteLength(initialSave), revision: 4, client_updated_at: iso });
    const originalMusic = await databaseRows(music), originalReads = await legacyReads(music, legacy);
    const originalEntitlements = (await reader.prepare('SELECT * FROM novel_entitlements ORDER BY id').all()).results;
    const originalMemberships = (await reader.prepare('SELECT * FROM reader_memberships ORDER BY account_id').all()).results;
    const before = { music: await exportFixtureDatabase(music), reader: await exportFixtureDatabase(reader) }, objects = await exportFixtureObjects(bucket);
    const preRestore = { music: await restoreFixtureClone(await mf.getD1Database('BEFORE_MUSIC_CLONE'), before.music),
      reader: await restoreFixtureClone(await mf.getD1Database('BEFORE_READER_CLONE'), before.reader),
      objects: await restoreFixtureObjects(await mf.getR2Bucket('RESTORE_BUCKET'), objects) };
    for (const group of groups.filter(row => Number(row.name.slice(0, 4)) >= 12)) {
      // Each fixture migration AND its ledger receipt commit in one D1 batch.
      await music.batch([...group.statements.map(sql => music.prepare(sql)),
        music.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(group.name, iso)]);
      applied.push({ name: group.name, sha256: releaseHash(await readFile(new URL('migrations-music/' + group.name, root))) });
    }
    assert.deepEqual(await databaseRows(music), originalMusic);
    assert.deepEqual(await legacyReads(music, legacy), originalReads);
    assert.ok((await music.prepare('SELECT published_revision FROM station_track_publications').all()).results.every(row => row.published_revision === null));
    assert.equal((await music.prepare('SELECT COUNT(*) n FROM station_promotions').first()).n, 0);
    await runStationEventRetention({ ...bindings, MUSIC_DB: music }); await runStationReportRetention({ ...bindings, MUSIC_DB: music });
    const runtime = { db: music, bucket }, track = legacy.tracks[0];
    const data = { metadata: track.metadata, siteAudioMode: 'none', legacyRevisionId: null, durationMs: 120000, coverAssetId: track.cover, lyricsAssetId: null };
    await saveContentRights(runtime, track.cover, { scope: 'cover', status: 'approved', basis: 'T22 合成校验记录，非真实权利', reason: '本机演练' }, context());
    await saveContentObject(runtime, 'tracks', track.id, { revision: 1, data, reason: '合成网站作品' }, context());
    await contentPublication(runtime, 'tracks', track.id, 'publish', { revision: 2, reason: '隔离发布' }, context(2));
    const changedData = { ...data, metadata: { ...data.metadata, title: { ...data.metadata.title, en: 'T22 after migration' } } };
    await saveContentObject(runtime, 'tracks', track.id, { revision: 2, data: changedData, reason: '迁移后编辑' }, context(3));
    await contentPublication(runtime, 'tracks', track.id, 'publish', { revision: 3, reason: '迁移后发布' }, context(4));
    const newTrack = await createContentObject(runtime, 'tracks', { slug: 't22-post-migration', data: { ...data, coverAssetId: null }, reason: '迁移后新草稿' }, context());
    const platform = await saveContentPlatform(runtime, null, { trackId: track.id, provider: 'netease', status: 'planned', url: null,
      verifiedAt: null, releasedAt: null, territories: ['*'], sortOrder: 0 }, context());
    const gameData = { metadata: { originalLocale: 'en', title: { en: 'T22 synthetic game' }, summary: { en: 'Local rollback fixture only' } },
      launchUrl: '/games/cat-life/', supportedDevices: ['desktop', 'ios', 'android'], screenshotIds: [] };
    const game = await createContentObject(runtime, 'games', { slug: 'cat-life-game', data: gameData, reason: '本机介绍' }, context());
    const screenshot = randomUUID(); await mediaFixture(music, bucket, game.id, 'game_screenshot', screenshot);
    await saveContentObject(runtime, 'games', game.id, { revision: 1, data: { ...gameData, screenshotIds: [screenshot] }, reason: '合成截图' }, context());
    await contentPublication(runtime, 'games', game.id, 'publish', { revision: 2, reason: '隔离介绍' }, context(2));
    await music.prepare("UPDATE station_home_configs SET status='draft'").run();
    const http = []; let ip = 1;
    const request = async (path, { mode, ...options } = {}) => {
      const response = await mf.dispatchFetch('https://wwwstationcat.org' + path, { redirect: 'manual', ...options,
        headers: { 'CF-Connecting-IP': '192.0.2.' + (ip++ % 250 + 1), ...(mode ? { 'x-sc-t22-fixture': mode } : {}), ...options.headers } });
      http.push({ path, method: options.method || 'GET', mode: mode || 'candidate', status: response.status, location: response.headers.get('location') });
      return response;
    };
    const putSave = async (baseRevision, gold, mode) => {
      const response = await request('/api/readers/game-saves/cat-life', { mode, method: 'PUT', headers: { Cookie: cookie(2), Origin: 'https://wwwstationcat.org', 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision, saveData: makeSave(gold) }) });
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
    };
    await reader.batch([
      reader.prepare("INSERT INTO novel_orders(order_token,account_id,provider,order_type,price_amount,status) VALUES('T22-AFTER-ORDER',2,'creem','credit_pack','10.00','finished')"),
      reader.prepare('UPDATE reader_credit_accounts SET balance_credits=225,lifetime_purchased_credits=100 WHERE account_id=2'),
      reader.prepare("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,source,source_ref) VALUES(2,'purchase',100,225,'creem','T22-AFTER-ORDER')")
    ]);
    await putSave(4, 187);
    const item = event('track_view', { trackId: track.id });
    const eventOptions = { method: 'POST', headers: { Origin: 'https://wwwstationcat.org', 'X-Requested-With': 'StationCatEvents', 'Content-Type': 'application/json' }, body: JSON.stringify({ consentVersion: 'station-events-v1', events: [item] }) };
    const collected = await request('/api/station/events', eventOptions); assert.equal(collected.status, 200, await collected.clone().text()); assert.equal((await collected.json()).accepted, 1);
    const active = await request('/'); assert.equal(active.status, 200); assert.match(await active.text(), /data-sc-route-profile="brand"/);
    assert.equal((await request('/apps/')).status, 410);
    const gameRedirect = await request('/apps/cat-life-game/'); assert.equal(gameRedirect.status, 301); assert.equal(gameRedirect.headers.get('location'), '/en/games/cat-life-game/');
    assert.equal((await request(gameRedirect.headers.get('location'))).status, 200);
    for (const path of ['/robots.txt', '/sitemap.xml', '/sitemaps/tracks-1.xml', '/en/about/', '/zh-hant/music', '/music/tracks/permanent-free/', '/%61pps/']) {
      const response = await request(path); assert.ok(response.status < 500, path); await response.body?.cancel();
    }
    for (const flag of migrationFlags) {
      const partial = await request('/', { mode: flag }); assert.ok(!(await partial.text()).includes('data-sc-route-profile="brand"'), flag);
    }
    assert.equal((await request('/api/station/events', { ...eventOptions, mode: 'statistics-off' })).status, 503);
    assert.equal((await request('/music/tracks/permanent-free/', { mode: 'statistics-off' })).status, 200);
    assert.equal((await request('/games/cat-life/', { mode: 'statistics-off' })).status, 200);
    const protectedTables = { novel_orders: 'id', reader_credit_accounts: 'account_id', reader_credit_ledger: 'id', reader_game_saves: 'id', reader_game_save_backups: 'id' };
    const protectedReaderRows = async () => Object.fromEntries(await Promise.all(Object.entries(protectedTables).map(async ([table, key]) =>
      [table, (await reader.prepare('SELECT * FROM ' + table + ' ORDER BY ' + key).all()).results])));
    const beforeRollback = { music: await exportFixtureDatabase(music), reader: await exportFixtureDatabase(reader),
      objects: await exportFixtureObjects(bucket), business: await protectedReaderRows() };
    const oldHome = await request('/', { mode: 'rollback' }); assert.ok(!(await oldHome.text()).includes('data-sc-route-profile="brand"'));
    assert.equal((await request('/apps/', { mode: 'rollback' })).status, 301);
    const oldRuntime = await request('/games/cat-life/', { mode: 'rollback' }), newRuntime = await request('/games/cat-life/');
    assert.equal(oldRuntime.status, 200); assert.equal(await oldRuntime.text(), await newRuntime.text());
    for (const path of ['/api/readers/session', '/api/readers/membership', '/api/readers/orders', '/api/readers/game-saves/cat-life',
      '/api/mobile/v1/me/music/likes', '/.well-known/apple-app-site-association', '/admin/api/music/tracks']) {
      const options = { headers: { Cookie: cookie(2) } }, candidate = await request(path, options), rollback = await request(path, { ...options, mode: 'rollback' });
      assert.equal(candidate.status, rollback.status, path); assert.ok(candidate.status !== 500);
      await candidate.body?.cancel(); await rollback.body?.cancel();
    }
    // HTTP reads may append rate-limit rows; compare the complete business rows.
    assert.deepEqual(await protectedReaderRows(), beforeRollback.business);
    assert.equal((await music.prepare('SELECT COUNT(*) n FROM station_analytics_events').first()).n, 1);
    assert.deepEqual((await reader.prepare('SELECT * FROM novel_entitlements ORDER BY id').all()).results, originalEntitlements);
    assert.deepEqual((await reader.prepare('SELECT * FROM reader_memberships ORDER BY account_id').all()).results, originalMemberships);
    for (const table of ['music_tracks', 'music_track_revisions', 'music_assets']) for (const row of originalMusic[table]) {
      assert.deepEqual(await music.prepare('SELECT * FROM ' + table + ' WHERE id=?').bind(row.id).first(), row);
    }
    const currentReads = await legacyReads(music, legacy);
    for (const key of ['readiness', 'catalogs', 'details']) assert.deepEqual(currentReads[key], originalReads[key]);
    for (const reference of originalReads.cleanupReferences) {
      const current = currentReads.cleanupReferences.find(row => row.id === reference.id);
      assert.ok(current, reference.id);
      for (const [key, value] of Object.entries(reference)) if (key !== 'id') assert.ok(current[key] >= value, key + ' retains ' + reference.id);
    }
    await contentPublication(runtime, 'tracks', track.id, 'rollback', { revision: 2, reason: '隔离恢复旧内容' }, context(5));
    const restoredContent = await readContentObject(music, 'tracks', track.id);
    assert.equal(restoredContent.published.revision, 4); assert.equal(restoredContent.published.data.metadata.title.en, track.metadata.title.en);
    assert.equal(restoredContent.revisions.find(row => row.revision === 3).data.metadata.title.en, 'T22 after migration');
    assert.ok(await music.prepare('SELECT id FROM music_tracks WHERE id=?').bind(newTrack.id).first());
    assert.ok(await music.prepare('SELECT id FROM station_platform_links WHERE id=?').bind(platform.id).first());
    await putSave(5, 287, 'rollback');
    assert.equal((await reader.prepare('SELECT revision FROM reader_game_saves WHERE account_id=2').first()).revision, 6);
    assert.equal((await reader.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=2').first()).balance_credits, 225);
    assert.equal((await reader.prepare('SELECT COUNT(*) n FROM novel_orders').first()).n, 2);
    const after = { music: await exportFixtureDatabase(music), reader: await exportFixtureDatabase(reader) };
    const postRestore = { music: await restoreFixtureClone(await mf.getD1Database('AFTER_MUSIC_CLONE'), after.music),
      reader: await restoreFixtureClone(await mf.getD1Database('AFTER_READER_CLONE'), after.reader),
      objects: await restoreFixtureObjects(await mf.getR2Bucket('AFTER_RESTORE_BUCKET'), beforeRollback.objects) };
    await assert.rejects(restoreFixtureClone(reader, before.reader), /NEW empty clone/);
    await assert.rejects(restoreFixtureClone(music, before.music), /NEW empty clone/);
    await saveContentRights(runtime, track.cover, { scope: 'cover', status: 'blocked', basis: '合成权利撤销', reason: '回退必须重新核验' }, context());
    await assert.rejects(contentPublication(runtime, 'tracks', track.id, 'rollback', { revision: 3, reason: '应当拒绝' }, context(6)), { code: 'STATION_ASSET_NOT_READY' });
    const report = { executedAt: new Date().toISOString(), production: false, remoteOperations: 0,
      routing: inspectMigrationRouting(config.assets.run_worker_first), nativeAssetsRouter: true, appliedMigrations: applied,
      beforeRestore: preRestore, afterRestore: postRestore, http,
      checks: { preMigrationBackupRestores: true, objectBytesAndMetadataRestore: true, legacyRowsAndReadsRetained: true,
        backfillStillUnpublished: true, newOrdersAndBalanceRetained: true, oldEntitlementsAndMembershipRetained: true,
        newCloudRevisionRetainedAndWritableAfterRollback: true, newDraftPlatformAndEventRetained: true,
        contentRollbackAppendsRevision: true, currentRightsRechecked: true, liveBackupOverwriteRefused: true,
        partialActivationKeepsOldHome: true, statisticsOffKeepsMusicAndRuntime: true, runtimeBytesPreserved: true },
      observations: { ordersBefore: 1, ordersAfter: 2, balanceBefore: 125, balanceAfter: 225,
        cloudRevisionBefore: 4, cloudRevisionAfterWrite: 5, cloudRevisionAfterRollbackWrite: 6,
        contentPublishedBeforeRollback: 3, contentPublishedAfterRollback: 4, retainedEditedRevision: 3,
        eventRows: 1, activeDatabaseWasRestored: false, homePromotion: 'pending',
        beforeRollbackMusicFingerprint: beforeRollback.music.fingerprint },
      limits: ['Synthetic local D1/R2 and representative reader fixture only; no production backup, migration or cloud conflict verification',
        'Order and balance writes are fixture SQL, not merchant callbacks or real payment proof',
        'Small synthetic R2 bytes check identity and backup integrity, not media decoding, performance or rights',
        'Worker flags are local test overrides; actual deployment, production routing and retirement remain unexecuted',
        'In-flight cloud writes, cross-process local storage and iframe/exit limits remain unchanged'] };
    return { report, backups: { before, after }, objectManifest: beforeRollback.objects.map(({ key, bytes, sha256 }) => ({ key, byteSize: bytes.byteLength, sha256 })) };
  } finally { await mf.dispose(); }
}
