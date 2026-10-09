# T19 design QA

Source visual truth: `docs/station-cat-redesign/evidence/T16/admin-final.png` (1425 x 1627), the previously accepted content admin. No report-specific mock was supplied. T19 extends the admin system with statistics and manual source records; content, controls and page length intentionally differ. This is not a new interpretation of the public homepage.

Final implementation: `evidence/T19/report-final-1440.png` (1425 x 2563). CSS viewport 1440 x 1000, density 1, content width 1425 after the scrollbar. Full comparison: `comparison-final-full.png`; focused header comparison: `comparison-final-header.png`. Both were inspected together at the same source content width. The five captures use 320, 390, 768, 1024 and 1440 CSS pixels; viewport overrides were reset after testing.

## Iteration findings and corrections

1. Initial comparison found two P2 defects: the role badge overflowed the 320px heading to 332px; inherited details padding displaced the panel gutters. The mobile heading now wraps and report-specific padding has scoped specificity. Final scroll widths equal client widths: 305, 375, 753, 1009 and 1425. Evidence: `comparison-first-full.png`, `report-first-320.png`, final captures and `viewport-metrics.json`.
2. Actual import found a P2 interaction defect: valid midnight input was rejected because native datetime-local removes zero seconds. The client now canonicalizes UTC timestamps. Final browser import saved a provenance-backed 0, and revision changed it to 7 with identity fields disabled. Evidence: `import-before-date-fix.png`, `manual-zero-saved.png`, `manual-edit-form-320.png`, `form-320-metrics.json`.
3. Final verification included the time-bounded operation key. The preview browser isolates some cookies; the local proxy now also reads only the same-origin report page's selected fixture from Referer. Actual lost acknowledgement then retained pending state after reload, and retry confirmed the original operation. This fixture adaptation does not change production authentication or client paths. Evidence: `snapshot-lost-ack.png`, `snapshot-recovered-after-reload.png`; native D1 and client tests separately verify one insertion and the original key/body/version.

## Five fidelity surfaces

| Surface | Reference comparison and result |
| --- | --- |
| Fonts and typography | Original system/PingFang stack and 26px desktop heading preserved. Mobile title wraps at 28px. Larger green numerals serve the new metrics. Labels, denominators and UTC dates remain legible in the expanded 320px form. |
| Spacing and layout | Original admin top bar, outer gutters, restrained bordered panels and rounded controls retained. Data cards use responsive grids; the long mobile page is intentional. Badge and details gutters corrected. No document-level overflow at five widths. |
| Colors and tokens | Original green/gray text, pale background, white panels and green primary buttons retained. Soft mint distinguishes primary metrics without another palette. |
| Assets and icon quality | No new illustration, substitute brand image or custom art. Existing Lucide admin icons and native form controls remain consistent with T16. |
| Copy and content | Fixture banner marks synthetic figures. Clicks and platform plays, missing and zero, local saves and cloud acceptance remain distinct. Percentages show session denominators; unmatched manual scopes are labeled. |

## Interaction and accessibility evidence

Actual browser checks covered same-song/Campaign cohorts, the NetEase click filter (4 clicks, 1/3 converted, denominator still 3), sourced zero, CAS revision, expanded mobile controls, keyboard Tab skipping disabled identities, and recovery across reload. State checks verified disabled reports, missing schema, read-only editor, known recent zero and missing historical aggregates.

Visible main controls are at least 44px high. Expanded text/select/button controls are 44px; the native checkbox is 18px inside a label target at least 44px high. Focus outlines are present; the actual Tab check moved from the editable number to source kind while disabled identities were skipped. This is a keyboard spot check, not full accessibility certification.

The available browser console log contained no recorded JavaScript warnings or errors. Expected fixture 503s and one transient preview read failure were handled by the unavailable/recheck path; explicit recheck recovered. Not every network request succeeded. `browser-interactions.json` records the observed scope.

No remaining actionable P0/P1/P2 visual or interaction finding was identified in these checked surfaces. Production scheduling capacity, service bindings, real media/rights and expired-operation reconciliation are documented in the T19 contract; screenshots do not validate them. Physical iOS/Android devices, in-app browsers and VoiceOver remain untested P3 evidence gaps.

final result: passed
