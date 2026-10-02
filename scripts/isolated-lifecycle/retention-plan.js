// Read-only, synthetic-only financial review. This module never issues a write.
// A candidate column is still pseudonymous data, not anonymous or approved for production.
import inventory from '../../docs/mobile-ios-m2/deletion-plan/schema-inventory.json' with {type:'json'};

const reviewed = inventory.databases.reader;
const groups = {
  reader_credit_accounts: {
    association: ['account_id'], amount: ['balance_credits','lifetime_purchased_credits','lifetime_spent_credits','currency_label'],
    timeline: ['created_at','updated_at']
  },
  reader_credit_ledger: {
    association: ['id','account_id','source','source_ref','series_slug','chapter_slug'], amount: ['credits_delta','balance_after'],
    dispute: ['entry_type'], free_text: ['note'], raw_json: ['metadata_json'], timeline: ['created_at']
  },
  reader_memberships: {
    association: ['account_id','source','source_ref'], dispute: ['membership_level'], raw_json: ['metadata_json'],
    timeline: ['started_at','expires_at','last_redeemed_at','created_at','updated_at']
  },
  reader_membership_redemptions: {
    association: ['account_id','ledger_id'], idempotency: ['request_key','operation_token'],
    amount: ['cost_credits','duration_months','unit_label','balance_before'], dispute: ['covers_paid','applied'],
    raw_json: ['membership_json'], timeline: ['previous_expires_at','created_at']
  },
  membership_refund_reviews: {
    association: ['reversal_id','account_id'], idempotency: ['operation_token','intent_hash'], dispute: ['decision','applied'],
    identity: ['actor_email'], free_text: ['reason'], raw_json: ['before_json'], amount: ['removed_seconds'],
    timeline: ['after_expires_at','created_at']
  },
  membership_refund_review_items: {
    association: ['redemption_ledger_id','reversal_id'], amount: ['removed_seconds']
  },
  novel_orders: {
    association: ['id','account_id','provider','provider_order_id','provider_payment_id','provider_invoice_id','order_type','series_slug','chapter_slug','entitlement_scope','entitlement_access_level'],
    idempotency: ['order_token'], amount: ['price_amount','price_currency','pay_amount','pay_currency'],
    identity: ['payment_url','customer_email'], dispute: ['status','provider_status'], raw_json: ['metadata_json'],
    timeline: ['expires_at','confirmed_at','finished_at','created_at','updated_at']
  },
  novel_tips: {
    association: ['id','order_id','account_id','provider','provider_order_id','provider_payment_id','series_slug'],
    amount: ['amount','currency'], free_text: ['message'], dispute: ['status'], raw_json: ['metadata_json'], timeline: ['created_at','updated_at']
  },
  novel_payment_events: {
    association: ['id','provider','order_id','provider_order_id','provider_payment_id'], idempotency: ['provider_event_id'],
    dispute: ['event_type','status','signature_valid'], raw_json: ['payload_json'], timeline: ['received_at']
  },
  novel_entitlements: {
    association: ['id','account_id','series_slug','chapter_slug','scope','access_level','source','source_ref'],
    free_text: ['note'], identity: ['granted_by'], timeline: ['granted_at','expires_at','revoked_at','created_at','updated_at']
  },
  game_purchases: {
    association: ['id','account_id','game_key','product_id','product_type','entitlement_key','catalog_revision','ledger_id','ledger_source','ledger_source_ref','reversal_ledger_id'],
    amount: ['points_spent','balance_before','balance_after'], raw_json: ['product_snapshot_json'],
    idempotency: ['idempotency_key','reversal_id'], dispute: ['status'], free_text: ['reversal_reason'],
    timeline: ['completed_at','reversed_at','created_at','updated_at']
  },
  game_entitlements: {
    association: ['id','account_id','game_key','entitlement_key','product_id','purchase_id','grant_source','source_ref'],
    free_text: ['grant_reason','revoke_reason'], identity: ['granted_by'], raw_json: ['metadata_json'],
    timeline: ['granted_at','expires_at','revoked_at','created_at','updated_at']
  },
  game_commerce_events: {
    association: ['id','account_id','purchase_id','product_id','entitlement_key'], idempotency: ['event_key'],
    dispute: ['event_type'], amount: ['points_delta'], raw_json: ['metadata_json'], timeline: ['created_at']
  },
  game_entitlement_events: {
    association: ['id','account_id','entitlement_id','product_id','entitlement_key'], idempotency: ['event_key'],
    dispute: ['event_type'], identity: ['actor_email'], free_text: ['reason'], raw_json: ['metadata_json'], timeline: ['created_at']
  }
};
const removal = new Set(['identity','free_text','raw_json']);
const deepFreeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
};
const fail = code => { throw Object.assign(new Error(code), {code}); };
const check = (condition, code) => { if (!condition) fail(code); };
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const same = (a,b) => canonical(a) === canonical(b);

// All paths are literal SQL over reviewed account / order / reversal links.
// Each placeholder binds the same account ID; no email or arbitrary JSON search is used.
const links = {
  reader_membership_redemptions: [['ledger_id','reader_credit_ledger','id']],
  membership_refund_reviews: [['reversal_id','reader_credit_ledger','id']],
  membership_refund_review_items: [['reversal_id','membership_refund_reviews','reversal_id'],['redemption_ledger_id','reader_credit_ledger','id']],
  novel_tips: [['order_id','novel_orders','id']],
  novel_payment_events: [['order_id','novel_orders','id']],
  game_purchases: [['ledger_id','reader_credit_ledger','id'],['reversal_ledger_id','reader_credit_ledger','id']],
  game_entitlements: [['purchase_id','game_purchases','id']],
  game_commerce_events: [['purchase_id','game_purchases','id']],
  game_entitlement_events: [['entitlement_id','game_entitlements','id']]
};

const specs = {};
for (const [table, categories] of Object.entries(groups)) {
  const columns = reviewed[table]?.columns;
  const classified = Object.values(categories).flat();
  check(reviewed[table]?.category === 'financial_review' && classified.length === columns.length &&
    new Set(classified).size === classified.length && same([...classified].sort(), [...columns].sort()), 'REVIEW_MANIFEST_DRIFT');
  const classifications = Object.fromEntries(Object.entries(categories).flatMap(([category,names]) => names.map(name => [name,category])));
  const retainColumns = columns.filter(column => !removal.has(classifications[column]));
  const reviewColumns = columns.filter(column => removal.has(classifications[column]));
  const associations = (links[table] || []).map(([column,parent,parentColumn]) => ({column,parent,parentColumn}));
  const selectors = columns.includes('account_id') ? [`${table}.account_id=?`] : [];
  for (const {column,parent,parentColumn} of associations) selectors.push(`${table}.${column} IN (SELECT ${parentColumn} FROM ${parent} WHERE account_id=?)`);
  specs[table] = {
    selector: `(${selectors.join(' OR ')})`, selectorBindings: selectors.length,
    retainColumns, reviewColumns, classifications, associations,
    emptyValues: Object.fromEntries(reviewColumns.map(column => [column, classifications[column] === 'raw_json' ? '{}' : '']))
  };
}
check(same(Object.keys(specs).sort(), Object.entries(reviewed).filter(([,s]) => s.category === 'financial_review').map(([name]) => name).sort()), 'REVIEW_MANIFEST_DRIFT');
export const retentionSpecs = deepFreeze(specs);
export const financialColumnReview = deepFreeze(Object.fromEntries(Object.entries(specs).map(([table,s]) => [table,s.classifications])));

const jsonColumns = Object.entries(specs).flatMap(([table,s]) => s.reviewColumns.filter(column => s.classifications[column] === 'raw_json').map(column => `${table}.${column}`));
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort());
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,127}$/.test(value);

// Descriptors contain only key names and types. They never contain JSON values.
// Arrays have an exact reviewed length; embedded *_json strings are reviewed recursively.
export function financialJsonShape(value) {
  let nodes = 0;
  const walk = (item, depth, key = '') => {
    check(++nodes <= 2048 && depth <= 12, 'JSON_SHAPE_LIMIT');
    if (key.endsWith('_json') && typeof item === 'string') {
      let decoded; try { decoded = JSON.parse(item); } catch { fail('INVALID_JSON'); }
      return {type:'encoded_json', shape:walk(decoded,depth+1)};
    }
    if (item === null) return {type:'null'};
    if (Array.isArray(item)) {
      check(item.length <= 100, 'JSON_SHAPE_LIMIT');
      return {type:'array',items:item.map(child => walk(child,depth+1))};
    }
    if (typeof item === 'object') {
      check(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'INVALID_JSON_SHAPE');
      const fields = Object.create(null);
      for (const name of Object.keys(item).sort()) {
        check(name.length <= 128 && !['__proto__','prototype','constructor'].includes(name), 'INVALID_JSON_SHAPE');
        fields[name] = walk(item[name],depth+1,name);
      }
      return {type:'object',fields};
    }
    check(['string','number','boolean'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item)), 'INVALID_JSON_SHAPE');
    return {type:typeof item};
  };
  return walk(value,0);
}

function validateShape(descriptor, depth = 0, budget = {nodes:0}) {
  check(++budget.nodes <= 2048 && depth <= 12 && descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor), 'INVALID_JSON_SHAPE_POLICY');
  if (['string','number','boolean','null'].includes(descriptor.type)) check(exactKeys(descriptor,['type']), 'INVALID_JSON_SHAPE_POLICY');
  else if (descriptor.type === 'object') {
    check(exactKeys(descriptor,['type','fields']) && descriptor.fields && typeof descriptor.fields === 'object' && !Array.isArray(descriptor.fields), 'INVALID_JSON_SHAPE_POLICY');
    for (const [key,child] of Object.entries(descriptor.fields)) {
      check(key.length <= 128 && !['__proto__','prototype','constructor'].includes(key), 'INVALID_JSON_SHAPE_POLICY');
      validateShape(child,depth+1,budget);
    }
  } else if (descriptor.type === 'array') {
    check(exactKeys(descriptor,['type','items']) && Array.isArray(descriptor.items) && descriptor.items.length <= 100, 'INVALID_JSON_SHAPE_POLICY');
    for (const child of descriptor.items) validateShape(child,depth+1,budget);
  } else if (descriptor.type === 'encoded_json') {
    check(exactKeys(descriptor,['type','shape']), 'INVALID_JSON_SHAPE_POLICY');
    validateShape(descriptor.shape,depth+1,budget);
  } else fail('INVALID_JSON_SHAPE_POLICY');
}

export function validateSyntheticRetentionPolicy(policy) {
  check(policy?.approved === true, 'POLICY_NOT_APPROVED');
  check(exactKeys(policy,['version','approved','environment','dataset','jurisdiction','basis','financialDays','receiptDays','tables','jsonShapes']), 'INVALID_POLICY');
  check(policy.environment === 'isolated' && policy.dataset === 'synthetic-r1', 'SYNTHETIC_POLICY_REQUIRED');
  check(token(policy.version) && token(policy.jurisdiction) && token(policy.basis), 'POLICY_BASIS_REQUIRED');
  check(Number.isSafeInteger(policy.financialDays) && policy.financialDays > 0 && Number.isSafeInteger(policy.receiptDays) && policy.receiptDays > 0, 'POLICY_RETENTION_REQUIRED');
  check(exactKeys(policy.tables,Object.keys(specs)), 'POLICY_SCOPE_REQUIRED');
  for (const [table,s] of Object.entries(specs)) {
    const scope = policy.tables[table];
    check(exactKeys(scope,['scope','retainColumns','reviewColumns']) && scope.scope === 'exact-account-links' &&
      Array.isArray(scope.retainColumns) && Array.isArray(scope.reviewColumns) &&
      same([...scope.retainColumns].sort(), [...s.retainColumns].sort()) && same([...scope.reviewColumns].sort(), [...s.reviewColumns].sort()), 'POLICY_SCOPE_REQUIRED');
  }
  check(exactKeys(policy.jsonShapes,jsonColumns), 'POLICY_JSON_SCOPE_REQUIRED');
  for (const shapes of Object.values(policy.jsonShapes)) {
    check(Array.isArray(shapes) && shapes.length > 0 && shapes.length <= 16, 'INVALID_JSON_SHAPE_POLICY');
    for (const descriptor of shapes) validateShape(descriptor);
    check(new Set(shapes.map(canonical)).size === shapes.length, 'INVALID_JSON_SHAPE_POLICY');
  }
  // Column/shape lists are sets, so their insertion order must not change the digest.
  const normalized = {
    ...policy,
    tables:Object.fromEntries(Object.entries(specs).map(([table,s]) => [table,{
      scope:'exact-account-links',retainColumns:[...s.retainColumns],reviewColumns:[...s.reviewColumns]
    }])),
    jsonShapes:Object.fromEntries(jsonColumns.map(column => [column,[...policy.jsonShapes[column]].sort((a,b) => canonical(a).localeCompare(canonical(b)))]))
  };
  return deepFreeze(JSON.parse(canonical(normalized)));
}

export async function retentionPolicyDigest(policy) {
  const normalized = validateSyntheticRetentionPolicy(policy);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(normalized)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
}

export async function validateFinancialRetentionSchema(db) {
  for (const table of Object.keys(specs)) {
    const info = (await db.prepare(`PRAGMA table_info(${table})`).all()).results;
    check(Array.isArray(info) && same(info.map(column => column.name),reviewed[table].columns), 'FINANCIAL_SCHEMA_DRIFT');
    const foreignKeys = (await db.prepare(`PRAGMA foreign_key_list(${table})`).all()).results;
    const normalized = foreignKeys.map(key => ({id:key.id,seq:key.seq,column:key.from,parent:key.table,parentColumn:key.to,onDelete:key.on_delete}));
    check(same(normalized,reviewed[table].foreignKeys), 'FINANCIAL_SCHEMA_DRIFT');
  }
}

const bindings = (account,count) => Array.from({length:count},() => account);
const columnsSummary = () => Object.fromEntries(Object.entries(specs).map(([table,s]) => [table,{
  candidateRetain:[...s.retainColumns], removeIdentity:s.reviewColumns.filter(c => s.classifications[c] === 'identity'),
  removeFreeText:s.reviewColumns.filter(c => s.classifications[c] === 'free_text'), removeRawJson:s.reviewColumns.filter(c => s.classifications[c] === 'raw_json')
}]));

export async function planFinancialRetention(db, requestId, options, policy = null) {
  const result = {status:'blocked',blockers:[],counts:{},columns:columnsSummary(),jsonReview:{},policyDigest:null,policySummary:null,
    productionEnabled:false,accountDeletionCompleted:false};
  const blocked = code => { if (!result.blockers.includes(code)) result.blockers.push(code); };
  let normalized;
  if (policy === null || policy === undefined) blocked('POLICY_REQUIRED');
  else try { normalized = validateSyntheticRetentionPolicy(policy); } catch (error) { blocked(error.code || 'INVALID_POLICY'); }
  try {
    check(options?.environment === 'isolated' && options?.dataset === 'synthetic-r1', 'ISOLATION_REQUIRED');
    check(typeof requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId), 'INVALID_REQUEST_ID');
    check((await db.prepare('SELECT dataset FROM r1_fixture_provenance WHERE id=1').first())?.dataset === 'synthetic-r1', 'SYNTHETIC_DATA_REQUIRED');
    await validateFinancialRetentionSchema(db);
    const task = await db.prepare(`SELECT d.account_id,d.confirm_id,d.confirmed_at,d.status,a.status AS account_status
      FROM mobile_deletions d JOIN reader_accounts a ON a.id=d.account_id WHERE d.id=?`).bind(requestId).first();
    check(task?.confirm_id && task.confirmed_at && ['accepted','processing','retrying','attention_required'].includes(task.status) &&
      ['deletion_pending','deleted_pending_review'].includes(task.account_status) && Number.isSafeInteger(task.account_id) && task.account_id > 0, 'CONFIRMED_DELETION_REQUIRED');
    const account = task.account_id;
    for (const [table,s] of Object.entries(specs)) {
      const args = bindings(account,s.selectorBindings);
      const count = (await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${s.selector}`).bind(...args).first()).n;
      check(Number.isSafeInteger(count) && count >= 0, 'INVALID_COUNT');
      result.counts[table] = count;
      if (reviewed[table].columns.includes('account_id')) {
        const mismatch = (await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${s.selector} AND account_id IS NOT NULL AND account_id!=?`).bind(...args,account).first()).n;
        if (mismatch) blocked('FINANCIAL_ACCOUNT_LINK_MISMATCH');
      }
      for (const {column,parent,parentColumn} of s.associations) {
        const mismatch = (await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${s.selector} AND ${table}.${column} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${parent} WHERE ${parent}.${parentColumn}=${table}.${column} AND ${parent}.account_id=?)`).bind(...args,account).first()).n;
        if (mismatch) blocked('FINANCIAL_ACCOUNT_LINK_MISMATCH');
      }
      const json = s.reviewColumns.filter(column => s.classifications[column] === 'raw_json');
      if (!json.length) continue;
      // A bounded report must not pretend to have reviewed unscanned rows.
      if (count > 200) { blocked('FINANCIAL_JSON_SCAN_LIMIT'); continue; }
      const rows = (await db.prepare(`SELECT ${json.join(',')} FROM ${table} WHERE ${s.selector} LIMIT 201`).bind(...args).all()).results;
      check(rows.length === count, 'FINANCIAL_REVIEW_CHANGED');
      result.jsonReview[table] = {};
      for (const column of json) {
        let recognized = 0;
        for (const row of rows) {
          try {
            const raw = row[column];
            check(raw === null || (typeof raw === 'string' && new TextEncoder().encode(raw).length <= 65536), 'INVALID_JSON');
            const shape = financialJsonShape(raw === null ? null : JSON.parse(raw));
            const allowed = normalized?.jsonShapes[`${table}.${column}`] || [financialJsonShape({}),financialJsonShape(null)];
            check(allowed.some(reviewedShape => same(reviewedShape,shape)), 'UNKNOWN_JSON_SHAPE');
            recognized++;
          } catch { blocked('UNKNOWN_JSON_SHAPE'); }
        }
        result.jsonReview[table][column] = {inspected:rows.length,recognized};
      }
    }
    if (normalized) {
      result.policyDigest = await retentionPolicyDigest(normalized);
      result.policySummary = {version:normalized.version,jurisdiction:normalized.jurisdiction,basis:normalized.basis,
        financialDays:normalized.financialDays,receiptDays:normalized.receiptDays,scope:'synthetic-r1-only',tableCount:Object.keys(specs).length};
    }
    if (!result.blockers.length) result.status = 'ready_for_synthetic_review';
  } catch (error) { blocked(error.code || 'FINANCIAL_REVIEW_UNAVAILABLE'); }
  return result;
}
