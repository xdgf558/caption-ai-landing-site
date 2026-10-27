# Station Cat Music iPhone page

The owner's third selected visual is implemented as a separate `/music/iphone/` page, with matching `/zh-hans/`, `/en/`, and `/ja/` routes. The music catalog links to the page immediately below its introduction. Switching language preserves the iPhone page.

As of 2026-10-27, the primary button opens the released app at `https://apps.apple.com/app/id6822797145`. This country-neutral link was verified to resolve to Apple's Station Cat Music listing, `https://apps.apple.com/us/app/station-cat-music/id6822797145`, which lists the app as free and requiring iOS 18.0 or later. No invitation or separate testing app is needed.

The music catalog marks the iPhone App entry as available. All four page localizations describe published lyrics and stories, device-local notes with offline reading and editing, favorites, and external music-service links. The former installation section is now a short feature introduction; its `#install` anchor remains valid for existing links. The page does not promise full-song playback, offline song downloads, or cross-device synchronization.

The introduction is a compiled public shell served through the existing music route handler and flags. It does not query D1/R2 or load a player. The final music-discovery section links back to the catalog instead of duplicating a current featured-song card: download access does not depend on a live music query, and no public song snapshot is hardcoded. Internal shell routes remain inaccessible. Existing indexing policy, canonical metadata and sitemap alternates cover the new public route.

## Asset sources

- `public/images/station-music-app/icon.webp`: existing Station Cat Music app icon from `station-cat-music-ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`; resized to 256 × 256, WebP, 6,912 bytes.
- `public/images/station-music-app/discover.webp`: real discovery-screen capture from `station-cat-music-ios-platform/docs/platform-20261013/real-home.png`; resized proportionally from 1206 × 2622 to 804 × 1748, WebP, 85,220 bytes. The page viewport hides the OS status bar; the app interface is not reconstructed or retouched. All screenshot controls are part of one labelled image, not interactive web controls.

Both sources are owner-supplied project assets. No third-party app screenshot, generated logo, new font dependency, or live tester count is used. The current description and system requirement were checked against the public App Store listing on 2026-10-27.

## Verification

The existing music/runtime and route/runtime suites cover the four locales, the official App Store link, absence of outdated beta links and copy, GET/HEAD/POST behavior, disabled rollout, canonical redirects, hidden internal templates, absent music DB, absent assets, and compressed assets. Build the full development site for those runtime fixtures and run `npm run build:station:first-launch` to verify the release asset package. The development build with `ALLOW_EMPTY_SERIAL_CONTENT=1` is not a production deployment package.

The original page's browser review compared the selected visual at 1122 px, then checked a 390 px mobile viewport and an 834 px Japanese tablet layout, anchor navigation, catalog entry, keyboard focus, and language switching. That run passed 71 related regressions and 22 staging tests; its release candidate build and staging asset checks passed. Runtime fixtures use disposable D1/R2 only. The App Store copy update is verified separately against newly built assets. Device installation, Safari and VoiceOver have not been tested.

For the 2026-10-27 release-copy update, the full development build and first-launch build passed; the release package contains 64 HTML pages and 432 files and preserves the compatibility manifests. Music-page/runtime regressions passed 27/27 and first-launch package regressions passed 13/13. Browser checks covered the desktop layout, Traditional Chinese, English and Japanese at a 390 px mobile viewport, the feature anchor, and the music catalog's App entry. The mobile page has no horizontal overflow, and each download button targets the official App Store URL. No production deployment or content write was performed during these checks.
