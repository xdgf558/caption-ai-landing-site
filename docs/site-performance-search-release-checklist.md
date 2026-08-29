# Station Cat performance and search release checklist

This batch reduces homepage image transfer, adds immutable caching for fingerprinted assets, generates a complete sitemap with `lastmod`, and publishes Organization, WebSite, and Book structured data. It does not change language-prefix routing or enable HSTS.

## What changed

- The homepage uses responsive, content-fingerprinted WebP variants for the Station Cat logo, six product icons, and the featured novel cover.
- `/_astro/*` and `/images/optimized/*` receive one-year immutable cache headers. Social and icon assets use shorter, non-immutable cache lifetimes.
- `scripts/generate-sitemap.mjs` scans the built public pages, excludes admin, member, 404, and retired devlog routes, and adds a stable source-commit `lastmod` date.
- `/sitemap.xml` runs through the Worker so published D1 Signal briefs, novel series, and novel chapters are added with their own update dates without waiting for another deployment.
- The four homepage locales emit Organization and WebSite JSON-LD. Static and D1-backed novel series pages emit Book JSON-LD.
- Retired devlog pages remain reachable for recovery but now use `noindex, follow` and are absent from the sitemap.

## Before deployment

- Run `npm test`.
- Run `npm run build`; confirm the postbuild step reports a generated sitemap and all built-site checks pass.
- Run `npx --yes wrangler@latest deploy --dry-run`.
- Confirm `wrangler.toml` keeps `/sitemap.xml` in `run_worker_first`.
- Confirm no source file named `public/sitemap.xml` exists; the build owns this artifact.

## Production smoke checks

- `/` serves WebP image URLs under `/images/optimized/` and includes responsive `srcset` attributes.
- A request to a fingerprinted image returns `Cache-Control: public, max-age=31536000, immutable`.
- `/sitemap.xml` returns XML, includes `<lastmod>`, `/novel/`, `/signal/`, published D1 content, and no `/devlog/`, `/admin/`, or `/library/` locations.
- The homepage source contains Organization and WebSite JSON-LD.
- A published novel series source contains Book JSON-LD with its canonical URL.
- Existing social preview, localized 404, HTTPS redirect, and admin Access checks still pass.

## Rollback notes

- Reverting the homepage image references is independent from the Worker and sitemap changes.
- If the dynamic sitemap handler fails, it is designed to return the generated static sitemap without D1 additions.
- Keep the generated `dist/sitemap.xml` path available before removing `/sitemap.xml` from `run_worker_first`.
- Do not remove the general static security-header block when changing asset cache rules.
