# Station Letters sharing card — Design QA (1.27.0)

## Target, evidence and normalization

Source visual truth: selected Product Design option 1, “小站来信”. Local review copy: `test-results/share-card/source.png` (1086 × 1448). The approved mock is a flat 3:4 export, not a screen with browser chrome.

Rendered implementation: `test-results/share-card/postcard.png` (1080 × 1440), a real PNG downloaded through the Version → Share this update flow. The same image was verified under the exact production game CSP. `desktop.png`, `tablet.png` and `mobile.png` show the surrounding modal at 1280 × 900, 1040 × 900 and 390 × 900 CSS pixels, deviceScaleFactor 1. The export remains 1080 × 1440 at every viewport; it is not a screenshot of the preview.

Full comparison: `test-results/share-card/comparison.png` places both images in one 1620 × 1080 input, each normalized to 810 × 1080. Focused comparison: `footer-comparison.png` puts the bottom 440px of each normalized 1080px-wide poster into one 1080 × 880 input. Both comparison inputs were opened and inspected. The in-app browser was also used to inspect the working modal and controls.

State: local guest, zh-Hant site / existing zh-CN game-copy fallback, generated and ready. The mock's v1.26.2 music copy intentionally becomes current v1.27.0 sharing notes. The illustrative QR is intentionally replaced with a verified real game QR. English and Japanese exports were separately opened to verify line wrapping and layout.

These screenshots are ignored local review artifacts, not committed files or PR attachments, and are not deployed. No private machine paths are embedded in the committed documentation. Previous interaction-polish QA is preserved in `docs/design-qa/cat-interaction-polish.md`.

## Findings and iteration history

- Initial comparison (`comparison-before.png`, `postcard-before.png`): **P2 — the update area was too dense.** Six lines of small 22px copy weakened the postcard hierarchy. The update notes were edited into concise, accurate release copy and Chinese body text increased to 27px; English/JA remain 23px for their longer summaries. Live wrapping is bounded to two lines per note, with full current notes available as selectable text.
- Post-fix comparison (`comparison.png`, `footer-comparison.png`): copy is readable, separated from the brand footer, and does not collide with the QR. The primary scene, title, postal accents and left-copy/right-QR composition are preserved. No remaining actionable P0/P1/P2 visual differences.
- Mobile UI check: the modal header stays available while scrolling to actions. Image preview, instructions and actions stack in one column; desktop uses two columns. Figure default margins were removed. No horizontal overflow at any tested width.
- Functional integration finding: production CSP does not allow blob image previews. The implementation now uses a data-URL preview without weakening CSP; blob URLs remain download-only. All 19 sharing scenarios passed with production CSP applied.
- Test correction: the first close/cleanup assertion ran before the queued native dialog close event. It now waits for actual dialog teardown before asserting zero object URLs. This is a condition-based assertion, not a sleep or retry.

## Required fidelity surfaces

**Fonts and typography:** Noto Serif SC Black provides the large fixed game title in all three languages; a local 10.6 KB subset loads before export. Georgia/system serif provides brand and display labels, matching the reference's editorial contrast; system CJK sans handles the smaller release text. Bounded wrapping, grapheme-safe ellipsis and word-boundary wrapping prevent spillover. Different OS body fallbacks may have minor glyph/metric differences (P3), not fixed-font title drift.

**Spacing and layout rhythm:** fixed 1080 × 1440 export; matching upper brand/title/subtitle zones, cottage scene around 25–69%, update block below and QR on the lower right. Safe QR whitespace is deliberately wider than the fake code in the mock. The brand footer is slightly lower to reserve room for up to three two-line notes; no overlap in Chinese, English, Japanese or long-text unit cases.

**Colors and tokens:** cream paper, cocoa ink, orange postal/update accents and sage details follow the selected reference. The modal uses the existing story paper/ink/orange/green system, with orange focus outlines and no hover translation or new motion.

**Image quality and asset fidelity:** the actual selected scene was edited through built-in ImageGen to remove overlaid type and fake QR while preserving the cat, orange bow, cottage, flowers, signs and postal marks. The 158 KB WebP is sharp at export size. Actual existing Station Cat logo is reused; no CSS art, emoji or handmade SVG substitutes. Real QR uses square integer modules, black on white, four-module quiet zone and no overlapping logo.

**Copy/content:** live latest notes and version only; Station Cat is introduced as a personal creative brand (“从零做产品，写故事，记录日常。”), not as the player's identity. Interface distinguishes saving/manual Moments posting, an X draft requiring manual image attachment, and supported native sharing. Loading, failure, retry, manual-copy, cancellation and native-share failure have explicit copy in zh-CN/en/ja. No simulated-QR label remains.

## Interaction and accessibility checks

- Entry is a real button with a stable ID. Native modal supplies focus containment and Escape close; sticky Close stays reachable. Close returns focus to the latest entry even after redraw.
- Image alt text describes the card and points to selectable equivalent text. The readonly text field has a real label. Status uses a polite live region. Controls are at least 44px high.
- PNG generation completes before save/native sharing is enabled. No incomplete download is offered.
- Explicit `render(true)` and actual commerce response completion preserve image, selected text and focused control.
- Failed illustration/font/QR loading can retry. Closing during generation prevents stale modal/image resurrection. Closing/retry revokes object URLs.
- Clipboard rejection selects copyable text; native capability/success/cancel/failure are covered without contacting real social accounts.
- QR independently decoded from actual PNG and from 540px JPEG quality 80, for every tested locale/viewport.

## Verification and limits

Local verification on 2026-09-08: 7/7 sharing unit tests, 19/19 sharing browser tests under production CSP, full game browser suite **139/139** under TZ=UTC, full `npm test`, 144-page Astro build and whitespace/syntax checks passed. No GitHub CI result is claimed before a PR exists.

OS share sheets and real X/WeChat publishing were not invoked. Native handoff behavior is mocked in automated tests; a physical iPhone/WeChat save/scan check remains useful before release. No new Worker, database, account or save schema changes; no deployment or posting performed.

Asset paths, licenses and the final built-in ImageGen edit prompt are recorded in `docs/cat-life-game-sharing.md`.

final result: passed
