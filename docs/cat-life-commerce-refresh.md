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

No layout, assets, backend, save schema or account synchronization policy changes.
This fix does not suppress an intentional cloud-save replacement or account
switch, and does not claim to preserve an in-progress IME composition.

## Deterministic browser regression

`scripts/browser-tests/cat-life-commerce-refresh.spec.mjs` holds the actual
catalog and entitlement requests until the player has typed or focused a control.
It then releases the responses and asserts that the original DOM node was
disconnected, proving the test crossed a real completion-triggered redraw.
It does not stub the renderer, sleep for a presumed tick, or pause game timers.
All account/network responses are local test fixtures, never production writes.

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

Before the fix, the two mobile success cases failed with `Sunny` instead of
`Momo draft` and an empty import textarea instead of `draft-save-payload`.
After the fix, the 16 cases repeated three times in UTC passed 48/48.
Full `npm test`, 143-page project build and modified-JS syntax checks passed.
The complete browser suite in UTC passed 77/77, including existing membership
purchase/revocation, cloud-save, onboarding, version-history and redraw tests.
These are local results; no PR CI or production deployment has run for this fix.

Run the focused check:

```sh
TZ=UTC npm run test:browser -- scripts/browser-tests/cat-life-commerce-refresh.spec.mjs --repeat-each=3
```
