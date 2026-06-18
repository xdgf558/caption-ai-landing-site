import { novelPaymentConfig } from './generated/novelPaymentConfig.js';
import { protectedSerialContent } from './generated/protectedSerialContent.js';

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
const adminPathPattern = /^\/admin(?:-v2)?(?:\/|$)/;
const defaultAdminEmail = 'brodstem@protonmail.com';

const cleanText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);

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

const randomToken = (byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let raw = '';
  bytes.forEach((byte) => {
    raw += String.fromCharCode(byte);
  });
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
const nowPaymentsSupportedCurrencies = ['USDTTRC20', 'USDTERC20', 'USDC', 'BTC', 'ETH'];
const novelOrderStatuses = ['draft', 'waiting', 'confirming', 'confirmed', 'finished', 'failed', 'expired', 'refunded', 'unknown'];
const novelPaymentGrantStatuses = ['confirmed', 'finished'];
const novelCheckoutPath = '/api/novels/payments/checkout';
const novelBundleOrderType = 'chapter-bundle';
const novelCreditPackOrderType = 'credit-pack';
const novelCreditSource = 'reader-credits';
const novelCreditUnitLabel = 'SC Credits';
const novelCreditLedgerTopupSource = 'nowpayments-credit-pack';
const novelCreditLedgerUnlockSource = 'chapter-credit-unlock';
const novelAdminSource = 'admin-v2';
const novelAdminManualCreditSource = 'admin-v2-manual-credit';

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
    creditPacks
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
  const packs = (envPacks.length
    ? envPacks
    : [
        { credits: 10, priceAmount: 1, priceCurrency: 'USD', label: '10 SC Credits' },
        { credits: 60, priceAmount: 5, priceCurrency: 'USD', label: '60 SC Credits' },
        { credits: 130, priceAmount: 10, priceCurrency: 'USD', label: '130 SC Credits' }
      ])
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

const resolveSeriesPaymentSettings = async (db, seriesSlug, env, options = {}) => {
  try {
    const backendSettings = await getBackendSeriesPaymentSettings(db, seriesSlug, env, options);
    if (backendSettings) return backendSettings;
  } catch (error) {
    if (!isMissingContentTablesError(error)) throw error;
  }
  return getStaticSeriesPaymentSettings(seriesSlug, env);
};

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

const contentEntryTypes = new Set(['blog_post', 'novel_series', 'novel_chapter']);
const contentLocales = new Set(['zh-Hant', 'zh-Hans', 'en', 'ja']);
const contentStatuses = new Set(['draft', 'scheduled', 'published', 'archived']);
const contentVisibilities = new Set(['public', 'unlisted', 'private']);
const contentAccessLevels = new Set(['free', 'paid', 'supporter', 'member']);
const contentBodyFormats = new Set(['markdown', 'html']);

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

  const base = `content/blog/${entry.locale}/${entry.slug}`;
  return {
    markdown: `${base}/body.md`,
    html: `${base}/body.html`
  };
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

const getContentBucket = (env) => env.CONTENT_BUCKET || null;

const getContentStorageDescriptor = (env) => ({
  contentBucketConfigured: Boolean(getContentBucket(env)),
  r2KeyConventions: {
    blogPostMarkdown: 'content/blog/{locale}/{slug}/body.md',
    blogPostHtml: 'content/blog/{locale}/{slug}/body.html',
    novelSeriesMarkdown: 'content/novels/{seriesSlug}/series/{locale}/body.md',
    novelChapterMarkdown: 'content/novels/{seriesSlug}/chapters/{chapterNumber}-{chapterSlug}/{locale}/body.md',
    novelChapterHtml: 'content/novels/{seriesSlug}/chapters/{chapterNumber}-{chapterSlug}/{locale}/body.html',
    importBackup: 'content/imports/{yyyy}/{mm}/{importId}-{filename}'
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
    lockedBody: 'Sign in from the library to check whether this account can read the chapter.',
    lockedTitle: 'This chapter is reserved for unlocked readers.',
    read: 'Read',
    readFirst: 'Read from chapter one',
    readLatest: 'Read latest chapter',
    serialsDescription: 'A quiet reading shelf for long-form fiction published on Station Cat.',
    serialsTitle: 'Station Cat Serials',
    signIn: 'Open my library',
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
    read: '読む',
    readFirst: '第一章から読む',
    readLatest: '最新章を読む',
    serialsDescription: 'Station Cat で公開していく長編小説のための、小さな読書棚です。',
    serialsTitle: 'Station Cat 連載小説',
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
    lockedBody: '請先從書庫登入，確認這個帳戶是否可以閱讀本章。',
    lockedTitle: '這一章保留給已解鎖讀者。',
    read: '閱讀',
    readFirst: '從第一章開始',
    readLatest: '閱讀最新章',
    serialsDescription: '一個放長篇小說、更新順序和後續讀者支持入口的小書架。',
    serialsTitle: 'Station Cat 連載小說',
    signIn: '打開我的書庫',
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
    lockedBody: '请先从书库登录，确认这个账户是否可以阅读本章。',
    lockedTitle: '这一章保留给已解锁读者。',
    read: '阅读',
    readFirst: '从第一章开始',
    readLatest: '阅读最新章',
    serialsDescription: '一个放长篇小说、更新顺序和后续读者支持入口的小书架。',
    serialsTitle: 'Station Cat 连载小说',
    signIn: '打开我的书库',
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

const ensureContentTablesReady = async (db) => {
  try {
    await db.prepare('SELECT id FROM content_entries LIMIT 1').first();
    return true;
  } catch (error) {
    if (isMissingContentTablesError(error)) return false;
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
  const subject = 'Sign in to Station Cat Library';
  const text = [
    'Use this secure link to sign in to your Station Cat reader library:',
    '',
    loginUrl,
    '',
    'This link expires in 15 minutes. If you did not request it, you can ignore this email.'
  ].join('\n');
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
      <h1 style="font-size: 20px;">Sign in to Station Cat Library</h1>
      <p>Use this secure link to open your reader library:</p>
      <p><a href="${loginUrl}" style="display: inline-block; background: #2e5b4e; color: #fffaf1; padding: 12px 16px; border-radius: 8px; text-decoration: none;">Open my library</a></p>
      <p style="color: #6b7280;">This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>
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
         WHERE account_id = ? AND consumed_at IS NULL`
      )
      .bind(account.id),
    db
      .prepare(
        `INSERT INTO reader_login_tokens (
          account_id, normalized_email, token_hash, expires_at, request_ip_hash, user_agent
        )
        VALUES (?, ?, ?, datetime('now', '+15 minutes'), ?, ?)`
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
        reader_accounts.created_at AS account_created_at
       FROM reader_sessions
       INNER JOIN reader_accounts ON reader_accounts.id = reader_sessions.account_id
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
         AND access_level IN ('paid', 'supporter', 'member')
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
  return {
    access: row.access_level === 'supporter' ? 'supporter' : 'paid',
    chapterNumber: row.chapter_number,
    chapterSlug: row.slug,
    excerpt: row.excerpt || row.description,
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
  const entitlement = await findActiveNovelEntitlement(db, session.account_id, seriesSlug, chapterSlug, accessRequired);
  if (!entitlement) {
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
      html: protectedHtml.html,
      source: 'r2',
      uploadedAt: protectedHtml.uploadedAt
    },
    entitlement: entitlementToJson({ ...entitlement, email: session.email })
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
  const ledger = await getReaderCreditLedger(db, accountId);

  return {
    account: readerCreditAccountToJson(account, config),
    chapterCostCredits: config.chapterCostCredits,
    packs: config.packs.map((pack) => ({
      credits: pack.credits,
      priceAmount: amountToStorage(pack.priceAmount),
      priceCurrency: pack.priceCurrency,
      label: pack.label
    })),
    ledger
  };
};

const handleReaderCredits = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const config = getReaderCreditConfig(env);
  const session = await getReaderFromSession(request, env);
  if (!session) {
    return json({
      ok: true,
      authenticated: false,
      chapterCostCredits: config.chapterCostCredits,
      packs: config.packs.map((pack) => ({
        credits: pack.credits,
        priceAmount: amountToStorage(pack.priceAmount),
        priceCurrency: pack.priceCurrency,
        label: pack.label
      }))
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
      chapterCostCredits: getReaderCreditConfig(env).chapterCostCredits,
      packs: getReaderCreditConfig(env).packs.map((pack) => ({
        credits: pack.credits,
        priceAmount: amountToStorage(pack.priceAmount),
        priceCurrency: pack.priceCurrency,
        label: pack.label
      }))
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
    orderType === novelCreditPackOrderType ? '/library/' : seriesSlug ? `/zh-hant/works/${seriesSlug}/` : '/library/'
  );

  if (orderType !== novelCreditPackOrderType && !seriesSlug) {
    throw new Error('seriesSlug is required.');
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
    creditPack = creditPack || findReaderCreditPack(env, payload.credits || payload.packCredits);
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

const handleAdminListNovelOrders = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

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
  const [row, creditSummary, entitlements, orders] = await Promise.all([
    getAdminReaderAccountRow(db, account.id),
    getReaderCreditSummary(db, account.id, env),
    listNovelEntitlements(db, account.normalized_email),
    listNovelOrdersForAccount(db, account.id)
  ]);

  return privateJson({
    ok: true,
    account: readerAccountToAdminJson(row, getReaderCreditConfig(env)),
    credits: creditSummary.account,
    creditLedger: creditSummary.ledger,
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

  const [row, creditSummary, entitlements, orders] = await Promise.all([
    getAdminReaderAccountRow(db, account.id),
    getReaderCreditSummary(db, account.id, env),
    listNovelEntitlements(db, account.normalized_email),
    listNovelOrdersForAccount(db, account.id)
  ]);

  return privateJson({
    ok: true,
    ledger: readerCreditLedgerToJson(ledger),
    account: readerAccountToAdminJson(row, getReaderCreditConfig(env)),
    credits: creditSummary.account,
    creditLedger: creditSummary.ledger,
    entitlements,
    orders
  });
};

const handleAdminContentSchema = async (env) =>
  privateJson({
    ok: true,
    stage: '7G Cleanup',
    purpose: 'Backend content management, pricing, order, reader account, credit, entitlement, and audit operations centered in Admin 2.0.',
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
        'credit_pack'
      ],
      source: 'content_pricing_rules'
    },
    storage: getContentStorageDescriptor(env),
    migration: {
      currentStaticSources: ['src/content/devlog', 'src/content/serials', 'src/content/serialChapters'],
      backendTables: [
        'content_entries',
        'content_revisions',
        'content_imports',
        'content_pricing_rules',
        'admin_audit_logs'
      ],
      legacyMigration: 'Completed. The one-time legacy Markdown migration endpoint and manifest have been removed from the Worker bundle.',
      protectedContent: 'Paid/supporter chapter HTML is loaded from CONTENT_BUCKET after entitlement checks.',
      dynamicFrontend: 'Published backend content can render public Blog and serial pages without a site rebuild.',
      checkoutPricing: 'Reader-facing checkout resolves content_pricing_rules before generated static config and env defaults.',
      commerceAdmin: 'Admin 2.0 can inspect orders, reader accounts, credit ledger, entitlements, and rerun paid-order fulfillment.',
      oldAuthoringPath: 'The old GitHub-token Markdown editor is deprecated. Use Admin 2.0 for routine content publishing.',
      nextStages: ['7H media cover upload', '8A NovelForge import API']
    }
  });

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
        archived_at = CASE WHEN excluded.status = 'archived' THEN CURRENT_TIMESTAMP ELSE content_entries.archived_at END,
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

const readPublicEntryBody = async (env, row) => {
  if (!row) return { html: '', source: 'none' };
  if (row.access_level !== 'free') return { html: '', source: 'protected' };

  const bucket = getContentBucket(env);
  if (!bucket) return { html: '', source: 'missing-bucket' };

  const html = await readContentObjectText(bucket, row.html_r2_key, 'HTML body');
  if (html) return { html, source: 'html-r2' };

  const markdown = await readContentObjectText(bucket, row.markdown_r2_key, 'Markdown body');
  if (markdown) return { html: renderSimpleMarkdownToHtml(markdown), source: 'markdown-r2' };

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
  if (entry.access_level !== 'free') {
    return publicContentResponse(
      {
        ok: false,
        code: 'CONTENT_PROTECTED',
        entry: contentEntryToJson(entry),
        message: 'This content is protected.'
      },
      { status: 403 }
    );
  }

  const body = await readPublicEntryBody(env, entry);
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
  description: entry.description,
  excerpt: entry.excerpt,
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

const getPreviewBasePath = (entry) => getPathWithLocale(entry.locale, entry.entryType === 'blog_post' ? 'devlog' : 'works');

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
  if (entry.entryType === 'novel_series') {
    return { basePath, kind: 'novel-series', locale: entry.locale, seriesSlug: entry.slug };
  }
  return {
    basePath,
    chapterSlug: entry.slug,
    kind: 'novel-chapter',
    locale: entry.locale,
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
      description: entry.description || entry.excerpt,
      lang: entry.locale,
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
      description: entry.description || entry.excerpt,
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
    description: entry.description || entry.excerpt,
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

  if (section === 'works') {
    locale = locale || 'en';
    return {
      basePath: hasLocalePrefix ? getPathWithLocale(locale, 'works') : '/works/',
      chapterSlug: cleanSlug(segments[offset + 2] || '', 160),
      kind: segments[offset + 2] ? 'novel-chapter' : segments[offset + 1] ? 'novel-series' : 'novel-index',
      locale,
      seriesSlug: cleanSlug(segments[offset + 1] || '', 160)
    };
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
  if (route.kind === 'novel-series') return `${route.basePath}${route.seriesSlug}/`;
  if (route.kind === 'novel-chapter') return `${route.basePath}${route.seriesSlug}/${route.chapterSlug}/`;
  return '/';
};

const dynamicHtmlShell = ({ body, canonicalPath, description, lang, robots = '', title }) => `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} | Station Cat</title>
    <meta name="description" content="${escapeHtml(description)}">
    ${robots ? `<meta name="robots" content="${escapeHtml(robots)}">` : ''}
    <link rel="canonical" href="https://wwwstationcat.org${escapeHtml(canonicalPath)}">
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
      .button-row { display: flex; flex-wrap: wrap; gap: 10px; }
      .button { align-items: center; border: 1px solid var(--ink); border-radius: 8px; display: inline-flex; font-weight: 900; justify-content: center; min-height: 44px; padding: 10px 14px; text-decoration: none; }
      .button-primary { background: var(--ink); color: #fff; }
      .button-secondary { background: #fff; color: var(--ink); }
      .prose { background: rgba(255,255,255,.68); border: 1px solid var(--line); border-radius: 16px; display: grid; gap: 18px; padding: clamp(20px, 4vw, 42px); }
      .prose h1 { font-size: 34px; }
      .prose h2 { font-size: 28px; margin-top: 12px; }
      .prose h3 { font-size: 22px; margin-top: 8px; }
      .prose ul { display: grid; gap: 8px; margin: 0; padding-left: 22px; }
      .prose li { color: var(--muted); font-size: 17px; line-height: 1.75; }
      .status { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; color: var(--muted); font-size: 15px; font-weight: 800; padding: 12px; }
      .status[data-tone="success"] { border-color: rgba(8,121,109,.32); color: var(--teal); }
      .status[data-tone="error"] { border-color: rgba(217,93,69,.4); color: var(--coral); }
      @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } .topbar { align-items: flex-start; flex-direction: column; } }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <a class="brand" href="/"><span>SC</span><span>Station Cat</span></a>
        <nav class="nav">
          <a href="/zh-hant/works/">連載小說</a>
          <a href="/devlog/">開發博客</a>
          <a href="/apps/">Apps</a>
          <a href="https://x.com/bketck">Follow on X</a>
        </nav>
      </header>
      ${body}
    </main>
  </body>
</html>`;

const dynamicHtmlResponse = (request, payload, init = {}) =>
  new Response(request.method === 'HEAD' ? null : dynamicHtmlShell(payload), {
    ...init,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      ...(init.headers || {})
    }
  });

const renderDynamicDevlogPost = (route, post, body) => {
  const copy = dynamicContentCopy[route.locale];
  return `<article class="section">
      <a class="text-link" href="${escapeHtml(route.basePath)}">${escapeHtml(copy.backDevlog)}</a>
      <header class="hero">
        <div class="meta">
          <span class="pill">${escapeHtml(formatContentDate(post.published_at || post.updated_at, route.locale))}</span>
          <span>${escapeHtml(dynamicContentStatusLabels[post.status] || post.status)}</span>
        </div>
        <h1>${escapeHtml(post.title)}</h1>
        <p>${escapeHtml(post.description || post.excerpt)}</p>
      </header>
      <div class="prose">${body.html || `<p>${escapeHtml(post.excerpt || post.description)}</p>`}</div>
    </article>`;
};

const renderChapterCards = (route, chapters) => {
  const copy = dynamicContentCopy[route.locale];
  if (!chapters.length) return `<p>${escapeHtml(copy.chapters)}</p>`;
  return chapters
    .map(
      (chapter) => `<a class="card" href="${escapeHtml(`${route.basePath}${chapter.parent_slug}/${chapter.slug}/`)}">
        <div class="meta">
          <span class="pill">${escapeHtml(copy.chapter)} ${escapeHtml(String(chapter.chapter_number || ''))}</span>
          <span>${escapeHtml(dynamicAccessLabels[chapter.access_level] || chapter.access_level)}</span>
        </div>
        <h3>${escapeHtml(chapter.title)}</h3>
        <p>${escapeHtml(chapter.excerpt || chapter.description)}</p>
      </a>`
    )
    .join('');
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
    creditInsufficient: 'Not enough reading credits. Top up in the library first.',
    creditTopUp: 'Top up credits',
    creditUnlock: 'Use reading credits',
    denied: 'This account has not unlocked this chapter yet.',
    disabled: 'Checkout is not configured yet.',
    failed: 'Could not create checkout.',
    library: 'Open my library',
    opening: 'Opening NOWPayments...',
    signIn: 'Sign in to my library',
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
    creditInsufficient: '閱讀點數不足，請先到書庫充值。',
    creditTopUp: '充值閱讀點',
    creditUnlock: '用閱讀點解鎖',
    denied: '這個帳戶尚未解鎖本章。',
    disabled: '支付通道尚未配置完成。',
    failed: '支付訂單建立失敗。',
    library: '打開我的書庫',
    opening: '正在打開 NOWPayments...',
    signIn: '登入我的書庫',
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
    creditInsufficient: '阅读点数不足，请先到书库充值。',
    creditTopUp: '充值阅读点',
    creditUnlock: '用阅读点解锁',
    denied: '这个账户尚未解锁本章。',
    disabled: '支付通道尚未配置完成。',
    failed: '支付订单建立失败。',
    library: '打开我的书库',
    opening: '正在打开 NOWPayments...',
    signIn: '登录我的书库',
    signInRequired: '请先登录，再解锁付费阅读。',
    unlock: '解锁'
  }
};

const formatPaymentAmountForLocale = (amount, currency, locale) => {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amountToStorage(amount)} ${currency}`;
  }
};

const renderDynamicUnlockButtons = (route, serial, chapter, settings) => {
  const copy = dynamicPaymentCopy[route.locale];
  const orderType = chapter.access_level === 'supporter' ? 'supporter' : 'chapter';
  const unlockAmount = orderType === 'supporter' ? settings.supporterPriceAmount : settings.chapterPriceAmount;
  const unlockCurrency = orderType === 'supporter' ? settings.supporterPriceCurrency : settings.chapterPriceCurrency;
  const bundleOptions = orderType === 'chapter' ? getBundlePricingOptions(settings, chapter.slug) : [];
  const bundleButtons = bundleOptions
    .map(
      (option) => `<button
          class="button button-secondary"
          type="button"
          data-serial-unlock
          data-order-type="${escapeHtml(novelBundleOrderType)}"
          data-bundle-chapters="${escapeHtml(String(option.bundleChapterCount))}"
          data-chapter-slugs="${escapeHtml(option.bundleChapterSlugs.join(','))}"
        >
          ${escapeHtml(copy.bundle)} ${escapeHtml(String(option.bundleChapterCount))}${escapeHtml(copy.bundleUnit)} · ${escapeHtml(formatPaymentAmountForLocale(option.priceAmount, settings.chapterPriceCurrency, route.locale))} · ${escapeHtml(String(option.bundleDiscountPercent))}% ${escapeHtml(copy.bundleOff)}
        </button>`
    )
    .join('');

  return `<div class="button-row">
      <a class="button button-primary" href="/library/">${escapeHtml(copy.signIn)}</a>
      ${
        orderType === 'chapter'
          ? `<button class="button button-secondary" type="button" data-serial-credit-unlock>${escapeHtml(copy.creditUnlock)} · ${escapeHtml(String(settings.chapterCredits))}</button>`
          : ''
      }
      <button class="button button-secondary" type="button" data-serial-unlock data-order-type="${escapeHtml(orderType)}">
        ${escapeHtml(copy.unlock)} ${escapeHtml(formatPaymentAmountForLocale(unlockAmount, unlockCurrency, route.locale))}
      </button>
      ${bundleButtons}
      ${orderType === 'chapter' ? `<a class="button button-secondary" href="/library/">${escapeHtml(copy.creditTopUp)}</a>` : ''}
      <a class="button button-secondary" href="${escapeHtml(`${route.basePath}${serial.slug}/`)}">${escapeHtml(copy.backSeries)}</a>
    </div>`;
};

const renderDynamicNovelSeries = (route, serial, body, chapters) => {
  const copy = dynamicContentCopy[route.locale];
  const firstChapter = chapters[0];
  const latestChapter = chapters[chapters.length - 1];
  return `<section class="hero">
      <p class="kicker">${escapeHtml(copy.status)}</p>
      <h1>${escapeHtml(serial.title)}</h1>
      <p>${escapeHtml(serial.subtitle || serial.description)}</p>
      <div class="meta">
        <span class="pill">${escapeHtml(copy.author)}: ${escapeHtml(serial.author_name || 'Station Cat')}</span>
        <span>${escapeHtml(copy.access)}: ${escapeHtml(dynamicAccessLabels[serial.access_level] || serial.access_level)}</span>
      </div>
      <div class="button-row">
        ${firstChapter ? `<a class="button button-primary" href="${escapeHtml(`${route.basePath}${serial.slug}/${firstChapter.slug}/`)}">${escapeHtml(copy.readFirst)}</a>` : ''}
        ${latestChapter && latestChapter.slug !== firstChapter?.slug ? `<a class="button button-secondary" href="${escapeHtml(`${route.basePath}${serial.slug}/${latestChapter.slug}/`)}">${escapeHtml(copy.readLatest)}</a>` : ''}
        <a class="button button-secondary" href="${escapeHtml(route.basePath)}">${escapeHtml(copy.allSerials)}</a>
      </div>
    </section>
    <section class="section">
      <div class="prose">${body.html || `<p>${escapeHtml(serial.excerpt || serial.description)}</p>`}</div>
    </section>
    <section class="section">
      <p class="kicker">${escapeHtml(copy.chapters)}</p>
      <div class="grid">${renderChapterCards(route, chapters)}</div>
    </section>`;
};

const renderDynamicNovelChapter = (route, serial, chapter, body, chapters, paymentSettings) => {
  const copy = dynamicContentCopy[route.locale];
  const paymentCopy = dynamicPaymentCopy[route.locale];
  const currentIndex = chapters.findIndex((entry) => entry.slug === chapter.slug);
  const previousChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex >= 0 ? chapters[currentIndex + 1] : null;
  const isProtected = chapter.access_level !== 'free';
  const content = isProtected
    ? `<section class="gate" data-serial-access-gate data-series-slug="${escapeHtml(chapter.parent_slug)}" data-chapter-slug="${escapeHtml(chapter.slug)}" data-access="${escapeHtml(chapter.access_level)}" data-locale="${escapeHtml(route.locale)}" data-return-path="${escapeHtml(dynamicCanonicalPath(route))}">
        <p class="kicker">${escapeHtml(dynamicAccessLabels[chapter.access_level] || chapter.access_level)}</p>
        <h2>${escapeHtml(copy.lockedTitle)}</h2>
        <p>${escapeHtml(copy.lockedBody)}</p>
        <div class="status" data-serial-access-status>${escapeHtml(paymentCopy.checking)}</div>
        <div class="status" data-serial-credit-status></div>
        ${renderDynamicUnlockButtons(route, serial, chapter, paymentSettings)}
      </section>
      <article class="prose" data-protected-chapter-body hidden></article>
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
    : `<article class="prose">${body.html || `<p>${escapeHtml(chapter.excerpt || chapter.description)}</p>`}</article>`;

  return `<article class="section">
      <a class="text-link" href="${escapeHtml(`${route.basePath}${serial.slug}/`)}">${escapeHtml(copy.backSeries)}</a>
      <header class="hero">
        <div class="meta">
          <span class="pill">${escapeHtml(copy.chapter)} ${escapeHtml(String(chapter.chapter_number || ''))}</span>
          <span>${escapeHtml(copy.access)}: ${escapeHtml(dynamicAccessLabels[chapter.access_level] || chapter.access_level)}</span>
          ${chapter.word_count ? `<span>${escapeHtml(String(chapter.word_count))} ${escapeHtml(copy.words)}</span>` : ''}
        </div>
        <h1>${escapeHtml(chapter.title)}</h1>
        <p>${escapeHtml(chapter.excerpt || chapter.description)}</p>
      </header>
      ${content}
      <footer class="section">
        <div class="button-row">
          ${previousChapter ? `<a class="button button-secondary" href="${escapeHtml(`${route.basePath}${serial.slug}/${previousChapter.slug}/`)}">Previous</a>` : `<a class="button button-secondary" href="${escapeHtml(`${route.basePath}${serial.slug}/`)}">${escapeHtml(copy.backSeries)}</a>`}
          ${nextChapter ? `<a class="button button-primary" href="${escapeHtml(`${route.basePath}${serial.slug}/${nextChapter.slug}/`)}">Next</a>` : `<a class="button button-primary" href="${escapeHtml(`${route.basePath}${serial.slug}/`)}">${escapeHtml(copy.backSeries)}</a>`}
        </div>
      </footer>
    </article>`;
};

const handleDynamicFrontendContent = async (request, env) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const route = parseDynamicContentRoute(url.pathname);
  if (!route) return null;
  if (route.kind === 'devlog-index' || route.kind === 'novel-index') return null;

  const db = env.WAITLIST_DB;
  if (!db || !(await ensureContentTablesReady(db))) return null;

  if (route.kind === 'devlog-post') {
    const post = await getPublishedContentEntry(db, { entryType: 'blog_post', locale: route.locale, slug: route.slug });
    if (!post) return null;
    const body = await readPublicEntryBody(env, post);
    return dynamicHtmlResponse(request, {
      body: renderDynamicDevlogPost(route, post, body),
      canonicalPath: dynamicCanonicalPath(route),
      description: post.description || post.excerpt,
      lang: route.locale,
      title: post.title
    });
  }

  if (route.kind === 'novel-series') {
    const serial = await getPublishedContentEntry(db, { entryType: 'novel_series', locale: route.locale, slug: route.seriesSlug });
    if (!serial) return null;
    const [body, chapters] = await Promise.all([
      readPublicEntryBody(env, serial),
      listPublishedContentEntries(db, { entryType: 'novel_chapter', locale: route.locale, parentSlug: serial.slug, limit: 100 })
    ]);
    return dynamicHtmlResponse(request, {
      body: renderDynamicNovelSeries(route, serial, body, chapters),
      canonicalPath: dynamicCanonicalPath(route),
      description: serial.description || serial.excerpt,
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
      description: chapter.description || chapter.excerpt,
      lang: route.locale,
      title: `${chapter.title} | ${serial.title}`
    });
  }

  return null;
};

const downloadFiles = {
  '/downloads/stationcat-radar/StationCat-Radar-0.1.0-arm64.dmg': {
    key: 'stationcat-radar/0.1.0/StationCat-Radar-0.1.0-arm64.dmg',
    filename: 'StationCat-Radar-0.1.0-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'stationcat-radar-0.1.0-arm64'
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
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-arm64.dmg',
    filename: 'NodePilot-0.2.18-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.18-arm64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-latest-arm64.dmg': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-arm64.dmg',
    filename: 'NodePilot-0.2.18-arm64.dmg',
    contentType: 'application/x-apple-diskimage',
    limitKey: 'nodepilot-0.2.18-arm64'
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
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-mac-arm64.zip',
    filename: 'NodePilot-0.2.18-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.18-mac-arm64-zip'
  },
  '/downloads/anytls-desktop-manager/NodePilot-latest-mac-arm64.zip': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-0.2.18-mac-arm64.zip',
    filename: 'NodePilot-0.2.18-mac-arm64.zip',
    contentType: 'application/zip',
    limitKey: 'nodepilot-0.2.18-mac-arm64-zip'
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
    key: 'anytls-desktop-manager/0.2.18/NodePilot-Setup-0.2.18-x64.exe',
    filename: 'NodePilot-Setup-0.2.18-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.18-x64'
  },
  '/downloads/anytls-desktop-manager/NodePilot-Setup-latest-x64.exe': {
    key: 'anytls-desktop-manager/0.2.18/NodePilot-Setup-0.2.18-x64.exe',
    filename: 'NodePilot-Setup-0.2.18-x64.exe',
    contentType: 'application/octet-stream',
    limitKey: 'nodepilot-0.2.18-x64'
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isAdminRequest = adminPathPattern.test(url.pathname);
    const downloadFile = downloadFiles[url.pathname];
    const externalDownloadRedirect = externalDownloadRedirects[url.pathname];
    const redirectPath = pageRedirects[url.pathname];

    if (isAdminRequest) {
      const adminAccessResponse = await enforceAdminAccess(request, env);
      if (adminAccessResponse) return adminAccessResponse;
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

    if (request.method === 'POST' && url.pathname === '/api/readers/magic-link') {
      return handleReaderMagicLinkRequest(request, env);
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

    if (request.method === 'GET' && url.pathname === '/api/content/entries') {
      return handlePublicContentEntries(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/content/body') {
      return handlePublicContentBody(request, env);
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
  }
};
