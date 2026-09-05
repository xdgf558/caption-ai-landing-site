# Cat Life 1.24.0 — onboarding and return journey

This release adds a saved, action-driven care journey without changing save schema 3.

## Player experience

- The home diary presents one primary recommendation at a time. Safety actions are ordered first: welcome home, basic rescue, treatment, player relief meal, then ordinary care and work.
- A fresh player meets the existing starter cat, receives a small care package, completes a useful feed and play action, and finishes a real paid shift. Starting a shift alone does not complete the work step.
- The first three **meaningful care dates** are tracked by UTC date. Only an action that actually improves a cat records a date, at most once per date. Dates do not need to be consecutive, and time away never consumes an opportunity.
- Each care-date stage has one package: basic food ×2, litter ×1 and toy uses ×2. Unclaimed unlocked packages remain available after a stage advances or learning protection ends, oldest first. Claims are persisted and cannot be repeated through navigation, reload, import, or disabled auto-save.
- While the learning period is active, cats cannot newly contract disease. An existing illness remains visible and can use a single free clinic treatment per save. The treatment flag is consumed only after treatment succeeds.
- Finishing the learning period does not remove the 1.23.0 safety net: temporary care, welcome-home rescue, legacy recovery, basic rescue, and the zero-cash emergency meal remain available.
- Global recommendations check every companion's rescue eligibility, including missing litter and deceased companions alongside living cats. A cat's profile keeps recommendations scoped to that cat. In-place meals belong to care, while shopping is highlighted only when a purchase is needed.
- Returning focus does not replace an unchanged page. When background progress or a new day requires a redraw, editable form values and caret selection are preserved in memory without submitting them or saving drafts to the game.

## Compatibility and truthfulness

`player.careLearning` is additive data inside the existing schema-3 player object. The browser normalizer and Worker already retain unknown player fields; the cloud-save test now verifies the complete learning record survives a Worker round trip. A future learning-record version is retained but treated as ineligible by this client, preventing accidental duplicate rewards.

Existing level-1 saves infer the four introductory steps from real historical counters, but never invent care dates or claimed packages. Established saves at level 2+, with three or more completed jobs, or with the old tutorial flag are not enrolled. Empty, all-locked, deceased and sheltered cat lists produce honest recovery or navigation actions and never fabricate an adoption or reward.

## Verification

- `scripts/test-cat-life-onboarding.mjs`: action semantics, persistence, UTC dates, late package claims, time away, rollback, zero-resource recovery, free treatment, old/future saves, multi-cat rescue targeting, three-language landmarks, and no-op protection.
- `scripts/browser-tests/cat-life-onboarding.spec.mjs`: the full first session, reload deduplication, seven-day return, clinic aid, UTC graduation and late claims, form drafts across focus/visibility/background updates, rescue and meal routes, responsive layouts, and all supported languages.
- Existing gentle-care, commerce, storybook, cloud-save and full-site suites remain part of the release gate.
