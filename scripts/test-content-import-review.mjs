import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildContentImportListQuery } from '../src/contentImportReview.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(read('migrations/0007_backend_content_platform.sql'));
db.exec(read('migrations/0027_content_import_review_indexes.sql'));

const insertImport = db.prepare(
  `INSERT INTO content_imports (id, import_type, filename, status, updated_at)
   VALUES (?, ?, ?, ?, ?)`
);
const insertEntry = db.prepare(
  `INSERT INTO content_entries (
     entry_type, slug, title, status, source_kind, source_ref
   )
   VALUES (?, ?, ?, ?, ?, ?)`
);

insertImport.run(1, 'novelforge', 'novel-published', 'completed', '2026-07-26 01:00:00');
insertEntry.run('novel_chapter', 'published', 'Published', 'published', 'novelforge', 'novel-published');

insertImport.run(2, 'novelforge', 'novel-scheduled', 'completed', '2026-07-26 02:00:00');
insertEntry.run('novel_chapter', 'scheduled', 'Scheduled', 'scheduled', 'novelforge', 'novel-scheduled');

insertImport.run(3, 'novelforge', 'novel-failed', 'failed', '2026-07-26 03:00:00');
insertImport.run(4, 'novelforge', 'novel-processing', 'processing', '2026-07-26 04:00:00');
insertImport.run(5, 'novelforge', 'novel-warning-complete', 'completed_with_warnings', '2026-07-26 05:00:00');

insertImport.run(6, 'signal_brief', 'signal-manual', 'completed', '2026-07-26 06:00:00');
insertEntry.run('signal_brief', 'signal-manual', 'Signal manual', 'draft', 'signal_brief', 'signal-manual');

insertImport.run(7, 'signal_brief', 'signal-automation', 'completed', '2026-07-26 07:00:00');
insertEntry.run('signal_brief', 'signal-automation', 'Signal automation', 'scheduled', 'signal_automation', 'signal-automation');

const queryImports = (options) => {
  const query = buildContentImportListQuery(options);
  return db.prepare(query.sql).all(...query.params);
};

const pendingNovelForge = queryImports({
  importType: 'novelforge',
  limit: 50,
  review: 'pending'
});
assert.deepEqual(
  pendingNovelForge.map((row) => row.filename),
  ['novel-processing', 'novel-failed', 'novel-scheduled'],
  'Pending NovelForge review should retain processing, failed, and unpublished batches.'
);

const pendingNovelForgeQuery = buildContentImportListQuery({
  importType: 'novelforge',
  limit: 50,
  review: 'pending'
});
const pendingQueryPlan = db
  .prepare(`EXPLAIN QUERY PLAN ${pendingNovelForgeQuery.sql}`)
  .all(...pendingNovelForgeQuery.params);
assert.ok(
  pendingQueryPlan.some((step) => String(step.detail).includes('idx_content_entries_source')),
  'Pending review should use the content source lookup index.'
);

const allNovelForge = queryImports({
  importType: 'novelforge',
  limit: 50,
  review: 'all'
});
assert.equal(allNovelForge.length, 5, 'All review should retain published history.');

const pendingSignals = queryImports({
  importType: 'signal_brief',
  limit: 50,
  review: 'pending'
});
assert.deepEqual(
  pendingSignals.map((row) => row.filename),
  ['signal-automation', 'signal-manual'],
  'Signal review should match both manual and automated source kinds.'
);

assert.throws(
  () => insertImport.run(8, 'novelforge', 'novel-published', 'processing', '2026-07-26 08:00:00'),
  /UNIQUE constraint failed/,
  'Import request IDs should be unique within each import type.'
);

const contentEntryIndexes = db.prepare(`PRAGMA index_list('content_entries')`).all();
assert.ok(
  contentEntryIndexes.some((index) => index.name === 'idx_content_entries_source'),
  'The source lookup index should be installed.'
);

console.log('content import review query and migration tests passed');
