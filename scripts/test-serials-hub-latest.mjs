import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/SerialsHubPage.astro', import.meta.url), 'utf8');

assert.ok(
  source.includes('data-backend-latest-series'),
  'Backend serial spotlight should mark latest chapter text for hydration.'
);
assert.ok(
  source.includes("entryType: 'novel_chapter'"),
  'Backend latest chapter hydration should request novel chapters.'
);
assert.ok(
  source.includes("entryType: 'novel_series'"),
  'Bookshelf hydration should request backend novel series for the top shelf.'
);
assert.ok(
  source.includes('inferBookshelfCategories') && source.includes('悬疑'),
  'Bookshelf hydration should infer categories, including mystery/suspense works.'
);
assert.ok(
  source.includes("parentSlug: seriesSlug"),
  'Backend latest chapter hydration should query chapters for the current series.'
);
assert.ok(
  source.includes('chapters.length ? chapters[chapters.length - 1] : null'),
  'Backend latest chapter hydration should pick the highest sorted chapter number.'
);
assert.ok(
  source.includes('target.textContent = `${formatChapterNumber(latest.chapterNumber, locale)} ${latest.title}`;'),
  'Backend latest chapter hydration should update the visible latest chapter label.'
);
assert.ok(
  source.includes("document.addEventListener('DOMContentLoaded', callback, { once: true })"),
  'Backend latest chapter hydration should wait until the whole page DOM is ready.'
);
assert.ok(
  source.includes('runWhenDomReady(hydrateBackendLatestChapters);'),
  'Backend latest chapter hydration should run through the DOM-ready helper.'
);

console.log('serials hub latest chapter tests passed');
