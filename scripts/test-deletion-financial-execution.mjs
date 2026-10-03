import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {claimDeletion,runDeletionStep,assertSyntheticIsolation} from './isolated-lifecycle/executor.js';
import {retentionSpecs,financialJsonShape} from './isolated-lifecycle/retention-plan.js';
import {prepareFinancialErasure,claimFinancialErasure,runFinancialErasureStep,planFinancialErasure,resolveSyntheticFinancialCase} from './isolated-lifecycle/financial-executor.js';
const options={environment:'isolated',dataset:'synthetic-r1',completionProfile:'synthetic-finality-v1',executionProfile:'synthetic-erasure-v1'};
const now=Date.now(),expired=now+86400_000,persist=mkdtempSync(join(tmpdir(),'r1-financial-execution-'));
let mf,db;
async function start(){
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("No financial HTTP entry",{status:404})}}',
 compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{DB:'synthetic-erasure'},d1Persist:persist,
 outboundService:()=>new Response('',{status:503})});db=await mf.getD1Database('DB');
}
async function migrate(paths){const parser=new DatabaseSync(':memory:');
 for(const path of paths){let sql=readFileSync(path,'utf8');while(sql.trim()){const st=parser.prepare(sql);st.run();await db.prepare(st.sourceSQL).run();sql=sql.slice(st.sourceSQL.length);}}parser.close();
}
before(async()=>{await start();await migrate([...['migrations','migrations-mobile'].flatMap(dir=>readdirSync(dir).filter(x=>x.endsWith('.sql')).sort().map(x=>dir+'/'+x)),
 'scripts/isolated-lifecycle/schema.sql','scripts/isolated-lifecycle/completion-schema.sql','scripts/isolated-lifecycle/financial-schema.sql','scripts/isolated-lifecycle/external-schema.sql']);
 await db.prepare("INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1')").run();},{timeout:120000});
after(async()=>{await mf?.dispose();rmSync(persist,{recursive:true,force:true});});
const insert=async(sql,...args)=>(await db.prepare(sql+' RETURNING rowid AS inserted_rowid').bind(...args).first()).inserted_rowid;
async function seedAccount(marker,balance=1234567) {
    const id = await insert('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?)',`${marker}@example.test`,`${marker}@example.test`,marker);
    await insert('INSERT INTO reader_credit_accounts(account_id,balance_credits,lifetime_purchased_credits) VALUES(?,1234567,1234567)',id);
    const ledger = await insert("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,note) VALUES(?,'membership_redeem',-10,1234557,?)",id,marker);
    const reversal = await insert("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,note) VALUES(?,'reversal',-5,1234552,?)",id,marker);
    await insert("INSERT INTO reader_memberships(account_id,source,source_ref,expires_at) VALUES(?,'reader-membership-redeem',?,'2027-01-01 00:00:00')",id,marker);
    await insert("INSERT INTO reader_membership_redemptions(account_id,request_key,operation_token,cost_credits,duration_months,unit_label,covers_paid,balance_before,membership_json,ledger_id,applied) VALUES(?,?,?,10,1,'Station Points',1,1234567,'{}',?,1)",id,`${marker}-request`,`${marker}-operation`,ledger);
    await insert("INSERT INTO membership_refund_reviews(reversal_id,account_id,operation_token,intent_hash,decision,actor_email,reason,before_json,removed_seconds,applied) VALUES(?,?,?,?,'keep',?,?,'{}',0,1)",reversal,id,`${marker}-review`,`${marker}-digest`,`${marker}@example.test`,marker);
    await insert('INSERT INTO membership_refund_review_items(redemption_ledger_id,reversal_id,removed_seconds) VALUES(?,?,1)',ledger,reversal);
    const order = await insert('INSERT INTO novel_orders(order_token,account_id,price_amount,customer_email,payment_url) VALUES(?,?,?, ?,?)',`${marker}-order-token`,id,'1234567.89',`${marker}@example.test`,`https://example.test/${marker}`);
    await insert('INSERT INTO novel_tips(order_id,account_id,amount,message) VALUES(?,?,?,?)',order,id,'1234567.89',marker);
    await insert("INSERT INTO novel_payment_events(order_id,payload_json,provider_event_id) VALUES(?,'{}',?)",order,`${marker}-provider-event`);
    await insert("INSERT INTO novel_entitlements(account_id,series_slug,chapter_slug,scope,access_level,source,source_ref,note,granted_by) VALUES(?,'synthetic','chapter','chapter','paid','synthetic',?,?,?)",id,`${marker}-source`,marker,`${marker}@example.test`);
    const purchase = `${marker}-purchase`;
    await insert("INSERT INTO game_purchases(id,account_id,game_key,product_id,product_type,entitlement_key,points_spent,balance_before,balance_after,catalog_revision,idempotency_key,ledger_source_ref,ledger_id,reversal_reason) VALUES(?,?,'cat-life','cat-life.skin.moonlit-tabby','cat_skin','synthetic-entitlement',10,1234567,1234557,1,?,?,?,?)",purchase,id,`${marker}-idempotency`,purchase,ledger,marker);
    const entitlement = await insert("INSERT INTO game_entitlements(account_id,game_key,entitlement_key,product_id,purchase_id,source_ref,grant_reason,granted_by,revoke_reason) VALUES(?,'cat-life','synthetic-entitlement','cat-life.skin.moonlit-tabby',?,?,?,?,?)",id,purchase,purchase,marker,`${marker}@example.test`,marker);
    await insert("INSERT INTO game_commerce_events(account_id,purchase_id,event_type,event_key,product_id,entitlement_key,points_delta) VALUES(?,?,'purchase.completed',?,'cat-life.skin.moonlit-tabby','synthetic-entitlement',-10)",id,purchase,`${marker}-commerce-event`);
    await insert("INSERT INTO game_entitlement_events(account_id,entitlement_id,event_type,event_key,product_id,entitlement_key,actor_email,reason) VALUES(?,?,'entitlement.granted',?,'cat-life.skin.moonlit-tabby','synthetic-entitlement',?,?)",id,entitlement,`${marker}-entitlement-event`,`${marker}@example.test`,marker);
    await db.prepare('UPDATE reader_credit_accounts SET balance_credits=? WHERE account_id=?').bind(balance,id).run();
    return {id,ledger,reversal,order,purchase,entitlement,marker};
}
function policy(){return {
 version:'synthetic-erasure-test-v1',approved:true,environment:'isolated',dataset:'synthetic-r1',jurisdiction:'fictional-fixture',basis:'test-only-not-operational',financialDays:1,receiptDays:14,
 tables:Object.fromEntries(Object.entries(retentionSpecs).map(([table,s])=>[table,{scope:'exact-account-links',retainColumns:[...s.retainColumns],reviewColumns:[...s.reviewColumns]}])),
 jsonShapes:Object.fromEntries(Object.entries(retentionSpecs).flatMap(([table,s])=>s.reviewColumns.filter(c=>s.classifications[c]==='raw_json')
  .map(c=>[`${table}.${c}`,[financialJsonShape({}),financialJsonShape(null),financialJsonShape({email:'shape-only'})]])))
};}
async function fixture({balance=1234567,unknown=false,cross=false,many=false}={}){
 const a=await seedAccount('A'+randomUUID(),balance),b=await seedAccount('B'+randomUUID());
 for(const [table,s] of Object.entries(retentionSpecs))for(const column of s.reviewColumns.filter(c=>s.classifications[c]==='raw_json'))
  await db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${s.selector}`).bind(JSON.stringify({email:a.marker+'@example.test'}),...Array(s.selectorBindings).fill(a.id)).run();
 if(unknown)await db.prepare('UPDATE novel_orders SET metadata_json=? WHERE account_id=?').bind('{"unexpected":"private"}',a.id).run();
 if(cross){
  // Historical fault injection bypasses only this guard, then restores its exact SQL.
  const g=await db.prepare("SELECT sql FROM sqlite_master WHERE name='r1_financial_novel_tips_update'").first();
  await db.prepare('DROP TRIGGER r1_financial_novel_tips_update').run();
  try{await db.prepare('UPDATE novel_tips SET account_id=? WHERE order_id=?').bind(b.id,a.order).run();}finally{await db.prepare(g.sql).run();}
 }
 if(many)for(let i=0;i<204;i++)await db.prepare(`INSERT INTO novel_entitlements(account_id,series_slug,chapter_slug,scope,access_level,source,source_ref,note)
  VALUES(?,'bulk',?,'chapter','paid','synthetic',?,'private')`).bind(a.id,'chapter'+i,'source'+i).run();
 const id=randomUUID();
 await db.prepare(`INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status,confirm_id,confirmed_at,stage)
  VALUES(?,?,?,'synthetic-receipt-hash','station-account-v1',?,?,'accepted',?,?,'queued')`).bind(id,a.id,randomUUID(),now+600000,now+14*86400000,randomUUID(),now).run();
 await db.prepare('INSERT INTO mobile_deletion_outbox(job_id,updated_at) VALUES(?,?)').bind(id,now).run();
 await db.prepare("UPDATE reader_accounts SET status='deletion_pending' WHERE id=?").bind(a.id).run();
 for(let i=0;i<80;i++){const ticket=await claimDeletion(db,id,randomUUID(),now,options);const result=await runDeletionStep(db,ticket,now,options);if(result.personalCleanupVerified)return {id,a,b,policy:policy()};}
 throw Error('personal cleanup stalled');
}
async function snapshot(account){return Object.fromEntries(await Promise.all(Object.entries(retentionSpecs).map(async([table,s])=>
 [table,(await db.prepare(`SELECT * FROM ${table} WHERE ${s.selector} ORDER BY rowid`).bind(...Array(s.selectorBindings).fill(account)).all()).results])));}
const permits=async()=>assert.equal((await db.prepare('SELECT count(*) n FROM r1_financial_write_permits').first()).n,0);
async function minimize(f){await prepareFinancialErasure(db,f.id,f.policy,now,options);let largest=0;
 for(let i=0;i<100;i++){const ticket=await claimFinancialErasure(db,f.id,randomUUID(),now,options);assert.ok(ticket);const r=await runFinancialErasureStep(db,ticket,now,options);largest=Math.max(largest,r.changedRows);await permits();if(r.stage==='retained')return largest;}throw Error('minimization stalled');}
async function caseResolved(f){const job=await db.prepare('SELECT * FROM r1_financial_jobs WHERE id=?').bind(f.id).first();
 return resolveSyntheticFinancialCase(db,f.id,{decision:'resolved-no-open-dispute',balanceDisposition:'zero-balance-confirmed',confirmedAt:now,
 policyDigest:job.policy_digest,evidenceDigest:createHash('sha256').update('synthetic case '+f.id).digest('hex'),reviewerRef:'synthetic-case-reviewed'},expired,options);}
async function purge(f){for(let i=0;i<100;i++){const ticket=await claimFinancialErasure(db,f.id,randomUUID(),expired,options);if(!ticket)return;
 const r=await runFinancialErasureStep(db,ticket,expired,options);assert.ok(r.changedRows<=200);await permits();if(r.stage==='purged')return;}throw Error('purge stalled');}

test('actual D1 minimizes all approved columns while retaining every amount, balance, association and receipt field; restart is idempotent',async()=>{
 const f=await fixture({many:true}),before=await snapshot(f.a.id),other=await snapshot(f.b.id);
 assert.equal(await minimize(f),200);
 const after=await snapshot(f.a.id);
 for(const [table,s] of Object.entries(retentionSpecs)){
  assert.equal(after[table].length,before[table].length);
  for(let i=0;i<after[table].length;i++)for(const column of [...s.retainColumns,...s.reviewColumns])
   assert.equal(after[table][i][column],s.reviewColumns.includes(column)?(before[table][i][column]===null?null:s.emptyValues[column]):before[table][i][column],`${table}.${column}`);
 }
 assert.deepEqual(await snapshot(f.b.id),other);
 assert.equal((await db.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=?').bind(f.a.id).first()).balance_credits,1234567);
 await mf.dispose();await start();await assertSyntheticIsolation(db,options);await permits();
 assert.equal(await claimFinancialErasure(db,f.id,randomUUID(),now,options),null);
 assert.deepEqual(await snapshot(f.a.id),after);assert.equal((await planFinancialErasure(db,f.id,now,options)).stage,'retained');
});

test('unknown JSON, cross-account links, unapproved policy and schema drift fail without financial mutation',async()=>{
 for(const mode of ['unknown','cross','policy']){
  const f=await fixture({[mode]:true}),before=await snapshot(f.a.id);
  if(mode==='policy')f.policy.approved=false;
  await assert.rejects(()=>prepareFinancialErasure(db,f.id,f.policy,now,options),mode==='policy'?/POLICY_NOT_APPROVED/:/FINANCIAL_PLAN_BLOCKED/);
  assert.deepEqual(await snapshot(f.a.id),before);await permits();
 }
 const f=await fixture(),before=await snapshot(f.a.id);
 await db.prepare('CREATE TABLE unreviewed_financial_data(id INTEGER)').run();
 try{await assert.rejects(()=>prepareFinancialErasure(db,f.id,f.policy,now,options),/SCHEMA_DRIFT/);}finally{await db.prepare('DROP TABLE unreviewed_financial_data').run();}
 assert.deepEqual(await snapshot(f.a.id),before);
 await assert.rejects(()=>prepareFinancialErasure(db,f.id,f.policy,now,{...options,environment:'production'}),/ISOLATION_REQUIRED/);
 await assert.rejects(()=>prepareFinancialErasure(db,f.id,f.policy,now,{...options,executionProfile:undefined}),/ERASURE_PROFILE_REQUIRED/);
});

test('failure after financial UPDATE rolls back rows, CAS checkpoint and short-lived permit; stale tickets cannot retry',async()=>{
 const f=await fixture();await prepareFinancialErasure(db,f.id,f.policy,now,options);
 let ticket=await claimFinancialErasure(db,f.id,randomUUID(),now,options);
 // The credit-account table has no review columns, so advance to the ledger mutation.
 await runFinancialErasureStep(db,ticket,now,options);ticket=await claimFinancialErasure(db,f.id,randomUUID(),now,options);
 const before=await snapshot(f.a.id),job=await db.prepare('SELECT * FROM r1_financial_jobs WHERE id=?').bind(f.id).first();
 let injected=false;
 const failing={prepare:sql=>db.prepare(sql),batch:statements=>{
  // The mutation batch has seven statements; schema reads are a larger readonly batch.
  if(statements.length!==7)return db.batch(statements);
  injected=true;return db.batch([...statements.slice(0,-1),db.prepare('INSERT INTO mobile_assert(value) VALUES(0)'),statements.at(-1)]);
 }};
 await assert.rejects(()=>runFinancialErasureStep(failing,ticket,now,options),/CHECK/);
 assert.equal(injected,true);
 assert.deepEqual(await snapshot(f.a.id),before);assert.deepEqual(await db.prepare('SELECT * FROM r1_financial_jobs WHERE id=?').bind(f.id).first(),job);await permits();
 await runFinancialErasureStep(db,ticket,now,options);const after=await snapshot(f.a.id);
 await assert.rejects(()=>runFinancialErasureStep(db,ticket,now,options));assert.deepEqual(await snapshot(f.a.id),after);await permits();
 // Compress this fixture lease, then delay an actual awaited preflight read past it.
 const delayedTicket=await claimFinancialErasure(db,f.id,randomUUID(),now,options);
 await db.prepare('UPDATE r1_financial_jobs SET lease_until=? WHERE id=?').bind(now+20,f.id).run();
 const shortened=await db.prepare('SELECT * FROM r1_financial_jobs WHERE id=?').bind(f.id).first();let delayed=false;
 const slow={batch:statements=>db.batch(statements),prepare(sql){const statement=db.prepare(sql);
  if(delayed||sql!=='SELECT 1 FROM r1_financial_write_permits LIMIT 1')return statement;
  delayed=true;return {async first(){await new Promise(resolve=>setTimeout(resolve,35));return statement.first();}};
 }};
 await assert.rejects(()=>runFinancialErasureStep(slow,delayedTicket,now,options),/CHECK/);
 assert.deepEqual(await snapshot(f.a.id),after);assert.deepEqual(await db.prepare('SELECT * FROM r1_financial_jobs WHERE id=?').bind(f.id).first(),shortened);await permits();
});

test('inactive old/new owners reject delayed financial callbacks, reassignment, PII recreation, balances and entitlements',async()=>{
 const f=await fixture();await minimize(f);
 const before=await snapshot(f.a.id),other=await snapshot(f.b.id);
 for(const sql of [
  `UPDATE reader_credit_accounts SET balance_credits=0 WHERE account_id=${f.a.id}`,
  `UPDATE reader_credit_ledger SET note='late private' WHERE account_id=${f.a.id}`,
  `UPDATE reader_memberships SET expires_at='2099-01-01' WHERE account_id=${f.a.id}`,
  `UPDATE novel_orders SET customer_email='late@example.test' WHERE account_id=${f.a.id}`,
  `UPDATE novel_tips SET account_id=${f.b.id} WHERE account_id=${f.a.id}`,
  `UPDATE novel_tips SET account_id=${f.a.id} WHERE account_id=${f.b.id}`,
  `UPDATE game_entitlements SET grant_reason='late private' WHERE account_id=${f.a.id}`,
  `INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,note) VALUES(${f.a.id},'purchase',1,1,'late')`,
  `INSERT INTO novel_orders(order_token,account_id,customer_email) VALUES('late-${f.id}',${f.a.id},'late@example.test')`,
  `INSERT INTO novel_payment_events(order_id,payload_json) VALUES(${f.a.order},'{"email":"late"}')`,
  `DELETE FROM novel_orders WHERE account_id=${f.a.id}`
 ])await assert.rejects(()=>db.prepare(sql).run(),/R1_/);
 assert.deepEqual(await snapshot(f.a.id),before);assert.deepEqual(await snapshot(f.b.id),other);await permits();
});

test('retention expiry alone or unresolved case cannot purge, and a nonzero balance is never silently zeroed',async()=>{
 const f=await fixture();await minimize(f);const before=await snapshot(f.a.id);
 assert.equal(await claimFinancialErasure(db,f.id,randomUUID(),expired-1,options),null);
 await assert.rejects(()=>claimFinancialErasure(db,f.id,randomUUID(),expired,options),/FINANCIAL_CASE_UNRESOLVED/);
 await assert.rejects(()=>caseResolved(f),/CHECK/);
 assert.deepEqual(await snapshot(f.a.id),before);await permits();
 assert.equal((await db.prepare('SELECT status FROM r1_financial_case_reviews WHERE job_id=?').bind(f.id).first()).status,'unresolved');
});

test('zero balance plus independent explicit case disposition permits due physical erasure, bounded and restartable; account tombstone survives',async()=>{
 const f=await fixture({balance:0}),other=await snapshot(f.b.id);await minimize(f);await caseResolved(f);
 let ticket=await claimFinancialErasure(db,f.id,randomUUID(),expired,options);assert.ok(ticket);
 await runFinancialErasureStep(db,ticket,expired,options);
 await mf.dispose();await start();await permits();await purge(f);
 const after=await snapshot(f.a.id);for(const rows of Object.values(after))assert.equal(rows.length,0);
 assert.deepEqual(await snapshot(f.b.id),other);assert.equal(await claimFinancialErasure(db,f.id,randomUUID(),expired,options),null);
 assert.equal((await db.prepare('SELECT status FROM reader_accounts WHERE id=?').bind(f.a.id).first()).status,'deleted_pending_review');
 assert.equal((await db.prepare('SELECT completed_at FROM mobile_deletions WHERE id=?').bind(f.id).first()).completed_at,null);
 assert.equal((await planFinancialErasure(db,f.id,expired,options)).stage,'purged');await permits();
 assert.equal((await prepareFinancialErasure(db,f.id,f.policy,expired,options)).requestId,f.id);
 const changedPolicy=structuredClone(f.policy);changedPolicy.financialDays=2;
 await assert.rejects(()=>prepareFinancialErasure(db,f.id,changedPolicy,expired,options),/POLICY_CHANGED/);
 for(const sql of [
  `INSERT INTO novel_payment_events(order_id,payload_json) VALUES(NULL,'{"email":"late-private"}')`,
  `INSERT INTO novel_payment_events(order_id,payload_json) VALUES(${f.a.order},'{"email":"late-private"}')`,
  `INSERT INTO novel_payment_events(provider_order_id,payload_json) VALUES('old-provider-ref','{"email":"late-private"}')`,
  `UPDATE novel_payment_events SET order_id=NULL WHERE order_id=${f.b.order}`,
  `UPDATE novel_payment_events SET order_id=${f.a.order} WHERE order_id=${f.b.order}`
 ])await assert.rejects(()=>db.prepare(sql).run(),/R1_FINANCIAL_INACTIVE_WRITE/);
 assert.deepEqual(await snapshot(f.b.id),other);
});
