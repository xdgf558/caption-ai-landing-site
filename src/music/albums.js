import { effectivePolicy, policyFromRevision } from './policy.js';
import { fail } from './adminValidation.js';

export const collectionType = c => c.collection_type === undefined ? 'playlist' : c.collection_type;
export function albumTrackAccess(track, now) {
  if (track.lifecycle !== 'published' || !track.published_revision_id || track.published_state !== 'sealed' || track.published_track_id !== track.track_id ||
    !Number.isSafeInteger(track.published_at) || track.published_at > now) return null;
  try { return effectivePolicy(policyFromRevision(track), now).effectiveAccess; } catch { return null; }
}
export function checkAlbum(collection, tracks, now, published = collection.status === 'published') {
  if (collectionType(collection) !== 'album') return;
  if (collection.cover_track_id && !tracks.some(t => t.track_id === collection.cover_track_id)) fail('MUSIC_ALBUM_COVER_INVALID');
  if (!published) return;
  if (!tracks.length || tracks.some(t => !albumTrackAccess(t, now))) fail('MUSIC_ALBUM_TRACKS_NOT_PUBLISHED');
  if (collection.listening_mode !== 'mixed' && tracks.some(t => albumTrackAccess(t, now) !== collection.listening_mode)) fail('MUSIC_ALBUM_POLICY_MISMATCH');
  if (collection.cover_track_id && !tracks.find(t => t.track_id === collection.cover_track_id)?.published_cover_valid) fail('MUSIC_ALBUM_COVER_INVALID');
}

// Sealed revisions are immutable. Guard the pointer and lifecycle in the same
// D1 mutation as the collection write so publication/replacement cannot race it.
export function guardAlbumTracks(guard, tracks) {
  const ordered = tracks.map(t => ({id:t.track_id,lifecycle:t.lifecycle,published_revision_id:t.published_revision_id,published_at:t.published_at})).sort((a,b) => a.id.localeCompare(b.id));
  guard.condition += ` AND COALESCE((SELECT json_group_array(json_object('id',id,'lifecycle',lifecycle,
    'published_revision_id',published_revision_id,'published_at',published_at)) FROM
    (SELECT id,lifecycle,published_revision_id,published_at FROM music_tracks WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id)),'[]')=?`;
  guard.params.push(JSON.stringify(ordered.map(t => t.id)),JSON.stringify(ordered));
}
