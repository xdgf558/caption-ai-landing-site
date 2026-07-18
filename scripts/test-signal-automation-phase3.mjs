import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as workerHooks } from '../src/worker.js';
import {
  enrichSignalCandidateRows,
  findSignalCandidateMergeMatch,
  scoreSignalCandidate,
  signalTitleFingerprint,
  signalTitleSimilarity
} from '../src/signalTriage.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const migration0019 = read('migrations/0019_signal_automation.sql');
const migration0020 = read('migrations/0020_signal_collection.sql');
const migration0021 = read('migrations/0021_signal_candidate_triage.sql');
const migration0022 = read('migrations/0022_signal_source_adapters.sql');
const migration0023 = read('migrations/0023_signal_candidate_deduplication.sql');
assert.match(migration0021, /CREATE TABLE IF NOT EXISTS signal_candidate_reviews/);
assert.match(migration0021, /score_breakdown_json/);
assert.match(migration0021, /cluster_key/);
assert.match(migration0023, /CREATE TABLE IF NOT EXISTS signal_candidate_occurrences/);
assert.match(migration0023, /title_fingerprint/);
assert.match(migration0023, /match_reason IN \('primary', 'canonical_url', 'content_hash', 'title_fingerprint'\)/);

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'signal-automation-phase3-'));
const sqlitePath = join(sqliteDirectory, 'signal.sqlite');
const runSqlite = (input) => spawnSync('sqlite3', [sqlitePath], { encoding: 'utf8', input });
try {
  const migrationResult = runSqlite(`${migration0019}\n${migration0020}\n${migration0021}\n${migration0022}`);
  assert.equal(migrationResult.status, 0, migrationResult.stderr);
  const preDedupCandidateResult = runSqlite(`
    INSERT INTO signal_candidates (
      id, source_id, canonical_url, title, summary, published_at, content_hash,
      score_breakdown_json, cluster_key, decision_note
    ) VALUES (
      'candidate-before-0023', 'openai-news', 'https://openai.com/news/before-0023',
      'Candidate before migration 0023', 'Backfill check', '2026-07-17T10:00:00.000Z',
      'before-0023-hash', '{}', 'cluster-before-0023', ''
    );
  `);
  assert.equal(preDedupCandidateResult.status, 0, preDedupCandidateResult.stderr);
  const dedupMigrationResult = runSqlite(migration0023);
  assert.equal(dedupMigrationResult.status, 0, dedupMigrationResult.stderr);
  const schemaResult = runSqlite(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'signal_candidate_reviews')
      || '|' || (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'signal_candidate_occurrences')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_candidates') WHERE name = 'score_breakdown_json')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_candidates') WHERE name = 'cluster_key')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_candidates') WHERE name = 'decision_note')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_candidates') WHERE name = 'title_fingerprint')
      || '|' || (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_candidates_review_queue')
      || '|' || (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_candidates_title_fingerprint')
      || '|' || (SELECT COUNT(*) FROM signal_candidate_occurrences WHERE candidate_id = 'candidate-before-0023' AND match_reason = 'primary');
  `);
  assert.equal(schemaResult.status, 0, schemaResult.stderr);
  assert.equal(schemaResult.stdout.trim(), '1|1|1|1|1|1|1|1|1');

  const constraintResult = runSqlite(`
    INSERT INTO signal_candidates (id, source_id, canonical_url, title, content_hash)
    VALUES ('candidate-constraint', 'openai-news', 'https://openai.com/news/constraint', 'Constraint', 'constraint-hash');
    INSERT INTO signal_candidate_reviews (
      id, candidate_id, action, from_status, to_status, actor_email
    ) VALUES (
      'review-invalid', 'candidate-constraint', 'publish', 'new', 'used', 'admin@example.com'
    );
  `);
  assert.notEqual(constraintResult.status, 0);
  assert.match(constraintResult.stderr, /CHECK constraint failed/i);

  const occurrenceConstraintResult = runSqlite(`
    INSERT INTO signal_candidate_occurrences (
      id, candidate_id, source_id, canonical_url, title, content_hash, match_reason
    ) VALUES (
      'occurrence-invalid', 'candidate-before-0023', 'openai-news',
      'https://openai.com/news/invalid-occurrence', 'Invalid occurrence',
      'invalid-occurrence-hash', 'similar_title'
    );
  `);
  assert.notEqual(occurrenceConstraintResult.status, 0);
  assert.match(occurrenceConstraintResult.stderr, /CHECK constraint failed/i);
} finally {
  rmSync(sqliteDirectory, { force: true, recursive: true });
}

const now = new Date('2026-07-17T12:00:00.000Z');
const highScore = scoreSignalCandidate(
  {
    author: 'OpenAI',
    category: 'ai',
    publishedAt: '2026-07-17T10:00:00.000Z',
    summary: 'OpenAI released a new reasoning model with API safety evaluations, benchmark details, and deployment guidance.'.repeat(3),
    title: 'OpenAI releases a new reasoning model and API safety report'
  },
  { category: 'ai', trust_tier: 'primary' },
  { now }
);
const lowScore = scoreSignalCandidate(
  {
    category: 'tech',
    publishedAt: '2026-07-01T10:00:00.000Z',
    summary: '',
    title: 'BREAKING: YOU WON’T BELIEVE THIS'
  },
  { category: 'tech', trust_tier: 'community' },
  { now }
);
assert.ok(highScore.score >= 75, `Expected high-priority score, received ${highScore.score}`);
assert.ok(lowScore.score < 55, `Expected low-priority score, received ${lowScore.score}`);
assert.ok(highScore.breakdown.trust > lowScore.breakdown.trust);

const substringOnlyAiScore = scoreSignalCandidate(
  {
    category: 'ai',
    publishedAt: '2026-07-17T10:00:00.000Z',
    summary: 'A routine workplace note about a team calendar.',
    title: 'Email maintainers said the archive remains available'
  },
  { category: 'ai', trust_tier: 'community' },
  { now }
);
assert.deepEqual(substringOnlyAiScore.breakdown.siteMatches, []);
assert.equal(substringOnlyAiScore.breakdown.siteRelevance, 9);

const futureTimestampScore = scoreSignalCandidate(
  {
    category: 'tech',
    publishedAt: '2026-07-17T13:00:00.000Z',
    summary: 'A future-dated software release entry.',
    title: 'Software release entry'
  },
  { category: 'tech', trust_tier: 'established' },
  { now }
);
assert.equal(futureTimestampScore.breakdown.recency, 6);
assert.ok(futureTimestampScore.reasons.includes('发布时间晚于当前时间'));

assert.ok(
  signalTitleSimilarity(
    'OpenAI releases new reasoning model with safety report',
    'OpenAI launches its new reasoning model and safety report'
  ) >= 0.72
);
assert.ok(signalTitleSimilarity('美国就业降温，市场下调加息预期', '美国就业继续降温，市场下调加息预期') >= 0.72);
assert.ok(signalTitleSimilarity('Apple updates macOS', 'Federal Reserve holds interest rates') < 0.4);

assert.equal(
  signalTitleFingerprint('  OpenAI: New API — Safety Report!  '),
  'openai new api safety report'
);
const existingCandidate = {
  canonicalUrl: 'https://openai.com/news/reasoning-model',
  category: 'ai',
  contentHash: 'existing-content-hash',
  createdAt: '2026-07-17T09:00:00.000Z',
  id: 'candidate-primary',
  publishedAt: '2026-07-17T08:00:00.000Z',
  title: 'OpenAI releases a new reasoning model',
  titleFingerprint: 'openai releases a new reasoning model'
};
assert.deepEqual(
  findSignalCandidateMergeMatch(
    {
      canonicalUrl: existingCandidate.canonicalUrl,
      contentHash: 'different-content-hash',
      publishedAt: '2026-07-17T11:00:00.000Z',
      title: 'A different headline'
    },
    [existingCandidate],
    { now }
  ),
  { candidateId: 'candidate-primary', reason: 'canonical_url' }
);
assert.deepEqual(
  findSignalCandidateMergeMatch(
    {
      canonicalUrl: 'https://example.com/reasoning-model',
      contentHash: existingCandidate.contentHash,
      publishedAt: '2026-07-17T11:00:00.000Z',
      title: 'Another different headline'
    },
    [existingCandidate],
    { now }
  ),
  { candidateId: 'candidate-primary', reason: 'content_hash' }
);
assert.deepEqual(
  findSignalCandidateMergeMatch(
    {
      canonicalUrl: 'https://example.com/title-match',
      category: 'ai',
      contentHash: 'title-match-hash',
      publishedAt: '2026-07-19T08:00:00.000Z',
      title: 'OpenAI releases a new reasoning model'
    },
    [existingCandidate],
    { now }
  ),
  { candidateId: 'candidate-primary', reason: 'title_fingerprint' }
);
assert.equal(
  findSignalCandidateMergeMatch(
    {
      canonicalUrl: 'https://example.com/title-outside-window',
      category: 'ai',
      contentHash: 'outside-window-hash',
      publishedAt: '2026-07-21T08:01:00.000Z',
      title: 'OpenAI releases a new reasoning model'
    },
    [existingCandidate],
    { now }
  ),
  null
);
assert.equal(
  findSignalCandidateMergeMatch(
    {
      canonicalUrl: 'https://example.com/weekly-update',
      category: 'tech',
      contentHash: 'weekly-update-new',
      publishedAt: '2026-07-17T11:00:00.000Z',
      title: 'Weekly Update'
    },
    [{
      category: 'tech',
      createdAt: '2026-07-17T09:00:00.000Z',
      id: 'candidate-generic-title',
      title: 'Weekly Update'
    }],
    { now }
  ),
  null
);
assert.equal(
  findSignalCandidateMergeMatch(
    {
      canonicalUrl: 'https://example.com/cross-category',
      category: 'market',
      contentHash: 'cross-category-new',
      publishedAt: '2026-07-17T11:00:00.000Z',
      title: existingCandidate.title
    },
    [existingCandidate],
    { now }
  ),
  null
);

class CandidateInsertStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new CandidateInsertStatement(this.db, this.sql, params);
  }

  async first() {
    return null;
  }

  async all() {
    if (/WHERE canonical_url = \? OR content_hash = \?/i.test(this.sql)) {
      const [canonicalUrl, contentHash] = this.params;
      return {
        results: [...this.db.candidates.values()].filter(
          (candidate) =>
            candidate.canonical_url === canonicalUrl || candidate.content_hash === contentHash
        )
      };
    }
    if (/SELECT id, canonical_url, content_hash, title, title_fingerprint/i.test(this.sql)) {
      return {
        results: [...this.db.candidates.values()].filter(
          (candidate) => !this.db.hiddenFromMergePool.has(candidate.id)
        )
      };
    }
    return { results: [] };
  }

  async run() {
    if (/INSERT OR IGNORE INTO signal_candidates/i.test(this.sql)) {
      const [
        id, sourceId, runId, externalId, canonicalUrl, title, summary, author,
        publishedAt, language, category, relevanceScore, contentHash, rawPayloadJson,
        metadataJson, scoreBreakdownJson, clusterKey, titleFingerprint, scoredAt
      ] = this.params;
      const duplicate = [...this.db.candidates.values()].some(
        (candidate) =>
          candidate.content_hash === contentHash ||
          (candidate.source_id === sourceId && candidate.canonical_url === canonicalUrl)
      );
      if (duplicate) return { meta: { changes: 0 } };
      this.db.candidates.set(id, {
        author,
        canonical_url: canonicalUrl,
        category,
        cluster_key: clusterKey,
        content_hash: contentHash,
        created_at: scoredAt,
        external_id: externalId,
        id,
        language,
        metadata_json: metadataJson,
        published_at: publishedAt,
        raw_payload_json: rawPayloadJson,
        relevance_score: relevanceScore,
        run_id: runId,
        score_breakdown_json: scoreBreakdownJson,
        source_id: sourceId,
        status: 'new',
        summary,
        title,
        title_fingerprint: titleFingerprint
      });
      return { meta: { changes: 1 } };
    }

    if (/INSERT OR IGNORE INTO signal_candidate_occurrences/i.test(this.sql)) {
      const fromCandidate = /FROM signal_candidates AS candidate/i.test(this.sql);
      const occurrence = fromCandidate
        ? {
            id: this.params[0],
            candidate_id: this.params[10],
            source_id: this.params[1],
            run_id: this.params[2],
            canonical_url: this.params[3],
            title: this.params[4],
            summary: this.params[5],
            published_at: this.params[6],
            content_hash: this.params[7],
            title_fingerprint: this.params[8],
            match_reason: 'primary',
            metadata_json: this.params[9]
          }
        : {
            id: this.params[0],
            candidate_id: this.params[1],
            source_id: this.params[2],
            run_id: this.params[3],
            canonical_url: this.params[4],
            title: this.params[5],
            summary: this.params[6],
            published_at: this.params[7],
            content_hash: this.params[8],
            title_fingerprint: this.params[9],
            match_reason: this.params[10],
            metadata_json: this.params[11]
          };
      if (!this.db.candidates.has(occurrence.candidate_id)) return { meta: { changes: 0 } };
      const duplicate = this.db.occurrences.some(
        (item) =>
          item.candidate_id === occurrence.candidate_id &&
          item.source_id === occurrence.source_id &&
          item.canonical_url === occurrence.canonical_url &&
          item.content_hash === occurrence.content_hash
      );
      if (duplicate) return { meta: { changes: 0 } };
      this.db.occurrences.push(occurrence);
      return { meta: { changes: 1 } };
    }

    if (/INSERT INTO signal_candidate_reviews/i.test(this.sql)) {
      const [id, note, actor, candidateId, occurrenceId] = this.params;
      const candidate = this.db.candidates.get(candidateId);
      const occurrence = this.db.occurrences.find((item) => item.id === occurrenceId);
      if (!candidate || candidate.status !== 'rejected' || !occurrence) return { meta: { changes: 0 } };
      this.db.reviews.push({
        action: 'restore',
        actor,
        candidateId,
        fromStatus: 'rejected',
        id,
        note,
        toStatus: 'new'
      });
      return { meta: { changes: 1 } };
    }

    if (/UPDATE signal_candidates[\s\S]+status = 'new'/i.test(this.sql)) {
      const [note, actor, candidateId, occurrenceId] = this.params;
      const candidate = this.db.candidates.get(candidateId);
      const occurrence = this.db.occurrences.find((item) => item.id === occurrenceId);
      if (!candidate || candidate.status !== 'rejected' || !occurrence) return { meta: { changes: 0 } };
      Object.assign(candidate, {
        decision_note: note,
        reviewed_at: '2026-07-18 12:00:00',
        reviewed_by: actor,
        status: 'new',
        updated_at: '2026-07-18 12:00:00'
      });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }
}

class CandidateInsertDb {
  constructor() {
    this.batchSizes = [];
    this.candidates = new Map();
    this.hiddenFromMergePool = new Set();
    this.occurrences = [];
    this.reviews = [];
  }

  prepare(sql) {
    return new CandidateInsertStatement(this, sql);
  }

  async batch(statements) {
    this.batchSizes.push(statements.length);
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const candidateInsertDb = new CandidateInsertDb();
const candidateInsertResult = await workerHooks.insertSignalCandidates(
  candidateInsertDb,
  { category: 'tech', id: 'source-primary', language: 'en', trust_tier: 'primary' },
  [
    {
      author: 'Station Source A',
      canonicalUrl: 'https://source-a.example/cloudflare-update',
      category: 'tech',
      contentHash: 'cloudflare-update-a',
      externalId: 'source-a-update',
      id: 'candidate-cloudflare-a',
      metadataJson: '{}',
      publishedAt: '2026-07-18T08:00:00.000Z',
      rawPayloadJson: '{}',
      runId: 'run-dedup',
      summary: 'Cloudflare published details for developers.',
      title: 'Cloudflare launches a developer platform update',
      titleFingerprint: 'cloudflare launches a developer platform update'
    },
    {
      author: 'Station Source B',
      canonicalUrl: 'https://source-b.example/cloudflare-update',
      category: 'tech',
      contentHash: 'cloudflare-update-b',
      externalId: 'source-b-update',
      id: 'candidate-cloudflare-b',
      metadataJson: '{}',
      publishedAt: '2026-07-18T09:00:00.000Z',
      rawPayloadJson: '{}',
      runId: 'run-dedup',
      summary: 'A second report about the same Cloudflare developer update.',
      title: 'Cloudflare launches a developer platform update',
      titleFingerprint: 'cloudflare launches a developer platform update'
    }
  ]
);
assert.deepEqual(candidateInsertResult, { acceptedCount: 1, duplicateCount: 1 });
assert.equal(candidateInsertDb.candidates.size, 1);
assert.equal(candidateInsertDb.occurrences.length, 2);
assert.deepEqual(
  candidateInsertDb.occurrences.map((occurrence) => occurrence.match_reason),
  ['primary', 'title_fingerprint']
);

const persistedFallbackDb = new CandidateInsertDb();
persistedFallbackDb.candidates.set('candidate-persisted-old', {
  canonical_url: 'https://source-old.example/platform-release',
  category: 'tech',
  cluster_key: 'signal-cluster-old',
  content_hash: 'persisted-global-content-hash',
  created_at: '2026-07-01T08:00:00.000Z',
  id: 'candidate-persisted-old',
  published_at: '2026-07-01T07:00:00.000Z',
  source_id: 'source-old',
  status: 'new',
  title: 'A persisted report outside the recent merge pool',
  title_fingerprint: 'a persisted report outside the recent merge pool'
});
persistedFallbackDb.hiddenFromMergePool.add('candidate-persisted-old');
const persistedFallbackResult = await workerHooks.insertSignalCandidates(
  persistedFallbackDb,
  { category: 'tech', id: 'source-new', language: 'en', trust_tier: 'established' },
  [{
    author: 'Station Source New',
    canonicalUrl: 'https://source-new.example/platform-release',
    category: 'tech',
    contentHash: 'persisted-global-content-hash',
    externalId: 'persisted-fallback',
    id: 'candidate-persisted-attempt',
    metadataJson: '{}',
    publishedAt: '2026-07-18T10:00:00.000Z',
    rawPayloadJson: '{}',
    runId: 'run-persisted-fallback',
    summary: 'The same report arrived after the primary candidate left the recent pool.',
    title: 'A fresh headline for the persisted platform report',
    titleFingerprint: 'a fresh headline for the persisted platform report'
  }]
);
assert.deepEqual(persistedFallbackResult, { acceptedCount: 0, duplicateCount: 1 });
assert.equal(persistedFallbackDb.candidates.size, 1);
assert.equal(persistedFallbackDb.occurrences.length, 1);
assert.equal(persistedFallbackDb.occurrences[0].candidate_id, 'candidate-persisted-old');
assert.equal(persistedFallbackDb.occurrences[0].match_reason, 'content_hash');
assert.equal(persistedFallbackDb.batchSizes[0], 2);

const rejectedReopenDb = new CandidateInsertDb();
rejectedReopenDb.candidates.set('candidate-rejected', {
  canonical_url: 'https://source-a.example/reported-update',
  category: 'tech',
  cluster_key: 'signal-cluster-reported-update',
  content_hash: 'rejected-original-hash',
  created_at: '2026-07-18T08:00:00.000Z',
  decision_note: 'Not useful yesterday',
  id: 'candidate-rejected',
  published_at: '2026-07-18T07:00:00.000Z',
  reviewed_at: '2026-07-18T08:30:00.000Z',
  reviewed_by: 'editor@example.com',
  source_id: 'source-a',
  status: 'rejected',
  title: 'Cloudflare launches a developer platform update',
  title_fingerprint: 'cloudflare launches a developer platform update'
});
const rejectedReopenResult = await workerHooks.insertSignalCandidates(
  rejectedReopenDb,
  { category: 'tech', id: 'source-b', language: 'en', trust_tier: 'primary' },
  [{
    author: 'Station Source B',
    canonicalUrl: 'https://source-b.example/reported-update',
    category: 'tech',
    contentHash: 'rejected-new-hash',
    externalId: 'rejected-reopen',
    id: 'candidate-rejected-reopen-attempt',
    metadataJson: '{}',
    publishedAt: '2026-07-18T11:00:00.000Z',
    rawPayloadJson: '{}',
    runId: 'run-rejected-reopen',
    summary: 'A new source independently reports the previously rejected event.',
    title: 'Cloudflare launches a developer platform update',
    titleFingerprint: 'cloudflare launches a developer platform update'
  }]
);
assert.deepEqual(rejectedReopenResult, { acceptedCount: 0, duplicateCount: 1 });
assert.equal(rejectedReopenDb.candidates.get('candidate-rejected').status, 'new');
assert.equal(rejectedReopenDb.candidates.get('candidate-rejected').reviewed_by, 'signal-automation');
assert.equal(rejectedReopenDb.reviews.length, 1);
assert.equal(rejectedReopenDb.reviews[0].action, 'restore');
rejectedReopenDb.candidates.get('candidate-rejected').status = 'rejected';
await workerHooks.insertSignalCandidates(
  rejectedReopenDb,
  { category: 'tech', id: 'source-b', language: 'en', trust_tier: 'primary' },
  [{
    author: 'Station Source B',
    canonicalUrl: 'https://source-b.example/reported-update',
    category: 'tech',
    contentHash: 'rejected-new-hash',
    externalId: 'rejected-reopen-replay',
    id: 'candidate-rejected-replay-attempt',
    metadataJson: '{}',
    publishedAt: '2026-07-18T11:00:00.000Z',
    rawPayloadJson: '{}',
    runId: 'run-rejected-replay',
    summary: 'The collection task replayed an occurrence that was already stored.',
    title: 'Cloudflare launches a developer platform update',
    titleFingerprint: 'cloudflare launches a developer platform update'
  }]
);
assert.equal(rejectedReopenDb.candidates.get('candidate-rejected').status, 'rejected');
assert.equal(rejectedReopenDb.reviews.length, 1);

const clustered = await enrichSignalCandidateRows(
  [
    {
      id: 'candidate-a',
      publishedAt: '2026-07-17T10:00:00.000Z',
      summary: 'A detailed safety report and API release note.',
      title: 'OpenAI releases new reasoning model with safety report'
    },
    {
      id: 'candidate-b',
      publishedAt: '2026-07-17T10:30:00.000Z',
      summary: 'Coverage of the same reasoning model and safety report.',
      title: 'OpenAI launches its new reasoning model and safety report'
    }
  ],
  { now, source: { category: 'ai', trust_tier: 'primary' } }
);
assert.equal(clustered[0].clusterKey, clustered[1].clusterKey);
assert.equal(JSON.parse(clustered[1].metadataJson).triage.clusterMatchedId, 'candidate-a');
assert.equal(JSON.parse(clustered[0].scoreBreakdownJson).version, 3);
assert.equal(clustered[0].titleFingerprint, signalTitleFingerprint(clustered[0].title));

assert.deepEqual(
  workerHooks.normalizeSignalCandidateReviewPayload({ action: 'shortlist', candidateIds: ['a', 'a', 'b'], note: ' useful ' }),
  { action: 'shortlist', candidateIds: ['a', 'b'], note: 'useful' }
);
assert.throws(
  () => workerHooks.normalizeSignalCandidateReviewPayload({ action: 'publish', candidateId: 'a' }),
  (error) => error.code === 'SIGNAL_CANDIDATE_ACTION_INVALID'
);

class ReviewStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new ReviewStatement(this.db, this.sql, params);
  }

  async first() {
    if (/SELECT (?:id|score_breakdown_json|http_etag|processed_source_count) FROM/i.test(this.sql)) return null;
    return null;
  }

  async all() {
    if (/SELECT \* FROM signal_candidates WHERE id IN/i.test(this.sql)) {
      return { results: this.params.map((id) => this.db.candidates.get(id)).filter(Boolean) };
    }
    if (/SELECT candidate\.\*, source\.name AS source_name/i.test(this.sql)) {
      return {
        results: this.params.map((id) => ({
          ...this.db.candidates.get(id),
          cluster_size: 1,
          source_name: 'OpenAI News'
        }))
      };
    }
    return { results: [] };
  }

  async run() {
    if (/UPDATE signal_candidates[\s\S]+decision_note/i.test(this.sql)) {
      const [status, note, actor, id, expectedStatus] = this.params;
      const candidate = this.db.candidates.get(id);
      if (!candidate || candidate.status !== expectedStatus) return { meta: { changes: 0 } };
      Object.assign(candidate, {
        decision_note: note,
        reviewed_at: '2026-07-17 12:00:00',
        reviewed_by: actor,
        status,
        updated_at: '2026-07-17 12:00:00'
      });
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO signal_candidate_reviews/i.test(this.sql)) {
      const [reviewId, action, toStatus, note, actor, candidateId, expectedStatus] = this.params;
      const candidate = this.db.candidates.get(candidateId);
      if (!candidate || candidate.status !== expectedStatus) return { meta: { changes: 0 } };
      this.db.reviews.push({
        action,
        actor,
        candidateId,
        fromStatus: candidate.status,
        id: reviewId,
        note,
        toStatus
      });
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO admin_audit_logs/i.test(this.sql)) {
      this.db.auditActions.push(this.params[1]);
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }
}

class ReviewDb {
  constructor() {
    this.auditActions = [];
    this.reviews = [];
    this.raceStatus = '';
    this.candidates = new Map([
      ['candidate-review', {
        author: 'OpenAI',
        canonical_url: 'https://openai.com/news/review',
        category: 'ai',
        cluster_key: 'cluster-a',
        content_hash: 'review-hash',
        created_at: '2026-07-17 10:00:00',
        decision_note: '',
        external_id: 'review',
        id: 'candidate-review',
        language: 'en',
        metadata_json: '{}',
        published_at: '2026-07-17 09:00:00',
        relevance_score: 88,
        reviewed_at: null,
        reviewed_by: '',
        run_id: 'run-a',
        score_breakdown_json: '{"version":3}',
        scored_at: '2026-07-17 10:00:00',
        source_id: 'openai-news',
        status: 'new',
        summary: 'Summary',
        title: 'Candidate review',
        updated_at: '2026-07-17 10:00:00'
      }],
      ['candidate-used', {
        id: 'candidate-used',
        source_id: 'openai-news',
        status: 'used',
        title: 'Already used'
      }]
    ]);
  }

  prepare(sql) {
    return new ReviewStatement(this, sql);
  }

  async batch(statements) {
    if (this.raceStatus) {
      this.candidates.get('candidate-review').status = this.raceStatus;
      this.raceStatus = '';
    }
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const reviewDb = new ReviewDb();
const reviewResponse = await workerHooks.handleAdminReviewSignalCandidates(
  new Request('http://localhost/admin/api/signal/candidates', {
    body: JSON.stringify({ action: 'shortlist', candidateId: 'candidate-review', note: 'Primary source' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  { WAITLIST_DB: reviewDb }
);
assert.equal(reviewResponse.status, 200);
assert.equal(reviewDb.candidates.get('candidate-review').status, 'shortlisted');
assert.equal(reviewDb.reviews[0].fromStatus, 'new');
assert.equal(reviewDb.reviews[0].toStatus, 'shortlisted');
assert.equal(reviewDb.auditActions[0], 'signal_candidate_shortlist');

const usedResponse = await workerHooks.handleAdminReviewSignalCandidates(
  new Request('http://localhost/admin/api/signal/candidates', {
    body: JSON.stringify({ action: 'restore', candidateId: 'candidate-used' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  { WAITLIST_DB: reviewDb }
);
assert.equal(usedResponse.status, 409);
assert.equal((await usedResponse.json()).code, 'SIGNAL_CANDIDATE_ALREADY_USED');

const conflictDb = new ReviewDb();
conflictDb.raceStatus = 'rejected';
const conflictResponse = await workerHooks.handleAdminReviewSignalCandidates(
  new Request('http://localhost/admin/api/signal/candidates', {
    body: JSON.stringify({ action: 'shortlist', candidateId: 'candidate-review' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  }),
  { WAITLIST_DB: conflictDb }
);
assert.equal(conflictResponse.status, 409);
assert.equal((await conflictResponse.json()).code, 'SIGNAL_CANDIDATE_STATUS_CONFLICT');
assert.equal(conflictDb.reviews.length, 0);
assert.equal(conflictDb.auditActions.length, 0);
assert.equal(conflictDb.candidates.get('candidate-review').status, 'rejected');

const protectedAdminEnv = {
  ADMIN_ALLOWED_EMAILS: 'admin@example.com',
  CF_ACCESS_AUD: 'test-audience',
  CF_ACCESS_TEAM_DOMAIN: 'stationcat.cloudflareaccess.com'
};
for (const method of ['GET', 'POST']) {
  const protectedResponse = await worker.fetch(
    new Request('https://wwwstationcat.org/admin/api/signal/candidates', { method }),
    protectedAdminEnv,
    {}
  );
  assert.equal(protectedResponse.status, 401);
}

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /id="signal-candidate-filters"/);
assert.match(adminSource, /id="signal-candidates-rescore"/);
assert.match(adminSource, /action: 'rescore'/);
assert.match(adminSource, /更早记录保留原评分/);
assert.match(adminSource, /reviewSignalCandidate/);
assert.match(adminSource, /审核备注（可选）/);
assert.match(adminSource, /已合并.*来源/);
assert.match(adminSource, /近似同题/);
assert.match(adminSource, /站点相关性和内容完整度/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /ensureSignalCandidateTriageReady/);
assert.match(workerSource, /ensureSignalCandidateDeduplicationReady/);
assert.match(workerSource, /signal_candidate_reviews/);
assert.match(workerSource, /signal_candidate_occurrences/);
assert.match(workerSource, /findPersistedSignalCandidateMatch/);
assert.match(workerSource, /SIGNAL_CANDIDATE_STATUS_CONFLICT/);
assert.match(workerSource, /ESCAPE '\\\\'/);
assert.match(workerSource, /if \(request\.method === 'POST'\) return handleAdminReviewSignalCandidates/);

console.log('Signal automation phase 3 scoring, duplicate merging, clustering, review, auth, migration, and Admin checks passed.');
