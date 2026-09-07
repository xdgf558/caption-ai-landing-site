# Cat interaction polish — 1.26.1

The Cat Journal has one set of seven real care controls. Right-hand daily recommendations and novice cat-care guidance use `data-focus-cat-action` to locate the matching stable `cat-care-*` control. The click opens its details if needed, scrolls it into view and focuses it; it never calls `performAction`, changes supplies, or serializes view state. Missing, disabled and non-profile targets are rejected. Home guidance retains direct care. Package, rescue, treatment and non-care navigation retain their existing handlers.

Successful cat-page care uses the scene's inline live receipt. Failed actions and other pages retain toasts. The existing core validator, cooldown, actual-delta calculation, member skin handling, draft preservation and safe focus restoration are unchanged. Primary care, additional care and guidance share orange keyboard focus styling. English completion copy reads `Done: Feed` rather than `Feed complete`.

`memorySystem.list()` explicitly sorts a slice. Previously, normalization already cloned the journal, so this reinforces the read-only contract rather than correcting demonstrated persisted-order corruption. Tests cover frozen saved arrays, a shared normalized array, future journal versions and repeated rendering.

Runtime, content manifest, product version and tests target 1.26.1. Current notes are localized in zh-CN/en/ja; former 1.26.0 notes are archived intact. The integration check reads `config.releaseNotes` directly so historical text cannot satisfy the current-release assertion. Save schema remains 3; no migration, Worker, database or new asset is required.

Verification is recorded in root `design-qa.md`: under `TZ=UTC`, the new scenarios passed 7/7 and 35/35 repeated runs, the complete game browser suite passed 113/113, and the independent article suite passed 5/5. Full unit tests and the 144-page build also passed. No PR, merge or deployment is part of this local implementation; GitHub CI and review remain the next release gates.
