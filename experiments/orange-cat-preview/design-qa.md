# Orange cat preview — paws and feeding correction

final result: passed

Record scope: the full before/after comparison below documents the paw and feeding-position correction. Subsequent visible-bite and neck-attachment checks are preserved in the final review checkpoint at the end; the earlier comparison is not overwritten.

## Target and scope

Scoped Product Design correction to the existing independent preview, not a new page design. Preserve the painted orange tabby, thicker limbs, stage, typography, palette and controls. Restore the source artwork's round paw shape and keep the feeding muzzle above the food/bowl rather than behind the bowl body.

Source visual truth: `public/assets/front-leg.webp`, `public/assets/back-leg.webp`, `public/assets/head.webp`, `public/assets/bowl.png`, and the pre-change scene capture `test-results/paw-feeding/before-eat-viewport.png` for the unchanged page composition. The old incorrect head/paw pose is evidence of the defect, not a pose to replicate.

Implementation: local preview on port 4190. Evidence is kept under ignored `test-results/paw-feeding/`, not deployed or committed as PNG payloads.

## Comparison evidence

- Full-view pair: `eat-comparison.png`, old left / corrected right, both at eat 5.50 seconds. Input captures `before-eat-viewport.png` and `after-eat-viewport.png` are both 490×603 pixels; no relative scale adjustment was applied. The browser reports CSS viewport 505×621 and DPR 2; the native screenshot surface returns normalized 490×603 captures rather than raw DPR-sized pixels. Compare equal native captures, not raw CSS pixels against image pixels.
- Focused pair: `eat-focus-comparison.png`, matching 235×150 scene crops at x=90, y=350, each enlarged 3× for inspection. Shows the old ceramic bowl covering the muzzle / pointed rear foot, and the corrected muzzle above the opening / round toes.
- Paw fidelity: `paw-art-comparison.png`, original forepaw detail left, rendered idle forepaw right. This is a shape/anatomy comparison of differently sized asset and scene crops, not a whole-asset 1:1 pixel comparison. White round toes and fur transition are retained without sloping the sole.
- Additional observed implementation states: `after-idle-viewport.png` at idle 0.00, `after-walk-viewport.png` at walk 3.00, `after-lowering-viewport.png` at eat 3.25, `after-lifting-viewport.png` at eat 8.80. These cover contact, lifted paws, approach to the bowl and withdrawal.
- The initial full-page capture had a native capture stitching artifact; it was excluded. Viewport captures above were used instead.

## Comparison history and resolved findings

1. **P1 — Pointed, flattened paws.** The original lower mesh rotated around the ankle-to-floor vector and re-centred every texture row. This sheared the toe cap and put its edge below the ground. Fix: preserve the final 18% of the painted limb with uniform scaling, one fixed lateral anchor and a flat contact plane; blend only the wrist into the IK-driven upper limb. Rechecked against the real forepaw artwork and idle/walking/eating captures. No actionable mismatch remains for the requested round-paw correction.
2. **P1 — Head entering/being masked by the bowl.** The original head was translated down by a fixed amount with no mouth target, and the entire bowl was painted over it. Fix: share bowl dimensions and measured mouth coordinates between rendering and motion, approach a point 12 rig units above the food surface, reduce the head tilt and place the bowl behind the cat. Rechecked at lowering, eating and lifting, plus the matched before/after full and focused pairs. The muzzle stays above the bowl body; the bowl remains stationary.

## Required fidelity surfaces

- **Fonts/typography:** unchanged family/fallback, weights, heading wrap, control labels and hierarchy in the full-view pair. No font additions or replacements.
- **Spacing/layout rhythm:** unchanged stage bounds, header spacing, border, radius, controls and content order. No horizontal overflow observed in the current viewport. Cat joint and head placement changes are intentional corrections.
- **Colors/tokens:** unchanged cream surface, orange tabby/controls, green status and dark outlines. No new palette or gradients.
- **Image quality:** original raster art retained, with source-proportional toe caps; no generated placeholders or code-drawn replacement paws. The supplied alpha layers have minor pre-existing pale edge fringes at extreme magnification (P3). Natural-size captures do not show background checkerboard fields.
- **Copy/content:** unchanged; independent preview/no-save scope and action descriptions remain visible.

## Verification and boundaries

- 12/12 local tests: eight existing motion tests plus four geometry/texture checks. The new tests cover all three clips for toe proportions and floor contact, dense full-clip mouth clearance, and sampled opaque head pixels against the lower bowl body.
- Preview build and JavaScript syntax checks passed.
- Browser action switching and timeline scrubbing work; idle, walk, lowering, eating and lifting inspected. Browser warning/error log check returned no entries.
- No production game, saves, economy, version, API or deployment changes. No new ImageGen call: the paw problem was deformation of an already suitable painted asset.
- No full responsive matrix or physical-phone certification in this scoped pass. Extreme zoom alpha-edge cleanup, additional camera angles and more detailed jaw/tongue animation remain optional follow-up work, not claims of this preview.

## Implementation checklist

- [x] Restore round toe geometry while preserving the thicker limb setting.
- [x] Anchor feeding to the food surface and correct bowl/head draw order.
- [x] Capture matching before/after and focused visual comparisons.
- [x] Recheck lowering, feeding, lifting and walking states.
- [x] Add geometry regression tests and verify the local build.

## Final PR review checkpoint

- Accepted visual scope now also includes a raster mouth/tongue layer, three decorative kibble portions, open/take/close/chew/swallow timing, and a rear-neck joint docked inside the shoulder.
- Current verification is **21/21 unit/geometry/artwork tests**, plus a successful standalone build and syntax checks. The earlier 12-test count describes the paw-only checkpoint, not the final test suite.
- Later source art: `public/assets/mouth-open.webp` and `public/assets/kibble.webp`; original identities, crops and provenance are in `feeding-meta.json` and the README prompt supplement. Built-in ImageGen was used for these two later assets.
- Later browser captures: ignored `test-results/paw-feeding/bite-open-t421.png`, `bite-taking-t436.png`, and `bite-closed-t473.png`. Opening, food entry and closed-mouth frames were observed through the real timeline controls; no browser warnings/errors were returned.
- The neck refinement was then checked in desktop Chrome at idle, eat 5.50 s and eat 10.00 s. The user's final acceptance followed the corrected head/shoulder result. The neck landmark is continuously tested against opaque torso pixels and its exact computed joint; mouth/bowl clearance tests include the deformed head and open-mouth pixels.
- No new UI-layout direction, production integration, mobile-hardware certification or broader responsive matrix is claimed. Optional alpha-edge polish and other viewing angles remain future work.
