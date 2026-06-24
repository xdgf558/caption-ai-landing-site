import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const astroSource = await readFile(new URL('../src/components/SerialChapterPage.astro', import.meta.url), 'utf8');
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

console.log('reader bookmark shortcut tests passed');
