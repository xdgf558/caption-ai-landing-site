import MarkdownIt from 'markdown-it';

export const articleBodyLimit = 120000;
const siteOrigin = 'https://wwwstationcat.org';
export function safeArticleLink(value) {
  const text = String(value || '').trim();
  if (!text || /[\u0000-\u0020\u007f\\]/.test(text) || text.startsWith('//')) return false;
  try {
    const url = new URL(text, siteOrigin);
    return !url.username && !url.password && (['https:', 'http:'].includes(url.protocol) || url.protocol === 'mailto:');
  } catch { return false; }
}

export function localArticleImage(value) {
  try {
    const url = new URL(String(value), siteOrigin);
    const key = url.searchParams.get('key') || '';
    if (url.origin !== siteOrigin || url.pathname !== '/api/content/media' || url.hash || [...url.searchParams.keys()].some(k => k !== 'key')) return '';
    if (!/^content\/media\/covers\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|webp|gif|avif)$/.test(key) || key.includes('..')) return '';
    return `/api/content/media?key=${encodeURIComponent(key)}`;
  } catch { return ''; }
}

// Article-only parser. No raw HTML, external image loading, embeds, or executable URLs.
const md = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false, maxNesting: 40 });
md.validateLink = safeArticleLink;
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
const imageRule = md.renderer.rules.image;
md.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index], src = localArticleImage(token.attrGet('src'));
  if (!src) return md.utils.escapeHtml(renderer.renderInlineAsText(token.children || [], options, env));
  token.attrSet('src', src);
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  token.attrSet('referrerpolicy', 'no-referrer');
  return imageRule(tokens, index, options, env, renderer);
};
md.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  if (tokens[index].tag === 'h1') tokens[index].tag = 'h2';
  return renderer.renderToken(tokens, index, options);
};
md.renderer.rules.heading_close = md.renderer.rules.heading_open;
const tableLabels = { 'zh-Hans': '表格', 'zh-Hant': '表格', en: 'Table', ja: '表' };
md.renderer.rules.table_open = (tokens, index, options, env) => `<div class="article-table-scroll" tabindex="0" role="region" aria-label="${tableLabels[env.locale] || 'Table'}"><table>\n`;
md.renderer.rules.table_close = () => '</table></div>\n';

export function renderArticleMarkdown(value, locale = 'en') {
  const text = String(value || '');
  if (text.length > articleBodyLimit) throw new Error('文章正文不能超过 120000 字符。');
  return md.render(text, { locale });
}

// Normalize only spacing between parsed top-level blocks; code and list indentation stay intact.
export function formatArticleMarkdown(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  if (text.length > articleBodyLimit) throw new Error('文章正文不能超过 120000 字符。');
  const lines = text.split('\n');
  const blocks = md.parse(text, {}).filter(token => token.level === 0 && token.map);
  const output = [];
  let previousEnd = 0;
  for (const block of blocks) {
    const [start, end] = block.map;
    if (start < previousEnd) continue;
    const gap = lines.slice(previousEnd, start).join('\n').trim();
    if (gap) output.push(gap);
    output.push(lines.slice(start, end).join('\n').replace(/\n+$/, ''));
    previousEnd = end;
  }
  const tail = lines.slice(previousEnd).join('\n').trim();
  if (tail) output.push(tail);
  const formatted = output.join('\n\n');
  // Unclosed fences, reference definitions and indentation can make blank lines meaningful.
  return md.render(formatted) === md.render(text) ? formatted : text;
}
