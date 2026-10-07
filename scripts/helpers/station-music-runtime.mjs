import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { migrationStatements } from './station-redesign-database.mjs';
import { readerStatements, seedReaders, iso } from './station-content-fixture.mjs';
import { seedStationMusicPages } from './station-music-fixture.mjs';
import { seedStationPlatformCases } from './station-platform-fixture.mjs';
import { seedStationVideoCases } from './station-video-fixture.mjs';

const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
export async function stationMusicAssets(request) {
  const pathname = new URL(request.url).pathname;
  const allowed = /^\/music\/site-shell\/(?:zh-Hant|zh-Hans|en|ja)\/$/.test(pathname) ||
    /^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(pathname) || pathname === '/images/station-gentle/cat-mark.webp' ||
    /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?music\/$/.test(pathname);
  if (!allowed) return new Response('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>本地預覽</title><p>此地址不屬於 T08 音樂交互預覽。帳號、遊戲與其他正式入口仍沿用現有網站。</p><a href="/music/">回到音樂預覽</a>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  const file = resolve(dist, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(resolve(dist) + sep)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(file), type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : 'text/html';
    return new Response(bytes, { headers: { 'Content-Type': type + (type.startsWith('text/') ? '; charset=utf-8' : ''), 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store' } });
  } catch { return new Response(null, { status: 404 }); }
}
export async function createStationMusicRuntime({ platformCases = false, videoCases = false } = {}) {
  const output = await build({ entryPoints: [fileURLToPath(new URL('station-music-runtime-worker.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wasm': 'binary' } });
  const mf = new Miniflare({ modules: true, script: output.outputFiles[0].text,
    compatibilityDate: '2026-05-17', host: '127.0.0.1', port: 0,
    d1Databases: { MUSIC_DB: 'station-music-pages-only', WAITLIST_DB: 'station-music-pages-readers-only', EMPTY_DB: 'station-music-pages-empty' },
    r2Buckets: { MUSIC_BUCKET: 'station-music-pages-only' },
    bindings: { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true',
      MUSIC_RATE_LIMIT_SECRET: 'station-music-pages-local-test-secret-no-production' },
    serviceBindings: { ASSETS: stationMusicAssets },
    outboundService: () => new Response('Outbound network disabled in local music preview', { status: 403 }) });
  try {
    const db = await mf.getD1Database('MUSIC_DB'), reader = await mf.getD1Database('WAITLIST_DB'), bucket = await mf.getR2Bucket('MUSIC_BUCKET');
    for (const group of migrationStatements().slice(0, -1)) await db.batch(group.statements.map(sql => db.prepare(sql)));
    const content = await seedStationMusicPages(db, bucket, { videoCases });
    const videoScenarios = videoCases ? await seedStationVideoCases(db, bucket, content) : null;
    const platformScenarios = platformCases ? await seedStationPlatformCases(db, content) : null;
    await reader.batch(readerStatements().map(sql => reader.prepare(sql))); await seedReaders(reader);
    const time = Date.now();
    await reader.prepare('UPDATE reader_sessions SET created_at=?,expires_at=?').bind(iso(time - 60000), iso(time + 3600000)).run();
    await reader.prepare('UPDATE reader_memberships SET started_at=?,expires_at=? WHERE account_id=1').bind(iso(time - 60000), iso(time + 3600000)).run();
    return { mf, db, reader, bucket, content, platformScenarios, videoScenarios, async close() { await mf.dispose(); } };
  } catch (error) { await mf.dispose(); throw error; }
}
