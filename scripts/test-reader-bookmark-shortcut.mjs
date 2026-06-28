import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const astroSource = await readFile(new URL('../src/components/SerialChapterPage.astro', import.meta.url), 'utf8');
const librarySource = await readFile(new URL('../src/pages/library/index.astro', import.meta.url), 'utf8');
const globalCssSource = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');

const count = (source, pattern) => (source.match(pattern) || []).length;

assert.equal(
  count(astroSource, /data-reader-bookmark-save/g),
  4,
  'Astro chapter page should expose footer and FAB bookmark buttons plus delegated selectors.'
);
assert.ok(
  count(astroSource, /aria-keyshortcuts="B"/g) >= 2,
  'Astro bookmark buttons should expose B keyboard shortcut metadata.'
);
assert.ok(
  astroSource.includes('title={bookmarkCopy.shortcutTitle}'),
  'Astro bookmark buttons should expose a shortcut tooltip.'
);
assert.ok(
  astroSource.includes('event.isComposing'),
  'Astro bookmark shortcut should ignore IME composition.'
);
assert.ok(
  astroSource.includes("document.addEventListener('click'") && astroSource.includes("closest('[data-reader-bookmark-save]')"),
  'Astro bookmark buttons should use delegated click handling.'
);
assert.ok(
  astroSource.includes("window.addEventListener('pagehide', clearBookmarkToastTimer"),
  'Astro bookmark toast timer should be cleared on pagehide.'
);
assert.ok(
  librarySource.includes('reader-bookmark-hint') && librarySource.includes('按 <kbd>B</kbd> 可保存目前閱讀位置'),
  'Member Center should explain the B shortcut in the bookmarks section.'
);
assert.ok(
  librarySource.includes('手機可點右下角「保存書籤」按鈕'),
  'Member Center bookmark hint should mention the mobile save button.'
);
assert.ok(
  librarySource.includes('reader-bookmark-status') && librarySource.includes('data-reader-bookmark-delete'),
  'Member Center bookmark list should expose per-bookmark delete controls and status feedback.'
);
assert.ok(
  librarySource.includes("method: 'DELETE'") && librarySource.includes('/api/readers/bookmarks?id='),
  'Member Center bookmark delete controls should call the reader bookmarks DELETE API.'
);
assert.ok(
  globalCssSource.includes('.reader-bookmark-hint') && globalCssSource.includes('.reader-bookmark-hint kbd'),
  'Member Center bookmark shortcut hint should have visible hint and keycap styling.'
);
assert.ok(
  globalCssSource.includes('.reader-bookmark-actions') && globalCssSource.includes('.reader-bookmark-delete'),
  'Member Center bookmark delete controls should have compact card actions styling.'
);

assert.ok(
  count(workerSource, /aria-keyshortcuts="B"/g) >= 2,
  'Worker dynamic bookmark buttons should expose B keyboard shortcut metadata.'
);
assert.ok(
  workerSource.includes('bookmarkCopy.shortcutTitle'),
  'Worker dynamic bookmark buttons should expose shortcut tooltip copy.'
);
assert.ok(
  workerSource.includes('event.isComposing'),
  'Worker dynamic bookmark shortcut should ignore IME composition.'
);
assert.ok(
  workerSource.includes("document.addEventListener('click'") && workerSource.includes("closest('[data-reader-bookmark-save]')"),
  'Worker dynamic bookmark buttons should use delegated click handling.'
);
assert.ok(
  workerSource.includes("window.addEventListener('pagehide', clearBookmarkToastTimer"),
  'Worker dynamic bookmark toast timer should be cleared on pagehide.'
);
assert.ok(
  workerSource.includes('handleReaderBookmarkDelete') && workerSource.includes("request.method === 'DELETE'"),
  'Worker should expose a DELETE endpoint for reader bookmarks.'
);
assert.ok(
  workerSource.includes('WHERE id = ? AND account_id = ?'),
  'Worker bookmark delete should be scoped to the signed-in account.'
);

console.log('reader bookmark shortcut tests passed');
