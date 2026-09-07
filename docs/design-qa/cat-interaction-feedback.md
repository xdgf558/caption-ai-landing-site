# Cat interaction feedback — Design QA (1.26.0)

Archived verification record for the 1.26.0 release. Results below do not certify later releases.

## Target and comparison

Selected target: first displayed Product Design image (scene-first feeding).
Source: `test-results/cat-interactions-design/selected-design.png`, 853 × 1844, designed for 390 × 844.
Implementation: `test-results/cat-interactions-design/mobile-feeding.jpg` (375 × 895) and `desktop-playing.jpg`.
Combined, inspected evidence: `test-results/cat-interactions-design/comparison.png` (770 × 860).
The source is normalized to 375px width; the implementation crop (21,75), 318 × 725, is normalized to the same width. Both images were opened together after the fixes.

Codex in-app browser, isolated local guest origin on port 4184. CSS widths checked: 390, 1040, 1280; heights 844/1100 for mobile region inspection, 900 for larger layouts. The in-app capture scales the 390px viewport to 375 pixels and clips to the visible panel. This is a region comparison, not an unscaled device screenshot. Full-page capture showed stitching artifacts and was rejected as evidence.

Matching state: healthy orange tabby, hunger 50 and mood 60 before real feeding; result +25/+4, basic food −1. Test state was imported through the game's normal UI. Earlier capped and no-change states were checked separately. Existing outer navigation is outside this component target.

Evidence stays in ignored `test-results/`, not git or deployed `public/`. These are local review artifacts, not hosted PR attachments. Previous QA is archived in `docs/design-qa/cat-life-memories.md`.

## Findings, fixes and final comparison

- P2 fixed: success toast obscured the receipt. Profile care now announces success inline; failure and other-page messages remain.
- P2 fixed: the mobile heading stacked too tall. Two-column heading keeps the name and memory link together, retaining the real status.
- P2 fixed: tall vertical receipt differed from the target hierarchy. The final receipt uses a result/value split with wrapping for additional actual deltas.
- Final combined inspection: room, eating pose, speech, unobstructed receipt, three illustrated actions and more-care disclosure appear in the intended order. No actionable P0/P1/P2 visual finding remains.
- Expected integration differences: retain existing roster, facts, guidance and navigation; use existing bowl/toy/bed props; show useful inventory counts instead of decorative taglines; native disclosure marker replaces a decorative arrow.
- P3: in-app JPEG screenshots are softer than the source PNG. The actual eating sprite is 560 × 560 WebP, approximately 47 KB.

## Required fidelity surfaces

- Typography: existing rounded Chinese/system stack, 16–17px result heading, 14px receipt/speech, 15–17px action labels. Long translations wrap.
- Spacing/layout: square scene, reserved receipt, three equal action columns, stable disclosure. DOM checks found identical row tops at 390/1040/1280 and no horizontal overflow; intermediate widths stack the guidance sidebar.
- Colors/tokens: existing cream paper, brown ink, orange and sage. Positive deltas use dark green; spent vitality uses brown-orange.
- Imagery: generated eating-cat cutout over the existing room; no full mock embedded as UI. Existing play/nap and member/non-orange identities remain. Motion transforms the cat, not the room or hit targets.
- Copy/content: actual capped stat changes and consumed items, including pregnancy; memory prompt only for a real new entry. Three-language unit coverage; no new rules/rewards/save schema.

## Verification and boundaries

Full `npm test` (including the latest main's article tests), 8 new interaction tests, 144-page build, JS syntax and whitespace checks passed. The initial build had 143 pages; syncing main added its article admin page.
In-app checks: feed/play/rest/clean; double-click play consumed exactly one use; disclosure and clean-button focus survived reaction-end redraw; unsubmitted nickname and focus survived background redraw; reload clears transient receipt; no console errors returned.
Browser validation on 2026-09-07, with `TZ=UTC`: five new interaction cases passed; the complete suite passed 106/106 (57.3s), then passed 106/106 again (52.9s) after syncing latest main.
The latest main's separate article browser suite also passed 5/5 (2.5s). Its test entry and the new interaction entry are both retained in package.json.
The initial full run passed 105/106: the member skin test still targeted the removed care section and old `Zz` cue. Its selector and reaction assertion now follow the new UI while retaining the official skin identity check and adding the rest animation check. That case passed 5/5 repeated runs before the complete rerun. No failures were skipped or retried automatically.
Browser emulated reduced-motion coverage passed; no OS-level reduced-motion or screen-reader test was run. GitHub CI status is reported by the PR checks, not this local QA record.
The fixture has no member API; its cloud-unavailable label is expected. No production account/save, Worker, database or deployment changed.

Next: review the PR and its GitHub CI checks before merging. No merge or deployment has been performed.

final result: passed
