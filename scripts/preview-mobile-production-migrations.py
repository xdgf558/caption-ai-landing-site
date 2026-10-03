"""Rehearse repository SQL in fresh in-memory SQLite; never open a user database.

No URL, database, Cloudflare, or deployment arguments are supported. The optional
output is a create-only JSON review report, never an executable migration bundle.
"""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
# Exact local source set for this rehearsal; changing SQL requires review of these pins.
SOURCE_SHA256 = {
    'migrations/0001_waitlist.sql': '9834ce3b7e12c217db2196742150046bf58f3fa759fbef505d5ee8dcb9dcb7c5',
    'migrations/0002_download_rate_limits.sql': '50f9e00a7360c5ed3cf259520314bc15e6609bfdc54e3a3e8844bc94a3f2ce62',
    'migrations/0003_reader_accounts.sql': '49eb30c6d38f11bb458911af2c66591b8ad800cb43674b4855d70715f98fb5b0',
    'migrations/0004_novel_entitlements.sql': '2ba8b9e57a1ea888776c294e9615fbd4be5aa35e1fb942edee02d5e2bd39d2ae',
    'migrations/0005_novel_payments.sql': '5246a24004579863c1a9394e7d7359d932f103e68cedfcc87a1da612155f0856',
    'migrations/0006_reader_credits.sql': 'b7e4bea9b57fac3e1546ccf9b8e925da31a67fb9211238148f115e5e676555f1',
    'migrations/0007_backend_content_platform.sql': 'c174517367bf8874ebdd7b66eb5f29cad7ee9a176b69e302028fe0d8ef60dcfb',
    'migrations/0008_admin_content_settings.sql': 'c7b67595eb1874703274891675d674f5a51608252a81a1b94ef32102a2ba7ab4',
    'migrations/0009_reader_memberships.sql': '9584450be399df6dbd233541b3bf640b97a1a6ba90f16694800dce7e4c506f43',
    'migrations/0010_reader_bookmarks.sql': '1eb2b1b4ba5fde5699ec058f20f37ee4d9335a292bf5c4c33345940308ee3837',
    'migrations/0011_reader_password_credentials.sql': '55d4f627346a1b6dc896132d0b7dc27ace6c890dc89beaac377b51318c11d663',
    'migrations/0012_reader_totp_credentials.sql': 'c1eeb055a807f5a511e46ccd618fdcbd4d5f717c0ea7d3c1b1c4d5bfc9666b2a',
    'migrations/0013_reader_totp_reset_attempts.sql': '17f9d73814af92340aec6c32c374f1541858d8973b982f9666b408df6d11fc23',
    'migrations/0014_reading_events.sql': 'a163af85548b36fc60e3c88fe962ba9f7e0f63e51858e995cd2c6e9264c3d5a1',
    'migrations/0015_chapter_stats.sql': '3ffaab11f0a2b6dae46a73a67fbda71d65967b5c9fc720a2c69133a87e78eb90',
    'migrations/0016_ai_insights.sql': '80c7268d4fbcfa68c9e9590775d3d7625d2523a215fb8ff70e245da3a1f01026',
    'migrations/0017_reader_comments.sql': 'de786764d8286153a9ec6e6d340d7225909111c30b4d1e29f93cc789efc1a247',
    'migrations/0018_product_feedback.sql': 'd952c5d5305087d757880fa5a1221b295a7754133f8343bd94ac4c6924eaeaf3',
    'migrations/0019_signal_automation.sql': 'f37ecde19fbaebae7d57e720fcf5bf82a4686b81f64d2f9d23a300b6022c0aa6',
    'migrations/0020_signal_collection.sql': 'ebf22836312c95ee518614062f7620c06b492d3062e7e9acd1fbb5e9bae8fb7f',
    'migrations/0021_signal_candidate_triage.sql': '615080e3ac443a7fab1bf19d10bf6e2918cc919c0dd3a17a4cd3274669bcb182',
    'migrations/0022_signal_source_adapters.sql': '460ade3cc1e9d78c744436adcb22add4e2636a275bc2e95b396e37aa32d366f0',
    'migrations/0023_signal_candidate_deduplication.sql': 'd74c8046cc2a0e40d69254120a458ea5f2df676a57ff49f1c12880aef9b29546',
    'migrations/0024_signal_operations.sql': 'ba13024d261c788b45d83e07b9f3affcb3edba035fcf07bbfa8d5a8104c51adc',
    'migrations/0025_signal_model_rollout.sql': 'e918bcc56c96d00bc0ebf5dc400df9f423fe49c5a122e2827ad377eb3b51fc22',
    'migrations/0026_archive_paused_signal_sources.sql': '263e818818d17b6273e6a3c2de77a966310d831db1eff5c64eea63d88da38816',
    'migrations/0027_content_import_review_indexes.sql': '3256ea8d4ca0209e477b08763c27fdcaee24b391ff48340f05e88419e96b3cf6',
    'migrations/0028_station_points.sql': '07592a7fb9b994f25545a32a80d3db7b61d6c3cfd18f6993b10eff17e84b1ebe',
    'migrations/0029_creem_credit_topup_idempotency.sql': '880b7fd8aec712ae9687dada631cfcc4ec0f6bbfcf311bfaa131b10215668a85',
    'migrations/0030_creem_reversals_and_event_ids.sql': '5aae0f645d543e6e945816995786ee4385b2de0c61c2462a9a5dd0697a549b72',
    'migrations/0031_reader_game_saves.sql': 'fe47874df69798b4aa11d48861ac3f318aa0ad9178527e3bf88afea97d7d0bae',
    'migrations/0032_reader_game_save_recovery.sql': '44267eca8c9a83bf3384080570fada7318d6c0e617baa4b4c762984a874d2045',
    'migrations/0033_cat_life_game_commerce.sql': '7bd11508ff80dadb9d8c0a246f87ecc177b9fb30d7ed8d86f21682c7b6612d86',
    'migrations/0034_cat_life_game_commerce_api.sql': '7f1651968dd0b6d14f62ab4fb6e3a50c40b245d96fcfa32f19ca0effe10f436f',
    'migrations/0035_cat_life_game_commerce_admin.sql': 'fcc129eeb5b4c98c7c1d395162d1942a6973598351dfe7d670be4241dbfb8b58',
    'migrations/0036_reader_membership_redemptions.sql': '5da3296aab5535c123fd007805cd0f9aa4faeb4926ac775783198c6c3765e9cd',
    'migrations/0037_membership_refund_reviews.sql': 'c572ac43dc4b8248aa71534399711019e1cf5f708b44bd80fabb9f6876c6f8f4',
    'migrations-mobile/0001_native_auth.sql': 'e74329fd93ccc85915a296de9bad1549aa919b093c5a707e9f78a0656fe2dc5b',
    'migrations-mobile/0002_music_playback_grants.sql': 'f47f0d8bb9275b58870751b3f427e85dd153c5d847c90ab0273ce524040b3b31',
    'migrations-mobile/0003_personal_music.sql': 'd733869052d49b3c590d67f0ba08d2fe827d4509fba869f57455c8d440273566',
    'migrations-mobile/0004_music_listen_receipt.sql': '52f79afaafbf352f1055e6d4ad4577ea7ad889259966588b79082f321d88c7ab',
    'migrations-mobile-candidate/0001_binding_identity.sql': '77f440fa76d20f266f6ff946c249a5cf6bd2c58aae8aaf9af4c1980feced1493',
}
EXPECTED_TABLES = {
    'mobile_assert', 'mobile_browser_flows', 'mobile_codes', 'mobile_sessions',
    'mobile_refresh_tokens', 'mobile_refresh_operations', 'mobile_deletions',
    'mobile_deletion_outbox', 'mobile_rate_limits', 'mobile_playback_grants',
    'mobile_music_state', 'mobile_music_favorites', 'mobile_music_operations',
    'mobile_music_recent', 'station_native_binding_identity',
}
EXPECTED_INDEXES = {'mobile_sessions_account', 'mobile_one_deletion',
                    'mobile_playback_grants_expiry', 'mobile_playback_grants_session',
                    'mobile_music_recent_order'}


class RehearsalError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise RehearsalError(reason)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sources(root):
    result = []
    for directory in ['migrations', 'migrations-mobile', 'migrations-mobile-candidate']:
        expected = sorted(Path(path).name for path in SOURCE_SHA256 if Path(path).parent.name == directory)
        folder = root / directory
        require(folder.is_dir() and not folder.is_symlink(), 'MIGRATION_DIRECTORY_MISSING_OR_LINKED:' + directory)
        require(sorted(path.name for path in folder.glob('*.sql')) == sorted(expected),
                'MIGRATION_SET_CHANGED:' + directory)
        for name in expected:
            path = folder / name
            require(path.is_file() and not path.is_symlink(), 'MIGRATION_FILE_MISSING_OR_LINKED:' + directory + '/' + name)
            data = path.read_bytes()
            require(bool(data.strip()), 'MIGRATION_EMPTY:' + directory + '/' + name)
            require(digest(data) == SOURCE_SHA256[directory + '/' + name], 'MIGRATION_SOURCE_CHANGED:' + directory + '/' + name)
            result.append({'path': directory + '/' + name, 'sha256': digest(data),
                           'bytes': len(data), 'sql': data.decode('utf-8')})
    return result


def schema(db):
    return list(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master "
                           "WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name"))


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def data_fingerprint(db, tables):
    def value(item):
        return {'blobHex': item.hex()} if isinstance(item, bytes) else item
    result = {}
    for table in tables:
        rows = [[value(item) for item in row] for row in db.execute('SELECT * FROM ' + quoted(table))]
        result[table] = {'rows': len(rows), 'sha256': digest(json_bytes(sorted(rows, key=json_bytes)))}
    return result


def checks(db):
    require(db.execute('PRAGMA foreign_keys').fetchone() == (1,), 'FOREIGN_KEYS_DISABLED')
    require(not list(db.execute('PRAGMA foreign_key_check')), 'FOREIGN_KEY_CHECK_FAILED')
    require(list(db.execute('PRAGMA integrity_check')) == [('ok',)], 'INTEGRITY_CHECK_FAILED')


def seed_website_fixture(db):
    # These deliberately synthetic rows exist only inside this :memory: connection.
    for account, balance in [(810001, 137), (810002, 0)]:
        email = 'migration-fixture-' + str(account) + '@example.test'
        db.execute("INSERT INTO reader_accounts (id,email,normalized_email,display_name,status,created_at,updated_at) "
                   "VALUES (?,?,?,'Synthetic migration fixture','active','2026-10-03','2026-10-03')", (account, email, email))
        db.execute("INSERT INTO reader_sessions (account_id,session_hash,expires_at,created_at,last_seen_at) "
                   "VALUES (?,?,'2030-01-01','2026-10-03','2026-10-03')", (account, 'not-a-real-session-' + str(account)))
        db.execute("INSERT INTO reader_credit_accounts (account_id,balance_credits,lifetime_purchased_credits,"
                   "lifetime_spent_credits,currency_label,created_at,updated_at) VALUES (?,?,?,0,'Station Points','2026-10-03','2026-10-03')",
                   (account, balance, balance))
        db.execute("INSERT INTO reader_credit_ledger (account_id,entry_type,credits_delta,balance_after,source,source_ref,created_at) "
                   "VALUES (?,'synthetic-rehearsal',?,?,'local-memory-fixture',?,'2026-10-03')",
                   (account, balance, balance, 'fixture-' + str(account)))
    db.commit()


def rehearse(root=ROOT):
    files = sources(Path(root))
    protected_tables, protected_objects = set(), set()

    def authorize(action, first, second, _database, _trigger):
        if action in {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_CREATE_VTABLE}:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and (second or '').lower() == 'load_extension':
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_PRAGMA:
            allowed = {'foreign_key_check', 'integrity_check', 'quick_check', 'foreign_key_list', 'table_xinfo', 'index_list', 'index_xinfo'}
            if (first or '').lower() == 'foreign_keys':
                return sqlite3.SQLITE_OK if second is None or second.lower() in {'1', 'on'} else sqlite3.SQLITE_DENY
            if (first or '').lower() not in allowed:
                return sqlite3.SQLITE_DENY
        if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE} and first in protected_tables:
            return sqlite3.SQLITE_DENY
        if action in {sqlite3.SQLITE_DROP_TABLE, sqlite3.SQLITE_DROP_INDEX, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_DROP_TRIGGER} and first in protected_objects:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_ALTER_TABLE and second in protected_tables:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    # The only database connection in this tool is hard-coded in-memory.
    with closing(sqlite3.connect(':memory:')) as db:
        if hasattr(db, 'enable_load_extension'):
            db.enable_load_extension(False)
        db.set_authorizer(authorize)
        db.execute('PRAGMA foreign_keys=ON')

        def apply(file):
            try:
                db.executescript(file['sql'])
                checks(db)
            except sqlite3.Error as error:
                raise RehearsalError('SQL_REJECTED:' + file['path']) from error

        website = [file for file in files if file['path'].startswith('migrations/')]
        native = [file for file in files if not file['path'].startswith('migrations/')]
        for file in website:
            apply(file)
        before_schema = schema(db)
        tables = sorted(row[1] for row in before_schema if row[0] == 'table')
        require(len(tables) == 50, 'WEBSITE_TABLE_SET_CHANGED')
        seed_website_fixture(db)
        checks(db)
        # Include SQLite's existing autoincrement counters in the preservation proof.
        before_data = data_fingerprint(db, tables + ['sqlite_sequence'])
        protected_tables.update(tables + ['sqlite_sequence'])
        protected_objects.update(row[1] for row in before_schema)
        for file in native:
            apply(file)
            require([row for row in schema(db) if row[1] in protected_objects] == before_schema,
                    'EXISTING_SCHEMA_CHANGED:' + file['path'])
            require(data_fingerprint(db, tables + ['sqlite_sequence']) == before_data,
                    'EXISTING_DATA_CHANGED:' + file['path'])
        added = [row for row in schema(db) if row[1] not in protected_objects]
        require({row[1] for row in added if row[0] == 'table'} == EXPECTED_TABLES, 'NATIVE_TABLE_SET_CHANGED')
        require({row[1] for row in added if row[0] == 'index'} == EXPECTED_INDEXES, 'NATIVE_INDEX_SET_CHANGED')
        require(all(row[0] in {'table', 'index'} for row in added), 'UNEXPECTED_NATIVE_SCHEMA_OBJECT')
        require(all(db.execute('SELECT COUNT(*) FROM ' + quoted(table)).fetchone() == (0,) for table in EXPECTED_TABLES),
                'NATIVE_OR_MARKER_TABLE_NOT_EMPTY')
        dependencies = []
        for table in sorted(EXPECTED_TABLES):
            for row in db.execute('PRAGMA foreign_key_list(' + quoted(table) + ')'):
                dependencies.append({'table': table, 'constraintId': row[0], 'columnSequence': row[1],
                                     'from': row[3], 'referencesTable': row[2], 'referencesColumn': row[4],
                                     'onUpdate': row[5], 'onDelete': row[6]})
        manifest = [{key: file[key] for key in ['path', 'sha256', 'bytes']} for file in files]
        return {
            'status': 'passed', 'scope': 'local-in-memory-synthetic-migration-rehearsal',
            'productionApproved': False, 'productionDataTested': False, 'networkUsed': False,
            'userDatabaseOpened': False, 'deploymentArtifactsGenerated': False,
            'sqliteVersion': sqlite3.sqlite_version,
            'toolSha256': digest(Path(__file__).read_bytes()),
            'migrationFiles': manifest, 'migrationManifestSha256': digest(json_bytes(manifest)),
            'website': {'migrationCount': len(website), 'tableCount': len(tables),
                        'schemaSha256': digest(json_bytes(before_schema)), 'dataFingerprints': before_data},
            'candidate': {'migrationCount': len(native), 'newTables': sorted(EXPECTED_TABLES),
                          'newIndexes': [{'name': row[1], 'table': row[2]} for row in added if row[0] == 'index'],
                          'indexListing': 'Explicit indexes; primary-key and UNIQUE autoindexes are represented by table definitions.',
                          'foreignKeyDependencies': dependencies, 'markerRows': 0,
                          'schemaSha256': digest(json_bytes(schema(db)))},
            'checks': {'existingSchemaUnchanged': True, 'existingDataAndSequencesUnchanged': True,
                       'syntheticWebAccountsPreserved': 2, 'syntheticWebSessionsPreserved': 2,
                       'syntheticBalancesPreserved': [137, 0], 'foreignKeyCheck': 'passed', 'integrityCheck': 'passed',
                       'allNativeAndMarkerTablesEmpty': True},
            'limits': ['No real snapshot or existing deployed migration state was read.',
                       'This report is not approval to apply migrations or populate production binding markers.',
                       'Local SQLite is not a Cloudflare D1 migration/restore acceptance test.',
                       'No rollback, erasure, provisioning, or deployment operation is provided.'],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', help='Optional new .json report; existing paths are never overwritten')
    args = parser.parse_args()
    try:
        if args.output:
            require('://' not in args.output and Path(args.output).suffix == '.json', 'LOCAL_JSON_OUTPUT_REQUIRED')
        report = rehearse()
        content = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
        if args.output:
            with Path(args.output).open('x', encoding='utf-8') as output:
                output.write(content)
        else:
            print(content, end='')
    except (RehearsalError, OSError, UnicodeError, sqlite3.Error) as error:
        reason = str(error) if isinstance(error, RehearsalError) else type(error).__name__
        print(json.dumps({'status': 'failed', 'scope': 'local-in-memory-synthetic-migration-rehearsal',
                          'reason': reason, 'productionApproved': False}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
