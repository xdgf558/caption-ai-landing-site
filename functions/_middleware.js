const ADMIN_PATH_PATTERN = /^\/admin(?:\/|$)/;
const DEFAULT_ADMIN_EMAIL = 'brodstem@protonmail.com';

export async function onRequest(context) {
  const { request, env } = context;
  const pathname = new URL(request.url).pathname;

  if (!ADMIN_PATH_PATTERN.test(pathname)) {
    return context.next();
  }

  const config = getAccessConfig(env);
  if (!config.isConfigured) {
    return deny(
      503,
      'Admin access is locked until Cloudflare Access environment variables are configured.'
    );
  }

  const token = getAccessToken(request);
  if (!token) {
    return deny(401, 'Cloudflare Access sign-in is required for this admin page.');
  }

  try {
    const payload = await verifyAccessJwt(token, config);
    const email = String(payload.email || '').trim().toLowerCase();

    if (!email || !config.allowedEmails.has(email)) {
      return deny(403, 'This email is not allowed to open the admin page.');
    }

    return withPrivateHeaders(await context.next());
  } catch (error) {
    return deny(401, 'Cloudflare Access token is invalid or expired.');
  }
}

function getAccessConfig(env) {
  const teamDomain = normalizeTeamDomain(
    env.CF_ACCESS_TEAM_DOMAIN || env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || ''
  );
  const audiences = splitEnvList(env.CF_ACCESS_AUD || env.CLOUDFLARE_ACCESS_AUD || '');
  const allowedEmails = new Set(
    splitEnvList(env.ADMIN_ALLOWED_EMAILS || DEFAULT_ADMIN_EMAIL).map((email) =>
      email.toLowerCase()
    )
  );

  return {
    allowedEmails,
    audiences,
    isConfigured: Boolean(teamDomain && audiences.length && allowedEmails.size),
    teamDomain
  };
}

function getAccessToken(request) {
  const headerToken = request.headers.get('Cf-Access-Jwt-Assertion');
  if (headerToken) {
    return headerToken.trim();
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const cookieToken = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('CF_Authorization='));

  return cookieToken ? decodeURIComponent(cookieToken.split('=').slice(1).join('=')) : '';
}

async function verifyAccessJwt(token, config) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported JWT header');
  }

  if (!config.audiences.some((audience) => payloadHasAudience(payload.aud, audience))) {
    throw new Error('Invalid JWT audience');
  }

  if (normalizeTeamDomain(payload.iss || '') !== config.teamDomain) {
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

  if (!valid) {
    throw new Error('Invalid JWT signature');
  }

  return payload;
}

async function getAccessJwk(teamDomain, kid) {
  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
    cf: { cacheEverything: true, cacheTtl: 3600 }
  });

  if (!response.ok) {
    throw new Error('Unable to load Cloudflare Access certificates');
  }

  const jwks = await response.json();
  const jwk = jwks.keys?.find((key) => key.kid === kid);

  if (!jwk) {
    throw new Error('Cloudflare Access signing key not found');
  }

  return jwk;
}

function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(part)));
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function payloadHasAudience(payloadAudience, expectedAudience) {
  if (Array.isArray(payloadAudience)) {
    return payloadAudience.includes(expectedAudience);
  }

  return payloadAudience === expectedAudience;
}

function normalizeTeamDomain(value) {
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (trimmed.includes('.')) {
    return `https://${trimmed}`.toLowerCase();
  }

  return `https://${trimmed}.cloudflareaccess.com`.toLowerCase();
}

function splitEnvList(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function deny(status, message) {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex, nofollow">
    <title>Admin Access</title>
    <style>
      body {
        align-items: center;
        background: #05070a;
        color: #f8fafc;
        display: flex;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
        padding: 24px;
      }

      main {
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 22px;
        max-width: 520px;
        padding: 28px;
      }

      h1 {
        font-size: 24px;
        margin: 0 0 12px;
      }

      p {
        color: #cbd5e1;
        line-height: 1.7;
        margin: 0;
      }
    </style>
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
}

function withPrivateHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
