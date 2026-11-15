# Decisions

## StoryCat MVP

- Do not add a backend, database, login, or App Store API integration.
- Keep the TestFlight URL in a single product configuration file.
- Use the current Station Cat paper-style visual language.
- Use the owner-confirmed TestFlight public link for the StoryCat iOS test CTA.
- Use `/zh-hans/` for Simplified Chinese to match the existing site, not `/zh-cn/`.
- Keep `/apps/storycat/` as the canonical English route; `/en/apps/storycat/` is only a compatibility route.

## Two-language site and paper redesign (2026-11-15)

- The website serves Traditional Chinese (default) and English only. `/zh-hans/*` and `/ja/*` return a binding-free 404 from the Worker, with no redirects, as chosen by the owner.
- Content storage, admin metadata and public JSON APIs keep accepting `zh-Hans` and `ja` (`stationContentLocales`) so existing data and the iPhone app are unaffected.
- Known limitation, accepted by the owner (2026-11-15 review): for `locale=zh-Hans` / `ja` the public API still returns track `href` values under `/zh-hans/` and `/ja/`, because older iPhone app builds strictly validate that shape. Those links now open a 404. The fix belongs in the iPhone app (map `zh-Hans` to the Traditional Chinese page and `ja` to the English page); do not change the DTO shape or add redirects without a new owner decision.
- Campaign links can only be created for `zh-Hant` and `en`. Stored zh-Hans/ja campaigns stay readable for history, but report `effective: false` and expose no URL or QR.
- `/downloads/simplecut-pro/` now redirects to the Traditional Chinese download page.
- The in-game Cat Life language options are unchanged; its links to site pages now point at Traditional Chinese or English pages.
- Public pages use the bright paper theme (`paper.css`). Motion is decorative only, never hides content without JavaScript, and is disabled under `prefers-reduced-motion`, including when the preference changes while a page is open.
