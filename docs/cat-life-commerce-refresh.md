# Membership initialization: preserve in-progress interaction

## Cause and scope

`commerce.js` called `CatGameApp.render()` when catalog/entitlement requests
started, succeeded or failed. The responses can arrive after the player has
opened another module and begun editing. Replacing the page without the existing
draft-preservation flag reset the nickname to its saved value, emptied the save
import textarea and dropped keyboard focus.

The commerce refresh path now uses `render(true)`, reusing the same transient
draft/selection preservation as background game updates. Membership ownership,
balances and offline status still update immediately. Explicit gameplay actions
and navigation keep their existing render behavior: drafts are not submitted,
saved, or carried into another page.

For background renders, buttons/navigation controls with a stable ID or data
identity regain focus only when exactly one matching control survives within the
same replaced region. Missing, disabled or ambiguous replacements are not chosen
by position. Focus is restored with `preventScroll`; external site controls and
dialogs are not replaced or refocused by this helper. Editable input focus and
selection continue to use the existing draft restoration.

Every commerce refresh now has a monotonically increasing request revision.
Only the latest-started revision can apply success/failure state, write the
entitlement cache or trigger a render. Superseded responses return without those
side effects, including when the newer refresh has become a guest or failed.
The catalog and entitlement responses must also agree on authentication and
account ID before they are combined; an inconsistent pair follows the existing
offline path instead of publishing mixed-account data.

Lottery digit selects now have stable, unique IDs so the existing draft path
also restores their value and focus. The care-rules details and summary have
stable IDs; background renders restore open/closed details state within the
same main region before restoring focus. This state is not stored in the save:
a full reload still starts with the care rules collapsed.

No layout, assets, backend, save schema or account synchronization policy changes.
This fix does not suppress an intentional cloud-save replacement or account
switch, and does not claim to preserve an in-progress IME composition.

## Deterministic browser regression

`scripts/browser-tests/cat-life-commerce-refresh.spec.mjs` holds the actual
catalog and entitlement requests until the player has typed or focused a control.
It then releases the responses and asserts that the original DOM node was
disconnected, proving the test crossed a real completion-triggered redraw.
Positive interaction tests do not stub the renderer, sleep for a presumed tick,
or pause game timers. The rejection cases wrap the next renderer output to
produce a disabled control, duplicate identities, or an identical control in a
different region; the actual commerce response still triggers the render.
All account/network responses are local test fixtures, never production writes.
Catalog and entitlement fixtures are now separate contracts and separate indexed
request queues. Catalog returns `products`, entitlements returns `entitlements`;
tests can release each endpoint of each refresh independently, without pairing
by arrival order or returning a combined response object.

At both 390px and 1280px the tests independently cover:

- Success and failure while editing a nickname or save-import draft, including
  backward selection, continued typing and no implicit rename.
- Success and failure after tabbing from the nickname to its rename button;
  Enter still performs the intended explicit action with the retained draft.
- A late response after switching pages, without restoring the abandoned draft
  or navigating back; the current navigation button remains keyboard-operable.
- An authenticated account receiving a real entitlement fixture while editing,
  then displaying ownership in the store; manual refresh preserves button focus
  through both loading and ready renders.
- Disabled, duplicate-identity and other-region successors must not receive
  focus. Each case verifies the intended DOM condition and real node replacement
  before asserting that focus was not transferred.
- Lottery digit value/focus and care-rule open/closed state/summary focus survive
  both an explicit `render(true)` and an actual delayed commerce response.

Ordering tests additionally interleave two refreshes and complete the newer
pair first. Older successes and failures cannot roll account 2 / balance 222
back to account 1 / balance 111, overwrite a newer guest/offline result, mutate
commerce caches or redraw the current input. Separate tests reject mixed-account
and mixed-authentication pairs.

## Verification history

Before the fix, the two mobile success cases failed with `Sunny` instead of
`Momo draft` and an empty import textarea instead of `draft-save-payload`.
After the fix, the 16 cases repeated three times in UTC passed 48/48.
Full `npm test`, 143-page project build and modified-JS syntax checks passed.
The complete browser suite in UTC passed 77/77, including existing membership
purchase/revocation, cloud-save, onboarding, version-history and redraw tests.
These were initial local results, not a claim that the initial PR CI passed.
[PR #104 initial CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/34040069672)
failed 1/77 in the existing room-drag test: the saved furniture layout remained
unchanged. All other 76 browser cases passed. No production deployment has run.

The review update makes the room test use locator actionability to hover the
live furniture, then explicitly requires the intended `roomDrag` identity,
connected element and pointer capture after `mouse.down()`. Only afterward does
it sample the live bench coordinates and move the pointer. It also requires the
drag to finish on release. The original layout-change, bench/collision, resize
and reload assertions remain; there are no forced clicks, synthetic pointer
events, retries or direct writes to drag state.

Review-update local verification:

- UTC room drag plus all six focus rejection cases, repeated three times: 21/21.
- UTC repaired room-drag test repeated ten times: 10/10.
- UTC complete browser suite: 83/83.
- Full `npm test`, 143-page build, modified-test syntax and diff checks: passed.

The review-update CI result is tracked separately on PR #104; the initial failed
CI run remains part of this verification history.

### Second review: runtime gaps

Commit `19da76c` passed CI but only changed tests/documentation. It did not yet
cover request ordering, ID-less lottery selects or care-rule disclosure state.
On that baseline, new deterministic checks reproduced the 2/222 → 1/111 account
rollback, an unfocused lottery digit after `render(true)`, and a care disclosure
that closed on redraw. The lottery reproduction initially used an ambiguous tab
selector; after narrowing to the actual tab it failed on the intended focus
assertion. These findings supersede any implication that CI alone completed
the initialization fix.

The second review changes `commerce.js`, `main.js` and the two affected renderers
as described above, alongside the separated response fixtures. The onboarding
markup unit test is updated to require the new stable disclosure/summary IDs.

Second-review local verification:

- UTC 32 focused cases repeated three times: 96/96.
- UTC complete browser suite: 93/93.
- Full `npm test`, 143-page build, modified-JS syntax and diff checks: passed.

These results validate the new runtime changes locally; CI is tracked against
the new PR head, not the previously green `19da76c`.

### Third review: arcade disclosure identity

Commit `1ada8dd` retained lottery input and care-rule state, but the arcade
rules/history disclosure still lacked IDs. On that baseline the new 390px slot
test confirmed that `render(true)` removed its `open` attribute.

`renderArcadePanel.js` now gives the shared rules/history details and summary
stable IDs (`arcade-rule-history` and `arcade-rule-history-summary`), using the
existing background disclosure/focus restoration without changing save data.
Eight new cases cover slot/lottery views at 390px/1280px, with successful/failed
commerce responses. Each crosses both an explicit background render and a real
delayed response, verifies node replacement, expanded state and summary focus,
then uses Enter to close/reopen and checks that a closed-state redraw also
retains focus.

Duplicate data-only button identities still deliberately decline focus
restoration; adding unique focus keys remains separate non-blocking follow-up.

Third-review local verification: UTC arcade cases repeated three times passed
24/24; the complete UTC browser suite passed 101/101. Full `npm test`, 143-page
build, modified-JS syntax and diff checks passed. CI is checked on this new
commit separately, not inferred from `1ada8dd`.

Run the focused check:

```sh
TZ=UTC npm run test:browser -- scripts/browser-tests/cat-life-commerce-refresh.spec.mjs --repeat-each=3
```
