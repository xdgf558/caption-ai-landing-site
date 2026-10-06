import test from 'node:test';
import assert from 'node:assert/strict';
import { stationHref, stationSection, stationLanguageHref, stationPolicyHref, stationSections } from '../src/redesign/routes.js';

test('four locales keep canonical home/music paths and five navigation entries reuse existing services', () => {
  const expected = {
    'zh-Hant': ['/', '/music/', '/games/', '/zh-hant/library/'],
    'zh-Hans': ['/zh-hans/', '/zh-hans/music/', '/zh-hans/games/', '/zh-hans/library/'],
    en: ['/en/', '/en/music/', '/en/games/', '/en/library/'],
    ja: ['/ja/', '/ja/music/', '/ja/games/', '/ja/library/'],
  };
  for (const [locale, paths] of Object.entries(expected)) {
    assert.deepEqual(['home', 'music', 'games', 'member'].map(section => stationHref(locale, section)), paths);
  }
});

test('five-entry navigation uses the existing member and about pages', () => {
  assert.deepEqual(stationSections, ['home', 'music', 'games', 'member', 'about']);
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    assert.equal(stationHref(locale, 'member'), stationHref(locale, 'my'));
    assert.equal(stationHref(locale, 'about'), '/about/');
    assert.equal(stationLanguageHref(locale, '/about/'), '/about/');
  }
  assert.equal(stationSection('/about/'), 'about');
});

test('language changes retain valid public music selections, discarding private and duplicated parameters', () => {
  const track = '6A009E51-F7E1-454B-83CF-F37C7CA98D9B';
  const safe = '?track=6a009e51-f7e1-454b-83cf-f37c7ca98d9b&collection=quiet-days';
  for (const path of ['/music', '/music/', '/zh-hant/music/', '/en/music/old-child/']) {
    assert.equal(stationLanguageHref('ja', path, `?track=${track}&collection=quiet-days&token=secret&return=https://example.com`), `/ja/music/${safe}`);
  }
  assert.equal(stationLanguageHref('en', '/music/', `?track=${track}&track=${track}&collection=quiet-days`), '/en/music/?collection=quiet-days');
  assert.equal(stationLanguageHref('en', '/music/', '?collection=../api&session=secret'), '/en/music/');
});

test('future single-song and game routes keep their entity when switching language', () => {
  assert.equal(stationLanguageHref('en', '/zh-hans/music/tracks/sample-song/', '?collection=quiet-days&token=secret'), '/en/music/tracks/sample-song/?collection=quiet-days');
  assert.equal(stationLanguageHref('zh-Hant', '/en/games/cat-life-game/'), '/games/cat-life-game/');
  assert.equal(stationLanguageHref('ja', '/zh-hant/library/'), '/ja/library/');
  assert.equal(stationLanguageHref('en', '/zh-hans/privacy/'), '/en/privacy/');
  assert.equal(stationLanguageHref('ja', '/api/mobile/v1/me/music/'), '/ja/');
  assert.equal(stationLanguageHref('en', '/music/tracks/../../api/'), '/en/music/');
});

test('selected state recognizes descendants and aliases without confusing service paths', () => {
  assert.equal(stationSection('/zh-hant/music/descendant/'), 'music');
  assert.equal(stationSection('/games/cat-life/'), 'games');
  assert.equal(stationSection('/ja/apps/cat-life-game/'), 'games');
  assert.equal(stationSection('/en/library/'), 'member');
  assert.equal(stationSection('/zh-hant/'), 'home');
  assert.equal(stationSection('/api/mobile/v1/me/music/'), null);
  assert.equal(stationSection('/en/privacy/'), null);
});

test('language links never move the existing game runtime into a localized introduction path', () => {
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    assert.equal(stationLanguageHref(locale, '/games/cat-life'), '/games/cat-life/');
    assert.equal(stationLanguageHref(locale, '/games/cat-life/'), '/games/cat-life/');
  }
  assert.equal(stationLanguageHref('en', '/games/cat-life-game/'), '/en/games/cat-life-game/');
});

test('policy links retain four existing locale prefixes and reject arbitrary destinations', () => {
  assert.equal(stationPolicyHref('zh-Hant', 'terms'), '/zh-hant/terms/');
  assert.equal(stationPolicyHref('zh-Hans', 'privacy'), '/zh-hans/privacy/');
  assert.throws(() => stationPolicyHref('en', 'api'), TypeError);
});
