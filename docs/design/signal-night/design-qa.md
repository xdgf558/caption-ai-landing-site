# Signal / Journal — design QA

Final result: passed

## Reference and scope

User requested a similar style to the previously approved Station Cat pages, not a pixel copy of a new mockup. Visual source: `docs/design/signal-night/reference-home.png`, captured from https://wwwstationcat.org/ on 2026-09-15. Implementation: http://127.0.0.1:4197/signal/ using a local snapshot of five public articles. All preview writes use ephemeral SQLite/R2 fixtures; no production records are changed.

## Evidence

- Full-view comparison: `reference-home.png` and `desktop.png`, shown together. Both use 1280 × 720 CSS viewports; browser captures are 1265 × 712 px. Equal capture sizes were compared directly, without density conversion.
- Focused article-region evidence: `desktop-articles.png`; title, metadata, image crop and action contrast checked at readable size.
- Mobile: `mobile.png`, `mobile-articles.png`, `mobile-en.png`, `mobile-ja.png`, `mobile-share.png`. CSS viewport 390 × 844; captures 375 × 812 px. Browser snapshots are slightly scaled/cropped; no comparison against a device bezel or status bar.
- Tablet: `tablet.png`, CSS viewport 768 × 1024 (capture 753 × 894 px). Layout also checked with DOM width measurements.
- Reader: `mobile-reader-final.png`, same viewport and pixel dimensions as the earlier `mobile-reader.png`.
- All evidence paths above are relative to `docs/design/signal-night/`.

## Fidelity review

Typography: serif display headings and Station Cat brand, system sans for controls/body. CJK and English wrapping checked; article titles remain complete. Reader body is #d2dbe1 on #09151c, with brighter headings and gold links.

Spacing: full-bleed desk hero, constrained 1128px content, featured article spanning the grid, two-column supporting cards and single-column mobile cards. Page and document widths match at desktop/mobile/tablet; the original 100vw overflow was removed. Mobile navigation wraps rather than hiding existing destinations.

Colors: same midnight blue family, #f5ca80 warm gold, off-white titles and muted secondary text as the reference. Explicit dialog/button/input colors avoid white-on-white controls. Keyboard focus is visible and disabled actions remain distinct.

Images: reused the actual site cat mark and home-night/novel.webp desk illustration. Public article covers retain their original content, with responsive crops. Missing-cover articles use text layout, not invented artwork. Hero is decorative with empty alt; no new image/font/icon dependencies.

Copy: four localized hub interfaces. Existing article titles, descriptions, source links, language labels, reading links, share data and pagination remain data driven. The larger first article is the first returned article, not an invented editorial endorsement. The article page intentionally has different copy and a 390px hero versus the homepage's shorter hero; same style, different content purpose.

## Comparison history

1. Initial pass: P1 dark inherited headings; P2 inherited hidden mobile brand and 100vw horizontal overflow. Fixed explicit scoped heading/brand styles and replaced viewport-wide margins with container gutters. Rechecked desktop and mobile screenshots plus DOM widths.
2. Mobile header: isolated X link wrapped awkwardly. Moved it beside the brand on narrow screens; verified localized headers and mobile snapshots.
3. Reader pass: P1 inherited paragraph color was too dark (`mobile-reader.png`). Scoped article prose to #d2dbe1 and restored gold source links. Rechecked at the same 390 × 844 viewport (`mobile-reader-final.png`) and confirmed computed paragraph color. No remaining P0/P1/P2 visual findings.

## Verification

Existing `test-signal-articles.mjs` and `test-signal-strip.mjs` passed. Astro build and postbuild foundation checks passed with ALLOW_EMPTY_SERIAL_CONTENT=1 and PUBLIC_MUSIC_ENTRY_ENABLED=true for local preview only. Existing private serial content is absent in this worktree; this build is not a production release artifact. `git diff --check` passed.

Browser interactions: start-reading anchor; all four language destinations and active state; internal article open/back; share dialog open, image generation and close; no error-level console messages in inspected pages. External X URLs inspected without posting. Sharing appearance changed; image generation itself was not redesigned.

Remaining validation boundary: desktop browser responsive emulation is not physical iPhone/WeChat or production deployment verification. No deployment performed.
