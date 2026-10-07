import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { handleStationContent } from '../src/redesign/publicHttp.js';
import { handleStationMusicPage, stationMusicRoute, isStationMusicTemplate } from '../src/redesign/musicPages.js';
import { musicBootstrap, renderMusicPage, renderSongHero, musicPlatforms } from '../src/redesign/musicRender.js';
import { stationMusicSource, previewPlayerTrack, fullPlayerTrack, indexStationMusicTracks } from '../src/redesign/musicPlayback.js';
import { readMusicResponse } from '../src/redesign/musicResponse.js';
import { musicCopy } from '../src/redesign/musicCopy.js';
import { createMusicPlayer, musicSource } from '../src/scripts/musicPlayerCore.js';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { contentFixture, base, now, promotionFixture, platformFixture } from './helpers/station-content-fixture.mjs';
import { fixtureId } from './helpers/station-redesign-database.mjs';

const fixtures = [];
async function fixture(options) { const f = await contentFixture(options); fixtures.push(f); return f; }
afterEach(() => fixtures.splice(0).forEach(f => f.close()));
const request = path => new Request('https://wwwstationcat.org' + base + path, { headers: { 'CF-Connecting-IP': '192.0.2.90' } });
const call = (f, path) => handleStationContent(request(path), f.env, { clock: () => now });
async function body(f, path) {
  const response = await call(f, path); assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
async function ids(f, sort, q = '') {
  let cursor = null; const found = [], seen = new Set();
  do {
    const query = new URLSearchParams({ locale: 'en', sort, limit: '2', q });
    if (cursor) query.set('cursor', cursor);
    const value = await body(f, '/tracks?' + query); found.push(...value.items.map(item => item.id)); cursor = value.nextCursor;
    if (cursor) { assert(!seen.has(cursor)); seen.add(cursor); }
  } while (cursor);
  assert.equal(new Set(found).size, found.length); return found;
}

test('operational order prefers only current enabled promotion, keeps stable ties, and preserves legacy no-sort contract', async () => {
  const f = await fixture(), [free, vip, limited] = f.content.tracks;
  await promotionFixture(f.music.db, free, { order: 4, preview: 0 });
  await promotionFixture(f.music.db, limited, { order: 1, preview: 0 });
  assert.deepEqual((await ids(f, 'default')).slice(0, 3), [vip.id, limited.id, free.id]);
  assert.equal((await body(f, '/tracks?locale=en')).items[0].id, free.id);
  await promotionFixture(f.music.db, vip, { enabled: 0 });
  assert.deepEqual((await ids(f, 'default')).slice(0, 2), [limited.id, free.id]);
  assert.equal(f.r2.state.reads.filter(read => read.method === 'get').length, 0);
});

test('latest release uses first global live verified date; unknowns follow, planned/future rows do not rank', async () => {
  const f = await fixture(), [free, vip, limited, expired, early] = f.content.tracks;
  await platformFixture(f.music.db, free, { external_released_at: now - 1000, territories_json: '["JP"]' });
  await platformFixture(f.music.db, free, { provider: 'spotify', url: 'https://open.spotify.com/track/synthetic-fixture', external_released_at: now - 9000 });
  await platformFixture(f.music.db, limited, { external_released_at: now - 2000 });
  await platformFixture(f.music.db, expired, { status: 'planned', external_released_at: now - 10 });
  await platformFixture(f.music.db, early, { verified_at: now + 1, external_released_at: now - 10 });
  const sorted = await ids(f, 'release');
  assert.deepEqual(sorted.slice(0, 3), [vip.id, limited.id, free.id]);
  const freeDto = (await body(f, '/tracks/permanent-free?locale=en')).track;
  assert.equal(freeDto.catalogReleasedAt, new Date(now - 9000).toISOString());
  assert(!freeDto.platforms.some(link => link.provider === 'apple_music'));
  assert.equal((await body(f, '/tracks/limited-expired')).track.catalogReleasedAt, null);
});

test('new cursors bind sort, search and locale while v1 no-sort callers continue to page', async () => {
  const f = await fixture(), page = await body(f, '/tracks?locale=en&sort=default&limit=1');
  for (const path of ['/tracks?locale=ja&sort=default', '/tracks?locale=en&sort=release', '/tracks?locale=en&sort=default&q=vip']) {
    assert.equal((await call(f, path + '&cursor=' + page.nextCursor)).status, 400);
  }
  const v1 = (await body(f, '/tracks?locale=en&limit=1')).nextCursor;
  assert.equal((await body(f, '/tracks?locale=en&cursor=' + v1)).items[0].id, f.content.tracks[1].id);
  for (const query of ['sort=published', 'sort=other', 'sort=default&sort=release', 'sort=default&cursor=' + v1]) {
    assert.equal((await call(f, '/tracks?' + query)).status, 400);
  }
  assert.deepEqual(await ids(f, 'default', 'vip'), [f.content.tracks[1].id]);
  assert.deepEqual(await ids(f, 'release', 'no-such-title'), []);
});

test('stale legacy audio hint cannot publish a full source; the hint never contains a private audio URL', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  let dto = (await body(f, '/tracks/vip')).track;
  assert.equal(dto.fullPlayback.playbackPath, base + '/tracks/vip/playback?variant=full');
  assert.equal(dto.fullPlayback.requiresAccessCheck, true);
  assert(!JSON.stringify(dto).includes('audio?'));
  f.music.sql.prepare("UPDATE music_tracks SET lifecycle='draft',published_revision_id=NULL WHERE id=?").run(vip.id);
  dto = (await body(f, '/tracks/vip')).track; assert.equal(dto.fullPlayback, null);
  assert(dto.preview);
});

test('route boundaries retain aliases and refuse runtime/API namespaces; either flag off preserves the old handler without reading bindings', async () => {
  assert.deepEqual(stationMusicRoute('/en/music/tracks/a-song'), { locale: 'en', kind: 'detail', slug: 'a-song' });
  assert.equal(stationMusicRoute('/zh-hant/music/').locale, 'zh-Hant');
  for (const path of ['/games/cat-life/', '/api/mobile/v1/me/music/', '/music/a/deeper/', '/about/']) assert.equal(stationMusicRoute(path), null);
  for (const path of ['/music/site-shell/en/', '/en/music/site-shell/', '/music/%73ite-shell/en/', '/music//site-shell/en/']) assert(isStationMusicTemplate(path));
  const env = { get MUSIC_DB() { throw new Error('must not read'); }, get MUSIC_BUCKET() { throw new Error('must not read'); }, get ASSETS() { throw new Error('must not read'); } };
  for (const flags of [
    {}, { STATION_MUSIC_PAGES_ENABLED: 'false' }, { STATION_CONTENT_PUBLIC_ENABLED: 'true' },
    { STATION_MUSIC_PAGES_ENABLED: 'true' }, { STATION_MUSIC_PAGES_ENABLED: 'true', STATION_CONTENT_PUBLIC_ENABLED: 'false' },
    { STATION_MUSIC_PAGES_ENABLED: 'false', STATION_CONTENT_PUBLIC_ENABLED: 'true' },
    { STATION_MUSIC_PAGES_ENABLED: true }, { STATION_MUSIC_PAGES_ENABLED: true, STATION_CONTENT_PUBLIC_ENABLED: false },
    { STATION_MUSIC_PAGES_ENABLED: false, STATION_CONTENT_PUBLIC_ENABLED: true }
  ]) {
    for (const path of ['/music/', '/music/?q=one&q=two', '/en/music?track=' + fixtureId(1), '/zh-hans/music/?collection=old-album',
      '/music/tracks/vip/', '/ja/music/tracks/unknown', '/zh-hant/music/old-share/']) {
      for (const method of ['GET', 'HEAD', 'POST']) assert.equal(await handleStationMusicPage(new Request('https://wwwstationcat.org' + path, { method }), { ...flags,
        get MUSIC_DB() { return env.MUSIC_DB; }, get MUSIC_BUCKET() { return env.MUSIC_BUCKET; }, get ASSETS() { return env.ASSETS; } }),
        null, JSON.stringify(flags) + ' ' + method + ' ' + path);
    }
  }
  assert.equal((await handleStationMusicPage(new Request('https://wwwstationcat.org/music/site-shell/en/'), env)).status, 404);
});

test('an enabled detail route must prove a published mapping before claiming an unknown or withdrawn address', async () => {
  const f = await fixture(), env = { ...f.env, STATION_MUSIC_PAGES_ENABLED: 'true', get ASSETS() { throw new Error('unmapped route must not read the shell'); } };
  const pageRequest = path => new Request('https://wwwstationcat.org' + path, { headers: { 'CF-Connecting-IP': '192.0.2.90' } });
  for (const path of ['/music/tracks/not-mapped/', '/en/music/tracks/not-mapped?token=fixture-secret', '/ja/music/not-mapped/']) {
    assert.equal(await handleStationMusicPage(pageRequest(path), env, { clock: () => now }), null);
  }
  f.music.sql.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").run(f.content.tracks[1].id);
  assert.equal(await handleStationMusicPage(pageRequest('/music/tracks/vip/'), env, { clock: () => now }), null);
});

const dto = { id: fixtureId(1), slug: 'a-song', revision: 2, href: '/en/music/tracks/a-song/', title: 'A song', artist: 'Station Cat',
  durationMs: 120000, summary: '', platforms: [], coverUrl: null,
  preview: { revision: 1, durationMs: 30000, playbackPath: base + '/tracks/a-song/playback?variant=preview' } };

test('a public full-playback hint is rendered as unchecked access in every language, without ready or entitlement claims', () => {
  const fullPlayback = { playbackPath: base + '/tracks/a-song/playback?variant=full', requiresAccessCheck: true };
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const track = { ...dto, href: ({ 'zh-Hant': '', 'zh-Hans': '/zh-hans', en: '/en', ja: '/ja' })[locale] + '/music/tracks/a-song/', fullPlayback };
    const html = renderSongHero(track, locale, { detail: true }), copy = musicCopy[locale];
    assert(html.includes(copy.full)); assert(html.includes(copy.fullAccessHint)); assert(!html.includes(copy.ready));
    assert.match(html, /aria-describedby="sc-full-access-note" data-sc-full-check=/);
    assert(!html.includes('data-ready=')); assert(!html.includes('isVip'));
    assert(!renderSongHero({ ...track, fullPlayback: { playbackPath: fullPlayback.playbackPath } }, locale).includes('data-sc-full-check='));
    assert(!renderSongHero({ ...track, fullPlayback: null }, locale).includes('sc-full-access-note'));
  }
});
test('public preview adapter controls both versions, and full adapter needs an exact private handshake', () => {
  const preview = previewPlayerTrack(dto);
  assert.equal(stationMusicSource(preview, 'preview'), base + '/tracks/a-song/audio?variant=preview&v=2&p=1');
  const handshake = { trackId: dto.id, revision: 2, variant: 'full', durationMs: 120000,
    audioPath: base + '/tracks/a-song/audio?variant=full&v=2' };
  assert.equal(stationMusicSource(fullPlayerTrack(dto, handshake), 'full'), handshake.audioPath);
  for (const patch of [{ revision: 1 }, { trackId: fixtureId(2) }, { variant: 'preview' },
    { audioPath: 'https://evil.test/audio' }, { audioPath: handshake.audioPath + '&isVip=true' }]) assert.throws(() => fullPlayerTrack(dto, { ...handshake, ...patch }));
  assert.throws(() => stationMusicSource(preview, 'full'));
  assert.throws(() => previewPlayerTrack({ ...dto, preview: { ...dto.preview, playbackPath: '/api/evil' } }));
});

test('a selected home summary cannot erase the catalog media contract for the same song', () => {
  const selected = { id: dto.id, title: dto.title, artist: dto.artist, href: dto.href };
  const index = indexStationMusicTracks({ selected: [selected], featured: dto, items: [dto] });
  assert.equal(stationMusicSource(previewPlayerTrack(index.get(dto.id)), 'preview'), base + '/tracks/a-song/audio?variant=preview&v=2&p=1');
  const updated = { ...dto, revision: 3, preview: null };
  indexStationMusicTracks({ selected: [selected], featured: dto, items: [updated] }, index);
  assert.equal(index.get(dto.id).revision, 3); assert.equal(index.get(dto.id).preview, null);
});

test('shared player retains old UUID default, has no source before explicit play, and resets on promotion source change', () => {
  const origin = 'https://wwwstationcat.org', audio = new Audio(), player = createMusicPlayer(audio, { origin, sourceFor: stationMusicSource });
  const preview = previewPlayerTrack(dto); player.select(preview, 'preview');
  assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0);
  player.playTrack(preview, 'preview'); assert.equal(audio.src, origin + stationMusicSource(preview, 'preview'));
  assert.equal(audio.plays.length, 1);
  player.playTrack({ ...preview, previewRevision: 2 }, 'preview');
  assert.match(audio.src, /p=2$/); assert.equal(player.snapshot().sourceGeneration, 2);
  player.clear(); assert.equal(audio.src, ''); player.destroy();
  const legacyAudio = new Audio(), legacy = createMusicPlayer(legacyAudio, { origin });
  legacy.playTrack(preview, 'preview'); assert.equal(legacyAudio.src, origin + musicSource(preview, 'preview')); legacy.destroy();
});

test('untrusted custom sources cannot disturb a selected source', () => {
  for (const path of ['//evil.test/a', 'https://evil.test/a', '/api/a#token', '/api/a\\evil', '/api/a b']) {
    const audio = new Audio(), player = createMusicPlayer(audio, { origin: 'https://wwwstationcat.org', sourceFor: () => path });
    assert.throws(() => player.playTrack(previewPlayerTrack(dto), 'preview'));
    assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0); player.destroy();
  }
});

test('HTML/JSON escaping preserves readable titles and story without executable markup; missing sections collapse', () => {
  const attack = '</script><script>alert("fixture")</script>&<img src=x onerror=1>';
  const track = { ...dto, title: attack, story: attack, preview: null, lyricsUrl: null };
  const model = { mode: 'detail', locale: 'en', track, related: [], clips: [], error: null };
  const html = renderMusicPage(model);
  assert(html.includes('&lt;/script&gt;')); assert(!html.includes('<script>')); assert(!html.includes('<img src=x'));
  assert(!html.includes('data-sc-preview')); assert(!html.includes('data-sc-lyrics')); assert(!html.includes('sc-clip-grid')); assert(!html.includes('data-sc-music-audio'));
  const serialized = musicBootstrap(model); assert(!serialized.includes('<')); assert.deepEqual(JSON.parse(serialized), model);
  assert(!renderSongHero({ ...track, href: '/games/cat-life/' }, 'en'));
});

test('external buttons revalidate provider hosts and never fabricate planned or missing links', () => {
  assert(!musicPlatforms(dto, 'en').includes('<a '));
  const html = musicPlatforms({ ...dto, platforms: [
    { id: fixtureId(440), verifiedAt: new Date(now - 1).toISOString(), provider: 'apple_music', status: 'live', href: 'https://music.apple.com/song/synthetic-fixture' },
    { provider: 'spotify', status: 'planned', href: 'https://open.spotify.com/track/synthetic-fixture' },
    { provider: 'youtube', status: 'live', href: 'https://youtube.com.evil.test/watch' }] }, 'en');
  assert.equal((html.match(/<a /g) || []).length, 1); assert.match(html, /noopener noreferrer/); assert(!html.includes('evil.test'));
});

test('selected songs remain visible without a featured promotion; an entirely unconfigured catalog stays empty', () => {
  const model = { mode: 'catalog', locale: 'en', query: { q: '', sort: 'default', cursor: null },
    featured: null, selected: [dto], items: [], nextCursor: null, error: null };
  let html = renderMusicPage(model);
  assert.match(html, /Selected songs/); assert(html.includes('A song')); assert(!html.includes('sc-song-hero"'));
  html = renderMusicPage({ ...model, selected: [] });
  assert.match(html, /New music is on its way/); assert(!html.includes('data-sc-curated')); assert(!html.includes('A song'));
});

test('bounded response readers reject deceptive length and invalid UTF-8 and cancel oversized streams', async () => {
  assert.equal(await readMusicResponse(new Response('ok'), 2), 'ok');
  await assert.rejects(readMusicResponse(new Response('over', { headers: { 'Content-Length': '100' } }), 3));
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10)); }, cancel() { cancelled = true; } });
  await assert.rejects(readMusicResponse(new Response(stream), 3)); assert(cancelled);
  await assert.rejects(readMusicResponse(new Response(new Uint8Array([255])), 3));
});
