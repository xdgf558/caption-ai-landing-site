import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import sharp from 'sharp';
const root = new URL('../public/games/cat-life/', import.meta.url);
function setup(language = 'zh-CN', query = '?lang=zh-Hant&accountId=secret&returnTo=private#secret') {
  const context = vm.createContext({ window: {}, URL, Intl, document: { baseURI: 'http://127.0.0.1/games/cat-life/' + query } });
  for (const path of ['core/namespace.js', 'core/i18n.js', 'utils/format.js', 'utils/shareCard.js', 'ui/renderVersionPanel.js']) {
    vm.runInContext(readFileSync(new URL('src/js/' + path, root), 'utf8'), context);
  }
  const game = context.window.CatGame;
  game.state.game = { settings: { language }, meta: { lastSeenVersion: '1.26.2' }, player: { name: 'PRIVATE_NAME', gold: 123456789 } };
  return game;
}
for (const language of ['zh-CN', 'en', 'ja']) test(language + ': public latest release only, translated UI, no state mutations', () => {
  const game = setup(language);
  const before = JSON.stringify(game.state);
  const model = game.utils.shareCard.getModel();
  assert.equal(model.version, game.config.version);
  assert.deepEqual(Array.from(model.notes), Array.from(game.config.releaseNotes[language]));
  const text = game.utils.shareCard.getShareText(model);
  assert.match(text, /Station Cat/);
  assert.doesNotMatch(text, /PRIVATE_NAME|123456789|secret|returnTo|share_|undefined|NaN/);
  assert.equal(new URL(model.url).origin, 'https://wwwstationcat.org');
  assert.equal(new URL(model.url).pathname, '/games/cat-life/');
  assert.equal(new URL(model.url).searchParams.size, 1);
  assert.equal(new URL(model.url).searchParams.get('lang'), language === 'zh-CN' ? 'zh-Hant' : language);
  const rendered = game.ui.renderVersionPanel(game.state.game);
  assert.match(rendered, /id="game-share-open"/);
  assert.doesNotMatch(rendered, /share_open/);
  const intent = new URL(game.utils.shareCard.xIntent(model));
  assert.equal(intent.origin, 'https://twitter.com');
  assert.equal(intent.pathname, '/intent/tweet');
  assert.equal(intent.searchParams.get('url'), model.url);
  assert.equal(Array.from(intent.searchParams.get('text')).length < 200, true);
  assert.equal(JSON.stringify(game.state), before);
});
test('current notes are snapshotted and the share text keeps all notes, never old history', () => {
  const game = setup();
  const notes = ['first', 'second', 'third', 'fourth'];
  game.config.releaseNotes['zh-CN'] = notes;
  const model = game.utils.shareCard.getModel();
  notes[0] = 'changed';
  assert.equal(model.notes[0], 'first');
  assert.match(game.utils.shareCard.getShareText(model), /fourth/);
  assert.doesNotMatch(game.utils.shareCard.getShareText(model), /Moonlight|changed/);
  game.config.releaseNotes['zh-CN'] = [];
  assert.doesNotMatch(game.utils.shareCard.getShareText(game.utils.shareCard.getModel()), /undefined/);
});
test('untrusted locale cannot leak current origin, extra parameters or a fragment', () => {
  const game = setup('zh-CN', '?lang=https://evil.example/&token=secret#member');
  assert.equal(game.utils.shareCard.getModel().url, 'https://wwwstationcat.org/games/cat-life/?lang=zh-CN');
});
test('wrapping is bounded, prefers word boundaries, and preserves graphemes', () => {
  const game = setup();
  const ctx = { measureText: text => ({ width: Array.from(new Intl.Segmenter().segment(text)).length }) };
  const wrap = game.utils.shareCard.wrapText;
  assert.deepEqual(Array.from(wrap(ctx, 'hello world again', 8, 3)), ['hello', 'world', 'again']);
  assert.deepEqual(Array.from(wrap(ctx, '猫咪🐈🐈🐈🐈👨‍👩‍👧‍👦结尾', 4, 2)), ['猫咪🐈🐈', '🐈🐈👨‍👩‍👧‍👦…']);
  for (const value of ['中文更新'.repeat(100), 'longtext'.repeat(100), '<script>hello</script>']) {
    const lines = wrap(ctx, value, 20, 2);
    assert.ok(lines.length <= 2);
    assert.ok(lines.every(line => ctx.measureText(line).width <= 20));
  }
});
test('illustration and font stay lean and local; QR vendor matches the licensed dependency', async () => {
  const asset = new URL('src/assets/share/station-letter.webp', root);
  const metadata = await sharp(readFileSync(asset)).metadata();
  assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1440);
  assert.ok(statSync(asset).size < 200000);
  assert.ok(statSync(new URL('src/assets/share/letter-title.ttf', root)).size < 20000);
  assert.match(readFileSync(new URL('src/assets/share/OFL.txt', root), 'utf8'), /SIL OPEN FONT LICENSE/);
  assert.equal(readFileSync(new URL('src/js/vendor/qrcode.js', root), 'utf8'), readFileSync(new URL('../node_modules/qrcode-generator/qrcode.js', import.meta.url), 'utf8'));
  const index = readFileSync(new URL('index.html', root), 'utf8');
  assert.ok(index.includes('shareDialog.js')); assert.ok(index.includes('share-card.css'));
  assert.ok(!index.includes('vendor/qrcode.js'), 'QR is loaded only on demand');
});
