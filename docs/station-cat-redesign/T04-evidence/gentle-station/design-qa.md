**Findings**

No actionable P0/P1/P2 remains for the T04 isolated visual-system/navigation scope. This does not accept T05 production content, audio playback, accounts, native synchronization, game startup, or deployment.

**Visual truth and comparison**

- Current source: `docs/station-cat-redesign/T04-evidence/gentle-station/source.png`, 1448×1086. User selected this exact image on 2026-10-06 and separately confirmed five navigation entries. Template 2 is superseded.
- Content reference: `reference-content.png`, 1356×996, excluding the painted browser chrome and outside canvas.
- Latest implementation: `desktop-final.jpg`, 1356×1107 browser pixels; CSS viewport 1371×996, DPR 1, client width 1356 because of the 15px scrollbar. Comparison crop through the footer is 1356×998. No density rescaling on the final pair; footer bottom is 997.77 CSS px. The separate local test panel is excluded.
- State: Traditional Chinese, logged-out static fixture, no selected media, closed menus/dialog, unset wishlist, promotion/platform/preview data unconfigured. The design’s release badges are deliberately labelled samples and unconfigured controls are disabled.
- Full-view pair opened together: `comparison-final.jpg`. Focused pairs also opened together: `focused-final-navigation.jpg`, `focused-final-hero-copy.jpg`, `focused-final-cards.jpg`, `focused-final-news.jpg`. Text and controls require those focused views, not only a reduced full-page pair.

**Five required fidelity surfaces**

- Fonts/typography: bold sans-serif title at 39px/900 matches the source’s heavy display hierarchy; system CJK fallback is used rather than incomplete old serif subsets. Body, card and badge sizes compared in focused views. English/Japanese tablet wrapping and mobile line balance were recaptured. Exact font files are not supplied, so platform fallback glyph differences remain an expected limit.
- Spacing/layout rhythm: centered five-entry group, 62px header, 313.56px hero, 1296px content, 263.03px paired cards, 85px promotion strip, 125.18px news cards and 78px footer. Source content height 996 versus implementation 997.77; region order and density align. Mobile/panel padding and measured bottom reserve verified separately.
- Colors/tokens: pale paper, navy text, lavender accents, powder-blue game and pink music surfaces agree with the reference balance. Subtle painted gradients are simplified to quiet solid UI surfaces. Focus outlines are intentionally stronger than the un-focused source. Tablet text no longer crosses the dark city illustration.
- Image quality: reference-based built-in image_gen assets retain the headphones cat, twilight town, backpack cat, cover titles and daily silhouette. Actual bitmap assets and stock Phosphor/Lucide icons are used; no CSS/handcrafted SVG/emoji substitute artwork. Reconstructions vary in brushwork/crop and are not original game screenshots or album files. Transparent logo alpha and WebP derivatives checked.
- Copy/content: brand heading and section order follow the image; localized UI supplied in four languages. Sample labels, disabled pending platform/preview states, local-only wishlist notice and current copyright year intentionally preserve the known operational boundary. The screenshot’s stationcat.co address did not change site configuration. About uses its actual existing Traditional Chinese URL; it does not claim four localized production About pages.

**Comparison and fix history**

- Iteration 1 — `comparison-initial.jpg` / `desktop-initial.jpg`: P2 navigation too far right, headline too light, inline badge/news line boxes added roughly 30px, and daily card reused the album art. Fixed centered navigation, weight 900, measured header/badge rhythm, full paragraph width and dedicated source-based daily illustration. Result remained blocked pending recapture.
- Iteration 2 — `comparison-revised.jpg` / `desktop-revised.jpg` with focused navigation/hero/cards/news: navigation and heading corrected; remaining P2 news row rhythm put the footer about 15px too low. Fixed news header/badge line boxes; final news cards 125.18px and footer 997.77px, with `desktop-final-geometry.json` and final paired views.
- Iteration 3 — initial locale captures and `locale-observations.json`: P2 isolated trailing words in mobile/tablet headings. Removed forced mobile line breaks, balanced English tablet copy and adjusted international type scale. New phone captures and `locale-final-observations.json` show no overflow and 44px CTAs.
- Iteration 4 — `interaction-observations.json` retains `closeFocusInitial:false`: search-input Escape cleared the query and kept the dialog open. Fixed capture-phase Escape handling. `escapeFinal` and `closeButtonFinal` both show closed=true and focusReturned=true; `search-filtered-390.jpg` verifies rendered filtered state.
- Iteration 5 — intermediate `locale-en-768.jpg` revealed P2 body text on the dark city art, despite no geometric overflow. Switched tablet hero to vertically separated text/image. Final four-language `locale-*-768.jpg` and `tablet-final-observations.json` show copyBottom=imageTop, no overlap, no overflow, and 44px CTAs. English/Japanese final renders opened and inspected. Recaptured the final desktop and paired focused views after this change.

**Interaction and responsive evidence**

- Five widths 375/390/768/1280/1440: no horizontal overflow; `responsive-observations.json` is initial evidence, final tablet overrides are in `tablet-final-observations.json`.
- Four languages at 375/768: latest phone captures and final tablet captures verified. There is no separate source mobile mock, so mobile is a responsive adaptation, not a claimed pixel-identical reference match.
- Five destinations clicked: Home/Music/Games/Member/About each selects correctly; Member reuses /library/ and About uses /about/. Safe track/collection preserved on actual language click, dummy private parameter removed.
- Search: focus on open, filtering, empty state, destination click, Escape and close-button focus return passed. Wishlist toggles and clears on reload; no persistence/cloud claim. Skip link Enter focuses main; language Escape returns to summary.
- 390×844 stack: nav main 64px + dock 125px + simulated safe area 34px + 24px = 247px reserve; dock bottom=nav top=746px; last action bottom573.14 < dock top621. Runtime toggle hides all site chrome and sets padding0; close dock returns focus. See `stack-runtime-observations.json` and viewport screenshots.
- Media count 0, default dock hidden. Console error/warn observations: 0 (`console-observations.json`). These are local browser results, not a physical-device or production-service test.

**Open Questions / residual limits**

Promotion song, release URLs, preview switch and videos remain “稍后确定”. Art from a flattened source is reconstructed. About content/localization must be prepared before production integration, and T20 must reconcile its future new-content route with the old-content retirement proposal. Full screen-reader, device, media and service checks remain future-task work.

**Implementation Checklist**

Completed source selection, full/focused final visual comparison, P2 repairs and recaptures, local routes/builds, keyboard/search/wishlist/nav checks, bottom geometry and production-isolation scan. Keep the preview running and hand off only T04 in PR189 for user review.

**Follow-up Polish**

P3: exact original font/illustration files would improve pixel fidelity; small waveform and handwritten promotion flourish are omitted in the unconfigured sample. Platform-specific marks can replace the generic pending symbols after real platform configuration. These do not block this isolated T04 review.

final result: passed
