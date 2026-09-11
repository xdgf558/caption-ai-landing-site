import { musicRuntime, musicRuntimeFlags, checkMusicDatabase } from './runtime.js';
import { uploadReadiness } from './uploads.js';
import { cleanupReadiness } from './cleanup.js';
import { readMusicRateDiagnostics } from './rateLimits.js';
import { primary, rows } from './adminStore.js';

async function inspect(check) {
  try { return { available: true,details: await check() }; }
  catch { return { available: false,code: 'UNAVAILABLE' }; }
}

// Access-protected aggregate snapshot. No IP/hash, cookie, account, object key or error text.
export async function readMusicDiagnostics(env) {
  const result = { observedAt: Date.now(),flags: musicRuntimeFlags(env),
    maintenanceEnabled: env.MUSIC_CLEANUP_ENABLED === true || env.MUSIC_CLEANUP_ENABLED === 'true' };
  let runtime;
  try { runtime = musicRuntime(env); }
  catch { return { ...result,configured: false,code: 'MUSIC_NOT_CONFIGURED' }; }
  const db = runtime.db;
  result.configured = true;
  result.database = await inspect(() => checkMusicDatabase(db));
  result.uploadAccounting = await inspect(() => uploadReadiness(db));
  result.cleanup = await inspect(async () => {
    const ready = await cleanupReadiness(db);
    const counts = rows(await primary(db).prepare(`SELECT COUNT(*) AS retiredUploads,
      COALESCE(SUM(CASE WHEN c.released_at IS NULL THEN u.declared_bytes ELSE 0 END),0) AS retainedBytes,
      COALESCE(SUM(CASE WHEN c.released_at IS NOT NULL THEN u.declared_bytes ELSE 0 END),0) AS releasedBytes,
      COALESCE(SUM(CASE WHEN c.proof_json IS NULL AND u.write_token IS NOT NULL THEN 1 ELSE 0 END),0) AS unresolvedWriters
      FROM music_upload_cleanup c JOIN music_upload_sessions u ON u.id=c.upload_id`).all())[0];
    return { ...ready,...counts };
  });
  result.rateLimits = await inspect(() => readMusicRateDiagnostics(env));
  return result;
}
