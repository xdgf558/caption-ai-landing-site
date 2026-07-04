import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const {
  contentEntryPublicPath,
  dynamicCanonicalPath,
  dynamicSignalCardPath,
  dynamicSignalPath,
  parseDynamicContentRoute,
  renderDynamicSignalBrief,
  renderDynamicSignalIndex,
  renderSignalShareCardSvg
} = hooks;

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
    summaryBullets: ['AI 基建继续升温', '市场等待新的经济数据']
  }),
  parent_slug: '',
  published_at: '2026-07-04 09:00:00',
  slug: 'daily-brief-2026-07-04',
  status: 'published',
  subtitle: '科技',
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
assert.match(indexHtml, /Signal strip/);
assert.match(indexHtml, /\/signal\/daily-brief-2026-07-04\//);

const briefHtml = renderDynamicSignalBrief(briefRoute, signalRow, { html: '<p>正文内容</p>', source: 'test' });
assert.match(briefHtml, /分享到 X/);
assert.match(briefHtml, /card\.svg/);
assert.match(briefHtml, /Example source/);

const svg = renderSignalShareCardSvg(cardRoute, signalRow);
assert.match(svg, /^<svg/);
assert.match(svg, /width="1200"/);
assert.match(svg, /每日优先简报/);

const adminSource = await readFile(new URL('../src/pages/admin-v2/index.astro', import.meta.url), 'utf8');
assert.match(adminSource, /data-admin-v2-tab="signal"/);
assert.match(adminSource, /\/admin\/api\/signal\/import/);
assert.match(adminSource, /signal_brief/);

const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
assert.match(workerSource, /handleAdminImportSignalBrief/);
assert.match(workerSource, /new Set\(\['blog_post', 'novel_series', 'novel_chapter', 'signal_brief'\]\)/);
assert.match(workerSource, /twitter:card/);

console.log('Signal strip route, render, and admin import checks passed.');
