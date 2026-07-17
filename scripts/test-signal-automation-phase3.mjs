import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as workerHooks } from '../src/worker.js';
import {
  enrichSignalCandidateRows,
  scoreSignalCandidate,
  signalTitleSimilarity
} from '../src/signalTriage.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const migration0019 = read('migrations/0019_signal_automation.sql');
const migration0020 = read('migrations/0020_signal_collection.sql');
const migration0021 = read('migrations/0021_signal_candidate_triage.sql');
assert.match(migration0021, /CREATE TABLE IF NOT EXISTS signal_candidate_reviews/);
assert.match(migration0021, /score_breakdown_json/);
assert.match(migration0021, /cluster_key/);

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'signal-automation-phase3-'));
const sqlitePath = join(sqliteDirectory, 'signal.sqlite');
const runSqlite = (input) => spawnSync('sqlite3', [sqlitePath], { encoding: 'utf8', input });
try {
  const migrationResult = runSqlite(`${migration0019}\n${migration0020}\n${migration0021}`);
  assert.equal(migrationResult.status, 0, migrationResult.stderr);
  const schemaResult = runSqlite(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'signal_candidate_reviews')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_candidates') WHERE name = 'score_breakdown_json')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_candidates') WHERE name = 'cluster_key')
      || '|' || (SELECT COUNT(*) FROM pragma_table_info('signal_candidates') WHERE name = 'decision_note')
      || '|' || (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_candidates_review_queue');
  `);
  assert.equal(schemaResult.status, 0, schemaResult.stderr);
  assert.equal(schemaResult.stdout.trim(), '1|1|1|1|1');

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

assert.ok(
  signalTitleSimilarity(
    'OpenAI releases new reasoning model with safety report',
    'OpenAI launches its new reasoning model and safety report'
  ) >= 0.72
);
assert.ok(signalTitleSimilarity('美国就业降温，市场下调加息预期', '美国就业继续降温，市场下调加息预期') >= 0.72);
assert.ok(signalTitleSimilarity('Apple updates macOS', 'Federal Reserve holds interest rates') < 0.4);

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
assert.equal(JSON.parse(clustered[0].scoreBreakdownJson).version, 1);

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
      this.db.reviews.push({
        action: this.params[2],
        candidateId: this.params[1],
        fromStatus: this.params[3],
        note: this.params[5],
        toStatus: this.params[4]
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
        score_breakdown_json: '{"version":1}',
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
assert.match(adminSource, /reviewSignalCandidate/);
assert.match(adminSource, /审核备注（可选）/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /ensureSignalCandidateTriageReady/);
assert.match(workerSource, /signal_candidate_reviews/);
assert.match(workerSource, /if \(request\.method === 'POST'\) return handleAdminReviewSignalCandidates/);

console.log('Signal automation phase 3 scoring, clustering, review, auth, migration, and Admin checks passed.');
