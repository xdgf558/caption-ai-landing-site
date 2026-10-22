// Only a public single-video identity is stored; never share tokens or iframe HTML.
export const douyinVideoID = value => typeof value === 'string' && /^[1-9][0-9]{15,19}$/.test(value) && !/[^0-9]/.test(value);
export const douyinWatchURL = id => douyinVideoID(id) ? `https://www.douyin.com/video/${id}` : null;
const shareFields = new Set(['region','mid','u_code','did','iid','with_sec_did','share_sign','share_version','titleType','timestamp','app','previous_page','from','source','share_app_id','share_link_id','sec_uid','utm_source','utm_campaign','utm_medium']);
function address(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value) ||
      !/^https:\/\/(www\.douyin\.com|www\.iesdouyin\.com|v\.douyin\.com)\//.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || url.hash || url.pathname.includes('%') || /\/\.{1,2}(?:\/|$)/.test(value)) return null;
    for (const [key, item] of url.searchParams) {
      if (!shareFields.has(key) || url.searchParams.getAll(key).length !== 1 || !/^[A-Za-z0-9._~-]{1,256}$/.test(item)) return null;
    }
    return url;
  } catch { return null; }
}
export function douyinIDFromURL(value) {
  const url = address(value);
  if (!url) return null;
  const match = url.hostname === 'www.douyin.com' ? /^\/video\/([1-9][0-9]{15,19})\/?$/.exec(url.pathname)
    : url.hostname === 'www.iesdouyin.com' ? /^\/share\/video\/([1-9][0-9]{15,19})\/?$/.exec(url.pathname) : null;
  return match?.[1] ?? null;
}
export function douyinShortURL(value) {
  const url = address(value);
  return url?.hostname === 'v.douyin.com' && !url.search && /^\/[A-Za-z0-9_-]{4,64}\/$/.test(url.pathname) ? url.href : null;
}
export function douyinReference(metadata) {
  const value = metadata?.douyin;
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'embeddingConfirmed,videoId' &&
    douyinVideoID(value.videoId) && value.embeddingConfirmed === true ? value : null;
}
