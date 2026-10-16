# Station Cat Music iPhone page

The owner's third selected visual is implemented as a separate `/music/iphone/` page, with matching `/zh-hans/`, `/en/`, and `/ja/` routes. The music catalog links to the page immediately below its introduction. Switching language preserves the iPhone page.

The primary button opens the owner-provided public TestFlight invitation, `https://testflight.apple.com/join/eEtSur8y`. Installation instructions link to Apple's TestFlight app. The page describes discovery, device-local favorites, and external listening links; it does not promise on-site/full audio, offline downloads, or account synchronization.

The introduction is a compiled public shell served through the existing music route handler and flags. It does not query D1/R2 or load a player. The final music-discovery section links back to the catalog instead of duplicating a current featured-song card: download access does not depend on a live music query, and no public song snapshot is hardcoded. Internal shell routes remain inaccessible. Existing indexing policy, canonical metadata and sitemap alternates cover the new public route.

## Asset sources

- `public/images/station-music-app/icon.webp`: existing Station Cat Music app icon from `station-cat-music-ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`; resized to 256 × 256, WebP, 6,912 bytes.
- `public/images/station-music-app/discover.webp`: real discovery-screen capture from `station-cat-music-ios-platform/docs/platform-20261013/real-home.png`; resized proportionally from 1206 × 2622 to 804 × 1748, WebP, 85,220 bytes. The page viewport hides the OS status bar; the app interface is not reconstructed or retouched. All screenshot controls are part of one labelled image, not interactive web controls.

Both sources are owner-supplied project assets. No third-party app screenshot, generated logo, new font dependency, or live tester count is used. The beta description was checked against the public TestFlight page on 2026-10-16.

## Verification

The existing music/runtime and route/runtime suites cover the four locales, real invitation/download links, GET/HEAD/POST behavior, disabled rollout, canonical redirects, hidden internal templates, absent music DB, absent assets, and compressed assets. Build the full development site for those runtime fixtures and run `npm run build:station:first-launch` to verify the release asset package. The development build with `ALLOW_EMPTY_SERIAL_CONTENT=1` is not a production deployment package.

Local browser review compares the selected visual with the new page at 1122 px, then checks a 390 px mobile viewport and an 834 px Japanese tablet layout, the install anchor, return navigation, catalog entry, keyboard focus, and language switching. The final run passed 71 related regressions and 22 staging tests; the release candidate build passed, and the isolated staging package generated and verified 8 pages with 39 exact resources. Runtime fixtures use disposable D1/R2 only. No deployment or production content write is part of this change. Device installation, Safari and VoiceOver have not been tested.
