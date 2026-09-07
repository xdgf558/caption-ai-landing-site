# Scene-first cat care — 1.26.0

Implements the selected first Product Design image inside the existing cat profile. No new route, Worker, database or save schema. State changes still run through catSystem.performAction; the new catInteractionSystem adds a transient receipt around it.

- Delta values are differences between before/after stats, including capped gains and negative vitality. Inventory use is measured, not guessed from labels.
- Duplicate activation of the same action within 650ms is ignored. Different follow-up actions remain available; clock rollback does not freeze input.
- Receipt and reaction are bound to the exact save and cat object. Import/account replacement cannot reuse feedback from a different save with the same cat ID.
- The 2200ms reaction uses its original start time as a negative CSS animation delay after redraw. Final receipt remains readable; reload discards it.
- Success from the profile uses the inline live region instead of an overlapping toast; failures and other-page messages remain unchanged. Other care is under a native details element with stable IDs. Successful care preserves drafts, disclosure state and eligible focus.
- New memory indicator comes from the existing journal's changed keys; no extra rewards or history fabrication.
- Existing room, bowl, toy and bed assets are reused. Non-orange and member cats retain their own sprites, with the same action-specific motion.

## Generated asset

Built-in Image Gen, not CLI. Output: `public/games/cat-life/src/assets/poses/eating-bowl.webp`, 560 × 560, about 47 KB.

Prompt: create a single isolated full-body orange tabby bending to eat kibble from a sage ceramic bowl; match the selected design's chibi painted identity, white muzzle/chest/paws, content closed eyes, raised striped tail and red collar with bell; three-quarter front view, fully visible body and bowl, square composition, no text/UI/room/sticker outline.

The first transparent request returned an opaque checkerboard. A second built-in edit preserved the subject and replaced only the backdrop with solid magenta. Deterministic chroma-key extraction and WebP resizing then produced real alpha; both generated sources stay outside the repository. Do not use the opaque checkerboard source in the game.

## Verification

See root `design-qa.md` for results and verification boundaries. Full unit tests, the 143-page build and the complete UTC browser suite (106/106) passed. Reproduce with `npm test`, `npm run build` and `TZ=UTC npm run test:browser`. No deployment is implied by the version bump.
