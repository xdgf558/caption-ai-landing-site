# Cat interaction polish — Design QA (1.26.1)

## Scope and visual target

Keep the approved 1.26.0 scene-first Cat Journal. This is an interaction polish, not a new layout or art direction. Product Design guided the separation between secondary guidance (locate an action) and actual care beside the cat. Room, cat sprites, three primary actions, roster, status and supplies remain unchanged.

The previous release's QA is preserved in `docs/design-qa/cat-interaction-feedback.md`. The before/after desktop comparison was captured in the Codex in-app browser at 1280 × 900, using the same local orange cat, room, food stock and ready receipt. Both were inspected together. Evidence is in ignored `test-results/cat-interaction-polish/`: `before-desktop.jpg`, `after-desktop.jpg`, `desktop-comparison.png`, `mobile-focus.jpg` and `mobile-novice.jpg`. These are local review artifacts, not PR attachments, and are not in public assets or git.

The in-app browser captures a 1265 × 889 visible desktop region and a 375px-wide region for a 390px CSS viewport. This is not an unscaled device screenshot. Mobile evidence verifies interaction and responsive fit, not a matched before/after mobile design comparison.

## Comparison and intentional differences

- Typography, cream/brown/sage/orange tokens, borders, scene, primary controls and column positions match the existing design. No new image resources.
- The right-hand Execute control becomes a secondary Find-button control with an explicit no-consumption hint. This adds about 45px to the desktop recommendation card; the existing bowl image fills its taller cover slot. No overlap or clipped text was observed.
- Additional care, the disclosure summary and the new navigation button share the orange keyboard focus treatment with the primary tray. Pointer focus is not forced to show a keyboard ring.
- At CSS widths 390, 1040 and 1280, document scroll width did not exceed client width. Mobile action targets were within the unobscured viewport, above the fixed bottom navigation.

## Manual interaction checks — passed

Local guest origins only; no production save/account was used.

- Veteran guidance focuses Feed, Play or Rest without consuming inventory. Actual care produces one inline receipt and hides the success toast. Feeding changed stock 9 → 8 and displayed actual +25 hunger / +4 mood.
- Finding additional care opens `cat-extra-care` before focusing its control. At 390px the target was at y=385–459, above the bottom navigation at y=776. The unsubmitted nickname remained intact.
- Keyboard focus on additional care uses `rgb(232, 131, 74)`. Reaction-end redraw retained an enabled care button's focus and the nickname draft.
- The novice journey retains package claiming, then points to the real Feed button: seven care controls total, none duplicated in the right guidance panel. Locating retained stock 5; Enter fed once, stock became 4, and the receipt read `Done: Feed` without a toast. Finding Clean Up on mobile opened additional care and focused the visible button.
- Consuming the final premium-food item disables its button. Existing safe focus restoration intentionally does not refocus a newly disabled control; the disclosure stays open. This is not a guarantee of focus retention for disabled targets.

## Automated checks and limits

Full `npm test`, 11 interaction unit tests, the release-history tests, integration/manifest checks and the 144-page build passed locally. Current release notes are checked directly in zh-CN/en/ja; 1.26.0 is archived, not mixed into current notes.

With user permission on 2026-09-07, Playwright ran under `TZ=UTC`. The seven new scenarios passed 7/7 (2.8s), then five repeated runs passed 35/35 (9.8s). They cover novice/veteran guidance at 390/1280, additional-care focus across explicit redraw, and home-success/cat-error notifications. The complete game browser suite passed 113/113 (54.9s), including the updated storybook and release tests. The independent article browser suite passed 5/5 (3.0s), and its fresh 144-page build passed. No failed assertions, skips or automatic retries were needed. The first sandboxed launch could not bind the local server port; after granting the required execution permission, all test runs completed successfully. No GitHub CI result is claimed for this local branch. No native screen reader or physical iPhone test was run.

Memory normalization already returned a copy before this change. The additional `slice()` makes read-only sorting explicit; frozen-array and shared-normalizer tests protect that contract. This is not evidence of a previously reproduced save-order corruption.

Save schema stays 3. No Worker, database, economy, production deployment or PR has changed.

Visual QA final result: passed.
Local verification final result: passed. Ready for PR review; GitHub CI and review are still required before merge or deployment.
