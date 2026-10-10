import { chapterRoute } from './routeMigrationPaths.js';

const slug = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '') && value.length <= 160;
async function published(db, type, locale, name, parent = '') {
  if (typeof db?.prepare !== 'function') throw new Error('LEGACY_LOOKUP_UNAVAILABLE');
  return Boolean(await db.prepare(`SELECT id FROM content_entries WHERE entry_type=? AND locale=? AND slug=? AND parent_slug=?
    AND status='published' AND visibility IN ('public','unlisted') LIMIT 1`).bind(type, locale, name, parent).first());
}
// No table creation, body reads, credentials, remote exports or data deletion.
export async function legacyContentExists(db, family) {
  const { segments: s, locale, explicit, section } = family;
  if (section === 'devlog' && s.length === 2 && slug(s[1])) return published(db, 'blog_post', locale, s[1]);
  if (section === 'signal' && ((s.length === 2 && slug(s[1])) ||
    (s.length === 3 && slug(s[1]) && ['card.png','share-card.png','card.svg','share-card.svg'].includes(s[2])))) return published(db, 'signal_brief', locale, s[1]);
  if (section === 'novel' && (!explicit || locale === 'en') && s.length === 2 && slug(s[1])) return published(db, 'novel_series', locale, s[1]);
  if (section === 'works' && s.length === 2 && slug(s[1])) return published(db, 'novel_series', locale === 'en' ? 'en' : 'zh-Hant', s[1]);
  return false;
}
export async function legacyChapterExists(request, env, route) {
  if (typeof env.ASSETS?.fetch === 'function') {
    const asset = await env.ASSETS.fetch(new Request(new URL(route.href, request.url), { method: 'HEAD' }));
    await asset.body?.cancel();
    if (asset.status === 200 && asset.headers.get('content-type')?.includes('text/html')) return true;
  }
  return (await published(env.WAITLIST_DB, 'novel_series', route.locale, route.series)) &&
    (await published(env.WAITLIST_DB, 'novel_chapter', route.locale, route.chapter, route.series));
}
export async function legacyTrackExists(env, id) {
  if (typeof env.MUSIC_DB?.prepare !== 'function') throw new Error('LEGACY_LOOKUP_UNAVAILABLE');
  return Boolean(await env.MUSIC_DB.prepare("SELECT id FROM music_tracks WHERE id=? AND lifecycle='published' LIMIT 1").bind(id).first());
}
// This table is a proposal ledger, not executable routing authority. T22 must
// resolve its soft associations separately; even approved rows cannot dispatch.
export function assessRouteProposal(row) {
  const safe = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') &&
    !/[\\%?#\s]/.test(path) && !/^\/(?:api|admin|auth)(?:\/|$)/.test(path);
  if (!safe(row.old_path) || !['keep','service','redirect','retire'].includes(row.action)) return 'invalid';
  if (row.action === 'redirect' && (!safe(row.new_path) || row.new_path === row.old_path || row.new_path === '/games/cat-life/')) return 'invalid';
  if (row.action !== 'redirect' && row.action !== 'keep' && row.new_path !== null) return 'invalid';
  return chapterRoute(row.new_path || '') ? 'requires-reading-permission-review' : 'requires-entity-and-http-review';
}
