# Stage 7E-B: Reader Checkout Uses Backend Pricing

Stage 7E-B makes public reading and payment flows consume Admin 2.0 pricing rules.

## Scope

Implemented in this stage:

- `POST /api/novels/payments/checkout` resolves series pricing from D1 before generated static config.
- `POST /api/novels/credits/unlock` uses backend `chapterCredits` before the environment default.
- `GET /api/novels/pricing` exposes the effective public pricing summary for reader-facing UI.
- Static serial chapter gates refresh button labels from the public pricing API.
- Static serial detail tip panels refresh tip amounts and can hide when backend tips are disabled.
- Dynamic backend chapter pages render credit unlock, single chapter, supporter, and bundle purchase buttons from backend pricing.
- Admin 2.0 shows an effective pricing preview that reads the same public pricing API after content is loaded or saved.

## Resolution Order

Reader-facing pricing resolves in this order:

1. Enabled rows in `content_pricing_rules`
2. The saved `content_entries.pricing_json` snapshot
3. Generated legacy `src/generated/novelPaymentConfig.js`
4. Environment defaults

The Worker still recalculates every checkout amount server-side. Frontend button text is only a display hint.

## Public Pricing API

```text
GET /api/novels/pricing?series={seriesSlug}&chapter={chapterSlug}&locale=zh-Hant
```

The route returns:

- pricing source
- tip amounts and currency
- single chapter price
- supporter price
- reading-credit chapter cost
- available bundle options for the requested chapter
- configured credit packs

The route is public and intentionally returns only pricing data.

## Checkout Notes

- Chapter, supporter, bundle, and tip orders record `pricingSource` in order metadata.
- Credit-pack orders may optionally pass `seriesSlug`; when present, matching backend credit packs can override the global environment pack list.
- Reading-credit unlock ledger metadata records the pricing source used for `chapterCredits`.

## Verification

Recommended checks:

```text
node --check src/worker.js
npm run build
npx --yes wrangler@latest deploy --dry-run
```

For local Wrangler regression:

1. Save a published `novel_series` with pricing controls in Admin 2.0.
2. Request `/api/novels/pricing?series={slug}&chapter={chapterSlug}` and confirm `source` is `backend-pricing-rules`.
3. Create a chapter checkout and confirm the saved order metadata contains `pricingSource: "backend-pricing-rules"`.
4. Unlock a paid chapter with reading credits and confirm the ledger metadata uses the backend credit cost.
5. In Admin 2.0, load or save the same series/chapter and confirm the effective pricing preview matches the public API response.
