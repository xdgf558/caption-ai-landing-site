import { MobileError, requireValue, validID, validSecret, randomSecret, hash, challenge, equal, iso, seal, unseal, exactKeys, assertChanged, clearAssert } from './security.js';

export async function principal(db, request, now) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') || '');
  requireValue(match, 'AUTH_REQUIRED',401); // Never fall back to a web Cookie.
  const session = await db.prepare(`SELECT s.*, a.display_name FROM mobile_sessions s
    JOIN reader_accounts a ON a.id=s.account_id JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id
    WHERE s.access_hash=? AND s.revoked=0 AND s.access_until>? AND s.absolute_until>?
      AND a.status='active' AND s.password_version=p.password_hash AND s.totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,''))`).bind(await hash(match[1]),now,now).first();
  requireValue(session,'SESSION_REVOKED',401); return session;
}
function tokenResult(accountID,sessionID,familyID,generation,now,absoluteUntil) {
  return {accountId:String(accountID),sessionId:sessionID,tokenFamilyId:familyID,generation,
    accessToken:randomSecret(),accessExpiresAt:iso(Math.min(now+300_000,absoluteUntil)),
    refreshToken:randomSecret(),refreshExpiresAt:iso(Math.min(now+30*86400_000,absoluteUntil)),absoluteExpiresAt:iso(absoluteUntil)};
}
export async function exchange(db, body, config, now) {
  exactKeys(body,['clientId','code','codeVerifier','redirectUri']);
  requireValue(body.clientId==='station-cat-ios' && validSecret(body.code) && typeof body.codeVerifier==='string' &&
    /^[A-Za-z0-9._~-]{43,128}$/.test(body.codeVerifier) && body.redirectUri===config.redirect);
  const digest=await hash(body.code);
  const code=await db.prepare(`SELECT c.* FROM mobile_codes c JOIN reader_accounts a ON a.id=c.account_id
    JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id
    WHERE c.hash=? AND c.used=0 AND c.expires_at>? AND a.status='active'
      AND c.password_version=p.password_hash AND c.totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,''))`).bind(digest,now).first();
  requireValue(code && code.redirect_uri===config.redirect && await equal(code.challenge,await challenge(body.codeVerifier)),'AUTH_REQUIRED',401);
  const result=tokenResult(code.account_id,crypto.randomUUID(),crypto.randomUUID(),0,now,now+90*86400_000);
  try {
    await db.batch([
      db.prepare(`UPDATE mobile_codes SET used=1 WHERE hash=? AND used=0 AND expires_at>?
        AND EXISTS(SELECT 1 FROM reader_accounts a JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id
          WHERE a.id=mobile_codes.account_id AND a.status='active' AND p.password_hash=mobile_codes.password_version AND mobile_codes.totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,'')))` ).bind(digest,now),
      assertChanged(db),
      db.prepare(`INSERT INTO mobile_sessions(id,family_id,account_id,generation,access_hash,access_until,refresh_until,absolute_until,authenticated_at,password_version,totp_version)
        VALUES(?,?,?,0,?,?,?,?,?,?,?)`).bind(result.sessionId,result.tokenFamilyId,code.account_id,await hash(result.accessToken),Date.parse(result.accessExpiresAt),Date.parse(result.refreshExpiresAt),Date.parse(result.absoluteExpiresAt),code.authenticated_at,code.password_version,code.totp_version),
      db.prepare('INSERT INTO mobile_refresh_tokens(hash,family_id,generation) VALUES(?,?,0)').bind(await hash(result.refreshToken),result.tokenFamilyId),clearAssert(db)
    ]);
  } catch { // A race must consume the code exactly once, never issue a second session.
    const used=await db.prepare('SELECT used FROM mobile_codes WHERE hash=?').bind(digest).first();
    if(used?.used)throw new MobileError('AUTH_REQUIRED',401); throw new MobileError('SERVICE_UNAVAILABLE',503);
  }
  return result;
}
export async function refresh(db, body, config, now) {
  exactKeys(body,['clientId','refreshToken','refreshRequestId','generation']);
  requireValue(body.clientId==='station-cat-ios' && validSecret(body.refreshToken) && validID(body.refreshRequestId) && Number.isSafeInteger(body.generation) && body.generation>=0);
  const tokenHash=await hash(body.refreshToken);
  // Identity comes only from the verified token hash. A client cannot choose a family/account.
  const s=await db.prepare(`SELECT s.*, rt.generation AS token_generation FROM mobile_refresh_tokens rt
    JOIN mobile_sessions s ON s.family_id=rt.family_id JOIN reader_accounts a ON a.id=s.account_id
    JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id WHERE rt.hash=? AND s.revoked=0
      AND s.absolute_until>? AND s.refresh_until>? AND a.status='active' AND s.password_version=p.password_hash AND s.totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,''))`).bind(tokenHash,now,now).first();
  requireValue(s,'SESSION_REVOKED',401);
  const digest=await hash(JSON.stringify(['station-cat-ios',tokenHash,body.refreshRequestId,body.generation]));
  const readOperation=()=>db.prepare('SELECT * FROM mobile_refresh_operations WHERE family_id=? AND request_id=?').bind(s.family_id,body.refreshRequestId).first();
  const replay = async op => {
    requireValue(op.digest===digest && op.old_generation===body.generation,'REFRESH_CONFLICT',409);
    const current=await db.prepare(`SELECT s.* FROM mobile_sessions s JOIN reader_accounts a ON a.id=s.account_id
      JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id WHERE s.family_id=? AND s.revoked=0
        AND a.status='active' AND p.password_hash=s.password_version AND s.totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,''))`).bind(s.family_id).first();
    requireValue(current && current.absolute_until>now && current.refresh_until>now,'SESSION_REVOKED',401);
    requireValue(current.generation===op.old_generation+1 && op.result && op.result_until>now,'REFRESH_REAUTH_REQUIRED',409);
    return unseal(op.result,config,`${s.family_id}:${body.refreshRequestId}:${digest}`);
  };
  let existing=await readOperation(); if(existing)return replay(existing);
  requireValue(body.generation===s.token_generation,'REFRESH_CONFLICT',409);
  if(s.generation!==s.token_generation) {
    await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE family_id=?').bind(s.family_id).run();
    throw new MobileError('SESSION_REVOKED',401);
  }
  const result={...tokenResult(s.account_id,s.id,s.family_id,s.generation+1,now,s.absolute_until),
    refreshRequestId:body.refreshRequestId,previousGeneration:s.generation,replayUntil:iso(now+120_000)};
  const box=await seal(result,config,`${s.family_id}:${body.refreshRequestId}:${digest}`);
  try {
    await db.batch([
      db.prepare(`UPDATE mobile_sessions SET generation=generation+1,access_hash=?,access_until=?,refresh_until=?
        WHERE family_id=? AND generation=? AND revoked=0 AND absolute_until>? AND refresh_until>?
        AND EXISTS(SELECT 1 FROM reader_accounts a JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id
          WHERE a.id=mobile_sessions.account_id AND a.status='active' AND p.password_hash=mobile_sessions.password_version AND mobile_sessions.totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,'')))`)
        .bind(await hash(result.accessToken),Date.parse(result.accessExpiresAt),Date.parse(result.refreshExpiresAt),s.family_id,s.generation,now,now),
      assertChanged(db), // A zero-row CAS fails a CHECK and rolls back the whole D1 batch.
      db.prepare('INSERT INTO mobile_refresh_tokens(hash,family_id,generation) VALUES(?,?,?)').bind(await hash(result.refreshToken),s.family_id,result.generation),
      db.prepare(`INSERT INTO mobile_refresh_operations(family_id,request_id,old_generation,digest,result,result_until,absolute_until) VALUES(?,?,?,?,?,?,?)`)
        .bind(s.family_id,body.refreshRequestId,s.generation,digest,box,now+120_000,s.absolute_until),clearAssert(db)
    ]);
  } catch {
    existing=await readOperation(); if(existing)return replay(existing);
    const current=await db.prepare('SELECT generation,revoked FROM mobile_sessions WHERE family_id=?').bind(s.family_id).first();
    if(current?.revoked)throw new MobileError('SESSION_REVOKED',401);
    if(current?.generation>s.generation){await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE family_id=?').bind(s.family_id).run();throw new MobileError('SESSION_REVOKED',401);}
    throw new MobileError('SERVICE_UNAVAILABLE',503);
  }
  return result;
}
export async function cleanup(db, now) {
  await db.batch([
    db.prepare('UPDATE mobile_refresh_operations SET result=NULL WHERE result_until<=?').bind(now),
    // The spent tokens and operation tombstones survive until the family's absolute end.
    db.prepare('DELETE FROM mobile_sessions WHERE absolute_until<=?').bind(now),
    db.prepare('DELETE FROM mobile_codes WHERE expires_at<=?').bind(now),
    db.prepare('DELETE FROM mobile_browser_flows WHERE expires_at<=?').bind(now),
    db.prepare('DELETE FROM mobile_rate_limits WHERE window<?').bind(Math.floor(now/60_000)-2)
  ]);
}
