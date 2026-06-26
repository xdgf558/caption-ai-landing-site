import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const statsRow = {
  account_readers: 1,
  avg_read_time_seconds: 93,
  avg_scroll_depth: 60,
  bookmark_count: 1,
  calculated_at: '2026-06-26 12:08:00',
  chapter_number: 1,
  chapter_slug: 'ch1',
  close_count: 1,
  comment_count: 1,
  completion_count: 1,
  completion_rate: 0.5,
  created_at: '2026-06-26 12:08:00',
  drop_off_points_json: JSON.stringify([{ count: 1, label: '中段', position: 'middle', rate: 0.5, severity: 'high' }]),
  drop_off_rate: 0.5,
  engagement_score: 0.62,
  event_window_end: '2026-06-26 12:05:00',
  event_window_start: '2026-06-26 12:00:00',
  id: 1,
  like_count: 1,
  locale: 'zh-Hant',
  open_count: 2,
  scroll_depth_distribution_json: JSON.stringify({ '0-25': 0, '26-50': 0, '51-75': 1, '76-89': 0, '90-100': 1 }),
  series_slug: 'book',
  series_title: 'Book',
  title: 'Chapter One',
  total_events: 8,
  unique_sessions: 2,
  updated_at: '2026-06-26 12:08:00'
};

class MockBoundStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  async first() {
    if (/SELECT id FROM reading_events LIMIT 1/i.test(this.sql)) {
      if (this.db.missingReadingEvents) throw new Error('D1_ERROR: no such table: reading_events');
      return null;
    }
    if (/SELECT id FROM chapter_stats LIMIT 1/i.test(this.sql)) {
      if (this.db.missingChapterStats) throw new Error('D1_ERROR: no such table: chapter_stats');
      return null;
    }
    if (/COUNT\(\*\) AS total_events/i.test(this.sql) && /FROM reading_events/i.test(this.sql)) {
      return {
        account_readers: 1,
        event_window_end: '2026-06-26 12:05:00',
        event_window_start: '2026-06-26 12:00:00',
        total_events: 8
      };
    }
    if (/INSERT INTO chapter_stats/i.test(this.sql)) {
      this.db.upserted.push(this.params);
      return {
        ...statsRow,
        account_readers: this.params[5],
        avg_read_time_seconds: this.params[12],
        avg_scroll_depth: this.params[13],
        bookmark_count: this.params[10],
        chapter_slug: this.params[1],
        close_count: this.params[7],
        comment_count: this.params[11],
        completion_count: this.params[8],
        completion_rate: this.params[14],
        drop_off_points_json: this.params[18],
        drop_off_rate: this.params[15],
        engagement_score: this.params[16],
        event_window_end: this.params[20],
        event_window_start: this.params[19],
        like_count: this.params[9],
        locale: this.params[2],
        open_count: this.params[6],
        scroll_depth_distribution_json: this.params[17],
        series_slug: this.params[0],
        total_events: this.params[3],
        unique_sessions: this.params[4]
      };
    }
    if (/COUNT\(\*\) AS chapter_count/i.test(this.sql) && /FROM chapter_stats/i.test(this.sql)) {
      return {
        avg_completion_rate: 0.5,
        avg_engagement_score: 0.62,
        avg_read_time_seconds: 93,
        chapter_count: 1,
        latest_updated_at: '2026-06-26 12:08:00',
        open_count: 2,
        total_events: 8,
        unique_sessions: 2
      };
    }
    return null;
  }

  async all() {
    if (/SELECT series_slug, chapter_slug, locale, MAX\(created_at\) AS latest_event_at/i.test(this.sql)) {
      return { results: [{ chapter_slug: 'ch1', latest_event_at: '2026-06-26 12:05:00', locale: 'zh-Hant', series_slug: 'book' }] };
    }
    if (/SELECT event_type, COUNT\(\*\) AS count/i.test(this.sql)) {
      return {
        results: [
          { count: 2, event_type: 'chapter_open' },
          { count: 1, event_type: 'chapter_close' },
          { count: 1, event_type: 'like' },
          { count: 1, event_type: 'bookmark' },
          { count: 1, event_type: 'comment_draft' }
        ]
      };
    }
    if (/GROUP BY session_id/i.test(this.sql)) {
      return {
        results: [
          {
            bookmark_count: 1,
            close_duration_ms: 120000,
            close_progress: 100,
            comment_count: 0,
            first_event_at: '2026-06-26 12:00:00',
            last_event_at: '2026-06-26 12:02:00',
            like_count: 1,
            max_progress: 100,
            max_scroll_depth: 100,
            session_id: 'session-a'
          },
          {
            bookmark_count: 0,
            close_duration_ms: 0,
            close_progress: 0,
            comment_count: 1,
            first_event_at: '2026-06-26 12:03:00',
            last_event_at: '2026-06-26 12:04:06',
            like_count: 0,
            max_progress: 55,
            max_scroll_depth: 55,
            session_id: 'session-b'
          }
        ]
      };
    }
    if (/SELECT\s+chapter_stats\.\*/i.test(this.sql)) {
      return { results: [statsRow] };
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
    this.missingChapterStats = Boolean(options.missingChapterStats);
    this.missingReadingEvents = Boolean(options.missingReadingEvents);
    this.runs = [];
    this.upserted = [];
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }
}

const migrationSource = read('migrations/0015_chapter_stats.sql');
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS chapter_stats/);
assert.match(migrationSource, /UNIQUE \(series_slug, chapter_slug, locale\)/);
assert.match(migrationSource, /idx_chapter_stats_series_updated/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /handleAdminAggregateNovelAnalytics/);
assert.match(workerSource, /handleAdminListNovelAnalyticsStats/);
assert.match(workerSource, /CHAPTER_STATS_NOT_READY/);
assert.match(workerSource, /INSERT INTO chapter_stats/);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /data-admin-v2-tab="analytics"/);
assert.match(adminSource, /admin\/api\/novels\/analytics\/aggregate/);
assert.match(adminSource, /admin\/api\/novels\/analytics\/stats/);
assert.match(adminSource, /阅读事件统计/);

const metrics = hooks.buildNovelChapterStatsMetrics({
  chapterSlug: 'ch1',
  eventRows: [
    { count: 2, event_type: 'chapter_open' },
    { count: 1, event_type: 'like' },
    { count: 1, event_type: 'bookmark' },
    { count: 1, event_type: 'comment_draft' }
  ],
  locale: 'zh-Hant',
  seriesSlug: 'book',
  sessionRows: [
    {
      bookmark_count: 1,
      close_duration_ms: 90000,
      close_progress: 100,
      comment_count: 0,
      first_event_at: '2026-06-26 12:00:00',
      last_event_at: '2026-06-26 12:01:30',
      like_count: 1,
      max_progress: 100,
      max_scroll_depth: 100
    },
    {
      bookmark_count: 0,
      close_duration_ms: 0,
      close_progress: 0,
      comment_count: 1,
      first_event_at: '2026-06-26 12:03:00',
      last_event_at: '2026-06-26 12:04:00',
      like_count: 0,
      max_progress: 45,
      max_scroll_depth: 45
    }
  ],
  windowRow: {
    account_readers: 1,
    event_window_end: '2026-06-26 12:04:00',
    event_window_start: '2026-06-26 12:00:00',
    total_events: 7
  }
});
assert.equal(metrics.uniqueSessions, 2);
assert.equal(metrics.completionCount, 1);
assert.equal(metrics.completionRate, 0.5);
assert.equal(metrics.scrollDepthDistribution['90-100'], 1);
assert.equal(metrics.dropOffPoints[0].position, 'first_half');
assert.equal(metrics.likeCount, 1);

const db = new MockDb();
const aggregateResponse = await hooks.handleAdminAggregateNovelAnalytics(
  new Request('https://wwwstationcat.org/admin/api/novels/analytics/aggregate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seriesSlug: 'book', sinceDays: 30 })
  }),
  { ADMIN_ACCESS_LOCAL_BYPASS: '1', WAITLIST_DB: db }
);
const aggregateBody = await aggregateResponse.json();
assert.equal(aggregateResponse.status, 200);
assert.equal(aggregateBody.aggregated, 1);
assert.equal(db.upserted.length, 1);
assert.equal(db.upserted[0][0], 'book');
assert.equal(db.upserted[0][1], 'ch1');

const listResponse = await hooks.handleAdminListNovelAnalyticsStats(
  new Request('https://wwwstationcat.org/admin/api/novels/analytics/stats?seriesSlug=book'),
  { WAITLIST_DB: new MockDb() }
);
const listBody = await listResponse.json();
assert.equal(listResponse.status, 200);
assert.equal(listBody.summary.chapterCount, 1);
assert.equal(listBody.stats[0].chapterSlug, 'ch1');
assert.equal(listBody.stats[0].dropOffPoints[0].position, 'middle');

const missingStatsResponse = await hooks.handleAdminListNovelAnalyticsStats(
  new Request('https://wwwstationcat.org/admin/api/novels/analytics/stats'),
  { WAITLIST_DB: new MockDb({ missingChapterStats: true }) }
);
assert.equal(missingStatsResponse.status, 503);
assert.equal((await missingStatsResponse.json()).code, 'CHAPTER_STATS_NOT_READY');

console.log('novel analytics stats tests passed');
