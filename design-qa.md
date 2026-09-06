# Shared memories / bond feedback — Design QA

## Comparison setup

- Source visual truth: the existing Cat Life cat journal at baseline commit `e7f70f5000e04c39a86183480c5355737def7f07`, captured as `test-results/memories-design/before-{width}.png` and `before-full-{width}.png`. The live cats page and local guest baseline were inspected before implementation.
- Implementation: `test-results/memories-design/after-{width}.png`, `after-full-{width}.png`, `home-{width}.png`, and `journal-{width}.png`.
- Combined evidence: `comparison-{width}.png` and `comparison-full-{width}.png` put baseline left and implementation right in one image.
- CSS viewports: 390 × 844, 1040 × 844, 1280 × 844; deviceScaleFactor 1, no browser chrome or device frame. Focused source/current captures each equal the CSS viewport in pixels, with no density resampling.
- Full-page dimensions (source → current): 390 × 4228 → 390 × 4602; 1040 × 3266 → 1040 × 3590; 1280 × 2009 → 1280 × 2098. Combined canvases use the taller page and white padding for the shorter side.
- State: simplified Chinese, isolated guest origin, one unlocked healthy cat, existing bond 62 followed by actual feeding and play (bond 74), no active job. Identical saved state is reloaded for each side; the comparison uses the old renderer against the current runtime to isolate UI changes.
- Reproduce after starting the local fixture on port 4180: `node scripts/capture-cat-life-memories-qa.mjs e7f70f5000e04c39a86183480c5355737def7f07`. Screenshots are generated into ignored test output, never committed or served as game assets. The earlier homepage QA is archived in `docs/design-qa/cat-life-home-daily-route.md`.

## Findings and fixes

PR #101 review of `87da855` found two P2 interaction defects. The initial local passing run below was not sufficient evidence of stability: CI run `34028892813` and the review reported 45/47. The review supersedes that earlier acceptance; the follow-up results below apply to the corrected implementation.

### Review follow-up

- P2 — Unstable hover hit areas after rescue: global hover/active transforms moved the next care button under a stationary pointer. Care-journey, care-support and memory-toggle buttons now retain shadow feedback without geometric transforms. No forced clicks, extra retries or suppressed animations were added to the tests.
- P2 — Focus leaving the viewport: with ten entries, the old bottom toggle moved down 844px after expansion. The toggle now precedes the list, so the existing focus restoration returns to the same screen position. Enter expansion and Space collapse keep focus below the fixed header and above the mobile navigation.
- P3 — Documentation: the integration introduction now explicitly targets source version 1.25.0 rather than claiming 1.20.1 is current; source version is distinguished from deployed version.
- Reproduction: all four newly added regression cases failed against the old implementation. The originally failing welcome-back/meal paths also reproduced an intermittent failure (2 failures in 6 focused runs).
- Corrected behavior: the four new cases plus the two previously failing paths passed three repetitions (18/18). The complete 51-case browser suite passed two repetitions (102/102).
- Visual evidence: `test-results/cat-life-review-interactio-4bf40--without-moving-the-control/expanded-focus-390.png` and `test-results/cat-life-review-interactio-1e864--without-moving-the-control/expanded-focus-1280.png` were inspected. Ten entries are expanded; the focused control remains around y=400 with its focus ring visible. Viewports and screenshot pixels are 390×844 and 1280×844 at density 1. Existing fonts, colors, assets and journal column layout are unchanged; control placement is the intentional correction.

- Initial P2: jumping from Home put the journal heading behind the fixed site bar. The heading now has a 96px scroll margin; browser tests assert it is focused and below the bar. Final `journal-390.png`, `journal-1040.png`, and `journal-1280.png` verify the corrected landing position.
- Initial P2, pre-existing but exposed here: care supplies nested progressively because a chip's outer span was not closed. The final combined desktop evidence shows six sibling chips, and browser assertions guard against nesting.
- Initial P2, pre-existing but exposed by the identity test: an English rename still displayed the default translated name. Rename now updates all three name fields; reload and the memory link display the player-chosen name.
- Initial P2: undated bond 100 sorted after 25/50/75 by text. Numeric milestone ordering now puts the most advanced established bond first; localization fixtures and unit assertions cover this.
- Refinement: memory body copy uses weight 500 to separate it from event headings; memory feedback is appended to the existing action toast, not queued as another notification.

## Full-view and focused comparison

The combined full-page captures preserve the existing shell, roster, live cat scene, profile facts and care tray. The intended additions are the relationship stage below the existing bond bar, the memory list after the profile's five-condition snapshot, and a compact latest-memory card on Home. At desktop size the memory column fills previously unused space beside care. On narrower screens it adds reading length; it does not remove controls or change the existing single-column breakpoint.

Focused combined captures at 390, 1040 and 1280 verify the shared paper surface, typography, dividers, bond bar, state snapshot and memory spacing. Separate final journal captures verify expanded reading and Home-to-journal focus. Three-locale browser screenshots exercise undated and complete-bond states.

## Required fidelity surfaces

- Typography: retains the storybook font stack and established headings. Event headings are 16px, body 13px/1.7 and dates 12px/1.5. Dates, long localized copy and player names wrap without raw keys or overflow.
- Spacing/layout: preserves existing columns and profile controls. Journal uses a restrained divider, an explicit expand button above the list and three initial entries. Expanded state survives action/focus rerenders. Home stacks its button below the summary at 520px; controls remain at least 44px high.
- Colors/tokens: uses existing `--story-ink`, paper, orange and muted tokens. No new gradients, color palette, decorative glyphs or animation.
- Image quality: all existing room, cat, action and supply assets are retained; QA explicitly waits for their decoding. No new images or placeholder artwork. Fixed supply nesting restores intended image/card layout.
- Copy/content: records real successful interactions once per cat. Old milestones are labelled “date not recorded”; no historical feeding dates are invented. Full bond has a family-state message instead of another target. Missing and future-format journals have honest empty/upgrade states in Chinese, English and Japanese.

## Verification

- 8 focused memory unit tests plus existing care/onboarding suites; full `npm test` passed.
- Historical initial run only: 47/47 browser tests passed once locally, including six new memory cases. Review and CI subsequently reported 45/47; a repeated focused reproduction failed twice in six runs. Do not use the initial count as the acceptance result for `87da855`.
- Review-fix acceptance: `npx playwright test --repeat-each=2` passed 102/102 (51 distinct cases), without retries. Four new cases cover both 390px and 1280px; edge-hover geometry, ordinary clicks and keyboard focus bounds are asserted. Full `npm test`, 143-page build, JS syntax and whitespace checks also passed again. Remote CI status is tracked separately on PR #101, not inferred from a local run.
- Cloud contract round-trips `cat.memoryJournal` through the existing schema-3 Worker.
- Local 143-page build passed. No Worker code, database schema or deployment change.
- UI browser checks include named sections, semantic time/list markup, focus transfer, 44px buttons and no horizontal overflow at 390/1040/1280.
- New-flow browser test records no page exceptions. The fixture has no account API; its guest cloud-unavailable message is expected, not a cloud availability test.
- No actual signed-in production account was changed during implementation.

## Remaining boundaries

No device-native iOS Safari or screen-reader session was run. The responsive checks use Chromium and the Codex in-app browser. Cloud verification uses the repository's Worker contract harness, not a live-account upload. Visual evidence is reproducible but deliberately excluded from git and deployment.

final result: passed
