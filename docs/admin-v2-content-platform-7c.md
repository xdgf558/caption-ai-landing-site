# Stage 7C: Admin 2.0 Content Management Platform

Stage 7C introduces a new backend-first admin surface at `/admin-v2/`.

The old `/admin/` GitHub-token Markdown editor remains available during validation. It should only be removed after Stage 7G migrates legacy Markdown into D1/R2 and confirms the new publishing flow is stable.

## Goals

- Manage serialized novels, novel chapters, and Blog/Devlog posts from one backend UI.
- Save metadata to D1 `content_entries`.
- Save Markdown and rendered HTML bodies to `CONTENT_BUCKET`.
- Keep pricing, tipping, reading-credit, and multi-chapter discount settings alongside content metadata.
- Show reader entitlements, NOWPayments orders, revisions, and admin audit logs in one place.
- Keep all admin pages and admin APIs under Cloudflare Access.

## New Admin Entry

```text
/admin-v2/
```

The page has four primary areas:

- Content: list, create, edit, import Markdown, preview, and publish backend content entries.
- Orders: read the existing novel payment order API for payment troubleshooting.
- Entitlements: query, grant, and revoke reader access.
- Audit: read `admin_audit_logs` for backend content operations.

## New Admin APIs

Stage 7A already added:

```text
GET  /admin/api/content/schema
GET  /admin/api/content/entries
POST /admin/api/content/entries
```

Stage 7C adds:

```text
GET /admin/api/content/body?id={entryId}
GET /admin/api/content/revisions?id={entryId}
GET /admin/api/content/audit-logs
```

These APIs are nested below `/admin/api/` so the existing Cloudflare Access rule continues to protect them.

## Access Boundary

The Worker and Pages middleware now protect both admin route families:

```text
/admin
/admin/*
/admin-v2
/admin-v2/*
```

Cloudflare Access should also be configured with matching paths. If the dashboard does not treat wildcard matching as expected, create explicit applications or path rules for `/admin`, `/admin/*`, `/admin-v2`, and `/admin-v2/*`.

## Production Verification After Deploy

After merging and deploying Stage 7C, verify the admin boundary before using the new editor with real content:

1. Open a private browser session and visit `/admin-v2/`.
2. Confirm Cloudflare Access appears before the Admin 2.0 page loads.
3. Request these URLs without a valid Access session and confirm they redirect to Access or return an admin access denial:

```text
/admin-v2/
/admin/api/content/schema
/admin/api/content/entries
/admin/api/content/body?id=1
/admin/api/content/revisions?id=1
/admin/api/content/audit-logs
```

Do not enter real content in Admin 2.0 until unauthenticated access to the editor and write APIs is blocked in production.

## Content Body Behavior

When Admin 2.0 saves content:

1. Metadata is normalized and upserted into `content_entries`.
2. Markdown is uploaded to the generated `markdown_r2_key`.
3. A simple HTML preview is uploaded to the generated `html_r2_key`.
4. A row is created in `content_revisions`.
5. A row is written to `admin_audit_logs`.

The HTML renderer in Stage 7C is intentionally simple. It is enough for admin preview and first backend body storage, but Stage 7D/7G can replace it with the site rendering pipeline when frontend pages start reading backend content directly.

## Pricing Controls

Admin 2.0 writes pricing controls into `content_entries.pricing_json`:

- `mode`
- `freeChapters`
- `chapterPriceAmount`
- `chapterPriceCurrency`
- `chapterCredits`
- `tipsEnabled`
- `tipAmounts`
- `tipCurrency`
- `bundlePurchasesEnabled`
- `chapterBundleDiscounts`

Stage 7E will promote these rules into the frontend purchase experience and, where needed, the generic `content_pricing_rules` table.

## Current Boundary

Stage 7C does not yet make public novel or Blog pages dynamic. Existing static Astro pages remain the public source of truth until Stage 7D.

Stage 7D should convert the public reading and Blog/Devlog surfaces to read backend-published content from the Worker APIs, while retaining static Astro content as a rollback path. The target outcome is immediate publishing from Admin 2.0 without a GitHub commit or site redeploy for routine chapters and posts.

Stage 7C also does not remove legacy Markdown content or the old `/admin/` page. That cleanup belongs to Stage 7G.
