const fallbackPath = '/zh-hant/library/';

const validatedPath = (value) => {
  if (typeof value !== 'string' || !value || value.length > 2048) return null;
  let decoded = value;
  // Reject dangerous prefixes even behind multiple percent-encoding layers.
  for (let depth = 0; depth < 8; depth += 1) {
    if (!decoded.startsWith('/') || decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    let url;
    try { url = new URL(decoded, 'https://return.invalid'); } catch { return null; }
    if (url.origin !== 'https://return.invalid' || url.pathname.startsWith('//')) return null;
    let next;
    try { next = decodeURIComponent(decoded); } catch { return null; }
    if (next === decoded) {
      const original = new URL(value, 'https://return.invalid');
      return `${original.pathname}${original.search}${original.hash}`;
    }
    decoded = next;
  }
  return null;
};

export const safeReturnPath = (value, fallback = fallbackPath) =>
  validatedPath(value) || validatedPath(fallback) || fallbackPath;
