# Admin Pricing Defaults 8B

Stage 8B adds a reusable Admin 2.0 pricing template for new serial works.

## Storage

Global Admin 2.0 content settings are stored in D1:

```text
admin_content_settings
```

The pricing default row uses this key:

```text
content.pricing-defaults.v1
```

Apply the migration before using the feature in production:

```text
migrations/0008_admin_content_settings.sql
```

## Admin API

The endpoint is protected by the existing `/admin*` Cloudflare Access boundary:

```http
GET /admin/api/content/pricing-defaults
POST /admin/api/content/pricing-defaults
```

GET returns:

```json
{
  "ok": true,
  "template": {
    "accessLevel": "free",
    "pricing": {
      "mode": "chapter-paid",
      "freeChapters": 10,
      "chapterPriceAmount": 0.1,
      "chapterCredits": 10,
      "tipsEnabled": true,
      "tipAmounts": [1],
      "bundlePurchasesEnabled": true,
      "chapterBundleDiscounts": [
        { "minimumChapters": 100, "discountPercent": 10 },
        { "minimumChapters": 200, "discountPercent": 20 }
      ],
      "creditPacks": [
        { "credits": 100, "priceAmount": 1, "priceCurrency": "USD", "label": "100 SC Credits" }
      ]
    },
    "isConfigured": true,
    "updatedAt": "2026-06-18 00:00:00",
    "updatedBy": "brodstem@protonmail.com"
  }
}
```

POST accepts:

```json
{
  "accessLevel": "free",
  "pricing": {
    "mode": "chapter-paid",
    "freeChapters": 10,
    "chapterPriceAmount": 0.1,
    "chapterCredits": 10,
    "tipsEnabled": true,
    "tipAmounts": [1],
    "bundlePurchasesEnabled": true,
    "chapterBundleDiscounts": [
      { "minimumChapters": 100, "discountPercent": 10 },
      { "minimumChapters": 200, "discountPercent": 20 }
    ],
    "creditPacks": [
      { "credits": 100, "priceAmount": 1, "priceCurrency": "USD" }
    ]
  }
}
```

POST normalizes values through the same content pricing rules used by saved entries, then writes an `admin_audit_logs` row with action:

```text
content_pricing_defaults_update
```

## Admin 2.0 Behavior

The content sidebar now includes `收费模板`:

- `保存当前为默认`: saves the current pricing panel as the default template.
- `套用默认`: applies the default template to the current form. The content entry still needs to be saved.
- `刷新模板`: reloads the template from D1.

New `小说作品` forms automatically receive the saved default template.

Existing content is never overwritten automatically. To update an existing work:

1. Load the work in Admin 2.0.
2. Click `套用默认`.
3. Click `保存到后端内容平台`.
4. Use `生效价格预览` to confirm the public pricing API result.

## Input Notes

The `多章折扣` field accepts comma or space separated rules:

```text
100:10 200:20
100:10, 200:20
```

Both forms mean:

- unlock 100 chapters with 10% discount
- unlock 200 chapters with 20% discount

## Verification

Recommended checks:

```text
node --check src/worker.js
git diff --check
npm run build
npx --yes wrangler@latest deploy --dry-run
```

Manual production checks:

1. Apply `0008_admin_content_settings.sql` to the production D1 database.
2. Open `/admin-v2/` through Cloudflare Access.
3. Configure the pricing panel and click `保存当前为默认`.
4. Click `新作品`; confirm the default pricing values are automatically filled.
5. Save a test work and confirm `生效价格预览` reads `D1 规则表`.
