import { extractSignalLinkedPagePreview, readResponseTextLimited } from './signalCollection.js';
import { articleShareCopy, articleShareData } from './articleShare.js';

export const articleSourceKind = 'x_article';
export const escapeArticleHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fail = (message) => { throw Object.assign(new Error(message), { status: 400, code: 'ARTICLE_INVALID' }); };
const field = (value, max, name) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) fail(`${name}过长。`);
  return text;
};

export function normalizeArticleUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { fail('请填写完整的 X 文章链接。'); }
  if (url.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) || url.port || url.username || url.password) fail('只接受 https://x.com 上的文章链接。');
  const article = url.pathname.match(/^\/i\/article\/(\d{1,25})\/?$/);
  const post = url.pathname.match(/^\/statiocat\/status\/(\d{1,25})\/?$/i);
  if (!article && !post) fail('请粘贴 Articles 链接，或 @statiocat 发布文章的链接。');
  const id = (article || post)[1];
  const kind = article ? 'article' : 'post';
  return { url: `https://x.com/${article ? 'i/article' : 'statiocat/status'}/${id}`, slug: `x-${kind}-${id}` };
}

export function normalizeArticleInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('文章格式无效。');
  const source = normalizeArticleUrl(payload.sourceUrl);
  const title = field(payload.title, 240, '标题');
  const description = field(payload.description, 1200, '摘要');
  if (!title || !description) fail('请填写标题和摘要。');
  const markdown = field(payload.markdown, 120000, '正文');
  const locale = payload.locale || 'zh-Hans';
  if (!['zh-Hant', 'zh-Hans', 'en', 'ja'].includes(locale)) fail('请选择文章语言。');
  const status = payload.status || 'draft';
  if (!['draft', 'published', 'archived'].includes(status)) fail('文章状态无效。');
  const coverR2Key = field(payload.coverR2Key, 500, '封面');
  if (coverR2Key && (!/^content\/media\/covers\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|webp|gif|avif)$/.test(coverR2Key) || coverR2Key.includes('..'))) fail('请使用后台上传的封面。');
  return { ...source, title, description, markdown, locale, status, coverR2Key, coverAlt: field(payload.coverAlt, 300, '图片说明'), hasBody: Boolean(markdown) };
}

// Best effort only: a fixed public X host, no redirects, cookies, credentials or embeds.
export async function suggestArticleMetadata(sourceUrl, fetchImpl = fetch) {
  const source = normalizeArticleUrl(sourceUrl);
  try {
    const response = await fetchImpl(source.url, { redirect: 'error', signal: AbortSignal.timeout(6000), headers: { accept: 'text/html' } });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return { available: false };
    const html = await readResponseTextLimited(response, 262144, 6000);
    const preview = extractSignalLinkedPagePreview(html);
    // Login/challenge pages must never be mistaken for the author's article.
    if (!/<meta\b[^>]*(?:property|name)=["']og:type["'][^>]*content=["']article["']/i.test(html)) return { available: false };
    if (!preview.title || /^(?:x|twitter|log in|sign in)(?:\s|$)/i.test(preview.title)) return { available: false };
    return { available: true, title: preview.title.slice(0, 240), description: preview.summary.slice(0, 1200) };
  } catch { return { available: false }; }
}

export const articleCopy = (locale) => ({
  'zh-Hant': { title: '文章與觀察', description: '關於創作、工具與日常的長篇記錄。', latest: '最新文章', empty: '新文章正在整理中。', read: '閱讀文章', original: '在 X 閱讀原文', back: '返回文章', more: '下一頁', previous: '上一頁', language: '原文語言', minutes: '分鐘閱讀' },
  'zh-Hans': { title: '文章与观察', description: '关于创作、工具与日常的长篇记录。', latest: '最新文章', empty: '新文章正在整理中。', read: '阅读文章', original: '在 X 阅读原文', back: '返回文章', more: '下一页', previous: '上一页', language: '原文语言', minutes: '分钟阅读' },
  en: { title: 'Notes & Essays', description: 'Longer thoughts on making things, useful tools, and everyday life.', latest: 'Latest articles', empty: 'New articles are on their way.', read: 'Read article', original: 'Read on X', back: 'Back to articles', more: 'Next page', previous: 'Previous page', language: 'Original language', minutes: 'min read' },
  ja: { title: '記事と思考', description: 'ものづくり、ツール、日々の暮らしについての記録。', latest: '新着記事', empty: '新しい記事を準備しています。', read: '記事を読む', original: 'X で原文を読む', back: '記事一覧へ', more: '次のページ', previous: '前のページ', language: '原文の言語', minutes: '分で読めます' }
}[locale] || articleCopy('zh-Hant'));
export const articleBasePath = (locale) => ({ 'zh-Hant': '/signal/', 'zh-Hans': '/zh-hans/signal/', en: '/en/signal/', ja: '/ja/signal/' }[locale] || '/signal/');
export const articleMetadata = (row) => {
  try { return JSON.parse(row.metadata_json || '{}').article || {}; } catch { return {}; }
};
const languageName = (locale) => ({ 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文', en: 'English', ja: '日本語' }[locale] || locale);
const dateLabel = (row) => String(row.published_at || row.updated_at || '').slice(0, 10);
const renderArticleShare = (locale, row) => {
  const data = articleShareData(row, articleBasePath(row.locale));
  if (!data) return '';
  return `<button type="button" class="article-share-trigger" hidden data-article-share="${escapeArticleHtml(JSON.stringify(data))}">${escapeArticleHtml(articleShareCopy(locale).open)}</button>`;
};
const renderArticleShareDialog = (locale) => {
  const e = escapeArticleHtml, copy = articleShareCopy(locale);
  return `<dialog class="article-share-dialog" aria-labelledby="article-share-title" data-article-share-dialog data-copy="${e(JSON.stringify(copy))}">
    <div class="article-share-heading"><h2 id="article-share-title">${e(copy.title)}</h2><button type="button" data-share-close autofocus>${e(copy.close)}</button></div>
    <div class="article-share-preview" aria-busy="false"><img data-share-image hidden alt="${e(copy.ready)}" width="1080" height="1440"></div>
    <p class="article-share-status" role="status" aria-live="polite"></p>
    <p class="article-share-hint">${e(copy.hint)}</p>
    <div class="article-share-actions"><a data-share-save hidden download="station-cat-article.png">${e(copy.save)}</a><button type="button" data-share-native hidden>${e(copy.share)}</button><button type="button" data-share-copy>${e(copy.copy)}</button><button type="button" data-share-retry hidden>${e(copy.retry)}</button></div>
    <input data-share-url aria-label="${e(copy.copy)}" readonly>
  </dialog>`;
};
const coverUrl = (row) => row.cover_r2_key ? `/api/content/media?key=${encodeURIComponent(row.cover_r2_key)}` : '';
export function renderArticleIndex(locale, rows, { page = 1, hasMore = false } = {}) {
  const e = escapeArticleHtml, copy = articleCopy(locale), base = articleBasePath(locale);
  // Legacy/admin data can be malformed: one broken reference must not take down the collection.
  const visibleRows = rows.flatMap(row => {
    const meta = articleMetadata(row);
    try {
      const source = normalizeArticleUrl(meta.sourceUrl);
      return [{ row, meta, href: meta.hasBody ? `${articleBasePath(row.locale)}${row.slug}/` : source.url }];
    } catch { return []; }
  });
  return `<section class="articles-intro"><p class="articles-eyebrow">STATION CAT / JOURNAL</p><h1>${e(copy.title)}</h1><p>${e(copy.description)}</p><a href="https://x.com/statiocat">@statiocat</a></section>
    <h2 class="articles-list-heading">${e(copy.latest)}</h2>
    <section class="articles-list" aria-label="${e(copy.latest)}">${visibleRows.length ? visibleRows.map(({row, meta, href}) => {
      return `<article class="article-row${coverUrl(row) ? ' has-cover' : ''}" lang="${e(row.locale)}">
        ${coverUrl(row) ? `<a class="article-thumbnail" href="${e(href)}" tabindex="-1" aria-hidden="true"><img src="${e(coverUrl(row))}" alt="" width="480" height="320" loading="lazy"></a>` : ''}
        <div><div class="article-meta"><time datetime="${e(dateLabel(row))}">${e(dateLabel(row))}</time><span>${e(languageName(row.locale))}</span>${meta.hasBody ? `<span>${row.reading_minutes || 1} ${e(copy.minutes)}</span>` : '<span>X Articles</span>'}</div>
        <h2><a href="${e(href)}">${e(row.title)}</a></h2><p>${e(row.description)}</p><div class="article-row-actions"><a class="article-read" href="${e(href)}">${e(meta.hasBody ? copy.read : copy.original)} <span aria-hidden="true">↗</span></a>${renderArticleShare(locale, row)}</div></div></article>`;
    }).join('') : `<p class="articles-empty">${e(copy.empty)}</p>`}</section>
    <nav class="articles-pagination" aria-label="${e(copy.latest)}">${page > 1 ? `<a href="${base}?page=${page - 1}">${e(copy.previous)}</a>` : ''}${hasMore ? `<a href="${base}?page=${page + 1}">${e(copy.more)}</a>` : ''}</nav>${renderArticleShareDialog(locale)}`;
}

export function renderArticleDetail(locale, row, safeHtml) {
  const e = escapeArticleHtml, copy = articleCopy(locale), meta = articleMetadata(row);
  return `<article class="article-reader"><a class="article-back" href="${articleBasePath(locale)}">${e(copy.back)}</a>
    <header><div class="article-meta"><span>STATION CAT</span><time datetime="${e(dateLabel(row))}">${e(dateLabel(row))}</time></div><h1>${e(row.title)}</h1><p class="article-lead">${e(row.description)}</p><div class="article-row-actions"><a href="${e(normalizeArticleUrl(meta.sourceUrl).url)}" rel="noopener noreferrer">${e(copy.original)} ↗</a>${renderArticleShare(locale, row)}</div></header>
    ${coverUrl(row) ? `<img class="article-cover" src="${e(coverUrl(row))}" alt="${e(row.cover_alt)}" width="1200" height="800">` : ''}
    <div class="article-prose">${safeHtml}</div></article>${renderArticleShareDialog(locale)}`;
}
