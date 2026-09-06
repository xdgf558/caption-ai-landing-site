# Cat Life: interaction sampling across background rerenders

## One-second tick regression

The rescue-successor hover tests in `scripts/browser-tests/cat-life-review-interactions.spec.mjs` originally retained a single DOM node inside an asynchronous `locator.evaluate` callback. A normal background tick can replace the node while that callback is still sampling. Its detached bounding rectangle becomes zero, falsely reporting a large movement even though the replacement button remains in the same position.

Initial local reproduction on the PR #102 merged baseline: extending the old loop to 90 animation frames and checking `node.isConnected` failed 4/4 runs (390px and 1280px, twice each). This demonstrated a possible stale-node failure, not a guarantee that every one-second tick replaces the DOM. The timer rerenders only when game state changes; timezone-dependent shop initialization had made the initial reproduction appear deterministic.

## Test-only fix

- Resolve the unique live button by its selector on each animation frame.
- Sample the original button first, then explicitly call `CatGameApp.render()` on a subsequent animation frame. Leave normal timers running, but do not depend on them to cause a render.
- Sample positive cases for at least 1,200 milliseconds, not a fixed frame count; count live-node replacements and require at least one, proving the intended redraw happened during sampling.
- Fail for missing, duplicate or hidden controls; do not skip invalid frames.
- Keep the original 0.1px movement threshold, inspect every sample's transform and use ordinary non-forced clicks afterward.
- At both viewport widths, independently test 4px displacement, hiding, deletion and duplication. Each negative control starts sampling, explicitly redraws, observes a replacement, then mutates that live successor on a later frame. Each asserts `replacements > 0` and mutation execution before checking the expected failure. Deletion and duplication are separate cases; invalid samples retain their diagnostic counters and must fail the same positive assertion.

No application timers are paused or application source is changed. Tests explicitly invoke the existing render entry point only in isolated local test contexts. This does not fix or make claims about other initialization/focus issues. Since the change affects tests only, there is no new game version, save migration or deployment.

## Verification history

The initial commit recorded local 20/20 stress and 55/55 full-suite passes. Those results did **not** demonstrate stability: PR #103 CI failed 2/55; reviewer repetition was 9/10 locally and 0/4 with `TZ=UTC`. The initial negative controls also lacked a guaranteed redraw. These rejected results remain here as history, not as validation of the revised implementation.

Revised implementation (PR #103 review fix, local runs):

- `TZ=UTC`, positive and all four negative-control cases repeated twice at both widths: 20/20 passed.
- `TZ=UTC`, rescue-successor cases repeated ten times at both widths: 20/20 passed, covering both emergency meal and supplies in each case.
- `TZ=Asia/Singapore`, complete browser suite including all eight negative-control cases: 61/61 passed.
- Full `npm test`, project build, JS syntax and diff checks: passed.

These local results replace the initial stability claim. The review-fix commit's GitHub CI result is reported separately on the PR; the earlier failed CI run is not treated as passing.

Run the focused stress check with `TZ=UTC npm run test:browser -- scripts/browser-tests/cat-life-review-interactions.spec.mjs --grep 'rescue successors' --repeat-each=10`. Include `--grep 'rescue successors|live sampler rejects' --repeat-each=2` to exercise the negative controls. Run the complete suite with `TZ=Asia/Singapore npm run test:browser` (or `TZ=UTC` to check the CI timezone).
