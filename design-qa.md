# 图鉴模块重构 Design QA

## Comparison setup

- Selected visual direction: Product Design option 3, “Collection Path / 收集路线”. The selected generated reference is local-only and was not committed.
- Existing product reference: `cat-life-collection-reference.png`, captured from the supplied Station Cat collection URL before implementation.
- Prototype evidence: local in-app browser captures at 1440 × 1024, 1040 × 800, and 390 × 844; captures are local-only and are not shipped with the site.
- Desktop state: Simplified Chinese, guest mode, one unlocked cat (`小橘`), two locked collection slots, and the collection page opened from the game navigation.
- Mobile state: the same collection flow at 390px; the browser reported `scrollWidth=375`, with no horizontal overflow.

## Full-view comparison evidence

The selected source and the latest desktop prototype were reviewed together at the same 1440 × 1024 viewport. The implementation carries the source direction into the existing Station Cat shell as a field-journal surface: a large collection cover with progress, a mint next-step ribbon, a route from recorded to current to locked, and a compact current-record strip.

The redesign reuses the game's existing broadsheet tokens, paper surfaces, dark ink, orange action treatment, mint progress state, real cat art, and the existing question-pose asset for undiscovered slots. It keeps the game masthead, condition bar, navigation, and page routing intact instead of replacing the surrounding product context. No generated mockup or fabricated focal asset is shipped.

## Focused-region comparison evidence

- Collection cover: title, progress meter, three collection facts, and the primary route back to the cat page are visible without changing the save schema.
- Collection route: unlocked cats appear first, the first undiscovered slot is marked as the current goal, and later slots are disabled until the player discovers them. The recorded cat remains selectable and exposes `aria-pressed` state.
- Current record: the selected cat's breed, age, gender, bond, health, energy, pregnancy countdown when applicable, and a working “Open cats” action are shown in one compact strip.
- Responsive region: at 1040px the three route entries remain on one row without overflow; at 390px the route becomes a single-column reading path while the objective, record, and mobile navigation remain usable.
- Localization: Chinese and English DOM snapshots contain the new route copy and no raw `collection_*` keys in the rendered English page.

## Required fidelity surfaces

- Typography and rhythm: the implementation reuses the current type stack, page-title scale, section eyebrows, rounded editorial borders, and shell spacing. The route book is the visual anchor while the cover and objective ribbon establish the collection goal first.
- Color and state: existing `--story-*` tokens distinguish recorded, current, locked, informational, and progress states. Orange is reserved for the active route and primary action; muted paper tones communicate undiscovered content.
- Assets: unlocked entries use the existing `catArt.buildCatSvg` output and locked entries use the existing question-pose image. Images have explicit dimensions, async decoding, and decorative alt text because the surrounding buttons carry the accessible names.
- Copy and localization: all new collection copy is present in `zh-CN` and `en`; Japanese continues to inherit the project's English fallback layer. Dynamic values are escaped before rendering.
- Accessibility: the page is a labelled region, the overall collection meter uses `role="progressbar"` with value text, record metrics expose progress semantics, unlocked route entries are buttons with `aria-pressed`, and locked entries are disabled.
- Interaction integrity: rendering remains pure. Existing `data-inspect-collection-cat`, `data-page-target`, and `data-select-cat` contracts remain in place; the local browser verified that the current record action opened the cats page and preserved `selectedCatId`.
- Motion and runtime: route and record transitions are covered by the reduced-motion media rule. No new persistence fields or state migrations were introduced; the existing `collectionInspectCatId` selection state continues to drive the record.

## Findings

No actionable P0, P1, or P2 findings remain.

## Verification checklist

- [x] Collection journal cover, progress, objective ribbon, route path, and current record implemented.
- [x] Recorded, current-goal, locked, empty, and all-complete rendering branches represented.
- [x] Existing cat inspection and cat-page navigation contracts preserved.
- [x] Existing cat/question assets reused with explicit image dimensions.
- [x] Route buttons, disabled locked slots, labelled regions, and progress semantics verified in the local DOM.
- [x] 1440px desktop, 1040px intermediate, and 390px mobile in-app browser checks completed with no horizontal overflow.
- [x] English and Chinese render checks completed without raw translation keys.
- [x] Changed JavaScript passed `node --check`.
- [x] `npm test` passed.
- [x] `npm run build` passed; only the repository's existing empty-content warnings were emitted during Astro content sync.
- [x] Browser regression assertions for the collection route and mobile width were added to `scripts/browser-tests/cat-life-storybook.spec.mjs` for CI.

## Follow-up polish

- [P3] If the collection grows beyond a few route entries, consider a compact pagination or chapter marker so the journal remains scannable.
- [P3] Consider adding a small “discovered on” timestamp when collection history needs more long-term memory.

final result: passed
