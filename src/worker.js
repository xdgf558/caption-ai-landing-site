import { novelPaymentConfig } from './generated/novelPaymentConfig.js';
import { protectedSerialContent } from './generated/protectedSerialContent.js';
import {
  collectSignalSource,
  getSignalSourceAdapter,
  getSignalSourceSecretBinding,
  isSignalSourceSecretConfigured,
  normalizePublicSignalUrl,
  signalContentHash,
  supportedSignalCollectionAdapters
} from './signalCollection.js';
import {
  enrichSignalCandidateRows,
  findSignalCandidateMergeMatch,
  signalScorePriority,
  signalTitleFingerprint
} from './signalTriage.js';
import {
  generateSignalBriefDraftWithProviders,
  normalizeSignalDraftCandidateIds,
  signalDraftMaxCandidates
} from './signalDraft.js';
import {
  createDeepSeekSignalDraftAdapter,
  defaultDeepSeekSignalDraftModel,
  isDeepSeekApiKeyConfigured,
  normalizeDeepSeekSignalDraftModel
} from './deepseekSignalDraft.js';
import { buildContentImportListQuery, contentImportSourceKinds } from './contentImportReview.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });

const privateJson = (body, init = {}) =>
  json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      ...(init.headers || {})
    }
  });

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const readerSessionCookieName = 'station_cat_reader_session';
const readerSessionMaxAge = 60 * 60 * 24 * 30;
const readerPasswordAlgorithm = 'PBKDF2-SHA256';
const readerPasswordIterations = 100000;
const readerTotpIssuer = 'Station Cat';
const readerTotpPeriodSeconds = 30;
const readerTotpDigits = 6;
const readerTotpResetFailureMessage = '账号或二步验证码不正确。';
const readerTotpResetLockedMessage = '尝试次数过多，请稍后再试。';
const readerTotpResetFailureThreshold = 5;
const readerTotpResetBaseLockSeconds = 60;
const readerTotpResetMaxLockSeconds = 15 * 60;
const adminPathPattern = /^\/admin(?:-v2)?(?:\/|$)/;
const defaultAdminEmail = 'brodstem@protonmail.com';

const cleanText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);

const stripInlineMarkdown = (value) =>
  String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/[`*_~]+/g, '')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1')
    .trim();

const plainTextFromMarkdown = (value, maxLength = 500) => {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n?/, '\n');
  const plainLines = [];
  const headingFallback = [];
  let inFence = false;

  for (const line of normalized.split('\n')) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    if (/^```|^~~~/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\|?[\s:|-]+\|?$/.test(trimmed)) continue;

    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const text = stripInlineMarkdown(heading[1]);
      if (text) headingFallback.push(text);
      continue;
    }

    trimmed = trimmed
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '');

    const text = stripInlineMarkdown(trimmed);
    if (text) plainLines.push(text);
  }

  const plain = (plainLines.length ? plainLines : headingFallback).join(' ').replace(/\s+/g, ' ');
  return cleanText(plain, maxLength);
};

const cleanPlatform = (value) => {
  const platform = String(value || '').trim().toLowerCase();
  return platform === 'android' ? 'android' : 'ios';
};

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Hex = async (value) => {
  const encoded = new TextEncoder().encode(value);
  return toHex(await crypto.subtle.digest('SHA-256', encoded));
};

const hmacSha256Hex = async (value, secret) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
};

const getD1ChangeCount = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);

const getRequestClientHashes = async (request) => {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const userAgent = cleanText(request.headers.get('user-agent'), 200);
  const [ipHash, ipUaHash] = await Promise.all([
    sha256Hex(ip),
    sha256Hex(`${ip}|${userAgent}`)
  ]);
  return { ipHash, ipUaHash };
};

const randomToken = (byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let raw = '';
  bytes.forEach((byte) => {
    raw += String.fromCharCode(byte);
  });
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const randomHex = (byteLength = 24) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

const isValidReaderUsername = (value) => /^[\p{L}\p{N}_-]{3,32}$/u.test(String(value || '').trim());

const isValidReaderPassword = (value) => {
  const password = String(value || '');
  return password.length >= 8 && password.length <= 128;
};

const hashReaderPassword = async (password, salt, iterations = readerPasswordIterations) => {
  const encodedPassword = new TextEncoder().encode(String(password || ''));
  const encodedSalt = new TextEncoder().encode(String(salt || ''));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encodedPassword,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encodedSalt,
      iterations
    },
    keyMaterial,
    256
  );
  return toHex(derivedBits);
};

const isLocalRequest = (request, env) => {
  const { hostname } = new URL(request.url);
  const host = request.headers.get('host') || '';
  return (
    env.READER_AUTH_DEBUG_LINKS === '1' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:') ||
    host.startsWith('[::1]:')
  );
};

const getCookie = (request, name) => {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) continue;
    if (cookie.slice(0, separatorIndex) === name) {
      return cookie.slice(separatorIndex + 1);
    }
  }
  return '';
};

const makeCookie = (name, value, request, options = {}) => {
  const isSecure = new URL(request.url).protocol === 'https:';
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAge ?? readerSessionMaxAge}`
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
};

const clearCookie = (name, request) => makeCookie(name, '', request, { maxAge: 0 });

const cleanRedirectPath = (value, fallback = '/library/') => {
  const path = cleanText(value, 300);
  if (!path || !path.startsWith('/') || path.startsWith('//')) return fallback;
  return path;
};

const isLocalHostnameRequest = (request) => {
  const { hostname } = new URL(request.url);
  const host = request.headers.get('host') || '';
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:') ||
    host.startsWith('[::1]:')
  );
};

const hasLocalAdminBypass = (env) => {
  if (env.ADMIN_ACCESS_LOCAL_BYPASS !== '1') return false;
  const debugOrigin = String(env.READER_AUTH_DEBUG_ORIGIN || '').trim();
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(debugOrigin);
};

const cleanSlug = (value, maxLength = 120) =>
  cleanText(value, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toSqlTimestamp = (value) => {
  const raw = cleanText(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace('T', ' ').slice(0, 19);
};

const entitlementToJson = (row) => ({
  id: row.id,
  accountId: row.account_id,
  email: row.email,
  seriesSlug: row.series_slug,
  chapterSlug: row.chapter_slug,
  scope: row.scope,
  accessLevel: row.access_level,
  source: row.source,
  sourceRef: row.source_ref,
  note: row.note,
  grantedBy: row.granted_by,
  grantedAt: row.granted_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const acceptableAccessLevels = (access) => {
  if (access === 'supporter') return ['all', 'supporter'];
  if (access === 'paid') return ['all', 'paid'];
  return ['all'];
};

const nowPaymentsProvider = 'nowpayments';
const nowPaymentsDefaultApiBase = 'https://api.nowpayments.io/v1';
const nowPaymentsWebhookPath = '/api/novels/webhooks/nowpayments';
const nowPaymentsSupportedCurrencies = ['USDTBSC', 'USDTERC20', 'USDC', 'USDCMATIC', 'USDTARB', 'FDUSDBSC'];
const novelOrderStatuses = ['draft', 'waiting', 'confirming', 'confirmed', 'finished', 'failed', 'expired', 'refunded', 'unknown'];
const novelPaymentGrantStatuses = ['confirmed', 'finished'];
const staleUnfinishedNovelOrderStatuses = ['draft', 'waiting', 'unknown'];
const staleUnfinishedNovelOrderHours = 12;
const novelCheckoutPath = '/api/novels/payments/checkout';
const novelReadingEventsPath = '/api/novels/reading-events';
const novelBundleOrderType = 'chapter-bundle';
const novelCreditPackOrderType = 'credit-pack';
const novelCreditSource = 'reader-credits';
const novelCreditUnitLabel = 'SC Credits';
const novelCreditLedgerTopupSource = 'nowpayments-credit-pack';
const novelCreditLedgerUnlockSource = 'chapter-credit-unlock';
const novelCreditLedgerMembershipSource = 'reader-membership-redeem';
const novelAdminSource = 'admin-v2';
const novelAdminManualCreditSource = 'admin-v2-manual-credit';
const novelReadingEventTypes = new Set([
  'chapter_open',
  'chapter_close',
  'scroll',
  'scroll_depth',
  'reading_pause',
  'reading_resume',
  'click_next',
  'click_prev',
  'like',
  'bookmark',
  'comment_open',
  'comment_draft'
]);
const novelInternalReadingEventTypes = new Set([...novelReadingEventTypes, 'comment_submit']);
const novelReadingEventMaxBatchSize = 20;
const novelReadingEventMaxMetadataKeys = 20;
const novelReadingEventRateLimitWindowSeconds = 60;
const novelReadingEventClientRateLimitPerMinute = 120;
const novelReadingEventSessionRateLimitPerMinute = 60;
const readerCommentStatuses = new Set(['pending', 'approved', 'hidden', 'deleted']);
const readerCommentMinBodyLength = 2;
const readerCommentMaxBodyLength = 1200;
const readerCommentSubmitWindowSeconds = 60;
const readerCommentSubmitLimitPerMinute = 5;
const productFeedbackProducts = new Set(['privatepinyin']);
const productFeedbackPlatforms = new Set(['macos', 'windows', 'ios', 'other']);
const productFeedbackIssueTypes = new Set(['install', 'activation', 'typing', 'candidates', 'performance', 'other']);
const productFeedbackImpacts = new Set(['minor', 'normal', 'blocking']);
const productFeedbackStatuses = new Set(['new', 'in_progress', 'resolved', 'closed']);
const productFeedbackSubmitWindowSeconds = 15 * 60;
const productFeedbackSubmitLimitPerWindow = 5;
const novelStatsDefaultSinceDays = 30;
const novelStatsMaxAggregateTargets = 80;
const defaultReaderCreditPacks = [
  { credits: 10, priceAmount: 1, priceCurrency: 'USD', label: '10 SC Credits' },
  { credits: 50, priceAmount: 5, priceCurrency: 'USD', label: '50 SC Credits' },
  { credits: 100, priceAmount: 10, priceCurrency: 'USD', label: '100 SC Credits' }
];
const defaultMembershipCreditCost = 10;
const defaultMembershipMonths = 1;
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const timingSafeEqualString = (left, right) => {
  const leftValue = String(left || '');
  const rightValue = String(right || '');
  if (leftValue.length !== rightValue.length) return false;

  let result = 0;
  for (let index = 0; index < leftValue.length; index += 1) {
    result |= leftValue.charCodeAt(index) ^ rightValue.charCodeAt(index);
  }
  return result === 0;
};

const bytesToBase32 = (bytes) => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }

  return output;
};

const randomTotpSecretBase32 = (byteLength = 20) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase32(bytes);
};

const base32ToBytes = (value) => {
  const normalized = String(value || '').replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let buffer = 0;
  const bytes = [];

  for (const char of normalized) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
};

const normalizeTotpCode = (value) => String(value || '').replace(/\s+/g, '');

const getTotpStep = (timestamp = Date.now()) => Math.floor(timestamp / 1000 / readerTotpPeriodSeconds);

const hotpCode = async (secretBase32, counter) => {
  const keyBytes = base32ToBytes(secretBase32);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  const counterBigInt = BigInt(counter);
  counterView.setUint32(0, Number((counterBigInt >> 32n) & 0xffffffffn));
  counterView.setUint32(4, Number(counterBigInt & 0xffffffffn));

  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuffer));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = binary % 10 ** readerTotpDigits;
  return String(otp).padStart(readerTotpDigits, '0');
};

const verifyTotpCode = async (secretBase32, code, options = {}) => {
  const normalizedCode = normalizeTotpCode(code);
  if (!new RegExp(`^\\d{${readerTotpDigits}}$`).test(normalizedCode)) {
    return { ok: false, reason: 'invalid-format' };
  }

  const windowSize = Number.isInteger(options.windowSize) ? Math.max(0, options.windowSize) : 1;
  const lastUsedStep =
    options.lastUsedStep !== null && options.lastUsedStep !== undefined && Number.isFinite(Number(options.lastUsedStep))
      ? Number(options.lastUsedStep)
      : null;
  const currentStep = getTotpStep();

  for (let step = currentStep - windowSize; step <= currentStep + windowSize; step += 1) {
    if (step < 0) continue;
    const expected = await hotpCode(secretBase32, step);
    if (timingSafeEqualString(expected, normalizedCode)) {
      if (lastUsedStep !== null && step <= lastUsedStep) {
        return { ok: false, reason: 'reused-code', step };
      }
      return { ok: true, step };
    }
  }

  return { ok: false, reason: 'invalid-code' };
};

const makeTotpOtpAuthUrl = (account, secretBase32) => {
  const label = `${readerTotpIssuer}:${account.email || account.username || account.account_id || account.id}`;
  const url = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
  url.searchParams.set('secret', secretBase32);
  url.searchParams.set('issuer', readerTotpIssuer);
  url.searchParams.set('algorithm', 'SHA1');
  url.searchParams.set('digits', String(readerTotpDigits));
  url.searchParams.set('period', String(readerTotpPeriodSeconds));
  return url.toString();
};

const readerTotpAuthJson = (credential) => ({
  enabled: Boolean(credential?.enabled_at && !credential?.disabled_at),
  verifiedAt: credential?.verified_at || '',
  enabledAt: credential?.enabled_at || ''
});

const hmacSha512Hex = async (secret, value) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
};

const sortObjectDeep = (value) => {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = sortObjectDeep(value[key]);
      return sorted;
    }, {});
};

const stableJsonStringify = (value) => JSON.stringify(sortObjectDeep(value));

const verifyNowPaymentsSignature = async (payload, signature, secret) => {
  if (!secret || !signature) return false;
  const expected = await hmacSha512Hex(secret, stableJsonStringify(payload));
  return timingSafeEqualString(expected.toLowerCase(), String(signature).trim().toLowerCase());
};

const getNowPaymentsConfig = (env, request) => {
  const origin = new URL(request.url).origin;
  const apiBase = cleanText(env.NOWPAYMENTS_API_BASE || nowPaymentsDefaultApiBase, 200).replace(/\/+$/, '');
  const callbackUrl = cleanText(
    env.NOWPAYMENTS_IPN_CALLBACK_URL || `${origin}${nowPaymentsWebhookPath}`,
    300
  );

  return {
    apiBase: apiBase || nowPaymentsDefaultApiBase,
    callbackUrl,
    hasApiKey: Boolean(String(env.NOWPAYMENTS_API_KEY || '').trim()),
    hasIpnSecret: Boolean(String(env.NOWPAYMENTS_IPN_SECRET || '').trim())
  };
};

const mapNowPaymentsStatus = (value) => {
  const status = cleanText(value, 80).toLowerCase();
  if (status === 'finished') return 'finished';
  if (status === 'confirmed' || status === 'sending') return 'confirmed';
  if (status === 'confirming' || status === 'partially_paid') return 'confirming';
  if (status === 'waiting') return 'waiting';
  if (status === 'failed') return 'failed';
  if (status === 'expired') return 'expired';
  if (status === 'refunded') return 'refunded';
  return status || 'unknown';
};

const normalizePaymentValue = (value, maxLength = 80) => cleanText(value, maxLength);

const normalizePriceAmount = (value, fallback = null) => {
  const amount = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  return Math.round(amount * 100) / 100;
};

const normalizeFiatCurrency = (value, fallback = 'USD') => {
  const currency = cleanText(value, 12).toUpperCase();
  return currency === 'USD' ? 'USD' : fallback;
};

const normalizePayCurrency = (value) => {
  const currency = cleanText(value, 24).toUpperCase();
  return nowPaymentsSupportedCurrencies.includes(currency) ? currency : '';
};

const amountToStorage = (amount) => {
  const number = normalizePriceAmount(amount, 0);
  return number.toFixed(2);
};

const paymentReturnUrl = (request, path, state, orderToken) => {
  const url = new URL(cleanRedirectPath(path, '/library/'), new URL(request.url).origin);
  url.searchParams.set('payment', state);
  url.searchParams.set('order', orderToken);
  return url.toString();
};

const getCheckoutPrices = (env) => ({
  chapter: normalizePriceAmount(env.NOVEL_CHAPTER_PRICE_USD, 1.99),
  supporter: normalizePriceAmount(env.NOVEL_SUPPORTER_PRICE_USD, 4.99),
  tipMin: normalizePriceAmount(env.NOVEL_TIP_MIN_USD, 1),
  tipMax: normalizePriceAmount(env.NOVEL_TIP_MAX_USD, 500)
});

const normalizePositiveInteger = (value, fallback = 0) => {
  const number = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

const normalizeBundleDiscounts = (discounts) =>
  (Array.isArray(discounts) ? discounts : [])
    .map((discount) => ({
      chapters: normalizePositiveInteger(discount?.chapters, 0),
      discountPercent: normalizePriceAmount(discount?.discountPercent, 0)
    }))
    .filter((discount) => discount.chapters > 1 && discount.discountPercent > 0 && discount.discountPercent < 100)
    .sort((a, b) => a.chapters - b.chapters || a.discountPercent - b.discountPercent);

const contentPricingModes = new Set(['free', 'tip-optional', 'chapter-paid', 'volume-paid', 'member']);

const normalizeContentPricingMode = (value) => {
  const mode = cleanText(value, 40).toLowerCase();
  return contentPricingModes.has(mode) ? mode : 'free';
};

const normalizeContentTipAmounts = (value) => {
  const amounts = (Array.isArray(value) ? value : [])
    .map((amount) => normalizePriceAmount(amount, null))
    .filter((amount) => amount && amount > 0);
  return Array.from(new Set(amounts)).sort((a, b) => a - b);
};

const normalizeContentBundleDiscounts = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => ({
      minimumChapters: normalizePositiveInteger(item?.minimumChapters ?? item?.chapters, 0),
      discountPercent: normalizePriceAmount(item?.discountPercent, 0)
    }))
    .filter((item) => item.minimumChapters > 1 && item.discountPercent > 0 && item.discountPercent < 100)
    .sort((a, b) => a.minimumChapters - b.minimumChapters || a.discountPercent - b.discountPercent);

const normalizeContentCreditPacks = (value) =>
  (Array.isArray(value) ? value : [])
    .map((pack) => {
      const credits = normalizePositiveInteger(pack?.credits, 0);
      const priceAmount = normalizePriceAmount(pack?.priceAmount, null);
      if (!credits || !priceAmount) return null;
      return {
        credits,
        label: cleanText(pack?.label || `${credits} ${novelCreditUnitLabel}`, 80),
        priceAmount,
        priceCurrency: normalizeFiatCurrency(pack?.priceCurrency, 'USD')
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priceAmount - b.priceAmount || a.credits - b.credits);

const normalizeContentPricing = (value = {}) => {
  const pricing = normalizeJsonObject(value);
  const mode = normalizeContentPricingMode(pricing.mode || pricing.priceMode);
  const tipAmounts = normalizeContentTipAmounts(pricing.tipAmounts);
  const chapterBundleDiscounts = normalizeContentBundleDiscounts(pricing.chapterBundleDiscounts);
  const creditPacks = normalizeContentCreditPacks(pricing.creditPacks || pricing.readerCreditPacks);
  const membershipCreditCost = normalizePositiveInteger(
    pricing.membershipCreditCost ?? pricing.subscriptionCreditCost,
    defaultMembershipCreditCost
  );
  const membershipDurationMonths = normalizePositiveInteger(
    pricing.membershipDurationMonths ?? pricing.subscriptionMonths,
    defaultMembershipMonths
  );

  return {
    mode,
    freeChapters: normalizePositiveInteger(pricing.freeChapters, 0),
    chapterPriceAmount: normalizePriceAmount(pricing.chapterPriceAmount, 0) || 0,
    chapterPriceCurrency: normalizeFiatCurrency(pricing.chapterPriceCurrency, 'USD'),
    chapterCredits: normalizePositiveInteger(pricing.chapterCredits, 0),
    supporterPriceAmount: normalizePriceAmount(pricing.supporterPriceAmount, 0) || 0,
    supporterPriceCurrency: normalizeFiatCurrency(pricing.supporterPriceCurrency, 'USD'),
    tipsEnabled: Boolean(pricing.tipsEnabled),
    tipAmounts,
    tipCurrency: normalizeFiatCurrency(pricing.tipCurrency, 'USD'),
    bundlePurchasesEnabled: Boolean(pricing.bundlePurchasesEnabled),
    chapterBundleDiscounts,
    creditPacks,
    directChapterCheckoutEnabled: Boolean(pricing.directChapterCheckoutEnabled),
    subscriptionEnabled: pricing.subscriptionEnabled !== false,
    membershipCreditCost: Math.max(1, membershipCreditCost || defaultMembershipCreditCost),
    membershipDurationMonths: Math.max(1, membershipDurationMonths || defaultMembershipMonths),
    membershipCoversPaidContent: pricing.membershipCoversPaidContent !== false
  };
};

const normalizeCreditPack = (pack) => {
  const credits = normalizePositiveInteger(pack?.credits, 0);
  const priceAmount = normalizePriceAmount(pack?.priceAmount, null);
  if (!credits || !priceAmount) return null;
  return {
    credits,
    priceAmount,
    priceCurrency: normalizeFiatCurrency(pack?.priceCurrency, 'USD'),
    label: cleanText(pack?.label || `${credits} ${novelCreditUnitLabel}`, 80)
  };
};

const parseCreditPacksEnv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => {
      const [credits, priceAmount, label] = item.split(':');
      return normalizeCreditPack({
        credits,
        priceAmount,
        label: label ? label.replace(/_/g, ' ') : ''
      });
    })
    .filter(Boolean);

const getReaderCreditConfig = (env) => {
  const envPacks = parseCreditPacksEnv(env.NOVEL_CREDIT_PACKS);
  const packs = (envPacks.length ? envPacks : defaultReaderCreditPacks)
    .map(normalizeCreditPack)
    .filter(Boolean)
    .sort((a, b) => a.priceAmount - b.priceAmount || a.credits - b.credits);

  return {
    chapterCostCredits: Math.max(1, normalizePositiveInteger(env.NOVEL_CHAPTER_CREDIT_COST, 1)),
    unitLabel: cleanText(env.NOVEL_CREDIT_UNIT_LABEL || novelCreditUnitLabel, 40) || novelCreditUnitLabel,
    packs
  };
};

const findReaderCreditPack = (env, requestedCredits) => {
  const config = getReaderCreditConfig(env);
  const credits = normalizePositiveInteger(requestedCredits, 0);
  const pack = config.packs.find((candidate) => candidate.credits === credits) || null;
  if (!pack) {
    const error = new Error('The selected reading credit pack is not available.');
    error.code = 'CREDIT_PACK_NOT_AVAILABLE';
    throw error;
  }
  return {
    ...pack,
    unitLabel: config.unitLabel
  };
};

const getStaticSeriesPaymentSettings = (seriesSlug, env) => {
  const defaults = getCheckoutPrices(env);
  const settings = novelPaymentConfig?.series?.[seriesSlug];
  const readerCreditConfig = getReaderCreditConfig(env);
  if (!settings) {
    return {
      seriesSlug,
      source: 'env-default',
      priceMode: 'chapter-paid',
      freeChapters: 0,
      tipsEnabled: true,
      tipAmounts: [3, 5, 10],
      tipCurrency: 'USD',
      chapterPriceAmount: defaults.chapter,
      chapterPriceCurrency: 'USD',
      chapterCredits: readerCreditConfig.chapterCostCredits,
      supporterPriceAmount: defaults.supporter,
      supporterPriceCurrency: 'USD',
      bundlePurchasesEnabled: false,
      chapterBundleDiscounts: [],
      creditPacks: readerCreditConfig.packs,
      directChapterCheckoutEnabled: false,
      subscriptionEnabled: true,
      membershipCreditCost: defaultMembershipCreditCost,
      membershipDurationMonths: defaultMembershipMonths,
      membershipCoversPaidContent: true,
      chapters: []
    };
  }

  const tipAmounts = (Array.isArray(settings.tipAmounts) ? settings.tipAmounts : [])
    .map((amount) => normalizePriceAmount(amount, null))
    .filter((amount) => amount && amount > 0);

  return {
    seriesSlug,
    source: 'serial-config',
    priceMode: normalizeContentPricingMode(settings.priceMode),
    freeChapters: normalizePositiveInteger(settings.freeChapters, 0),
    tipsEnabled: settings.tipsEnabled !== false,
    tipAmounts: tipAmounts.length ? tipAmounts : [3, 5, 10],
    tipCurrency: normalizeFiatCurrency(settings.tipCurrency, 'USD'),
    chapterPriceAmount: normalizePriceAmount(settings.chapterPriceAmount, defaults.chapter),
    chapterPriceCurrency: normalizeFiatCurrency(settings.chapterPriceCurrency, 'USD'),
    chapterCredits: readerCreditConfig.chapterCostCredits,
    supporterPriceAmount: normalizePriceAmount(settings.supporterPriceAmount, defaults.supporter),
    supporterPriceCurrency: normalizeFiatCurrency(settings.supporterPriceCurrency, 'USD'),
    bundlePurchasesEnabled: Boolean(settings.bundlePurchasesEnabled),
    chapterBundleDiscounts: normalizeBundleDiscounts(settings.chapterBundleDiscounts),
    creditPacks: readerCreditConfig.packs,
    directChapterCheckoutEnabled: false,
    subscriptionEnabled: true,
    membershipCreditCost: defaultMembershipCreditCost,
    membershipDurationMonths: defaultMembershipMonths,
    membershipCoversPaidContent: true,
    chapters: (Array.isArray(settings.chapters) ? settings.chapters : [])
      .map((chapter) => ({
        chapterSlug: cleanSlug(chapter?.chapterSlug),
        chapterNumber: normalizePositiveInteger(chapter?.chapterNumber, 0),
        access: chapter?.access === 'supporter' ? 'supporter' : chapter?.access === 'paid' ? 'paid' : 'free',
        status: chapter?.status === 'published' ? 'published' : chapter?.status === 'scheduled' ? 'scheduled' : 'draft'
      }))
      .filter((chapter) => chapter.chapterSlug)
      .sort((a, b) => a.chapterNumber - b.chapterNumber || a.chapterSlug.localeCompare(b.chapterSlug))
  };
};

const paymentBundleDiscountsFromContentPricing = (pricing) =>
  normalizeContentBundleDiscounts(pricing.chapterBundleDiscounts).map((rule) => ({
    chapters: rule.minimumChapters,
    discountPercent: rule.discountPercent
  }));

const applyContentPricingSnapshot = (settings, pricingSnapshot, source) => {
  const rawPricing = normalizeJsonObject(pricingSnapshot);
  const pricing = normalizeContentPricing(rawPricing);
  const has = (key) => Object.prototype.hasOwnProperty.call(rawPricing, key);
  const next = { ...settings, source };

  if (has('mode') || has('priceMode')) next.priceMode = pricing.mode;
  if (has('freeChapters')) next.freeChapters = pricing.freeChapters;
  if (pricing.chapterPriceAmount > 0) next.chapterPriceAmount = pricing.chapterPriceAmount;
  if (has('chapterPriceCurrency')) next.chapterPriceCurrency = pricing.chapterPriceCurrency;
  if (pricing.chapterCredits > 0) next.chapterCredits = pricing.chapterCredits;
  if (pricing.supporterPriceAmount > 0) next.supporterPriceAmount = pricing.supporterPriceAmount;
  if (has('supporterPriceCurrency')) next.supporterPriceCurrency = pricing.supporterPriceCurrency;
  if (has('tipsEnabled')) next.tipsEnabled = pricing.tipsEnabled;
  if (pricing.tipAmounts.length) next.tipAmounts = pricing.tipAmounts;
  if (has('tipCurrency')) next.tipCurrency = pricing.tipCurrency;
  if (has('bundlePurchasesEnabled')) next.bundlePurchasesEnabled = pricing.bundlePurchasesEnabled;
  if (pricing.chapterBundleDiscounts.length) {
    next.chapterBundleDiscounts = paymentBundleDiscountsFromContentPricing(pricing);
  }
  if (pricing.creditPacks.length) next.creditPacks = pricing.creditPacks;
  if (has('directChapterCheckoutEnabled')) next.directChapterCheckoutEnabled = pricing.directChapterCheckoutEnabled;
  if (has('subscriptionEnabled')) next.subscriptionEnabled = pricing.subscriptionEnabled;
  if (has('membershipCreditCost') || has('subscriptionCreditCost')) next.membershipCreditCost = pricing.membershipCreditCost;
  if (has('membershipDurationMonths') || has('subscriptionMonths')) next.membershipDurationMonths = pricing.membershipDurationMonths;
  if (has('membershipCoversPaidContent')) next.membershipCoversPaidContent = pricing.membershipCoversPaidContent;

  return next;
};

const ruleAmount = (rule, fallback = null) => normalizePriceAmount(rule?.amount, fallback);

const pricingRuleMode = (rule) => normalizeContentPricingMode(rule?.metadata?.mode || rule?.label);

const getScopedPricingRules = (rules, chapterSlug = '') => {
  const normalizedChapterSlug = cleanSlug(chapterSlug, 160);
  const enabledRules = (Array.isArray(rules) ? rules : []).filter((rule) => rule?.isEnabled);
  return enabledRules
    .filter((rule) => !rule.chapterSlug || (normalizedChapterSlug && rule.chapterSlug === normalizedChapterSlug))
    .sort((left, right) => {
      const leftScore = left.chapterSlug && left.chapterSlug === normalizedChapterSlug ? 0 : 1;
      const rightScore = right.chapterSlug && right.chapterSlug === normalizedChapterSlug ? 0 : 1;
      return leftScore - rightScore || left.entryId - right.entryId || left.id - right.id;
    });
};

const pickScopedPricingRule = (rules, ruleType, chapterSlug = '') =>
  getScopedPricingRules(rules, chapterSlug).find((rule) => rule.ruleType === ruleType) || null;

const pickValuedScopedPricingRule = (rules, ruleType, chapterSlug, isValued) =>
  getScopedPricingRules(rules, chapterSlug).find((rule) => rule.ruleType === ruleType && isValued(rule)) || null;

const listScopedPricingRules = (rules, ruleType, chapterSlug = '') => {
  const normalizedChapterSlug = cleanSlug(chapterSlug, 160);
  const scopedRules = getScopedPricingRules(rules, normalizedChapterSlug).filter((rule) => rule.ruleType === ruleType);
  const exactRules = scopedRules.filter((rule) => normalizedChapterSlug && rule.chapterSlug === normalizedChapterSlug);
  return exactRules.length ? exactRules : scopedRules.filter((rule) => !rule.chapterSlug);
};

const applyContentPricingRules = (settings, rules, chapterSlug = '') => {
  const scopedRules = getScopedPricingRules(rules, chapterSlug);
  if (!scopedRules.length) return settings;

  const next = { ...settings, source: 'backend-pricing-rules' };
  const modeRule = pickScopedPricingRule(scopedRules, 'pricing_mode', chapterSlug);
  if (modeRule) next.priceMode = pricingRuleMode(modeRule);

  const freeChaptersRule = pickScopedPricingRule(scopedRules, 'free_chapters', chapterSlug);
  if (freeChaptersRule) next.freeChapters = normalizePositiveInteger(freeChaptersRule.minimumChapters, 0);

  const chapterPriceRule =
    pickValuedScopedPricingRule(
      scopedRules,
      'chapter_price',
      chapterSlug,
      (rule) => Boolean(ruleAmount(rule, null)) || rule.credits > 0
    ) || pickScopedPricingRule(scopedRules, 'chapter_price', chapterSlug);
  if (chapterPriceRule) {
    const amount = ruleAmount(chapterPriceRule, null);
    if (amount) next.chapterPriceAmount = amount;
    if (chapterPriceRule.currency) next.chapterPriceCurrency = normalizeFiatCurrency(chapterPriceRule.currency, next.chapterPriceCurrency);
    if (chapterPriceRule.credits > 0) next.chapterCredits = chapterPriceRule.credits;
  }

  const supporterPriceRule =
    pickValuedScopedPricingRule(scopedRules, 'supporter_price', chapterSlug, (rule) => Boolean(ruleAmount(rule, null))) ||
    pickScopedPricingRule(scopedRules, 'supporter_price', chapterSlug);
  if (supporterPriceRule) {
    const amount = ruleAmount(supporterPriceRule, null);
    if (amount) next.supporterPriceAmount = amount;
    if (supporterPriceRule.currency) {
      next.supporterPriceCurrency = normalizeFiatCurrency(supporterPriceRule.currency, next.supporterPriceCurrency);
    }
  }

  const tipRules = listScopedPricingRules(scopedRules, 'tip_amount', chapterSlug);
  if (tipRules.length) {
    next.tipsEnabled = true;
    next.tipAmounts = Array.from(new Set(tipRules.map((rule) => ruleAmount(rule, null)).filter(Boolean))).sort((a, b) => a - b);
    next.tipCurrency = normalizeFiatCurrency(tipRules[0]?.currency, next.tipCurrency);
  }

  const bundleRules = listScopedPricingRules(scopedRules, 'bundle_discount', chapterSlug);
  if (bundleRules.length) {
    next.bundlePurchasesEnabled = bundleRules.some((rule) => rule.isEnabled);
    next.chapterBundleDiscounts = bundleRules
      .map((rule) => ({
        chapters: normalizePositiveInteger(rule.minimumChapters, 0),
        discountPercent: normalizePriceAmount(rule.discountPercent, 0)
      }))
      .filter((rule) => rule.chapters > 1 && rule.discountPercent > 0 && rule.discountPercent < 100)
      .sort((left, right) => left.chapters - right.chapters || left.discountPercent - right.discountPercent);
  }

  const creditPackRules = listScopedPricingRules(scopedRules, 'credit_pack', chapterSlug);
  if (creditPackRules.length) {
    next.creditPacks = creditPackRules
      .map((rule) =>
        normalizeCreditPack({
          credits: rule.credits,
          label: rule.label,
          priceAmount: rule.amount,
          priceCurrency: rule.currency
        })
      )
      .filter(Boolean);
  }

  return next;
};

const selectPublishedSeriesContentEntry = async (db, seriesSlug, locale = '') => {
  const normalizedSeriesSlug = cleanSlug(seriesSlug, 160);
  const normalizedLocale = cleanText(locale, 20);
  if (!normalizedSeriesSlug) return null;

  return db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = 'novel_series'
         AND slug = ?
         AND status = 'published'
         AND visibility IN ('public', 'unlisted')
       ORDER BY CASE WHEN locale = ? THEN 0 ELSE 1 END, updated_at DESC, id DESC
       LIMIT 1`
    )
    .bind(normalizedSeriesSlug, normalizedLocale)
    .first();
};

const backendChaptersToPaymentChapters = (chapters) =>
  (Array.isArray(chapters) ? chapters : [])
    .map((chapter) => ({
      chapterSlug: cleanSlug(chapter.slug, 160),
      chapterNumber: normalizePositiveInteger(chapter.chapter_number, 0),
      access:
        chapter.access_level === 'supporter'
          ? 'supporter'
          : chapter.access_level === 'paid' || chapter.access_level === 'member'
            ? 'paid'
            : 'free',
      status: 'published'
    }))
    .filter((chapter) => chapter.chapterSlug)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.chapterSlug.localeCompare(b.chapterSlug));

const getBackendSeriesPaymentSettings = async (db, seriesSlug, env, options = {}) => {
  if (!db) return null;

  const tablesReady = await ensureContentTablesReady(db);
  if (!tablesReady) return null;

  const seriesEntry = await selectPublishedSeriesContentEntry(db, seriesSlug, options.locale);
  if (!seriesEntry) return null;

  const fallback = getStaticSeriesPaymentSettings(seriesSlug, env);
  const [chapters, rules] = await Promise.all([
    listPublishedContentEntries(db, {
      entryType: 'novel_chapter',
      locale: seriesEntry.locale,
      parentSlug: seriesEntry.slug,
      limit: 100
    }),
    listContentPricingRules(db, { seriesSlug: seriesEntry.slug, limit: 200 })
  ]);
  const backendChapters = backendChaptersToPaymentChapters(chapters);
  const snapshotSettings = applyContentPricingSnapshot(
    {
      ...fallback,
      chapters: backendChapters.length ? backendChapters : fallback.chapters
    },
    parseStoredJson(seriesEntry.pricing_json, {}),
    'backend-pricing-json'
  );

  return applyContentPricingRules(snapshotSettings, rules, options.chapterSlug);
};

const applyConfiguredPricingDefaultsToSettings = async (db, settings) => {
  if (!db || !settings) return settings;
  try {
    if (!(await ensureAdminContentSettingsReady(db))) return settings;
    const row = await getContentPricingDefaultsRow(db);
    if (!row) return settings;
    const template = normalizeContentPricingDefaults(parseStoredJson(row.setting_json, {}));
    const merged = applyContentPricingSnapshot(settings, template.pricing, 'global-pricing-defaults');
    return {
      ...merged,
      accessLevel: template.accessLevel,
      globalPricingUpdatedAt: row.updated_at || '',
      globalPricingUpdatedBy: row.updated_by || ''
    };
  } catch (error) {
    if (isMissingContentTablesError(error)) return settings;
    if (String(error?.message || '').includes('no such table')) return settings;
    throw error;
  }
};

const resolveSeriesPaymentSettings = async (db, seriesSlug, env, options = {}) => {
  let settings = null;
  try {
    const backendSettings = await getBackendSeriesPaymentSettings(db, seriesSlug, env, options);
    if (backendSettings) settings = backendSettings;
  } catch (error) {
    if (!isMissingContentTablesError(error)) throw error;
  }
  return applyConfiguredPricingDefaultsToSettings(db, settings || getStaticSeriesPaymentSettings(seriesSlug, env));
};

const normalizeDynamicChapterAccessLevel = (value) => {
  const accessLevel = cleanText(value, 40).toLowerCase();
  if (accessLevel === 'supporter') return 'supporter';
  if (accessLevel === 'member') return 'member';
  if (accessLevel === 'paid') return 'paid';
  return 'free';
};

const getDynamicChapterNumberForPricing = (chapter, index = 0) =>
  normalizePositiveInteger(chapter?.chapter_number ?? chapter?.chapterNumber, 0) ||
  normalizePositiveInteger(index + 1, 0);

const getEffectiveDynamicChapterAccessLevel = (chapter, paymentSettings = null, index = 0) => {
  const originalAccessLevel = normalizeDynamicChapterAccessLevel(chapter?.access_level ?? chapter?.access);
  if (!paymentSettings || paymentSettings.priceMode !== 'chapter-paid') return originalAccessLevel;

  const chapterNumber = getDynamicChapterNumberForPricing(chapter, index);
  const hasChapterCharge =
    normalizePositiveInteger(paymentSettings.chapterCredits, 0) > 0 ||
    normalizePriceAmount(paymentSettings.chapterPriceAmount, 0) > 0;
  if (!chapterNumber || !hasChapterCharge) return originalAccessLevel;

  const freeChapters = normalizePositiveInteger(paymentSettings.freeChapters, 0);
  if (chapterNumber <= freeChapters) return 'free';
  if (originalAccessLevel === 'supporter') return 'supporter';
  if (originalAccessLevel === 'member') return 'member';
  return 'paid';
};

const dynamicProtectedAccessFromChapterAccess = (accessLevel) =>
  accessLevel === 'supporter' ? 'supporter' : accessLevel === 'paid' || accessLevel === 'member' ? 'paid' : 'free';

const getConfiguredTipAmount = (settings, amount) => {
  const requested = normalizePriceAmount(amount, null);
  if (!requested) return settings.tipAmounts[0] || 5;
  return settings.tipAmounts.find((tipAmount) => Math.abs(tipAmount - requested) < 0.001) || null;
};

const getBundleCheckoutDetails = (settings, payload, chapterSlug) => {
  const bundleChapters = normalizePositiveInteger(payload.bundleChapters || payload.chapterCount, 0);
  const rule = settings.chapterBundleDiscounts.find((discount) => discount.chapters === bundleChapters);
  if (!settings.bundlePurchasesEnabled || !rule) {
    const error = new Error('Bundle checkout is not enabled for this serial.');
    error.code = 'BUNDLE_NOT_AVAILABLE';
    throw error;
  }

  const paidChapters = settings.chapters.filter((chapter) => chapter.status === 'published' && chapter.access === 'paid');
  const startIndex = paidChapters.findIndex((chapter) => chapter.chapterSlug === chapterSlug);
  const bundleChapterSlugs =
    startIndex >= 0 ? paidChapters.slice(startIndex, startIndex + rule.chapters).map((chapter) => chapter.chapterSlug) : [];
  if (bundleChapterSlugs.length !== rule.chapters) {
    const error = new Error('Not enough paid chapters are available for this bundle.');
    error.code = 'BUNDLE_NOT_AVAILABLE';
    throw error;
  }

  const requestedSlugs = Array.isArray(payload.chapterSlugs)
    ? payload.chapterSlugs.map((slug) => cleanSlug(slug)).filter(Boolean)
    : [];
  if (requestedSlugs.length && requestedSlugs.join('|') !== bundleChapterSlugs.join('|')) {
    const error = new Error('Bundle chapter list does not match the configured reading order.');
    error.code = 'INVALID_BUNDLE_CHAPTERS';
    throw error;
  }

  const unitPriceAmount = settings.chapterPriceAmount;
  const subtotalAmount = Math.round(unitPriceAmount * rule.chapters * 100) / 100;
  const priceAmount = Math.round(subtotalAmount * (100 - rule.discountPercent)) / 100;

  return {
    bundleChapterCount: rule.chapters,
    bundleChapterSlugs,
    bundleDiscountPercent: rule.discountPercent,
    priceAmount: normalizePriceAmount(priceAmount, unitPriceAmount),
    subtotalAmount,
    unitPriceAmount
  };
};

const getBundlePricingOptions = (settings, chapterSlug) =>
  (settings.chapterBundleDiscounts || [])
    .map((rule) => {
      try {
        return getBundleCheckoutDetails(settings, { bundleChapters: rule.chapters }, chapterSlug);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

const paymentSettingsToPublicJson = (settings, options = {}) => {
  const chapterSlug = cleanSlug(options.chapterSlug, 160);
  const bundleOptions = chapterSlug ? getBundlePricingOptions(settings, chapterSlug) : [];
  return {
    seriesSlug: settings.seriesSlug,
    source: settings.source,
    priceMode: settings.priceMode,
    freeChapters: settings.freeChapters,
    tipsEnabled: Boolean(settings.tipsEnabled),
    tipAmounts: settings.tipAmounts.map((amount) => amountToStorage(amount)),
    tipCurrency: settings.tipCurrency,
    chapterPriceAmount: amountToStorage(settings.chapterPriceAmount),
    chapterPriceCurrency: settings.chapterPriceCurrency,
    chapterCredits: Math.max(1, normalizePositiveInteger(settings.chapterCredits, 1)),
    supporterPriceAmount: amountToStorage(settings.supporterPriceAmount),
    supporterPriceCurrency: settings.supporterPriceCurrency,
    bundlePurchasesEnabled: Boolean(settings.bundlePurchasesEnabled),
    chapterBundleDiscounts: settings.chapterBundleDiscounts,
    directChapterCheckoutEnabled: Boolean(settings.directChapterCheckoutEnabled),
    subscriptionEnabled: settings.subscriptionEnabled !== false,
    membershipCreditCost: Math.max(1, normalizePositiveInteger(settings.membershipCreditCost, defaultMembershipCreditCost)),
    membershipDurationMonths: Math.max(1, normalizePositiveInteger(settings.membershipDurationMonths, defaultMembershipMonths)),
    membershipCoversPaidContent: settings.membershipCoversPaidContent !== false,
    bundleOptions: bundleOptions.map((option) => ({
      chapterCount: option.bundleChapterCount,
      chapterSlugs: option.bundleChapterSlugs,
      discountPercent: option.bundleDiscountPercent,
      priceAmount: amountToStorage(option.priceAmount),
      priceCurrency: settings.chapterPriceCurrency,
      subtotalAmount: amountToStorage(option.subtotalAmount),
      unitPriceAmount: amountToStorage(option.unitPriceAmount)
    })),
    creditPacks: (settings.creditPacks || []).map((pack) => ({
      credits: pack.credits,
      label: pack.label,
      priceAmount: amountToStorage(pack.priceAmount),
      priceCurrency: pack.priceCurrency
    }))
  };
};

const parseOrderMetadata = (order) => {
  try {
    const metadata = JSON.parse(order?.metadata_json || '{}');
    return metadata && typeof metadata === 'object' ? metadata : {};
  } catch {
    return {};
  }
};

const extractNowPaymentsEvent = (payload) => {
  const providerStatus = normalizePaymentValue(payload.payment_status || payload.status, 80).toLowerCase();
  return {
    providerOrderId: normalizePaymentValue(payload.order_id || payload.orderId, 200),
    providerPaymentId: normalizePaymentValue(payload.payment_id || payload.paymentId, 120),
    providerInvoiceId: normalizePaymentValue(payload.invoice_id || payload.invoiceId, 120),
    providerStatus,
    status: mapNowPaymentsStatus(providerStatus),
    priceAmount: normalizePaymentValue(payload.price_amount || payload.priceAmount, 60),
    priceCurrency: normalizePaymentValue(payload.price_currency || payload.priceCurrency, 24).toUpperCase(),
    payAmount: normalizePaymentValue(payload.pay_amount || payload.payAmount || payload.actually_paid, 60),
    payCurrency: normalizePaymentValue(payload.pay_currency || payload.payCurrency, 24).toUpperCase()
  };
};

const novelOrderToJson = (row) => ({
  id: row.id,
  orderToken: row.order_token,
  accountId: row.account_id,
  accountEmail: row.account_email || row.email || '',
  provider: row.provider,
  providerOrderId: row.provider_order_id,
  providerPaymentId: row.provider_payment_id,
  providerInvoiceId: row.provider_invoice_id,
  orderType: row.order_type,
  seriesSlug: row.series_slug,
  chapterSlug: row.chapter_slug,
  entitlementScope: row.entitlement_scope,
  entitlementAccessLevel: row.entitlement_access_level,
  priceAmount: row.price_amount,
  priceCurrency: row.price_currency,
  payAmount: row.pay_amount,
  payCurrency: row.pay_currency,
  paymentUrl: row.payment_url,
  status: row.status,
  providerStatus: row.provider_status,
  customerEmail: row.customer_email,
  metadataJson: row.metadata_json,
  expiresAt: row.expires_at,
  confirmedAt: row.confirmed_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const readerCreditAccountToJson = (row, config) => ({
  accountId: row.account_id,
  balanceCredits: normalizePositiveInteger(row.balance_credits, 0),
  lifetimePurchasedCredits: normalizePositiveInteger(row.lifetime_purchased_credits, 0),
  lifetimeSpentCredits: normalizePositiveInteger(row.lifetime_spent_credits, 0),
  unitLabel: row.currency_label || config.unitLabel,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const readerCreditLedgerToJson = (row) => ({
  id: row.id,
  accountId: row.account_id,
  entryType: row.entry_type,
  creditsDelta: normalizePositiveInteger(Math.abs(row.credits_delta), 0) * (Number(row.credits_delta) < 0 ? -1 : 1),
  balanceAfter: normalizePositiveInteger(row.balance_after, 0),
  source: row.source,
  sourceRef: row.source_ref,
  seriesSlug: row.series_slug,
  chapterSlug: row.chapter_slug,
  note: row.note,
  metadataJson: row.metadata_json,
  createdAt: row.created_at
});

const readerBookmarkToJson = (row) => ({
  id: row.id,
  accountId: row.account_id,
  seriesSlug: row.series_slug,
  chapterSlug: row.chapter_slug,
  seriesTitle: row.series_title,
  chapterTitle: row.chapter_title,
  locale: row.locale,
  sourcePath: row.source_path,
  progressPercent: normalizePositiveInteger(row.progress_percent, 0),
  positionLabel: row.position_label,
  note: row.note,
  metadata: parseStoredJson(row.metadata_json, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const readerMembershipToJson = (row) => row
  ? {
      accountId: row.account_id,
      membershipLevel: row.membership_level,
      source: row.source,
      sourceRef: row.source_ref,
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      lastRedeemedAt: row.last_redeemed_at,
      active: !row.expires_at || new Date(String(row.expires_at).replace(' ', 'T')).getTime() > Date.now(),
      metadata: parseStoredJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  : null;

const getActiveReaderMembership = async (db, accountId) => {
  if (!db || !(await ensureReaderMembershipsReady(db))) return null;
  return db
    .prepare(
      `SELECT *
       FROM reader_memberships
       WHERE account_id = ?
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`
    )
    .bind(accountId)
    .first();
};

const getReaderMembershipSettings = async (db, env) => {
  const config = getReaderCreditConfig(env);
  let pricing = getDefaultContentPricingTemplate().pricing;
  try {
    if (db && (await ensureAdminContentSettingsReady(db))) {
      const row = await getContentPricingDefaultsRow(db);
      if (row) pricing = contentPricingDefaultsToJson(row).pricing;
    }
  } catch (error) {
    if (!isMissingAdminContentSettingsError(error)) throw error;
  }

  return {
    enabled: pricing.subscriptionEnabled !== false,
    membershipCreditCost: Math.max(1, normalizePositiveInteger(pricing.membershipCreditCost, defaultMembershipCreditCost)),
    membershipDurationMonths: Math.max(1, normalizePositiveInteger(pricing.membershipDurationMonths, defaultMembershipMonths)),
    membershipCoversPaidContent: pricing.membershipCoversPaidContent !== false,
    unitLabel: config.unitLabel
  };
};

const getConfiguredReaderCreditPacks = async (db, env) => {
  const config = getReaderCreditConfig(env);
  try {
    if (db && (await ensureAdminContentSettingsReady(db))) {
      const row = await getContentPricingDefaultsRow(db);
      if (row) {
        const packs = contentPricingDefaultsToJson(row).pricing.creditPacks || [];
        if (packs.length) return packs;
      }
    }
  } catch (error) {
    if (!isMissingAdminContentSettingsError(error)) throw error;
  }
  return config.packs;
};

const getConfiguredChapterCostCredits = async (db, env) => {
  const config = getReaderCreditConfig(env);
  try {
    if (db && (await ensureAdminContentSettingsReady(db))) {
      const row = await getContentPricingDefaultsRow(db);
      if (row) {
        const pricing = contentPricingDefaultsToJson(row).pricing;
        return Math.max(1, normalizePositiveInteger(pricing.chapterCredits, config.chapterCostCredits));
      }
    }
  } catch (error) {
    if (!isMissingAdminContentSettingsError(error)) throw error;
  }
  return config.chapterCostCredits;
};

const findConfiguredReaderCreditPack = async (db, env, requestedCredits) => {
  const config = getReaderCreditConfig(env);
  const credits = normalizePositiveInteger(requestedCredits, 0);
  const packs = await getConfiguredReaderCreditPacks(db, env);
  const pack = packs.find((candidate) => candidate.credits === credits) || null;
  if (!pack) {
    const error = new Error('The selected reading credit pack is not available.');
    error.code = 'CREDIT_PACK_NOT_AVAILABLE';
    throw error;
  }
  return {
    ...pack,
    unitLabel: config.unitLabel
  };
};

const readerAccountToAdminJson = (row, config = getReaderCreditConfig({})) => ({
  id: row.id,
  email: row.email,
  normalizedEmail: row.normalized_email,
  displayName: row.display_name,
  status: row.status,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  creditAccount: {
    accountId: row.id,
    balanceCredits: normalizePositiveInteger(row.balance_credits, 0),
    lifetimePurchasedCredits: normalizePositiveInteger(row.lifetime_purchased_credits, 0),
    lifetimeSpentCredits: normalizePositiveInteger(row.lifetime_spent_credits, 0),
    unitLabel: row.currency_label || config.unitLabel,
    createdAt: row.credit_created_at || '',
    updatedAt: row.credit_updated_at || ''
  },
  stats: {
    orderCount: normalizePositiveInteger(row.order_count, 0),
    activeEntitlementCount: normalizePositiveInteger(row.active_entitlement_count, 0),
    ledgerCount: normalizePositiveInteger(row.ledger_count, 0),
    latestOrderAt: row.latest_order_at || ''
  }
});

const novelPaymentEventToJson = (row) => ({
  id: row.id,
  provider: row.provider,
  orderId: row.order_id,
  providerOrderId: row.provider_order_id,
  providerPaymentId: row.provider_payment_id,
  eventType: row.event_type,
  status: row.status,
  signatureValid: Boolean(row.signature_valid),
  receivedAt: row.received_at
});

const readerCommentPublicName = (row) => {
  const displayName = cleanText(row.display_name, 80);
  if (displayName) return displayName;
  const username = cleanText(row.username, 80);
  if (username) return username;
  const email = normalizeEmail(row.email);
  const localPart = cleanText(email.split('@')[0], 40);
  return localPart ? `${localPart.slice(0, 2)}***` : '读者';
};

const readerCommentToJson = (row, options = {}) => {
  const admin = Boolean(options.admin);
  const comment = {
    id: row.id,
    seriesSlug: row.series_slug,
    chapterSlug: row.chapter_slug,
    locale: row.locale,
    body: row.body,
    status: row.status,
    displayName: readerCommentPublicName(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (admin) {
    comment.accountId = row.account_id;
    comment.email = row.email || '';
    comment.username = row.username || '';
    comment.sourcePath = row.source_path || '';
    comment.reviewedBy = row.reviewed_by || '';
    comment.reviewedAt = row.reviewed_at || '';
    comment.hiddenReason = row.hidden_reason || '';
    comment.metadata = parseStoredJson(row.metadata_json, {});
  }
  return comment;
};

const productFeedbackToJson = (row, options = {}) => {
  const admin = Boolean(options.admin);
  const feedback = {
    id: row.id,
    product: row.product,
    platform: row.platform,
    appVersion: row.app_version || '',
    issueType: row.issue_type,
    impact: row.impact,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (admin) {
    feedback.details = row.details || '';
    feedback.reproductionSteps = row.reproduction_steps || '';
    feedback.environment = row.environment || '';
    feedback.contactEmail = row.contact_email || '';
    feedback.adminNote = row.admin_note || '';
    feedback.sourcePath = row.source_path || '';
    feedback.locale = row.locale || 'zh-Hant';
    feedback.metadata = parseStoredJson(row.metadata_json, {});
    feedback.updatedBy = row.updated_by || '';
    feedback.resolvedAt = row.resolved_at || '';
  }
  return feedback;
};

const contentEntryTypes = new Set(['blog_post', 'novel_series', 'novel_chapter', 'signal_brief']);
const contentLocales = new Set(['zh-Hant', 'zh-Hans', 'en', 'ja']);
const contentStatuses = new Set(['draft', 'scheduled', 'published', 'archived']);
const contentVisibilities = new Set(['public', 'unlisted', 'private']);
const contentAccessLevels = new Set(['free', 'paid', 'supporter', 'member']);
const contentBodyFormats = new Set(['markdown', 'html']);
const contentPricingDefaultsSettingKey = 'content.pricing-defaults.v1';
const novelForgeImportContract = 'station-cat-novelforge-import';
const novelForgeImportContractHeader = 'station-cat-novelforge-import.v1';
const novelForgeAnalyticsContractHeader = 'station-cat-novelforge-analytics.v1';
const novelForgeContentContractHeader = 'station-cat-novelforge-content.v1';
const novelForgeTranslationContractHeader = 'station-cat-novelforge-translation.v1';
const novelForgePackageFormat = 'novelforge-standard-publish-package';
const maxNovelForgeImportBytes = 8 * 1024 * 1024;
const defaultNovelTranslationModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const defaultSignalBriefDraftModel = '@cf/meta/llama-3.1-8b-instruct-fast';
const defaultNovelTranslationSourceLocale = 'zh-Hant';
const defaultNovelTranslationTargetLocale = 'en';
const novelTranslationChunkMaxLength = 1800;
const novelTranslationChunkConcurrency = 3;
const novelEnglishTitleOverrides = new Map([
  ['离线未来', 'Offline Future'],
  ['照夜寒舟录', 'Records of Night and Cold Boats'],
  ['1999年的风扇声', 'The Fan Noise of 1999'],
  ['谢勇出场', 'Xie Yong Appears'],
  ['罗文斌的警告', "Luo Wenbin's Warning"],
  ['第一堂课', 'The First Class'],
  ['半个月', 'Half a Month'],
  ['查分方案', 'The Score Lookup Plan'],
  ['断供', 'Supply Cutoff'],
  ['雨夜旧印', 'The Old Seal on a Rainy Night'],
  ['碎布暗隙', 'The Hidden Gap in the Torn Cloth'],
  ['墙痕对质', 'Confrontation at the Wall Marks']
]);

const parseStoredJson = (value, fallback) => {
  try {
    const parsed = JSON.parse(value || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const normalizeJsonObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const isPlainRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);

const firstCleanText = (values, maxLength = 500) => {
  for (const value of values) {
    const text = cleanText(value, maxLength);
    if (text) return text;
  }
  return '';
};

const firstPlainSummary = (values, maxLength = 500) => {
  for (const value of values) {
    const text = plainTextFromMarkdown(value, maxLength);
    if (text) return text;
  }
  return '';
};

const normalizeMaybeNumber = (value, fallback = null) => {
  const number = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(number) ? number : fallback;
};

const countContentWords = (value) => {
  const text = String(value || '').trim();
  if (!text) return 0;
  const latin = text.match(/[A-Za-z0-9]+/g) || [];
  const cjk = text.match(/[\u3400-\u9fff]/g) || [];
  return latin.length + cjk.length;
};

const excerptFromText = (value, maxLength = 260) => plainTextFromMarkdown(value, maxLength);

const normalizeStringArray = (value, maxItems = 20) => {
  const items = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim());

  return items
    .map((item) => cleanText(item, 80))
    .filter(Boolean)
    .slice(0, maxItems);
};

const normalizeContentLocale = (value) => {
  const locale = cleanText(value || 'zh-Hant', 20);
  return contentLocales.has(locale) ? locale : 'zh-Hant';
};

const normalizeContentStatus = (value) => {
  const status = cleanText(value || 'draft', 30).toLowerCase();
  return contentStatuses.has(status) ? status : 'draft';
};

const normalizeContentVisibility = (value) => {
  const visibility = cleanText(value || 'public', 30).toLowerCase();
  return contentVisibilities.has(visibility) ? visibility : 'public';
};

const normalizeContentAccessLevel = (value) => {
  const accessLevel = cleanText(value || 'free', 30).toLowerCase();
  return contentAccessLevels.has(accessLevel) ? accessLevel : 'free';
};

const normalizeContentPricingDefaults = (value = {}) => {
  const defaults = normalizeJsonObject(value);
  return {
    accessLevel: normalizeContentAccessLevel(defaults.accessLevel || defaults.access),
    pricing: normalizeContentPricing(defaults.pricing || defaults)
  };
};

const normalizeContentBodyFormat = (value) => {
  const format = cleanText(value || 'markdown', 30).toLowerCase();
  return contentBodyFormats.has(format) ? format : 'markdown';
};

const normalizeContentEntryType = (value) => {
  const entryType = cleanText(value, 40).toLowerCase().replace(/-/g, '_');
  if (!contentEntryTypes.has(entryType)) {
    const error = new Error('Unsupported content entry type.');
    error.code = 'INVALID_CONTENT_TYPE';
    throw error;
  }
  return entryType;
};

const paddedChapterNumber = (value) => String(normalizePositiveInteger(value, 0)).padStart(3, '0');

const buildContentR2Keys = (entry) => {
  if (entry.entryType === 'novel_chapter') {
    const chapterPart = `${paddedChapterNumber(entry.chapterNumber)}-${entry.slug}`;
    const base = `content/novels/${entry.parentSlug}/chapters/${chapterPart}/${entry.locale}`;
    return {
      markdown: `${base}/body.md`,
      html: `${base}/body.html`
    };
  }

  if (entry.entryType === 'novel_series') {
    const base = `content/novels/${entry.slug}/series/${entry.locale}`;
    return {
      markdown: `${base}/body.md`,
      html: `${base}/body.html`
    };
  }

  if (entry.entryType === 'signal_brief') {
    const base = `content/signals/${entry.locale}/${entry.slug}`;
    return {
      markdown: `${base}/body.md`,
      html: `${base}/body.html`
    };
  }

  const base = `content/blog/${entry.locale}/${entry.slug}`;
  return {
    markdown: `${base}/body.md`,
    html: `${base}/body.html`
  };
};

const contentMediaKeyPrefix = 'content/media/';
const contentMediaKinds = new Set(['covers', 'inline']);
const contentImageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif']
]);
const maxContentImageBytes = 5 * 1024 * 1024;
const maxContentImageRequestBytes = maxContentImageBytes + 1024 * 1024;

const isSafeContentMediaKey = (value) => {
  const key = cleanText(value, 500);
  return (
    key.startsWith(contentMediaKeyPrefix) &&
    key.length <= 500 &&
    !key.includes('..') &&
    !key.includes('\\') &&
    !key.includes('//') &&
    /^[A-Za-z0-9._~/-]+$/.test(key)
  );
};

const contentMediaUrl = (value) => {
  const key = cleanText(value, 500);
  if (!key) return '';
  if (/^https?:\/\//i.test(key) || key.startsWith('/')) return key;
  if (!isSafeContentMediaKey(key)) return '';
  return `/api/content/media?key=${encodeURIComponent(key)}`;
};

const buildContentMediaKey = ({ contentType, filename, kind, slug }) => {
  const normalizedKind = contentMediaKinds.has(kind) ? kind : 'covers';
  const extension =
    contentImageTypes.get(contentType) ||
    cleanSlug(String(filename || '').split('.').pop(), 12) ||
    'bin';
  const now = new Date();
  const year = now.toISOString().slice(0, 4);
  const month = now.toISOString().slice(5, 7);
  const safeSlug = cleanSlug(slug || filename || 'media', 90) || 'media';
  const token = (crypto.randomUUID?.() || randomToken(12)).replace(/-/g, '').slice(0, 12);
  return `${contentMediaKeyPrefix}${normalizedKind}/${year}/${month}/${safeSlug}-${Date.now()}-${token}.${extension}`;
};

const contentEntryToJson = (row) => ({
  id: row.id,
  entryType: row.entry_type,
  locale: row.locale,
  slug: row.slug,
  parentSlug: row.parent_slug,
  title: row.title,
  subtitle: row.subtitle,
  description: row.description,
  excerpt: row.excerpt,
  status: row.status,
  visibility: row.visibility,
  accessLevel: row.access_level,
  authorName: row.author_name,
  featured: Boolean(row.featured),
  sortOrder: normalizePositiveInteger(row.sort_order, 0),
  chapterNumber: row.chapter_number,
  volumeTitle: row.volume_title,
  tags: parseStoredJson(row.tags_json, []),
  seo: parseStoredJson(row.seo_json, {}),
  metadata: parseStoredJson(row.metadata_json, {}),
  pricing: parseStoredJson(row.pricing_json, {}),
  bodyFormat: row.body_format,
  markdownR2Key: row.markdown_r2_key,
  htmlR2Key: row.html_r2_key,
  importR2Key: row.import_r2_key,
  coverR2Key: row.cover_r2_key,
  coverUrl: contentMediaUrl(row.cover_r2_key),
  coverAlt: row.cover_alt,
  wordCount: normalizePositiveInteger(row.word_count, 0),
  readingMinutes: normalizePositiveInteger(row.reading_minutes, 0),
  sourceKind: row.source_kind,
  sourceRef: row.source_ref,
  scheduledAt: row.scheduled_at,
  publishedAt: row.published_at,
  archivedAt: row.archived_at,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const contentEntryNovelV2Path = (row) => {
  if (!row) return '';
  const basePath = novelV2BasePathForLocale(row.locale);
  if (row.entry_type === 'novel_series' && row.slug) return `${basePath}${row.slug}/`;
  if (row.entry_type === 'novel_chapter' && row.parent_slug && row.slug) {
    return `${basePath}${row.parent_slug}/chapter/${row.slug}/`;
  }
  return '';
};

const contentEntryLegacyWorksPath = (row) => {
  if (!row) return '';
  const locale = normalizeContentLocale(row.locale);
  const basePath = getPathWithLocale(locale, 'works');
  if (row.entry_type === 'novel_series' && row.slug) return `${basePath}${row.slug}/`;
  if (row.entry_type === 'novel_chapter' && row.parent_slug && row.slug) {
    return `${basePath}${row.parent_slug}/${row.slug}/`;
  }
  return '';
};

const contentEntryPublicPath = (row) => {
  if (!row) return '';
  const locale = normalizeContentLocale(row.locale);
  if (row.entry_type === 'blog_post') return `${getPathWithLocale(locale, 'devlog')}${row.slug}/`;
  if (row.entry_type === 'signal_brief') return `${getPathWithLocale(locale, 'signal')}${row.slug}/`;
  return contentEntryNovelV2Path(row);
};

const novelForgeRemoteIdForEntry = (row) => {
  if (!row?.id) return '';
  if (row.entry_type === 'novel_series') return `work_${row.id}`;
  if (row.entry_type === 'novel_chapter') return `chapter_${row.id}`;
  return `content_${row.id}`;
};

const novelForgeCoverRemoteIdForSeries = (row) => (row?.id ? `cover_${row.id}` : '');

const novelV2BasePathForLocale = (locale) => {
  const normalized = normalizeContentLocale(locale);
  if (normalized === 'zh-Hant') return '/novel/';
  if (normalized === 'zh-Hans') return '/zh-hans/novel/';
  if (normalized === 'ja') return '/ja/novel/';
  return '/en/novel/';
};

const parseNovelForgeRemoteEntryId = (remoteId, entryType) => {
  const value = cleanText(remoteId, 100);
  if (!value) return 0;
  const patterns = entryType === 'novel_series'
    ? [/^work_(\d+)$/i, /^cover_(\d+)$/i, /^novel_series:(\d+)$/i, /^content_entry:(\d+)$/i]
    : [/^chapter_(\d+)$/i, /^novel_chapter:(\d+)$/i, /^content_entry:(\d+)$/i];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return normalizePositiveInteger(match[1], 0);
  }
  return 0;
};

const getContentBucket = (env) => env.CONTENT_BUCKET || null;

const getContentStorageDescriptor = (env) => ({
  contentBucketConfigured: Boolean(getContentBucket(env)),
  r2KeyConventions: {
    blogPostMarkdown: 'content/blog/{locale}/{slug}/body.md',
    blogPostHtml: 'content/blog/{locale}/{slug}/body.html',
    novelSeriesMarkdown: 'content/novels/{seriesSlug}/series/{locale}/body.md',
    novelChapterMarkdown: 'content/novels/{seriesSlug}/chapters/{chapterNumber}-{chapterSlug}/{locale}/body.md',
    novelChapterHtml: 'content/novels/{seriesSlug}/chapters/{chapterNumber}-{chapterSlug}/{locale}/body.html',
    signalBriefMarkdown: 'content/signals/{locale}/{slug}/body.md',
    signalBriefHtml: 'content/signals/{locale}/{slug}/body.html',
    importBackup: 'content/imports/{yyyy}/{mm}/{importId}-{filename}',
    coverImage: 'content/media/covers/{yyyy}/{mm}/{slug}-{timestamp}-{token}.{ext}'
  }
});

const localePathSegments = {
  en: 'en',
  ja: 'ja',
  'zh-Hant': 'zh-hant',
  'zh-Hans': 'zh-hans'
};

const pathSegmentLocales = {
  en: 'en',
  ja: 'ja',
  'zh-hant': 'zh-Hant',
  'zh-hans': 'zh-Hans'
};

const dynamicContentCopy = {
  en: {
    access: 'Access',
    allSerials: 'All serials',
    author: 'Author',
    backDevlog: 'Back to Dev Blog',
    backSeries: 'Back to series',
    chapter: 'Chapter',
    chapters: 'Chapters',
    devlogDescription: 'Development updates, product experiments, launch notes, and creative records from Station Cat.',
    devlogTitle: 'Station Cat Dev Blog',
    free: 'Free',
    lockedBody: 'Sign in from Member Center to check whether this account can read the chapter.',
    lockedTitle: 'This chapter is reserved for unlocked readers.',
    nextChapter: 'Next chapter',
    previousChapter: 'Previous chapter',
    read: 'Read',
    readFirst: 'Read from chapter one',
    readLatest: 'Read latest chapter',
    serialsDescription: 'A quiet reading shelf for long-form fiction published on Station Cat.',
    serialsTitle: 'Station Cat Serials',
    signalBack: 'Back to Signal strip',
    signalCard: 'Open share card',
    signalCopyLink: 'Copy link',
    signalDescription: 'Daily technology, economy, AI, and market signals collected for Station Cat readers.',
    signalEmpty: 'No public signal briefs yet.',
    signalEyebrow: 'Signal strip',
    signalLatest: 'Latest briefs',
    signalReadMore: 'Read full brief',
    signalShare: 'Share to X',
    signalSources: 'Sources',
    signalTitle: 'Daily Priority Brief',
    signIn: 'Open Member Center',
    status: 'Status',
    words: 'words'
  },
  ja: {
    access: '公開方式',
    allSerials: '連載一覧',
    author: '作者',
    backDevlog: '開発ログへ戻る',
    backSeries: '作品ページへ',
    chapter: '第',
    chapters: '章一覧',
    devlogDescription: 'Station Cat の開発進捗、プロダクト実験、公開準備、制作メモ。',
    devlogTitle: 'Station Cat 開発ログ',
    free: '無料',
    lockedBody: '本棚にログインして、このアカウントで読めるか確認してください。',
    lockedTitle: 'この章は解放済み読者向けです。',
    nextChapter: '次の章',
    previousChapter: '前の章',
    read: '読む',
    readFirst: '第一章から読む',
    readLatest: '最新章を読む',
    serialsDescription: 'Station Cat で公開していく長編小説のための、小さな読書棚です。',
    serialsTitle: 'Station Cat 連載小説',
    signalBack: 'Signal strip へ戻る',
    signalCard: '共有カードを開く',
    signalCopyLink: 'リンクをコピー',
    signalDescription: 'テクノロジー、経済、AI、市場の小さなシグナルを毎日まとめます。',
    signalEmpty: '公開済みの簡報はまだありません。',
    signalEyebrow: 'Signal strip',
    signalLatest: '最新簡報',
    signalReadMore: '全文を読む',
    signalShare: 'X で共有',
    signalSources: '出典',
    signalTitle: 'Daily Priority Brief',
    signIn: '本棚を開く',
    status: '更新状態',
    words: '語'
  },
  'zh-Hant': {
    access: '閱讀方式',
    allSerials: '全部連載',
    author: '作者',
    backDevlog: '返回開發博客',
    backSeries: '回到作品頁',
    chapter: '第',
    chapters: '章節列表',
    devlogDescription: 'Station Cat 的開發進度、產品實驗、上架準備和創作記錄。',
    devlogTitle: 'Station Cat 開發博客',
    free: '免費',
    lockedBody: '請先從會員中心登入，確認這個帳戶是否可以閱讀本章。',
    lockedTitle: '這一章保留給已解鎖讀者。',
    nextChapter: '下一章',
    previousChapter: '上一章',
    read: '閱讀',
    readFirst: '從第一章開始',
    readLatest: '閱讀最新章',
    serialsDescription: '一個放長篇小說、更新順序和後續讀者支持入口的小書架。',
    serialsTitle: 'Station Cat 連載小說',
    signalBack: '返回 Signal strip',
    signalCard: '打開分享卡片',
    signalCopyLink: '複製鏈接',
    signalDescription: '每天整理科技、經濟、AI 和市場上的微弱信號，像貼在站台上的一條短訊紙帶。',
    signalEmpty: '目前還沒有公開簡報。',
    signalEyebrow: 'Signal strip',
    signalLatest: '最近簡報',
    signalReadMore: '閱讀全文',
    signalShare: '分享到 X',
    signalSources: '來源',
    signalTitle: '每日信號簡報',
    signIn: '打開會員中心',
    status: '更新狀態',
    words: '字'
  },
  'zh-Hans': {
    access: '阅读方式',
    allSerials: '全部连载',
    author: '作者',
    backDevlog: '返回开发博客',
    backSeries: '回到作品页',
    chapter: '第',
    chapters: '章节列表',
    devlogDescription: 'Station Cat 的开发进度、产品实验、上架准备和创作记录。',
    devlogTitle: 'Station Cat 开发博客',
    free: '免费',
    lockedBody: '请先从会员中心登录，确认这个账户是否可以阅读本章。',
    lockedTitle: '这一章保留给已解锁读者。',
    nextChapter: '下一章',
    previousChapter: '上一章',
    read: '阅读',
    readFirst: '从第一章开始',
    readLatest: '阅读最新章',
    serialsDescription: '一个放长篇小说、更新顺序和后续读者支持入口的小书架。',
    serialsTitle: 'Station Cat 连载小说',
    signalBack: '返回 Signal strip',
    signalCard: '打开分享卡片',
    signalCopyLink: '复制链接',
    signalDescription: '每天整理科技、经济、AI 和市场上的微弱信号，像贴在站台上的一条短讯纸带。',
    signalEmpty: '目前还没有公开简报。',
    signalEyebrow: 'Signal strip',
    signalLatest: '最近简报',
    signalReadMore: '阅读全文',
    signalShare: '分享到 X',
    signalSources: '来源',
    signalTitle: '每日信号简报',
    signIn: '打开会员中心',
    status: '更新状态',
    words: '字'
  }
};

const dynamicContentStatusLabels = {
  archived: 'Archived',
  draft: 'Draft',
  published: 'Published',
  scheduled: 'Scheduled'
};

const dynamicAccessLabels = {
  free: 'Free',
  member: 'Members',
  paid: 'Paid',
  supporter: 'Supporters'
};

const dynamicAccessLabelsByLocale = {
  en: dynamicAccessLabels,
  ja: {
    free: '無料',
    member: 'メンバー',
    paid: '有料',
    supporter: '支援者向け'
  },
  'zh-Hant': {
    free: '免費',
    member: '會員',
    paid: '付費',
    supporter: '支持者'
  },
  'zh-Hans': {
    free: '免费',
    member: '会员',
    paid: '付费',
    supporter: '支持者'
  }
};

const chineseNumerals = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const formatChineseChapterNumber = (value) => {
  const number = normalizePositiveInteger(value, 0);
  if (!number) return '';
  if (number < 10) return chineseNumerals[number];
  if (number < 20) return `十${number % 10 ? chineseNumerals[number % 10] : ''}`;
  if (number < 100) {
    const tens = Math.floor(number / 10);
    const ones = number % 10;
    return `${chineseNumerals[tens]}十${ones ? chineseNumerals[ones] : ''}`;
  }
  if (number < 1000) {
    const hundreds = Math.floor(number / 100);
    const remainder = number % 100;
    if (!remainder) return `${chineseNumerals[hundreds]}百`;
    return `${chineseNumerals[hundreds]}百${remainder < 10 ? '零' : ''}${formatChineseChapterNumber(remainder)}`;
  }
  return String(number);
};

const formatDynamicChapterNumber = (chapterNumber, locale) => {
  if (locale === 'zh-Hant' || locale === 'zh-Hans' || locale === 'ja') {
    return `第${formatChineseChapterNumber(chapterNumber)}章`;
  }
  return `Chapter ${normalizePositiveInteger(chapterNumber, 0) || ''}`.trim();
};

const getDynamicAccessLabel = (accessLevel, locale) =>
  dynamicAccessLabelsByLocale[locale]?.[accessLevel] || dynamicAccessLabels[accessLevel] || accessLevel;

const getDynamicSeriesAccessSummary = (accessLevel, locale, paymentSettings = null) => {
  const accessLabel = getDynamicAccessLabel(accessLevel, locale);
  if (!paymentSettings || paymentSettings.priceMode === 'free') return accessLabel;

  const freeChapters = normalizePositiveInteger(paymentSettings.freeChapters, 0);
  const paidStartChapter = freeChapters + 1;
  const chapterCredits = normalizePositiveInteger(paymentSettings.chapterCredits, 0);

  if (paymentSettings.priceMode === 'chapter-paid' && freeChapters > 0 && chapterCredits > 0) {
    if (locale === 'en') return `First ${freeChapters} chapters free, ${chapterCredits} credit / chapter from Chapter ${paidStartChapter}`;
    if (locale === 'ja') return `第${paidStartChapter}章から ${chapterCredits} 読書ポイント / 章（最初の${freeChapters}章は無料）`;
    if (locale === 'zh-Hans') return `前 ${freeChapters} 章免费，第 ${paidStartChapter} 章起 ${chapterCredits} 阅读点 / 章`;
    return `前 ${freeChapters} 章免費，第 ${paidStartChapter} 章起 ${chapterCredits} 閱讀點 / 章`;
  }

  if (chapterCredits > 0 && accessLevel !== 'free') {
    if (locale === 'en') return `${accessLabel} · ${chapterCredits} credit / chapter`;
    if (locale === 'ja') return `${accessLabel} · ${chapterCredits} 読書ポイント / 章`;
    if (locale === 'zh-Hans') return `${accessLabel} · ${chapterCredits} 阅读点 / 章`;
    return `${accessLabel} · ${chapterCredits} 閱讀點 / 章`;
  }

  return accessLabel;
};

const normalizeContentPayload = (payload = {}) => {
  const entryType = normalizeContentEntryType(payload.entryType || payload.type);
  const locale = normalizeContentLocale(payload.locale || payload.language);
  const slug = cleanSlug(payload.slug || payload.chapterSlug || payload.postSlug, 160);
  const parentSlug = cleanSlug(payload.parentSlug || payload.seriesSlug, 160);
  const title = cleanText(payload.title, 240);
  const chapterNumber =
    entryType === 'novel_chapter' ? Math.max(1, normalizePositiveInteger(payload.chapterNumber, 0)) : null;

  if (!slug) {
    const error = new Error('A slug is required.');
    error.code = 'CONTENT_SLUG_REQUIRED';
    throw error;
  }

  if (!title) {
    const error = new Error('A title is required.');
    error.code = 'CONTENT_TITLE_REQUIRED';
    throw error;
  }

  if (entryType === 'novel_chapter' && !parentSlug) {
    const error = new Error('A parent series slug is required for novel chapters.');
    error.code = 'CONTENT_PARENT_REQUIRED';
    throw error;
  }

  if (entryType !== 'novel_chapter' && parentSlug) {
    const error = new Error('Only novel chapters can use parentSlug in the backend content model.');
    error.code = 'CONTENT_PARENT_NOT_ALLOWED';
    throw error;
  }

  const entry = {
    accessLevel: normalizeContentAccessLevel(payload.accessLevel || payload.access),
    authorName: cleanText(payload.authorName || payload.author || 'Station Cat', 160) || 'Station Cat',
    bodyFormat: normalizeContentBodyFormat(payload.bodyFormat),
    chapterNumber,
    coverAlt: cleanText(payload.coverAlt, 300),
    coverR2Key: cleanText(payload.coverR2Key, 500),
    createdBy: cleanText(payload.createdBy, 160),
    description: cleanText(payload.description, 1200),
    entryType,
    excerpt: cleanText(payload.excerpt, 1000),
    featured: payload.featured ? 1 : 0,
    html: typeof payload.html === 'string' ? payload.html : '',
    htmlR2Key: cleanText(payload.htmlR2Key, 500),
    importR2Key: cleanText(payload.importR2Key, 500),
    locale,
    markdown: typeof payload.markdown === 'string' ? payload.markdown : '',
    markdownR2Key: cleanText(payload.markdownR2Key, 500),
    metadata: normalizeJsonObject(payload.metadata),
    parentSlug,
    pricing: normalizeContentPricing(payload.pricing),
    publishedAt: toSqlTimestamp(payload.publishedAt),
    scheduledAt: toSqlTimestamp(payload.scheduledAt),
    seo: normalizeJsonObject(payload.seo),
    slug,
    sortOrder: normalizePositiveInteger(payload.sortOrder, 0),
    sourceKind: cleanText(payload.sourceKind || 'backend', 40) || 'backend',
    sourceRef: cleanText(payload.sourceRef, 300),
    status: normalizeContentStatus(payload.status),
    subtitle: cleanText(payload.subtitle || payload.tagline, 400),
    tags: normalizeStringArray(payload.tags),
    title,
    updatedBy: cleanText(payload.updatedBy, 160),
    visibility: normalizeContentVisibility(payload.visibility),
    volumeTitle: cleanText(payload.volumeTitle || payload.volume, 240),
    wordCount: normalizePositiveInteger(payload.wordCount, 0),
    readingMinutes: normalizePositiveInteger(payload.readingMinutes, 0)
  };

  const keys = buildContentR2Keys(entry);
  if (!entry.markdownR2Key) entry.markdownR2Key = keys.markdown;
  if (!entry.htmlR2Key) entry.htmlR2Key = keys.html;

  return entry;
};

const getAdminActorEmail = async (request, env) => {
  if (isLocalHostnameRequest(request) || hasLocalAdminBypass(env)) return 'local-admin';
  const explicitEmail = normalizeEmail(request.headers.get('Cf-Access-Authenticated-User-Email'));
  if (explicitEmail) return explicitEmail;

  const token = getAccessToken(request);
  if (!token) return '';
  try {
    const payload = await verifyAccessJwt(token, getAdminAccessConfig(env));
    return normalizeEmail(payload.email);
  } catch {
    return '';
  }
};

const insertAdminAuditLog = async (db, data) => {
  await db
    .prepare(
      `INSERT INTO admin_audit_logs (
        actor_email, action, target_type, target_id, target_slug, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      cleanText(data.actorEmail, 254),
      cleanText(data.action, 120),
      cleanText(data.targetType, 80),
      cleanText(data.targetId, 80),
      cleanText(data.targetSlug, 240),
      JSON.stringify(normalizeJsonObject(data.metadata))
    )
    .run();
};

const contentPricingRuleToJson = (row) => ({
  id: row.id,
  entryId: row.entry_id,
  scopeType: row.scope_type,
  entryType: row.entry_type,
  seriesSlug: row.series_slug,
  chapterSlug: row.chapter_slug,
  ruleType: row.rule_type,
  label: row.label,
  amount: row.amount,
  currency: row.currency,
  credits: normalizePositiveInteger(row.credits, 0),
  discountPercent: normalizePositiveInteger(row.discount_percent, 0),
  minimumChapters: normalizePositiveInteger(row.minimum_chapters, 0),
  isEnabled: Boolean(row.is_enabled),
  metadata: parseStoredJson(row.metadata_json, {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const getContentPricingScope = (entry) => ({
  chapterSlug: entry.entry_type === 'novel_chapter' ? entry.slug : '',
  entryType: entry.entry_type,
  scopeType: 'entry',
  seriesSlug: entry.entry_type === 'novel_chapter' ? entry.parent_slug : entry.entry_type === 'novel_series' ? entry.slug : ''
});

const makeContentPricingRule = (entry, overrides = {}) => {
  const scope = getContentPricingScope(entry);
  return {
    amount: '',
    credits: 0,
    currency: 'USD',
    discountPercent: 0,
    entryId: entry.id,
    isEnabled: true,
    label: '',
    metadata: {},
    minimumChapters: 0,
    ruleType: '',
    ...scope,
    ...overrides
  };
};

const buildContentPricingRuleRows = (entry) => {
  const pricing = normalizeContentPricing(parseStoredJson(entry.pricing_json, {}));
  const rows = [
    makeContentPricingRule(entry, {
      isEnabled: true,
      label: pricing.mode,
      metadata: { mode: pricing.mode },
      ruleType: 'pricing_mode'
    })
  ];

  if (entry.entry_type === 'novel_series' && pricing.freeChapters > 0) {
    rows.push(
      makeContentPricingRule(entry, {
        isEnabled: true,
        label: `${pricing.freeChapters} free chapters`,
        metadata: { mode: pricing.mode },
        minimumChapters: pricing.freeChapters,
        ruleType: 'free_chapters'
      })
    );
  }

  if (pricing.chapterPriceAmount > 0 || pricing.chapterCredits > 0 || ['chapter-paid', 'volume-paid'].includes(pricing.mode)) {
    rows.push(
      makeContentPricingRule(entry, {
        amount: pricing.chapterPriceAmount > 0 ? amountToStorage(pricing.chapterPriceAmount) : '',
        credits: pricing.chapterCredits,
        currency: pricing.chapterPriceCurrency,
        isEnabled: pricing.mode !== 'free' || pricing.chapterPriceAmount > 0 || pricing.chapterCredits > 0,
        label: 'Single chapter',
        metadata: { mode: pricing.mode },
        minimumChapters: 1,
        ruleType: 'chapter_price'
      })
    );
  }

  if (pricing.supporterPriceAmount > 0) {
    rows.push(
      makeContentPricingRule(entry, {
        amount: amountToStorage(pricing.supporterPriceAmount),
        currency: pricing.supporterPriceCurrency,
        isEnabled: ['member', 'tip-optional', 'chapter-paid', 'volume-paid'].includes(pricing.mode),
        label: 'Supporter unlock',
        metadata: { mode: pricing.mode },
        ruleType: 'supporter_price'
      })
    );
  }

  pricing.tipAmounts.forEach((amount) => {
    rows.push(
      makeContentPricingRule(entry, {
        amount: amountToStorage(amount),
        currency: pricing.tipCurrency,
        isEnabled: pricing.tipsEnabled,
        label: `Tip ${amountToStorage(amount)} ${pricing.tipCurrency}`,
        metadata: { mode: pricing.mode },
        ruleType: 'tip_amount'
      })
    );
  });

  pricing.chapterBundleDiscounts.forEach((rule) => {
    rows.push(
      makeContentPricingRule(entry, {
        currency: pricing.chapterPriceCurrency,
        discountPercent: Math.round(rule.discountPercent),
        isEnabled: pricing.bundlePurchasesEnabled,
        label: `${rule.minimumChapters} chapters · ${rule.discountPercent}% off`,
        metadata: { mode: pricing.mode },
        minimumChapters: rule.minimumChapters,
        ruleType: 'bundle_discount'
      })
    );
  });

  pricing.creditPacks.forEach((pack) => {
    rows.push(
      makeContentPricingRule(entry, {
        amount: amountToStorage(pack.priceAmount),
        credits: pack.credits,
        currency: pack.priceCurrency,
        isEnabled: true,
        label: pack.label,
        metadata: { mode: pricing.mode },
        ruleType: 'credit_pack'
      })
    );
  });

  return rows;
};

const syncContentPricingRules = async (db, entry) => {
  await db.prepare('DELETE FROM content_pricing_rules WHERE entry_id = ?').bind(entry.id).run();

  const rows = buildContentPricingRuleRows(entry);
  if (!rows.length) return [];

  const insertStatement = db.prepare(
    `INSERT INTO content_pricing_rules (
      entry_id, scope_type, entry_type, series_slug, chapter_slug, rule_type,
      label, amount, currency, credits, discount_percent, minimum_chapters,
      is_enabled, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  );

  await db.batch(
    rows.map((rule) =>
      insertStatement.bind(
        rule.entryId,
        rule.scopeType,
        rule.entryType,
        rule.seriesSlug,
        rule.chapterSlug,
        rule.ruleType,
        rule.label,
        rule.amount,
        rule.currency,
        rule.credits,
        rule.discountPercent,
        rule.minimumChapters,
        rule.isEnabled ? 1 : 0,
        JSON.stringify(normalizeJsonObject(rule.metadata))
      )
    )
  );

  return listContentPricingRules(db, { entryId: entry.id });
};

const listContentPricingRules = async (db, options = {}) => {
  const entryId = normalizePositiveInteger(options.entryId, 0);
  const seriesSlug = cleanSlug(options.seriesSlug, 160);
  const chapterSlug = cleanSlug(options.chapterSlug, 160);
  const entryType = cleanText(options.entryType, 40).toLowerCase().replace(/-/g, '_');
  const ruleType = cleanText(options.ruleType, 80).toLowerCase().replace(/-/g, '_');
  const limit = Math.min(Math.max(normalizePositiveInteger(options.limit, 100), 1), 200);
  const clauses = [];
  const params = [];

  if (entryId) {
    clauses.push('entry_id = ?');
    params.push(entryId);
  }
  if (entryType) {
    clauses.push('entry_type = ?');
    params.push(entryType);
  }
  if (seriesSlug) {
    clauses.push('series_slug = ?');
    params.push(seriesSlug);
  }
  if (chapterSlug) {
    clauses.push('chapter_slug = ?');
    params.push(chapterSlug);
  }
  if (ruleType) {
    clauses.push('rule_type = ?');
    params.push(ruleType);
  }

  const response = await db
    .prepare(
      `SELECT *
       FROM content_pricing_rules
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY entry_id DESC, rule_type ASC, minimum_chapters ASC, amount ASC, id ASC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return (response.results || []).map(contentPricingRuleToJson);
};

const isMissingContentTablesError = (error) => /no such table: (content_|admin_audit_logs)/i.test(error?.message || '');
const isMissingAdminContentSettingsError = (error) => /no such table: admin_content_settings/i.test(error?.message || '');
const isMissingReaderMembershipsError = (error) => /no such table: reader_memberships/i.test(error?.message || '');
const isMissingReaderBookmarksError = (error) => /no such table: reader_bookmarks/i.test(error?.message || '');
const isMissingReaderPasswordCredentialsError = (error) => /no such table: reader_password_credentials/i.test(error?.message || '');
const isMissingReaderTotpCredentialsError = (error) => /no such table: reader_totp_credentials/i.test(error?.message || '');
const isMissingReaderTotpResetAttemptsError = (error) =>
  /no such table: reader_totp_reset_attempts/i.test(error?.message || '');
const isMissingReadingEventsError = (error) => /no such table: reading_events/i.test(error?.message || '');
const isMissingReaderCommentsError = (error) => /no such table: reader_comments/i.test(error?.message || '');
const isMissingProductFeedbackError = (error) => /no such table: product_feedback/i.test(error?.message || '');
const isMissingChapterStatsError = (error) => /no such table: chapter_stats/i.test(error?.message || '');
const isMissingAiInsightsError = (error) => /no such table: ai_insights/i.test(error?.message || '');
const isMissingSignalAutomationTablesError = (error) =>
  /no such table: signal_(sources|collection_runs|candidates)/i.test(error?.message || '');
const isMissingSignalCollectionPhase2Error = (error) =>
  /no such table: signal_collection_tasks|no such column: (?:http_etag|processed_source_count)/i.test(error?.message || '');
const isMissingSignalCandidateTriageError = (error) =>
  /no such table: signal_candidate_reviews|no such column: (?:score_breakdown_json|cluster_key|decision_note|scored_at)/i.test(
    error?.message || ''
  );
const isMissingSignalCandidateDeduplicationError = (error) =>
  /no such table: signal_candidate_occurrences|no such column: title_fingerprint/i.test(error?.message || '');
const isMissingSignalAutomationOperationsError = (error) =>
  /no such table: signal_automation_(?:runtime|alerts)|no such column: last_cron_status/i.test(error?.message || '');
const isMissingSignalModelRolloutError = (error) => /no such table: signal_model_rollout/i.test(error?.message || '');
const readySignalAutomationDatabases = new WeakSet();
const readySignalCollectionPhase2Databases = new WeakSet();
const readySignalCandidateTriageDatabases = new WeakSet();
const readySignalCandidateDeduplicationDatabases = new WeakSet();
const readySignalAutomationOperationsDatabases = new WeakSet();
const readySignalModelRolloutDatabases = new WeakSet();

const ensureContentTablesReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM content_entries LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingContentTablesError(error)) return false;
    throw error;
  }
};

const ensureSignalAutomationTablesReady = async (db) => {
  if (readySignalAutomationDatabases.has(db)) return true;
  try {
    await db.prepare('SELECT id FROM signal_sources LIMIT 1').first();
    await db.prepare('SELECT id FROM signal_collection_runs LIMIT 1').first();
    await db.prepare('SELECT id FROM signal_candidates LIMIT 1').first();
    readySignalAutomationDatabases.add(db);
    return true;
  } catch (error) {
    if (isMissingSignalAutomationTablesError(error)) return false;
    throw error;
  }
};

const ensureSignalCollectionPhase2Ready = async (db) => {
  if (readySignalCollectionPhase2Databases.has(db)) return true;
  try {
    await db.prepare('SELECT http_etag FROM signal_sources LIMIT 1').first();
    await db.prepare('SELECT processed_source_count FROM signal_collection_runs LIMIT 1').first();
    await db.prepare('SELECT id FROM signal_collection_tasks LIMIT 1').first();
    readySignalCollectionPhase2Databases.add(db);
    return true;
  } catch (error) {
    if (isMissingSignalAutomationTablesError(error) || isMissingSignalCollectionPhase2Error(error)) return false;
    throw error;
  }
};

const ensureSignalCandidateTriageReady = async (db) => {
  if (readySignalCandidateTriageDatabases.has(db)) return true;
  try {
    await db
      .prepare('SELECT score_breakdown_json, cluster_key, decision_note, scored_at FROM signal_candidates LIMIT 1')
      .first();
    await db.prepare('SELECT id FROM signal_candidate_reviews LIMIT 1').first();
    readySignalCandidateTriageDatabases.add(db);
    return true;
  } catch (error) {
    if (
      isMissingSignalAutomationTablesError(error) ||
      isMissingSignalCollectionPhase2Error(error) ||
      isMissingSignalCandidateTriageError(error)
    ) {
      return false;
    }
    throw error;
  }
};

const ensureSignalCandidateDeduplicationReady = async (db) => {
  if (readySignalCandidateDeduplicationDatabases.has(db)) return true;
  if (!(await ensureSignalCandidateTriageReady(db))) return false;
  try {
    await db.prepare('SELECT title_fingerprint FROM signal_candidates LIMIT 1').first();
    await db.prepare('SELECT id FROM signal_candidate_occurrences LIMIT 1').first();
    readySignalCandidateDeduplicationDatabases.add(db);
    return true;
  } catch (error) {
    if (
      isMissingSignalAutomationTablesError(error) ||
      isMissingSignalCandidateTriageError(error) ||
      isMissingSignalCandidateDeduplicationError(error)
    ) {
      return false;
    }
    throw error;
  }
};

const ensureSignalAutomationOperationsReady = async (db) => {
  if (readySignalAutomationOperationsDatabases.has(db)) return true;
  if (!(await ensureSignalCollectionPhase2Ready(db))) return false;
  try {
    await db
      .prepare('SELECT last_cron_status, consecutive_failures FROM signal_automation_runtime LIMIT 1')
      .first();
    await db.prepare('SELECT id FROM signal_automation_alerts LIMIT 1').first();
    readySignalAutomationOperationsDatabases.add(db);
    return true;
  } catch (error) {
    if (
      isMissingSignalAutomationTablesError(error) ||
      isMissingSignalCollectionPhase2Error(error) ||
      isMissingSignalAutomationOperationsError(error)
    ) {
      return false;
    }
    throw error;
  }
};

const ensureSignalModelRolloutReady = async (db) => {
  if (readySignalModelRolloutDatabases.has(db)) return true;
  try {
    await db.prepare('SELECT id FROM signal_model_rollout LIMIT 1').first();
    readySignalModelRolloutDatabases.add(db);
    return true;
  } catch (error) {
    if (isMissingSignalModelRolloutError(error)) return false;
    throw error;
  }
};

const ensureAdminAuditLogsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM admin_audit_logs LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingContentTablesError(error)) return false;
    throw error;
  }
};

const ensureAdminContentSettingsReady = async (db) => {
  try {
    await db.prepare('SELECT setting_key FROM admin_content_settings LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingAdminContentSettingsError(error)) return false;
    throw error;
  }
};

const ensureReaderMembershipsReady = async (db) => {
  try {
    await db.prepare('SELECT account_id FROM reader_memberships LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingReaderMembershipsError(error)) return false;
    throw error;
  }
};

const ensureReaderBookmarksReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM reader_bookmarks LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingReaderBookmarksError(error)) return false;
    throw error;
  }
};

const ensureReadingEventsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM reading_events LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingReadingEventsError(error)) return false;
    throw error;
  }
};

const ensureReaderCommentsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM reader_comments LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingReaderCommentsError(error)) return false;
    throw error;
  }
};

const ensureProductFeedbackReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM product_feedback LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingProductFeedbackError(error)) return false;
    throw error;
  }
};

const ensureChapterStatsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM chapter_stats LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingChapterStatsError(error)) return false;
    throw error;
  }
};

const ensureAiInsightsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM ai_insights LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingAiInsightsError(error)) return false;
    throw error;
  }
};

const ensureReaderPasswordCredentialsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM reader_password_credentials LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingReaderPasswordCredentialsError(error)) return false;
    throw error;
  }
};

const ensureReaderTotpCredentialsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM reader_totp_credentials LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingReaderTotpCredentialsError(error)) return false;
    throw error;
  }
};

const ensureReaderTotpResetAttemptsReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM reader_totp_reset_attempts LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingReaderTotpResetAttemptsError(error)) return false;
    throw error;
  }
};

const splitEnvList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeAccessTeamDomain = (value) => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.includes('.')) return `https://${trimmed}`.toLowerCase();
  return `https://${trimmed}.cloudflareaccess.com`.toLowerCase();
};

const getAdminAccessConfig = (env) => {
  const teamDomain = normalizeAccessTeamDomain(
    env.CF_ACCESS_TEAM_DOMAIN || env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || ''
  );
  const audiences = splitEnvList(env.CF_ACCESS_AUD || env.CLOUDFLARE_ACCESS_AUD || '');
  const allowedEmails = new Set(
    splitEnvList(env.ADMIN_ALLOWED_EMAILS || defaultAdminEmail).map((email) => email.toLowerCase())
  );

  return {
    allowedEmails,
    audiences,
    isConfigured: Boolean(teamDomain && audiences.length && allowedEmails.size),
    teamDomain
  };
};

const getAccessToken = (request) => {
  const headerToken = request.headers.get('Cf-Access-Jwt-Assertion');
  if (headerToken) return headerToken.trim();

  const cookieHeader = request.headers.get('Cookie') || '';
  const cookieToken = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('CF_Authorization='));

  return cookieToken ? decodeURIComponent(cookieToken.split('=').slice(1).join('=')) : '';
};

const decodeBase64Url = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const decodeJwtPart = (part) => JSON.parse(new TextDecoder().decode(decodeBase64Url(part)));

const payloadHasAudience = (payloadAudience, expectedAudience) => {
  if (Array.isArray(payloadAudience)) return payloadAudience.includes(expectedAudience);
  return payloadAudience === expectedAudience;
};

const getAccessJwk = async (teamDomain, kid) => {
  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
    cf: { cacheEverything: true, cacheTtl: 3600 }
  });

  if (!response.ok) {
    throw new Error('Unable to load Cloudflare Access certificates');
  }

  const jwks = await response.json();
  const jwk = jwks.keys?.find((key) => key.kid === kid);
  if (!jwk) throw new Error('Cloudflare Access signing key not found');
  return jwk;
};

const verifyAccessJwt = async (token, config) => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported JWT header');
  }

  if (!config.audiences.some((audience) => payloadHasAudience(payload.aud, audience))) {
    throw new Error('Invalid JWT audience');
  }

  if (normalizeAccessTeamDomain(payload.iss || '') !== config.teamDomain) {
    throw new Error('Invalid JWT issuer');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new Error('JWT expired');
  }

  if (Number.isFinite(payload.nbf) && payload.nbf > now + 60) {
    throw new Error('JWT not active yet');
  }

  const jwk = await getAccessJwk(config.teamDomain, header.kid);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );

  if (!valid) throw new Error('Invalid JWT signature');
  return payload;
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const scriptJson = (value) =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return char;
    }
  });

const withPrivateHeaders = (response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
};

const denyAdminAccess = (status, message) =>
  new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex, nofollow">
    <title>Admin Access</title>
  </head>
  <body>
    <main>
      <h1>Admin access protected</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`,
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow, noarchive'
      }
    }
  );

const enforceAdminAccess = async (request, env) => {
  if (isLocalHostnameRequest(request) || hasLocalAdminBypass(env)) return null;

  const config = getAdminAccessConfig(env);
  if (!config.isConfigured) {
    return denyAdminAccess(
      503,
      'Admin access is locked until Cloudflare Access environment variables are configured.'
    );
  }

  const token = getAccessToken(request);
  if (!token) {
    return denyAdminAccess(401, 'Cloudflare Access sign-in is required for this admin route.');
  }

  try {
    const payload = await verifyAccessJwt(token, config);
    const email = normalizeEmail(payload.email);
    if (!email || !config.allowedEmails.has(email)) {
      return denyAdminAccess(403, 'This email is not allowed to open the admin route.');
    }
  } catch (error) {
    console.error('admin_access_denied', { message: error?.message });
    return denyAdminAccess(401, 'Cloudflare Access token is invalid or expired.');
  }

  return null;
};

const getSetting = (db, product, platform) =>
  db
    .prepare(
      `SELECT product, platform, public_link, capacity, distributed_count, is_active, updated_at
       FROM waitlist_settings
       WHERE product = ? AND platform = ?`
    )
    .bind(product, platform)
    .first();

const ensureSetting = async (db, product, platform) => {
  await db
    .prepare(`INSERT OR IGNORE INTO waitlist_settings (product, platform) VALUES (?, ?)`)
    .bind(product, platform)
    .run();
  return getSetting(db, product, platform);
};

const upsertEntry = async (db, data, request) => {
  const userAgent = cleanText(request.headers.get('user-agent'), 300);
  await db
    .prepare(
      `INSERT INTO waitlist_entries (
        product, platform, locale, email, normalized_email, source, landing_path,
        utm_source, utm_medium, utm_campaign, utm_content, user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product, platform, normalized_email) DO UPDATE SET
        email = excluded.email,
        locale = excluded.locale,
        source = excluded.source,
        landing_path = excluded.landing_path,
        utm_source = excluded.utm_source,
        utm_medium = excluded.utm_medium,
        utm_campaign = excluded.utm_campaign,
        utm_content = excluded.utm_content,
        user_agent = excluded.user_agent,
        updated_at = CURRENT_TIMESTAMP`
    )
    .bind(
      data.product,
      data.platform,
      data.locale,
      data.email,
      data.normalizedEmail,
      data.source,
      data.landingPath,
      data.utmSource,
      data.utmMedium,
      data.utmCampaign,
      data.utmContent,
      userAgent
    )
    .run();

  return db
    .prepare(
      `SELECT id, invite_status, invite_url
       FROM waitlist_entries
       WHERE product = ? AND platform = ? AND normalized_email = ?`
    )
    .bind(data.product, data.platform, data.normalizedEmail)
    .first();
};

const handleWaitlistSubmit = async (request, env) => {
  if (!env.WAITLIST_DB) {
    return json({ ok: false, message: 'Waitlist database is not configured.' }, { status: 500 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(payload.email);
  if (!isEmail(normalizedEmail)) {
    return json({ ok: false, message: 'Please enter a valid email address.' }, { status: 400 });
  }

  const data = {
    product: cleanText(payload.product || 'snapcopy', 80) || 'snapcopy',
    platform: cleanPlatform(payload.platform),
    locale: cleanText(payload.locale, 20),
    email: cleanText(payload.email, 254),
    normalizedEmail,
    source: cleanText(payload.source, 120),
    landingPath: cleanText(payload.landing_path, 300),
    utmSource: cleanText(payload.utm_source, 120),
    utmMedium: cleanText(payload.utm_medium, 120),
    utmCampaign: cleanText(payload.utm_campaign, 120),
    utmContent: cleanText(payload.utm_content, 120)
  };

  const db = env.WAITLIST_DB;
  await ensureSetting(db, data.product, data.platform);
  const entry = await upsertEntry(db, data, request);
  const setting = await getSetting(db, data.product, data.platform);

  if (entry?.invite_status === 'delivered' && entry.invite_url) {
    return json({
      ok: true,
      status: 'invite',
      message: 'You are already on the test list. Here is your invite link again.',
      publicLink: entry.invite_url,
      capacity: setting?.capacity ?? 0,
      distributedCount: setting?.distributed_count ?? 0
    });
  }

  const canDistribute =
    setting &&
    Number(setting.is_active) === 1 &&
    String(setting.public_link || '').startsWith('https://testflight.apple.com/join/') &&
    Number(setting.capacity) > 0 &&
    data.platform === 'ios';

  if (canDistribute) {
    const allocation = await db
      .prepare(
        `UPDATE waitlist_settings
         SET distributed_count = distributed_count + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE product = ?
           AND platform = ?
           AND is_active = 1
           AND public_link <> ''
           AND distributed_count < capacity
         RETURNING public_link, capacity, distributed_count`
      )
      .bind(data.product, data.platform)
      .first();

    if (allocation?.public_link) {
      await db
        .prepare(
          `UPDATE waitlist_entries
           SET invite_status = 'delivered',
               invite_url = ?,
               invite_delivered_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(allocation.public_link, entry.id)
        .run();

      return json({
        ok: true,
        status: 'invite',
        message: 'Your test slot is ready. Open the TestFlight link below.',
        publicLink: allocation.public_link,
        capacity: allocation.capacity,
        distributedCount: allocation.distributed_count
      });
    }
  }

  return json({
    ok: true,
    status: 'waitlisted',
    message:
      data.platform === 'ios'
        ? 'Your test request was received. The current TestFlight round is full or not open yet.'
        : 'You are on the Android updates list.',
    capacity: setting?.capacity ?? 0,
    distributedCount: setting?.distributed_count ?? 0
  });
};

const handleGetSettings = async (env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Waitlist database is not configured.' }, { status: 500 });

  await ensureSetting(db, 'snapcopy', 'ios');
  await ensureSetting(db, 'snapcopy', 'android');

  const settings = await db
    .prepare(
      `SELECT product, platform, public_link, capacity, distributed_count, is_active, updated_at
       FROM waitlist_settings
       WHERE product = 'snapcopy'
       ORDER BY platform DESC`
    )
    .all();

  const counts = await db
    .prepare(
      `SELECT platform,
              COUNT(*) AS total,
              SUM(CASE WHEN invite_status = 'delivered' THEN 1 ELSE 0 END) AS delivered
       FROM waitlist_entries
       WHERE product = 'snapcopy'
       GROUP BY platform`
    )
    .all();

  return json({ ok: true, settings: settings.results || [], counts: counts.results || [] });
};

const handleUpdateSettings = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Waitlist database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const platform = cleanPlatform(payload.platform);
  const publicLink = cleanText(payload.publicLink, 500);
  const capacity = Math.max(0, Math.min(10000, Number.parseInt(payload.capacity, 10) || 0));
  const isActive = payload.isActive ? 1 : 0;
  const resetCount = Boolean(payload.resetCount);

  if (platform === 'ios' && publicLink && !publicLink.startsWith('https://testflight.apple.com/join/')) {
    return json({ ok: false, message: 'TestFlight link must start with https://testflight.apple.com/join/' }, { status: 400 });
  }

  await ensureSetting(db, 'snapcopy', platform);

  if (resetCount) {
    await db
      .prepare(
        `UPDATE waitlist_settings
         SET public_link = ?, capacity = ?, distributed_count = 0, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE product = 'snapcopy' AND platform = ?`
      )
      .bind(publicLink, capacity, isActive, platform)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE waitlist_settings
         SET public_link = ?, capacity = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE product = 'snapcopy' AND platform = ?`
      )
      .bind(publicLink, capacity, isActive, platform)
      .run();
  }

  return handleGetSettings(env);
};

const upsertReaderAccount = async (db, email, normalizedEmail) =>
  db
    .prepare(
      `INSERT INTO reader_accounts (email, normalized_email)
       VALUES (?, ?)
       ON CONFLICT(normalized_email) DO UPDATE SET
         email = excluded.email,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, email, normalized_email, status, created_at`
    )
    .bind(email, normalizedEmail)
    .first();

const sendReaderLoginEmail = async (env, email, loginUrl) => {
  const configured = Boolean(env.EMAIL && typeof env.EMAIL.send === 'function');
  if (!configured) {
    return { configured: false, sent: false };
  }

  const fromEmail = env.READER_EMAIL_FROM || 'noreply@wwwstationcat.org';
  const fromName = env.READER_EMAIL_FROM_NAME || 'Station Cat';
  const subject = '登入 Station Cat 會員中心';
  const text = [
    '請使用下面的安全連結登入 Station Cat 會員中心：',
    '',
    loginUrl,
    '',
    '這個連結會在 15 分鐘後失效。如果不是你本人操作，可以忽略這封信。'
  ].join('\n');
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
      <h1 style="font-size: 20px;">登入 Station Cat 會員中心</h1>
      <p>請使用下面的安全連結登入你的會員中心：</p>
      <p><a href="${loginUrl}" style="display: inline-block; background: #2e5b4e; color: #fffaf1; padding: 12px 16px; border-radius: 8px; text-decoration: none;">登入會員中心</a></p>
      <p style="color: #6b7280;">這個連結會在 15 分鐘後失效。如果不是你本人操作，可以忽略這封信。</p>
    </div>
  `;

  try {
    await env.EMAIL.send({
      to: email,
      from: { email: fromEmail, name: fromName },
      subject,
      text,
      html
    });
    return { configured: true, sent: true };
  } catch (error) {
    console.error('reader_login_email_failed', {
      code: error?.code,
      message: error?.message
    });
    return { configured: true, sent: false, error: error?.message || 'Email delivery failed.' };
  }
};

const sendReaderPasswordResetEmail = async (env, email, resetUrl) => {
  const configured = Boolean(env.EMAIL && typeof env.EMAIL.send === 'function');
  if (!configured) {
    return { configured: false, sent: false };
  }

  const fromEmail = env.READER_EMAIL_FROM || 'noreply@wwwstationcat.org';
  const fromName = env.READER_EMAIL_FROM_NAME || 'Station Cat';
  const subject = '重置 Station Cat 會員密碼';
  const text = [
    '請使用下面的安全連結重置你的 Station Cat 會員密碼：',
    '',
    resetUrl,
    '',
    '這個連結會在 30 分鐘後失效。如果不是你本人操作，可以忽略這封信。'
  ].join('\n');
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
      <h1 style="font-size: 20px;">重置 Station Cat 會員密碼</h1>
      <p>請使用下面的安全連結設定新的會員密碼：</p>
      <p><a href="${resetUrl}" style="display: inline-block; background: #2e5b4e; color: #fffaf1; padding: 12px 16px; border-radius: 8px; text-decoration: none;">重置密碼</a></p>
      <p style="color: #6b7280;">這個連結會在 30 分鐘後失效。如果不是你本人操作，可以忽略這封信。</p>
    </div>
  `;

  try {
    await env.EMAIL.send({
      to: email,
      from: { email: fromEmail, name: fromName },
      subject,
      text,
      html
    });
    return { configured: true, sent: true };
  } catch (error) {
    console.error('reader_password_reset_email_failed', {
      code: error?.code,
      message: error?.message
    });
    return { configured: true, sent: false, error: error?.message || 'Email delivery failed.' };
  }
};

const readerAccountAuthJson = (account) => ({
  id: account.account_id || account.id,
  email: account.email,
  normalizedEmail: account.normalized_email,
  username: account.username || '',
  displayName: account.display_name || account.username || account.email,
  createdAt: account.account_created_at || account.created_at
});

const createReaderSession = async (db, accountId, request) => {
  const sessionToken = randomToken();
  const sessionHash = await sha256Hex(sessionToken);
  const userAgent = cleanText(request.headers.get('user-agent'), 300);

  await db.batch([
    db
      .prepare(
        `UPDATE reader_accounts
         SET last_login_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(accountId),
    db
      .prepare(
        `INSERT INTO reader_sessions (account_id, session_hash, expires_at, user_agent)
         VALUES (?, ?, datetime('now', '+30 days'), ?)`
      )
      .bind(accountId, sessionHash, userAgent)
  ]);

  return sessionToken;
};

const getReaderTotpCredential = async (db, accountId) =>
  db
    .prepare(
      `SELECT *
       FROM reader_totp_credentials
       WHERE account_id = ?
       LIMIT 1`
    )
    .bind(accountId)
    .first();

const isReaderTotpEnabled = (credential) => Boolean(credential?.enabled_at && !credential?.disabled_at);

const consumeReaderTotpStep = async (db, accountId, step) => {
  const result = await db
    .prepare(
      `UPDATE reader_totp_credentials
       SET last_used_step = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ?
         AND enabled_at IS NOT NULL
         AND disabled_at IS NULL
         AND (last_used_step IS NULL OR last_used_step < ?)`
    )
    .bind(step, accountId, step)
    .run();
  return getD1ChangeCount(result) > 0;
};

const verifyAndConsumeReaderTotpCode = async (db, accountId, code, options = {}) => {
  const credential = await getReaderTotpCredential(db, accountId);
  if (!isReaderTotpEnabled(credential)) {
    return {
      ok: false,
      status: options.unboundStatus || 409,
      message: options.unboundMessage || '这个账号还没有绑定二步验证器。'
    };
  }

  const verification = await verifyTotpCode(credential.secret_base32, code, {
    lastUsedStep: credential.last_used_step
  });
  if (!verification.ok) {
    return {
      ok: false,
      status: options.invalidStatus || 401,
      message: options.invalidMessage || '二步验证码不正确或已过期。',
      reason: verification.reason
    };
  }

  const consumed = await consumeReaderTotpStep(db, accountId, verification.step);
  if (!consumed) {
    return {
      ok: false,
      status: options.reusedStatus || 409,
      message: options.reusedMessage || '二步验证码已使用，请等待下一组验证码。',
      reason: 'concurrent-reuse'
    };
  }

  return { ok: true, step: verification.step };
};

const normalizeReaderResetIdentifier = (identifier) => {
  const email = normalizeEmail(identifier);
  return isEmail(email) ? email : normalizeUsername(identifier);
};

const getReaderTotpResetIdentifierHash = async (normalizedIdentifier, env = {}) => {
  if (!normalizedIdentifier) return '';
  const secret = String(env?.READER_TOTP_RESET_KEY_SECRET || '').trim();
  return secret ? hmacSha256Hex(normalizedIdentifier, secret) : sha256Hex(normalizedIdentifier);
};

const getReaderTotpResetLimitKeys = ({ identifierHash, ipHash, ipUaHash, accountId }) => {
  const keys = [];
  if (identifierHash && ipHash) {
    keys.push({ scope: 'identifier_ip', key: `${identifierHash}:${ipHash}` });
  }
  if (ipHash) keys.push({ scope: 'ip', key: ipHash });
  if (ipUaHash) keys.push({ scope: 'ip_ua', key: ipUaHash });
  if (accountId) keys.push({ scope: 'account', key: String(accountId) });
  return keys;
};

const shouldSampleReaderTotpResetCleanup = (limitKeys, nowEpoch = Math.floor(Date.now() / 1000)) => {
  const primaryKey = limitKeys.find((limitKey) => limitKey.scope === 'identifier_ip')?.key || limitKeys[0]?.key;
  if (!primaryKey) return false;
  const cleanupWindow = Math.floor(nowEpoch / 3600);
  let hash = 2166136261;
  for (const char of `${primaryKey}:${cleanupWindow}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100 === 0;
};

const cleanupReaderTotpResetAttempts = async (db) =>
  db
    .prepare(
      `DELETE FROM reader_totp_reset_attempts
       WHERE id IN (
         SELECT id
         FROM reader_totp_reset_attempts
         WHERE updated_at < datetime('now', '-14 days')
         ORDER BY updated_at
         LIMIT 200
       )`
    )
    .run();

const reserveReaderTotpResetAttempt = async (
  db,
  limitKeys,
  nowEpoch = Math.floor(Date.now() / 1000),
  options = {}
) => {
  if (options.cleanup === true || shouldSampleReaderTotpResetCleanup(limitKeys, nowEpoch)) {
    await cleanupReaderTotpResetAttempts(db);
  }

  let retryAfterSeconds = 0;
  for (const limitKey of limitKeys) {
    await db
      .prepare(
        `INSERT INTO reader_totp_reset_attempts (
          scope, scope_key, failure_count, locked_until_epoch, last_failed_epoch, updated_at
        )
        VALUES (?, ?, 1, 0, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(scope, scope_key) DO UPDATE SET
          failure_count = reader_totp_reset_attempts.failure_count + 1,
          last_failed_epoch = excluded.last_failed_epoch,
          updated_at = CURRENT_TIMESTAMP`
      )
      .bind(limitKey.scope, limitKey.key, nowEpoch)
      .run();

    const attempt = await db
      .prepare(
        `SELECT failure_count, locked_until_epoch
         FROM reader_totp_reset_attempts
         WHERE scope = ? AND scope_key = ?
         LIMIT 1`
      )
      .bind(limitKey.scope, limitKey.key)
      .first();
    const failureCount = Number(attempt?.failure_count || 0);
    const lockedUntil = Number(attempt?.locked_until_epoch || 0);
    if (lockedUntil > nowEpoch) {
      retryAfterSeconds = Math.max(retryAfterSeconds, lockedUntil - nowEpoch);
      continue;
    }
    if (failureCount <= readerTotpResetFailureThreshold) continue;

    const lockSeconds =
      Math.min(
        readerTotpResetMaxLockSeconds,
        readerTotpResetBaseLockSeconds *
          2 ** Math.min(failureCount - readerTotpResetFailureThreshold - 1, 4)
      );
    const nextLockedUntil = nowEpoch + lockSeconds;
    await db
      .prepare(
        `UPDATE reader_totp_reset_attempts
         SET locked_until_epoch = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE scope = ? AND scope_key = ?
           AND locked_until_epoch < ?`
      )
      .bind(nextLockedUntil, limitKey.scope, limitKey.key, nextLockedUntil)
      .run();
    retryAfterSeconds = Math.max(retryAfterSeconds, lockSeconds);
  }

  if (retryAfterSeconds > 0) {
    return { ok: false, retryAfterSeconds };
  }
  return { ok: true, retryAfterSeconds: 0 };
};

const clearReaderTotpResetFailures = async (db, limitKeys) => {
  if (!limitKeys.length) return;
  await db.batch(
    limitKeys.map((limitKey) =>
      db
        .prepare(
          `DELETE FROM reader_totp_reset_attempts
           WHERE scope = ? AND scope_key = ?`
        )
        .bind(limitKey.scope, limitKey.key)
    )
  );
};

const readerTotpResetRateLimitResponse = (retryAfterSeconds) =>
  privateJson(
    { ok: false, message: readerTotpResetLockedMessage },
    {
      status: 429,
      headers: {
        'retry-after': String(Math.max(1, retryAfterSeconds || readerTotpResetBaseLockSeconds))
      }
    }
  );

const normalizeReaderRegisterPayload = (payload) => {
  const username = cleanText(payload.username, 40);
  const normalizedUsername = normalizeUsername(username);
  const email = cleanText(payload.email, 254);
  const normalizedEmail = normalizeEmail(email);
  const password = String(payload.password || '');
  const confirmPassword = String(payload.confirmPassword || payload.passwordConfirm || '');

  if (!isValidReaderUsername(username)) {
    throw new Error('用户名需要 3-32 个字符，只能使用文字、数字、下划线或横线。');
  }
  if (!isEmail(normalizedEmail)) {
    throw new Error('请输入有效的 Email。');
  }
  if (!isValidReaderPassword(password)) {
    throw new Error('密码需要 8-128 个字符。');
  }
  if (confirmPassword && confirmPassword !== password) {
    throw new Error('两次输入的密码不一致。');
  }

  return {
    email,
    normalizedEmail,
    normalizedUsername,
    password,
    username
  };
};

const handleReaderRegister = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  if (!(await ensureReaderPasswordCredentialsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_PASSWORD_AUTH_NOT_READY',
        message: '会员注册数据表尚未初始化，请先应用 0011_reader_password_credentials.sql。'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  let data;
  try {
    data = normalizeReaderRegisterPayload(payload);
  } catch (error) {
    return privateJson({ ok: false, message: error.message }, { status: 400 });
  }

  const existingUsername = await db
    .prepare(
      `SELECT account_id
       FROM reader_password_credentials
       WHERE normalized_username = ?
       LIMIT 1`
    )
    .bind(data.normalizedUsername)
    .first();
  if (existingUsername) {
    return privateJson({ ok: false, code: 'USERNAME_TAKEN', message: '这个用户名已经被使用。' }, { status: 409 });
  }

  const existingAccount = await db
    .prepare(
      `SELECT id, email, normalized_email, display_name, status, created_at
       FROM reader_accounts
       WHERE normalized_email = ?
       LIMIT 1`
    )
    .bind(data.normalizedEmail)
    .first();

  if (existingAccount?.status && existingAccount.status !== 'active') {
    return privateJson({ ok: false, message: '这个账号当前不可登录。' }, { status: 403 });
  }

  if (existingAccount) {
    const existingCredential = await db
      .prepare(
        `SELECT id
         FROM reader_password_credentials
         WHERE account_id = ?
         LIMIT 1`
      )
      .bind(existingAccount.id)
      .first();
    if (existingCredential) {
      return privateJson({ ok: false, code: 'EMAIL_TAKEN', message: '这个 Email 已经注册，请直接登录。' }, { status: 409 });
    }
  }

  const account = existingAccount || (await upsertReaderAccount(db, data.email, data.normalizedEmail));
  const salt = randomHex();
  const passwordHash = await hashReaderPassword(data.password, salt, readerPasswordIterations);

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE reader_accounts
           SET email = ?,
               display_name = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(data.email, data.username, account.id),
      db
        .prepare(
          `INSERT INTO reader_password_credentials (
            account_id, username, normalized_username, password_hash, password_salt,
            password_iterations, password_algorithm
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          account.id,
          data.username,
          data.normalizedUsername,
          passwordHash,
          salt,
          readerPasswordIterations,
          readerPasswordAlgorithm
        )
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error?.message || '')) {
      return privateJson({ ok: false, message: '这个用户名或 Email 已经注册。' }, { status: 409 });
    }
    throw error;
  }

  const sessionToken = await createReaderSession(db, account.id, request);
  return privateJson(
    {
      ok: true,
      authenticated: true,
      message: '注册成功，已登入会员中心。',
      account: readerAccountAuthJson({
        ...account,
        display_name: data.username,
        username: data.username
      })
    },
    {
      headers: {
        'set-cookie': makeCookie(readerSessionCookieName, sessionToken, request)
      }
    }
  );
};

const handleReaderLogin = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  if (!(await ensureReaderPasswordCredentialsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_PASSWORD_AUTH_NOT_READY',
        message: '会员登录数据表尚未初始化，请先应用 0011_reader_password_credentials.sql。'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const identifier = cleanText(payload.identifier || payload.email || payload.username, 254);
  const password = String(payload.password || '');
  if (!identifier || !password) {
    return privateJson({ ok: false, message: '请输入用户名 / Email 和密码。' }, { status: 400 });
  }

  const credential = isEmail(normalizeEmail(identifier))
    ? await db
        .prepare(
          `SELECT
            reader_accounts.id,
            reader_accounts.email,
            reader_accounts.normalized_email,
            reader_accounts.display_name,
            reader_accounts.status,
            reader_accounts.created_at,
            reader_password_credentials.username,
            reader_password_credentials.password_hash,
            reader_password_credentials.password_salt,
            reader_password_credentials.password_iterations,
            reader_password_credentials.password_algorithm
           FROM reader_accounts
           INNER JOIN reader_password_credentials
             ON reader_password_credentials.account_id = reader_accounts.id
           WHERE reader_accounts.normalized_email = ?
             AND reader_accounts.status = 'active'
           LIMIT 1`
        )
        .bind(normalizeEmail(identifier))
        .first()
    : await db
        .prepare(
          `SELECT
            reader_accounts.id,
            reader_accounts.email,
            reader_accounts.normalized_email,
            reader_accounts.display_name,
            reader_accounts.status,
            reader_accounts.created_at,
            reader_password_credentials.username,
            reader_password_credentials.password_hash,
            reader_password_credentials.password_salt,
            reader_password_credentials.password_iterations,
            reader_password_credentials.password_algorithm
           FROM reader_password_credentials
           INNER JOIN reader_accounts
             ON reader_accounts.id = reader_password_credentials.account_id
           WHERE reader_password_credentials.normalized_username = ?
             AND reader_accounts.status = 'active'
           LIMIT 1`
        )
        .bind(normalizeUsername(identifier))
        .first();

  if (!credential || credential.password_algorithm !== readerPasswordAlgorithm) {
    return privateJson({ ok: false, message: '用户名或密码不正确。' }, { status: 401 });
  }

  const passwordHash = await hashReaderPassword(
    password,
    credential.password_salt,
    Number(credential.password_iterations || readerPasswordIterations)
  );
  if (!timingSafeEqualString(passwordHash, credential.password_hash)) {
    return privateJson({ ok: false, message: '用户名或密码不正确。' }, { status: 401 });
  }

  const sessionToken = await createReaderSession(db, credential.id, request);
  return privateJson(
    {
      ok: true,
      authenticated: true,
      message: '登录成功。',
      account: readerAccountAuthJson(credential)
    },
    {
      headers: {
        'set-cookie': makeCookie(readerSessionCookieName, sessionToken, request)
      }
    }
  );
};

const handleReaderTotpStatus = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) return privateJson({ ok: true, authenticated: false });

  if (!(await ensureReaderTotpCredentialsReady(db))) {
    return privateJson({
      ok: true,
      authenticated: true,
      setupRequired: true,
      message: '二步验证数据表尚未初始化。',
      totp: { enabled: false, verifiedAt: '', enabledAt: '' }
    });
  }

  const credential = await getReaderTotpCredential(db, session.account_id);
  return privateJson({
    ok: true,
    authenticated: true,
    totp: readerTotpAuthJson(credential)
  });
};

const handleReaderTotpSetup = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return privateJson({ ok: false, message: '请先登入会员中心。' }, { status: 401 });
  }

  if (!(await ensureReaderTotpCredentialsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_TOTP_NOT_READY',
        message: '二步验证数据表尚未初始化，请先应用 0012_reader_totp_credentials.sql。'
      },
      { status: 503 }
    );
  }

  const existing = await getReaderTotpCredential(db, session.account_id);
  if (isReaderTotpEnabled(existing)) {
    return privateJson({
      ok: true,
      message: '这个账号已经绑定二步验证器。',
      totp: readerTotpAuthJson(existing)
    });
  }

  const secretBase32 = randomTotpSecretBase32();
  const label = session.email || session.username || `reader-${session.account_id}`;
  await db
    .prepare(
      `INSERT INTO reader_totp_credentials (
        account_id, secret_base32, issuer, label, verified_at, enabled_at, disabled_at, last_used_step
      )
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL)
      ON CONFLICT(account_id) DO UPDATE SET
        secret_base32 = excluded.secret_base32,
        issuer = excluded.issuer,
        label = excluded.label,
        verified_at = NULL,
        enabled_at = NULL,
        disabled_at = NULL,
        last_used_step = NULL,
        updated_at = CURRENT_TIMESTAMP`
    )
    .bind(session.account_id, secretBase32, readerTotpIssuer, label)
    .run();

  return privateJson({
    ok: true,
    message: '请在 Google Authenticator 中添加密钥，然后输入 6 位验证码完成绑定。',
    setup: {
      issuer: readerTotpIssuer,
      label,
      secretBase32,
      otpauthUrl: makeTotpOtpAuthUrl(session, secretBase32),
      periodSeconds: readerTotpPeriodSeconds,
      digits: readerTotpDigits
    },
    totp: { enabled: false, verifiedAt: '', enabledAt: '' }
  });
};

const handleReaderTotpConfirm = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return privateJson({ ok: false, message: '请先登入会员中心。' }, { status: 401 });
  }

  if (!(await ensureReaderTotpCredentialsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_TOTP_NOT_READY',
        message: '二步验证数据表尚未初始化，请先应用 0012_reader_totp_credentials.sql。'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const code = normalizeTotpCode(payload.code || payload.totpCode);
  const credential = await getReaderTotpCredential(db, session.account_id);
  if (!credential) {
    return privateJson({ ok: false, message: '请先生成二步验证密钥。' }, { status: 400 });
  }
  if (isReaderTotpEnabled(credential)) {
    return privateJson({
      ok: true,
      message: '二步验证器已经启用。',
      totp: readerTotpAuthJson(credential)
    });
  }

  const verification = await verifyTotpCode(credential.secret_base32, code);
  if (!verification.ok) {
    return privateJson({ ok: false, message: '二步验证码不正确或已过期。' }, { status: 401 });
  }

  await db
    .prepare(
      `UPDATE reader_totp_credentials
       SET verified_at = CURRENT_TIMESTAMP,
           enabled_at = CURRENT_TIMESTAMP,
           disabled_at = NULL,
           last_used_step = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ?`
    )
    .bind(session.account_id)
    .run();

  const updated = await getReaderTotpCredential(db, session.account_id);
  return privateJson({
    ok: true,
    message: '二步验证器已绑定。之后重置或修改密码时可以使用 6 位验证码。',
    totp: readerTotpAuthJson(updated)
  });
};

const handleReaderPasswordResetRequest = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  if (!(await ensureReaderPasswordCredentialsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_PASSWORD_AUTH_NOT_READY',
        message: '会员密码数据表尚未初始化。'
      },
      { status: 503 }
    );
  }

  return privateJson(
    {
      ok: false,
      code: 'EMAIL_PASSWORD_RESET_DISABLED',
      message: '密码重置已改用二步验证码。请使用用户名或 Email、6 位验证码和新密码完成重置。'
    },
    { status: 410 }
  );
};

const handleReaderPasswordResetConfirm = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  if (!(await ensureReaderPasswordCredentialsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_PASSWORD_AUTH_NOT_READY',
        message: '会员密码数据表尚未初始化。'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const rawToken = cleanText(payload.token, 300);
  const password = String(payload.password || '');
  const confirmPassword = String(payload.confirmPassword || payload.passwordConfirm || '');
  if (!isValidReaderPassword(password)) {
    return privateJson({ ok: false, message: '新密码需要 8-128 个字符。' }, { status: 400 });
  }
  if (confirmPassword && confirmPassword !== password) {
    return privateJson({ ok: false, message: '两次输入的新密码不一致。' }, { status: 400 });
  }

  if (!rawToken) {
    if (!(await ensureReaderTotpCredentialsReady(db))) {
      return privateJson(
        {
          ok: false,
          code: 'READER_TOTP_NOT_READY',
          message: '二步验证数据表尚未初始化，请先应用 0012_reader_totp_credentials.sql。'
        },
        { status: 503 }
      );
    }
    if (!(await ensureReaderTotpResetAttemptsReady(db))) {
      return privateJson(
        {
          ok: false,
          code: 'READER_TOTP_RESET_ATTEMPTS_NOT_READY',
          message: '二步验证重置限流表尚未初始化，请先应用 0013_reader_totp_reset_attempts.sql。'
        },
        { status: 503 }
      );
    }

    const identifier = cleanText(payload.identifier || payload.email || payload.username, 254);
    const code = normalizeTotpCode(payload.totpCode || payload.code);
    if (!identifier || !code) {
      return privateJson({ ok: false, message: '请输入用户名 / Email 和二步验证码。' }, { status: 400 });
    }

    const normalizedIdentifier = normalizeReaderResetIdentifier(identifier);
    const identifierHash = await getReaderTotpResetIdentifierHash(normalizedIdentifier, env);
    const { ipHash, ipUaHash } = await getRequestClientHashes(request);
    let limitKeys = getReaderTotpResetLimitKeys({ identifierHash, ipHash, ipUaHash });
    const baseLimit = await reserveReaderTotpResetAttempt(db, limitKeys);
    if (!baseLimit.ok) return readerTotpResetRateLimitResponse(baseLimit.retryAfterSeconds);

    const failTotpReset = (status = 401) =>
      privateJson({ ok: false, message: readerTotpResetFailureMessage }, { status });

    const resetAccount = isEmail(normalizeEmail(identifier))
      ? await db
          .prepare(
            `SELECT
              reader_accounts.id,
              reader_accounts.email,
              reader_accounts.normalized_email,
              reader_accounts.display_name,
              reader_accounts.created_at,
              reader_password_credentials.username,
              reader_totp_credentials.secret_base32,
              reader_totp_credentials.enabled_at,
              reader_totp_credentials.disabled_at,
              reader_totp_credentials.last_used_step
             FROM reader_accounts
             INNER JOIN reader_password_credentials
               ON reader_password_credentials.account_id = reader_accounts.id
             LEFT JOIN reader_totp_credentials
               ON reader_totp_credentials.account_id = reader_accounts.id
             WHERE reader_accounts.normalized_email = ?
               AND reader_accounts.status = 'active'
             LIMIT 1`
          )
          .bind(normalizeEmail(identifier))
          .first()
      : await db
          .prepare(
            `SELECT
              reader_accounts.id,
              reader_accounts.email,
              reader_accounts.normalized_email,
              reader_accounts.display_name,
              reader_accounts.created_at,
              reader_password_credentials.username,
              reader_totp_credentials.secret_base32,
              reader_totp_credentials.enabled_at,
              reader_totp_credentials.disabled_at,
              reader_totp_credentials.last_used_step
             FROM reader_password_credentials
             INNER JOIN reader_accounts
               ON reader_accounts.id = reader_password_credentials.account_id
             LEFT JOIN reader_totp_credentials
               ON reader_totp_credentials.account_id = reader_accounts.id
             WHERE reader_password_credentials.normalized_username = ?
               AND reader_accounts.status = 'active'
             LIMIT 1`
          )
          .bind(normalizeUsername(identifier))
          .first();

    if (!resetAccount) {
      return failTotpReset();
    }

    limitKeys = getReaderTotpResetLimitKeys({
      identifierHash,
      ipHash,
      ipUaHash,
      accountId: resetAccount.id
    });
    const accountLimit = await reserveReaderTotpResetAttempt(db, [{ scope: 'account', key: String(resetAccount.id) }]);
    if (!accountLimit.ok) return readerTotpResetRateLimitResponse(accountLimit.retryAfterSeconds);

    if (!isReaderTotpEnabled(resetAccount)) {
      return failTotpReset();
    }

    const totpCheck = await verifyAndConsumeReaderTotpCode(db, resetAccount.id, code, {
      unboundStatus: 401,
      unboundMessage: readerTotpResetFailureMessage,
      invalidStatus: 401,
      invalidMessage: readerTotpResetFailureMessage,
      reusedStatus: 401,
      reusedMessage: readerTotpResetFailureMessage
    });
    if (!totpCheck.ok) {
      return failTotpReset(totpCheck.status || 401);
    }

    const salt = randomHex();
    const passwordHash = await hashReaderPassword(password, salt, readerPasswordIterations);

    await db.batch([
      db
        .prepare(
          `UPDATE reader_password_credentials
           SET password_hash = ?,
               password_salt = ?,
               password_iterations = ?,
               password_algorithm = ?,
               last_password_change_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?`
        )
        .bind(passwordHash, salt, readerPasswordIterations, readerPasswordAlgorithm, resetAccount.id),
      db
        .prepare(
          `UPDATE reader_sessions
           SET revoked_at = CURRENT_TIMESTAMP
           WHERE account_id = ?
             AND revoked_at IS NULL`
        )
        .bind(resetAccount.id)
    ]);
    await clearReaderTotpResetFailures(db, limitKeys);

    const sessionToken = await createReaderSession(db, resetAccount.id, request);
    return privateJson(
      {
        ok: true,
        authenticated: true,
        message: '密码已重置，已登入会员中心。',
        account: readerAccountAuthJson({
          account_id: resetAccount.id,
          email: resetAccount.email,
          normalized_email: resetAccount.normalized_email,
          display_name: resetAccount.display_name,
          username: resetAccount.username,
          account_created_at: resetAccount.created_at
        })
      },
      {
        headers: {
          'set-cookie': makeCookie(readerSessionCookieName, sessionToken, request)
        }
      }
    );
  }

  const tokenHash = await sha256Hex(rawToken);
  const resetToken = await db
    .prepare(
      `SELECT
        reader_login_tokens.id,
        reader_login_tokens.account_id,
        reader_accounts.email,
        reader_accounts.normalized_email,
        reader_accounts.display_name,
        reader_accounts.created_at,
        reader_password_credentials.username
       FROM reader_login_tokens
       INNER JOIN reader_accounts ON reader_accounts.id = reader_login_tokens.account_id
       INNER JOIN reader_password_credentials ON reader_password_credentials.account_id = reader_accounts.id
       WHERE reader_login_tokens.token_hash = ?
         AND reader_login_tokens.purpose = 'password-reset'
         AND reader_login_tokens.consumed_at IS NULL
         AND reader_login_tokens.expires_at > CURRENT_TIMESTAMP
         AND reader_accounts.status = 'active'
       LIMIT 1`
    )
    .bind(tokenHash)
    .first();

  if (!resetToken) {
    return privateJson({ ok: false, message: '密码重置链接已失效，请重新申请。' }, { status: 401 });
  }

  const salt = randomHex();
  const passwordHash = await hashReaderPassword(password, salt, readerPasswordIterations);

  await db.batch([
    db
      .prepare(
        `UPDATE reader_login_tokens
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(resetToken.id),
    db
      .prepare(
        `UPDATE reader_password_credentials
         SET password_hash = ?,
             password_salt = ?,
             password_iterations = ?,
             password_algorithm = ?,
             last_password_change_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ?`
      )
      .bind(passwordHash, salt, readerPasswordIterations, readerPasswordAlgorithm, resetToken.account_id),
    db
      .prepare(
        `UPDATE reader_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE account_id = ?
           AND revoked_at IS NULL`
      )
      .bind(resetToken.account_id)
  ]);

  const sessionToken = await createReaderSession(db, resetToken.account_id, request);
  return privateJson(
    {
      ok: true,
      authenticated: true,
      message: '密码已更新，已登入会员中心。',
      account: readerAccountAuthJson({
        account_id: resetToken.account_id,
        email: resetToken.email,
        normalized_email: resetToken.normalized_email,
        display_name: resetToken.display_name,
        username: resetToken.username,
        account_created_at: resetToken.created_at
      })
    },
    {
      headers: {
        'set-cookie': makeCookie(readerSessionCookieName, sessionToken, request)
      }
    }
  );
};

const handleReaderPasswordChange = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return privateJson({ ok: false, message: '请先登入会员中心。' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const currentPassword = String(payload.currentPassword || '');
  const password = String(payload.password || payload.newPassword || '');
  const confirmPassword = String(payload.confirmPassword || payload.passwordConfirm || '');
  if (!currentPassword) {
    return privateJson({ ok: false, message: '请输入当前密码。' }, { status: 400 });
  }
  if (!isValidReaderPassword(password)) {
    return privateJson({ ok: false, message: '新密码需要 8-128 个字符。' }, { status: 400 });
  }
  if (confirmPassword && confirmPassword !== password) {
    return privateJson({ ok: false, message: '两次输入的新密码不一致。' }, { status: 400 });
  }

  const credential = await db
    .prepare(
      `SELECT password_hash, password_salt, password_iterations, password_algorithm
       FROM reader_password_credentials
       WHERE account_id = ?
       LIMIT 1`
    )
    .bind(session.account_id)
    .first();

  if (!credential || credential.password_algorithm !== readerPasswordAlgorithm) {
    return privateJson({ ok: false, message: '当前账号暂时无法修改密码，请使用重置密码。' }, { status: 400 });
  }

  const currentHash = await hashReaderPassword(
    currentPassword,
    credential.password_salt,
    Number(credential.password_iterations || readerPasswordIterations)
  );
  if (!timingSafeEqualString(currentHash, credential.password_hash)) {
    return privateJson({ ok: false, message: '当前密码不正确。' }, { status: 401 });
  }

  if (await ensureReaderTotpCredentialsReady(db)) {
    const totpCredential = await getReaderTotpCredential(db, session.account_id);
    if (isReaderTotpEnabled(totpCredential)) {
      const totpCheck = await verifyAndConsumeReaderTotpCode(db, session.account_id, payload.totpCode || payload.code);
      if (!totpCheck.ok) {
        return privateJson({ ok: false, message: totpCheck.message }, { status: totpCheck.status });
      }
    }
  }

  const salt = randomHex();
  const passwordHash = await hashReaderPassword(password, salt, readerPasswordIterations);

  const statements = [
    db
      .prepare(
        `UPDATE reader_password_credentials
         SET password_hash = ?,
             password_salt = ?,
             password_iterations = ?,
             password_algorithm = ?,
             last_password_change_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ?`
      )
      .bind(passwordHash, salt, readerPasswordIterations, readerPasswordAlgorithm, session.account_id),
    db
      .prepare(
        `UPDATE reader_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE account_id = ?
           AND id <> ?
           AND revoked_at IS NULL`
      )
      .bind(session.account_id, session.session_id)
  ];
  await db.batch(statements);

  return privateJson({ ok: true, message: '密码已更新。' });
};

const handleReaderMagicLinkRequest = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(payload.email);
  if (!isEmail(normalizedEmail)) {
    return json({ ok: false, message: 'Please enter a valid email address.' }, { status: 400 });
  }

  const email = cleanText(payload.email, 254);
  const account = await upsertReaderAccount(db, email, normalizedEmail);
  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  const userAgent = cleanText(request.headers.get('user-agent'), 300);
  const ipHash = await sha256Hex(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local');

  await db.batch([
    db
      .prepare(
        `UPDATE reader_login_tokens
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE account_id = ?
           AND purpose = 'login'
           AND consumed_at IS NULL`
      )
      .bind(account.id),
    db
      .prepare(
        `INSERT INTO reader_login_tokens (
          account_id, normalized_email, token_hash, purpose, expires_at, request_ip_hash, user_agent
        )
        VALUES (?, ?, ?, 'login', datetime('now', '+15 minutes'), ?, ?)`
      )
      .bind(account.id, normalizedEmail, tokenHash, ipHash, userAgent)
  ]);

  const debugOrigin = env.READER_AUTH_DEBUG_LINKS === '1' ? env.READER_AUTH_DEBUG_ORIGIN : '';
  const loginUrl = new URL('/api/readers/verify', debugOrigin || request.url);
  loginUrl.searchParams.set('token', rawToken);
  loginUrl.searchParams.set('redirect', cleanRedirectPath(payload.redirectPath));
  const delivery = await sendReaderLoginEmail(env, email, loginUrl.toString());
  const debugLoginUrl = isLocalRequest(request, env) ? loginUrl.toString() : '';

  if (!delivery.configured && !debugLoginUrl) {
    return json(
      {
        ok: false,
        message: 'Reader login email delivery is not configured yet.',
        delivery
      },
      { status: 503 }
    );
  }

  if (delivery.configured && !delivery.sent) {
    return json(
      {
        ok: false,
        message: 'The login email could not be sent. Please try again later.',
        delivery
      },
      { status: 502 }
    );
  }

  return json({
    ok: true,
    message: delivery.sent
      ? 'Check your email for the secure sign-in link.'
      : 'Local reader login link generated.',
    delivery,
    debugLoginUrl
  });
};

const getReaderFromSession = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return null;

  const sessionToken = getCookie(request, readerSessionCookieName);
  if (!sessionToken) return null;

  const sessionHash = await sha256Hex(sessionToken);
  const session = await db
    .prepare(
      `SELECT
        reader_sessions.id AS session_id,
        reader_sessions.expires_at AS session_expires_at,
        reader_accounts.id AS account_id,
        reader_accounts.email,
        reader_accounts.normalized_email,
        reader_accounts.display_name,
        reader_password_credentials.username,
        reader_accounts.created_at AS account_created_at
       FROM reader_sessions
       INNER JOIN reader_accounts ON reader_accounts.id = reader_sessions.account_id
       LEFT JOIN reader_password_credentials ON reader_password_credentials.account_id = reader_accounts.id
       WHERE reader_sessions.session_hash = ?
         AND reader_sessions.revoked_at IS NULL
         AND reader_sessions.expires_at > CURRENT_TIMESTAMP
         AND reader_accounts.status = 'active'
       LIMIT 1`
    )
    .bind(sessionHash)
    .first();

  if (!session) return null;

  await db
    .prepare(`UPDATE reader_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(session.session_id)
    .run();

  return session;
};

const handleReaderSession = async (request, env) => {
  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json({ ok: true, authenticated: false });
  }

  return json({
    ok: true,
    authenticated: true,
    account: {
      id: session.account_id,
      email: session.email,
      normalizedEmail: session.normalized_email,
      username: session.username || '',
      displayName: session.display_name || session.username || session.email,
      createdAt: session.account_created_at
    },
    session: {
      expiresAt: session.session_expires_at
    }
  });
};

const handleReaderVerify = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return new Response('Reader database is not configured.', { status: 500 });

  const url = new URL(request.url);
  const rawToken = cleanText(url.searchParams.get('token'), 300);
  const redirectPath = cleanRedirectPath(url.searchParams.get('redirect'));
  const failureUrl = new URL('/library/', url.origin);
  failureUrl.searchParams.set('login', 'invalid');

  if (!rawToken) {
    return Response.redirect(failureUrl.toString(), 302);
  }

  const tokenHash = await sha256Hex(rawToken);
  const loginToken = await db
    .prepare(
      `SELECT id, account_id
       FROM reader_login_tokens
       WHERE token_hash = ?
         AND purpose = 'login'
         AND consumed_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`
    )
    .bind(tokenHash)
    .first();

  if (!loginToken) {
    return Response.redirect(failureUrl.toString(), 302);
  }

  const sessionToken = randomToken();
  const sessionHash = await sha256Hex(sessionToken);
  const userAgent = cleanText(request.headers.get('user-agent'), 300);

  await db.batch([
    db
      .prepare(
        `UPDATE reader_login_tokens
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(loginToken.id),
    db
      .prepare(
        `UPDATE reader_accounts
         SET last_login_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(loginToken.account_id),
    db
      .prepare(
        `INSERT INTO reader_sessions (account_id, session_hash, expires_at, user_agent)
         VALUES (?, ?, datetime('now', '+30 days'), ?)`
      )
      .bind(loginToken.account_id, sessionHash, userAgent)
  ]);

  const successUrl = new URL(redirectPath, url.origin);
  successUrl.searchParams.set('login', 'success');
  return new Response(null, {
    status: 302,
    headers: {
      location: successUrl.toString(),
      'set-cookie': makeCookie(readerSessionCookieName, sessionToken, request)
    }
  });
};

const handleReaderLogout = async (request, env) => {
  const db = env.WAITLIST_DB;
  const sessionToken = getCookie(request, readerSessionCookieName);

  if (db && sessionToken) {
    const sessionHash = await sha256Hex(sessionToken);
    await db
      .prepare(
        `UPDATE reader_sessions
         SET revoked_at = CURRENT_TIMESTAMP
         WHERE session_hash = ? AND revoked_at IS NULL`
      )
      .bind(sessionHash)
      .run();
  }

  return json(
    { ok: true, authenticated: false },
    {
      headers: {
        'set-cookie': clearCookie(readerSessionCookieName, request)
      }
    }
  );
};

const normalizeEntitlementPayload = (payload) => {
  const email = cleanText(payload.email, 254);
  const normalizedEmail = normalizeEmail(email);
  const seriesSlug = cleanSlug(payload.seriesSlug);
  const scope = payload.scope === 'series' ? 'series' : 'chapter';
  const chapterSlug = scope === 'chapter' ? cleanSlug(payload.chapterSlug) : '';
  const allowedAccess = new Set(['paid', 'supporter', 'all']);
  const accessLevel = allowedAccess.has(payload.accessLevel) ? payload.accessLevel : 'paid';
  const expiresAt = toSqlTimestamp(payload.expiresAt);

  if (!isEmail(normalizedEmail)) {
    throw new Error('Please enter a valid reader email.');
  }

  if (!seriesSlug) {
    throw new Error('seriesSlug is required.');
  }

  if (scope === 'chapter' && !chapterSlug) {
    throw new Error('chapterSlug is required for chapter grants.');
  }

  if (payload.expiresAt && !expiresAt) {
    throw new Error('expiresAt must be a valid date or empty.');
  }

  return {
    accessLevel,
    chapterSlug,
    email,
    expiresAt,
    grantedBy: cleanText(payload.grantedBy || 'admin', 120) || 'admin',
    normalizedEmail,
    note: cleanText(payload.note, 1000),
    scope,
    seriesSlug,
    source: cleanText(payload.source || 'manual', 60) || 'manual',
    sourceRef: cleanText(payload.sourceRef, 200)
  };
};

const listNovelEntitlements = async (db, normalizedEmail = '') => {
  const hasEmailFilter = Boolean(normalizedEmail);
  const response = hasEmailFilter
    ? await db
        .prepare(
          `SELECT
            novel_entitlements.*,
            reader_accounts.email
           FROM novel_entitlements
           INNER JOIN reader_accounts ON reader_accounts.id = novel_entitlements.account_id
           WHERE reader_accounts.normalized_email = ?
           ORDER BY novel_entitlements.updated_at DESC
           LIMIT 100`
        )
        .bind(normalizedEmail)
        .all()
    : await db
        .prepare(
          `SELECT
            novel_entitlements.*,
            reader_accounts.email
           FROM novel_entitlements
           INNER JOIN reader_accounts ON reader_accounts.id = novel_entitlements.account_id
           ORDER BY novel_entitlements.updated_at DESC
           LIMIT 100`
        )
        .all();

  return (response.results || []).map(entitlementToJson);
};

const handleAdminListNovelEntitlements = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const normalizedEmail = normalizeEmail(url.searchParams.get('email'));
  if (normalizedEmail && !isEmail(normalizedEmail)) {
    return privateJson({ ok: false, message: 'Please enter a valid reader email.' }, { status: 400 });
  }

  const entitlements = await listNovelEntitlements(db, normalizedEmail);
  return privateJson({ ok: true, entitlements });
};

const handleAdminGrantNovelEntitlement = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  let data;
  try {
    data = normalizeEntitlementPayload(payload);
  } catch (error) {
    return privateJson({ ok: false, message: error.message }, { status: 400 });
  }

  const account = await upsertReaderAccount(db, data.email, data.normalizedEmail);
  const entitlement = await db
    .prepare(
      `INSERT INTO novel_entitlements (
        account_id, series_slug, chapter_slug, scope, access_level, source, source_ref,
        note, granted_by, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, series_slug, chapter_slug, scope, access_level, source)
      DO UPDATE SET
        source_ref = excluded.source_ref,
        note = excluded.note,
        granted_by = excluded.granted_by,
        granted_at = CURRENT_TIMESTAMP,
        expires_at = excluded.expires_at,
        revoked_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`
    )
    .bind(
      account.id,
      data.seriesSlug,
      data.chapterSlug,
      data.scope,
      data.accessLevel,
      data.source,
      data.sourceRef,
      data.note,
      data.grantedBy,
      data.expiresAt
    )
    .first();

  const actorEmail = (await getAdminActorEmail(request, env)) || data.grantedBy || 'admin';
  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'novel_entitlement.grant',
    targetType: 'novel_entitlement',
    targetId: String(entitlement.id),
    targetSlug: `${data.seriesSlug}${data.chapterSlug ? `/${data.chapterSlug}` : ''}`,
    metadata: {
      accountId: account.id,
      email: account.email,
      scope: data.scope,
      accessLevel: data.accessLevel,
      source: data.source,
      sourceRef: data.sourceRef,
      expiresAt: data.expiresAt,
      note: data.note
    }
  });

  return privateJson({
    ok: true,
    entitlement: entitlementToJson({ ...entitlement, email: account.email }),
    entitlements: await listNovelEntitlements(db, data.normalizedEmail)
  });
};

const handleAdminRevokeNovelEntitlement = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const id = Number.parseInt(payload.id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return privateJson({ ok: false, message: 'A valid entitlement id is required.' }, { status: 400 });
  }

  const existing = await db
    .prepare(
      `SELECT novel_entitlements.*, reader_accounts.email
       FROM novel_entitlements
       LEFT JOIN reader_accounts ON reader_accounts.id = novel_entitlements.account_id
       WHERE novel_entitlements.id = ?
       LIMIT 1`
    )
    .bind(id)
    .first();
  if (!existing) return privateJson({ ok: false, message: 'Entitlement was not found.' }, { status: 404 });

  await db
    .prepare(
      `UPDATE novel_entitlements
       SET revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(id)
    .run();

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'novel_entitlement.revoke',
    targetType: 'novel_entitlement',
    targetId: String(id),
    targetSlug: `${existing.series_slug}${existing.chapter_slug ? `/${existing.chapter_slug}` : ''}`,
    metadata: {
      accountId: existing.account_id,
      email: existing.email,
      scope: existing.scope,
      accessLevel: existing.access_level,
      source: existing.source,
      sourceRef: existing.source_ref,
      note: cleanText(payload.note, 500)
    }
  });

  const normalizedEmail = normalizeEmail(payload.email);
  return privateJson({
    ok: true,
    entitlements: await listNovelEntitlements(db, isEmail(normalizedEmail) ? normalizedEmail : '')
  });
};

const findActiveNovelEntitlement = async (db, accountId, seriesSlug, chapterSlug, accessRequired) => {
  const levels = acceptableAccessLevels(accessRequired);
  return db
    .prepare(
      `SELECT *
       FROM novel_entitlements
       WHERE account_id = ?
         AND series_slug = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         AND access_level IN (?, ?)
         AND (
           (scope = 'series' AND chapter_slug = '')
           OR (scope = 'chapter' AND chapter_slug = ?)
         )
       ORDER BY
         CASE WHEN scope = 'chapter' THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT 1`
    )
    .bind(accountId, seriesSlug, levels[0], levels[1] || levels[0], chapterSlug)
    .first();
};

const handleNovelAccessCheck = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const seriesSlug = cleanSlug(url.searchParams.get('series'));
  const chapterSlug = cleanSlug(url.searchParams.get('chapter'));
  const accessRequired = url.searchParams.get('access') === 'supporter' ? 'supporter' : url.searchParams.get('access') === 'free' ? 'free' : 'paid';

  if (!seriesSlug || !chapterSlug) {
    return json({ ok: false, message: 'series and chapter are required.' }, { status: 400 });
  }

  if (accessRequired === 'free') {
    return json({ ok: true, authenticated: false, allowed: true, accessRequired, reason: 'free' });
  }

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json({
      ok: true,
      authenticated: false,
      allowed: false,
      accessRequired,
      reason: 'sign_in_required'
    });
  }

  const [membershipSettings, membership] = accessRequired === 'paid'
    ? await Promise.all([
        getReaderMembershipSettings(db, env),
        getActiveReaderMembership(db, session.account_id)
      ])
    : [{ membershipCoversPaidContent: false }, null];
  if (membership && membershipSettings.enabled && membershipSettings.membershipCoversPaidContent) {
    return json({
      ok: true,
      authenticated: true,
      allowed: true,
      accessRequired,
      reason: 'membership_active',
      account: {
        id: session.account_id,
        email: session.email
      },
      membership: readerMembershipToJson(membership),
      entitlement: null
    });
  }

  const entitlement = await findActiveNovelEntitlement(db, session.account_id, seriesSlug, chapterSlug, accessRequired);
  return json({
    ok: true,
    authenticated: true,
    allowed: Boolean(entitlement),
    accessRequired,
    reason: entitlement ? 'entitled' : 'entitlement_required',
    account: {
      id: session.account_id,
      email: session.email
    },
    entitlement: entitlement ? entitlementToJson({ ...entitlement, email: session.email }) : null
  });
};

const protectedChapterToJson = (entry) => ({
  access: entry.access,
  chapterNumber: entry.chapterNumber,
  chapterSlug: entry.chapterSlug,
  excerpt: entry.excerpt,
  language: entry.language,
  seriesSlug: entry.seriesSlug,
  title: entry.title
});

const getProtectedChapterContent = (seriesSlug, chapterSlug) =>
  protectedSerialContent?.chapters?.[`${seriesSlug}/${chapterSlug}`] || null;

const getBackendProtectedChapterContent = async (env, seriesSlug, chapterSlug, locale = '') => {
  const db = env.WAITLIST_DB;
  if (!db || !(await ensureContentTablesReady(db))) return null;

  const requestedLocale = cleanText(locale, 20);
  const localeClause = requestedLocale && contentLocales.has(requestedLocale) ? 'AND locale = ?' : '';
  const params = [seriesSlug, chapterSlug];
  if (localeClause) params.push(requestedLocale);

  const row = await db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = 'novel_chapter'
         AND parent_slug = ?
         AND slug = ?
         AND status = 'published'
         AND visibility IN ('public', 'unlisted')
         ${localeClause}
       ORDER BY
         CASE WHEN access_level = 'supporter' THEN 0 ELSE 1 END,
         COALESCE(published_at, updated_at) DESC,
         id DESC
       LIMIT 1`
    )
    .bind(...params)
    .first();

  if (!row) return null;
  const settings = await resolveSeriesPaymentSettings(db, row.parent_slug, env, { chapterSlug: row.slug, locale: row.locale });
  const access = dynamicProtectedAccessFromChapterAccess(getEffectiveDynamicChapterAccessLevel(row, settings));
  if (access === 'free') return null;

  return {
    access,
    chapterNumber: row.chapter_number,
    chapterSlug: row.slug,
    excerpt: firstPlainSummary([row.excerpt, row.description], 420),
    headings: [],
    htmlR2Key: row.html_r2_key,
    language: row.locale,
    seriesSlug: row.parent_slug,
    source: 'backend-content-platform',
    title: row.title
  };
};

const getProtectedChapterHtml = async (env, chapter) => {
  const bucket = getContentBucket(env);
  if (!bucket) {
    const error = new Error('Protected chapter content bucket is not configured.');
    error.code = 'CONTENT_BUCKET_NOT_CONFIGURED';
    throw error;
  }

  const key = cleanText(chapter?.htmlR2Key, 500);
  if (!key) {
    const error = new Error('Protected chapter content key is missing.');
    error.code = 'PROTECTED_CONTENT_KEY_MISSING';
    throw error;
  }

  const object = await bucket.get(key);
  if (!object) {
    const error = new Error('Protected chapter content object was not found.');
    error.code = 'PROTECTED_CONTENT_OBJECT_NOT_FOUND';
    throw error;
  }

  return {
    etag: object.httpEtag || '',
    html: await object.text(),
    key,
    uploadedAt: object.uploaded ? object.uploaded.toISOString() : ''
  };
};

const handleProtectedChapterContent = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const seriesSlug = cleanSlug(url.searchParams.get('series'));
  const chapterSlug = cleanSlug(url.searchParams.get('chapter'));
  const locale = cleanText(url.searchParams.get('locale'), 20);
  if (!seriesSlug || !chapterSlug) {
    return privateJson({ ok: false, message: 'series and chapter are required.' }, { status: 400 });
  }

  const chapter = getProtectedChapterContent(seriesSlug, chapterSlug) || (await getBackendProtectedChapterContent(env, seriesSlug, chapterSlug, locale));
  if (!chapter) {
    return privateJson(
      {
        ok: false,
        code: 'PROTECTED_CONTENT_NOT_FOUND',
        message: 'Protected chapter content is not available.'
      },
      { status: 404 }
    );
  }

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return privateJson(
      {
        ok: false,
        authenticated: false,
        allowed: false,
        code: 'SIGN_IN_REQUIRED',
        message: 'Please sign in before reading this protected chapter.'
      },
      { status: 401 }
    );
  }

  const accessRequired = chapter.access === 'supporter' ? 'supporter' : 'paid';
  const [membershipSettings, membership] = accessRequired === 'paid'
    ? await Promise.all([
        getReaderMembershipSettings(db, env),
        getActiveReaderMembership(db, session.account_id)
      ])
    : [{ membershipCoversPaidContent: false }, null];
  const entitlement = await findActiveNovelEntitlement(db, session.account_id, seriesSlug, chapterSlug, accessRequired);
  const membershipAllowed = Boolean(membership && membershipSettings.enabled && membershipSettings.membershipCoversPaidContent);
  if (!entitlement && !membershipAllowed) {
    return privateJson(
      {
        ok: false,
        authenticated: true,
        allowed: false,
        code: 'ENTITLEMENT_REQUIRED',
        message: 'This account has not unlocked this chapter yet.',
        account: {
          id: session.account_id,
          email: session.email
        }
      },
      { status: 403 }
    );
  }

  let protectedHtml;
  try {
    protectedHtml = await getProtectedChapterHtml(env, chapter);
  } catch (error) {
    const missingObject = error.code === 'PROTECTED_CONTENT_OBJECT_NOT_FOUND';
    return privateJson(
      {
        ok: false,
        authenticated: true,
        allowed: true,
        code: error.code || 'PROTECTED_CONTENT_R2_ERROR',
        message: missingObject
          ? 'Protected chapter content has not been uploaded yet.'
          : error.message || 'Protected chapter content is not available.',
        account: {
          id: session.account_id,
          email: session.email
        },
        chapter: protectedChapterToJson(chapter)
      },
      { status: missingObject ? 404 : 503 }
    );
  }

  return privateJson({
    ok: true,
    authenticated: true,
    allowed: true,
    account: {
      id: session.account_id,
      email: session.email
    },
    chapter: protectedChapterToJson(chapter),
    content: {
      etag: protectedHtml.etag,
      headings: chapter.headings || [],
      html: stripLeadingReaderHeadingHtml(protectedHtml.html),
      source: 'r2',
      uploadedAt: protectedHtml.uploadedAt
    },
    entitlement: entitlement ? entitlementToJson({ ...entitlement, email: session.email }) : null,
    membership: membershipAllowed ? readerMembershipToJson(membership) : null
  });
};

const handleNovelLibrary = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json({ ok: true, authenticated: false, entitlements: [] });
  }

  const response = await db
    .prepare(
      `SELECT *
       FROM novel_entitlements
       WHERE account_id = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ORDER BY series_slug ASC, scope ASC, chapter_slug ASC, updated_at DESC
       LIMIT 200`
    )
    .bind(session.account_id)
    .all();

  return json({
    ok: true,
    authenticated: true,
    account: {
      id: session.account_id,
      email: session.email
    },
    membership: readerMembershipToJson(await getActiveReaderMembership(db, session.account_id)),
    entitlements: (response.results || []).map((row) => entitlementToJson({ ...row, email: session.email }))
  });
};

const ensureReaderCreditAccount = async (db, accountId, config) => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO reader_credit_accounts (account_id, currency_label)
       VALUES (?, ?)`
    )
    .bind(accountId, config.unitLabel)
    .run();

  return db
    .prepare(
      `SELECT *
       FROM reader_credit_accounts
       WHERE account_id = ?`
    )
    .bind(accountId)
    .first();
};

const getReaderCreditLedger = async (db, accountId, limit = 20) => {
  const response = await db
    .prepare(
      `SELECT *
       FROM reader_credit_ledger
       WHERE account_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(accountId, Math.min(Math.max(limit, 1), 50))
    .all();

  return (response.results || []).map(readerCreditLedgerToJson);
};

const getReaderCreditSummary = async (db, accountId, env) => {
  const config = getReaderCreditConfig(env);
  const account = await ensureReaderCreditAccount(db, accountId, config);
  const [ledger, membership, membershipSettings, packs, chapterCostCredits] = await Promise.all([
    getReaderCreditLedger(db, accountId),
    getActiveReaderMembership(db, accountId),
    getReaderMembershipSettings(db, env),
    getConfiguredReaderCreditPacks(db, env),
    getConfiguredChapterCostCredits(db, env)
  ]);

  return {
    account: readerCreditAccountToJson(account, config),
    chapterCostCredits,
    packs: packs.map((pack) => ({
      credits: pack.credits,
      priceAmount: amountToStorage(pack.priceAmount),
      priceCurrency: pack.priceCurrency,
      label: pack.label
    })),
    membership: readerMembershipToJson(membership),
    membershipSettings,
    ledger
  };
};

const handleReaderCredits = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const [packs, chapterCostCredits, membershipSettings] = await Promise.all([
    getConfiguredReaderCreditPacks(db, env),
    getConfiguredChapterCostCredits(db, env),
    getReaderMembershipSettings(db, env)
  ]);
  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json({
      ok: true,
      authenticated: false,
      chapterCostCredits,
      packs: packs.map((pack) => ({
        credits: pack.credits,
        priceAmount: amountToStorage(pack.priceAmount),
        priceCurrency: pack.priceCurrency,
        label: pack.label
      })),
      membershipSettings
    });
  }

  const summary = await getReaderCreditSummary(db, session.account_id, env);
  return json({
    ok: true,
    authenticated: true,
    account: {
      id: session.account_id,
      email: session.email
    },
    ...summary
  });
};

const listReaderBookmarks = async (db, accountId, limit = 30) => {
  const response = await db
    .prepare(
      `SELECT *
       FROM reader_bookmarks
       WHERE account_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    )
    .bind(accountId, Math.min(Math.max(normalizePositiveInteger(limit, 30), 1), 80))
    .all();

  return (response.results || []).map(readerBookmarkToJson);
};

const normalizeReaderBookmarkMetadata = (payload) => {
  const metadata = normalizeJsonObject(payload.metadata);
  const rawAnchorId = cleanText(metadata.anchorId || payload.anchorId, 80);
  const anchorId = /^sc-bookmark-block-\d{1,5}$/.test(rawAnchorId) ? rawAnchorId : '';
  const rawBlockIndex = Number.parseInt(metadata.blockIndex ?? payload.blockIndex ?? '', 10);
  const blockIndex = Number.isFinite(rawBlockIndex) && rawBlockIndex >= 0 ? Math.min(rawBlockIndex, 99999) : null;
  return {
    ...(anchorId ? { anchorId } : {}),
    ...(blockIndex !== null ? { blockIndex } : {})
  };
};

const normalizeReaderBookmarkPayload = (payload) => {
  const seriesSlug = cleanSlug(payload.seriesSlug || payload.series);
  const chapterSlug = cleanSlug(payload.chapterSlug || payload.chapter);
  if (!seriesSlug || !chapterSlug) {
    const error = new Error('seriesSlug and chapterSlug are required.');
    error.code = 'INVALID_BOOKMARK_TARGET';
    throw error;
  }

  const fallbackPath = `/novel/${seriesSlug}/chapter/${chapterSlug}/`;
  const rawProgress = Number.parseInt(payload.progressPercent ?? payload.progress ?? '', 10);
  const progressPercent = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;

  return {
    chapterSlug,
    chapterTitle: cleanText(payload.chapterTitle || payload.title, 240),
    locale: normalizeContentLocale(payload.locale || 'zh-Hant'),
    metadata: normalizeReaderBookmarkMetadata(payload),
    note: cleanText(payload.note, 500),
    positionLabel: cleanText(payload.positionLabel, 120),
    progressPercent,
    seriesSlug,
    seriesTitle: cleanText(payload.seriesTitle, 240),
    sourcePath: cleanRedirectPath(payload.sourcePath || payload.path, fallbackPath)
  };
};

const handleReaderBookmarks = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json({
      ok: true,
      authenticated: false,
      bookmarks: []
    });
  }

  if (!(await ensureReaderBookmarksReady(db))) {
    return json({
      ok: true,
      authenticated: true,
      setupRequired: true,
      message: 'Reader bookmarks are not initialized. Apply migration 0010_reader_bookmarks.sql.',
      account: {
        id: session.account_id,
        email: session.email
      },
      bookmarks: []
    });
  }

  const url = new URL(request.url);
  const bookmarks = await listReaderBookmarks(db, session.account_id, url.searchParams.get('limit'));
  return json({
    ok: true,
    authenticated: true,
    setupRequired: false,
    account: {
      id: session.account_id,
      email: session.email
    },
    bookmarks
  });
};

const handleReaderBookmarkSave = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json(
      {
        ok: false,
        code: 'SIGN_IN_REQUIRED',
        message: 'Please sign in before saving a bookmark.'
      },
      { status: 401 }
    );
  }

  if (!(await ensureReaderBookmarksReady(db))) {
    return json(
      {
        ok: false,
        code: 'READER_BOOKMARKS_NOT_READY',
        message: 'Reader bookmarks are not initialized. Apply migration 0010_reader_bookmarks.sql.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, code: 'INVALID_JSON', message: 'Invalid request body.' }, { status: 400 });
  }

  let bookmark;
  try {
    bookmark = normalizeReaderBookmarkPayload(payload);
  } catch (error) {
    return json({ ok: false, code: error.code || 'INVALID_BOOKMARK', message: error.message }, { status: 400 });
  }

  const row = await db
    .prepare(
      `INSERT INTO reader_bookmarks (
        account_id, series_slug, chapter_slug, series_title, chapter_title, locale,
        source_path, progress_percent, position_label, note, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, series_slug, chapter_slug)
      DO UPDATE SET
        series_title = excluded.series_title,
        chapter_title = excluded.chapter_title,
        locale = excluded.locale,
        source_path = excluded.source_path,
        progress_percent = excluded.progress_percent,
        position_label = excluded.position_label,
        note = excluded.note,
        metadata_json = excluded.metadata_json,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`
    )
    .bind(
      session.account_id,
      bookmark.seriesSlug,
      bookmark.chapterSlug,
      bookmark.seriesTitle,
      bookmark.chapterTitle,
      bookmark.locale,
      bookmark.sourcePath,
      bookmark.progressPercent,
      bookmark.positionLabel,
      bookmark.note,
      JSON.stringify(bookmark.metadata)
    )
    .first();

  return json({
    ok: true,
    authenticated: true,
    bookmark: readerBookmarkToJson(row),
    bookmarks: await listReaderBookmarks(db, session.account_id),
    account: {
      id: session.account_id,
      email: session.email
    }
  });
};

const getReaderBookmarkDeleteId = async (request) => {
  const url = new URL(request.url);
  const queryId = normalizePositiveInteger(url.searchParams.get('id'), 0);
  if (queryId > 0) return queryId;

  try {
    const payload = await request.json();
    return normalizePositiveInteger(payload.id || payload.bookmarkId, 0);
  } catch {
    return 0;
  }
};

const handleReaderBookmarkDelete = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json(
      {
        ok: false,
        code: 'SIGN_IN_REQUIRED',
        message: 'Please sign in before deleting a bookmark.'
      },
      { status: 401 }
    );
  }

  if (!(await ensureReaderBookmarksReady(db))) {
    return json(
      {
        ok: false,
        code: 'READER_BOOKMARKS_NOT_READY',
        message: 'Reader bookmarks are not initialized. Apply migration 0010_reader_bookmarks.sql.'
      },
      { status: 503 }
    );
  }

  const bookmarkId = await getReaderBookmarkDeleteId(request);
  if (!bookmarkId) {
    return json(
      {
        ok: false,
        code: 'INVALID_BOOKMARK_ID',
        message: 'A valid bookmark id is required.'
      },
      { status: 400 }
    );
  }

  const result = await db
    .prepare(
      `DELETE FROM reader_bookmarks
       WHERE id = ? AND account_id = ?`
    )
    .bind(bookmarkId, session.account_id)
    .run();

  if (getD1ChangeCount(result) < 1) {
    return json(
      {
        ok: false,
        code: 'BOOKMARK_NOT_FOUND',
        message: 'Bookmark was not found.'
      },
      { status: 404 }
    );
  }

  return json({
    ok: true,
    authenticated: true,
    deletedBookmarkId: bookmarkId,
    bookmarks: await listReaderBookmarks(db, session.account_id),
    account: {
      id: session.account_id,
      email: session.email
    }
  });
};

const normalizeReadingEventMetadata = (value) => {
  const metadata = normalizeJsonObject(value);
  const normalized = {};

  for (const [rawKey, rawValue] of Object.entries(metadata).slice(0, novelReadingEventMaxMetadataKeys)) {
    const key = cleanText(rawKey, 48).replace(/[^a-zA-Z0-9_.:-]+/g, '_');
    if (!key) continue;

    if (typeof rawValue === 'string') {
      normalized[key] = cleanText(rawValue, 300);
    } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      normalized[key] = rawValue;
    } else if (typeof rawValue === 'boolean' || rawValue === null) {
      normalized[key] = rawValue;
    } else if (Array.isArray(rawValue)) {
      normalized[key] = rawValue
        .slice(0, 10)
        .map((item) => {
          if (typeof item === 'string') return cleanText(item, 120);
          if (typeof item === 'number' && Number.isFinite(item)) return item;
          if (typeof item === 'boolean' || item === null) return item;
          return null;
        })
        .filter((item) => item !== null);
    }
  }

  return normalized;
};

const normalizeNullableNumber = (value, options = {}) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const min = Number.isFinite(options.min) ? options.min : -1000000;
  const max = Number.isFinite(options.max) ? options.max : 1000000;
  return Math.max(min, Math.min(max, number));
};

const normalizeNullableInteger = (value, options = {}) => {
  const number = normalizeNullableNumber(value, options);
  return number === null ? null : Math.round(number);
};

const normalizeReadingEventPayload = (payload, options = {}) => {
  const eventType = cleanText(payload.eventType || payload.event, 40).toLowerCase();
  const eventTypes = options.eventTypes || novelReadingEventTypes;
  if (!eventTypes.has(eventType)) {
    const error = new Error('Unsupported reading event type.');
    error.code = 'INVALID_READING_EVENT_TYPE';
    throw error;
  }

  const seriesSlug = cleanSlug(payload.seriesSlug || payload.series || options.seriesSlug, 160);
  const chapterSlug = cleanSlug(payload.chapterSlug || payload.chapter || options.chapterSlug, 160);
  if (!seriesSlug || !chapterSlug) {
    const error = new Error('seriesSlug and chapterSlug are required.');
    error.code = 'INVALID_READING_EVENT_TARGET';
    throw error;
  }

  const rawClientEventId = cleanText(payload.clientEventId || payload.eventId, 120);
  const clientEventId = /^[a-zA-Z0-9:_-]{8,120}$/.test(rawClientEventId)
    ? rawClientEventId
    : `server-${randomHex(16)}`;
  const rawSessionId = cleanText(payload.sessionId || payload.clientSessionId || options.sessionId, 120);
  const sessionId = /^[a-zA-Z0-9:_-]{6,120}$/.test(rawSessionId) ? rawSessionId : `session-${randomHex(12)}`;
  const locale = normalizeContentLocale(payload.locale || options.locale || 'zh-Hant');
  const progressPercent = normalizeNullableInteger(payload.progressPercent ?? payload.progress, { min: 0, max: 100 });
  const blockIndex = normalizeNullableInteger(payload.blockIndex, { min: 0, max: 99999 });
  const durationMs = normalizeNullableInteger(payload.durationMs ?? payload.elapsedMs, { min: 0, max: 24 * 60 * 60 * 1000 });
  const eventValue = normalizeNullableNumber(payload.value ?? payload.eventValue, { min: -1000000, max: 1000000 });
  const sourcePath = cleanRedirectPath(payload.sourcePath || payload.path || options.sourcePath, `/novel/${seriesSlug}/chapter/${chapterSlug}/`);

  return {
    blockIndex,
    chapterSlug,
    clientEventId,
    durationMs,
    eventType,
    eventValue,
    locale,
    metadata: normalizeReadingEventMetadata(payload.metadata),
    progressPercent,
    seriesSlug,
    sessionId,
    sourcePath
  };
};

const countRecentReadingEventsByUserAgent = async (db, userAgentHash) => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reading_events
       WHERE user_agent_hash = ?
         AND created_at >= datetime('now', '-' || ? || ' seconds')`
    )
    .bind(userAgentHash, novelReadingEventRateLimitWindowSeconds)
    .first();
  return Math.max(0, Number(row?.count || 0));
};

const countRecentReadingEventsBySession = async (db, sessionId) => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reading_events
       WHERE session_id = ?
         AND created_at >= datetime('now', '-' || ? || ' seconds')`
    )
    .bind(sessionId, novelReadingEventRateLimitWindowSeconds)
    .first();
  return Math.max(0, Number(row?.count || 0));
};

const checkNovelReadingEventRateLimit = async (db, events, clientHashes) => {
  const clientRecentCount = await countRecentReadingEventsByUserAgent(db, clientHashes.ipUaHash);
  if (clientRecentCount + events.length > novelReadingEventClientRateLimitPerMinute) {
    return { limited: true, scope: 'client', retryAfterSeconds: novelReadingEventRateLimitWindowSeconds };
  }

  const eventsBySession = new Map();
  events.forEach((event) => {
    eventsBySession.set(event.sessionId, (eventsBySession.get(event.sessionId) || 0) + 1);
  });

  for (const [sessionId, incomingCount] of eventsBySession) {
    const sessionRecentCount = await countRecentReadingEventsBySession(db, sessionId);
    if (sessionRecentCount + incomingCount > novelReadingEventSessionRateLimitPerMinute) {
      return { limited: true, scope: 'session', retryAfterSeconds: novelReadingEventRateLimitWindowSeconds };
    }
  }

  return { limited: false, scope: '', retryAfterSeconds: 0 };
};

const normalizeProductFeedbackText = (value, options = {}) => {
  const field = options.field || 'Field';
  const minLength = Math.max(0, Number(options.minLength || 0));
  const maxLength = Math.max(minLength, Number(options.maxLength || 500));
  const text = String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (text.length < minLength) {
    const error = new Error(`${field} is too short.`);
    error.code = 'PRODUCT_FEEDBACK_TOO_SHORT';
    throw error;
  }
  if (text.length > maxLength) {
    const error = new Error(`${field} must be ${maxLength} characters or fewer.`);
    error.code = 'PRODUCT_FEEDBACK_TOO_LONG';
    throw error;
  }
  return text;
};

const selectProductFeedbackById = async (db, id) =>
  db.prepare('SELECT * FROM product_feedback WHERE id = ? LIMIT 1').bind(id).first();

const handleProductFeedbackSubmit = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Feedback database is not configured.' }, { status: 500 });
  if (!(await ensureProductFeedbackReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'PRODUCT_FEEDBACK_NOT_READY',
        message: 'Product feedback is not initialized. Apply migration 0018_product_feedback.sql.'
      },
      { status: 503 }
    );
  }

  const maxRequestBytes = 24 * 1024;
  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > maxRequestBytes) {
    return privateJson({ ok: false, code: 'PRODUCT_FEEDBACK_TOO_LARGE', message: 'Feedback request is too large.' }, { status: 413 });
  }

  let payload;
  try {
    const bodyText = await request.text();
    if (bodyText.length > maxRequestBytes) {
      return privateJson({ ok: false, code: 'PRODUCT_FEEDBACK_TOO_LARGE', message: 'Feedback request is too large.' }, { status: 413 });
    }
    payload = JSON.parse(bodyText);
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid request body.' }, { status: 400 });
  }

  // A filled honeypot is treated as accepted so automated submissions get no useful signal.
  if (cleanText(payload.website, 200)) {
    return privateJson({ ok: true, status: 'received', message: 'Feedback received.' });
  }

  const product = cleanText(payload.product || 'privatepinyin', 80).toLowerCase();
  const platform = cleanText(payload.platform, 40).toLowerCase();
  const issueType = cleanText(payload.issueType || payload.issue_type, 40).toLowerCase();
  const impact = cleanText(payload.impact || 'normal', 40).toLowerCase();
  const appVersion = cleanText(payload.appVersion || payload.version, 40);
  const locale = normalizeContentLocale(payload.locale || 'zh-Hant');
  const contactEmail = normalizeEmail(payload.contactEmail || payload.email);
  if (!productFeedbackProducts.has(product)) {
    return privateJson({ ok: false, code: 'INVALID_PRODUCT', message: 'Unsupported product.' }, { status: 400 });
  }
  if (!productFeedbackPlatforms.has(platform)) {
    return privateJson({ ok: false, code: 'INVALID_PLATFORM', message: 'Select a valid platform.' }, { status: 400 });
  }
  if (!productFeedbackIssueTypes.has(issueType)) {
    return privateJson({ ok: false, code: 'INVALID_ISSUE_TYPE', message: 'Select a valid issue type.' }, { status: 400 });
  }
  if (!productFeedbackImpacts.has(impact)) {
    return privateJson({ ok: false, code: 'INVALID_IMPACT', message: 'Select a valid impact level.' }, { status: 400 });
  }
  if (!appVersion) {
    return privateJson({ ok: false, code: 'VERSION_REQUIRED', message: 'Enter the app version.' }, { status: 400 });
  }
  if (contactEmail && !isEmail(contactEmail)) {
    return privateJson({ ok: false, code: 'INVALID_EMAIL', message: 'Enter a valid contact email.' }, { status: 400 });
  }

  let summary;
  let details;
  let reproductionSteps;
  let environment;
  try {
    summary = normalizeProductFeedbackText(payload.summary || payload.title, {
      field: 'Summary',
      minLength: 4,
      maxLength: 120
    });
    details = normalizeProductFeedbackText(payload.details || payload.description, {
      field: 'Details',
      minLength: 20,
      maxLength: 4000
    });
    reproductionSteps = normalizeProductFeedbackText(payload.reproductionSteps || payload.steps, {
      field: 'Reproduction steps',
      maxLength: 2000
    });
    environment = normalizeProductFeedbackText(payload.environment, {
      field: 'Environment',
      maxLength: 500
    });
  } catch (error) {
    return privateJson(
      { ok: false, code: error.code || 'INVALID_PRODUCT_FEEDBACK', message: error.message },
      { status: 400 }
    );
  }

  const clientHashes = await getRequestClientHashes(request);
  const recentRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM product_feedback
       WHERE ip_hash = ?
         AND created_at >= datetime('now', '-' || ? || ' seconds')`
    )
    .bind(clientHashes.ipHash, productFeedbackSubmitWindowSeconds)
    .first();
  if (normalizePositiveInteger(recentRow?.count, 0) >= productFeedbackSubmitLimitPerWindow) {
    return privateJson(
      {
        ok: false,
        code: 'PRODUCT_FEEDBACK_RATE_LIMITED',
        message: 'Too many feedback submissions. Please try again later.'
      },
      {
        status: 429,
        headers: { 'retry-after': String(productFeedbackSubmitWindowSeconds) }
      }
    );
  }

  const id = `pf_${randomHex(16)}`;
  const sourcePath = cleanRedirectPath(payload.sourcePath || payload.path, '/zh-hant/apps/privatepinyin/');
  const metadata = {
    viewportWidth: normalizeNullableInteger(payload.viewportWidth, { min: 0, max: 10000 })
  };
  await db
    .prepare(
      `INSERT INTO product_feedback (
        id, product, platform, app_version, issue_type, impact,
        summary, details, reproduction_steps, environment, contact_email,
        status, source_path, locale, metadata_json, ip_hash, user_agent_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      product,
      platform,
      appVersion,
      issueType,
      impact,
      summary,
      details,
      reproductionSteps,
      environment,
      contactEmail,
      sourcePath,
      locale,
      JSON.stringify(metadata),
      clientHashes.ipHash,
      clientHashes.ipUaHash
    )
    .run();

  const feedback = await selectProductFeedbackById(db, id);
  return privateJson({
    ok: true,
    feedback: productFeedbackToJson(feedback),
    message: 'Feedback received.'
  });
};

const normalizeReaderCommentBody = (value) => {
  const body = String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (body.length < readerCommentMinBodyLength) {
    const error = new Error('评论内容太短。');
    error.code = 'READER_COMMENT_TOO_SHORT';
    throw error;
  }
  if (body.length > readerCommentMaxBodyLength) {
    const error = new Error(`评论最多 ${readerCommentMaxBodyLength} 个字符。`);
    error.code = 'READER_COMMENT_TOO_LONG';
    throw error;
  }
  return body;
};

const selectReaderCommentById = async (db, id) =>
  db
    .prepare(
      `SELECT
        reader_comments.*,
        reader_accounts.email,
        reader_accounts.display_name,
        reader_password_credentials.username
       FROM reader_comments
       INNER JOIN reader_accounts ON reader_accounts.id = reader_comments.account_id
       LEFT JOIN reader_password_credentials ON reader_password_credentials.account_id = reader_accounts.id
       WHERE reader_comments.id = ?
       LIMIT 1`
    )
    .bind(id)
    .first();

const getPublishedNovelChapterForComments = async (db, seriesSlug, chapterSlug, locale) => {
  if (!(await ensureContentTablesReady(db))) {
    const error = new Error('Content entries are not initialized.');
    error.code = 'CONTENT_ENTRIES_NOT_READY';
    throw error;
  }

  return db
    .prepare(
      `SELECT id, parent_slug, slug, locale, title, access_level
       FROM content_entries
       WHERE entry_type = 'novel_chapter'
         AND parent_slug = ?
         AND slug = ?
         AND locale = ?
         AND status = 'published'
         AND visibility IN ('public', 'unlisted')
       ORDER BY COALESCE(published_at, updated_at) DESC, id DESC
       LIMIT 1`
    )
    .bind(seriesSlug, chapterSlug, locale)
    .first();
};

const getNovelChapterAccessRequired = (chapter) => {
  const accessLevel = cleanText(chapter?.access_level || 'free', 40).toLowerCase();
  if (!accessLevel || accessLevel === 'free' || accessLevel === 'public') return 'free';
  if (accessLevel === 'supporter') return 'supporter';
  return 'paid';
};

const resolveReaderChapterAccessForComments = async (db, env, session, chapter) => {
  const accessRequired = getNovelChapterAccessRequired(chapter);
  if (accessRequired === 'free') {
    return {
      accessRequired,
      allowed: true,
      authenticated: Boolean(session),
      protected: false,
      reason: 'free'
    };
  }

  if (!session) {
    return {
      accessRequired,
      allowed: false,
      authenticated: false,
      protected: true,
      reason: 'sign_in_required'
    };
  }

  const [membershipSettings, membership] = accessRequired === 'paid'
    ? await Promise.all([
        getReaderMembershipSettings(db, env),
        getActiveReaderMembership(db, session.account_id)
      ])
    : [{ membershipCoversPaidContent: false }, null];
  const membershipAllowed = Boolean(membership && membershipSettings.enabled && membershipSettings.membershipCoversPaidContent);
  if (membershipAllowed) {
    return {
      accessRequired,
      allowed: true,
      authenticated: true,
      membership,
      protected: true,
      reason: 'membership_active'
    };
  }

  const entitlement = await findActiveNovelEntitlement(db, session.account_id, chapter.parent_slug, chapter.slug, accessRequired);
  return {
    accessRequired,
    allowed: Boolean(entitlement),
    authenticated: true,
    entitlement,
    protected: true,
    reason: entitlement ? 'entitled' : 'entitlement_required'
  };
};

const commentAccessDeniedPayload = (access) => ({
  accessRequired: access.accessRequired || 'paid',
  comments: [],
  ok: false,
  protected: true,
  reason: access.reason || 'entitlement_required'
});

const insertCommentSubmitReadingEvent = async (db, request, session, payload, comment, clientHashes) => {
  if (!(await ensureReadingEventsReady(db))) return;
  const event = normalizeReadingEventPayload(
    {
      blockIndex: payload.blockIndex,
      chapterSlug: comment.chapter_slug,
      clientEventId: `comment:${comment.id}`,
      durationMs: payload.durationMs,
      eventType: 'comment_submit',
      locale: comment.locale,
      metadata: {
        commentId: comment.id,
        length: comment.body.length,
        status: comment.status
      },
      progressPercent: payload.progressPercent,
      seriesSlug: comment.series_slug,
      sessionId: payload.sessionId,
      sourcePath: payload.sourcePath || comment.source_path,
      value: comment.body.length
    },
    {
      chapterSlug: comment.chapter_slug,
      eventTypes: novelInternalReadingEventTypes,
      locale: comment.locale,
      seriesSlug: comment.series_slug,
      sourcePath: comment.source_path
    }
  );
  await db
    .prepare(
      `INSERT INTO reading_events (
        client_event_id, account_id, session_id, series_slug, chapter_slug, locale,
        event_type, event_value, progress_percent, block_index, duration_ms,
        source_path, metadata_json, ip_hash, user_agent_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_event_id) DO NOTHING`
    )
    .bind(
      event.clientEventId,
      session.account_id,
      event.sessionId,
      event.seriesSlug,
      event.chapterSlug,
      event.locale,
      event.eventType,
      event.eventValue,
      event.progressPercent,
      event.blockIndex,
      event.durationMs,
      event.sourcePath,
      JSON.stringify(event.metadata),
      clientHashes.ipHash,
      clientHashes.ipUaHash
    )
    .run();
};

const handlePublicNovelComments = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: true, comments: [], setupRequired: true });
  if (!(await ensureReaderCommentsReady(db))) {
    return json({ ok: true, comments: [], setupRequired: true });
  }

  const url = new URL(request.url);
  const seriesSlug = cleanSlug(url.searchParams.get('seriesSlug') || url.searchParams.get('series'), 160);
  const chapterSlug = cleanSlug(url.searchParams.get('chapterSlug') || url.searchParams.get('chapter'), 160);
  const locale = normalizeContentLocale(url.searchParams.get('locale') || 'zh-Hant');
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '30', 10) || 30, 1), 50);
  if (!seriesSlug || !chapterSlug) {
    return json({ ok: false, message: 'seriesSlug and chapterSlug are required.' }, { status: 400 });
  }

  let chapter;
  try {
    chapter = await getPublishedNovelChapterForComments(db, seriesSlug, chapterSlug, locale);
  } catch (error) {
    if (error.code === 'CONTENT_ENTRIES_NOT_READY') {
      return json(
        {
          ok: false,
          code: 'CONTENT_ENTRIES_NOT_READY',
          comments: [],
          message: 'Content entries are not initialized.'
        },
        { status: 503 }
      );
    }
    throw error;
  }
  if (!chapter) {
    return json(
      {
        ok: false,
        code: 'COMMENT_CHAPTER_NOT_FOUND',
        comments: [],
        message: 'Chapter was not found.'
      },
      { status: 404 }
    );
  }

  let access = await resolveReaderChapterAccessForComments(db, env, null, chapter);
  if (access.protected) {
    const session = await getReaderFromSession(request, env);
    access = await resolveReaderChapterAccessForComments(db, env, session, chapter);
    if (!access.allowed) {
      return json(
        {
          ...commentAccessDeniedPayload(access),
          code: access.authenticated ? 'CHAPTER_COMMENT_ACCESS_REQUIRED' : 'SIGN_IN_REQUIRED',
          message: access.authenticated ? '解锁后可查看评论。' : '请先登入会员账号，再查看本章评论。'
        },
        { status: access.authenticated ? 403 : 401 }
      );
    }
  }

  const response = await db
    .prepare(
      `SELECT
        reader_comments.*,
        reader_accounts.email,
        reader_accounts.display_name,
        reader_password_credentials.username
       FROM reader_comments
       INNER JOIN reader_accounts ON reader_accounts.id = reader_comments.account_id
       LEFT JOIN reader_password_credentials ON reader_password_credentials.account_id = reader_accounts.id
       WHERE reader_comments.series_slug = ?
         AND reader_comments.chapter_slug = ?
         AND reader_comments.locale = ?
         AND reader_comments.status = 'approved'
       ORDER BY reader_comments.created_at DESC, reader_comments.id DESC
       LIMIT ?`
    )
    .bind(seriesSlug, chapterSlug, locale, limit)
    .all();

  return json({
    ok: true,
    comments: (response.results || []).map((row) => readerCommentToJson(row))
  });
};

const handleReaderCommentSubmit = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  if (!(await ensureReaderCommentsReady(db))) {
    return json(
      {
        ok: false,
        code: 'READER_COMMENTS_NOT_READY',
        message: 'Reader comments are not initialized. Apply migration 0017_reader_comments.sql.'
      },
      { status: 503 }
    );
  }

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json(
      {
        ok: false,
        code: 'SIGN_IN_REQUIRED',
        message: '请先登入会员账号，再提交评论。'
      },
      { status: 401 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const seriesSlug = cleanSlug(payload.seriesSlug || payload.series, 160);
  const chapterSlug = cleanSlug(payload.chapterSlug || payload.chapter, 160);
  const locale = normalizeContentLocale(payload.locale || 'zh-Hant');
  if (!seriesSlug || !chapterSlug) {
    return json({ ok: false, message: 'seriesSlug and chapterSlug are required.' }, { status: 400 });
  }

  let chapter;
  try {
    chapter = await getPublishedNovelChapterForComments(db, seriesSlug, chapterSlug, locale);
  } catch (error) {
    if (error.code === 'CONTENT_ENTRIES_NOT_READY') {
      return json(
        {
          ok: false,
          code: 'CONTENT_ENTRIES_NOT_READY',
          message: 'Content entries are not initialized.'
        },
        { status: 503 }
      );
    }
    throw error;
  }
  if (!chapter) {
    return json(
      {
        ok: false,
        code: 'COMMENT_CHAPTER_NOT_FOUND',
        message: 'Chapter was not found.'
      },
      { status: 404 }
    );
  }

  const access = await resolveReaderChapterAccessForComments(db, env, session, chapter);
  if (!access.allowed) {
    return json(
      {
        ...commentAccessDeniedPayload(access),
        code: 'CHAPTER_COMMENT_ACCESS_REQUIRED',
        message: '解锁后才可以提交本章评论。'
      },
      { status: 403 }
    );
  }

  const recentCommentRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reader_comments
       WHERE account_id = ?
         AND created_at >= datetime('now', '-' || ? || ' seconds')`
    )
    .bind(session.account_id, readerCommentSubmitWindowSeconds)
    .first();
  if (normalizePositiveInteger(recentCommentRow?.count, 0) >= readerCommentSubmitLimitPerMinute) {
    return json(
      {
        ok: false,
        code: 'READER_COMMENT_RATE_LIMITED',
        message: '评论提交太频繁，请稍后再试。'
      },
      {
        status: 429,
        headers: { 'retry-after': String(readerCommentSubmitWindowSeconds) }
      }
    );
  }

  let body;
  try {
    body = normalizeReaderCommentBody(payload.body || payload.comment);
  } catch (error) {
    return json({ ok: false, code: error.code || 'INVALID_COMMENT', message: error.message }, { status: 400 });
  }

  const clientHashes = await getRequestClientHashes(request);
  const id = `rc_${randomHex(16)}`;
  const sourcePath = cleanRedirectPath(payload.sourcePath || payload.path, `/novel/${seriesSlug}/chapter/${chapterSlug}/`);
  const metadata = normalizeReadingEventMetadata({
    userAgentWidth: normalizeNullableInteger(payload.viewportWidth, { min: 0, max: 10000 }),
    readerVersion: 'v2'
  });
  await db
    .prepare(
      `INSERT INTO reader_comments (
        id, account_id, series_slug, chapter_slug, locale, body, status,
        source_path, metadata_json, ip_hash, user_agent_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
    .bind(
      id,
      session.account_id,
      seriesSlug,
      chapterSlug,
      locale,
      body,
      sourcePath,
      JSON.stringify(metadata),
      clientHashes.ipHash,
      clientHashes.ipUaHash
    )
    .run();

  const comment = await selectReaderCommentById(db, id);
  try {
    await insertCommentSubmitReadingEvent(db, request, session, payload, comment, clientHashes);
  } catch (error) {
    if (!isMissingReadingEventsError(error)) throw error;
  }

  return json({
    ok: true,
    comment: readerCommentToJson(comment),
    moderationRequired: true,
    message: '评论已提交，审核通过后会展示。'
  });
};

const handleNovelReadingEvents = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, code: 'READING_EVENTS_DB_NOT_CONFIGURED', message: 'Reading events database is not configured.' }, { status: 500 });

  if (!(await ensureReadingEventsReady(db))) {
    return json(
      {
        ok: false,
        code: 'READING_EVENTS_NOT_READY',
        message: 'Reading events are not initialized. Apply migration 0014_reading_events.sql.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, code: 'INVALID_JSON', message: 'Invalid request body.' }, { status: 400 });
  }

  const rawEvents = Array.isArray(payload.events) ? payload.events : [payload];
  const limitedEvents = rawEvents.slice(0, novelReadingEventMaxBatchSize);
  if (!limitedEvents.length) {
    return json({ ok: false, code: 'NO_READING_EVENTS', message: 'At least one reading event is required.' }, { status: 400 });
  }

  const [session, clientHashes] = await Promise.all([
    getReaderFromSession(request, env),
    getRequestClientHashes(request)
  ]);
  let events;
  try {
    events = limitedEvents.map((event) =>
      normalizeReadingEventPayload(event, {
        chapterSlug: payload.chapterSlug || payload.chapter,
        locale: payload.locale,
        seriesSlug: payload.seriesSlug || payload.series,
        sessionId: payload.sessionId,
        sourcePath: payload.sourcePath || payload.path
      })
    );
  } catch (error) {
    return json({ ok: false, code: error.code || 'INVALID_READING_EVENT', message: error.message }, { status: 400 });
  }

  const rateLimit = await checkNovelReadingEventRateLimit(db, events, clientHashes);
  if (rateLimit.limited) {
    return json(
      {
        ok: false,
        accepted: 0,
        code: 'READING_EVENTS_RATE_LIMITED',
        message: 'Too many reading events. Please retry shortly.'
      },
      {
        status: 429,
        headers: { 'retry-after': String(rateLimit.retryAfterSeconds) }
      }
    );
  }

  const statements = events.map((event) =>
    db
      .prepare(
        `INSERT INTO reading_events (
          client_event_id, account_id, session_id, series_slug, chapter_slug, locale,
          event_type, event_value, progress_percent, block_index, duration_ms,
          source_path, metadata_json, ip_hash, user_agent_hash
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(client_event_id) DO NOTHING`
      )
      .bind(
        event.clientEventId,
        session?.account_id || null,
        event.sessionId,
        event.seriesSlug,
        event.chapterSlug,
        event.locale,
        event.eventType,
        event.eventValue,
        event.progressPercent,
        event.blockIndex,
        event.durationMs,
        event.sourcePath,
        JSON.stringify(event.metadata),
        clientHashes.ipHash,
        clientHashes.ipUaHash
      )
  );

  await db.batch(statements);

  return json({
    ok: true,
    accepted: events.length,
    truncated: rawEvents.length > events.length
  });
};

const roundRatio = (value, digits = 4) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
};

const parseSqlTimestampMs = (value) => {
  if (!value) return 0;
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : 0;
};

const readingDepthBucket = (depth) => {
  if (depth >= 90) return '90-100';
  if (depth >= 76) return '76-89';
  if (depth >= 51) return '51-75';
  if (depth >= 26) return '26-50';
  return '0-25';
};

const readingDropOffPosition = (depth) => {
  if (depth >= 76) return { position: 'late', label: '后段', order: 4 };
  if (depth >= 51) return { position: 'middle', label: '中段', order: 3 };
  if (depth >= 26) return { position: 'first_half', label: '前半段', order: 2 };
  return { position: 'opening', label: '开头', order: 1 };
};

const severityFromRate = (rate) => {
  if (rate >= 0.4) return 'high';
  if (rate >= 0.2) return 'medium';
  return 'low';
};

const normalizeNovelAnalyticsWindowDays = (value) =>
  Math.min(Math.max(normalizePositiveInteger(value, novelStatsDefaultSinceDays), 1), 365);

const buildNovelChapterStatsMetrics = ({
  eventRows = [],
  sessionRows = [],
  windowDays = novelStatsDefaultSinceDays,
  windowRow = {},
  seriesSlug = '',
  chapterSlug = '',
  locale = 'zh-Hant'
}) => {
  const eventCounts = eventRows.reduce((map, row) => {
    map.set(row.event_type, Number(row.count || 0));
    return map;
  }, new Map());
  const uniqueSessions = sessionRows.length;
  const depthDistribution = {
    '0-25': 0,
    '26-50': 0,
    '51-75': 0,
    '76-89': 0,
    '90-100': 0
  };
  const dropOffBuckets = new Map();

  let completedSessions = 0;
  let totalDepth = 0;
  let totalReadSeconds = 0;
  let timedSessions = 0;
  let likeSessions = 0;
  let bookmarkSessions = 0;
  let commentSessions = 0;

  sessionRows.forEach((row) => {
    const maxDepth = Math.max(
      normalizePositiveInteger(row.max_progress, 0),
      normalizePositiveInteger(row.max_scroll_depth, 0),
      normalizePositiveInteger(row.close_progress, 0)
    );
    const clampedDepth = Math.max(0, Math.min(100, maxDepth));
    const completed = clampedDepth >= 90;
    if (completed) completedSessions += 1;
    totalDepth += clampedDepth;
    depthDistribution[readingDepthBucket(clampedDepth)] += 1;

    if (!completed) {
      const dropOff = readingDropOffPosition(clampedDepth);
      const current = dropOffBuckets.get(dropOff.position) || { ...dropOff, count: 0 };
      current.count += 1;
      dropOffBuckets.set(dropOff.position, current);
    }

    const closeDurationSeconds = Math.round(Math.max(0, normalizePositiveInteger(row.close_duration_ms, 0)) / 1000);
    const firstMs = parseSqlTimestampMs(row.first_event_at);
    const lastMs = parseSqlTimestampMs(row.last_event_at);
    const observedSeconds = firstMs && lastMs && lastMs >= firstMs ? Math.round((lastMs - firstMs) / 1000) : 0;
    const sessionSeconds = closeDurationSeconds || observedSeconds;
    if (sessionSeconds > 0) {
      totalReadSeconds += Math.min(sessionSeconds, 24 * 60 * 60);
      timedSessions += 1;
    }

    if (Number(row.like_count || 0) > 0) likeSessions += 1;
    if (Number(row.bookmark_count || 0) > 0) bookmarkSessions += 1;
    if (Number(row.comment_count || 0) > 0) commentSessions += 1;
  });

  const completionRate = uniqueSessions ? completedSessions / uniqueSessions : 0;
  const avgScrollDepth = uniqueSessions ? totalDepth / uniqueSessions : 0;
  const likeRate = uniqueSessions ? likeSessions / uniqueSessions : 0;
  const bookmarkRate = uniqueSessions ? bookmarkSessions / uniqueSessions : 0;
  const commentRate = uniqueSessions ? commentSessions / uniqueSessions : 0;
  const engagementScore = Math.min(
    1,
    completionRate * 0.45 + (avgScrollDepth / 100) * 0.25 + likeRate * 0.15 + bookmarkRate * 0.1 + commentRate * 0.05
  );
  const dropOffPoints = [...dropOffBuckets.values()]
    .sort((left, right) => right.count - left.count || left.order - right.order)
    .map((bucket) => ({
      count: bucket.count,
      label: bucket.label,
      position: bucket.position,
      rate: roundRatio(uniqueSessions ? bucket.count / uniqueSessions : 0),
      severity: severityFromRate(uniqueSessions ? bucket.count / uniqueSessions : 0)
    }));

  return {
    accountReaders: normalizePositiveInteger(windowRow.account_readers, 0),
    avgReadTimeSeconds: timedSessions ? Math.round(totalReadSeconds / timedSessions) : 0,
    avgScrollDepth: roundRatio(avgScrollDepth, 2),
    bookmarkCount: normalizePositiveInteger(eventCounts.get('bookmark'), 0),
    chapterSlug,
    closeCount: normalizePositiveInteger(eventCounts.get('chapter_close'), 0),
    commentCount: normalizePositiveInteger(eventCounts.get('comment_submit'), 0),
    completionCount: completedSessions,
    completionRate: roundRatio(completionRate),
    dropOffPoints,
    dropOffRate: roundRatio(1 - completionRate),
    engagementScore: roundRatio(engagementScore),
    eventWindowEnd: windowRow.event_window_end || null,
    eventWindowStart: windowRow.event_window_start || null,
    likeCount: normalizePositiveInteger(eventCounts.get('like'), 0),
    locale,
    openCount: normalizePositiveInteger(eventCounts.get('chapter_open'), 0),
    scrollDepthDistribution: depthDistribution,
    seriesSlug,
    totalEvents: normalizePositiveInteger(windowRow.total_events, 0),
    uniqueSessions,
    windowDays: normalizeNovelAnalyticsWindowDays(windowDays)
  };
};

const chapterStatsToJson = (row) => ({
  id: row.id,
  seriesSlug: row.series_slug,
  chapterSlug: row.chapter_slug,
  locale: row.locale,
  windowDays: normalizeNovelAnalyticsWindowDays(row.window_days),
  title: row.title || '',
  seriesTitle: row.series_title || '',
  chapterNumber: row.chapter_number,
  totalEvents: normalizePositiveInteger(row.total_events, 0),
  uniqueSessions: normalizePositiveInteger(row.unique_sessions, 0),
  accountReaders: normalizePositiveInteger(row.account_readers, 0),
  openCount: normalizePositiveInteger(row.open_count, 0),
  closeCount: normalizePositiveInteger(row.close_count, 0),
  completionCount: normalizePositiveInteger(row.completion_count, 0),
  likeCount: normalizePositiveInteger(row.like_count, 0),
  bookmarkCount: normalizePositiveInteger(row.bookmark_count, 0),
  commentCount: normalizePositiveInteger(row.comment_count, 0),
  avgReadTimeSeconds: normalizePositiveInteger(row.avg_read_time_seconds, 0),
  avgScrollDepth: Number(row.avg_scroll_depth || 0),
  completionRate: Number(row.completion_rate || 0),
  dropOffRate: Number(row.drop_off_rate || 0),
  engagementScore: Number(row.engagement_score || 0),
  scrollDepthDistribution: parseStoredJson(row.scroll_depth_distribution_json, {}),
  dropOffPoints: parseStoredJson(row.drop_off_points_json, []),
  eventWindowStart: row.event_window_start,
  eventWindowEnd: row.event_window_end,
  calculatedAt: row.calculated_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const normalizeInsightList = (items) => [...new Set((items || []).filter(Boolean))].slice(0, 5);

const buildNovelAiInsightFromStats = (stat = {}) => {
  const completionRate = Number(stat.completionRate || stat.completion_rate || 0);
  const dropOffRate = Number(stat.dropOffRate || stat.drop_off_rate || 0);
  const engagementScore = Number(stat.engagementScore || stat.engagement_score || 0);
  const avgScrollDepth = Number(stat.avgScrollDepth || stat.avg_scroll_depth || 0);
  const avgReadTimeSeconds = normalizePositiveInteger(stat.avgReadTimeSeconds || stat.avg_read_time_seconds, 0);
  const uniqueSessions = normalizePositiveInteger(stat.uniqueSessions || stat.unique_sessions, 0);
  const likeCount = normalizePositiveInteger(stat.likeCount || stat.like_count, 0);
  const bookmarkCount = normalizePositiveInteger(stat.bookmarkCount || stat.bookmark_count, 0);
  const commentCount = normalizePositiveInteger(stat.commentCount || stat.comment_count, 0);
  const dropOffPoints = Array.isArray(stat.dropOffPoints) ? stat.dropOffPoints : parseStoredJson(stat.drop_off_points_json, []);
  const topDropOff = dropOffPoints[0] || null;
  const strongPoints = [];
  const weakPoints = [];
  const suggestions = [];

  if (uniqueSessions <= 3) {
    weakPoints.push('样本量偏小，建议继续观察更多阅读会话');
    suggestions.push('先不要用这一章单独判断剧情问题，等数据超过 10 个会话后再复盘。');
  }
  if (completionRate >= 0.7) {
    strongPoints.push('章节完成率较好，读者愿意读到后段');
  } else if (completionRate < 0.35 && uniqueSessions > 0) {
    weakPoints.push('完成率偏低，读者中途离开较多');
    suggestions.push('检查开头到中段是否有过长铺垫，尽早抛出冲突或悬念。');
  }

  if (engagementScore >= 0.65) {
    strongPoints.push('互动分表现稳定，内容具备继续追读信号');
  } else if (uniqueSessions > 0) {
    weakPoints.push('互动分偏弱，点赞、书签或评论提交信号不足');
    suggestions.push('在章节末尾增加更明确的情绪钩子，让读者有保存或继续下一章的理由。');
  }

  if (avgScrollDepth >= 75) {
    strongPoints.push('平均阅读深度较高，章节整体可读性不错');
  } else if (avgScrollDepth > 0 && avgScrollDepth < 45) {
    weakPoints.push('平均阅读深度偏浅，前半段可能没有足够抓人');
    suggestions.push('把人物目标、阻力和反转提前一点，减少进入主线前的解释性文字。');
  }

  if (topDropOff?.position) {
    const label = topDropOff.label || topDropOff.position;
    weakPoints.push(`${label}流失最明显`);
    if (topDropOff.position === 'opening') {
      suggestions.push('优先打磨开篇第一屏，让主角目标、危险或异常点更快出现。');
    } else if (topDropOff.position === 'middle' || topDropOff.position === 'first_half') {
      suggestions.push('中段可以增加一次选择、冲突或信息反转，避免读者在过渡段离开。');
    } else {
      suggestions.push('后段流失偏高时，检查结尾前是否有重复说明或节奏放缓。');
    }
  }

  if (bookmarkCount > 0) strongPoints.push('有读者保存书签，说明章节具备回看或续读价值');
  if (likeCount > 0) strongPoints.push('已有喜欢反馈，情绪点或人物表现有命中读者');
  if (commentCount > 0) strongPoints.push('已有真实评论提交，读者有表达想法的意愿');

  const riskLevel = completionRate < 0.35 || dropOffRate >= 0.7 ? 'high' : engagementScore < 0.45 ? 'medium' : 'normal';
  const mainPopularity = Math.min(1, engagementScore * 0.55 + completionRate * 0.35 + Math.min(bookmarkCount / Math.max(uniqueSessions, 1), 1) * 0.1);
  const villainPopularity = Math.min(1, engagementScore * 0.45 + Math.min(commentCount / Math.max(uniqueSessions, 1), 1) * 0.25 + dropOffRate * 0.15 + 0.1);
  const supportingPopularity = Math.min(1, engagementScore * 0.45 + Math.min(likeCount / Math.max(uniqueSessions, 1), 1) * 0.25 + completionRate * 0.2);

  return {
    character_popularity: {
      main: roundRatio(mainPopularity),
      supporting: roundRatio(supportingPopularity),
      villain: roundRatio(villainPopularity)
    },
    evidence: {
      avg_read_time_seconds: avgReadTimeSeconds,
      avg_scroll_depth: Math.round(avgScrollDepth),
      completion_rate: roundRatio(completionRate),
      drop_off_points: dropOffPoints.slice(0, 3),
      engagement_score: roundRatio(engagementScore),
      unique_sessions: uniqueSessions
    },
    risk_level: riskLevel,
    strong_points: normalizeInsightList(strongPoints.length ? strongPoints : ['暂未发现稳定强项，建议等待更多数据']),
    suggestions: normalizeInsightList(suggestions.length ? suggestions : ['保持当前节奏，继续观察下一批阅读数据。']),
    summary:
      riskLevel === 'high'
        ? '本章存在明显流失风险，优先检查开头和中段节奏。'
        : riskLevel === 'medium'
          ? '本章表现中等，有继续优化互动和停留时长的空间。'
          : '本章阅读表现较稳定，可以作为后续章节节奏参考。',
    weak_points: normalizeInsightList(weakPoints.length ? weakPoints : ['暂未发现明显弱点'])
  };
};

const aiInsightToJson = (row) => ({
  id: row.id,
  seriesSlug: row.series_slug,
  chapterSlug: row.chapter_slug,
  locale: row.locale,
  windowDays: normalizeNovelAnalyticsWindowDays(row.window_days),
  title: row.title || '',
  seriesTitle: row.series_title || '',
  chapterNumber: row.chapter_number,
  insight: parseStoredJson(row.insight_json, {}),
  model: row.model || 'station-cat-insight-v1',
  sourceStatsUpdatedAt: row.source_stats_updated_at || '',
  generatedAt: row.generated_at || '',
  createdAt: row.created_at || '',
  updatedAt: row.updated_at || ''
});

const upsertChapterStats = async (db, metrics) =>
  db
    .prepare(
      `INSERT INTO chapter_stats (
        series_slug, chapter_slug, locale, window_days, total_events, unique_sessions, account_readers,
        open_count, close_count, completion_count, like_count, bookmark_count, comment_count,
        avg_read_time_seconds, avg_scroll_depth, completion_rate, drop_off_rate, engagement_score,
        scroll_depth_distribution_json, drop_off_points_json, event_window_start, event_window_end
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_slug, chapter_slug, locale, window_days)
      DO UPDATE SET
        total_events = excluded.total_events,
        unique_sessions = excluded.unique_sessions,
        account_readers = excluded.account_readers,
        open_count = excluded.open_count,
        close_count = excluded.close_count,
        completion_count = excluded.completion_count,
        like_count = excluded.like_count,
        bookmark_count = excluded.bookmark_count,
        comment_count = excluded.comment_count,
        avg_read_time_seconds = excluded.avg_read_time_seconds,
        avg_scroll_depth = excluded.avg_scroll_depth,
        completion_rate = excluded.completion_rate,
        drop_off_rate = excluded.drop_off_rate,
        engagement_score = excluded.engagement_score,
        scroll_depth_distribution_json = excluded.scroll_depth_distribution_json,
        drop_off_points_json = excluded.drop_off_points_json,
        event_window_start = excluded.event_window_start,
        event_window_end = excluded.event_window_end,
        calculated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`
    )
    .bind(
      metrics.seriesSlug,
      metrics.chapterSlug,
      metrics.locale,
      metrics.windowDays,
      metrics.totalEvents,
      metrics.uniqueSessions,
      metrics.accountReaders,
      metrics.openCount,
      metrics.closeCount,
      metrics.completionCount,
      metrics.likeCount,
      metrics.bookmarkCount,
      metrics.commentCount,
      metrics.avgReadTimeSeconds,
      metrics.avgScrollDepth,
      metrics.completionRate,
      metrics.dropOffRate,
      metrics.engagementScore,
      JSON.stringify(metrics.scrollDepthDistribution),
      JSON.stringify(metrics.dropOffPoints),
      metrics.eventWindowStart,
      metrics.eventWindowEnd
    )
    .first();

const upsertNovelAiInsight = async (db, stat, insight) =>
  db
    .prepare(
      `INSERT INTO ai_insights (
        series_slug, chapter_slug, locale, window_days, insight_json, model, source_stats_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(series_slug, chapter_slug, locale, window_days)
      DO UPDATE SET
        insight_json = excluded.insight_json,
        model = excluded.model,
        source_stats_updated_at = excluded.source_stats_updated_at,
        generated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`
    )
    .bind(
      stat.seriesSlug,
      stat.chapterSlug,
      stat.locale,
      stat.windowDays,
      JSON.stringify(insight),
      'station-cat-insight-v1',
      stat.updatedAt || stat.calculatedAt || null
    )
    .first();

const aggregateNovelChapterStats = async (db, target, options = {}) => {
  const seriesSlug = cleanSlug(target.seriesSlug, 160);
  const chapterSlug = cleanSlug(target.chapterSlug, 160);
  const locale = normalizeContentLocale(target.locale || options.locale || 'zh-Hant');
  const windowDays = normalizeNovelAnalyticsWindowDays(options.windowDays || options.sinceDays);
  if (!seriesSlug || !chapterSlug) return null;

  const windowModifier = `-${windowDays} days`;
  const whereSql = `series_slug = ? AND chapter_slug = ? AND locale = ? AND created_at >= datetime('now', ?)`;
  const bindValues = [seriesSlug, chapterSlug, locale, windowModifier];

  const [eventResponse, sessionResponse, windowRow] = await Promise.all([
    db
      .prepare(
        `SELECT event_type, COUNT(*) AS count
         FROM reading_events
         WHERE ${whereSql}
         GROUP BY event_type`
      )
      .bind(...bindValues)
      .all(),
    db
      .prepare(
        `SELECT
          session_id,
          COUNT(*) AS event_count,
          MAX(CASE WHEN account_id IS NOT NULL THEN 1 ELSE 0 END) AS has_account,
          MIN(created_at) AS first_event_at,
          MAX(created_at) AS last_event_at,
          MAX(COALESCE(progress_percent, 0)) AS max_progress,
          MAX(CASE WHEN event_type = 'scroll_depth' THEN COALESCE(event_value, progress_percent, 0) ELSE 0 END) AS max_scroll_depth,
          MAX(CASE WHEN event_type = 'chapter_close' THEN COALESCE(progress_percent, 0) ELSE 0 END) AS close_progress,
          MAX(CASE WHEN event_type = 'chapter_close' AND duration_ms IS NOT NULL THEN duration_ms ELSE 0 END) AS close_duration_ms,
          SUM(CASE WHEN event_type = 'like' THEN 1 ELSE 0 END) AS like_count,
          SUM(CASE WHEN event_type = 'bookmark' THEN 1 ELSE 0 END) AS bookmark_count,
          SUM(CASE WHEN event_type = 'comment_submit' THEN 1 ELSE 0 END) AS comment_count
         FROM reading_events
         WHERE ${whereSql}
         GROUP BY session_id`
      )
      .bind(...bindValues)
      .all(),
    db
      .prepare(
        `SELECT
          COUNT(*) AS total_events,
          COUNT(DISTINCT account_id) AS account_readers,
          MIN(created_at) AS event_window_start,
          MAX(created_at) AS event_window_end
         FROM reading_events
         WHERE ${whereSql}`
      )
      .bind(...bindValues)
      .first()
  ]);

  const metrics = buildNovelChapterStatsMetrics({
    chapterSlug,
    eventRows: eventResponse.results || [],
    locale,
    seriesSlug,
    sessionRows: sessionResponse.results || [],
    windowDays,
    windowRow: windowRow || {}
  });

  if (!metrics.totalEvents) return null;
  return upsertChapterStats(db, metrics);
};

const findNovelAnalyticsTargets = async (db, options = {}) => {
  const seriesSlug = cleanSlug(options.seriesSlug, 160);
  const chapterSlug = cleanSlug(options.chapterSlug, 160);
  const locale = normalizeContentLocale(options.locale || 'zh-Hant');
  const limit = Math.min(Math.max(normalizePositiveInteger(options.limit, novelStatsMaxAggregateTargets), 1), novelStatsMaxAggregateTargets);
  const windowDays = normalizeNovelAnalyticsWindowDays(options.windowDays || options.sinceDays);
  const clauses = ['created_at >= datetime(\'now\', ?)'];
  const params = [`-${windowDays} days`];

  if (seriesSlug) {
    clauses.push('series_slug = ?');
    params.push(seriesSlug);
  }
  if (chapterSlug) {
    clauses.push('chapter_slug = ?');
    params.push(chapterSlug);
  }
  if (locale) {
    clauses.push('locale = ?');
    params.push(locale);
  }

  const response = await db
    .prepare(
      `SELECT series_slug, chapter_slug, locale, MAX(created_at) AS latest_event_at
       FROM reading_events
       WHERE ${clauses.join(' AND ')}
       GROUP BY series_slug, chapter_slug, locale
       ORDER BY latest_event_at DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return (response.results || []).map((row) => ({
    chapterSlug: row.chapter_slug,
    locale: row.locale,
    seriesSlug: row.series_slug
  }));
};

const handleAdminAggregateNovelAnalytics = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  if (!(await ensureReadingEventsReady(db))) {
    return privateJson(
      { ok: false, code: 'READING_EVENTS_NOT_READY', message: 'Reading events are not initialized. Apply migration 0014_reading_events.sql.' },
      { status: 503 }
    );
  }
  if (!(await ensureChapterStatsReady(db))) {
    return privateJson(
      { ok: false, code: 'CHAPTER_STATS_NOT_READY', message: 'Chapter stats are not initialized. Apply migration 0015_chapter_stats.sql.' },
      { status: 503 }
    );
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const windowDays = normalizeNovelAnalyticsWindowDays(payload.windowDays || payload.sinceDays);
  const targets = await findNovelAnalyticsTargets(db, {
    chapterSlug: payload.chapterSlug || payload.chapter,
    limit: payload.limit,
    locale: payload.locale,
    seriesSlug: payload.seriesSlug || payload.series,
    windowDays
  });
  const rows = [];
  for (const target of targets) {
    const row = await aggregateNovelChapterStats(db, target, { windowDays });
    if (row) rows.push(row);
  }

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'novel_analytics.aggregate',
    targetType: 'chapter_stats',
    targetId: '',
    targetSlug: cleanSlug(payload.seriesSlug || payload.series) || 'all',
    metadata: {
      aggregated: rows.length,
      requestedTargets: targets.length,
      windowDays
    }
  });

  return privateJson({
    ok: true,
    aggregated: rows.length,
    requestedTargets: targets.length,
    sinceDays: windowDays,
    windowDays,
    stats: rows.map(chapterStatsToJson)
  });
};

const handleAdminListNovelAnalyticsStats = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  if (!(await ensureChapterStatsReady(db))) {
    return privateJson(
      { ok: false, code: 'CHAPTER_STATS_NOT_READY', message: 'Chapter stats are not initialized. Apply migration 0015_chapter_stats.sql.' },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const seriesSlug = cleanSlug(url.searchParams.get('series') || url.searchParams.get('seriesSlug'), 160);
  const chapterSlug = cleanSlug(url.searchParams.get('chapter') || url.searchParams.get('chapterSlug'), 160);
  const locale = normalizeContentLocale(url.searchParams.get('locale') || 'zh-Hant');
  const windowDays = normalizeNovelAnalyticsWindowDays(url.searchParams.get('windowDays') || url.searchParams.get('sinceDays'));
  const limit = Math.min(Math.max(normalizePositiveInteger(url.searchParams.get('limit'), 50), 1), 100);
  const clauses = ['chapter_stats.locale = ?', 'chapter_stats.window_days = ?'];
  const params = [locale, windowDays];
  if (seriesSlug) {
    clauses.push('chapter_stats.series_slug = ?');
    params.push(seriesSlug);
  }
  if (chapterSlug) {
    clauses.push('chapter_stats.chapter_slug = ?');
    params.push(chapterSlug);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [summaryRow, response] = await Promise.all([
    db
      .prepare(
        `SELECT
          COUNT(*) AS chapter_count,
          COALESCE(SUM(total_events), 0) AS total_events,
          COALESCE(SUM(unique_sessions), 0) AS unique_sessions,
          COALESCE(SUM(open_count), 0) AS open_count,
          COALESCE(AVG(completion_rate), 0) AS avg_completion_rate,
          COALESCE(AVG(engagement_score), 0) AS avg_engagement_score,
          COALESCE(AVG(avg_read_time_seconds), 0) AS avg_read_time_seconds,
          MAX(updated_at) AS latest_updated_at
         FROM chapter_stats
         ${whereSql}`
      )
      .bind(...params)
      .first(),
    db
      .prepare(
        `SELECT
          chapter_stats.*,
          chapter_entries.title AS title,
          chapter_entries.chapter_number AS chapter_number,
          series_entries.title AS series_title
         FROM chapter_stats
         LEFT JOIN content_entries AS chapter_entries
           ON chapter_entries.entry_type = 'novel_chapter'
          AND chapter_entries.locale = chapter_stats.locale
          AND chapter_entries.parent_slug = chapter_stats.series_slug
          AND chapter_entries.slug = chapter_stats.chapter_slug
         LEFT JOIN content_entries AS series_entries
           ON series_entries.entry_type = 'novel_series'
          AND series_entries.locale = chapter_stats.locale
          AND series_entries.slug = chapter_stats.series_slug
         ${whereSql}
         ORDER BY chapter_stats.updated_at DESC, chapter_stats.engagement_score DESC, chapter_stats.id DESC
         LIMIT ?`
      )
      .bind(...params, limit)
      .all()
  ]);

  return privateJson({
    ok: true,
    summary: {
      avgCompletionRate: Number(summaryRow?.avg_completion_rate || 0),
      avgEngagementScore: Number(summaryRow?.avg_engagement_score || 0),
      avgReadTimeSeconds: Math.round(Number(summaryRow?.avg_read_time_seconds || 0)),
      chapterCount: normalizePositiveInteger(summaryRow?.chapter_count, 0),
      latestUpdatedAt: summaryRow?.latest_updated_at || '',
      openCount: normalizePositiveInteger(summaryRow?.open_count, 0),
      totalEvents: normalizePositiveInteger(summaryRow?.total_events, 0),
      uniqueSessions: normalizePositiveInteger(summaryRow?.unique_sessions, 0),
      windowDays
    },
    stats: (response.results || []).map(chapterStatsToJson)
  });
};

const queryNovelStatsRowsForInsights = async (db, options = {}) => {
  const seriesSlug = cleanSlug(options.seriesSlug || options.series, 160);
  const chapterSlug = cleanSlug(options.chapterSlug || options.chapter, 160);
  const locale = normalizeContentLocale(options.locale || 'zh-Hant');
  const windowDays = normalizeNovelAnalyticsWindowDays(options.windowDays || options.sinceDays);
  const limit = Math.min(Math.max(normalizePositiveInteger(options.limit, 50), 1), 100);
  const clauses = ['chapter_stats.locale = ?', 'chapter_stats.window_days = ?'];
  const params = [locale, windowDays];
  if (seriesSlug) {
    clauses.push('chapter_stats.series_slug = ?');
    params.push(seriesSlug);
  }
  if (chapterSlug) {
    clauses.push('chapter_stats.chapter_slug = ?');
    params.push(chapterSlug);
  }

  const response = await db
    .prepare(
      `SELECT
        chapter_stats.*,
        chapter_entries.title AS title,
        chapter_entries.chapter_number AS chapter_number,
        series_entries.title AS series_title
       FROM chapter_stats
       LEFT JOIN content_entries AS chapter_entries
         ON chapter_entries.entry_type = 'novel_chapter'
        AND chapter_entries.locale = chapter_stats.locale
        AND chapter_entries.parent_slug = chapter_stats.series_slug
        AND chapter_entries.slug = chapter_stats.chapter_slug
       LEFT JOIN content_entries AS series_entries
         ON series_entries.entry_type = 'novel_series'
        AND series_entries.locale = chapter_stats.locale
        AND series_entries.slug = chapter_stats.series_slug
       WHERE ${clauses.join(' AND ')}
       ORDER BY chapter_stats.updated_at DESC, chapter_stats.engagement_score DESC, chapter_stats.id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return (response.results || []).map(chapterStatsToJson);
};

const handleAdminGenerateNovelAiInsights = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  if (!(await ensureChapterStatsReady(db))) {
    return privateJson(
      { ok: false, code: 'CHAPTER_STATS_NOT_READY', message: 'Chapter stats are not initialized. Apply migration 0015_chapter_stats.sql.' },
      { status: 503 }
    );
  }
  if (!(await ensureAiInsightsReady(db))) {
    return privateJson(
      { ok: false, code: 'AI_INSIGHTS_NOT_READY', message: 'AI insights are not initialized. Apply migration 0016_ai_insights.sql.' },
      { status: 503 }
    );
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const windowDays = normalizeNovelAnalyticsWindowDays(payload.windowDays || payload.sinceDays);
  const stats = await queryNovelStatsRowsForInsights(db, {
    chapterSlug: payload.chapterSlug || payload.chapter,
    limit: payload.limit,
    locale: payload.locale,
    seriesSlug: payload.seriesSlug || payload.series,
    windowDays
  });
  const rows = [];
  for (const stat of stats) {
    const insight = buildNovelAiInsightFromStats(stat);
    const saved = await upsertNovelAiInsight(db, stat, insight);
    rows.push({
      ...saved,
      chapter_number: stat.chapterNumber,
      series_title: stat.seriesTitle,
      title: stat.title
    });
  }

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'novel_analytics.ai_insights.generate',
    targetType: 'ai_insights',
    targetId: '',
    targetSlug: cleanSlug(payload.seriesSlug || payload.series) || 'all',
    metadata: {
      generated: rows.length,
      requestedStats: stats.length,
      windowDays
    }
  });

  return privateJson({
    ok: true,
    generated: rows.length,
    requestedStats: stats.length,
    windowDays,
    insights: rows.map(aiInsightToJson)
  });
};

const handleAdminListNovelAiInsights = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  if (!(await ensureAiInsightsReady(db))) {
    return privateJson(
      { ok: false, code: 'AI_INSIGHTS_NOT_READY', message: 'AI insights are not initialized. Apply migration 0016_ai_insights.sql.' },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const seriesSlug = cleanSlug(url.searchParams.get('series') || url.searchParams.get('seriesSlug'), 160);
  const chapterSlug = cleanSlug(url.searchParams.get('chapter') || url.searchParams.get('chapterSlug'), 160);
  const locale = normalizeContentLocale(url.searchParams.get('locale') || 'zh-Hant');
  const windowDays = normalizeNovelAnalyticsWindowDays(url.searchParams.get('windowDays') || url.searchParams.get('sinceDays'));
  const limit = Math.min(Math.max(normalizePositiveInteger(url.searchParams.get('limit'), 50), 1), 100);
  const clauses = ['ai_insights.locale = ?', 'ai_insights.window_days = ?'];
  const params = [locale, windowDays];
  if (seriesSlug) {
    clauses.push('ai_insights.series_slug = ?');
    params.push(seriesSlug);
  }
  if (chapterSlug) {
    clauses.push('ai_insights.chapter_slug = ?');
    params.push(chapterSlug);
  }

  const response = await db
    .prepare(
      `SELECT
        ai_insights.*,
        chapter_entries.title AS title,
        chapter_entries.chapter_number AS chapter_number,
        series_entries.title AS series_title
       FROM ai_insights
       LEFT JOIN content_entries AS chapter_entries
         ON chapter_entries.entry_type = 'novel_chapter'
        AND chapter_entries.locale = ai_insights.locale
        AND chapter_entries.parent_slug = ai_insights.series_slug
        AND chapter_entries.slug = ai_insights.chapter_slug
       LEFT JOIN content_entries AS series_entries
         ON series_entries.entry_type = 'novel_series'
        AND series_entries.locale = ai_insights.locale
        AND series_entries.slug = ai_insights.series_slug
       WHERE ${clauses.join(' AND ')}
       ORDER BY ai_insights.generated_at DESC, ai_insights.updated_at DESC, ai_insights.id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return privateJson({
    ok: true,
    insights: (response.results || []).map(aiInsightToJson),
    windowDays
  });
};

const redeemReaderMembershipWithCredits = async (db, accountId, env) => {
  if (!(await ensureReaderMembershipsReady(db))) {
    const error = new Error('Reader memberships are not initialized. Apply migration 0009_reader_memberships.sql.');
    error.code = 'READER_MEMBERSHIPS_NOT_READY';
    throw error;
  }

  const settings = await getReaderMembershipSettings(db, env);
  if (!settings.enabled) {
    const error = new Error('Membership redemption is disabled.');
    error.code = 'MEMBERSHIP_DISABLED';
    throw error;
  }

  const config = getReaderCreditConfig(env);
  await ensureReaderCreditAccount(db, accountId, config);
  const costCredits = Math.max(1, settings.membershipCreditCost);
  const months = Math.max(1, settings.membershipDurationMonths);
  const sourceRef = `membership-${randomToken(12).toLowerCase()}`;

  const updatedAccount = await db
    .prepare(
      `UPDATE reader_credit_accounts
       SET balance_credits = balance_credits - ?,
           lifetime_spent_credits = lifetime_spent_credits + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ?
         AND balance_credits >= ?
       RETURNING *`
    )
    .bind(costCredits, costCredits, accountId, costCredits)
    .first();

  if (!updatedAccount) {
    const summary = await getReaderCreditSummary(db, accountId, env);
    const error = new Error('Insufficient reading credits for membership.');
    error.code = 'INSUFFICIENT_CREDITS';
    error.summary = summary;
    throw error;
  }

  const monthModifier = `+${months} month`;
  const membership = await db
    .prepare(
      `INSERT INTO reader_memberships (
        account_id, membership_level, source, source_ref, started_at, expires_at,
        last_redeemed_at, metadata_json
      )
      VALUES (?, 'member', ?, ?, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, ?), CURRENT_TIMESTAMP, ?)
      ON CONFLICT(account_id)
      DO UPDATE SET
        membership_level = 'member',
        source = excluded.source,
        source_ref = excluded.source_ref,
        expires_at = datetime(
          CASE
            WHEN reader_memberships.expires_at > CURRENT_TIMESTAMP THEN reader_memberships.expires_at
            ELSE CURRENT_TIMESTAMP
          END,
          ?
        ),
        last_redeemed_at = CURRENT_TIMESTAMP,
        metadata_json = excluded.metadata_json,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`
    )
    .bind(
      accountId,
      novelCreditLedgerMembershipSource,
      sourceRef,
      monthModifier,
      JSON.stringify({
        costCredits,
        months,
        membershipCoversPaidContent: settings.membershipCoversPaidContent
      }),
      monthModifier
    )
    .first();

  const ledger = await db
    .prepare(
      `INSERT INTO reader_credit_ledger (
        account_id, entry_type, credits_delta, balance_after, source, source_ref,
        series_slug, chapter_slug, note, metadata_json
      )
      VALUES (?, 'membership_redeem', ?, ?, ?, ?, '', '', ?, ?)
      RETURNING *`
    )
    .bind(
      accountId,
      -costCredits,
      updatedAccount.balance_credits,
      novelCreditLedgerMembershipSource,
      sourceRef,
      `Redeemed ${months} month membership with ${costCredits} ${config.unitLabel}.`,
      JSON.stringify({
        costCredits,
        months,
        expiresAt: membership.expires_at
      })
    )
    .first();

  return {
    account: updatedAccount,
    ledger,
    membership,
    settings
  };
};

const handleReaderMembershipRedeem = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json(
      {
        ok: false,
        code: 'SIGN_IN_REQUIRED',
        message: 'Please sign in before redeeming membership.'
      },
      { status: 401 }
    );
  }

  let redeem;
  try {
    redeem = await redeemReaderMembershipWithCredits(db, session.account_id, env);
  } catch (error) {
    const status =
      error.code === 'INSUFFICIENT_CREDITS'
        ? 402
        : error.code === 'READER_MEMBERSHIPS_NOT_READY'
          ? 503
          : 400;
    return json(
      {
        ok: false,
        code: error.code || 'MEMBERSHIP_REDEEM_FAILED',
        message: error.message,
        ...(error.summary || {})
      },
      { status }
    );
  }

  const summary = await getReaderCreditSummary(db, session.account_id, env);
  return json({
    ok: true,
    redeemed: true,
    costCredits: redeem.settings.membershipCreditCost,
    membership: readerMembershipToJson(redeem.membership),
    ledger: readerCreditLedgerToJson(redeem.ledger),
    account: {
      id: session.account_id,
      email: session.email
    },
    ...summary
  });
};

const hasCreditTopupLedger = async (db, accountId, sourceRef) =>
  db
    .prepare(
      `SELECT *
       FROM reader_credit_ledger
       WHERE account_id = ?
         AND entry_type = 'topup'
         AND source = ?
         AND source_ref = ?
       LIMIT 1`
    )
    .bind(accountId, novelCreditLedgerTopupSource, sourceRef)
    .first();

const recordReaderCreditTopup = async (db, accountId, credits, sourceRef, note, metadata, config) => {
  const account = await ensureReaderCreditAccount(db, accountId, config);
  const updatedAccount = await db
    .prepare(
      `UPDATE reader_credit_accounts
       SET balance_credits = balance_credits + ?,
           lifetime_purchased_credits = lifetime_purchased_credits + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ?
       RETURNING *`
    )
    .bind(credits, credits, account.account_id)
    .first();

  const ledger = await db
    .prepare(
      `INSERT INTO reader_credit_ledger (
        account_id, entry_type, credits_delta, balance_after, source, source_ref,
        series_slug, chapter_slug, note, metadata_json
      )
      VALUES (?, 'topup', ?, ?, ?, ?, '', '', ?, ?)
      RETURNING *`
    )
    .bind(
      account.account_id,
      credits,
      updatedAccount.balance_credits,
      novelCreditLedgerTopupSource,
      sourceRef,
      note,
      JSON.stringify(metadata || {})
    )
    .first();

  return {
    account: updatedAccount,
    ledger
  };
};

const applyCreditTopupFromOrder = async (db, order, env) => {
  if (!order) return { credited: false, reason: 'order_not_found' };
  if (order.order_type !== novelCreditPackOrderType) return { credited: false, reason: 'not_credit_pack_order' };
  if (!novelPaymentGrantStatuses.includes(order.status)) return { credited: false, reason: 'status_not_creditable' };
  if (!order.account_id) return { credited: false, reason: 'missing_reader_account' };

  const metadata = parseOrderMetadata(order);
  const credits = normalizePositiveInteger(metadata.creditPackCredits, 0);
  if (!credits) return { credited: false, reason: 'missing_credit_pack_metadata' };

  const sourceRef = order.order_token || order.provider_payment_id || order.provider_order_id || `order-${order.id}`;
  const existing = await hasCreditTopupLedger(db, order.account_id, sourceRef);
  if (existing) {
    return {
      credited: false,
      reason: 'already_credited',
      ledger: existing
    };
  }

  const config = getReaderCreditConfig(env);
  const note = `Automatically credited from NOWPayments ${order.status} order ${sourceRef}.`;
  const result = await recordReaderCreditTopup(db, order.account_id, credits, sourceRef, note, metadata, config);

  return {
    credited: true,
    reason: 'credited',
    account: result.account,
    ledger: result.ledger,
    credits
  };
};

const normalizeCreditUnlockPayload = async (payload, env, db) => {
  const seriesSlug = cleanSlug(payload.seriesSlug);
  const chapterSlug = cleanSlug(payload.chapterSlug);
  const accessRequired = payload.access === 'supporter' ? 'supporter' : 'paid';

  if (!seriesSlug || !chapterSlug) {
    const error = new Error('seriesSlug and chapterSlug are required.');
    error.code = 'INVALID_CREDIT_UNLOCK';
    throw error;
  }
  if (accessRequired !== 'paid') {
    const error = new Error('Reading credits can only unlock paid chapters in this stage.');
    error.code = 'CREDIT_UNLOCK_SCOPE_NOT_SUPPORTED';
    throw error;
  }

  const settings = await resolveSeriesPaymentSettings(db, seriesSlug, env, {
    chapterSlug,
    locale: payload.locale
  });

  return {
    accessRequired,
    chapterSlug,
    costCredits: Math.max(1, normalizePositiveInteger(settings.chapterCredits, getReaderCreditConfig(env).chapterCostCredits)),
    pricingSource: settings.source,
    seriesSlug
  };
};

const spendReaderCreditsForChapter = async (db, accountId, unlock, env) => {
  const config = getReaderCreditConfig(env);
  await ensureReaderCreditAccount(db, accountId, config);

  const updatedAccount = await db
    .prepare(
      `UPDATE reader_credit_accounts
       SET balance_credits = balance_credits - ?,
           lifetime_spent_credits = lifetime_spent_credits + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ?
         AND balance_credits >= ?
       RETURNING *`
    )
    .bind(unlock.costCredits, unlock.costCredits, accountId, unlock.costCredits)
    .first();

  if (!updatedAccount) {
    const summary = await getReaderCreditSummary(db, accountId, env);
    const error = new Error('Insufficient reading credits.');
    error.code = 'INSUFFICIENT_CREDITS';
    error.summary = summary;
    throw error;
  }

  const sourceRef = `${unlock.seriesSlug}/${unlock.chapterSlug}`;
  const ledger = await db
    .prepare(
      `INSERT INTO reader_credit_ledger (
        account_id, entry_type, credits_delta, balance_after, source, source_ref,
        series_slug, chapter_slug, note, metadata_json
      )
      VALUES (?, 'spend', ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .bind(
      accountId,
      -unlock.costCredits,
      updatedAccount.balance_credits,
      novelCreditLedgerUnlockSource,
      sourceRef,
      unlock.seriesSlug,
      unlock.chapterSlug,
      `Unlocked paid chapter with ${unlock.costCredits} ${config.unitLabel}.`,
      JSON.stringify({ costCredits: unlock.costCredits, pricingSource: unlock.pricingSource })
    )
    .first();

  return {
    account: updatedAccount,
    ledger
  };
};

const handleReaderCreditUnlock = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json(
      {
        ok: false,
        code: 'SIGN_IN_REQUIRED',
        message: 'Please sign in before using reading credits.'
      },
      { status: 401 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  let unlock;
  try {
    unlock = await normalizeCreditUnlockPayload(payload, env, db);
  } catch (error) {
    return json({ ok: false, code: error.code || 'INVALID_CREDIT_UNLOCK', message: error.message }, { status: 400 });
  }

  const existingEntitlement = await findActiveNovelEntitlement(
    db,
    session.account_id,
    unlock.seriesSlug,
    unlock.chapterSlug,
    unlock.accessRequired
  );
  if (existingEntitlement) {
    const summary = await getReaderCreditSummary(db, session.account_id, env);
    return json({
      ok: true,
      alreadyUnlocked: true,
      charged: false,
      entitlement: entitlementToJson({ ...existingEntitlement, email: session.email }),
      ...summary
    });
  }

  let spend;
  try {
    spend = await spendReaderCreditsForChapter(db, session.account_id, unlock, env);
  } catch (error) {
    const status = error.code === 'INSUFFICIENT_CREDITS' ? 402 : 400;
    return json(
      {
        ok: false,
        code: error.code || 'CREDIT_SPEND_FAILED',
        message: error.message,
        ...(error.summary || {})
      },
      { status }
    );
  }

  const entitlement = await upsertNovelEntitlement(db, {
    accountId: session.account_id,
    seriesSlug: unlock.seriesSlug,
    chapterSlug: unlock.chapterSlug,
    scope: 'chapter',
    accessLevel: 'paid',
    source: novelCreditSource,
    sourceRef: `credit-ledger-${spend.ledger.id}`,
    note: `Unlocked with ${unlock.costCredits} ${getReaderCreditConfig(env).unitLabel}.`,
    grantedBy: novelCreditSource
  });
  const summary = await getReaderCreditSummary(db, session.account_id, env);

  return json({
    ok: true,
    alreadyUnlocked: false,
    charged: true,
    costCredits: unlock.costCredits,
    pricingSource: unlock.pricingSource,
    ledger: readerCreditLedgerToJson(spend.ledger),
    entitlement: entitlementToJson({ ...entitlement, email: session.email }),
    ...summary
  });
};

const handleNovelPaymentsStatus = async (request, env) => {
  const config = getNowPaymentsConfig(env, request);
  const checkoutEnabled = config.hasApiKey && config.hasIpnSecret;
  const db = env.WAITLIST_DB;
  const creditPacks = db ? await getConfiguredReaderCreditPacks(db, env) : getReaderCreditConfig(env).packs;
  const membershipSettings = db ? await getReaderMembershipSettings(db, env) : {
    enabled: true,
    membershipCreditCost: defaultMembershipCreditCost,
    membershipDurationMonths: defaultMembershipMonths,
    membershipCoversPaidContent: true,
    unitLabel: getReaderCreditConfig(env).unitLabel
  };
  return json({
    ok: true,
    provider: nowPaymentsProvider,
    configured: {
      apiKey: config.hasApiKey,
      ipnSecret: config.hasIpnSecret,
      database: Boolean(env.WAITLIST_DB)
    },
    callbackPath: nowPaymentsWebhookPath,
    callbackUrl: config.callbackUrl,
    checkoutPath: novelCheckoutPath,
    publicCheckoutEnabled: checkoutEnabled,
    readerCredits: {
      enabled: checkoutEnabled,
      unitLabel: getReaderCreditConfig(env).unitLabel,
      chapterCostCredits: db ? await getConfiguredChapterCostCredits(db, env) : getReaderCreditConfig(env).chapterCostCredits,
      packs: creditPacks.map((pack) => ({
        credits: pack.credits,
        priceAmount: amountToStorage(pack.priceAmount),
        priceCurrency: pack.priceCurrency,
        label: pack.label
      })),
      membership: membershipSettings
    },
    automaticEntitlementGrants: true,
    supportedCurrencies: nowPaymentsSupportedCurrencies,
    orderStatuses: novelOrderStatuses,
    grantStatuses: novelPaymentGrantStatuses,
    note: checkoutEnabled
      ? 'Stage 5C grants reading entitlements after confirmed or finished NOWPayments reading orders.'
      : 'Checkout stays disabled until NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET are configured.'
  });
};

const createNowPaymentsInvoice = async (env, request, invoice) => {
  const config = getNowPaymentsConfig(env, request);
  const response = await fetch(`${config.apiBase}/invoice`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': String(env.NOWPAYMENTS_API_KEY || '').trim()
    },
    body: JSON.stringify(invoice)
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const message = cleanText(data.message || data.error || 'NOWPayments invoice creation failed.', 300);
    throw new Error(message || 'NOWPayments invoice creation failed.');
  }

  return data;
};

const normalizeCheckoutPayload = async (payload, session, env, db) => {
  const rawOrderType = cleanText(payload.orderType, 40).toLowerCase();
  const orderType =
    rawOrderType === 'tip'
      ? 'tip'
      : rawOrderType === 'supporter'
        ? 'supporter'
        : rawOrderType === novelCreditPackOrderType || rawOrderType === 'credits'
          ? novelCreditPackOrderType
          : rawOrderType === novelBundleOrderType || rawOrderType === 'bundle'
            ? novelBundleOrderType
            : 'chapter';
  const seriesSlug = cleanSlug(payload.seriesSlug);
  const chapterSlug = orderType === 'chapter' || orderType === novelBundleOrderType ? cleanSlug(payload.chapterSlug) : '';
  const prices = getCheckoutPrices(env);
  const payCurrency = normalizePayCurrency(payload.payCurrency);
  const locale = cleanText(payload.locale, 20);
  const returnPath = cleanRedirectPath(
    payload.returnPath,
    orderType === novelCreditPackOrderType ? '/library/' : seriesSlug ? `/novel/${seriesSlug}/` : '/library/'
  );

  if (orderType !== novelCreditPackOrderType && !seriesSlug) {
    throw new Error('seriesSlug is required.');
  }

  if (orderType !== novelCreditPackOrderType && orderType !== 'tip') {
    const error = new Error('Direct USD unlocks are disabled. Please buy reading credits, then unlock chapters with credits.');
    error.code = 'DIRECT_USD_UNLOCK_DISABLED';
    throw error;
  }

  if ((orderType === 'chapter' || orderType === novelBundleOrderType) && !chapterSlug) {
    throw new Error('chapterSlug is required for chapter checkout.');
  }

  if (orderType !== 'tip' && !session) {
    const error = new Error('Please sign in before unlocking paid reading.');
    error.code = 'SIGN_IN_REQUIRED';
    throw error;
  }

  if (orderType === novelCreditPackOrderType) {
    let pricingSource = 'reader-credit-pack';
    let creditPack = null;
    if (seriesSlug) {
      const settings = await resolveSeriesPaymentSettings(db, seriesSlug, env, { locale });
      const credits = normalizePositiveInteger(payload.credits || payload.packCredits, 0);
      const configuredPack = (settings.creditPacks || []).find((candidate) => candidate.credits === credits) || null;
      if (configuredPack) {
        creditPack = {
          ...configuredPack,
          unitLabel: getReaderCreditConfig(env).unitLabel
        };
        pricingSource = settings.source;
      }
    }
    creditPack = creditPack || (await findConfiguredReaderCreditPack(db, env, payload.credits || payload.packCredits));
    return {
      bundleDetails: null,
      chapterSlug: '',
      creditPack,
      description: `Station Cat reading credits: ${creditPack.credits} ${creditPack.unitLabel}`,
      entitlementAccessLevel: '',
      entitlementScope: '',
      locale,
      message: '',
      orderType,
      payCurrency,
      priceAmount: creditPack.priceAmount,
      priceCurrency: creditPack.priceCurrency,
      pricingSource,
      returnPath,
      seriesSlug
    };
  }

  const settings = await resolveSeriesPaymentSettings(db, seriesSlug, env, { chapterSlug, locale });
  let priceAmount = settings.chapterPriceAmount;
  let priceCurrency = settings.chapterPriceCurrency;
  let bundleDetails = null;

  if (orderType === 'tip') {
    if (!settings.tipsEnabled) {
      const error = new Error('Tips are disabled for this serial.');
      error.code = 'TIPS_DISABLED';
      throw error;
    }

    priceAmount = getConfiguredTipAmount(settings, payload.amount);
    if (!priceAmount) {
      const error = new Error('Tip amount is not configured for this serial.');
      error.code = 'TIP_AMOUNT_NOT_CONFIGURED';
      throw error;
    }
    if (priceAmount < prices.tipMin || priceAmount > prices.tipMax) {
      const error = new Error('Tip amount is outside the configured payment limits.');
      error.code = 'TIP_AMOUNT_OUT_OF_RANGE';
      throw error;
    }
    priceCurrency = settings.tipCurrency;
  } else if (orderType === 'supporter') {
    priceAmount = settings.supporterPriceAmount;
    priceCurrency = settings.supporterPriceCurrency;
  } else if (orderType === novelBundleOrderType) {
    bundleDetails = getBundleCheckoutDetails(settings, payload, chapterSlug);
    priceAmount = bundleDetails.priceAmount;
    priceCurrency = settings.chapterPriceCurrency;
  }

  const entitlementScope =
    orderType === 'chapter' || orderType === novelBundleOrderType ? 'chapter' : orderType === 'supporter' ? 'series' : '';
  const entitlementAccessLevel =
    orderType === 'chapter' || orderType === novelBundleOrderType ? 'paid' : orderType === 'supporter' ? 'supporter' : '';
  const description =
    orderType === 'tip'
      ? `Station Cat novel tip: ${seriesSlug}`
      : orderType === 'supporter'
        ? `Station Cat supporter unlock: ${seriesSlug}`
        : orderType === novelBundleOrderType
          ? `Station Cat bundle unlock: ${seriesSlug}/${chapterSlug} (${bundleDetails.bundleChapterCount} chapters)`
          : `Station Cat chapter unlock: ${seriesSlug}/${chapterSlug}`;

  return {
    bundleDetails,
    chapterSlug,
    description,
    entitlementAccessLevel,
    entitlementScope,
    locale,
    message: cleanText(payload.message, 500),
    orderType,
    payCurrency,
    priceAmount,
    priceCurrency,
    pricingSource: settings.source,
    returnPath,
    seriesSlug
  };
};

const insertNovelCheckoutOrder = async (db, session, checkout, orderToken) =>
  db
    .prepare(
      `INSERT INTO novel_orders (
        order_token, account_id, provider, provider_order_id, order_type,
        series_slug, chapter_slug, entitlement_scope, entitlement_access_level,
        price_amount, price_currency, pay_currency, status, customer_email, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .bind(
      orderToken,
      session?.account_id || null,
      nowPaymentsProvider,
      orderToken,
      checkout.orderType,
      checkout.seriesSlug,
      checkout.chapterSlug,
      checkout.entitlementScope,
      checkout.entitlementAccessLevel,
      amountToStorage(checkout.priceAmount),
      checkout.priceCurrency,
      checkout.payCurrency,
      'draft',
      session?.email || '',
      JSON.stringify({
        bundleChapterCount: checkout.bundleDetails?.bundleChapterCount || 0,
        bundleChapterSlugs: checkout.bundleDetails?.bundleChapterSlugs || [],
        bundleDiscountPercent: checkout.bundleDetails?.bundleDiscountPercent || 0,
        creditPackCredits: checkout.creditPack?.credits || 0,
        creditPackUnitLabel: checkout.creditPack?.unitLabel || '',
        locale: checkout.locale,
        message: checkout.message,
        pricingSource: checkout.pricingSource,
        pricePerCredit: checkout.creditPack?.credits
          ? amountToStorage(checkout.priceAmount / checkout.creditPack.credits)
          : '',
        subtotalAmount: checkout.bundleDetails ? amountToStorage(checkout.bundleDetails.subtotalAmount) : '',
        unitPriceAmount: checkout.bundleDetails ? amountToStorage(checkout.bundleDetails.unitPriceAmount) : '',
        returnPath: checkout.returnPath
      })
    )
    .first();

const insertNovelTipDraft = async (db, session, order, checkout) => {
  if (checkout.orderType !== 'tip') return null;
  return db
    .prepare(
      `INSERT INTO novel_tips (
        order_id, account_id, provider, provider_order_id, series_slug,
        amount, currency, message, status, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .bind(
      order.id,
      session?.account_id || null,
      nowPaymentsProvider,
      order.order_token,
      checkout.seriesSlug,
      amountToStorage(checkout.priceAmount),
      checkout.priceCurrency,
      checkout.message,
      'draft',
      JSON.stringify({ locale: checkout.locale, returnPath: checkout.returnPath })
    )
    .first();
};

const updateNovelCheckoutOrder = async (db, orderId, invoice, status = 'waiting') =>
  db
    .prepare(
      `UPDATE novel_orders
       SET provider_invoice_id = CASE WHEN ? <> '' THEN ? ELSE provider_invoice_id END,
           provider_order_id = CASE WHEN ? <> '' THEN ? ELSE provider_order_id END,
           payment_url = CASE WHEN ? <> '' THEN ? ELSE payment_url END,
           status = ?,
           provider_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
    .bind(
      normalizePaymentValue(invoice.id, 120),
      normalizePaymentValue(invoice.id, 120),
      normalizePaymentValue(invoice.order_id, 200),
      normalizePaymentValue(invoice.order_id, 200),
      normalizePaymentValue(invoice.invoice_url || invoice.payment_url, 500),
      normalizePaymentValue(invoice.invoice_url || invoice.payment_url, 500),
      status,
      normalizePaymentValue(invoice.payment_status || invoice.status || status, 80),
      orderId
    )
    .first();

const updateNovelTipFromOrder = async (db, order, status = order.status) =>
  db
    .prepare(
      `UPDATE novel_tips
       SET provider_order_id = ?,
           provider_payment_id = ?,
           status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ?`
    )
    .bind(order.provider_order_id, order.provider_payment_id, status, order.id)
    .run();

const markNovelCheckoutOrderFailed = async (db, orderId, message) =>
  db
    .prepare(
      `UPDATE novel_orders
       SET status = 'failed',
           provider_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
    .bind(cleanText(message, 200) || 'invoice_failed', orderId)
    .first();

const handleNovelCheckout = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const config = getNowPaymentsConfig(env, request);
  if (!config.hasApiKey || !config.hasIpnSecret) {
    return json(
      {
        ok: false,
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'NOWPayments checkout is not configured yet.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const session = await getReaderFromSession(request, env);
  let checkout;
  try {
    checkout = await normalizeCheckoutPayload(payload, session, env, db);
  } catch (error) {
    const status = error.code === 'SIGN_IN_REQUIRED' ? 401 : 400;
    return json({ ok: false, code: error.code || 'INVALID_CHECKOUT', message: error.message }, { status });
  }

  const orderToken = `sc-${randomToken(18).toLowerCase()}`;
  const order = await insertNovelCheckoutOrder(db, session, checkout, orderToken);
  await insertNovelTipDraft(db, session, order, checkout);

  try {
    const invoice = await createNowPaymentsInvoice(env, request, {
      price_amount: checkout.priceAmount,
      price_currency: checkout.priceCurrency,
      order_id: orderToken,
      order_description: checkout.description,
      ipn_callback_url: config.callbackUrl,
      success_url: paymentReturnUrl(request, checkout.returnPath, 'success', orderToken),
      cancel_url: paymentReturnUrl(request, checkout.returnPath, 'cancelled', orderToken),
      ...(checkout.payCurrency ? { pay_currency: checkout.payCurrency } : {})
    });

    const updatedOrder = await updateNovelCheckoutOrder(db, order.id, invoice, 'waiting');
    if (checkout.orderType === 'tip') await updateNovelTipFromOrder(db, updatedOrder, 'waiting');

    return json({
      ok: true,
      provider: nowPaymentsProvider,
      checkoutEnabled: true,
      paymentUrl: updatedOrder.payment_url,
      order: novelOrderToJson(updatedOrder)
    });
  } catch (error) {
    const failedOrder = await markNovelCheckoutOrderFailed(db, order.id, error.message);
    if (checkout.orderType === 'tip') await updateNovelTipFromOrder(db, failedOrder, 'failed');
    return json(
      {
        ok: false,
        code: 'NOWPAYMENTS_INVOICE_FAILED',
        message: error.message || 'NOWPayments invoice creation failed.',
        order: novelOrderToJson(failedOrder)
      },
      { status: 502 }
    );
  }
};

const findNovelOrderByNowPaymentsEvent = async (db, event) => {
  if (!event.providerOrderId && !event.providerPaymentId) return null;

  return db
    .prepare(
      `SELECT *
       FROM novel_orders
       WHERE provider = ?
         AND (
           order_token = ?
           OR (? <> '' AND provider_order_id = ?)
           OR (? <> '' AND provider_payment_id = ?)
         )
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .bind(
      nowPaymentsProvider,
      event.providerOrderId,
      event.providerOrderId,
      event.providerOrderId,
      event.providerPaymentId,
      event.providerPaymentId
    )
    .first();
};

const insertNovelPaymentEvent = async (db, event, payload, orderId = null) =>
  db
    .prepare(
      `INSERT INTO novel_payment_events (
        provider, order_id, provider_order_id, provider_payment_id, event_type,
        status, signature_valid, payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      nowPaymentsProvider,
      orderId,
      event.providerOrderId,
      event.providerPaymentId,
      'ipn',
      event.providerStatus || event.status,
      1,
      JSON.stringify(payload)
    )
    .run();

const updateNovelOrderFromNowPaymentsEvent = async (db, orderId, event) =>
  db
    .prepare(
      `UPDATE novel_orders
       SET provider_order_id = CASE WHEN ? <> '' THEN ? ELSE provider_order_id END,
           provider_payment_id = CASE WHEN ? <> '' THEN ? ELSE provider_payment_id END,
           provider_invoice_id = CASE WHEN ? <> '' THEN ? ELSE provider_invoice_id END,
           price_amount = CASE WHEN ? <> '' THEN ? ELSE price_amount END,
           price_currency = CASE WHEN ? <> '' THEN ? ELSE price_currency END,
           pay_amount = CASE WHEN ? <> '' THEN ? ELSE pay_amount END,
           pay_currency = CASE WHEN ? <> '' THEN ? ELSE pay_currency END,
           status = ?,
           provider_status = ?,
           confirmed_at = CASE
             WHEN ? IN ('confirmed', 'finished') AND confirmed_at IS NULL THEN CURRENT_TIMESTAMP
             ELSE confirmed_at
           END,
           finished_at = CASE
             WHEN ? = 'finished' AND finished_at IS NULL THEN CURRENT_TIMESTAMP
             ELSE finished_at
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
    .bind(
      event.providerOrderId,
      event.providerOrderId,
      event.providerPaymentId,
      event.providerPaymentId,
      event.providerInvoiceId,
      event.providerInvoiceId,
      event.priceAmount,
      event.priceAmount,
      event.priceCurrency,
      event.priceCurrency,
      event.payAmount,
      event.payAmount,
      event.payCurrency,
      event.payCurrency,
      event.status,
      event.providerStatus,
      event.status,
      event.status,
      orderId
    )
    .first();

const upsertNovelEntitlement = async (db, data) => {
  const source = cleanText(data.source || nowPaymentsProvider, 60) || nowPaymentsProvider;
  const grantedBy = cleanText(data.grantedBy || source, 120) || source;
  return db
    .prepare(
      `INSERT INTO novel_entitlements (
        account_id, series_slug, chapter_slug, scope, access_level, source, source_ref,
        note, granted_by, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(account_id, series_slug, chapter_slug, scope, access_level, source)
      DO UPDATE SET
        source_ref = excluded.source_ref,
        note = excluded.note,
        granted_by = excluded.granted_by,
        granted_at = CASE
          WHEN novel_entitlements.source_ref <> excluded.source_ref THEN CURRENT_TIMESTAMP
          ELSE novel_entitlements.granted_at
        END,
        expires_at = NULL,
        revoked_at = CASE
          WHEN novel_entitlements.source_ref <> excluded.source_ref THEN NULL
          ELSE novel_entitlements.revoked_at
        END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`
    )
    .bind(
      data.accountId,
      data.seriesSlug,
      data.chapterSlug,
      data.scope,
      data.accessLevel,
      source,
      data.sourceRef,
      data.note,
      grantedBy
    )
    .first();
};

const grantNovelEntitlementFromOrder = async (db, order) => {
  if (!order) return { granted: false, reason: 'order_not_found' };
  if (order.order_type === 'tip') return { granted: false, reason: 'tip_order' };
  if (!novelPaymentGrantStatuses.includes(order.status)) {
    return { granted: false, reason: 'status_not_grantable' };
  }
  if (!order.account_id) return { granted: false, reason: 'missing_reader_account' };

  const seriesSlug = cleanSlug(order.series_slug);
  const scope = order.entitlement_scope === 'series' ? 'series' : 'chapter';
  const chapterSlug = scope === 'chapter' ? cleanSlug(order.chapter_slug) : '';
  const accessLevel =
    order.entitlement_access_level === 'supporter'
      ? 'supporter'
      : order.entitlement_access_level === 'all'
        ? 'all'
        : 'paid';

  if (!seriesSlug) return { granted: false, reason: 'missing_series_slug' };
  if (scope === 'chapter' && !chapterSlug) return { granted: false, reason: 'missing_chapter_slug' };

  const sourceRef = order.order_token || order.provider_payment_id || order.provider_order_id || `order-${order.id}`;
  const note = `Automatically granted from NOWPayments ${order.status} order ${sourceRef}.`;
  const metadata = parseOrderMetadata(order);
  const bundleChapterSlugs =
    order.order_type === novelBundleOrderType && Array.isArray(metadata.bundleChapterSlugs)
      ? metadata.bundleChapterSlugs.map((slug) => cleanSlug(slug)).filter(Boolean)
      : [];
  const grantChapterSlugs = bundleChapterSlugs.length ? Array.from(new Set(bundleChapterSlugs)) : [chapterSlug];
  const entitlements = [];

  for (const targetChapterSlug of grantChapterSlugs) {
    if (scope === 'chapter' && !targetChapterSlug) continue;
    entitlements.push(
      await upsertNovelEntitlement(db, {
        accountId: order.account_id,
        seriesSlug,
        chapterSlug: scope === 'chapter' ? targetChapterSlug : '',
        scope,
        accessLevel,
        sourceRef,
        note
      })
    );
  }

  if (!entitlements.length) {
    return { granted: false, reason: 'missing_chapter_slug' };
  }

  return {
    accessLevel,
    entitlement: entitlements[0],
    entitlements,
    granted: true,
    reason: 'granted',
    scope,
    seriesSlug,
    chapterSlug: entitlements[0].chapter_slug
  };
};

const handleNowPaymentsWebhook = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const ipnSecret = String(env.NOWPAYMENTS_IPN_SECRET || '').trim();
  if (!ipnSecret) {
    return json({ ok: false, message: 'NOWPayments IPN secret is not configured.' }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 256000) {
    return json({ ok: false, message: 'Invalid NOWPayments payload.' }, { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, message: 'Invalid NOWPayments JSON payload.' }, { status: 400 });
  }

  const signature = request.headers.get('x-nowpayments-sig') || '';
  const isValid = await verifyNowPaymentsSignature(payload, signature, ipnSecret);
  if (!isValid) {
    return json({ ok: false, message: 'Invalid NOWPayments signature.' }, { status: 401 });
  }

  const event = extractNowPaymentsEvent(payload);
  const order = await findNovelOrderByNowPaymentsEvent(db, event);
  await insertNovelPaymentEvent(db, event, payload, order?.id || null);

  let updatedOrder = null;
  let entitlementGrant = { granted: false, reason: order ? 'not_processed' : 'order_not_found' };
  let creditGrant = { credited: false, reason: order ? 'not_processed' : 'order_not_found' };
  if (order) {
    updatedOrder = await updateNovelOrderFromNowPaymentsEvent(db, order.id, event);
    if (updatedOrder.order_type === 'tip') {
      await updateNovelTipFromOrder(db, updatedOrder, event.status);
      entitlementGrant = { granted: false, reason: 'tip_order' };
      creditGrant = { credited: false, reason: 'tip_order' };
    } else if (updatedOrder.order_type === novelCreditPackOrderType) {
      entitlementGrant = { granted: false, reason: 'credit_pack_order' };
      creditGrant = await applyCreditTopupFromOrder(db, updatedOrder, env);
    } else {
      entitlementGrant = await grantNovelEntitlementFromOrder(db, updatedOrder);
      creditGrant = { credited: false, reason: 'reading_order' };
    }
  }

  return json({
    ok: true,
    matched: Boolean(order),
    provider: nowPaymentsProvider,
    payment: {
      status: event.status,
      providerStatus: event.providerStatus,
      providerOrderId: event.providerOrderId,
      providerPaymentId: event.providerPaymentId
    },
    entitlementGrantEnabled: true,
    entitlementGrant: {
      granted: Boolean(entitlementGrant.granted),
      reason: entitlementGrant.reason,
      entitlement: entitlementGrant.entitlement ? entitlementToJson(entitlementGrant.entitlement) : null,
      entitlements: (entitlementGrant.entitlements || []).map(entitlementToJson)
    },
    creditGrantEnabled: true,
    creditGrant: {
      credited: Boolean(creditGrant.credited),
      reason: creditGrant.reason,
      credits: creditGrant.credits || 0,
      account: creditGrant.account
        ? readerCreditAccountToJson(creditGrant.account, getReaderCreditConfig(env))
        : null,
      ledger: creditGrant.ledger ? readerCreditLedgerToJson(creditGrant.ledger) : null
    },
    order: updatedOrder ? novelOrderToJson(updatedOrder) : null
  });
};

const findNovelOrderByToken = async (db, orderToken) =>
  db
    .prepare(
      `SELECT novel_orders.*, reader_accounts.email AS account_email
       FROM novel_orders
       LEFT JOIN reader_accounts ON reader_accounts.id = novel_orders.account_id
       WHERE novel_orders.order_token = ?
       LIMIT 1`
    )
    .bind(orderToken)
    .first();

const listNovelPaymentEventsForOrder = async (db, orderId) => {
  const response = await db
    .prepare(
      `SELECT id, provider, order_id, provider_order_id, provider_payment_id, event_type,
              status, signature_valid, received_at
       FROM novel_payment_events
       WHERE order_id = ?
       ORDER BY received_at DESC, id DESC
       LIMIT 10`
    )
    .bind(orderId)
    .all();

  return (response.results || []).map(novelPaymentEventToJson);
};

const listNovelEntitlementsForOrder = async (db, order) => {
  if (!order?.account_id || !order?.order_token) return [];
  const response = await db
    .prepare(
      `SELECT novel_entitlements.*, reader_accounts.email
       FROM novel_entitlements
       LEFT JOIN reader_accounts ON reader_accounts.id = novel_entitlements.account_id
       WHERE novel_entitlements.account_id = ?
         AND novel_entitlements.source_ref = ?
       ORDER BY novel_entitlements.updated_at DESC, novel_entitlements.id DESC
       LIMIT 20`
    )
    .bind(order.account_id, order.order_token)
    .all();

  return (response.results || []).map(entitlementToJson);
};

const listReaderCreditLedgerForOrder = async (db, order) => {
  if (!order?.account_id || !order?.order_token) return [];
  const response = await db
    .prepare(
      `SELECT *
       FROM reader_credit_ledger
       WHERE account_id = ?
         AND source = ?
         AND source_ref = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 10`
    )
    .bind(order.account_id, novelCreditLedgerTopupSource, order.order_token)
    .all();

  return (response.results || []).map(readerCreditLedgerToJson);
};

const summarizeNovelPaymentFulfillment = async (db, order) => {
  const paymentFinal = ['confirmed', 'finished', 'failed', 'expired', 'refunded'].includes(order.status);
  const paymentGrantable = novelPaymentGrantStatuses.includes(order.status);
  const waitingReason = paymentFinal ? `payment_${order.status}` : 'waiting_for_ipn';

  if (order.order_type === 'tip') {
    return {
      complete: paymentGrantable,
      kind: 'tip',
      needsReview: false,
      pending: !paymentFinal,
      reason: paymentGrantable ? 'tip_confirmed' : paymentFinal ? `tip_${order.status}` : waitingReason,
      entitlements: [],
      creditLedger: []
    };
  }

  if (order.order_type === novelCreditPackOrderType) {
    const creditLedger = await listReaderCreditLedgerForOrder(db, order);
    const complete = creditLedger.length > 0;
    return {
      complete,
      kind: novelCreditPackOrderType,
      needsReview: paymentGrantable && !complete,
      pending: !paymentFinal,
      reason: complete ? 'credits_credited' : paymentGrantable ? 'credit_topup_not_found' : waitingReason,
      entitlements: [],
      creditLedger
    };
  }

  const entitlements = await listNovelEntitlementsForOrder(db, order);
  const complete = entitlements.length > 0;
  return {
    complete,
    kind: order.order_type,
    needsReview: paymentGrantable && !complete,
    pending: !paymentFinal,
    reason: complete ? 'entitlement_granted' : paymentGrantable ? 'entitlement_not_found' : waitingReason,
    entitlements,
    creditLedger: []
  };
};

const handleNovelPaymentOrderStatus = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const orderToken = cleanText(url.searchParams.get('order') || url.searchParams.get('orderToken'), 80);
  if (!orderToken) {
    return privateJson({ ok: false, code: 'ORDER_REQUIRED', message: 'order is required.' }, { status: 400 });
  }

  const order = await findNovelOrderByToken(db, orderToken);
  if (!order) {
    return privateJson({ ok: false, code: 'ORDER_NOT_FOUND', message: 'Order was not found.' }, { status: 404 });
  }

  const session = await getReaderFromSession(request, env);
  if (order.account_id && !session) {
    return privateJson(
      {
        ok: false,
        authenticated: false,
        code: 'SIGN_IN_REQUIRED',
        message: 'Please sign in to view this order.'
      },
      { status: 401 }
    );
  }

  if (order.account_id && session.account_id !== order.account_id) {
    return privateJson(
      {
        ok: false,
        authenticated: true,
        code: 'ORDER_ACCOUNT_MISMATCH',
        message: 'This order belongs to another reader account.'
      },
      { status: 403 }
    );
  }

  const [events, fulfillment] = await Promise.all([
    listNovelPaymentEventsForOrder(db, order.id),
    summarizeNovelPaymentFulfillment(db, order)
  ]);

  return privateJson({
    ok: true,
    authenticated: Boolean(session),
    account: session
      ? {
          id: session.account_id,
          email: session.email
        }
      : null,
    provider: nowPaymentsProvider,
    order: novelOrderToJson(order),
    events,
    fulfillment: {
      ...fulfillment,
      nextCheckSeconds: fulfillment.complete || fulfillment.needsReview || !fulfillment.pending ? 0 : 5
    }
  });
};

const cleanupStaleUnfinishedNovelOrders = async (db) => {
  const staleOrderWhere = `status IN (${staleUnfinishedNovelOrderStatuses.map(() => '?').join(', ')})
       AND created_at < datetime('now', '-${staleUnfinishedNovelOrderHours} hours')`;
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM novel_orders WHERE ${staleOrderWhere}`)
    .bind(...staleUnfinishedNovelOrderStatuses)
    .first();
  const staleCount = Number(countRow?.count || 0);
  if (!staleCount) {
    return {
      deleted: 0,
      olderThanHours: staleUnfinishedNovelOrderHours,
      statuses: staleUnfinishedNovelOrderStatuses
    };
  }

  const eventDelete = db
    .prepare(
      `DELETE FROM novel_payment_events
       WHERE order_id IN (
         SELECT id FROM novel_orders WHERE ${staleOrderWhere}
       )`
    )
    .bind(...staleUnfinishedNovelOrderStatuses);
  const tipDelete = db
    .prepare(
      `DELETE FROM novel_tips
       WHERE order_id IN (
         SELECT id FROM novel_orders WHERE ${staleOrderWhere}
       )`
    )
    .bind(...staleUnfinishedNovelOrderStatuses);
  const orderDelete = db
    .prepare(`DELETE FROM novel_orders WHERE ${staleOrderWhere}`)
    .bind(...staleUnfinishedNovelOrderStatuses);
  const results = await db.batch([eventDelete, tipDelete, orderDelete]);

  return {
    deleted: getD1ChangeCount(results[2]) || staleCount,
    olderThanHours: staleUnfinishedNovelOrderHours,
    statuses: staleUnfinishedNovelOrderStatuses
  };
};

const handleAdminListNovelOrders = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  const cleanup = await cleanupStaleUnfinishedNovelOrders(db);

  const url = new URL(request.url);
  const status = cleanText(url.searchParams.get('status'), 40).toLowerCase();
  const orderType = cleanText(url.searchParams.get('orderType') || url.searchParams.get('type'), 40).toLowerCase();
  const normalizedEmail = normalizeEmail(url.searchParams.get('email'));
  const seriesSlug = cleanSlug(url.searchParams.get('series') || url.searchParams.get('seriesSlug'));
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

  if (normalizedEmail && !isEmail(normalizedEmail)) {
    return privateJson({ ok: false, message: 'Please enter a valid reader email.' }, { status: 400 });
  }

  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('novel_orders.status = ?');
    params.push(status);
  }
  if (orderType) {
    clauses.push('novel_orders.order_type = ?');
    params.push(orderType);
  }
  if (normalizedEmail) {
    clauses.push('reader_accounts.normalized_email = ?');
    params.push(normalizedEmail);
  }
  if (seriesSlug) {
    clauses.push('novel_orders.series_slug = ?');
    params.push(seriesSlug);
  }

  const response = await db
    .prepare(
      `SELECT novel_orders.*, reader_accounts.email AS account_email
       FROM novel_orders
       LEFT JOIN reader_accounts ON reader_accounts.id = novel_orders.account_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY novel_orders.updated_at DESC, novel_orders.id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return json({
    ok: true,
    cleanup,
    orders: (response.results || []).map(novelOrderToJson)
  });
};

const findNovelOrderByAdminIdentifier = async (db, identifier) => {
  const id = Number.parseInt(identifier?.id || identifier?.orderId || '', 10);
  const orderToken = cleanText(identifier?.orderToken || identifier?.order || '', 100);
  if (!id && !orderToken) return null;

  return db
    .prepare(
      `SELECT novel_orders.*, reader_accounts.email AS account_email
       FROM novel_orders
       LEFT JOIN reader_accounts ON reader_accounts.id = novel_orders.account_id
       WHERE (? > 0 AND novel_orders.id = ?)
          OR (? <> '' AND novel_orders.order_token = ?)
       LIMIT 1`
    )
    .bind(id || 0, id || 0, orderToken, orderToken)
    .first();
};

const buildAdminOrderDetail = async (db, order) => {
  const [events, fulfillment] = await Promise.all([
    listNovelPaymentEventsForOrder(db, order.id),
    summarizeNovelPaymentFulfillment(db, order)
  ]);
  return {
    order: novelOrderToJson(order),
    events,
    fulfillment: {
      ...fulfillment,
      nextCheckSeconds: 0
    }
  };
};

const handleAdminGetNovelOrder = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  await cleanupStaleUnfinishedNovelOrders(db);

  const url = new URL(request.url);
  const order = await findNovelOrderByAdminIdentifier(db, {
    id: url.searchParams.get('id') || url.searchParams.get('orderId'),
    orderToken: url.searchParams.get('order') || url.searchParams.get('orderToken')
  });
  if (!order) return privateJson({ ok: false, code: 'ORDER_NOT_FOUND', message: 'Order was not found.' }, { status: 404 });

  return privateJson({
    ok: true,
    ...(await buildAdminOrderDetail(db, order))
  });
};

const handleAdminFulfillNovelOrder = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const order = await findNovelOrderByAdminIdentifier(db, payload);
  if (!order) return privateJson({ ok: false, code: 'ORDER_NOT_FOUND', message: 'Order was not found.' }, { status: 404 });
  if (!order.account_id) {
    return privateJson({ ok: false, code: 'ORDER_ACCOUNT_REQUIRED', message: 'This order is not linked to a reader account.' }, { status: 409 });
  }
  if (!novelPaymentGrantStatuses.includes(order.status)) {
    return privateJson(
      {
        ok: false,
        code: 'ORDER_NOT_GRANTABLE',
        message: 'Only confirmed or finished orders can be fulfilled automatically. Use manual entitlement or credit adjustment for support cases.'
      },
      { status: 409 }
    );
  }

  const result =
    order.order_type === novelCreditPackOrderType
      ? { creditGrant: await applyCreditTopupFromOrder(db, order, env), entitlementGrant: { granted: false, reason: 'credit_pack_order' } }
      : { entitlementGrant: await grantNovelEntitlementFromOrder(db, order), creditGrant: { credited: false, reason: 'reading_order' } };

  const orderSourceRef = order.order_token || order.provider_payment_id || order.provider_order_id || `order-${order.id}`;
  if (result.entitlementGrant.granted) {
    await db
      .prepare(
        `UPDATE novel_entitlements
         SET revoked_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE account_id = ?
           AND source_ref = ?`
      )
      .bind(order.account_id, orderSourceRef)
      .run();
  }

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'novel_order.fulfill',
    targetType: 'novel_order',
    targetId: String(order.id),
    targetSlug: order.order_token,
    metadata: {
      orderType: order.order_type,
      status: order.status,
      accountId: order.account_id,
      restoredSourceRef: result.entitlementGrant.granted ? orderSourceRef : '',
      entitlementGrant: result.entitlementGrant,
      creditGrant: result.creditGrant
    }
  });

  const refreshedOrder = await findNovelOrderByAdminIdentifier(db, { id: order.id });
  return privateJson({
    ok: true,
    ...result,
    ...(await buildAdminOrderDetail(db, refreshedOrder || order))
  });
};

const handleAdminListReaderAccounts = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const normalizedEmail = normalizeEmail(url.searchParams.get('email'));
  const status = cleanText(url.searchParams.get('status'), 40).toLowerCase();
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);
  if (normalizedEmail && !isEmail(normalizedEmail)) {
    return privateJson({ ok: false, message: 'Please enter a valid reader email.' }, { status: 400 });
  }

  const clauses = [];
  const params = [];
  if (normalizedEmail) {
    clauses.push('reader_accounts.normalized_email = ?');
    params.push(normalizedEmail);
  }
  if (status) {
    clauses.push('reader_accounts.status = ?');
    params.push(status);
  }

  const response = await db
    .prepare(
      `SELECT
        reader_accounts.*,
        reader_credit_accounts.balance_credits,
        reader_credit_accounts.lifetime_purchased_credits,
        reader_credit_accounts.lifetime_spent_credits,
        reader_credit_accounts.currency_label,
        reader_credit_accounts.created_at AS credit_created_at,
        reader_credit_accounts.updated_at AS credit_updated_at,
        (SELECT COUNT(*) FROM novel_orders WHERE novel_orders.account_id = reader_accounts.id) AS order_count,
        (SELECT COUNT(*) FROM novel_entitlements
         WHERE novel_entitlements.account_id = reader_accounts.id
           AND novel_entitlements.revoked_at IS NULL
           AND (novel_entitlements.expires_at IS NULL OR novel_entitlements.expires_at > CURRENT_TIMESTAMP)) AS active_entitlement_count,
        (SELECT COUNT(*) FROM reader_credit_ledger WHERE reader_credit_ledger.account_id = reader_accounts.id) AS ledger_count,
        (SELECT MAX(updated_at) FROM novel_orders WHERE novel_orders.account_id = reader_accounts.id) AS latest_order_at
       FROM reader_accounts
       LEFT JOIN reader_credit_accounts ON reader_credit_accounts.account_id = reader_accounts.id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY reader_accounts.updated_at DESC, reader_accounts.id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  const config = getReaderCreditConfig(env);
  return privateJson({
    ok: true,
    accounts: (response.results || []).map((row) => readerAccountToAdminJson(row, config))
  });
};

const handleAdminListReaderComments = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  if (!(await ensureReaderCommentsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_COMMENTS_NOT_READY',
        message: 'Reader comments are not initialized. Apply migration 0017_reader_comments.sql.'
      },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const status = cleanText(url.searchParams.get('status'), 40).toLowerCase();
  const seriesSlug = cleanSlug(url.searchParams.get('seriesSlug') || url.searchParams.get('series'), 160);
  const chapterSlug = cleanSlug(url.searchParams.get('chapterSlug') || url.searchParams.get('chapter'), 160);
  const normalizedEmail = normalizeEmail(url.searchParams.get('email'));
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '80', 10) || 80, 1), 120);
  if (status && !readerCommentStatuses.has(status)) {
    return privateJson({ ok: false, message: 'Invalid comment status.' }, { status: 400 });
  }
  if (normalizedEmail && !isEmail(normalizedEmail)) {
    return privateJson({ ok: false, message: 'Please enter a valid reader email.' }, { status: 400 });
  }

  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('reader_comments.status = ?');
    params.push(status);
  } else {
    clauses.push("reader_comments.status <> 'deleted'");
  }
  if (seriesSlug) {
    clauses.push('reader_comments.series_slug = ?');
    params.push(seriesSlug);
  }
  if (chapterSlug) {
    clauses.push('reader_comments.chapter_slug = ?');
    params.push(chapterSlug);
  }
  if (normalizedEmail) {
    clauses.push('reader_accounts.normalized_email = ?');
    params.push(normalizedEmail);
  }

  const response = await db
    .prepare(
      `SELECT
        reader_comments.*,
        reader_accounts.email,
        reader_accounts.display_name,
        reader_password_credentials.username
       FROM reader_comments
       INNER JOIN reader_accounts ON reader_accounts.id = reader_comments.account_id
       LEFT JOIN reader_password_credentials ON reader_password_credentials.account_id = reader_accounts.id
       WHERE ${clauses.join(' AND ')}
       ORDER BY
         CASE reader_comments.status
           WHEN 'pending' THEN 0
           WHEN 'approved' THEN 1
           WHEN 'hidden' THEN 2
           ELSE 3
         END,
         reader_comments.updated_at DESC,
         reader_comments.id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return privateJson({
    ok: true,
    comments: (response.results || []).map((row) => readerCommentToJson(row, { admin: true }))
  });
};

const handleAdminModerateReaderComment = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });
  if (!(await ensureReaderCommentsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'READER_COMMENTS_NOT_READY',
        message: 'Reader comments are not initialized. Apply migration 0017_reader_comments.sql.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const id = cleanText(payload.id, 80);
  const action = cleanText(payload.action, 40).toLowerCase();
  const statusByAction = {
    approve: 'approved',
    hide: 'hidden',
    delete: 'deleted'
  };
  const nextStatus = statusByAction[action];
  if (!id || !nextStatus) {
    return privateJson({ ok: false, message: 'A valid comment id and moderation action are required.' }, { status: 400 });
  }

  const existing = await selectReaderCommentById(db, id);
  if (!existing) return privateJson({ ok: false, message: 'Comment was not found.' }, { status: 404 });

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  const hiddenReason = action === 'approve' ? '' : cleanText(payload.note || payload.reason, 500);
  await db
    .prepare(
      `UPDATE reader_comments
       SET status = ?,
           reviewed_by = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           hidden_reason = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(nextStatus, actorEmail, hiddenReason, id)
    .run();

  const updated = await selectReaderCommentById(db, id);
  await insertAdminAuditLog(db, {
    actorEmail,
    action: `reader_comment.${action}`,
    targetType: 'reader_comment',
    targetId: id,
    targetSlug: `${existing.series_slug}/${existing.chapter_slug}`,
    metadata: {
      accountId: existing.account_id,
      email: existing.email,
      previousStatus: existing.status,
      status: nextStatus,
      note: hiddenReason
    }
  });

  return privateJson({
    ok: true,
    comment: readerCommentToJson(updated, { admin: true })
  });
};

const handleAdminListProductFeedback = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Feedback database is not configured.' }, { status: 500 });
  if (!(await ensureProductFeedbackReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'PRODUCT_FEEDBACK_NOT_READY',
        message: 'Product feedback is not initialized. Apply migration 0018_product_feedback.sql.'
      },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const product = cleanText(url.searchParams.get('product') || 'privatepinyin', 80).toLowerCase();
  const status = cleanText(url.searchParams.get('status'), 40).toLowerCase();
  const platform = cleanText(url.searchParams.get('platform'), 40).toLowerCase();
  const issueType = cleanText(url.searchParams.get('issueType'), 40).toLowerCase();
  const query = cleanText(url.searchParams.get('query'), 120);
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 150);
  if (product && !productFeedbackProducts.has(product)) {
    return privateJson({ ok: false, message: 'Invalid feedback product.' }, { status: 400 });
  }
  if (status && !productFeedbackStatuses.has(status)) {
    return privateJson({ ok: false, message: 'Invalid feedback status.' }, { status: 400 });
  }
  if (platform && !productFeedbackPlatforms.has(platform)) {
    return privateJson({ ok: false, message: 'Invalid feedback platform.' }, { status: 400 });
  }
  if (issueType && !productFeedbackIssueTypes.has(issueType)) {
    return privateJson({ ok: false, message: 'Invalid feedback issue type.' }, { status: 400 });
  }

  const clauses = [];
  const params = [];
  if (product) {
    clauses.push('product = ?');
    params.push(product);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (platform) {
    clauses.push('platform = ?');
    params.push(platform);
  }
  if (issueType) {
    clauses.push('issue_type = ?');
    params.push(issueType);
  }
  if (query) {
    clauses.push('(summary LIKE ? OR details LIKE ? OR contact_email LIKE ?)');
    const queryPattern = `%${query}%`;
    params.push(queryPattern, queryPattern, queryPattern);
  }

  const response = await db
    .prepare(
      `SELECT *
       FROM product_feedback
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY
         CASE status
           WHEN 'new' THEN 0
           WHEN 'in_progress' THEN 1
           WHEN 'resolved' THEN 2
           ELSE 3
         END,
         updated_at DESC,
         id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return privateJson({
    ok: true,
    feedback: (response.results || []).map((row) => productFeedbackToJson(row, { admin: true }))
  });
};

const handleAdminUpdateProductFeedback = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Feedback database is not configured.' }, { status: 500 });
  if (!(await ensureProductFeedbackReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'PRODUCT_FEEDBACK_NOT_READY',
        message: 'Product feedback is not initialized. Apply migration 0018_product_feedback.sql.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const id = cleanText(payload.id, 80);
  const status = cleanText(payload.status, 40).toLowerCase();
  if (!id || !productFeedbackStatuses.has(status)) {
    return privateJson({ ok: false, message: 'A valid feedback id and status are required.' }, { status: 400 });
  }
  const existing = await selectProductFeedbackById(db, id);
  if (!existing) return privateJson({ ok: false, message: 'Feedback was not found.' }, { status: 404 });

  let adminNote;
  try {
    adminNote = normalizeProductFeedbackText(payload.adminNote || payload.note, {
      field: 'Admin note',
      maxLength: 2000
    });
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'INVALID_ADMIN_NOTE', message: error.message }, { status: 400 });
  }

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  await db
    .prepare(
      `UPDATE product_feedback
       SET status = ?,
           admin_note = ?,
           updated_by = ?,
           resolved_at = CASE
             WHEN ? = 'resolved' THEN COALESCE(resolved_at, CURRENT_TIMESTAMP)
             WHEN ? IN ('new', 'in_progress') THEN NULL
             ELSE resolved_at
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(status, adminNote, actorEmail, status, status, id)
    .run();

  const updated = await selectProductFeedbackById(db, id);
  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'product_feedback.update',
    targetType: 'product_feedback',
    targetId: id,
    targetSlug: existing.product,
    metadata: {
      previousStatus: existing.status,
      status,
      platform: existing.platform,
      issueType: existing.issue_type,
      adminNote
    }
  });

  return privateJson({
    ok: true,
    feedback: productFeedbackToJson(updated, { admin: true })
  });
};

const findReaderAccountByAdminIdentifier = async (db, identifier) => {
  const id = Number.parseInt(identifier?.id || identifier?.accountId || '', 10);
  const normalizedEmail = normalizeEmail(identifier?.email);
  if (!id && !normalizedEmail) return null;
  if (normalizedEmail && !isEmail(normalizedEmail)) return null;

  return db
    .prepare(
      `SELECT reader_accounts.*
       FROM reader_accounts
       WHERE (? > 0 AND reader_accounts.id = ?)
          OR (? <> '' AND reader_accounts.normalized_email = ?)
       LIMIT 1`
    )
    .bind(id || 0, id || 0, normalizedEmail, normalizedEmail)
    .first();
};

const getAdminReaderAccountRow = async (db, accountId) =>
  db
    .prepare(
      `SELECT
        reader_accounts.*,
        reader_credit_accounts.balance_credits,
        reader_credit_accounts.lifetime_purchased_credits,
        reader_credit_accounts.lifetime_spent_credits,
        reader_credit_accounts.currency_label,
        reader_credit_accounts.created_at AS credit_created_at,
        reader_credit_accounts.updated_at AS credit_updated_at,
        (SELECT COUNT(*) FROM novel_orders WHERE novel_orders.account_id = reader_accounts.id) AS order_count,
        (SELECT COUNT(*) FROM novel_entitlements
         WHERE novel_entitlements.account_id = reader_accounts.id
           AND novel_entitlements.revoked_at IS NULL
           AND (novel_entitlements.expires_at IS NULL OR novel_entitlements.expires_at > CURRENT_TIMESTAMP)) AS active_entitlement_count,
        (SELECT COUNT(*) FROM reader_credit_ledger WHERE reader_credit_ledger.account_id = reader_accounts.id) AS ledger_count,
        (SELECT MAX(updated_at) FROM novel_orders WHERE novel_orders.account_id = reader_accounts.id) AS latest_order_at
       FROM reader_accounts
       LEFT JOIN reader_credit_accounts ON reader_credit_accounts.account_id = reader_accounts.id
       WHERE reader_accounts.id = ?
       LIMIT 1`
    )
    .bind(accountId)
    .first();

const listNovelOrdersForAccount = async (db, accountId) => {
  const response = await db
    .prepare(
      `SELECT novel_orders.*, reader_accounts.email AS account_email
       FROM novel_orders
       LEFT JOIN reader_accounts ON reader_accounts.id = novel_orders.account_id
       WHERE novel_orders.account_id = ?
       ORDER BY novel_orders.updated_at DESC, novel_orders.id DESC
       LIMIT 20`
    )
    .bind(accountId)
    .all();
  return (response.results || []).map(novelOrderToJson);
};

const handleAdminGetReaderAccount = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const account = await findReaderAccountByAdminIdentifier(db, {
    id: url.searchParams.get('id') || url.searchParams.get('accountId'),
    email: url.searchParams.get('email')
  });
  if (!account) return privateJson({ ok: false, code: 'READER_ACCOUNT_NOT_FOUND', message: 'Reader account was not found.' }, { status: 404 });

  await ensureReaderCreditAccount(db, account.id, getReaderCreditConfig(env));
  const [row, creditSummary, entitlements, orders, membership] = await Promise.all([
    getAdminReaderAccountRow(db, account.id),
    getReaderCreditSummary(db, account.id, env),
    listNovelEntitlements(db, account.normalized_email),
    listNovelOrdersForAccount(db, account.id),
    getActiveReaderMembership(db, account.id)
  ]);

  return privateJson({
    ok: true,
    account: readerAccountToAdminJson(row, getReaderCreditConfig(env)),
    credits: creditSummary.account,
    creditLedger: creditSummary.ledger,
    membership: readerMembershipToJson(membership),
    membershipSettings: creditSummary.membershipSettings,
    entitlements,
    orders
  });
};

const handleAdminAdjustReaderCredits = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const creditsDelta = Number.parseInt(payload.creditsDelta || payload.delta || '', 10);
  if (!Number.isFinite(creditsDelta) || creditsDelta === 0) {
    return privateJson({ ok: false, message: 'creditsDelta must be a non-zero integer.' }, { status: 400 });
  }
  const note = cleanText(payload.note, 1000);
  if (!note) return privateJson({ ok: false, message: 'A note is required for manual credit adjustments.' }, { status: 400 });

  let account = await findReaderAccountByAdminIdentifier(db, payload);
  const normalizedEmail = normalizeEmail(payload.email);
  if (!account && isEmail(normalizedEmail)) {
    account = await upsertReaderAccount(db, payload.email, normalizedEmail);
  }
  if (!account) return privateJson({ ok: false, code: 'READER_ACCOUNT_NOT_FOUND', message: 'Reader account was not found.' }, { status: 404 });

  await ensureReaderCreditAccount(db, account.id, getReaderCreditConfig(env));
  const sourceRef = cleanText(payload.sourceRef, 120) || `manual-credit-${randomToken(12)}`;
  const updatedAccount = creditsDelta > 0
    ? await db
        .prepare(
          `UPDATE reader_credit_accounts
           SET balance_credits = balance_credits + ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?
           RETURNING *`
        )
        .bind(creditsDelta, account.id)
        .first()
    : await db
        .prepare(
          `UPDATE reader_credit_accounts
           SET balance_credits = balance_credits + ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?
             AND balance_credits >= ?
           RETURNING *`
        )
        .bind(creditsDelta, account.id, Math.abs(creditsDelta))
        .first();

  if (!updatedAccount) {
    const summary = await getReaderCreditSummary(db, account.id, env);
    return privateJson(
      {
        ok: false,
        code: 'INSUFFICIENT_CREDITS',
        message: 'Manual deduction would make the reader balance negative.',
        ...summary
      },
      { status: 409 }
    );
  }

  const ledger = await db
    .prepare(
      `INSERT INTO reader_credit_ledger (
        account_id, entry_type, credits_delta, balance_after, source, source_ref,
        series_slug, chapter_slug, note, metadata_json
      )
      VALUES (?, 'admin_adjustment', ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .bind(
      account.id,
      creditsDelta,
      updatedAccount.balance_credits,
      novelAdminManualCreditSource,
      sourceRef,
      cleanSlug(payload.seriesSlug),
      cleanSlug(payload.chapterSlug),
      note,
      JSON.stringify({
        actor: await getAdminActorEmail(request, env),
        reason: cleanText(payload.reason, 120),
        source: novelAdminSource
      })
    )
    .first();

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'reader_credits.adjust',
    targetType: 'reader_account',
    targetId: String(account.id),
    targetSlug: account.normalized_email,
    metadata: {
      creditsDelta,
      balanceAfter: updatedAccount.balance_credits,
      ledgerId: ledger.id,
      note
    }
  });

  const [row, creditSummary, entitlements, orders, membership] = await Promise.all([
    getAdminReaderAccountRow(db, account.id),
    getReaderCreditSummary(db, account.id, env),
    listNovelEntitlements(db, account.normalized_email),
    listNovelOrdersForAccount(db, account.id),
    getActiveReaderMembership(db, account.id)
  ]);

  return privateJson({
    ok: true,
    ledger: readerCreditLedgerToJson(ledger),
    account: readerAccountToAdminJson(row, getReaderCreditConfig(env)),
    credits: creditSummary.account,
    creditLedger: creditSummary.ledger,
    membership: readerMembershipToJson(membership),
    membershipSettings: creditSummary.membershipSettings,
    entitlements,
    orders
  });
};

const handleAdminContentSchema = async (env) =>
  privateJson({
    ok: true,
    stage: '8D',
    purpose: 'Backend content management, media upload, global reading-credit pricing, reader membership, order, reader account, credit, entitlement, audit, and NovelForge import review operations centered in Admin 2.0.',
    entries: {
      entryTypes: [...contentEntryTypes],
      locales: [...contentLocales],
      statuses: [...contentStatuses],
      visibilities: [...contentVisibilities],
      accessLevels: [...contentAccessLevels],
      bodyFormats: [...contentBodyFormats]
    },
    pricing: {
      modes: [...contentPricingModes],
      currencies: ['USD'],
      ruleTypes: [
        'pricing_mode',
        'free_chapters',
        'chapter_price',
        'supporter_price',
        'tip_amount',
        'bundle_discount',
        'credit_pack',
        'membership_redeem'
      ],
      source: 'global admin_content_settings, then content_pricing_rules'
    },
    storage: getContentStorageDescriptor(env),
    migration: {
      currentStaticSources: ['src/content/devlog', 'src/content/serials', 'src/content/serialChapters'],
      backendTables: [
        'content_entries',
        'content_revisions',
        'content_imports',
        'content_pricing_rules',
        'admin_content_settings',
        'reader_bookmarks',
        'reading_events',
        'chapter_stats',
        'ai_insights',
        'signal_sources',
        'signal_collection_runs',
        'signal_candidates',
        'admin_audit_logs'
      ],
      legacyMigration: 'Completed. The one-time legacy Markdown migration endpoint and manifest have been removed from the Worker bundle.',
      protectedContent: 'Paid/supporter chapter HTML is loaded from CONTENT_BUCKET after entitlement checks.',
      dynamicFrontend: 'Published backend content can render public Blog and serial pages without a site rebuild.',
      checkoutPricing: 'Reader-facing checkout only sells reading-credit packs through NOWPayments. Paid chapters unlock with credits or active membership.',
      commerceAdmin: 'Admin 2.0 can inspect orders, reader accounts, credit ledger, entitlements, and rerun paid-order fulfillment.',
      mediaUpload: 'Admin 2.0 uploads cover images into CONTENT_BUCKET under content/media/covers.',
      novelForgeImport: 'NovelForge can publish projects, chapters, and cover metadata through POST /api/novelforge/import with a dedicated Bearer token.',
      novelForgeImportReview: 'Admin 2.0 can review NovelForge import batches, inspect linked entries, and publish imported drafts after review.',
      novelForgeWritingApi: 'NovelForge can read chapter stats, AI insights, and book trends through GET /api/novelforge/analytics/* with the same Bearer token boundary.',
      pricingDefaults: 'Admin 2.0 stores global novel pricing defaults in admin_content_settings. Saved pricing applies to all books and chapters.',
      readerMemberships: '10 reading credits can redeem a monthly membership by default. Active members can read paid chapters.',
      readerBookmarks: 'Reader accounts can save chapter bookmarks and continue reading from Member Center.',
      readingEvents: 'Novel V2 reader pages can send chapter open, scroll depth, pause/resume, navigation, like, bookmark, and comment interaction events into reading_events.',
      readingAnalytics: 'Admin 2.0 can aggregate reading_events into chapter_stats for completion, drop-off, reading time, and engagement diagnostics.',
      aiInsights: 'Admin 2.0 can generate structured AI-style chapter insights from chapter_stats into ai_insights.',
      signalStrip: 'Admin 2.0 can import daily technology/economy Signal strip briefs, manage an approved source registry, and inspect future collection runs and candidate items before automated collection is enabled.',
      oldAuthoringPath: 'The old GitHub-token Markdown editor is deprecated. Use Admin 2.0 for routine content publishing.',
      nextStages: ['8D optional retry tools and richer NovelForge source diagnostics']
    }
  });

const handleAdminUploadContentMedia = async (request, env) => {
  const bucket = getContentBucket(env);
  if (!bucket) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_BUCKET_NOT_CONFIGURED',
        message: 'CONTENT_BUCKET is not configured, so media upload is disabled.'
      },
      { status: 503 }
    );
  }

  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > maxContentImageRequestBytes) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_MEDIA_TOO_LARGE',
        message: 'Cover image uploads are limited to 5MB.'
      },
      { status: 413 }
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return privateJson({ ok: false, code: 'CONTENT_MEDIA_FORM_INVALID', message: 'Invalid media upload form.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.size !== 'number') {
    return privateJson({ ok: false, code: 'CONTENT_MEDIA_FILE_REQUIRED', message: 'Please choose an image file.' }, { status: 400 });
  }

  if (file.size <= 0) {
    return privateJson({ ok: false, code: 'CONTENT_MEDIA_EMPTY', message: 'The selected image file is empty.' }, { status: 400 });
  }

  if (file.size > maxContentImageBytes) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_MEDIA_TOO_LARGE',
        message: 'Cover image uploads are limited to 5MB.'
      },
      { status: 413 }
    );
  }

  const contentType = cleanText(file.type, 80).toLowerCase();
  if (!contentImageTypes.has(contentType)) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_MEDIA_TYPE_UNSUPPORTED',
        message: 'Please upload a JPG, PNG, WebP, GIF, or AVIF image.'
      },
      { status: 415 }
    );
  }

  const mediaKind = cleanSlug(formData.get('mediaKind') || 'covers', 20);
  const title = cleanText(formData.get('title'), 160);
  const slug = cleanSlug(formData.get('slug') || title || file.name || 'media', 100);
  const key = buildContentMediaKey({
    contentType,
    filename: file.name,
    kind: mediaKind,
    slug
  });
  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';

  let object;
  try {
    object = await bucket.put(key, file, {
      httpMetadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        contentType
      },
      customMetadata: {
        originalFilename: cleanText(file.name, 180),
        uploadedBy: actorEmail,
        uploadedFrom: 'admin-v2'
      }
    });
  } catch (error) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_MEDIA_UPLOAD_FAILED',
        message: error.message || 'Media upload failed.'
      },
      { status: 503 }
    );
  }

  const db = env.WAITLIST_DB;
  if (db && (await ensureContentTablesReady(db))) {
    try {
      await insertAdminAuditLog(db, {
        actorEmail,
        action: 'content_media_upload',
        targetType: 'content_media',
        targetId: key,
        targetSlug: key,
        metadata: {
          contentType,
          filename: cleanText(file.name, 180),
          mediaKind: contentMediaKinds.has(mediaKind) ? mediaKind : 'covers',
          size: file.size
        }
      });
    } catch {
      // Media upload should not fail just because audit logging is unavailable.
    }
  }

  return privateJson({
    ok: true,
    media: {
      contentType,
      key,
      size: file.size,
      uploadedAt: object?.uploaded ? object.uploaded.toISOString() : '',
      url: contentMediaUrl(key)
    }
  });
};

const handlePublicContentMedia = async (request, env) => {
  const bucket = getContentBucket(env);
  if (!bucket) return new Response('Content media bucket is not configured.', { status: 503 });

  const url = new URL(request.url);
  const key = cleanText(url.searchParams.get('key'), 500);
  if (!isSafeContentMediaKey(key)) {
    return new Response('Invalid content media key.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  const object = await bucket.get(key);
  if (!object) {
    return new Response('Content media not found.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get('content-type')) headers.set('content-type', 'application/octet-stream');
  if (!headers.get('cache-control')) headers.set('cache-control', 'public, max-age=86400');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  headers.set('x-content-type-options', 'nosniff');

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
};

const buildContentEntriesQuery = (url, options = {}) => {
  const entryType = cleanText(url.searchParams.get('type') || url.searchParams.get('entryType'), 40)
    .toLowerCase()
    .replace(/-/g, '_');
  const locale = cleanText(url.searchParams.get('locale') || url.searchParams.get('language'), 20);
  const status = cleanText(url.searchParams.get('status'), 30).toLowerCase();
  const parentSlug = cleanSlug(url.searchParams.get('parentSlug') || url.searchParams.get('series'));
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

  const clauses = [];
  const params = [];

  if (entryType) {
    if (!contentEntryTypes.has(entryType)) {
      const error = new Error('Unsupported content entry type.');
      error.code = 'INVALID_CONTENT_TYPE';
      throw error;
    }
    clauses.push('entry_type = ?');
    params.push(entryType);
  }

  if (locale) {
    if (!contentLocales.has(locale)) {
      const error = new Error('Unsupported content locale.');
      error.code = 'INVALID_CONTENT_LOCALE';
      throw error;
    }
    clauses.push('locale = ?');
    params.push(locale);
  }

  if (status) {
    if (!contentStatuses.has(status)) {
      const error = new Error('Unsupported content status.');
      error.code = 'INVALID_CONTENT_STATUS';
      throw error;
    }
    clauses.push('status = ?');
    params.push(status);
  } else if (options.publicOnly) {
    clauses.push("status = 'published'");
  }

  if (options.publicOnly) {
    clauses.push("visibility IN ('public', 'unlisted')");
  }

  if (parentSlug) {
    clauses.push('parent_slug = ?');
    params.push(parentSlug);
  }

  return {
    limit,
    params,
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  };
};

const handleAdminListContentEntries = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson({
      ok: true,
      setupRequired: true,
      message: 'Content tables are not initialized. Apply migration 0007_backend_content_platform.sql.',
      entries: [],
      storage: getContentStorageDescriptor(env)
    });
  }

  const url = new URL(request.url);
  let query;
  try {
    query = buildContentEntriesQuery(url);
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'CONTENT_QUERY_INVALID', message: error.message }, { status: 400 });
  }

  const response = await db
    .prepare(
      `SELECT *
       FROM content_entries
       ${query.where}
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    )
    .bind(...query.params, query.limit)
    .all();

  return privateJson({
    ok: true,
    entries: (response.results || []).map(contentEntryToJson),
    storage: getContentStorageDescriptor(env)
  });
};

const contentImportToJson = (row, entries = [], origin = '') => {
  const normalizedEntries = entries.map((entry) => {
    const publicPath = contentEntryPublicPath(entry);
    return {
      ...contentEntryToJson(entry),
      adminUrl: `/admin-v2/?contentId=${encodeURIComponent(String(entry.id))}`,
      coverRemoteId: entry.entry_type === 'novel_series' ? novelForgeCoverRemoteIdForSeries(entry) : '',
      publicPath,
      publicUrl: publicPath ? `${origin}${publicPath}` : '',
      remoteId: novelForgeRemoteIdForEntry(entry)
    };
  });
  const series = normalizedEntries.find((entry) => entry.entryType === 'novel_series') || null;
  const chapterCount = normalizedEntries.filter((entry) => entry.entryType === 'novel_chapter').length;
  const draftCount = normalizedEntries.filter((entry) => ['draft', 'scheduled'].includes(entry.status)).length;
  const publishedCount = normalizedEntries.filter((entry) => entry.status === 'published').length;

  return {
    id: row.id,
    importType: row.import_type,
    requestId: row.filename,
    filename: row.filename,
    r2Key: row.r2_key,
    status: row.status,
    entriesCreated: normalizePositiveInteger(row.entries_created, 0),
    entriesUpdated: normalizePositiveInteger(row.entries_updated, 0),
    warnings: parseStoredJson(row.warnings_json, []),
    errors: parseStoredJson(row.errors_json, []),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entries: normalizedEntries,
    summary: {
      chapterCount,
      draftCount,
      entryCount: normalizedEntries.length,
      publishedCount,
      seriesSlug: series?.slug || '',
      seriesTitle: series?.title || '',
      pricing: series?.pricing || {}
    }
  };
};

const listEntriesForContentImports = async (db, importRows) => {
  const refs = [...new Set(importRows.map((row) => cleanText(row.filename, 240)).filter(Boolean))];
  const sourceKinds = [
    ...new Set(
      importRows.flatMap((row) =>
        contentImportSourceKinds(cleanText(row.import_type, 40).toLowerCase())
      )
    )
  ].filter(Boolean);
  if (!refs.length || !sourceKinds.length) return new Map();

  const sourceKindPlaceholders = sourceKinds.map(() => '?').join(', ');
  const refPlaceholders = refs.map(() => '?').join(', ');
  const response = await db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE source_kind IN (${sourceKindPlaceholders})
         AND source_ref IN (${refPlaceholders})
       ORDER BY
         source_ref ASC,
         CASE entry_type
           WHEN 'novel_series' THEN 0
           WHEN 'novel_chapter' THEN 1
           ELSE 2
         END ASC,
         chapter_number ASC,
         updated_at DESC,
         id ASC`
    )
    .bind(...sourceKinds, ...refs)
    .all();

  const byRef = new Map(refs.map((ref) => [ref, []]));
  (response.results || []).forEach((entry) => {
    if (!byRef.has(entry.source_ref)) byRef.set(entry.source_ref, []);
    byRef.get(entry.source_ref).push(entry);
  });
  return byRef;
};

const handleAdminListContentImports = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson({
      ok: true,
      setupRequired: true,
      message: 'Content tables are not initialized. Apply migration 0007_backend_content_platform.sql.',
      imports: []
    });
  }

  const url = new URL(request.url);
  const importType = cleanText(url.searchParams.get('type') || 'novelforge', 40).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(importType)) {
    return privateJson({ ok: false, code: 'CONTENT_IMPORT_TYPE_INVALID', message: 'Unsupported import type.' }, { status: 400 });
  }
  const importId = normalizePositiveInteger(url.searchParams.get('id'), 0);
  const limit = Math.min(Math.max(normalizePositiveInteger(url.searchParams.get('limit'), 30), 1), 80);
  const review = cleanText(url.searchParams.get('review') || 'all', 20).toLowerCase();
  if (!['all', 'pending'].includes(review)) {
    return privateJson({ ok: false, code: 'CONTENT_IMPORT_REVIEW_FILTER_INVALID', message: 'Unsupported import review filter.' }, { status: 400 });
  }
  const query = buildContentImportListQuery({ importId, importType, limit, review });

  const response = await db
    .prepare(query.sql)
    .bind(...query.params)
    .all();

  const importRows = response.results || [];
  const entriesByRef = await listEntriesForContentImports(db, importRows);
  const origin = new URL(request.url).origin;
  return privateJson({
    ok: true,
    imports: importRows.map((row) => contentImportToJson(row, entriesByRef.get(row.filename) || [], origin)),
    stage: '8C'
  });
};

const handleAdminReviewContentImport = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_TABLES_NOT_READY',
        message: 'Content tables are not initialized. Apply migration 0007_backend_content_platform.sql before reviewing imports.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid request body.' }, { status: 400 });
  }

  const action = cleanText(payload.action || 'publish', 40).toLowerCase();
  if (!['publish', 'delete'].includes(action)) {
    return privateJson({ ok: false, code: 'CONTENT_IMPORT_ACTION_UNSUPPORTED', message: 'Unsupported import review action.' }, { status: 400 });
  }

  const importId = normalizePositiveInteger(payload.importId || payload.id, 0);
  if (!importId) {
    return privateJson({ ok: false, code: 'CONTENT_IMPORT_ID_REQUIRED', message: 'A valid import id is required.' }, { status: 400 });
  }

  const importRow = await db
    .prepare(
      `SELECT *
       FROM content_imports
       WHERE id = ?
         AND import_type = 'novelforge'
       LIMIT 1`
    )
    .bind(importId)
    .first();
  if (!importRow) {
    return privateJson({ ok: false, code: 'CONTENT_IMPORT_NOT_FOUND', message: 'NovelForge import was not found.' }, { status: 404 });
  }

  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  if (action === 'delete') {
    const entriesByRef = await listEntriesForContentImports(db, [importRow]);
    const linkedEntries = entriesByRef.get(importRow.filename) || [];
    await db
      .prepare(
        `DELETE FROM content_imports
         WHERE id = ?
           AND import_type = 'novelforge'`
      )
      .bind(importRow.id)
      .run();

    await insertAdminAuditLog(db, {
      actorEmail,
      action: 'novelforge_import_deleted_review_record',
      targetType: 'content_import',
      targetId: String(importRow.id),
      targetSlug: importRow.filename,
      metadata: {
        linkedEntryIds: linkedEntries.map((entry) => entry.id),
        linkedEntries: linkedEntries.length,
        requestId: importRow.filename,
        r2Key: importRow.r2_key,
        status: importRow.status
      }
    });

    return privateJson({
      ok: true,
      deletedImportId: importRow.id,
      linkedEntries: linkedEntries.length,
      message: `Deleted NovelForge import record #${importRow.id}. Linked content entries were kept.`,
      stage: '8C'
    });
  }

  const beforeResponse = await db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE source_kind = 'novelforge'
         AND source_ref = ?
       ORDER BY
         CASE entry_type
           WHEN 'novel_series' THEN 0
           WHEN 'novel_chapter' THEN 1
           ELSE 2
         END ASC,
         chapter_number ASC,
         id ASC`
    )
    .bind(importRow.filename)
    .all();
  const beforeEntries = beforeResponse.results || [];
  const publishableEntries = beforeEntries.filter((entry) => ['draft', 'scheduled'].includes(entry.status));

  if (publishableEntries.length) {
    await db
      .prepare(
        `UPDATE content_entries
         SET status = 'published',
             visibility = CASE WHEN visibility = 'private' THEN 'public' ELSE visibility END,
             published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE source_kind = 'novelforge'
           AND source_ref = ?
           AND status IN ('draft', 'scheduled')`
      )
      .bind(actorEmail, importRow.filename)
      .run();
  }

  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'novelforge_import_publish_reviewed_drafts',
    targetType: 'content_import',
    targetId: String(importRow.id),
    targetSlug: importRow.filename,
    metadata: {
      publishedEntryIds: publishableEntries.map((entry) => entry.id),
      publishedEntries: publishableEntries.length,
      requestId: importRow.filename
    }
  });

  const entriesByRef = await listEntriesForContentImports(db, [importRow]);
  const origin = new URL(request.url).origin;
  return privateJson({
    ok: true,
    import: contentImportToJson(importRow, entriesByRef.get(importRow.filename) || [], origin),
    message: publishableEntries.length
      ? `Published ${publishableEntries.length} imported draft entries.`
      : 'No draft entries were waiting for publication.',
    publishedEntries: publishableEntries.length,
    stage: '8C'
  });
};

const buildSignalImportBackupKey = (requestId) => {
  const now = new Date();
  const year = now.toISOString().slice(0, 4);
  const month = now.toISOString().slice(5, 7);
  const safeRequestId = cleanSlug(requestId, 120) || 'signal-brief';
  const token = (crypto.randomUUID?.() || randomToken(12)).replace(/-/g, '').slice(0, 12);
  return `content/imports/signal/${year}/${month}/${safeRequestId}-${Date.now()}-${token}.json`;
};

// Manual brief sources also use this normalizer, so fragments never create duplicate source links.
const normalizeSignalSourceUrl = (value) => {
  const valueText = cleanText(value, 1000);
  if (!valueText) return '';
  try {
    const url = new URL(valueText);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
};

const normalizeSignalAutomationSourceUrl = (value) => normalizePublicSignalUrl(value);

const parseSignalSourcesInput = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((source) => {
        if (typeof source === 'string') {
          const text = cleanText(source, 500);
          const url = normalizeSignalSourceUrl(text);
          return { label: url ? url.replace(/^https?:\/\//i, '') : text, note: '', url };
        }
        const url = normalizeSignalSourceUrl(source?.url);
        return {
          label: cleanText(source?.label || source?.title || url, 160),
          note: cleanText(source?.note || source?.description, 240),
          url
        };
      })
      .filter((source) => source.label || source.url)
      .slice(0, 12);
  }

  return String(value || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelPart, urlPart, notePart] = line.split('|').map((part) => part.trim());
      const directUrl = normalizeSignalSourceUrl(labelPart);
      const url = directUrl || normalizeSignalSourceUrl(urlPart);
      return {
        label: cleanText(directUrl ? directUrl.replace(/^https?:\/\//i, '') : labelPart, 160),
        note: cleanText(notePart || (!url && urlPart ? urlPart : ''), 240),
        url
      };
    })
    .filter((source) => source.label || source.url)
    .slice(0, 12);
};

const signalAutomationSourceTypes = new Set(['rss', 'api', 'page']);
const signalAutomationCategories = new Set(['ai', 'tech', 'economy', 'market', 'research', 'general']);
const signalAutomationTrustTiers = new Set(['primary', 'established', 'community']);
const signalAutomationRunStatuses = new Set(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']);
const signalAutomationCandidateStatuses = new Set(['new', 'shortlisted', 'rejected', 'used']);
const signalCandidateWindowHours = new Set([0, 24, 168]);
const signalCandidateReviewActions = new Set(['shortlist', 'reject', 'restore', 'rescore']);
const signalAutomationDefaultAdapters = Object.freeze({ api: 'json', page: 'html', rss: 'rss' });
const signalAutomationAlertTypes = new Set([
  'scheduler_gap',
  'scheduler_failure',
  'stale_run',
  'run_failed',
  'source_failures',
  'queue_failure',
  'dead_letter'
]);
const signalAutomationAlertSeverities = new Set(['info', 'warning', 'critical']);
const signalAutomationRuntimeId = 'signal-collection';
const signalCollectionDeadLetterQueueName = 'station-cat-signal-collection-dlq';

const signalAutomationSetupResponse = (kind) => {
  const collections = {
    candidates: { candidates: [], summary: { total: 0, new: 0, shortlisted: 0, rejected: 0, used: 0 } },
    runs: { runs: [], summary: { total: 0, queued: 0, running: 0, failed: 0 } },
    sources: { sources: [], summary: { total: 0, enabled: 0, paused: 0, errors: 0 } }
  };
  return privateJson({
    ok: true,
    setupRequired: true,
    migration: '0019_signal_automation.sql',
    ...(collections[kind] || {})
  });
};

const signalCandidateTriageSetupResponse = () =>
  privateJson(
    {
      ok: false,
      code: 'SIGNAL_CANDIDATE_TRIAGE_NOT_READY',
      message: '先应用 migrations/0021_signal_candidate_triage.sql，再审核候选资讯。',
      migration: '0021_signal_candidate_triage.sql',
      setupRequired: true,
      triageReady: false
    },
    { status: 503 }
  );

const signalSourceHealth = (row) => {
  if (!row.is_enabled) return 'paused';
  const latestErrorIsCurrent = row.last_error_at && (!row.last_success_at || row.last_error_at >= row.last_success_at);
  if (latestErrorIsCurrent) return 'error';
  if (row.last_success_at) return 'healthy';
  return 'not_checked';
};

const signalCollectionSecrets = (env) => ({ FRED_API_KEY: cleanText(env?.FRED_API_KEY, 200) });

const signalSourceToJson = (row, secrets = {}) => {
  const adapter = getSignalSourceAdapter(row);
  const collectionSupported = supportedSignalCollectionAdapters.has(adapter);
  const collectionConfigured = collectionSupported && isSignalSourceSecretConfigured(row, secrets);
  return {
    id: row.id,
    name: row.name,
    publisher: row.publisher,
    sourceType: row.source_type,
    category: row.category,
    trustTier: row.trust_tier,
    endpointUrl: row.endpoint_url,
    homepageUrl: row.homepage_url,
    language: row.language,
    isEnabled: Boolean(row.is_enabled),
    fetchIntervalMinutes: normalizePositiveInteger(row.fetch_interval_minutes, 360),
    maxItemsPerRun: normalizePositiveInteger(row.max_items_per_run, 30),
    requiresApiKey: Boolean(row.requires_api_key),
    config: parseStoredJson(row.config_json, {}),
    adapter,
    collectionSupported,
    collectionConfigured,
    missingSecretBinding: collectionConfigured ? '' : getSignalSourceSecretBinding(row),
    notes: row.notes,
    health: signalSourceHealth(row),
    lastFetchedAt: row.last_fetched_at,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastError: row.last_error,
    lastHttpStatus: row.last_http_status === null || row.last_http_status === undefined ? null : Number(row.last_http_status),
    lastItemCount: normalizePositiveInteger(row.last_item_count, 0),
    consecutiveFailures: normalizePositiveInteger(row.consecutive_failures, 0),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const signalCollectionRunToJson = (row) => ({
  id: row.id,
  triggerType: row.trigger_type,
  previousRunId: row.previous_run_id || '',
  status: row.status,
  requestedSourceIds: parseStoredJson(row.requested_source_ids_json, []),
  sourceCount: normalizePositiveInteger(row.source_count, 0),
  processedSourceCount: normalizePositiveInteger(row.processed_source_count, 0),
  fetchedCount: normalizePositiveInteger(row.fetched_count, 0),
  acceptedCount: normalizePositiveInteger(row.accepted_count, 0),
  duplicateCount: normalizePositiveInteger(row.duplicate_count, 0),
  failedCount: normalizePositiveInteger(row.failed_count, 0),
  errors: parseStoredJson(row.error_json, []),
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const signalAutomationAlertToJson = (row) => ({
  id: row.id,
  dedupeKey: row.dedupe_key,
  alertType: signalAutomationAlertTypes.has(row.alert_type) ? row.alert_type : 'queue_failure',
  severity: signalAutomationAlertSeverities.has(row.severity) ? row.severity : 'warning',
  status: row.status === 'resolved' ? 'resolved' : 'open',
  title: row.title,
  message: row.message,
  runId: row.run_id || '',
  sourceId: row.source_id || '',
  occurrenceCount: Math.max(1, normalizePositiveInteger(row.occurrence_count, 1)),
  metadata: parseStoredJson(row.metadata_json, {}),
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  lastNotifiedAt: row.last_notified_at,
  notificationCount: normalizePositiveInteger(row.notification_count, 0),
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by || '',
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const signalAutomationRuntimeToJson = (row) => ({
  id: row?.id || signalAutomationRuntimeId,
  lastCronStartedAt: row?.last_cron_started_at || null,
  lastCronFinishedAt: row?.last_cron_finished_at || null,
  lastCronScheduledAt: row?.last_cron_scheduled_at || null,
  lastCronStatus: row?.last_cron_status || 'never',
  lastRunId: row?.last_run_id || '',
  lastQueuedCount: normalizePositiveInteger(row?.last_queued_count, 0),
  consecutiveFailures: normalizePositiveInteger(row?.consecutive_failures, 0),
  lastError: row?.last_error || '',
  createdAt: row?.created_at || null,
  updatedAt: row?.updated_at || null
});

const signalCandidateToJson = (row) => {
  const occurrenceCount = normalizePositiveInteger(row.occurrence_count, 1);
  const sourceCount = normalizePositiveInteger(row.occurrence_source_count, 1);
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name || '',
    runId: row.run_id,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    title: row.title,
    summary: row.summary,
    author: row.author,
    publishedAt: row.published_at,
    language: row.language,
    category: row.category,
    status: row.status,
    relevanceScore: row.relevance_score === null || row.relevance_score === undefined ? null : Number(row.relevance_score),
    scorePriority:
      row.relevance_score === null || row.relevance_score === undefined
        ? 'unscored'
        : signalScorePriority(Number(row.relevance_score)),
    scoreBreakdown: parseStoredJson(row.score_breakdown_json, {}),
    clusterKey: row.cluster_key || '',
    clusterSize: normalizePositiveInteger(row.cluster_size, row.cluster_key ? 1 : 0),
    titleFingerprint: row.title_fingerprint || '',
    occurrenceCount,
    sourceCount,
    mergedDuplicateCount: Math.max(occurrenceCount - 1, 0),
    decisionNote: row.decision_note || '',
    scoredAt: row.scored_at || null,
    contentHash: row.content_hash,
    metadata: parseStoredJson(row.metadata_json, {}),
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const signalSourceValidationError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeSignalAutomationSourcePayload = (payload, existing = null) => {
  const sourceType = cleanText(payload.sourceType ?? existing?.source_type ?? '', 30).toLowerCase();
  if (!signalAutomationSourceTypes.has(sourceType)) {
    throw signalSourceValidationError('SIGNAL_SOURCE_TYPE_INVALID', '来源类型必须是 RSS、API 或网页。');
  }

  const category = cleanText(payload.category ?? existing?.category ?? 'general', 30).toLowerCase();
  if (!signalAutomationCategories.has(category)) {
    throw signalSourceValidationError('SIGNAL_SOURCE_CATEGORY_INVALID', '来源分类无效。');
  }

  const trustTier = cleanText(payload.trustTier ?? existing?.trust_tier ?? 'primary', 30).toLowerCase();
  if (!signalAutomationTrustTiers.has(trustTier)) {
    throw signalSourceValidationError('SIGNAL_SOURCE_TRUST_INVALID', '来源可信等级无效。');
  }

  const name = cleanText(payload.name ?? existing?.name, 160);
  if (!name) throw signalSourceValidationError('SIGNAL_SOURCE_NAME_REQUIRED', '来源名称必填。');

  const endpointInput = cleanText(payload.endpointUrl ?? existing?.endpoint_url, 1000);
  const endpointUrl = normalizeSignalAutomationSourceUrl(endpointInput);
  if (!endpointUrl) {
    throw signalSourceValidationError(
      'SIGNAL_SOURCE_URL_INVALID',
      '采集地址必须是不含凭据、且指向公网主机的 HTTP(S) URL。'
    );
  }

  const homepageInput = cleanText(payload.homepageUrl ?? existing?.homepage_url, 1000);
  const homepageUrl = homepageInput ? normalizeSignalAutomationSourceUrl(homepageInput) : '';
  if (homepageInput && !homepageUrl) {
    throw signalSourceValidationError(
      'SIGNAL_SOURCE_HOMEPAGE_INVALID',
      '主页地址必须是不含凭据、且指向公网主机的 HTTP(S) URL。'
    );
  }

  const fetchIntervalMinutes = Number.parseInt(payload.fetchIntervalMinutes ?? existing?.fetch_interval_minutes ?? 360, 10);
  if (!Number.isFinite(fetchIntervalMinutes) || fetchIntervalMinutes < 15 || fetchIntervalMinutes > 10080) {
    throw signalSourceValidationError('SIGNAL_SOURCE_INTERVAL_INVALID', '采集间隔必须在 15 到 10080 分钟之间。');
  }

  const maxItemsPerRun = Number.parseInt(payload.maxItemsPerRun ?? existing?.max_items_per_run ?? 30, 10);
  if (!Number.isFinite(maxItemsPerRun) || maxItemsPerRun < 1 || maxItemsPerRun > 100) {
    throw signalSourceValidationError('SIGNAL_SOURCE_LIMIT_INVALID', '单次条数必须在 1 到 100 之间。');
  }

  const language = cleanText(payload.language ?? existing?.language ?? 'en', 20) || 'en';
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(language)) {
    throw signalSourceValidationError('SIGNAL_SOURCE_LANGUAGE_INVALID', '来源语言格式无效。');
  }

  if (payload.isEnabled !== undefined && typeof payload.isEnabled !== 'boolean') {
    throw signalSourceValidationError('SIGNAL_SOURCE_ENABLED_INVALID', '启用状态必须是布尔值。');
  }
  if (payload.requiresApiKey !== undefined && typeof payload.requiresApiKey !== 'boolean') {
    throw signalSourceValidationError('SIGNAL_SOURCE_API_KEY_FLAG_INVALID', 'API Key 标记必须是布尔值。');
  }

  const configValue =
    payload.config === undefined
      ? existing
        ? parseStoredJson(existing.config_json, {})
        : { adapter: signalAutomationDefaultAdapters[sourceType] }
      : normalizeJsonObject(payload.config);
  const previousDefaultAdapter = signalAutomationDefaultAdapters[existing?.source_type];
  if (
    !cleanText(configValue.adapter, 60) ||
    (existing && sourceType !== existing.source_type && configValue.adapter === previousDefaultAdapter)
  ) {
    configValue.adapter = signalAutomationDefaultAdapters[sourceType];
  }
  const configJson = JSON.stringify(configValue);
  if (configJson.length > 8000) {
    throw signalSourceValidationError('SIGNAL_SOURCE_CONFIG_TOO_LARGE', '来源配置过大。');
  }

  return {
    name,
    publisher: cleanText(payload.publisher ?? existing?.publisher, 160),
    sourceType,
    category,
    trustTier,
    endpointUrl,
    homepageUrl,
    language,
    isEnabled: payload.isEnabled === undefined ? Boolean(existing ? existing.is_enabled : true) : payload.isEnabled,
    fetchIntervalMinutes,
    maxItemsPerRun,
    requiresApiKey: payload.requiresApiKey === undefined ? Boolean(existing?.requires_api_key) : payload.requiresApiKey,
    configJson,
    notes: cleanText(payload.notes ?? existing?.notes, 1000)
  };
};

const handleAdminListSignalSources = async (env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationTablesReady(db))) return signalAutomationSetupResponse('sources');

  const response = await db
    .prepare(
      `SELECT *
       FROM signal_sources
       WHERE archived_at IS NULL
       ORDER BY is_enabled DESC,
                CASE trust_tier WHEN 'primary' THEN 0 WHEN 'established' THEN 1 ELSE 2 END,
                name ASC
       LIMIT 200`
    )
    .all();
  const sources = (response.results || []).map((source) => signalSourceToJson(source, signalCollectionSecrets(env)));
  return privateJson({
    ok: true,
    setupRequired: false,
    collectionReady: await ensureSignalCollectionPhase2Ready(db),
    sources,
    summary: {
      total: sources.length,
      enabled: sources.filter((source) => source.isEnabled).length,
      paused: sources.filter((source) => !source.isEnabled).length,
      errors: sources.filter((source) => source.health === 'error').length
    }
  });
};

const handleAdminSaveSignalSource = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationTablesReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_AUTOMATION_NOT_READY',
        message: '先应用 migrations/0019_signal_automation.sql，再管理采集来源。'
      },
      { status: 503 }
    );
  }
  if (!(await ensureContentTablesReady(db)) || !(await ensureAdminAuditLogsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'ADMIN_AUDIT_NOT_READY',
        message: '内容库或审计日志表未初始化，来源变更已阻止。'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid Signal source JSON.' }, { status: 400 });
  }

  const action = cleanText(payload.action || 'save', 30).toLowerCase();
  const sourceId = cleanText(payload.id, 120);
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_SOURCE_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }

  if (action === 'toggle') {
    if (!sourceId) {
      return privateJson({ ok: false, code: 'SIGNAL_SOURCE_ID_REQUIRED', message: '来源 ID 必填。' }, { status: 400 });
    }
    if (typeof payload.isEnabled !== 'boolean') {
      return privateJson(
        { ok: false, code: 'SIGNAL_SOURCE_ENABLED_INVALID', message: '启用状态必须是布尔值。' },
        { status: 400 }
      );
    }
    const source = await db
      .prepare(
        `UPDATE signal_sources
         SET is_enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND archived_at IS NULL
         RETURNING *`
      )
      .bind(payload.isEnabled ? 1 : 0, actorEmail, sourceId)
      .first();
    if (!source) {
      return privateJson({ ok: false, code: 'SIGNAL_SOURCE_NOT_FOUND', message: '没有找到这个来源。' }, { status: 404 });
    }
    await insertAdminAuditLog(db, {
      actorEmail,
      action: payload.isEnabled ? 'signal_source_enable' : 'signal_source_pause',
      targetType: 'signal_source',
      targetId: source.id,
      targetSlug: source.name,
      metadata: { endpointUrl: source.endpoint_url }
    });
    return privateJson({ ok: true, source: signalSourceToJson(source, signalCollectionSecrets(env)) });
  }

  if (action !== 'save') {
    return privateJson({ ok: false, code: 'SIGNAL_SOURCE_ACTION_INVALID', message: '不支持这个来源操作。' }, { status: 400 });
  }

  const existing = sourceId
    ? await db.prepare('SELECT * FROM signal_sources WHERE id = ? AND archived_at IS NULL').bind(sourceId).first()
    : null;
  if (sourceId && !existing) {
    return privateJson({ ok: false, code: 'SIGNAL_SOURCE_NOT_FOUND', message: '没有找到这个来源。' }, { status: 404 });
  }

  let normalized;
  try {
    normalized = normalizeSignalAutomationSourcePayload(payload, existing);
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'SIGNAL_SOURCE_INVALID', message: error.message }, { status: 400 });
  }

  try {
    const saved = existing
      ? await db
          .prepare(
            `UPDATE signal_sources
             SET name = ?, publisher = ?, source_type = ?, category = ?, trust_tier = ?,
                 endpoint_url = ?, homepage_url = ?, language = ?, is_enabled = ?,
                 fetch_interval_minutes = ?, max_items_per_run = ?, requires_api_key = ?,
                 config_json = ?, notes = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND archived_at IS NULL
             RETURNING *`
          )
          .bind(
            normalized.name,
            normalized.publisher,
            normalized.sourceType,
            normalized.category,
            normalized.trustTier,
            normalized.endpointUrl,
            normalized.homepageUrl,
            normalized.language,
            normalized.isEnabled ? 1 : 0,
            normalized.fetchIntervalMinutes,
            normalized.maxItemsPerRun,
            normalized.requiresApiKey ? 1 : 0,
            normalized.configJson,
            normalized.notes,
            actorEmail,
            existing.id
          )
          .first()
      : await db
          .prepare(
            `INSERT INTO signal_sources (
               id, name, publisher, source_type, category, trust_tier,
               endpoint_url, homepage_url, language, is_enabled,
               fetch_interval_minutes, max_items_per_run, requires_api_key,
               config_json, notes, created_by, updated_by
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING *`
          )
          .bind(
            `signal-source-${randomToken(12)}`,
            normalized.name,
            normalized.publisher,
            normalized.sourceType,
            normalized.category,
            normalized.trustTier,
            normalized.endpointUrl,
            normalized.homepageUrl,
            normalized.language,
            normalized.isEnabled ? 1 : 0,
            normalized.fetchIntervalMinutes,
            normalized.maxItemsPerRun,
            normalized.requiresApiKey ? 1 : 0,
            normalized.configJson,
            normalized.notes,
            actorEmail,
            actorEmail
          )
          .first();

    await insertAdminAuditLog(db, {
      actorEmail,
      action: existing ? 'signal_source_update' : 'signal_source_create',
      targetType: 'signal_source',
      targetId: saved.id,
      targetSlug: saved.name,
      metadata: {
        category: saved.category,
        endpointUrl: saved.endpoint_url,
        isEnabled: Boolean(saved.is_enabled),
        sourceType: saved.source_type
      }
    });

    return privateJson({ ok: true, source: signalSourceToJson(saved, signalCollectionSecrets(env)) });
  } catch (error) {
    if (/UNIQUE constraint failed: signal_sources\.endpoint_url/i.test(error?.message || '')) {
      return privateJson(
        { ok: false, code: 'SIGNAL_SOURCE_URL_DUPLICATE', message: '这个采集地址已经在白名单里。' },
        { status: 409 }
      );
    }
    throw error;
  }
};

const handleAdminListSignalCollectionRuns = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationTablesReady(db))) return signalAutomationSetupResponse('runs');

  const url = new URL(request.url);
  const requestedStatus = cleanText(url.searchParams.get('status'), 30).toLowerCase();
  const status = signalAutomationRunStatuses.has(requestedStatus) ? requestedStatus : '';
  const limit = Math.min(Math.max(normalizePositiveInteger(url.searchParams.get('limit'), 30), 1), 100);
  const response = status
    ? await db
        .prepare('SELECT * FROM signal_collection_runs WHERE status = ? ORDER BY created_at DESC LIMIT ?')
        .bind(status, limit)
        .all()
    : await db.prepare('SELECT * FROM signal_collection_runs ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  const runs = (response.results || []).map(signalCollectionRunToJson);
  return privateJson({
    ok: true,
    setupRequired: false,
    runs,
    summary: {
      total: runs.length,
      queued: runs.filter((run) => run.status === 'queued').length,
      running: runs.filter((run) => run.status === 'running').length,
      failed: runs.filter((run) => run.status === 'failed').length
    }
  });
};

const handleAdminListSignalCandidates = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationTablesReady(db))) return signalAutomationSetupResponse('candidates');

  const url = new URL(request.url);
  const requestedStatus = cleanText(url.searchParams.get('status'), 30).toLowerCase();
  const status = signalAutomationCandidateStatuses.has(requestedStatus) ? requestedStatus : '';
  const sourceId = cleanText(url.searchParams.get('sourceId'), 120);
  const requestedCategory = cleanText(url.searchParams.get('category'), 30).toLowerCase();
  const category = signalAutomationCategories.has(requestedCategory) ? requestedCategory : '';
  const query = cleanText(url.searchParams.get('query'), 160);
  const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
  const requestedMinScore = Number.parseInt(url.searchParams.get('minScore') || '0', 10);
  const minScore = Number.isFinite(requestedMinScore) ? Math.min(Math.max(requestedMinScore, 0), 100) : 0;
  const requestedSinceHours = Number.parseInt(url.searchParams.get('sinceHours') || '0', 10);
  const sinceHours = signalCandidateWindowHours.has(requestedSinceHours) ? requestedSinceHours : 24;
  const requestedDate = cleanText(url.searchParams.get('date'), 10);
  const candidateDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : '';
  const limit = Math.min(Math.max(normalizePositiveInteger(url.searchParams.get('limit'), 50), 1), 100);
  const baseClauses = [];
  const baseParams = [];
  if (sourceId) {
    baseClauses.push('candidate.source_id = ?');
    baseParams.push(sourceId);
  }
  if (category) {
    baseClauses.push('candidate.category = ?');
    baseParams.push(category);
  }
  if (query) {
    baseClauses.push(`(candidate.title LIKE ? ESCAPE '\\' OR candidate.summary LIKE ? ESCAPE '\\')`);
    baseParams.push(`%${escapedQuery}%`, `%${escapedQuery}%`);
  }
  if (minScore > 0) {
    baseClauses.push('candidate.relevance_score >= ?');
    baseParams.push(minScore);
  }
  if (candidateDate) {
    baseClauses.push(
      'datetime(COALESCE(candidate.published_at, candidate.created_at)) >= datetime(?)',
      "datetime(COALESCE(candidate.published_at, candidate.created_at)) < datetime(?, '+1 day')"
    );
    baseParams.push(candidateDate, candidateDate);
  } else if (sinceHours > 0) {
    baseClauses.push("datetime(COALESCE(candidate.published_at, candidate.created_at)) >= datetime('now', ?)");
    baseParams.push(`-${sinceHours} hours`);
  }
  const listClauses = [...baseClauses];
  const listParams = [...baseParams];
  if (status) {
    listClauses.push('candidate.status = ?');
    listParams.push(status);
  }
  const triageReady = await ensureSignalCandidateTriageReady(db);
  const dedupReady = triageReady && (await ensureSignalCandidateDeduplicationReady(db));
  const response = dedupReady
    ? await db
        .prepare(
          `WITH cluster_sizes AS (
             SELECT cluster_key, COUNT(*) AS cluster_size
             FROM signal_candidates
             WHERE cluster_key <> ''
             GROUP BY cluster_key
           ), occurrence_stats AS (
             SELECT candidate_id, COUNT(*) AS occurrence_count,
                    COUNT(DISTINCT source_id) AS occurrence_source_count
             FROM signal_candidate_occurrences
             GROUP BY candidate_id
           )
           SELECT candidate.*, source.name AS source_name,
                  COALESCE(cluster_sizes.cluster_size, 0) AS cluster_size,
                  COALESCE(occurrence_stats.occurrence_count, 1) AS occurrence_count,
                  COALESCE(occurrence_stats.occurrence_source_count, 1) AS occurrence_source_count
           FROM signal_candidates AS candidate
           LEFT JOIN signal_sources AS source ON source.id = candidate.source_id
           LEFT JOIN cluster_sizes ON cluster_sizes.cluster_key = candidate.cluster_key
           LEFT JOIN occurrence_stats ON occurrence_stats.candidate_id = candidate.id
           ${listClauses.length ? `WHERE ${listClauses.join(' AND ')}` : ''}
           ORDER BY CASE candidate.status
                      WHEN 'new' THEN 0
                      WHEN 'shortlisted' THEN 1
                      WHEN 'rejected' THEN 2
                      ELSE 3
                    END,
                    candidate.relevance_score DESC,
                    COALESCE(candidate.published_at, candidate.created_at) DESC
           LIMIT ?`
        )
        .bind(...listParams, limit)
        .all()
    : triageReady
    ? await db
        .prepare(
          `WITH cluster_sizes AS (
             SELECT cluster_key, COUNT(*) AS cluster_size
             FROM signal_candidates
             WHERE cluster_key <> ''
             GROUP BY cluster_key
           )
           SELECT candidate.*, source.name AS source_name,
                  COALESCE(cluster_sizes.cluster_size, 0) AS cluster_size
           FROM signal_candidates AS candidate
           LEFT JOIN signal_sources AS source ON source.id = candidate.source_id
           LEFT JOIN cluster_sizes ON cluster_sizes.cluster_key = candidate.cluster_key
           ${listClauses.length ? `WHERE ${listClauses.join(' AND ')}` : ''}
           ORDER BY CASE candidate.status
                      WHEN 'new' THEN 0
                      WHEN 'shortlisted' THEN 1
                      WHEN 'rejected' THEN 2
                      ELSE 3
                    END,
                    candidate.relevance_score DESC,
                    COALESCE(candidate.published_at, candidate.created_at) DESC
           LIMIT ?`
        )
        .bind(...listParams, limit)
        .all()
    : await db
        .prepare(
          `SELECT candidate.*, source.name AS source_name
           FROM signal_candidates AS candidate
           LEFT JOIN signal_sources AS source ON source.id = candidate.source_id
           ${listClauses.length ? `WHERE ${listClauses.join(' AND ')}` : ''}
           ORDER BY COALESCE(candidate.published_at, candidate.created_at) DESC
           LIMIT ?`
        )
        .bind(...listParams, limit)
        .all();
  const candidates = (response.results || []).map(signalCandidateToJson);
  const summaryStatement = dedupReady
    ? db.prepare(
      `WITH occurrence_stats AS (
         SELECT candidate_id, COUNT(*) AS occurrence_count
         FROM signal_candidate_occurrences
         GROUP BY candidate_id
       )
       SELECT COUNT(*) AS total,
              SUM(CASE WHEN candidate.status = 'new' THEN 1 ELSE 0 END) AS new_count,
              SUM(CASE WHEN candidate.status = 'shortlisted' THEN 1 ELSE 0 END) AS shortlisted_count,
              SUM(CASE WHEN candidate.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
              SUM(CASE WHEN candidate.status = 'used' THEN 1 ELSE 0 END) AS used_count,
              AVG(candidate.relevance_score) AS average_score,
              SUM(
                CASE WHEN COALESCE(occurrence_stats.occurrence_count, 1) > 1
                  THEN occurrence_stats.occurrence_count - 1
                  ELSE 0
                END
              ) AS merged_duplicate_count
       FROM signal_candidates AS candidate
       LEFT JOIN occurrence_stats ON occurrence_stats.candidate_id = candidate.id
       ${baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : ''}`
    )
    : db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN candidate.status = 'new' THEN 1 ELSE 0 END) AS new_count,
              SUM(CASE WHEN candidate.status = 'shortlisted' THEN 1 ELSE 0 END) AS shortlisted_count,
              SUM(CASE WHEN candidate.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
              SUM(CASE WHEN candidate.status = 'used' THEN 1 ELSE 0 END) AS used_count,
              AVG(candidate.relevance_score) AS average_score
       FROM signal_candidates AS candidate
       ${baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : ''}`
    );
  const summaryRow = baseParams.length
    ? await summaryStatement.bind(...baseParams).first()
    : await summaryStatement.first();
  return privateJson({
    ok: true,
    setupRequired: false,
    triageReady,
    dedupReady,
    date: candidateDate || null,
    windowHours: candidateDate ? 0 : sinceHours,
    candidates,
    summary: {
      total: normalizePositiveInteger(summaryRow?.total, 0),
      new: normalizePositiveInteger(summaryRow?.new_count, 0),
      shortlisted: normalizePositiveInteger(summaryRow?.shortlisted_count, 0),
      rejected: normalizePositiveInteger(summaryRow?.rejected_count, 0),
      used: normalizePositiveInteger(summaryRow?.used_count, 0),
      mergedDuplicates: normalizePositiveInteger(summaryRow?.merged_duplicate_count, 0),
      averageScore:
        summaryRow?.average_score === null || summaryRow?.average_score === undefined
          ? null
          : Number(Number(summaryRow.average_score).toFixed(1))
    }
  });
};

const normalizeSignalCandidateReviewPayload = (payload) => {
  const action = cleanText(payload?.action, 30).toLowerCase();
  if (!signalCandidateReviewActions.has(action)) {
    throw signalSourceValidationError('SIGNAL_CANDIDATE_ACTION_INVALID', '候选操作无效。');
  }
  const rawIds = Array.isArray(payload?.candidateIds)
    ? payload.candidateIds
    : [payload?.candidateId || payload?.id].filter(Boolean);
  const candidateIds = [...new Set(rawIds.map((value) => cleanText(value, 120)).filter(Boolean))];
  if (action !== 'rescore' && !candidateIds.length) {
    throw signalSourceValidationError('SIGNAL_CANDIDATE_ID_REQUIRED', '至少选择一条候选资讯。');
  }
  if (candidateIds.length > 25) {
    throw signalSourceValidationError('SIGNAL_CANDIDATE_LIMIT_EXCEEDED', '单次最多审核 25 条候选资讯。');
  }
  return {
    action,
    candidateIds,
    note: cleanText(payload?.note, 500)
  };
};

const rescoreSignalCandidates = async (db) => {
  const dedupReady = await ensureSignalCandidateDeduplicationReady(db);
  const response = await db
    .prepare(
      `SELECT candidate.*, source.trust_tier AS source_trust_tier,
              source.category AS source_category
       FROM signal_candidates AS candidate
       LEFT JOIN signal_sources AS source ON source.id = candidate.source_id
       ORDER BY COALESCE(candidate.published_at, candidate.created_at) DESC
       LIMIT 500`
    )
    .all();
  const rows = (response.results || []).map((row) => ({
    ...row,
    source: {
      category: row.source_category || row.category,
      trust_tier: row.source_trust_tier || 'community'
    }
  }));
  const enriched = await enrichSignalCandidateRows(rows, { now: new Date() });
  for (let index = 0; index < enriched.length; index += 50) {
    const chunk = enriched.slice(index, index + 50);
    await db.batch(
      chunk.map((row) =>
        dedupReady
          ? db
              .prepare(
                `UPDATE signal_candidates
                 SET relevance_score = ?, score_breakdown_json = ?, cluster_key = ?,
                     title_fingerprint = ?, metadata_json = ?, scored_at = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`
              )
              .bind(
                row.relevanceScore,
                row.scoreBreakdownJson,
                row.clusterKey,
                row.titleFingerprint,
                row.metadataJson,
                row.scoredAt,
                row.id
              )
          : db
              .prepare(
                `UPDATE signal_candidates
                 SET relevance_score = ?, score_breakdown_json = ?, cluster_key = ?,
                     metadata_json = ?, scored_at = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`
              )
              .bind(
                row.relevanceScore,
                row.scoreBreakdownJson,
                row.clusterKey,
                row.metadataJson,
                row.scoredAt,
                row.id
              )
      )
    );
  }
  return enriched.length;
};

const handleAdminReviewSignalCandidates = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationTablesReady(db)) || !(await ensureSignalCandidateTriageReady(db))) {
    return signalCandidateTriageSetupResponse();
  }
  if (!(await ensureContentTablesReady(db)) || !(await ensureAdminAuditLogsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'ADMIN_AUDIT_NOT_READY',
        message: '内容库或审计日志表未初始化，候选审核已阻止。'
      },
      { status: 503 }
    );
  }

  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_CANDIDATE_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid candidate review JSON.' }, { status: 400 });
  }

  let normalized;
  try {
    normalized = normalizeSignalCandidateReviewPayload(payload);
  } catch (error) {
    return privateJson(
      { ok: false, code: error.code || 'SIGNAL_CANDIDATE_REVIEW_INVALID', message: error.message },
      { status: 400 }
    );
  }

  if (normalized.action === 'rescore') {
    const rescored = await rescoreSignalCandidates(db);
    await insertAdminAuditLog(db, {
      actorEmail,
      action: 'signal_candidates_rescore',
      targetType: 'signal_candidate',
      targetId: 'all',
      targetSlug: 'candidate-review-queue',
      metadata: { rescored }
    });
    return privateJson({ ok: true, rescored });
  }

  const placeholders = normalized.candidateIds.map(() => '?').join(', ');
  const response = await db
    .prepare(`SELECT * FROM signal_candidates WHERE id IN (${placeholders})`)
    .bind(...normalized.candidateIds)
    .all();
  const candidates = response.results || [];
  if (candidates.length !== normalized.candidateIds.length) {
    return privateJson(
      { ok: false, code: 'SIGNAL_CANDIDATE_NOT_FOUND', message: '部分候选资讯已经不存在，请刷新后重试。' },
      { status: 404 }
    );
  }
  if (candidates.some((candidate) => candidate.status === 'used')) {
    return privateJson(
      { ok: false, code: 'SIGNAL_CANDIDATE_ALREADY_USED', message: '已用于简报的候选不能修改审核状态。' },
      { status: 409 }
    );
  }

  const targetStatus = {
    reject: 'rejected',
    restore: 'new',
    shortlist: 'shortlisted'
  }[normalized.action];
  const changes = candidates.filter((candidate) => candidate.status !== targetStatus);
  if (!changes.length) {
    return privateJson(
      { ok: false, code: 'SIGNAL_CANDIDATE_STATUS_UNCHANGED', message: '候选资讯已经处于这个状态。' },
      { status: 409 }
    );
  }

  const statements = [];
  for (const candidate of changes) {
    statements.push(
      db
        .prepare(
          `INSERT INTO signal_candidate_reviews (
             id, candidate_id, action, from_status, to_status, note, actor_email
           )
           SELECT ?, candidate.id, ?, candidate.status, ?, ?, ?
           FROM signal_candidates AS candidate
           WHERE candidate.id = ? AND candidate.status = ?`
        )
        .bind(
          `signal-review-${randomToken(14)}`,
          normalized.action,
          targetStatus,
          normalized.note,
          actorEmail,
          candidate.id,
          candidate.status
        ),
      db
        .prepare(
          `UPDATE signal_candidates
           SET status = ?, decision_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = ?`
        )
        .bind(targetStatus, normalized.note, actorEmail, candidate.id, candidate.status)
    );
  }
  // D1 batches are transactional: the guarded history insert and matching update either describe the same transition or both no-op.
  const batchResults = await db.batch(statements);
  const appliedChanges = changes.filter(
    (_candidate, index) => normalizePositiveInteger(batchResults[index * 2 + 1]?.meta?.changes, 0) > 0
  );
  const conflictedChanges = changes.filter((candidate) => !appliedChanges.includes(candidate));
  if (appliedChanges.length) {
    await insertAdminAuditLog(db, {
      actorEmail,
      action: `signal_candidate_${normalized.action}`,
      targetType: 'signal_candidate',
      targetId: appliedChanges.length === 1 ? appliedChanges[0].id : 'batch',
      targetSlug: appliedChanges.length === 1 ? appliedChanges[0].title : `${appliedChanges.length} candidates`,
      metadata: {
        candidateIds: appliedChanges.map((candidate) => candidate.id),
        fromStatuses: [...new Set(appliedChanges.map((candidate) => candidate.status))],
        note: normalized.note,
        toStatus: targetStatus
      }
    });
  }
  if (conflictedChanges.length) {
    return privateJson(
      {
        ok: false,
        appliedCount: appliedChanges.length,
        code: 'SIGNAL_CANDIDATE_STATUS_CONFLICT',
        conflictedIds: conflictedChanges.map((candidate) => candidate.id),
        message: appliedChanges.length
          ? `已处理 ${appliedChanges.length} 条，另有 ${conflictedChanges.length} 条状态已变化，请刷新后确认。`
          : '候选状态已被其他操作修改，请刷新后重试。'
      },
      { status: 409 }
    );
  }

  const updatedResponse = await db
    .prepare(
      `SELECT candidate.*, source.name AS source_name,
              (SELECT COUNT(*)
               FROM signal_candidates AS related
               WHERE related.cluster_key <> '' AND related.cluster_key = candidate.cluster_key) AS cluster_size
       FROM signal_candidates AS candidate
       LEFT JOIN signal_sources AS source ON source.id = candidate.source_id
       WHERE candidate.id IN (${placeholders})`
    )
    .bind(...normalized.candidateIds)
    .all();
  return privateJson({ ok: true, candidates: (updatedResponse.results || []).map(signalCandidateToJson) });
};

const signalCollectionMaxAttempts = 3;
const signalCollectionStaleAfterMinutes = 120;
const signalAutomationCronGapMinutes = 180;
const signalAutomationCronCriticalMinutes = 360;
const signalAutomationHistoryRetentionDays = 90;
const signalAutomationResolvedAlertRetentionDays = 30;
const signalAutomationSourceFailureAlertThreshold = 3;
const signalCollectionTaskStatuses = new Set(['queued', 'running', 'completed', 'failed']);

const signalCollectionPhase2SetupResponse = () =>
  privateJson(
    {
      ok: false,
      code: 'SIGNAL_COLLECTION_NOT_READY',
      message: '先应用 migrations/0020_signal_collection.sql，再启动资讯采集。',
      migration: '0020_signal_collection.sql',
      setupRequired: true
    },
    { status: 503 }
  );

const signalAutomationOperationsSetupResponse = (options = {}) =>
  privateJson(
    {
      ok: options.status === 200,
      code: 'SIGNAL_OPERATIONS_NOT_READY',
      message: '先应用 migrations/0024_signal_operations.sql，再查看自动化运行状态。',
      migration: '0024_signal_operations.sql',
      setupRequired: true
    },
    { status: options.status || 503 }
  );

const signalAutomationLog = (level, event, details = {}) => {
  const entry = JSON.stringify({ component: 'signal_automation', event, ...details });
  if (level === 'error') {
    console.error(entry);
  } else if (level === 'warn') {
    console.warn(entry);
  } else {
    console.log(entry);
  }
};

const signalAutomationAlertRecipients = (env) =>
  splitEnvList(env.SIGNAL_ALERT_EMAILS || env.ADMIN_ALLOWED_EMAILS || defaultAdminEmail)
    .map((email) => email.toLowerCase())
    .filter(isEmail)
    .slice(0, 5);

const notifySignalAutomationAlert = async (env, alert) => {
  if (alert?.severity !== 'critical' || alert?.last_notified_at) return { configured: false, sent: 0 };
  if (!env.EMAIL || typeof env.EMAIL.send !== 'function') return { configured: false, sent: 0 };
  const recipients = signalAutomationAlertRecipients(env);
  if (!recipients.length) return { configured: false, sent: 0 };

  const fromEmail = env.READER_EMAIL_FROM || 'noreply@wwwstationcat.org';
  const fromName = env.READER_EMAIL_FROM_NAME || 'Station Cat';
  const subject = `[Station Cat Signal] ${cleanText(alert.title, 160)}`;
  const adminUrl = 'https://wwwstationcat.org/admin-v2/#signal';
  const text = [alert.title, '', alert.message, '', `查看后台：${adminUrl}`].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#17211f">
    <h1 style="font-size:20px">${escapeHtml(alert.title)}</h1>
    <p>${escapeHtml(alert.message)}</p>
    <p><a href="${adminUrl}">打开 Station Cat 后台</a></p>
  </div>`;
  let sent = 0;
  for (const recipient of recipients) {
    try {
      await env.EMAIL.send({
        to: recipient,
        from: { email: fromEmail, name: fromName },
        subject,
        text,
        html
      });
      sent += 1;
    } catch (error) {
      signalAutomationLog('error', 'alert_email_failed', {
        alertId: alert.id,
        code: cleanText(error?.code, 120),
        message: cleanText(error?.message, 300)
      });
    }
  }
  if (sent > 0) {
    await env.WAITLIST_DB
      .prepare(
        `UPDATE signal_automation_alerts
         SET last_notified_at = CURRENT_TIMESTAMP,
             notification_count = notification_count + ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND last_notified_at IS NULL`
      )
      .bind(sent, alert.id)
      .run();
  }
  return { configured: true, sent };
};

const openSignalAutomationAlert = async (env, input) => {
  const db = env.WAITLIST_DB;
  if (!db || !(await ensureSignalAutomationOperationsReady(db))) return null;
  const alertType = signalAutomationAlertTypes.has(input.alertType) ? input.alertType : 'queue_failure';
  const severity = signalAutomationAlertSeverities.has(input.severity) ? input.severity : 'warning';
  const dedupeKey = cleanText(input.dedupeKey, 240);
  const title = cleanText(input.title, 200);
  const message = cleanText(input.message, 1000);
  if (!dedupeKey || !title || !message) return null;
  const metadataJson = JSON.stringify(input.metadata && typeof input.metadata === 'object' ? input.metadata : {});
  const alert = await db
    .prepare(
      `INSERT INTO signal_automation_alerts (
         id, dedupe_key, alert_type, severity, status, title, message,
         run_id, source_id, metadata_json
       ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         alert_type = excluded.alert_type,
         severity = excluded.severity,
         status = 'open',
         title = excluded.title,
         message = excluded.message,
         run_id = excluded.run_id,
         source_id = excluded.source_id,
         occurrence_count = signal_automation_alerts.occurrence_count + 1,
         metadata_json = excluded.metadata_json,
         last_seen_at = CURRENT_TIMESTAMP,
         last_notified_at = CASE
           WHEN signal_automation_alerts.status = 'resolved' THEN NULL
           ELSE signal_automation_alerts.last_notified_at
         END,
         resolved_at = NULL,
         resolved_by = '',
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`
    )
    .bind(
      `signal-alert-${randomToken(14)}`,
      dedupeKey,
      alertType,
      severity,
      title,
      message,
      cleanText(input.runId, 120) || null,
      cleanText(input.sourceId, 120) || null,
      metadataJson
    )
    .first();
  if (alert) await notifySignalAutomationAlert(env, alert);
  return alert ? signalAutomationAlertToJson(alert) : null;
};

const resolveSignalAutomationAlert = async (db, options = {}) => {
  const actor = cleanText(options.actor || 'signal-system', 320);
  const alertId = cleanText(options.alertId, 120);
  const dedupeKey = cleanText(options.dedupeKey, 240);
  if (!alertId && !dedupeKey) return null;
  const clause = alertId ? 'id = ?' : 'dedupe_key = ?';
  return db
    .prepare(
      `UPDATE signal_automation_alerts
       SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE ${clause} AND status = 'open'
       RETURNING *`
    )
    .bind(actor, alertId || dedupeKey)
    .first();
};

const pruneSignalAutomationHistory = async (db, options = {}) => {
  const runRetentionDays = Math.max(30, normalizePositiveInteger(options.runRetentionDays, signalAutomationHistoryRetentionDays));
  const alertRetentionDays = Math.max(
    7,
    normalizePositiveInteger(options.alertRetentionDays, signalAutomationResolvedAlertRetentionDays)
  );
  const [runResult, alertResult] = await db.batch([
    db
      .prepare(
        `DELETE FROM signal_collection_runs
         WHERE status IN ('completed', 'partial', 'failed', 'cancelled')
           AND datetime(COALESCE(finished_at, updated_at, created_at)) < datetime('now', ?)`
      )
      .bind(`-${runRetentionDays} days`),
    db
      .prepare(
        `DELETE FROM signal_automation_alerts
         WHERE status = 'resolved'
           AND datetime(COALESCE(resolved_at, updated_at, created_at)) < datetime('now', ?)`
      )
      .bind(`-${alertRetentionDays} days`)
  ]);
  return {
    alertsDeleted: getD1ChangeCount(alertResult),
    runsDeleted: getD1ChangeCount(runResult)
  };
};

const beginSignalAutomationCron = async (env, options = {}) => {
  const db = env.WAITLIST_DB;
  if (!db || !(await ensureSignalAutomationOperationsReady(db))) return null;
  const previous = await db
    .prepare('SELECT * FROM signal_automation_runtime WHERE id = ?')
    .bind(signalAutomationRuntimeId)
    .first();
  const previousMs = parseSqlTimestampMs(previous?.last_cron_started_at);
  const gapMinutes = previousMs ? Math.floor((Date.now() - previousMs) / 60000) : 0;
  if (gapMinutes > signalAutomationCronGapMinutes) {
    await openSignalAutomationAlert(env, {
      alertType: 'scheduler_gap',
      dedupeKey: 'scheduler:gap',
      severity: gapMinutes >= signalAutomationCronCriticalMinutes ? 'critical' : 'warning',
      title: 'Signal 定时任务曾中断',
      message: `距离上一次 Cron 启动已过去 ${gapMinutes} 分钟，请检查 Worker、Cron 和 Queue 状态。`,
      metadata: { gapMinutes }
    });
  } else if (previousMs) {
    await resolveSignalAutomationAlert(db, { actor: 'signal-cron', dedupeKey: 'scheduler:gap' });
  }

  const scheduledAt = Number.isFinite(options.scheduledTime)
    ? new Date(options.scheduledTime).toISOString()
    : new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO signal_automation_runtime (
         id, last_cron_started_at, last_cron_scheduled_at, last_cron_status,
         last_error, updated_at
       ) VALUES (?, CURRENT_TIMESTAMP, ?, 'running', '', CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         last_cron_started_at = CURRENT_TIMESTAMP,
         last_cron_scheduled_at = excluded.last_cron_scheduled_at,
         last_cron_status = 'running',
         last_error = '',
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(signalAutomationRuntimeId, scheduledAt)
    .run();
  return { gapMinutes, scheduledAt };
};

const completeSignalAutomationCron = async (env, result = {}) => {
  const db = env.WAITLIST_DB;
  if (!db || !(await ensureSignalAutomationOperationsReady(db))) return null;
  const queued = normalizePositiveInteger(result.queued, 0);
  const status = queued > 0 ? 'queued' : 'skipped';
  const runtime = await db
    .prepare(
      `UPDATE signal_automation_runtime
       SET last_cron_finished_at = CURRENT_TIMESTAMP, last_cron_status = ?,
           last_run_id = ?, last_queued_count = ?, consecutive_failures = 0,
           last_error = '', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
    .bind(status, cleanText(result.runId, 120) || null, queued, signalAutomationRuntimeId)
    .first();
  await resolveSignalAutomationAlert(db, { actor: 'signal-cron', dedupeKey: 'scheduler:failure' });
  return runtime;
};

const failSignalAutomationCron = async (env, error) => {
  const db = env.WAITLIST_DB;
  if (!db || !(await ensureSignalAutomationOperationsReady(db))) return null;
  const message = cleanText(error?.message || 'Signal Cron 执行失败。', 1000);
  const runtime = await db
    .prepare(
      `UPDATE signal_automation_runtime
       SET last_cron_finished_at = CURRENT_TIMESTAMP, last_cron_status = 'failed',
           consecutive_failures = consecutive_failures + 1, last_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
    .bind(message, signalAutomationRuntimeId)
    .first();
  const failures = normalizePositiveInteger(runtime?.consecutive_failures, 1);
  await openSignalAutomationAlert(env, {
    alertType: 'scheduler_failure',
    dedupeKey: 'scheduler:failure',
    severity: failures >= 3 ? 'critical' : 'warning',
    title: 'Signal 定时任务执行失败',
    message: `${message}（连续失败 ${failures} 次）`,
    metadata: { consecutiveFailures: failures }
  });
  return runtime;
};

const isCollectibleSignalSource = (source, secrets = {}) =>
  Boolean(source?.is_enabled) &&
  supportedSignalCollectionAdapters.has(getSignalSourceAdapter(source)) &&
  isSignalSourceSecretConfigured(source, secrets);

const signalCollectionTaskToJson = (row) => ({
  id: row.id,
  runId: row.run_id,
  sourceId: row.source_id,
  status: signalCollectionTaskStatuses.has(row.status) ? row.status : 'queued',
  attempts: normalizePositiveInteger(row.attempts, 0),
  fetchedCount: normalizePositiveInteger(row.fetched_count, 0),
  acceptedCount: normalizePositiveInteger(row.accepted_count, 0),
  duplicateCount: normalizePositiveInteger(row.duplicate_count, 0),
  httpStatus: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
  notModified: Boolean(row.response_not_modified),
  lastError: row.last_error || '',
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const selectSignalCollectionSources = async (db, options = {}) => {
  const requestedIds = [...new Set((options.sourceIds || []).map((value) => cleanText(value, 120)).filter(Boolean))].slice(
    0,
    50
  );
  const filters = ['is_enabled = 1', 'archived_at IS NULL'];
  const bindings = [];
  if (options.onlyDue) {
    filters.push(`(
      last_fetched_at IS NULL
      OR datetime(last_fetched_at, '+' || fetch_interval_minutes || ' minutes') <= CURRENT_TIMESTAMP
    )`);
  }
  if (requestedIds.length) {
    filters.push(`id IN (${requestedIds.map(() => '?').join(', ')})`);
    bindings.push(...requestedIds);
  }
  const statement = db.prepare(
    `SELECT *
     FROM signal_sources
     WHERE ${filters.join('\n       AND ')}
     ORDER BY
       CASE trust_tier WHEN 'primary' THEN 0 WHEN 'established' THEN 1 ELSE 2 END,
       name ASC
     LIMIT 50`
  );
  const response = bindings.length ? await statement.bind(...bindings).all() : await statement.all();
  return (response.results || []).filter((source) => isCollectibleSignalSource(source, options.secrets));
};

const findActiveSignalCollectionRun = async (db) =>
  db
    .prepare(
      `SELECT * FROM signal_collection_runs
       WHERE status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`
    )
    .first();

const failQueuedSignalRun = async (db, runId, message) => {
  await db.batch([
    db
      .prepare(
        `UPDATE signal_collection_tasks
         SET status = 'failed', attempts = MAX(attempts, 1), last_error = ?,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE run_id = ? AND status IN ('queued', 'running')`
      )
      .bind(message, runId),
    db
      .prepare(
        `UPDATE signal_collection_runs
         SET status = 'failed', processed_source_count = source_count,
             failed_count = source_count, error_json = ?,
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('queued', 'running')`
      )
      .bind(JSON.stringify([{ message }]), runId)
  ]);
};

const expireStaleSignalCollectionRuns = async (
  db,
  maxAgeMinutes = signalCollectionStaleAfterMinutes,
  options = {}
) => {
  const staleAfterMinutes = Math.max(15, normalizePositiveInteger(maxAgeMinutes, signalCollectionStaleAfterMinutes));
  const cutoff = `-${staleAfterMinutes} minutes`;
  const response = await db
    .prepare(
      `SELECT id
       FROM signal_collection_runs
       WHERE status IN ('queued', 'running')
         AND datetime(updated_at) <= datetime('now', ?)
       ORDER BY updated_at ASC`
    )
    .bind(cutoff)
    .all();
  const staleRuns = response.results || [];
  for (const row of staleRuns) {
    const message = `采集任务超过 ${staleAfterMinutes} 分钟没有进展，已自动终止。`;
    await db
      .prepare(
        `UPDATE signal_collection_tasks
         SET status = 'failed', attempts = MAX(attempts, 1), last_error = ?,
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE run_id = ? AND status IN ('queued', 'running')`
      )
      .bind(message, row.id)
      .run();
    const refreshed = await refreshSignalCollectionRun(db, row.id);
    if (!refreshed || ['queued', 'running'].includes(refreshed.status)) {
      await failQueuedSignalRun(db, row.id, message);
    }
    if (options.env) {
      await openSignalAutomationAlert(options.env, {
        alertType: 'stale_run',
        dedupeKey: `run:${row.id}:stale`,
        severity: 'critical',
        title: 'Signal 采集任务卡死',
        message,
        runId: row.id,
        metadata: { staleAfterMinutes }
      });
    }
  }
  return staleRuns.map((row) => row.id);
};

const enqueueSignalCollectionRun = async (env, options = {}) => {
  const db = env.WAITLIST_DB;
  if (!db || !env.SIGNAL_COLLECTION_QUEUE) {
    throw signalSourceValidationError('SIGNAL_COLLECTION_QUEUE_MISSING', '资讯采集队列尚未配置。');
  }
  if (!(await ensureSignalAutomationTablesReady(db)) || !(await ensureSignalCollectionPhase2Ready(db))) {
    throw signalSourceValidationError('SIGNAL_COLLECTION_NOT_READY', '资讯采集数据表尚未初始化。');
  }

  await expireStaleSignalCollectionRuns(db, signalCollectionStaleAfterMinutes, { env });
  const activeRun = await findActiveSignalCollectionRun(db);
  if (activeRun) return { alreadyRunning: true, run: signalCollectionRunToJson(activeRun), sources: [] };

  const sources = await selectSignalCollectionSources(db, {
    onlyDue: options.triggerType === 'scheduled',
    secrets: signalCollectionSecrets(env),
    sourceIds: options.sourceIds || []
  });
  if (!sources.length) return { alreadyRunning: false, run: null, sources: [] };

  const runId = `signal-run-${randomToken(14)}`;
  const actor = cleanText(options.actor || 'signal-cron', 320);
  const triggerType = options.triggerType === 'retry' ? 'retry' : options.triggerType === 'manual' ? 'manual' : 'scheduled';
  const previousRunId = triggerType === 'retry' ? cleanText(options.previousRunId, 120) : '';
  const sourceIds = sources.map((source) => source.id);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO signal_collection_runs (
             id, trigger_type, status, requested_source_ids_json,
             source_count, processed_source_count, created_by, previous_run_id
           ) VALUES (?, ?, 'queued', ?, ?, 0, ?, ?)`
        )
        .bind(runId, triggerType, JSON.stringify(sourceIds), sources.length, actor, previousRunId || null),
      ...sources.map((source) =>
        db
          .prepare(
            `INSERT INTO signal_collection_tasks (id, run_id, source_id, status)
             VALUES (?, ?, ?, 'queued')`
          )
          .bind(`signal-task-${randomToken(14)}`, runId, source.id)
      )
    ]);
  } catch (error) {
    const concurrentRun = await findActiveSignalCollectionRun(db);
    if (concurrentRun) {
      return { alreadyRunning: true, run: signalCollectionRunToJson(concurrentRun), sources: [] };
    }
    throw error;
  }

  try {
    await env.SIGNAL_COLLECTION_QUEUE.sendBatch(
      sources.map((source) => ({ body: { version: 1, runId, sourceId: source.id } }))
    );
  } catch (error) {
    const message = cleanText(`队列写入失败：${error?.message || 'unknown error'}`, 500);
    await failQueuedSignalRun(db, runId, message);
    await openSignalAutomationAlert(env, {
      alertType: 'queue_failure',
      dedupeKey: `run:${runId}:queue`,
      severity: 'critical',
      title: 'Signal 采集队列写入失败',
      message,
      runId,
      metadata: { sourceCount: sources.length }
    });
    throw signalSourceValidationError('SIGNAL_COLLECTION_ENQUEUE_FAILED', message);
  }

  const run = await db.prepare('SELECT * FROM signal_collection_runs WHERE id = ?').bind(runId).first();
  return {
    alreadyRunning: false,
    run: signalCollectionRunToJson(run),
    sources: sources.map((source) => signalSourceToJson(source, signalCollectionSecrets(env)))
  };
};

const handleAdminCollectSignalSources = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationTablesReady(db))) return signalCollectionPhase2SetupResponse();
  if (!(await ensureSignalCollectionPhase2Ready(db))) return signalCollectionPhase2SetupResponse();
  if (!env.SIGNAL_COLLECTION_QUEUE) {
    return privateJson(
      { ok: false, code: 'SIGNAL_COLLECTION_QUEUE_MISSING', message: '资讯采集队列尚未配置。' },
      { status: 503 }
    );
  }
  if (!(await ensureContentTablesReady(db)) || !(await ensureAdminAuditLogsReady(db))) {
    return privateJson(
      { ok: false, code: 'ADMIN_AUDIT_NOT_READY', message: '内容库或审计日志表未初始化，采集已阻止。' },
      { status: 503 }
    );
  }

  let payload = {};
  try {
    const body = await request.text();
    payload = body ? JSON.parse(body) : {};
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid Signal collection JSON.' }, { status: 400 });
  }
  if (payload.sourceIds !== undefined && !Array.isArray(payload.sourceIds)) {
    return privateJson(
      { ok: false, code: 'SIGNAL_SOURCE_IDS_INVALID', message: '来源范围格式无效。' },
      { status: 400 }
    );
  }
  const sourceIds = [...new Set((payload.sourceIds || []).map((value) => cleanText(value, 120)).filter(Boolean))].slice(0, 50);
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_COLLECTION_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }

  try {
    const result = await enqueueSignalCollectionRun(env, {
      actor: actorEmail,
      sourceIds,
      triggerType: 'manual'
    });
    if (result.alreadyRunning) {
      return privateJson({
        ok: true,
        alreadyRunning: true,
        code: 'SIGNAL_COLLECTION_ALREADY_RUNNING',
        message: '已有采集任务正在进行，本次没有重复创建。',
        run: result.run,
        sources: []
      });
    }
    if (!result.run) {
      return privateJson(
        {
          ok: false,
          code: 'SIGNAL_COLLECTION_NO_SOURCES',
          message: sourceIds.length ? '所选来源不可采集或已暂停。' : '没有可采集的免费来源。'
        },
        { status: 409 }
      );
    }
    await insertAdminAuditLog(db, {
      actorEmail,
      action: 'signal_collection_start',
      targetType: 'signal_collection_run',
      targetId: result.run.id,
      targetSlug: result.run.id,
      metadata: { sourceIds: result.sources.map((source) => source.id), triggerType: 'manual' }
    });
    return privateJson({
      ok: true,
      message: `已把 ${result.sources.length} 个来源加入采集队列。`,
      run: result.run,
      sources: result.sources
    });
  } catch (error) {
    const status = error?.code === 'SIGNAL_COLLECTION_NOT_READY' ? 503 : 502;
    return privateJson(
      { ok: false, code: error?.code || 'SIGNAL_COLLECTION_FAILED', message: error?.message || '无法启动资讯采集。' },
      { status }
    );
  }
};

const refreshSignalCollectionRun = async (db, runId) => {
  // This read/aggregate/update sequence relies on the queue consumer remaining at max_concurrency = 1.
  const metrics = await db
    .prepare(
      `SELECT
         COUNT(*) AS source_count,
         SUM(CASE WHEN status IN ('completed', 'failed') THEN 1 ELSE 0 END) AS processed_source_count,
         SUM(fetched_count) AS fetched_count,
         SUM(accepted_count) AS accepted_count,
         SUM(duplicate_count) AS duplicate_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
       FROM signal_collection_tasks
       WHERE run_id = ?`
    )
    .bind(runId)
    .first();
  const sourceCount = normalizePositiveInteger(metrics?.source_count, 0);
  const processedSourceCount = normalizePositiveInteger(metrics?.processed_source_count, 0);
  const failedCount = normalizePositiveInteger(metrics?.failed_count, 0);
  const finished = sourceCount > 0 && processedSourceCount >= sourceCount;
  const status = !finished ? 'running' : failedCount === 0 ? 'completed' : failedCount < sourceCount ? 'partial' : 'failed';
  const errorResponse = await db
    .prepare(
      `SELECT source_id, last_error
       FROM signal_collection_tasks
       WHERE run_id = ? AND status = 'failed'
       ORDER BY finished_at ASC, source_id ASC`
    )
    .bind(runId)
    .all();
  const errors = (errorResponse.results || []).map((row) => ({ sourceId: row.source_id, message: row.last_error }));
  return db
    .prepare(
      `UPDATE signal_collection_runs
       SET status = ?, source_count = ?, processed_source_count = ?,
           fetched_count = ?, accepted_count = ?, duplicate_count = ?, failed_count = ?,
           error_json = ?, started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
           finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
    .bind(
      status,
      sourceCount,
      processedSourceCount,
      normalizePositiveInteger(metrics?.fetched_count, 0),
      normalizePositiveInteger(metrics?.accepted_count, 0),
      normalizePositiveInteger(metrics?.duplicate_count, 0),
      failedCount,
      JSON.stringify(errors),
      finished ? 1 : 0,
      runId
    )
    .first();
};

const buildSignalCandidateRows = async (source, runId, collection) => {
  const seenUrls = new Set();
  const seenHashes = new Set();
  const rows = [];
  for (const item of collection.items || []) {
    const canonicalUrl = cleanText(item.canonicalUrl, 1000);
    const title = cleanText(item.title, 300);
    if (!canonicalUrl || !title || seenUrls.has(canonicalUrl)) continue;
    const contentHash = await signalContentHash(item);
    if (!contentHash || seenHashes.has(contentHash)) continue;
    seenUrls.add(canonicalUrl);
    seenHashes.add(contentHash);
    rows.push({
      author: cleanText(item.author, 160),
      canonicalUrl,
      category: source.category || 'general',
      contentHash,
      externalId: cleanText(item.externalId, 300),
      id: `signal-candidate-${randomToken(14)}`,
      metadataJson: JSON.stringify({
        adapter: getSignalSourceAdapter(source),
        fetchedFrom: collection.finalUrl,
        itemErrors: collection.itemErrors || 0,
        trustTier: source.trust_tier
      }),
      publishedAt: item.publishedAt || null,
      rawPayloadJson: JSON.stringify({
        author: cleanText(item.author, 160),
        externalId: cleanText(item.externalId, 300),
        publishedAt: item.publishedAt || null,
        summary: cleanText(item.summary, 1200),
        title
      }),
      runId,
      summary: cleanText(item.summary, 1200),
      title,
      titleFingerprint: signalTitleFingerprint(title)
    });
  }
  return rows;
};

const loadSignalCandidateMergePool = async (db, rows) => {
  const canonicalUrls = [...new Set(rows.map((row) => row.canonicalUrl).filter(Boolean))];
  const contentHashes = [...new Set(rows.map((row) => row.contentHash).filter(Boolean))];
  const titleFingerprints = [...new Set(rows.map((row) => row.titleFingerprint).filter(Boolean))];
  const selectColumns = `SELECT id, canonical_url, content_hash, title, title_fingerprint, category,
                                published_at, created_at, cluster_key
                         FROM signal_candidates`;
  const candidates = new Map();
  const addCandidates = (response) => {
    for (const candidate of response?.results || []) candidates.set(candidate.id, candidate);
  };

  addCandidates(
    await db
      .prepare(
        `${selectColumns}
         WHERE created_at >= datetime('now', '-7 days')
         ORDER BY created_at DESC
         LIMIT 1000`
      )
      .all()
  );

  // D1 accepts at most 100 bound parameters per query. Keep exact persisted
  // lookups separate so a 50-item feed cannot combine three fields into 150 binds.
  const lookupBatchSize = 100;
  for (const [column, values] of [
    ['canonical_url', canonicalUrls],
    ['content_hash', contentHashes],
    ['title_fingerprint', titleFingerprints]
  ]) {
    for (let offset = 0; offset < values.length; offset += lookupBatchSize) {
      const batch = values.slice(offset, offset + lookupBatchSize);
      addCandidates(
        await db
          .prepare(
            `${selectColumns}
             WHERE ${column} IN (${batch.map(() => '?').join(', ')})
             ORDER BY created_at DESC
             LIMIT 1000`
          )
          .bind(...batch)
          .all()
      );
    }
  }

  return { results: [...candidates.values()] };
};

const signalCandidateOccurrenceMetadata = (row, candidateId, matchReason) => {
  const metadata = parseStoredJson(row.metadataJson, {});
  metadata.deduplication = {
    candidateId,
    matchReason
  };
  return JSON.stringify(metadata);
};

const insertSignalCandidateOccurrence = async (db, source, row, candidateId, matchReason) => {
  const occurrenceId = `signal-occurrence-${randomToken(14)}`;
  const automaticRestoreNote = '同一事件出现新增报道，已自动回到待审核。';
  const automaticActor = 'signal-automation';
  // The random occurrence id lets the guarded restore no-op when this report is only a replay.
  return db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO signal_candidate_occurrences (
           id, candidate_id, source_id, run_id, canonical_url, title, summary,
           published_at, content_hash, title_fingerprint, match_reason, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        occurrenceId,
        candidateId,
        source.id,
        row.runId,
        row.canonicalUrl,
        row.title,
        row.summary,
        row.publishedAt,
        row.contentHash,
        row.titleFingerprint,
        matchReason,
        signalCandidateOccurrenceMetadata(row, candidateId, matchReason)
      ),
    db
      .prepare(
        `INSERT INTO signal_candidate_reviews (
           id, candidate_id, action, from_status, to_status, note, actor_email
         )
         SELECT ?, candidate.id, 'restore', 'rejected', 'new', ?, ?
         FROM signal_candidates AS candidate
         WHERE candidate.id = ? AND candidate.status = 'rejected'
           AND EXISTS (
             SELECT 1 FROM signal_candidate_occurrences AS occurrence
             WHERE occurrence.id = ? AND occurrence.candidate_id = candidate.id
           )`
      )
      .bind(
        `signal-review-${randomToken(14)}`,
        automaticRestoreNote,
        automaticActor,
        candidateId,
        occurrenceId
      ),
    db
      .prepare(
        `UPDATE signal_candidates
         SET status = 'new', decision_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'rejected'
           AND EXISTS (
             SELECT 1 FROM signal_candidate_occurrences AS occurrence
             WHERE occurrence.id = ? AND occurrence.candidate_id = signal_candidates.id
           )`
      )
      .bind(automaticRestoreNote, automaticActor, candidateId, occurrenceId)
  ]);
};

const findPersistedSignalCandidateMatch = async (db, row, now) => {
  const response = await db
    .prepare(
      `SELECT id, canonical_url, content_hash, title, title_fingerprint, category,
              published_at, created_at, cluster_key
       FROM signal_candidates
       WHERE canonical_url = ? OR content_hash = ?
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .bind(row.canonicalUrl, row.contentHash)
    .all();
  return findSignalCandidateMergeMatch(row, response.results || [], { now });
};

const insertSignalCandidates = async (db, source, rows) => {
  if (!rows.length) return { acceptedCount: 0, duplicateCount: 0 };
  const triageReady = await ensureSignalCandidateTriageReady(db);
  const dedupReady = triageReady && (await ensureSignalCandidateDeduplicationReady(db));
  const triageNow = new Date();
  let insertRows = rows;
  let existingCandidates = [];
  if (triageReady) {
    const existingResponse = dedupReady
      ? await loadSignalCandidateMergePool(db, rows)
      : await db
          .prepare(
            `SELECT id, title, cluster_key
             FROM signal_candidates
             WHERE created_at >= datetime('now', '-7 days')
             ORDER BY created_at DESC
             LIMIT 300`
          )
          .all();
    existingCandidates = existingResponse.results || [];
    insertRows = await enrichSignalCandidateRows(rows, {
      existingCandidates,
      now: triageNow,
      source
    });
  }

  if (dedupReady) {
    let acceptedCount = 0;
    let duplicateCount = 0;
    const candidatePool = [...existingCandidates];
    // Queue concurrency is intentionally one; database uniqueness remains the final guard for manual overlap.
    for (const row of insertRows) {
      const mergeMatch = findSignalCandidateMergeMatch(row, candidatePool, { now: triageNow });
      if (mergeMatch) {
        await insertSignalCandidateOccurrence(db, source, row, mergeMatch.candidateId, mergeMatch.reason);
        duplicateCount += 1;
        continue;
      }

      // Create the primary candidate and its guarded primary occurrence atomically.
      // A uniqueness conflict is resolved below with an exact persisted lookup.
      const results = await db.batch([
        db
          .prepare(
            `INSERT OR IGNORE INTO signal_candidates (
               id, source_id, run_id, external_id, canonical_url, title, summary,
               author, published_at, language, category, status, relevance_score,
               content_hash, raw_payload_json, metadata_json, score_breakdown_json,
               cluster_key, title_fingerprint, scored_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            row.id,
            source.id,
            row.runId,
            row.externalId,
            row.canonicalUrl,
            row.title,
            row.summary,
            row.author,
            row.publishedAt,
            source.language || 'en',
            source.category || 'general',
            row.relevanceScore,
            row.contentHash,
            row.rawPayloadJson,
            row.metadataJson,
            row.scoreBreakdownJson,
            row.clusterKey,
            row.titleFingerprint,
            row.scoredAt
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO signal_candidate_occurrences (
               id, candidate_id, source_id, run_id, canonical_url, title, summary,
               published_at, content_hash, title_fingerprint, match_reason, metadata_json
             )
             SELECT ?, candidate.id, ?, ?, ?, ?, ?, ?, ?, ?, 'primary', ?
             FROM signal_candidates AS candidate
             WHERE candidate.id = ?`
          )
          .bind(
            `signal-occurrence-${randomToken(14)}`,
            source.id,
            row.runId,
            row.canonicalUrl,
            row.title,
            row.summary,
            row.publishedAt,
            row.contentHash,
            row.titleFingerprint,
            signalCandidateOccurrenceMetadata(row, row.id, 'primary'),
            row.id
          )
      ]);
      if (getD1ChangeCount(results[0]) > 0) {
        acceptedCount += 1;
        candidatePool.unshift({
          id: row.id,
          canonicalUrl: row.canonicalUrl,
          category: row.category || source.category || 'general',
          contentHash: row.contentHash,
          title: row.title,
          titleFingerprint: row.titleFingerprint,
          publishedAt: row.publishedAt,
          createdAt: row.scoredAt,
          clusterKey: row.clusterKey
        });
        continue;
      }

      const persistedMatch = await findPersistedSignalCandidateMatch(db, row, triageNow);
      if (persistedMatch) {
        await insertSignalCandidateOccurrence(db, source, row, persistedMatch.candidateId, persistedMatch.reason);
      }
      duplicateCount += 1;
    }
    return { acceptedCount, duplicateCount };
  }

  const results = await db.batch(
    insertRows.map((row) =>
      triageReady
        ? db
            .prepare(
              `INSERT OR IGNORE INTO signal_candidates (
                 id, source_id, run_id, external_id, canonical_url, title, summary,
                 author, published_at, language, category, status, relevance_score,
                 content_hash, raw_payload_json, metadata_json, score_breakdown_json,
                 cluster_key, scored_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              row.id,
              source.id,
              row.runId,
              row.externalId,
              row.canonicalUrl,
              row.title,
              row.summary,
              row.author,
              row.publishedAt,
              source.language || 'en',
              source.category || 'general',
              row.relevanceScore,
              row.contentHash,
              row.rawPayloadJson,
              row.metadataJson,
              row.scoreBreakdownJson,
              row.clusterKey,
              row.scoredAt
            )
        : db
            .prepare(
              `INSERT OR IGNORE INTO signal_candidates (
                 id, source_id, run_id, external_id, canonical_url, title, summary,
                 author, published_at, language, category, status, content_hash,
                 raw_payload_json, metadata_json
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
            )
            .bind(
              row.id,
              source.id,
              row.runId,
              row.externalId,
              row.canonicalUrl,
              row.title,
              row.summary,
              row.author,
              row.publishedAt,
              source.language || 'en',
              source.category || 'general',
              row.contentHash,
              row.rawPayloadJson,
              row.metadataJson
            )
    )
  );
  const acceptedCount = results.reduce((total, result) => total + getD1ChangeCount(result), 0);
  return { acceptedCount, duplicateCount: Math.max(insertRows.length - acceptedCount, 0) };
};

const syncSignalCollectionRunAlert = async (env, run) => {
  if (!env || !run || !['partial', 'failed'].includes(run.status)) return null;
  const failedCount = normalizePositiveInteger(run.failed_count, 0);
  const sourceCount = normalizePositiveInteger(run.source_count, 0);
  const failed = run.status === 'failed';
  return openSignalAutomationAlert(env, {
    alertType: 'run_failed',
    dedupeKey: `run:${run.id}:failure`,
    severity: failed ? 'critical' : 'warning',
    title: failed ? 'Signal 采集运行失败' : 'Signal 采集运行部分失败',
    message: `${failedCount}/${sourceCount} 个来源采集失败，请在后台查看运行记录并重试失败来源。`,
    runId: run.id,
    metadata: {
      acceptedCount: normalizePositiveInteger(run.accepted_count, 0),
      failedCount,
      sourceCount,
      status: run.status
    }
  });
};

const syncSignalRetrySuccessAlert = async (env, run) => {
  if (!env?.WAITLIST_DB || run?.trigger_type !== 'retry' || run?.status !== 'completed' || !run?.previous_run_id) {
    return null;
  }
  return resolveSignalAutomationAlert(env.WAITLIST_DB, {
    actor: 'signal-queue',
    dedupeKey: `run:${run.previous_run_id}:failure`
  });
};

const syncSignalSourceFailureAlert = async (env, source, failureCount, message = '') => {
  if (!env || !source?.id) return null;
  const dedupeKey = `source:${source.id}:consecutive-failures`;
  if (failureCount < signalAutomationSourceFailureAlertThreshold) {
    if (await ensureSignalAutomationOperationsReady(env.WAITLIST_DB)) {
      await resolveSignalAutomationAlert(env.WAITLIST_DB, { actor: 'signal-queue', dedupeKey });
    }
    return null;
  }
  return openSignalAutomationAlert(env, {
    alertType: 'source_failures',
    dedupeKey,
    severity: failureCount >= signalAutomationSourceFailureAlertThreshold * 2 ? 'critical' : 'warning',
    title: `资讯来源连续失败：${cleanText(source.name || source.id, 160)}`,
    message: `${cleanText(message || source.last_error || '来源采集失败。', 700)}（连续失败 ${failureCount} 次）`,
    sourceId: source.id,
    metadata: { consecutiveFailures: failureCount }
  });
};

const completeSignalCollectionTask = async (db, source, task, collection, counts, options = {}) => {
  await db.batch([
    db
      .prepare(
        `UPDATE signal_sources
         SET last_fetched_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP,
             last_error_at = NULL, last_error = '', http_etag = ?, http_last_modified = ?,
             last_http_status = ?, last_item_count = ?, consecutive_failures = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        cleanText(collection.etag, 500),
        cleanText(collection.lastModified, 500),
        collection.httpStatus,
        collection.notModified ? normalizePositiveInteger(source.last_item_count, 0) : collection.items.length,
        source.id
      ),
    db
      .prepare(
        `UPDATE signal_collection_tasks
         SET status = 'completed', fetched_count = ?, accepted_count = ?, duplicate_count = ?,
             http_status = ?, response_not_modified = ?, last_error = '',
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        collection.items.length,
        counts.acceptedCount,
        counts.duplicateCount,
        collection.httpStatus,
        collection.notModified ? 1 : 0,
        task.id
      )
  ]);
  const run = await refreshSignalCollectionRun(db, task.run_id);
  if (options.env) {
    if (normalizePositiveInteger(source.consecutive_failures, 0) > 0) {
      await syncSignalSourceFailureAlert(options.env, source, 0);
    }
    await syncSignalCollectionRunAlert(options.env, run);
    await syncSignalRetrySuccessAlert(options.env, run);
  }
  return run;
};

const failSignalCollectionTask = async (db, source, task, error, options = {}) => {
  const message = cleanText(error?.message || '资讯来源采集失败。', 500);
  const shouldRetry = error?.retriable !== false && normalizePositiveInteger(task.attempts, 1) < signalCollectionMaxAttempts;
  const consecutiveFailures = normalizePositiveInteger(source.consecutive_failures, 0) + 1;
  await db.batch([
    db
      .prepare(
        `UPDATE signal_sources
         SET last_fetched_at = CURRENT_TIMESTAMP, last_error_at = CURRENT_TIMESTAMP,
             last_error = ?, last_http_status = NULL,
             consecutive_failures = consecutive_failures + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(message, source.id),
    db
      .prepare(
        `UPDATE signal_collection_tasks
         SET status = ?, last_error = ?,
             finished_at = CASE WHEN ? = 1 THEN NULL ELSE CURRENT_TIMESTAMP END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(shouldRetry ? 'queued' : 'failed', message, shouldRetry ? 1 : 0, task.id)
  ]);
  const run = await refreshSignalCollectionRun(db, task.run_id);
  if (options.env && !shouldRetry) {
    await syncSignalSourceFailureAlert(options.env, source, consecutiveFailures, message);
    await syncSignalCollectionRunAlert(options.env, run);
  }
  return { message, retry: shouldRetry };
};

const processSignalCollectionMessage = async (env, body, options = {}) => {
  const db = env.WAITLIST_DB;
  if (!db || !(await ensureSignalCollectionPhase2Ready(db))) {
    throw signalSourceValidationError('SIGNAL_COLLECTION_NOT_READY', '资讯采集数据表尚未初始化。');
  }
  const runId = cleanText(body?.runId, 120);
  const sourceId = cleanText(body?.sourceId, 120);
  if (body?.version !== 1 || !runId || !sourceId) {
    throw signalSourceValidationError('SIGNAL_COLLECTION_MESSAGE_INVALID', '资讯采集队列消息无效。');
  }
  const existingTask = await db
    .prepare('SELECT * FROM signal_collection_tasks WHERE run_id = ? AND source_id = ?')
    .bind(runId, sourceId)
    .first();
  if (!existingTask) throw signalSourceValidationError('SIGNAL_COLLECTION_TASK_NOT_FOUND', '资讯采集任务不存在。');
  if (['completed', 'failed'].includes(existingTask.status)) {
    return { done: true, retry: false, task: signalCollectionTaskToJson(existingTask) };
  }
  const source = await db.prepare('SELECT * FROM signal_sources WHERE id = ?').bind(sourceId).first();
  if (!source) throw signalSourceValidationError('SIGNAL_SOURCE_NOT_FOUND', '资讯来源不存在。');

  const task = await db
    .prepare(
      `UPDATE signal_collection_tasks
       SET status = 'running', attempts = attempts + 1,
           started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       RETURNING *`
    )
    .bind(existingTask.id)
    .first();
  await db
    .prepare(
      `UPDATE signal_collection_runs
       SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued'`
    )
    .bind(runId)
    .run();

  try {
    const secrets = signalCollectionSecrets(env);
    if (!isCollectibleSignalSource(source, secrets)) {
      const error = signalSourceValidationError('SIGNAL_SOURCE_NOT_COLLECTIBLE', '来源已暂停、缺少所需密钥或适配器未开放。');
      error.retriable = false;
      throw error;
    }
    const collection = await collectSignalSource(source, {
      fetchImpl: options.fetchImpl || fetch,
      secrets
    });
    const rows = await buildSignalCandidateRows(source, runId, collection);
    const inserted = await insertSignalCandidates(db, source, rows);
    const counts = {
      acceptedCount: inserted.acceptedCount,
      duplicateCount: inserted.duplicateCount + Math.max(collection.items.length - rows.length, 0)
    };
    const run = await completeSignalCollectionTask(db, source, task, collection, counts, { env });
    return { done: true, retry: false, run: signalCollectionRunToJson(run), task: { ...signalCollectionTaskToJson(task), ...counts } };
  } catch (error) {
    const failure = await failSignalCollectionTask(db, source, task, error, { env });
    return { done: !failure.retry, retry: failure.retry, error: failure.message, task: signalCollectionTaskToJson(task) };
  }
};

const abandonSignalCollectionMessage = async (env, body, error) => {
  const db = env.WAITLIST_DB;
  const runId = cleanText(body?.runId, 120);
  const sourceId = cleanText(body?.sourceId, 120);
  if (!db || !runId || !sourceId) return false;
  const message = cleanText(`队列消息超过重试上限：${error?.message || 'unknown error'}`, 500);
  const result = await db
    .prepare(
      `UPDATE signal_collection_tasks
       SET status = 'failed', attempts = MAX(attempts, ?), last_error = ?,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE run_id = ? AND source_id = ? AND status IN ('queued', 'running')`
    )
    .bind(signalCollectionMaxAttempts, message, runId, sourceId)
    .run();
  if (!getD1ChangeCount(result)) return false;
  await db
    .prepare(
      `UPDATE signal_sources
       SET last_fetched_at = CURRENT_TIMESTAMP, last_error_at = CURRENT_TIMESTAMP,
           last_error = ?, consecutive_failures = consecutive_failures + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(message, sourceId)
    .run();
  const run = await refreshSignalCollectionRun(db, runId);
  const source = await db.prepare('SELECT * FROM signal_sources WHERE id = ?').bind(sourceId).first();
  await syncSignalCollectionRunAlert(env, run);
  if (source) {
    await syncSignalSourceFailureAlert(
      env,
      source,
      normalizePositiveInteger(source.consecutive_failures, 0),
      message
    );
  }
  return true;
};

const handleSignalCollectionQueue = async (batch, env) => {
  for (const message of batch.messages) {
    try {
      const result = await processSignalCollectionMessage(env, message.body);
      if (result.retry) {
        message.retry({ delaySeconds: Math.min(30 * 2 ** Math.max(message.attempts - 1, 0), 300) });
      } else {
        message.ack();
      }
    } catch (error) {
      signalAutomationLog('error', 'queue_message_failed', {
        attempts: normalizePositiveInteger(message.attempts, 1),
        code: cleanText(error?.code, 120),
        message: cleanText(error?.message, 500),
        runId: cleanText(message.body?.runId, 120),
        sourceId: cleanText(message.body?.sourceId, 120)
      });
      message.retry({ delaySeconds: Math.min(30 * 2 ** Math.max(message.attempts - 1, 0), 300) });
    }
  }
};

const handleSignalCollectionDeadLetterQueue = async (batch, env) => {
  for (const message of batch.messages) {
    try {
      const runId = cleanText(message.body?.runId, 120);
      const sourceId = cleanText(message.body?.sourceId, 120);
      const marked = await abandonSignalCollectionMessage(
        env,
        message.body,
        signalSourceValidationError('SIGNAL_COLLECTION_DEAD_LETTER', '队列消息已进入死信队列。')
      );
      await openSignalAutomationAlert(env, {
        alertType: 'dead_letter',
        dedupeKey: `run:${runId || 'unknown'}:source:${sourceId || 'unknown'}:dead-letter`,
        severity: 'critical',
        title: 'Signal 队列消息进入死信队列',
        message: marked
          ? '采集任务已标记失败，请在后台重试该运行中的失败来源。'
          : '死信消息对应的任务已经结束或无法定位，请检查队列日志。',
        runId,
        sourceId,
        metadata: {
          attempts: normalizePositiveInteger(message.attempts, signalCollectionMaxAttempts),
          queue: cleanText(batch.queue, 160) || signalCollectionDeadLetterQueueName
        }
      });
      signalAutomationLog('error', 'dead_letter_received', {
        marked,
        runId,
        sourceId
      });
      message.ack();
    } catch (error) {
      signalAutomationLog('error', 'dead_letter_processing_failed', {
        attempts: normalizePositiveInteger(message.attempts, 1),
        message: cleanText(error?.message, 500),
        runId: cleanText(message.body?.runId, 120),
        sourceId: cleanText(message.body?.sourceId, 120)
      });
      message.retry({ delaySeconds: Math.min(60 * 2 ** Math.max(message.attempts - 1, 0), 900) });
    }
  }
};

const handleSignalCollectionSchedule = async (env, options = {}) => {
  if (!env.WAITLIST_DB || !env.SIGNAL_COLLECTION_QUEUE) return { queued: 0, skipped: true };
  if (!(await ensureSignalAutomationTablesReady(env.WAITLIST_DB))) return { queued: 0, setupRequired: true };
  if (!(await ensureSignalCollectionPhase2Ready(env.WAITLIST_DB))) return { queued: 0, setupRequired: true };
  const operationsReady = await ensureSignalAutomationOperationsReady(env.WAITLIST_DB);
  if (operationsReady) await beginSignalAutomationCron(env, options);
  try {
    const result = await enqueueSignalCollectionRun(env, { actor: 'signal-cron', triggerType: 'scheduled' });
    const response = {
      alreadyRunning: result.alreadyRunning,
      queued: result.sources.length,
      runId: result.run?.id || ''
    };
    if (operationsReady) {
      const scheduledAt = Number.isFinite(options.scheduledTime) ? new Date(options.scheduledTime) : new Date();
      if (scheduledAt.getUTCHours() === 3) await pruneSignalAutomationHistory(env.WAITLIST_DB);
      await completeSignalAutomationCron(env, response);
    }
    signalAutomationLog('info', 'cron_completed', response);
    return { ...response, operationsReady };
  } catch (error) {
    if (operationsReady) await failSignalAutomationCron(env, error);
    signalAutomationLog('error', 'cron_failed', {
      code: cleanText(error?.code, 120),
      message: cleanText(error?.message, 500)
    });
    throw error;
  }
};

const getSignalAutomationHealth = ({ runtime, alerts, activeRun }) => {
  const openAlerts = alerts.filter((alert) => alert.status === 'open');
  const criticalCount = openAlerts.filter((alert) => alert.severity === 'critical').length;
  const warningCount = openAlerts.filter((alert) => alert.severity === 'warning').length;
  const lastCronMs = parseSqlTimestampMs(runtime?.last_cron_started_at);
  const heartbeatAgeMinutes = lastCronMs ? Math.max(0, Math.floor((Date.now() - lastCronMs) / 60000)) : null;
  let state = 'healthy';
  let message = '定时采集、队列和来源状态正常。';

  if (!lastCronMs || runtime?.last_cron_status === 'never') {
    state = 'waiting';
    message = '等待阶段六上线后的第一次定时运行。';
  }
  if (
    criticalCount > 0 ||
    runtime?.last_cron_status === 'failed' ||
    (heartbeatAgeMinutes !== null && heartbeatAgeMinutes >= signalAutomationCronCriticalMinutes)
  ) {
    state = 'critical';
    message = criticalCount > 0 ? `有 ${criticalCount} 条严重告警需要处理。` : '定时采集状态异常，需要检查。';
  } else if (
    warningCount > 0 ||
    (heartbeatAgeMinutes !== null && heartbeatAgeMinutes >= signalAutomationCronGapMinutes)
  ) {
    state = 'degraded';
    message = warningCount > 0 ? `有 ${warningCount} 条警告需要检查。` : '定时采集心跳延迟。';
  } else if (activeRun) {
    state = 'running';
    message = `正在处理 ${activeRun.processed_source_count || 0}/${activeRun.source_count || 0} 个来源。`;
  }

  return {
    state,
    message,
    heartbeatAgeMinutes,
    openAlertCount: openAlerts.length,
    criticalAlertCount: criticalCount,
    warningAlertCount: warningCount
  };
};

const handleAdminGetSignalOperations = async (request, env) => {
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_OPERATIONS_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationOperationsReady(db))) {
    return signalAutomationOperationsSetupResponse({ status: 200 });
  }

  const [runtime, alertsResponse, sourceErrorsResponse, activeRun, latestRun] = await Promise.all([
    db.prepare('SELECT * FROM signal_automation_runtime WHERE id = ?').bind(signalAutomationRuntimeId).first(),
    db
      .prepare(
        `SELECT * FROM signal_automation_alerts
         ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,
                  CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                  datetime(last_seen_at) DESC
         LIMIT 50`
      )
      .all(),
    db
      .prepare(
        `SELECT id, name, category, consecutive_failures, last_error, last_error_at, last_success_at
         FROM signal_sources
         WHERE archived_at IS NULL
           AND (consecutive_failures > 0 OR last_error <> '')
         ORDER BY consecutive_failures DESC, datetime(last_error_at) DESC
         LIMIT 20`
      )
      .all(),
    findActiveSignalCollectionRun(db),
    db.prepare('SELECT * FROM signal_collection_runs ORDER BY datetime(created_at) DESC LIMIT 1').first()
  ]);
  const alertRows = alertsResponse.results || [];
  const health = getSignalAutomationHealth({ runtime, alerts: alertRows, activeRun });
  return privateJson({
    ok: true,
    setupRequired: false,
    health,
    runtime: signalAutomationRuntimeToJson(runtime),
    activeRun: activeRun ? signalCollectionRunToJson(activeRun) : null,
    latestRun: latestRun ? signalCollectionRunToJson(latestRun) : null,
    alerts: alertRows.map(signalAutomationAlertToJson),
    sourceErrors: (sourceErrorsResponse.results || []).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      consecutiveFailures: normalizePositiveInteger(row.consecutive_failures, 0),
      lastError: row.last_error,
      lastErrorAt: row.last_error_at,
      lastSuccessAt: row.last_success_at
    })),
    notification: {
      configured: Boolean(env.EMAIL && typeof env.EMAIL.send === 'function' && signalAutomationAlertRecipients(env).length),
      recipientCount: signalAutomationAlertRecipients(env).length,
      criticalOnly: true
    },
    retention: {
      resolvedAlertDays: signalAutomationResolvedAlertRetentionDays,
      runDays: signalAutomationHistoryRetentionDays
    }
  });
};

const handleAdminManageSignalOperations = async (request, env) => {
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_OPERATIONS_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationOperationsReady(db))) return signalAutomationOperationsSetupResponse();
  if (!(await ensureContentTablesReady(db)) || !(await ensureAdminAuditLogsReady(db))) {
    return privateJson(
      { ok: false, code: 'ADMIN_AUDIT_NOT_READY', message: '内容库或审计日志表未初始化，操作已阻止。' },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid Signal operations JSON.' }, { status: 400 });
  }
  const action = cleanText(payload?.action, 40).toLowerCase();

  if (action === 'resolve_alert') {
    const alertId = cleanText(payload.alertId, 120);
    if (!alertId) {
      return privateJson({ ok: false, code: 'SIGNAL_ALERT_ID_REQUIRED', message: '请选择要处理的告警。' }, { status: 400 });
    }
    const resolved = await resolveSignalAutomationAlert(db, { actor: actorEmail, alertId });
    if (!resolved) {
      return privateJson(
        { ok: false, code: 'SIGNAL_ALERT_NOT_OPEN', message: '告警不存在或已经处理。' },
        { status: 409 }
      );
    }
    await insertAdminAuditLog(db, {
      actorEmail,
      action: 'signal_automation_alert_resolve',
      targetType: 'signal_automation_alert',
      targetId: resolved.id,
      targetSlug: resolved.dedupe_key,
      metadata: { alertType: resolved.alert_type, severity: resolved.severity }
    });
    return privateJson({ ok: true, alert: signalAutomationAlertToJson(resolved), message: '告警已标记为已处理。' });
  }

  if (action === 'retry_run') {
    const runId = cleanText(payload.runId, 120);
    if (!runId) {
      return privateJson({ ok: false, code: 'SIGNAL_RUN_ID_REQUIRED', message: '请选择要重试的采集运行。' }, { status: 400 });
    }
    const run = await db.prepare('SELECT * FROM signal_collection_runs WHERE id = ?').bind(runId).first();
    if (!run) {
      return privateJson({ ok: false, code: 'SIGNAL_RUN_NOT_FOUND', message: '没有找到这次采集运行。' }, { status: 404 });
    }
    if (!['partial', 'failed'].includes(run.status)) {
      return privateJson(
        { ok: false, code: 'SIGNAL_RUN_NOT_RETRYABLE', message: '只有部分失败或全部失败的运行可以重试。' },
        { status: 409 }
      );
    }
    const failedTasksResponse = await db
      .prepare(
        `SELECT source_id FROM signal_collection_tasks
         WHERE run_id = ? AND status = 'failed'
         ORDER BY source_id ASC LIMIT 50`
      )
      .bind(runId)
      .all();
    const sourceIds = (failedTasksResponse.results || []).map((row) => row.source_id).filter(Boolean);
    if (!sourceIds.length) {
      return privateJson(
        { ok: false, code: 'SIGNAL_RUN_NO_FAILED_SOURCES', message: '这次运行没有可重试的失败来源。' },
        { status: 409 }
      );
    }

    try {
      const result = await enqueueSignalCollectionRun(env, {
        actor: actorEmail,
        previousRunId: runId,
        sourceIds,
        triggerType: 'retry'
      });
      if (result.alreadyRunning) {
        return privateJson({
          ok: true,
          alreadyRunning: true,
          message: '已有采集任务正在进行，请等它结束后再重试。',
          run: result.run
        });
      }
      if (!result.run) {
        return privateJson(
          { ok: false, code: 'SIGNAL_RETRY_NO_SOURCES', message: '失败来源已暂停或当前不可采集。' },
          { status: 409 }
        );
      }
      await insertAdminAuditLog(db, {
        actorEmail,
        action: 'signal_collection_retry',
        targetType: 'signal_collection_run',
        targetId: result.run.id,
        targetSlug: result.run.id,
        metadata: { previousRunId: runId, sourceIds }
      });
      return privateJson({
        ok: true,
        message: `已把 ${result.sources.length} 个失败来源重新加入队列。`,
        run: result.run,
        previousRunId: runId,
        sources: result.sources
      });
    } catch (error) {
      return privateJson(
        { ok: false, code: error?.code || 'SIGNAL_RETRY_FAILED', message: error?.message || '无法重试采集运行。' },
        { status: error?.code === 'SIGNAL_COLLECTION_NOT_READY' ? 503 : 502 }
      );
    }
  }

  return privateJson({ ok: false, code: 'SIGNAL_OPERATION_INVALID', message: '不支持的运维操作。' }, { status: 400 });
};

const signalSummaryMaxItems = 10;
const signalNumberedHeadingPattern = /^(\d{1,3})[.)、]\s+(.{2,})$/;

const extractSignalNumberedHeadings = (markdown) =>
  String(markdown || '')
    .split('\n')
    .map((line) => cleanText(line.trim(), 220))
    .filter((line) => signalNumberedHeadingPattern.test(line))
    .slice(0, signalSummaryMaxItems);

const extractSignalSummaryBullets = (payload, markdown) => {
  const explicit = normalizeStringArray(payload.summaryBullets || payload.bullets || payload.highlights, signalSummaryMaxItems);
  if (explicit.length) return explicit;
  const numbered = extractSignalNumberedHeadings(markdown);
  if (numbered.length) return numbered.slice(0, signalSummaryMaxItems);
  const headings = String(markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{2,3}\s+/.test(line))
    .map((line) => cleanText(line.replace(/^#{2,3}\s+/, ''), 180))
    .filter(Boolean)
    .slice(0, signalSummaryMaxItems);
  if (headings.length) return headings;
  return String(markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => cleanText(line.replace(/^[-*]\s+/, ''), 180))
    .filter(Boolean)
    .slice(0, signalSummaryMaxItems);
};

const renderSignalMarkdownToHtml = (markdown) => {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      output.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      closeList();
      output.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
      continue;
    }

    if (trimmed.startsWith('## ')) {
      closeList();
      output.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      closeList();
      output.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
      continue;
    }

    if (signalNumberedHeadingPattern.test(trimmed)) {
      closeList();
      output.push(`<h2 class="signal-section-heading">${escapeHtml(trimmed)}</h2>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!listOpen) {
        output.push('<ul>');
        listOpen = true;
      }
      output.push(`<li>${escapeHtml(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  closeList();
  return output.join('\n');
};

const getSignalBriefDraftModel = (env) =>
  cleanText(env.SIGNAL_BRIEF_MODEL || defaultSignalBriefDraftModel, 160) || defaultSignalBriefDraftModel;

const getSignalBriefDraftFallbackModel = (env) =>
  cleanText(env.SIGNAL_BRIEF_FALLBACK_MODEL || env.NOVEL_TRANSLATION_MODEL || defaultNovelTranslationModel, 160) ||
  defaultNovelTranslationModel;

const getSignalBriefDraftDeepSeekModel = (env) =>
  cleanText(env.SIGNAL_BRIEF_DEEPSEEK_MODEL || defaultDeepSeekSignalDraftModel, 160) ||
  defaultDeepSeekSignalDraftModel;

const signalBriefModelRolloutId = 'signal-brief';
const signalBriefSmokeFreshnessMs = 24 * 60 * 60 * 1000;

const isSignalBriefDeepSeekMasterEnabled = (env) =>
  cleanText(env.SIGNAL_BRIEF_DEEPSEEK_ENABLED || '0', 10) === '1';

const getSignalBriefDraftProviderPlan = (env, options = {}) => {
  const providers = [];
  const deepSeekEnabled = options.allowDeepSeek === true && isSignalBriefDeepSeekMasterEnabled(env);
  if (deepSeekEnabled && isDeepSeekApiKeyConfigured(env.DEEPSEEK_API_KEY)) {
    providers.push({
      ai: createDeepSeekSignalDraftAdapter({ apiKey: env.DEEPSEEK_API_KEY }),
      model: cleanText(options.deepSeekModel, 160) || getSignalBriefDraftDeepSeekModel(env),
      provider: 'deepseek'
    });
  }
  if (env.AI && typeof env.AI.run === 'function') {
    const model = getSignalBriefDraftModel(env);
    const fallbackModel = getSignalBriefDraftFallbackModel(env);
    providers.push({
      ai: env.AI,
      fallbackModel: fallbackModel === model ? '' : fallbackModel,
      model,
      provider: 'workers-ai'
    });
  }
  return providers;
};

const signalBriefModelRolloutRow = async (db) =>
  db.prepare('SELECT * FROM signal_model_rollout WHERE id = ? LIMIT 1').bind(signalBriefModelRolloutId).first();

const signalBriefSmokeIsFresh = (row, now = Date.now()) => {
  if (row?.last_smoke_status !== 'passed' || row?.last_smoke_model !== row?.deepseek_model) return false;
  const smokeAt = Date.parse(row.last_smoke_at || '');
  return Number.isFinite(smokeAt) && smokeAt <= now && now - smokeAt <= signalBriefSmokeFreshnessMs;
};

const signalBriefModelRolloutToJson = (row, env) => {
  const masterGateEnabled = isSignalBriefDeepSeekMasterEnabled(env);
  const secretConfigured = isDeepSeekApiKeyConfigured(env.DEEPSEEK_API_KEY);
  const fallbackConfigured = Boolean(env.AI && typeof env.AI.run === 'function');
  const smokeFresh = signalBriefSmokeIsFresh(row);
  const rolloutMode = row?.rollout_mode === 'live' ? 'live' : 'off';
  return {
    canEnableLive: masterGateEnabled && secretConfigured && fallbackConfigured && smokeFresh,
    canSmoke: masterGateEnabled && secretConfigured,
    deepSeekModel: cleanText(row?.deepseek_model || getSignalBriefDraftDeepSeekModel(env), 160),
    fallbackConfigured,
    fallbackModel: getSignalBriefDraftModel(env),
    lastSmoke: {
      at: row?.last_smoke_at || null,
      candidateCount: normalizePositiveInteger(row?.last_smoke_candidate_count, 0),
      finishReason: cleanText(row?.last_smoke_finish_reason, 80),
      message: cleanText(row?.last_smoke_message, 500),
      model: cleanText(row?.last_smoke_model, 160),
      status: cleanText(row?.last_smoke_status || 'never', 30),
      usage: normalizeJsonObject(parseStoredJson(row?.last_smoke_usage_json, {}))
    },
    liveEffective: rolloutMode === 'live' && masterGateEnabled && secretConfigured,
    masterGateEnabled,
    rolloutMode,
    secretConfigured,
    smokeFresh,
    updatedAt: row?.updated_at || null,
    updatedBy: cleanText(row?.updated_by, 320)
  };
};

const resolveSignalBriefModelRollout = async (db, env) => {
  const fallback = {
    allowDeepSeek: false,
    deepSeekModel: getSignalBriefDraftDeepSeekModel(env),
    rolloutMode: 'off',
    setupReady: false
  };
  if (!isSignalBriefDeepSeekMasterEnabled(env) || !isDeepSeekApiKeyConfigured(env.DEEPSEEK_API_KEY)) return fallback;
  try {
    if (!(await ensureSignalModelRolloutReady(db))) return fallback;
    const row = await signalBriefModelRolloutRow(db);
    if (!row) return { ...fallback, setupReady: true };
    return {
      allowDeepSeek: row.rollout_mode === 'live',
      deepSeekModel: cleanText(row.deepseek_model, 160) || fallback.deepSeekModel,
      rolloutMode: row.rollout_mode === 'live' ? 'live' : 'off',
      setupReady: true,
      updatedAt: row.updated_at || null
    };
  } catch (error) {
    console.warn('Signal brief model rollout check failed closed.', {
      code: error?.code || 'SIGNAL_MODEL_ROLLOUT_CHECK_FAILED'
    });
    return fallback;
  }
};

const signalBriefModelRolloutSetupResponse = () =>
  privateJson(
    {
      ok: false,
      code: 'SIGNAL_MODEL_ROLLOUT_NOT_READY',
      message: '请先应用 migrations/0025_signal_model_rollout.sql。',
      setupRequired: true
    },
    { status: 503 }
  );

const handleAdminGetSignalBriefModelRollout = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_MODEL_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }
  if (!(await ensureSignalModelRolloutReady(db))) return signalBriefModelRolloutSetupResponse();
  const row = await signalBriefModelRolloutRow(db);
  return privateJson({ ok: true, rollout: signalBriefModelRolloutToJson(row, env), setupRequired: false });
};

const handleAdminManageSignalBriefModelRollout = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_MODEL_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }
  if (!(await ensureSignalModelRolloutReady(db))) return signalBriefModelRolloutSetupResponse();
  if (!(await ensureAdminAuditLogsReady(db))) {
    return privateJson(
      { ok: false, code: 'SIGNAL_MODEL_AUDIT_NOT_READY', message: '审计日志表尚未初始化，模型设置已阻止。' },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid Signal model JSON.' }, { status: 400 });
  }
  const action = cleanText(payload.action, 40).toLowerCase();
  const current = await signalBriefModelRolloutRow(db);
  if (!current) return signalBriefModelRolloutSetupResponse();

  if (action === 'save_model') {
    let model;
    try {
      model = normalizeDeepSeekSignalDraftModel(payload.model);
    } catch (error) {
      return privateJson({ ok: false, code: error.code, message: error.message }, { status: error.status || 400 });
    }
    if (current.rollout_mode === 'live' && model !== current.deepseek_model) {
      return privateJson(
        { ok: false, code: 'SIGNAL_MODEL_DISABLE_BEFORE_CHANGE', message: '请先关闭 DeepSeek 主路径，再更换模型。' },
        { status: 409 }
      );
    }
    const changed = model !== current.deepseek_model;
    await db
      .prepare(
        `UPDATE signal_model_rollout
         SET deepseek_model = ?,
             last_smoke_status = CASE WHEN deepseek_model = ? THEN last_smoke_status ELSE 'never' END,
             last_smoke_message = CASE WHEN deepseek_model = ? THEN last_smoke_message ELSE '' END,
             updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(model, model, model, actorEmail, signalBriefModelRolloutId)
      .run();
    await insertAdminAuditLog(db, {
      actorEmail,
      action: 'signal_model_rollout_configure',
      targetType: 'signal_model_rollout',
      targetId: signalBriefModelRolloutId,
      targetSlug: model,
      metadata: { changed, model }
    });
    const row = await signalBriefModelRolloutRow(db);
    return privateJson({
      ok: true,
      message: changed ? '模型已保存，请重新运行冒烟测试。' : '模型设置没有变化。',
      rollout: signalBriefModelRolloutToJson(row, env)
    });
  }

  if (action === 'set_mode') {
    const mode = cleanText(payload.mode, 20).toLowerCase();
    if (!['live', 'off'].includes(mode)) {
      return privateJson({ ok: false, code: 'SIGNAL_MODEL_MODE_INVALID', message: '模型启用状态无效。' }, { status: 400 });
    }
    if (mode === 'live') {
      if (payload.confirmation !== 'ENABLE_DEEPSEEK_PRIMARY') {
        return privateJson(
          { ok: false, code: 'SIGNAL_MODEL_CONFIRMATION_REQUIRED', message: '启用 DeepSeek 主路径需要明确确认。' },
          { status: 400 }
        );
      }
      const readiness = signalBriefModelRolloutToJson(current, env);
      if (!readiness.canEnableLive) {
        return privateJson(
          {
            ok: false,
            code: 'SIGNAL_MODEL_NOT_READY_FOR_LIVE',
            message: '需要部署许可、DeepSeek Secret、Workers AI 回退和 24 小时内同模型冒烟通过后才能启用。',
            rollout: readiness
          },
          { status: 409 }
        );
      }
    }
    const result = await db
      .prepare(
        `UPDATE signal_model_rollout
         SET rollout_mode = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (
             ? = 'off'
             OR (
               last_smoke_status = 'passed'
               AND last_smoke_model = deepseek_model
               AND datetime(last_smoke_at) >= datetime('now', '-24 hours')
             )
           )`
      )
      .bind(mode, actorEmail, signalBriefModelRolloutId, mode)
      .run();
    if (!getD1ChangeCount(result)) {
      return privateJson(
        { ok: false, code: 'SIGNAL_MODEL_MODE_CONFLICT', message: '模型状态没有更新，请刷新后重试。' },
        { status: 409 }
      );
    }
    await insertAdminAuditLog(db, {
      actorEmail,
      action: mode === 'live' ? 'signal_model_rollout_enable' : 'signal_model_rollout_disable',
      targetType: 'signal_model_rollout',
      targetId: signalBriefModelRolloutId,
      targetSlug: current.deepseek_model,
      metadata: { from: current.rollout_mode, mode, model: current.deepseek_model }
    });
    const row = await signalBriefModelRolloutRow(db);
    return privateJson({
      ok: true,
      message: mode === 'live' ? 'DeepSeek 已启用为简报主模型，Workers AI 保持回退。' : 'DeepSeek 主路径已关闭。',
      rollout: signalBriefModelRolloutToJson(row, env)
    });
  }

  if (action === 'smoke_test') {
    if (!(await ensureSignalAutomationTablesReady(db))) {
      return privateJson(
        {
          ok: false,
          code: 'SIGNAL_AUTOMATION_NOT_READY',
          message: '候选资讯表尚未初始化，无法运行模型冒烟测试。'
        },
        { status: 503 }
      );
    }
    if (!isSignalBriefDeepSeekMasterEnabled(env)) {
      return privateJson(
        { ok: false, code: 'SIGNAL_MODEL_MASTER_DISABLED', message: '部署许可尚未开启，不能调用 DeepSeek 冒烟测试。' },
        { status: 409 }
      );
    }
    if (!isDeepSeekApiKeyConfigured(env.DEEPSEEK_API_KEY)) {
      return privateJson(
        { ok: false, code: 'DEEPSEEK_NOT_CONFIGURED', message: 'DeepSeek Worker Secret 尚未配置。' },
        { status: 409 }
      );
    }
    let candidateIds;
    try {
      candidateIds = normalizeSignalDraftCandidateIds(payload.candidateIds);
    } catch (error) {
      return privateJson({ ok: false, code: error.code, message: error.message }, { status: error.status || 400 });
    }
    const briefDate = normalizeSignalBriefDraftDate(payload.briefDate || new Date().toISOString().slice(0, 10));
    if (!briefDate) {
      return privateJson({ ok: false, code: 'SIGNAL_DRAFT_DATE_INVALID', message: '简报日期无效。' }, { status: 400 });
    }
    const requestedCategory = cleanText(payload.category || 'auto', 30).toLowerCase();
    if (requestedCategory !== 'auto' && !signalAutomationCategories.has(requestedCategory)) {
      return privateJson({ ok: false, code: 'SIGNAL_DRAFT_CATEGORY_INVALID', message: '简报分类无效。' }, { status: 400 });
    }
    const placeholders = candidateIds.map(() => '?').join(', ');
    const candidateResponse = await db
      .prepare(
        `SELECT candidate.*, source.name AS source_name, source.publisher AS source_publisher
         FROM signal_candidates AS candidate
         LEFT JOIN signal_sources AS source ON source.id = candidate.source_id
         WHERE candidate.id IN (${placeholders})`
      )
      .bind(...candidateIds)
      .all();
    const candidateMap = new Map((candidateResponse.results || []).map((candidate) => [candidate.id, candidate]));
    if (candidateMap.size !== candidateIds.length) {
      return privateJson(
        { ok: false, code: 'SIGNAL_DRAFT_CANDIDATE_NOT_FOUND', message: '部分候选资讯已经不存在，请刷新后重试。' },
        { status: 404 }
      );
    }
    const candidates = candidateIds.map((id) => candidateMap.get(id));
    if (candidates.some((candidate) => candidate.status !== 'shortlisted')) {
      return privateJson(
        { ok: false, code: 'SIGNAL_DRAFT_CANDIDATE_NOT_SHORTLISTED', message: '冒烟测试只能使用已入选候选。' },
        { status: 409 }
      );
    }
    const model = normalizeDeepSeekSignalDraftModel(current.deepseek_model);
    const startedAt = new Date().toISOString();
    await db
      .prepare(
        `UPDATE signal_model_rollout
         SET last_smoke_status = 'running', last_smoke_at = ?, last_smoke_model = ?,
             last_smoke_finish_reason = '', last_smoke_message = '正在运行',
             last_smoke_usage_json = '{}', last_smoke_candidate_count = ?,
             updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(startedAt, model, candidateIds.length, actorEmail, signalBriefModelRolloutId)
      .run();
    try {
      const draft = await generateSignalBriefDraftWithProviders(
        [
          {
            ai: createDeepSeekSignalDraftAdapter({ apiKey: env.DEEPSEEK_API_KEY }),
            model,
            provider: 'deepseek'
          }
        ],
        candidates,
        { briefDate, category: requestedCategory }
      );
      const completedAt = new Date().toISOString();
      const message = `冒烟通过：${candidateIds.length} 条候选，未保存、未发布。`;
      const update = await db
        .prepare(
          `UPDATE signal_model_rollout
           SET last_smoke_status = 'passed', last_smoke_at = ?, last_smoke_model = ?,
               last_smoke_finish_reason = ?, last_smoke_message = ?, last_smoke_usage_json = ?,
               last_smoke_candidate_count = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND deepseek_model = ?`
        )
        .bind(
          completedAt,
          model,
          cleanText(draft.finishReason, 80),
          message,
          JSON.stringify(draft.usage || {}),
          candidateIds.length,
          actorEmail,
          signalBriefModelRolloutId,
          model
        )
        .run();
      if (!getD1ChangeCount(update)) {
        return privateJson(
          { ok: false, code: 'SIGNAL_MODEL_CHANGED_DURING_SMOKE', message: '模型设置在测试期间发生变化，请重新测试。' },
          { status: 409 }
        );
      }
      await insertAdminAuditLog(db, {
        actorEmail,
        action: 'signal_model_rollout_smoke_passed',
        targetType: 'signal_model_rollout',
        targetId: signalBriefModelRolloutId,
        targetSlug: model,
        metadata: {
          candidateCount: candidateIds.length,
          candidateIds,
          finishReason: draft.finishReason,
          model,
          usage: draft.usage
        }
      });
      const row = await signalBriefModelRolloutRow(db);
      return privateJson({
        ok: true,
        message,
        preview: {
          category: draft.category,
          description: draft.description,
          finishReason: draft.finishReason,
          items: draft.items,
          model: draft.model || model,
          provider: draft.provider,
          title: draft.title,
          usage: draft.usage
        },
        rollout: signalBriefModelRolloutToJson(row, env)
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      const code = cleanText(error?.code || 'SIGNAL_MODEL_SMOKE_FAILED', 120);
      const message = cleanText(error?.message || 'DeepSeek 冒烟测试失败。', 500);
      await db
        .prepare(
          `UPDATE signal_model_rollout
           SET last_smoke_status = 'failed', last_smoke_at = ?, last_smoke_model = ?,
               last_smoke_finish_reason = ?, last_smoke_message = ?, last_smoke_usage_json = '{}',
               last_smoke_candidate_count = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND deepseek_model = ?`
        )
        .bind(
          failedAt,
          model,
          cleanText(error?.finishReason, 80),
          `${code}: ${message}`,
          candidateIds.length,
          actorEmail,
          signalBriefModelRolloutId,
          model
        )
        .run();
      await insertAdminAuditLog(db, {
        actorEmail,
        action: 'signal_model_rollout_smoke_failed',
        targetType: 'signal_model_rollout',
        targetId: signalBriefModelRolloutId,
        targetSlug: model,
        metadata: { candidateCount: candidateIds.length, candidateIds, code, model }
      });
      return privateJson(
        { ok: false, code, message, rollout: signalBriefModelRolloutToJson(await signalBriefModelRolloutRow(db), env) },
        { status: error?.status || 502 }
      );
    }
  }

  return privateJson({ ok: false, code: 'SIGNAL_MODEL_ACTION_INVALID', message: '模型操作无效。' }, { status: 400 });
};

const normalizeSignalBriefDraftDate = (value) => {
  const briefDate = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(briefDate)) return '';
  const parsed = new Date(`${briefDate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== briefDate ? '' : briefDate;
};

const signalDraftAutomationMetadata = (value) => {
  const metadata = normalizeJsonObject(value);
  const candidateIds = normalizeSignalDraftCandidateIds(metadata.candidateIds, {
    min: 0,
    max: signalDraftMaxCandidates
  });
  if (!candidateIds.length) return null;
  const excludedCandidateIds = normalizeSignalDraftCandidateIds(metadata.excludedCandidateIds, {
    min: 0,
    max: signalDraftMaxCandidates
  }).filter((candidateId) => !candidateIds.includes(candidateId));
  const usage = normalizeJsonObject(metadata.usage);
  const normalizedUsage = {
    completionTokens: normalizePositiveInteger(usage.completionTokens, 0),
    promptTokens: normalizePositiveInteger(usage.promptTokens, 0),
    totalTokens: normalizePositiveInteger(usage.totalTokens, 0)
  };
  const providerAttempts = (Array.isArray(metadata.providerAttempts) ? metadata.providerAttempts : [])
    .slice(0, 6)
    .map((attempt) => ({
      code: cleanText(attempt?.code, 120),
      finishReason: cleanText(attempt?.finishReason, 80),
      model: cleanText(attempt?.model, 160),
      provider: cleanText(attempt?.provider, 80),
      status: cleanText(attempt?.status, 30)
    }))
    .filter((attempt) => attempt.provider && attempt.model && ['completed', 'failed'].includes(attempt.status));
  return {
    candidateIds,
    excludedCandidateIds,
    fallbackUsed: metadata.fallbackUsed === true,
    finishReason: cleanText(metadata.finishReason, 80),
    generatedAt: cleanText(metadata.generatedAt, 80),
    model: cleanText(metadata.model, 160),
    outputLocale: cleanText(metadata.outputLocale, 20),
    provider: cleanText(metadata.provider, 80),
    providerAttempts,
    promptVersion: normalizePositiveInteger(metadata.promptVersion, 0),
    qualityVersion: normalizePositiveInteger(metadata.qualityVersion, 0),
    rolloutMode: cleanText(metadata.rolloutMode, 20),
    rolloutUpdatedAt: cleanText(metadata.rolloutUpdatedAt, 80),
    sourceEntryId: normalizePositiveInteger(metadata.sourceEntryId, 0),
    translationMode: cleanText(metadata.translationMode, 40),
    usage: Object.values(normalizedUsage).some(Boolean) ? normalizedUsage : null
  };
};

const signalBriefDraftForReview = (row) => {
  const entry = contentEntryToJson(row);
  let automation = null;
  let automationInvalid = false;
  try {
    automation = signalDraftAutomationMetadata(entry.metadata?.automation);
  } catch {
    automationInvalid = true;
  }
  if (!automation) automationInvalid = true;
  return {
    ...entry,
    automation: automation
      ? { ...automation, sourceEntryId: normalizePositiveInteger(row.id, automation.sourceEntryId) }
      : null,
    automationInvalid
  };
};

const buildSignalDraftApprovalPayload = (row, markdown, automation, options = {}) => {
  const metadata = parseStoredJson(row.metadata_json, {});
  const entryId = normalizePositiveInteger(row.id, 0);
  return {
    approvalEntryId: entryId,
    allowCandidateExclusions: options.allowCandidateExclusions === true,
    automation: { ...automation, sourceEntryId: entryId },
    briefDate: metadata.briefDate || String(row.published_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    bullets: metadata.summaryBullets || [],
    category: metadata.category || 'general',
    description: row.description,
    locale: row.locale,
    markdown,
    requestId: `signal-approve-${entryId}-${Date.now()}`,
    revisionSummary: '简报草稿审核通过并发布',
    slug: row.slug,
    sources: metadata.sources || [],
    status: 'published',
    tags: parseStoredJson(row.tags_json, []),
    title: row.title
  };
};

const handleAdminListSignalBriefDrafts = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_CONTENT_NOT_READY',
        message: '内容库尚未初始化，无法读取简报草稿。'
      },
      { status: 503 }
    );
  }
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_DRAFT_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const requestedStatus = cleanText(url.searchParams.get('status') || 'draft', 30).toLowerCase();
  const status = requestedStatus === 'all' ? '' : contentStatuses.has(requestedStatus) ? requestedStatus : 'draft';
  const limit = Math.min(Math.max(normalizePositiveInteger(url.searchParams.get('limit'), 30), 1), 100);
  const listStatement = db.prepare(
    `SELECT *
     FROM content_entries
     WHERE entry_type = 'signal_brief'
       AND locale = 'zh-Hant'
       AND source_kind = 'signal_automation'
       ${status ? 'AND status = ?' : ''}
     ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'published' THEN 2 ELSE 3 END,
              updated_at DESC
     LIMIT ?`
  );
  const [response, summaryRow] = await Promise.all([
    status ? listStatement.bind(status, limit).all() : listStatement.bind(limit).all(),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_count,
                SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled_count,
                SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published_count,
                SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived_count
         FROM content_entries
         WHERE entry_type = 'signal_brief'
           AND locale = 'zh-Hant'
           AND source_kind = 'signal_automation'`
      )
      .first()
  ]);
  return privateJson({
    ok: true,
    drafts: (response.results || []).map(signalBriefDraftForReview),
    summary: {
      total: normalizePositiveInteger(summaryRow?.total, 0),
      draft: normalizePositiveInteger(summaryRow?.draft_count, 0),
      scheduled: normalizePositiveInteger(summaryRow?.scheduled_count, 0),
      published: normalizePositiveInteger(summaryRow?.published_count, 0),
      archived: normalizePositiveInteger(summaryRow?.archived_count, 0)
    }
  });
};

const handleAdminManageSignalBriefDraft = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db)) || !(await ensureAdminAuditLogsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_CONTENT_NOT_READY',
        message: '内容库或审计日志表尚未初始化，草稿审核已阻止。'
      },
      { status: 503 }
    );
  }
  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_DRAFT_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid Signal draft action JSON.' }, { status: 400 });
  }
  const action = cleanText(payload.action, 30).toLowerCase();
  if (!['archive', 'approve'].includes(action)) {
    return privateJson({ ok: false, code: 'SIGNAL_DRAFT_ACTION_INVALID', message: '草稿审核操作无效。' }, { status: 400 });
  }
  const entryId = normalizePositiveInteger(payload.entryId || payload.id, 0);
  if (!entryId) {
    return privateJson({ ok: false, code: 'SIGNAL_DRAFT_ID_REQUIRED', message: '请选择一份简报草稿。' }, { status: 400 });
  }
  const row = await db
    .prepare(
      `SELECT * FROM content_entries
       WHERE id = ? AND entry_type = 'signal_brief' AND source_kind = 'signal_automation'
       LIMIT 1`
    )
    .bind(entryId)
    .first();
  if (!row) {
    return privateJson({ ok: false, code: 'SIGNAL_DRAFT_NOT_FOUND', message: '简报草稿不存在。' }, { status: 404 });
  }
  if (row.status !== 'draft') {
    return privateJson(
      { ok: false, code: 'SIGNAL_DRAFT_STATUS_CONFLICT', message: '这份简报已不再是草稿，请刷新后重试。' },
      { status: 409 }
    );
  }

  if (action === 'archive') {
    const archivedAt = new Date().toISOString();
    const revisionSummary = '自动化简报草稿已删除（归档）';
    const auditMetadata = JSON.stringify({
      archivedAt,
      candidateIds: signalBriefDraftForReview(row).automation?.candidateIds || [],
      previousStatus: row.status
    });
    const results = await db.batch([
      db
        .prepare(
          `UPDATE content_entries
           SET status = 'archived', archived_at = ?, updated_by = ?, updated_at = ?
           WHERE id = ? AND entry_type = 'signal_brief'
             AND source_kind = 'signal_automation' AND status = 'draft'`
        )
        .bind(archivedAt, actorEmail, archivedAt, entryId),
      db
        .prepare(
          `INSERT INTO content_revisions (
             entry_id, revision_number, status, title, summary, metadata_json, pricing_json,
             markdown_r2_key, html_r2_key, created_by
           )
           SELECT entry.id,
                  COALESCE((SELECT MAX(revision_number) + 1 FROM content_revisions WHERE entry_id = entry.id), 1),
                  entry.status, entry.title, ?, entry.metadata_json, entry.pricing_json,
                  entry.markdown_r2_key, entry.html_r2_key, ?
           FROM content_entries AS entry
           WHERE entry.id = ? AND entry.status = 'archived' AND entry.archived_at = ?`
        )
        .bind(revisionSummary, actorEmail, entryId, archivedAt),
      db
        .prepare(
          `INSERT INTO admin_audit_logs (
             actor_email, action, target_type, target_id, target_slug, metadata_json
           )
           SELECT ?, 'signal_brief_draft_archive', 'signal_brief', CAST(entry.id AS TEXT), entry.slug, ?
           FROM content_entries AS entry
           WHERE entry.id = ? AND entry.status = 'archived' AND entry.archived_at = ?`
        )
        .bind(actorEmail, auditMetadata, entryId, archivedAt)
    ]);
    if (!getD1ChangeCount(results[0])) {
      return privateJson(
        { ok: false, code: 'SIGNAL_DRAFT_STATUS_CONFLICT', message: '草稿状态已变化，请刷新后重试。' },
        { status: 409 }
      );
    }
    return privateJson({
      ok: true,
      action,
      archivedAt,
      candidateStatusesChanged: false,
      entryId,
      stage: 'signal-automation-5'
    });
  }

  const reviewDraft = signalBriefDraftForReview(row);
  if (reviewDraft.automationInvalid || !reviewDraft.automation) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_AUTOMATION_METADATA_INVALID',
        message: '服务器保存的候选关联无效，请重新生成草稿。'
      },
      { status: 409 }
    );
  }
  const bucket = getContentBucket(env);
  if (!bucket) {
    return privateJson(
      { ok: false, code: 'CONTENT_BUCKET_NOT_CONFIGURED', message: '正文存储未配置，无法批准发布。' },
      { status: 503 }
    );
  }
  const markdown = await readContentObjectText(bucket, row.markdown_r2_key, 'Signal draft Markdown');
  if (!markdown.trim()) {
    return privateJson(
      { ok: false, code: 'SIGNAL_DRAFT_BODY_NOT_FOUND', message: '草稿正文不存在，请重新生成或保存后再发布。' },
      { status: 409 }
    );
  }
  const importHeaders = new Headers(request.headers);
  importHeaders.set('content-type', 'application/json');
  const importRequest = new Request(new URL('/admin/api/signal/import', request.url), {
    method: 'POST',
    headers: importHeaders,
    body: JSON.stringify(
      buildSignalDraftApprovalPayload(row, markdown, reviewDraft.automation, {
        allowCandidateExclusions: payload.allowCandidateExclusions === true
      })
    )
  });
  const response = await handleAdminImportSignalBrief(importRequest, env);
  const result = await response.json().catch(() => ({}));
  return privateJson({ ...result, action, stage: 'signal-automation-5' }, { status: response.status });
};

const handleAdminGenerateSignalBriefDraft = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureSignalAutomationTablesReady(db)) || !(await ensureSignalCandidateTriageReady(db))) {
    return signalCandidateTriageSetupResponse();
  }
  if (!(await ensureContentTablesReady(db)) || !(await ensureAdminAuditLogsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_CONTENT_NOT_READY',
        message: '内容库或审计日志表未初始化，草稿生成已阻止。'
      },
      { status: 503 }
    );
  }

  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_DRAFT_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid Signal draft JSON.' }, { status: 400 });
  }

  let candidateIds;
  try {
    candidateIds = normalizeSignalDraftCandidateIds(payload.candidateIds);
  } catch (error) {
    return privateJson({ ok: false, code: error.code, message: error.message }, { status: error.status || 400 });
  }
  const briefDate = normalizeSignalBriefDraftDate(payload.briefDate || new Date().toISOString().slice(0, 10));
  if (!briefDate) {
    return privateJson({ ok: false, code: 'SIGNAL_DRAFT_DATE_INVALID', message: '简报日期无效。' }, { status: 400 });
  }
  const requestedCategory = cleanText(payload.category || 'auto', 30).toLowerCase();
  if (requestedCategory !== 'auto' && !signalAutomationCategories.has(requestedCategory)) {
    return privateJson({ ok: false, code: 'SIGNAL_DRAFT_CATEGORY_INVALID', message: '简报分类无效。' }, { status: 400 });
  }

  const placeholders = candidateIds.map(() => '?').join(', ');
  const candidateResponse = await db
    .prepare(
      `SELECT candidate.*, source.name AS source_name, source.publisher AS source_publisher
       FROM signal_candidates AS candidate
       LEFT JOIN signal_sources AS source ON source.id = candidate.source_id
       WHERE candidate.id IN (${placeholders})`
    )
    .bind(...candidateIds)
    .all();
  const candidateMap = new Map((candidateResponse.results || []).map((candidate) => [candidate.id, candidate]));
  if (candidateMap.size !== candidateIds.length) {
    return privateJson(
      { ok: false, code: 'SIGNAL_DRAFT_CANDIDATE_NOT_FOUND', message: '部分候选资讯已经不存在，请刷新后重试。' },
      { status: 404 }
    );
  }
  const candidates = candidateIds.map((id) => candidateMap.get(id));
  const invalidCandidates = candidates.filter((candidate) => candidate.status !== 'shortlisted');
  if (invalidCandidates.length) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_CANDIDATE_NOT_SHORTLISTED',
        invalidCandidateIds: invalidCandidates.map((candidate) => candidate.id),
        message: '草稿只能使用已入选候选，请刷新后重新选择。'
      },
      { status: 409 }
    );
  }

  const slug = `daily-brief-${briefDate}`;
  const existing = await db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = 'signal_brief' AND locale = 'zh-Hant' AND parent_slug = '' AND slug = ?
       LIMIT 1`
    )
    .bind(slug)
    .first();
  const existingAutomationDraft = existing?.source_kind === 'signal_automation' && existing?.status === 'draft';
  const archivedAutomationDraft = existing?.source_kind === 'signal_automation' && existing?.status === 'archived';
  if (existing && !existingAutomationDraft && !archivedAutomationDraft) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_DATE_CONFLICT',
        message: '这个日期已有人工简报或已发布内容，请更换日期后再生成。'
      },
      { status: 409 }
    );
  }
  if (existingAutomationDraft && payload.confirmOverwrite !== true) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_OVERWRITE_CONFIRMATION_REQUIRED',
        message: '这个日期已有自动化草稿。重新生成会覆盖当前编辑版本，但修订记录仍会保留。'
      },
      { status: 409 }
    );
  }

  try {
    const rollout = await resolveSignalBriefModelRollout(db, env);
    const providerPlan = getSignalBriefDraftProviderPlan(env, {
      allowDeepSeek: rollout.allowDeepSeek,
      deepSeekModel: rollout.deepSeekModel
    });
    const draft = await generateSignalBriefDraftWithProviders(providerPlan, candidates, {
      briefDate,
      category: requestedCategory
    });
    const generatedModel = draft.model || providerPlan[0]?.model || '';
    const generationId = `signal-draft-${(crypto.randomUUID?.() || randomToken(20)).replace(/-/g, '')}`;
    const generatedAt = new Date().toISOString();
    const sources = candidates.map((candidate) => ({
      label: cleanText(candidate.source_publisher || candidate.source_name || candidate.source_id, 160),
      note: cleanText(candidate.title, 240),
      url: normalizeSignalSourceUrl(candidate.canonical_url)
    }));
    const wordCount = countContentWords(draft.markdown);
    const entry = normalizeContentPayload({
      accessLevel: 'free',
      authorName: 'Station Cat',
      description: draft.description,
      entryType: 'signal_brief',
      excerpt: cleanText(draft.description, 260),
      html: renderSignalMarkdownToHtml(draft.markdown),
      locale: 'zh-Hant',
      markdown: draft.markdown,
      metadata: {
        adminVersion: 'signal-automation-4',
        automation: {
          candidateIds,
          fallbackUsed: draft.fallbackUsed,
          finishReason: draft.finishReason,
          generatedAt,
          model: generatedModel,
          outputLocale: draft.outputLocale,
          provider: draft.provider,
          providerAttempts: draft.providerAttempts,
          promptVersion: draft.promptVersion,
          qualityVersion: draft.qualityVersion,
          rolloutMode: rollout.rolloutMode,
          rolloutUpdatedAt: rollout.updatedAt || '',
          sourceEntryId: existing?.id || 0,
          translationMode: draft.translationMode,
          usage: draft.usage
        },
        briefDate,
        category: draft.category,
        importedFromAdminV2: true,
        shareCardVersion: 1,
        sources,
        summaryBullets: draft.summaryBullets
      },
      publishedAt: null,
      slug,
      sourceKind: 'signal_automation',
      sourceRef: generationId,
      status: 'draft',
      subtitle: signalCategoryLabel(draft.category, 'zh-Hant'),
      tags: ['Signal strip', signalCategoryLabel(draft.category, 'zh-Hant')],
      title: draft.title,
      visibility: 'public',
      wordCount,
      readingMinutes: Math.max(1, Math.ceil(wordCount / 450))
    });
    const { saved, revisionNumber } = await persistContentEntry(db, env, entry, {
      actorEmail,
      auditAction: 'signal_brief_draft_generate',
      auditMetadata: {
        candidateIds,
        generationId,
        model: generatedModel,
        outputLocale: draft.outputLocale,
        promptVersion: draft.promptVersion,
        provider: draft.provider,
        providerAttempts: draft.providerAttempts,
        qualityVersion: draft.qualityVersion,
        rolloutMode: rollout.rolloutMode,
        rolloutUpdatedAt: rollout.updatedAt || '',
        usage: draft.usage
      },
      revisionSummary: `AI 草稿生成 · ${candidateIds.length} 条候选`
    });
    const automation = {
      candidateIds,
      fallbackUsed: draft.fallbackUsed,
      finishReason: draft.finishReason,
      generatedAt,
      model: generatedModel,
      outputLocale: draft.outputLocale,
      provider: draft.provider,
      providerAttempts: draft.providerAttempts,
      promptVersion: draft.promptVersion,
      qualityVersion: draft.qualityVersion,
      rolloutMode: rollout.rolloutMode,
      rolloutUpdatedAt: rollout.updatedAt || '',
      sourceEntryId: saved.id,
      translationMode: draft.translationMode,
      usage: draft.usage
    };
    return privateJson({
      ok: true,
      automation,
      body: { html: entry.html, markdown: draft.markdown },
      candidateStatusesChanged: false,
      entry: contentEntryToJson(saved),
      revisionNumber,
      stage: 'signal-automation-4'
    });
  } catch (error) {
    const providerAttempts = Array.isArray(error?.providerAttempts) ? error.providerAttempts : [];
    console.warn('Signal brief generation failed.', {
      candidateCount: candidateIds.length,
      code: error?.code || 'SIGNAL_DRAFT_GENERATION_FAILED',
      providerAttempts
    });
    return privateJson(
      {
        ok: false,
        code: error.code || 'SIGNAL_DRAFT_GENERATION_FAILED',
        message: error.message || '简报草稿生成失败。',
        providerAttempts
      },
      { status: error.status || (error.code === 'CONTENT_BUCKET_NOT_CONFIGURED' ? 503 : 502) }
    );
  }
};

const handleAdminImportSignalBrief = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_TABLES_NOT_READY',
        message: 'Content tables are not initialized. Apply migration 0007_backend_content_platform.sql before importing Signal briefs.'
      },
      { status: 503 }
    );
  }

  const actorEmail = await getAdminActorEmail(request, env);
  if (!actorEmail) {
    return privateJson(
      { ok: false, code: 'SIGNAL_IMPORT_ADMIN_REQUIRED', message: '管理员身份无效或已过期。' },
      { status: 401 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid Signal import JSON.' }, { status: 400 });
  }

  const title = cleanText(payload.title, 240);
  const markdown = typeof payload.markdown === 'string' ? payload.markdown.trim() : String(payload.body || '').trim();
  if (!title) return privateJson({ ok: false, code: 'SIGNAL_TITLE_REQUIRED', message: '简报标题必填。' }, { status: 400 });
  if (!markdown) return privateJson({ ok: false, code: 'SIGNAL_BODY_REQUIRED', message: '简报正文必填。' }, { status: 400 });
  if (markdown.length > 2_000_000) {
    return privateJson({ ok: false, code: 'SIGNAL_BODY_TOO_LARGE', message: '简报正文过大。' }, { status: 413 });
  }

  const locale = normalizeContentLocale(payload.locale || 'zh-Hant');
  const briefDate = cleanText(payload.briefDate || new Date().toISOString().slice(0, 10), 40);
  const category = normalizeSignalCategory(payload.category || payload.signalCategory || payload.subtitle);
  const slugBase = cleanSlug(payload.slug || payload.briefSlug, 160);
  const dateSlug = cleanSlug(briefDate, 40) || new Date().toISOString().slice(0, 10);
  const slug = slugBase || `daily-brief-${dateSlug}`;
  const requestId =
    cleanText(payload.requestId, 240) ||
    `signal-${slug}-${(crypto.randomUUID?.() || randomToken(12)).replace(/-/g, '').slice(0, 8)}`;
  const requestedStatus = normalizeContentStatus(payload.status || 'published');
  let submittedAutomation = null;
  try {
    submittedAutomation = signalDraftAutomationMetadata(payload.automation);
  } catch (error) {
    return privateJson({ ok: false, code: error.code, message: error.message }, { status: error.status || 400 });
  }
  const html = renderSignalMarkdownToHtml(markdown);
  const wordCount = countContentWords(markdown);
  const summaryBullets = extractSignalSummaryBullets(payload, markdown);
  const sources = parseSignalSourcesInput(payload.sources || payload.sourcesText);
  const description = cleanText(payload.description || firstPlainSummary([markdown], 360), 1200);
  const excerpt = cleanText(payload.excerpt || firstPlainSummary([markdown], 260), 1000);
  const existing = await db
    .prepare(
      `SELECT id, metadata_json, source_kind, status
       FROM content_entries
       WHERE entry_type = 'signal_brief'
         AND locale = ?
         AND slug = ?
         AND parent_slug = ''
       LIMIT 1`
    )
    .bind(locale, slug)
    .first();
  const approvalEntryId = normalizePositiveInteger(payload.approvalEntryId, 0);
  if (approvalEntryId && (!existing || existing.id !== approvalEntryId || existing.status !== 'draft')) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_STATUS_CONFLICT',
        message: '草稿状态已变化，请刷新后重新审核。'
      },
      { status: 409 }
    );
  }

  // Automation provenance is server-owned. The browser may echo it back, but cannot replace candidate IDs.
  const storedMetadata = parseStoredJson(existing?.metadata_json, {});
  let storedAutomation = null;
  try {
    storedAutomation =
      existing?.source_kind === 'signal_automation'
        ? signalDraftAutomationMetadata(storedMetadata.automation)
        : null;
  } catch {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_AUTOMATION_METADATA_INVALID',
        message: '服务器保存的自动化关联无效，请重新生成草稿。'
      },
      { status: 409 }
    );
  }
  if (existing?.source_kind === 'signal_automation' && !storedAutomation) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_AUTOMATION_METADATA_INVALID',
        message: '服务器保存的自动化关联为空，请重新生成草稿。'
      },
      { status: 409 }
    );
  }
  if (submittedAutomation && !storedAutomation) {
    return privateJson(
      {
        ok: false,
        code: 'SIGNAL_DRAFT_AUTOMATION_METADATA_UNTRUSTED',
        message: '自动化候选关联只能来自服务器已保存的草稿。'
      },
      { status: 409 }
    );
  }
  if (submittedAutomation && storedAutomation) {
    const submittedIds = submittedAutomation.candidateIds.join('\n');
    const storedIds = storedAutomation.candidateIds.join('\n');
    if (submittedIds !== storedIds) {
      return privateJson(
        {
          ok: false,
          code: 'SIGNAL_DRAFT_AUTOMATION_METADATA_STALE',
          message: '草稿的候选关联已变化，请重新载入后再保存。'
        },
        { status: 409 }
      );
    }
  }
  let automation = storedAutomation
    ? { ...storedAutomation, sourceEntryId: normalizePositiveInteger(existing.id, 0) }
    : null;

  let usageCandidates = [];
  let excludedCandidateIds = [];
  if (requestedStatus === 'published' && automation?.candidateIds.length) {
    if (!(await ensureSignalAutomationTablesReady(db)) || !(await ensureSignalCandidateTriageReady(db))) {
      return signalCandidateTriageSetupResponse();
    }
    const placeholders = automation.candidateIds.map(() => '?').join(', ');
    const response = await db
      .prepare(`SELECT id, status FROM signal_candidates WHERE id IN (${placeholders})`)
      .bind(...automation.candidateIds)
      .all();
    const candidateMap = new Map((response.results || []).map((candidate) => [candidate.id, candidate]));
    if (candidateMap.size !== automation.candidateIds.length) {
      return privateJson(
        { ok: false, code: 'SIGNAL_DRAFT_CANDIDATE_NOT_FOUND', message: '草稿关联的候选资讯已经不存在。' },
        { status: 409 }
      );
    }
    usageCandidates = automation.candidateIds.map((candidateId) => candidateMap.get(candidateId));
    excludedCandidateIds = usageCandidates
      .filter((candidate) => candidate.status !== 'shortlisted' && candidate.status !== 'used')
      .map((candidate) => candidate.id);
    if (excludedCandidateIds.length && payload.allowCandidateExclusions !== true) {
      return privateJson(
        {
          ok: false,
          code: 'SIGNAL_DRAFT_CANDIDATE_EXCLUSION_CONFIRMATION_REQUIRED',
          excludedCandidateIds,
          message: `有 ${excludedCandidateIds.length} 条关联候选已不再是“已入选”状态。确认后可从本次发布关联中移除。`
        },
        { status: 409 }
      );
    }
    if (excludedCandidateIds.length) {
      const excludedSet = new Set(excludedCandidateIds);
      usageCandidates = usageCandidates.filter((candidate) => !excludedSet.has(candidate.id));
      if (!usageCandidates.length) {
        return privateJson(
          {
            ok: false,
            code: 'SIGNAL_DRAFT_NO_PUBLISHABLE_CANDIDATES',
            excludedCandidateIds,
            message: '所有关联候选都已被移出入选队列，请重新生成草稿。'
          },
          { status: 409 }
        );
      }
      automation = {
        ...automation,
        candidateIds: usageCandidates.map((candidate) => candidate.id),
        excludedCandidateIds: [
          ...new Set([...(automation.excludedCandidateIds || []), ...excludedCandidateIds])
        ]
      };
    }
  }

  const backupPayload = {
    importedAt: new Date().toISOString(),
    importedBy: actorEmail,
    requestId,
    signalBrief: {
      briefDate,
      category,
      excludedCandidateIds,
      locale,
      slug,
      title
    },
    payload
  };
  let backupKey = '';
  const bucket = getContentBucket(env);
  if (bucket) {
    backupKey = buildSignalImportBackupKey(requestId);
    await bucket.put(backupKey, JSON.stringify(backupPayload, null, 2), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' }
    });
  }

  const entry = normalizeContentPayload({
    accessLevel: 'free',
    authorName: payload.authorName || payload.author || 'Station Cat',
    description,
    entryType: 'signal_brief',
    excerpt,
    featured: Boolean(payload.featured),
    html,
    importR2Key: backupKey,
    locale,
    markdown,
    metadata: {
      adminVersion: 'signal-strip-1',
      ...(automation ? { automation } : {}),
      briefDate,
      category,
      importedFromAdminV2: true,
      issue: cleanText(payload.issue, 80),
      shareCardVersion: 1,
      sources,
      summaryBullets
    },
    publishedAt: payload.publishedAt || `${briefDate}T09:00`,
    revisionSummary: payload.revisionSummary || 'Signal brief import',
    slug,
    sourceKind: automation ? 'signal_automation' : 'signal_brief',
    sourceRef: requestId,
    status: requestedStatus,
    subtitle: signalCategoryLabel(category, locale),
    tags: payload.tags || ['Signal strip', signalCategoryLabel(category, locale)],
    title,
    visibility: 'public',
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 450))
  });

  try {
    const { saved, revisionNumber } = await persistContentEntry(db, env, entry, {
      actorEmail,
      auditAction: 'signal_brief_import',
      auditMetadata: {
        backupKey,
        briefDate,
        category,
        excludedCandidateIds,
        requestId,
        sources: sources.length,
        summaryBullets: summaryBullets.length
      },
      revisionSummary: cleanText(payload.revisionSummary || 'Signal brief import', 500)
    });

    const candidatesToMarkUsed = usageCandidates.filter((candidate) => candidate.status === 'shortlisted');
    let usedCandidateIds = [];
    if (entry.status === 'published' && candidatesToMarkUsed.length) {
      const results = await db.batch(
        candidatesToMarkUsed.map((candidate) =>
          db
            .prepare(
              `UPDATE signal_candidates
               SET status = 'used', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND status = 'shortlisted'`
            )
            .bind(actorEmail, candidate.id)
        )
      );
      usedCandidateIds = candidatesToMarkUsed
        .filter((_candidate, index) => normalizePositiveInteger(results[index]?.meta?.changes, 0) > 0)
        .map((candidate) => candidate.id);
      if (usedCandidateIds.length) {
        await insertAdminAuditLog(db, {
          actorEmail,
          action: 'signal_candidates_used',
          targetType: 'signal_candidate',
          targetId: usedCandidateIds.length === 1 ? usedCandidateIds[0] : 'batch',
          targetSlug: saved.slug,
          metadata: {
            candidateIds: usedCandidateIds,
            contentEntryId: saved.id,
            signalBriefSlug: saved.slug
          }
        });
      }
    }
    const usedCandidateIdSet = new Set(usedCandidateIds);
    const candidateUsageConflictIds = candidatesToMarkUsed
      .filter((candidate) => !usedCandidateIdSet.has(candidate.id))
      .map((candidate) => candidate.id);

    const importRow = await db
      .prepare(
        `INSERT INTO content_imports (
          import_type, filename, r2_key, status, entries_created, entries_updated,
          warnings_json, errors_json, created_by
        )
        VALUES ('signal_brief', ?, ?, 'completed', ?, ?, '[]', '[]', ?)
        RETURNING *`
      )
      .bind(requestId, backupKey, existing ? 0 : 1, existing ? 1 : 0, actorEmail)
      .first();
    const origin = new URL(request.url).origin;
    const publicPath = contentEntryPublicPath(saved);

    return privateJson({
      ok: true,
      entry: contentEntryToJson(saved),
      import: contentImportToJson(importRow, [saved], origin),
      publicPath,
      publicUrl: `${origin}${publicPath}`,
      revisionNumber,
      shareCardPath: `${publicPath}card.svg`,
      stage: automation ? 'signal-automation-4' : 'signal-strip-1',
      candidateUsageConflictIds,
      excludedCandidateIds,
      usedCandidateIds
    });
  } catch (error) {
    return privateJson(
      {
        ok: false,
        code: error.code || 'SIGNAL_IMPORT_FAILED',
        message: error.message || 'Signal brief import failed.'
      },
      { status: error.code === 'CONTENT_BUCKET_NOT_CONFIGURED' ? 503 : 500 }
    );
  }
};

const parseContentEntryId = (request) => {
  const url = new URL(request.url);
  const id = Number.parseInt(url.searchParams.get('id') || url.searchParams.get('entryId') || '', 10);
  return Number.isFinite(id) && id > 0 ? id : 0;
};

const readContentObjectText = async (bucket, key, label) => {
  if (!key) return '';
  const object = await bucket.get(key);
  if (!object) return '';
  if (object.size && object.size > 2_000_000) {
    const error = new Error(`${label} is too large to load in Admin 2.0.`);
    error.code = 'CONTENT_OBJECT_TOO_LARGE';
    throw error;
  }
  return object.text();
};

const handleAdminGetContentBody = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_TABLES_NOT_READY',
        message: 'Content tables are not initialized. Apply migration 0007_backend_content_platform.sql before editing.'
      },
      { status: 503 }
    );
  }

  const id = parseContentEntryId(request);
  if (!id) return privateJson({ ok: false, code: 'CONTENT_ENTRY_ID_REQUIRED', message: 'A valid entry id is required.' }, { status: 400 });

  const entry = await db.prepare('SELECT * FROM content_entries WHERE id = ?').bind(id).first();
  if (!entry) return privateJson({ ok: false, code: 'CONTENT_ENTRY_NOT_FOUND', message: 'Content entry not found.' }, { status: 404 });

  const bucket = getContentBucket(env);
  if (!bucket && (entry.markdown_r2_key || entry.html_r2_key)) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_BUCKET_NOT_CONFIGURED',
        message: 'CONTENT_BUCKET is not configured, so stored body text cannot be loaded.'
      },
      { status: 503 }
    );
  }

  try {
    const [markdown, html] = bucket
      ? await Promise.all([
          readContentObjectText(bucket, entry.markdown_r2_key, 'Markdown body'),
          readContentObjectText(bucket, entry.html_r2_key, 'HTML body')
        ])
      : ['', ''];
    const pricingRules = await listContentPricingRules(db, { entryId: entry.id });

    return privateJson({
      ok: true,
      entry: contentEntryToJson(entry),
      body: {
        markdown,
        html,
        markdownR2Key: entry.markdown_r2_key,
        htmlR2Key: entry.html_r2_key
      },
      pricingRules
    });
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'CONTENT_BODY_READ_FAILED', message: error.message }, { status: 500 });
  }
};

const revisionToJson = (row) => ({
  id: row.id,
  entryId: row.entry_id,
  revisionNumber: row.revision_number,
  status: row.status,
  title: row.title,
  summary: row.summary,
  metadata: parseStoredJson(row.metadata_json, {}),
  pricing: parseStoredJson(row.pricing_json, {}),
  markdownR2Key: row.markdown_r2_key,
  htmlR2Key: row.html_r2_key,
  createdBy: row.created_by,
  createdAt: row.created_at
});

const handleAdminListContentRevisions = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson({ ok: true, setupRequired: true, revisions: [] });
  }

  const id = parseContentEntryId(request);
  if (!id) return privateJson({ ok: false, code: 'CONTENT_ENTRY_ID_REQUIRED', message: 'A valid entry id is required.' }, { status: 400 });

  const response = await db
    .prepare(
      `SELECT *
       FROM content_revisions
       WHERE entry_id = ?
       ORDER BY revision_number DESC
       LIMIT 30`
    )
    .bind(id)
    .all();

  return privateJson({ ok: true, revisions: (response.results || []).map(revisionToJson) });
};

const auditLogToJson = (row) => ({
  id: row.id,
  actorEmail: row.actor_email,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  targetSlug: row.target_slug,
  metadata: parseStoredJson(row.metadata_json, {}),
  createdAt: row.created_at
});

const handleAdminListAuditLogs = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson({ ok: true, setupRequired: true, logs: [] });
  }

  const url = new URL(request.url);
  const targetType = cleanText(url.searchParams.get('targetType'), 80);
  const targetSlug = cleanText(url.searchParams.get('targetSlug'), 240);
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '40', 10) || 40, 1), 100);
  const clauses = [];
  const params = [];

  if (targetType) {
    clauses.push('target_type = ?');
    params.push(targetType);
  }

  if (targetSlug) {
    clauses.push('target_slug = ?');
    params.push(targetSlug);
  }

  const response = await db
    .prepare(
      `SELECT *
       FROM admin_audit_logs
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return privateJson({ ok: true, logs: (response.results || []).map(auditLogToJson) });
};

const handleAdminListContentPricingRules = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson({ ok: true, setupRequired: true, pricingRules: [] });
  }

  const url = new URL(request.url);
  const pricingRules = await listContentPricingRules(db, {
    chapterSlug: url.searchParams.get('chapterSlug') || url.searchParams.get('chapter'),
    entryId: url.searchParams.get('entryId') || url.searchParams.get('id'),
    entryType: url.searchParams.get('entryType') || url.searchParams.get('type'),
    limit: url.searchParams.get('limit'),
    ruleType: url.searchParams.get('ruleType'),
    seriesSlug: url.searchParams.get('seriesSlug') || url.searchParams.get('series')
  });

  return privateJson({
    ok: true,
    pricingRules,
    stage: '7E-A'
  });
};

const getDefaultContentPricingTemplate = () =>
  normalizeContentPricingDefaults({
    accessLevel: 'paid',
    pricing: {
      mode: 'chapter-paid',
      freeChapters: 20,
      chapterCredits: 1,
      chapterPriceAmount: 0,
      creditPacks: defaultReaderCreditPacks,
      directChapterCheckoutEnabled: false,
      subscriptionEnabled: true,
      membershipCreditCost: defaultMembershipCreditCost,
      membershipDurationMonths: defaultMembershipMonths,
      membershipCoversPaidContent: true
    }
  });

const contentPricingDefaultsToJson = (row) => {
  const template = row?.setting_json
    ? normalizeContentPricingDefaults(parseStoredJson(row.setting_json, {}))
    : getDefaultContentPricingTemplate();
  return {
    ...template,
    isConfigured: Boolean(row),
    updatedAt: row?.updated_at || '',
    updatedBy: row?.updated_by || ''
  };
};

const getContentPricingDefaultsRow = (db) =>
  db
    .prepare(
      `SELECT setting_key, setting_json, updated_by, created_at, updated_at
       FROM admin_content_settings
       WHERE setting_key = ?`
    )
    .bind(contentPricingDefaultsSettingKey)
    .first();

const handleAdminGetContentPricingDefaults = async (env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureAdminContentSettingsReady(db))) {
    return privateJson({
      ok: true,
      setupRequired: true,
      message: 'Admin content settings are not initialized. Apply migration 0008_admin_content_settings.sql.',
      template: contentPricingDefaultsToJson(null)
    });
  }

  const row = await getContentPricingDefaultsRow(db);
  return privateJson({
    ok: true,
    setupRequired: false,
    stage: '8B',
    template: contentPricingDefaultsToJson(row)
  });
};

const handleAdminUpdateContentPricingDefaults = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureAdminContentSettingsReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'ADMIN_CONTENT_SETTINGS_NOT_READY',
        message: 'Admin content settings are not initialized. Apply migration 0008_admin_content_settings.sql before saving defaults.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid request body.' }, { status: 400 });
  }

  const template = normalizeContentPricingDefaults(payload);
  const actorEmail = (await getAdminActorEmail(request, env)) || 'admin';
  const row = await db
    .prepare(
      `INSERT INTO admin_content_settings (setting_key, setting_json, updated_by)
       VALUES (?, ?, ?)
       ON CONFLICT(setting_key)
       DO UPDATE SET
         setting_json = excluded.setting_json,
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING setting_key, setting_json, updated_by, created_at, updated_at`
    )
    .bind(contentPricingDefaultsSettingKey, JSON.stringify(template), actorEmail)
    .first();

  if (await ensureContentTablesReady(db)) {
    await insertAdminAuditLog(db, {
      actorEmail,
      action: 'content_pricing_defaults_update',
      targetType: 'admin_content_setting',
      targetId: contentPricingDefaultsSettingKey,
      targetSlug: contentPricingDefaultsSettingKey,
      metadata: {
        accessLevel: template.accessLevel,
        pricing: template.pricing
      }
    });
  }

  return privateJson({
    ok: true,
    stage: '8B',
    template: contentPricingDefaultsToJson(row)
  });
};

const uploadContentBodies = async (env, entry) => {
  const bucket = getContentBucket(env);
  const hasMarkdown = entry.markdown.length > 0;
  const hasHtml = entry.html.length > 0;

  if (!hasMarkdown && !hasHtml) return;
  if (!bucket) {
    const error = new Error('CONTENT_BUCKET is not configured, so body upload is disabled.');
    error.code = 'CONTENT_BUCKET_NOT_CONFIGURED';
    throw error;
  }

  if (hasMarkdown) {
    await bucket.put(entry.markdownR2Key, entry.markdown, {
      httpMetadata: { contentType: 'text/markdown; charset=utf-8' }
    });
  }

  if (hasHtml) {
    await bucket.put(entry.htmlR2Key, entry.html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' }
    });
  }
};

const persistContentEntry = async (db, env, entry, options = {}) => {
  const actorEmail = cleanText(options.actorEmail, 254) || entry.updatedBy || entry.createdBy || 'admin';
  entry.createdBy = entry.createdBy || actorEmail;
  entry.updatedBy = actorEmail;

  await uploadContentBodies(env, entry);

  const saved = await db
    .prepare(
      `INSERT INTO content_entries (
        entry_type, locale, slug, parent_slug, title, subtitle, description, excerpt,
        status, visibility, access_level, author_name, featured, sort_order, chapter_number,
        volume_title, tags_json, seo_json, metadata_json, pricing_json, body_format,
        markdown_r2_key, html_r2_key, import_r2_key, cover_r2_key, cover_alt,
        word_count, reading_minutes, source_kind, source_ref, scheduled_at, published_at,
        created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_type, locale, parent_slug, slug)
      DO UPDATE SET
        title = excluded.title,
        subtitle = excluded.subtitle,
        description = excluded.description,
        excerpt = excluded.excerpt,
        status = excluded.status,
        visibility = excluded.visibility,
        access_level = excluded.access_level,
        author_name = excluded.author_name,
        featured = excluded.featured,
        sort_order = excluded.sort_order,
        chapter_number = excluded.chapter_number,
        volume_title = excluded.volume_title,
        tags_json = excluded.tags_json,
        seo_json = excluded.seo_json,
        metadata_json = excluded.metadata_json,
        pricing_json = excluded.pricing_json,
        body_format = excluded.body_format,
        markdown_r2_key = excluded.markdown_r2_key,
        html_r2_key = excluded.html_r2_key,
        import_r2_key = excluded.import_r2_key,
        cover_r2_key = excluded.cover_r2_key,
        cover_alt = excluded.cover_alt,
        word_count = excluded.word_count,
        reading_minutes = excluded.reading_minutes,
        source_kind = excluded.source_kind,
        source_ref = excluded.source_ref,
        scheduled_at = excluded.scheduled_at,
        published_at = excluded.published_at,
        archived_at = CASE WHEN excluded.status = 'archived' THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`
    )
    .bind(
      entry.entryType,
      entry.locale,
      entry.slug,
      entry.parentSlug,
      entry.title,
      entry.subtitle,
      entry.description,
      entry.excerpt,
      entry.status,
      entry.visibility,
      entry.accessLevel,
      entry.authorName,
      entry.featured,
      entry.sortOrder,
      entry.chapterNumber,
      entry.volumeTitle,
      JSON.stringify(entry.tags),
      JSON.stringify(entry.seo),
      JSON.stringify(entry.metadata),
      JSON.stringify(entry.pricing),
      entry.bodyFormat,
      entry.markdownR2Key,
      entry.htmlR2Key,
      entry.importR2Key,
      entry.coverR2Key,
      entry.coverAlt,
      entry.wordCount,
      entry.readingMinutes,
      entry.sourceKind,
      entry.sourceRef,
      entry.scheduledAt,
      entry.publishedAt,
      entry.createdBy,
      entry.updatedBy
    )
    .first();

  const pricingRules = await syncContentPricingRules(db, saved);

  const revisionNumberRow = await db
    .prepare(`SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision_number FROM content_revisions WHERE entry_id = ?`)
    .bind(saved.id)
    .first();
  const revisionNumber = normalizePositiveInteger(revisionNumberRow?.revision_number, 1) || 1;

  await db
    .prepare(
      `INSERT INTO content_revisions (
        entry_id, revision_number, status, title, summary, metadata_json, pricing_json,
        markdown_r2_key, html_r2_key, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      saved.id,
      revisionNumber,
      saved.status,
      saved.title,
      cleanText(options.revisionSummary, 500),
      saved.metadata_json,
      saved.pricing_json,
      saved.markdown_r2_key,
      saved.html_r2_key,
      actorEmail
    )
    .run();

  await insertAdminAuditLog(db, {
    actorEmail,
    action: cleanText(options.auditAction || 'content_entry_upsert', 120),
    targetType: saved.entry_type,
    targetId: String(saved.id),
    targetSlug: `${saved.parent_slug ? `${saved.parent_slug}/` : ''}${saved.slug}`,
    metadata: {
      locale: saved.locale,
      pricingRules: pricingRules.length,
      revisionNumber,
      status: saved.status,
      ...normalizeJsonObject(options.auditMetadata)
    }
  });

  return { pricingRules, revisionNumber, saved };
};

const handleAdminUpsertContentEntry = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return privateJson({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return privateJson(
      {
        ok: false,
        code: 'CONTENT_TABLES_NOT_READY',
        message: 'Content tables are not initialized. Apply migration 0007_backend_content_platform.sql before saving.'
      },
      { status: 503 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid request body.' }, { status: 400 });
  }

  let entry;
  try {
    entry = normalizeContentPayload(payload);
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'CONTENT_INVALID', message: error.message }, { status: 400 });
  }

  try {
    const actorEmail = (await getAdminActorEmail(request, env)) || entry.updatedBy || entry.createdBy || 'admin';
    const { pricingRules, revisionNumber, saved } = await persistContentEntry(db, env, entry, {
      actorEmail,
      revisionSummary: payload.revisionSummary
    });

    return privateJson({
      ok: true,
      entry: contentEntryToJson(saved),
      pricingRules,
      revisionNumber,
      storage: getContentStorageDescriptor(env)
    });
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'CONTENT_UPLOAD_FAILED', message: error.message }, { status: 503 });
  }
};

const novelForgeImportJson = (body, init = {}) =>
  json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...(init.headers || {})
    }
  });

const novelForgeImportError = (message, { code = 'NOVELFORGE_IMPORT_ERROR', errors = [], status = 400 } = {}) =>
  novelForgeImportJson(
    {
      ok: false,
      error: {
        code,
        message
      },
      errors: errors.map((error) => (typeof error === 'string' ? { message: error } : error))
    },
    { status }
  );

const requireNovelForgePublishToken = (request, env, options = {}) => {
  const expected = cleanText(env.NOVELFORGE_PUBLISH_TOKEN, 1000);
  if (!expected) {
    return novelForgeImportError('NovelForge publish token is not configured.', {
      code: 'NOVELFORGE_TOKEN_NOT_CONFIGURED',
      status: 503
    });
  }

  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const received = cleanText(match?.[1], 1000);
  if (!received || !timingSafeEqualString(received, expected)) {
    return novelForgeImportError('Invalid publish token.', {
      code: 'NOVELFORGE_TOKEN_INVALID',
      status: 401
    });
  }

  const contractHeader = cleanText(request.headers.get('x-novelforge-contract'), 80);
  const allowedContracts =
    Array.isArray(options.allowedContracts) && options.allowedContracts.length
      ? options.allowedContracts
      : [novelForgeImportContractHeader];
  if (contractHeader && !allowedContracts.includes(contractHeader)) {
    return novelForgeImportError('Unsupported NovelForge contract header.', {
      code: 'NOVELFORGE_CONTRACT_HEADER_UNSUPPORTED',
      status: 400
    });
  }

  return null;
};

const requireNovelForgeAnalyticsToken = (request, env) =>
  requireNovelForgePublishToken(request, env, {
    allowedContracts: [novelForgeImportContractHeader, novelForgeAnalyticsContractHeader]
  });

const requireNovelForgeContentToken = (request, env) =>
  requireNovelForgePublishToken(request, env, {
    allowedContracts: [novelForgeImportContractHeader, novelForgeAnalyticsContractHeader, novelForgeContentContractHeader]
  });

const requireNovelForgeTranslationToken = (request, env) => {
  if (isLocalHostnameRequest(request) && hasLocalAdminBypass(env)) return null;
  if (
    hasLocalAdminBypass(env) &&
    cleanText(request.headers.get('x-stationcat-local-admin-bypass'), 80) === 'translation-sync'
  ) {
    return null;
  }
  return requireNovelForgePublishToken(request, env, {
    allowedContracts: [novelForgeImportContractHeader, novelForgeTranslationContractHeader]
  });
};

const readNovelForgeImportPayload = async (request) => {
  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > maxNovelForgeImportBytes) {
    const error = new Error('NovelForge import request is too large.');
    error.code = 'NOVELFORGE_IMPORT_TOO_LARGE';
    error.status = 413;
    throw error;
  }

  const bodyText = await request.text();
  if (bodyText.length > maxNovelForgeImportBytes) {
    const error = new Error('NovelForge import request is too large.');
    error.code = 'NOVELFORGE_IMPORT_TOO_LARGE';
    error.status = 413;
    throw error;
  }

  try {
    return {
      bodyText,
      payload: JSON.parse(bodyText)
    };
  } catch {
    const error = new Error('Invalid JSON request body.');
    error.code = 'INVALID_JSON';
    error.status = 400;
    throw error;
  }
};

const normalizeNovelForgeMode = (value) => (cleanText(value, 20).toLowerCase() === 'publish' ? 'publish' : 'draft');

const normalizeNovelForgeChangedItems = (payload) => {
  if (Array.isArray(payload.changedItems)) {
    return payload.changedItems.filter(isPlainRecord);
  }

  if (payload.onlyChanged !== false) return [];
  const publishPackage = normalizeJsonObject(payload.publishPackage);
  const project = normalizeJsonObject(publishPackage.project);
  const cover = normalizeJsonObject(publishPackage.cover);
  const chapters = Array.isArray(publishPackage.chapters) ? publishPackage.chapters.filter(isPlainRecord) : [];

  return [
    {
      changeType: 'create',
      contentHash: '',
      label: `小说元信息：${cleanText(project.title, 120) || 'Untitled work'}`,
      localId: cleanText(project.id, 120) || 'project',
      localType: 'project',
      payload: {
        ...project,
        pricingSuggestion: normalizeJsonObject(publishPackage.pricingSuggestion)
      },
      remoteId: null
    },
    {
      changeType: 'create',
      contentHash: '',
      label: '封面图与封面提示词',
      localId: `${cleanText(project.id, 120) || 'project'}:cover`,
      localType: 'cover',
      payload: cover,
      remoteId: null
    },
    ...chapters.map((chapter) => ({
      changeType: 'create',
      contentHash: '',
      label: `第 ${chapter.chapterNumber ?? '?'} 章：${cleanText(chapter.title, 120) || 'Untitled chapter'}`,
      localId: cleanText(chapter.id, 120) || `chapter-${chapter.chapterNumber || crypto.randomUUID()}`,
      localType: 'chapter',
      payload: chapter,
      remoteId: null
    }))
  ];
};

const validateNovelForgeImportPayload = (payload) => {
  if (!isPlainRecord(payload)) {
    const error = new Error('NovelForge import payload must be an object.');
    error.code = 'NOVELFORGE_PAYLOAD_INVALID';
    error.status = 400;
    throw error;
  }

  if (payload.contract !== novelForgeImportContract || Number(payload.contractVersion) !== 1) {
    const error = new Error('Unsupported NovelForge import contract.');
    error.code = 'NOVELFORGE_CONTRACT_UNSUPPORTED';
    error.status = 400;
    throw error;
  }

  const publishPackage = normalizeJsonObject(payload.publishPackage);
  if (publishPackage.format !== novelForgePackageFormat || Number(publishPackage.version) !== 1) {
    const error = new Error('Unsupported NovelForge publish package format.');
    error.code = 'NOVELFORGE_PACKAGE_UNSUPPORTED';
    error.status = 400;
    throw error;
  }

  if (!isPlainRecord(publishPackage.project)) {
    const error = new Error('NovelForge publish package is missing project metadata.');
    error.code = 'NOVELFORGE_PROJECT_REQUIRED';
    error.status = 400;
    throw error;
  }

  return {
    changedItems: normalizeNovelForgeChangedItems(payload),
    mode: normalizeNovelForgeMode(payload.mode),
    publishPackage,
    requestId: cleanText(payload.requestId || `novelforge:${crypto.randomUUID()}`, 160)
  };
};

const getNovelForgeItemPayload = (item, fallback = {}) => (isPlainRecord(item?.payload) ? item.payload : fallback);

const getNovelForgeItemByType = (items, type) =>
  items.find((item) => cleanText(item.localType, 40).toLowerCase() === type) || null;

const getNovelForgeItemsByType = (items, type) =>
  items.filter((item) => cleanText(item.localType, 40).toLowerCase() === type);

const getNovelForgeBody = (payload) => {
  const values = [payload.body, payload.markdown, payload.finalText, payload.content, payload.text];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const body = value.trim();
    if (body) return body.slice(0, 2_000_000);
  }
  return '';
};

const novelForgePublicSeriesUrl = (origin, locale, slug) => {
  return `${origin}${novelV2BasePathForLocale(locale)}${slug}/`;
};

const novelForgePreviewUrl = (origin, entryId) => `${origin}/admin-v2/?contentId=${encodeURIComponent(String(entryId))}`;

const findContentEntryById = async (db, id, entryType) => {
  if (!id) return null;
  return db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE id = ?
         AND entry_type = ?
       LIMIT 1`
    )
    .bind(id, entryType)
    .first();
};

const findContentEntryByIdentity = async (db, entry) =>
  db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = ?
         AND locale = ?
         AND parent_slug = ?
         AND slug = ?
       LIMIT 1`
    )
    .bind(entry.entryType, entry.locale, entry.parentSlug, entry.slug)
    .first();

const findExistingNovelForgeEntry = async (db, remoteId, entry) => {
  const remoteEntryId = parseNovelForgeRemoteEntryId(remoteId, entry.entryType);
  const byId = remoteEntryId ? await findContentEntryById(db, remoteEntryId, entry.entryType) : null;
  if (byId) return byId;
  return findContentEntryByIdentity(db, entry);
};

const safeDecodePathSegment = (segment) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const parseNovelForgeAnalyticsRoute = (pathname) => {
  const segments = String(pathname || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (segments[0] !== 'api' || segments[1] !== 'novelforge' || segments[2] !== 'analytics') return null;

  const resource = cleanText(segments[3], 40).toLowerCase();
  if (!['chapter', 'insights', 'trend'].includes(resource)) return null;
  const identifierSegments = segments.slice(4).map(safeDecodePathSegment);
  if (resource === 'trend' && identifierSegments.length > 1) return null;
  if ((resource === 'chapter' || resource === 'insights') && identifierSegments.length > 2) return null;

  return {
    identifier: identifierSegments.join('/'),
    resource
  };
};

const parseNovelForgeChapterContentRoute = (pathname) => {
  const segments = String(pathname || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (segments[0] !== 'api' || segments[1] !== 'novelforge' || segments[2] !== 'chapters') return null;
  if (segments[segments.length - 1] !== 'content') return null;

  const identifierSegments = segments.slice(3, -1).map(safeDecodePathSegment);
  if (identifierSegments.length < 1 || identifierSegments.length > 2) return null;

  return {
    identifier: identifierSegments.join('/'),
    resource: 'chapter-content'
  };
};

const findContentEntryBySlug = async (db, { entryType, locale, parentSlug = '', slug }) => {
  const normalizedEntryType = cleanText(entryType, 40);
  const normalizedLocale = normalizeContentLocale(locale || 'zh-Hant');
  const normalizedParentSlug = cleanSlug(parentSlug || '', 160);
  const normalizedSlug = cleanSlug(slug, 160);
  if (!normalizedEntryType || !normalizedSlug) return null;

  return db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = ?
         AND locale = ?
         AND COALESCE(parent_slug, '') = ?
         AND slug = ?
       ORDER BY
         CASE status WHEN 'published' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
         COALESCE(published_at, updated_at) DESC,
         id DESC
       LIMIT 1`
    )
    .bind(normalizedEntryType, normalizedLocale, normalizedParentSlug, normalizedSlug)
    .first();
};

const getNovelForgeAnalyticsOptions = (request, route) => {
  const url = new URL(request.url);
  const identifier = cleanText(
    route.identifier ||
      url.searchParams.get('id') ||
      url.searchParams.get('remoteId') ||
      url.searchParams.get('chapterId') ||
      url.searchParams.get('bookId') ||
      url.searchParams.get('seriesId') ||
      '',
    260
  );

  return {
    chapterSlug: cleanSlug(url.searchParams.get('chapterSlug') || url.searchParams.get('chapter'), 160),
    identifier,
    limit: Math.min(Math.max(normalizePositiveInteger(url.searchParams.get('limit'), 50), 1), 100),
    locale: normalizeContentLocale(url.searchParams.get('locale') || url.searchParams.get('language') || 'zh-Hant'),
    seriesSlug: cleanSlug(url.searchParams.get('seriesSlug') || url.searchParams.get('series') || url.searchParams.get('bookSlug'), 160),
    windowDays: normalizeNovelAnalyticsWindowDays(url.searchParams.get('windowDays') || url.searchParams.get('sinceDays'))
  };
};

const splitNovelForgeSeriesChapterIdentifier = (identifier) => {
  const parts = cleanText(identifier, 260)
    .split('/')
    .map((part) => cleanSlug(part, 160))
    .filter(Boolean);
  if (parts.length >= 2) return { chapterSlug: parts[1], seriesSlug: parts[0] };
  return { chapterSlug: parts[0] || '', seriesSlug: '' };
};

const findNovelForgeSeriesForAnalytics = async (db, options) => {
  const locale = normalizeContentLocale(options.locale || 'zh-Hant');
  const identifier = cleanText(options.identifier, 260);
  const remoteId = parseNovelForgeRemoteEntryId(identifier, 'novel_series');
  if (remoteId) {
    const byId = await findContentEntryById(db, remoteId, 'novel_series');
    if (byId) return byId;
  }

  const seriesSlug = cleanSlug(options.seriesSlug || identifier, 160);
  if (!seriesSlug) return null;
  return findContentEntryBySlug(db, {
    entryType: 'novel_series',
    locale,
    parentSlug: '',
    slug: seriesSlug
  });
};

const findNovelForgeChapterForAnalytics = async (db, options) => {
  const locale = normalizeContentLocale(options.locale || 'zh-Hant');
  const identifier = cleanText(options.identifier, 260);
  const remoteId = parseNovelForgeRemoteEntryId(identifier, 'novel_chapter');
  if (remoteId) {
    const byId = await findContentEntryById(db, remoteId, 'novel_chapter');
    if (byId) return byId;
  }

  const parsedIdentifier = splitNovelForgeSeriesChapterIdentifier(identifier);
  const seriesSlug = cleanSlug(options.seriesSlug || parsedIdentifier.seriesSlug, 160);
  const chapterSlug = cleanSlug(options.chapterSlug || parsedIdentifier.chapterSlug, 160);
  if (!chapterSlug) return null;

  if (!seriesSlug) {
    const error = new Error('seriesSlug is required when resolving a NovelForge chapter by slug. Use seriesSlug + chapterSlug, /seriesSlug/chapterSlug, or a chapter_N remote ID.');
    error.code = 'NOVELFORGE_SERIES_REQUIRED';
    error.status = 400;
    throw error;
  }

  return findContentEntryBySlug(db, {
    entryType: 'novel_chapter',
    locale,
    parentSlug: seriesSlug,
    slug: chapterSlug
  });
};

const originFromRequest = (request) => new URL(request.url).origin;

const withOrigin = (origin, path) => (path ? `${origin}${path}` : '');

const novelForgeAnalyticsEntryToJson = (entry, request) => {
  if (!entry) return null;
  const origin = originFromRequest(request);
  const publicPath = contentEntryPublicPath(entry);
  const legacyPath = contentEntryLegacyWorksPath(entry);
  const readerV2Path = contentEntryNovelV2Path(entry);

  return {
    id: entry.id,
    remoteId: novelForgeRemoteIdForEntry(entry),
    entryType: entry.entry_type,
    locale: entry.locale,
    slug: entry.slug,
    parentSlug: entry.parent_slug || '',
    title: entry.title || '',
    chapterNumber: entry.chapter_number,
    status: entry.status,
    visibility: entry.visibility,
    wordCount: normalizePositiveInteger(entry.word_count, 0),
    updatedAt: entry.updated_at || '',
    paths: {
      public: publicPath,
      legacy: legacyPath,
      readerV2: readerV2Path
    },
    urls: {
      public: withOrigin(origin, publicPath),
      legacy: withOrigin(origin, legacyPath),
      preview: entry.id ? novelForgePreviewUrl(origin, entry.id) : '',
      readerV2: withOrigin(origin, readerV2Path)
    }
  };
};

const queryNovelForgeChapterStatsRow = async (db, { chapterSlug, locale, seriesSlug, windowDays }) =>
  db
    .prepare(
      `SELECT
        chapter_stats.*,
        chapter_entries.title AS title,
        chapter_entries.chapter_number AS chapter_number,
        series_entries.title AS series_title
       FROM chapter_stats
       LEFT JOIN content_entries AS chapter_entries
         ON chapter_entries.entry_type = 'novel_chapter'
        AND chapter_entries.locale = chapter_stats.locale
        AND chapter_entries.parent_slug = chapter_stats.series_slug
        AND chapter_entries.slug = chapter_stats.chapter_slug
       LEFT JOIN content_entries AS series_entries
         ON series_entries.entry_type = 'novel_series'
        AND series_entries.locale = chapter_stats.locale
        AND series_entries.slug = chapter_stats.series_slug
       WHERE chapter_stats.series_slug = ?
         AND chapter_stats.chapter_slug = ?
         AND chapter_stats.locale = ?
         AND chapter_stats.window_days = ?
       ORDER BY chapter_stats.updated_at DESC, chapter_stats.id DESC
       LIMIT 1`
    )
    .bind(seriesSlug, chapterSlug, locale, windowDays)
    .first();

const queryNovelForgeInsightRow = async (db, { chapterSlug, locale, seriesSlug, windowDays }) =>
  db
    .prepare(
      `SELECT
        ai_insights.*,
        chapter_entries.title AS title,
        chapter_entries.chapter_number AS chapter_number,
        series_entries.title AS series_title
       FROM ai_insights
       LEFT JOIN content_entries AS chapter_entries
         ON chapter_entries.entry_type = 'novel_chapter'
        AND chapter_entries.locale = ai_insights.locale
        AND chapter_entries.parent_slug = ai_insights.series_slug
        AND chapter_entries.slug = ai_insights.chapter_slug
       LEFT JOIN content_entries AS series_entries
         ON series_entries.entry_type = 'novel_series'
        AND series_entries.locale = ai_insights.locale
        AND series_entries.slug = ai_insights.series_slug
       WHERE ai_insights.series_slug = ?
         AND ai_insights.chapter_slug = ?
         AND ai_insights.locale = ?
         AND ai_insights.window_days = ?
       ORDER BY ai_insights.generated_at DESC, ai_insights.updated_at DESC, ai_insights.id DESC
       LIMIT 1`
    )
    .bind(seriesSlug, chapterSlug, locale, windowDays)
    .first();

const queryNovelForgeSeriesTrendRows = async (db, { limit, locale, seriesSlug, windowDays }) => {
  const response = await db
    .prepare(
      `SELECT
        chapter_stats.*,
        chapter_entries.title AS title,
        chapter_entries.chapter_number AS chapter_number,
        series_entries.title AS series_title
       FROM chapter_stats
       LEFT JOIN content_entries AS chapter_entries
         ON chapter_entries.entry_type = 'novel_chapter'
        AND chapter_entries.locale = chapter_stats.locale
        AND chapter_entries.parent_slug = chapter_stats.series_slug
        AND chapter_entries.slug = chapter_stats.chapter_slug
       LEFT JOIN content_entries AS series_entries
         ON series_entries.entry_type = 'novel_series'
        AND series_entries.locale = chapter_stats.locale
        AND series_entries.slug = chapter_stats.series_slug
       WHERE chapter_stats.series_slug = ?
         AND chapter_stats.locale = ?
         AND chapter_stats.window_days = ?
       ORDER BY
         COALESCE(chapter_entries.chapter_number, 999999) ASC,
         chapter_entries.sort_order ASC,
         chapter_stats.updated_at DESC,
         chapter_stats.id ASC
       LIMIT ?`
    )
    .bind(seriesSlug, locale, windowDays, limit)
    .all();

  return response.results || [];
};

const queryNovelForgeSeriesTrendSummary = async (db, { locale, seriesSlug, windowDays }) =>
  db
    .prepare(
      `SELECT
        COUNT(*) AS chapter_count,
        COALESCE(SUM(total_events), 0) AS total_events,
        COALESCE(SUM(unique_sessions), 0) AS unique_sessions,
        COALESCE(AVG(completion_rate), 0) AS avg_completion_rate,
        COALESCE(AVG(engagement_score), 0) AS avg_engagement_score,
        COALESCE(AVG(avg_read_time_seconds), 0) AS avg_read_time_seconds,
        MAX(updated_at) AS latest_updated_at
       FROM chapter_stats
       WHERE series_slug = ?
         AND locale = ?
         AND window_days = ?`
    )
    .bind(seriesSlug, locale, windowDays)
    .first();

const novelForgeInsightWithFreshness = (insightRow, statsRow) => {
  if (!insightRow) return null;
  const insight = aiInsightToJson(insightRow);
  const statsUpdatedAt = statsRow?.updated_at || '';
  return {
    ...insight,
    stale: Boolean(statsUpdatedAt && insight.sourceStatsUpdatedAt && parseSqlTimestampMs(insight.sourceStatsUpdatedAt) < parseSqlTimestampMs(statsUpdatedAt)),
    statsUpdatedAt
  };
};

const decodeBasicHtmlEntities = (value) =>
  String(value || '')
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number.parseInt(code, 10);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : _;
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const plainTextFromHtml = (html) =>
  decodeBasicHtmlEntities(
    stripLeadingReaderHeadingHtml(html)
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|blockquote)>/gi, '\n\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const toIsoTimestamp = (value) => {
  const time = parseSqlTimestampMs(value);
  return time ? new Date(time).toISOString() : cleanText(value, 80);
};

const readNovelForgeChapterContentBody = async (env, chapter) => {
  const bucket = getContentBucket(env);
  if (!bucket && (chapter.markdown_r2_key || chapter.html_r2_key)) {
    const error = new Error('CONTENT_BUCKET is not configured, so chapter body text cannot be loaded.');
    error.code = 'CONTENT_BUCKET_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  if (!bucket) return { body: '', bodyFormat: 'empty', source: 'empty' };

  const markdown = await readContentObjectText(bucket, chapter.markdown_r2_key, 'Markdown body');
  if (markdown) {
    return {
      body: markdown,
      bodyFormat: 'markdown',
      source: 'markdown-r2'
    };
  }

  const html = await readContentObjectText(bucket, chapter.html_r2_key, 'HTML body');
  if (html) {
    return {
      body: plainTextFromHtml(html),
      bodyFormat: 'html-text',
      source: 'html-r2'
    };
  }

  return { body: '', bodyFormat: 'empty', source: 'empty' };
};

const handleNovelForgeChapterContent = async (request, env, route) => {
  const tokenError = requireNovelForgeContentToken(request, env);
  if (tokenError) return tokenError;

  const db = env.WAITLIST_DB;
  if (!db) return novelForgeImportError('Content database is not configured.', { code: 'CONTENT_DATABASE_NOT_CONFIGURED', status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return novelForgeImportError('Content tables are not initialized.', { code: 'CONTENT_TABLES_NOT_READY', status: 503 });
  }

  const options = getNovelForgeAnalyticsOptions(request, route);
  let chapter;
  try {
    chapter = await findNovelForgeChapterForAnalytics(db, options);
  } catch (error) {
    return novelForgeImportError(error.message || 'NovelForge chapter lookup failed.', {
      code: error.code || 'NOVELFORGE_CHAPTER_LOOKUP_FAILED',
      status: error.status || 400
    });
  }
  if (!chapter) {
    return novelForgeImportError('NovelForge chapter was not found.', { code: 'NOVELFORGE_CHAPTER_NOT_FOUND', status: 404 });
  }

  try {
    const body = await readNovelForgeChapterContentBody(env, chapter);
    return novelForgeImportJson({
      ok: true,
      body: body.body,
      bodyFormat: body.bodyFormat,
      chapter: novelForgeAnalyticsEntryToJson(chapter, request),
      id: novelForgeRemoteIdForEntry(chapter),
      resource: 'chapter-content',
      source: body.source,
      stage: 'novelforge-writing-api-5',
      status: chapter.status,
      title: chapter.title || '',
      updatedAt: toIsoTimestamp(chapter.updated_at || chapter.published_at || chapter.created_at)
    });
  } catch (error) {
    return novelForgeImportError(error.message || 'NovelForge chapter content could not be loaded.', {
      code: error.code || 'NOVELFORGE_CHAPTER_CONTENT_READ_FAILED',
      status: error.status || 500
    });
  }
};

const getNovelTranslationModel = (env) =>
  cleanText(env.NOVEL_TRANSLATION_MODEL || defaultNovelTranslationModel, 120) || defaultNovelTranslationModel;

const isNovelTranslationAutoSyncEnabled = (env) => cleanText(env.NOVEL_TRANSLATION_AUTO_SYNC || '1', 10) !== '0';
const getNovelEnglishTitleOverride = (title) => novelEnglishTitleOverrides.get(String(title || '').trim()) || '';

const extractAiText = (result) => {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  return (
    result.translated_text ||
    result.translatedText ||
    result.translation ||
    result.translation_text ||
    result.response ||
    result.text ||
    result.output_text ||
    result.result?.translated_text ||
    result.result?.translatedText ||
    result.result?.translation ||
    result.result?.translation_text ||
    result.result?.response ||
    result.result?.text ||
    result.choices?.[0]?.message?.content ||
    result.choices?.[0]?.text ||
    ''
  );
};

const stripAiTranslationWrapper = (value) =>
  String(value || '')
    .trim()
    .replace(/^```(?:markdown|md|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const splitNovelTranslationChunks = (value, maxLength = novelTranslationChunkMaxLength) => {
  const text = String(value || '').trim();
  if (!text) return [];
  const chunks = [];
  const pushLongText = (segment) => {
    let remaining = segment.trim();
    while (remaining.length > maxLength) {
      let cut = remaining.lastIndexOf('\n', maxLength);
      if (cut < Math.floor(maxLength * 0.55)) cut = remaining.lastIndexOf('。', maxLength);
      if (cut < Math.floor(maxLength * 0.55)) cut = remaining.lastIndexOf('.', maxLength);
      if (cut < Math.floor(maxLength * 0.55)) cut = maxLength;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
  };

  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxLength) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      pushLongText(trimmed);
      continue;
    }
    const next = current ? `${current}\n\n${trimmed}` : trimmed;
    if (next.length > maxLength) {
      if (current) chunks.push(current.trim());
      current = trimmed;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
};

const isWorkersAiTranslationModel = (model) => String(model || '').includes('m2m100');

const translateNovelTextToEnglish = async (env, sourceText, options = {}) => {
  const text = String(sourceText || '').trim();
  if (!text) return '';
  if (!env.AI || typeof env.AI.run !== 'function') {
    const error = new Error('Workers AI is not configured for novel translation.');
    error.code = 'NOVEL_TRANSLATION_AI_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const model = getNovelTranslationModel(env);
  const chunks = splitNovelTranslationChunks(text, normalizePositiveInteger(options.chunkMaxLength, novelTranslationChunkMaxLength));
  const context = cleanText(options.context || 'Station Cat serial fiction', 300);
  const field = cleanText(options.field || 'content', 80);
  const translateChunk = async (chunk) => {
    const input = isWorkersAiTranslationModel(model)
      ? {
          source_lang: 'zh',
          target_lang: 'en',
          text: chunk
        }
      : {
          messages: [
            {
              role: 'system',
              content: [
                'You are a professional literary translator for Chinese web fiction.',
                'Translate into natural, readable English while preserving names, timeline details, paragraph breaks, markdown structure, and narrative voice.',
                'Do not summarize, rewrite the plot, add explanations, add notes, repeat text, or wrap the answer in code fences.',
                'Return only the English translation.'
              ].join(' ')
            },
            {
              role: 'user',
              content: [`Context: ${context}`, `Field: ${field}`, 'Chinese text:', chunk].join('\n\n')
            }
          ],
          temperature: 0.15,
          max_tokens: 4096
        };
    const result = await env.AI.run(model, input);
    const translated = stripAiTranslationWrapper(extractAiText(result));
    if (!translated) {
      const error = new Error('Workers AI returned an empty translation.');
      error.code = 'NOVEL_TRANSLATION_EMPTY';
      error.status = 502;
      throw error;
    }
    return translated;
  };

  const translations = new Array(chunks.length);
  let nextChunkIndex = 0;
  const workerCount = Math.min(novelTranslationChunkConcurrency, chunks.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextChunkIndex < chunks.length) {
        const chunkIndex = nextChunkIndex;
        nextChunkIndex += 1;
        translations[chunkIndex] = await translateChunk(chunks[chunkIndex]);
      }
    })
  );

  return translations.join('\n\n').trim();
};

const readContentEntryTextBody = async (env, entry) => {
  if (!entry) return { body: '', bodyFormat: 'empty', source: 'empty' };
  if (entry.entry_type === 'novel_chapter') return readNovelForgeChapterContentBody(env, entry);

  const bucket = getContentBucket(env);
  if (!bucket && (entry.markdown_r2_key || entry.html_r2_key)) {
    const error = new Error('CONTENT_BUCKET is not configured, so content body text cannot be loaded.');
    error.code = 'CONTENT_BUCKET_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  if (!bucket) return { body: entry.description || entry.excerpt || '', bodyFormat: 'metadata', source: 'metadata' };

  const markdown = await readContentObjectText(bucket, entry.markdown_r2_key, 'Markdown body');
  if (markdown) return { body: markdown, bodyFormat: 'markdown', source: 'markdown-r2' };

  const html = await readContentObjectText(bucket, entry.html_r2_key, 'HTML body');
  if (html) return { body: plainTextFromHtml(html), bodyFormat: 'html-text', source: 'html-r2' };

  return { body: entry.description || entry.excerpt || '', bodyFormat: 'metadata', source: 'metadata' };
};

const findTranslatedContentEntry = (db, sourceEntry, targetLocale = defaultNovelTranslationTargetLocale) =>
  findContentEntryBySlug(db, {
    entryType: sourceEntry.entry_type,
    locale: targetLocale,
    parentSlug: sourceEntry.parent_slug || '',
    slug: sourceEntry.slug
  });

const translateContentEntryToEnglishPayload = async (env, sourceEntry) => {
  const sourceBody = await readContentEntryTextBody(env, sourceEntry);
  const sourceMetadata = parseStoredJson(sourceEntry.metadata_json, {});
  const contextParts = [
    sourceEntry.entry_type === 'novel_series' ? 'novel series metadata' : 'novel chapter',
    sourceEntry.title,
    sourceEntry.parent_slug ? `series ${sourceEntry.parent_slug}` : ''
  ].filter(Boolean);
  const context = contextParts.join(' · ');
  const translatedTitle =
    getNovelEnglishTitleOverride(sourceEntry.title) ||
    (await translateNovelTextToEnglish(env, sourceEntry.title, {
      chunkMaxLength: 500,
      context,
      field: 'title'
    }));
  const translatedSubtitle = sourceEntry.subtitle
    ? await translateNovelTextToEnglish(env, sourceEntry.subtitle, {
        chunkMaxLength: 700,
        context,
        field: 'subtitle'
      })
    : '';
  const sourceMarkdown = sourceBody.body || sourceEntry.description || sourceEntry.excerpt || '';
  const translatedMarkdown = sourceMarkdown
    ? await translateNovelTextToEnglish(env, sourceMarkdown, {
        context,
        field: sourceEntry.entry_type === 'novel_series' ? 'series description' : 'chapter body'
      })
    : '';
  const translatedDescription = firstPlainSummary([translatedMarkdown, translatedSubtitle], 1200);
  const translatedExcerpt = firstPlainSummary([translatedMarkdown, translatedSubtitle], 1000);
  const translatedWordCount = countContentWords(translatedMarkdown);
  const now = new Date().toISOString();

  return normalizeContentPayload({
    accessLevel: sourceEntry.access_level,
    authorName: sourceEntry.author_name || 'Station Cat',
    bodyFormat: 'markdown',
    chapterNumber: sourceEntry.chapter_number,
    coverAlt: sourceEntry.cover_alt ? `${translatedTitle} cover` : '',
    coverR2Key: sourceEntry.cover_r2_key,
    description: translatedDescription,
    entryType: sourceEntry.entry_type,
    excerpt: translatedExcerpt,
    featured: sourceEntry.featured,
    html: translatedMarkdown ? renderSimpleMarkdownToHtml(translatedMarkdown) : '',
    locale: defaultNovelTranslationTargetLocale,
    markdown: translatedMarkdown,
    metadata: {
      ...sourceMetadata,
      translation: {
        generatedAt: now,
        model: getNovelTranslationModel(env),
        sourceEntryId: sourceEntry.id,
        sourceLocale: sourceEntry.locale,
        sourceUpdatedAt: sourceEntry.updated_at || '',
        targetLocale: defaultNovelTranslationTargetLocale
      }
    },
    parentSlug: sourceEntry.parent_slug || '',
    pricing: parseStoredJson(sourceEntry.pricing_json, {}),
    publishedAt: sourceEntry.published_at || now,
    slug: sourceEntry.slug,
    sortOrder: normalizePositiveInteger(sourceEntry.sort_order, 0),
    sourceKind: 'translation',
    sourceRef: `translation:${sourceEntry.id}`,
    status: 'draft',
    subtitle: translatedSubtitle,
    tags: parseStoredJson(sourceEntry.tags_json, []),
    title: translatedTitle,
    visibility: 'private',
    volumeTitle: sourceEntry.volume_title
      ? await translateNovelTextToEnglish(env, sourceEntry.volume_title, {
          chunkMaxLength: 500,
          context,
          field: 'volume title'
        })
      : '',
    wordCount: translatedWordCount || normalizePositiveInteger(sourceEntry.word_count, 0)
  });
};

const translateAndPersistContentEntryToEnglish = async (db, env, sourceEntry, options = {}) => {
  if (!sourceEntry || sourceEntry.locale === defaultNovelTranslationTargetLocale) {
    return { entry: null, message: 'Source entry is already English.', status: 'skipped' };
  }

  const existing = await findTranslatedContentEntry(db, sourceEntry, defaultNovelTranslationTargetLocale);
  if (existing && !options.overwrite) {
    return {
      entry: existing,
      message: 'English translation already exists.',
      status: 'skipped'
    };
  }

  const translatedEntry = await translateContentEntryToEnglishPayload(env, sourceEntry);
  const { saved } = await persistContentEntry(db, env, translatedEntry, {
    actorEmail: options.actorEmail || 'translation-worker',
    auditAction: 'novel_translation_sync',
    auditMetadata: {
      overwrite: Boolean(options.overwrite),
      sourceEntryId: sourceEntry.id,
      sourceLocale: sourceEntry.locale
    },
    revisionSummary: `English translation sync from entry #${sourceEntry.id}`
  });

  return {
    entry: saved,
    message: existing ? 'English translation updated.' : 'English translation created.',
    status: existing ? 'updated' : 'created'
  };
};

const getPublishedNovelSeriesForTranslation = async (db, options = {}) => {
  const sourceLocale = normalizeContentLocale(options.sourceLocale || defaultNovelTranslationSourceLocale);
  const seriesSlug = cleanSlug(options.seriesSlug || '', 160);
  if (seriesSlug) {
    const series = await getPublishedContentEntry(db, {
      entryType: 'novel_series',
      locale: sourceLocale,
      slug: seriesSlug
    });
    return series ? [series] : [];
  }
  return listPublishedContentEntries(db, {
    entryType: 'novel_series',
    locale: sourceLocale,
    limit: options.seriesLimit || 100
  });
};

const getPublishedNovelChaptersForTranslation = async (db, options = {}) => {
  const sourceLocale = normalizeContentLocale(options.sourceLocale || defaultNovelTranslationSourceLocale);
  const seriesSlug = cleanSlug(options.seriesSlug || '', 160);
  const chapterSlugs = [
    ...(Array.isArray(options.chapterSlugs) ? options.chapterSlugs : []),
    options.chapterSlug
  ]
    .map((slug) => cleanSlug(slug, 160))
    .filter(Boolean);
  if (!seriesSlug) return [];

  if (chapterSlugs.length) {
    const chapters = [];
    for (const chapterSlug of chapterSlugs) {
      const chapter = await getPublishedContentEntry(db, {
        entryType: 'novel_chapter',
        locale: sourceLocale,
        parentSlug: seriesSlug,
        slug: chapterSlug
      });
      if (chapter) chapters.push(chapter);
    }
    return chapters;
  }

  return listPublishedContentEntries(db, {
    entryType: 'novel_chapter',
    locale: sourceLocale,
    parentSlug: seriesSlug,
    limit: options.limit || 100
  });
};

const syncPublishedNovelEnglishTranslations = async (env, options = {}) => {
  const db = env.WAITLIST_DB;
  if (!db) {
    const error = new Error('Content database is not configured.');
    error.code = 'CONTENT_DATABASE_NOT_CONFIGURED';
    error.status = 500;
    throw error;
  }
  if (!(await ensureContentTablesReady(db))) {
    const error = new Error('Content tables are not initialized.');
    error.code = 'CONTENT_TABLES_NOT_READY';
    error.status = 503;
    throw error;
  }
  if (!env.AI || typeof env.AI.run !== 'function') {
    const error = new Error('Workers AI is not configured for novel translation.');
    error.code = 'NOVEL_TRANSLATION_AI_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const sourceLocale = normalizeContentLocale(options.sourceLocale || defaultNovelTranslationSourceLocale);
  const limit = Math.min(Math.max(normalizePositiveInteger(options.limit, 100), 1), 200);
  const results = [];
  const errors = [];
  const skipSeries = Boolean(options.skipSeries);
  let remaining = limit;

  const sourceSeriesRows = await getPublishedNovelSeriesForTranslation(db, {
    seriesLimit: limit,
    seriesSlug: options.seriesSlug,
    sourceLocale
  });

  for (const series of sourceSeriesRows) {
    if (remaining <= 0) break;
    if (!skipSeries) {
      try {
        const result = await translateAndPersistContentEntryToEnglish(db, env, series, options);
        results.push({
          entryType: series.entry_type,
          message: result.message,
          parentSlug: series.parent_slug || '',
          remoteId: novelForgeRemoteIdForEntry(result.entry),
          slug: series.slug,
          status: result.status,
          title: result.entry?.title || series.title
        });
      } catch (error) {
        errors.push({
          entryType: series.entry_type,
          message: error.message || 'Series translation failed.',
          slug: series.slug
        });
      }
      remaining -= 1;
    }

    const chapters = await getPublishedNovelChaptersForTranslation(db, {
      chapterSlug: options.chapterSlug,
      chapterSlugs: options.chapterSlugs,
      limit: Math.min(100, Math.max(remaining, 1)),
      seriesSlug: series.slug,
      sourceLocale
    });
    for (const chapter of chapters) {
      if (remaining <= 0) break;
      try {
        const result = await translateAndPersistContentEntryToEnglish(db, env, chapter, options);
        results.push({
          chapterNumber: chapter.chapter_number,
          entryType: chapter.entry_type,
          message: result.message,
          parentSlug: chapter.parent_slug || '',
          remoteId: novelForgeRemoteIdForEntry(result.entry),
          slug: chapter.slug,
          status: result.status,
          title: result.entry?.title || chapter.title
        });
      } catch (error) {
        errors.push({
          chapterNumber: chapter.chapter_number,
          entryType: chapter.entry_type,
          message: error.message || 'Chapter translation failed.',
          parentSlug: chapter.parent_slug || '',
          slug: chapter.slug
        });
      }
      remaining -= 1;
    }
  }

  return {
    errors,
    limit,
    model: getNovelTranslationModel(env),
    results,
    sourceLocale,
    targetLocale: defaultNovelTranslationTargetLocale,
    translated: results.filter((entry) => entry.status === 'created' || entry.status === 'updated').length,
    skipped: results.filter((entry) => entry.status === 'skipped').length
  };
};

const handleNovelForgeTranslationSync = async (request, env) => {
  const tokenError = requireNovelForgeTranslationToken(request, env);
  if (tokenError) return tokenError;

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    const result = await syncPublishedNovelEnglishTranslations(env, {
      actorEmail: 'translation-worker',
      chapterSlug: payload.chapterSlug || payload.chapter,
      chapterSlugs: payload.chapterSlugs,
      limit: payload.limit,
      overwrite: Boolean(payload.overwrite),
      seriesSlug: payload.seriesSlug || payload.series,
      skipSeries: Boolean(payload.skipSeries),
      sourceLocale: payload.sourceLocale || payload.locale || defaultNovelTranslationSourceLocale
    });
    return novelForgeImportJson({
      ok: true,
      ...result
    });
  } catch (error) {
    return novelForgeImportError(error.message || 'Novel translation sync failed.', {
      code: error.code || 'NOVEL_TRANSLATION_SYNC_FAILED',
      status: error.status || 500
    });
  }
};

const handleNovelForgeAnalytics = async (request, env, route) => {
  const tokenError = requireNovelForgeAnalyticsToken(request, env);
  if (tokenError) return tokenError;

  const db = env.WAITLIST_DB;
  if (!db) return novelForgeImportError('Content database is not configured.', { code: 'CONTENT_DATABASE_NOT_CONFIGURED', status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return novelForgeImportError('Content tables are not initialized.', { code: 'CONTENT_TABLES_NOT_READY', status: 503 });
  }

  const options = getNovelForgeAnalyticsOptions(request, route);
  if (route.resource === 'trend') {
    if (!(await ensureChapterStatsReady(db))) {
      return novelForgeImportError('Chapter stats are not initialized. Apply migration 0015_chapter_stats.sql.', {
        code: 'CHAPTER_STATS_NOT_READY',
        status: 503
      });
    }
    const series = await findNovelForgeSeriesForAnalytics(db, options);
    if (!series) {
      return novelForgeImportError('NovelForge series was not found.', { code: 'NOVELFORGE_SERIES_NOT_FOUND', status: 404 });
    }

    const [summaryRow, trendRows] = await Promise.all([
      queryNovelForgeSeriesTrendSummary(db, {
        locale: series.locale,
        seriesSlug: series.slug,
        windowDays: options.windowDays
      }),
      queryNovelForgeSeriesTrendRows(db, {
        limit: options.limit,
        locale: series.locale,
        seriesSlug: series.slug,
        windowDays: options.windowDays
      })
    ]);

    return novelForgeImportJson({
      ok: true,
      resource: 'trend',
      series: novelForgeAnalyticsEntryToJson(series, request),
      stage: 'novelforge-writing-api-5',
      summary: {
        avgCompletionRate: Number(summaryRow?.avg_completion_rate || 0),
        avgEngagementScore: Number(summaryRow?.avg_engagement_score || 0),
        avgReadTimeSeconds: Math.round(Number(summaryRow?.avg_read_time_seconds || 0)),
        chapterCount: normalizePositiveInteger(summaryRow?.chapter_count, 0),
        latestUpdatedAt: summaryRow?.latest_updated_at || '',
        totalEvents: normalizePositiveInteger(summaryRow?.total_events, 0),
        uniqueSessions: normalizePositiveInteger(summaryRow?.unique_sessions, 0)
      },
      trend: trendRows.map(chapterStatsToJson),
      windowDays: options.windowDays
    });
  }

  let chapter;
  try {
    chapter = await findNovelForgeChapterForAnalytics(db, options);
  } catch (error) {
    return novelForgeImportError(error.message || 'NovelForge chapter lookup failed.', {
      code: error.code || 'NOVELFORGE_CHAPTER_LOOKUP_FAILED',
      status: error.status || 400
    });
  }
  if (!chapter) {
    return novelForgeImportError('NovelForge chapter was not found.', { code: 'NOVELFORGE_CHAPTER_NOT_FOUND', status: 404 });
  }

  const chapterTarget = {
    chapterSlug: chapter.slug,
    locale: chapter.locale,
    seriesSlug: chapter.parent_slug || '',
    windowDays: options.windowDays
  };

  if (route.resource === 'chapter') {
    if (!(await ensureChapterStatsReady(db))) {
      return novelForgeImportError('Chapter stats are not initialized. Apply migration 0015_chapter_stats.sql.', {
        code: 'CHAPTER_STATS_NOT_READY',
        status: 503
      });
    }
    const statsRow = chapterTarget.seriesSlug ? await queryNovelForgeChapterStatsRow(db, chapterTarget) : null;
    return novelForgeImportJson({
      ok: true,
      chapter: novelForgeAnalyticsEntryToJson(chapter, request),
      resource: 'chapter',
      stage: 'novelforge-writing-api-5',
      stats: statsRow ? chapterStatsToJson(statsRow) : null,
      windowDays: options.windowDays
    });
  }

  if (!(await ensureChapterStatsReady(db))) {
    return novelForgeImportError('Chapter stats are not initialized. Apply migration 0015_chapter_stats.sql.', {
      code: 'CHAPTER_STATS_NOT_READY',
      status: 503
    });
  }
  if (!(await ensureAiInsightsReady(db))) {
    return novelForgeImportError('AI insights are not initialized. Apply migration 0016_ai_insights.sql.', {
      code: 'AI_INSIGHTS_NOT_READY',
      status: 503
    });
  }

  const [insightRow, statsRow] = await Promise.all([
    chapterTarget.seriesSlug ? queryNovelForgeInsightRow(db, chapterTarget) : null,
    chapterTarget.seriesSlug ? queryNovelForgeChapterStatsRow(db, chapterTarget) : null
  ]);

  return novelForgeImportJson({
    ok: true,
    chapter: novelForgeAnalyticsEntryToJson(chapter, request),
    insight: novelForgeInsightWithFreshness(insightRow, statsRow),
    resource: 'insights',
    stage: 'novelforge-writing-api-5',
    stats: statsRow ? chapterStatsToJson(statsRow) : null,
    windowDays: options.windowDays
  });
};

const buildNovelForgeImportBackupKey = (requestId) => {
  const now = new Date();
  const year = now.toISOString().slice(0, 4);
  const month = now.toISOString().slice(5, 7);
  const safeRequestId = cleanSlug(requestId, 120) || 'novelforge-import';
  const token = (crypto.randomUUID?.() || randomToken(12)).replace(/-/g, '').slice(0, 12);
  return `content/imports/novelforge/${year}/${month}/${safeRequestId}-${Date.now()}-${token}.json`;
};

const createNovelForgeImportRecord = async (db, data) =>
  db
    .prepare(
      `INSERT INTO content_imports (
        import_type, filename, r2_key, status, warnings_json, errors_json, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *`
    )
    .bind(
      'novelforge',
      cleanText(data.requestId, 240),
      cleanText(data.r2Key, 500),
      'processing',
      '[]',
      '[]',
      cleanText(data.actorEmail || 'novelforge-api', 160)
    )
    .first();

const updateNovelForgeImportRecord = async (db, id, data) => {
  if (!id) return;
  await db
    .prepare(
      `UPDATE content_imports
       SET status = ?,
           entries_created = ?,
           entries_updated = ?,
           warnings_json = ?,
           errors_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      cleanText(data.status, 80),
      normalizePositiveInteger(data.entriesCreated, 0),
      normalizePositiveInteger(data.entriesUpdated, 0),
      JSON.stringify(Array.isArray(data.warnings) ? data.warnings : []),
      JSON.stringify(Array.isArray(data.errors) ? data.errors : []),
      id
    )
    .run();
};

const uploadNovelForgeImportBackup = async (env, requestId, bodyText) => {
  const bucket = getContentBucket(env);
  if (!bucket) return '';
  const key = buildNovelForgeImportBackupKey(requestId);
  await bucket.put(key, bodyText, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
  return key;
};

const buildNovelForgeSeriesPayload = ({ coverPayload, existing, item, mode, projectPayload, publishPackage, requestId }) => {
  const existingMetadata = parseStoredJson(existing?.metadata_json, {});
  const pricingSuggestion = normalizeJsonObject(projectPayload.pricingSuggestion || publishPackage.pricingSuggestion);
  const projectId = firstCleanText([projectPayload.id, publishPackage.project?.id, item?.localId], 120) || 'project';
  const title = firstCleanText([projectPayload.title, publishPackage.project?.title, projectId], 240) || 'Untitled novel';
  const explicitSlug = firstCleanText([projectPayload.slug, projectPayload.seriesSlug], 160);
  const slug = cleanSlug(explicitSlug || existing?.slug || projectId || title, 160) || `work-${Date.now()}`;
  const locale = normalizeContentLocale(projectPayload.locale || projectPayload.language || publishPackage.locale);
  const description = firstPlainSummary([projectPayload.description, projectPayload.summary, publishPackage.project?.description], 1200);
  const cover = normalizeJsonObject(coverPayload);
  const coverR2Key =
    firstCleanText([cover.coverR2Key, cover.r2Key, cover.imageUrl, projectPayload.coverR2Key, projectPayload.coverImage], 500) ||
    existing?.cover_r2_key ||
    '';
  const coverAlt =
    firstCleanText([cover.coverAlt, cover.alt, projectPayload.coverAlt, `${title} 封面`], 300) ||
    existing?.cover_alt ||
    '';
  const status = mode === 'publish' ? 'published' : 'draft';
  const publishedAt =
    mode === 'publish'
      ? firstCleanText([existing?.published_at, publishPackage.generatedAt, new Date().toISOString()], 80)
      : '';
  const tags = normalizeStringArray([
    projectPayload.genre,
    projectPayload.platform,
    projectPayload.targetAudience
  ]);

  return {
    accessLevel: existing?.access_level || 'free',
    authorName: firstCleanText([projectPayload.authorName, projectPayload.author], 160) || existing?.author_name || 'Station Cat',
    coverAlt,
    coverR2Key,
    description,
    entryType: 'novel_series',
    excerpt: description,
    html: description ? renderSimpleMarkdownToHtml(description) : '',
    locale,
    markdown: description,
    metadata: {
      ...existingMetadata,
      novelforge: {
        contentHash: cleanText(item?.contentHash, 140),
        cover: {
          imagePath: cleanText(cover.imagePath, 500),
          imageUrl: cleanText(cover.imageUrl, 500),
          prompt: cleanText(cover.prompt, 1000),
          status: cleanText(cover.status, 80)
        },
        generatedAt: cleanText(publishPackage.generatedAt, 80),
        localId: cleanText(item?.localId || projectId, 140),
        packageVersion: normalizePositiveInteger(publishPackage.version, 1),
        pricingSuggestion,
        projectId,
        requestId
      }
    },
    pricing: parseStoredJson(existing?.pricing_json, {}),
    publishedAt,
    slug,
    sourceKind: 'novelforge',
    sourceRef: requestId,
    status,
    subtitle: firstCleanText([projectPayload.genre, projectPayload.targetAudience, projectPayload.platform], 400),
    tags,
    title,
    visibility: existing?.visibility || 'public',
    wordCount: normalizePositiveInteger(projectPayload.totalWordTarget, 0)
  };
};

const buildNovelForgeChapterPayload = ({ chapterPayload, existing, item, mode, publishPackage, requestId, series }) => {
  const existingMetadata = parseStoredJson(existing?.metadata_json, {});
  const body = getNovelForgeBody(chapterPayload);
  const chapterNumber =
    normalizeMaybeNumber(chapterPayload.chapterNumber, null) ??
    normalizeMaybeNumber(chapterPayload.number, null) ??
    normalizeMaybeNumber(existing?.chapter_number, null);
  const localId = firstCleanText([chapterPayload.id, item?.localId], 120) || `chapter-${chapterNumber || Date.now()}`;
  const title = firstCleanText([chapterPayload.title, item?.label, localId], 240) || 'Untitled chapter';
  const explicitSlug = firstCleanText([chapterPayload.slug, chapterPayload.chapterSlug], 160);
  const slug = cleanSlug(explicitSlug || existing?.slug || localId || title, 160) || `chapter-${chapterNumber || Date.now()}`;
  const status = mode === 'publish' ? 'published' : 'draft';
  const publishedAt =
    mode === 'publish'
      ? firstCleanText([existing?.published_at, chapterPayload.updatedAt, publishPackage.generatedAt, new Date().toISOString()], 80)
      : '';
  const excerpt = firstPlainSummary([chapterPayload.excerpt, chapterPayload.summary, excerptFromText(body)], 1000);
  const wordCount = normalizePositiveInteger(chapterPayload.wordCount, countContentWords(body));

  return {
    accessLevel: existing?.access_level || 'free',
    authorName: series.author_name || 'Station Cat',
    chapterNumber: chapterNumber || 1,
    description: excerpt,
    entryType: 'novel_chapter',
    excerpt,
    html: renderSimpleMarkdownToHtml(body),
    locale: series.locale,
    markdown: body,
    metadata: {
      ...existingMetadata,
      novelforge: {
        contentHash: cleanText(item?.contentHash, 140),
        generatedAt: cleanText(publishPackage.generatedAt, 80),
        localId,
        packageVersion: normalizePositiveInteger(publishPackage.version, 1),
        requestId,
        sourceStatus: cleanText(chapterPayload.status, 80)
      }
    },
    parentSlug: series.slug,
    pricing: parseStoredJson(existing?.pricing_json, {}),
    publishedAt,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 450)),
    slug,
    sourceKind: 'novelforge',
    sourceRef: requestId,
    status,
    title,
    visibility: existing?.visibility || 'public',
    wordCount
  };
};

const resultForNovelForgeItem = ({ item, message, remoteId, status }) => ({
  localType: cleanText(item?.localType, 40),
  localId: cleanText(item?.localId, 140),
  message,
  remoteId: remoteId || null,
  status
});

const handleNovelForgeImport = async (request, env, ctx) => {
  const tokenError = requireNovelForgePublishToken(request, env);
  if (tokenError) return tokenError;

  const db = env.WAITLIST_DB;
  if (!db) return novelForgeImportError('Content database is not configured.', { code: 'CONTENT_DATABASE_NOT_CONFIGURED', status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return novelForgeImportError('Content tables are not initialized.', { code: 'CONTENT_TABLES_NOT_READY', status: 503 });
  }

  let bodyText;
  let normalized;
  try {
    const readResult = await readNovelForgeImportPayload(request);
    bodyText = readResult.bodyText;
    normalized = validateNovelForgeImportPayload(readResult.payload);
  } catch (error) {
    return novelForgeImportError(error.message, {
      code: error.code || 'NOVELFORGE_IMPORT_INVALID',
      status: error.status || 400
    });
  }

  const actorEmail = 'novelforge-api';
  let importRecord = null;
  const warnings = [];
  const errors = [];
  const itemResults = [];
  let entriesCreated = 0;
  let entriesUpdated = 0;
  const importedChapterSlugs = [];

  try {
    const backupKey = await uploadNovelForgeImportBackup(env, normalized.requestId, bodyText);
    importRecord = await createNovelForgeImportRecord(db, {
      actorEmail,
      requestId: normalized.requestId,
      r2Key: backupKey
    });

    const projectItem = getNovelForgeItemByType(normalized.changedItems, 'project');
    const coverItem = getNovelForgeItemByType(normalized.changedItems, 'cover');
    const chapterItems = getNovelForgeItemsByType(normalized.changedItems, 'chapter');
    const unsupportedItems = normalized.changedItems.filter((item) => !['project', 'cover', 'chapter'].includes(cleanText(item.localType, 40)));
    const projectPayload = {
      ...normalizeJsonObject(normalized.publishPackage.project),
      ...getNovelForgeItemPayload(projectItem, {}),
      pricingSuggestion: normalizeJsonObject(
        getNovelForgeItemPayload(projectItem, {}).pricingSuggestion || normalized.publishPackage.pricingSuggestion
      )
    };
    const coverPayload = {
      ...normalizeJsonObject(normalized.publishPackage.cover),
      ...getNovelForgeItemPayload(coverItem, {})
    };

    const initialSeriesEntry = normalizeContentPayload(
      buildNovelForgeSeriesPayload({
        coverPayload,
        existing: null,
        item: projectItem || coverItem,
        mode: normalized.mode,
        projectPayload,
        publishPackage: normalized.publishPackage,
        requestId: normalized.requestId
      })
    );
    let existingSeries = await findExistingNovelForgeEntry(db, projectItem?.remoteId || coverItem?.remoteId, initialSeriesEntry);
    let series = existingSeries;

    if (projectItem || coverItem || !series) {
      const seriesEntry = normalizeContentPayload(
        buildNovelForgeSeriesPayload({
          coverPayload,
          existing: existingSeries,
          item: projectItem || coverItem,
          mode: normalized.mode,
          projectPayload,
          publishPackage: normalized.publishPackage,
          requestId: normalized.requestId
        })
      );
      const { saved } = await persistContentEntry(db, env, seriesEntry, {
        actorEmail,
        auditAction: 'novelforge_import_series',
        auditMetadata: {
          importId: importRecord?.id,
          mode: normalized.mode,
          requestId: normalized.requestId
        },
        revisionSummary: `NovelForge import ${normalized.requestId}`
      });
      series = saved;
      if (existingSeries) entriesUpdated += 1;
      else entriesCreated += 1;
    }

    if (projectItem) {
      itemResults.push(
        resultForNovelForgeItem({
          item: projectItem,
          message: existingSeries ? 'Project metadata updated.' : 'Project metadata imported.',
          remoteId: novelForgeRemoteIdForEntry(series),
          status: existingSeries ? 'updated' : 'created'
        })
      );
    }

    if (coverItem) {
      itemResults.push(
        resultForNovelForgeItem({
          item: coverItem,
          message: coverPayload.imageUrl || coverPayload.coverR2Key || coverPayload.r2Key
            ? 'Cover metadata linked to the series.'
            : 'Cover prompt accepted; no image asset was provided.',
          remoteId: novelForgeCoverRemoteIdForSeries(series),
          status: 'updated'
        })
      );
    }

    for (const chapterItem of chapterItems) {
      const chapterPayload = getNovelForgeItemPayload(chapterItem, {});
      const body = getNovelForgeBody(chapterPayload);
      if (!body) {
        warnings.push(`Skipped empty chapter: ${cleanText(chapterItem.label || chapterItem.localId, 160)}`);
        itemResults.push(
          resultForNovelForgeItem({
            item: chapterItem,
            message: 'Chapter body is empty.',
            remoteId: chapterItem.remoteId || null,
            status: 'skipped'
          })
        );
        continue;
      }

      const initialChapterEntry = normalizeContentPayload(
        buildNovelForgeChapterPayload({
          chapterPayload,
          existing: null,
          item: chapterItem,
          mode: normalized.mode,
          publishPackage: normalized.publishPackage,
          requestId: normalized.requestId,
          series
        })
      );
      const existingChapter = await findExistingNovelForgeEntry(db, chapterItem.remoteId, initialChapterEntry);
      const chapterEntry = normalizeContentPayload(
        buildNovelForgeChapterPayload({
          chapterPayload,
          existing: existingChapter,
          item: chapterItem,
          mode: normalized.mode,
          publishPackage: normalized.publishPackage,
          requestId: normalized.requestId,
          series
        })
      );
      const { saved } = await persistContentEntry(db, env, chapterEntry, {
        actorEmail,
        auditAction: 'novelforge_import_chapter',
        auditMetadata: {
          importId: importRecord?.id,
          mode: normalized.mode,
          requestId: normalized.requestId,
          seriesSlug: series.slug
        },
        revisionSummary: `NovelForge import ${normalized.requestId}`
      });
      if (saved.status === 'published') importedChapterSlugs.push(saved.slug);
      if (existingChapter) entriesUpdated += 1;
      else entriesCreated += 1;
      itemResults.push(
        resultForNovelForgeItem({
          item: chapterItem,
          message: existingChapter ? 'Chapter updated.' : 'Chapter imported.',
          remoteId: novelForgeRemoteIdForEntry(saved),
          status: existingChapter ? 'updated' : 'created'
        })
      );
    }

    unsupportedItems.forEach((item) => {
      warnings.push(`Unsupported NovelForge item type: ${cleanText(item.localType, 80)}`);
      itemResults.push(
        resultForNovelForgeItem({
          item,
          message: 'Unsupported item type.',
          remoteId: item.remoteId || null,
          status: 'skipped'
        })
      );
    });

    await updateNovelForgeImportRecord(db, importRecord?.id, {
      entriesCreated,
      entriesUpdated,
      errors,
      status: warnings.length ? 'completed_with_warnings' : 'completed',
      warnings
    });

    const origin = new URL(request.url).origin;
    if (
      normalized.mode === 'publish' &&
      series?.locale === defaultNovelTranslationSourceLocale &&
      isNovelTranslationAutoSyncEnabled(env) &&
      typeof ctx?.waitUntil === 'function'
    ) {
      ctx.waitUntil(
        syncPublishedNovelEnglishTranslations(env, {
          actorEmail,
          chapterSlugs: importedChapterSlugs,
          limit: Math.max(1, importedChapterSlugs.length + 1),
          overwrite: true,
          seriesSlug: series.slug,
          sourceLocale: series.locale
        }).catch((error) => {
          console.error('Novel translation auto sync failed', error);
        })
      );
    }

    return novelForgeImportJson({
      ok: true,
      remoteBookId: novelForgeRemoteIdForEntry(series),
      previewUrl: novelForgePreviewUrl(origin, series.id),
      publishUrl: novelForgePublicSeriesUrl(origin, series.locale, series.slug),
      message: normalized.mode === 'publish' ? 'Imported and published.' : 'Imported as draft.',
      items: itemResults,
      requestId: normalized.requestId,
      remoteIds: {
        cover: novelForgeCoverRemoteIdForSeries(series),
        project: novelForgeRemoteIdForEntry(series)
      }
    });
  } catch (error) {
    errors.push(error.message || 'NovelForge import failed.');
    await updateNovelForgeImportRecord(db, importRecord?.id, {
      entriesCreated,
      entriesUpdated,
      errors,
      status: 'failed',
      warnings
    });
    return novelForgeImportError(error.message || 'NovelForge import failed.', {
      code: error.code || 'NOVELFORGE_IMPORT_FAILED',
      errors,
      status: error.status || 500
    });
  }
};

const handlePublicContentEntries = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return json({
      ok: true,
      setupRequired: true,
      source: 'backend-content-platform',
      stage: '7D',
      entries: []
    });
  }

  const url = new URL(request.url);
  let query;
  try {
    query = buildContentEntriesQuery(url, { publicOnly: true });
  } catch (error) {
    return json({ ok: false, code: error.code || 'CONTENT_QUERY_INVALID', message: error.message }, { status: 400 });
  }

  const response = await db
    .prepare(
      `SELECT *
       FROM content_entries
       ${query.where}
       ORDER BY
         COALESCE(published_at, updated_at) DESC,
         sort_order ASC,
         id DESC
       LIMIT ?`
    )
    .bind(...query.params, query.limit)
    .all();

  return json({
    ok: true,
    source: 'backend-content-platform',
    stage: '7D',
    entries: (response.results || []).map(contentEntryToJson)
  });
};

const publicContentResponse = (body, init = {}) =>
  json(body, {
    ...init,
    headers: {
      'cache-control': 'no-store',
      ...(init.headers || {})
    }
  });

const handlePublicNovelPricing = async (request, env) => {
  const url = new URL(request.url);
  const seriesSlug = cleanSlug(url.searchParams.get('seriesSlug') || url.searchParams.get('series'), 160);
  const chapterSlug = cleanSlug(url.searchParams.get('chapterSlug') || url.searchParams.get('chapter'), 160);
  const locale = cleanText(url.searchParams.get('locale') || url.searchParams.get('language'), 20);
  if (!seriesSlug) {
    return publicContentResponse({ ok: false, code: 'SERIES_REQUIRED', message: 'series is required.' }, { status: 400 });
  }

  const settings = await resolveSeriesPaymentSettings(env.WAITLIST_DB, seriesSlug, env, { chapterSlug, locale });
  return publicContentResponse({
    ok: true,
    pricing: paymentSettingsToPublicJson(settings, { chapterSlug }),
    stage: '7E-B'
  });
};

const getPublishedContentEntry = async (db, options) => {
  const entryType = cleanText(options.entryType, 40);
  const locale = normalizeContentLocale(options.locale);
  const slug = cleanSlug(options.slug, 160);
  const parentSlug = cleanSlug(options.parentSlug || '', 160);
  if (!entryType || !slug) return null;

  return db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = ?
         AND locale = ?
         AND slug = ?
         AND parent_slug = ?
         AND status = 'published'
         AND visibility IN ('public', 'unlisted')
       ORDER BY COALESCE(published_at, updated_at) DESC, id DESC
       LIMIT 1`
    )
    .bind(entryType, locale, slug, parentSlug)
    .first();
};

const listPublishedContentEntries = async (db, options) => {
  const entryType = cleanText(options.entryType, 40);
  const locale = normalizeContentLocale(options.locale);
  const parentSlug = cleanSlug(options.parentSlug || '', 160);
  const limit = Math.min(Math.max(Number.parseInt(options.limit || '50', 10) || 50, 1), 100);
  const params = [entryType, locale];
  let parentClause = '';

  if (options.parentSlug !== undefined) {
    parentClause = 'AND parent_slug = ?';
    params.push(parentSlug);
  }

  const orderClause =
    entryType === 'novel_chapter'
      ? 'chapter_number ASC, sort_order ASC, COALESCE(published_at, updated_at) ASC, id ASC'
      : 'featured DESC, sort_order ASC, COALESCE(published_at, updated_at) DESC, id DESC';

  const response = await db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = ?
         AND locale = ?
         ${parentClause}
         AND status = 'published'
         AND visibility IN ('public', 'unlisted')
       ORDER BY ${orderClause}
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();

  return response.results || [];
};

const getAdjacentPublishedSignalBriefs = async (db, brief, locale) => {
  const normalizedLocale = normalizeContentLocale(locale);
  const publishedAt = cleanText(brief?.published_at || brief?.updated_at, 80);
  const entryId = Number.parseInt(brief?.id, 10);
  if (!publishedAt || !Number.isFinite(entryId)) return { next: null, previous: null };

  const selectAdjacent = (direction) => {
    const comparison = direction === 'previous' ? '<' : '>';
    const order = direction === 'previous' ? 'DESC' : 'ASC';
    return db
      .prepare(
        `SELECT *
         FROM content_entries
         WHERE entry_type = 'signal_brief'
           AND locale = ?
           AND status = 'published'
           AND visibility IN ('public', 'unlisted')
           AND (
             COALESCE(published_at, updated_at) ${comparison} ?
             OR (COALESCE(published_at, updated_at) = ? AND id ${comparison} ?)
           )
         ORDER BY COALESCE(published_at, updated_at) ${order}, id ${order}
         LIMIT 1`
      )
      .bind(normalizedLocale, publishedAt, publishedAt, entryId)
      .first();
  };

  const [previous, next] = await Promise.all([selectAdjacent('previous'), selectAdjacent('next')]);
  return { next: next || null, previous: previous || null };
};

const renderSimpleMarkdownToHtml = (markdown) => {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      output.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      closeList();
      output.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
      continue;
    }

    if (trimmed.startsWith('## ')) {
      closeList();
      output.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      closeList();
      output.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!listOpen) {
        output.push('<ul>');
        listOpen = true;
      }
      output.push(`<li>${escapeHtml(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    closeList();
    output.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  closeList();
  return output.join('\n');
};

const stripLeadingReaderHeadingHtml = (html) =>
  String(html || '').replace(/^\s*<h[12]\b[^>]*>[\s\S]*?<\/h[12]>\s*/i, '');

const readPublicEntryBody = async (env, row, options = {}) => {
  if (!row) return { html: '', source: 'none' };
  if (row.access_level !== 'free') return { html: '', source: 'protected' };

  const bucket = getContentBucket(env);
  if (!bucket) return { html: '', source: 'missing-bucket' };

  if (options.preferMarkdown) {
    const markdown = await readContentObjectText(bucket, row.markdown_r2_key, 'Markdown body');
    if (markdown) {
      return {
        html: stripLeadingReaderHeadingHtml(renderSimpleMarkdownToHtml(markdown)),
        markdown,
        source: 'markdown-r2'
      };
    }
  }

  const html = await readContentObjectText(bucket, row.html_r2_key, 'HTML body');
  if (html) return { html: stripLeadingReaderHeadingHtml(html), source: 'html-r2' };

  const markdown = await readContentObjectText(bucket, row.markdown_r2_key, 'Markdown body');
  if (markdown) {
    return {
      html: stripLeadingReaderHeadingHtml(renderSimpleMarkdownToHtml(markdown)),
      markdown,
      source: 'markdown-r2'
    };
  }

  return { html: '', source: 'empty' };
};

const handlePublicContentBody = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return publicContentResponse({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return publicContentResponse({ ok: false, code: 'CONTENT_TABLES_NOT_READY', message: 'Content tables are not initialized.' }, { status: 503 });
  }

  const url = new URL(request.url);
  let entryType;
  try {
    entryType = normalizeContentEntryType(url.searchParams.get('type') || url.searchParams.get('entryType'));
  } catch (error) {
    return publicContentResponse({ ok: false, code: error.code || 'CONTENT_TYPE_INVALID', message: error.message }, { status: 400 });
  }

  const locale = normalizeContentLocale(url.searchParams.get('locale') || url.searchParams.get('language'));
  const slug = cleanSlug(url.searchParams.get('slug') || url.searchParams.get('chapter'), 160);
  const parentSlug = cleanSlug(url.searchParams.get('parentSlug') || url.searchParams.get('series'), 160);
  if (!slug) return publicContentResponse({ ok: false, code: 'CONTENT_SLUG_REQUIRED', message: 'A slug is required.' }, { status: 400 });

  const entry = await getPublishedContentEntry(db, { entryType, locale, parentSlug, slug });
  if (!entry) return publicContentResponse({ ok: false, code: 'CONTENT_NOT_FOUND', message: 'Content was not found.' }, { status: 404 });
  let effectiveAccessLevel = entry.access_level;
  if (entryType === 'novel_chapter') {
    const settings = await resolveSeriesPaymentSettings(db, entry.parent_slug, env, { chapterSlug: entry.slug, locale: entry.locale });
    effectiveAccessLevel = getEffectiveDynamicChapterAccessLevel(entry, settings);
  }
  if (effectiveAccessLevel !== 'free') {
    return publicContentResponse(
      {
        ok: false,
        code: 'CONTENT_PROTECTED',
        entry: contentEntryToJson({ ...entry, access_level: effectiveAccessLevel }),
        message: 'This content is protected.'
      },
      { status: 403 }
    );
  }

  const body = await readPublicEntryBody(env, { ...entry, access_level: effectiveAccessLevel });
  return publicContentResponse({
    ok: true,
    entry: contentEntryToJson(entry),
    content: {
      html: body.html,
      source: body.source
    }
  });
};

const contentPreviewTimestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const contentPreviewRowFromEntry = (entry) => ({
  access_level: entry.accessLevel,
  author_name: entry.authorName,
  chapter_number: entry.chapterNumber,
  cover_alt: entry.coverAlt,
  cover_r2_key: entry.coverR2Key,
  description: entry.description,
  entry_type: entry.entryType,
  excerpt: entry.excerpt,
  locale: entry.locale,
  metadata_json: JSON.stringify(normalizeJsonObject(entry.metadata)),
  parent_slug: entry.parentSlug,
  published_at: entry.publishedAt || entry.scheduledAt || contentPreviewTimestamp(),
  slug: entry.slug,
  sort_order: entry.sortOrder,
  status: entry.status,
  subtitle: entry.subtitle,
  title: entry.title,
  updated_at: contentPreviewTimestamp(),
  word_count: entry.wordCount
});

const getPreviewBody = (entry) => ({
  html: entry.html || renderSimpleMarkdownToHtml(entry.markdown),
  source: 'admin-preview'
});

const getPreviewBasePath = (entry) => {
  if (entry.entryType === 'blog_post') return getPathWithLocale(entry.locale, 'devlog');
  if (entry.entryType === 'signal_brief') return getPathWithLocale(entry.locale, 'signal');
  return novelV2BasePathForLocale(entry.locale);
};

const getAnyPreviewContentEntry = async (env, options) => {
  const db = env.WAITLIST_DB;
  if (!db || !(await ensureContentTablesReady(db))) return null;

  const entryType = cleanText(options.entryType, 40);
  const locale = normalizeContentLocale(options.locale);
  const slug = cleanSlug(options.slug, 160);
  const parentSlug = cleanSlug(options.parentSlug || '', 160);
  if (!entryType || !slug) return null;

  return db
    .prepare(
      `SELECT *
       FROM content_entries
       WHERE entry_type = ?
         AND locale = ?
         AND slug = ?
         AND parent_slug = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    )
    .bind(entryType, locale, slug, parentSlug)
    .first();
};

const mergePreviewChapter = (chapters, previewChapter) => {
  const rows = new Map((chapters || []).map((chapter) => [chapter.slug, chapter]));
  rows.set(previewChapter.slug, previewChapter);
  return [...rows.values()].sort((left, right) => {
    const leftNumber = normalizePositiveInteger(left.chapter_number, 0);
    const rightNumber = normalizePositiveInteger(right.chapter_number, 0);
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    return cleanText(left.slug, 160).localeCompare(cleanText(right.slug, 160));
  });
};

const previewRouteFromEntry = (entry) => {
  const basePath = getPreviewBasePath(entry);
  if (entry.entryType === 'blog_post') {
    return { basePath, kind: 'devlog-post', locale: entry.locale, slug: entry.slug };
  }
  if (entry.entryType === 'signal_brief') {
    return { basePath, kind: 'signal-brief', locale: entry.locale, slug: entry.slug };
  }
  if (entry.entryType === 'novel_series') {
    return { basePath, kind: 'novel-series', locale: entry.locale, readerVersion: 'v2', seriesSlug: entry.slug };
  }
  return {
    basePath,
    chapterPathSegment: 'chapter',
    chapterSlug: entry.slug,
    kind: 'novel-chapter',
    locale: entry.locale,
    readerVersion: 'v2',
    seriesSlug: entry.parentSlug
  };
};

const addPreviewBanner = (entry, body) => `<section class="status" data-tone="success">
    Admin Preview · ${escapeHtml(entry.entryType)} · ${escapeHtml(entry.status)} · This page is not publicly published by this preview.
  </section>
  ${body}`;

const renderAdminContentPreview = async (entry, env) => {
  const row = contentPreviewRowFromEntry(entry);
  const route = previewRouteFromEntry(entry);
  const body = getPreviewBody(entry);

  if (entry.entryType === 'blog_post') {
    return {
      body: addPreviewBanner(entry, renderDynamicDevlogPost(route, row, body)),
      canonicalPath: dynamicCanonicalPath(route),
      description: firstPlainSummary([entry.description, entry.excerpt], 260),
      lang: entry.locale,
      robots: 'noindex, nofollow',
      title: `[Preview] ${entry.title}`
    };
  }

  if (entry.entryType === 'signal_brief') {
    return {
      body: addPreviewBanner(entry, renderDynamicSignalBrief(route, row, body)),
      canonicalPath: dynamicCanonicalPath(route),
      description: firstPlainSummary([entry.description, entry.excerpt], 260),
      lang: entry.locale,
      ogImage: dynamicSignalCardPath(route, entry.slug),
      pageKind: 'signal',
      robots: 'noindex, nofollow',
      title: `[Preview] ${entry.title}`
    };
  }

  if (entry.entryType === 'novel_series') {
    const chapters =
      env.WAITLIST_DB && (await ensureContentTablesReady(env.WAITLIST_DB))
        ? await listPublishedContentEntries(env.WAITLIST_DB, {
            entryType: 'novel_chapter',
            locale: entry.locale,
            parentSlug: entry.slug,
            limit: 100
          })
        : [];
    return {
      body: addPreviewBanner(entry, renderDynamicNovelSeries(route, row, body, chapters)),
      canonicalPath: dynamicCanonicalPath(route),
      description: firstPlainSummary([entry.description, entry.excerpt], 260),
      lang: entry.locale,
      robots: 'noindex, nofollow',
      title: `[Preview] ${entry.title}`
    };
  }

  const storedSeries = entry.parentSlug
    ? await getAnyPreviewContentEntry(env, {
        entryType: 'novel_series',
        locale: entry.locale,
        slug: entry.parentSlug
      })
    : null;
  const series =
    storedSeries ||
    contentPreviewRowFromEntry({
      ...entry,
      accessLevel: 'free',
      authorName: entry.authorName,
      chapterNumber: null,
      description: `Preview parent series for ${entry.parentSlug || entry.slug}.`,
      excerpt: '',
      parentSlug: '',
      slug: entry.parentSlug || 'preview-series',
      sortOrder: 0,
      subtitle: '',
      title: entry.parentSlug || 'Preview Series',
      wordCount: 0
    });
  const storedChapters =
    env.WAITLIST_DB && entry.parentSlug && (await ensureContentTablesReady(env.WAITLIST_DB))
      ? await listPublishedContentEntries(env.WAITLIST_DB, {
          entryType: 'novel_chapter',
          locale: entry.locale,
          parentSlug: entry.parentSlug,
          limit: 100
        })
      : [];
  const chapters = mergePreviewChapter(storedChapters, row);

  return {
    body: addPreviewBanner(entry, renderDynamicNovelChapter(route, series, row, body, chapters, getStaticSeriesPaymentSettings(series.slug, env))),
    canonicalPath: dynamicCanonicalPath(route),
    description: firstPlainSummary([entry.description, entry.excerpt], 260),
    lang: entry.locale,
    robots: 'noindex, nofollow',
    title: `[Preview] ${entry.title} | ${series.title}`
  };
};

const handleAdminContentPreview = async (request, env) => {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return privateJson({ ok: false, code: 'INVALID_JSON', message: 'Invalid request body.' }, { status: 400 });
  }

  const markdownLength = typeof payload.markdown === 'string' ? payload.markdown.length : 0;
  const htmlLength = typeof payload.html === 'string' ? payload.html.length : 0;
  if (markdownLength > 2_000_000 || htmlLength > 2_000_000) {
    return privateJson({ ok: false, code: 'CONTENT_PREVIEW_TOO_LARGE', message: 'Preview content is too large.' }, { status: 413 });
  }

  let entry;
  try {
    entry = normalizeContentPayload(payload);
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'CONTENT_PREVIEW_INVALID', message: error.message }, { status: 400 });
  }

  try {
    return withPrivateHeaders(
      dynamicHtmlResponse(request, await renderAdminContentPreview(entry, env), {
        headers: {
          'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';"
        }
      })
    );
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'CONTENT_PREVIEW_FAILED', message: error.message }, { status: 500 });
  }
};

const getPathWithLocale = (locale, routeName) => {
  const segment = localePathSegments[locale];
  if (routeName === 'works' && locale === 'en') return '/works/';
  if (routeName === 'devlog' && locale === 'zh-Hant') return '/devlog/';
  if (routeName === 'signal' && locale === 'zh-Hant') return '/signal/';
  return `/${segment}/${routeName}/`;
};

const parseDynamicContentRoute = (pathname) => {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const segments = normalizedPath.split('/').filter(Boolean);
  if (!segments.length) return null;

  let locale = null;
  let offset = 0;
  let hasLocalePrefix = false;
  if (pathSegmentLocales[segments[0]]) {
    locale = pathSegmentLocales[segments[0]];
    offset = 1;
    hasLocalePrefix = true;
  }

  const section = segments[offset];
  if (section === 'devlog') {
    locale = locale || 'zh-Hant';
    return {
      basePath: getPathWithLocale(locale, 'devlog'),
      kind: segments[offset + 1] ? 'devlog-post' : 'devlog-index',
      locale,
      slug: cleanSlug(segments[offset + 1] || '', 160)
    };
  }

  if (section === 'novel') {
    locale = locale || 'zh-Hant';
    if (hasLocalePrefix && locale !== defaultNovelTranslationTargetLocale) return null;
    const seriesSlug = cleanSlug(segments[offset + 1] || '', 160);
    const chapterSegment = segments[offset + 2];
    const chapterSlug = cleanSlug(segments[offset + 3] || '', 160);
    const segmentCount = segments.length - offset;
    const baseRoute = {
      basePath: hasLocalePrefix ? novelV2BasePathForLocale(locale) : '/novel/',
      chapterSlug: '',
      locale,
      readerVersion: 'v2',
      seriesSlug: ''
    };

    if (segmentCount === 1) {
      return {
        ...baseRoute,
        kind: 'novel-index'
      };
    }

    if (segmentCount === 2 && seriesSlug) {
      return {
        ...baseRoute,
        kind: 'novel-series',
        seriesSlug
      };
    }

    if (segmentCount === 4 && seriesSlug && chapterSegment === 'chapter' && chapterSlug) {
      return {
        ...baseRoute,
        chapterPathSegment: 'chapter',
        chapterSlug,
        kind: 'novel-chapter',
        seriesSlug
      };
    }

    return null;
  }

  if (section === 'signal') {
    locale = locale || 'zh-Hant';
    const slug = cleanSlug(segments[offset + 1] || '', 160);
    const asset = cleanText(segments[offset + 2] || '', 80);
    const segmentCount = segments.length - offset;
    const baseRoute = {
      basePath: hasLocalePrefix ? getPathWithLocale(locale, 'signal') : '/signal/',
      kind: 'signal-index',
      locale,
      slug: ''
    };

    if (segmentCount === 1) return baseRoute;

    if (segmentCount === 2 && slug) {
      return {
        ...baseRoute,
        kind: 'signal-brief',
        slug
      };
    }

    if (segmentCount === 3 && slug && ['card.svg', 'share-card.svg'].includes(asset)) {
      return {
        ...baseRoute,
        asset,
        kind: 'signal-card',
        slug
      };
    }

    return null;
  }

  if (section === 'works') {
    locale = locale || 'en';
    const basePath = hasLocalePrefix ? getPathWithLocale(locale, 'works') : '/works/';
    const seriesSlug = cleanSlug(segments[offset + 1] || '', 160);
    const chapterSlug = cleanSlug(segments[offset + 2] || '', 160);
    const segmentCount = segments.length - offset;
    const baseRoute = {
      basePath,
      chapterSlug: '',
      kind: 'novel-index',
      locale,
      seriesSlug: ''
    };

    if (segmentCount === 1) return baseRoute;
    if (segmentCount === 2 && seriesSlug) {
      return {
        ...baseRoute,
        kind: 'novel-series',
        seriesSlug
      };
    }
    if (segmentCount === 3 && seriesSlug && chapterSlug) {
      return {
        ...baseRoute,
        chapterSlug,
        kind: 'novel-chapter',
        seriesSlug
      };
    }
    return null;
  }

  return null;
};

const formatContentDate = (value, locale) => {
  const raw = cleanText(value, 80);
  if (!raw) return '';
  const date = new Date(raw.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
};

const dynamicCanonicalPath = (route) => {
  if (route.kind === 'devlog-index') return route.basePath;
  if (route.kind === 'devlog-post') return `${route.basePath}${route.slug}/`;
  if (route.kind === 'novel-index') return route.basePath;
  if (route.kind === 'novel-series') return dynamicSeriesPath(route, route.seriesSlug);
  if (route.kind === 'novel-chapter') return dynamicChapterPath(route, route.seriesSlug, route.chapterSlug);
  if (route.kind === 'signal-index') return route.basePath;
  if (route.kind === 'signal-brief') return dynamicSignalPath(route, route.slug);
  if (route.kind === 'signal-card') return dynamicSignalCardPath(route, route.slug);
  return '/';
};

const dynamicSeriesPath = (route, seriesSlug) => `${route.basePath}${seriesSlug}/`;

const dynamicChapterPath = (route, seriesSlug, chapterSlug) => {
  const chapterPathSegment = route.chapterPathSegment || (route.readerVersion === 'v2' ? 'chapter' : '');
  return chapterPathSegment
    ? `${route.basePath}${seriesSlug}/${chapterPathSegment}/${chapterSlug}/`
    : `${route.basePath}${seriesSlug}/${chapterSlug}/`;
};

const dynamicSignalPath = (route, slug) => `${route.basePath}${slug}/`;
const dynamicSignalCardPath = (route, slug) => `${dynamicSignalPath(route, slug)}card.svg`;

const dynamicNavCopy = {
  en: {
    apps: 'Apps',
    devlog: 'Dev Blog',
    member: 'Member Center',
    serials: 'Serials',
    signal: 'Signal strip'
  },
  ja: {
    apps: 'Apps',
    devlog: '開発ログ',
    member: '会員センター',
    serials: '連載小説',
    signal: 'シグナル簡報'
  },
  'zh-Hant': {
    apps: 'Apps',
    devlog: '開發博客',
    member: '會員登入',
    serials: '連載小說',
    signal: '信號簡報'
  },
  'zh-Hans': {
    apps: 'Apps',
    devlog: '开发博客',
    member: '会员登录',
    serials: '连载小说',
    signal: '信号简报'
  }
};

const absoluteStationUrl = (path) => {
  const value = cleanText(path, 1000);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://wwwstationcat.org${value.startsWith('/') ? value : `/${value}`}`;
};

const dynamicHtmlShell = ({ body, canonicalPath, description, lang, ogImage = '', pageKind = '', robots = '', title }) => {
  const ogImageUrl = absoluteStationUrl(ogImage);
  const isSignalPage = pageKind === 'signal';
  const navCopy = dynamicNavCopy[lang] || dynamicNavCopy['zh-Hant'];
  const signalPageCopy = isSignalPage ? signalDesignCopy(lang) : null;
  const topbar = isSignalPage
    ? `<header class="signal-station-header">
        <div class="signal-station-header__inner">
          <a class="signal-station-brand" href="/">
            <span class="signal-station-brand__mark">SC</span>
            <span class="signal-station-brand__copy">
              <strong>STATION CAT</strong>
              <small>${escapeHtml(signalPageCopy.platformLabel)}</small>
            </span>
          </a>
          <nav class="signal-station-nav" aria-label="${escapeHtml(signalPageCopy.primaryNavigation)}">
            <a href="${escapeHtml(novelV2BasePathForLocale(lang))}">${escapeHtml(navCopy.serials)}</a>
            <a class="is-current" href="${escapeHtml(getPathWithLocale(lang, 'signal'))}" aria-current="page">${escapeHtml(navCopy.signal)}</a>
            <a href="/devlog/">${escapeHtml(navCopy.devlog)}</a>
            <a href="/apps/">${escapeHtml(navCopy.apps)}</a>
            <a href="/library/">${escapeHtml(navCopy.member)}</a>
            <a href="/about/">About</a>
            <a class="signal-station-nav__x" href="https://x.com/bketck">↗ X</a>
          </nav>
        </div>
      </header>`
    : `<header class="topbar">
        <a class="brand" href="/"><span>SC</span><span>Station Cat</span></a>
        <nav class="nav">
          <a href="${escapeHtml(novelV2BasePathForLocale(lang))}">${escapeHtml(navCopy.serials)}</a>
          <a href="${escapeHtml(getPathWithLocale(lang, 'signal'))}">${escapeHtml(navCopy.signal)}</a>
          <a href="/devlog/">${escapeHtml(navCopy.devlog)}</a>
          <a href="/apps/">${escapeHtml(navCopy.apps)}</a>
          <a href="/library/">${escapeHtml(navCopy.member)}</a>
          <a href="/about/">About</a>
          <a href="https://x.com/bketck">Follow on X</a>
        </nav>
      </header>`;
  const signalFooter = isSignalPage
    ? `<footer class="signal-station-footer">
        <div class="signal-station-footer__inner">
          <div class="signal-station-footer__brand">
            <span>SC</span>
            <p>© STATION CAT · ${escapeHtml(signalPageCopy.footerLabel)}</p>
          </div>
          <p>SIGNAL &gt; NOISE</p>
        </div>
      </footer>`
    : '';
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} | Station Cat</title>
    <meta name="description" content="${escapeHtml(description)}">
    ${robots ? `<meta name="robots" content="${escapeHtml(robots)}">` : ''}
    <link rel="canonical" href="https://wwwstationcat.org${escapeHtml(canonicalPath)}">
    <meta property="og:title" content="${escapeHtml(title)} | Station Cat">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="https://wwwstationcat.org${escapeHtml(canonicalPath)}">
    <meta property="og:site_name" content="Station Cat">
    ${ogImageUrl ? `<meta property="og:image" content="${escapeHtml(ogImageUrl)}">` : ''}
    <meta name="twitter:card" content="${ogImageUrl ? 'summary_large_image' : 'summary'}">
    <meta name="twitter:title" content="${escapeHtml(title)} | Station Cat">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    ${ogImageUrl ? `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">` : ''}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <style>
      :root { color-scheme: light; --bg: #fffaf4; --surface: #ffffff; --soft: #f5efe7; --ink: #1f2d29; --muted: #64736d; --line: #e4dbd0; --teal: #08796d; --coral: #d95d45; }
      * { box-sizing: border-box; }
      body { background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; margin: 0; }
      a { color: inherit; }
      .shell { margin: 0 auto; max-width: 1120px; padding: 28px 20px 72px; }
      .topbar { align-items: center; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 14px; justify-content: space-between; margin-bottom: 44px; padding: 16px 0; }
      .brand { align-items: center; display: inline-flex; font-weight: 900; gap: 10px; text-decoration: none; }
      .brand span:first-child { align-items: center; background: var(--ink); border-radius: 8px; color: #fff; display: inline-flex; height: 34px; justify-content: center; width: 34px; }
      .nav { display: flex; flex-wrap: wrap; gap: 12px; }
      .nav a, .text-link { color: var(--muted); font-size: 15px; font-weight: 800; text-decoration: none; }
      .nav a:hover, .text-link:hover { color: var(--teal); }
      .hero, .section { display: grid; gap: 18px; margin-bottom: 48px; }
      .hero--novel { align-items: center; grid-template-columns: minmax(0, 1fr) minmax(220px, 320px); }
      .hero--chapter { margin-left: auto; margin-right: auto; max-width: 820px; width: 100%; }
      .hero-copy { display: grid; gap: 18px; }
      .kicker { color: var(--teal); font-size: 12px; font-weight: 950; letter-spacing: .08em; margin: 0; text-transform: uppercase; }
      h1, h2, h3 { color: var(--ink); line-height: 1.08; margin: 0; text-wrap: balance; }
      h1 { font-size: clamp(36px, 7vw, 72px); max-width: 920px; }
      h2 { font-size: clamp(28px, 4vw, 42px); }
      h3 { font-size: 22px; }
      p { color: var(--muted); font-size: 17px; line-height: 1.75; margin: 0; overflow-wrap: anywhere; }
      .meta { color: var(--muted); display: flex; flex-wrap: wrap; font-size: 14px; font-weight: 800; gap: 10px; }
      .pill { background: var(--soft); border: 1px solid var(--line); border-radius: 999px; color: var(--ink); padding: 7px 10px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .card, .panel, .gate { background: rgba(255,255,255,.72); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 18px 50px rgba(44,39,33,.08); display: grid; gap: 12px; padding: 18px; }
      .card { text-decoration: none; }
      .card:hover { border-color: rgba(8,121,109,.35); transform: translateY(-1px); }
      .chapter-list-shell { display: grid; gap: 14px; }
      .chapter-list { gap: 10px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      .chapter-card { gap: 7px; min-height: 0; padding: 12px 14px; }
      .chapter-card[hidden] { display: none !important; }
      .chapter-card .meta { align-items: center; gap: 6px; }
      .chapter-card .pill { padding: 5px 8px; }
      .chapter-card h3 { font-size: 18px; line-height: 1.25; }
      .chapter-card p { display: -webkit-box; font-size: 14px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
      .chapter-pagination { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
      .chapter-pagination__button { align-items: center; background: rgba(255,255,255,.72); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); cursor: pointer; display: inline-flex; font: inherit; font-size: 14px; font-weight: 900; height: 34px; justify-content: center; min-width: 34px; padding: 0 10px; }
      .chapter-pagination__button:hover, .chapter-pagination__button:focus-visible, .chapter-pagination__button.is-active { background: var(--teal); border-color: var(--ink); color: #fffaf1; }
      .hero-cover { aspect-ratio: 16 / 10; background: var(--soft); border: 1px solid var(--line); border-radius: 14px; margin: 6px 0 0; max-width: 780px; overflow: hidden; }
      .hero-cover--book { aspect-ratio: 2 / 3; border-radius: 10px; box-shadow: 0 18px 44px rgba(23, 30, 27, .18); margin: 0; max-width: 320px; width: 100%; }
      .hero-cover img { display: block; height: 100%; object-fit: cover; width: 100%; }
      .button-row { display: flex; flex-wrap: wrap; gap: 10px; }
      .button { align-items: center; border: 1px solid var(--ink); border-radius: 8px; display: inline-flex; font-weight: 900; justify-content: center; min-height: 44px; padding: 10px 14px; text-decoration: none; }
      .button-primary { background: var(--ink); color: #fff; }
      .button-secondary { background: #fff; color: var(--ink); }
      .prose { background: rgba(255,255,255,.68); border: 1px solid var(--line); border-radius: 16px; display: grid; gap: 18px; padding: clamp(20px, 4vw, 42px); }
      .prose h1 { font-size: 34px; }
      .prose h2 { font-size: 28px; margin-top: 12px; }
      .prose h3 { font-size: 22px; margin-top: 8px; }
      .prose p { color: #283631; overflow-wrap: break-word; }
      .prose ul { display: grid; gap: 8px; margin: 0; padding-left: 22px; }
      .prose li { color: var(--muted); font-size: 17px; line-height: 1.75; }
      .prose--reader { margin-left: auto; margin-right: auto; max-width: 760px; width: 100%; }
      .prose--reader p { font-size: clamp(18px, 4.5vw, 20px); line-height: 1.95; }
      .prose--reader [id^="sc-bookmark-block-"] { scroll-margin-top: 24px; }
      .prose--protected { opacity: 0; transform: translateY(8px); transition: opacity 180ms ease, transform 180ms ease; }
      .prose--protected.prose--ready { opacity: 1; transform: translateY(0); }
      .status { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; color: var(--muted); font-size: 15px; font-weight: 800; padding: 12px; }
      .status[data-tone="success"] { border-color: rgba(8,121,109,.32); color: var(--teal); }
      .status[data-tone="error"] { border-color: rgba(217,93,69,.4); color: var(--coral); }
      .reader-interactions { background: #fffaf1; border: 1px solid var(--line); border-radius: 14px; box-shadow: 4px 4px 0 rgba(34,27,22,.08); display: grid; gap: 16px; margin-bottom: 18px; padding: 18px; }
      .reader-interactions h2 { font-size: 24px; margin: 0 0 6px; }
      .reader-interactions p { color: var(--muted); margin: 0; }
      .reader-interactions [aria-pressed="true"] { background: var(--teal); border-color: var(--ink); color: #fffaf1; }
      .reader-comment-panel { display: grid; gap: 8px; }
      .reader-comment-panel[hidden] { display: none; }
      .reader-comment-panel label { color: var(--teal); font-size: 13px; font-weight: 900; text-transform: uppercase; }
      .reader-comment-panel textarea { background: #fff; border: 1px solid var(--line); border-radius: 12px; color: var(--ink); font: inherit; line-height: 1.7; min-height: 112px; padding: 12px; resize: vertical; }
      .reader-comments { display: grid; gap: 10px; }
      .reader-comments h3 { font-size: 18px; margin: 0; }
      .reader-comments-list { display: grid; gap: 10px; }
      .reader-comment-item { background: rgba(255,255,255,.74); border: 1px solid var(--line); border-radius: 12px; display: grid; gap: 8px; padding: 12px; }
      .reader-comment-item div { align-items: baseline; display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
      .reader-comment-item time { color: var(--muted); font-size: 12px; font-weight: 800; }
      .reader-comment-item p { color: var(--ink); line-height: 1.7; }
      .reader-bookmark-fab, .reader-bookmark-toast { display: none; }
      .reader-bookmark-toast { background: rgba(255,255,255,.96); border-color: rgba(8,121,109,.32); box-shadow: 0 18px 50px rgba(44,39,33,.12); color: var(--ink); font-weight: 900; left: max(16px, env(safe-area-inset-left)); position: fixed; right: max(16px, env(safe-area-inset-right)); text-align: center; z-index: 50; }
      @keyframes sc-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes sc-blink { 0%, 60% { opacity: 1; } 61%, 100% { opacity: .25; } }
      .signal-page { --signal-paper: oklch(.955 .009 88); --signal-card: oklch(.985 .006 88); --signal-ink: oklch(.22 .012 60); --signal-muted: oklch(.5 .02 60); --signal-copy: oklch(.36 .012 60); --signal-amber: oklch(.66 .14 55); --signal-green: oklch(.62 .12 155); --signal-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Hiragino Sans", "Microsoft JhengHei", sans-serif; --signal-serif: ui-serif, "Iowan Old Style", "Songti TC", "Hiragino Mincho ProN", Georgia, serif; --signal-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; background: linear-gradient(oklch(.22 .012 60 / .035) 1px, transparent 1px) 0 0 / 100% 26px, var(--signal-paper); color: var(--signal-ink); font-family: var(--signal-sans); }
      .signal-page a { color: inherit; }
      .signal-page ::selection { background: oklch(.66 .14 55 / .28); }
      .signal-shell { margin: 0; max-width: none; padding: 0; }
      .signal-station-header { background: oklch(.955 .009 88 / .9); backdrop-filter: blur(10px); border-bottom: 1.5px solid var(--signal-ink); position: sticky; top: 0; z-index: 50; }
      .signal-station-header__inner { align-items: center; display: flex; gap: 24px; height: 64px; justify-content: space-between; margin: 0 auto; max-width: 1120px; padding: 0 24px; }
      .signal-station-brand { align-items: center; display: inline-flex; gap: 12px; text-decoration: none; }
      .signal-station-brand__mark { background: var(--signal-ink); color: var(--signal-paper); display: grid; font-family: var(--signal-mono); font-size: 14px; font-weight: 700; height: 34px; letter-spacing: 0; place-items: center; width: 34px; }
      .signal-station-brand__copy { display: flex; flex-direction: column; line-height: 1; }
      .signal-station-brand__copy strong { font-family: var(--signal-mono); font-size: 13px; letter-spacing: 0; }
      .signal-station-brand__copy small { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 9.5px; letter-spacing: 0; margin-top: 3px; }
      .signal-station-nav { align-items: center; display: flex; flex-wrap: wrap; font-size: 13.5px; gap: 4px; }
      .signal-station-nav a { padding: 7px 11px; text-decoration: none; }
      .signal-station-nav a:hover, .signal-station-nav a:focus-visible { color: var(--signal-amber); }
      .signal-station-nav a.is-current { background: var(--signal-ink); color: var(--signal-paper); }
      .signal-station-nav__x { border: 1.5px solid var(--signal-ink); font-family: var(--signal-mono); font-size: 12px; margin-left: 6px; }
      .signal-index-hero { margin: 0 auto; max-width: 1120px; padding: 72px 24px 40px; }
      .signal-index-hero__label { align-items: center; display: flex; gap: 12px; margin-bottom: 26px; }
      .signal-index-hero__lamp { animation: sc-blink 1.6s steps(1) infinite; background: var(--signal-amber); border-radius: 50%; height: 9px; width: 9px; }
      .signal-index-hero__label strong { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 12px; font-weight: 500; letter-spacing: 0; }
      .signal-index-hero__dash { background: repeating-linear-gradient(90deg, var(--signal-ink) 0 6px, transparent 6px 12px); flex: 1; height: 1.5px; }
      .signal-index-hero h1 { font-family: var(--signal-serif); font-size: 104px; font-weight: 900; letter-spacing: 0; line-height: .98; margin: 0 0 26px; }
      .signal-index-hero > p { color: oklch(.38 .012 60); font-size: 18px; line-height: 1.75; max-width: 640px; }
      .signal-ticker { background: var(--signal-ink); border-bottom: 1.5px solid var(--signal-ink); border-top: 1.5px solid var(--signal-ink); overflow: hidden; }
      .signal-ticker__track { animation: sc-ticker 42s linear infinite; display: flex; padding: 11px 0; width: max-content; will-change: transform; }
      .signal-ticker__track span { color: oklch(.9 .01 88); font-family: var(--signal-mono); font-size: 13px; letter-spacing: 0; white-space: nowrap; }
      .signal-intro, .signal-feed { margin: 0 auto; max-width: 1120px; padding-left: 24px; padding-right: 24px; }
      .signal-intro { align-items: end; display: grid; gap: 40px; grid-template-columns: 1fr 1fr; padding-bottom: 30px; padding-top: 56px; }
      .signal-intro h2 { font-family: var(--signal-serif); font-size: 38px; font-weight: 700; line-height: 1.15; margin: 0 0 14px; }
      .signal-intro p { color: oklch(.42 .012 60); font-size: 15.5px; line-height: 1.7; max-width: 440px; }
      .signal-intro__stats { display: flex; flex-wrap: wrap; gap: 20px; justify-content: flex-end; }
      .signal-stat { min-width: 128px; text-align: right; }
      .signal-stat + .signal-stat { border-left: 1.5px solid var(--signal-ink); padding-left: 20px; }
      .signal-stat strong { display: block; font-family: var(--signal-mono); font-size: 34px; line-height: 1; }
      .signal-stat:first-child strong { color: var(--signal-amber); }
      .signal-stat span { color: var(--signal-muted); display: block; font-family: var(--signal-mono); font-size: 10.5px; letter-spacing: 0; margin-top: 8px; }
      .signal-feed { padding-bottom: 24px; }
      .signal-feed__heading { align-items: end; border-bottom: 2.5px solid var(--signal-ink); display: flex; gap: 12px; margin-bottom: 30px; padding-bottom: 12px; }
      .signal-feed__heading h2 { font-family: var(--signal-serif); font-size: 22px; font-weight: 700; }
      .signal-feed__heading span { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 11px; letter-spacing: 0; }
      .signal-feed__heading span:last-child { margin-left: auto; }
      .signal-feed__list { display: flex; flex-direction: column; gap: 30px; }
      .signal-tape-card { --signal-accent: var(--signal-amber); background: var(--signal-card); border: 1.5px solid var(--signal-ink); box-shadow: 5px 6px 0 oklch(.22 .012 60 / .14); color: var(--signal-ink); display: grid; grid-template-columns: 44px minmax(0, 1fr); position: relative; text-decoration: none; transition: box-shadow .15s ease, transform .15s ease; }
      .signal-tape-card::before { border-top: 2px dotted oklch(.22 .012 60 / .4); content: ""; left: 14px; position: absolute; right: 14px; top: 8px; }
      .signal-tape-card:hover, .signal-tape-card:focus-visible { box-shadow: 8px 10px 0 oklch(.66 .14 55 / .55); color: inherit; transform: translate(-2px, -2px); }
      .signal-tape-card--general, .signal-tape-card--economy, .signal-tape-card--market { --signal-accent: var(--signal-green); }
      .signal-tape-card__spine { background: radial-gradient(circle, oklch(.22 .012 60 / .22) 2.5px, transparent 3px) 50% 8px / 16px 22px repeat-y; border-right: 1.5px dashed oklch(.22 .012 60 / .35); }
      .signal-tape-card__body { padding: 24px 26px 24px; }
      .signal-dispatch-meta { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 13px; }
      .signal-category-chip { align-items: center; border: 1.5px solid var(--signal-ink); border-left: 4px solid var(--signal-accent); display: inline-flex; font-family: var(--signal-mono); font-size: 11px; font-weight: 700; gap: 7px; letter-spacing: 0; padding: 4px 10px 4px 8px; }
      .signal-category-chip strong { color: var(--signal-accent); }
      .signal-code, .signal-date, .signal-weekday { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 11.5px; letter-spacing: 0; }
      .signal-date { color: oklch(.4 .012 60); font-size: 12px; margin-left: auto; }
      .signal-tape-card h3 { font-family: var(--signal-serif); font-size: 29px; font-weight: 700; line-height: 1.25; margin: 0 0 10px; }
      .signal-tape-card__summary { color: var(--signal-copy); font-size: 15px; line-height: 1.7; max-width: 66ch; }
      .signal-tape-list { background: oklch(.955 .009 88 / .58); border: 1px solid oklch(.22 .012 60 / .14); display: flex; flex-direction: column; gap: 9px; list-style: none; margin: 16px 0 0; padding: 14px 18px; }
      .signal-tape-list li { align-items: baseline; color: oklch(.3 .012 60); display: flex; font-size: 14.5px; gap: 10px; line-height: 1.55; }
      .signal-tape-list li span { color: var(--signal-accent); font-family: var(--signal-mono); font-size: 11.5px; font-weight: 700; min-width: 20px; }
      .signal-tape-list li.signal-tape-list__more { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 11.5px; }
      .signal-tape-card__footer { align-items: center; display: flex; gap: 14px; margin-top: 18px; }
      .signal-read-more { font-family: var(--signal-mono); font-size: 13px; font-weight: 700; }
      .signal-strength-label { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 10px; letter-spacing: 0; margin-left: auto; }
      .signal-strength { align-items: flex-end; display: inline-flex; gap: 3px; height: 16px; }
      .signal-strength i { background: oklch(.22 .012 60 / .15); display: block; width: 5px; }
      .signal-strength i:nth-child(1) { height: 40%; } .signal-strength i:nth-child(2) { height: 62%; } .signal-strength i:nth-child(3) { height: 84%; } .signal-strength i:nth-child(4) { height: 100%; }
      .signal-strength[data-level="1"] i:nth-child(-n+1), .signal-strength[data-level="2"] i:nth-child(-n+2), .signal-strength[data-level="3"] i:nth-child(-n+3), .signal-strength[data-level="4"] i:nth-child(-n+4) { background: var(--signal-accent); }
      .signal-empty { border: 1.5px dashed oklch(.22 .012 60 / .3); color: var(--signal-muted); font-family: var(--signal-mono); padding: 28px; }
      .signal-detail-back { margin: 0 auto; max-width: 820px; padding: 26px 24px 0; }
      .signal-detail-back a { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 12px; letter-spacing: 0; text-decoration: none; }
      .signal-dispatch { --signal-accent: var(--signal-amber); margin: 0 auto; max-width: 820px; padding: 22px 24px 0; }
      .signal-dispatch--general, .signal-dispatch--economy, .signal-dispatch--market { --signal-accent: var(--signal-green); }
      .signal-dispatch__masthead h1 { font-family: var(--signal-serif); font-size: 58px; font-weight: 900; letter-spacing: 0; line-height: 1.08; margin: 0 0 22px; }
      .signal-dispatch__lede { color: oklch(.35 .012 60); font-size: 18px; line-height: 1.75; margin-bottom: 26px; max-width: 64ch; }
      .signal-dispatch__stats { align-items: center; border-bottom: 1.5px solid var(--signal-ink); border-top: 1.5px solid var(--signal-ink); display: flex; gap: 16px; padding: 16px 0; }
      .signal-dispatch__stats > span:first-child { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 11px; letter-spacing: 0; }
      .signal-dispatch__items { margin-top: 8px; position: relative; }
      .signal-item { display: grid; grid-template-columns: 56px minmax(0, 1fr); position: relative; }
      .signal-item__rail { padding-top: 34px; position: relative; }
      .signal-item__rail::after { background: repeating-linear-gradient(var(--signal-ink) 0 5px, transparent 5px 11px); bottom: 0; content: ""; left: 19px; opacity: .35; position: absolute; top: 0; width: 1.5px; z-index: 1; }
      .signal-item__number { background: var(--signal-paper); border: 1.5px solid var(--signal-ink); color: var(--signal-accent); display: grid; font-family: var(--signal-mono); font-size: 14px; font-weight: 700; height: 38px; place-items: center; position: relative; width: 38px; z-index: 2; }
      .signal-item__body { padding: 34px 0 22px 6px; }
      .signal-item__body h2 { font-family: var(--signal-serif); font-size: 26px; font-weight: 700; line-height: 1.3; margin: 0 0 12px; }
      .signal-item__copy { color: oklch(.34 .012 60); font-size: 15.5px; line-height: 1.78; margin-bottom: 16px; max-width: 60ch; }
      .signal-analysis { background: oklch(.22 .012 60 / .14); border: 1px solid oklch(.22 .012 60 / .14); display: grid; gap: 1.5px; grid-template-columns: 1fr 1fr; margin-bottom: 16px; }
      .signal-analysis__cell { background: var(--signal-card); padding: 13px 15px; }
      .signal-analysis__label { color: var(--signal-accent); font-family: var(--signal-mono); font-size: 10px; letter-spacing: 0; margin-bottom: 7px; }
      .signal-analysis__cell:last-child .signal-analysis__label { color: var(--signal-muted); }
      .signal-analysis__text { color: oklch(.3 .012 60); font-size: 13.5px; line-height: 1.6; }
      .signal-analysis__cell:last-child .signal-analysis__text { color: oklch(.45 .012 60); }
      .signal-item__source { color: var(--signal-muted); display: inline-flex; font-family: var(--signal-mono); font-size: 11.5px; gap: 7px; letter-spacing: 0; text-decoration: none; }
      .signal-item__source:hover { color: var(--signal-accent); }
      .signal-dispatch__fallback { background: var(--signal-card); border: 1.5px solid var(--signal-ink); padding: 24px; }
      .signal-dispatch__fallback h1, .signal-dispatch__fallback h2, .signal-dispatch__fallback h3 { font-family: var(--signal-serif); }
      .signal-dispatch__fallback p { color: var(--signal-copy); font-size: 15.5px; line-height: 1.78; }
      .signal-share-strip { align-items: center; border-top: 2px dotted oklch(.22 .012 60 / .4); display: flex; flex-wrap: wrap; gap: 14px; margin-top: 16px; padding-top: 24px; }
      .signal-share-strip > span { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 12px; letter-spacing: 0; margin-right: auto; }
      .signal-share-button { background: transparent; border: 1.5px solid var(--signal-ink); color: var(--signal-ink); cursor: pointer; font-family: var(--signal-mono); font-size: 12px; font-weight: 700; padding: 9px 16px; text-decoration: none; }
      .signal-share-button:hover, .signal-share-button:focus-visible { background: var(--signal-ink); color: var(--signal-paper); }
      .signal-adjacent { margin: 40px auto 0; max-width: 820px; padding: 0 24px; }
      .signal-adjacent__grid { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; }
      .signal-adjacent__card { border: 1.5px solid var(--signal-ink); display: flex; flex-direction: column; gap: 8px; min-height: 104px; padding: 18px 20px; text-decoration: none; }
      .signal-adjacent__card:hover, .signal-adjacent__card:focus-visible { box-shadow: 5px 6px 0 oklch(.22 .012 60 / .14); color: inherit; }
      .signal-adjacent__card small { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 11px; letter-spacing: 0; }
      .signal-adjacent__card strong { font-family: var(--signal-serif); font-size: 17px; line-height: 1.35; }
      .signal-adjacent__card--next { align-items: flex-end; text-align: right; }
      .signal-adjacent__empty { border: 1.5px dashed oklch(.22 .012 60 / .3); color: var(--signal-muted); display: flex; flex-direction: column; gap: 8px; justify-content: center; min-height: 104px; padding: 18px 20px; }
      .signal-adjacent__empty:last-child { align-items: flex-end; text-align: right; }
      .signal-adjacent__empty small { font-family: var(--signal-mono); font-size: 11px; letter-spacing: 0; }
      .signal-adjacent__empty strong { font-family: var(--signal-serif); font-size: 16px; font-weight: 500; }
      .signal-station-footer { border-top: 1.5px solid var(--signal-ink); margin-top: 56px; }
      .signal-station-footer__inner { align-items: center; display: flex; flex-wrap: wrap; gap: 20px; justify-content: space-between; margin: 0 auto; max-width: 1120px; padding: 34px 24px; }
      .signal-station-footer__brand { align-items: center; display: flex; gap: 12px; }
      .signal-station-footer__brand span { background: var(--signal-ink); color: var(--signal-paper); display: grid; font-family: var(--signal-mono); font-size: 12px; font-weight: 700; height: 28px; place-items: center; width: 28px; }
      .signal-station-footer p { color: var(--signal-muted); font-family: var(--signal-mono); font-size: 11px; letter-spacing: 0; }
      .signal-section-heading { border-top: 1px dashed var(--line); color: var(--ink); font-size: 30px; padding-top: 18px; }
      @media (max-width: 760px) {
        .shell { padding: 18px 14px 96px; }
        .grid, .hero--novel { grid-template-columns: 1fr; }
        .chapter-list { gap: 8px; }
        .chapter-card { padding: 12px; }
        .chapter-pagination { justify-content: flex-start; }
        .topbar { align-items: flex-start; flex-direction: column; margin-bottom: 28px; }
        .hero-cover--book { justify-self: center; max-width: 240px; }
        .button-row { align-items: stretch; flex-direction: column; }
        .button { width: 100%; }
        .prose { border-radius: 10px; padding: 18px 16px; }
        .reader-bookmark-fab { bottom: calc(16px + env(safe-area-inset-bottom)); display: inline-flex; left: auto; min-width: 132px; position: fixed; right: max(16px, env(safe-area-inset-right)); width: auto; z-index: 51; }
        .reader-bookmark-toast { bottom: calc(76px + env(safe-area-inset-bottom)); display: block; }
        .reader-bookmark-toast[hidden] { display: none; }
        .signal-station-header__inner { align-items: flex-start; height: auto; padding-bottom: 10px; padding-top: 10px; }
        .signal-station-brand__copy { display: none; }
        .signal-station-nav { justify-content: flex-end; }
        .signal-station-nav a { font-size: 12px; padding: 6px 7px; }
        .signal-station-nav a:nth-child(3), .signal-station-nav a:nth-child(6) { display: none; }
        .signal-index-hero { padding-top: 50px; }
        .signal-index-hero h1 { font-size: 72px; }
        .signal-intro h2 { font-size: 32px; }
        .signal-tape-card h3 { font-size: 25px; }
        .signal-dispatch__masthead h1 { font-size: 44px; }
        .signal-item__body h2 { font-size: 23px; }
        .signal-section-heading { font-size: 25px; }
        .signal-intro { grid-template-columns: 1fr; }
        .signal-intro__stats { justify-content: flex-start; }
        .signal-stat { text-align: left; }
        .signal-tape-card { grid-template-columns: 30px minmax(0, 1fr); }
        .signal-tape-card__body { padding: 24px 18px 20px; }
        .signal-date { margin-left: 0; }
        .signal-analysis { grid-template-columns: 1fr; }
        .signal-adjacent__grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 520px) {
        .signal-station-header__inner { gap: 10px; padding-left: 14px; padding-right: 14px; }
        .signal-station-nav a:nth-child(4), .signal-station-nav a:nth-child(5) { display: none; }
        .signal-index-hero, .signal-intro, .signal-feed, .signal-detail-back, .signal-dispatch, .signal-adjacent { padding-left: 16px; padding-right: 16px; }
        .signal-feed__heading span:nth-child(2) { display: none; }
        .signal-tape-card__spine { background-size: 12px 20px; }
        .signal-dispatch-meta { gap: 8px; }
        .signal-weekday { display: none; }
        .signal-item { grid-template-columns: 46px minmax(0, 1fr); }
        .signal-item__body { padding-left: 2px; }
        .signal-share-button { flex: 1 1 auto; text-align: center; }
        .signal-index-hero h1 { font-size: 54px; }
        .signal-dispatch__masthead h1 { font-size: 36px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .signal-index-hero__lamp, .signal-ticker__track { animation: none; }
        .signal-tape-card { transition: none; }
      }
    </style>
  </head>
  <body class="${isSignalPage ? 'signal-page' : ''}">
    ${topbar}
    <main class="shell${isSignalPage ? ' signal-shell' : ''}">
      ${body}
    </main>
    ${signalFooter}
  </body>
</html>`;
};

const dynamicHtmlResponse = (request, payload, init = {}) =>
  new Response(request.method === 'HEAD' ? null : dynamicHtmlShell(payload), {
    ...init,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      ...(init.headers || {})
    }
  });

const renderDynamicCover = (entry, options = {}) => {
  const url = contentMediaUrl(entry.cover_r2_key);
  if (!url) return '';
  const alt = entry.cover_alt || `${entry.title} cover`;
  const variantClass = options.variant === 'book' ? ' hero-cover--book' : '';
  return `<figure class="hero-cover${variantClass}">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="eager" />
    </figure>`;
};

const renderDynamicDevlogPost = (route, post, body) => {
  const copy = dynamicContentCopy[route.locale];
  const summary = firstPlainSummary([post.description, post.excerpt], 420);
  const fallbackBody = firstPlainSummary([post.excerpt, post.description], 1200);
  return `<article class="section">
      <a class="text-link" href="${escapeHtml(route.basePath)}">${escapeHtml(copy.backDevlog)}</a>
      <header class="hero">
        <div class="meta">
          <span class="pill">${escapeHtml(formatContentDate(post.published_at || post.updated_at, route.locale))}</span>
          <span>${escapeHtml(dynamicContentStatusLabels[post.status] || post.status)}</span>
        </div>
        <h1>${escapeHtml(post.title)}</h1>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
        ${renderDynamicCover(post)}
      </header>
      <div class="prose">${body.html || `<p>${escapeHtml(fallbackBody)}</p>`}</div>
    </article>`;
};

const signalCategoryLabels = {
  ai: 'AI',
  economy: 'Economy',
  general: 'General',
  market: 'Markets',
  research: 'Research',
  tech: 'Tech'
};

const signalCategoryLabelsByLocale = {
  en: signalCategoryLabels,
  ja: {
    ai: 'AI',
    economy: '経済',
    general: '総合',
    market: '市場',
    research: '研究',
    tech: 'テック'
  },
  'zh-Hant': {
    ai: 'AI',
    economy: '經濟',
    general: '綜合',
    market: '市場',
    research: '研究',
    tech: '科技'
  },
  'zh-Hans': {
    ai: 'AI',
    economy: '经济',
    general: '综合',
    market: '市场',
    research: '研究',
    tech: '科技'
  }
};

const normalizeSignalCategory = (value) => {
  const category = cleanText(value || 'general', 40).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return signalCategoryLabels[category] ? category : 'general';
};

const signalCategoryLabel = (category, locale) =>
  signalCategoryLabelsByLocale[locale]?.[normalizeSignalCategory(category)] ||
  signalCategoryLabels[normalizeSignalCategory(category)] ||
  'Signal';

const signalBriefMetadata = (row) => {
  const metadata = parseStoredJson(row.metadata_json, {});
  let summaryBullets = Array.isArray(metadata.summaryBullets)
    ? metadata.summaryBullets.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, signalSummaryMaxItems)
    : [];
  if (row.signalMarkdown) {
    const markdownBullets = extractSignalSummaryBullets({}, row.signalMarkdown);
    const seen = new Set(summaryBullets.map((item) => normalizeSignalCardBullet(item)));
    for (const item of markdownBullets) {
      const normalized = normalizeSignalCardBullet(item);
      if (!normalized || seen.has(normalized)) continue;
      summaryBullets.push(item);
      seen.add(normalized);
      if (summaryBullets.length >= signalSummaryMaxItems) break;
    }
  }
  const sources = Array.isArray(metadata.sources)
    ? metadata.sources
        .map((source) => ({
          label: cleanText(source?.label || source?.title || normalizeSignalSourceUrl(source?.url), 160),
          note: cleanText(source?.note || source?.description, 240),
          url: normalizeSignalSourceUrl(source?.url)
        }))
        .filter((source) => source.label || source.url)
        .slice(0, 12)
    : [];

  return {
    briefDate: cleanText(metadata.briefDate || row.published_at || row.updated_at, 80),
    category: normalizeSignalCategory(metadata.category || row.subtitle),
    issue: cleanText(metadata.issue, 80),
    sources,
    summaryBullets
  };
};

const signalDesignCopyByLocale = {
  en: {
    adjacentNavigation: 'Adjacent Signal briefs',
    briefsLabel: 'briefs · BRIEFS',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    dispatches: 'RECENT DISPATCHES',
    footerLabel: 'PLATFORM DISPATCH',
    heroAction: 'Tear off, read, and pass it on.',
    introDescription: 'Each day, we turn the public signals worth noticing into a card you can tear off and share. Signal first, noise behind.',
    introTitle: 'Technology · Economy · AI',
    latest: 'Latest update',
    moreSignals: (count) => `${count} more signals`,
    newestFirst: '↓ Newest first',
    platform: 'Platform dispatch',
    platformLabel: 'PLATFORM',
    primaryNavigation: 'Primary navigation',
    signalCount: 'SIGNALS',
    signalLabel: '▲ SIGNAL',
    signalStrength: 'Signal strength',
    signalTotal: (count) => `${count} signals · ${count} SIGNALS`,
    tickerLabel: 'Latest Signal headlines',
    noiseLabel: '▽ NOISE',
    source: 'SOURCE',
    tear: 'Tear off this strip —',
    previous: '← Previous',
    next: 'Next →',
    oldest: 'This is the earliest brief',
    newest: 'This is the latest brief'
  },
  ja: {
    adjacentNavigation: '前後の Signal 簡報',
    briefsLabel: '件の簡報 · BRIEFS',
    copied: 'コピーしました',
    copyFailed: 'コピーできませんでした',
    dispatches: 'RECENT DISPATCHES',
    footerLabel: 'ホーム通信',
    heroAction: '切り取り、読み、手渡す。',
    introDescription: '毎日注目すべき公開シグナルを、切り取って共有できる一枚のカードにまとめます。シグナルを前に、ノイズを後ろに。',
    introTitle: 'テクノロジー · 経済 · AI',
    latest: '最新更新',
    moreSignals: (count) => `ほか ${count} 件のシグナル`,
    newestFirst: '↓ 新しい順',
    platform: 'ホーム通信',
    platformLabel: 'プラットフォーム',
    primaryNavigation: 'メインナビゲーション',
    signalCount: 'SIGNALS',
    signalLabel: '▲ シグナル',
    signalStrength: 'シグナル強度',
    signalTotal: (count) => `${count} 件のシグナル · ${count} SIGNALS`,
    tickerLabel: '最新の Signal 見出し',
    noiseLabel: '▽ ノイズ',
    source: '出典',
    tear: 'この紙帯を切り取る ——',
    previous: '← 前の簡報',
    next: '次の簡報 →',
    oldest: '最初の簡報です',
    newest: '最新の簡報です'
  },
  'zh-Hant': {
    adjacentNavigation: '相鄰 Signal 簡報',
    briefsLabel: '份簡報 · BRIEFS',
    copied: '已複製',
    copyFailed: '複製失敗',
    dispatches: 'RECENT DISPATCHES',
    footerLabel: '站台短訊',
    heroAction: '撕下、閱讀、傳遞。',
    introDescription: '把每天值得留意的公開信號整理成一張可以撕下、可以分享的卡片。信號在前，噪音退後。',
    introTitle: '科技 · 經濟 · AI',
    latest: '最新更新',
    moreSignals: (count) => `另有 ${count} 則信號`,
    newestFirst: '↓ 由新到舊',
    platform: '站台短訊',
    platformLabel: '月台 · PLATFORM',
    primaryNavigation: '主要導覽',
    signalCount: 'SIGNALS',
    signalLabel: '▲ 信號',
    signalStrength: '信號強度',
    signalTotal: (count) => `共 ${count} 則信號 · ${count} SIGNALS`,
    tickerLabel: '最新 Signal 標題',
    noiseLabel: '▽ 噪音',
    source: '來源',
    tear: '撕下這張紙帶 ——',
    previous: '← 上一則',
    next: '下一則 →',
    oldest: '已是最早一則',
    newest: '已是最新一則'
  },
  'zh-Hans': {
    adjacentNavigation: '相邻 Signal 简报',
    briefsLabel: '份简报 · BRIEFS',
    copied: '已复制',
    copyFailed: '复制失败',
    dispatches: 'RECENT DISPATCHES',
    footerLabel: '站台短讯',
    heroAction: '撕下、阅读、传递。',
    introDescription: '把每天值得留意的公开信号整理成一张可以撕下、可以分享的卡片。信号在前，噪音退后。',
    introTitle: '科技 · 经济 · AI',
    latest: '最新更新',
    moreSignals: (count) => `另有 ${count} 则信号`,
    newestFirst: '↓ 由新到旧',
    platform: '站台短讯',
    platformLabel: '站台 · PLATFORM',
    primaryNavigation: '主要导航',
    signalCount: 'SIGNALS',
    signalLabel: '▲ 信号',
    signalStrength: '信号强度',
    signalTotal: (count) => `共 ${count} 则信号 · ${count} SIGNALS`,
    tickerLabel: '最新 Signal 标题',
    noiseLabel: '▽ 噪音',
    source: '来源',
    tear: '撕下这张纸带 ——',
    previous: '← 上一则',
    next: '下一则 →',
    oldest: '已是最早一则',
    newest: '已是最新一则'
  }
};

const signalDesignCopy = (locale) => signalDesignCopyByLocale[locale] || signalDesignCopyByLocale['zh-Hant'];

const signalCategoryCode = (category) =>
  ({ ai: 'AI', economy: 'ECON', general: 'MIXED', market: 'MARKET', research: 'RESEARCH', tech: 'TECH' })[
    normalizeSignalCategory(category)
  ] || 'MIXED';

const signalBriefIsoDate = (row) => {
  const meta = signalBriefMetadata(row);
  const value = cleanText(meta.briefDate || row.published_at || row.updated_at, 80);
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
};

const signalWeekdayLabel = (iso, locale) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const labels = {
    en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    ja: ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'],
    'zh-Hant': ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
    'zh-Hans': ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  };
  return (labels[locale] || labels['zh-Hant'])[day];
};

const renderSignalCategoryChip = (route, row) => {
  const meta = signalBriefMetadata(row);
  return `<span class="signal-category-chip"><strong>${escapeHtml(signalCategoryCode(meta.category))}</strong><span>${escapeHtml(
    signalCategoryLabel(meta.category, route.locale)
  )}</span></span>`;
};

const renderSignalDispatchMeta = (route, row) => {
  const iso = signalBriefIsoDate(row);
  const issue = signalBriefMetadata(row).issue || (iso ? `SG-${iso.slice(2).replace(/-/g, '')}` : 'SG-DAILY');
  return `<div class="signal-dispatch-meta">
      ${renderSignalCategoryChip(route, row)}
      <span class="signal-code">${escapeHtml(issue)}</span>
      ${iso ? `<span class="signal-date">${escapeHtml(iso)}</span><span class="signal-weekday">${escapeHtml(signalWeekdayLabel(iso, route.locale))}</span>` : ''}
    </div>`;
};

const renderSignalStrength = (itemCount, forceFull = false, label = 'Signal strength') => {
  const level = forceFull ? 4 : Math.max(1, Math.min(4, Math.round(Math.max(1, itemCount) / 2)));
  return `<span class="signal-strength" data-level="${level}" aria-label="${escapeHtml(label)} ${level}/4"><i></i><i></i><i></i><i></i></span>`;
};

const splitSignalAnalysisLine = (value) => {
  const text = cleanText(value, 4000);
  const matches = [...text.matchAll(/(信號|信号|signal|噪音|noise)\s*[：:]/gi)];
  if (!matches.length) return { body: text, signal: '', noise: '' };
  const result = { body: text.slice(0, matches[0].index).trim(), signal: '', noise: '' };
  matches.forEach((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const content = text.slice(start, end).trim();
    if (/^(信號|信号|signal)$/i.test(match[1])) result.signal = content;
    if (/^(噪音|noise)$/i.test(match[1])) result.noise = content;
  });
  return result;
};

const parseSignalMarkdownItems = (markdown, sources = []) => {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const items = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.body = current.bodyParts.join(' ').trim();
    delete current.bodyParts;
    const source = sources[items.length] || null;
    current.source = source;
    items.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = trimmed.replace(/^#{1,3}\s+/, '');
    const headingMatch = heading.match(signalNumberedHeadingPattern);
    if (headingMatch) {
      flush();
      current = { headline: cleanText(headingMatch[2], 300), bodyParts: [], signal: '', noise: '' };
      continue;
    }
    if (!current) continue;
    const parts = splitSignalAnalysisLine(trimmed.replace(/^[-*]\s+/, ''));
    if (parts.body) current.bodyParts.push(parts.body);
    if (parts.signal) current.signal = parts.signal;
    if (parts.noise) current.noise = parts.noise;
  }
  flush();
  return items.slice(0, signalSummaryMaxItems);
};

const renderDynamicSignalIndex = (route, rows) => {
  const copy = dynamicContentCopy[route.locale] || dynamicContentCopy['zh-Hant'];
  const designCopy = signalDesignCopy(route.locale);
  const latest = rows[0] || null;
  const latestMeta = latest ? signalBriefMetadata(latest) : null;
  const tickerItems = latestMeta?.summaryBullets?.length
    ? latestMeta.summaryBullets.map(normalizeSignalCardBullet).filter(Boolean)
    : latest
      ? [latest.title]
      : [copy.signalDescription];
  const ticker = `${tickerItems.map((item) => `◆ ${item}`).join('   ')}   ◆ SIGNAL > NOISE   `;
  const cards = rows.length
    ? rows
        .map((row) => {
          const meta = signalBriefMetadata(row);
          const summary = firstPlainSummary([row.description, row.excerpt], 180);
          const category = normalizeSignalCategory(meta.category);
          const visibleBullets = meta.summaryBullets.slice(0, 4).map(normalizeSignalCardBullet).filter(Boolean);
          const bullets = visibleBullets.length
            ? `<ul class="signal-tape-list">${visibleBullets
                .map((item, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(item)}</li>`)
                .join('')}${meta.summaryBullets.length > visibleBullets.length ? `<li class="signal-tape-list__more">＋ ${escapeHtml(
                  designCopy.moreSignals(meta.summaryBullets.length - visibleBullets.length)
                )}</li>` : ''}</ul>`
            : '';
          return `<a class="signal-tape-card signal-tape-card--${escapeHtml(category)}" href="${escapeHtml(dynamicSignalPath(route, row.slug))}">
              <span class="signal-tape-card__spine" aria-hidden="true"></span>
              <div class="signal-tape-card__body">
                ${renderSignalDispatchMeta(route, row)}
                <h3>${escapeHtml(row.title)}</h3>
                ${summary ? `<p class="signal-tape-card__summary">${escapeHtml(summary)}</p>` : ''}
                ${bullets}
                <footer class="signal-tape-card__footer">
                  <span class="signal-read-more">${escapeHtml(copy.signalReadMore)} →</span>
                  <span class="signal-strength-label">${escapeHtml(designCopy.signalStrength)}</span>
                  ${renderSignalStrength(meta.summaryBullets.length, false, designCopy.signalStrength)}
                </footer>
              </div>
            </a>`;
        })
        .join('')
    : `<p class="signal-empty">${escapeHtml(copy.signalEmpty)}</p>`;

  return `<section class="signal-index-hero">
      <div class="signal-index-hero__label">
        <span class="signal-index-hero__lamp" aria-hidden="true"></span>
        <strong>SIGNAL STRIP · ${escapeHtml(designCopy.platform)}</strong>
        <span class="signal-index-hero__dash" aria-hidden="true"></span>
      </div>
      <h1>${escapeHtml(copy.signalTitle)}</h1>
      <p>${escapeHtml(copy.signalDescription)} — ${escapeHtml(designCopy.heroAction)}</p>
    </section>
    <div class="signal-ticker" aria-label="${escapeHtml(designCopy.tickerLabel)}">
      <div class="signal-ticker__track"><span>${escapeHtml(ticker)}</span><span>${escapeHtml(ticker)}</span></div>
    </div>
    <section class="signal-intro">
      <div>
        <h2>${escapeHtml(designCopy.introTitle)}</h2>
        <p>${escapeHtml(designCopy.introDescription)}</p>
      </div>
      <div class="signal-intro__stats">
        <div class="signal-stat"><strong>${rows.length}</strong><span>${escapeHtml(designCopy.briefsLabel)}</span></div>
        <div class="signal-stat"><strong>${escapeHtml(latest ? signalBriefIsoDate(latest).replace(/-/g, '.') : '—')}</strong><span>${escapeHtml(designCopy.latest)} · LATEST</span></div>
      </div>
    </section>
    <section class="signal-feed">
      <header class="signal-feed__heading">
        <h2>${escapeHtml(copy.signalLatest)}</h2>
        <span>${escapeHtml(designCopy.dispatches)}</span>
        <span>${escapeHtml(designCopy.newestFirst)}</span>
      </header>
      <div class="signal-feed__list">${cards}</div>
    </section>`;
};

const renderDynamicSignalBrief = (route, row, body, navigation = {}) => {
  const copy = dynamicContentCopy[route.locale] || dynamicContentCopy['zh-Hant'];
  const designCopy = signalDesignCopy(route.locale);
  const meta = signalBriefMetadata(row);
  const summary = firstPlainSummary([row.description, row.excerpt], 180);
  const fallbackBody = firstPlainSummary([row.excerpt, row.description], 1200);
  const canonicalPath = dynamicSignalPath(route, row.slug);
  const absoluteUrl = absoluteStationUrl(canonicalPath);
  const shareText = `${row.title} | Station Cat Signal strip`;
  const shareHref = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(absoluteUrl)}`;
  const cardPath = dynamicSignalCardPath(route, row.slug);
  const items = parseSignalMarkdownItems(body.markdown, meta.sources);
  const category = normalizeSignalCategory(meta.category);
  const renderedItems = items
    .map((item, index) => {
      const sourceLabel = item.source?.label || item.source?.url || '';
      const source = sourceLabel
        ? /^https?:\/\//i.test(item.source?.url || '')
          ? `<a class="signal-item__source" href="${escapeHtml(item.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(designCopy.source)} · ${escapeHtml(sourceLabel)} ↗</a>`
          : `<span class="signal-item__source">${escapeHtml(designCopy.source)} · ${escapeHtml(sourceLabel)}</span>`
        : '';
      const analysis = item.signal || item.noise
        ? `<div class="signal-analysis">
            <div class="signal-analysis__cell"><div class="signal-analysis__label">${escapeHtml(designCopy.signalLabel)}</div><div class="signal-analysis__text">${escapeHtml(item.signal || '—')}</div></div>
            <div class="signal-analysis__cell"><div class="signal-analysis__label">${escapeHtml(designCopy.noiseLabel)}</div><div class="signal-analysis__text">${escapeHtml(item.noise || '—')}</div></div>
          </div>`
        : '';
      return `<section class="signal-item">
          <div class="signal-item__rail"><span class="signal-item__number">${String(index + 1).padStart(2, '0')}</span></div>
          <div class="signal-item__body">
            <h2>${escapeHtml(item.headline)}</h2>
            ${item.body ? `<p class="signal-item__copy">${escapeHtml(item.body)}</p>` : ''}
            ${analysis}
            ${source}
          </div>
        </section>`;
    })
    .join('');
  const fallbackHtml = body.markdown
    ? renderSignalMarkdownToHtml(body.markdown)
    : body.html || `<p>${escapeHtml(fallbackBody)}</p>`;
  const adjacentCard = (entry, direction) => {
    if (!entry) {
      return `<div class="signal-adjacent__empty"><small>${escapeHtml(direction === 'previous' ? designCopy.previous : designCopy.next)}</small><strong>${escapeHtml(
        direction === 'previous' ? designCopy.oldest : designCopy.newest
      )}</strong></div>`;
    }
    const label = direction === 'previous' ? designCopy.previous : designCopy.next;
    const date = signalBriefIsoDate(entry).replace(/-/g, '.');
    return `<a class="signal-adjacent__card${direction === 'next' ? ' signal-adjacent__card--next' : ''}" href="${escapeHtml(dynamicSignalPath(route, entry.slug))}">
        <small>${escapeHtml(label)}${date ? ` · ${escapeHtml(date)}` : ''}</small>
        <strong>${escapeHtml(entry.title)}</strong>
      </a>`;
  };

  return `<div class="signal-detail-back"><a href="${escapeHtml(route.basePath)}">← ${escapeHtml(copy.signalBack)}</a></div>
    <article class="signal-dispatch signal-dispatch--${escapeHtml(category)}">
      <header class="signal-dispatch__masthead">
        ${renderSignalDispatchMeta(route, row)}
        <h1>${escapeHtml(row.title)}</h1>
        ${summary ? `<p class="signal-dispatch__lede">${escapeHtml(summary)}</p>` : ''}
        <div class="signal-dispatch__stats">
          <span>${escapeHtml(designCopy.signalTotal(items.length || meta.summaryBullets.length))}</span>
          <span class="signal-strength-label">${escapeHtml(designCopy.signalStrength)}</span>
          ${renderSignalStrength(items.length || meta.summaryBullets.length, true, designCopy.signalStrength)}
        </div>
      </header>
      ${renderedItems ? `<div class="signal-dispatch__items">${renderedItems}</div>` : `<div class="signal-dispatch__fallback">${fallbackHtml}</div>`}
      <section class="signal-share-strip">
        <span>${escapeHtml(designCopy.tear)}</span>
        <a class="signal-share-button" href="${escapeHtml(shareHref)}" target="_blank" rel="noreferrer">${escapeHtml(copy.signalShare)}</a>
        <a class="signal-share-button" href="${escapeHtml(cardPath)}" target="_blank" rel="noreferrer">${escapeHtml(copy.signalCard)}</a>
        <button class="signal-share-button" type="button" data-signal-copy-link>${escapeHtml(copy.signalCopyLink)}</button>
      </section>
      <script>
        (() => {
          const button = document.querySelector('[data-signal-copy-link]');
          button?.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(${scriptJson(absoluteUrl)});
              button.textContent = ${scriptJson(designCopy.copied)};
            } catch {
              button.textContent = ${scriptJson(designCopy.copyFailed)};
            }
            window.setTimeout(() => {
              button.textContent = ${scriptJson(copy.signalCopyLink)};
            }, 1800);
          });
        })();
      </script>
    </article>
    <nav class="signal-adjacent" aria-label="${escapeHtml(designCopy.adjacentNavigation)}">
      <div class="signal-adjacent__grid">${adjacentCard(navigation.previous, 'previous')}${adjacentCard(navigation.next, 'next')}</div>
    </nav>`;
};

const wrapSignalCardLines = (value, maxChars = 24, maxLines = 4) => {
  const text = cleanText(value, 800);
  if (!text) return [];
  const words = text.includes(' ') ? text.split(/\s+/).filter(Boolean) : Array.from(text);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = text.includes(' ') ? `${current}${current ? ' ' : ''}${word}` : `${current}${word}`;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
};

const truncateSignalCardText = (value, maxChars) => {
  const chars = Array.from(cleanText(value, 400));
  if (chars.length <= maxChars) return chars.join('');
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
};

const normalizeSignalCardBullet = (value) =>
  cleanText(value, 240)
    .replace(/^(\d{1,3})[.)、．]\s+/, '')
    .trim();

const renderSignalShareCardSvg = (route, row) => {
  const meta = signalBriefMetadata(row);
  const category = signalCategoryLabel(meta.category, route.locale);
  const date = formatContentDate(meta.briefDate || row.published_at || row.updated_at, route.locale);
  const titleLines = [truncateSignalCardText(row.title, route.locale === 'en' ? 30 : 14)].filter(Boolean);
  const rawBulletLines = meta.summaryBullets
    .map(normalizeSignalCardBullet)
    .filter(Boolean)
    .slice(0, signalSummaryMaxItems);
  const useTwoColumnBullets = rawBulletLines.length > 6;
  const bulletMaxChars = useTwoColumnBullets ? (route.locale === 'en' ? 34 : 17) : route.locale === 'en' ? 68 : 31;
  const bulletLines = rawBulletLines.map((item) => truncateSignalCardText(item, bulletMaxChars));
  const fallbackLines = !bulletLines.length
    ? wrapSignalCardLines(row.excerpt || row.description, route.locale === 'en' ? 64 : 30, signalSummaryMaxItems)
    : [];
  const sourceLabel = meta.sources[0]?.label || 'Station Cat';
  const url = `wwwstationcat.org${dynamicSignalPath(route, row.slug)}`;

  const bulletSvg = bulletLines.length
    ? bulletLines
        .map((line, index) => {
          const column = useTwoColumnBullets ? Math.floor(index / 5) : 0;
          const rowIndex = useTwoColumnBullets ? index % 5 : index;
          const x = column ? 612 : 153;
          const textX = column ? 647 : 188;
          const y = 326 + rowIndex * (useTwoColumnBullets ? 46 : bulletLines.length > 4 ? 46 : 54);
          const fontSize = useTwoColumnBullets ? 21 : bulletLines.length > 4 ? 24 : 27;
          return `<circle cx="${x}" cy="${y - 8}" r="${useTwoColumnBullets ? 15 : 17}" fill="#f4eadc" stroke="#d8c9b8" stroke-width="2"/>
    <text x="${x}" y="${y}" fill="#286a5e" font-family="Arial, sans-serif" font-size="${useTwoColumnBullets ? 16 : 18}" font-weight="900" text-anchor="middle">${index + 1}</text>
    <text x="${textX}" y="${y}" fill="#3f5751" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="800">${escapeHtml(line)}</text>`;
        })
        .join('\n    ')
    : fallbackLines
        .slice(0, 6)
        .map((line, index) => `<text x="142" y="${326 + index * 42}" fill="#3f5751" font-family="Arial, sans-serif" font-size="27" font-weight="700">${escapeHtml(line)}</text>`)
        .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${escapeHtml(row.title)}">
    <defs>
      <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
        <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#eadfce" stroke-width="1"/>
      </pattern>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="10" dy="12" stdDeviation="0" flood-color="#211b16" flood-opacity="0.16"/>
      </filter>
    </defs>
    <rect width="1200" height="675" fill="#fffaf4"/>
    <rect width="1200" height="675" fill="url(#grid)" opacity="0.68"/>
    <rect x="74" y="58" width="1052" height="554" rx="24" fill="#fffaf1" stroke="#241f1a" stroke-width="3" filter="url(#shadow)"/>
    <rect x="74" y="58" width="20" height="554" fill="#286a5e"/>
    <text x="128" y="118" fill="#286a5e" font-family="Arial, sans-serif" font-size="25" font-weight="900">SC SIGNAL STRIP</text>
    <text x="1064" y="118" fill="#524a42" font-family="Arial, sans-serif" font-size="22" font-weight="800" text-anchor="end">${escapeHtml(category)}</text>
    <line x1="128" y1="150" x2="1072" y2="150" stroke="#d8c9b8" stroke-width="3" stroke-dasharray="7 8"/>
    ${titleLines
      .map((line, index) => `<text x="128" y="${226 + index * 66}" fill="#241f1a" font-family="Georgia, 'Times New Roman', serif" font-size="58" font-weight="800">${escapeHtml(line)}</text>`)
      .join('')}
    <text x="128" y="286" fill="#7b6f63" font-family="Arial, sans-serif" font-size="22" font-weight="800">${escapeHtml(date || sourceLabel)}</text>
    ${bulletSvg}
    <rect x="128" y="548" width="170" height="8" fill="#e9a95e"/>
    <rect x="318" y="548" width="72" height="8" fill="#286a5e"/>
    <text x="128" y="588" fill="#52645e" font-family="Arial, sans-serif" font-size="22" font-weight="800">Station Cat Daily Signal</text>
    <text x="1072" y="588" fill="#52645e" font-family="Arial, sans-serif" font-size="22" font-weight="800" text-anchor="end">${escapeHtml(url)}</text>
  </svg>`;
};

const hydrateSignalIndexRows = async (env, rows) =>
  Promise.all(
    rows.map(async (row) => {
      const body = await readPublicEntryBody(env, row, { preferMarkdown: true });
      return body.markdown ? { ...row, signalMarkdown: body.markdown } : row;
    })
  );

const renderDynamicNovelIndex = (route, seriesRows) => {
  const copy = dynamicContentCopy[route.locale];
  const cards = seriesRows.length
    ? seriesRows
        .map((series) => {
          const summary = firstPlainSummary([series.description, series.excerpt, series.subtitle], 220);
          return `<a class="card" href="${escapeHtml(dynamicSeriesPath(route, series.slug))}">
          <div class="meta">
            <span class="pill">${escapeHtml(dynamicContentStatusLabels[series.status] || series.status)}</span>
            <span>${escapeHtml(getDynamicAccessLabel(series.access_level, route.locale))}</span>
          </div>
          <h3>${escapeHtml(series.title)}</h3>
          ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
        </a>`;
        })
        .join('')
    : `<p>${escapeHtml(copy.serialsDescription)}</p>`;

  return `<section class="hero">
      <p class="kicker">${escapeHtml(copy.allSerials)}</p>
      <h1>${escapeHtml(copy.serialsTitle)}</h1>
      <p>${escapeHtml(copy.serialsDescription)}</p>
    </section>
    <section class="section">
      <div class="grid">${cards}</div>
    </section>`;
};

const DYNAMIC_CHAPTERS_PER_PAGE = 9;

const renderChapterCards = (route, chapters, paymentSettings = null) => {
  const copy = dynamicContentCopy[route.locale];
  if (!chapters.length) return `<p>${escapeHtml(copy.chapters)}</p>`;
  return chapters
    .map(
      (chapter, index) => {
        const summary = firstPlainSummary([chapter.excerpt, chapter.description], 120);
        const pageNumber = Math.floor(index / DYNAMIC_CHAPTERS_PER_PAGE) + 1;
        const hiddenAttribute = pageNumber > 1 ? ' hidden' : '';
        const accessLevel = getEffectiveDynamicChapterAccessLevel(chapter, paymentSettings, index);
        return `<a class="card chapter-card" href="${escapeHtml(dynamicChapterPath(route, chapter.parent_slug, chapter.slug))}" data-chapter-page="${pageNumber}"${hiddenAttribute}>
        <div class="meta">
          <span class="pill">${escapeHtml(formatDynamicChapterNumber(chapter.chapter_number, route.locale))}</span>
          <span>${escapeHtml(getDynamicAccessLabel(accessLevel, route.locale))}</span>
        </div>
        <h3>${escapeHtml(chapter.title)}</h3>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
      </a>`;
      }
    )
    .join('');
};

const renderChapterPagination = (chapters) => {
  const totalPages = Math.ceil(chapters.length / DYNAMIC_CHAPTERS_PER_PAGE);
  if (totalPages <= 1) return '';
  return `<nav class="chapter-pagination" aria-label="章節分頁">
      ${Array.from({ length: totalPages }, (_, index) => {
        const pageNumber = index + 1;
        const activeClass = pageNumber === 1 ? ' is-active' : '';
        const current = pageNumber === 1 ? ' aria-current="page"' : '';
        return `<button type="button" class="chapter-pagination__button${activeClass}" data-chapter-page-button="${pageNumber}"${current}>${pageNumber}</button>`;
      }).join('')}
    </nav>`;
};

const renderChapterPaginationScript = (chapters) => {
  if (chapters.length <= DYNAMIC_CHAPTERS_PER_PAGE) return '';
  return `<script>
    (() => {
      const roots = document.querySelectorAll('[data-chapter-pagination-root]');
      roots.forEach((root) => {
        const cards = Array.from(root.querySelectorAll('[data-chapter-page]'));
        const buttons = Array.from(root.querySelectorAll('[data-chapter-page-button]'));
        if (!cards.length || !buttons.length) return;
        const setPage = (page) => {
          cards.forEach((card) => {
            card.hidden = card.dataset.chapterPage !== String(page);
          });
          buttons.forEach((button) => {
            const isActive = button.dataset.chapterPageButton === String(page);
            button.classList.toggle('is-active', isActive);
            if (isActive) {
              button.setAttribute('aria-current', 'page');
            } else {
              button.removeAttribute('aria-current');
            }
          });
        };
        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const page = Number(button.dataset.chapterPageButton || '1');
            setPage(page);
            root.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
        setPage(1);
      });
    })();
  </script>`;
};

const dynamicPaymentCopy = {
  en: {
    allowed: 'Access confirmed. Loading the chapter...',
    backSeries: 'Back to series',
    bundle: 'Unlock',
    bundleOff: 'off',
    bundleUnit: ' chapters',
    checking: 'Checking access...',
    contentFailed: 'Could not load the protected chapter.',
    creditInsufficient: 'Not enough reading credits. Top up in Member Center first.',
    creditTopUp: 'Top up credits',
    creditUnlock: 'Use reading credits',
    denied: 'This account has not unlocked this chapter yet.',
    disabled: 'Checkout is not configured yet.',
    failed: 'Could not create checkout.',
    library: 'Open Member Center',
    opening: 'Opening NOWPayments...',
    signIn: 'Sign in to Member Center',
    signInRequired: 'Please sign in before unlocking paid reading.',
    unlock: 'Unlock'
  },
  ja: {
    allowed: '権限を確認しました。本文を読み込んでいます...',
    backSeries: '作品ページへ',
    bundle: '解放',
    bundleOff: 'OFF',
    bundleUnit: '章',
    checking: '権限を確認しています...',
    contentFailed: '保護された本文を読み込めません。',
    creditInsufficient: '読書ポイントが足りません。先に本棚で追加してください。',
    creditTopUp: 'ポイントを追加',
    creditUnlock: '読書ポイントで解放',
    denied: 'このアカウントではまだこの章が解放されていません。',
    disabled: '支払い設定はまだ有効ではありません。',
    failed: 'チェックアウトを作成できませんでした。',
    library: '本棚を開く',
    opening: 'NOWPayments を開いています...',
    signIn: '本棚にログイン',
    signInRequired: '有料閲覧を解放する前にログインしてください。',
    unlock: '解放する'
  },
  'zh-Hant': {
    allowed: '權限已確認，正在載入正文...',
    backSeries: '回到作品頁',
    bundle: '解鎖',
    bundleOff: '折扣',
    bundleUnit: ' 章',
    checking: '正在確認閱讀權限...',
    contentFailed: '受保護正文載入失敗。',
    creditInsufficient: '閱讀點數不足，請先到會員中心充值。',
    creditTopUp: '充值閱讀點',
    creditUnlock: '用閱讀點解鎖',
    denied: '這個帳戶尚未解鎖本章。',
    disabled: '支付通道尚未配置完成。',
    failed: '支付訂單建立失敗。',
    library: '打開會員中心',
    opening: '正在打開 NOWPayments...',
    signIn: '登入會員中心',
    signInRequired: '請先登入，再解鎖付費閱讀。',
    unlock: '解鎖'
  },
  'zh-Hans': {
    allowed: '权限已确认，正在加载正文...',
    backSeries: '回到作品页',
    bundle: '解锁',
    bundleOff: '折扣',
    bundleUnit: ' 章',
    checking: '正在确认阅读权限...',
    contentFailed: '受保护正文加载失败。',
    creditInsufficient: '阅读点数不足，请先到会员中心充值。',
    creditTopUp: '充值阅读点',
    creditUnlock: '用阅读点解锁',
    denied: '这个账户尚未解锁本章。',
    disabled: '支付通道尚未配置完成。',
    failed: '支付订单建立失败。',
    library: '打开会员中心',
    opening: '正在打开 NOWPayments...',
    signIn: '登录会员中心',
    signInRequired: '请先登录，再解锁付费阅读。',
    unlock: '解锁'
  }
};

const dynamicBookmarkCopy = {
  en: {
    failed: 'Could not save bookmark.',
    save: 'Save bookmark',
    saved: 'Bookmark saved. You can continue from Member Center next time.',
    shortcutTitle: 'Press B to save reading position',
    saving: 'Saving bookmark...',
    signInRequired: 'Please sign in before saving a bookmark.'
  },
  ja: {
    failed: 'しおりを保存できませんでした。',
    save: 'しおりを保存',
    saved: 'しおりを保存しました。次回は本棚から続きが読めます。',
    shortcutTitle: 'B キーで読書位置を保存',
    saving: 'しおりを保存しています...',
    signInRequired: 'しおりを保存する前にログインしてください。'
  },
  'zh-Hant': {
    failed: '書籤保存失敗。',
    save: '保存書籤',
    saved: '書籤已保存，下次可以從會員中心繼續閱讀。',
    shortcutTitle: '按 B 保存閱讀位置',
    saving: '正在保存書籤...',
    signInRequired: '請先登入，再保存書籤。'
  },
  'zh-Hans': {
    failed: '书签保存失败。',
    save: '保存书签',
    saved: '书签已保存，下次可以从会员中心继续阅读。',
    shortcutTitle: '按 B 保存阅读位置',
    saving: '正在保存书签...',
    signInRequired: '请先登录，再保存书签。'
  }
};

const dynamicReaderInteractionCopy = {
  en: {
    body: 'Like this chapter, save your reading point, or submit a comment for review.',
    comment: 'Comment',
    commentAccessRequired: 'Unlock this chapter before reading or submitting comments.',
    commentEmpty: 'No public comments yet.',
    commentFailed: 'Could not load comments.',
    commentLabel: 'Comment',
    commentLoading: 'Loading comments...',
    commentPlaceholder: 'Write a note about this chapter...',
    commentSaved: 'Draft saved on this device.',
    commentSignInRequired: 'Please sign in before submitting a comment.',
    commentSubmitted: 'Comment submitted. It will appear after review.',
    commentSubmitting: 'Submitting comment...',
    commentsTitle: 'Reader comments',
    commentSubmit: 'Submit comment',
    commentTooShort: 'Write at least 2 characters before submitting.',
    eyebrow: 'Reader actions',
    like: 'Like',
    liked: 'Liked',
    title: 'Keep your reaction here'
  },
  ja: {
    body: 'この章にいいねを付けたり、読書位置を保存したり、レビュー用コメントを送れます。',
    comment: 'コメント',
    commentAccessRequired: 'この章を解放するとコメントを読んだり送信したりできます。',
    commentEmpty: '公開コメントはまだありません。',
    commentFailed: 'コメントを読み込めませんでした。',
    commentLabel: 'コメント',
    commentLoading: 'コメントを読み込んでいます...',
    commentPlaceholder: 'この章についてメモを書く...',
    commentSaved: 'この端末に下書きを保存しました。',
    commentSignInRequired: 'コメントを送る前にログインしてください。',
    commentSubmitted: 'コメントを送信しました。確認後に表示されます。',
    commentSubmitting: 'コメントを送信しています...',
    commentsTitle: '読者コメント',
    commentSubmit: 'コメントを送信',
    commentTooShort: '2文字以上入力してから送信してください。',
    eyebrow: '読者アクション',
    like: 'いいね',
    liked: 'いいね済み',
    title: '反応をここに残す'
  },
  'zh-Hant': {
    body: '可以喜歡本章、保存目前閱讀位置，也可以提交評論，審核通過後公開展示。',
    comment: '評論',
    commentAccessRequired: '解鎖本章後，可以查看或提交評論。',
    commentEmpty: '目前還沒有公開評論。',
    commentFailed: '評論載入失敗。',
    commentLabel: '評論內容',
    commentLoading: '正在載入評論...',
    commentPlaceholder: '寫下你對這章的想法...',
    commentSaved: '草稿已保存在這台裝置。',
    commentSignInRequired: '請先登入會員，再提交評論。',
    commentSubmitted: '評論已提交，審核通過後會展示。',
    commentSubmitting: '正在提交評論...',
    commentsTitle: '讀者評論',
    commentSubmit: '提交評論',
    commentTooShort: '至少寫 2 個字再提交。',
    eyebrow: '讀者互動',
    like: '喜歡',
    liked: '已喜歡',
    title: '欢迎大家对本章内容进行评价'
  },
  'zh-Hans': {
    body: '可以喜欢本章、保存目前阅读位置，也可以提交评论，审核通过后公开展示。',
    comment: '评论',
    commentAccessRequired: '解锁本章后，可以查看或提交评论。',
    commentEmpty: '目前还没有公开评论。',
    commentFailed: '评论加载失败。',
    commentLabel: '评论内容',
    commentLoading: '正在加载评论...',
    commentPlaceholder: '写下你对这章的想法...',
    commentSaved: '草稿已保存在这台设备。',
    commentSignInRequired: '请先登录会员，再提交评论。',
    commentSubmitted: '评论已提交，审核通过后会展示。',
    commentSubmitting: '正在提交评论...',
    commentsTitle: '读者评论',
    commentSubmit: '提交评论',
    commentTooShort: '至少写 2 个字再提交。',
    eyebrow: '读者互动',
    like: '喜欢',
    liked: '已喜欢',
    title: '欢迎大家对本章内容进行评价'
  }
};

const renderDynamicUnlockButtons = (route, serial, chapter, settings) => {
  const copy = dynamicPaymentCopy[route.locale];
  const orderType = chapter.access_level === 'supporter' ? 'supporter' : 'chapter';

  return `<div class="button-row">
      <a class="button button-primary" href="/library/">${escapeHtml(copy.signIn)}</a>
      ${
        orderType === 'chapter'
          ? `<button class="button button-secondary" type="button" data-serial-credit-unlock>${escapeHtml(copy.creditUnlock)} · ${escapeHtml(String(settings.chapterCredits))}</button>`
          : ''
      }
      ${orderType === 'chapter' ? `<a class="button button-secondary" href="/library/">${escapeHtml(copy.creditTopUp)}</a>` : ''}
      <a class="button button-secondary" href="${escapeHtml(dynamicSeriesPath(route, serial.slug))}">${escapeHtml(copy.backSeries)}</a>
    </div>`;
};

const renderDynamicReadingEventsScript = (route, serial, chapter) => {
  if (route.readerVersion !== 'v2') return '';
  const readingEventsData = {
    chapterSlug: chapter.slug,
    chapterTitle: chapter.title,
    locale: route.locale,
    seriesSlug: serial.slug,
    seriesTitle: serial.title,
    sourcePath: dynamicCanonicalPath(route)
  };

  return `<script>
    (() => {
      const readingEventsEndpoint = ${scriptJson(novelReadingEventsPath)};
      const readingEventsData = ${scriptJson(readingEventsData)};
      const readingSessionStorageKey = 'stationcat:novel-v2:reading-session-id';
      const readingStartTime = Date.now();
      const scrollDepthThresholds = [25, 50, 75, 90, 100];
      const reportedDepths = new Set();
      let readingSessionId = '';
      let readingPaused = false;
      let readingIdleTimer;
      let readingScrollFrame = 0;
      let readingMaxDepth = 0;
      let readingOpened = false;
      let readingBodyObserver;
      let lastScrollTrackAt = 0;
      let lastScrollProgress = -1;
      const createReadingId = (prefix) => {
        const randomValue = typeof window.crypto?.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        return prefix + '-' + randomValue;
      };
      try {
        readingSessionId = window.localStorage.getItem(readingSessionStorageKey) || '';
        if (!readingSessionId) {
          readingSessionId = createReadingId('r');
          window.localStorage.setItem(readingSessionStorageKey, readingSessionId);
        }
      } catch {
        readingSessionId = createReadingId('r');
      }
      const getReaderBodyForEvents = () =>
        document.querySelector('[data-reader-body]:not([hidden])');
      const getReadableBlocksForEvents = (body) =>
        Array.from(body?.querySelectorAll('p, h2, h3, blockquote, li') || [])
          .filter((node) => node.textContent.trim().length > 0);
      const getReadingPosition = () => {
        const body = getReaderBodyForEvents();
        if (!body) return { blockIndex: null, progressPercent: 0 };
        const rect = body.getBoundingClientRect();
        const total = Math.max(1, body.scrollHeight - window.innerHeight * 0.55);
        const read = Math.max(0, -rect.top + window.innerHeight * 0.18);
        const progressPercent = Math.max(0, Math.min(100, Math.round((read / total) * 100)));
        const blocks = getReadableBlocksForEvents(body);
        const targetLine = window.innerHeight * 0.22;
        const currentBlock = blocks.reduce((best, block) => {
          const distance = Math.abs(block.getBoundingClientRect().top - targetLine);
          return !best || distance < best.distance ? { block, distance } : best;
        }, null)?.block;
        const blockIndex = currentBlock ? blocks.indexOf(currentBlock) : null;
        return { blockIndex, progressPercent };
      };
      const sendReadingPayload = (payload, options = {}) => {
        const body = JSON.stringify(payload);
        if (options.beacon && navigator.sendBeacon) {
          try {
            const blob = new Blob([body], { type: 'application/json' });
            if (navigator.sendBeacon(readingEventsEndpoint, blob)) return;
          } catch {}
        }
        fetch(readingEventsEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: Boolean(options.keepalive)
        }).catch(() => null);
      };
      const trackReadingEvent = (eventType, eventData = {}, options = {}) => {
        const position = getReadingPosition();
        readingMaxDepth = Math.max(readingMaxDepth, position.progressPercent || 0);
        sendReadingPayload({
          ...readingEventsData,
          blockIndex: eventData.blockIndex ?? position.blockIndex,
          clientEventId: createReadingId('e'),
          durationMs: Date.now() - readingStartTime,
          eventType,
          metadata: {
            readerVersion: 'v2',
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
            visibilityState: document.visibilityState,
            ...(eventData.metadata || {})
          },
          progressPercent: eventData.progressPercent ?? position.progressPercent,
          sessionId: readingSessionId,
          sourcePath: window.location.pathname + window.location.hash,
          value: eventData.value
        }, options);
      };
      window.stationCatReadingEvents = {
        openWhenReady: () => openReadingSession(),
        sessionId: () => readingSessionId,
        track: trackReadingEvent
      };
      const markReadingActivity = () => {
        if (!readingOpened) return;
        if (readingPaused) {
          readingPaused = false;
          trackReadingEvent('reading_resume');
        }
        window.clearTimeout(readingIdleTimer);
        readingIdleTimer = window.setTimeout(() => {
          readingPaused = true;
          trackReadingEvent('reading_pause');
        }, 45000);
      };
      const handleReadingScroll = () => {
        if (!readingOpened) return;
        markReadingActivity();
        if (readingScrollFrame) return;
        readingScrollFrame = window.requestAnimationFrame(() => {
          readingScrollFrame = 0;
          const { progressPercent } = getReadingPosition();
          readingMaxDepth = Math.max(readingMaxDepth, progressPercent);
          scrollDepthThresholds.forEach((threshold) => {
            if (progressPercent >= threshold && !reportedDepths.has(threshold)) {
              reportedDepths.add(threshold);
              trackReadingEvent('scroll_depth', {
                progressPercent,
                value: threshold,
                metadata: { threshold }
              });
            }
          });
          const now = Date.now();
          if (now - lastScrollTrackAt >= 15000 && Math.abs(progressPercent - lastScrollProgress) >= 5) {
            lastScrollTrackAt = now;
            lastScrollProgress = progressPercent;
            trackReadingEvent('scroll', { progressPercent, value: progressPercent });
          }
        });
      };
      const openReadingSession = () => {
        if (readingOpened) return true;
        if (!getReaderBodyForEvents()) return false;
        readingOpened = true;
        if (readingBodyObserver) {
          readingBodyObserver.disconnect();
          readingBodyObserver = null;
        }
        trackReadingEvent('chapter_open');
        markReadingActivity();
        return true;
      };
      const watchForReaderBody = () => {
        if (openReadingSession()) return;
        if (typeof MutationObserver !== 'function' || !document.body) return;
        readingBodyObserver = new MutationObserver(() => {
          openReadingSession();
        });
        readingBodyObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['hidden'],
          childList: true,
          subtree: true
        });
      };
      document.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest('[data-reader-nav]') : null;
        if (!target) return;
        const direction = target.dataset.readerNav === 'prev' ? 'prev' : 'next';
        trackReadingEvent(direction === 'prev' ? 'click_prev' : 'click_next', {
          metadata: { href: target.getAttribute('href') || '' }
        }, { beacon: true, keepalive: true });
      });
      ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
        window.addEventListener(eventName, markReadingActivity, { passive: true });
      });
      window.addEventListener('scroll', handleReadingScroll, { passive: true });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!openReadingSession()) return;
          markReadingActivity();
        }
      });
      window.addEventListener('pagehide', () => {
        window.clearTimeout(readingIdleTimer);
        if (readingBodyObserver) readingBodyObserver.disconnect();
        if (readingOpened) {
          trackReadingEvent('chapter_close', {
            value: readingMaxDepth,
            metadata: { maxDepth: readingMaxDepth }
          }, { beacon: true, keepalive: true });
        }
      }, { once: true });
      watchForReaderBody();
    })();
  </script>`;
};

const renderDynamicReaderInteractions = (route, serial, chapter) => {
  if (route.readerVersion !== 'v2') return '';
  const copy = dynamicReaderInteractionCopy[route.locale] || dynamicReaderInteractionCopy['zh-Hant'];
  const interactionKey = `${serial.slug}:${chapter.slug}`;
  const commentData = {
    chapterSlug: chapter.slug,
    locale: route.locale,
    seriesSlug: serial.slug,
    sourcePath: dynamicCanonicalPath(route)
  };
  return `<section class="reader-interactions" data-reader-v2-interactions>
      <div>
        <p class="kicker">${escapeHtml(copy.eyebrow)}</p>
        <h2>${escapeHtml(copy.title)}</h2>
        <p>${escapeHtml(copy.body)}</p>
      </div>
      <div class="button-row">
        <button class="button button-secondary" type="button" data-reader-like aria-pressed="false">${escapeHtml(copy.like)}</button>
        <button class="button button-secondary" type="button" data-reader-comment-toggle aria-expanded="false" aria-controls="reader-comment-panel">${escapeHtml(copy.comment)}</button>
      </div>
      <div class="reader-comment-panel" id="reader-comment-panel" data-reader-comment-panel hidden>
        <label for="reader-comment-draft">${escapeHtml(copy.commentLabel)}</label>
        <textarea id="reader-comment-draft" data-reader-comment-draft rows="4" placeholder="${escapeHtml(copy.commentPlaceholder)}"></textarea>
        <div class="button-row">
          <button class="button button-primary" type="button" data-reader-comment-submit>${escapeHtml(copy.commentSubmit)}</button>
        </div>
        <div class="status" data-reader-comment-status role="status" aria-live="polite"></div>
      </div>
      <section class="reader-comments" aria-labelledby="reader-comments-title">
        <h3 id="reader-comments-title">${escapeHtml(copy.commentsTitle)}</h3>
        <div class="reader-comments-list" data-reader-comments-list>
          <p class="status">${escapeHtml(copy.commentLoading)}</p>
        </div>
      </section>
    </section>
    <script>
      (() => {
        const interactionPanel = document.querySelector('[data-reader-v2-interactions]');
        const interactionCopy = ${scriptJson(copy)};
        const commentData = ${scriptJson(commentData)};
        const commentsEndpoint = '/api/novels/comments';
        const commentSubmitEndpoint = '/api/readers/comments';
        const interactionKey = ${scriptJson(interactionKey)};
        const likeButton = interactionPanel?.querySelector('[data-reader-like]');
        const commentToggle = interactionPanel?.querySelector('[data-reader-comment-toggle]');
        const commentPanel = interactionPanel?.querySelector('[data-reader-comment-panel]');
        const commentDraft = interactionPanel?.querySelector('[data-reader-comment-draft]');
        const commentSubmit = interactionPanel?.querySelector('[data-reader-comment-submit]');
        const commentStatus = interactionPanel?.querySelector('[data-reader-comment-status]');
        const commentsList = interactionPanel?.querySelector('[data-reader-comments-list]');
        const storagePrefix = 'stationcat:novel-v2:' + interactionKey;
        const likedKey = storagePrefix + ':liked';
        const commentKey = storagePrefix + ':comment-draft';
        let commentPostTimer;
        const escapeClientHtml = (value) => String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
        const formatClientDate = (value) => {
          if (!value) return '';
          const date = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
          if (Number.isNaN(date.getTime())) return '';
          return date.toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' });
        };
        const setCommentStatus = (message, tone = 'neutral') => {
          if (!commentStatus) return;
          commentStatus.textContent = message || '';
          commentStatus.dataset.tone = tone;
        };
        const renderComments = (comments) => {
          if (!commentsList) return;
          if (!comments.length) {
            commentsList.innerHTML = '<p class="status">' + escapeClientHtml(interactionCopy.commentEmpty) + '</p>';
            return;
          }
          commentsList.innerHTML = comments.map((comment) =>
            '<article class="reader-comment-item">' +
              '<div><strong>' + escapeClientHtml(comment.displayName || '读者') + '</strong>' +
              '<time>' + escapeClientHtml(formatClientDate(comment.createdAt)) + '</time></div>' +
              '<p>' + escapeClientHtml(comment.body).replace(/\\n/g, '<br>') + '</p>' +
            '</article>'
          ).join('');
        };
        const loadComments = async () => {
          if (!commentsList) return;
          commentsList.innerHTML = '<p class="status">' + escapeClientHtml(interactionCopy.commentLoading) + '</p>';
          const params = new URLSearchParams({
            chapterSlug: commentData.chapterSlug,
            locale: commentData.locale,
            seriesSlug: commentData.seriesSlug
          });
          try {
            const response = await fetch(commentsEndpoint + '?' + params.toString());
            const payload = await response.json().catch(() => ({}));
            if (response.status === 401 || response.status === 403 || payload.code === 'CHAPTER_COMMENT_ACCESS_REQUIRED') {
              commentsList.innerHTML = '<p class="status">' + escapeClientHtml(interactionCopy.commentAccessRequired) + '</p>';
              return;
            }
            if (!response.ok || payload.ok === false) throw new Error(payload.message || 'Failed');
            renderComments(payload.comments || []);
          } catch {
            commentsList.innerHTML = '<p class="status" data-tone="error">' + escapeClientHtml(interactionCopy.commentFailed) + '</p>';
          }
        };
        const setLikedState = (liked) => {
          if (!likeButton) return;
          likeButton.setAttribute('aria-pressed', liked ? 'true' : 'false');
          likeButton.textContent = liked ? interactionCopy.liked : interactionCopy.like;
        };
        try {
          setLikedState(window.localStorage.getItem(likedKey) === '1');
          if (commentDraft) commentDraft.value = window.localStorage.getItem(commentKey) || '';
        } catch {
          setLikedState(false);
        }
        likeButton?.addEventListener('click', () => {
          const nextLiked = likeButton.getAttribute('aria-pressed') !== 'true';
          setLikedState(nextLiked);
          window.stationCatReadingEvents?.track?.('like', {
            value: nextLiked ? 1 : 0,
            metadata: { liked: nextLiked }
          });
          try {
            window.localStorage.setItem(likedKey, nextLiked ? '1' : '0');
          } catch {}
        });
        commentToggle?.addEventListener('click', () => {
          if (!commentPanel) return;
          const expanded = commentPanel.hidden;
          commentPanel.hidden = !expanded;
          commentToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          if (expanded) {
            window.stationCatReadingEvents?.track?.('comment_open');
            commentDraft?.focus();
          }
        });
        commentDraft?.addEventListener('input', () => {
          const commentLength = commentDraft.value.trim().length;
          window.clearTimeout(commentPostTimer);
          if (commentLength > 0) {
            commentPostTimer = window.setTimeout(() => {
              window.stationCatReadingEvents?.track?.('comment_draft', {
                value: commentLength,
                metadata: { length: commentLength }
              });
            }, 1200);
          }
          try {
            window.localStorage.setItem(commentKey, commentDraft.value);
            setCommentStatus(interactionCopy.commentSaved, 'success');
          } catch {
            setCommentStatus('', 'neutral');
          }
        });
        commentSubmit?.addEventListener('click', async () => {
          const body = commentDraft?.value.trim() || '';
          if (body.length < 2) {
            setCommentStatus(interactionCopy.commentTooShort, 'error');
            return;
          }
          commentSubmit.disabled = true;
          setCommentStatus(interactionCopy.commentSubmitting, 'neutral');
          try {
            const response = await fetch(commentSubmitEndpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ...commentData,
                body,
                sessionId: window.stationCatReadingEvents?.sessionId?.() || '',
                sourcePath: window.location.pathname + window.location.hash
              })
            });
            const payload = await response.json().catch(() => ({}));
            if (response.status === 401 || payload.code === 'SIGN_IN_REQUIRED') {
              setCommentStatus(interactionCopy.commentSignInRequired, 'error');
              window.location.href = '/library/?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
              return;
            }
            if (response.status === 403 || payload.code === 'CHAPTER_COMMENT_ACCESS_REQUIRED') {
              setCommentStatus(interactionCopy.commentAccessRequired, 'error');
              return;
            }
            if (!response.ok || payload.ok === false) throw new Error(payload.message || interactionCopy.commentFailed);
            if (commentDraft) commentDraft.value = '';
            try {
              window.localStorage.removeItem(commentKey);
            } catch {}
            setCommentStatus(payload.message || interactionCopy.commentSubmitted, 'success');
            await loadComments();
          } catch (error) {
            setCommentStatus(error.message || interactionCopy.commentFailed, 'error');
          } finally {
            commentSubmit.disabled = false;
          }
        });
        loadComments();
        window.addEventListener('pagehide', () => window.clearTimeout(commentPostTimer), { once: true });
      })();
    </script>`;
};

const renderDynamicBookmarkScript = (route, serial, chapter) => {
  const copy = dynamicBookmarkCopy[route.locale] || dynamicBookmarkCopy['zh-Hant'];
  const bookmarkData = {
    chapterSlug: chapter.slug,
    chapterTitle: chapter.title,
    locale: route.locale,
    seriesSlug: serial.slug,
    seriesTitle: serial.title,
    sourcePath: dynamicCanonicalPath(route)
  };

  return `<script>
    (() => {
      const bookmarkStatus = document.querySelector('[data-reader-bookmark-status]');
      const bookmarkToast = document.querySelector('[data-reader-bookmark-toast]');
      const bookmarkCopy = ${scriptJson(copy)};
      const bookmarkData = ${scriptJson(bookmarkData)};
      const anchorPrefix = 'sc-bookmark-block-';
      let bookmarkToastTimer;
      const getBookmarkButtons = () => Array.from(document.querySelectorAll('[data-reader-bookmark-save]'));
      const clearBookmarkToastTimer = () => {
        window.clearTimeout(bookmarkToastTimer);
      };
      const setBookmarkStatus = (message, tone = 'neutral') => {
        if (!bookmarkStatus) return;
        bookmarkStatus.textContent = message;
        bookmarkStatus.dataset.tone = tone;
        if (bookmarkToast) {
          window.clearTimeout(bookmarkToastTimer);
          bookmarkToast.textContent = message;
          bookmarkToast.dataset.tone = tone;
          bookmarkToast.hidden = false;
          if (tone !== 'neutral') {
            bookmarkToastTimer = window.setTimeout(() => {
              bookmarkToast.hidden = true;
            }, 2600);
          }
        }
      };
      const setBookmarkButtonsDisabled = (disabled) => {
        getBookmarkButtons().forEach((button) => {
          button.disabled = disabled;
          button.setAttribute('aria-busy', disabled ? 'true' : 'false');
        });
      };
      const isEditableTarget = (target) => {
        if (!(target instanceof HTMLElement)) return false;
        return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
      };
      const getReaderBody = () =>
        document.querySelector('[data-reader-body]:not([hidden])') ||
        document.querySelector('[data-protected-chapter-body]:not([hidden])') ||
        document.querySelector('.prose--reader');
      const getReadableBlocks = (body) =>
        Array.from(body?.querySelectorAll('p, h2, h3, blockquote, li') || [])
          .filter((node) => node.textContent.trim().length > 0);
      const initializeBookmarkAnchors = (body = getReaderBody(), options = {}) => {
        const blocks = getReadableBlocks(body);
        blocks.forEach((block, index) => {
          if (!block.id || block.id.startsWith(anchorPrefix)) {
            block.id = anchorPrefix + String(index + 1);
          }
        });
        if (options.restore) restoreBookmarkPosition(body);
        return blocks;
      };
      const progressPercentForBody = (body) => {
        if (!body) return 0;
        const rect = body.getBoundingClientRect();
        const total = Math.max(1, body.scrollHeight - window.innerHeight * 0.55);
        const read = Math.max(0, -rect.top + window.innerHeight * 0.18);
        return Math.max(0, Math.min(100, Math.round((read / total) * 100)));
      };
      const restoreBookmarkPosition = (body = getReaderBody()) => {
        if (!body || !window.location.hash.startsWith('#' + anchorPrefix)) return;
        initializeBookmarkAnchors(body);
        const anchorId = decodeURIComponent(window.location.hash.slice(1));
        const target = document.getElementById(anchorId);
        if (target) {
          window.setTimeout(() => target.scrollIntoView({ block: 'start' }), 60);
        }
      };
      const currentBookmarkPosition = () => {
        const body = getReaderBody();
        const blocks = initializeBookmarkAnchors(body);
        const progressPercent = progressPercentForBody(body);
        const targetLine = window.innerHeight * 0.22;
        const currentBlock = blocks.reduce((best, block) => {
          const distance = Math.abs(block.getBoundingClientRect().top - targetLine);
          return !best || distance < best.distance ? { block, distance } : best;
        }, null)?.block;
        const blockIndex = currentBlock ? blocks.indexOf(currentBlock) : -1;
        const anchorId = currentBlock?.id || '';
        const sourcePath = anchorId
          ? window.location.pathname + '#' + encodeURIComponent(anchorId)
          : window.location.pathname;
        return {
          anchorId,
          blockIndex,
          progressPercent,
          sourcePath,
          positionLabel: blockIndex >= 0 ? '第 ' + String(blockIndex + 1) + ' 段 · ' + String(progressPercent) + '%' : String(progressPercent) + '%'
        };
      };
      window.stationCatReaderBookmarks = {
        init: initializeBookmarkAnchors,
        restore: restoreBookmarkPosition
      };
      initializeBookmarkAnchors(getReaderBody(), { restore: true });
      window.addEventListener('load', () => initializeBookmarkAnchors(getReaderBody(), { restore: true }), { once: true });
      window.addEventListener('pagehide', clearBookmarkToastTimer, { once: true });
      const saveBookmark = async () => {
        if (getBookmarkButtons().some((button) => button.disabled)) return;
        setBookmarkButtonsDisabled(true);
        setBookmarkStatus(bookmarkCopy.saving, 'neutral');
        const bookmarkPosition = currentBookmarkPosition();
        try {
          const response = await fetch('/api/readers/bookmarks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...bookmarkData,
              metadata: {
                anchorId: bookmarkPosition.anchorId,
                blockIndex: bookmarkPosition.blockIndex
              },
              progressPercent: bookmarkPosition.progressPercent,
              positionLabel: bookmarkPosition.positionLabel,
              sourcePath: bookmarkPosition.sourcePath
            })
          });
          const data = await response.json();
          if (!response.ok || !data.ok) {
            if (data.code === 'SIGN_IN_REQUIRED') {
              setBookmarkStatus(bookmarkCopy.signInRequired, 'error');
              window.location.href = '/library/?returnTo=' + encodeURIComponent(window.location.pathname);
              return;
            }
            throw new Error(data.message || bookmarkCopy.failed);
          }
          setBookmarkStatus(bookmarkCopy.saved, 'success');
          window.stationCatReadingEvents?.track?.('bookmark', {
            blockIndex: bookmarkPosition.blockIndex,
            progressPercent: bookmarkPosition.progressPercent,
            value: bookmarkPosition.progressPercent,
            metadata: {
              anchorId: bookmarkPosition.anchorId,
              sourcePath: bookmarkPosition.sourcePath
            }
          });
        } catch (error) {
          setBookmarkStatus(error.message || bookmarkCopy.failed, 'error');
        } finally {
          setBookmarkButtonsDisabled(false);
        }
      };
      document.addEventListener('click', (event) => {
        const trigger = event.target instanceof HTMLElement
          ? event.target.closest('[data-reader-bookmark-save]')
          : null;
        if (!trigger) return;
        event.preventDefault();
        saveBookmark();
      });
      window.addEventListener('keydown', (event) => {
        if (event.isComposing) return;
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.key.toLowerCase() !== 'b') return;
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        saveBookmark();
      });
    })();
  </script>`;
};

const renderDynamicNovelSeries = (route, serial, body, chapters, paymentSettings = null) => {
  const copy = dynamicContentCopy[route.locale];
  const firstChapter = chapters[0];
  const latestChapter = chapters[chapters.length - 1];
  const summary = firstPlainSummary([serial.subtitle, serial.description, serial.excerpt], 420);
  const fallbackBody = firstPlainSummary([serial.excerpt, serial.description], 1200);
  const accessSummary = getDynamicSeriesAccessSummary(serial.access_level, route.locale, paymentSettings);
  return `<section class="hero hero--novel">
      <div class="hero-copy">
        <p class="kicker">${escapeHtml(copy.status)}</p>
        <h1>${escapeHtml(serial.title)}</h1>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
        <div class="meta">
          <span class="pill">${escapeHtml(copy.author)}: ${escapeHtml(serial.author_name || 'Station Cat')}</span>
          <span>${escapeHtml(copy.access)}: ${escapeHtml(accessSummary)}</span>
        </div>
        <div class="button-row">
          ${firstChapter ? `<a class="button button-primary" href="${escapeHtml(dynamicChapterPath(route, serial.slug, firstChapter.slug))}">${escapeHtml(copy.readFirst)}</a>` : ''}
          ${latestChapter && latestChapter.slug !== firstChapter?.slug ? `<a class="button button-secondary" href="${escapeHtml(dynamicChapterPath(route, serial.slug, latestChapter.slug))}">${escapeHtml(copy.readLatest)}</a>` : ''}
          <a class="button button-secondary" href="${escapeHtml(route.basePath)}">${escapeHtml(copy.allSerials)}</a>
        </div>
      </div>
      ${renderDynamicCover(serial, { variant: 'book' })}
    </section>
    <section class="section">
      <div class="prose">${body.html || `<p>${escapeHtml(fallbackBody)}</p>`}</div>
    </section>
    <section class="section">
      <p class="kicker">${escapeHtml(copy.chapters)}</p>
      <div class="chapter-list-shell" data-chapter-pagination-root data-chapters-per-page="${DYNAMIC_CHAPTERS_PER_PAGE}">
        <div class="grid chapter-list" data-chapter-pagination-list>${renderChapterCards(route, chapters, paymentSettings)}</div>
        ${renderChapterPagination(chapters)}
      </div>
      ${renderChapterPaginationScript(chapters)}
    </section>`;
};

const renderDynamicNovelChapter = (route, serial, chapter, body, chapters, paymentSettings) => {
  const copy = dynamicContentCopy[route.locale];
  const paymentCopy = dynamicPaymentCopy[route.locale];
  const currentIndex = chapters.findIndex((entry) => entry.slug === chapter.slug);
  const previousChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex >= 0 ? chapters[currentIndex + 1] : null;
  const effectiveAccessLevel = getEffectiveDynamicChapterAccessLevel(chapter, paymentSettings, currentIndex);
  const effectiveChapter = { ...chapter, access_level: effectiveAccessLevel };
  const isProtected = effectiveAccessLevel !== 'free';
  const bookmarkCopy = dynamicBookmarkCopy[route.locale] || dynamicBookmarkCopy['zh-Hant'];
  const fallbackBody = firstPlainSummary([chapter.excerpt, chapter.description], 1200);
  const content = isProtected
    ? `<section class="gate" data-serial-access-gate data-series-slug="${escapeHtml(chapter.parent_slug)}" data-chapter-slug="${escapeHtml(chapter.slug)}" data-access="${escapeHtml(effectiveAccessLevel)}" data-locale="${escapeHtml(route.locale)}" data-return-path="${escapeHtml(dynamicCanonicalPath(route))}">
        <p class="kicker">${escapeHtml(getDynamicAccessLabel(effectiveAccessLevel, route.locale))}</p>
        <h2>${escapeHtml(copy.lockedTitle)}</h2>
        <p>${escapeHtml(copy.lockedBody)}</p>
        <div class="status" data-serial-access-status>${escapeHtml(paymentCopy.checking)}</div>
        <div class="status" data-serial-credit-status></div>
        ${renderDynamicUnlockButtons(route, serial, effectiveChapter, paymentSettings)}
      </section>
      <article class="prose prose--reader prose--protected" data-protected-chapter-body data-reader-body hidden></article>
      <script>
        (() => {
          const gate = document.querySelector('[data-serial-access-gate]');
          const status = gate?.querySelector('[data-serial-access-status]');
          const creditStatus = gate?.querySelector('[data-serial-credit-status]');
          const body = document.querySelector('[data-protected-chapter-body]');
          const unlockButtons = gate ? Array.from(gate.querySelectorAll('[data-serial-unlock]')) : [];
          const creditUnlockButton = gate?.querySelector('[data-serial-credit-unlock]');
          const setStatus = (message, tone = 'neutral') => {
            if (!status) return;
            status.textContent = message;
            status.dataset.tone = tone;
          };
          const setCreditStatus = (message, tone = 'neutral') => {
            if (!creditStatus) return;
            creditStatus.textContent = message;
            creditStatus.dataset.tone = tone;
          };
          const setButtonsDisabled = (disabled) => {
            unlockButtons.forEach((button) => {
              button.disabled = disabled;
            });
            if (creditUnlockButton) creditUnlockButton.disabled = disabled;
          };
          const loadProtectedContent = async () => {
            if (!gate || !body) return;
            setStatus(${JSON.stringify(paymentCopy.allowed)}, 'success');
            const contentParams = new URLSearchParams({
              chapter: gate.dataset.chapterSlug,
              locale: gate.dataset.locale,
              series: gate.dataset.seriesSlug
            });
            const response = await fetch('/api/novels/chapters/protected-content?' + contentParams.toString());
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.message || ${JSON.stringify(paymentCopy.contentFailed)});
            body.innerHTML = payload.content.html;
            body.hidden = false;
            window.stationCatReaderBookmarks?.init?.(body, { restore: true });
            window.stationCatReadingEvents?.openWhenReady?.();
            body.classList.add('prose--ready');
            gate.hidden = true;
          };
          const checkAccess = async () => {
            if (!gate) return;
            const accessParams = new URLSearchParams({
              access: gate.dataset.access,
              chapter: gate.dataset.chapterSlug,
              series: gate.dataset.seriesSlug
            });
            const response = await fetch('/api/novels/access?' + accessParams.toString());
            const access = await response.json();
            if (!response.ok || !access.ok) throw new Error(access.message || ${JSON.stringify(paymentCopy.denied)});
            if (access.allowed) {
              setButtonsDisabled(true);
              await loadProtectedContent();
              return;
            }
            setStatus(access.authenticated ? ${JSON.stringify(paymentCopy.denied)} : ${JSON.stringify(copy.lockedBody)}, access.authenticated ? 'error' : 'neutral');
          };
          if (creditUnlockButton) {
            creditUnlockButton.addEventListener('click', async () => {
              if (!gate) return;
              setButtonsDisabled(true);
              setCreditStatus(${JSON.stringify(paymentCopy.checking)}, 'neutral');
              try {
                const response = await fetch('/api/novels/credits/unlock', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    seriesSlug: gate.dataset.seriesSlug,
                    chapterSlug: gate.dataset.chapterSlug,
                    access: gate.dataset.access,
                    locale: gate.dataset.locale
                  })
                });
                const payload = await response.json();
                if (!response.ok || !payload.ok) {
                  if (payload.code === 'SIGN_IN_REQUIRED') {
                    window.location.href = '/library/?returnTo=' + encodeURIComponent(window.location.pathname);
                    return;
                  }
                  if (payload.code === 'INSUFFICIENT_CREDITS') throw new Error(${JSON.stringify(paymentCopy.creditInsufficient)});
                  throw new Error(payload.message || ${JSON.stringify(paymentCopy.failed)});
                }
                await loadProtectedContent();
              } catch (error) {
                setCreditStatus(error.message || ${JSON.stringify(paymentCopy.failed)}, 'error');
                setButtonsDisabled(false);
              }
            });
          }
          unlockButtons.forEach((button) => {
            button.addEventListener('click', async () => {
              if (!gate) return;
              setButtonsDisabled(true);
              setStatus(${JSON.stringify(paymentCopy.checking)}, 'neutral');
              const orderType = button.dataset.orderType || 'chapter';
              const checkoutPayload = {
                orderType,
                seriesSlug: gate.dataset.seriesSlug,
                chapterSlug: gate.dataset.chapterSlug,
                locale: gate.dataset.locale,
                returnPath: gate.dataset.returnPath
              };
              if (orderType === ${JSON.stringify(novelBundleOrderType)}) {
                checkoutPayload.bundleChapters = button.dataset.bundleChapters;
                checkoutPayload.chapterSlugs = String(button.dataset.chapterSlugs || '').split(',').map((slug) => slug.trim()).filter(Boolean);
              }
              try {
                const response = await fetch(${JSON.stringify(novelCheckoutPath)}, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(checkoutPayload)
                });
                const payload = await response.json();
                if (!response.ok || !payload.ok) {
                  if (payload.code === 'SIGN_IN_REQUIRED') {
                    window.location.href = '/library/?returnTo=' + encodeURIComponent(window.location.pathname);
                    return;
                  }
                  if (payload.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED') throw new Error(${JSON.stringify(paymentCopy.disabled)});
                  throw new Error(payload.message || ${JSON.stringify(paymentCopy.failed)});
                }
                if (!payload.paymentUrl) throw new Error(${JSON.stringify(paymentCopy.failed)});
                setStatus(${JSON.stringify(paymentCopy.opening)}, 'success');
                window.location.href = payload.paymentUrl;
              } catch (error) {
                setStatus(error.message || ${JSON.stringify(paymentCopy.failed)}, 'error');
                setButtonsDisabled(false);
              }
            });
          });
          checkAccess().catch((error) => setStatus(error.message || ${JSON.stringify(paymentCopy.contentFailed)}, 'error'));
        })();
      </script>`
    : `<article class="prose prose--reader" data-reader-body>${body.html || `<p>${escapeHtml(fallbackBody)}</p>`}</article>`;

  return `<article class="section">
      <a class="text-link" href="${escapeHtml(dynamicSeriesPath(route, serial.slug))}">${escapeHtml(copy.backSeries)}</a>
      <header class="hero hero--chapter">
        <div class="meta">
          <span>${escapeHtml(copy.access)}: ${escapeHtml(getDynamicAccessLabel(effectiveAccessLevel, route.locale))}</span>
          ${chapter.word_count ? `<span>${escapeHtml(String(chapter.word_count))} ${escapeHtml(copy.words)}</span>` : ''}
        </div>
        <h1>${escapeHtml(chapter.title)}</h1>
      </header>
      ${content}
      <footer class="section">
        ${renderDynamicReadingEventsScript(route, serial, chapter)}
        ${renderDynamicReaderInteractions(route, serial, chapter)}
        <div class="button-row">
          ${previousChapter ? `<a class="button button-secondary" href="${escapeHtml(dynamicChapterPath(route, serial.slug, previousChapter.slug))}" data-reader-nav="prev">${escapeHtml(copy.previousChapter)}</a>` : `<a class="button button-secondary" href="${escapeHtml(dynamicSeriesPath(route, serial.slug))}">${escapeHtml(copy.backSeries)}</a>`}
          ${nextChapter ? `<a class="button button-primary" href="${escapeHtml(dynamicChapterPath(route, serial.slug, nextChapter.slug))}" data-reader-nav="next">${escapeHtml(copy.nextChapter)}</a>` : previousChapter ? `<a class="button button-primary" href="${escapeHtml(dynamicSeriesPath(route, serial.slug))}">${escapeHtml(copy.backSeries)}</a>` : ''}
          <button class="button button-secondary" type="button" data-reader-bookmark-save aria-keyshortcuts="B" title="${escapeHtml(bookmarkCopy.shortcutTitle)}">${escapeHtml(bookmarkCopy.save)}</button>
        </div>
        <div class="reader-status serial-bookmark-status" data-reader-bookmark-status role="status" aria-live="polite"></div>
      </footer>
      <button class="button button-primary reader-bookmark-fab" type="button" data-reader-bookmark-save aria-label="${escapeHtml(bookmarkCopy.save)}" aria-keyshortcuts="B" title="${escapeHtml(bookmarkCopy.shortcutTitle)}">${escapeHtml(bookmarkCopy.save)}</button>
      <div class="status reader-bookmark-toast" data-reader-bookmark-toast role="status" aria-live="polite" hidden></div>
      ${renderDynamicBookmarkScript(route, serial, chapter)}
    </article>`;
};

const handleDynamicFrontendContent = async (request, env) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const route = parseDynamicContentRoute(url.pathname);
  if (!route) return null;
  if (route.kind === 'devlog-index' || (route.kind === 'novel-index' && route.locale === 'zh-Hant')) return null;

  const db = env.WAITLIST_DB;
  if (!db || !(await ensureContentTablesReady(db))) return null;

  if (route.kind === 'signal-index') {
    const rows = await listPublishedContentEntries(db, { entryType: 'signal_brief', locale: route.locale, limit: 50 });
    const signalRows = request.method === 'HEAD' ? rows : await hydrateSignalIndexRows(env, rows);
    const copy = dynamicContentCopy[route.locale] || dynamicContentCopy['zh-Hant'];
    return dynamicHtmlResponse(request, {
      body: renderDynamicSignalIndex(route, signalRows),
      canonicalPath: dynamicCanonicalPath(route),
      description: copy.signalDescription,
      lang: route.locale,
      pageKind: 'signal',
      title: copy.signalTitle
    });
  }

  if (route.kind === 'signal-brief' || route.kind === 'signal-card') {
    const brief = await getPublishedContentEntry(db, {
      entryType: 'signal_brief',
      locale: route.locale,
      slug: route.slug
    });
    if (!brief) return null;

    if (route.kind === 'signal-card') {
      const body = request.method === 'HEAD' ? { markdown: '' } : await readPublicEntryBody(env, brief, { preferMarkdown: true });
      const cardBrief = body.markdown ? { ...brief, signalMarkdown: body.markdown } : brief;
      return new Response(request.method === 'HEAD' ? null : renderSignalShareCardSvg(route, cardBrief), {
        headers: {
          'cache-control': 'public, max-age=300',
          'content-type': 'image/svg+xml; charset=utf-8',
          'x-content-type-options': 'nosniff'
        }
      });
    }

    const body = await readPublicEntryBody(env, brief, { preferMarkdown: true });
    const navigation = await getAdjacentPublishedSignalBriefs(db, brief, route.locale);
    return dynamicHtmlResponse(request, {
      body: renderDynamicSignalBrief(route, brief, body, navigation),
      canonicalPath: dynamicCanonicalPath(route),
      description: firstPlainSummary([brief.description, brief.excerpt], 260),
      lang: route.locale,
      ogImage: dynamicSignalCardPath(route, brief.slug),
      pageKind: 'signal',
      title: brief.title
    });
  }

  if (route.kind === 'novel-index') {
    const seriesRows = await listPublishedContentEntries(db, { entryType: 'novel_series', locale: route.locale, limit: 100 });
    return dynamicHtmlResponse(request, {
      body: renderDynamicNovelIndex(route, seriesRows),
      canonicalPath: dynamicCanonicalPath(route),
      description: dynamicContentCopy[route.locale]?.serialsDescription || dynamicContentCopy['zh-Hant'].serialsDescription,
      lang: route.locale,
      title: dynamicContentCopy[route.locale]?.serialsTitle || dynamicContentCopy['zh-Hant'].serialsTitle
    });
  }

  if (route.kind === 'devlog-post') {
    const post = await getPublishedContentEntry(db, { entryType: 'blog_post', locale: route.locale, slug: route.slug });
    if (!post) return null;
    const body = await readPublicEntryBody(env, post);
    return dynamicHtmlResponse(request, {
      body: renderDynamicDevlogPost(route, post, body),
      canonicalPath: dynamicCanonicalPath(route),
      description: firstPlainSummary([post.description, post.excerpt], 260),
      lang: route.locale,
      title: post.title
    });
  }

  if (route.kind === 'novel-series') {
    const serial = await getPublishedContentEntry(db, { entryType: 'novel_series', locale: route.locale, slug: route.seriesSlug });
    if (!serial) return null;
    const [body, chapters, paymentSettings] = await Promise.all([
      readPublicEntryBody(env, serial),
      listPublishedContentEntries(db, { entryType: 'novel_chapter', locale: route.locale, parentSlug: serial.slug, limit: 100 }),
      resolveSeriesPaymentSettings(db, serial.slug, env, { locale: route.locale })
    ]);
    return dynamicHtmlResponse(request, {
      body: renderDynamicNovelSeries(route, serial, body, chapters, paymentSettings),
      canonicalPath: dynamicCanonicalPath(route),
      description: firstPlainSummary([serial.description, serial.excerpt], 260),
      lang: route.locale,
      title: serial.title
    });
  }

  if (route.kind === 'novel-chapter') {
    const [serial, chapter] = await Promise.all([
      getPublishedContentEntry(db, { entryType: 'novel_series', locale: route.locale, slug: route.seriesSlug }),
      getPublishedContentEntry(db, {
        entryType: 'novel_chapter',
        locale: route.locale,
        parentSlug: route.seriesSlug,
        slug: route.chapterSlug
      })
    ]);
    if (!serial || !chapter) return null;
    const [body, chapters, paymentSettings] = await Promise.all([
      readPublicEntryBody(env, chapter),
      listPublishedContentEntries(db, { entryType: 'novel_chapter', locale: route.locale, parentSlug: route.seriesSlug, limit: 100 }),
      resolveSeriesPaymentSettings(db, route.seriesSlug, env, { chapterSlug: route.chapterSlug, locale: route.locale })
    ]);
    return dynamicHtmlResponse(request, {
      body: renderDynamicNovelChapter(route, serial, chapter, body, chapters, paymentSettings),
      canonicalPath: dynamicCanonicalPath(route),
      description: firstPlainSummary([chapter.description, chapter.excerpt], 260),
      lang: route.locale,
      title: `${chapter.title} | ${serial.title}`
    });
  }

  return null;
};

const downloadFiles = {
  '/downloads/privatepinyin/PrivatePinyin-0.1.29.pkg': {
    key: 'privatepinyin/0.1.29/PrivatePinyin-0.1.29.pkg',
    filename: 'PrivatePinyin-0.1.29.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.29-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.28.pkg': {
    key: 'privatepinyin/0.1.28/PrivatePinyin-0.1.28.pkg',
    filename: 'PrivatePinyin-0.1.28.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.28-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.27.pkg': {
    key: 'privatepinyin/0.1.27/PrivatePinyin-0.1.27.pkg',
    filename: 'PrivatePinyin-0.1.27.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.27-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.26.pkg': {
    key: 'privatepinyin/0.1.26/PrivatePinyin-0.1.26.pkg',
    filename: 'PrivatePinyin-0.1.26.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.26-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.25.pkg': {
    key: 'privatepinyin/0.1.25/PrivatePinyin-0.1.25.pkg',
    filename: 'PrivatePinyin-0.1.25.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.25-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.24.pkg': {
    key: 'privatepinyin/0.1.24/PrivatePinyin-0.1.24.pkg',
    filename: 'PrivatePinyin-0.1.24.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.24-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.25-setup.exe': {
    key: 'privatepinyin/0.1.25/PrivatePinyin-0.1.25-setup.exe',
    filename: 'PrivatePinyin-0.1.25-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.25-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.24-setup.exe': {
    key: 'privatepinyin/0.1.24/PrivatePinyin-0.1.24-setup.exe',
    filename: 'PrivatePinyin-0.1.24-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.24-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.23-setup.exe': {
    key: 'privatepinyin/0.1.23/PrivatePinyin-0.1.23-setup.exe',
    filename: 'PrivatePinyin-0.1.23-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.23-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.23.pkg': {
    key: 'privatepinyin/0.1.23/PrivatePinyin-0.1.23.pkg',
    filename: 'PrivatePinyin-0.1.23.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.23-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.20-setup.exe': {
    key: 'privatepinyin/0.1.20/PrivatePinyin-0.1.20-setup.exe',
    filename: 'PrivatePinyin-0.1.20-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.20-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.22.pkg': {
    key: 'privatepinyin/0.1.22/PrivatePinyin-0.1.22.pkg',
    filename: 'PrivatePinyin-0.1.22.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.22-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.21.pkg': {
    key: 'privatepinyin/0.1.21/PrivatePinyin-0.1.21.pkg',
    filename: 'PrivatePinyin-0.1.21.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.21-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.18.pkg': {
    key: 'privatepinyin/0.1.18/PrivatePinyin-0.1.18.pkg',
    filename: 'PrivatePinyin-0.1.18.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.18-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.17.pkg': {
    key: 'privatepinyin/0.1.17/PrivatePinyin-0.1.17.pkg',
    filename: 'PrivatePinyin-0.1.17.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.17-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.13-setup.exe': {
    key: 'privatepinyin/0.1.13/PrivatePinyin-0.1.13-setup.exe',
    filename: 'PrivatePinyin-0.1.13-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.13-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.16.pkg': {
    key: 'privatepinyin/0.1.16/PrivatePinyin-0.1.16.pkg',
    filename: 'PrivatePinyin-0.1.16.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.16-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.15.pkg': {
    key: 'privatepinyin/0.1.15/PrivatePinyin-0.1.15.pkg',
    filename: 'PrivatePinyin-0.1.15.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.15-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.13.pkg': {
    key: 'privatepinyin/0.1.13/PrivatePinyin-0.1.13.pkg',
    filename: 'PrivatePinyin-0.1.13.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.13-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.12.pkg': {
    key: 'privatepinyin/0.1.12/PrivatePinyin-0.1.12.pkg',
    filename: 'PrivatePinyin-0.1.12.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.12-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.12-setup.exe': {
    key: 'privatepinyin/0.1.12/PrivatePinyin-0.1.12-setup.exe',
    filename: 'PrivatePinyin-0.1.12-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.12-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.11-setup.exe': {
    key: 'privatepinyin/0.1.11/PrivatePinyin-0.1.11-setup.exe',
    filename: 'PrivatePinyin-0.1.11-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.11-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.10-setup.exe': {
    key: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10-setup.exe',
    filename: 'PrivatePinyin-0.1.10-setup.exe',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.10-setup-exe'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.11.msi': {
    key: 'privatepinyin/0.1.11/PrivatePinyin-0.1.11.msi',
    filename: 'PrivatePinyin-0.1.11.msi',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.11-msi'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.11.zip': {
    key: 'privatepinyin/0.1.11/PrivatePinyin-0.1.11.zip',
    filename: 'PrivatePinyin-0.1.11.zip',
    contentType: 'application/zip',
    limitKey: 'privatepinyin-0.1.11-zip'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.10.pkg': {
    key: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10.pkg',
    filename: 'PrivatePinyin-0.1.10.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.10-pkg'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.10.msi': {
    key: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10.msi',
    filename: 'PrivatePinyin-0.1.10.msi',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.10-msi'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.10.zip': {
    key: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10.zip',
    filename: 'PrivatePinyin-0.1.10.zip',
    contentType: 'application/zip',
    limitKey: 'privatepinyin-0.1.10-zip'
  },
  '/downloads/privatepinyin/PrivatePinyin-0.1.9.pkg': {
    key: 'privatepinyin/0.1.9/PrivatePinyin-0.1.9.pkg',
    filename: 'PrivatePinyin-0.1.9.pkg',
    contentType: 'application/octet-stream',
    limitKey: 'privatepinyin-0.1.9-pkg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.24-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.24-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.24-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.24-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.24-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.19-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.19-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.19-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.19-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.19-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.18-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.18-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.dmg.blockmap': {
    key: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.dmg.blockmap',
    filename: 'SimpleCut-Pro-0.1.18-mac-arm64.dmg.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.18-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.18-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.18-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.16-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.16-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.16-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.16-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.16-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.14-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.14-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.dmg.blockmap': {
    key: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.dmg.blockmap',
    filename: 'SimpleCut-Pro-0.1.14-mac-arm64.dmg.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.14-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.14-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.14-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.13-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.13-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.dmg.blockmap': {
    key: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.dmg.blockmap',
    filename: 'SimpleCut-Pro-0.1.13-mac-arm64.dmg.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.13-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.13-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.13-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.11-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.11-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.dmg.blockmap': {
    key: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.dmg.blockmap',
    filename: 'SimpleCut-Pro-0.1.11-mac-arm64.dmg.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.11-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.11-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.11-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.10-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.10-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.dmg.blockmap': {
    key: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.dmg.blockmap',
    filename: 'SimpleCut-Pro-0.1.10-mac-arm64.dmg.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.10-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.10-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.10-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.7-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.7/SimpleCut-Pro-0.1.7-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.7-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.7-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.7-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.7/SimpleCut-Pro-0.1.7-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.7-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.7-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.7-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.7/SimpleCut-Pro-0.1.7-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.7-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.6-mac-arm64.dmg': {
    key: 'simplecut-pro/0.1.6/SimpleCut-Pro-0.1.6-mac-arm64.dmg',
    filename: 'SimpleCut-Pro-0.1.6-mac-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'simplecut-pro-0.1.6-mac-arm64-dmg'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.6-mac-arm64.zip': {
    key: 'simplecut-pro/0.1.6/SimpleCut-Pro-0.1.6-mac-arm64.zip',
    filename: 'SimpleCut-Pro-0.1.6-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'simplecut-pro-0.1.6-mac-arm64-zip'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.6-mac-arm64.zip.blockmap': {
    key: 'simplecut-pro/0.1.6/SimpleCut-Pro-0.1.6-mac-arm64.zip.blockmap',
    filename: 'SimpleCut-Pro-0.1.6-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/latest-mac.yml': {
    key: 'simplecut-pro/0.1.24/latest-mac.yml',
    filename: 'latest-mac.yml',
    contentType: 'text/yaml; charset=utf-8',
    cacheControl: 'public, max-age=60'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-win-x64.exe': {
    key: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.24-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.24-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.24-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-win-x64.exe': {
    key: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.19-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.19-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.19-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-win-x64.exe': {
    key: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.18-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.18-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.18-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-win-x64.exe': {
    key: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.16-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.16-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.16-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-win-x64.exe': {
    key: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.14-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.14-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.14-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-win-x64.exe': {
    key: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.13-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.13-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.13-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-win-x64.exe': {
    key: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.11-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.11-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.11-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-win-x64.exe': {
    key: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.10-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.10-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.10-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.7-win-x64.exe': {
    key: 'simplecut-pro/0.1.7/SimpleCut-Pro-0.1.7-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.7-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.7-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.7-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.7/SimpleCut-Pro-0.1.7-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.7-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.6-win-x64.exe': {
    key: 'simplecut-pro/0.1.6/SimpleCut-Pro-0.1.6-win-x64.exe',
    filename: 'SimpleCut-Pro-0.1.6-win-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'simplecut-pro-0.1.6-win-x64-exe'
  },
  '/downloads/simplecut-pro/SimpleCut-Pro-0.1.6-win-x64.exe.blockmap': {
    key: 'simplecut-pro/0.1.6/SimpleCut-Pro-0.1.6-win-x64.exe.blockmap',
    filename: 'SimpleCut-Pro-0.1.6-win-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/simplecut-pro/latest.yml': {
    key: 'simplecut-pro/0.1.24/latest.yml',
    filename: 'latest.yml',
    contentType: 'text/yaml; charset=utf-8',
    cacheControl: 'public, max-age=60'
  },
  '/downloads/nodepilot/NodePilot-latest-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-arm64.dmg',
    filename: 'NodePilot-0.2.26-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.26-arm64',
    cacheControl: 'public, max-age=60, must-revalidate'
  },
  '/downloads/anytls-desktop-manager/NodePilot-latest-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-arm64.dmg',
    filename: 'NodePilot-0.2.26-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.26-arm64',
    cacheControl: 'public, max-age=60, must-revalidate'
  },
  '/downloads/nodepilot/NodePilot-0.2.26-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-arm64.dmg',
    filename: 'NodePilot-0.2.26-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.26-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.26-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-arm64.dmg',
    filename: 'NodePilot-0.2.26-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.26-arm64'
  },
  '/downloads/nodepilot/NodePilot-0.2.26-arm64.dmg.blockmap': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-arm64.dmg.blockmap',
    filename: 'NodePilot-0.2.26-arm64.dmg.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.26-arm64.dmg.blockmap': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-arm64.dmg.blockmap',
    filename: 'NodePilot-0.2.26-arm64.dmg.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/nodepilot/NodePilot-0.2.18-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-arm64.dmg',
    filename: 'NodePilot-0.2.18-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.18-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.18-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-arm64.dmg',
    filename: 'NodePilot-0.2.18-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.18-arm64'
  },
  '/downloads/nodepilot/NodePilot-latest-mac-arm64.zip': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-mac-arm64.zip',
    filename: 'NodePilot-0.2.26-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.26-mac-arm64-zip'
  },
  '/downloads/anytls-desktop-manager/NodePilot-latest-mac-arm64.zip': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-mac-arm64.zip',
    filename: 'NodePilot-0.2.26-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.26-mac-arm64-zip'
  },
  '/downloads/nodepilot/NodePilot-0.2.26-mac-arm64.zip': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-mac-arm64.zip',
    filename: 'NodePilot-0.2.26-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.26-mac-arm64-zip'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.26-mac-arm64.zip': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-mac-arm64.zip',
    filename: 'NodePilot-0.2.26-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.26-mac-arm64-zip'
  },
  '/downloads/nodepilot/NodePilot-0.2.26-mac-arm64.zip.blockmap': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-mac-arm64.zip.blockmap',
    filename: 'NodePilot-0.2.26-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.26-mac-arm64.zip.blockmap': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-0.2.26-mac-arm64.zip.blockmap',
    filename: 'NodePilot-0.2.26-mac-arm64.zip.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/nodepilot/latest-mac.yml': {
    key: 'anytls-desktop-manager/0.2.26/latest-mac.yml',
    filename: 'latest-mac.yml',
    contentType: 'text/yaml; charset=utf-8',
    cacheControl: 'public, max-age=60'
  },
  '/downloads/anytls-desktop-manager/latest-mac.yml': {
    key: 'anytls-desktop-manager/0.2.26/latest-mac.yml',
    filename: 'latest-mac.yml',
    contentType: 'text/yaml; charset=utf-8',
    cacheControl: 'public, max-age=60'
  },
  '/downloads/nodepilot/NodePilot-0.2.18-mac-arm64.zip': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-mac-arm64.zip',
    filename: 'NodePilot-0.2.18-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.18-mac-arm64-zip'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.18-mac-arm64.zip': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-mac-arm64.zip',
    filename: 'NodePilot-0.2.18-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.18-mac-arm64-zip'
  },
  '/downloads/nodepilot/NodePilot-0.2.17-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.17/NodePilot-0.2.17-arm64.dmg',
    filename: 'NodePilot-0.2.17-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.17-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.17-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.17/NodePilot-0.2.17-arm64.dmg',
    filename: 'NodePilot-0.2.17-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.17-arm64'
  },
  '/downloads/nodepilot/NodePilot-0.2.16-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.16/NodePilot-0.2.16-arm64.dmg',
    filename: 'NodePilot-0.2.16-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.16-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.16-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.16/NodePilot-0.2.16-arm64.dmg',
    filename: 'NodePilot-0.2.16-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.16-arm64'
  },
  '/downloads/nodepilot/NodePilot-0.2.13-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.13/NodePilot-0.2.13-arm64.dmg',
    filename: 'NodePilot-0.2.13-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.13-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.13-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.13/NodePilot-0.2.13-arm64.dmg',
    filename: 'NodePilot-0.2.13-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.13-arm64'
  },
  '/downloads/nodepilot/NodePilot-0.2.12-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.12/NodePilot-0.2.12-arm64.dmg',
    filename: 'NodePilot-0.2.12-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.12-arm64'
  },
  '/downloads/nodepilot/NodePilot-Setup-latest-x64.exe': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-Setup-0.2.26-x64.exe',
    filename: 'NodePilot-Setup-0.2.26-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.26-x64',
    cacheControl: 'public, max-age=60, must-revalidate'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-latest-x64.exe': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-Setup-0.2.26-x64.exe',
    filename: 'NodePilot-Setup-0.2.26-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.26-x64',
    cacheControl: 'public, max-age=60, must-revalidate'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.26-x64.exe': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-Setup-0.2.26-x64.exe',
    filename: 'NodePilot-Setup-0.2.26-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.26-x64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.26-x64.exe': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-Setup-0.2.26-x64.exe',
    filename: 'NodePilot-Setup-0.2.26-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.26-x64'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.26-x64.exe.blockmap': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-Setup-0.2.26-x64.exe.blockmap',
    filename: 'NodePilot-Setup-0.2.26-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.26-x64.exe.blockmap': {
    key: 'anytls-desktop-manager/0.2.26/NodePilot-Setup-0.2.26-x64.exe.blockmap',
    filename: 'NodePilot-Setup-0.2.26-x64.exe.blockmap',
    contentType: 'application/octet-stream'
  },
  '/downloads/nodepilot/latest.yml': {
    key: 'anytls-desktop-manager/0.2.26/latest.yml',
    filename: 'latest.yml',
    contentType: 'text/yaml; charset=utf-8',
    cacheControl: 'public, max-age=60'
  },
  '/downloads/anytls-desktop-manager/latest.yml': {
    key: 'anytls-desktop-manager/0.2.26/latest.yml',
    filename: 'latest.yml',
    contentType: 'text/yaml; charset=utf-8',
    cacheControl: 'public, max-age=60'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.18-x64.exe': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-Setup-0.2.18-x64.exe',
    filename: 'NodePilot-Setup-0.2.18-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.18-x64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.18-x64.exe': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-Setup-0.2.18-x64.exe',
    filename: 'NodePilot-Setup-0.2.18-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.18-x64'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.17-x64.exe': {
    key: 'anytls-desktop-manager/0.2.17/NodePilot-Setup-0.2.17-x64.exe',
    filename: 'NodePilot-Setup-0.2.17-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.17-x64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.17-x64.exe': {
    key: 'anytls-desktop-manager/0.2.17/NodePilot-Setup-0.2.17-x64.exe',
    filename: 'NodePilot-Setup-0.2.17-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.17-x64'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.16-x64.exe': {
    key: 'anytls-desktop-manager/0.2.16/NodePilot-Setup-0.2.16-x64.exe',
    filename: 'NodePilot-Setup-0.2.16-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.16-x64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.16-x64.exe': {
    key: 'anytls-desktop-manager/0.2.16/NodePilot-Setup-0.2.16-x64.exe',
    filename: 'NodePilot-Setup-0.2.16-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.16-x64'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.13-x64.exe': {
    key: 'anytls-desktop-manager/0.2.13/NodePilot-Setup-0.2.13-x64.exe',
    filename: 'NodePilot-Setup-0.2.13-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.13-x64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.13-x64.exe': {
    key: 'anytls-desktop-manager/0.2.13/NodePilot-Setup-0.2.13-x64.exe',
    filename: 'NodePilot-Setup-0.2.13-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.13-x64'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.12-x64.exe': {
    key: 'anytls-desktop-manager/0.2.12/NodePilot-Setup-0.2.12-x64.exe',
    filename: 'NodePilot-Setup-0.2.12-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.12-x64'
  },
  '/downloads/anytls-desktop-manager/AnyTLS-Desktop-Manager-Setup-0.1.0-x64.exe': {
    key: 'anytls-desktop-manager/0.1.0/AnyTLS-Desktop-Manager-Setup-0.1.0-x64.exe',
    filename: 'AnyTLS-Desktop-Manager-Setup-0.1.0-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'anytls-desktop-manager-0.1.0-x64'
  },
  '/downloads/anytls-desktop-manager/AnyTLS-Desktop-Manager-0.2.0-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.0/AnyTLS-Desktop-Manager-0.2.0-arm64.dmg',
    filename: 'AnyTLS-Desktop-Manager-0.2.0-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'anytls-desktop-manager-0.2.0-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.8-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.8/NodePilot-0.2.8-arm64.dmg',
    filename: 'NodePilot-0.2.8-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.8-arm64'
  },
  '/downloads/nodepilot/NodePilot-0.2.8-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.8/NodePilot-0.2.8-arm64.dmg',
    filename: 'NodePilot-0.2.8-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.8-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.8-x64.exe': {
    key: 'anytls-desktop-manager/0.2.8/NodePilot-Setup-0.2.8-x64.exe',
    filename: 'NodePilot-Setup-0.2.8-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.8-x64'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.8-x64.exe': {
    key: 'anytls-desktop-manager/0.2.8/NodePilot-Setup-0.2.8-x64.exe',
    filename: 'NodePilot-Setup-0.2.8-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.8-x64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-0.2.9-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.9/NodePilot-0.2.9-arm64.dmg',
    filename: 'NodePilot-0.2.9-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.9-arm64'
  },
  '/downloads/nodepilot/NodePilot-0.2.9-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.9/NodePilot-0.2.9-arm64.dmg',
    filename: 'NodePilot-0.2.9-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.9-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-0.2.9-x64.exe': {
    key: 'anytls-desktop-manager/0.2.9/NodePilot-Setup-0.2.9-x64.exe',
    filename: 'NodePilot-Setup-0.2.9-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.9-x64'
  },
  '/downloads/nodepilot/NodePilot-Setup-0.2.9-x64.exe': {
    key: 'anytls-desktop-manager/0.2.9/NodePilot-Setup-0.2.9-x64.exe',
    filename: 'NodePilot-Setup-0.2.9-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.9-x64'
  }
};

const externalDownloadRedirects = {};

const downloadLimitConfig = {
  dailyLimit: 5,
  windowLimit: 2,
  windowSeconds: 600
};

const pageRedirects = {
  '/downloads/simplecut-pro': '/zh-hans/apps/simplecut-pro/download/',
  '/downloads/simplecut-pro/': '/zh-hans/apps/simplecut-pro/download/',
  '/apps/anytls-desktop-manager': '/apps/nodepilot/',
  '/apps/anytls-desktop-manager/': '/apps/nodepilot/',
  '/zh-hant/apps/anytls-desktop-manager': '/zh-hant/apps/nodepilot/',
  '/zh-hant/apps/anytls-desktop-manager/': '/zh-hant/apps/nodepilot/',
  '/zh-hans/apps/anytls-desktop-manager': '/zh-hans/apps/nodepilot/',
  '/zh-hans/apps/anytls-desktop-manager/': '/zh-hans/apps/nodepilot/',
  '/ja/apps/anytls-desktop-manager': '/ja/apps/nodepilot/',
  '/ja/apps/anytls-desktop-manager/': '/ja/apps/nodepilot/'
};

const getLegacyWorksRedirectPath = (pathname) => {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const segments = normalizedPath.split('/').filter(Boolean);
  if (!segments.length) return '';

  let offset = 0;
  if (pathSegmentLocales[segments[0]]) {
    offset = 1;
  }

  if (segments[offset] !== 'works') return '';

  const segmentCount = segments.length - offset;
  const seriesSlug = cleanSlug(segments[offset + 1] || '', 160);
  const chapterSlug = cleanSlug(segments[offset + 2] || '', 160);

  if (segmentCount === 1) return '/novel/';
  if (segmentCount === 2 && seriesSlug) return `/novel/${seriesSlug}/`;
  if (segmentCount === 3 && seriesSlug && chapterSlug) return `/novel/${seriesSlug}/chapter/${chapterSlug}/`;
  return '';
};

const rateLimitResponse = (message, retryAfterSeconds) =>
  new Response(message, {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': String(retryAfterSeconds),
      'cache-control': 'no-store'
    }
  });

const checkDownloadLimit = async (request, env, file) => {
  if (!file.limitKey || request.method === 'HEAD') {
    return null;
  }

  if (!env.WAITLIST_DB) {
    return null;
  }

  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const userAgent = cleanText(request.headers.get('user-agent'), 200);
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const windowKey = Math.floor(now.getTime() / 1000 / downloadLimitConfig.windowSeconds);
  const ipHash = await sha256Hex(`${ip}|${userAgent}`);
  const db = env.WAITLIST_DB;

  await db
    .prepare(
      `DELETE FROM download_rate_limits
       WHERE updated_at < datetime('now', '-14 days')`
    )
    .run();

  const existing = await db
    .prepare(
      `SELECT daily_count, window_count, window_key
       FROM download_rate_limits
       WHERE download_key = ? AND ip_hash = ? AND day_key = ?`
    )
    .bind(file.limitKey, ipHash, dayKey)
    .first();

  const dailyCount = Number(existing?.daily_count || 0);
  const windowCount = Number(existing?.window_key) === windowKey ? Number(existing?.window_count || 0) : 0;

  if (dailyCount >= downloadLimitConfig.dailyLimit) {
    return rateLimitResponse(
      'Daily download limit reached. Please try again tomorrow.',
      24 * 60 * 60
    );
  }

  if (windowCount >= downloadLimitConfig.windowLimit) {
    return rateLimitResponse(
      'Too many download attempts. Please wait a few minutes and try again.',
      downloadLimitConfig.windowSeconds
    );
  }

  await db
    .prepare(
      `INSERT INTO download_rate_limits (
        download_key, ip_hash, day_key, window_key, daily_count, window_count, updated_at
      )
      VALUES (?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(download_key, ip_hash, day_key) DO UPDATE SET
        daily_count = daily_count + 1,
        window_count = CASE
          WHEN window_key = excluded.window_key THEN window_count + 1
          ELSE 1
        END,
        window_key = excluded.window_key,
        updated_at = CURRENT_TIMESTAMP`
    )
    .bind(file.limitKey, ipHash, dayKey, windowKey)
    .run();

  return null;
};

const handleR2Download = async (request, env, file) => {
  if (!env.DOWNLOADS_BUCKET) {
    return new Response('Downloads bucket is not configured.', { status: 503 });
  }

  const limitResponse = await checkDownloadLimit(request, env, file);
  if (limitResponse) {
    return limitResponse;
  }

  const object = await env.DOWNLOADS_BUCKET.get(file.key);

  if (!object) {
    return new Response('Download file not found.', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', file.contentType);
  headers.set('content-disposition', `attachment; filename="${file.filename}"`);
  headers.set('cache-control', file.cacheControl || 'public, max-age=3600');
  headers.set('etag', object.httpEtag);

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
};

export const __readerTotpTestHooks = {
  aggregateNovelChapterStats,
  base32ToBytes,
  buildSignalDraftApprovalPayload,
  buildNovelAiInsightFromStats,
  buildNovelChapterStatsMetrics,
  beginSignalAutomationCron,
  bytesToBase32,
  contentEntryLegacyWorksPath,
  contentEntryNovelV2Path,
  contentEntryPublicPath,
  expireStaleSignalCollectionRuns,
  failSignalAutomationCron,
  findActiveSignalCollectionRun,
  getD1ChangeCount,
  getAdjacentPublishedSignalBriefs,
  getLegacyWorksRedirectPath,
  getSignalAutomationHealth,
  getReaderTotpResetLimitKeys,
  getReaderTotpResetIdentifierHash,
  getRequestClientHashes,
  getTotpStep,
  handleAdminAggregateNovelAnalytics,
  handleAdminGenerateNovelAiInsights,
  handleAdminGenerateSignalBriefDraft,
  handleAdminGetSignalBriefModelRollout,
  handleAdminImportSignalBrief,
  handleAdminListSignalBriefDrafts,
  handleAdminListSignalCandidates,
  handleAdminReviewSignalCandidates,
  handleAdminListSignalCollectionRuns,
  handleAdminGetSignalOperations,
  handleAdminManageSignalOperations,
  handleAdminManageSignalBriefModelRollout,
  handleAdminListSignalSources,
  handleAdminCollectSignalSources,
  handleAdminListNovelAiInsights,
  handleAdminListNovelAnalyticsStats,
  handleAdminListProductFeedback,
  handleAdminListReaderComments,
  handleAdminModerateReaderComment,
  handleAdminManageSignalBriefDraft,
  handleAdminUpdateProductFeedback,
  handleAdminSaveSignalSource,
  normalizeSignalCandidateReviewPayload,
  handleSignalCollectionQueue,
  handleSignalCollectionDeadLetterQueue,
  handleSignalCollectionSchedule,
  openSignalAutomationAlert,
  handleNovelForgeAnalytics,
  handleNovelForgeChapterContent,
  handleNovelForgeTranslationSync,
  handlePublicNovelComments,
  handleProductFeedbackSubmit,
  handleNovelReadingEvents,
  handleReaderCommentSubmit,
  handleReaderBookmarkDelete,
  handleReaderPasswordResetConfirm,
  hmacSha256Hex,
  hotpCode,
  dynamicCanonicalPath,
  dynamicChapterPath,
  dynamicHtmlShell,
  dynamicSignalCardPath,
  dynamicSignalPath,
  dynamicSeriesPath,
  normalizeTotpCode,
  normalizeReadingEventPayload,
  selectSignalCollectionSources,
  normalizeSignalAutomationSourcePayload,
  loadSignalCandidateMergePool,
  insertSignalCandidates,
  processSignalCollectionMessage,
  completeSignalCollectionTask,
  pruneSignalAutomationHistory,
  readerCommentToJson,
  productFeedbackToJson,
  parseNovelForgeAnalyticsRoute,
  parseNovelForgeChapterContentRoute,
  parseDynamicContentRoute,
  parseSignalMarkdownItems,
  parseSignalSourcesInput,
  renderSignalMarkdownToHtml,
  renderDynamicSignalBrief,
  renderDynamicSignalIndex,
  splitNovelTranslationChunks,
  readerTotpResetFailureMessage,
  readerTotpResetFailureThreshold,
  readerTotpResetLockedMessage,
  reserveReaderTotpResetAttempt,
  resolveSignalAutomationAlert,
  syncSignalRetrySuccessAlert,
  renderDynamicNovelSeries,
  renderDynamicNovelChapter,
  renderSignalShareCardSvg,
  sha256Hex,
  shouldSampleReaderTotpResetCleanup,
  timingSafeEqualString,
  translateNovelTextToEnglish,
  verifyAndConsumeReaderTotpCode,
  verifyTotpCode
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' && !isLocalRequest(request, env)) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    const isAdminRequest = adminPathPattern.test(url.pathname);
    const downloadFile = downloadFiles[url.pathname];
    const externalDownloadRedirect = externalDownloadRedirects[url.pathname];
    const redirectPath = pageRedirects[url.pathname];
    const legacyWorksRedirectPath = getLegacyWorksRedirectPath(url.pathname);

    // This gate runs before every /admin/, /admin-v2/, and /admin/api/ route is dispatched.
    if (isAdminRequest) {
      const adminAccessResponse = await enforceAdminAccess(request, env);
      if (adminAccessResponse) return adminAccessResponse;
    }

    if (legacyWorksRedirectPath && (request.method === 'GET' || request.method === 'HEAD')) {
      const redirectUrl = new URL(legacyWorksRedirectPath, url.origin);
      redirectUrl.search = url.search;
      return Response.redirect(redirectUrl.toString(), 301);
    }

    if (redirectPath && (request.method === 'GET' || request.method === 'HEAD')) {
      return Response.redirect(new URL(redirectPath, url.origin).toString(), 301);
    }

    if (externalDownloadRedirect && (request.method === 'GET' || request.method === 'HEAD')) {
      return Response.redirect(externalDownloadRedirect, 302);
    }

    if (downloadFile && (request.method === 'GET' || request.method === 'HEAD')) {
      return handleR2Download(request, env, downloadFile);
    }

    if (request.method === 'POST' && url.pathname === '/api/waitlist') {
      return handleWaitlistSubmit(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/product-feedback') {
      return handleProductFeedbackSubmit(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/magic-link') {
      return handleReaderMagicLinkRequest(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/register') {
      return handleReaderRegister(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/login') {
      return handleReaderLogin(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/password-reset/request') {
      return handleReaderPasswordResetRequest(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/password-reset/confirm') {
      return handleReaderPasswordResetConfirm(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/password/change') {
      return handleReaderPasswordChange(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/readers/totp/status') {
      return handleReaderTotpStatus(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/totp/setup') {
      return handleReaderTotpSetup(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/totp/confirm') {
      return handleReaderTotpConfirm(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/readers/verify') {
      return handleReaderVerify(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/readers/session') {
      return handleReaderSession(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/logout') {
      return handleReaderLogout(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/readers/credits') {
      return handleReaderCredits(request, env);
    }

    if (url.pathname === '/api/readers/bookmarks') {
      if (request.method === 'GET') return handleReaderBookmarks(request, env);
      if (request.method === 'POST') return handleReaderBookmarkSave(request, env);
      if (request.method === 'DELETE') return handleReaderBookmarkDelete(request, env);
      return json({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/comments') {
      return handleReaderCommentSubmit(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/readers/membership/redeem') {
      return handleReaderMembershipRedeem(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/access') {
      return handleNovelAccessCheck(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/chapters/protected-content') {
      return handleProtectedChapterContent(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/library') {
      return handleNovelLibrary(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/payments/status') {
      return handleNovelPaymentsStatus(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/payments/order') {
      return handleNovelPaymentOrderStatus(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/pricing') {
      return handlePublicNovelPricing(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/comments') {
      return handlePublicNovelComments(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/content/entries') {
      return handlePublicContentEntries(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/content/body') {
      return handlePublicContentBody(request, env);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/content/media') {
      return handlePublicContentMedia(request, env);
    }

    if (url.pathname === '/api/novelforge/import') {
      if (request.method === 'POST') return handleNovelForgeImport(request, env, ctx);
      return novelForgeImportError('Method not allowed.', {
        code: 'METHOD_NOT_ALLOWED',
        status: 405
      });
    }

    if (url.pathname === '/api/novelforge/translations/english') {
      if (request.method === 'POST') return handleNovelForgeTranslationSync(request, env);
      return novelForgeImportError('Method not allowed.', {
        code: 'METHOD_NOT_ALLOWED',
        status: 405
      });
    }

    const novelForgeChapterContentRoute = parseNovelForgeChapterContentRoute(url.pathname);
    if (novelForgeChapterContentRoute) {
      if (request.method === 'GET') return handleNovelForgeChapterContent(request, env, novelForgeChapterContentRoute);
      return novelForgeImportError('Method not allowed.', {
        code: 'METHOD_NOT_ALLOWED',
        status: 405
      });
    }

    const novelForgeAnalyticsRoute = parseNovelForgeAnalyticsRoute(url.pathname);
    if (novelForgeAnalyticsRoute) {
      if (request.method === 'GET') return handleNovelForgeAnalytics(request, env, novelForgeAnalyticsRoute);
      return novelForgeImportError('Method not allowed.', {
        code: 'METHOD_NOT_ALLOWED',
        status: 405
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/novels/credits/unlock') {
      return handleReaderCreditUnlock(request, env);
    }

    if (request.method === 'POST' && url.pathname === novelCheckoutPath) {
      return handleNovelCheckout(request, env);
    }

    if (request.method === 'POST' && url.pathname === nowPaymentsWebhookPath) {
      return handleNowPaymentsWebhook(request, env);
    }

    if (request.method === 'POST' && url.pathname === novelReadingEventsPath) {
      return handleNovelReadingEvents(request, env);
    }

    if (url.pathname === '/admin/api/novels/analytics/stats') {
      if (request.method === 'GET') return handleAdminListNovelAnalyticsStats(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/analytics/aggregate') {
      if (request.method === 'POST') return handleAdminAggregateNovelAnalytics(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/analytics/insights') {
      if (request.method === 'GET') return handleAdminListNovelAiInsights(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/analytics/insights/generate') {
      if (request.method === 'POST') return handleAdminGenerateNovelAiInsights(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/comments') {
      if (request.method === 'GET') return handleAdminListReaderComments(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/comments/moderate') {
      if (request.method === 'POST') return handleAdminModerateReaderComment(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/product-feedback') {
      if (request.method === 'GET') return handleAdminListProductFeedback(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/product-feedback/update') {
      if (request.method === 'POST') return handleAdminUpdateProductFeedback(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/payments/orders') {
      if (request.method === 'GET') return handleAdminListNovelOrders(request, env);
      return json({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/payments/order') {
      if (request.method === 'GET') return handleAdminGetNovelOrder(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/payments/orders/fulfill') {
      if (request.method === 'POST') return handleAdminFulfillNovelOrder(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/readers/accounts') {
      if (request.method === 'GET') return handleAdminListReaderAccounts(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/readers/account') {
      if (request.method === 'GET') return handleAdminGetReaderAccount(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/readers/credits/adjust') {
      if (request.method === 'POST') return handleAdminAdjustReaderCredits(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/schema') {
      if (request.method === 'GET') return handleAdminContentSchema(env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/body') {
      if (request.method === 'GET') return handleAdminGetContentBody(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/media') {
      if (request.method === 'POST') return handleAdminUploadContentMedia(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/revisions') {
      if (request.method === 'GET') return handleAdminListContentRevisions(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/audit-logs') {
      if (request.method === 'GET') return handleAdminListAuditLogs(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/pricing-rules') {
      if (request.method === 'GET') return handleAdminListContentPricingRules(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/pricing-defaults') {
      if (request.method === 'GET') return handleAdminGetContentPricingDefaults(env);
      if (request.method === 'POST') return handleAdminUpdateContentPricingDefaults(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/imports') {
      if (request.method === 'GET') return handleAdminListContentImports(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/imports/review') {
      if (request.method === 'POST') return handleAdminReviewContentImport(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/import') {
      if (request.method === 'POST') return handleAdminImportSignalBrief(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/drafts/generate') {
      if (request.method === 'POST') return handleAdminGenerateSignalBriefDraft(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/drafts') {
      if (request.method === 'GET') return handleAdminListSignalBriefDrafts(request, env);
      if (request.method === 'POST') return handleAdminManageSignalBriefDraft(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/model-rollout') {
      if (request.method === 'GET') return handleAdminGetSignalBriefModelRollout(request, env);
      if (request.method === 'POST') return handleAdminManageSignalBriefModelRollout(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/sources') {
      if (request.method === 'GET') return handleAdminListSignalSources(env);
      if (request.method === 'POST') return handleAdminSaveSignalSource(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/runs') {
      if (request.method === 'GET') return handleAdminListSignalCollectionRuns(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/operations') {
      if (request.method === 'GET') return handleAdminGetSignalOperations(request, env);
      if (request.method === 'POST') return handleAdminManageSignalOperations(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/candidates') {
      if (request.method === 'GET') return handleAdminListSignalCandidates(request, env);
      if (request.method === 'POST') return handleAdminReviewSignalCandidates(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/signal/collect') {
      if (request.method === 'POST') return handleAdminCollectSignalSources(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/preview') {
      if (request.method === 'POST') return handleAdminContentPreview(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/content/entries') {
      if (request.method === 'GET') return handleAdminListContentEntries(request, env);
      if (request.method === 'POST') return handleAdminUpsertContentEntry(request, env);
      return privateJson({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/admin/api/novels/entitlements') {
      if (request.method === 'GET') return handleAdminListNovelEntitlements(request, env);
      return json({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (request.method === 'POST' && url.pathname === '/admin/api/novels/entitlements/grant') {
      return handleAdminGrantNovelEntitlement(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/admin/api/novels/entitlements/revoke') {
      return handleAdminRevokeNovelEntitlement(request, env);
    }

    if (url.pathname === '/admin/api/waitlist/settings') {
      if (request.method === 'GET') return handleGetSettings(env);
      if (request.method === 'POST') return handleUpdateSettings(request, env);
      return json({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    const dynamicContentResponse = await handleDynamicFrontendContent(request, env);
    if (dynamicContentResponse) return dynamicContentResponse;

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      return isAdminRequest ? withPrivateHeaders(assetResponse) : assetResponse;
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env) {
    await handleSignalCollectionSchedule(env, {
      cron: cleanText(controller?.cron, 120),
      scheduledTime: controller?.scheduledTime
    });
  },

  async queue(batch, env) {
    if (batch.queue === signalCollectionDeadLetterQueueName) {
      await handleSignalCollectionDeadLetterQueue(batch, env);
      return;
    }
    await handleSignalCollectionQueue(batch, env);
  }
};
