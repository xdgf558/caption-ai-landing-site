import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const account = {
  account_created_at: '2026-06-26 10:00:00',
  account_id: 7,
  display_name: 'Wang',
  email: 'reader@example.com',
  normalized_email: 'reader@example.com',
  session_expires_at: '2026-07-01 00:00:00',
  session_id: 11,
  username: 'wangxia789'
};

class MockBoundStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  async first() {
    if (/SELECT id FROM reader_comments LIMIT 1/i.test(this.sql)) {
      if (this.db.missingReaderComments) throw new Error('D1_ERROR: no such table: reader_comments');
      return null;
    }
    if (/SELECT id FROM content_entries LIMIT 1/i.test(this.sql)) {
      if (this.db.missingContentEntries) throw new Error('D1_ERROR: no such table: content_entries');
      return null;
    }
    if (/SELECT id FROM reading_events LIMIT 1/i.test(this.sql)) {
      return null;
    }
    if (/SELECT account_id FROM reader_memberships LIMIT 1/i.test(this.sql)) {
      return null;
    }
    if (/SELECT id FROM admin_content_settings LIMIT 1/i.test(this.sql)) {
      return null;
    }
    if (/SELECT COUNT\(\*\) AS count\s+FROM reader_comments\s+WHERE account_id = \?/i.test(this.sql)) {
      return { count: this.db.recentCommentCount };
    }
    if (/FROM content_entries/i.test(this.sql) && /entry_type = 'novel_chapter'/i.test(this.sql)) {
      if (this.db.missingChapter) return null;
      return {
        access_level: this.db.chapterAccessLevel,
        id: 101,
        locale: this.params[2] || 'zh-Hant',
        parent_slug: this.params[0],
        slug: this.params[1],
        title: 'Test Chapter'
      };
    }
    if (/FROM reader_sessions/i.test(this.sql)) {
      return this.db.session || null;
    }
    if (/FROM reader_memberships\s+WHERE account_id = \?/i.test(this.sql)) {
      return this.db.membership || null;
    }
    if (/FROM novel_entitlements/i.test(this.sql) && /WHERE account_id = \?/i.test(this.sql)) {
      return this.db.entitlement || null;
    }
    if (/SELECT\s+reader_comments\.\*/i.test(this.sql) && /WHERE reader_comments\.id = \?/i.test(this.sql)) {
      return this.db.comments.get(this.params[0]) || null;
    }
    return null;
  }

  async all() {
    if (/FROM reader_comments/i.test(this.sql)) {
      const rows = [...this.db.comments.values()];
      if (/reader_comments\.status = 'approved'/i.test(this.sql)) {
        return { results: rows.filter((row) => row.status === 'approved') };
      }
      if (/reader_comments\.status = \?/i.test(this.sql)) {
        return { results: rows.filter((row) => row.status === this.params[0]) };
      }
      return { results: rows.filter((row) => row.status !== 'deleted') };
    }
    return { results: [] };
  }

  async run() {
    if (/UPDATE reader_sessions SET last_seen_at/i.test(this.sql)) {
      return { success: true, meta: { changes: 1 } };
    }
    if (/INSERT INTO reader_comments/i.test(this.sql)) {
      const row = {
        id: this.params[0],
        account_id: this.params[1],
        series_slug: this.params[2],
        chapter_slug: this.params[3],
        locale: this.params[4],
        body: this.params[5],
        status: 'pending',
        source_path: this.params[6],
        metadata_json: this.params[7],
        ip_hash: this.params[8],
        user_agent_hash: this.params[9],
        reviewed_by: '',
        reviewed_at: '',
        hidden_reason: '',
        created_at: '2026-06-26 12:00:00',
        updated_at: '2026-06-26 12:00:00',
        display_name: account.display_name,
        email: account.email,
        username: account.username
      };
      this.db.comments.set(row.id, row);
      return { success: true, meta: { changes: 1 } };
    }
    if (/INSERT INTO reading_events/i.test(this.sql)) {
      this.db.readingEvents.push({
        clientEventId: this.params[0],
        accountId: this.params[1],
        eventType: this.params[6],
        metadataJson: this.params[12]
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (/UPDATE reader_comments/i.test(this.sql)) {
      const row = this.db.comments.get(this.params[3]);
      if (row) {
        row.status = this.params[0];
        row.reviewed_by = this.params[1];
        row.reviewed_at = '2026-06-26 12:05:00';
        row.hidden_reason = this.params[2];
        row.updated_at = '2026-06-26 12:05:00';
      }
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (/INSERT INTO admin_audit_logs/i.test(this.sql)) {
      this.db.auditLogs.push({ action: this.params[1], targetId: this.params[3] });
      return { success: true, meta: { changes: 1 } };
    }
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
    this.auditLogs = [];
    this.chapterAccessLevel = options.chapterAccessLevel || 'free';
    this.comments = new Map();
    this.entitlement = options.entitlement || null;
    this.membership = options.membership || null;
    this.missingChapter = Boolean(options.missingChapter);
    this.missingContentEntries = Boolean(options.missingContentEntries);
    this.missingReaderComments = Boolean(options.missingReaderComments);
    this.readingEvents = [];
    this.recentCommentCount = Number(options.recentCommentCount || 0);
    this.session = options.session || null;
    (options.comments || []).forEach((comment) => this.comments.set(comment.id, comment));
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }
}

const migrationSource = read('migrations/0017_reader_comments.sql');
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS reader_comments/);
assert.match(migrationSource, /status TEXT NOT NULL DEFAULT 'pending'/);
assert.match(migrationSource, /idx_reader_comments_chapter_status_created/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /handleReaderCommentSubmit/);
assert.match(workerSource, /handlePublicNovelComments/);
assert.match(workerSource, /handleAdminModerateReaderComment/);
assert.match(workerSource, /'comment_submit'/);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /data-admin-v2-tab="comments"/);
assert.match(adminSource, /admin\/api\/novels\/comments\/moderate/);
assert.match(adminSource, /章节评论审核/);

const staticReaderSource = read('src/components/SerialChapterPage.astro');
assert.match(staticReaderSource, /commentSubmitEndpoint = '\/api\/readers\/comments'/);
assert.match(staticReaderSource, /data-reader-comment-submit/);
assert.match(staticReaderSource, /data-reader-comments-list/);

const unauthDb = new MockDb();
const unauthResponse = await hooks.handleReaderCommentSubmit(
  new Request('https://wwwstationcat.org/api/readers/comments', {
    method: 'POST',
    body: JSON.stringify({ body: '好看', chapterSlug: 'ch1', seriesSlug: 'book' })
  }),
  { WAITLIST_DB: unauthDb }
);
assert.equal(unauthResponse.status, 401);
assert.equal((await unauthResponse.json()).code, 'SIGN_IN_REQUIRED');

const limitedDb = new MockDb({ recentCommentCount: 5, session: account });
const limitedResponse = await hooks.handleReaderCommentSubmit(
  new Request('https://wwwstationcat.org/api/readers/comments', {
    method: 'POST',
    headers: {
      cookie: 'station_cat_reader_session=test-session',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ body: '好看', chapterSlug: 'ch1', seriesSlug: 'book' })
  }),
  { WAITLIST_DB: limitedDb }
);
assert.equal(limitedResponse.status, 429);
assert.equal((await limitedResponse.json()).code, 'READER_COMMENT_RATE_LIMITED');

const db = new MockDb({ session: account });
const submitResponse = await hooks.handleReaderCommentSubmit(
  new Request('https://wwwstationcat.org/api/readers/comments', {
    method: 'POST',
    headers: {
      cookie: 'station_cat_reader_session=test-session',
      'cf-connecting-ip': '203.0.113.1',
      'content-type': 'application/json',
      'user-agent': 'Unit Test'
    },
    body: JSON.stringify({
      body: '这一章的课堂冲突很好看。',
      chapterSlug: 'ch1',
      locale: 'zh-Hant',
      seriesSlug: 'book',
      sessionId: 'session-reader-1',
      sourcePath: '/novel/book/chapter/ch1/'
    })
  }),
  { WAITLIST_DB: db }
);
assert.equal(submitResponse.status, 200);
const submitPayload = await submitResponse.json();
assert.equal(submitPayload.ok, true);
assert.equal(submitPayload.comment.status, 'pending');
assert.equal(db.readingEvents.length, 1);
assert.equal(db.readingEvents[0].eventType, 'comment_submit');

const protectedSubmitDb = new MockDb({ chapterAccessLevel: 'paid', session: account });
const protectedSubmitResponse = await hooks.handleReaderCommentSubmit(
  new Request('https://wwwstationcat.org/api/readers/comments', {
    method: 'POST',
    headers: {
      cookie: 'station_cat_reader_session=test-session',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ body: '还没解锁也想评论', chapterSlug: 'paid-ch1', seriesSlug: 'book' })
  }),
  { WAITLIST_DB: protectedSubmitDb }
);
assert.equal(protectedSubmitResponse.status, 403);
assert.equal((await protectedSubmitResponse.json()).code, 'CHAPTER_COMMENT_ACCESS_REQUIRED');

const protectedAuthorizedDb = new MockDb({
  chapterAccessLevel: 'paid',
  entitlement: {
    access_level: 'paid',
    account_id: account.account_id,
    chapter_slug: 'paid-ch1',
    id: 88,
    scope: 'chapter',
    series_slug: 'book'
  },
  session: account
});
const protectedAuthorizedResponse = await hooks.handleReaderCommentSubmit(
  new Request('https://wwwstationcat.org/api/readers/comments', {
    method: 'POST',
    headers: {
      cookie: 'station_cat_reader_session=test-session',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ body: '解锁后评论正常。', chapterSlug: 'paid-ch1', seriesSlug: 'book' })
  }),
  { WAITLIST_DB: protectedAuthorizedDb }
);
assert.equal(protectedAuthorizedResponse.status, 200);
assert.equal(protectedAuthorizedDb.readingEvents[0].eventType, 'comment_submit');

const pendingComment = [...db.comments.values()][0];
const publicEmpty = await hooks.handlePublicNovelComments(
  new Request('https://wwwstationcat.org/api/novels/comments?seriesSlug=book&chapterSlug=ch1'),
  { WAITLIST_DB: db }
);
assert.deepEqual((await publicEmpty.json()).comments, []);

const protectedApprovedComment = {
  account_id: account.account_id,
  body: '这一段有剧透。',
  chapter_slug: 'paid-ch1',
  created_at: '2026-06-26 12:00:00',
  display_name: account.display_name,
  email: account.email,
  hidden_reason: '',
  id: 'rc_protected',
  ip_hash: '',
  locale: 'zh-Hant',
  metadata_json: '{}',
  reviewed_at: '',
  reviewed_by: '',
  series_slug: 'book',
  source_path: '/novel/book/chapter/paid-ch1/',
  status: 'approved',
  updated_at: '2026-06-26 12:00:00',
  user_agent_hash: '',
  username: account.username
};
const protectedPublicDb = new MockDb({
  chapterAccessLevel: 'paid',
  comments: [protectedApprovedComment]
});
const protectedPublicResponse = await hooks.handlePublicNovelComments(
  new Request('https://wwwstationcat.org/api/novels/comments?seriesSlug=book&chapterSlug=paid-ch1'),
  { WAITLIST_DB: protectedPublicDb }
);
assert.equal(protectedPublicResponse.status, 401);
const protectedPublicPayload = await protectedPublicResponse.json();
assert.equal(protectedPublicPayload.code, 'SIGN_IN_REQUIRED');
assert.deepEqual(protectedPublicPayload.comments, []);

const moderateResponse = await hooks.handleAdminModerateReaderComment(
  new Request('http://localhost/admin/api/novels/comments/moderate', {
    method: 'POST',
    body: JSON.stringify({ action: 'approve', id: pendingComment.id })
  }),
  { WAITLIST_DB: db }
);
assert.equal(moderateResponse.status, 200);
assert.equal((await moderateResponse.json()).comment.status, 'approved');
assert.equal(db.auditLogs[0].action, 'reader_comment.approve');

const publicApproved = await hooks.handlePublicNovelComments(
  new Request('https://wwwstationcat.org/api/novels/comments?seriesSlug=book&chapterSlug=ch1'),
  { WAITLIST_DB: db }
);
const publicPayload = await publicApproved.json();
assert.equal(publicPayload.comments.length, 1);
assert.equal(publicPayload.comments[0].body, '这一章的课堂冲突很好看。');
assert.equal(publicPayload.comments[0].email, undefined);

const adminList = await hooks.handleAdminListReaderComments(
  new Request('http://localhost/admin/api/novels/comments?status=approved'),
  { WAITLIST_DB: db }
);
const adminPayload = await adminList.json();
assert.equal(adminPayload.comments.length, 1);
assert.equal(adminPayload.comments[0].email, 'reader@example.com');

console.log('Reader comments tests passed.');
