import { contentBase, uuid, slug, positive } from './publicValidation.js';

export function indexStationMusicTracks(model, index = new Map()) {
  // Home selections are summaries. Current catalog DTOs must retain the slug,
  // revisions and media promises used by their own visible play buttons.
  for (const track of [...(model.selected || []), ...(model.related || []), model.featured, model.track, ...(model.items || [])]) {
    if (track && uuid(track.id)) index.set(track.id, track);
  }
  return index;
}

export function stationMusicSource(track, variant) {
  if (!uuid(track?.id) || !slug(track.slug) || !positive(track.audioVersion) || !['preview', 'full'].includes(variant)) throw new TypeError('Invalid source');
  let path = contentBase + '/tracks/' + track.slug + '/audio?variant=' + variant + '&v=' + track.audioVersion;
  if (variant === 'preview') {
    if (!positive(track.previewRevision)) throw new TypeError('Invalid promotion version');
    path += '&p=' + track.previewRevision;
  } else if (track.authorizedPath !== path) throw new TypeError('Missing private playback handshake');
  return path;
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
export function fullPlayerTrack(dto, handshake) {
  if (handshake?.trackId !== dto.id || handshake.revision !== dto.revision || handshake.variant !== 'full' ||
    !positive(handshake.durationMs)) throw new TypeError('Stale private playback handshake');
  const track = { id: dto.id, slug: dto.slug, audioVersion: dto.revision, policyVersion: dto.revision,
    durationSec: handshake.durationMs / 1000, authorizedPath: handshake.audioPath };
  stationMusicSource(track, 'full');
  return track;
}
