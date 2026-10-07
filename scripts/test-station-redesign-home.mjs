import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView } from '../src/redesign/home.js';
import { stationHomeConfig, emptyHomeContent } from '../src/data/station-home.js';
import { homeScenario, fixtureIds } from './fixtures/station-redesign/home-scenarios.js';

const now = '2026-10-06T12:00:00.000Z';
const render = (input, options = {}) => buildHomeView({ ...input, now, fixture: true, ...options });
const complete = () => structuredClone(homeScenario('complete'));
const musicAbsent = input => assert.equal(render(input).music, null);

test('unselected draft remains empty without choosing a free/latest fallback', () => {
  const data = complete();
  const home = render({ config: stationHomeConfig, content: data.content });
  assert.equal(home.publishedRevision, null);
  assert.deepEqual([home.music, home.game, home.clips.length, home.selectedTracks.length, home.updates.length], [null, null, 0, 0, 0]);
  assert.equal(render({ config: stationHomeConfig, content: emptyHomeContent }).fixture, false);
});
test('published IDs and revision drive direct destinations, three selections and four clips', () => {
  const home = render(complete());
  assert.equal(home.publishedRevision, 1);
  assert.equal(home.music.id, fixtureIds.track);
  assert.equal(home.music.href, '/music/tracks/sample-song/');
  assert.equal(home.game.href, '/games/cat-life-game/');
  assert.equal(home.selectedTracks.length, 3);
  assert.equal(home.clips.length, 4);
  assert.equal(home.updates.length, 3);
  assert.equal(home.music.platforms.length, 3);
  assert.equal(home.music.preview, null);
});
test('synthetic configuration needs explicit fixture option and cannot enter a normal consumer', () => {
  const input = complete();
  assert.equal(render(input, { fixture: false }).music, null);
  delete input.config.environment;
  assert.equal(render(input).music, null); // fixture URLs are rejected even with the option
});
test('draft, mismatched revision, scheduled/future or missing configuration cannot publish', () => {
  for (const change of [{ status: 'draft' }, { publishedRevision: 2 }, { status: 'scheduled' },
    { publishedAt: '2030-01-01T00:00:00.000Z' }, { id: 'unsafe' }, { revision: 0 }]) {
    const input = complete(); Object.assign(input.config, change);
    assert.equal(render(input).publishedRevision, null);
    musicAbsent(input);
  }
});
test('promotion must be explicitly enabled, published and refer to a public parent', () => {
  for (const mutate of [input => input.content.promotions[0].enabled = false,
    input => input.content.promotions[0].status = 'draft', input => input.content.promotions[0].revision = 0,
    input => input.content.tracks[0].status = 'archived', input => input.content.tracks[0].publishedAt = '2030-01-01T00:00:00Z',
    input => input.config.featuredTrackId = input.content.tracks[1].id]) {
    const input = complete(); mutate(input); musicAbsent(input);
  }
});
test('missing, revoked, private, mismatched or duplicate cover references hide the work', () => {
  for (const mutate of [asset => asset.state = 'revoked', asset => asset.visibility = 'private',
    asset => asset.ownerId = fixtureIds.game, asset => asset.rightsConfirmed = false, asset => asset.kind = 'full_audio']) {
    const input = complete(); mutate(input.content.assets[0]); musicAbsent(input);
  }
  const input = complete(); input.content.assets.push({ ...input.content.assets[0] }); musicAbsent(input);
});
test('repeated track IDs are ambiguous and never pick a row by order', () => {
  const input = complete(); input.content.tracks.push({ ...input.content.tracks[0], id: input.content.tracks[0].id.toUpperCase() });
  musicAbsent(input);
});
test('selectors de-duplicate IDs and exclude the featured work', () => {
  const input = complete();
  input.config.selectedTrackIds.unshift(fixtureIds.track.toUpperCase(), input.config.selectedTrackIds[0]);
  assert.equal(render(input).selectedTracks.length, 3);
  assert.ok(render(input).selectedTracks.every(track => track.id !== fixtureIds.track));
});
test('empty optional summary does not hide an otherwise published song or game', () => {
  const input = complete(); input.content.tracks[0].summary['zh-Hant'] = ''; input.content.games[0].summary['zh-Hant'] = '';
  assert.equal(render(input).music.summary, ''); assert.equal(render(input).game.summary, '');
});
test('missing video and missing platforms produce distinct honest states', () => {
  assert.equal(render(homeScenario('no-video')).clips.length, 0);
  const home = render(homeScenario('no-platform'));
  assert.equal(home.music.platforms.length, 0); assert.equal(home.clips.length, 4);
});
test('only selected, live, verified and correctly owned platform links survive', () => {
  for (const change of [{ status: 'planned' }, { status: 'removed' }, { verifiedAt: null },
    { verifiedAt: '2030-01-01T00:00:00Z' }, { trackId: fixtureIds.game }, { provider: '__proto__' }]) {
    const input = complete(); Object.assign(input.content.platforms[0], change);
    assert.equal(render(input).music.platforms.length, 2);
  }
  const input = complete(); input.content.promotions[0].selectedPlatformLinkIds = [];
  assert.equal(render(input).music.platforms.length, 0);
});
test('public link syntax rejects credentials, tokens, scripts, private hosts and fixture paths', () => {
  for (const url of ['javascript:alert(1)', 'http://music.163.com/', 'https://user:password@music.163.com/',
    'https://music.163.com/?token=private', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/',
    'https://music.invalid/', '//music.163.com/', '/__home-fixture/platform/other/', 'https://music.163.com/\\evil']) {
    const input = complete(); input.content.platforms[0].url = url;
    assert.equal(render(input).music.platforms.length, 2, url);
  }
  const input = complete(); input.content.platforms[0].url = 'https://music.163.com/';
  assert.equal(render(input).music.platforms.length, 2); // A provider homepage is not a verified work entry.
});
test('preview requires enabled, ready, independently typed public and rights-confirmed clip', () => {
  const base = () => structuredClone(homeScenario('preview-enabled'));
  assert.equal(render(base()).music.preview.durationSec, 30);
  const longer = base();
  longer.content.assets.find(asset => asset.id === fixtureIds.preview).durationSec = 60;
  assert.equal(render(longer).music.preview.durationSec, 60); // no unapproved duration cap
  for (const change of [{ state: 'uploading' }, { visibility: 'private' }, { rightsConfirmed: false },
    { kind: 'full_audio' }, { ownerId: fixtureIds.game }, { durationSec: 0 }, { durationSec: Infinity }]) {
    const input = base(); Object.assign(input.content.assets.find(asset => asset.id === fixtureIds.preview), change);
    assert.equal(render(input).music.preview, null);
  }
});
test('revoking a clip, poster or platform removes the reference on next projection', () => {
  const view = render(homeScenario('revoked'));
  assert.equal(view.music.platforms.length, 2); assert.equal(view.clips.length, 3);
  assert.ok(view.clips.every(clip => clip.id !== fixtureIds.firstClip));
});
test('clips require both selection lists, public parent, ready poster and public media', () => {
  for (const mutate of [input => input.content.clips[0].trackId = fixtureIds.game,
    input => input.content.clips[0].type = 'mv', input => input.content.clips[0].status = 'draft',
    input => input.content.clips[0].durationSec = -1, input => input.content.clips[0].durationSec = NaN,
    input => input.content.clips[0].publishedAt = '2030-01-01T00:00:00Z',
    input => input.content.assets.find(asset => asset.id === input.content.clips[0].mediaAssetId).visibility = 'private']) {
    const input = complete(); mutate(input);
    assert.ok(render(input).clips.every(clip => clip.id !== fixtureIds.firstClip));
  }
  const input = complete(); input.content.promotions[0].selectedClipIds = [];
  assert.equal(render(input).clips.length, 0);
});
test('game revocation removes its card and related update without starting a runtime', () => {
  const input = complete(); input.content.games[0].status = 'archived';
  const home = render(input);
  assert.equal(home.game, null); assert.equal(home.updates.length, 2);
  assert.ok(!JSON.stringify(home).includes('/games/cat-life/'));
});
test('a game introduction never occupies the existing cat-life runtime namespace', () => {
  const input = complete(); input.content.games[0].slug = 'cat-life';
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const home = render(input, { locale });
    assert.equal(home.game, null);
    assert.ok(home.updates.every(update => update.kind !== 'games'));
    assert.ok(!JSON.stringify(home).includes('/games/cat-life/'));
  }
});
test('locale routing and translation fallback retain the stable selected IDs', () => {
  for (const [locale, prefix] of [['zh-Hant', ''], ['zh-Hans', '/zh-hans'], ['en', '/en'], ['ja', '/ja']]) {
    const input = complete(); delete input.content.tracks[0].title[locale];
    if (locale === 'zh-Hant') input.content.tracks[0].title[locale] = '晚一點告白';
    const home = render(input, { locale });
    assert.equal(home.music.href, `${prefix}/music/tracks/sample-song/`);
    assert.equal(home.music.id, fixtureIds.track); assert.equal(home.music.title, '晚一點告白');
  }
});
test('allowlist projection never forwards private audio, storage, entitlement or extra fields', () => {
  const input = complete();
  for (const record of [input.config, ...Object.values(input.content).flat()]) {
    record.fullAudioUrl = 'PRIVATE_AUDIO_SENTINEL'; record.storageKey = 'PRIVATE_STORAGE_SENTINEL'; record.entitlement = 'PRIVATE_ENTITLEMENT_SENTINEL';
  }
  const view = render(input), output = JSON.stringify(view);
  assert.ok(!output.includes('PRIVATE_')); assert.ok(!output.includes('storageKey')); assert.equal(Object.hasOwn(view, 'assets'), false);
});
