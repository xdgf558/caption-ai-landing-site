import { MUSIC_LOCALES, effectivePolicy, isoTime, musicError, policyFromRevision, positiveInteger } from './policy.js';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const parseObject = value => {
  const parsed = JSON.parse(value);
  if (!object(parsed)) throw musicError('MUSIC_INVALID_METADATA');
  return parsed;
};

function translated(values, locale, original, max, required = false) {
  if (!object(values) || !MUSIC_LOCALES.includes(original)) throw musicError('MUSIC_INVALID_METADATA');
  const source = values[original];
  if (!text(source, max) || (required && !source.trim())) throw musicError('MUSIC_INVALID_METADATA');
  const candidate = values[locale];
  return text(candidate, max) && candidate.trim() ? candidate : source;
}

function tags(values) {
  if (!Array.isArray(values) || values.length > 12 || values.some(v => !text(v, 40) || !v.trim())) {
    throw musicError('MUSIC_INVALID_METADATA');
  }
  return [...new Set(values)];
}

function currentAsset(assets, id, trackId, kind) {
  const matches = assets.filter(asset => asset.id === id);
  const asset = matches[0];
  if (matches.length !== 1 || !uuid(id) || asset.owner_track_id !== trackId || asset.kind !== kind ||
    asset.state !== 'validated' || !positiveInteger(asset.byte_size) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw musicError('MUSIC_INVALID_ASSET');
  }
  return asset;
}

function publicTrack(record, locale, now) {
  if (!object(record)) return null;
  const { track, revision, assets } = record;
  if (!track || track.lifecycle !== 'published') return null;
  if (!uuid(track.id) || !slug(track.slug) || !revision || revision.track_id !== track.id ||
    track.published_revision_id !== revision.id || !uuid(revision.id) || revision.state !== 'sealed' ||
    !positiveInteger(revision.revision_no) || !Array.isArray(assets) || !assets.every(object)) throw musicError('MUSIC_INVALID_PUBLICATION');
  const firstPublishedAt = isoTime(track.first_published_at);
  const publishedAt = isoTime(track.published_at);
  if (publishedAt < firstPublishedAt || track.published_at > now) throw musicError('MUSIC_INVALID_PUBLICATION');
  isoTime(revision.created_at);
  isoTime(revision.technical_reviewed_at);
  if (revision.technical_reviewed_at < revision.created_at || revision.technical_reviewed_at > track.published_at) {
    throw musicError('MUSIC_INVALID_PUBLICATION');
  }
  const policy = effectivePolicy(policyFromRevision(revision), now);
  const meta = parseObject(revision.metadata_json);
  const title = translated(meta.title, locale, meta.originalLocale, 200, true);
  const summary = translated(meta.summary, locale, meta.originalLocale, 500);
  if (!text(meta.creatorName, 120) || !meta.creatorName.trim() || typeof meta.instrumental !== 'boolean' ||
    !text(meta.language, 40) || !meta.language.trim()) throw musicError('MUSIC_INVALID_METADATA');
  const audio = currentAsset(assets, revision.audio_asset_id, track.id, 'audio');
  if (!positiveInteger(audio.duration_ms) || audio.format !== 'mp3' || audio.content_type !== 'audio/mpeg' ||
    audio.byte_size > 33554432) throw musicError('MUSIC_INVALID_ASSET');
  let preview = null;
  if (revision.preview_asset_id !== null) {
    preview = currentAsset(assets, revision.preview_asset_id, track.id, 'preview');
    if (preview.id === audio.id || preview.object_key === audio.object_key || preview.derived_from_asset_id !== audio.id ||
      preview.format !== 'mp3' || preview.content_type !== 'audio/mpeg' || preview.byte_size > 4194304 ||
      !positiveInteger(preview.duration_ms) || !Number.isSafeInteger(preview.source_start_ms) || preview.source_start_ms < 0 ||
      !Number.isSafeInteger(preview.source_end_ms) || preview.source_end_ms <= preview.source_start_ms ||
      preview.source_end_ms > audio.duration_ms ||
      preview.source_end_ms - preview.source_start_ms > Math.min(45000, audio.duration_ms / 2) ||
      preview.duration_ms > Math.min(45000, audio.duration_ms / 2) + 250 ||
      Math.abs(preview.duration_ms - (preview.source_end_ms - preview.source_start_ms)) > 250) {
      throw musicError('MUSIC_INVALID_PREVIEW');
    }
  }
  let coverUrl = null;
  if (revision.cover_asset_id !== null) {
    const cover = currentAsset(assets, revision.cover_asset_id, track.id, 'cover');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(cover.content_type) || cover.byte_size > 5242880) {
      throw musicError('MUSIC_INVALID_ASSET');
    }
    coverUrl = `/api/music/tracks/${track.id}/cover?v=${revision.revision_no}`;
  }
  let lyricsKind = 'none';
  if (revision.lyrics_asset_id !== null) {
    const lyrics = currentAsset(assets, revision.lyrics_asset_id, track.id, 'lyrics');
    if (!['txt', 'lrc'].includes(lyrics.format) || lyrics.content_type !== 'text/plain' || lyrics.byte_size > 131072) {
      throw musicError('MUSIC_INVALID_ASSET');
    }
    lyricsKind = lyrics.format;
  }
  // Explicit allowlist only: never spread metadata, DB rows, rights evidence or caller capabilities.
  return { id: track.id, slug: track.slug, title, creatorName: meta.creatorName, summary,
    durationSec: audio.duration_ms / 1000, language: meta.language, instrumental: meta.instrumental,
    genres: tags(meta.genres), moods: tags(meta.moods), coverUrl, audioVersion: revision.revision_no, lyricsKind,
    accessMode: policy.accessMode, effectiveAccess: policy.effectiveAccess, policyVersion: policy.policyVersion,
    previewAvailable: preview !== null, previewDurationSec: preview ? preview.duration_ms / 1000 : null,
    previewSourceStartSec: preview ? preview.source_start_ms / 1000 : null,
    earlyAccessUntil: policy.earlyAccessUntil, postEarlyAccessMode: policy.postEarlyAccessMode,
    publishedAt, nextPolicyChangeAt: policy.nextPolicyChangeAt };
}

export function projectPublicTrack(record, { locale, now }) {
  if (!MUSIC_LOCALES.includes(locale)) throw musicError('MUSIC_INVALID_LOCALE');
  isoTime(now);
  try { return publicTrack(record, locale, now); }
  catch (error) {
    if (error instanceof SyntaxError || error.code?.startsWith('MUSIC_')) return null;
    throw error;
  }
}

export function projectPublicTrackDetail(record, options) {
  const track = projectPublicTrack(record, options);
  if (!track) return null;
  try {
    const metadata = parseObject(record.revision.metadata_json);
    const story = metadata.story === undefined ? '' : metadata.story;
    if (typeof story !== 'string' || story.length > 8000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(story)) return null;
    return { ...track, story };
  } catch (error) {
    if (error instanceof SyntaxError || error.code?.startsWith('MUSIC_')) return null;
    throw error;
  }
}

function projectCollection(record, locale, publicTracks) {
  if (!object(record)) return null;
  const { collection, items } = record;
  if (!collection || collection.status !== 'published') return null;
  if (!uuid(collection.id) || !slug(collection.slug) || !positiveInteger(collection.version) || !Array.isArray(items) || items.length > 500) {
    throw musicError('MUSIC_INVALID_COLLECTION');
  }
  const title = translated(parseObject(collection.title_json), locale, collection.original_locale, 200, true);
  const description = translated(parseObject(collection.description_json), locale, collection.original_locale, 500);
  const type = collection.collection_type === undefined ? 'playlist' : collection.collection_type;
  const listeningMode = collection.listening_mode === undefined ? 'mixed' : collection.listening_mode;
  const coverTrackId = collection.cover_track_id ?? null;
  if (!['playlist','album'].includes(type) || !['mixed','free','vip'].includes(listeningMode) ||
    (type === 'playlist' && (listeningMode !== 'mixed' || coverTrackId !== null))) throw musicError('MUSIC_INVALID_COLLECTION');
  const seen = new Set();
  const positions = new Set();
  const visible = [];
  for (const item of items) {
    if (!object(item) || item.collection_id !== collection.id || !uuid(item.track_id) || !Number.isSafeInteger(item.position) ||
      item.position < 0 || seen.has(item.track_id) || positions.has(item.position)) throw musicError('MUSIC_INVALID_COLLECTION');
    seen.add(item.track_id);
    positions.add(item.position);
    if (publicTracks.has(item.track_id)) visible.push(item);
  }
  visible.sort((a, b) => a.position - b.position);
  // An album is an entire ordered release. Never silently turn a partial or
  // policy-mismatched album into a successfully published subset.
  if (type === 'album' && (visible.length !== items.length || !visible.length ||
    (listeningMode !== 'mixed' && visible.some(item => publicTracks.get(item.track_id).effectiveAccess !== listeningMode)))) return null;
  if (coverTrackId !== null && (!uuid(coverTrackId) || !seen.has(coverTrackId) || !publicTracks.get(coverTrackId)?.coverUrl)) return null;
  const cover = type === 'album' ? (coverTrackId ? publicTracks.get(coverTrackId) : visible.map(item => publicTracks.get(item.track_id)).find(t => t.coverUrl)) : null;
  return { id: collection.id, slug: collection.slug, title, description, version: collection.version, type,
    ...(type === 'album' ? { listeningMode, coverTrackId:cover?.id || null, coverUrl:cover?.coverUrl || null } : {}),
    trackIds: visible.map(item => item.track_id) };
}

// Pure shared representation. Transport caching/authentication are separate M2 responsibilities.
export async function buildPublicCatalog({ records, collections = [], catalogVersion, locale, now }) {
  if (!MUSIC_LOCALES.includes(locale)) throw musicError('MUSIC_INVALID_LOCALE');
  isoTime(now);
  if (!Array.isArray(records) || records.length > 500 || !Array.isArray(collections) || collections.length > 500 ||
    !Number.isSafeInteger(catalogVersion) || catalogVersion < 0) throw musicError('MUSIC_INVALID_CATALOG');
  const tracks = records.map(record => projectPublicTrack(record, { locale, now })).filter(Boolean);
  const ids = new Map(tracks.map(track => [track.id,track]));
  if (ids.size !== tracks.length) throw musicError('MUSIC_DUPLICATE_TRACK');
  tracks.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const changes = tracks.map(track => track.nextPolicyChangeAt).filter(Boolean).sort();
  const publicCollections = [];
  for (const row of collections) {
    try {
      const collection = projectCollection(row, locale, ids);
      if (collection?.trackIds.length) publicCollections.push(collection);
    } catch (error) {
      if (!(error instanceof SyntaxError) && !error.code?.startsWith('MUSIC_')) throw error;
    }
  }
  publicCollections.sort((a, b) => a.slug.localeCompare(b.slug));
  if (new Set(publicCollections.map(row => row.id)).size !== publicCollections.length) throw musicError('MUSIC_DUPLICATE_COLLECTION');
  const body = { schemaVersion: 2, catalogVersion, locale, nextPolicyChangeAt: changes[0] || null,
    tracks, collections: publicCollections };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const etag = '"music-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') + '"';
  return { body, etag };
}
