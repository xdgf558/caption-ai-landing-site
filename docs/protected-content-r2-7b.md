# Stage 7B: Protected Chapter Bodies in R2

Stage 7B moves protected chapter body delivery out of the Worker bundle and into a dedicated R2 bucket.

Static chapter pages still render the access gate. Reader auth, credit unlocks, NOWPayments orders, and `novel_entitlements` continue to work the same way. The only changed part is where authorized protected HTML is loaded from.

## What Changed

Before 7B:

- `scripts/build-novel-payment-config.mjs` rendered paid/supporter chapter HTML.
- The rendered HTML was embedded directly into `src/generated/protectedSerialContent.js`.
- The Worker imported that module and returned `chapter.html` after checking entitlement.

After 7B:

- `src/generated/protectedSerialContent.js` contains metadata and `htmlR2Key` only.
- Rendered protected HTML files are written to `.generated/protected-serial-content/files/...`.
- `.generated/protected-serial-content/manifest.json` lists the files that need to be uploaded.
- `scripts/upload-protected-serial-content.mjs` uploads those files to R2.
- The Worker checks entitlement, then reads the HTML from `env.CONTENT_BUCKET`.

## R2 Bucket

`wrangler.toml` now includes:

```toml
[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "station-cat-content"
```

This bucket is separate from `station-cat-downloads` so paid chapter content, blog bodies, covers, and future uploads do not mix with public app download packages.

## R2 Keys

Protected chapter HTML uses the Stage 7 content convention:

```text
content/novels/{seriesSlug}/chapters/{chapterNumber}-{chapterSlug}/{locale}/body.html
```

Example:

```text
content/novels/deng-hai-liang-zhe/chapters/002-city-after-midnight/zh-Hant/body.html
```

## Build And Upload Flow

Run:

```bash
npm run build:novel-payment-config
npm run upload:protected-serial-content
npm run build
```

`npm run build` already calls `build:novel-payment-config`, so the usual deployment flow can be:

```bash
npm run build
npm run upload:protected-serial-content
npx --yes wrangler@latest deploy
```

If there are no paid/supporter published chapters, the upload step exits with:

```text
No protected serial content files to upload.
```

## Runtime Behavior

`GET /api/novels/chapters/protected-content?series=...&chapter=...` now returns content only after:

1. The chapter exists in the generated protected manifest.
2. The reader is signed in.
3. `novel_entitlements` grants this account access.
4. `CONTENT_BUCKET` is configured.
5. The R2 object exists.

Successful responses include:

```json
{
  "content": {
    "source": "r2",
    "html": "...",
    "headings": []
  }
}
```

Failure cases are explicit:

- `CONTENT_BUCKET_NOT_CONFIGURED`
- `PROTECTED_CONTENT_KEY_MISSING`
- `PROTECTED_CONTENT_OBJECT_NOT_FOUND`

All protected content responses continue to use:

```text
Cache-Control: no-store
X-Robots-Tag: noindex
```

## Deployment Checklist

Before deploying Stage 7B to production:

1. Create the `station-cat-content` R2 bucket if it does not already exist.
2. Run `npm run build`.
3. Run `npm run upload:protected-serial-content`.
4. Run `npx --yes wrangler@latest deploy`.
5. Confirm the Worker bindings show `CONTENT_BUCKET`.
6. Confirm a protected chapter with entitlement loads from `source: "r2"` once a paid/supporter chapter exists.

## Current Boundary

Stage 7B does not build Admin 2.0. The old Markdown files are still the authoring source until Stage 7C/7G.
