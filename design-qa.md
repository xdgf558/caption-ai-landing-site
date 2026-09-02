# 打工模块重构 Design QA

## Comparison setup

- Source visual truth: PR #87 design context — the selected third Product Design ideation concept, “今日排班计划”.
- Implementation screenshots: PR #87 browser QA captures — `cat-life-work-ready-top-viewport.png`, `cat-life-work-ready-roster-viewport.png`, and `cat-life-work-active.png`. These captures are intentionally kept out of the deployable repository to avoid adding private-machine paths and unnecessary clone/deployment weight.
- Viewport: in-app browser CSS viewport `1280 × 720`; browser screenshot surface `1265 × 712` pixels; `devicePixelRatio` reported by the page as `2`.
- Source pixels: `1487 × 1058`; implementation pixels: `1265 × 712` per capture. No pixel-level diff was used because the source is a generated full-page mock and the implementation includes the live site's fixed shell; comparison was normalized to the shared content regions and layout intent.
- Ready state: Day 1, 200 gold, stamina 100, mood 80, hunger 20, Lv.1 with `0 / 100` EXP, flyer job selected, convenience-store job shown as the next unlock.
- Active state: flyer shift started through the real CTA; the active scene, status label, live remaining time, progress bar, start/finish metadata, and navigation running indicator were verified.

## Full-view comparison evidence

The source and ready implementation were opened together and compared at the page-composition level. The implementation preserves the existing Station Cat shell and carries the selected direction into the main content: a two-column planner, large selected-job scene, growth rail, unlock rail, and a dense job roster below. Card proportions, warm paper palette, ink borders, orange primary action, blue growth card, and green unlock card all remain coherent with the source direction.

## Focused-region comparison evidence

- Planner top: the PR #87 browser QA capture `cat-life-work-ready-top-viewport.png` verifies the date/shift board, selected job scene, metric strip, CTA, growth card, and next-unlock card at readable scale.
- Roster: the PR #87 browser QA capture `cat-life-work-ready-roster-viewport.png` verifies the five job rows, aligned metric columns, selected state, lock labels, and filter controls.
- Dynamic state: the PR #87 browser QA capture `cat-life-work-active.png` verifies the same selected-job region after starting work, including the real image asset, active treatment, status pill, progress treatment, and live copy.
- No focused-region issue remains actionable after the roster grid was aligned to eight columns and the empty decorative tape element was removed.

## Required fidelity surfaces

- Fonts and typography: the implementation reuses the game's existing type stack and broadsheet hierarchy. Heading, eyebrow, metric, status, and supporting copy sizes remain distinct and readable; no clipping or awkward wrapping was observed at the captured desktop viewport.
- Spacing and layout rhythm: the planner top aligns the selected board with the growth/unlock rail, while the roster uses explicit index/icon/name/metric/state tracks. The current viewport has no horizontal overflow (`body.scrollWidth` remained below the viewport width); the page scrolls vertically to preserve the existing shell.
- Colors and visual tokens: existing `--story-*` tokens and the established paper/ink treatment are used. Orange is reserved for the active navigation and primary CTA, blue communicates growth, green communicates unlock/readiness, and warning/blocked copy remains legible.
- Image quality and asset fidelity: the flyer scene uses the generated storybook raster asset at `960 × 720` and the roster/locked states use the existing job SVGs. Other job scenes use the existing orange-tabby walk asset; image elements include explicit dimensions and decorative `alt=""` attributes. No CSS art, emoji, or inline SVG substitute was added.
- Copy and content: new copy is available in zh-CN and English, with Japanese inheriting the English layer. The level/EXP and next-unlock copy is specific to the actual job data and the existing work-system rules.

## Findings

No actionable P0, P1, or P2 findings remain.

## Open Questions

- The source mock shows a hunger-blocked state and illustrative job values, while the implementation comparison uses a startable state and the live game's actual job values. This is intentional so the CTA and active-work journey can be tested; the blocked state is still rendered by the existing condition checks and the new action hint.
- The in-app browser surface used for QA does not expose viewport resizing, so mobile was validated from the responsive CSS breakpoints and desktop DOM measurements rather than a second captured mobile viewport. A resize-capable browser pass can be added before a production release if needed.

## Implementation Checklist

- [x] Selected-job planner with real start-work interaction.
- [x] Player level, current EXP, progress bar, and distance to next level.
- [x] Next-work unlock card with required level and remaining EXP.
- [x] All-job roster with all/unlocked/locked filters and selectable rows.
- [x] Ready and active image/status states with live progress updates.
- [x] Accessibility labels, progress semantics, explicit image dimensions, and reduced-motion support.
- [x] `node --check`, `npm test`, `npm run build`, DOM/resource checks, and browser interaction checks passed.

## Comparison history

- Pass 1: found a roster header/row grid-track mismatch during implementation review; fixed the header with a dedicated icon column and aligned CSS tracks. Removed an unused empty decorative element. Re-captured the planner and roster screenshots; no P0/P1/P2 visual or interaction findings remained.

## Follow-up Polish

- [P3] If the art direction expands beyond the flyer job, add job-specific active scene assets so each unlocked job can have its own illustrated environment rather than sharing the walking-cat fallback.

final result: passed
