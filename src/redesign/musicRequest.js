import { contentBase } from './publicValidation.js';
import { readMusicResponse } from './musicResponse.js';

export async function requestStationMusic(path, controller = new AbortController(), fetcher = globalThis.fetch) {
  if (typeof path !== 'string' || !path.startsWith(contentBase + '/') || /[\\#\s]/.test(path)) throw new Error('INVALID_ENDPOINT');
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    const text = await readMusicResponse(response);
    let body;
    try { body = JSON.parse(text); } catch { throw new Error('INVALID_RESPONSE'); }
    if (!response.ok) throw Object.assign(new Error('QUERY_FAILED'), { status: response.status, code: body.code });
    if (controller.signal.aborted) throw new DOMException('Request no longer current', 'AbortError');
    return body;
  } finally { clearTimeout(timer); }
}
