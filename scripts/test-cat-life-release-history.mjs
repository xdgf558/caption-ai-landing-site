import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const root = new URL('../public/games/cat-life/', import.meta.url);
function setup() {
  const context = vm.createContext({ window: {}, console, URL, document: { baseURI: 'http://localhost/games/cat-life/' } });
  for (const file of ['core/namespace.js', 'utils/format.js', 'core/i18n.js', 'ui/renderVersionPanel.js']) {
    vm.runInContext(readFileSync(new URL('src/js/' + file, root), 'utf8'), context);
  }
  const game = context.window.CatGame;
  game.state.game = { meta: { lastSeenVersion: '1.25.0' }, settings: { language: 'zh-CN' } };
  return game;
}
for (const language of ['zh-CN', 'en', 'ja']) test(language + ': latest only; all archived notes retained and collapsed', () => {
  const game = setup();
  game.state.game.settings.language = language;
  const before = JSON.stringify(game.state);
  const html = game.ui.renderVersionPanel(game.state.game);
  assert.equal(JSON.stringify(game.state), before, 'render has no state mutations');
  assert.equal((html.match(/<details /g) || []).length, 4);
  assert.doesNotMatch(html, /<details[^>]+ open/);
  assert.match(html, /data-dismiss-release-note/);
  const latest = html.split('class="page-card release-latest"')[1].split('</section>')[0];
  assert.equal((latest.match(/<li /g) || []).length, 2);
  assert.deepEqual(Array.from(game.config.releaseHistory, item => item.version), ['1.25.0', '1.24.0', '1.23.0', '1.22.2']);
  assert.deepEqual(Array.from(game.config.releaseHistory, item => item.notes[language].length), [3, 3, 4, 1]);
  for (const release of game.config.releaseHistory) for (const note of release.notes[language]) {
    assert.ok(html.includes(game.utils.format.escapeHtml(note)));
    assert.ok(!latest.includes(game.utils.format.escapeHtml(note)));
  }
  assert.doesNotMatch(html, /version_history_|undefined|NaN/);
});
test('view-only expansion, empty history, language fallback and escaping', () => {
  const game = setup();
  game.state.releaseHistoryOpen = ['1.24.0'];
  let html = game.ui.renderVersionPanel(game.state.game);
  assert.match(html, /data-release-version="1.24.0" open/);
  assert.doesNotMatch(html, /data-release-version="1.25.0" open/);
  game.config.releaseHistory = [{ version: '<x>', notes: { 'zh-CN': ['<script>bad</script>'] } }];
  game.state.game.settings.language = 'unknown';
  html = game.ui.renderVersionPanel(game.state.game);
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(html.includes('data-release-version="&lt;x&gt;"'));
  game.config.releaseHistory = [{ version: game.config.version, notes: game.config.releaseNotes }];
  assert.doesNotMatch(game.ui.renderVersionPanel(game.state.game), /<details|id="release-history-title"/);
});
