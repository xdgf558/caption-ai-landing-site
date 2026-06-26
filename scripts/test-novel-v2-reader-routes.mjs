import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const assert = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const seriesPage = 'src/pages/novel/[bookId]/index.astro';
const chapterPage = 'src/pages/novel/[bookId]/chapter/[chapterId].astro';
const shelfPage = 'src/pages/novel/index.astro';
const serialsSource = read('src/data/serials.ts');
const hubSource = read('src/components/SerialsHubPage.astro');
const chapterSource = read('src/components/SerialChapterPage.astro');
const workerSource = read('src/worker.js');

assert(existsSync(join(root, shelfPage)), 'Novel V2 shelf route should exist at /novel/.');
assert(existsSync(join(root, seriesPage)), 'Novel V2 series route should exist at /novel/[bookId]/.');
assert(existsSync(join(root, chapterPage)), 'Novel V2 chapter route should exist at /novel/[bookId]/chapter/[chapterId]/.');

assert(
  read(shelfPage).includes("const basePath = '/novel/';") && read(shelfPage).includes('SerialsHubPage'),
  'Novel V2 shelf should reuse the existing Station Cat serial shelf style with /novel/ links.'
);

assert(
  read(seriesPage).includes("params: { bookId: serial.data.seriesSlug }") && read(seriesPage).includes("const basePath = '/novel/';"),
  'Novel V2 series page should map bookId to the existing series slug and use /novel/ as base path.'
);

assert(
  read(chapterPage).includes("params: { bookId: chapter.data.seriesSlug, chapterId: chapter.data.chapterSlug }") &&
    read(chapterPage).includes("const basePath = '/novel/';"),
  'Novel V2 chapter page should map bookId/chapterId and use /novel/ as base path.'
);

assert(
  serialsSource.includes("basePath === '/novel/'") && serialsSource.includes('/chapter/${chapterSlug}/'),
  'Shared chapter link helper should generate /novel/:bookId/chapter/:chapterId/ URLs.'
);

assert(
  hubSource.includes("firstChapterHref: getChapterHref(basePath, 'cmqjfju1300008z3wyh66ynvw', 'chap-offline-future-001')"),
  'Shared shelf spotlight should use the chapter link helper so V2 shelf links include /chapter/.'
);

assert(
  chapterSource.includes("const isNovelV2Reader = basePath === '/novel/';") &&
    chapterSource.includes('data-reader-v2-interactions') &&
    chapterSource.includes('stationcat:novel-v2:'),
  'Astro V2 reader should expose the first-stage like/comment interaction panel without affecting legacy routes.'
);

assert(
  workerSource.includes("if (section === 'novel')") &&
    workerSource.includes("chapterPathSegment: 'chapter'") &&
    workerSource.includes("readerVersion: 'v2'") &&
    workerSource.includes('const dynamicChapterPath') &&
    workerSource.includes('renderDynamicReaderInteractions(route, serial, chapter)'),
  'Worker dynamic routes should support /novel/:bookId/chapter/:chapterId/ and render the V2 reader controls.'
);

console.log('novel v2 reader route tests passed');
