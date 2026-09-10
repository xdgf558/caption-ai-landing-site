import { MUSIC_LOCALES, createDraftPolicy, validatePolicy } from './policy.js';
import { publicationError, validMusicId } from './publicationValidation.js';

export const fail = (code, status = 422) => { throw publicationError(code, status); };
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function fields(value, allowed) {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_INPUT', 400);
  return value;
}
export function text(value, max, empty = false, multiline = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail('INVALID_INPUT', 400);
  return value.trim();
}
export function musicId(value) {
  if (!validMusicId(value)) fail('INVALID_INPUT', 400);
  return value.toLowerCase();
}
export function editVersion(value) {
  const match = /^"edit-([1-9][0-9]*)"$/.exec(value || '');
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= Number.MAX_SAFE_INTEGER) fail('EDIT_VERSION_REQUIRED', 428);
  return Number(match[1]);
}
export function mutationKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail('IDEMPOTENCY_KEY_REQUIRED', 400);
  return value;
}
export function metadata(input) {
  fields(input, ['originalLocale', 'title', 'summary', 'creatorName', 'instrumental', 'language', 'genres', 'moods', 'story']);
  if (!MUSIC_LOCALES.includes(input.originalLocale) || typeof input.instrumental !== 'boolean') fail('MUSIC_INVALID_METADATA');
  const translated = (value, max, required) => {
    fields(value, MUSIC_LOCALES);
    const result = {};
    for (const locale of MUSIC_LOCALES) if (value[locale] !== undefined) result[locale] = text(value[locale], max, true);
    if (!(input.originalLocale in result) || (required && !result[input.originalLocale])) fail('MUSIC_INVALID_METADATA');
    return result;
  };
  const tags = value => {
    if (!Array.isArray(value) || value.length > 12) fail('MUSIC_INVALID_METADATA');
    return [...new Set(value.map(v => text(v, 32)))];
  };
  return { originalLocale: input.originalLocale, title: translated(input.title, 120, true), summary: translated(input.summary, 500, false),
    creatorName: text(input.creatorName, 80), instrumental: input.instrumental, language: text(input.language, 40),
    genres: tags(input.genres), moods: tags(input.moods), story: text(input.story ?? '', 8000, true, true) };
}
export function draftInput(input, create = false) {
  fields(input, create ? ['slug', 'metadata', 'policy', 'assets'] : ['slug', 'metadata', 'policy', 'assets', 'revisionId', 'reason']);
  if (typeof input.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 100) fail('MUSIC_INVALID_SLUG');
  const assets = fields(input.assets ?? {}, ['audio', 'preview', 'cover', 'lyrics']);
  let policy;
  try { policy = validatePolicy(input.policy ?? (create ? createDraftPolicy() : null)); }
  catch { fail('MUSIC_INVALID_POLICY'); }
  const clean = { slug: input.slug, metadata: metadata(input.metadata), policy,
    assets: Object.fromEntries(['audio', 'preview', 'cover', 'lyrics'].map(kind => [kind, assets[kind] == null ? null : musicId(assets[kind])])) };
  if (create && (policy.policyVersion !== 1 || Object.values(clean.assets).some(Boolean))) fail('INVALID_INPUT', 400);
  if (!create) Object.assign(clean, { revisionId: musicId(input.revisionId), reason: text(input.reason, 1000) });
  return clean;
}
export function rightsInput(input) {
  fields(input, ['status', 'review', 'evidenceIds', 'reason']);
  if (!['pending', 'approved', 'blocked'].includes(input.status) || !Array.isArray(input.evidenceIds) || input.evidenceIds.length > 10) fail('INVALID_INPUT', 400);
  fields(input.review, ['sourcePlatform', 'sourceSongUrl', 'sourceSongId', 'generatedAt', 'downloadedAt', 'termsCheckedAt',
    'planAtGeneration', 'planAtDownload', 'outputKind', 'downloadMethod', 'permittedUse', 'authorizationBasis',
    'lyricsRightsNotes', 'coverRightsNotes', 'audioInputRightsNotes', 'exceptionAuthorizationBasis', 'exceptionEvidenceAssetId']);
  const review = {};
  for (const key of Object.keys(input.review).sort()) review[key] = key === 'sourceSongUrl' && input.review[key] === null
    ? null : text(input.review[key], 4000, true);
  const evidenceIds = input.evidenceIds.map(musicId).sort();
  if (new Set(evidenceIds).size !== evidenceIds.length) fail('INVALID_INPUT', 400);
  return { status: input.status, review, evidenceIds, reason: text(input.reason, 1000) };
}
