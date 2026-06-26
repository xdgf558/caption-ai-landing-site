import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const statsRow = {
  account_readers: 2,
  avg_read_time_seconds: 72,
  avg_scroll_depth: 34,
  bookmark_count: 1,
  calculated_at: '2026-06-26 12:08:00',
  chapter_number: 8,
  chapter_slug: 'ch8',
  close_count: 3,
  comment_count: 1,
  completion_count: 1,
  completion_rate: 0.25,
  created_at: '2026-06-26 12:08:00',
  drop_off_points_json: JSON.stringify([{ count: 3, label: '开头', position: 'opening', rate: 0.75, severity: 'high' }]),
  drop_off_rate: 0.75,
  engagement_score: 0.31,
  event_window_end: '2026-06-26 12:05:00',
  event_window_start: '2026-06-26 12:00:00',
  id: 1,
  like_count: 1,
  locale: 'zh-Hant',
  open_count: 4,
  scroll_depth_distribution_json: JSON.stringify({ '0-25': 2, '26-50': 1, '51-75': 0, '76-89': 0, '90-100': 1 }),
  series_slug: 'book',
  series_title: 'Book',
  title: 'Chapter Eight',
  total_events: 14,
  unique_sessions: 4,
  updated_at: '2026-06-26 12:08:00',
  window_days: 30
};

class MockBoundStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  async first() {
    if (/SELECT id FROM chapter_stats LIMIT 1/i.test(this.sql)) {
      if (this.db.missingChapterStats) throw new Error('D1_ERROR: no such table: chapter_stats');
      return null;
    }
    if (/SELECT id FROM ai_insights LIMIT 1/i.test(this.sql)) {
      if (this.db.missingAiInsights) throw new Error('D1_ERROR: no such table: ai_insights');
      return null;
    }
    if (/INSERT INTO ai_insights/i.test(this.sql)) {
      this.db.insightUpserts.push(this.params);
      return {
        chapter_slug: this.params[1],
        created_at: '2026-06-26 12:10:00',
        generated_at: '2026-06-26 12:10:00',
        id: 9,
        insight_json: this.params[4],
        locale: this.params[2],
        model: this.params[5],
        series_slug: this.params[0],
        source_stats_updated_at: this.params[6],
        updated_at: '2026-06-26 12:10:00',
        window_days: this.params[3]
      };
    }
    return null;
  }

  async all() {
    if (/FROM chapter_stats/i.test(this.sql)) {
      this.db.statsQueries.push({ params: this.params, sql: this.sql });
      return { results: [{ ...statsRow, window_days: this.params[1] || 30 }] };
    }
    if (/FROM ai_insights/i.test(this.sql)) {
      this.db.insightQueries.push({ params: this.params, sql: this.sql });
      return {
        results: [
          {
            ...this.db.latestInsightRow,
            chapter_number: 8,
            series_title: 'Book',
            title: 'Chapter Eight',
            window_days: this.params[1] || 30
          }
        ]
      };
    }
    return { results: [] };
  }

  async run() {
    this.db.runs.push({ params: this.params, sql: this.sql });
    return { success: true, meta: { changes: 1 } };
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
    this.insightQueries = [];
    this.insightUpserts = [];
    this.latestInsightRow = {
      chapter_slug: 'ch8',
      created_at: '2026-06-26 12:10:00',
      generated_at: '2026-06-26 12:10:00',
      id: 9,
      insight_json: JSON.stringify({ strong_points: ['existing'], suggestions: ['keep going'] }),
      locale: 'zh-Hant',
      model: 'station-cat-insight-v1',
      series_slug: 'book',
      source_stats_updated_at: '2026-06-26 12:08:00',
      updated_at: '2026-06-26 12:10:00',
      window_days: 30
    };
    this.missingAiInsights = Boolean(options.missingAiInsights);
    this.missingChapterStats = Boolean(options.missingChapterStats);
    this.runs = [];
    this.statsQueries = [];
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }
}

const migrationSource = read('migrations/0016_ai_insights.sql');
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_insights/);
assert.match(migrationSource, /window_days INTEGER NOT NULL DEFAULT 30/);
assert.match(migrationSource, /UNIQUE \(series_slug, chapter_slug, locale, window_days\)/);
assert.match(migrationSource, /idx_ai_insights_series_generated/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /handleAdminGenerateNovelAiInsights/);
assert.match(workerSource, /handleAdminListNovelAiInsights/);
assert.match(workerSource, /AI_INSIGHTS_NOT_READY/);
assert.match(workerSource, /admin\/api\/novels\/analytics\/insights\/generate/);
assert.match(workerSource, /INSERT INTO ai_insights/);
assert.match(workerSource, /ON CONFLICT\(series_slug, chapter_slug, locale, window_days\)/);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /analytics-generate-insights/);
assert.match(adminSource, /AI Insight/);
assert.match(adminSource, /admin\/api\/novels\/analytics\/insights\/generate/);

const highRiskInsight = hooks.buildNovelAiInsightFromStats({
  avgReadTimeSeconds: 60,
  avgScrollDepth: 28,
  bookmarkCount: 0,
  commentCount: 1,
  completionRate: 0.2,
  dropOffPoints: [{ count: 5, label: '开头', position: 'opening', rate: 0.5, severity: 'high' }],
  dropOffRate: 0.8,
  engagementScore: 0.22,
  likeCount: 0,
  uniqueSessions: 10
});
assert.equal(highRiskInsight.risk_level, 'high');
assert.ok(highRiskInsight.weak_points.some((item) => item.includes('完成率偏低')));
assert.ok(highRiskInsight.suggestions.some((item) => item.includes('开篇')));
assert.equal(typeof highRiskInsight.character_popularity.main, 'number');

const db = new MockDb();
const generateResponse = await hooks.handleAdminGenerateNovelAiInsights(
  new Request('https://wwwstationcat.org/admin/api/novels/analytics/insights/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seriesSlug: 'book', windowDays: 7 })
  }),
  { ADMIN_ACCESS_LOCAL_BYPASS: '1', WAITLIST_DB: db }
);
const generateBody = await generateResponse.json();
assert.equal(generateResponse.status, 200);
assert.equal(generateBody.generated, 1);
assert.equal(generateBody.windowDays, 7);
assert.equal(db.statsQueries[0].params[1], 7);
assert.equal(db.insightUpserts[0][0], 'book');
assert.equal(db.insightUpserts[0][1], 'ch8');
assert.equal(db.insightUpserts[0][3], 7);
assert.equal(JSON.parse(db.insightUpserts[0][4]).risk_level, 'high');

const listDb = new MockDb();
const listResponse = await hooks.handleAdminListNovelAiInsights(
  new Request('https://wwwstationcat.org/admin/api/novels/analytics/insights?seriesSlug=book&windowDays=7'),
  { WAITLIST_DB: listDb }
);
const listBody = await listResponse.json();
assert.equal(listResponse.status, 200);
assert.equal(listBody.windowDays, 7);
assert.equal(listBody.insights[0].chapterSlug, 'ch8');
assert.equal(listBody.insights[0].insight.suggestions[0], 'keep going');
assert.equal(listDb.insightQueries[0].params[1], 7);

const missingInsightsResponse = await hooks.handleAdminGenerateNovelAiInsights(
  new Request('https://wwwstationcat.org/admin/api/novels/analytics/insights/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seriesSlug: 'book' })
  }),
  { ADMIN_ACCESS_LOCAL_BYPASS: '1', WAITLIST_DB: new MockDb({ missingAiInsights: true }) }
);
assert.equal(missingInsightsResponse.status, 503);
assert.equal((await missingInsightsResponse.json()).code, 'AI_INSIGHTS_NOT_READY');

console.log('novel AI insights tests passed');
