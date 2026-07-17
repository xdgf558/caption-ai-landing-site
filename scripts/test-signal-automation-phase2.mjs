import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as workerHooks } from '../src/worker.js';
import {
  collectSignalSource,
  fetchPublicSignalResource,
  normalizePublicSignalUrl,
  parseSignalFeed
} from '../src/signalCollection.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const migration0019 = read('migrations/0019_signal_automation.sql');
const migration0020 = read('migrations/0020_signal_collection.sql');
assert.match(migration0020, /CREATE TABLE IF NOT EXISTS signal_collection_tasks/);
assert.match(migration0020, /idx_signal_candidates_content_hash_unique/);
assert.match(migration0020, /processed_source_count/);

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'signal-automation-phase2-'));
const sqlitePath = join(sqliteDirectory, 'signal.sqlite');
const runSqlite = (input) => spawnSync('sqlite3', [sqlitePath], { encoding: 'utf8', input });
try {
  const migrationResult = runSqlite(`${migration0019}\n${migration0020}`);
  assert.equal(migrationResult.status, 0, migrationResult.stderr);
  const schemaResult = runSqlite(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'signal_collection_tasks')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_sources') WHERE name = 'http_etag')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_collection_runs') WHERE name = 'processed_source_count');
  `);
  assert.equal(schemaResult.status, 0, schemaResult.stderr);
  assert.equal(schemaResult.stdout.trim(), '1|1|1');
  const correctedSourceResult = runSqlite(
    "SELECT endpoint_url FROM signal_sources WHERE id = 'google-company-news';"
  );
  assert.equal(correctedSourceResult.status, 0, correctedSourceResult.stderr);
  assert.equal(correctedSourceResult.stdout.trim(), 'https://blog.google/rss/');
  const hackerNewsLimitResult = runSqlite(
    "SELECT max_items_per_run FROM signal_sources WHERE id = 'hacker-news-top';"
  );
  assert.equal(hackerNewsLimitResult.status, 0, hackerNewsLimitResult.stderr);
  assert.equal(hackerNewsLimitResult.stdout.trim(), '12');

  const uniqueHashResult = runSqlite(`
    INSERT INTO signal_candidates (id, source_id, canonical_url, title, content_hash)
    VALUES ('candidate-a', 'google-company-news', 'https://blog.google/a', 'A', 'same-content');
    INSERT INTO signal_candidates (id, source_id, canonical_url, title, content_hash)
    VALUES ('candidate-b', 'github-changelog', 'https://github.blog/b', 'B', 'same-content');
  `);
  assert.notEqual(uniqueHashResult.status, 0);
  assert.match(uniqueHashResult.stderr, /UNIQUE constraint failed: signal_candidates\.content_hash/i);
} finally {
  rmSync(sqliteDirectory, { force: true, recursive: true });
}

const rssItems = parseSignalFeed(
  `<?xml version="1.0"?>
   <rss><channel><item>
     <title>New product &amp; safety update</title>
     <link>https://news.example.org/post?utm_source=feed#top</link>
     <description><![CDATA[<p>A concise <strong>summary</strong>.</p>]]></description>
     <guid>post-1</guid>
     <pubDate>Fri, 17 Jul 2026 12:00:00 GMT</pubDate>
   </item></channel></rss>`,
  'https://news.example.org/feed.xml',
  10
);
assert.equal(rssItems.length, 1);
assert.equal(rssItems[0].canonicalUrl, 'https://news.example.org/post');
assert.equal(rssItems[0].summary, 'A concise summary .');

const atomItems = parseSignalFeed(
  `<?xml version="1.0"?>
   <feed xmlns="http://www.w3.org/2005/Atom"><entry>
     <title>Research update</title>
     <id>paper-1</id>
     <link rel="alternate" href="https://arxiv.org/abs/2607.12345" />
     <summary>Useful research signal.</summary>
     <author><name>Researcher</name></author>
     <updated>2026-07-17T10:00:00Z</updated>
   </entry></feed>`,
  'https://export.arxiv.org/api/query',
  10
);
assert.equal(atomItems.length, 1);
assert.equal(atomItems[0].author, 'Researcher');
assert.equal(atomItems[0].canonicalUrl, 'https://arxiv.org/abs/2607.12345');

assert.throws(
  () => parseSignalFeed('<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss />', 'https://example.org/feed', 10),
  (error) => error.code === 'SIGNAL_FEED_DTD_BLOCKED'
);
assert.equal(normalizePublicSignalUrl('http://127.0.0.1/feed'), '');
assert.equal(normalizePublicSignalUrl('https://reader:secret@example.org/feed'), '');

const dnsPayload = (type, addresses) =>
  JSON.stringify({ Answer: addresses.map((data) => ({ data, type: type === 'A' ? 1 : 28 })) });

const rssFetchCalls = [];
const rssFetch = async (url, init = {}) => {
  const parsed = new URL(url);
  rssFetchCalls.push({ headers: new Headers(init.headers || {}), url: parsed.toString() });
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['93.184.216.34'] : []), {
      headers: { 'content-type': 'application/dns-json' }
    });
  }
  return new Response(
    '<rss><channel><item><title>Collected item</title><link>https://example.org/item</link><description>Summary</description></item></channel></rss>',
    { headers: { etag: '"feed-v2"', 'last-modified': 'Fri, 17 Jul 2026 12:00:00 GMT' } }
  );
};

const collectedRss = await collectSignalSource(
  {
    config_json: '{"adapter":"rss"}',
    endpoint_url: 'https://example.org/feed.xml',
    http_etag: '"feed-v1"',
    http_last_modified: '',
    max_items_per_run: 10
  },
  { fetchImpl: rssFetch }
);
assert.equal(collectedRss.items.length, 1);
assert.equal(collectedRss.etag, '"feed-v2"');
assert.equal(
  rssFetchCalls.find((call) => call.url === 'https://example.org/feed.xml').headers.get('if-none-match'),
  '"feed-v1"'
);

const privateDnsFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['10.0.0.8'] : []));
  }
  throw new Error('The private target must never be fetched');
};
await assert.rejects(
  fetchPublicSignalResource('https://private-target.example.net/feed', { fetchImpl: privateDnsFetch }),
  (error) => error.code === 'SIGNAL_FETCH_PRIVATE_ADDRESS'
);

const redirectFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['93.184.216.34'] : []));
  }
  return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
};
await assert.rejects(
  fetchPublicSignalResource('https://public.example.net/feed', { fetchImpl: redirectFetch }),
  (error) => error.code === 'SIGNAL_FETCH_REDIRECT_BLOCKED'
);

const oversizedFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['93.184.216.34'] : []));
  }
  return new Response('large', { headers: { 'content-length': '2000000' } });
};
await assert.rejects(
  fetchPublicSignalResource('https://large.example.net/feed', { fetchImpl: oversizedFetch, maxBytes: 1024 }),
  (error) => error.code === 'SIGNAL_RESPONSE_TOO_LARGE'
);

const slowBodyFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['93.184.216.34'] : []));
  }
  return new Response(new ReadableStream({ start() {} }));
};
await assert.rejects(
  fetchPublicSignalResource('https://slow.example.net/feed', { fetchImpl: slowBodyFetch, timeoutMs: 25 }),
  (error) => error.code === 'SIGNAL_RESPONSE_TIMEOUT'
);

const hackerNewsFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['104.18.3.33'] : []));
  }
  if (parsed.pathname.endsWith('/topstories.json')) return new Response('[101,102]');
  if (parsed.pathname.endsWith('/101.json')) {
    return new Response(JSON.stringify({ by: 'alice', id: 101, time: 1784282400, title: 'Useful tool', type: 'story', url: 'https://example.org/tool' }));
  }
  return new Response(JSON.stringify({ by: 'bob', id: 102, time: 1784282401, title: 'Community discussion', type: 'story' }));
};
const collectedHackerNews = await collectSignalSource(
  {
    config_json: '{"adapter":"hacker_news"}',
    endpoint_url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    http_etag: '',
    http_last_modified: '',
    max_items_per_run: 30
  },
  { fetchImpl: hackerNewsFetch }
);
assert.equal(collectedHackerNews.items.length, 2);
assert.equal(collectedHackerNews.items[1].canonicalUrl, 'https://news.ycombinator.com/item?id=102');

class ManualStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new ManualStatement(this.db, this.sql, params);
  }

  async first() {
    if (/SELECT (?:id|http_etag|processed_source_count) FROM signal_/i.test(this.sql)) return null;
    if (/SELECT id FROM (?:content_entries|admin_audit_logs) LIMIT 1/i.test(this.sql)) return null;
    if (/SELECT \* FROM signal_collection_runs WHERE id = \?/i.test(this.sql)) return this.db.runs.get(this.params[0]) || null;
    return null;
  }

  async all() {
    if (/FROM signal_sources\s+WHERE is_enabled = 1/i.test(this.sql)) return { results: [this.db.source] };
    return { results: [] };
  }

  async run() {
    if (/INSERT INTO signal_collection_runs/i.test(this.sql)) {
      this.db.runs.set(this.params[0], {
        accepted_count: 0,
        created_at: '2026-07-17 12:00:00',
        created_by: this.params[4],
        duplicate_count: 0,
        error_json: '[]',
        failed_count: 0,
        fetched_count: 0,
        finished_at: null,
        id: this.params[0],
        processed_source_count: 0,
        requested_source_ids_json: this.params[2],
        source_count: this.params[3],
        started_at: null,
        status: 'queued',
        trigger_type: this.params[1],
        updated_at: '2026-07-17 12:00:00'
      });
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO signal_collection_tasks/i.test(this.sql)) {
      this.db.tasks.push({ id: this.params[0], runId: this.params[1], sourceId: this.params[2] });
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO admin_audit_logs/i.test(this.sql)) {
      this.db.auditActions.push(this.params[1]);
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }
}

class ManualDb {
  constructor() {
    this.auditActions = [];
    this.runs = new Map();
    this.tasks = [];
    this.source = {
      category: 'tech',
      config_json: '{"adapter":"rss"}',
      created_at: '2026-07-17 10:00:00',
      created_by: 'migration',
      endpoint_url: 'https://example.org/feed.xml',
      fetch_interval_minutes: 180,
      homepage_url: 'https://example.org/',
      http_etag: '',
      http_last_modified: '',
      id: 'example-feed',
      is_enabled: 1,
      language: 'en',
      last_error: '',
      last_error_at: null,
      last_fetched_at: null,
      last_http_status: null,
      last_item_count: 0,
      last_success_at: null,
      max_items_per_run: 20,
      name: 'Example feed',
      notes: '',
      publisher: 'Example',
      requires_api_key: 0,
      source_type: 'rss',
      trust_tier: 'primary',
      updated_at: '2026-07-17 10:00:00',
      updated_by: 'migration'
    };
  }

  prepare(sql) {
    return new ManualStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const manualDb = new ManualDb();
const queuedMessages = [];
const manualResponse = await workerHooks.handleAdminCollectSignalSources(
  new Request('http://localhost/admin/api/signal/collect', {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  {
    SIGNAL_COLLECTION_QUEUE: { sendBatch: async (messages) => queuedMessages.push(...messages) },
    WAITLIST_DB: manualDb
  }
);
assert.equal(manualResponse.status, 200);
const manualPayload = await manualResponse.json();
assert.equal(manualPayload.run.sourceCount, 1);
assert.equal(queuedMessages.length, 1);
assert.equal(queuedMessages[0].body.sourceId, 'example-feed');
assert.equal(manualDb.auditActions[0], 'signal_collection_start');

const protectedAdminEnv = {
  ADMIN_ALLOWED_EMAILS: 'admin@example.com',
  CF_ACCESS_AUD: 'test-audience',
  CF_ACCESS_TEAM_DOMAIN: 'stationcat.cloudflareaccess.com'
};
const protectedResponse = await worker.fetch(
  new Request('https://wwwstationcat.org/admin/api/signal/collect', { method: 'POST' }),
  protectedAdminEnv,
  {}
);
assert.equal(protectedResponse.status, 401);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /id="signal-collection-start"/);
assert.match(adminSource, /\/admin\/api\/signal\/collect/);
assert.match(adminSource, /采集到的资讯会先进入这里，不会直接发布/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /async scheduled\(_controller, env\)/);
assert.match(workerSource, /async queue\(batch, env\)/);

const collectionSource = read('src/signalCollection.js');
assert.match(collectionSource, /SIGNAL_FETCH_PRIVATE_ADDRESS/);

const wranglerSource = read('wrangler.toml');
assert.match(wranglerSource, /crons = \["17 \* \* \* \*"\]/);
assert.match(wranglerSource, /binding = "SIGNAL_COLLECTION_QUEUE"/);
assert.match(wranglerSource, /max_batch_size = 1/);
assert.match(wranglerSource, /max_concurrency = 1/);

console.log('Signal automation phase 2 collection, SSRF protection, migration, queue, and Admin checks passed.');
