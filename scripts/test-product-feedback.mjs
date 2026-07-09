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
    if (/SELECT id FROM product_feedback LIMIT 1/i.test(this.sql)) {
      if (this.db.missingTable) throw new Error('D1_ERROR: no such table: product_feedback');
      return null;
    }
    if (/SELECT COUNT\(\*\) AS count\s+FROM product_feedback/i.test(this.sql)) {
      return { count: this.db.recentCount };
    }
    if (/SELECT \* FROM product_feedback WHERE id = \?/i.test(this.sql)) {
      return this.db.feedback.get(this.params[0]) || null;
    }
    return null;
  }

  async all() {
    if (/FROM product_feedback/i.test(this.sql)) {
      return { results: [...this.db.feedback.values()] };
    }
    return { results: [] };
  }

  async run() {
    if (/INSERT INTO product_feedback/i.test(this.sql)) {
      const row = {
        id: this.params[0],
        product: this.params[1],
        platform: this.params[2],
        app_version: this.params[3],
        issue_type: this.params[4],
        impact: this.params[5],
        summary: this.params[6],
        details: this.params[7],
        reproduction_steps: this.params[8],
        environment: this.params[9],
        contact_email: this.params[10],
        status: 'new',
        admin_note: '',
        source_path: this.params[11],
        locale: this.params[12],
        metadata_json: this.params[13],
        ip_hash: this.params[14],
        user_agent_hash: this.params[15],
        updated_by: '',
        resolved_at: '',
        created_at: '2026-07-10 10:00:00',
        updated_at: '2026-07-10 10:00:00'
      };
      this.db.feedback.set(row.id, row);
      return { success: true, meta: { changes: 1 } };
    }
    if (/UPDATE product_feedback/i.test(this.sql)) {
      const row = this.db.feedback.get(this.params[5]);
      if (row) {
        row.status = this.params[0];
        row.admin_note = this.params[1];
        row.updated_by = this.params[2];
        row.resolved_at = row.status === 'resolved' ? '2026-07-10 11:00:00' : '';
        row.updated_at = '2026-07-10 11:00:00';
      }
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
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
}

class MockDb {
  constructor(options = {}) {
    this.auditLogs = [];
    this.feedback = new Map();
    this.missingTable = Boolean(options.missingTable);
    this.recentCount = Number(options.recentCount || 0);
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }
}

const migrationSource = read('migrations/0018_product_feedback.sql');
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS product_feedback/);
assert.match(migrationSource, /status TEXT NOT NULL DEFAULT 'new'/);
assert.match(migrationSource, /idx_product_feedback_product_status_created/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /handleProductFeedbackSubmit/);
assert.match(workerSource, /handleAdminListProductFeedback/);
assert.match(workerSource, /handleAdminUpdateProductFeedback/);
assert.match(workerSource, /PRODUCT_FEEDBACK_RATE_LIMITED/);

const productSource = read('src/components/PrivatePinyinLanding.astro');
assert.match(productSource, /data-product-feedback-form/);
assert.match(productSource, /\/api\/product-feedback/);
assert.match(productSource, /提交 Bug 回饋/);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /data-admin-v2-tab="feedback"/);
assert.match(adminSource, /\/admin\/api\/product-feedback\/update/);
assert.match(adminSource, /产品 Bug 反馈/);

const missingResponse = await hooks.handleProductFeedbackSubmit(
  new Request('https://wwwstationcat.org/api/product-feedback', {
    method: 'POST',
    body: JSON.stringify({})
  }),
  { WAITLIST_DB: new MockDb({ missingTable: true }) }
);
assert.equal(missingResponse.status, 503);
assert.equal((await missingResponse.json()).code, 'PRODUCT_FEEDBACK_NOT_READY');

const invalidResponse = await hooks.handleProductFeedbackSubmit(
  new Request('https://wwwstationcat.org/api/product-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appVersion: '0.1.12',
      details: 'The input method does not appear after installation.',
      impact: 'normal',
      issueType: 'install',
      platform: 'linux',
      product: 'privatepinyin',
      summary: 'Missing input method'
    })
  }),
  { WAITLIST_DB: new MockDb() }
);
assert.equal(invalidResponse.status, 400);
assert.equal((await invalidResponse.json()).code, 'INVALID_PLATFORM');

const limitedResponse = await hooks.handleProductFeedbackSubmit(
  new Request('https://wwwstationcat.org/api/product-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appVersion: '0.1.12',
      details: 'The input method does not appear after installation.',
      impact: 'normal',
      issueType: 'install',
      platform: 'windows',
      product: 'privatepinyin',
      summary: 'Missing input method'
    })
  }),
  { WAITLIST_DB: new MockDb({ recentCount: 5 }) }
);
assert.equal(limitedResponse.status, 429);
assert.equal((await limitedResponse.json()).code, 'PRODUCT_FEEDBACK_RATE_LIMITED');

const db = new MockDb();
const submitResponse = await hooks.handleProductFeedbackSubmit(
  new Request('https://wwwstationcat.org/api/product-feedback', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '203.0.113.7',
      'content-type': 'application/json',
      'user-agent': 'Product Feedback Test'
    },
    body: JSON.stringify({
      appVersion: '0.1.12',
      contactEmail: 'reader@example.com',
      details: 'After installation, Windows does not show the input method in the language list.',
      environment: 'Windows 11 24H2',
      impact: 'blocking',
      issueType: 'install',
      locale: 'zh-Hant',
      platform: 'windows',
      product: 'privatepinyin',
      reproductionSteps: 'Install the EXE and open Language settings.',
      sourcePath: '/zh-hant/apps/privatepinyin/',
      summary: 'Windows input method is missing'
    })
  }),
  { WAITLIST_DB: db }
);
assert.equal(submitResponse.status, 200);
const submitPayload = await submitResponse.json();
assert.equal(submitPayload.ok, true);
assert.equal(submitPayload.feedback.status, 'new');
assert.equal(db.feedback.size, 1);

const listResponse = await hooks.handleAdminListProductFeedback(
  new Request('http://localhost/admin/api/product-feedback?product=privatepinyin&status=new'),
  { WAITLIST_DB: db }
);
assert.equal(listResponse.status, 200);
const listPayload = await listResponse.json();
assert.equal(listPayload.feedback.length, 1);
assert.equal(listPayload.feedback[0].details.includes('Windows'), true);

const updateResponse = await hooks.handleAdminUpdateProductFeedback(
  new Request('http://localhost/admin/api/product-feedback/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      adminNote: 'Reproduced and fixed for the next internal build.',
      id: submitPayload.feedback.id,
      status: 'resolved'
    })
  }),
  { WAITLIST_DB: db }
);
assert.equal(updateResponse.status, 200);
const updatePayload = await updateResponse.json();
assert.equal(updatePayload.feedback.status, 'resolved');
assert.equal(updatePayload.feedback.updatedBy, 'local-admin');
assert.equal(db.auditLogs.length, 1);

console.log('Product feedback tests passed.');
