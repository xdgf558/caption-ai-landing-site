# Station Cat site foundation release checklist

This batch changes canonical URLs, redirects, error pages, icons, social previews, and baseline response headers. It does not enable HSTS in source code because HTTP requests for static assets can bypass the Worker. HTTPS enforcement must be enabled at the Cloudflare zone level.

## Before deployment

- Run `npm test`.
- Run `npm run build` and confirm the postbuild step generates permanent redirects.
- Run `npx --yes wrangler@latest deploy --dry-run`.
- Confirm the custom 404 works through Wrangler with `Sec-Fetch-Mode: navigate`.

## Cloudflare zone settings

1. In SSL/TLS > Edge Certificates, enable **Always Use HTTPS**.
2. Verify `http://wwwstationcat.org/` returns a single permanent redirect to `https://wwwstationcat.org/`.
3. Verify every production hostname and required subdomain works over HTTPS.
4. Only after those checks, enable **HTTP Strict Transport Security (HSTS)** with a conservative initial max-age. Do not enable preload in this batch.
5. Enable `includeSubDomains` only after every current and future subdomain is confirmed to support HTTPS.

References:

- [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)
- [HTTP Strict Transport Security](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)

## Production smoke checks

- `/zh-hant` and `/zh-hant/` return `301` to `/`.
- A slashless generated page such as `/about` returns `301` to `/about/`.
- `/signal` and localized Signal paths return `301` to their trailing-slash forms.
- An unknown navigation URL returns a branded `404` page with a non-empty body.
- `/favicon.ico`, `/favicon.svg`, and `/apple-touch-icon.png` return `200`.
- Static and dynamic HTML responses include `X-Content-Type-Options`, `Referrer-Policy`, and framing protection.
- The homepage Open Graph image is a `1200x630` PNG and renders in a social-card debugger.

## Deferred batches

- Image conversion, responsive sources, and long-lived immutable asset caching.
- Sitemap generation with `lastmod`, complete public routes, and retired devlog handling.
- Organization, WebSite, and Book structured data.
- Remaining language-prefix normalization and homepage layout cleanup.
