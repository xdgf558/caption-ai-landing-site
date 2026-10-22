import { douyinIDFromURL, douyinShortURL, douyinWatchURL } from './douyinClip.js';
import { fail } from '../music/adminValidation.js';

// Authenticated admin utility only. No cookies/auth forwarding, HTML scraping,
// arbitrary destinations, media proxy, storage or playability claim.
export async function resolveDouyinURL(value, { transport = fetch, timeoutMs = 6000 } = {}) {
  const result = id => ({ videoId: id, url: douyinWatchURL(id), playabilityVerified: false, cachePolicy: 'no-store' });
  const direct = douyinIDFromURL(value);
  if (direct) return result(direct);
  let next = douyinShortURL(value);
  if (!next) fail('STATION_DOUYIN_URL_INVALID', 422);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const visited = new Set();
  try {
    for (let hop = 0; hop < 3; hop++) {
      if (visited.has(next)) break;
      visited.add(next);
      const response = await transport(next, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
        headers: { Accept: 'text/html' } });
      const location = response.headers.get('location');
      await response.body?.cancel(); // Never read the short-link page or its media.
      if (![301,302,303,307,308].includes(response.status) || !location || location.length > 2048) break;
      // Only absolute allowlisted HTTPS targets. Do not follow a terminal video:
      // the path yields the identity without fetching a public playback page.
      const id = douyinIDFromURL(location);
      if (id) return result(id);
      next = douyinShortURL(location);
      if (!next) break;
    }
  } catch { /* One bounded attempt; return a safe, actionable error. */ }
  finally { clearTimeout(timer); controller.abort(); }
  fail('STATION_DOUYIN_RESOLVE_FAILED', 422);
}
