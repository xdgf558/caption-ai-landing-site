import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const seriesRow = {
  access_level: 'free',
  chapter_number: null,
  created_at: '2026-06-26 12:00:00',
  entry_type: 'novel_series',
  id: 2,
  locale: 'zh-Hant',
  parent_slug: '',
  slug: 'book',
  status: 'published',
  title: 'Book',
  updated_at: '2026-06-26 12:00:00',
  visibility: 'public',
  word_count: 12000
};

const chapterRow = {
  access_level: 'free',
  chapter_number: 8,
  created_at: '2026-06-26 12:05:00',
  entry_type: 'novel_chapter',
  id: 8,
  locale: 'zh-Hant',
  parent_slug: 'book',
  slug: 'ch8',
  status: 'published',
  title: 'Chapter Eight',
  updated_at: '2026-06-26 12:05:00',
  visibility: 'public',
  word_count: 3000
};

const statsRow = {
  account_readers: 2,
  avg_read_time_seconds: 72,
  avg_scroll_depth: 64,
  bookmark_count: 1,
  calculated_at: '2026-06-26 12:08:00',
  chapter_number: 8,
  chapter_slug: 'ch8',
  close_count: 3,
  comment_count: 1,
  completion_count: 2,
  completion_rate: 0.5,
  created_at: '2026-06-26 12:08:00',
  drop_off_points_json: JSON.stringify([{ count: 2, label: '中段', position: 'middle', rate: 0.5, severity: 'medium' }]),
  drop_off_rate: 0.5,
  engagement_score: 0.61,
  event_window_end: '2026-06-26 12:05:00',
  event_window_start: '2026-06-26 12:00:00',
  id: 1,
  like_count: 1,
  locale: 'zh-Hant',
  open_count: 4,
  scroll_depth_distribution_json: JSON.stringify({ '0-25': 0, '26-50': 1, '51-75': 2, '76-89': 0, '90-100': 1 }),
  series_slug: 'book',
  series_title: 'Book',
  title: 'Chapter Eight',
  total_events: 16,
  unique_sessions: 4,
  updated_at: '2026-06-26 12:12:00',
  window_days: 30
};

const insightRow = {
  chapter_number: 8,
  chapter_slug: 'ch8',
  created_at: '2026-06-26 12:10:00',
  generated_at: '2026-06-26 12:10:00',
  id: 9,
  insight_json: JSON.stringify({
    risk_level: 'medium',
    strong_points: ['有读者保存书签'],
    suggestions: ['继续观察下一批阅读数据。'],
    summary: '本章表现中等。'
  }),
  locale: 'zh-Hant',
  model: 'station-cat-insight-v1',
  series_slug: 'book',
  series_title: 'Book',
  source_stats_updated_at: '2026-06-26 12:08:00',
  title: 'Chapter Eight',
  updated_at: '2026-06-26 12:10:00',
  window_days: 30
};

class MockBoundStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  async first() {
    if (/SELECT id FROM content_entries LIMIT 1/i.test(this.sql)) return null;
    if (/SELECT id FROM chapter_stats LIMIT 1/i.test(this.sql)) return null;
    if (/SELECT id FROM ai_insights LIMIT 1/i.test(this.sql)) return null;

    if (/FROM content_entries\s+WHERE id = \?/i.test(this.sql)) {
      const [id, entryType] = this.params;
      if (entryType === 'novel_series' && Number(id) === 2) return seriesRow;
      if (entryType === 'novel_chapter' && Number(id) === 8) return chapterRow;
      return null;
    }

    if (/FROM content_entries/i.test(this.sql) && /COALESCE\(parent_slug, ''\) = \?/i.test(this.sql)) {
      const [entryType, locale, parentSlug, slug] = this.params;
      if (entryType === 'novel_series' && locale === 'zh-Hant' && parentSlug === '' && slug === 'book') return seriesRow;
      if (entryType === 'novel_chapter' && locale === 'zh-Hant' && parentSlug === 'book' && slug === 'ch8') return chapterRow;
      return null;
    }

    if (/WHERE entry_type = 'novel_chapter'/i.test(this.sql)) {
      const [locale, slug] = this.params;
      if (locale === 'zh-Hant' && slug === 'ch8') return chapterRow;
      return null;
    }

    if (/COUNT\(\*\) AS chapter_count/i.test(this.sql) && /FROM chapter_stats/i.test(this.sql)) {
      this.db.summaryQueries.push({ params: this.params, sql: this.sql });
      return {
        avg_completion_rate: 0.5,
        avg_engagement_score: 0.61,
        avg_read_time_seconds: 72,
        chapter_count: 2,
        latest_updated_at: '2026-06-26 12:12:00',
        total_events: 32,
        unique_sessions: 8
      };
    }

    if (/FROM chapter_stats/i.test(this.sql) && /LIMIT 1/i.test(this.sql)) {
      this.db.statsQueries.push({ params: this.params, sql: this.sql });
      return { ...statsRow, window_days: this.params[3] || 30 };
    }

    if (/FROM ai_insights/i.test(this.sql) && /LIMIT 1/i.test(this.sql)) {
      this.db.insightQueries.push({ params: this.params, sql: this.sql });
      return { ...insightRow, window_days: this.params[3] || 30 };
    }

    return null;
  }

  async all() {
    if (/FROM chapter_stats/i.test(this.sql) && /LIMIT \?/i.test(this.sql)) {
      this.db.trendQueries.push({ params: this.params, sql: this.sql });
      return {
        results: [
          { ...statsRow, chapter_number: 7, chapter_slug: 'ch7', title: 'Chapter Seven', window_days: this.params[2] || 30 },
          { ...statsRow, chapter_number: 8, chapter_slug: 'ch8', title: 'Chapter Eight', window_days: this.params[2] || 30 }
        ]
      };
    }
    return { results: [] };
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
  constructor() {
    this.insightQueries = [];
    this.statsQueries = [];
    this.summaryQueries = [];
    this.trendQueries = [];
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }
}

const workerSource = read('src/worker.js');
assert.match(workerSource, /novelForgeAnalyticsContractHeader/);
assert.match(workerSource, /parseNovelForgeAnalyticsRoute/);
assert.match(workerSource, /handleNovelForgeAnalytics/);
assert.match(workerSource, /\/api\/novelforge\/analytics/);

const docsSource = read('docs/novelforge-writing-api-5.md');
assert.match(docsSource, /\/api\/novelforge\/analytics\/chapter/);
assert.match(docsSource, /station-cat-novelforge-analytics\.v1/);
assert.match(docsSource, /NOVELFORGE_SERIES_REQUIRED/);

const parsedRoute = hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/chapter/book/ch8/');
assert.deepEqual(parsedRoute, { identifier: 'book/ch8', resource: 'chapter' });
assert.equal(hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/chapter/book/ch8/extra'), null);
assert.equal(hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/trend/book/extra'), null);

const env = { NOVELFORGE_PUBLISH_TOKEN: 'secret', WAITLIST_DB: new MockDb() };
const authHeaders = {
  authorization: 'Bearer secret',
  'x-novelforge-contract': 'station-cat-novelforge-analytics.v1'
};

const invalidAuthResponse = await hooks.handleNovelForgeAnalytics(
  new Request('https://wwwstationcat.org/api/novelforge/analytics/chapter/chapter_8'),
  { NOVELFORGE_PUBLISH_TOKEN: 'secret', WAITLIST_DB: new MockDb() },
  hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/chapter/chapter_8')
);
assert.equal(invalidAuthResponse.status, 401);

const invalidContractResponse = await hooks.handleNovelForgeAnalytics(
  new Request('https://wwwstationcat.org/api/novelforge/analytics/chapter/chapter_8', {
    headers: { authorization: 'Bearer secret', 'x-novelforge-contract': 'wrong-contract.v1' }
  }),
  { NOVELFORGE_PUBLISH_TOKEN: 'secret', WAITLIST_DB: new MockDb() },
  hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/chapter/chapter_8')
);
assert.equal(invalidContractResponse.status, 400);

const chapterResponse = await hooks.handleNovelForgeAnalytics(
  new Request('https://wwwstationcat.org/api/novelforge/analytics/chapter/chapter_8?windowDays=7', {
    headers: authHeaders
  }),
  env,
  hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/chapter/chapter_8')
);
const chapterBody = await chapterResponse.json();
assert.equal(chapterResponse.status, 200);
assert.equal(chapterBody.chapter.remoteId, 'chapter_8');
assert.equal(chapterBody.chapter.paths.readerV2, '/novel/book/chapter/ch8/');
assert.equal(chapterBody.stats.windowDays, 7);
assert.equal(chapterBody.stats.chapterSlug, 'ch8');

const slugWithoutSeriesResponse = await hooks.handleNovelForgeAnalytics(
  new Request('https://wwwstationcat.org/api/novelforge/analytics/chapter/ch8', {
    headers: authHeaders
  }),
  env,
  hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/chapter/ch8')
);
const slugWithoutSeriesBody = await slugWithoutSeriesResponse.json();
assert.equal(slugWithoutSeriesResponse.status, 400);
assert.equal(slugWithoutSeriesBody.error.code, 'NOVELFORGE_SERIES_REQUIRED');

const slugWithSeriesResponse = await hooks.handleNovelForgeAnalytics(
  new Request('https://wwwstationcat.org/api/novelforge/analytics/chapter/ch8?seriesSlug=book&windowDays=7', {
    headers: authHeaders
  }),
  env,
  hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/chapter/ch8')
);
const slugWithSeriesBody = await slugWithSeriesResponse.json();
assert.equal(slugWithSeriesResponse.status, 200);
assert.equal(slugWithSeriesBody.chapter.parentSlug, 'book');

const insightsResponse = await hooks.handleNovelForgeAnalytics(
  new Request('https://wwwstationcat.org/api/novelforge/analytics/insights?seriesSlug=book&chapterSlug=ch8&windowDays=30', {
    headers: authHeaders
  }),
  env,
  hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/insights')
);
const insightsBody = await insightsResponse.json();
assert.equal(insightsResponse.status, 200);
assert.equal(insightsBody.insight.insight.summary, '本章表现中等。');
assert.equal(insightsBody.insight.stale, true);
assert.equal(insightsBody.stats.updatedAt, '2026-06-26 12:12:00');

const trendResponse = await hooks.handleNovelForgeAnalytics(
  new Request('https://wwwstationcat.org/api/novelforge/analytics/trend/work_2?windowDays=30&limit=2', {
    headers: authHeaders
  }),
  env,
  hooks.parseNovelForgeAnalyticsRoute('/api/novelforge/analytics/trend/work_2')
);
const trendBody = await trendResponse.json();
assert.equal(trendResponse.status, 200);
assert.equal(trendBody.series.remoteId, 'work_2');
assert.equal(trendBody.trend.length, 2);
assert.equal(trendBody.summary.chapterCount, 2);

console.log('NovelForge writing API tests passed');
