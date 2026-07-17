import { XMLParser } from 'fast-xml-parser';

const defaultFetchTimeoutMs = 12_000;
const defaultMaxBodyBytes = 1024 * 1024;
const dnsResponseMaxBytes = 64 * 1024;
const maxRedirects = 3;
const hackerNewsItemLimit = 12;

const blockedHostSuffixes = new Set([
  'arpa',
  'example',
  'home',
  'internal',
  'invalid',
  'lan',
  'local',
  'localhost',
  'onion',
  'test'
]);

const trackingSearchParams = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source'
]);

const signalXmlParser = new XMLParser({
  attributeNamePrefix: '@_',
  cdataPropName: '#cdata',
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  textNodeName: '#text',
  trimValues: true
});

const collectionError = (code, message, options = {}) => {
  const error = new Error(message);
  error.code = code;
  error.retriable = options.retriable !== false;
  return error;
};

const asArray = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

const isIpv4 = (value) => {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  return parts.every((part) => Number.parseInt(part, 10) >= 0 && Number.parseInt(part, 10) <= 255);
};

export const isBlockedSignalIpv4 = (value) => {
  if (!isIpv4(value)) return false;
  const [first, second, third] = value.split('.').map((part) => Number.parseInt(part, 10));
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && [0, 2].includes(third)) ||
    (first === 192 && second === 168) ||
    (first === 198 && [18, 19].includes(second)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
};

const mappedIpv4FromIpv6 = (value) => {
  const normalized = String(value || '').toLowerCase();
  const dotted = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && isIpv4(dotted[1])) return dotted[1];
  const packed = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!packed) return '';
  const high = Number.parseInt(packed[1], 16);
  const low = Number.parseInt(packed[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
};

export const isBlockedSignalIpv6 = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized.includes(':')) return false;
  const mappedIpv4 = mappedIpv4FromIpv6(normalized);
  if (mappedIpv4) return isBlockedSignalIpv4(mappedIpv4);
  if (normalized === '::' || normalized === '::1') return true;
  if (/^(?:fc|fd)/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (/^ff/.test(normalized)) return true;
  if (/^2001:db8(?::|$)/.test(normalized)) return true;
  return false;
};

export const isBlockedSignalHostname = (value) => {
  const hostname = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!hostname || hostname.includes(':')) return true;
  if (isBlockedSignalIpv4(hostname)) return true;
  if (!hostname.includes('.')) return true;
  return [...blockedHostSuffixes].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
};

export const normalizePublicSignalUrl = (value, baseUrl = undefined) => {
  try {
    const url = baseUrl ? new URL(String(value || '').trim(), baseUrl) : new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password || isBlockedSignalHostname(url.hostname)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
};

export const normalizeSignalCandidateUrl = (value, baseUrl) => {
  const normalized = normalizePublicSignalUrl(value, baseUrl);
  if (!normalized) return '';
  const url = new URL(normalized);
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || trackingSearchParams.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
};

const safeCodePoint = (value, radix) => {
  const codePoint = Number.parseInt(value, radix);
  return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
};

const decodeCommonEntities = (value) =>
  String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeCodePoint(code, 16));

export const signalPlainText = (value, maxLength = 1200) =>
  decodeCommonEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const nodeText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(nodeText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    if (value['#text'] !== undefined) return nodeText(value['#text']);
    if (value['#cdata'] !== undefined) return nodeText(value['#cdata']);
  }
  return '';
};

const normalizePublishedAt = (value) => {
  const date = new Date(nodeText(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const atomLink = (entry) => {
  const links = asArray(entry?.link);
  const preferred = links.find((link) => !link?.['@_rel'] || link['@_rel'] === 'alternate') || links[0];
  return typeof preferred === 'string' ? preferred : preferred?.['@_href'] || nodeText(preferred);
};

const rssLink = (item) => {
  if (typeof item?.link === 'string') return item.link;
  return item?.link?.['@_href'] || nodeText(item?.link);
};

const feedEntries = (parsed) => {
  if (parsed?.rss?.channel?.item) return { entries: asArray(parsed.rss.channel.item), kind: 'rss' };
  if (parsed?.feed?.entry) return { entries: asArray(parsed.feed.entry), kind: 'atom' };
  if (parsed?.['rdf:RDF']?.item) return { entries: asArray(parsed['rdf:RDF'].item), kind: 'rss' };
  return { entries: [], kind: '' };
};

export const parseSignalFeed = (xml, sourceUrl, maxItems = 30) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw collectionError('SIGNAL_FEED_DTD_BLOCKED', '来源内容包含不允许的 XML 声明。', { retriable: false });
  }
  let parsed;
  try {
    parsed = signalXmlParser.parse(xml);
  } catch {
    throw collectionError('SIGNAL_FEED_INVALID', '来源返回的 RSS / Atom 无法解析。', { retriable: false });
  }
  const { entries, kind } = feedEntries(parsed);
  if (!kind) {
    throw collectionError('SIGNAL_FEED_UNSUPPORTED', '来源不是可识别的 RSS / Atom feed。', { retriable: false });
  }

  return entries
    .slice(0, Math.max(1, maxItems))
    .map((entry) => {
      const linkValue = kind === 'atom' ? atomLink(entry) : rssLink(entry);
      const canonicalUrl = normalizeSignalCandidateUrl(linkValue, sourceUrl);
      const title = signalPlainText(nodeText(entry?.title), 300);
      if (!canonicalUrl || !title) return null;
      const rawSummary =
        entry?.summary ?? entry?.description ?? entry?.['content:encoded'] ?? entry?.content ?? entry?.subtitle ?? '';
      const externalId = signalPlainText(nodeText(entry?.id ?? entry?.guid), 300);
      return {
        author: signalPlainText(nodeText(entry?.author?.name ?? entry?.author ?? entry?.['dc:creator']), 160),
        canonicalUrl,
        externalId,
        publishedAt: normalizePublishedAt(entry?.published ?? entry?.pubDate ?? entry?.updated ?? entry?.['dc:date']),
        summary: signalPlainText(nodeText(rawSummary), 1200),
        title
      };
    })
    .filter(Boolean);
};

export const readResponseTextLimited = async (response, maxBytes = defaultMaxBodyBytes, timeoutMs = 0) => {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw collectionError('SIGNAL_RESPONSE_TOO_LARGE', `来源响应超过 ${maxBytes} bytes。`, { retriable: false });
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw collectionError('SIGNAL_RESPONSE_TOO_LARGE', `来源响应超过 ${maxBytes} bytes。`, { retriable: false });
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;
  let total = 0;
  let text = '';
  while (true) {
    const remainingMs = deadline ? deadline - Date.now() : 0;
    if (deadline && remainingMs <= 0) {
      await reader.cancel();
      throw collectionError('SIGNAL_RESPONSE_TIMEOUT', '来源正文读取超时。');
    }
    let timer;
    let chunk;
    try {
      chunk = deadline
        ? await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(collectionError('SIGNAL_RESPONSE_TIMEOUT', '来源正文读取超时。')),
                remainingMs
              );
            })
          ])
        : await reader.read();
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const { done, value } = chunk;
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw collectionError('SIGNAL_RESPONSE_TOO_LARGE', `来源响应超过 ${maxBytes} bytes。`, { retriable: false });
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

const fetchWithTimeout = async (fetchImpl, url, init, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw collectionError('SIGNAL_FETCH_TIMEOUT', '来源请求超时。');
    }
    throw collectionError('SIGNAL_FETCH_FAILED', `来源请求失败：${error?.message || 'unknown error'}`);
  } finally {
    clearTimeout(timeout);
  }
};

const resolveDnsAnswers = async (hostname, fetchImpl, timeoutMs) => {
  const query = async (type) => {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', type);
    const response = await fetchWithTimeout(
      fetchImpl,
      url.toString(),
      { headers: { accept: 'application/dns-json' } },
      Math.min(timeoutMs, 5000)
    );
    if (!response.ok) throw collectionError('SIGNAL_DNS_FAILED', `无法验证来源域名：DNS HTTP ${response.status}。`);
    const payload = JSON.parse(await readResponseTextLimited(response, dnsResponseMaxBytes, Math.min(timeoutMs, 5000)));
    return asArray(payload.Answer)
      .filter((answer) => answer?.type === (type === 'A' ? 1 : 28))
      .map((answer) => String(answer.data || '').trim())
      .filter(Boolean);
  };
  const results = await Promise.allSettled([query('A'), query('AAAA')]);
  const answers = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  if (!answers.length) throw collectionError('SIGNAL_DNS_EMPTY', '来源域名没有可验证的公网地址。');
  return answers;
};

export const assertSignalUrlResolvesPublicly = async (urlValue, options = {}) => {
  const normalized = normalizePublicSignalUrl(urlValue);
  if (!normalized) {
    throw collectionError('SIGNAL_FETCH_URL_BLOCKED', '来源地址不是允许的公网 HTTP(S) URL。', { retriable: false });
  }
  const url = new URL(normalized);
  if (isIpv4(url.hostname)) {
    if (isBlockedSignalIpv4(url.hostname)) {
      throw collectionError('SIGNAL_FETCH_PRIVATE_ADDRESS', '来源地址解析到内网或保留地址。', { retriable: false });
    }
    return normalized;
  }

  const cache = options.dnsCache || new Map();
  if (cache.has(url.hostname)) return normalized;
  const answers = await resolveDnsAnswers(
    url.hostname,
    options.fetchImpl || fetch,
    options.timeoutMs || defaultFetchTimeoutMs
  );
  if (answers.some((answer) => isBlockedSignalIpv4(answer) || isBlockedSignalIpv6(answer))) {
    throw collectionError('SIGNAL_FETCH_PRIVATE_ADDRESS', '来源地址解析到内网或保留地址。', { retriable: false });
  }
  cache.set(url.hostname, answers);
  return normalized;
};

export const fetchPublicSignalResource = async (urlValue, options = {}) => {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || defaultFetchTimeoutMs;
  const maxBytes = options.maxBytes || defaultMaxBodyBytes;
  const dnsCache = options.dnsCache || new Map();
  let currentUrl = normalizePublicSignalUrl(urlValue);
  if (!currentUrl) {
    throw collectionError('SIGNAL_FETCH_URL_BLOCKED', '来源地址不是允许的公网 HTTP(S) URL。', { retriable: false });
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertSignalUrlResolvesPublicly(currentUrl, { dnsCache, fetchImpl, timeoutMs });
    const headers = new Headers(options.headers || {});
    headers.set('accept', options.accept || 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.2');
    headers.set('user-agent', 'StationCat-SignalCollector/2.0 (+https://wwwstationcat.org/signal/)');
    const response = await fetchWithTimeout(fetchImpl, currentUrl, { headers, redirect: 'manual' }, timeoutMs);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === maxRedirects) {
        throw collectionError('SIGNAL_FETCH_REDIRECT_BLOCKED', '来源重定向无效或次数过多。', { retriable: false });
      }
      const nextUrl = normalizePublicSignalUrl(location, currentUrl);
      if (!nextUrl) {
        throw collectionError('SIGNAL_FETCH_REDIRECT_BLOCKED', '来源重定向到了不允许的地址。', { retriable: false });
      }
      currentUrl = nextUrl;
      continue;
    }

    if (response.status === 304) {
      return { body: '', finalUrl: currentUrl, headers: response.headers, notModified: true, status: 304 };
    }
    if (!response.ok) {
      throw collectionError('SIGNAL_FETCH_HTTP_ERROR', `来源返回 HTTP ${response.status}。`, {
        retriable: response.status === 408 || response.status === 429 || response.status >= 500
      });
    }
    return {
      body: await readResponseTextLimited(response, maxBytes, timeoutMs),
      finalUrl: currentUrl,
      headers: response.headers,
      notModified: false,
      status: response.status
    };
  }

  throw collectionError('SIGNAL_FETCH_REDIRECT_BLOCKED', '来源重定向次数过多。', { retriable: false });
};

const conditionalHeaders = (source) => {
  const headers = {};
  if (source.http_etag) headers['if-none-match'] = source.http_etag;
  if (source.http_last_modified) headers['if-modified-since'] = source.http_last_modified;
  return headers;
};

const parseHackerNewsItem = (item, sourceUrl) => {
  if (!item || item.deleted || item.dead || item.type !== 'story') return null;
  const canonicalUrl = normalizeSignalCandidateUrl(item.url || `https://news.ycombinator.com/item?id=${item.id}`, sourceUrl);
  const title = signalPlainText(item.title, 300);
  if (!canonicalUrl || !title) return null;
  const publishedDate = item.time ? new Date(Number(item.time) * 1000) : null;
  return {
    author: signalPlainText(item.by, 160),
    canonicalUrl,
    externalId: String(item.id || ''),
    publishedAt: publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate.toISOString() : null,
    summary: signalPlainText(item.text, 1200),
    title
  };
};

const collectHackerNews = async (source, options) => {
  const dnsCache = new Map();
  const listing = await fetchPublicSignalResource(source.endpoint_url, {
    ...options,
    accept: 'application/json',
    dnsCache,
    headers: conditionalHeaders(source),
    maxBytes: 256 * 1024
  });
  if (listing.notModified) return { ...listing, items: [] };
  let ids;
  try {
    ids = JSON.parse(listing.body);
  } catch {
    throw collectionError('SIGNAL_API_INVALID_JSON', 'Hacker News API 返回了无效 JSON。', { retriable: false });
  }
  if (!Array.isArray(ids)) {
    throw collectionError('SIGNAL_API_INVALID_SHAPE', 'Hacker News API 返回格式不正确。', { retriable: false });
  }
  const maxItems = Math.min(Math.max(Number(source.max_items_per_run) || 1, 1), hackerNewsItemLimit);
  const itemResults = await Promise.allSettled(
    ids.slice(0, maxItems).map(async (id) => {
      const itemUrl = new URL(`${encodeURIComponent(String(id))}.json`, listing.finalUrl).toString();
      const response = await fetchPublicSignalResource(itemUrl, {
        ...options,
        accept: 'application/json',
        dnsCache,
        maxBytes: 128 * 1024
      });
      return parseHackerNewsItem(JSON.parse(response.body), listing.finalUrl);
    })
  );
  if (itemResults.length && itemResults.every((result) => result.status === 'rejected')) {
    throw collectionError('SIGNAL_HACKER_NEWS_ITEMS_FAILED', 'Hacker News 条目读取失败。');
  }
  return {
    ...listing,
    itemErrors: itemResults.filter((result) => result.status === 'rejected').length,
    items: itemResults
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value)
  };
};

const collectXmlFeed = async (source, options) => {
  const response = await fetchPublicSignalResource(source.endpoint_url, {
    ...options,
    headers: conditionalHeaders(source)
  });
  return {
    ...response,
    items: response.notModified
      ? []
      : parseSignalFeed(response.body, response.finalUrl, Math.max(Number(source.max_items_per_run) || 1, 1))
  };
};

export const supportedSignalCollectionAdapters = new Set(['atom', 'hacker_news', 'rss']);

export const getSignalSourceAdapter = (source) => {
  let config = {};
  try {
    config = JSON.parse(source?.config_json || '{}');
  } catch {
    config = {};
  }
  const explicit = String(config.adapter || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (source?.source_type === 'rss') return 'rss';
  return '';
};

export const collectSignalSource = async (source, options = {}) => {
  const adapter = getSignalSourceAdapter(source);
  if (!supportedSignalCollectionAdapters.has(adapter)) {
    throw collectionError('SIGNAL_ADAPTER_UNSUPPORTED', `来源适配器 ${adapter || 'unknown'} 尚未开放。`, {
      retriable: false
    });
  }
  const result = adapter === 'hacker_news' ? await collectHackerNews(source, options) : await collectXmlFeed(source, options);
  return {
    etag: result.headers.get('etag') || source.http_etag || '',
    finalUrl: result.finalUrl,
    httpStatus: result.status,
    itemErrors: result.itemErrors || 0,
    items: result.items,
    lastModified: result.headers.get('last-modified') || source.http_last_modified || '',
    notModified: result.notModified
  };
};

export const signalContentHash = async (item) => {
  const normalized = `${signalPlainText(item?.title, 300).toLowerCase()}\n${signalPlainText(item?.summary, 1200).toLowerCase()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const __signalCollectionTestHooks = {
  collectionError,
  getSignalSourceAdapter,
  normalizePublishedAt,
  parseHackerNewsItem,
  resolveDnsAnswers
};
