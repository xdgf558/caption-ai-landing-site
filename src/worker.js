const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
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

    if (request.method === 'GET' && url.pathname === '/api/novels/access') {
      return handleNovelAccessCheck(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/api/novels/library') {
      return handleNovelLibrary(request, env);
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
