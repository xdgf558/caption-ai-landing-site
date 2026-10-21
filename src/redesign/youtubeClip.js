// Revision-bound YouTube references, never a remote fetch or a media proxy.
export const youtubeVideoID = value => typeof value === 'string' && value.length === 11 && /^[A-Za-z0-9_-]{11}$/.test(value);
export const youtubeWatchURL = id => youtubeVideoID(id) ? `https://www.youtube.com/watch?v=${id}` : null;

export function youtubeIDFromURL(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
        !/^https:\/\/(www\.youtube\.com|youtube\.com|m\.youtube\.com|youtu\.be)\//.test(value)) return null;
    let id;
    const allowed = ['si', 'feature'];
    if (url.hostname === 'youtu.be') id = /^\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1];
    else if (url.pathname === '/watch') { id = url.searchParams.get('v'); allowed.push('v'); }
    else id = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    if (!youtubeVideoID(id)) return null;
    for (const [key, item] of url.searchParams) {
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1 ||
          (key === 'si' && !/^[A-Za-z0-9_-]{1,128}$/.test(item)) ||
          (key === 'feature' && !['share', 'shared'].includes(item))) return null;
    }
    // Do not persist share identifiers or turn arbitrary query data into HTML.
    return id;
  } catch { return null; }
}

export function youtubeReference(metadata) {
  const value = metadata?.youtube;
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'embeddingConfirmed,videoId' &&
    youtubeVideoID(value.videoId) && value.embeddingConfirmed === true ? value : null;
}
