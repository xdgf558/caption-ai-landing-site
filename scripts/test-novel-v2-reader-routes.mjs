import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const loadSerialsModule = () => {
  const source = read('src/data/serials.ts');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    compiled,
    {
      exports: module.exports,
      module,
      require: (id) => {
        if (id === 'node:fs') return { existsSync };
        throw new Error(`Unexpected require in serials test: ${id}`);
      }
    },
    { filename: 'serials.js' }
  );
  return module.exports;
};

const seriesPage = 'src/pages/novel/[bookId]/index.astro';
const chapterPage = 'src/pages/novel/[bookId]/chapter/[chapterId].astro';
const shelfPage = 'src/pages/novel/index.astro';
const hubSource = read('src/components/SerialsHubPage.astro');
const chapterSource = read('src/components/SerialChapterPage.astro');

assert.equal(existsSync(join(root, shelfPage)), true, 'Novel V2 shelf route should exist at /novel/.');
assert.equal(existsSync(join(root, seriesPage)), true, 'Novel V2 series route should exist at /novel/[bookId]/.');
assert.equal(
  existsSync(join(root, chapterPage)),
  true,
  'Novel V2 chapter route should exist at /novel/[bookId]/chapter/[chapterId]/.'
);

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

const { getChapterHref } = loadSerialsModule();
assert.equal(getChapterHref('/novel/', 'book', 'ch1'), '/novel/book/chapter/ch1/');
assert.equal(getChapterHref('/works/', 'book', 'ch1'), '/works/book/ch1/');
assert.equal(getChapterHref('/zh-hant/works/', 'book', 'ch1'), '/zh-hant/works/book/ch1/');

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

const novelIndexRoute = hooks.parseDynamicContentRoute('/novel/');
assert.deepEqual(novelIndexRoute, {
  basePath: '/novel/',
  chapterSlug: '',
  kind: 'novel-index',
  locale: 'zh-Hant',
  readerVersion: 'v2',
  seriesSlug: ''
});

const novelSeriesRoute = hooks.parseDynamicContentRoute('/novel/book/');
assert.deepEqual(novelSeriesRoute, {
  basePath: '/novel/',
  chapterSlug: '',
  kind: 'novel-series',
  locale: 'zh-Hant',
  readerVersion: 'v2',
  seriesSlug: 'book'
});

const novelChapterRoute = hooks.parseDynamicContentRoute('/novel/book/chapter/ch1/');
assert.deepEqual(novelChapterRoute, {
  basePath: '/novel/',
  chapterPathSegment: 'chapter',
  chapterSlug: 'ch1',
  kind: 'novel-chapter',
  locale: 'zh-Hant',
  readerVersion: 'v2',
  seriesSlug: 'book'
});

assert.equal(hooks.parseDynamicContentRoute('/novel/book/anything/'), null);
assert.equal(hooks.parseDynamicContentRoute('/novel/book/chapter/'), null);
assert.equal(hooks.parseDynamicContentRoute('/novel/book/chapter/ch1/extra/'), null);
assert.deepEqual(hooks.parseDynamicContentRoute('/en/novel/book/chapter/ch1/'), {
  basePath: '/en/novel/',
  chapterPathSegment: 'chapter',
  chapterSlug: 'ch1',
  kind: 'novel-chapter',
  locale: 'en',
  readerVersion: 'v2',
  seriesSlug: 'book'
});
assert.equal(hooks.parseDynamicContentRoute('/zh-hant/novel/book/chapter/ch1/'), null);
assert.equal(hooks.parseDynamicContentRoute('/works/book/ch1/extra/'), null);

assert.equal(hooks.getLegacyWorksRedirectPath('/works/'), '/novel/');
assert.equal(hooks.getLegacyWorksRedirectPath('/en/works/'), '/novel/');
assert.equal(hooks.getLegacyWorksRedirectPath('/zh-hant/works/'), '/novel/');
assert.equal(hooks.getLegacyWorksRedirectPath('/zh-hans/works/book/'), '/novel/book/');
assert.equal(hooks.getLegacyWorksRedirectPath('/ja/works/book/ch1/'), '/novel/book/chapter/ch1/');
assert.equal(hooks.getLegacyWorksRedirectPath('/works/book/ch1/extra/'), '');
assert.equal(hooks.getLegacyWorksRedirectPath('/novel/book/chapter/ch1/'), '');

assert.equal(hooks.dynamicCanonicalPath(novelChapterRoute), '/novel/book/chapter/ch1/');
assert.equal(hooks.dynamicSeriesPath(novelChapterRoute, 'book'), '/novel/book/');
assert.equal(hooks.dynamicChapterPath(novelChapterRoute, 'book', 'ch2'), '/novel/book/chapter/ch2/');

const worksChapterRoute = hooks.parseDynamicContentRoute('/works/book/ch1/');
assert.equal(hooks.dynamicChapterPath(worksChapterRoute, 'book', 'ch2'), '/works/book/ch2/');

const contentSeriesRow = { entry_type: 'novel_series', locale: 'zh-Hant', slug: 'book' };
const contentChapterRow = { entry_type: 'novel_chapter', locale: 'zh-Hant', parent_slug: 'book', slug: 'ch1' };
const englishContentSeriesRow = { entry_type: 'novel_series', locale: 'en', slug: 'book' };
const englishContentChapterRow = { entry_type: 'novel_chapter', locale: 'en', parent_slug: 'book', slug: 'ch1' };
assert.equal(hooks.contentEntryPublicPath(contentSeriesRow), '/novel/book/');
assert.equal(hooks.contentEntryPublicPath(contentChapterRow), '/novel/book/chapter/ch1/');
assert.equal(hooks.contentEntryPublicPath(englishContentSeriesRow), '/en/novel/book/');
assert.equal(hooks.contentEntryPublicPath(englishContentChapterRow), '/en/novel/book/chapter/ch1/');
assert.equal(hooks.contentEntryLegacyWorksPath(contentSeriesRow), '/zh-hant/works/book/');
assert.equal(hooks.contentEntryLegacyWorksPath(contentChapterRow), '/zh-hant/works/book/ch1/');

const legacyRedirectResponse = await worker.fetch(
  new Request('https://wwwstationcat.org/zh-hant/works/book/ch1/?a=1'),
  {}
);
assert.equal(legacyRedirectResponse.status, 301);
assert.equal(
  legacyRedirectResponse.headers.get('location'),
  'https://wwwstationcat.org/novel/book/chapter/ch1/?a=1'
);

const serial = {
  access_level: 'paid',
  author_name: 'Station Cat',
  description: 'A serial.',
  excerpt: '',
  slug: 'book',
  subtitle: '',
  title: 'Book'
};
const chapters = [
  { access_level: 'free', description: '', excerpt: '', parent_slug: 'book', slug: 'ch1', title: 'Chapter 1', word_count: 10 },
  { access_level: 'free', description: '', excerpt: '', parent_slug: 'book', slug: 'ch2', title: 'Chapter 2', word_count: 20 },
  { access_level: 'free', description: '', excerpt: '', parent_slug: 'book', slug: 'ch3', title: 'Chapter 3', word_count: 30 }
];

const seriesHtml = hooks.renderDynamicNovelSeries(novelSeriesRoute, serial, { html: '<p>Body</p>' }, chapters);
assert.match(seriesHtml, /href="\/novel\/book\/chapter\/ch1\/"/);
assert.match(seriesHtml, /href="\/novel\/book\/chapter\/ch3\/"/);
assert.match(seriesHtml, /href="\/novel\/"/);
assert.equal(hooks.getDynamicNovelSeriesStatusLabel(serial, 'zh-Hant'), '連載中');
assert.equal(
  hooks.getDynamicNovelSeriesStatusLabel({ metadata_json: '{"serialStatus":"completed"}' }, 'zh-Hant'),
  '已完結'
);
assert.equal(
  hooks.getDynamicNovelSeriesStatusLabel({ metadata_json: '{"serialStatus":"completed"}' }, 'en'),
  'Completed'
);

const completedSeriesHtml = hooks.renderDynamicNovelSeries(
  novelSeriesRoute,
  { ...serial, metadata_json: '{"serialStatus":"completed"}' },
  { html: '<p>Body</p>' },
  chapters
);
assert.match(completedSeriesHtml, /已完結/);

const pricedSeriesHtml = hooks.renderDynamicNovelSeries(novelSeriesRoute, serial, { html: '<p>Body</p>' }, chapters, {
  freeChapters: 20,
  priceMode: 'chapter-paid',
  chapterCredits: 1
});
assert.match(pricedSeriesHtml, /前 20 章免費，第 21 章起 1 閱讀點 \/ 章/);

const elevenChapters = Array.from({ length: 11 }, (_, index) => ({
  access_level: 'free',
  chapter_number: index + 1,
  description: '',
  excerpt: '',
  parent_slug: 'book',
  slug: `ch${index + 1}`,
  title: `Chapter ${index + 1}`,
  word_count: 10
}));
const paidAfterTenSettings = {
  chapterCredits: 1,
  chapterPriceAmount: 0,
  freeChapters: 10,
  priceMode: 'chapter-paid'
};
const paidAfterTenHtml = hooks.renderDynamicNovelSeries(
  novelSeriesRoute,
  serial,
  { html: '<p>Body</p>' },
  elevenChapters,
  paidAfterTenSettings
);
assert.match(paidAfterTenHtml, /第十章<\/span>\s*<span>免費<\/span>/);
assert.match(paidAfterTenHtml, /第十一章<\/span>\s*<span>付費<\/span>/);
const paidChapterHtml = hooks.renderDynamicNovelChapter(
  { ...novelChapterRoute, chapterSlug: 'ch11' },
  serial,
  elevenChapters[10],
  { html: '<p>Paid body should not render before unlock.</p>' },
  elevenChapters,
  paidAfterTenSettings
);
assert.match(paidChapterHtml, /data-serial-access-gate/);
assert.match(paidChapterHtml, /data-access="paid"/);
assert.doesNotMatch(paidChapterHtml, /Paid body should not render before unlock/);

const memberFromTenChapters = Array.from({ length: 11 }, (_, index) => ({
  access_level: 'free',
  chapter_number: index + 1,
  description: '',
  excerpt: '',
  parent_slug: 'book',
  slug: `member-ch${index + 1}`,
  title: `Member Chapter ${index + 1}`,
  word_count: 10
}));
const memberFromTenSettings = {
  chapterCredits: 0,
  chapterPriceAmount: 0,
  chapters: memberFromTenChapters.map((chapter) => ({
    access: chapter.access_level,
    chapterNumber: chapter.chapter_number,
    chapterSlug: chapter.slug,
    status: 'published'
  })),
  freeChapters: 0,
  memberFromChapter: 10,
  priceMode: 'free'
};
const memberSeriesHtml = hooks.renderDynamicNovelSeries(
  novelSeriesRoute,
  { ...serial, access_level: 'free' },
  { html: '<p>Body</p>' },
  memberFromTenChapters,
  memberFromTenSettings
);
assert.match(memberSeriesHtml, /免費閱讀 · 第 10 章起需登入會員/);
assert.match(memberSeriesHtml, /第九章<\/span>\s*<span>免費<\/span>/);
assert.match(memberSeriesHtml, /第十章<\/span>\s*<span>登入後免費<\/span>/);

const memberChapterHtml = hooks.renderDynamicNovelChapter(
  { ...novelChapterRoute, chapterSlug: 'member-ch10' },
  serial,
  memberFromTenChapters[9],
  { html: '<p>Member body should not render before sign in.</p>' },
  memberFromTenChapters,
  memberFromTenSettings
);
assert.match(memberChapterHtml, /data-access="member"/);
assert.match(memberChapterHtml, /登入後即可免費閱讀本章/);
assert.match(memberChapterHtml, /登入後，可以查看或提交本章評論/);
assert.doesNotMatch(memberChapterHtml, /解鎖本章/);
assert.doesNotMatch(memberChapterHtml, /<button[^>]+data-serial-credit-unlock/);
assert.doesNotMatch(memberChapterHtml, /Member body should not render before sign in/);
assert.equal(hooks.dynamicProtectedAccessFromChapterAccess('member'), 'member');
assert.equal(
  hooks.getEffectiveDynamicChapterAccessLevel(memberFromTenChapters[9], memberFromTenSettings, 9),
  'member'
);
assert.equal(hooks.getNovelChapterAccessRequired({ access_level: 'member' }), 'member');
assert.equal(
  hooks.applyContentPricingSnapshot(
    { chapterCredits: 1, chapterPriceAmount: 1, priceMode: 'chapter-paid' },
    { chapterCredits: 0, chapterPriceAmount: 0, mode: 'free' },
    'test'
  ).chapterCredits,
  0
);
assert.deepEqual(
  await hooks.resolveReaderChapterAccessForComments(
    {},
    {},
    { account_id: 1, email: 'reader@example.com' },
    { access_level: 'member', parent_slug: 'book', slug: 'member-ch10' }
  ),
  {
    accessRequired: 'member',
    allowed: true,
    authenticated: true,
    protected: true,
    reason: 'member_signed_in'
  }
);
await assert.rejects(
  hooks.normalizeCreditUnlockPayload(
    { access: 'member', chapterSlug: 'member-ch10', seriesSlug: 'book' },
    {},
    {}
  ),
  (error) => error?.code === 'CREDIT_UNLOCK_SCOPE_NOT_SUPPORTED'
);

const manyChapters = Array.from({ length: 10 }, (_, index) => ({
  access_level: 'free',
  description: '',
  excerpt: '',
  parent_slug: 'book',
  slug: `ch${index + 1}`,
  title: `Chapter ${index + 1}`,
  word_count: 10
}));
const paginatedSeriesHtml = hooks.renderDynamicNovelSeries(novelSeriesRoute, serial, { html: '<p>Body</p>' }, manyChapters);
assert.match(paginatedSeriesHtml, /data-chapters-per-page="9"/);
assert.match(paginatedSeriesHtml, /data-chapter-page="2" hidden/);
assert.match(paginatedSeriesHtml, /data-chapter-page-button="2"/);
assert.match(
  read('src/worker.js'),
  /\.chapter-card\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/,
  'Dynamic chapter pagination should hide page 2+ cards even when .card sets display:grid.'
);

const chapterHtml = hooks.renderDynamicNovelChapter(
  { ...novelChapterRoute, chapterSlug: 'ch2' },
  serial,
  chapters[1],
  { html: '<p>Body</p>' },
  chapters,
  { chapterCredits: 1 }
);
assert.match(chapterHtml, /href="\/novel\/book\/"/);
assert.match(chapterHtml, /href="\/novel\/book\/chapter\/ch1\/"/);
assert.match(chapterHtml, /href="\/novel\/book\/chapter\/ch3\/"/);
assert.match(chapterHtml, /data-reader-v2-interactions/);

console.log('novel v2 reader route tests passed');
