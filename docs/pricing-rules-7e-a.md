# Stage 7E-A: Backend Pricing Rule Storage

Stage 7E-A moves Admin 2.0 pricing controls from a content-only JSON snapshot into normalized D1 pricing rules.

## Scope

Implemented in this stage:

- Admin 2.0 saves pricing controls into `content_entries.pricing_json`.
- The Worker rebuilds matching `content_pricing_rules` rows whenever an entry is saved.
- Admin 2.0 can read saved pricing rules through `/admin/api/content/pricing-rules`.
- Content body reads return the saved pricing rules for the selected entry.
- Admin audit logs record how many pricing rules were synced with a content save.

Not implemented yet:

- Public checkout still uses the current generated/static pricing fallback.
- Reader-facing purchase buttons do not yet consume `content_pricing_rules`.
- Full order, account, balance, and entitlement management remains Stage 7F.

## Rule Types

The rules table can now store:

```text
pricing_mode
free_chapters
chapter_price
supporter_price
tip_amount
bundle_discount
credit_pack
```

Each rule is scoped to the saved content entry. Novel chapters inherit a `series_slug` from `parent_slug`; novel series use their own slug as `series_slug`.

## Admin API

```text
GET /admin/api/content/pricing-rules?entryId={entryId}
```

Optional filters:

```text
entryType
seriesSlug
chapterSlug
ruleType
limit
```

This route is an Admin route and must stay covered by Cloudflare Access.

## Next

Stage 7E-B should update checkout and reader-facing gates to resolve pricing in this order:

1. `content_pricing_rules`
2. `content_entries.pricing_json`
3. Generated legacy `novelPaymentConfig`
4. Environment defaults
