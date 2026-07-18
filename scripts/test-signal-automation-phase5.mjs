import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const automation = {
  candidateIds: ['candidate-ai', 'candidate-economy', 'candidate-tech'],
  generatedAt: '2026-07-18T05:00:00.000Z',
  model: '@cf/test/signal-model',
  promptVersion: 2,
  sourceEntryId: 41
};

const draftEntry = () => ({
  access_level: 'free',
  archived_at: null,
  author_name: 'Station Cat',
  body_format: 'markdown',
  chapter_number: null,
  cover_alt: '',
  cover_r2_key: '',
  created_at: '2026-07-18 05:00:00',
  created_by: 'local-admin',
  description: 'Today focuses on AI, the economy, and developer tools.',
  entry_type: 'signal_brief',
  excerpt: 'Today focuses on AI, the economy, and developer tools.',
  featured: 0,
  html_r2_key: 'content/signal/2026/07/daily-brief-2026-07-18.html',
  id: 41,
  import_r2_key: '',
  locale: 'zh-Hant',
  markdown_r2_key: 'content/signal/2026/07/daily-brief-2026-07-18.md',
  metadata_json: JSON.stringify({
    automation,
    briefDate: '2026-07-18',
    category: 'ai',
    sources: [{ label: 'OpenAI', note: 'Model update', url: 'https://openai.com/news/model-update' }],
    summaryBullets: ['OpenAI model update', 'Federal Reserve policy update', 'GitHub workflow update']
  }),
  parent_slug: '',
  pricing_json: '{}',
  published_at: null,
  reading_minutes: 1,
  scheduled_at: null,
  seo_json: '{}',
  slug: 'daily-brief-2026-07-18',
  sort_order: 0,
  source_kind: 'signal_automation',
  source_ref: 'signal-draft-test',
  status: 'draft',
  subtitle: 'AI',
  tags_json: JSON.stringify(['Signal strip', 'AI']),
  title: 'Server-owned Signal draft',
  updated_at: '2026-07-18 05:10:00',
  updated_by: 'local-admin',
  visibility: 'public',
  volume_title: '',
  word_count: 420
});

class ReviewStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    this.db.boundParams.push(params);
    return new ReviewStatement(this.db, this.sql, params);
  }

  async first() {
    this.db.sql.push(this.sql);
    if (/SELECT \* FROM content_entries[\s\S]+WHERE id = \?/i.test(this.sql)) return this.db.entry;
    if (/SELECT COUNT\(\*\) AS total[\s\S]+source_kind = 'signal_automation'/i.test(this.sql)) {
      return {
        archived_count: this.db.entry?.status === 'archived' ? 1 : 0,
        draft_count: this.db.entry?.status === 'draft' ? 1 : 0,
        published_count: this.db.entry?.status === 'published' ? 1 : 0,
        scheduled_count: 0,
        total: this.db.entry ? 1 : 0
      };
    }
    if (/SELECT COUNT\(\*\) AS total/i.test(this.sql)) {
      return {
        average_score: null,
        merged_duplicate_count: 0,
        new_count: 0,
        rejected_count: 0,
        shortlisted_count: 0,
        total: 0,
        used_count: 0
      };
    }
    return null;
  }

  async all() {
    this.db.sql.push(this.sql);
    if (/SELECT \*[\s\S]+FROM content_entries[\s\S]+source_kind = 'signal_automation'/i.test(this.sql)) {
      const requestedStatus = this.params.length > 1 ? this.params[0] : '';
      return { results: this.db.entry && (!requestedStatus || this.db.entry.status === requestedStatus) ? [this.db.entry] : [] };
    }
    return { results: [] };
  }

  async run() {
    this.db.sql.push(this.sql);
    if (/UPDATE content_entries[\s\S]+status = 'archived'/i.test(this.sql)) {
      if (!this.db.entry || this.db.entry.status !== 'draft') return { meta: { changes: 0 }, success: true };
      this.db.entry.status = 'archived';
      this.db.entry.archived_at = this.params[0];
      this.db.entry.updated_by = this.params[1];
      this.db.entry.updated_at = this.params[2];
      return { meta: { changes: 1 }, success: true };
    }
    if (/INSERT INTO content_revisions/i.test(this.sql)) {
      if (this.db.entry?.status !== 'archived' || this.db.entry.archived_at !== this.params[3]) {
        return { meta: { changes: 0 }, success: true };
      }
      this.db.revisions.push({ createdBy: this.params[1], status: 'archived', summary: this.params[0] });
      return { meta: { changes: 1 }, success: true };
    }
    if (/INSERT INTO admin_audit_logs/i.test(this.sql)) {
      if (this.db.entry?.status !== 'archived' || this.db.entry.archived_at !== this.params[3]) {
        return { meta: { changes: 0 }, success: true };
      }
      this.db.auditActions.push('signal_brief_draft_archive');
      return { meta: { changes: 1 }, success: true };
    }
    return { meta: { changes: 0 }, success: true };
  }
}

class ReviewDb {
  constructor(entry = draftEntry()) {
    this.auditActions = [];
    this.boundParams = [];
    this.candidateStatuses = new Map(automation.candidateIds.map((id) => [id, 'shortlisted']));
    this.entry = entry;
    this.revisions = [];
    this.sql = [];
  }

  prepare(sql) {
    return new ReviewStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const listDb = new ReviewDb();
const listResponse = await hooks.handleAdminListSignalBriefDrafts(
  new Request('http://localhost/admin/api/signal/drafts?status=draft'),
  { WAITLIST_DB: listDb }
);
assert.equal(listResponse.status, 200);
const listPayload = await listResponse.json();
assert.equal(listPayload.drafts.length, 1);
assert.equal(listPayload.drafts[0].title, 'Server-owned Signal draft');
assert.deepEqual(listPayload.drafts[0].automation.candidateIds, automation.candidateIds);
assert.equal(listPayload.summary.draft, 1);

const archiveDb = new ReviewDb();
const archiveResponse = await hooks.handleAdminManageSignalBriefDraft(
  new Request('http://localhost/admin/api/signal/drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'archive', entryId: 41 })
  }),
  { WAITLIST_DB: archiveDb }
);
assert.equal(archiveResponse.status, 200);
const archivePayload = await archiveResponse.json();
assert.equal(archivePayload.candidateStatusesChanged, false);
assert.equal(archiveDb.entry.status, 'archived');
assert.equal(archiveDb.revisions.length, 1);
assert.match(archiveDb.revisions[0].summary, /归档/);
assert.deepEqual(archiveDb.auditActions, ['signal_brief_draft_archive']);
assert.deepEqual([...archiveDb.candidateStatuses.values()], ['shortlisted', 'shortlisted', 'shortlisted']);

const archivedAgainResponse = await hooks.handleAdminManageSignalBriefDraft(
  new Request('http://localhost/admin/api/signal/drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'archive', entryId: 41 })
  }),
  { WAITLIST_DB: archiveDb }
);
assert.equal(archivedAgainResponse.status, 409);
assert.equal((await archivedAgainResponse.json()).code, 'SIGNAL_DRAFT_STATUS_CONFLICT');

const approvalPayload = hooks.buildSignalDraftApprovalPayload(
  draftEntry(),
  '# Reviewed body\n\nThe editor-approved Markdown.',
  automation,
  { allowCandidateExclusions: true }
);
assert.equal(approvalPayload.title, 'Server-owned Signal draft');
assert.equal(approvalPayload.slug, 'daily-brief-2026-07-18');
assert.equal(approvalPayload.status, 'published');
assert.equal(approvalPayload.approvalEntryId, 41);
assert.equal(approvalPayload.allowCandidateExclusions, true);
assert.deepEqual(approvalPayload.automation.candidateIds, automation.candidateIds);
assert.equal(approvalPayload.markdown, '# Reviewed body\n\nThe editor-approved Markdown.');

const missingBucketResponse = await hooks.handleAdminManageSignalBriefDraft(
  new Request('http://localhost/admin/api/signal/drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve', entryId: 41, title: 'Forged browser title' })
  }),
  { WAITLIST_DB: new ReviewDb() }
);
assert.equal(missingBucketResponse.status, 503);
assert.equal((await missingBucketResponse.json()).code, 'CONTENT_BUCKET_NOT_CONFIGURED');

const unauthorizedDirectResponse = await hooks.handleAdminListSignalBriefDrafts(
  new Request('https://wwwstationcat.org/admin/api/signal/drafts'),
  { WAITLIST_DB: new ReviewDb() }
);
assert.equal(unauthorizedDirectResponse.status, 401);

const protectedEnv = {
  ADMIN_ALLOWED_EMAILS: 'admin@example.com',
  CF_ACCESS_AUD: 'test-audience',
  CF_ACCESS_TEAM_DOMAIN: 'stationcat.cloudflareaccess.com'
};
for (const method of ['GET', 'POST']) {
  const response = await worker.fetch(
    new Request('https://wwwstationcat.org/admin/api/signal/drafts', { method }),
    protectedEnv,
    {}
  );
  assert.equal(response.status, 401, `${method} Signal draft route must require Cloudflare Access`);
}

const candidateWindowDb = new ReviewDb(null);
const candidateWindowResponse = await hooks.handleAdminListSignalCandidates(
  new Request('http://localhost/admin/api/signal/candidates?sinceHours=24&limit=50'),
  { WAITLIST_DB: candidateWindowDb }
);
assert.equal(candidateWindowResponse.status, 200);
assert.equal((await candidateWindowResponse.json()).windowHours, 24);
assert.ok(candidateWindowDb.boundParams.some((params) => params.includes('-24 hours')));

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /<h3 id="signal-candidates-title">今日候选<\/h3>/);
assert.match(adminSource, /id="signal-candidate-window"/);
assert.match(adminSource, /<h3 id="signal-drafts-title">简报草稿<\/h3>/);
assert.match(adminSource, /批准发布/);
assert.match(adminSource, /action: 'archive'/);
assert.match(adminSource, /action: 'approve'/);
assert.match(adminSource, /系统会归档并保留修订记录/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /url\.pathname === '\/admin\/api\/signal\/drafts'/);
assert.match(workerSource, /signal_brief_draft_archive/);
assert.match(workerSource, /approvalEntryId/);
assert.match(workerSource, /buildSignalDraftApprovalPayload/);
assert.match(workerSource, /datetime\(COALESCE\(candidate\.published_at, candidate\.created_at\)\)/);

console.log('Signal automation phase 5 review, archive, approval payload, auth, and candidate-window checks passed.');
