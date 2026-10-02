import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import inventory from '../docs/mobile-ios-m2/deletion-plan/schema-inventory.json' with {type:'json'};
import {
  retentionSpecs, financialJsonShape, validateSyntheticRetentionPolicy,
  retentionPolicyDigest, planFinancialRetention
} from './isolated-lifecycle/retention-plan.js';

const options = {environment:'isolated',dataset:'synthetic-r1'};
const policyFile = 'docs/mobile-ios-m2/deletion-plan/policy-draft.json';
const originalPolicy = readFileSync(policyFile,'utf8');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const directory of ['migrations','migrations-mobile']) {
    for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`${directory}/${file}`,'utf8'));
  }
  sqlite.exec(readFileSync('scripts/isolated-lifecycle/schema.sql','utf8'));
  sqlite.exec("INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1')");
  const insert = (sql,...args) => sqlite.prepare(sql).run(...args).lastInsertRowid;
  const account = marker => {
    const id = insert('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?)',`${marker}@example.test`,`${marker}@example.test`,marker);
    insert('INSERT INTO reader_credit_accounts(account_id,balance_credits,lifetime_purchased_credits) VALUES(?,1234567,1234567)',id);
    const ledger = insert("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,note) VALUES(?,'membership_redeem',-10,1234557,?)",id,marker);
    const reversal = insert("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,note) VALUES(?,'reversal',-5,1234552,?)",id,marker);
    insert("INSERT INTO reader_memberships(account_id,source,source_ref,expires_at) VALUES(?,'reader-membership-redeem',?,'2027-01-01 00:00:00')",id,marker);
    insert("INSERT INTO reader_membership_redemptions(account_id,request_key,operation_token,cost_credits,duration_months,unit_label,covers_paid,balance_before,membership_json,ledger_id,applied) VALUES(?,?,?,10,1,'Station Points',1,1234567,'{}',?,1)",id,`${marker}-request`,`${marker}-operation`,ledger);
    insert("INSERT INTO membership_refund_reviews(reversal_id,account_id,operation_token,intent_hash,decision,actor_email,reason,before_json,removed_seconds,applied) VALUES(?,?,?,?,'keep',?,?,'{}',0,1)",reversal,id,`${marker}-review`,`${marker}-digest`,`${marker}@example.test`,marker);
    insert('INSERT INTO membership_refund_review_items(redemption_ledger_id,reversal_id,removed_seconds) VALUES(?,?,1)',ledger,reversal);
    const order = insert('INSERT INTO novel_orders(order_token,account_id,price_amount,customer_email,payment_url) VALUES(?,?,?, ?,?)',`${marker}-order-token`,id,'1234567.89',`${marker}@example.test`,`https://example.test/${marker}`);
    insert('INSERT INTO novel_tips(order_id,account_id,amount,message) VALUES(?,?,?,?)',order,id,'1234567.89',marker);
    insert("INSERT INTO novel_payment_events(order_id,payload_json,provider_event_id) VALUES(?,'{}',?)",order,`${marker}-provider-event`);
    insert("INSERT INTO novel_entitlements(account_id,series_slug,chapter_slug,scope,access_level,source,source_ref,note,granted_by) VALUES(?,'synthetic','chapter','chapter','paid','synthetic',?,?,?)",id,`${marker}-source`,marker,`${marker}@example.test`);
    const purchase = `${marker}-purchase`;
    insert("INSERT INTO game_purchases(id,account_id,game_key,product_id,product_type,entitlement_key,points_spent,balance_before,balance_after,catalog_revision,idempotency_key,ledger_source_ref,ledger_id,reversal_reason) VALUES(?,?,'cat-life','cat-life.skin.moonlit-tabby','cat_skin','synthetic-entitlement',10,1234567,1234557,1,?,?,?,?)",purchase,id,`${marker}-idempotency`,purchase,ledger,marker);
    const entitlement = insert("INSERT INTO game_entitlements(account_id,game_key,entitlement_key,product_id,purchase_id,source_ref,grant_reason,granted_by,revoke_reason) VALUES(?,'cat-life','synthetic-entitlement','cat-life.skin.moonlit-tabby',?,?,?,?,?)",id,purchase,purchase,marker,`${marker}@example.test`,marker);
    insert("INSERT INTO game_commerce_events(account_id,purchase_id,event_type,event_key,product_id,entitlement_key,points_delta) VALUES(?,?,'purchase.completed',?,'cat-life.skin.moonlit-tabby','synthetic-entitlement',-10)",id,purchase,`${marker}-commerce-event`);
    insert("INSERT INTO game_entitlement_events(account_id,entitlement_id,event_type,event_key,product_id,entitlement_key,actor_email,reason) VALUES(?,?,'entitlement.granted',?,'cat-life.skin.moonlit-tabby','synthetic-entitlement',?,?)",id,entitlement,`${marker}-entitlement-event`,`${marker}@example.test`,marker);
    return {id,ledger,reversal,order,purchase,entitlement,marker};
  };
  const a = account('PRIVATE_MARKER_A'), b = account('PRIVATE_MARKER_B');
  const requestId = randomUUID();
  insert("INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status,confirm_id,confirmed_at,stage) VALUES(?,?,?,'synthetic-hash','station-account-v1',1,9999999999999,'accepted',?,1,'queued')",requestId,a.id,randomUUID(),randomUUID());
  sqlite.prepare("UPDATE reader_accounts SET status='deletion_pending' WHERE id=?").run(a.id);
  const queries = [];
  const db = {
    prepare(sql) {
      assert.match(sql,/^\s*(SELECT\b|PRAGMA (table_info|foreign_key_list)\()/i,'The report attempted a write or an unreviewed PRAGMA');
      assert.doesNotMatch(sql,/\b(LIKE|GLOB)\b|customer_email\s*=|actor_email\s*=/i,'The report attempted fuzzy identity matching');
      queries.push(sql);
      const statement = sqlite.prepare(sql);
      const bound = args => ({
        bind: (...values) => bound(values),
        first: async () => statement.get(...args) || null,
        all: async () => ({results:statement.all(...args)})
      });
      return bound([]);
    }
  };
  const snapshot = () => Object.fromEntries(Object.keys(retentionSpecs).map(table => [table,sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return {sqlite,db,a,b,requestId,queries,snapshot,close:() => sqlite.close()};
}

// These durations and legal labels are made-up test inputs, never an approved policy.
function syntheticPolicy() {
  return {
    version:'synthetic-policy-test-v1',approved:true,environment:'isolated',dataset:'synthetic-r1',
    jurisdiction:'synthetic-fixture-only',basis:'test-only-no-real-retention-basis',financialDays:30,receiptDays:14,
    tables:Object.fromEntries(Object.entries(retentionSpecs).map(([table,s]) => [table,{scope:'exact-account-links',retainColumns:[...s.retainColumns],reviewColumns:[...s.reviewColumns]}])),
    jsonShapes:Object.fromEntries(Object.entries(retentionSpecs).flatMap(([table,s]) => s.reviewColumns.filter(column => s.classifications[column] === 'raw_json')
      .map(column => [`${table}.${column}`,[financialJsonShape({}),financialJsonShape(null)]])))
  };
}
const withFixture = run => async () => { const f = fixture(); try { await run(f); } finally { f.close(); } };

test('all 14 reviewed tables classify every actual migration column exactly once',withFixture(async f => {
  assert.equal(Object.keys(retentionSpecs).length,14);
  for (const [table,s] of Object.entries(retentionSpecs)) {
    assert.deepEqual([...s.retainColumns,...s.reviewColumns].sort(),[...inventory.databases.reader[table].columns].sort());
    assert.deepEqual(f.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name),inventory.databases.reader[table].columns);
  }
  assert.equal(retentionSpecs.reader_credit_ledger.classifications.credits_delta,'amount');
  assert.equal(retentionSpecs.novel_payment_events.classifications.provider_event_id,'idempotency');
  assert.equal(retentionSpecs.novel_orders.classifications.customer_email,'identity');
  assert.equal(retentionSpecs.novel_payment_events.classifications.payload_json,'raw_json');
}));

test('missing policy reports blocked counts and leaves all financial rows and the real draft unchanged',withFixture(async f => {
  const before = f.snapshot();
  const report = await planFinancialRetention(f.db,f.requestId,options);
  assert.equal(report.status,'blocked'); assert.deepEqual(report.blockers,['POLICY_REQUIRED']);
  assert.equal(report.counts.reader_credit_ledger,2);
  for (const table of Object.keys(retentionSpecs).filter(table => table !== 'reader_credit_ledger')) assert.equal(report.counts[table],1,table);
  assert.equal(report.policyDigest,null); assert.equal(report.productionEnabled,false); assert.equal(report.accountDeletionCompleted,false);
  assert.deepEqual(f.snapshot(),before); assert.equal(readFileSync(policyFile,'utf8'),originalPolicy);
  const draft = JSON.parse(originalPolicy); assert.equal(draft.approved,false); assert.equal(draft.executionEnabled,false);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_MARKER|1234567|example\.test/);
  assert.ok(f.queries.length > 30);
}));

test('approved synthetic policy produces a canonical digest and cannot claim erasure completion',withFixture(async f => {
  const policy = syntheticPolicy(), before = f.snapshot();
  const report = await planFinancialRetention(f.db,f.requestId,options,policy);
  assert.equal(report.status,'ready_for_synthetic_review'); assert.deepEqual(report.blockers,[]);
  assert.match(report.policyDigest,/^[a-f0-9]{64}$/); assert.equal(report.accountDeletionCompleted,false);
  assert.equal(report.policySummary.financialDays,30); assert.equal(report.policySummary.receiptDays,14);
  const reorderedPolicy = Object.fromEntries(Object.entries(policy).reverse());
  for (const scope of Object.values(reorderedPolicy.tables)) { scope.retainColumns.reverse(); scope.reviewColumns.reverse(); }
  for (const shapes of Object.values(reorderedPolicy.jsonShapes)) shapes.reverse();
  assert.equal(await retentionPolicyDigest(reorderedPolicy),report.policyDigest);
  const changed = structuredClone(policy); changed.financialDays=31;
  assert.notEqual(await retentionPolicyDigest(changed),report.policyDigest);
  assert.deepEqual(f.snapshot(),before); assert.doesNotMatch(JSON.stringify(report),/PRIVATE_MARKER|1234567|example\.test/);
}));

test('policy validation requires explicit synthetic basis, positive durations and every table and column',async () => {
  const invalid = [
    [p => p.approved=false,'POLICY_NOT_APPROVED'],[p => p.environment='production','SYNTHETIC_POLICY_REQUIRED'],
    [p => p.dataset='production-account-copy','SYNTHETIC_POLICY_REQUIRED'],[p => p.version='','POLICY_BASIS_REQUIRED'],
    [p => p.jurisdiction='','POLICY_BASIS_REQUIRED'],[p => p.basis='','POLICY_BASIS_REQUIRED'],
    [p => p.financialDays=null,'POLICY_RETENTION_REQUIRED'],[p => p.financialDays=0,'POLICY_RETENTION_REQUIRED'],
    [p => p.receiptDays=-1,'POLICY_RETENTION_REQUIRED'],[p => p.receiptDays=1.5,'POLICY_RETENTION_REQUIRED'],
    [p => delete p.tables.novel_orders,'POLICY_SCOPE_REQUIRED'],
    [p => p.tables.novel_orders.scope='email-match','POLICY_SCOPE_REQUIRED'],
    [p => p.tables.novel_orders.retainColumns.push('customer_email'),'POLICY_SCOPE_REQUIRED'],
    [p => p.tables.reader_credit_ledger.retainColumns=p.tables.reader_credit_ledger.retainColumns.filter(column => column !== 'credits_delta'),'POLICY_SCOPE_REQUIRED'],
    [p => delete p.jsonShapes['novel_payment_events.payload_json'],'POLICY_JSON_SCOPE_REQUIRED'],
    [p => p.jsonShapes['novel_payment_events.payload_json']=[{type:'any'}],'INVALID_JSON_SHAPE_POLICY']
  ];
  for (const [mutate,code] of invalid) {
    const policy=syntheticPolicy(); mutate(policy);
    assert.throws(() => validateSyntheticRetentionPolicy(policy),error => error.code===code,code);
  }
  assert.throws(() => validateSyntheticRetentionPolicy(JSON.parse(originalPolicy)),/POLICY_NOT_APPROVED/);
});

test('exact order links include a detached tip, without matching an unrelated identical email or JSON value',withFixture(async f => {
  f.sqlite.prepare('UPDATE novel_tips SET account_id=NULL WHERE account_id=?').run(f.a.id);
  f.sqlite.prepare('UPDATE novel_orders SET customer_email=? WHERE account_id=?').run(`${f.a.marker}@example.test`,f.b.id);
  f.sqlite.prepare('UPDATE novel_payment_events SET payload_json=? WHERE order_id=?').run(JSON.stringify({accountId:f.a.id,email:`${f.a.marker}@example.test`}),f.b.order);
  const before=f.snapshot(),report=await planFinancialRetention(f.db,f.requestId,options,syntheticPolicy());
  assert.equal(report.status,'ready_for_synthetic_review'); assert.equal(report.counts.novel_tips,1);
  assert.equal(report.counts.novel_orders,1); assert.equal(report.counts.novel_payment_events,1);
  assert.deepEqual(f.snapshot(),before);
}));

test('cross-account order and reversal links fail closed even when foreign keys are valid',withFixture(async f => {
  f.sqlite.prepare('UPDATE novel_tips SET account_id=? WHERE order_id=?').run(f.b.id,f.a.order);
  f.sqlite.prepare('DELETE FROM membership_refund_review_items WHERE reversal_id=?').run(f.b.reversal);
  f.sqlite.prepare('UPDATE membership_refund_review_items SET redemption_ledger_id=? WHERE reversal_id=?').run(f.b.ledger,f.a.reversal);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  const before=f.snapshot(),report=await planFinancialRetention(f.db,f.requestId,options,syntheticPolicy());
  assert.equal(report.status,'blocked'); assert.ok(report.blockers.includes('FINANCIAL_ACCOUNT_LINK_MISMATCH'));
  assert.deepEqual(f.snapshot(),before); assert.doesNotMatch(JSON.stringify(report),/PRIVATE_MARKER/);
}));

test('unreviewed JSON blocks until its exact nested key and type shape is explicitly approved',withFixture(async f => {
  const payload={kind:'payment.completed',data:{customer:{email:`${f.a.marker}@example.test`},amount:1234567}};
  f.sqlite.prepare('UPDATE novel_payment_events SET payload_json=? WHERE order_id=?').run(JSON.stringify(payload),f.a.order);
  const policy=syntheticPolicy();
  let report=await planFinancialRetention(f.db,f.requestId,options,policy);
  assert.equal(report.status,'blocked'); assert.ok(report.blockers.includes('UNKNOWN_JSON_SHAPE'));
  policy.jsonShapes['novel_payment_events.payload_json'].push(financialJsonShape(payload));
  report=await planFinancialRetention(f.db,f.requestId,options,policy);
  assert.equal(report.status,'ready_for_synthetic_review');
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_MARKER|1234567|example\.test/);
  f.sqlite.prepare('UPDATE novel_payment_events SET payload_json=? WHERE order_id=?').run(JSON.stringify({...payload,data:{...payload.data,newPrivateField:f.a.marker}}),f.a.order);
  report=await planFinancialRetention(f.db,f.requestId,options,policy);
  assert.equal(report.status,'blocked'); assert.ok(report.blockers.includes('UNKNOWN_JSON_SHAPE'));
}));

test('malformed, oversized and nested encoded JSON cannot hide unknown fields',withFixture(async f => {
  const policy=syntheticPolicy();
  for (const raw of ['not-json',JSON.stringify({data:'x'.repeat(65536)})]) {
    f.sqlite.prepare('UPDATE novel_payment_events SET payload_json=? WHERE order_id=?').run(raw,f.a.order);
    const report=await planFinancialRetention(f.db,f.requestId,options,policy);
    assert.equal(report.status,'blocked'); assert.ok(report.blockers.includes('UNKNOWN_JSON_SHAPE'));
    assert.doesNotMatch(JSON.stringify(report),/not-json|xxxxxxx/);
  }
  const before={metadata_json:JSON.stringify({months:1})};
  assert.notDeepEqual(financialJsonShape(before),financialJsonShape({metadata_json:JSON.stringify({months:1,email:f.a.marker})}));
  assert.throws(() => financialJsonShape({metadata_json:'not-json'}),/INVALID_JSON/);
}));

test('unknown column fails schema review before any financial row is inspected',withFixture(async f => {
  f.sqlite.exec('ALTER TABLE novel_orders ADD COLUMN unreviewed_private_identity TEXT');
  const report=await planFinancialRetention(f.db,f.requestId,options,syntheticPolicy());
  assert.equal(report.status,'blocked'); assert.ok(report.blockers.includes('FINANCIAL_SCHEMA_DRIFT'));
  assert.deepEqual(report.counts,{}); assert.equal(report.policyDigest,null);
}));

test('real environment, unproven dataset and unconfirmed deletion are refused',withFixture(async f => {
  let report=await planFinancialRetention(f.db,f.requestId,{...options,environment:'production'},syntheticPolicy());
  assert.deepEqual(report.blockers,['ISOLATION_REQUIRED']); assert.equal(f.queries.length,0);
  f.sqlite.prepare("UPDATE r1_fixture_provenance SET dataset='synthetic-r1' WHERE id=1").run();
  f.sqlite.exec('DELETE FROM r1_fixture_provenance');
  report=await planFinancialRetention(f.db,f.requestId,options,syntheticPolicy());
  assert.ok(report.blockers.includes('SYNTHETIC_DATA_REQUIRED'));
  f.sqlite.exec("INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1')");
  f.sqlite.prepare("UPDATE mobile_deletions SET status='prepared',confirm_id=NULL,confirmed_at=NULL WHERE id=?").run(f.requestId);
  report=await planFinancialRetention(f.db,f.requestId,options,syntheticPolicy());
  assert.ok(report.blockers.includes('CONFIRMED_DELETION_REQUIRED')); assert.deepEqual(report.counts,{});
}));

test('bounded scan cannot approve financial JSON rows it did not inspect',withFixture(async f => {
  const insert=f.sqlite.prepare("INSERT INTO novel_payment_events(order_id,payload_json) VALUES(?,'{}')");
  for(let index=0;index<200;index++)insert.run(f.a.order);
  const before=f.snapshot(),report=await planFinancialRetention(f.db,f.requestId,options,syntheticPolicy());
  assert.equal(report.counts.novel_payment_events,201); assert.equal(report.status,'blocked');
  assert.ok(report.blockers.includes('FINANCIAL_JSON_SCAN_LIMIT')); assert.deepEqual(f.snapshot(),before);
}));
