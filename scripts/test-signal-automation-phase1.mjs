import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

class MockBoundStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  async first() {
    if (/SELECT id FROM signal_(sources|collection_runs|candidates) LIMIT 1/i.test(this.sql)) {
      if (this.db.missingSignalTables) throw new Error('D1_ERROR: no such table: signal_sources');
      return null;
    }
    if (/SELECT id FROM content_entries LIMIT 1/i.test(this.sql)) return null;
    if (/SELECT id FROM admin_audit_logs LIMIT 1/i.test(this.sql)) {
      if (this.db.missingAuditTable) throw new Error('D1_ERROR: no such table: admin_audit_logs');
      return null;
    }
    if (/SELECT \* FROM signal_sources WHERE id = \?/i.test(this.sql)) {
      return this.db.sources.get(this.params[0]) || null;
    }
    if (/INSERT INTO signal_sources/i.test(this.sql)) {
      const row = {
        id: this.params[0],
        name: this.params[1],
        publisher: this.params[2],
        source_type: this.params[3],
        category: this.params[4],
        trust_tier: this.params[5],
        endpoint_url: this.params[6],
        homepage_url: this.params[7],
        language: this.params[8],
        is_enabled: this.params[9],
        fetch_interval_minutes: this.params[10],
        max_items_per_run: this.params[11],
        requires_api_key: this.params[12],
        config_json: this.params[13],
        notes: this.params[14],
        created_by: this.params[15],
        updated_by: this.params[16],
        last_fetched_at: null,
        last_success_at: null,
        last_error_at: null,
        last_error: '',
        created_at: '2026-07-17 10:00:00',
        updated_at: '2026-07-17 10:00:00'
      };
      this.db.sources.set(row.id, row);
      return row;
    }
    if (/UPDATE signal_sources\s+SET is_enabled = \?/i.test(this.sql)) {
      const row = this.db.sources.get(this.params[2]);
      if (!row) return null;
      row.is_enabled = this.params[0];
      row.updated_by = this.params[1];
      row.updated_at = '2026-07-17 11:00:00';
      return row;
    }
    if (/UPDATE signal_sources\s+SET name = \?/i.test(this.sql)) {
      const row = this.db.sources.get(this.params[15]);
      if (!row) return null;
      Object.assign(row, {
        name: this.params[0],
        publisher: this.params[1],
        source_type: this.params[2],
        category: this.params[3],
        trust_tier: this.params[4],
        endpoint_url: this.params[5],
        homepage_url: this.params[6],
        language: this.params[7],
        is_enabled: this.params[8],
        fetch_interval_minutes: this.params[9],
        max_items_per_run: this.params[10],
        requires_api_key: this.params[11],
        config_json: this.params[12],
        notes: this.params[13],
        updated_by: this.params[14],
        updated_at: '2026-07-17 11:00:00'
      });
      return row;
    }
    return null;
  }

  async all() {
    if (/FROM signal_sources\s+ORDER BY/i.test(this.sql)) {
      return { results: [...this.db.sources.values()] };
    }
    if (/FROM signal_collection_runs/i.test(this.sql)) return { results: [] };
    if (/FROM signal_candidates AS candidate/i.test(this.sql)) return { results: [] };
    return { results: [] };
  }

  async run() {
    if (/INSERT INTO admin_audit_logs/i.test(this.sql)) {
      this.db.auditLogs.push({ action: this.params[1], targetId: this.params[3] });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }
}

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  bind(...params) {
    return new MockBoundStatement(this.db, this.sql, params);
  }

  async first() {
    return new MockBoundStatement(this.db, this.sql, []).first();
  }

  async all() {
    return new MockBoundStatement(this.db, this.sql, []).all();
  }
}

class MockDb {
  constructor(options = {}) {
    this.auditLogs = [];
    this.sources = new Map();
    this.missingAuditTable = Boolean(options.missingAuditTable);
    this.missingSignalTables = Boolean(options.missingSignalTables);
    this.signalProbeCount = 0;
  }

  prepare(sql) {
    if (/SELECT id FROM signal_(sources|collection_runs|candidates) LIMIT 1/i.test(sql)) {
      this.signalProbeCount += 1;
    }
    return new MockStatement(this, sql);
  }
}

const migrationSource = read('migrations/0019_signal_automation.sql');
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS signal_sources/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS signal_collection_runs/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS signal_candidates/);
assert.match(migrationSource, /UNIQUE \(source_id, canonical_url\)/);
assert.match(migrationSource, /https:\/\/www\.federalreserve\.gov\/feeds\/press_all\.xml/);
assert.match(migrationSource, /https:\/\/github\.blog\/changelog\/feed\//);

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'signal-automation-phase1-'));
const sqlitePath = join(sqliteDirectory, 'signal.sqlite');
const runSqlite = (input) => spawnSync('sqlite3', [sqlitePath], { encoding: 'utf8', input });
try {
  const migrationResult = runSqlite(migrationSource);
  assert.equal(
    migrationResult.status,
    0,
    `sqlite3 must apply 0019_signal_automation.sql: ${migrationResult.error?.message || migrationResult.stderr}`
  );

  const schemaResult = runSqlite(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('signal_sources', 'signal_collection_runs', 'signal_candidates'))
      || '|' || (SELECT COUNT(*) FROM signal_sources)
      || '|' || (SELECT COUNT(*) FROM signal_sources WHERE is_enabled = 1);
  `);
  assert.equal(schemaResult.status, 0, schemaResult.stderr);
  assert.equal(schemaResult.stdout.trim(), '3|8|5');

  const constraintResult = runSqlite(`
    INSERT INTO signal_sources (id, name, source_type, endpoint_url)
    VALUES ('invalid-source', 'Invalid source', 'ftp', 'https://invalid.example/feed');
  `);
  assert.notEqual(constraintResult.status, 0);
  assert.match(constraintResult.stderr, /CHECK constraint failed/i);
} finally {
  rmSync(sqliteDirectory, { force: true, recursive: true });
}

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /id="signal-source-form" novalidate/);
assert.match(adminSource, /id="signal-sources-list"/);
assert.match(adminSource, /\/admin\/api\/signal\/sources/);
assert.match(adminSource, /候选内容需要人工审核，不会自动发布/);
assert.match(adminSource, /读取失败：\$\{error\.message\}/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /handleAdminListSignalSources/);
assert.match(workerSource, /handleAdminSaveSignalSource/);
assert.match(workerSource, /handleAdminListSignalCollectionRuns/);
assert.match(workerSource, /handleAdminListSignalCandidates/);
assert.match(workerSource, /SIGNAL_SOURCE_URL_INVALID/);
assert.match(workerSource, /This gate runs before every \/admin\//);

const protectedAdminEnv = {
  ADMIN_ALLOWED_EMAILS: 'admin@example.com',
  CF_ACCESS_AUD: 'test-audience',
  CF_ACCESS_TEAM_DOMAIN: 'stationcat.cloudflareaccess.com'
};
for (const method of ['GET', 'POST']) {
  const protectedResponse = await worker.fetch(
    new Request('https://wwwstationcat.org/admin/api/signal/sources', { method }),
    protectedAdminEnv,
    {}
  );
  assert.equal(protectedResponse.status, 401, `${method} Signal source route must require Cloudflare Access`);
}

assert.throws(
  () =>
    hooks.normalizeSignalAutomationSourcePayload({
      category: 'tech',
      endpointUrl: 'javascript:alert(1)',
      name: 'Blocked source',
      sourceType: 'rss',
      trustTier: 'primary'
    }),
  (error) => error.code === 'SIGNAL_SOURCE_URL_INVALID'
);

for (const endpointUrl of [
  'http://localhost/feed',
  'http://metadata.internal/feed',
  'http://10.0.0.8/feed',
  'http://100.64.0.1/feed',
  'http://127.0.0.1/feed',
  'http://127.1/feed',
  'http://2130706433/feed',
  'http://169.254.169.254/latest/meta-data',
  'http://172.16.0.8/feed',
  'http://192.168.1.8/feed',
  'http://[::1]/feed',
  'http://[::ffff:127.0.0.1]/feed',
  'https://reader:secret@example.com/feed'
]) {
  assert.throws(
    () =>
      hooks.normalizeSignalAutomationSourcePayload({
        category: 'tech',
        endpointUrl,
        name: 'Blocked source',
        sourceType: 'rss',
        trustTier: 'primary'
      }),
    (error) => error.code === 'SIGNAL_SOURCE_URL_INVALID',
    `${endpointUrl} must be blocked before it can become a fetch target`
  );
}

const normalized = hooks.normalizeSignalAutomationSourcePayload({
  category: 'tech',
  endpointUrl: 'https://example.com/feed.xml#latest',
  fetchIntervalMinutes: 120,
  homepageUrl: 'https://example.com/',
  isEnabled: true,
  language: 'en',
  maxItemsPerRun: 25,
  name: 'Example feed',
  sourceType: 'rss',
  trustTier: 'primary'
});
assert.equal(normalized.endpointUrl, 'https://example.com/feed.xml');
assert.equal(normalized.fetchIntervalMinutes, 120);
assert.equal(JSON.parse(normalized.configJson).adapter, 'rss');

assert.throws(
  () =>
    hooks.normalizeSignalAutomationSourcePayload({
      category: 'tech',
      endpointUrl: 'https://example.com/feed.xml',
      isEnabled: 'false',
      name: 'Invalid boolean source',
      sourceType: 'rss',
      trustTier: 'primary'
    }),
  (error) => error.code === 'SIGNAL_SOURCE_ENABLED_INVALID'
);

const missingResponse = await hooks.handleAdminListSignalSources({
  WAITLIST_DB: new MockDb({ missingSignalTables: true })
});
assert.equal(missingResponse.status, 200);
const missingPayload = await missingResponse.json();
assert.equal(missingPayload.setupRequired, true);
assert.equal(missingPayload.migration, '0019_signal_automation.sql');

const missingAuditDb = new MockDb({ missingAuditTable: true });
const missingAuditResponse = await hooks.handleAdminSaveSignalSource(
  new Request('http://localhost/admin/api/signal/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'toggle', id: 'source-id', isEnabled: false })
  }),
  { WAITLIST_DB: missingAuditDb }
);
assert.equal(missingAuditResponse.status, 503);
assert.equal((await missingAuditResponse.json()).code, 'ADMIN_AUDIT_NOT_READY');
assert.equal(missingAuditDb.sources.size, 0);

const db = new MockDb();
const createResponse = await hooks.handleAdminSaveSignalSource(
  new Request('http://localhost/admin/api/signal/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'save',
      category: 'tech',
      endpointUrl: 'https://example.com/feed.xml',
      fetchIntervalMinutes: 180,
      homepageUrl: 'https://example.com/',
      isEnabled: true,
      language: 'en',
      maxItemsPerRun: 20,
      name: 'Example technology feed',
      publisher: 'Example',
      requiresApiKey: false,
      sourceType: 'rss',
      trustTier: 'primary'
    })
  }),
  { WAITLIST_DB: db }
);
assert.equal(createResponse.status, 200);
const createPayload = await createResponse.json();
assert.equal(createPayload.source.isEnabled, true);
assert.equal(createPayload.source.health, 'not_checked');
assert.equal(createPayload.source.config.adapter, 'rss');
assert.equal(db.auditLogs[0].action, 'signal_source_create');

const listResponse = await hooks.handleAdminListSignalSources({ WAITLIST_DB: db });
const listPayload = await listResponse.json();
assert.equal(listPayload.sources.length, 1);
assert.equal(listPayload.summary.enabled, 1);

const invalidToggleResponse = await hooks.handleAdminSaveSignalSource(
  new Request('http://localhost/admin/api/signal/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'toggle', id: createPayload.source.id, isEnabled: 'false' })
  }),
  { WAITLIST_DB: db }
);
assert.equal(invalidToggleResponse.status, 400);
assert.equal((await invalidToggleResponse.json()).code, 'SIGNAL_SOURCE_ENABLED_INVALID');

const toggleResponse = await hooks.handleAdminSaveSignalSource(
  new Request('http://localhost/admin/api/signal/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'toggle', id: createPayload.source.id, isEnabled: false })
  }),
  { WAITLIST_DB: db }
);
assert.equal(toggleResponse.status, 200);
const togglePayload = await toggleResponse.json();
assert.equal(togglePayload.source.isEnabled, false);
assert.equal(togglePayload.source.health, 'paused');
assert.equal(db.auditLogs[1].action, 'signal_source_pause');

const runsResponse = await hooks.handleAdminListSignalCollectionRuns(
  new Request('http://localhost/admin/api/signal/runs?limit=20'),
  { WAITLIST_DB: db }
);
assert.deepEqual((await runsResponse.json()).runs, []);

const candidatesResponse = await hooks.handleAdminListSignalCandidates(
  new Request('http://localhost/admin/api/signal/candidates?limit=30'),
  { WAITLIST_DB: db }
);
assert.deepEqual((await candidatesResponse.json()).candidates, []);
assert.equal(db.signalProbeCount, 3, 'successful table readiness checks should be cached per D1 binding');

console.log('Signal automation phase 1 migration, source management, and queue API checks passed.');
