"""Local-only failure-boundary tests for the in-memory migration rehearsal."""
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('migration_rehearsal', Path(__file__).with_name('preview-mobile-production-migrations.py'))
preview = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preview)


class MigrationRehearsalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='station-native-migration-source-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for directory in ['migrations', 'migrations-mobile', 'migrations-mobile-candidate']:
            shutil.copytree(preview.ROOT / directory, self.root / directory)

    def append(self, sql, path='migrations-mobile/0004_music_listen_receipt.sql'):
        file = self.root / path
        file.write_text(file.read_text() + '\n' + sql + '\n')
        return {path: hashlib.sha256(file.read_bytes()).hexdigest()}

    def test_complete_local_rehearsal_preserves_website_accounts_balances_and_schema(self):
        report = preview.rehearse(self.root)
        self.assertEqual(report['status'], 'passed')
        self.assertFalse(report['productionApproved'])
        self.assertFalse(report['productionDataTested'])
        self.assertFalse(report['networkUsed'])
        self.assertFalse(report['userDatabaseOpened'])
        self.assertEqual(report['website']['migrationCount'], 37)
        self.assertEqual(report['website']['tableCount'], 50)
        self.assertEqual(report['candidate']['migrationCount'], 5)
        self.assertEqual(len(report['candidate']['newTables']), 15)
        self.assertEqual(len(report['candidate']['newIndexes']), 5)
        self.assertEqual(report['candidate']['markerRows'], 0)
        self.assertEqual(report['checks']['syntheticBalancesPreserved'], [137, 0])
        self.assertEqual(report['checks']['foreignKeyCheck'], 'passed')
        for table in ['reader_accounts', 'reader_sessions', 'reader_credit_accounts', 'reader_credit_ledger']:
            self.assertEqual(report['website']['dataFingerprints'][table]['rows'], 2)
        self.assertTrue(any(row['table'] == 'mobile_codes' and row['referencesTable'] == 'reader_accounts'
                            for row in report['candidate']['foreignKeyDependencies']))
        self.assertEqual(len(report['migrationFiles']), 42)
        for file in report['migrationFiles']:
            self.assertEqual(file['sha256'], hashlib.sha256((self.root / file['path']).read_bytes()).hexdigest())
        self.assertFalse(any(self.root.rglob('*.db')))

    def test_missing_last_migration_or_marker_fails_closed(self):
        for path in ['migrations/0037_membership_refund_reviews.sql',
                     'migrations-mobile/0004_music_listen_receipt.sql',
                     'migrations-mobile-candidate/0001_binding_identity.sql']:
            file = self.root / path
            data = file.read_bytes()
            file.unlink()
            with self.subTest(path=path), self.assertRaisesRegex(preview.RehearsalError, 'MIGRATION_SET_CHANGED'):
                preview.rehearse(self.root)
            file.write_bytes(data)

    def test_modified_even_syntactically_valid_source_requires_new_review(self):
        self.append('-- A different candidate must not reuse the old rehearsal input pins.')
        with self.assertRaisesRegex(preview.RehearsalError, 'MIGRATION_SOURCE_CHANGED'):
            preview.rehearse(self.root)

    def test_unexpected_or_symlinked_source_is_rejected(self):
        extra = self.root / 'migrations-mobile/0005_unreviewed.sql'
        extra.write_text('SELECT 1;')
        with self.assertRaisesRegex(preview.RehearsalError, 'MIGRATION_SET_CHANGED'):
            preview.rehearse(self.root)
        extra.unlink()
        link = self.root / 'migrations-mobile/0004_music_listen_receipt.sql'
        link.unlink()
        link.symlink_to(preview.ROOT / 'migrations-mobile/0004_music_listen_receipt.sql')
        with self.assertRaisesRegex(preview.RehearsalError, 'MIGRATION_FILE_MISSING_OR_LINKED'):
            preview.rehearse(self.root)

    def test_bad_sql_still_fails_if_its_new_hash_was_explicitly_selected(self):
        with patch.dict(preview.SOURCE_SHA256, self.append('THIS IS NOT VALID SQL;')):
            with self.assertRaisesRegex(preview.RehearsalError, 'SQL_REJECTED'):
                preview.rehearse(self.root)

    def test_composite_foreign_key_columns_keep_their_constraint_and_pairing(self):
        path = 'migrations-mobile/0003_personal_music.sql'
        file = self.root / path
        old = 'PRIMARY KEY(account_id,track_id)\n);\nCREATE INDEX mobile_music_recent_order'
        new = ('PRIMARY KEY(account_id,track_id),\n'
               ' FOREIGN KEY(account_id,track_id) REFERENCES mobile_music_favorites(account_id,track_id)\n'
               ');\nCREATE INDEX mobile_music_recent_order')
        original = file.read_text()
        self.assertIn(old, original)
        file.write_text(original.replace(old, new))
        with patch.dict(preview.SOURCE_SHA256, {path: hashlib.sha256(file.read_bytes()).hexdigest()}):
            dependencies = preview.rehearse(self.root)['candidate']['foreignKeyDependencies']
        compound = [row for row in dependencies if row['table'] == 'mobile_music_recent' and row['referencesTable'] == 'mobile_music_favorites']
        self.assertEqual(len(compound), 2)
        self.assertEqual(compound[0]['constraintId'], compound[1]['constraintId'])
        ordered = sorted(compound, key=lambda row: row['columnSequence'])
        self.assertEqual([(row['columnSequence'], row['from'], row['referencesColumn']) for row in ordered],
                         [(0, 'account_id', 'account_id'), (1, 'track_id', 'track_id')])

    def test_native_migrations_cannot_mutate_existing_website_schema_or_balance(self):
        path = self.root / 'migrations-mobile/0004_music_listen_receipt.sql'
        original = path.read_bytes()
        for sql in ['UPDATE reader_credit_accounts SET balance_credits=0;',
                    'ALTER TABLE reader_accounts ADD COLUMN unreviewed TEXT;',
                    'DROP TABLE reader_sessions;', 'PRAGMA foreign_keys=OFF;']:
            path.write_bytes(original)
            with self.subTest(sql=sql), patch.dict(preview.SOURCE_SHA256, self.append(sql)):
                with self.assertRaisesRegex(preview.RehearsalError, 'SQL_REJECTED'):
                    preview.rehearse(self.root)

    def test_sql_cannot_open_or_export_an_external_database(self):
        path = self.root / 'migrations-mobile/0004_music_listen_receipt.sql'
        original = path.read_bytes()
        outside = self.root / 'must-not-exist.db'
        for sql in ["ATTACH DATABASE '" + str(outside) + "' AS external;", "VACUUM INTO '" + str(outside) + "';"]:
            path.write_bytes(original)
            with self.subTest(sql=sql), patch.dict(preview.SOURCE_SHA256, self.append(sql)):
                with self.assertRaisesRegex(preview.RehearsalError, 'SQL_REJECTED'):
                    preview.rehearse(self.root)
                self.assertFalse(outside.exists())

    def test_candidate_marker_remains_empty(self):
        sql = "INSERT INTO station_native_binding_identity VALUES (1,'synthetic','synthetic','reader','synthetic','synthetic');"
        with patch.dict(preview.SOURCE_SHA256, self.append(sql, 'migrations-mobile-candidate/0001_binding_identity.sql')):
            with self.assertRaisesRegex(preview.RehearsalError, 'NATIVE_OR_MARKER_TABLE_NOT_EMPTY'):
                preview.rehearse(self.root)

    def test_foreign_key_violation_and_missing_native_index_fail(self):
        path = self.root / 'migrations-mobile/0004_music_listen_receipt.sql'
        original = path.read_bytes()
        for sql, expected in [('INSERT INTO mobile_music_state(account_id) VALUES(99999999);', 'SQL_REJECTED'),
                              ('DROP INDEX mobile_music_recent_order;', 'NATIVE_INDEX_SET_CHANGED'),
                              ('CREATE TABLE sqliteXunreviewed(value TEXT);', 'NATIVE_TABLE_SET_CHANGED')]:
            path.write_bytes(original)
            with self.subTest(sql=sql), patch.dict(preview.SOURCE_SHA256, self.append(sql)):
                with self.assertRaisesRegex(preview.RehearsalError, expected):
                    preview.rehearse(self.root)

    def test_cli_accepts_only_new_json_reports_and_never_overwrites(self):
        output = self.root / 'review.json'
        with patch.object(preview.sys, 'argv', ['preview', '--output', str(output)]):
            self.assertEqual(preview.main(), 0)
            first = output.read_bytes()
            with redirect_stderr(io.StringIO()) as error:
                self.assertEqual(preview.main(), 1)
            self.assertEqual(output.read_bytes(), first)
            self.assertEqual(json.loads(error.getvalue())['status'], 'failed')
        with patch.object(preview.sys, 'argv', ['preview', '--production-url', 'https://example.test']), redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                preview.main()
        with patch.object(preview.sys, 'argv', ['preview', '--output', 'https://example.test/report.json']), redirect_stderr(io.StringIO()):
            self.assertEqual(preview.main(), 1)

    def test_failed_rehearsal_does_not_emit_a_success_report(self):
        output = self.root / 'failed.json'
        with patch.object(preview, 'rehearse', side_effect=preview.RehearsalError('MIGRATION_SOURCE_CHANGED:fixture')):
            with patch.object(preview.sys, 'argv', ['preview', '--output', str(output)]), redirect_stderr(io.StringIO()) as error, redirect_stdout(io.StringIO()) as success:
                self.assertEqual(preview.main(), 1)
        self.assertFalse(output.exists())
        self.assertEqual(success.getvalue(), '')
        self.assertEqual(json.loads(error.getvalue())['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
