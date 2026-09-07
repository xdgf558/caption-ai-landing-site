import assert from 'node:assert/strict';
import { articleBodyLimit, renderArticleMarkdown as render, formatArticleMarkdown as format, localArticleImage, safeArticleLink, normalizeArticleLink } from '../src/articleMarkdown.js';
import { encodedArticleLinks } from './helpers/article-link-fixtures.mjs';

const rich = '# Heading\n\nA **bold** and *italic* ~~deleted~~ text.\nSecond line.\n\n> Quote\n\n1. First\n2. Second\n   - Nested\n\n| Name | Value |\n| --- | --- |\n| sample | 42 |\n\n```js\nconst x = "<script>";\n```\n\n[Visit](https://example.com)';
const html = render(rich);
for (const tag of ['h2', 'strong', 'em', 's', 'blockquote', 'ol', 'ul', 'table', 'pre', 'code', 'br']) assert.match(html, new RegExp(`<${tag}[ >]`));
assert.doesNotMatch(html, /<h1|<script>/);
assert.match(html, /rel="noopener noreferrer"/);
assert.match(html, /class="article-table-scroll"/);
for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'vbscript:test', '//evil.org/', 'https://user:pass@example.com', 'https:\\evil.org', 'java\nscript:test']) {
  assert.equal(safeArticleLink(url), false, url);
}
for (const url of ['https://example.com/a?b=1', '/signal/', '#part', 'mailto:author@example.com']) assert.equal(safeArticleLink(url), true, url);
for (const url of [...encodedArticleLinks, 'relative/path', './signal/', '?query=1']) {
  assert.equal(safeArticleLink(url), false, url);
  assert.equal(normalizeArticleLink(url), '', url);
  assert.doesNotMatch(render(`[encoded](${url})`), /<a\b/, url);
  assert.doesNotMatch(render(`[encoded][ref]\n\n[ref]: ${url}`), /<a\b/, url);
}
assert.equal(normalizeArticleLink('/signal/?title=%E7%8C%AB'), 'https://wwwstationcat.org/signal/?title=%E7%8C%AB');
assert.equal(normalizeArticleLink('/safe/..//evil.example/'), 'https://wwwstationcat.org//evil.example/');
assert.equal(normalizeArticleLink('HTTPS://EXAMPLE.COM:443/a'), 'https://example.com/a');
assert.equal(normalizeArticleLink('#part'), '#part');
assert.equal(normalizeArticleLink('#'), '#');
assert.match(render('[normalized](HTTPS://EXAMPLE.COM:443/a)'), /href="https:\/\/example.com\/a"/);
assert.match(render('[site](/safe/..//evil.example/)'), /href="https:\/\/wwwstationcat.org\/\/evil.example\/"/);
for (const input of ['[x](javascript:alert(1))', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](jav&#x61;script:alert(1))', '![x](data:image/png;base64,AA)']) {
  assert.doesNotMatch(render(input), /<(?:script|img)\b|href="(?:javascript|data):/);
}
assert.equal(render('![Outside](https://tracker.example/image.png)'), '<p>Outside</p>\n');
const key = 'content/media/covers/2026/09/article-body_ab12.png';
const image = '/api/content/media?key=' + encodeURIComponent(key);
assert.equal(localArticleImage(image), image);
assert.equal(localArticleImage('https://wwwstationcat.org' + image), image);
assert.match(render(`![Caption](${image})`), /<img[^>]+alt="Caption"[^>]+loading="lazy"/);
for (const path of ['https://evil.org' + image, '/api/content/media?key=private/test.png', '/api/content/media?key=content/media/covers/../test.png', image + '&next=https://evil.org']) assert.equal(localArticleImage(path), '');

assert.equal(format('## Title\n\n\nParagraph\n\n\n'), '## Title\n\nParagraph');
for (const original of [rich, '    a\n    b\n\n\nNext', '- a\n  - b\n\n- c', 'a  \nb\n\n\nc', '[link][ref]\n\n\n[ref]: https://example.com', '```\ntrailing\n\n\n', '```js\n  const x = 2;\n\n```\n\n\nDone', '<div>\nnot HTML\n</div>', '  [ref]: https://example.com\n\n[link][ref]']) {
  assert.equal(render(format(original)), render(original), original);
  assert.equal(format(format(original)), format(original), 'format is idempotent');
}
assert.throws(() => render('x'.repeat(articleBodyLimit + 1)));
assert.throws(() => format('x'.repeat(articleBodyLimit + 1)));
console.log('Article Markdown rendering, safe URLs and lossless spacing tests passed.');
