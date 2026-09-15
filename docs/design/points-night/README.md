# Station Points night-theme review

Four localized Points landing pages follow the supplied night-desk reference. The reference/implementation comparison is shown at equal width; the right-hand implementation is longer because it preserves the full existing usage and account rules.

- [Reference and implementation comparison](reference-comparison.webp)
- [Mobile preview](mobile-preview.webp)

The current public payment configuration has one pack: 100 points / USD 10. Prices remain fetched from the same-origin status endpoint; no illustrated NT-dollar packs or recommendation claims were added. Music availability follows the existing entry gate and VIP copy. Software remains planned.

Validation: active-entry build and postbuild checks; closed-entry build with no public music navigation on all four Points pages; existing Station Points, site foundation and reader-library locale tests; responsive checks at 1122, 768, 390 and 320 pixels. The English 320px layout was rechecked after fixing subtitle overflow and the inherited body minimum width. Purchase-disabled and API-failure fixtures both hide pack actions and the Creem badge and disable the primary purchase link. Active purchase navigation leads to the matching locale's member centre. The mobile language menu remains on the Points route.

Screenshots use a read-only local checkout-status snapshot. No real payment was made; no backend, pricing configuration, account data or deployment was changed. Local browser checks do not replace physical iPhone acceptance testing.

CI follow-up: retained the shared 64px `VipMark` badge in the VIP benefit row and kept the redemption explanation within the capabilities section. This preserves the existing payment UI regression contract. The original comparison image predates this small badge-only visual adjustment.
