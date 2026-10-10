import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements, insertFixture } from './station-redesign-database.mjs';
import { seedStationMusicPages } from './station-music-fixture.mjs';
import { memberFixtureMigrations } from './station-member-runtime.mjs';
import { migrationFlags } from '../../src/redesign/routeMigrationPaths.js';

export const routeFixtureCookie = id => 'station_cat_reader_session=t20-local-session-' + id;
export async function createStationRouteRuntime({ videoCases = false, bindings = {} } = {}) {
  const output = await build({ entryPoints: [fileURLToPath(new URL('station-route-runtime-worker.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wasm': 'binary' } });
  const mf = new Miniflare({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-05-17', host: '127.0.0.1', port: 0,
    log: new Log(LogLevel.ERROR),
    d1Databases: { WAITLIST_DB: 't20-local-readers', MUSIC_DB: 't20-local-music', EMPTY_DB: 't20-local-empty' },
    r2Buckets: { MUSIC_BUCKET: 't20-local-music', CONTENT_BUCKET: 't20-local-novels' },
    bindings: { ...Object.fromEntries(migrationFlags.map(key => [key, 'true'])), STATION_SEARCH_INDEXING_ENABLED: 'false',
      MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true', MUSIC_RATE_LIMIT_SECRET: 't20-synthetic-secret-only-at-least-32-characters',
      ALLOW_LOCAL_ADMIN: 'false', MOBILE_PRODUCTION_ASSOCIATION_ENABLED: 'false', ...bindings },
    // Actual Workers asset router, not a filesystem handler approximation.
    // It parses the built _redirects/_headers and uses the real asset manifest.
    assets: { directory: fileURLToPath(new URL('../../dist/', import.meta.url)), binding: 'ASSETS',
      routerConfig: { invoke_user_worker_ahead_of_assets: true, has_user_worker: true }, assetConfig: { not_found_handling: '404-page' } },
    outboundService: () => new Response('Outbound network disabled in T20 fixture', { status: 403 }) });
  try {
    const reader = await mf.getD1Database('WAITLIST_DB'), db = await mf.getD1Database('MUSIC_DB'), bucket = await mf.getR2Bucket('MUSIC_BUCKET');
    const parser = new DatabaseSync(':memory:');
    try {
      for (const name of ['0001_waitlist.sql', '0002_download_rate_limits.sql', ...memberFixtureMigrations]) {
        let remaining = await readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8'); const statements = [];
        while (remaining.trim()) {
          const statement = parser.prepare(remaining), source = statement.sourceSQL;
          statement.run(); statements.push(source); remaining = remaining.slice(source.length);
        }
        await reader.batch(statements.map(sql => reader.prepare(sql)));
      }
    } finally { parser.close(); }
    for (const group of migrationStatements().slice(0, -1)) await db.batch(group.statements.map(sql => db.prepare(sql)));
    const content = await seedStationMusicPages(db, bucket, { gameCases: true, videoCases });
    const time = Date.now(), iso = value => new Date(value).toISOString();
    for (const id of [1,2,3]) {
      await insertFixture(reader, 'reader_accounts', { id, email: 't20-' + id + '@example.test', normalized_email: 't20-' + id + '@example.test', display_name: 'Local T20 ' + id });
      await insertFixture(reader, 'reader_sessions', { account_id: id, session_hash: createHash('sha256').update('t20-local-session-' + id).digest('hex'), expires_at: iso(time + 86400000) });
    }
    await insertFixture(reader, 'reader_memberships', { account_id: 1, started_at: iso(time - 86400000), expires_at: iso(time + 86400000) });
    await insertFixture(reader, 'novel_entitlements', { account_id: 2, series_slug: 't20-history', scope: 'series', access_level: 'all', source: 't20-local', source_ref: 'synthetic-history' });
    await insertFixture(reader, 'reader_game_saves', { account_id: 2, game_key: 'cat-life', save_json: '{"fixture":"t20-preserved"}', save_hash: 't20-local-save-only', save_bytes: 27, revision: 4, client_updated_at: iso(time - 60000) });
    for (const locale of ['zh-Hant','en']) {
      const row = { locale, status: 'published', visibility: 'public', title: 'T20 local reading fixture', published_at: iso(time - 60000) };
      await insertFixture(reader, 'content_entries', { ...row, entry_type: 'novel_series', slug: 't20-history' });
      await insertFixture(reader, 'content_entries', { ...row, entry_type: 'novel_chapter', slug: 'chapter-one', parent_slug: 't20-history', chapter_number: 1, excerpt: 'T20-PRESERVED-FREE-CHAPTER' });
      await insertFixture(reader, 'content_entries', { ...row, entry_type: 'novel_chapter', slug: 'paid-chapter', parent_slug: 't20-history', chapter_number: 12, access_level: 'paid', excerpt: 'T20-PAID-EXCERPT' });
      await insertFixture(reader, 'content_entries', { ...row, entry_type: 'blog_post', slug: 't20-old-dynamic' });
      await insertFixture(reader, 'content_entries', { ...row, entry_type: 'signal_brief', slug: 't20-old-signal' });
    }
    const references = {
      production: false, createdAt: iso(time),
      routes: (await db.prepare('SELECT * FROM station_track_routes ORDER BY slug').all()).results,
      routeProposals: (await db.prepare('SELECT * FROM station_route_migrations ORDER BY old_path').all()).results,
      publications: (await db.prepare('SELECT track_id,status,published_revision FROM station_track_publications ORDER BY track_id').all()).results,
      reading: (await reader.prepare('SELECT id,entry_type,locale,slug,parent_slug,access_level FROM content_entries ORDER BY id').all()).results,
      entitlements: (await reader.prepare('SELECT account_id,series_slug,scope,access_level FROM novel_entitlements ORDER BY id').all()).results,
      saves: (await reader.prepare('SELECT account_id,game_key,save_json,save_hash,save_bytes,revision FROM reader_game_saves ORDER BY account_id').all()).results,
    };
    return { mf, reader, db, bucket, content, references, async close() { await mf.dispose(); } };
  } catch (error) { await mf.dispose(); throw error; }
}
