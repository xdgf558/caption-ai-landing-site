import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';

let runtime;
before(async () => { runtime = await createStationMusicRuntime({ platformCases: true }); }, { timeout: 60000 });
after(async () => { await runtime?.close(); });
const call = path => runtime.mf.dispatchFetch('https://wwwstationcat.org/fixture-pages-on' + path,
  { headers: { 'CF-Connecting-IP': '192.0.2.99' }, redirect: 'manual' });
const model = text => JSON.parse(/<script id="sc-music-bootstrap" type="application\/json">([^]*?)<\/script>/.exec(text)[1]);
async function html(state, prefix = '') {
  const response = await call(prefix + '/music/tracks/' + runtime.platformScenarios[state] + '/');
  assert.equal(response.status, 200); assert.match(response.headers.get('x-robots-tag'), /noindex/); return response.text();
}
test('actual Worker and D1 produce all five release states, withholding every unavailable URL', async () => {
  const live = model(await html('live')).track;
  assert.deepEqual(live.platforms.map(link => link.provider), ['apple_music', 'qishui', 'netease']);
  assert.equal(live.platformAvailability.state, 'available');
  for (const [state, expected] of [['planned', 'unreleased'], ['removed', 'removed'], ['regional', 'region_restricted'], ['unverified', 'unconfirmed']]) {
    const text = await html(state), dto = model(text).track;
    assert.equal(dto.platformAvailability.state, expected); assert.equal(dto.platforms.length, 0);
    assert(!text.includes('station-cat-local-synthetic') && !text.includes('synthetic-fixture/1'));
    assert(!text.includes('data-sc-platform-copy') && !text.includes('data-sc-platform-link'));
  }
});
test('all four SSR locales keep a real HTTPS anchor plus a manual no-JS path; public pages have no full source or iframe', async () => {
  for (const prefix of ['', '/zh-hans', '/en', '/ja']) {
    const text = await html('live', prefix);
    assert.equal((text.match(/data-sc-platform-link /g) || []).length, 3);
    assert.equal((text.match(/data-sc-platform-url/g) || []).length, 3);
    assert.match(text, /<details[^>]+data-sc-platform-backup/);
    assert.match(text, /target="_blank" rel="noopener noreferrer"/);
    assert(!/intent:|itms:|<iframe|<audio[^>]+src=/.test(text));
  }
});
test('untrusted destination/country claims do not choose a link or change availability', async () => {
  const name = runtime.platformScenarios.live;
  const redirect = await call('/music/tracks/' + name + '/?url=https%3A%2F%2Fevil.test&country=JP');
  assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/music/tracks/' + name + '/');
  const page = model(await html('live')).track;
  assert(page.platforms.every(link => !link.href.includes('evil.test') && !link.href.includes('country=JP')));
});
