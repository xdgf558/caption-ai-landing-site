import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as workerHooks } from '../src/worker.js';
import {
  deriveSignalDraftCategory,
  generateSignalBriefDraft,
  normalizeSignalDraftCandidateIds
} from '../src/signalDraft.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const candidates = [
  {
    canonical_url: 'https://openai.com/news/model-update',
    category: 'ai',
    id: 'candidate-ai',
    published_at: '2026-07-18T01:00:00.000Z',
    source_id: 'openai-news',
    source_name: 'OpenAI News',
    source_publisher: 'OpenAI',
    status: 'shortlisted',
    summary: 'OpenAI published a model update with API and safety details.',
    title: 'OpenAI publishes a model and API update'
  },
  {
    canonical_url: 'https://www.federalreserve.gov/newsevents/pressreleases/test.htm',
    category: 'economy',
    id: 'candidate-economy',
    published_at: '2026-07-18T02:00:00.000Z',
    source_id: 'federal-reserve',
    source_name: 'Federal Reserve',
    source_publisher: 'Federal Reserve',
    status: 'shortlisted',
    summary: 'The Federal Reserve published an official economic policy update.',
    title: 'Federal Reserve publishes policy update'
  },
  {
    canonical_url: 'https://github.blog/changelog/test/',
    category: 'tech',
    id: 'candidate-tech',
    published_at: '2026-07-18T03:00:00.000Z',
    source_id: 'github-changelog',
    source_name: 'GitHub Changelog',
    source_publisher: 'GitHub',
    status: 'shortlisted',
    summary: 'GitHub released a developer workflow update.',
    title: 'GitHub updates developer workflows'
  }
];

const aiPayloadFor = (items = candidates) => ({
  category: 'ai',
  description: '今天关注模型、经济政策和开发工具的三条信号。',
  items: items.map((candidate, index) => ({
    candidateId: candidate.id,
    headline: `${index + 1}. ${candidate.title}`,
    noise: '仍需结合后续一手数据，不能过度外推。',
    signal: '这项变化可能影响开发者、市场预期或产品路线。',
    summary: candidate.summary
  })),
  title: '每日信号简报'
});

assert.deepEqual(normalizeSignalDraftCandidateIds(candidates.map((candidate) => candidate.id)), candidates.map((candidate) => candidate.id));
assert.throws(
  () => normalizeSignalDraftCandidateIds(['one', 'two']),
  (error) => error.code === 'SIGNAL_DRAFT_CANDIDATE_COUNT_INVALID'
);
assert.throws(
  () => normalizeSignalDraftCandidateIds(Array.from({ length: 11 }, (_, index) => `candidate-${index}`)),
  (error) => error.code === 'SIGNAL_DRAFT_CANDIDATE_COUNT_INVALID'
);
assert.equal(deriveSignalDraftCategory(candidates), 'ai');

const aiCalls = [];
const ai = {
  async run(model, request) {
    aiCalls.push({ model, request });
    return { response: aiPayloadFor() };
  }
};
const generated = await generateSignalBriefDraft(ai, '@cf/test/draft-model', candidates, {
  briefDate: '2026-07-18',
  category: 'auto'
});
assert.equal(generated.items.length, 3);
assert.equal(generated.category, 'ai');
assert.match(generated.markdown, /1\. OpenAI publishes a model and API update/);
assert.match(generated.markdown, /信号：/);
assert.match(generated.markdown, /噪音：/);
assert.equal(aiCalls[0].request.response_format.type, 'json_schema');
assert.equal(aiCalls[0].request.response_format.json_schema.properties.items.minItems, 3);
assert.match(aiCalls[0].request.messages[0].content, /untrusted reference material/);
assert.match(aiCalls[0].request.messages[1].content, /not permission to publish/i);

await assert.rejects(
  generateSignalBriefDraft(
    { run: async () => ({ response: aiPayloadFor([candidates[0], candidates[0], candidates[2]]) }) },
    '@cf/test/draft-model',
    candidates,
    { briefDate: '2026-07-18', category: 'auto' }
  ),
  (error) => error.code === 'SIGNAL_DRAFT_AI_OUTPUT_INVALID'
);

class DraftStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new DraftStatement(this.db, this.sql, params);
  }

  async first() {
    this.db.sql.push(this.sql);
    if (/SELECT \*\s+FROM content_entries[\s\S]+slug = \?/i.test(this.sql)) return null;
    if (/INSERT INTO content_entries/i.test(this.sql)) {
      const values = this.params;
      const row = {
        access_level: values[10],
        archived_at: null,
        author_name: values[11],
        body_format: values[20],
        chapter_number: values[14],
        cover_alt: values[25],
        cover_r2_key: values[24],
        created_at: '2026-07-18 04:00:00',
        created_by: values[32],
        description: values[6],
        entry_type: values[0],
        excerpt: values[7],
        featured: values[12],
        html_r2_key: values[22],
        id: 41,
        import_r2_key: values[23],
        locale: values[1],
        markdown_r2_key: values[21],
        metadata_json: values[18],
        parent_slug: values[3],
        pricing_json: values[19],
        published_at: values[31],
        reading_minutes: values[27],
        scheduled_at: values[30],
        seo_json: values[17],
        slug: values[2],
        sort_order: values[13],
        source_kind: values[28],
        source_ref: values[29],
        status: values[8],
        subtitle: values[5],
        tags_json: values[16],
        title: values[4],
        updated_at: '2026-07-18 04:00:00',
        updated_by: values[33],
        visibility: values[9],
        volume_title: values[15],
        word_count: values[26]
      };
      this.db.savedEntry = row;
      return row;
    }
    if (/SELECT COALESCE\(MAX\(revision_number\)/i.test(this.sql)) return { revision_number: 1 };
    return null;
  }

  async all() {
    this.db.sql.push(this.sql);
    if (/SELECT candidate\.\*, source\.name AS source_name/i.test(this.sql)) {
      return {
        results: this.params.map((id) => this.db.candidates.get(id)).filter(Boolean)
      };
    }
    return { results: [] };
  }

  async run() {
    this.db.sql.push(this.sql);
    if (/INSERT INTO admin_audit_logs/i.test(this.sql)) this.db.auditActions.push(this.params[1]);
    return { meta: { changes: 1 }, success: true };
  }
}

class DraftDb {
  constructor(rows = candidates) {
    this.auditActions = [];
    this.candidates = new Map(rows.map((candidate) => [candidate.id, { ...candidate }]));
    this.savedEntry = null;
    this.sql = [];
  }

  prepare(sql) {
    return new DraftStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const bucketWrites = [];
const draftDb = new DraftDb();
const handlerResponse = await workerHooks.handleAdminGenerateSignalBriefDraft(
  new Request('http://localhost/admin/api/signal/drafts/generate', {
    body: JSON.stringify({
      briefDate: '2026-07-18',
      candidateIds: candidates.map((candidate) => candidate.id),
      category: 'auto'
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  {
    AI: { run: async () => ({ response: aiPayloadFor() }) },
    CONTENT_BUCKET: {
      async put(key, value) {
        bucketWrites.push({ key, value: String(value) });
      }
    },
    WAITLIST_DB: draftDb
  }
);
assert.equal(handlerResponse.status, 200);
const handlerPayload = await handlerResponse.json();
assert.equal(handlerPayload.entry.status, 'draft');
assert.equal(handlerPayload.entry.sourceKind, 'signal_automation');
assert.equal(handlerPayload.candidateStatusesChanged, false);
assert.deepEqual(handlerPayload.automation.candidateIds, candidates.map((candidate) => candidate.id));
assert.equal(handlerPayload.automation.sourceEntryId, 41);
assert.equal(bucketWrites.length, 2);
assert.deepEqual([...draftDb.candidates.values()].map((candidate) => candidate.status), [
  'shortlisted',
  'shortlisted',
  'shortlisted'
]);
assert.equal(draftDb.sql.some((sql) => /UPDATE signal_candidates/i.test(sql)), false);
assert.ok(draftDb.auditActions.includes('signal_brief_draft_generate'));

const invalidStatusDb = new DraftDb([
  candidates[0],
  { ...candidates[1], status: 'new' },
  candidates[2]
]);
const invalidStatusResponse = await workerHooks.handleAdminGenerateSignalBriefDraft(
  new Request('http://localhost/admin/api/signal/drafts/generate', {
    body: JSON.stringify({
      briefDate: '2026-07-18',
      candidateIds: candidates.map((candidate) => candidate.id),
      category: 'auto'
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  { WAITLIST_DB: invalidStatusDb }
);
assert.equal(invalidStatusResponse.status, 409);
assert.equal((await invalidStatusResponse.json()).code, 'SIGNAL_DRAFT_CANDIDATE_NOT_SHORTLISTED');

const protectedResponse = await worker.fetch(
  new Request('https://wwwstationcat.org/admin/api/signal/drafts/generate', { method: 'POST' }),
  {
    ADMIN_ALLOWED_EMAILS: 'admin@example.com',
    CF_ACCESS_AUD: 'test-audience',
    CF_ACCESS_TEAM_DOMAIN: 'stationcat.cloudflareaccess.com'
  },
  {}
);
assert.equal(protectedResponse.status, 401);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /选择 3–10 条已入选候选/);
assert.match(adminSource, /\/admin\/api\/signal\/drafts\/generate/);
assert.match(adminSource, /elements\.signal\.status\.value = 'draft'/);
assert.match(adminSource, /automation: state\.signalDraftAutomation/);
assert.match(adminSource, /草稿已保存到内容平台，尚未公开/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /status: 'draft'/);
assert.match(workerSource, /defaultSignalBriefDraftModel = '@cf\/meta\/llama-3\.1-8b-instruct-fast'/);
assert.match(workerSource, /candidateStatusesChanged: false/);
assert.match(workerSource, /WHERE id = \? AND status = 'shortlisted'/);
assert.match(workerSource, /candidateUsageConflictIds/);

console.log('Signal automation phase 4 draft generation, storage, auth, and publication-gate checks passed.');
