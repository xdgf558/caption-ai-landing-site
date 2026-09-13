import { fail, fields } from './adminValidation.js';
import { primary, rows, mutate } from './adminStore.js';

export const MAX_QUOTA_MIB = 1048576; // Admin control ceiling: 1 TiB, not a purchased storage plan.
const MIB = 1048576;
const charged = '(SELECT COALESCE(SUM(charged_bytes),0) FROM music_storage_charges)';
export async function readMusicStorageQuota(db) {
  const r = rows(await primary(db).prepare(`SELECT value_json,updated_at,${charged} AS charged FROM music_settings WHERE key='storageQuotaBytes'`).all())[0];
  let quota;
  try { quota = JSON.parse(r?.value_json); } catch { fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503); }
  if (!Number.isSafeInteger(quota) || quota < 0 || !Number.isSafeInteger(r?.updated_at) || r.updated_at < 0 ||
      r.updated_at >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(r?.charged) || r.charged < 0) fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
  return { quotaBytes: quota, chargedBytes: r.charged, updatedAt: r.updated_at, maxQuotaMiB: MAX_QUOTA_MIB };
}
export async function saveMusicStorageQuota(db, input, context) {
  fields(input, ['quotaMiB', 'expectedQuotaBytes', 'expectedUpdatedAt']);
  if (!Number.isSafeInteger(input.quotaMiB) || input.quotaMiB < 0 || input.quotaMiB > MAX_QUOTA_MIB ||
      !Number.isSafeInteger(input.expectedQuotaBytes) || input.expectedQuotaBytes < 0 ||
      !Number.isSafeInteger(input.expectedUpdatedAt) || input.expectedUpdatedAt < 0 || input.expectedUpdatedAt >= Number.MAX_SAFE_INTEGER) fail('INVALID_INPUT', 400);
  const command = { ...input }, quotaBytes = input.quotaMiB * MIB;
  return mutate(db, { ...context, route:'/admin/api/music/storage-quota', command, conflictCode:'MUSIC_QUOTA_CONFLICT' }, async (s, now) => {
    const previous = await readMusicStorageQuota(db);
    if (previous.quotaBytes !== input.expectedQuotaBytes || previous.updatedAt !== input.expectedUpdatedAt) fail('MUSIC_QUOTA_CONFLICT', 409);
    if (quotaBytes < previous.chargedBytes) fail('MUSIC_QUOTA_BELOW_USAGE', 409);
    const updatedAt = Math.max(now, previous.updatedAt + 1);
    // Same transaction as the setting, audit, and receipt. Includes reserved/unconfirmed writes.
    // Upload reservations also guard the current quota, so a shrink cannot race past admission.
    return { condition:`EXISTS (SELECT 1 FROM music_settings WHERE key='storageQuotaBytes' AND value_json=? AND updated_at=?) AND ${charged}<=?`,
      params:[JSON.stringify(previous.quotaBytes),previous.updatedAt,quotaBytes],
      writes:[s.prepare("UPDATE music_settings SET value_json=?,updated_at=? WHERE key='storageQuotaBytes'").bind(JSON.stringify(quotaBytes),updatedAt)],
      action:'music.storage.quota', targetId:'storageQuotaBytes', summary:{ previousQuotaBytes:previous.quotaBytes, quotaBytes },
      result:{ quotaBytes, updatedAt } };
  });
}
