# T05 Design QA

final result: passed

## Findings

No unresolved P0, P1 or P2 visual or interaction findings remain within the isolated T05 homepage scope. The first pass found a P1 poster-height defect: the HTML height of 1024 overrode the intended 16:9 card ratio. Setting `height: auto` repaired it; the final desktop posters measure 291.5 × 163.96875 CSS pixels. `complete-initial.jpg` and `comparison-initial.jpg` preserve the first pass. All final state, width and locale screenshots were recaptured after the last change restoring the reference's preview-only wishlist feedback.

The inherited P3 differences are the reconstructed illustration's brushwork and local composition, font metrics, and stock platform glyphs. The user approved the T04 visual baseline. No new visual direction was introduced. T05 adds the selected-song and short-video sections required by the task when valid selected records exist; the reference image has neither separate section. Sample badges and local platform labels intentionally distinguish fixture content from an actual release. Playback and real account wishlist persistence remain outside T05.

## Visual truth

The authoritative reference is `../T04-evidence/gentle-station/reference-content.png`, 1356 × 996 pixels, extracted from the user's “Station Cat 温柔小站首页.png” without its painted browser frame. The current implementation was captured at CSS viewport 1371 × 996, DPR 1, with client width 1356. `desktop-review.jpg` is the latest render through the real footer, 1356 × 1472; `complete-final.jpg` also includes the development controls. `comparison-final.jpg` places the original and the latest implementation side by side at equal width, without scaling either input. The page is taller because the full fixture includes three selected songs and four clip cards.

The same-input focused pairs `focused-navigation.jpg`, `focused-hero-copy.jpg`, `focused-features.jpg` and `focused-news.jpg` were inspected together with the full pair. Header, hero copy, card boundaries, cover sizes, action positions, promotion strip, news and footer retain the approved T04 hierarchy. The primary preview affordance is absent in the default complete fixture because its explicit preview switch is off. The music card adds the actual artist field and marks every mock platform link as a sample; its target is a local explanatory page.

All images are reused T04 bitmap assets; no new generation was needed. Their source, five complete asset prompts and license/provenance notes remain in `../T04-evidence/gentle-station/asset-prompts.md`. They are illustration samples, not operational song artwork or real game screenshots.

## Required surfaces and evidence

| Surface | Verification and evidence |
| --- | --- |
| Desktop | Six configurations at 1371 × 996; no horizontal overflow or broken images. Full/focused comparison above; `state-observations.json`, `final-geometry.json`. |
| Phone | Five width checks at 375, 390, 768, 1280 and 1440; four language checks at 375 and 768. Hero text and image separate at narrow widths. No horizontal overflow; primary and game buttons remain at least 44 CSS pixels tall. `responsive-observations.json`, `locale-observations.json`. |
| Required state branches | Complete sample, missing video and missing platform screenshots on desktop and phone, plus unconfigured, preview-enabled and revoked branches. Missing clips remove the entire clip section; missing platforms show accurate copy; unconfigured content does not select a song or game. |
| Controls and keyboard | The hero music link was activated with Enter; track, clip, game, platform and preview destinations were clicked and verified. The corresponding destination heading/hash identifies the intended work. Sample wishlist feedback uses `aria-pressed` and a status message explicitly saying it is not synced to the account; reload clears it. `interaction-observations.json`, `wishlist-selected.jpg`. |
| Obstruction and media | Actual viewport screenshots `viewport-features-{zh-Hant,en}.jpg`, `viewport-clips-{zh-Hant,en}.jpg` and `mobile-bottom.jpg` show game actions and final controls above the fixed navigation. Latest game-action bottoms are 443.94/497.84 with nav top 780; final action bottom is 731.99. No audio, video or iframe is mounted in any home state, so this homepage cannot autoplay. Console warning/error observations are empty. |

Browser screenshot pixel dimensions are recorded in the manifest and may differ from the requested CSS viewport because the in-app browser's capture excludes scrollbar/chrome area. Full-page captures can place fixed navigation in the initial viewport position; they are used for layout, while actual viewport captures and DOM rectangles establish obstruction results. These are simulated viewports, not device or VoiceOver acceptance.

## Implementation checklist and limits

The selected reference, five-entry navigation, quiet first visit, file-based stable IDs/published revision, safe empty states, direct entity destinations, conditional cards and local review controls are present. The poster-height repair and final wishlist change were rebuilt and recaptured. The final input review also reserves the existing `cat-life` runtime slug and leaves duration limits to the actual resource contract; these gates do not change the six rendered fixture states. Final route tests pass 7/7, homepage projection tests pass 19/19, and isolated preview compilation builds 85 pages. The normal build passes with `ALLOW_EMPTY_SERIAL_CONTENT=1`; its 153 pages/111 sitemap routes are not a production package or deployment result. Normal output contains none of the checked homepage/shell/fixture markers (`build-isolation.json`).

This report accepts frontend projection and isolated navigation only. The synthetic publication/resource-rights flags do not establish real issuance, public D1/R2 rights or media availability. Platform verification, server authorization, preview resource validation, players, video playback, game intro/runtime integration, admin publication and cache invalidation remain their assigned later tasks. A01 is supported only for local static homepage silence; A03 covers truthful fixture state rendering; A20 covers deterministic reference removal on reprojection, not a production cache purge. About still uses the existing Hant `/about/`; unknown legacy music descendants still require the T08/T20 mapping already identified in the T04 review.
