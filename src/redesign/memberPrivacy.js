// Keep the existing JSON/body/status/Set-Cookie contract. Only the cache and
// indexing policy for private, cookie-based reader service responses changes.
export function privateReaderResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  const vary = (headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!vary.some(value => value.toLowerCase() === 'cookie')) vary.push('Cookie');
  headers.set('Vary', vary.join(', '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function privateReaderRequest(handler) {
  try { return privateReaderResponse(await handler()); }
  catch { return privateReaderResponse(Response.json({ ok: false, code: 'READER_SERVICE_UNAVAILABLE',
    message: 'Reader service temporarily unavailable.' }, { status: 503 })); }
}
