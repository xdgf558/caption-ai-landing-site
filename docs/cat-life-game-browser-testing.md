# Cat Life: interaction sampling across background rerenders

## One-second tick regression

The rescue-successor hover tests in `scripts/browser-tests/cat-life-review-interactions.spec.mjs` originally retained a single DOM node inside an asynchronous `locator.evaluate` callback. A normal background tick can replace the node while that callback is still sampling. Its detached bounding rectangle becomes zero, falsely reporting a large movement even though the replacement button remains in the same position.

Reproduction on the PR #102 merged baseline: extending the old loop to 90 animation frames and checking `node.isConnected` failed 4/4 runs (390px and 1280px, twice each). This confirms the stale-node failure rather than assuming that visible movement occurred.

## Test-only fix

- Resolve the unique live button by its selector on each animation frame.
- Sample for at least 1,200 milliseconds, not a fixed number of frames, so the window spans the one-second tick across display refresh rates.
- Count node replacements and require at least one during each rescue-successor sample, proving the regression scenario was exercised.
- Fail for missing, duplicate or hidden controls; do not skip invalid frames.
- Keep the original 0.1px movement threshold, inspect every sample's transform and use ordinary non-forced clicks afterward.
- Add mutation controls at both viewport widths: deliberately apply a 4px hover translation and verify the movement assertion rejects it; hide the button and verify sampling fails instead of silently succeeding.

No application timers are paused, runtime render behavior is altered, or application source is changed. This does not fix or make claims about other initialization/focus issues. Since the change affects tests only, there is no new game version, save migration or deployment.

## Verification

- Rescue successors at 390px and 1280px, ten repetitions each: 20/20 passed. Both emergency meal and supplies are exercised in every case.
- Complete browser suite, including both mutation controls: 55/55 passed.
- Full `npm test`: passed.
- Project build: passed.
- JS syntax and whitespace checks: passed.

Run the focused stress check with `npm run test:browser -- scripts/browser-tests/cat-life-review-interactions.spec.mjs --grep 'rescue successors' --repeat-each=10`, and the complete suite with `npm run test:browser`.
