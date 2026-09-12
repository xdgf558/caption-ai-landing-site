import { effectivePolicy, MUSIC_LOCALES, utcMillis } from '../music/policy.js';
import { playerVariant } from './musicPlayerCatalog.js';

export const musicPreviewRoles = Object.freeze(['visitor', 'account', 'vip', 'expired']);
const validId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const invalid = () => { throw new Error('ROLE_PREVIEW_INVALID'); };
const displayText = (value, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) invalid();
  return value;
};

// Display model only. Never pass these synthetic capabilities to a player or a request.
// Saved asset metadata is not a fresh object-existence or publication proof.
export function musicRolePreview(row, flags, {
  revision = 'draft', locale = 'zh-Hans', scenario = 'current', at = 'read'
} = {}) {
  if (!validId(row?.id) || !['draft','published','unpublished','archived'].includes(row.lifecycle) ||
    !['draft','published'].includes(revision) || !MUSIC_LOCALES.includes(locale) ||
    !['current','released'].includes(scenario) || !['read','boundary'].includes(at) ||
    typeof flags?.public !== 'boolean' || typeof flags?.vipDelivery !== 'boolean') invalid();
  const readAt = utcMillis(row.serverNow), r = row[revision];
  if (!r) throw new Error('ROLE_PREVIEW_NO_REVISION');
  if (!validId(r.id) || !Number.isSafeInteger(r.number) || r.number < 1 ||
    r.state !== (revision === 'draft' ? 'draft' : 'sealed') || !Array.isArray(row.assets) || row.assets.length > 18) invalid();
  const now = at === 'boundary' ? utcMillis(r.policy?.earlyAccessUntil) : readAt;
  const policy = effectivePolicy(r.policy, now), m = r.metadata;
  if (!MUSIC_LOCALES.includes(m?.originalLocale)) invalid();
  const translated = (values, max, required = false) => {
    const original = displayText(values?.[m.originalLocale], max, required);
    return typeof values[locale] === 'string' && values[locale].trim() ? displayText(values[locale], max) : original;
  };
  const findAsset = kind => {
    const id = r.assets?.[kind];
    if (id === null) return null;
    const matches = row.assets.filter(a => a.id === id);
    if (!validId(id) || matches.length !== 1 || matches[0].kind !== kind || matches[0].state !== 'validated' ||
      !Number.isSafeInteger(matches[0].byteSize) || matches[0].byteSize < 1) invalid();
    return matches[0];
  };
  const audio = findAsset('audio'), preview = findAsset('preview');
  if (audio && (!Number.isSafeInteger(audio.durationMs) || audio.durationMs <= 0 || audio.byteSize > 33554432)) invalid();
  if (preview && (!audio || preview.id === audio.id || preview.derivedFromAssetId !== audio.id || preview.byteSize > 4194304 ||
    !Number.isSafeInteger(preview.durationMs) || preview.durationMs <= 0 ||
    !Number.isSafeInteger(preview.sourceStartMs) || preview.sourceStartMs < 0 || !Number.isSafeInteger(preview.sourceEndMs) ||
    preview.sourceEndMs <= preview.sourceStartMs || preview.sourceEndMs > audio.durationMs ||
    preview.sourceEndMs - preview.sourceStartMs > Math.min(45000, audio.durationMs / 2) ||
    preview.durationMs > Math.min(45000, audio.durationMs / 2) + 250 ||
    Math.abs(preview.durationMs - (preview.sourceEndMs - preview.sourceStartMs)) > 250)) invalid();
  const cover = findAsset('cover'), lyrics = findAsset('lyrics');
  const simulated = scenario === 'released';
  const publicOpen = simulated || flags.public;
  const vipOpen = simulated || flags.vipDelivery;
  const visible = publicOpen && (simulated || (revision === 'published' && row.lifecycle === 'published'));
  const roles = musicPreviewRoles.map(role => {
    const active = role === 'vip';
    const variant = visible && audio ? playerVariant({ effectiveAccess: policy.effectiveAccess, previewAvailable: !!preview },
      { canPlayVipFull: active && vipOpen, musicVipDeliveryEnabled: vipOpen, membershipStatus: active ? 'active' : role === 'expired' ? 'expired' : 'none' }) : null;
    const reason = !publicOpen ? 'PUBLIC_DISABLED' : !visible ? 'NOT_PUBLISHED' : !audio ? 'AUDIO_MISSING' :
      policy.effectiveAccess === 'free' ? 'FREE' : !vipOpen ? 'VIP_DISABLED' :
      active ? 'VIP_ACTIVE' : role === 'visitor' ? 'LOGIN' : role === 'expired' ? 'EXPIRED' : 'VIP_REQUIRED';
    return { role, variant, reason };
  });
  // Explicit allowlist: no asset IDs, media URLs, authorizations, rights or account data.
  return { revisionNumber: r.number, readAt: row.serverNow, at: new Date(now).toISOString(),
    title: translated(m.title, 200, true), summary: translated(m.summary, 500),
    creatorName: displayText(m.creatorName, 120, true), story: displayText(m.story ?? '', 8000),
    durationSec: audio ? audio.durationMs / 1000 : null, previewDurationSec: preview ? preview.durationMs / 1000 : null,
    coverAvailable: !!cover, lyricsAvailable: !!lyrics, policy, simulated, roles };
}

// Read a fresh saved snapshot on entry. Switching tracks/tabs or losing access cancels late views.
export function createMusicRolePreviewReader({ request, actorId, onChange }) {
  let generation = 0;
  return {
    clear(message = '') { generation++; onChange({ state:'empty', message }); },
    async read(id) {
      const attempt = ++generation;
      onChange({ state:'loading' });
      try {
        if (!validId(id)) invalid();
        const service = await request('/status');
        if (attempt !== generation) return;
        if (service.actorId !== actorId()) throw new Error('ROLE_PREVIEW_ACTOR_CHANGED');
        const row = await request('/tracks/' + id);
        if (attempt !== generation) return;
        if (row.id !== id) invalid();
        utcMillis(row.serverNow);
        onChange({ state:'ready', row, flags:service.flags });
      } catch (error) {
        if (attempt === generation) onChange({ state:'error', message:error.message, denied:[401,403].includes(error.status) });
      }
    }
  };
}
