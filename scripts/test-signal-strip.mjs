import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const {
  contentEntryPublicPath,
  dynamicCanonicalPath,
  dynamicHtmlShell,
  dynamicSignalCardPath,
  dynamicSignalPath,
  parseSignalMarkdownItems,
  parseSignalSourcesInput,
  parseDynamicContentRoute,
  renderDynamicSignalBrief,
  renderDynamicSignalIndex,
  renderSignalMarkdownToHtml,
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

const cardRoute = parseDynamicContentRoute('/signal/daily-brief-2026-07-04/card.svg');
assert.equal(cardRoute.kind, 'signal-card');
assert.equal(dynamicSignalCardPath(cardRoute, signalRow.slug), '/signal/daily-brief-2026-07-04/card.svg');
assert.equal(dynamicCanonicalPath(cardRoute), '/signal/daily-brief-2026-07-04/card.svg');

const enRoute = parseDynamicContentRoute('/en/signal/daily-brief-2026-07-04/');
assert.equal(enRoute.kind, 'signal-brief');
assert.equal(enRoute.locale, 'en');
assert.equal(enRoute.basePath, '/en/signal/');

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
assert.match(indexPage, /Noto\+Serif\+TC/);
assert.match(indexPage, /signal-station-header/);

const signalMarkdownHtml = renderSignalMarkdownToHtml(pastedSignalMarkdown);
assert.match(signalMarkdownHtml, /class="signal-section-heading"/);
assert.match(signalMarkdownHtml, /全球资金重新流入科技基金/);

const briefHtml = renderDynamicSignalBrief(briefRoute, signalRow, { html: '<p>正文内容</p>', markdown: pastedSignalMarkdown, source: 'test' });
assert.match(briefHtml, /分享到 X/);
assert.match(briefHtml, /card\.svg/);
assert.match(briefHtml, /Example source/);
assert.match(briefHtml, /class="signal-dispatch/);
assert.match(briefHtml, /class="signal-item/);
assert.match(briefHtml, /▲ 信號/);
assert.match(briefHtml, /▽ 噪音/);

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

console.log('Signal strip route, render, and admin import checks passed.');
