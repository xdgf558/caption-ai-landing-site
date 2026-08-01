import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/SerialsHubPage.astro', import.meta.url), 'utf8');
const backendShelfSource = await readFile(new URL('../src/components/BackendContentShelf.astro', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

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
assert.ok(
  source.includes('formatSerialStatus') && source.includes('entry?.metadata?.serialStatus'),
  'Bookshelf previews should read each backend series serialStatus instead of hard-coding the ongoing label.'
);
assert.ok(
  backendShelfSource.includes('formatNovelStatus') && backendShelfSource.includes('entry?.metadata?.serialStatus'),
  'Backend novel cards should render the same series serialStatus label.'
);
assert.ok(
  styles.includes('.station-paper-page .serials-bookshelf') &&
    styles.includes('.serials-bookshelf__filters') &&
    styles.includes('overflow-x: auto') &&
    styles.includes('scroll-padding-inline: 18px'),
  'Mobile serial bookshelf should keep category controls horizontally scrollable.'
);
assert.ok(
  styles.includes('.serials-bookshelf__book') &&
    styles.includes('flex: 0 0 min(74vw, 252px)') &&
    styles.includes('-webkit-line-clamp: 4'),
  'Mobile serial bookshelf should use compact rail cards and clamp preview copy.'
);

console.log('serials hub latest chapter tests passed');
