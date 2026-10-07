# T08 Design QA

final result: passed

## Findings and repairs

No unresolved P0/P1/P2 visual or interaction finding remains in the locally verified T08 catalog/detail scope. The narrowest 320 CSS px viewport initially overflowed because the inherited shell reserved a 320 px minimum body while the IAB client width was 305. Removing that fixed minimum repaired it; final DOM scroll/client widths are equal at all five checked widths. `catalog-320-initial.jpg` preserves the first pass, `catalog-320.jpg` the corrected view.

Player controls initially sat against the viewport edge. Internal padding now aligns title/seek/close controls, without covering the mobile navigation. Closing the player also clears its prepared full-audio state; it cannot leave a ready button with no corresponding selection. Catalog history restores the selected sort without pushing another entry. The local proxy now forwards 302 instead of following it inside the closed test Worker, preserving the real browser destination. Valid selected songs also render without a featured promotion; this independent state is covered by a targeted renderer test. Current catalog DTOs take precedence over home summaries, so overlapping selected IDs cannot erase the versions needed by a visible preview button.

## Comparison target and normalization

The authoritative visual is the user's T04 “温柔小站” source, saved as `../T04-evidence/gentle-station/reference-content.png`, 1356 × 996, without its painted browser frame. T08 reuses that approved brand/navigation/tokens/illustration style for new music screens. The source is a homepage, not a catalog or detail mockup: new section hierarchy, search, finite cards and text-only missing states are intentional T08 adaptations. It would be inaccurate to claim a pixel-for-pixel catalog/body clone.

`comparison-desktop.jpg` puts the actual reference and catalog in the same input. The latest catalog JPEG is 1356 × 902; the reference is cropped to its top 902 px, and neither input is scaled in the saved pair. `comparison-header.jpg` compares the first 62 px of each at full 1356 px width; it makes fonts, mark, subtitle, five labels, search and entry button readable. Source Home and implementation Music active states differ intentionally; the existing four-language switch is retained. The preview-only fixture notice is also intentional.

Requested desktop CSS viewport was 1371 × 996, DPR 1, client width 1356. IAB capture pixels differ from requested CSS dimensions; exact screenshot dimensions are in the manifest. DOM geometry is used for overflow and obstruction rather than inferring CSS size from JPEG pixels. These are simulated viewports, not real phones or VoiceOver evidence.

## Fidelity surfaces

Typography reuses the approved Noto/PingFang/system and Kaiti fallback stacks, navy weights and hierarchy. The header still has stock-font metric differences from the raster source (P3). Catalog names clamp to two lines with complete accessible link text; detail names wrap without truncation, including the long sample on a phone.

Layout retains the source's constrained frame, spacing rhythm, pale cards, restrained borders, pill actions and five-entry navigation. The new catalog uses a spotlight plus selected column and finite song grid; detail uses a larger cover/text card. At 320/390/768/1024/1371 CSS px there is no horizontal overflow. Phone detail actions and fixed player remain above navigation, and the player reserves page space.

Colors use the approved paper/navy/muted/pink/purple tokens. No new decorative gradients, drawing primitives or alternate design direction were introduced. Native focus outlines, readable quiet empty/error copy and consistent button states remain.

Images are the existing T04 raster illustration samples; the cat mark is a bitmap, UI symbols come from the existing Lucide/Phosphor libraries. No custom icon drawings replace source artwork. The inherited brushwork/crop differences and repeated fixture covers are P3/test-content differences, explicitly not actual song artwork or game screenshots.

Copy is four-language UI text plus bounded published metadata. Pending platform copy is truthful and has no fabricated clickable release. The single available About page remains Hant `/about/`. Full-audio preparation, local-only favorites and error recovery identify actual state. The fixture banner never appears in the production shell.

## Verified surfaces and states

| Surface | Evidence and result |
| --- | --- |
| Desktop + responsive | `catalog-*.jpg`, `detail-*.jpg`, `browser-observations.json`; five widths, no broken loaded image or horizontal overflow. Lazy images below the viewport are not counted as broken. |
| Four languages | `catalog-{zh-Hant,zh-Hans,en,ja}-mobile.jpg` and matching detail captures at 390 × 844 requested CSS; correct localized title/lang and selected Music navigation. |
| Catalog interaction | Search by keyboard returns one sample; sort changes to release and Back restores default with the same one result. Manual More adds 5 to the initial 20 without duplicates; empty search offers Clear. `empty-mobile.jpg`. |
| Service failure | The actual local empty-schema binding produces the failed catalog. Its retry fetches the real local API, replaces error with 20 items and clears busy. `error-mobile.jpg`; no browser warning/error at that check. |
| Detail missing states | `long-mobile.jpg` has the full long title and no audio, lyrics or video placeholder. Available lyrics request only on expansion and display plain text. Related display is limited to three. |
| Favorites | An actual toggle saves into existing local storage; reloading retains pressed state and local-only note. It is not native/cloud-library acceptance. |
| Guest preview + full policy | One-second synthetic preview actually reaches native ended state. Anonymous VIP full preparation is denied with the existing account link; no full source is assigned. Free full preparation remains source-less until a second explicit click; then the four-second synthetic file plays. `free-full-explicit-mobile.jpg`. |
| Dock + close | At requested 320/390 × 844 CSS, navigation top and player bottom both measure 780; doc/client widths are respectively 305/375. Close unloads src, hides dock, restores focus and resets ready text. `free-full-explicit-mobile.jpg` and final `player-mobile.jpg`. |
| Quiet entry | All final observed catalog/detail entries have one source-less, non-autoplay audio. In the recorded final viewport/locale segment, 176 additional anonymous local requests contain zero audio/playback requests. `no-autoplay.json`. No video or iframe is mounted. |

Some earlier 390 px interaction captures predate the 320 px minimum-width correction; their 390 px geometry and content are unchanged by it. The final five-width/locale captures and recorded DOM widths follow that repair. The last selected-only and interrupted-request code refinements do not change these pictured states; final build/automated checks cover that revision.

## Checklist and limits

The source and combined captures were opened and compared, all five fidelity surfaces checked, actual local pages loaded through the production Worker/compiled shell, and the core catalog/detail interactions verified through IAB. A 320 px overflow repair was captured and compared again. Build output and complete test logs are in the verification manifest.

This passes local T08 UI, query and permission integration only. Real materials remain “稍后确定”; A02 is not an operational promotion/rights acceptance. MP3s are checked-in synthetic fixtures, and video bytes remain metadata-only, so neither video playback nor real release is claimed. T09 owns complete playback/queue/persistence behavior, T11 owns video, T12 game/save, T18 new analytics/retention, T20 production HTTP/route order/indexing and legacy retirement. Production bindings/schema, real memberships/orders, device compatibility and new AASA paths remain unverified. Both new feature flags remain unset, and no production deployment or old public entrance closure is authorized.
