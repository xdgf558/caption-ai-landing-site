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
  getSignalSourceSecretBinding,
  isSignalSourceSecretConfigured,
  normalizePublicSignalUrl,
  parseAnthropicNewsPage,
  parseSignalFeed
} from '../src/signalCollection.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const migration0019 = read('migrations/0019_signal_automation.sql');
const migration0020 = read('migrations/0020_signal_collection.sql');
const migration0021 = read('migrations/0021_signal_candidate_triage.sql');
const migration0022 = read('migrations/0022_signal_source_adapters.sql');
const packageJson = JSON.parse(read('package.json'));
assert.match(migration0020, /CREATE TABLE IF NOT EXISTS signal_collection_tasks/);
assert.match(migration0020, /idx_signal_candidates_content_hash_unique/);
assert.match(migration0020, /idx_signal_collection_runs_single_active/);
assert.match(migration0020, /processed_source_count/);
assert.equal(packageJson.dependencies['fast-xml-parser'], '5.10.1');

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'signal-automation-phase2-'));
const sqlitePath = join(sqliteDirectory, 'signal.sqlite');
const runSqlite = (input) => spawnSync('sqlite3', [sqlitePath], { encoding: 'utf8', input });
try {
  const migrationResult = runSqlite(`${migration0019}\n${migration0020}\n${migration0021}\n${migration0022}`);
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
  const officialAdapterResult = runSqlite(`
    SELECT id || '|' || source_type || '|' || endpoint_url || '|' || is_enabled || '|' || config_json
    FROM signal_sources
    WHERE id IN ('openai-news', 'anthropic-news')
    ORDER BY id;
  `);
  assert.equal(officialAdapterResult.status, 0, officialAdapterResult.stderr);
  assert.equal(
    officialAdapterResult.stdout.trim(),
    [
      'anthropic-news|page|https://www.anthropic.com/news|1|{"adapter":"anthropic_news"}',
      'openai-news|rss|https://openai.com/news/rss.xml|1|{"adapter":"rss"}'
    ].join('\n')
  );
  const fredAdapterResult = runSqlite(`
    SELECT endpoint_url || '|' || is_enabled || '|' || requires_api_key
           || '|' || json_extract(config_json, '$.adapter')
           || '|' || json_extract(config_json, '$.secretBinding')
           || '|' || json_array_length(json_extract(config_json, '$.series'))
    FROM signal_sources WHERE id = 'fred-api';
  `);
  assert.equal(fredAdapterResult.status, 0, fredAdapterResult.stderr);
  assert.equal(
    fredAdapterResult.stdout.trim(),
    'https://api.stlouisfed.org/fred/series/observations|0|1|fred|FRED_API_KEY|5'
  );

  const singleActiveRunResult = runSqlite(`
    INSERT INTO signal_collection_runs (id, trigger_type, status)
    VALUES ('active-run-a', 'scheduled', 'queued');
    INSERT INTO signal_collection_runs (id, trigger_type, status)
    VALUES ('active-run-b', 'manual', 'running');
  `);
  assert.notEqual(singleActiveRunResult.status, 0);
  assert.match(singleActiveRunResult.stderr, /idx_signal_collection_runs_single_active/i);
  runSqlite("DELETE FROM signal_collection_runs WHERE id = 'active-run-a';");

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

const anthropicItems = parseAnthropicNewsPage(
  `<main>
    <a href="/features/research"><h2>Feature that must be ignored</h2><time>Jul 8, 2026</time></a>
    <a href="/news/hard-questions">
      <time datetime="2026-07-09">Jul 9, 2026</time>
      <h2>Hard questions about AI systems</h2>
      <p>An official Anthropic newsroom summary.</p>
    </a>
    <a href="/news/claude-for-teachers" class="PublicationList__listItem">
      <div><time>Jul 14, 2026</time><span class="PublicationList__subject">Product</span></div>
      <span class="PublicationList__title body-3">Introducing Claude for Teachers</span>
    </a>
  </main>`,
  'https://www.anthropic.com/news',
  10
);
assert.equal(anthropicItems.length, 2);
const hardQuestionsItem = anthropicItems.find((item) => item.externalId === '/news/hard-questions');
const teachersItem = anthropicItems.find((item) => item.externalId === '/news/claude-for-teachers');
assert.equal(hardQuestionsItem.canonicalUrl, 'https://www.anthropic.com/news/hard-questions');
assert.equal(hardQuestionsItem.publishedAt, '2026-07-09T00:00:00.000Z');
assert.equal(hardQuestionsItem.summary, 'An official Anthropic newsroom summary.');
assert.equal(teachersItem.title, 'Introducing Claude for Teachers');
assert.equal(teachersItem.publishedAt, '2026-07-14T00:00:00.000Z');
assert.throws(
  () => parseAnthropicNewsPage('<a href="/news/item"><h2>Item</h2><time>Today</time></a>', 'https://example.org/news'),
  (error) => error.code === 'SIGNAL_ANTHROPIC_SOURCE_INVALID'
);

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

const anthropicFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['160.79.104.10'] : []));
  }
  assert.equal(parsed.toString(), 'https://www.anthropic.com/news');
  return new Response(
    '<a href="/news/reliable-systems"><time datetime="2026-07-10">Jul 10, 2026</time><h2>Reliable systems</h2><p>Official update.</p></a>',
    { headers: { 'content-type': 'text/html' } }
  );
};
const collectedAnthropic = await collectSignalSource(
  {
    config_json: '{"adapter":"anthropic_news"}',
    endpoint_url: 'https://www.anthropic.com/news',
    http_etag: '',
    http_last_modified: '',
    max_items_per_run: 10
  },
  { fetchImpl: anthropicFetch }
);
assert.equal(collectedAnthropic.items.length, 1);
assert.equal(collectedAnthropic.items[0].title, 'Reliable systems');

const fredApiKey = 'a'.repeat(32);
const fredSource = {
  config_json: JSON.stringify({
    adapter: 'fred',
    secretBinding: 'FRED_API_KEY',
    series: [
      { id: 'UNRATE', label: 'US unemployment rate', unit: 'percent' },
      { id: 'DGS10', label: '10-year US Treasury yield', unit: 'percent' }
    ]
  }),
  endpoint_url: 'https://api.stlouisfed.org/fred/series/observations',
  max_items_per_run: 5,
  requires_api_key: 1
};
assert.equal(getSignalSourceSecretBinding(fredSource), 'FRED_API_KEY');
assert.equal(isSignalSourceSecretConfigured(fredSource), false);
assert.equal(isSignalSourceSecretConfigured(fredSource, { FRED_API_KEY: fredApiKey }), true);
const fredRequests = [];
const fredFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['23.21.34.52'] : []));
  }
  assert.equal(parsed.hostname, 'api.stlouisfed.org');
  assert.equal(parsed.searchParams.get('api_key'), fredApiKey);
  fredRequests.push(parsed);
  return new Response(
    JSON.stringify({
      observations: [
        { date: '2026-06-01', value: parsed.searchParams.get('series_id') === 'UNRATE' ? '4.1' : '4.25' },
        { date: '2026-05-01', value: parsed.searchParams.get('series_id') === 'UNRATE' ? '4.0' : '4.30' }
      ]
    }),
    { headers: { 'content-type': 'application/json' } }
  );
};
const collectedFred = await collectSignalSource(fredSource, {
  fetchImpl: fredFetch,
  secrets: { FRED_API_KEY: fredApiKey }
});
assert.equal(fredRequests.length, 2);
assert.equal(collectedFred.items.length, 2);
assert.equal(collectedFred.items[0].canonicalUrl, 'https://fred.stlouisfed.org/series/UNRATE');
assert.match(collectedFred.items[0].summary, /Previous valid observation: 4\.0 percent/);
assert.equal(collectedFred.finalUrl, 'https://fred.stlouisfed.org/');
assert.doesNotMatch(JSON.stringify(collectedFred), new RegExp(fredApiKey));
await assert.rejects(
  collectSignalSource(fredSource, { fetchImpl: fredFetch, secrets: {} }),
  (error) => error.code === 'SIGNAL_FRED_API_KEY_MISSING'
);

const fredRedirectTargets = [];
const fredRedirectFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    return new Response(dnsPayload(type, type === 'A' ? ['23.21.34.52'] : []));
  }
  fredRedirectTargets.push(parsed.hostname);
  return new Response(null, { status: 302, headers: { location: 'https://example.org/leak' } });
};
await assert.rejects(
  collectSignalSource(
    { ...fredSource, config_json: JSON.stringify({ ...JSON.parse(fredSource.config_json), series: [{ id: 'UNRATE', label: 'US unemployment rate', unit: 'percent' }] }) },
    { fetchImpl: fredRedirectFetch, secrets: { FRED_API_KEY: fredApiKey } }
  ),
  (error) => error.code === 'SIGNAL_FETCH_REDIRECT_BLOCKED'
);
assert.deepEqual(fredRedirectTargets, ['api.stlouisfed.org']);

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

let hackerNewsDnsAQueries = 0;
const hackerNewsFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'cloudflare-dns.com') {
    const type = parsed.searchParams.get('type');
    if (type === 'A') hackerNewsDnsAQueries += 1;
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
assert.equal(hackerNewsDnsAQueries, 3, 'Each outbound HN request must repeat the public DNS check.');

let selectionSql = '';
const selectionDb = {
  prepare(sql) {
    selectionSql = sql;
    return {
      async all() {
        return {
          results: [
            { config_json: '{"adapter":"rss"}', id: 'rss-source', is_enabled: 1, requires_api_key: 0 },
            { ...fredSource, id: 'fred-source', is_enabled: 1 }
          ]
        };
      }
    };
  }
};
const sourcesWithoutFredKey = await workerHooks.selectSignalCollectionSources(selectionDb);
assert.deepEqual(sourcesWithoutFredKey.map((source) => source.id), ['rss-source']);
const sourcesWithFredKey = await workerHooks.selectSignalCollectionSources(selectionDb, {
  secrets: { FRED_API_KEY: fredApiKey }
});
assert.deepEqual(sourcesWithFredKey.map((source) => source.id), ['rss-source', 'fred-source']);
assert.doesNotMatch(selectionSql, /requires_api_key\s*=\s*0/);

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
    if (/FROM signal_collection_runs\s+WHERE status IN \('queued', 'running'\)/i.test(this.sql)) {
      return [...this.db.runs.values()].find((run) => ['queued', 'running'].includes(run.status)) || null;
    }
    if (/SELECT \* FROM signal_collection_runs WHERE id = \?/i.test(this.sql)) return this.db.runs.get(this.params[0]) || null;
    return null;
  }

  async all() {
    if (/FROM signal_sources\s+WHERE is_enabled = 1/i.test(this.sql)) {
      this.db.lastSourceQuery = this.sql;
      this.db.lastSourceParams = this.params;
      const requested = this.params.length ? this.params.includes(this.db.source.id) : true;
      return { results: requested ? [this.db.source] : [] };
    }
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
    this.lastSourceParams = [];
    this.lastSourceQuery = '';
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
    body: JSON.stringify({ sourceIds: ['example-feed'] }),
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
assert.match(manualDb.lastSourceQuery, /id IN \(\?\)/);
assert.doesNotMatch(manualDb.lastSourceQuery, /LIMIT 100/);
assert.deepEqual(manualDb.lastSourceParams, ['example-feed']);

const duplicateManualResponse = await workerHooks.handleAdminCollectSignalSources(
  new Request('http://localhost/admin/api/signal/collect', {
    body: JSON.stringify({ sourceIds: ['example-feed'] }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  {
    SIGNAL_COLLECTION_QUEUE: { sendBatch: async (messages) => queuedMessages.push(...messages) },
    WAITLIST_DB: manualDb
  }
);
assert.equal(duplicateManualResponse.status, 200);
const duplicateManualPayload = await duplicateManualResponse.json();
assert.equal(duplicateManualPayload.alreadyRunning, true);
assert.equal(queuedMessages.length, 1);
assert.equal(manualDb.runs.size, 1);
assert.equal(manualDb.auditActions.length, 1);

class StaleRunStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new StaleRunStatement(this.db, this.sql, params);
  }

  async all() {
    if (/SELECT id\s+FROM signal_collection_runs/i.test(this.sql)) {
      this.db.cutoff = this.params[0];
      return { results: [{ id: this.db.run.id }] };
    }
    if (/SELECT source_id, last_error\s+FROM signal_collection_tasks/i.test(this.sql)) {
      return {
        results: this.db.tasks
          .filter((task) => task.status === 'failed')
          .map((task) => ({ last_error: task.last_error, source_id: task.source_id }))
      };
    }
    return { results: [] };
  }

  async first() {
    if (/COUNT\(\*\) AS source_count/i.test(this.sql)) {
      const tasks = this.db.tasks;
      return {
        accepted_count: tasks.reduce((sum, task) => sum + task.accepted_count, 0),
        duplicate_count: tasks.reduce((sum, task) => sum + task.duplicate_count, 0),
        failed_count: tasks.filter((task) => task.status === 'failed').length,
        fetched_count: tasks.reduce((sum, task) => sum + task.fetched_count, 0),
        processed_source_count: tasks.filter((task) => ['completed', 'failed'].includes(task.status)).length,
        source_count: tasks.length
      };
    }
    if (/UPDATE signal_collection_runs[\s\S]+RETURNING \*/i.test(this.sql)) {
      const [status, sourceCount, processedSourceCount, fetchedCount, acceptedCount, duplicateCount, failedCount, errors] =
        this.params;
      Object.assign(this.db.run, {
        accepted_count: acceptedCount,
        duplicate_count: duplicateCount,
        error_json: errors,
        failed_count: failedCount,
        fetched_count: fetchedCount,
        finished_at: '2026-07-17 14:00:00',
        processed_source_count: processedSourceCount,
        source_count: sourceCount,
        status,
        updated_at: '2026-07-17 14:00:00'
      });
      return this.db.run;
    }
    return null;
  }

  async run() {
    if (/UPDATE signal_collection_tasks[\s\S]+status = 'failed'/i.test(this.sql)) {
      const [message, runId] = this.params;
      let changes = 0;
      for (const task of this.db.tasks) {
        if (task.run_id !== runId || !['queued', 'running'].includes(task.status)) continue;
        task.status = 'failed';
        task.last_error = message;
        changes += 1;
      }
      return { meta: { changes } };
    }
    return { meta: { changes: 0 } };
  }
}

class StaleRunDb {
  constructor() {
    this.cutoff = '';
    this.run = {
      accepted_count: 1,
      created_at: '2026-07-17 10:00:00',
      created_by: 'signal-cron',
      duplicate_count: 0,
      error_json: '[]',
      failed_count: 0,
      fetched_count: 1,
      finished_at: null,
      id: 'stale-run',
      processed_source_count: 1,
      requested_source_ids_json: '["source-a","source-b"]',
      source_count: 2,
      started_at: '2026-07-17 10:00:00',
      status: 'running',
      trigger_type: 'scheduled',
      updated_at: '2026-07-17 10:00:00'
    };
    this.tasks = [
      {
        accepted_count: 1,
        duplicate_count: 0,
        fetched_count: 1,
        last_error: '',
        run_id: 'stale-run',
        source_id: 'source-a',
        status: 'completed'
      },
      {
        accepted_count: 0,
        duplicate_count: 0,
        fetched_count: 0,
        last_error: '',
        run_id: 'stale-run',
        source_id: 'source-b',
        status: 'running'
      }
    ];
  }

  prepare(sql) {
    return new StaleRunStatement(this, sql);
  }
}

const staleRunDb = new StaleRunDb();
const expiredRunIds = await workerHooks.expireStaleSignalCollectionRuns(staleRunDb);
assert.deepEqual(expiredRunIds, ['stale-run']);
assert.equal(staleRunDb.cutoff, '-120 minutes');
assert.equal(staleRunDb.tasks[1].status, 'failed');
assert.match(staleRunDb.tasks[1].last_error, /超过 120 分钟/);
assert.equal(staleRunDb.run.status, 'partial');
assert.equal(staleRunDb.run.processed_source_count, 2);
assert.equal(staleRunDb.run.failed_count, 1);

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
assert.match(adminSource, /source\.collectionConfigured/);
assert.match(adminSource, /source\.missingSecretBinding/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /async scheduled\(controller, env\)/);
assert.match(workerSource, /async queue\(batch, env\)/);

const collectionSource = read('src/signalCollection.js');
assert.match(collectionSource, /SIGNAL_FETCH_PRIVATE_ADDRESS/);

const wranglerSource = read('wrangler.toml');
assert.match(wranglerSource, /crons = \["17 \* \* \* \*"\]/);
assert.match(wranglerSource, /binding = "SIGNAL_COLLECTION_QUEUE"/);
assert.match(wranglerSource, /max_batch_size = 1/);
assert.match(wranglerSource, /max_concurrency = 1/);

console.log('Signal automation phase 2 collection, SSRF protection, migration, queue, and Admin checks passed.');
