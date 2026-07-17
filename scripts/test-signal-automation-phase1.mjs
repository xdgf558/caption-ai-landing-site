import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

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
    this.missingSignalTables = Boolean(options.missingSignalTables);
  }

  prepare(sql) {
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

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /id="signal-source-form" novalidate/);
assert.match(adminSource, /id="signal-sources-list"/);
assert.match(adminSource, /\/admin\/api\/signal\/sources/);
assert.match(adminSource, /第一阶段不会自动抓取或发布/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /handleAdminListSignalSources/);
assert.match(workerSource, /handleAdminSaveSignalSource/);
assert.match(workerSource, /handleAdminListSignalCollectionRuns/);
assert.match(workerSource, /handleAdminListSignalCandidates/);
assert.match(workerSource, /SIGNAL_SOURCE_URL_INVALID/);

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

const missingResponse = await hooks.handleAdminListSignalSources({
  WAITLIST_DB: new MockDb({ missingSignalTables: true })
});
assert.equal(missingResponse.status, 200);
const missingPayload = await missingResponse.json();
assert.equal(missingPayload.setupRequired, true);
assert.equal(missingPayload.migration, '0019_signal_automation.sql');

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
assert.equal(db.auditLogs[0].action, 'signal_source_create');

const listResponse = await hooks.handleAdminListSignalSources({ WAITLIST_DB: db });
const listPayload = await listResponse.json();
assert.equal(listPayload.sources.length, 1);
assert.equal(listPayload.summary.enabled, 1);

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

console.log('Signal automation phase 1 migration, source management, and queue API checks passed.');
