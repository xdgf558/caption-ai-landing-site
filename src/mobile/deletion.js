import {requireValue,MobileError,validID,validSecret,hashBytes,decode,iso,exactKeys,assertChanged,clearAssert} from './security.js';
const scope='station-account-v1';
export async function requireRecent(db,s,now) {
  requireValue(s.recent_auth_at>now-300_000 && s.recent_auth_at<=now,'RECENT_AUTH_REQUIRED',403);
  const t=await db.prepare('SELECT enabled_at,disabled_at FROM reader_totp_credentials WHERE account_id=?').bind(s.account_id).first();
  requireValue(s.recent_auth_totp_version===JSON.stringify([t?.enabled_at||'',t?.disabled_at||'']),'RECENT_AUTH_REQUIRED',403);
}
const recentPredicate=`EXISTS(SELECT 1 FROM mobile_sessions s JOIN reader_accounts a ON a.id=s.account_id
 JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id
 WHERE s.id=? AND s.revoked=0 AND s.access_until>? AND s.recent_auth_at>? AND s.account_id=mobile_deletions.account_id
 AND a.status='active' AND p.password_hash=s.password_version
 AND s.recent_auth_totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,'')))`;
export function deletionDTO(row, now) {
  const common={deletionRequestId:row.id,receiptExpiresAt:iso(row.receipt_until)};
  if(row.status==='prepared' && row.prepare_until>now)return {...common,status:'prepared',scopeVersion:row.scope_version,prepareExpiresAt:iso(row.prepare_until),confirmAccepted:false};
  if(row.status==='prepared' || row.status==='preparation_expired')return {...common,status:'preparation_expired',confirmAccepted:false};
  return {...common,status:row.status,confirmAccepted:true,stage:row.stage,confirmedAt:iso(row.confirmed_at),completedAt:row.completed_at?iso(row.completed_at):null};
}
export async function prepareDeletion(db,s,body,key,now) {
  exactKeys(body,['deletionRequestId','deletionReceiptHash','scopeVersion']);
  requireValue(validID(key) && validID(body.deletionRequestId) && body.scopeVersion===scope && /^[a-f0-9]{64}$/.test(body.deletionReceiptHash) &&
    !/^([a-f0-9])\1{63}$/.test(body.deletionReceiptHash) && body.deletionReceiptHash!==await hashBytes(new Uint8Array(32)));
  await requireRecent(db,s,now);
  const read=()=>db.prepare('SELECT * FROM mobile_deletions WHERE id=?').bind(body.deletionRequestId).first();
  const check=row=>{
    requireValue(row && row.account_id===s.account_id && row.prepare_id===key && row.receipt_hash===body.deletionReceiptHash && row.scope_version===scope,'VERSION_CONFLICT',409);
    return deletionDTO(row,now);
  };
  let row=await read();if(row)return check(row);
  try {
    await db.batch([
      db.prepare(`UPDATE mobile_deletions SET status='preparation_expired' WHERE account_id=? AND status='prepared' AND prepare_until<=?`).bind(s.account_id,now),
      db.prepare(`INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status)
        SELECT ?,?,?,?,?,?,?,'prepared' WHERE EXISTS(SELECT 1 FROM mobile_sessions s JOIN reader_accounts a ON a.id=s.account_id
          JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id
          WHERE s.id=? AND s.revoked=0 AND s.access_until>? AND s.recent_auth_at>? AND a.status='active'
          AND p.password_hash=s.password_version AND s.recent_auth_totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,'')))`)
        .bind(body.deletionRequestId,s.account_id,key,body.deletionReceiptHash,scope,now+600_000,now+14*86400_000,s.id,now,now-300_000),
      assertChanged(db),clearAssert(db)
    ]);
  } catch {
    row=await read();if(row)return check(row);
    const other=await db.prepare(`SELECT id FROM mobile_deletions WHERE account_id=? AND status NOT IN ('preparation_expired','completed')`).bind(s.account_id).first();
    if(other)throw new MobileError('VERSION_CONFLICT',409);
    throw new MobileError('SERVICE_UNAVAILABLE',503);
  }
  return check(await read());
}
export async function confirmDeletion(db,s,id,body,key,now) {
  exactKeys(body,['confirmedScopeVersion']);requireValue(validID(key) && validID(id) && body.confirmedScopeVersion===scope);
  await requireRecent(db,s,now);
  try {
    await db.batch([
      db.prepare(`UPDATE mobile_deletions SET status='accepted',stage='queued',confirm_id=?,confirmed_at=?
        WHERE id=? AND account_id=? AND status='prepared' AND prepare_until>? AND receipt_until>? AND ${recentPredicate}`)
        .bind(key,now,id,s.account_id,now,now,s.id,now,now-300_000),assertChanged(db),
      db.prepare(`UPDATE reader_accounts SET status='deletion_pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`).bind(s.account_id),assertChanged(db),
      db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE account_id=?').bind(s.account_id),
      db.prepare('UPDATE reader_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE account_id=? AND revoked_at IS NULL').bind(s.account_id),
      db.prepare('UPDATE reader_login_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE account_id=? AND consumed_at IS NULL').bind(s.account_id),
      db.prepare('INSERT INTO mobile_deletion_outbox(job_id,updated_at) VALUES(?,?)').bind(id,now),clearAssert(db)
    ]);
  } catch {
    const row=await db.prepare('SELECT * FROM mobile_deletions WHERE id=? AND account_id=?').bind(id,s.account_id).first();
    if(row?.confirm_id===key && row.confirmed_at)return deletionDTO(row,now);
    if(!row || row.status!=='prepared' || row.prepare_until<=now)throw new MobileError('VERSION_CONFLICT',409);
    throw new MobileError('SERVICE_UNAVAILABLE',503);
  }
  return deletionDTO(await db.prepare('SELECT * FROM mobile_deletions WHERE id=?').bind(id).first(),now);
}
export async function deletionStatus(db,request,id,now) {
  const receipt=/^DeletionReceipt ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'')?.[1];
  requireValue(validID(id) && validSecret(receipt),'DELETION_STATUS_UNAVAILABLE',404);
  let bytes;try{bytes=decode(receipt);}catch{throw new MobileError('DELETION_STATUS_UNAVAILABLE',404);}
  requireValue(bytes.length===32,'DELETION_STATUS_UNAVAILABLE',404);
  const row=await db.prepare('SELECT * FROM mobile_deletions WHERE id=? AND receipt_hash=? AND receipt_until>?').bind(id,await hashBytes(bytes),now).first();
  requireValue(row,'DELETION_STATUS_UNAVAILABLE',404);return deletionDTO(row,now);
}
// Durable local M2 outbox consumer. Until a reviewed cross-product retention policy exists,
// do NOT physically delete account/financial/game data or report completion.
export async function processDeletionOutbox(db,now) {
  await db.batch([
    db.prepare(`UPDATE mobile_deletions SET status='attention_required',stage='retention_policy_review'
      WHERE status IN ('accepted','retrying') AND id IN(SELECT job_id FROM mobile_deletion_outbox WHERE status='pending')`),
    db.prepare(`UPDATE mobile_deletion_outbox SET status='attention_required',attempts=attempts+1,updated_at=?
      WHERE status='pending' AND job_id IN(SELECT id FROM mobile_deletions WHERE stage='retention_policy_review')`).bind(now)
  ]);
}
