import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const {
  contentEntryPublicPath,
  dynamicCanonicalPath,
  dynamicHtmlShell,
  dynamicSignalCardPath,
  dynamicSignalCardSvgPath,
  dynamicSignalPath,
  getAdjacentPublishedSignalBriefs,
  parseSignalMarkdownItems,
  parseSignalSourcesInput,
  parseDynamicContentRoute,
  renderDynamicSignalBrief,
  renderDynamicSignalIndex,
  renderSignalMarkdownToHtml,
  renderSignalShareCardPng,
  renderSignalShareCardSvg
} = hooks;

const pastedSignalMarkdown = `1. 美国就业降温，市场继续下调加息预期。
Reuters 报道，美国6月非农就业只增加 57,000 人。信号：利率压力短线缓和。

2. 全球资金重新流入科技基金，但仓位更集中。
Reuters 数据显示，科技行业基金吸引 89 亿美元流入。信号：AI 和科技仍是资金主线。`;

const signalRow = {
  access_level: 'free',
  description: '今天重点看 AI、市场和宏观数据的几个公开信号。',
  entry_type: 'signal_brief',
  excerpt: '今天重点看 AI、市场和宏观数据的几个公开信号。',
  locale: 'zh-Hant',
  metadata_json: JSON.stringify({
    briefDate: '2026-07-04',
    category: 'tech',
    sources: [{ label: 'Example source', url: 'https://example.com/report' }],
    summaryBullets: ['1. 美国就业降温，市场继续下调加息预期。']
  }),
  parent_slug: '',
  published_at: '2026-07-04 09:00:00',
  slug: 'daily-brief-2026-07-04',
  status: 'published',
  subtitle: '科技',
  signalMarkdown: pastedSignalMarkdown,
  title: '每日优先简报',
  updated_at: '2026-07-04 09:00:00'
};

assert.equal(contentEntryPublicPath(signalRow), '/signal/daily-brief-2026-07-04/');

const indexRoute = parseDynamicContentRoute('/signal/');
assert.equal(indexRoute.kind, 'signal-index');
assert.equal(indexRoute.basePath, '/signal/');
assert.equal(dynamicCanonicalPath(indexRoute), '/signal/');

const briefRoute = parseDynamicContentRoute('/signal/daily-brief-2026-07-04/');
assert.equal(briefRoute.kind, 'signal-brief');
assert.equal(dynamicSignalPath(briefRoute, signalRow.slug), '/signal/daily-brief-2026-07-04/');
assert.equal(dynamicCanonicalPath(briefRoute), '/signal/daily-brief-2026-07-04/');

const cardRoute = parseDynamicContentRoute('/signal/daily-brief-2026-07-04/card.png');
assert.equal(cardRoute.kind, 'signal-card');
assert.equal(cardRoute.assetFormat, 'png');
assert.equal(dynamicSignalCardPath(cardRoute, signalRow.slug), '/signal/daily-brief-2026-07-04/card.png');
assert.equal(dynamicCanonicalPath(cardRoute), '/signal/daily-brief-2026-07-04/card.png');

const legacySvgCardRoute = parseDynamicContentRoute('/signal/daily-brief-2026-07-04/card.svg');
assert.equal(legacySvgCardRoute.kind, 'signal-card');
assert.equal(legacySvgCardRoute.assetFormat, 'svg');
assert.equal(dynamicSignalCardSvgPath(legacySvgCardRoute, signalRow.slug), '/signal/daily-brief-2026-07-04/card.svg');
assert.equal(dynamicCanonicalPath(legacySvgCardRoute), '/signal/daily-brief-2026-07-04/card.svg');

const enRoute = parseDynamicContentRoute('/en/signal/daily-brief-2026-07-04/');
assert.equal(enRoute.kind, 'signal-brief');
assert.equal(enRoute.locale, 'en');
assert.equal(enRoute.basePath, '/en/signal/');

const enIndexRoute = parseDynamicContentRoute('/en/signal/');
assert.equal(enIndexRoute.kind, 'signal-index');

const jaIndexRoute = parseDynamicContentRoute('/ja/signal/');
assert.equal(jaIndexRoute.kind, 'signal-index');

assert.equal(parseDynamicContentRoute('/signal/daily-brief-2026-07-04/extra/path'), null);

const indexHtml = renderDynamicSignalIndex(indexRoute, [signalRow]);
assert.match(indexHtml, /SIGNAL STRIP/);
assert.match(indexHtml, /\/signal\/daily-brief-2026-07-04\//);
assert.match(indexHtml, /美国就业降温，市场继续下调加息预期/);
assert.match(indexHtml, /閱讀全文/);
assert.match(indexHtml, /class="signal-tape-card/);
assert.match(indexHtml, /RECENT DISPATCHES/);

const indexPage = dynamicHtmlShell({
  body: indexHtml,
  canonicalPath: '/signal/',
  description: 'Signal strip',
  lang: 'zh-Hant',
  pageKind: 'signal',
  title: '每日信號簡報'
});
assert.match(indexPage, /class="signal-page"/);
assert.match(indexPage, /--signal-serif:/);
assert.doesNotMatch(indexPage, /fonts\.googleapis\.com/);
assert.match(indexPage, /signal-station-header/);

const englishSignalRow = {
  ...signalRow,
  description: 'Five public signals worth checking today.',
  excerpt: 'Five public signals worth checking today.',
  locale: 'en',
  metadata_json: JSON.stringify({
    briefDate: '2026-07-04',
    category: 'tech',
    sources: [{ label: 'Example source', url: 'https://example.com/report' }],
    summaryBullets: Array.from({ length: 5 }, (_, index) => `${index + 1}. English signal ${index + 1}`)
  }),
  signalMarkdown: `1. OpenAI publishes a product update
The release adds a new workflow. Signal: Adoption may accelerate. Noise: Pricing remains unclear.`,
  title: 'Daily technology brief'
};
const englishIndexHtml = renderDynamicSignalIndex(enIndexRoute, [englishSignalRow]);
const englishPage = dynamicHtmlShell({
  body: englishIndexHtml,
  canonicalPath: '/en/signal/',
  description: 'Signal strip',
  lang: 'en',
  pageKind: 'signal',
  title: 'Daily Priority Brief'
});
assert.match(englishPage, /Tear off, read, and pass it on/);
assert.match(englishPage, /Each day, we turn the public signals/);
assert.match(englishPage, /briefs · BRIEFS/);
assert.match(englishIndexHtml, /more signals/);
assert.match(englishPage, /Signal strength/);
assert.doesNotMatch(englishPage, /撕下|閱讀|傳遞|份簡報|信號強度|站台短訊|月台/);

const japaneseSignalRow = {
  ...englishSignalRow,
  description: '今日確認したい公開シグナル。',
  excerpt: '今日確認したい公開シグナル。',
  locale: 'ja',
  metadata_json: JSON.stringify({
    briefDate: '2026-07-04',
    category: 'tech',
    sources: [],
    summaryBullets: ['1. 新しい製品アップデート']
  }),
  title: '今日の技術簡報'
};
const japanesePage = dynamicHtmlShell({
  body: renderDynamicSignalIndex(jaIndexRoute, [japaneseSignalRow]),
  canonicalPath: '/ja/signal/',
  description: 'Signal strip',
  lang: 'ja',
  pageKind: 'signal',
  title: 'Daily Priority Brief'
});
assert.match(japanesePage, /切り取り、読み、手渡す/);
assert.match(japanesePage, /シグナル強度/);
assert.match(japanesePage, /ホーム通信/);
assert.doesNotMatch(japanesePage, /撕下|閱讀|傳遞|份簡報|信號強度|站台短訊|月台/);

const signalMarkdownHtml = renderSignalMarkdownToHtml(pastedSignalMarkdown);
assert.match(signalMarkdownHtml, /class="signal-section-heading"/);
assert.match(signalMarkdownHtml, /全球资金重新流入科技基金/);

const briefHtml = renderDynamicSignalBrief(briefRoute, signalRow, { html: '<p>正文内容</p>', markdown: pastedSignalMarkdown, source: 'test' });
assert.match(briefHtml, /分享到 X/);
assert.match(briefHtml, /card\.png\?v=20260704090000/);
assert.match(briefHtml, /Example source/);
assert.match(briefHtml, /class="signal-dispatch/);
assert.match(briefHtml, /class="signal-item/);
assert.match(briefHtml, /▲ 信號/);
assert.match(briefHtml, /▽ 噪音/);

const englishBriefHtml = renderDynamicSignalBrief(
  enRoute,
  { ...englishSignalRow, id: 60 },
  { html: '', markdown: englishSignalRow.signalMarkdown, source: 'test' }
);
assert.match(englishBriefHtml, /1 signals · 1 SIGNALS/);
assert.match(englishBriefHtml, /Signal strength/);
assert.match(englishBriefHtml, /Tear off this strip/);
assert.match(englishBriefHtml, /Copied/);
assert.doesNotMatch(englishBriefHtml, /共 1 則信號|信號強度|已複製/);

const adjacentQueries = [];
const adjacentDb = {
  prepare(sql) {
    return {
      bind(...params) {
        adjacentQueries.push({ params, sql });
        return {
          first: async () =>
            /ORDER BY COALESCE\(published_at, updated_at\) DESC/.test(sql)
              ? { id: 59, slug: 'older-brief', title: 'Older brief' }
              : { id: 61, slug: 'newer-brief', title: 'Newer brief' }
        };
      }
    };
  }
};
const adjacentBriefs = await getAdjacentPublishedSignalBriefs(
  adjacentDb,
  { id: 60, published_at: '2026-07-04 09:00:00' },
  'en'
);
assert.equal(adjacentBriefs.previous.slug, 'older-brief');
assert.equal(adjacentBriefs.next.slug, 'newer-brief');
assert.equal(adjacentQueries.length, 2);
assert.ok(adjacentQueries.every(({ sql }) => /LIMIT 1/.test(sql)));
assert.ok(adjacentQueries.every(({ sql }) => !/LIMIT 50/.test(sql)));
assert.deepEqual(adjacentQueries[0].params, ['en', '2026-07-04 09:00:00', '2026-07-04 09:00:00', 60]);

const structuredItems = parseSignalMarkdownItems(`1. 第一則信號
這是一段正文。信號：企業採用正在增加。噪音：尚未公布實際定價。

2. 第二則信號
另一段正文。
信號：需求上升。
噪音：樣本仍然有限。`, [
  { label: 'Source one', url: 'https://example.com/one' },
  { label: 'Source two', url: 'https://example.com/two' }
]);
assert.equal(structuredItems.length, 2);
assert.equal(structuredItems[0].body, '這是一段正文。');
assert.equal(structuredItems[0].signal, '企業採用正在增加。');
assert.equal(structuredItems[0].noise, '尚未公布實際定價。');
assert.equal(structuredItems[1].source.label, 'Source two');

const svg = renderSignalShareCardSvg(cardRoute, signalRow);
assert.match(svg, /^<svg/);
assert.match(svg, /width="1200"/);
assert.match(svg, /height="675"/);
assert.match(svg, /每日优先简报/);
assert.match(svg, /全球资金重新流入科技基金/);

const png = await renderSignalShareCardPng(svg);
assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
const pngView = new DataView(png.buffer, png.byteOffset, png.byteLength);
assert.equal(pngView.getUint32(16), 1200);
assert.equal(pngView.getUint32(20), 675);

const briefPage = dynamicHtmlShell({
  body: briefHtml,
  canonicalPath: '/signal/daily-brief-2026-07-04/',
  description: signalRow.description,
  lang: 'zh-Hant',
  ogImage: '/signal/daily-brief-2026-07-04/card.png?v=20260704090000',
  pageKind: 'signal',
  title: signalRow.title
});
assert.match(briefPage, /twitter:card" content="summary_large_image"/);
assert.match(briefPage, /twitter:image" content="https:\/\/wwwstationcat\.org\/signal\/daily-brief-2026-07-04\/card\.png\?v=20260704090000"/);
assert.match(briefPage, /og:image:type" content="image\/png"/);
assert.match(briefPage, /og:image:width" content="1200"/);
assert.match(briefPage, /og:image:height" content="675"/);

const tenItemSignalRow = {
  ...signalRow,
  metadata_json: JSON.stringify({
    briefDate: '2026-07-04',
    category: 'tech',
    sources: [],
    summaryBullets: Array.from({ length: 10 }, (_, index) => `${index + 1}. Signal item ${index + 1}`)
  }),
  signalMarkdown: ''
};
const tenItemSvg = renderSignalShareCardSvg(cardRoute, tenItemSignalRow);
assert.match(tenItemSvg, /Signal item 10/);
assert.match(tenItemSvg, />10<\/text>/);

const sanitizedSources = parseSignalSourcesInput([
  { label: 'Good', url: 'https://example.com/report' },
  { label: 'Blocked', url: 'javascript:alert(1)' },
  'ftp://example.com/file',
  'Plain source note'
]);
assert.equal(sanitizedSources[0].url, 'https://example.com/report');
assert.equal(sanitizedSources[1].label, 'Blocked');
assert.equal(sanitizedSources[1].url, '');
assert.equal(sanitizedSources[2].url, '');
assert.equal(sanitizedSources[3].label, 'Plain source note');

const adminSource = await readFile(new URL('../src/pages/admin-v2/index.astro', import.meta.url), 'utf8');
assert.match(adminSource, /data-admin-v2-tab="signal"/);
assert.match(adminSource, /\/admin\/api\/signal\/import/);
assert.match(adminSource, /signal_brief/);

const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
assert.match(workerSource, /handleAdminImportSignalBrief/);
assert.match(workerSource, /new Set\(\['blog_post', 'novel_series', 'novel_chapter', 'signal_brief'\]\)/);
assert.match(workerSource, /twitter:card/);
assert.match(workerSource, /'content-type': 'image\/png'/);

console.log('Signal strip route, render, and admin import checks passed.');
