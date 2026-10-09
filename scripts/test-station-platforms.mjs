import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { platformAvailability, stationPlatformLinks } from '../src/redesign/platformView.js';
import { musicPlatforms } from '../src/redesign/musicRender.js';
import { renderPlatformBackup } from '../src/redesign/platformRender.js';
import { mountStationPlatforms, observeStationPlatform, copyStationPlatform } from '../src/redesign/platformClient.js';
import { handleStationContent } from '../src/redesign/publicHttp.js';
import { contentFixture, platformFixture, now, base } from './helpers/station-content-fixture.mjs';
import { fixtureId } from './helpers/station-redesign-database.mjs';

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));
const link = { id: fixtureId(7200), provider: 'apple_music', status: 'live', href: 'https://music.apple.com/sg/album/synthetic-fixture/0', verifiedAt: new Date(now - 1).toISOString() };
const track = { id: fixtureId(7201), platforms: [link] };
const row = { id: link.id, track_id: track.id, provider: link.provider, status: link.status, url: link.href, verified_at: now - 1, territories_json: '["*"]', sort_order: 0 };

test('all providers use verified HTTPS entries in the operator order, independent of device preference', () => {
  const links = [link, { ...link, id: fixtureId(7202), provider: 'qishui', href: 'https://music.douyin.com/track/synthetic' },
    { ...link, id: fixtureId(7203), provider: 'netease', href: 'https://music.163.com/song?id=synthetic' }];
  assert.deepEqual(stationPlatformLinks({ ...track, platforms: links }, now).map(item => item.provider), ['apple_music', 'qishui', 'netease']);
  for (const patch of [{ status: 'planned' }, { status: 'removed' }, { verifiedAt: null }, { verifiedAt: new Date(now + 1).toISOString() },
    { id: 'bad-id' }, { provider: '__proto__' }, { href: 'https://music.apple.com/' }, { href: 'https://music.apple.com/sg/song?redirect=https://evil.test' }]) {
    assert.deepEqual(stationPlatformLinks({ ...track, platforms: [{ ...link, ...patch }] }, now), [], JSON.stringify(patch));
  }
});
test('ambiguous IDs and oversized public arrays cannot render or copy a first matching target', () => {
  assert.deepEqual(stationPlatformLinks({ ...track, platforms: [link, { ...link, id: link.id.toUpperCase() }] }, now), []);
  assert.deepEqual(stationPlatformLinks({ ...track, platforms: Array(26).fill(link) }, now), []);
  assert.equal(renderPlatformBackup({ ...track, platforms: [{ ...link, href: '/__home-fixture/platform/apple_music/' }] }, 'en'), '');
});
test('public status distinguishes upcoming, withdrawn, confirmed regional exclusion and unknown country without URLs', () => {
  assert.equal(platformAvailability([row], track.id, null, now).state, 'available');
  assert.deepEqual(platformAvailability([{ ...row, status: 'planned' }], track.id, null, now), { state: 'unreleased', notes: [{ provider: 'apple_music', status: 'planned' }] });
  assert.deepEqual(platformAvailability([{ ...row, status: 'removed' }], track.id, null, now), { state: 'removed', notes: [] });
  assert.equal(platformAvailability([{ ...row, territories_json: '["JP"]' }], track.id, 'SG', now).notes[0].status, 'region_unavailable');
  assert.equal(platformAvailability([{ ...row, territories_json: '["JP"]' }], track.id, null, now).notes[0].status, 'region_unconfirmed');
  assert.equal(platformAvailability([{ ...row, territories_json: '["JP"]' }], track.id, 'JP', now).state, 'available');
  for (const patch of [{ track_id: fixtureId(7204) }, { provider: 'unknown' }, { verified_at: now + 1 },
    { url: 'https://evil.test/song' }, { territories_json: '["*","JP"]' }]) {
    assert.deepEqual(platformAvailability([{ ...row, ...patch }], track.id, 'SG', now), { state: 'unconfirmed', notes: [] });
  }
});
test('four languages retain ordinary anchors and readable no-JS manual fallback, without an app-open claim', () => {
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const html = musicPlatforms(track, locale);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /<details[^>]+data-sc-platform-backup/);
    assert.match(html, /readonly value="https:\/\/music.apple.com/);
    assert.match(html, /data-sc-platform-copy hidden/);
    assert(!/javascript:|intent:|itms:|window\.open|setTimeout/.test(html));
    const upcoming = musicPlatforms({ ...track, platforms: [], platformAvailability: { state: 'unreleased', notes: [{ provider: 'apple_music', status: 'planned' }] } }, locale);
    assert(!upcoming.includes('<a ') && !upcoming.includes('synthetic-fixture'));
    const region = musicPlatforms({ ...track, platforms: [], platformAvailability: { state: 'region_restricted', notes: [{ provider: 'apple_music', status: 'region_unavailable' }] } }, locale);
    assert(!region.includes('<a ') && !region.includes('synthetic-fixture'));
  }
});
test('URL attacks, unknown note fields and withdrawn-only data never become clickable links or copy inputs', () => {
  for (const href of ['https://music.apple.com.evil.test/song', 'https://user:pass@music.apple.com/song', 'http://music.apple.com/song',
    'https://music.apple.com/song?token=private', 'https://music.apple.com/song#private', 'https://music.apple.com/login', '//music.apple.com/song']) {
    assert(!musicPlatforms({ ...track, platforms: [{ ...link, href }] }, 'en').includes('<a '));
  }
  const html = musicPlatforms({ ...track, platforms: [], platformAvailability: { state: 'removed', notes: [{ provider: '<script>', status: 'planned', href: 'https://evil.test/' }] } }, 'en');
  assert(!html.includes('<a ') && !html.includes('<input') && !html.includes('evil.test') && !html.includes('<script>'));
});
test('clipboard invocation happens in the gesture, only resolution claims success, denial or absence preserves manual use', async () => {
  let copied, resolve;
  const pending = copyStationPlatform(link.href, link.provider, { clipboard: { writeText: value => { copied = value; return new Promise(done => { resolve = done; }); } } });
  assert.equal(copied, link.href); resolve(); assert.equal((await pending).status, 'copied');
  assert.equal((await copyStationPlatform(link.href, link.provider, {})).status, 'manual');
  assert.equal((await copyStationPlatform(link.href, link.provider, { clipboard: { writeText: () => Promise.reject({ name: 'NotAllowedError' }) } })).status, 'manual');
  assert.equal((await copyStationPlatform('https://evil.test/song', link.provider, { clipboard: { writeText: () => assert.fail('unsafe copy') } })).status, 'invalid');
});
test('sync/rejected/hanging statistics never throw or retain control of navigation and only receive public dimensions', async () => {
  const payload = { trackId: track.id, linkId: link.id, provider: link.provider, href: link.href, session: 'private', cookie: 'private' };
  let seen;
  for (const observer of [value => { seen = value; throw new Error('offline'); }, () => Promise.reject(new Error('offline')), () => new Promise(() => {})]) {
    assert.equal(observeStationPlatform(observer, payload), undefined);
  }
  assert.deepEqual(seen, { trackId: track.id, linkId: link.id, provider: link.provider });
  observeStationPlatform(() => assert.fail('invalid dimensions'), { ...payload, trackId: 'invalid' });
  await new Promise(resolve => setImmediate(resolve)); // A rejected observer is handled.
});

function domFixture() {
  const result = { hidden: true, textContent: '' }, input = { value: link.href, focused: false, selected: false, focus() { this.focused = true; }, select() { this.selected = true; } };
  const rowNode = { dataset: { provider: link.provider }, querySelector: selector => selector.includes('url') ? input : result };
  const button = { hidden: true, isConnected: true, closest: selector => selector.includes('row') ? rowNode : selector.includes('copy') ? button : null };
  const anchor = { dataset: { trackId: track.id, linkId: link.id, provider: link.provider }, getAttribute: () => link.href,
    closest: selector => selector.startsWith('a[') ? anchor : null };
  const handlers = new Map();
  const root = { querySelectorAll: () => [button], contains: node => node === anchor || node === button, addEventListener: (type, fn) => { handlers.set(type,fn); } };
  return { root, result, input, button, anchor, click(node, type='click', extra={}) { handlers.get(type)?.({ target: node, ...extra, preventDefault() { assert.fail('native navigation intercepted'); } }); } };
}
test('delegated native click with offline observer does not prevent navigation; copy denial selects its readable URL', async () => {
  const dom = domFixture();
  const dispose = mountStationPlatforms(dom.root, 'en', { observer: () => { throw new Error('offline'); }, navigator: {} });
  assert.equal(dom.button.hidden, false); dom.click(dom.anchor); dom.click(dom.button);
  await new Promise(resolve => setImmediate(resolve));
  assert(dom.input.focused && dom.input.selected); assert.match(dom.result.textContent, /manually/); dispose();
});
test('a late clipboard result cannot overwrite a newer attempt or an unloaded page', async () => {
  const dom = domFixture(), resolves = [];
  const dispose = mountStationPlatforms(dom.root, 'en', { navigator: { clipboard: { writeText: () => new Promise(resolve => resolves.push(resolve)) } } });
  dom.click(dom.button); dom.click(dom.button); resolves[0]();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(dom.result.textContent, 'Copying…');
  dispose(); resolves[1](); await new Promise(resolve => setImmediate(resolve)); assert.equal(dom.result.textContent, 'Copying…');
});
test('confirmed middle-button intent is observed once; synthetic clicks and copying do not claim navigation',()=>{
  const dom=domFixture(),seen=[];const dispose=mountStationPlatforms(dom.root,'en',{observer:value=>seen.push(value),navigator:{}});
  dom.click(dom.anchor,'click',{isTrusted:false});dom.click(dom.anchor,'auxclick',{isTrusted:true,button:2});assert.equal(seen.length,0);
  dom.click(dom.anchor,'auxclick',{isTrusted:true,button:1});assert.equal(seen.length,1);dispose();
});

async function apiFixture() { const f = await contentFixture({ externalLinks: false }); fixtures.push(f); return f; }
async function apiTrack(f, country = null) {
  const req = new Request('https://wwwstationcat.org' + base + '/tracks/vip', { headers: { 'CF-Connecting-IP': '192.0.2.91', 'CF-IPCountry': 'JP' } });
  if (country) Object.defineProperty(req, 'cf', { value: { country } });
  const response = await handleStationContent(req, f.env, { clock: () => now });
  assert.equal(response.status, 200); return (await response.json()).track;
}
test('real local queries preserve operator order and never forward unpublished/withdrawn/unverified targets', async () => {
  const f = await apiFixture(), vip = f.content.tracks[1];
  await platformFixture(f.music.db, vip, { provider: 'netease', url: 'https://music.163.com/song?id=synthetic', sort_order: 2 });
  await platformFixture(f.music.db, vip, { provider: 'qishui', url: 'https://music.douyin.com/track/synthetic', sort_order: 1 });
  await platformFixture(f.music.db, vip, { provider: 'apple_music', status: 'planned', url: 'https://music.apple.com/song/never-forward-this', verified_at: null });
  await platformFixture(f.music.db, vip, { provider: 'spotify', status: 'removed', url: 'https://open.spotify.com/track/never-forward-this' });
  const value = await apiTrack(f);
  assert.deepEqual(value.platforms.map(item => item.provider), ['qishui', 'netease']);
  assert.deepEqual(value.platformAvailability.notes, [{ provider: 'apple_music', status: 'planned' }]);
  assert(!JSON.stringify(value).includes('never-forward-this'));
});
test('country comes only from trusted cf; a spoofed country header cannot enable a regional anchor', async () => {
  const f = await apiFixture(); await platformFixture(f.music.db, f.content.tracks[1], { territories_json: '["JP"]' });
  const unknown = await apiTrack(f); assert.equal(unknown.platforms.length, 0); assert.equal(unknown.platformAvailability.notes[0].status, 'region_unconfirmed');
  const sg = await apiTrack(f, 'SG'); assert.equal(sg.platforms.length, 0); assert.equal(sg.platformAvailability.notes[0].status, 'region_unavailable');
  const jp = await apiTrack(f, 'JP'); assert.equal(jp.platforms.length, 1); assert.equal(jp.platformAvailability.state, 'available');
});
test('withdrawal changes the next projection and no raw platform URL remains in the DTO or HTML', async () => {
  const f = await apiFixture(), id = await platformFixture(f.music.db, f.content.tracks[1]);
  assert.equal((await apiTrack(f)).platforms.length, 1);
  f.music.sql.prepare("UPDATE station_platform_links SET status='removed' WHERE id=?").run(id);
  const value = await apiTrack(f); assert.equal(value.platformAvailability.state, 'removed');
  assert.equal(value.platforms.length, 0); assert(!musicPlatforms(value, 'en').includes('https://'));
});
