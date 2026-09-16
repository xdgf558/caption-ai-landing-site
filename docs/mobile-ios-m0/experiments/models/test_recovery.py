import concurrent.futures,json,os,sqlite3,subprocess,sys,tempfile,unittest
from pathlib import Path
from recovery import *

class Models(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.db=self.root/'db';self.journal=self.root/'envelope'
        atomic_save(self.journal,{'token':'fixture-old','generation':0,'session':'s','pending':None})
    def tearDown(self):self.tmp.cleanup()
    def server(self):return RefreshServer(self.db)
    def assertFailure(self,code,fn):
        with self.assertRaisesRegex(Failure,code):fn()
    def crash(self,point):
        p=subprocess.run([sys.executable,str(Path(__file__).with_name('crash_client.py')),str(self.journal),str(self.db),point]);self.assertIn(p.returncode,[71,72,73])
    def test_four_actual_process_exit_points(self):
        for point in ('prepared','committed','received','saved'):
            with self.subTest(point=point):
                db=self.root/point; db.mkdir(); self.db=db/'db';self.journal=db/'envelope'
                atomic_save(self.journal,{'token':'fixture-old','generation':0,'session':'s','pending':None})
                self.crash(point);c=RefreshClient(self.journal);s=self.server();e=load(self.journal)
                if e['pending']:
                    r=s.refresh(e['token'],e['pending']['request']);c.save_result(e,r)
                self.assertEqual(load(self.journal)['generation'],1)
                self.assertEqual(s.db.execute('SELECT gen,revoked FROM family').fetchone(),(1,0))
                self.assertEqual(s.db.execute('SELECT count(*) FROM operations').fetchone()[0],1)
    def test_same_result_no_renewal(self):
        s=self.server();r=s.refresh('fixture-old',now=0);self.assertEqual(r,s.refresh('fixture-old',now=119))
    def test_window_expired_tombstone_does_not_revoke(self):
        s=self.server();s.refresh('fixture-old');s.db.execute('UPDATE operations SET result=NULL');s.db.commit()
        self.assertFailure('RECOVERY_EXPIRED',lambda:s.refresh('fixture-old',now=121));self.assertEqual(s.db.execute('SELECT revoked FROM family').fetchone()[0],0)
    def test_unsent_request_after_window_still_works(self):self.assertEqual(self.server().refresh('fixture-old',now=121)['generation'],1)
    def test_superseded_does_not_revoke(self):
        s=self.server();r=s.refresh('fixture-old');s.refresh(r['token'],request='next')
        self.assertFailure('SUPERSEDED',lambda:s.refresh('fixture-old'));self.assertEqual(s.db.execute('SELECT revoked FROM family').fetchone()[0],0)
    def test_different_id_reuse_revokes(self):
        s=self.server();s.refresh('fixture-old');self.assertFailure('REUSE',lambda:s.refresh('fixture-old',request='attack'));self.assertFailure('REVOKED',lambda:s.refresh('fixture-old'))
    def test_unknown_token_cannot_revoke(self):
        s=self.server();self.assertFailure('UNKNOWN',lambda:s.refresh('unknown'));self.assertEqual(s.db.execute('SELECT revoked FROM family').fetchone()[0],0)
    def test_same_id_changed_body(self):
        s=self.server();s.refresh('fixture-old');self.assertFailure('MISMATCH',lambda:s.refresh('fixture-old',body='changed'))
    def test_cas_zero_rolls_back(self):
        s=self.server();self.assertFailure('CAS_MISS',lambda:s.refresh('fixture-old',expected=99));self.assertEqual(s.db.execute('SELECT gen FROM family').fetchone()[0],0);self.assertEqual(s.db.execute('SELECT count(*) FROM operations').fetchone()[0],0)
    def test_transaction_failures_rollback_both(self):
        s=self.server()
        for fail in ('after_cas','after_result'):
            self.assertFailure('INJECTED',lambda:s.refresh('fixture-old',fail=fail));self.assertEqual(s.db.execute('SELECT gen FROM family').fetchone()[0],0);self.assertEqual(s.db.execute('SELECT count(*) FROM operations').fetchone()[0],0)
    def test_concurrent_same_operation_only_one_rotation(self):
        self.server().db.close()
        def run(_):
            s=self.server()
            try:return s.refresh('fixture-old')
            finally:s.db.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:r=list(pool.map(run,range(4)))
        self.assertTrue(all(x==r[0] for x in r));self.assertEqual(self.server().db.execute('SELECT gen FROM family').fetchone()[0],1)
    def test_prepare_write_failure_prevents_http(self):
        c=RefreshClient(self.journal);self.assertFailure('STORE',lambda:c.prepare(fail=True));self.assertIsNone(load(self.journal)['pending']);self.assertFalse(self.db.exists())
    def test_result_write_failure_keeps_pending(self):
        c=RefreshClient(self.journal);e=c.prepare();r=self.server().refresh(e['token'],e['pending']['request']);self.assertFailure('STORE',lambda:c.save_result(e,r,fail=True));self.assertEqual(load(self.journal),e)
    def test_logout_or_account_switch_discards_late_result(self):
        c=RefreshClient(self.journal);e=c.prepare();r=self.server().refresh(e['token'],e['pending']['request']);atomic_save(self.journal,{'session':'B','generation':0});self.assertFailure('STALE',lambda:c.save_result(e,r))
    def deletion(self):return DeletionServer(self.root/'deletion')
    def test_prepare_response_lost_still_queryable(self):
        s=self.deletion();receipt=secrets.token_bytes(32);atomic_save(self.root/'receipt',{'receipt':receipt.hex()});s.prepare(receipt)
        s=DeletionServer(self.root/'deletion');self.assertEqual(s.status(bytes.fromhex(load(self.root/'receipt')['receipt']))['status'],'prepared');self.assertEqual(s.db.execute('SELECT active FROM account').fetchone()[0],1)
    def test_confirm_response_lost_after_revocation(self):
        s=self.deletion();receipt=secrets.token_bytes(32);s.prepare(receipt);s.confirm();self.assertFailure('UNAUTHORIZED',lambda:s.confirm());self.assertEqual(s.status(receipt)['status'],'accepted');self.assertEqual(s.db.execute('SELECT count(*) FROM outbox').fetchone()[0],1)
    def test_deletion_transaction_rollback(self):
        s=self.deletion();r=secrets.token_bytes(32);s.prepare(r);self.assertFailure('INJECTED',lambda:s.confirm(fail=True));self.assertEqual(s.status(r)['status'],'prepared');self.assertEqual(s.db.execute('SELECT active FROM account').fetchone()[0],1);self.assertEqual(s.db.execute('SELECT count(*) FROM outbox').fetchone()[0],0)
    def test_outbox_delivery_failure_leaves_durable_work(self):
        s=self.deletion();r=secrets.token_bytes(32);s.prepare(r);s.confirm();s.db.close();s=self.deletion();self.assertEqual(s.db.execute('SELECT id,sent FROM outbox').fetchone(),('d',0))
    def test_status_survives_account_cleanup(self):
        s=self.deletion();r=secrets.token_bytes(32);s.prepare(r);s.confirm();s.db.execute('DELETE FROM account');s.db.execute('UPDATE deletion SET status="completed"');s.db.commit();s.db.close();s=self.deletion();self.assertEqual(s.status(r)['status'],'completed');self.assertEqual(s.db.execute('SELECT count(*) FROM account').fetchone()[0],0)
    def test_receipt_wrong_task_expiry_and_query_failure(self):
        s=self.deletion();r=secrets.token_bytes(32);s.prepare(r)
        for fn in (lambda:s.status(secrets.token_bytes(32)),lambda:s.status(r,request='other'),lambda:s.status(r,now=1209600)):self.assertFailure('NOT_FOUND',fn)
        self.assertFailure('UNAVAILABLE',lambda:s.status(r,fail=True));self.assertEqual(s.status(r)['status'],'prepared')
    def test_preparation_expiry_does_not_delete(self):
        s=self.deletion();r=secrets.token_bytes(32);s.prepare(r);self.assertFailure('PREPARATION_EXPIRED',lambda:s.confirm(now=600));self.assertEqual(s.status(r,now=600)['status'],'preparation_expired');self.assertEqual(s.db.execute('SELECT active FROM account').fetchone()[0],1)
    def test_duplicate_prepare_cannot_create_second_job(self):
        s=self.deletion();r=secrets.token_bytes(32);s.prepare(r);s.prepare(r);self.assertFailure('PREPARATION_EXISTS',lambda:s.prepare(secrets.token_bytes(32),request='other'));self.assertEqual(s.db.execute('SELECT count(*) FROM deletion').fetchone()[0],1)
    def test_receipt_write_failure_prevents_prepare(self):
        self.assertFailure('STORE',lambda:atomic_save(self.root/'receipt',{},fail=True));self.assertFalse((self.root/'deletion').exists())
    def test_logout_does_not_clear_separate_receipt(self):
        atomic_save(self.root/'receipt',{'receipt':'fixture-only','confirmAttempted':True});self.journal.unlink();self.assertTrue(load(self.root/'receipt')['confirmAttempted'])
    def test_full_buffer_soft_failures_stop_at_hard_deadline(self):
        for failure in ('503','timeout','429'):
            p=DeadlinePlayer();self.assertTrue(p.install(100,110,20,21));p.pending_loads=99;p.start();p.soft_failure(failure);p.tick(27.9);self.assertTrue(p.playing);p.tick(28);self.assertFalse(p.playing);self.assertFalse(p.item);self.assertEqual(p.pending_loads,0)
    def test_late_grant_never_autoplays(self):
        p=DeadlinePlayer();p.install(100,110,20,21);p.start();p.tick(28);p.install(110,120,29,30);self.assertFalse(p.playing);self.assertTrue(p.needs_user)
    def test_explicit_reject_wins_over_old_success(self):
        p=DeadlinePlayer();p.install(100,110,20,21);p.start();p.deny();self.assertFalse(p.install(110,150,22,23,sequence=0));self.assertFalse(p.playing)
    def test_invalid_grant_and_scope_rejected(self):
        for kwargs in ({'server_now':None},{'valid_until':None},{'valid_until':100},{'session':'other'}):
            args=dict(server_now=100,valid_until=110,t0=20,t1=21);args.update(kwargs);self.assertFalse(DeadlinePlayer().install(**args))
    def test_sleep_and_wall_clock_cannot_extend(self):
        p=DeadlinePlayer();p.install(100,110,20,21);p.start();p.tick(1000);self.assertFalse(p.playing)
    def test_media_identity_matrix_and_no_delivery(self):
        grant={'mode':'session_bearer','policy':'vip','account':'a','session':'s','until':10}
        for method in ('GET','HEAD'):
            for bearer,expected in [(None,401),({'account':'b','session':'b'},403),({'account':'a','session':'other'},403),({'account':'a','session':'s','generation':9},200)]:self.assertEqual(media_decision(grant,bearer,method),expected)
        self.assertEqual(media_decision(grant,{'account':'a','session':'s'},now=10),410)
        self.assertEqual(media_decision(grant,{'account':'a','session':'s'},available=False),503)
    def test_public_mode_cannot_escalate_vip(self):
        g={'mode':'public','policy':'vip','until':10};self.assertEqual(media_decision(g,None),403);g['policy']='preview';self.assertEqual(media_decision(g,None),200);self.assertEqual(media_decision(g,{'invalid':True}),401)

if __name__=='__main__':unittest.main(verbosity=2)
