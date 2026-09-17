import {isReaderMembershipActive,membershipTimestamp} from '../readerMembership.js';
import {requireValue,iso} from './security.js';

// Music-specific projection of the existing site ledger. No writes, subscription
// sale, invented membership level or change to novel/payment semantics.
export async function nativeMusicEntitlements(db, session, now) {
  const row=await db.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(session.account_id).first();
  if(row) requireValue(row.membership_level==='member' && Number.isFinite(membershipTimestamp(row.started_at)) &&
    Number.isFinite(membershipTimestamp(row.expires_at)) && membershipTimestamp(row.started_at)<=membershipTimestamp(row.expires_at),'SERVICE_UNAVAILABLE',503);
  const active=isReaderMembershipActive(row,now), end=row?membershipTimestamp(row.expires_at):null;
  const valid=active?Math.min(end,session.access_until,session.absolute_until):null;
  return {accountId:String(session.account_id), music:{canPlayVipFull:active,accessValidUntil:valid===null?null:iso(valid),
    revalidateAt:iso(Math.min(now+60000,valid??session.access_until)),
    sources:row?[{kind:'site_vip',provider:'station',status:active?'active':'expired',validUntil:iso(end)}]:[]},
    siteVip:{active,validUntil:end===null?null:iso(end)}};
}
