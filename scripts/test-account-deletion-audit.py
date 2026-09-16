#!/usr/bin/env python3
"""Deletion hazards reproduced only in an in-memory schema with synthetic accounts."""
import importlib.util,json,sqlite3,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('audit-account-deletion.py'))
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
class DeletionAuditTests(unittest.TestCase):
    def setUp(self):
        self.db=audit.schema('reader')
        for i in [1,2]:self.db.execute('INSERT INTO reader_accounts(id,email,normalized_email,display_name) VALUES(?,?,?,?)',(i,f'fixture{i}@example.test',f'fixture{i}@example.test',f'Fixture {i}'))
        self.db.commit()
    def tearDown(self):self.db.close()
    def ledger(self,account=1):
        return self.db.execute("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,source,source_ref) VALUES(?,'purchase',100,100,'fixture','order-fixture')",(account,)).lastrowid
    def test_schema_inventory_and_draft_are_current(self):
        snapshot=audit.inspect()
        self.assertEqual(json.loads((audit.DOC/'schema-inventory.json').read_text()),snapshot)
        self.assertEqual((audit.DOC/'table-matrix.md').read_text(),audit.render(snapshot))
    def test_blind_account_delete_cascades_financial_ledger(self):
        self.ledger();self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM reader_credit_ledger').fetchone()[0],0)
        self.assertIsNotNone(self.db.execute('SELECT id FROM reader_accounts WHERE id=2').fetchone())
    def test_set_null_keeps_order_email_and_metadata(self):
        self.db.execute("INSERT INTO novel_orders(order_token,account_id,customer_email,metadata_json) VALUES('fixture',1,'fixture1@example.test','{\"email\":\"fixture1@example.test\"}')")
        self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        account,email,metadata=self.db.execute('SELECT account_id,customer_email,metadata_json FROM novel_orders').fetchone()
        self.assertIsNone(account);self.assertEqual(email,'fixture1@example.test');self.assertIn('fixture1@example.test',metadata)
    def test_payment_payload_survives_order_removal(self):
        oid=self.db.execute("INSERT INTO novel_orders(order_token,account_id) VALUES('fixture',1)").lastrowid
        self.db.execute('INSERT INTO novel_payment_events(order_id,payload_json) VALUES(?,?)',(oid,'{"customer":{"email":"fixture1@example.test"}}'))
        self.db.execute('DELETE FROM novel_orders WHERE id=?',(oid,))
        order,payload=self.db.execute('SELECT order_id,payload_json FROM novel_payment_events').fetchone()
        self.assertIsNone(order);self.assertIn('fixture1@example.test',payload)
    def test_game_commerce_blocks_blind_account_deletion(self):
        self.db.execute("INSERT INTO game_products(product_id,game_key,product_type,points_price,entitlement_key) VALUES('fixture','cat-life','skin',10,'fixture-skin')")
        self.db.execute("INSERT INTO game_purchases(id,account_id,game_key,product_id,product_type,entitlement_key,points_spent,balance_before,catalog_revision,idempotency_key,ledger_source_ref) VALUES('purchase-fixture',1,'cat-life','fixture','skin','fixture-skin',10,100,1,'fixture-id','fixture-ref')")
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        self.assertIsNotNone(self.db.execute('SELECT id FROM reader_accounts WHERE id=1').fetchone())
    def test_refund_review_blocks_ledger_or_account_removal(self):
        ledger=self.ledger()
        self.db.execute("INSERT INTO membership_refund_reviews(reversal_id,account_id,operation_token,intent_hash,decision,actor_email,reason,before_json,removed_seconds,applied) VALUES(?,1,'fixture-op','fixture-hash','keep','operator@example.test','fixture','{}',0,0)",(ledger,));self.db.commit()
        for sql in ['DELETE FROM reader_accounts WHERE id=1','DELETE FROM reader_credit_ledger WHERE account_id=1']:
            with self.assertRaises(sqlite3.IntegrityError):self.db.execute(sql)
    def test_cloud_saves_backups_and_comments_require_explicit_policy(self):
        for account in [1,2]:
            for table in ['reader_game_saves','reader_game_save_backups']:
                self.db.execute(f"INSERT INTO {table}(account_id,game_key,save_json,save_hash,revision,client_updated_at) VALUES(?,'cat-life','{{}}','fixture',1,'2026-01-01')",(account,))
            self.db.execute("INSERT INTO reader_comments(id,account_id,series_slug,chapter_slug,body) VALUES(?,?,'fixture-series','chapter','Personal text')",(f'comment-{account}',account))
        self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        for table in ['reader_game_saves','reader_game_save_backups','reader_comments']:
            self.assertEqual(self.db.execute(f'SELECT account_id FROM {table}').fetchall(),[(2,)])
    def test_non_fk_account_rate_limit_survives(self):
        self.db.execute("INSERT INTO game_commerce_rate_limits(account_id,action,window_started_at,request_count) VALUES(1,'purchase','2026-01-01',1)")
        self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        self.assertEqual(self.db.execute('SELECT account_id FROM game_commerce_rate_limits').fetchone()[0],1)
    def test_deletion_receipt_outlives_account_but_still_needs_minimization(self):
        self.db.execute("INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status) VALUES('fixture-delete',1,'fixture-prepare','fixture-hash','station-account-v1',1,2,'prepared')")
        self.db.execute('DELETE FROM reader_accounts WHERE id=1')
        self.assertEqual(self.db.execute('SELECT account_id FROM mobile_deletions').fetchone()[0],1)
    def test_composite_foreign_keys_preserve_ordered_column_pairs(self):
        music=audit.inventory('music')
        groups=audit.foreign_key_groups(music['music_assets']['foreignKeys'])
        pairs=[[(r['column'],r['parentColumn']) for r in group] for group in groups]
        self.assertIn([('owner_track_id','owner_track_id'),('derived_from_asset_id','id')],pairs)
        revisions=[g for g in audit.foreign_key_groups(music['music_track_revisions']['foreignKeys']) if len(g)>1]
        self.assertEqual(len(revisions),4)
        for group in revisions:
            self.assertEqual([r['seq'] for r in group],list(range(len(group))))
            self.assertEqual(len({r['id'] for r in group}),1)
        matrix=audit.render(audit.inspect())
        self.assertIn('(owner_track_id, derived_from_asset_id) → music_assets (owner_track_id, id)',matrix)
    def test_music_schema_has_no_reader_owned_catalog_or_library(self):
        music=audit.inventory('music')
        self.assertTrue(all('account_id' not in table['columns'] for table in music.values()))
        self.assertFalse(any('favorite' in name for name in music))
        self.assertIn('anonymous_session_id',music['music_analytics_events']['columns'])
        self.assertIn('owner_track_id',music['music_assets']['columns'])
if __name__=='__main__':unittest.main(verbosity=2)
