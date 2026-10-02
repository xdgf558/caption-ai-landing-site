#!/usr/bin/env python3
"""Review candidate author migration against real repository schema, in memory only.

No database path, network, execution approval, or production deploy option exists.
--preflight prints a read-only candidate assessment of the reconstructed schema.
"""
import argparse
import importlib.util
import json
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'scripts/isolated-lifecycle/migrations'
spec = importlib.util.spec_from_file_location('audit', ROOT / 'scripts/audit-account-deletion.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
original = audit.schema('reader')
EXPECTED_COLUMNS = original.execute("PRAGMA table_info('reader_comments')").fetchall()
EXPECTED_INDEXES = original.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='reader_comments' ORDER BY name").fetchall()
EXPECTED_TABLE_SQL = original.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='reader_comments'").fetchone()[0]
original.close()


def preflight(db, direction='forward'):
    """SELECT/PRAGMA only. No identifiers or row contents leave the report."""
    if direction not in ('forward', 'rollback'):
        raise ValueError('UNKNOWN_DIRECTION')
    expected = list(EXPECTED_COLUMNS)
    if direction == 'rollback':
        author = list(expected[1])
        author[3] = 0
        expected[1] = tuple(author)
    columns = db.execute("PRAGMA table_info('reader_comments')").fetchall()
    foreign = db.execute("PRAGMA foreign_key_list('reader_comments')").fetchall()
    indexes = db.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='reader_comments' ORDER BY name").fetchall()
    # Normalize harmless whitespace only; index order/collation/partial/unique changes fail.
    normalize = lambda rows: [(name, ' '.join(sql.split()) if sql else None) for name, sql in rows]
    triggers = db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='reader_comments'").fetchone()[0]
    anonymous = db.execute('SELECT count(*) FROM reader_comments WHERE account_id IS NULL').fetchone()[0]
    blockers = []
    if columns != expected:
        blockers.append('comment_schema_drift')
    expected_delete = 'CASCADE' if direction == 'forward' else 'SET NULL'
    if foreign != [(0, 0, 'reader_accounts', 'account_id', 'id', 'NO ACTION', expected_delete, 'NONE')]:
        blockers.append('comment_foreign_key_drift')
    expected_sql = EXPECTED_TABLE_SQL
    if direction == 'rollback':
        expected_sql = expected_sql.replace('account_id INTEGER NOT NULL', 'account_id INTEGER').replace('ON DELETE CASCADE', 'ON DELETE SET NULL')
    actual_sql = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='reader_comments'").fetchone()[0]
    ddl_normalize = lambda text: ''.join(text.split()).replace('"', '')
    if ddl_normalize(actual_sql) != ddl_normalize(expected_sql):
        blockers.append('comment_constraints_drift')
    if normalize(indexes) != normalize(EXPECTED_INDEXES):
        blockers.append('comment_index_drift')
    if triggers:
        blockers.append('comment_trigger_review_required')
    inbound = db.execute('''SELECT count(*) FROM sqlite_master m
      JOIN pragma_foreign_key_list(m.name) f ON f."table"='reader_comments'
      WHERE m.type='table' ''').fetchone()[0]
    references = db.execute("SELECT count(*) FROM sqlite_master WHERE type IN ('view','trigger') AND instr(lower(sql),'reader_comments')>0").fetchone()[0]
    if inbound or references:
        blockers.append('comment_dependencies_review_required')
    if db.execute("PRAGMA foreign_key_check('reader_comments')").fetchone():
        blockers.append('comment_orphan_author')
    if direction == 'rollback' and anonymous:
        blockers.append('anonymous_authors_cannot_rollback')
    return {'source': 'repository-schema-only', 'liveDataAccess': False,
            'direction': direction, 'compatible': not blockers,
            'blockers': blockers, 'anonymousAuthorCount': anonymous,
            'policyApproved': False, 'productionExecutionEnabled': False}


def apply_candidate(db, direction):
    assessment = preflight(db, direction)
    if not assessment['compatible']:
        raise ValueError(','.join(assessment['blockers']))
    sql = (MIGRATIONS / f'0001_comment_authors_{direction}.sql').read_text()
    try:
        db.executescript('BEGIN IMMEDIATE;\n' + sql + '\nCOMMIT;')
    except BaseException:
        db.rollback()
        raise


class CommentAuthorMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = audit.schema('reader')
        for account in (1, 2):
            self.db.execute('INSERT INTO reader_accounts(id,email,normalized_email) VALUES(?,?,?)',
                            (account, f'fixture{account}@example.test', f'fixture{account}@example.test'))
            for index, status in enumerate(('approved', 'pending', 'hidden', 'deleted')):
                self.db.execute('''INSERT INTO reader_comments
                  (id,account_id,series_slug,chapter_slug,locale,body,status,source_path,
                   metadata_json,ip_hash,user_agent_hash,reviewed_by,reviewed_at,hidden_reason,created_at,updated_at)
                  VALUES(?,?,'fixture-series','chapter','zh-Hant',?,?,?,?,?,?,?,?,?,'2026-09-20 00:00:00','2026-09-21 00:00:00')''',
                  (f'comment-{account}-{index}', account, f'Fixture text {account} {status}', status,
                   '/fixture', '{"fixture":true}', 'ip-fixture', 'ua-fixture', 'reviewer-fixture',
                   '2026-09-21 00:00:00', 'fixture-hidden-reason'))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def rows(self):
        return self.db.execute('SELECT * FROM reader_comments ORDER BY id').fetchall()

    def schema(self):
        return self.db.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").fetchall()

    def test_preflight_does_not_write_or_claim_approval(self):
        changes, schema, rows = self.db.total_changes, self.schema(), self.rows()
        result = preflight(self.db)
        self.assertTrue(result['compatible'])
        self.assertFalse(result['policyApproved'])
        self.assertFalse(result['productionExecutionEnabled'])
        self.assertEqual((self.db.total_changes, self.schema(), self.rows()), (changes, schema, rows))

    def test_forward_preserves_all_fields_and_indexes(self):
        rows = self.rows()
        apply_candidate(self.db, 'forward')
        self.assertEqual(rows, self.rows())
        self.assertEqual(self.db.execute("PRAGMA table_info('reader_comments')").fetchall()[1][3], 0)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_list('reader_comments')").fetchall()[0][6], 'SET NULL')
        self.assertTrue(preflight(self.db, 'rollback')['compatible'])
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_original_schema_rejects_anonymous_author(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE reader_comments SET account_id=NULL WHERE id='comment-1-0'")
        self.db.rollback()

    def test_forward_supports_anonymous_authors_and_keeps_moderation(self):
        apply_candidate(self.db, 'forward')
        before = self.rows()
        self.db.execute('UPDATE reader_comments SET account_id=NULL WHERE account_id=1')
        self.db.commit()
        after = self.rows()
        for prior, current in zip(before, after):
            expected = list(prior)
            if prior[1] == 1:
                expected[1] = None
            self.assertEqual(tuple(expected), current)
        visible = self.db.execute("SELECT c.id FROM reader_comments c LEFT JOIN reader_accounts a ON a.id=c.account_id WHERE c.status='approved' ORDER BY c.id").fetchall()
        self.assertEqual(visible, [('comment-1-0',), ('comment-2-0',)])

    def test_account_delete_keeps_comment_rows_and_other_account(self):
        apply_candidate(self.db, 'forward')
        other = self.db.execute('SELECT * FROM reader_comments WHERE account_id=2 ORDER BY id').fetchall()
        self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        self.assertEqual(len(self.rows()), 8)
        self.assertEqual(self.db.execute('SELECT count(*) FROM reader_comments WHERE account_id IS NULL').fetchone()[0], 4)
        self.assertEqual(self.db.execute('SELECT * FROM reader_comments WHERE account_id=2 ORDER BY id').fetchall(), other)
        self.assertIsNotNone(self.db.execute('SELECT id FROM reader_accounts WHERE id=2').fetchone())

    def test_rollback_refuses_anonymous_without_changing_data(self):
        apply_candidate(self.db, 'forward')
        self.db.execute("UPDATE reader_comments SET account_id=NULL WHERE id='comment-1-0'")
        self.db.commit()
        rows, schema = self.rows(), self.schema()
        with self.assertRaisesRegex(ValueError, 'anonymous_authors_cannot_rollback'):
            apply_candidate(self.db, 'rollback')
        self.assertEqual((self.rows(), self.schema()), (rows, schema))

    def test_rollback_sql_itself_refuses_anonymous_atomically(self):
        apply_candidate(self.db, 'forward')
        self.db.execute("UPDATE reader_comments SET account_id=NULL WHERE id='comment-1-0'")
        self.db.commit()
        rows, schema = self.rows(), self.schema()
        with self.assertRaises(sqlite3.IntegrityError):
            try:
                self.db.executescript('BEGIN IMMEDIATE;\n' + (MIGRATIONS / '0001_comment_authors_rollback.sql').read_text() + '\nCOMMIT;')
            finally:
                self.db.rollback()
        self.assertEqual((self.rows(), self.schema()), (rows, schema))

    def test_rollback_before_anonymization_restores_original_constraints(self):
        rows = self.rows()
        apply_candidate(self.db, 'forward')
        apply_candidate(self.db, 'rollback')
        self.assertEqual(rows, self.rows())
        self.assertTrue(preflight(self.db)['compatible'])
        self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        self.assertEqual(self.db.execute('SELECT count(*) FROM reader_comments').fetchone()[0], 4)

    def test_unknown_column_refuses_without_changing_comments(self):
        self.db.execute("ALTER TABLE reader_comments ADD COLUMN private_unknown TEXT DEFAULT ''")
        rows = self.rows()
        with self.assertRaisesRegex(ValueError, 'comment_schema_drift'):
            apply_candidate(self.db, 'forward')
        self.assertEqual(rows, self.rows())

    def test_unknown_index_requires_review(self):
        self.db.execute('CREATE INDEX comments_custom ON reader_comments(body)')
        self.assertIn('comment_index_drift', preflight(self.db)['blockers'])

    def test_index_direction_and_partial_constraints_require_review(self):
        self.db.execute('DROP INDEX idx_reader_comments_status_updated')
        self.db.execute("CREATE INDEX idx_reader_comments_status_updated ON reader_comments(status,updated_at DESC) WHERE status='approved'")
        self.assertIn('comment_index_drift', preflight(self.db)['blockers'])

    def test_unknown_trigger_requires_review(self):
        self.db.execute('CREATE TRIGGER comment_custom AFTER UPDATE ON reader_comments BEGIN SELECT 1; END')
        self.assertIn('comment_trigger_review_required', preflight(self.db)['blockers'])

    def test_inbound_foreign_keys_require_review(self):
        self.db.execute('CREATE TABLE comment_references(id TEXT PRIMARY KEY,comment_id TEXT REFERENCES reader_comments(id) ON DELETE CASCADE)')
        self.assertIn('comment_dependencies_review_required', preflight(self.db)['blockers'])

    def test_referencing_views_require_review(self):
        self.db.execute('CREATE VIEW comment_public AS SELECT id FROM reader_comments')
        self.assertIn('comment_dependencies_review_required', preflight(self.db)['blockers'])

    def test_sql_guard_rejects_changed_indexes_without_helper(self):
        self.db.execute('DROP INDEX idx_reader_comments_status_updated')
        self.db.execute('CREATE INDEX idx_reader_comments_status_updated ON reader_comments(status,updated_at DESC)')
        self.db.commit()
        rows, schema = self.rows(), self.schema()
        with self.assertRaises(sqlite3.IntegrityError):
            try:
                self.db.executescript('BEGIN IMMEDIATE;\n' + (MIGRATIONS / '0001_comment_authors_forward.sql').read_text() + '\nCOMMIT;')
            finally:
                self.db.rollback()
        self.assertEqual((self.rows(), self.schema()), (rows, schema))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preflight', action='store_true')
    args, remaining = parser.parse_known_args()
    if args.preflight:
        db = audit.schema('reader')
        print(json.dumps(preflight(db), sort_keys=True))
        db.close()
    else:
        unittest.main(argv=[__file__, *remaining], verbosity=2)
