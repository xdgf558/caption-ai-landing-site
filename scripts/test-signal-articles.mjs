import assert from 'node:assert/strict';
import './test-article-markdown.mjs';
import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';
import { normalizeArticleUrl, normalizeArticleInput, suggestArticleMetadata, renderArticleIndex } from '../src/signalArticles.js';
import { createArticleFixture } from './helpers/article-fixture.mjs';
import { articleShareData, articleShareCopy } from '../src/articleShare.js';
import { encodedArticleLinks } from './helpers/article-link-fixtures.mjs';

const { env, sqlite, objects } = createArticleFixture();
const base = 'http://localhost:4179';
const data = { sourceUrl: 'https://x.com/i/article/123?s=20', title: 'Making a small game', description: 'Notes from the workbench.', locale: 'en', markdown: '# First steps\n\n<script>alert(1)</script>', status: 'draft' };
const request = (path, body, origin = base) => new Request(base + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const call = (body, suffix = '', origin = base) => hooks.handleAdminArticles(request('/admin/api/articles' + suffix, body, origin), env);
const publicPage = async (path) => hooks.handleDynamicFrontendContent(request(path), env, {});

assert.equal(normalizeArticleUrl(data.sourceUrl).url, 'https://x.com/i/article/123');
assert.equal(normalizeArticleUrl('https://twitter.com/Statiocat/status/123#x').url, 'https://x.com/statiocat/status/123');
for (const url of ['http://x.com/i/article/1', 'https://x.com.evil.org/i/article/1', 'https://x.com@evil.org/i/article/1', 'https://x.com:444/i/article/1', 'https://x.com/else/status/1', 'https://127.0.0.1/']) assert.throws(() => normalizeArticleUrl(url));
assert.throws(() => normalizeArticleInput({ ...data, coverR2Key: 'content/media/covers/../private.png' }));
assert.throws(() => normalizeArticleInput({ ...data, title: '' }));
assert.throws(() => normalizeArticleInput({ ...data, markdown: 'a'.repeat(120001) }));
let fetches = 0;
const recognized = await suggestArticleMetadata(data.sourceUrl, async (url, options) => {
  fetches++; assert.equal(url, 'https://x.com/i/article/123'); assert.equal(options.redirect, 'error');
  return new Response('<meta property="og:type" content="article"><meta property="og:title" content="An essay"><meta property="og:description" content="A summary">', { headers: { 'content-type': 'text/html' } });
});
assert.equal(fetches, 1); assert.equal(recognized.title, 'An essay');
assert.equal((await suggestArticleMetadata(data.sourceUrl, async () => { throw Error('unavailable'); })).available, false);
assert.equal((await suggestArticleMetadata(data.sourceUrl, async () => new Response('<title>Log in</title>', { headers: { 'content-type': 'text/html' } }))).available, false);

assert.equal((await call(data, '', '')).status, 403);
assert.equal((await call(data, '', 'https://evil.org')).status, 403);
assert.equal((await call('{broken')).status, 400);
assert.equal((await call('x'.repeat(520001))).status, 413);
assert.equal((await call({ ...data, sourceUrl: 'https://evil.org/' })).status, 400);
assert.equal((await worker.fetch(new Request('https://wwwstationcat.org/admin/api/articles'), env, {})).status, 503, 'production Access gate stays closed when unconfigured');
const preview = await (await call(data, '/preview')).json();
assert.match(preview.html, /&lt;script&gt;/); assert.doesNotMatch(preview.html, /<script>/);
assert.equal(sqlite.prepare('SELECT count(*) n FROM content_entries').get().n, 0, 'preview is read-only');
let response = await call(data);
assert.equal(response.status, 200, await response.clone().text());
let saved = (await response.json()).entry;
assert.equal(saved.sourceKind, 'x_article');
assert.equal((await call(data)).status, 409);
assert.doesNotMatch(await (await publicPage('/en/signal/')).text(), /Making a small game/);
const originalKey = saved.markdownR2Key;
const update = { ...data, id: saved.id, version: saved.metadata.article.version, status: 'published' };
const pair = await Promise.all([call({ ...update, title: 'Published essay' }), call({ ...update, title: 'Losing edit' })]);
assert.deepEqual(pair.map(r => r.status).sort(), [200, 409]);
saved = (await pair.find(r => r.status === 200).json()).entry;
assert.notEqual(saved.markdownR2Key, originalKey);
assert.ok(objects.has(originalKey), 'old revision body survives');
assert.equal((await call(update)).status, 409, 'stale edit rejected');
assert.equal((await call({ ...update, sourceUrl: 'https://x.com/i/article/456' })).status, 409);
const loaded = await (await call(undefined, `?id=${saved.id}`)).json();
assert.equal(loaded.markdown, data.markdown);
const index = await (await publicPage('/signal/')).text();
assert.match(index, /Published essay/); assert.match(index, /\/en\/signal\/x-article-123\//);
const detail = await (await publicPage('/en/signal/x-article-123/')).text();
assert.match(detail, /&lt;script&gt;/); assert.match(detail, /"@type":"Article"/);
assert.match(detail, /data-article-share=/);
assert.match(detail, /scripts\/article-share\.js\?v=1/);
assert.equal((await hooks.handleDynamicFrontendContent(new Request(base + '/en/signal/', { method: 'HEAD' }), env, {})).body, null);
const linkOnly = (await (await call({ ...data, sourceUrl: 'https://x.com/i/article/456', title: 'Link only', markdown: '', status: 'published' })).json()).entry;
const linkDetail = await (await publicPage('/en/signal/x-article-456/')).text();
assert.match(linkDetail, /noindex, follow/);
assert.doesNotMatch(linkDetail, /"@type":"Article"/);
const sitemap = await (await hooks.handleSitemap(request('/sitemap.xml'), env, {})).text();
assert.match(sitemap, /x-article-123/); assert.doesNotMatch(sitemap, /x-article-456/);
assert.equal((await (await call(undefined, '?status=draft')).json()).entries.length, 0);
const unpublished = await call({ ...data, id: saved.id, version: saved.metadata.article.version, status: 'archived' });
assert.equal(unpublished.status, 200);
assert.doesNotMatch(await (await publicPage('/en/signal/')).text(), /Published essay/);
assert.equal(await publicPage('/en/signal/x-article-123/'), null);
sqlite.prepare("INSERT INTO content_entries(entry_type,locale,slug,title,status,source_kind) VALUES('signal_brief','en','legacy','Legacy brief','published','signal_brief')").run();
assert.match(await (await publicPage('/en/signal/?view=archive')).text(), /Legacy brief/);
assert.doesNotMatch(await (await publicPage('/en/signal/?view=archive')).text(), /Link only/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='article_save'").get().n, 4);
const image = new FormData(); image.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fHAAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'cover.png'); image.set('mediaKind', 'covers');
const uploaded = await hooks.handleAdminArticles(new Request(base + '/admin/api/articles/cover', { method: 'POST', headers: { origin: base }, body: image }), env);
assert.equal(uploaded.status, 200, await uploaded.clone().text());
const media = (await uploaded.json()).media;
assert.ok(normalizeArticleInput({ ...data, coverR2Key: media.key }).coverR2Key);
assert.equal((await call('x'.repeat(6 * 1024 * 1024 + 1), '/cover')).status, 413);
const rows = [{ locale: 'ja', slug: 'x-article-1', title: '<unsafe>', description: '"text"', metadata_json: JSON.stringify({ article: { hasBody: true, sourceUrl: 'https://x.com/i/article/1' } }) }];
assert.match(renderArticleIndex('en', rows), /&lt;unsafe&gt;/);
assert.match(renderArticleIndex('en', rows), /\/ja\/signal\/x-article-1\//);
assert.equal(linkOnly.metadata.article.hasBody, false);
const shared = articleShareData({ ...rows[0], title: '<unsafe> "quoted"', slug: 'x-article-1' }, '/ja/signal/');
assert.equal(shared.url, 'https://wwwstationcat.org/ja/signal/x-article-1/');
assert.ok(shared.modules.length >= 21);
assert.ok(shared.modules.every(row => /^[01]+$/.test(row) && row.length === shared.modules.length));
assert.equal(articleShareData({ slug: '../admin' }, '/signal/'), null);
assert.equal(articleShareData({ slug: 'x-article-1' }, '//evil.org/'), null);
for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
  assert.ok(articleShareCopy(locale).save);
  const rendered = renderArticleIndex(locale, rows);
  assert.match(rendered, /data-article-share-dialog/);
  assert.match(rendered, /&lt;unsafe&gt;/);
}
assert.match(linkDetail, /data-article-share=/, 'link-only articles can share their website wrapper');
assert.doesNotMatch(await (await publicPage('/en/signal/?view=archive')).text(), /data-article-share=/, 'legacy archive remains independent');

// Exercise the actual legacy routes, not only the new editor's handler.
const protectedEntry = (await (await call({ ...data, sourceUrl: 'https://x.com/i/article/777', locale: 'zh-Hant', status: 'published' })).json()).entry;
const legacyPayload = { entryType: 'signal_brief', slug: protectedEntry.slug, locale: 'zh-Hant', title: 'Overwritten', markdown: 'Wrong body', status: 'published' };
const before = sqlite.prepare('SELECT * FROM content_entries WHERE id = ?').get(protectedEntry.id);
const beforeObjects = [...objects.keys()];
const beforeRevisions = sqlite.prepare('SELECT count(*) n FROM content_revisions').get().n;
const beforeAudit = sqlite.prepare('SELECT count(*) n FROM admin_audit_logs').get().n;
for (const path of ['/admin/api/content/entries', '/admin/api/signal/import']) {
  const result = await worker.fetch(request(path, legacyPayload), env, {});
  assert.equal(result.status, 409, await result.clone().text());
  const error = await result.json();
  assert.equal(error.code, 'ARTICLE_EDITOR_REQUIRED');
  assert.equal(error.editUrl, '/admin/articles/');
}
assert.deepEqual(sqlite.prepare('SELECT * FROM content_entries WHERE id = ?').get(protectedEntry.id), before);
assert.deepEqual([...objects.keys()], beforeObjects, 'legacy saves are rejected before writing R2');
assert.equal(sqlite.prepare('SELECT count(*) n FROM content_revisions').get().n, beforeRevisions);
assert.equal(sqlite.prepare('SELECT count(*) n FROM admin_audit_logs').get().n, beforeAudit);
const spoofed = await worker.fetch(request('/admin/api/content/entries', { ...legacyPayload, sourceKind: 'x_article', articleVersion: protectedEntry.metadata.article.version }), env, {});
assert.equal(spoofed.status, 409, 'public payload cannot impersonate internal article options');
for (const query of ['', '?type=signal_brief&locale=zh-Hant']) {
  const listed = await (await worker.fetch(request('/admin/api/content/entries' + query), env, {})).json();
  assert.ok(listed.entries.every(row => row.sourceKind !== 'x_article'));
}
const prepare = env.WAITLIST_DB.prepare;
env.WAITLIST_DB.prepare = sql => {
  const statement = prepare(sql);
  // Simulate a concurrent article creation after the preflight's snapshot.
  if (sql.startsWith('SELECT source_kind FROM content_entries')) statement.first = async () => null;
  return statement;
};
assert.equal((await worker.fetch(request('/admin/api/content/entries', legacyPayload), env, {})).status, 409, 'UPSERT itself guards a stale preflight');
env.WAITLIST_DB.prepare = prepare;
assert.deepEqual(sqlite.prepare('SELECT * FROM content_entries WHERE id = ?').get(protectedEntry.id), before);
assert.match(await (await publicPage('/signal/')).text(), /Making a small game/);

const insertBrief = sqlite.prepare("INSERT INTO content_entries(entry_type,locale,slug,title,status,source_kind,visibility,featured,sort_order,published_at) VALUES('signal_brief','ja',?,?,'published','signal_brief',?,?,?,?)");
insertBrief.run('older', 'Archive older', 'public', 0, 0, '2026-01-01 00:00:00');
insertBrief.run('unlisted', 'Archive pinned unlisted', 'unlisted', 1, 10, '2026-01-02 00:00:00');
insertBrief.run('pinned', 'Archive first pinned', 'public', 1, 0, '2026-01-03 00:00:00');
const articleBetween = (await (await call({ ...data, sourceUrl: 'https://x.com/i/article/888', locale: 'ja', status: 'published' })).json()).entry;
sqlite.prepare('UPDATE content_entries SET published_at = ? WHERE id = ?').run('2026-01-02 12:00:00', articleBetween.id);
const archiveHtml = await (await publicPage('/ja/signal/?view=archive')).text();
assert.ok(archiveHtml.indexOf('Archive first pinned') < archiveHtml.indexOf('Archive pinned unlisted'));
assert.ok(archiveHtml.indexOf('Archive pinned unlisted') < archiveHtml.indexOf('Archive older'));
assert.doesNotMatch(archiveHtml, /x-article-888/);
const middleBrief = sqlite.prepare("SELECT * FROM content_entries WHERE slug='unlisted'").get();
const adjacent = await hooks.getAdjacentPublishedSignalBriefs(env.WAITLIST_DB, middleBrief, 'ja');
assert.equal(adjacent.previous.slug, 'older'); assert.equal(adjacent.next.slug, 'pinned');
sqlite.prepare('UPDATE content_entries SET metadata_json = ? WHERE id = ?').run(JSON.stringify({ article: { hasBody: false, sourceUrl: 'javascript:alert(1)' } }), articleBetween.id);
assert.equal((await publicPage('/ja/signal/')).status, 200);
assert.doesNotMatch(await (await publicPage('/ja/signal/')).text(), /javascript:|x-article-888/);
assert.match(renderArticleIndex('en', [{ metadata_json: '{invalid' }]), /New articles are on their way/);
env.WAITLIST_DB.prepare = sql => {
  const statement = prepare(sql);
  if (sql.includes("source_kind = 'x_article'") && sql.includes('LIMIT 21 OFFSET')) statement.all = async () => ({ results: [new Proxy({}, { get() { throw Error('HEAD must not render entries'); } })] });
  return statement;
};
assert.equal((await hooks.handleDynamicFrontendContent(new Request(base + '/signal/', { method: 'HEAD' }), env, {})).status, 200);
env.WAITLIST_DB.prepare = prepare;
assert.match(await (await publicPage('/signal/?page=2&tracking=test')).text(), /rel="canonical" href="https:\/\/wwwstationcat.org\/signal\/\?page=2"/);

// Stored/R2 bodies may predate the current writer limit. Public reads must remain available.
const longEntry = (await (await call({ ...data, sourceUrl: 'https://x.com/i/article/9901', status: 'published' })).json()).entry;
const longMarkdown = '<script>window.articleInjected=true</script>\n\n' + 'x'.repeat(120001) + '\nFull-text tail <img src=x onerror=alert(1)>';
await env.CONTENT_BUCKET.put(longEntry.markdownR2Key, longMarkdown);
const warnings = [], originalWarn = console.warn;
let longResponse;
try {
  console.warn = (...args) => warnings.push(args);
  longResponse = await publicPage('/en/signal/x-article-9901/');
} finally { console.warn = originalWarn; }
assert.equal(longResponse.status, 200);
const longHtml = await longResponse.text();
assert.match(longHtml, /class="article-plain-text"/);
assert.match(longHtml, /&lt;script&gt;window.articleInjected=true&lt;\/script&gt;/);
assert.match(longHtml, /Full-text tail &lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(longHtml, /<script>window.articleInjected|<img src=x/);
assert.equal(warnings.length, 1);
assert.deepEqual(warnings[0][1], { code: 'ARTICLE_BODY_RENDER_FALLBACK', entryId: longEntry.id, bodyLength: longMarkdown.length });
assert.doesNotMatch(JSON.stringify(warnings), /articleInjected|Full-text tail/);
const bucketGet = env.CONTENT_BUCKET.get;
let headBodyReads = 0;
try {
  env.CONTENT_BUCKET.get = async () => { headBodyReads++; throw Error('HEAD must not read R2'); };
  const head = await hooks.handleDynamicFrontendContent(new Request(base + '/en/signal/x-article-9901/', { method: 'HEAD' }), env, {});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(headBodyReads, 0, 'HEAD does not access stored article bodies');
} finally { env.CONTENT_BUCKET.get = bucketGet; }
assert.equal((await call({ ...data, markdown: longMarkdown }, '/preview')).status, 400, 'admin preview still rejects oversize input');
assert.equal((await call({ ...data, sourceUrl: 'https://x.com/i/article/9902', markdown: longMarkdown })).status, 400, 'writer limits stay strict');

const encodedBody = encodedArticleLinks.map((url, index) => `[Encoded ${index}](${url})`).join('\n\n');
const encodedInput = { ...data, sourceUrl: 'https://x.com/i/article/9903', markdown: encodedBody, status: 'published' };
const previewLinks = (await (await call(encodedInput, '/preview')).json()).html;
const encodedEntry = (await (await call(encodedInput)).json()).entry;
const encodedHtml = await (await publicPage(`/en/signal/${encodedEntry.slug}/`)).text();
for (const output of [previewLinks, encodedHtml]) {
  assert.doesNotMatch(output, /href="(?:java|data%|%|https%)/i, 'encoded schemes must not become article links');
  assert.match(output, /Encoded 0/);
}
console.log('Signal articles: URL bounds, auth, preview, SQLite CAS, revision bodies, public routes, archive, sitemap and uploads passed.');
