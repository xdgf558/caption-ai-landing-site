export const defaultAdminEmail = 'brodstem@protonmail.com';

export const splitEnvList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export const normalizeAccessTeamDomain = (value) => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.includes('.')) return `https://${trimmed}`.toLowerCase();
  return `https://${trimmed}.cloudflareaccess.com`.toLowerCase();
};

export const getAdminAccessConfig = (env) => {
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

export const getAccessToken = (request) => {
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

  if (!response.ok) throw new Error('Unable to load Cloudflare Access certificates');

  const jwks = await response.json();
  const jwk = jwks.keys?.find((key) => key.kid === kid);
  if (!jwk) throw new Error('Cloudflare Access signing key not found');
  return jwk;
};

export const verifyAccessJwt = async (token, config) => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported JWT header');

  if (!config.audiences.some((audience) => payloadHasAudience(payload.aud, audience))) {
    throw new Error('Invalid JWT audience');
  }

  if (normalizeAccessTeamDomain(payload.iss || '') !== config.teamDomain) {
    throw new Error('Invalid JWT issuer');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now) throw new Error('JWT expired');
  if (Number.isFinite(payload.nbf) && payload.nbf > now + 60) throw new Error('JWT not active yet');

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

export const musicAdminActor = async (request, env) => {
  const denied = (code, status) => Object.assign(new Error(code), { code, status });
  const config = getAdminAccessConfig(env);
  if (!config.isConfigured) throw denied('ADMIN_AUTH_UNAVAILABLE', 503);

  try {
    // Music APIs deliberately do not inherit Host-header/local-bypass actor shortcuts.
    const payload = await verifyAccessJwt(getAccessToken(request), config);
    const email = normalizeEmail(payload.email);
    if (!email || email.length > 200 || !config.allowedEmails.has(email)) {
      throw denied('ADMIN_FORBIDDEN', 403);
    }
    return email;
  } catch (error) {
    if (error.code === 'ADMIN_FORBIDDEN') throw error;
    throw denied('ADMIN_AUTH_REQUIRED', 401);
  }
};
