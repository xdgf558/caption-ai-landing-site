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
const adminPathPattern = /^\/admin(?:\/|$)/;
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

const getSeriesPaymentSettings = (seriesSlug, env) => {
  const defaults = getCheckoutPrices(env);
  const settings = novelPaymentConfig?.series?.[seriesSlug];
  if (!settings) {
    return {
      seriesSlug,
      source: 'env-default',
      tipsEnabled: true,
      tipAmounts: [3, 5, 10],
      tipCurrency: 'USD',
      chapterPriceAmount: defaults.chapter,
      chapterPriceCurrency: 'USD',
      supporterPriceAmount: defaults.supporter,
      supporterPriceCurrency: 'USD',
      bundlePurchasesEnabled: false,
      chapterBundleDiscounts: [],
      chapters: []
    };
  }

  const tipAmounts = (Array.isArray(settings.tipAmounts) ? settings.tipAmounts : [])
    .map((amount) => normalizePriceAmount(amount, null))
    .filter((amount) => amount && amount > 0);

  return {
    seriesSlug,
    source: 'serial-config',
    tipsEnabled: settings.tipsEnabled !== false,
    tipAmounts: tipAmounts.length ? tipAmounts : [3, 5, 10],
    tipCurrency: normalizeFiatCurrency(settings.tipCurrency, 'USD'),
    chapterPriceAmount: normalizePriceAmount(settings.chapterPriceAmount, defaults.chapter),
    chapterPriceCurrency: normalizeFiatCurrency(settings.chapterPriceCurrency, 'USD'),
    supporterPriceAmount: normalizePriceAmount(settings.supporterPriceAmount, defaults.supporter),
    supporterPriceCurrency: normalizeFiatCurrency(settings.supporterPriceCurrency, 'USD'),
    bundlePurchasesEnabled: Boolean(settings.bundlePurchasesEnabled),
    chapterBundleDiscounts: normalizeBundleDiscounts(settings.chapterBundleDiscounts),
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
    pricing: normalizeJsonObject(payload.pricing),
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
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  const url = new URL(request.url);
  const normalizedEmail = normalizeEmail(url.searchParams.get('email'));
  if (normalizedEmail && !isEmail(normalizedEmail)) {
    return json({ ok: false, message: 'Please enter a valid reader email.' }, { status: 400 });
  }

  const entitlements = await listNovelEntitlements(db, normalizedEmail);
  return json({ ok: true, entitlements });
};

const handleAdminGrantNovelEntitlement = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  let data;
  try {
    data = normalizeEntitlementPayload(payload);
  } catch (error) {
    return json({ ok: false, message: error.message }, { status: 400 });
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

  return json({
    ok: true,
    entitlement: entitlementToJson({ ...entitlement, email: account.email }),
    entitlements: await listNovelEntitlements(db, data.normalizedEmail)
  });
};

const handleAdminRevokeNovelEntitlement = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Reader database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const id = Number.parseInt(payload.id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return json({ ok: false, message: 'A valid entitlement id is required.' }, { status: 400 });
  }

  await db
    .prepare(
      `UPDATE novel_entitlements
       SET revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(id)
    .run();

  const normalizedEmail = normalizeEmail(payload.email);
  return json({
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
  if (!seriesSlug || !chapterSlug) {
    return privateJson({ ok: false, message: 'series and chapter are required.' }, { status: 400 });
  }

  const chapter = getProtectedChapterContent(seriesSlug, chapterSlug);
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

const normalizeCreditUnlockPayload = (payload, env) => {
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

  return {
    accessRequired,
    chapterSlug,
    costCredits: getReaderCreditConfig(env).chapterCostCredits,
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
      JSON.stringify({ costCredits: unlock.costCredits })
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
    unlock = normalizeCreditUnlockPayload(payload, env);
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

const normalizeCheckoutPayload = (payload, session, env) => {
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
    const creditPack = findReaderCreditPack(env, payload.credits || payload.packCredits);
    return {
      bundleDetails: null,
      chapterSlug: '',
      creditPack,
      description: `Station Cat reading credits: ${creditPack.credits} ${creditPack.unitLabel}`,
      entitlementAccessLevel: '',
      entitlementScope: '',
      locale: cleanText(payload.locale, 20),
      message: '',
      orderType,
      payCurrency,
      priceAmount: creditPack.priceAmount,
      priceCurrency: creditPack.priceCurrency,
      pricingSource: 'reader-credit-pack',
      returnPath,
      seriesSlug: ''
    };
  }

  const settings = getSeriesPaymentSettings(seriesSlug, env);
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
    locale: cleanText(payload.locale, 20),
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
    checkout = normalizeCheckoutPayload(payload, session, env);
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
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

  const response = status
    ? await db
        .prepare(
          `SELECT novel_orders.*, reader_accounts.email AS account_email
           FROM novel_orders
           LEFT JOIN reader_accounts ON reader_accounts.id = novel_orders.account_id
           WHERE novel_orders.status = ?
           ORDER BY novel_orders.updated_at DESC
           LIMIT ?`
        )
        .bind(status, limit)
        .all()
    : await db
        .prepare(
          `SELECT novel_orders.*, reader_accounts.email AS account_email
           FROM novel_orders
           LEFT JOIN reader_accounts ON reader_accounts.id = novel_orders.account_id
           ORDER BY novel_orders.updated_at DESC
           LIMIT ?`
        )
        .bind(limit)
        .all();

  return json({
    ok: true,
    orders: (response.results || []).map(novelOrderToJson)
  });
};

const handleAdminContentSchema = async (env) =>
  privateJson({
    ok: true,
    stage: '7B',
    purpose: 'Backend content model foundation plus R2-backed protected chapter bodies.',
    entries: {
      entryTypes: [...contentEntryTypes],
      locales: [...contentLocales],
      statuses: [...contentStatuses],
      visibilities: [...contentVisibilities],
      accessLevels: [...contentAccessLevels],
      bodyFormats: [...contentBodyFormats]
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
      protectedContent: 'Paid/supporter chapter HTML is loaded from CONTENT_BUCKET after entitlement checks.',
      nextStages: ['7C Admin 2.0 UI for novels and blog/devlog']
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

  const actorEmail = (await getAdminActorEmail(request, env)) || entry.updatedBy || entry.createdBy || 'admin';
  entry.createdBy = entry.createdBy || actorEmail;
  entry.updatedBy = actorEmail;

  try {
    await uploadContentBodies(env, entry);
  } catch (error) {
    return privateJson({ ok: false, code: error.code || 'CONTENT_UPLOAD_FAILED', message: error.message }, { status: 503 });
  }

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
      cleanText(payload.revisionSummary, 500),
      saved.metadata_json,
      saved.pricing_json,
      saved.markdown_r2_key,
      saved.html_r2_key,
      actorEmail
    )
    .run();

  await insertAdminAuditLog(db, {
    actorEmail,
    action: 'content_entry_upsert',
    targetType: saved.entry_type,
    targetId: String(saved.id),
    targetSlug: `${saved.parent_slug ? `${saved.parent_slug}/` : ''}${saved.slug}`,
    metadata: {
      locale: saved.locale,
      revisionNumber,
      status: saved.status
    }
  });

  return privateJson({
    ok: true,
    entry: contentEntryToJson(saved),
    revisionNumber,
    storage: getContentStorageDescriptor(env)
  });
};

const handlePublicContentEntries = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Content database is not configured.' }, { status: 500 });
  if (!(await ensureContentTablesReady(db))) {
    return json({
      ok: true,
      setupRequired: true,
      source: 'backend-content-platform',
      stage: '7A',
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
    stage: '7B',
    entries: (response.results || []).map(contentEntryToJson)
  });
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

    if (request.method === 'GET' && url.pathname === '/api/content/entries') {
      return handlePublicContentEntries(request, env);
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

    if (url.pathname === '/admin/api/content/schema') {
      if (request.method === 'GET') return handleAdminContentSchema(env);
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

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      return isAdminRequest ? withPrivateHeaders(assetResponse) : assetResponse;
    }

    return new Response('Not found', { status: 404 });
  }
};
