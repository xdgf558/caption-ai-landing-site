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
    if (/SELECT id FROM reading_events LIMIT 1/i.test(this.sql)) {
      if (this.db.missingReadingEvents) throw new Error('D1_ERROR: no such table: reading_events');
      return null;
    }
    return null;
  }

  async run() {
    this.db.executed.push(this);
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
    this.executed = [];
    this.missingReadingEvents = Boolean(options.missingReadingEvents);
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    this.executed.push(...statements);
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }
}

const migrationSource = read('migrations/0014_reading_events.sql');
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS reading_events/);
assert.match(migrationSource, /client_event_id TEXT NOT NULL UNIQUE/);
assert.match(migrationSource, /user_agent_hash TEXT NOT NULL DEFAULT ''/);
assert.match(migrationSource, /idx_reading_events_chapter_created/);

const astroSource = read('src/components/SerialChapterPage.astro');
assert.match(astroSource, /readingEventsEndpoint = '\/api\/novels\/reading-events'/);
assert.match(astroSource, /trackReadingEvent\('chapter_open'\)/);
assert.match(astroSource, /trackReadingEvent\('chapter_close'/);
assert.match(astroSource, /trackReadingEvent\('scroll_depth'/);
assert.match(astroSource, /trackReadingEvent\('reading_pause'\)/);
assert.match(astroSource, /trackReadingEvent\('reading_resume'\)/);
assert.match(astroSource, /data-reader-nav="next"/);
assert.match(astroSource, /window\.stationCatReadingEvents\?\.track\?\.\('bookmark'/);
assert.match(astroSource, /window\.stationCatReadingEvents\?\.track\?\.\('comment_post'/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /const novelReadingEventsPath = '\/api\/novels\/reading-events'/);
assert.match(workerSource, /const novelReadingEventTypes = new Set/);
assert.match(workerSource, /renderDynamicReadingEventsScript/);
assert.match(workerSource, /data-reader-nav="prev"/);
assert.match(workerSource, /handleNovelReadingEvents/);

const normalized = hooks.normalizeReadingEventPayload({
  blockIndex: 42,
  chapterSlug: 'Chapter One!',
  clientEventId: 'client-event-123',
  durationMs: 1200,
  eventType: 'scroll_depth',
  locale: 'zh-Hant',
  metadata: {
    length: 20,
    note: 'x'.repeat(500),
    nested: { ignored: true },
    ok: true
  },
  progressPercent: 200,
  seriesSlug: 'Book One',
  sessionId: 'session-123',
  sourcePath: '/novel/book-one/chapter/chapter-one/',
  value: 68
});

assert.equal(normalized.seriesSlug, 'book-one');
assert.equal(normalized.chapterSlug, 'chapter-one');
assert.equal(normalized.eventType, 'scroll_depth');
assert.equal(normalized.progressPercent, 100);
assert.equal(normalized.blockIndex, 42);
assert.equal(normalized.eventValue, 68);
assert.equal(normalized.metadata.note.length, 300);
assert.equal(normalized.metadata.nested, undefined);

assert.throws(
  () => hooks.normalizeReadingEventPayload({ eventType: 'unknown', seriesSlug: 'book', chapterSlug: 'ch' }),
  /Unsupported reading event type/
);

const db = new MockDb();
const request = new Request('https://wwwstationcat.org/api/novels/reading-events', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'user-agent': 'reader-test',
    'cf-connecting-ip': '203.0.113.10'
  },
  body: JSON.stringify({
    chapterSlug: 'ch1',
    events: [
      {
        clientEventId: 'event-open-123',
        eventType: 'chapter_open',
        progressPercent: 0,
        value: 0
      },
      {
        blockIndex: 12,
        clientEventId: 'event-depth-123',
        eventType: 'scroll_depth',
        metadata: { threshold: 50 },
        progressPercent: 54,
        value: 50
      }
    ],
    locale: 'zh-Hant',
    seriesSlug: 'book',
    sessionId: 'session-abc',
    sourcePath: '/novel/book/chapter/ch1/'
  })
});

const response = await hooks.handleNovelReadingEvents(request, { WAITLIST_DB: db });
const body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.ok, true);
assert.equal(body.accepted, 2);
assert.equal(db.executed.length, 2);
assert.equal(db.executed[0].params[2], 'session-abc');
assert.equal(db.executed[0].params[3], 'book');
assert.equal(db.executed[0].params[4], 'ch1');
assert.equal(db.executed[0].params[6], 'chapter_open');
assert.equal(db.executed[1].params[6], 'scroll_depth');
assert.equal(db.executed[1].params[8], 54);
assert.equal(db.executed[1].params[9], 12);
assert.deepEqual(JSON.parse(db.executed[1].params[12]), { threshold: 50 });

const invalidResponse = await hooks.handleNovelReadingEvents(
  new Request('https://wwwstationcat.org/api/novels/reading-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventType: 'not_allowed', seriesSlug: 'book', chapterSlug: 'ch1' })
  }),
  { WAITLIST_DB: new MockDb() }
);
assert.equal(invalidResponse.status, 400);

const missingResponse = await hooks.handleNovelReadingEvents(
  new Request('https://wwwstationcat.org/api/novels/reading-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventType: 'chapter_open', seriesSlug: 'book', chapterSlug: 'ch1' })
  }),
  { WAITLIST_DB: new MockDb({ missingReadingEvents: true }) }
);
assert.equal(missingResponse.status, 503);
assert.equal((await missingResponse.json()).code, 'READING_EVENTS_NOT_READY');

console.log('novel reading event tests passed');
