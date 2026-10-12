import { contentBase, uuid, slug, positive } from './publicValidation.js';

export function indexStationMusicTracks(model, index = new Map()) {
  // Home selections are summaries. Current catalog DTOs must retain the slug,
  // revisions and media promises used by their own visible play buttons.
  for (const track of [...(model.selected || []), ...(model.related || []), model.featured, model.track, ...(model.items || [])]) {
    if (track && uuid(track.id)) index.set(track.id, track);
  }
  return index;
}

// Website music is preview-only. The shared legacy/native player keeps its
// own source resolver; a stale website DTO cannot opt this one into full audio.
export function stationMusicSource(track, variant) {
  if (!uuid(track?.id) || !slug(track.slug) || !positive(track.audioVersion) || variant !== 'preview') throw new TypeError('Invalid source');
  if (!positive(track.previewRevision)) throw new TypeError('Invalid promotion version');
  return contentBase + '/tracks/' + track.slug + '/audio?variant=preview&v=' + track.audioVersion + '&p=' + track.previewRevision;
}
export function previewPlayerTrack(dto) {
  if (!positive(dto?.preview?.revision) || !positive(dto.preview.durationMs) || dto.preview.playbackPath !==
    contentBase + '/tracks/' + dto.slug + '/playback?variant=preview') throw new TypeError('Invalid public preview');
  const track = { id: dto.id, slug: dto.slug, audioVersion: dto.revision, policyVersion: dto.preview.revision,
    previewRevision: dto.preview.revision, durationSec: dto.durationMs / 1000,
    previewDurationSec: dto.preview.durationMs / 1000, previewSourceStartSec: 0 };
  stationMusicSource(track, 'preview');
  return track;
}
