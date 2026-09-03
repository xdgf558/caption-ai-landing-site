# Station Cat site foundation release checklist

This batch changes canonical URLs, redirects, error pages, icons, social previews, and baseline response headers. It does not enable HSTS in source code because HTTP requests for static assets can bypass the Worker. HTTPS enforcement must be enabled at the Cloudflare zone level.

## Before deployment

- Run `npm test`.
- Run `npm run build` and confirm the postbuild step generates permanent redirects.
- Run `npx --yes wrangler@latest deploy --dry-run`.
- Confirm the custom 404 works through Wrangler with `Sec-Fetch-Mode: navigate`.

## Admin route protection

- Cloudflare Access is the outer gate for both `/admin/` and `/admin-v2/`. An unauthenticated production check on 2026-08-29 returned the Access login redirect for both paths with the configured `CF_ACCESS_AUD`.
- `run_worker_first` includes the bare and nested `/admin` and `/admin-v2` paths so the Worker JWT and email allowlist remain a second gate even when a matching static admin shell exists.
- Admin responses receive `Cache-Control: no-store` and `X-Robots-Tag` from `withPrivateHeaders`; static `_headers` rules do not apply to Worker-first responses.
- The current check confirms present-day protection. It does not prove that the Access application was continuously enabled before this release; use retained Cloudflare logs if a historical audit is required.

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
- Unauthenticated `/admin`, `/admin/`, `/admin-v2`, and `/admin-v2/` requests are intercepted by Cloudflare Access before any admin HTML is returned.
- An unknown navigation URL returns a branded `404` page with a non-empty body.
- Unknown `/en/`, `/ja/`, `/zh-hans/`, and `/zh-hant/` URLs return the matching localized 404 copy.
- `/favicon.ico`, `/favicon-64.png`, and `/apple-touch-icon.png` return `200`.
- Static and dynamic HTML responses include `X-Content-Type-Options`, `Referrer-Policy`, and framing protection.
- The homepage Open Graph image is a `1200x630` PNG and renders in a social-card debugger.

## Deferred batches

- Remaining language-prefix normalization and homepage layout cleanup.

The image, sitemap, caching, and structured-data items moved into the second foundation batch. See `docs/site-performance-search-release-checklist.md`.
