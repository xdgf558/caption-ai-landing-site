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
- The in-game Cat Life language options are unchanged; its links to site pages now point at Traditional Chinese or English pages.
- Public pages use the bright paper theme (`paper.css`). Motion is decorative only, never hides content without JavaScript, and is disabled under `prefers-reduced-motion`.
