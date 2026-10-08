import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { migrationStatements, insertFixture } from './station-redesign-database.mjs';
import { seedStationMusicPages } from './station-music-fixture.mjs';

export const memberFixturePassword = 'Local-member-14-only';
export const memberFixtureCookie = id => 'station_cat_reader_session=t14-local-session-' + id;
export const memberFixtureMigrations = [
  '0003_reader_accounts.sql', '0004_novel_entitlements.sql', '0005_novel_payments.sql', '0006_reader_credits.sql',
  '0007_backend_content_platform.sql', '0008_admin_content_settings.sql', '0009_reader_memberships.sql',
  '0010_reader_bookmarks.sql', '0011_reader_password_credentials.sql', '0012_reader_totp_credentials.sql',
  '0013_reader_totp_reset_attempts.sql', '0028_station_points.sql', '0029_creem_credit_topup_idempotency.sql',
  '0030_creem_reversals_and_event_ids.sql', '0031_reader_game_saves.sql', '0032_reader_game_save_recovery.sql',
  '0033_cat_life_game_commerce.sql', '0034_cat_life_game_commerce_api.sql', '0035_cat_life_game_commerce_admin.sql',
  '0036_reader_membership_redemptions.sql', '0037_membership_refund_reviews.sql'
];
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
export async function stationMemberAssets(request, root = dist) {
  const path = new URL(request.url).pathname;
  if (!(/^\/(?:member|music|games)\/site-shell\/(?:zh-Hant|zh-Hans|en|ja)\/$/.test(path) ||
    /^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css|webp)$/.test(path) ||
    /^\/images\/(?:station-gentle|points-night)\/[A-Za-z0-9_.-]+\.(?:webp|png)$/.test(path) ||
    /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?(?:library|points|privacy|terms)\/$/.test(path) ||
    path.startsWith('/games/cat-life/'))) return new Response(null, { status: 404 });
  let decoded; try { decoded = decodeURIComponent(path); } catch { return new Response(null, { status: 404 }); }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
  for (const directory of [root, dist]) {
    const file = resolve(directory, '.' + decoded, path.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(resolve(directory) + sep)) continue;
    try { const bytes = await readFile(file); return new Response(bytes, { headers: {
      'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } }); }
    catch {}
  }
  return new Response(null, { status: 404 });
}

// Real Worker and disposable D1/R2 only. No Wrangler config, credentials,
// production bindings, merchant calls, remote migrations or remote media.
export async function createStationMemberRuntime({ assetRoot = dist } = {}) {
  const output = await build({ entryPoints: [fileURLToPath(new URL('station-member-runtime-worker.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wasm': 'binary' } });
  const mf = new Miniflare({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-05-17', host: '127.0.0.1', port: 0,
    d1Databases: { WAITLIST_DB: 'station-member-local-readers', MUSIC_DB: 'station-member-local-music', EMPTY_DB: 'station-member-local-empty' },
    r2Buckets: { MUSIC_BUCKET: 'station-member-local-music' },
    bindings: { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true', MUSIC_RATE_LIMIT_SECRET: 't14-synthetic-no-production-secret',
      STATION_CONTENT_PUBLIC_ENABLED: 'true', STATION_MUSIC_PAGES_ENABLED: 'true', STATION_GAME_PAGES_ENABLED: 'true' },
    serviceBindings: { ASSETS: request => stationMemberAssets(request, assetRoot) },
    outboundService: () => new Response('Outbound network disabled in local T14 fixture', { status: 403 }) });
  try {
    const reader = await mf.getD1Database('WAITLIST_DB'), db = await mf.getD1Database('MUSIC_DB'), bucket = await mf.getR2Bucket('MUSIC_BUCKET');
    const parser = new DatabaseSync(':memory:');
    try {
      for (const name of memberFixtureMigrations) {
        let remaining = await readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8'); const statements = [];
        while (remaining.trim()) { const statement = parser.prepare(remaining), source = statement.sourceSQL;
          statement.run(); statements.push(source); remaining = remaining.slice(source.length); }
        await reader.batch(statements.map(sql => reader.prepare(sql)));
      }
    } finally { parser.close(); }
    for (const group of migrationStatements().slice(0, -1)) await db.batch(group.statements.map(sql => db.prepare(sql)));
    const content = await seedStationMusicPages(db, bucket, { gameCases: true });
    const time = Date.now(), iso = offset => new Date(time + offset).toISOString();
    for (const [id, name, balance] of [[1, 'GentleMember', 100], [2, 'ArchiveFriend', 23], [3, 'ExpiredFriend', 0]]) {
      await insertFixture(reader, 'reader_accounts', { id, email: name.toLowerCase() + '@example.test', normalized_email: name.toLowerCase() + '@example.test', display_name: name });
      const salt = 't14-local-only-salt-' + id;
      await insertFixture(reader, 'reader_password_credentials', { account_id: id, username: name, normalized_username: name.toLowerCase(),
        password_hash: pbkdf2Sync(memberFixturePassword, salt, 100000, 32, 'sha256').toString('hex'), password_salt: salt });
      await insertFixture(reader, 'reader_sessions', { account_id: id, session_hash: createHash('sha256').update('t14-local-session-' + id).digest('hex'), expires_at: iso(86400000) });
      await insertFixture(reader, 'reader_credit_accounts', { account_id: id, balance_credits: balance, currency_label: 'Station Points' });
    }
    for (const [id, expiry] of [[1, 86400000], [3, -60000]]) await insertFixture(reader, 'reader_memberships', { account_id: id, started_at: iso(-86400000), expires_at: iso(expiry) });
    await insertFixture(reader, 'novel_entitlements', { account_id: 2, series_slug: 'local-history-fixture', scope: 'series', access_level: 'all', source: 'local-t14', source_ref: 'historical-fixture' });
    await insertFixture(reader, 'reader_bookmarks', { account_id: 2, series_slug: 'local-history-fixture', chapter_slug: 'chapter-one', series_title: '本機歷史閱讀夾具', chapter_title: '已保存的閱讀位置', source_path: '/novel/', progress_percent: 42 });
    await insertFixture(reader, 'game_entitlements', { account_id: 2, game_key: 'cat-life', entitlement_key: 'cat-life.cosmetic.skin.moonlit-tabby.v1',
      product_id: 'cat-life.skin.moonlit-tabby', purchase_id: null, grant_source: 'admin', source_ref: 't14-local-only', grant_reason: 'Synthetic historical entitlement' });
    for (const [token, id, status] of [['T14-MEMBER-ORDER', 1, 'waiting'], ['T14-HISTORY-ORDER', 2, 'finished'], ['T14-GUEST-TIP', null, 'finished'], ['T14-REFUNDED', 2, 'refunded']]) {
      await insertFixture(reader, 'novel_orders', { order_token: token, account_id: id, order_type: 'tip', price_amount: '2.00', price_currency: 'USD', status });
    }
    await insertFixture(reader, 'reader_game_saves', { account_id: 2, game_key: 'cat-life', save_json: '{"fixture":"cloud-presence-only"}', save_hash: 't14-local-cloud-presence-only', save_bytes: 39, revision: 4, client_updated_at: iso(-60000), updated_at: iso(-60000) });
    return { mf, reader, db, bucket, content, async close() { await mf.dispose(); } };
  } catch (error) { await mf.dispose(); throw error; }
}
