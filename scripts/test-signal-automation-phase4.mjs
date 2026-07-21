import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as workerHooks } from '../src/worker.js';
import {
  deriveSignalDraftCategory,
  generateSignalBriefDraft,
  getSignalDraftMaxTokens,
  normalizeSignalDraftCandidateIds,
  signalDraftOutputLocale
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
  description: '今天關注模型、經濟政策和開發工具的三條重要信號。',
  items: items.map((candidate, index) => ({
    candidateId: candidate.id,
    headline: `${index + 1}. 第 ${index + 1} 條資訊已完成繁體中文整理`,
    noise: '仍需結合後續一手資料，不能過度推論。',
    signal: '這項變化可能影響開發者、市場預期或產品路線。',
    summary: `這條候選資訊已翻譯並保留原始事實，來源是 ${candidate.source_name || '官方來源'}。`
  })),
  title: '每日信號簡報'
});

const englishPayloadFor = (items = candidates) => ({
  category: 'ai',
  description: 'Today covers models, economic policy, and developer tools.',
  items: items.map((candidate, index) => ({
    candidateId: candidate.id,
    headline: `${index + 1}. ${candidate.title}`,
    noise: 'More first-party data is needed before drawing broad conclusions.',
    signal: 'This may affect developers, market expectations, or product roadmaps.',
    summary: candidate.summary
  })),
  title: 'Daily Signal Brief'
});

const mixedEnglishPayloadFor = (items = candidates) => ({
  ...aiPayloadFor(items),
  items: items.map((candidate, index) => ({
    candidateId: candidate.id,
    headline: `${index + 1}. OpenAI 推出 new reasoning model with expanded API safety report`,
    noise: '仍需 wait for more first-party data before drawing broad conclusions',
    signal: '這項 update may affect developers and future product roadmaps',
    summary: '這則 report explains the new model architecture and API rollout schedule in detail'
  }))
});

const simplifiedPayloadFor = (items = candidates) => ({
  category: 'ai',
  description: '今天关注模型、经济政策和开发工具的三条重要信号。',
  items: items.map((candidate, index) => ({
    candidateId: candidate.id,
    headline: `${index + 1}. 发布新的模型与接口安全报告`,
    noise: '仍需结合后续一手数据，不能过度推断。',
    signal: '这项变化可能影响开发者、市场预期或产品路线。',
    summary: '这条候选资讯已经整理，并保留原始事实和来源。'
  })),
  title: '每日信号简报'
});

const duplicatedEditorialPayloadFor = (items = candidates) => ({
  ...aiPayloadFor(items),
  items: aiPayloadFor(items).items.map((item) => ({
    ...item,
    noise: item.signal
  }))
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
assert.equal(getSignalDraftMaxTokens(3), 3200);
assert.equal(getSignalDraftMaxTokens(4), 3520);
assert.equal(getSignalDraftMaxTokens(10), 6400);

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
assert.equal(generated.outputLocale, signalDraftOutputLocale);
assert.equal(generated.translationMode, 'source-to-zh-Hant');
assert.match(generated.markdown, /1\. 第 1 條資訊已完成繁體中文整理/);
assert.match(generated.markdown, /信號：/);
assert.match(generated.markdown, /噪音：/);
assert.equal(aiCalls[0].request.response_format.type, 'json_schema');
assert.equal(aiCalls[0].request.response_format.json_schema.properties.items.minItems, 3);
assert.equal(aiCalls[0].request.max_tokens, 3200);
assert.match(aiCalls[0].request.messages[0].content, /untrusted reference material/);
assert.match(aiCalls[0].request.messages[0].content, /Traditional Chinese \(zh-Hant\)/);
assert.match(aiCalls[0].request.messages[0].content, /must never repeat or paraphrase each other/i);
assert.match(aiCalls[0].request.messages[0].content, /Avoid generic controversy language/i);
assert.match(aiCalls[0].request.messages[1].content, /not permission to publish/i);
assert.match(aiCalls[0].request.messages[1].content, /"outputLocale":"zh-Hant"/);

const wrappedJson = await generateSignalBriefDraft(
  {
    async run() {
      return { response: `Draft follows:\n\`\`\`json\n${JSON.stringify(aiPayloadFor())}\n\`\`\`` };
    }
  },
  '@cf/test/draft-model',
  candidates,
  { briefDate: '2026-07-18', category: 'auto' }
);
assert.equal(wrappedJson.items.length, candidates.length);

const structureRetryCalls = [];
const generatedAfterStructureRetry = await generateSignalBriefDraft(
  {
    async run(_model, request) {
      structureRetryCalls.push(request);
      return { response: structureRetryCalls.length === 1 ? '{"title":"truncated"' : aiPayloadFor() };
    }
  },
  '@cf/test/draft-model',
  candidates,
  { briefDate: '2026-07-18', category: 'auto' }
);
assert.equal(structureRetryCalls.length, 2);
assert.match(structureRetryCalls[1].messages[0].content, /previous attempt returned malformed or incomplete JSON/i);
assert.equal(generatedAfterStructureRetry.items.length, candidates.length);

const fallbackCalls = [];
const generatedWithFallback = await generateSignalBriefDraft(
  {
    async run(model) {
      fallbackCalls.push(model);
      return { response: model === '@cf/test/fallback-model' ? aiPayloadFor() : '{"title":"truncated"' };
    }
  },
  '@cf/test/draft-model',
  candidates,
  {
    briefDate: '2026-07-18',
    category: 'auto',
    fallbackModel: '@cf/test/fallback-model'
  }
);
assert.deepEqual(fallbackCalls, ['@cf/test/draft-model', '@cf/test/draft-model', '@cf/test/fallback-model']);
assert.equal(generatedWithFallback.model, '@cf/test/fallback-model');

const translationRetryCalls = [];
const translatedAfterRetry = await generateSignalBriefDraft(
  {
    async run(_model, request) {
      translationRetryCalls.push(request);
      return { response: translationRetryCalls.length === 1 ? englishPayloadFor() : aiPayloadFor() };
    }
  },
  '@cf/test/draft-model',
  candidates,
  { briefDate: '2026-07-18', category: 'auto' }
);
assert.equal(translationRetryCalls.length, 2);
assert.match(translationRetryCalls[1].messages[0].content, /previous attempt did not complete the Chinese translation/i);
assert.equal(translatedAfterRetry.outputLocale, 'zh-Hant');

for (const invalidPayload of [mixedEnglishPayloadFor(), simplifiedPayloadFor()]) {
  const languageRetryCalls = [];
  const translatedResult = await generateSignalBriefDraft(
    {
      async run(_model, request) {
        languageRetryCalls.push(request);
        return { response: languageRetryCalls.length === 1 ? invalidPayload : aiPayloadFor() };
      }
    },
    '@cf/test/draft-model',
    candidates,
    { briefDate: '2026-07-18', category: 'auto' }
  );
  assert.equal(languageRetryCalls.length, 2);
  assert.equal(translatedResult.outputLocale, 'zh-Hant');
}

const editorialRetryCalls = [];
const editorialResult = await generateSignalBriefDraft(
  {
    async run(_model, request) {
      editorialRetryCalls.push(request);
      return { response: editorialRetryCalls.length === 1 ? duplicatedEditorialPayloadFor() : aiPayloadFor() };
    }
  },
  '@cf/test/draft-model',
  candidates,
  { briefDate: '2026-07-18', category: 'auto' }
);
assert.equal(editorialRetryCalls.length, 2);
assert.match(editorialRetryCalls[1].messages[0].content, /previous attempt repeated or paraphrased signal and noise/i);
assert.equal(editorialResult.items.length, candidates.length);

await assert.rejects(
  generateSignalBriefDraft(
    { run: async () => ({ response: duplicatedEditorialPayloadFor() }) },
    '@cf/test/draft-model',
    candidates,
    { briefDate: '2026-07-18', category: 'auto' }
  ),
  (error) => error.code === 'SIGNAL_DRAFT_AI_OUTPUT_EDITORIAL_INVALID'
);

await assert.rejects(
  generateSignalBriefDraft(
    { run: async () => ({ response: englishPayloadFor() }) },
    '@cf/test/draft-model',
    candidates,
    { briefDate: '2026-07-18', category: 'auto' }
  ),
  (error) => error.code === 'SIGNAL_DRAFT_AI_OUTPUT_LANGUAGE_INVALID'
);

const tenCandidates = Array.from({ length: 10 }, (_value, index) => ({
  ...candidates[index % candidates.length],
  id: `candidate-large-${index}`,
  title: `Large batch candidate ${index}`
}));
let largeBatchRequest = null;
await generateSignalBriefDraft(
  {
    async run(_model, request) {
      largeBatchRequest = request;
      return { response: aiPayloadFor(tenCandidates) };
    }
  },
  '@cf/test/draft-model',
  tenCandidates,
  { briefDate: '2026-07-18', category: 'auto' }
);
assert.equal(largeBatchRequest.max_tokens, 6400);

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
    if (/SELECT \*\s+FROM content_entries[\s\S]+slug = \?/i.test(this.sql)) return this.db.existingEntry;
    if (/SELECT id, metadata_json, source_kind, status\s+FROM content_entries[\s\S]+slug = \?/i.test(this.sql)) {
      return this.db.existingEntry;
    }
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
    if (/INSERT INTO content_imports/i.test(this.sql)) {
      return {
        created_at: '2026-07-18 04:00:00',
        created_by: this.params[4],
        entries_created: this.params[2],
        entries_updated: this.params[3],
        errors_json: '[]',
        filename: this.params[0],
        id: 71,
        import_type: 'signal_brief',
        r2_key: this.params[1],
        status: 'completed',
        updated_at: '2026-07-18 04:00:00',
        warnings_json: '[]'
      };
    }
    return null;
  }

  async all() {
    this.db.sql.push(this.sql);
    if (/SELECT candidate\.\*, source\.name AS source_name/i.test(this.sql)) {
      return {
        results: this.params.map((id) => this.db.candidates.get(id)).filter(Boolean)
      };
    }
    if (/SELECT id, status FROM signal_candidates WHERE id IN/i.test(this.sql)) {
      return {
        results: this.params.map((id) => this.db.candidates.get(id)).filter(Boolean)
      };
    }
    return { results: [] };
  }

  async run() {
    this.db.sql.push(this.sql);
    if (/INSERT INTO admin_audit_logs/i.test(this.sql)) this.db.auditActions.push(this.params[1]);
    if (/UPDATE signal_candidates[\s\S]+status = 'used'/i.test(this.sql)) {
      const candidate = this.db.candidates.get(this.params[1]);
      if (!candidate || candidate.status !== 'shortlisted') return { meta: { changes: 0 }, success: true };
      candidate.status = 'used';
    }
    return { meta: { changes: 1 }, success: true };
  }
}

class DraftDb {
  constructor(rows = candidates, existingEntry = null) {
    this.auditActions = [];
    this.candidates = new Map(rows.map((candidate) => [candidate.id, { ...candidate }]));
    this.existingEntry = existingEntry;
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
assert.equal(handlerPayload.automation.outputLocale, 'zh-Hant');
assert.equal(handlerPayload.automation.sourceEntryId, 41);
assert.equal(handlerPayload.automation.translationMode, 'source-to-zh-Hant');
assert.equal(bucketWrites.length, 2);
assert.deepEqual([...draftDb.candidates.values()].map((candidate) => candidate.status), [
  'shortlisted',
  'shortlisted',
  'shortlisted'
]);
assert.equal(draftDb.sql.some((sql) => /UPDATE signal_candidates/i.test(sql)), false);
assert.ok(draftDb.auditActions.includes('signal_brief_draft_generate'));

let overwriteAiCalled = false;
const overwriteResponse = await workerHooks.handleAdminGenerateSignalBriefDraft(
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
    AI: {
      async run() {
        overwriteAiCalled = true;
        return { response: aiPayloadFor() };
      }
    },
    WAITLIST_DB: new DraftDb(candidates, {
      id: 41,
      source_kind: 'signal_automation',
      status: 'draft'
    })
  }
);
assert.equal(overwriteResponse.status, 409);
assert.equal((await overwriteResponse.json()).code, 'SIGNAL_DRAFT_OVERWRITE_CONFIRMATION_REQUIRED');
assert.equal(overwriteAiCalled, false);

let archivedReviveAiCalled = false;
const archivedReviveDb = new DraftDb(candidates, {
  archived_at: '2026-07-18T05:20:00.000Z',
  id: 41,
  source_kind: 'signal_automation',
  status: 'archived'
});
const archivedReviveResponse = await workerHooks.handleAdminGenerateSignalBriefDraft(
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
    AI: {
      async run() {
        archivedReviveAiCalled = true;
        return { response: aiPayloadFor() };
      }
    },
    CONTENT_BUCKET: { async put() {} },
    WAITLIST_DB: archivedReviveDb
  }
);
assert.equal(archivedReviveResponse.status, 200);
assert.equal(archivedReviveAiCalled, true);
assert.equal((await archivedReviveResponse.json()).entry.status, 'draft');
assert.equal(archivedReviveDb.savedEntry.archived_at, null);

let publishedConflictAiCalled = false;
const publishedConflictResponse = await workerHooks.handleAdminGenerateSignalBriefDraft(
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
    AI: {
      async run() {
        publishedConflictAiCalled = true;
        return { response: aiPayloadFor() };
      }
    },
    WAITLIST_DB: new DraftDb(candidates, {
      id: 41,
      source_kind: 'signal_automation',
      status: 'published'
    })
  }
);
assert.equal(publishedConflictResponse.status, 409);
assert.equal((await publishedConflictResponse.json()).code, 'SIGNAL_DRAFT_DATE_CONFLICT');
assert.equal(publishedConflictAiCalled, false);

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

const directImportUnauthorizedResponse = await workerHooks.handleAdminImportSignalBrief(
  new Request('https://wwwstationcat.org/admin/api/signal/import', { method: 'POST' }),
  { WAITLIST_DB: new DraftDb() }
);
assert.equal(directImportUnauthorizedResponse.status, 401);
assert.equal((await directImportUnauthorizedResponse.json()).code, 'SIGNAL_IMPORT_ADMIN_REQUIRED');

const forgedAutomationResponse = await workerHooks.handleAdminImportSignalBrief(
  new Request('http://localhost/admin/api/signal/import', {
    body: JSON.stringify({
      automation: { candidateIds: candidates.map((candidate) => candidate.id) },
      briefDate: '2026-07-18',
      markdown: '1. Test item\n\nTest summary.',
      status: 'draft',
      title: 'Forged automation metadata'
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  { WAITLIST_DB: new DraftDb() }
);
assert.equal(forgedAutomationResponse.status, 409);
assert.equal((await forgedAutomationResponse.json()).code, 'SIGNAL_DRAFT_AUTOMATION_METADATA_UNTRUSTED');

const publicationCandidates = candidates.map((candidate, index) => ({
  ...candidate,
  status: index === 1 ? 'rejected' : 'shortlisted'
}));
const storedAutomation = {
  candidateIds: candidates.map((candidate) => candidate.id),
  generatedAt: '2026-07-18T04:00:00.000Z',
  model: '@cf/test/draft-model',
  promptVersion: 2,
  sourceEntryId: 41
};
const publicationDb = new DraftDb(publicationCandidates, {
  id: 41,
  metadata_json: JSON.stringify({ automation: storedAutomation }),
  source_kind: 'signal_automation',
  status: 'draft'
});
const publicationPayload = {
  automation: storedAutomation,
  briefDate: '2026-07-18',
  markdown: '1. Test item\n\nTest summary.\n\n信號：Test signal.\n\n噪音：Test noise.',
  status: 'published',
  title: 'Publication candidate exclusion'
};
const publicationNeedsConfirmation = await workerHooks.handleAdminImportSignalBrief(
  new Request('http://localhost/admin/api/signal/import', {
    body: JSON.stringify(publicationPayload),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  { WAITLIST_DB: publicationDb }
);
assert.equal(publicationNeedsConfirmation.status, 409);
const publicationConfirmationPayload = await publicationNeedsConfirmation.json();
assert.equal(publicationConfirmationPayload.code, 'SIGNAL_DRAFT_CANDIDATE_EXCLUSION_CONFIRMATION_REQUIRED');
assert.deepEqual(publicationConfirmationPayload.excludedCandidateIds, ['candidate-economy']);

const publicationBucketWrites = [];
const publicationResponse = await workerHooks.handleAdminImportSignalBrief(
  new Request('http://localhost/admin/api/signal/import', {
    body: JSON.stringify({ ...publicationPayload, allowCandidateExclusions: true }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  {
    CONTENT_BUCKET: {
      async put(key, value) {
        publicationBucketWrites.push({ key, value: String(value) });
      }
    },
    WAITLIST_DB: publicationDb
  }
);
assert.equal(publicationResponse.status, 200);
const publicationResult = await publicationResponse.json();
assert.deepEqual(publicationResult.excludedCandidateIds, ['candidate-economy']);
assert.deepEqual(publicationResult.usedCandidateIds.sort(), ['candidate-ai', 'candidate-tech']);
assert.equal(publicationBucketWrites.length, 3);
const savedAutomation = JSON.parse(publicationDb.savedEntry.metadata_json).automation;
assert.deepEqual(savedAutomation.candidateIds, ['candidate-ai', 'candidate-tech']);
assert.deepEqual(savedAutomation.excludedCandidateIds, ['candidate-economy']);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /选择 3–10 条已入选候选/);
assert.match(adminSource, /\/admin\/api\/signal\/drafts\/generate/);
assert.match(adminSource, /elements\.signal\.status\.value = 'draft'/);
assert.match(adminSource, /automation: state\.signalDraftAutomation/);
assert.match(adminSource, /confirmOverwrite: true/);
assert.match(adminSource, /allowCandidateExclusions: true/);
assert.match(adminSource, /草稿已保存到内容平台，尚未公开/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /status: 'draft'/);
assert.match(workerSource, /defaultSignalBriefDraftModel = '@cf\/meta\/llama-3\.1-8b-instruct-fast'/);
assert.match(workerSource, /candidateStatusesChanged: false/);
assert.match(workerSource, /WHERE id = \? AND status = 'shortlisted'/);
assert.match(workerSource, /candidateUsageConflictIds/);
assert.match(workerSource, /SIGNAL_DRAFT_CANDIDATE_EXCLUSION_CONFIRMATION_REQUIRED/);
assert.match(workerSource, /Automation provenance is server-owned/);

console.log('Signal automation phase 4 draft generation, storage, auth, and publication-gate checks passed.');
