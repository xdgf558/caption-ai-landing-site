import { publicationError } from './publicationValidation.js';

const enabled = value => value === true || value === 'true';

// Internal binding checks, not authorization or proof that an R2 bucket is private.
export function musicRuntime(env = {}) {
  const db = env?.MUSIC_DB, bucket = env?.MUSIC_BUCKET;
  if (!db || db === env?.WAITLIST_DB || typeof db.withSession !== 'function' ||
    !bucket || typeof bucket.get !== 'function') throw publicationError('MUSIC_NOT_CONFIGURED', 503);
  return { db, bucket, flags: Object.freeze({
    public: enabled(env.MUSIC_PUBLIC_ENABLED), uploads: enabled(env.MUSIC_UPLOADS_ENABLED),
    vipDelivery: enabled(env.MUSIC_VIP_DELIVERY_ENABLED), analytics: enabled(env.MUSIC_ANALYTICS_ENABLED)
  }) };
}

// Read-only readiness probe. Never creates tables, applies migrations or touches WAITLIST_DB.
export async function checkMusicDatabase(db) {
  try {
    const session = db.withSession('first-primary');
    const results = await session.batch([
      session.prepare("SELECT key,value_json FROM music_settings WHERE key IN ('catalogVersion','previewLimitMs') ORDER BY key"),
      session.prepare('SELECT technical_fingerprint FROM music_track_revisions LIMIT 0'),
      session.prepare('SELECT revision_fingerprint FROM music_rights_reviews LIMIT 0'),
      session.prepare('SELECT operation_token,passed FROM music_publication_guards LIMIT 0'),
      session.prepare('SELECT request_hash,result_json FROM music_mutations LIMIT 0')
    ]);
    if (results.length !== 5 || results.some(r => r.success !== true || !Array.isArray(r.results))) throw new Error('results');
    const settings = results[0].results;
    if (settings.length !== 2) throw new Error('settings');
    const catalogVersion = JSON.parse(settings.find(s => s.key === 'catalogVersion').value_json);
    const previewLimitMs = JSON.parse(settings.find(s => s.key === 'previewLimitMs').value_json);
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 0 || catalogVersion >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(previewLimitMs) || previewLimitMs < 15000 || previewLimitMs > 45000) throw new Error('settings');
    return { catalogVersion, previewLimitMs };
  } catch { throw publicationError('MUSIC_DATABASE_UNAVAILABLE', 503); }
}
