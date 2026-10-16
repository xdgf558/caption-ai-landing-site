# Public music links and favorite presentation — 2026-10-16

Paired iOS development candidate: **0.1.0 (8)**. This batch prepares public song navigation and an explicitly cacheable, minimal favorite label. It does not deploy the website, enable Universal Links, activate native accounts/audio/sync, or upload a TestFlight build.

## Favorite presentation contract

`GET|HEAD /api/station/content/tracks/{slug}/bookmark?locale=…` returns:

```json
{"schemaVersion":1,"locale":"en","bookmark":{"id":"<UUID>","slug":"<canonical-slug>","revision":1,"title":"…","artist":"…"}}
```

It uses the existing public-content switch, request validation, runtime/schema readiness, catalog rate limit and published-track query. It validates ID, slug, revision, publication time and localized metadata, without reading media from R2. Missing, withdrawn or archived content returns the existing no-store error. Public 404 responses intentionally do not distinguish withdrawal from a nonexistent address.

Only successful bookmark responses permit private reuse for up to 24 hours:

```http
Cache-Control: private, max-age=86400, must-revalidate
CDN-Cache-Control: no-store
Cloudflare-CDN-Cache-Control: no-store
Date: <response date>
```

Catalog and full-detail responses remain no-store. The projection contains no artwork URL, audio URL, platform link, account data or availability assertion. The iOS client persists only these approved labels and reduced HTTP freshness, separately from durable favorite IDs. Expired or unavailable metadata falls back to a saved-work placeholder; it never erases a favorite. Opening a song or platform still requires an online detail response with matching identity. Withdrawal cannot remotely erase a valid snapshot already downloaded to a device.

## Independent public association profile

The existing `/.well-known/apple-app-site-association` handler may select the new public profile only when all of these are explicitly configured:

```text
STATION_PUBLIC_APP_LINKS_ENABLED=true
STATION_PUBLIC_APP_LINKS_PROFILE=station-cat-music-platform-links-v1
STATION_CONTENT_PUBLIC_ENABLED=true
```

No deployment configuration was changed. The existing native association path remains unchanged when the new profile is not selected. The public profile validates the exact `https://wwwstationcat.org` origin, AASA path, method and absence of query parameters before returning an association. It needs no native-account, payment, music entitlement or private media bindings.

The profile contains only `applinks` for `2AM5S7BM2N.org.stationcat.music`, with root, zh-hant, zh-hans, en and ja song routes. It excludes fragments, encoded paths and nested song descendants, and retains historical music-root links carrying a UUID-shaped `track` parameter. It declares no `webcredentials` or authentication callback.

AASA is routing, not the complete input validator. The paired iOS parser independently rejects credentials, unexpected ports, fragments, encoded path aliases, unknown/duplicate query parameters and invalid slugs/IDs. Canonical slug links accept only `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`, each 1–128 ASCII letters/digits or `._~-`, with a 640-byte encoded-query cap. Attribution is only in the current navigation context; no analytics or persistent attribution store is introduced. Song detail queries and shared URLs use the canonical path.

Canonical slug links can resolve directly before the catalog finishes, after a failed catalog load, or for a new song absent from the loaded list. Historical UUID links retain their existing catalog lookup. Links do not initiate playback or grant access.

## Verification and delivery boundary

- `npm run test:redesign:public`: **60/60**, including actual Miniflare/D1/R2 tests and four-locale bookmark responses.
- `node --test scripts/test-mobile-production-association.mjs scripts/test-platform-links-bookmarks.mjs`: **84/84**.
- Development build and postbuild: **181 pages**, using `ALLOW_EMPTY_SERIAL_CONTENT=1`. This is not a production deployment artifact.
- Both repositories contain the same 56-case link matrix. `tests/fixtures/platform-link-cases.json` SHA-256: `1dce0ad82c4f2b491b908396470518cdbcc5111abbd81d5150501577f6a6db40`.
- Paired iOS local tests: 265 passed, 23 dedicated probes skipped, zero failures; six UI checks passed. A final focused run passed 19 unit tests and the offline terminate/relaunch UI test. Toolchain: Xcode 27.1 / iOS 27.0 simulator; this is not the pinned remote CI result.

The test matcher is a local contract checker, not Apple's implementation. No current remote CI, live cross-repository HTTPS acceptance, Apple CDN delivery, signed public-links distribution or physical-device link handoff is claimed. All four committed iOS configurations leave the new link flag off, and the prepared public-only entitlements file is not selected by default.

Review the paired changes, then deploy the website contract before relying on bookmark labels in a new iOS candidate. An older server safely produces placeholders. Enabling AASA remains a separate deliberate release action: recheck the origin and Apple CDN, exported signed entitlements/provisioning, and cold/warm external links on a device. Merging these changes does not authorize that activation.
