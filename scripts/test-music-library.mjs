import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import worker from '../src/worker.js';
import { handleMusicPage } from '../src/music/pageHttp.js';
import { musicPagePaths, musicPageHref, musicSelection, isMusicPagePath } from '../src/music/pagePaths.js';
import { readPlayerCatalog, readPlayerCollections, readPlayerFeatured } from '../src/scripts/musicPlayerCatalog.js';
import { browseMusic, libraryFilters, normalizeMusicSearch, libraryNoticeHash } from '../src/scripts/musicLibrary.js';
import { musicMessages, musicText, musicLocales } from '../src/scripts/musicMessages.js';
import { shouldIncludeSitemapRoute } from './generate-sitemap.mjs';
import { createMusicPlayer } from '../src/scripts/musicPlayerCore.js';
import { createMusicQueue } from '../src/scripts/musicPlayerQueue.js';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { tracks as originals } from './fixtures/music-player/data.mjs';
const tracks = readPlayerCatalog({ schemaVersion: 2, tracks: Array.from({ length: 500 }, (_, i) => ({ ...originals[i % 3],
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: `Song ${i + 1}`,
  effectiveAccess: i % 2 ? 'vip' : 'free', genres: i % 2 ? ['Jazz'] : ['Piano', 'Folk'], moods: i % 3 ? ['Calm'] : ['Bright'],
  publishedAt: new Date(Date.UTC(2026, 8, 11) - i * 86400000).toISOString() })) });
const group = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'quiet', title: 'Quiet', description: 'A quiet day', trackIds: [tracks[4].id, tracks[1].id, tracks[0].id] };
const request = (path, method = 'GET') => new Request(`https://music.example.test${path}`, { method });

test('browse normalization retains only static notice anchors, never a return or credential fragment', () => {
  for (const value of ['#music-listening', '#music-privacy']) assert.equal(libraryNoticeHash(value), value);
  for (const value of [undefined, '', '#membership-return', '#music-privacy?token=secret', '#token=secret', '#music%2Dprivacy']) assert.equal(libraryNoticeHash(value), '');
});

test('every HTML path, alias, slashless and nested asset path is gated with zero binding reads', async () => {
  for (const path of [...Object.values(musicPagePaths), '/zh-hant/music/', '/music', '/music/index.html', '/en/music/index.html', '/%6dusic/', '/music%2f', '/en/%6dusic/', '/%2fmusic/']) {
    assert.equal(isMusicPagePath(path), true);
    for (const flag of [undefined, 'false', true, 'TRUE']) {
      const env = { MUSIC_PUBLIC_ENABLED: flag };
      for (const key of ['ASSETS', 'MUSIC_DB', 'MUSIC_BUCKET', 'WAITLIST_DB']) Object.defineProperty(env, key, { get() { assert.fail(`read ${key}`); } });
      const response = await worker.fetch(request(path), env, {});
      assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal((await response.json()).error.code, 'MUSIC_PUBLIC_DISABLED');
    }
  }
});
test('alias and slashless redirects preserve only unique valid public identifiers', async () => {
  const query = `track=${tracks[0].id}&collection=quiet&token=secret&returnTo=https://evil.test&autoplay=1`;
  assert.equal(musicPageHref('zh-Hant', query), `/music/?track=${tracks[0].id}&collection=quiet`);
  const env = { MUSIC_PUBLIC_ENABLED: 'true', get ASSETS() { assert.fail('redirect read assets'); } };
  for (const path of ['/zh-hant/music', '/zh-hant/music/', '/music']) {
    const response = await handleMusicPage(request(`${path}?${query}`), env);
    assert.equal(response.status, 302); assert.equal(response.headers.get('location'), `/music/?track=${tracks[0].id}&collection=quiet`);
  }
  for (const query of ['track=x&collection=../bad', `track=${tracks[0].id}&track=${tracks[1].id}`, 'collection=a&collection=b', 'collection=%2F%2Fevil.test']) assert.equal(musicSelection(query).size, 0);
});
test('enabled HTML streams assets but is never positively cached; HEAD and method handling', async () => {
  let calls = 0;
  const env = { MUSIC_PUBLIC_ENABLED: 'true', ASSETS: { async fetch() { calls++; return new Response('<html>shell</html>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' } }); } } };
  const get = await handleMusicPage(request('/en/music/'), env);
  assert.equal(await get.text(), '<html>shell</html>'); assert.equal(get.headers.get('cache-control'), 'private, no-store');
  assert.equal(get.headers.get('x-robots-tag'), 'noindex, nofollow');
  const head = await handleMusicPage(request('/en/music/', 'HEAD'), env); assert.equal(await head.text(), '');
  assert.equal((await handleMusicPage(request('/music/', 'POST'), env)).status, 405);
  assert.equal((await handleMusicPage(request('/music/index.html'), env)).status, 404);
  assert.equal(calls, 2);
  assert.equal((await handleMusicPage(request('/music/'), { MUSIC_PUBLIC_ENABLED: 'true' })).status, 503);
});
test('music routes run before asset fallthrough, stay out of sitemap, and use explicit language mapping', async () => {
  const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.ok(worker.indexOf('if (isMusicPagePath(url.pathname))') < worker.lastIndexOf('env.ASSETS.fetch(request)'));
  const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  for (const pattern of ['/music', '/music/*', '/en/*', '/ja/*', '/zh-hans/*', '/zh-hant/*']) assert.ok(config.includes(`"${pattern}"`));
  for (const path of [...Object.values(musicPagePaths), '/zh-hant/music/']) assert.equal(shouldIncludeSitemapRoute(path), false);
  assert.equal(shouldIncludeSitemapRoute('/en/'), true);
  for (const locale of musicLocales) assert.ok(musicPageHref(locale, `track=${tracks[0].id}`).startsWith(musicPagePaths[locale]));
  assert.equal(musicPageHref('zh-Hant'), '/music/');
});
test('500-track catalog is bounded, rejects duplicate IDs and unsafe fields, and canonicalizes covers', () => {
  assert.equal(tracks.length, 500);
  assert.throws(() => readPlayerCatalog({ schemaVersion: 2, tracks: [...tracks, tracks[0]] }));
  assert.throws(() => readPlayerCatalog({ schemaVersion: 2, tracks: [tracks[0], tracks[0]] }));
  assert.throws(() => readPlayerCatalog({ schemaVersion: 2, tracks: [{ ...tracks[0], genres: ['x'.repeat(41)] }] }));
  const parsed = readPlayerCatalog({ schemaVersion: 2, tracks: [{ ...tracks[0], coverUrl: 'https://evil.test/image', objectKey: 'secret', canPlayFull: true }] })[0];
  assert.ok(parsed.coverUrl.startsWith('/api/music/tracks/')); assert.equal(parsed.objectKey, undefined); assert.equal(parsed.canPlayFull, undefined);
});
test('search NFKC/case normalization, tag OR/group AND, access and stable latest order', () => {
  assert.equal(normalizeMusicSearch('  ＳＯＮＧ １  '), 'song 1');
  assert.equal(browseMusic(tracks, [], { query: '  ＳＯＮＧ １ ' })[0].id, tracks[0].id);
  const filtered = browseMusic(tracks, [], { genres: ['Piano', 'Jazz'], moods: ['Bright'], access: 'free' });
  assert.deepEqual(filtered, tracks.filter((_, i) => i % 6 === 0));
  assert.deepEqual(browseMusic([...tracks].reverse(), []), tracks);
  assert.equal(browseMusic(tracks, [], { mode: 'picks' }).every(track => track.effectiveAccess === 'free'), true);
  assert.deepEqual(libraryFilters(tracks), { genres: ['Folk', 'Jazz', 'Piano'], moods: ['Bright', 'Calm'] });
  assert.equal(browseMusic(tracks, [], { query: 'not a song' }).length, 0);
});
test('collections preserve administrator order and cannot grant full access or inject private fields', () => {
  const groups = readPlayerCollections({ collections: [{ ...group, token: 'secret' }] }, tracks);
  assert.equal(groups[0].token, undefined);
  assert.deepEqual(browseMusic(tracks, groups, { collection: 'quiet' }).map(track => track.id), group.trackIds);
  assert.equal(browseMusic(tracks, groups, { collection: 'missing' }).length, 0);
  assert.throws(() => readPlayerCollections({ collections: [{ ...group, trackIds: [tracks[0].id, tracks[0].id] }] }, tracks));
  assert.deepEqual(readPlayerCollections({ collections: [{ ...group, trackIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] }] }, tracks), []);
});
test('featured catalog is bounded, references public rows only and orders free picks without granting access',()=>{
  const groups=readPlayerCollections({collections:[group]},tracks),featured=readPlayerFeatured({featured:{version:2,primaryTrackId:tracks[0].id,primarySource:'primary',
    secondaryTrackIds:[tracks[3].id,tracks[2].id],collectionIds:[group.id]}},tracks,groups);
  assert.deepEqual(browseMusic(tracks,groups,{mode:'picks'},{featuredTrackIds:[featured.primaryTrackId,...featured.secondaryTrackIds]}).map(row=>row.id),[tracks[0].id,tracks[2].id]);
  assert.equal(tracks[3].effectiveAccess,'vip');
  assert.throws(()=>readPlayerFeatured({featured:{...featured,primaryTrackId:tracks[1].id}},tracks,groups));
  assert.throws(()=>readPlayerFeatured({featured:{...featured,secondaryTrackIds:Array(7).fill(tracks[2].id)}},tracks,groups));
  assert.deepEqual(readPlayerFeatured({},tracks,groups),{version:1,primaryTrackId:null,primarySource:'none',secondaryTrackIds:[],collectionIds:[]});
});
test('50-row presentation does not truncate play-all and browsing never rewrites the queue', () => {
  const audio = new Audio(), player = createMusicPlayer(audio, { origin: 'https://music.example.test' }), queue = createMusicQueue(player);
  queue.updateCatalog(tracks);
  const results = browseMusic(tracks, []);
  assert.equal(results.slice(0, 50).length, 50);
  queue.playAll(results);
  assert.equal(queue.snapshot().items.length, 500);
  const source = audio.src, generation = player.snapshot().sourceGeneration;
  browseMusic(tracks, [], { query: 'Song 5' });
  assert.equal(queue.snapshot().items.length, 500); assert.equal(audio.src, source); assert.equal(player.snapshot().sourceGeneration, generation);
  queue.destroy(); player.destroy();
});
test('album category separates playlists and opens ordered songs without changing playback', () => {
  const audio = new Audio(), player = createMusicPlayer(audio, { origin: 'https://music.example.test' }), queue = createMusicQueue(player);
  queue.updateCatalog(tracks); queue.playAll(tracks);
  const source = audio.src, generation = player.snapshot().sourceGeneration, items = queue.snapshot().items;
  const album = { ...group, id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', slug:'album', type:'album', listeningMode:'mixed', coverTrackId:tracks[0].id, coverUrl:'https://evil.test/cover' };
  const groups = readPlayerCollections({ collections: [group, album] }, tracks);
  assert.deepEqual(browseMusic(tracks, groups, {mode:'albums',collection:'album'}).map(t=>t.id), group.trackIds);
  assert.equal(groups[1].coverUrl,tracks[0].coverUrl);
  assert.throws(()=>readPlayerCollections({collections:[{...album,listeningMode:'free'}]},tracks));
  assert.throws(()=>readPlayerCollections({collections:[album]},tracks.slice(0,2)));
  assert.deepEqual(browseMusic(tracks,groups,{mode:'albums'}),[]);
  assert.deepEqual(browseMusic(tracks, groups, { mode: 'albums', collection: group.slug }), []);
  assert.deepEqual(browseMusic(tracks, groups, { collection: group.slug }).map(track => track.id), group.trackIds);
  assert.equal(audio.src, source); assert.equal(player.snapshot().sourceGeneration, generation);
  assert.deepEqual(queue.snapshot().items, items);
  queue.destroy(); player.destroy();
});
test('all UI dictionary entries have four translations and preserve placeholders', () => {
  for (const [key, values] of Object.entries(musicMessages)) {
    assert.equal(values.length, 4, key); assert.ok(values.every(Boolean), key);
    for (const value of values) assert.deepEqual((value.match(/\{\w+\}/g) || []).sort(), (key.match(/\{\w+\}/g) || []).sort(), key);
  }
  assert.equal(musicText('en')('显示 {shown} / {total} 首', { shown: 50, total: 500 }), 'Showing 50 of 500 songs');
});

test('native asset router cannot serve encoded music HTML before the closed gate', async () => {
  const { Miniflare } = await import('miniflare');
  const { build } = await import('esbuild');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'music-html-assets-'));
  for (const path of ['music', 'en/music']) { await mkdir(join(directory, path), { recursive: true }); await writeFile(join(directory, path, 'index.html'), 'music shell'); }
  await writeFile(join(directory, 'plain.txt'), 'ordinary asset');
  const compiled = await build({ stdin: { contents: `import {isMusicPagePath} from './src/music/pagePaths.js'; import {handleMusicPage} from './src/music/pageHttp.js'; export default {fetch(r,e){return isMusicPagePath(new URL(r.url).pathname)?handleMusicPage(r,e):e.ASSETS.fetch(r)}}`, resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false });
  const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const patterns = [...config.match(/run_worker_first = \[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const mf = new Miniflare({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-08-01', assets: { directory, binding: 'ASSETS', routerConfig: { has_user_worker: true, static_routing: { user_worker: patterns } } } });
  try {
    for (const path of ['/music/', '/music', '/music/index.html', '/%6dusic/', '/m%75sic/', '/music%2f', '/music%2findex.html', '/en/%6dusic/', '/en%2fmusic/', '/%2fmusic/']) {
      const response = await mf.dispatchFetch(`http://localhost${path}`, { redirect: 'manual' });
      assert.equal(response.status, 503, path); assert.doesNotMatch(await response.text(), /music shell/, path);
    }
    assert.equal(await (await mf.dispatchFetch('http://localhost/plain.txt')).text(), 'ordinary asset');
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});
