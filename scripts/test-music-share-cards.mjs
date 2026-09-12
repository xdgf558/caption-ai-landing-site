import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { basename, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { handleMusicShareCard, readMusicShareBytes } from '../src/music/shareCardHttp.js';
import { musicShareCardData, musicShareCardPath, musicShareMetadata, musicShareLines, MUSIC_SHARE_FONT } from '../src/music/shareCard.js';
import { normalizeMusicCardCover, renderMusicShareCard } from '../src/music/shareCardRender.js';
import { createMusicShareCards, shareMusicCardFile } from '../src/scripts/musicShareCardClient.js';
import { tracks } from './fixtures/music-player/data.mjs';

const now = Date.parse('2026-09-12T01:00:00Z'), origin = 'https://music.example.test', id = '22222222-2222-4222-8222-222222222222';
const root = new URL('../', import.meta.url), file = path => readFileSync(new URL(path, root));
const font = file('public' + MUSIC_SHARE_FONT), webp = file('scripts/fixtures/music-player/artwork/night.webp');
const track = { ...tracks[1], id, title: '晚安，小城市', creatorName: 'Station Cat', audioVersion: 1, effectiveAccess: 'vip', previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 0 };
const dbs = []; afterEach(() => dbs.splice(0).forEach(db => db.close()));
const request = (path = musicShareCardPath(id, 1, 'zh-Hans'), options = {}) => new Request(origin + path, { headers: { 'CF-Connecting-IP': '192.0.2.9' }, ...options });
async function fixture() {
  const fixture = musicTestDatabase(), { sql, db } = fixture; dbs.push(sql);
  const revision = randomUUID(), audio = randomUUID(), preview = randomUUID(), cover = randomUUID(), objects = new Map();
  const insert = (table, data) => { const keys = Object.keys(data); sql.prepare(`INSERT INTO ${table}(${keys}) VALUES(${keys.map(() => '?')})`).run(...Object.values(data)); };
  insert('music_tracks', { id, slug: 'card-fixture', created_at: now - 5000, updated_at: now - 1000 });
  for (const [asset, kind, duration] of [[audio, 'audio', 120000], [preview, 'preview', 30000], [cover, 'cover', null]]) {
    const bytes = kind === 'cover' ? webp : new Uint8Array([1, 2, 3]), key = `music/${kind === 'preview' ? 'previews' : kind === 'cover' ? 'covers' : 'audio'}/${id}/${asset}.${kind === 'cover' ? 'webp' : 'mp3'}`;
    const data = { id: asset, owner_track_id: id, state: 'validated', kind, format: kind === 'cover' ? 'webp' : 'mp3', content_type: kind === 'cover' ? 'image/webp' : 'audio/mpeg', byte_size: bytes.length,
      duration_ms: duration, object_key: key, sha256: createHash('sha256').update(bytes).digest('hex'), etag: 'fixture', created_at: now - 4000,
      ...(kind === 'preview' ? { derived_from_asset_id: audio, source_start_ms: 0, source_end_ms: 30000 } : {}) };
    insert('music_assets', data); objects.set(key, { bytes, asset: data });
  }
  insert('music_track_revisions', { id: revision, track_id: id, revision_no: 1, state: 'sealed', audio_asset_id: audio, preview_asset_id: preview, cover_asset_id: cover,
    access_mode: 'vip', created_at: now - 3000, technical_reviewed_at: now - 2000, technical_fingerprint: 'b'.repeat(64), metadata_json: JSON.stringify({ originalLocale: 'zh-Hans',
      title: { 'zh-Hans': track.title }, summary: { 'zh-Hans': '' }, creatorName: track.creatorName, language: 'instrumental', instrumental: true, genres: [], moods: [] }) });
  sql.prepare("UPDATE music_tracks SET lifecycle='published',published_revision_id=?,first_published_at=?,published_at=? WHERE id=?").run(revision, now - 1000, now - 1000, id);
  const state = { r2: [], assets: [], changed: false, missingFont: false };
  const env = { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_SHARE_CARDS_ENABLED: 'true', MUSIC_RATE_LIMIT_SECRET: 'share-test-secret-only-not-for-deployment', MUSIC_DB: db,
    MUSIC_BUCKET: { async get(key, options) { state.r2.push(key); assert.equal(options.onlyIf.etagMatches, 'fixture'); const value = objects.get(key);
      return { key, size: value.bytes.length, etag: state.changed ? 'changed' : 'fixture', httpMetadata: { contentType: value.asset.content_type }, body: new Response(value.bytes).body }; } },
    ASSETS: { async fetch(req) { state.assets.push(req.url); assert.equal(new URL(req.url).pathname, MUSIC_SHARE_FONT); assert.equal(req.headers.has('cookie'), false);
      return state.missingFont ? new Response('missing', { status: 404 }) : new Response(font, { headers: { 'Content-Length': String(font.length) } }); } } };
  return { ...fixture, env, state, revision, cover, objects };
}
test('invalid input and either disabled flag read no bindings, counters, media or fonts', async () => {
  for (const flags of [{}, { MUSIC_PUBLIC_ENABLED: 'true' }, { MUSIC_PUBLIC_ENABLED: 'false', MUSIC_SHARE_CARDS_ENABLED: 'true' }]) {
    const env = { ...flags }; for (const key of ['MUSIC_DB', 'MUSIC_BUCKET', 'ASSETS', 'WAITLIST_DB']) Object.defineProperty(env, key, { get() { assert.fail(key); } });
    assert.equal((await handleMusicShareCard(request(), env)).status, 503);
    assert.equal((await handleMusicShareCard(request('/api/music/tracks/bad/share.png'), env)).status, 400);
    assert.equal((await handleMusicShareCard(request(undefined, { method: 'POST' }), env)).status, 405);
  }
  const path = musicShareCardPath(id, 1, 'zh-Hans');
  assert.equal((await handleMusicShareCard(request(path + '&v=1'), {})).status, 400);
  assert.equal((await handleMusicShareCard(request(path + '&key=private'), {})).status, 400);
});
test('PNG reads only current public cover, keeps VIP anonymous, QR links contain no identity', async () => {
  const f = await fixture();
  f.env.WAITLIST_DB = { prepare() { assert.fail('public card must not query reader identity'); } };
  const response = await handleMusicShareCard(request(undefined, { headers: { 'CF-Connecting-IP': '192.0.2.9', Cookie: 'CF_Authorization=test-edge-session; reader_session=ignored-test-only' } }), f.env, { clock: () => now });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const png = new Uint8Array(await response.arrayBuffer()), decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 1080); assert.equal(decoded.info.height, 1800);
  assert.equal(jsQR(new Uint8ClampedArray(decoded.data), decoded.info.width, decoded.info.height).data, `${origin}/zh-hans/music/?track=${id}`);
  assert.equal(f.state.r2.length, 1); assert.ok(f.state.r2[0].includes('/covers/')); assert.equal(f.state.assets.length, 1);
});
test('HEAD/version/downlisting/limit failure precede R2 and renderer', async () => {
  const f = await fixture(), options = { clock: () => now, render() { assert.fail('render'); } };
  assert.equal((await handleMusicShareCard(request(undefined, { method: 'HEAD', headers: { 'CF-Connecting-IP': '192.0.2.9' } }), f.env, options)).status, 200);
  assert.equal((await handleMusicShareCard(request(musicShareCardPath(id, 2, 'en')), f.env, options)).status, 409);
  f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(id);
  assert.equal((await handleMusicShareCard(request(), f.env, options)).status, 410);
  for (let i = 0; i < 3; i++) await handleMusicShareCard(request(), f.env, options);
  const limited = await handleMusicShareCard(request(), f.env, options); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(f.state.r2.length, 0); assert.equal(f.state.assets.length, 0);
  assert.equal(f.sql.prepare("SELECT hits FROM music_rate_windows WHERE category='artwork'").get().hits, 6);
});
test('bad source/secret/database fail closed, changed cover and missing font never yield an image', async () => {
  const f = await fixture();
  assert.equal((await handleMusicShareCard(request(undefined, { headers: { 'X-Forwarded-For': '192.0.2.9' } }), f.env)).status, 503);
  assert.equal((await handleMusicShareCard(request(), { ...f.env, MUSIC_RATE_LIMIT_SECRET: '' })).status, 503);
  assert.equal(f.state.r2.length, 0);
  f.state.changed = true; assert.equal((await handleMusicShareCard(request(), f.env, { clock: () => now })).status, 503);
  assert.equal(f.state.assets.length, 0);
  f.state.changed = false; f.state.missingFont = true;
  assert.equal((await handleMusicShareCard(request(), f.env, { clock: () => now })).status, 503);
});
test('body and decoded image budgets reject truncation, overflow and oversized pixels', async () => {
  await assert.rejects(readMusicShareBytes(new Response(new Uint8Array(11)).body, 10, 10));
  await assert.rejects(readMusicShareBytes(new Response(new Uint8Array(9)).body, 10, 10));
  const huge = await sharp({ create: { width: 2049, height: 2049, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.throws(() => normalizeMusicCardCover(huge, 'image/png'), /TOO_LARGE/);
  assert.throws(() => normalizeMusicCardCover(new TextEncoder().encode('<svg/>'), 'image/svg+xml'));
});
test('all supported raster formats render; titles/QR/XML cannot inject remote image URLs or credentials', async () => {
  const data = musicShareCardData({ ...track, title: '</title><script>bad</script>', creatorName: 'A & B', coverUrl: 'https://evil.test' }, origin, 'en');
  const meta = musicShareMetadata({ ...track, title: '\"/><script>bad</script>', objectKey: 'private' }, origin, 'en');
  assert.ok(meta.includes('&lt;script&gt;')); assert.doesNotMatch(meta, /<script>|private|evil\.test|token=/);
  for (const format of ['png', 'jpeg', 'webp']) assert.ok(normalizeMusicCardCover(await sharp(webp).toFormat(format).toBuffer(), `image/${format}`).length);
  const png = await renderMusicShareCard(data, 'card', null, font); assert.equal((await sharp(png).metadata()).width, 1200);
  assert.deepEqual(musicShareLines('Goodnight, Little City', 7.4, 3), ['Goodnight,', 'Little City']);
  assert.equal(musicShareLines('a'.repeat(200), 5, 2).length, 2); assert.ok(musicShareLines('长'.repeat(200), 5, 2).at(-1).endsWith('…'));
  assert.throws(() => musicShareCardData(track, 'https://user:pass@evil.test', 'en'));
});

const detail = fresh => new Response(JSON.stringify({ schemaVersion: 2, track: fresh }), { headers: { 'Content-Type': 'application/json' } });
function fakePng(format = 'poster') { const out = new Uint8Array(24); out.set([137,80,78,71,13,10,26,10],0); out.set([73,72,68,82],12); const v=new DataView(out.buffer); v.setUint32(16,format==='poster'?1080:1200);v.setUint32(20,format==='poster'?1800:630); return new Response(out,{headers:{'Content-Type':'image/png'}}); }
function client(fetcher) { const created = [], revoked = [], states = []; const api = createMusicShareCards({ locale: 'zh-Hans', origin, fetcher,
  urls: { createObjectURL(blob) { created.push(blob); return `blob:${created.length}`; }, revokeObjectURL(url) { revoked.push(url); } }, onChange: state => states.push(state) }); return { api, created, revoked, states }; }
test('card preparation is lazy, fresh revision wins, same-origin Access session never crosses redirects', async () => {
  const calls = [], f = client(async (path, options) => { calls.push([path, options]); return calls.length === 1 ? detail({ ...track, audioVersion: 2 }) : fakePng(); });
  assert.equal(calls.length,0); await f.api.prepare(track);
  assert.equal(f.api.snapshot().status,'ready'); assert.ok(calls[1][0].includes('v=2'));
  assert.ok(calls.every(([,o])=>o.credentials==='same-origin' && o.cache==='no-store' && o.redirect==='error'));
  assert.doesNotMatch(calls.map(([p])=>p).join(' '), /audio\?|access\?|https:\/\/evil/);
  f.api.close(); assert.deepEqual(f.revoked,['blob:1']); assert.equal(f.api.snapshot().blob,null);
});
test('late A response cannot replace B or revive a closed panel; failed refresh clears old blob', async () => {
  let release; const a = new Promise(resolve=>{release=resolve;}); let calls=0;
  const f = client(async () => ++calls === 1 ? a : calls===2 ? detail(track) : fakePng('card'));
  const pending = f.api.prepare(track); await f.api.prepare(track,'card'); assert.equal(f.api.snapshot().format,'card');
  release(detail(track)); await pending; assert.equal(f.created.length,1);
  const previous=f.api.snapshot().imageUrl; f.api.close(); assert.ok(f.revoked.includes(previous));
  const bad=client(async()=>new Response('denied',{status:410}));await bad.api.prepare(track);assert.equal(bad.api.snapshot().code,'SHARE_TRACK_UNAVAILABLE');bad.api.destroy();f.api.destroy();
});
test('oversized/HTML/wrong-size responses do not become image object URLs', async () => {
  for (const bad of [new Response('<html/>',{headers:{'Content-Type':'text/html'}}),fakePng('card'),new Response('x',{headers:{'Content-Type':'image/png','Content-Length':'99999999'}})]) {
    let n=0; const f=client(async()=>++n===1?detail(track):bad);await f.api.prepare(track);assert.equal(f.api.snapshot().status,'error');assert.equal(f.created.length,0);f.api.destroy();
  }
});
test('file share is invoked within the user gesture, unsupported/cancelled remains a local fallback', async () => {
  let invoked=false, resolve; const pending=new Promise(r=>{resolve=r;});
  const result=shareMusicCardFile(new Blob(['png']), 'Song', {navigator:{canShare:()=>true,share(){invoked=true;return pending;}}});
  assert.equal(invoked,true);resolve();assert.equal(await result,'shared');
  assert.equal(await shareMusicCardFile(new Blob(),'',{navigator:{canShare:()=>false}}),'unavailable');
  assert.equal(await shareMusicCardFile(new Blob(),'',{navigator:{canShare:()=>true,share(){throw Object.assign(new Error(),{name:'AbortError'});}}}),'cancelled');
});

test('actual workerd renders PNG with D1/R2/ASSETS and rewrites one set of song metadata', { timeout: 60000 }, async () => {
  const f = await fixture(), wasm = new Map();
  const compiled = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {handleMusicShareCard} from './src/music/shareCardHttp.js';
    import {handleMusicPage} from './src/music/pageHttp.js';
    export default {fetch(request,env){
      const assets=env.ASSETS; env={...env,ASSETS:{fetch(r){return new URL(r.url).pathname.startsWith('/fonts/')?assets.fetch(r):new Response('<html><head><title>Generic</title><meta property="og:title" content="generic"><meta name="twitter:card" content="summary"><link rel="canonical" href="https://wrong.test/"></head><body>one audio shell</body></html>',{headers:{'Content-Type':'text/html'}})}}};
      return new URL(request.url).pathname.startsWith('/api/')?handleMusicShareCard(request,env,{clock:()=>${now}}):handleMusicPage(request,env,{clock:()=>${now}});
    }}` }, bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], write: false,
    plugins: [{ name: 'wasm-modules', setup(builder) { builder.onResolve({ filter: /\.wasm$/ }, args => {
      const name = basename(args.path); wasm.set(name, readFileSync(resolve(args.resolveDir, args.path))); return { path: './' + name, external: true };
    }); } }] });
  const mf = new Miniflare({ modulesRoot: '/music-share-test', modules: [{ type: 'ESModule', path: '/music-share-test/index.mjs', contents: compiled.outputFiles[0].text },
    ...[...wasm].map(([name, contents]) => ({ type: 'CompiledWasm', path: '/music-share-test/' + name, contents }))], compatibilityDate: '2026-08-01', host: '127.0.0.1', port: 0,
    d1Databases: { MUSIC_DB: 'music-share-test-only' }, r2Buckets: { MUSIC_BUCKET: 'music-share-test-only' }, assets: { directory: resolve('public'), binding: 'ASSETS', routerConfig: { has_user_worker: true, static_routing: { user_worker: ['/*'] } } },
    bindings: { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_SHARE_CARDS_ENABLED: 'true', MUSIC_RATE_LIMIT_SECRET: 'share-runtime-secret-only-not-for-deployment' },
    outboundService: () => new Response('No external network', { status: 403 }) });
  const parser = new DatabaseSync(':memory:');
  try {
    const db = await mf.getD1Database('MUSIC_DB'), bucket = await mf.getR2Bucket('MUSIC_BUCKET');
    for (const name of ['0001_music_foundation.sql', '0002_music_publication.sql', '0003_music_uploads.sql', '0004_music_cleanup.sql', '0005_music_rate_limits.sql', '0006_music_analytics.sql', '0007_music_albums.sql']) {
      let sql = file('migrations-music/' + name).toString(); const statements = [];
      while (sql.trim()) { const statement = parser.prepare(sql), source = statement.sourceSQL; statement.run(); statements.push(db.prepare(source)); sql = sql.slice(source.length); }
      await db.batch(statements);
    }
    const statements = [];
    for (const table of ['music_tracks', 'music_assets', 'music_track_revisions']) for (const row of f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()) {
      if (table === 'music_tracks') Object.assign(row, { lifecycle: 'draft', published_revision_id: null, published_at: null, first_published_at: null });
      if (table === 'music_assets' && row.kind === 'cover') { const object = await bucket.put(row.object_key, webp, { httpMetadata: { contentType: 'image/webp' } }); row.etag = object.etag; }
      const keys = Object.keys(row); statements.push(db.prepare(`INSERT INTO ${table}(${keys}) VALUES(${keys.map(() => '?')})`).bind(...Object.values(row)));
    }
    statements.push(db.prepare("UPDATE music_tracks SET lifecycle='published',published_revision_id=?,published_at=?,first_published_at=? WHERE id=?").bind(f.revision, now - 1000, now - 1000, id));
    await db.batch(statements);
    const headers = { 'CF-Connecting-IP': '192.0.2.55' };
    const html = await mf.dispatchFetch(`http://music.test/zh-hans/music/?track=${id}`, { headers });
    const content = await html.text(); assert.equal(html.status, 200, content);
    assert.equal((content.match(/property="og:title"/g) || []).length, 1); assert.equal((content.match(/<title>/g) || []).length, 1);
    assert.match(content, /晚安，小城市/); assert.doesNotMatch(content, /wrong\.test|content="generic"|token=/);
    assert.match(content, /format=card/); assert.equal(html.headers.get('cache-control'), 'private, no-store');
    const images = await Promise.all([0, 1, 2].map(() => mf.dispatchFetch('http://music.test' + musicShareCardPath(id, 1, 'zh-Hans'), { headers })));
    for (const response of images) {
      assert.equal(response.status, 200); const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal((await sharp(bytes).metadata()).height, 1800);
    }
    await db.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").bind(id).run();
    assert.equal((await mf.dispatchFetch('http://music.test' + musicShareCardPath(id, 1, 'zh-Hans'), { headers })).status, 410);
    assert.equal((await mf.dispatchFetch(`http://music.test/zh-hans/music/?track=${id}`, { headers })).status, 410);
  } finally { parser.close(); await mf.dispose(); }
});
