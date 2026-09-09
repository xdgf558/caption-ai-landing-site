export const MUSIC_LOCALES = Object.freeze(['zh-Hant', 'zh-Hans', 'en', 'ja']);
const MAX_TIME = 253402300799999;
export const musicError = code => Object.assign(new Error(code), { code });
export const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

export function utcMillis(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw musicError('MUSIC_INVALID_UTC');
  }
  const time = Date.parse(value);
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_TIME || new Date(time).toISOString() !== canonical) {
    throw musicError('MUSIC_INVALID_UTC');
  }
  return time;
}

export function isoTime(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME) throw musicError('MUSIC_INVALID_UTC');
  return new Date(value).toISOString();
}

// Defaults apply only to NEW drafts. Missing or corrupt persisted policy is never free.
export function createDraftPolicy() {
  return { accessMode: 'vip', earlyAccessUntil: null, postEarlyAccessMode: null, policyVersion: 1 };
}

export function createEarlyAccessPolicy(effectiveAt, postEarlyAccessMode) {
  isoTime(effectiveAt);
  return validatePolicy({ accessMode: 'early_access', earlyAccessUntil: isoTime(effectiveAt + 7 * 86400000),
    postEarlyAccessMode, policyVersion: 1 });
}

export function validatePolicy(policy) {
  if (!policy || !['free', 'vip', 'early_access'].includes(policy.accessMode) || !positiveInteger(policy.policyVersion)) {
    throw musicError('MUSIC_INVALID_POLICY');
  }
  const { accessMode, earlyAccessUntil, postEarlyAccessMode, policyVersion } = policy;
  if (accessMode === 'early_access') {
    if (!['free', 'vip'].includes(postEarlyAccessMode)) throw musicError('MUSIC_INVALID_POLICY');
    return { accessMode, earlyAccessUntil: isoTime(utcMillis(earlyAccessUntil)), postEarlyAccessMode, policyVersion };
  }
  if (earlyAccessUntil !== null || postEarlyAccessMode !== null) throw musicError('MUSIC_INVALID_POLICY');
  return { accessMode, earlyAccessUntil: null, postEarlyAccessMode: null, policyVersion };
}

export function policyFromRevision(revision) {
  return validatePolicy({ accessMode: revision.access_mode,
    earlyAccessUntil: revision.early_access_until === null ? null : isoTime(revision.early_access_until),
    postEarlyAccessMode: revision.post_early_access_mode, policyVersion: revision.policy_version });
}

export function effectivePolicy(policy, now) {
  isoTime(now);
  const clean = validatePolicy(policy);
  const early = clean.accessMode === 'early_access' && now < utcMillis(clean.earlyAccessUntil);
  return { ...clean,
    effectiveAccess: clean.accessMode === 'early_access' ? (early ? 'vip' : clean.postEarlyAccessMode) : clean.accessMode,
    nextPolicyChangeAt: early ? clean.earlyAccessUntil : null };
}

// This describes a requirement, NOT a grant. M1-03/M2 must check trusted VIP and media state.
export function variantRequirement(policy, variant, now) {
  if (variant !== 'full' && variant !== 'preview') throw musicError('MUSIC_INVALID_VARIANT');
  const resolved = effectivePolicy(policy, now);
  return { variant, requiredAccess: variant === 'preview' || resolved.effectiveAccess === 'free' ? 'public' : 'vip' };
}

export function validatePolicyTransition(next, previous, effectiveAt) {
  const clean = validatePolicy(next);
  isoTime(effectiveAt);
  const prior = previous == null ? null : validatePolicy(previous);
  const same = prior && clean.accessMode === prior.accessMode && clean.earlyAccessUntil === prior.earlyAccessUntil &&
    clean.postEarlyAccessMode === prior.postEarlyAccessMode;
  if (prior && (same ? clean.policyVersion !== prior.policyVersion : clean.policyVersion !== prior.policyVersion + 1)) {
    throw musicError('MUSIC_POLICY_VERSION_CONFLICT');
  }
  if (clean.accessMode === 'early_access' && !same && utcMillis(clean.earlyAccessUntil) <= effectiveAt) {
    throw musicError('MUSIC_EARLY_ACCESS_NOT_FUTURE');
  }
  return clean;
}
