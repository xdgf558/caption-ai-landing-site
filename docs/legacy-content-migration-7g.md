# Stage 7G: Legacy Markdown Migration

Stage 7G retires the old GitHub-token Markdown authoring path and moves routine Blog/Devlog plus serialized novel publishing into Admin 2.0.

## What Changed

- `scripts/build-legacy-content-manifest.mjs` reads legacy Markdown from:
  - `src/content/devlog`
  - `src/content/serials`
  - `src/content/serialChapters`
- The build now generates `src/generated/legacyContentManifest.js`.
- Admin 2.0 has a new `迁移` tab.
- The Worker exposes a protected admin endpoint:

```text
GET  /admin/api/content/legacy-migration
POST /admin/api/content/legacy-migration
```

- The old `/admin/` page no longer exposes the GitHub fine-grained-token editor. It now points administrators to `/admin-v2/`.

## Migration Flow

1. Open `/admin-v2/`.
2. Switch to `迁移`.
3. Click `扫描旧内容`.
4. Click `模拟迁移`.
5. Confirm the create/update counts.
6. Click `执行迁移`.

The execution path writes:

- metadata to D1 `content_entries`
- Markdown and HTML bodies to `CONTENT_BUCKET`
- revision rows to `content_revisions`
- import records to `content_imports`
- pricing rules to `content_pricing_rules`
- audit rows to `admin_audit_logs`

The import is idempotent. Running it again updates the same backend entries by `(entry_type, locale, parent_slug, slug)` instead of creating duplicates.

## Safety Boundary

Stage 7G does not delete legacy Markdown files from the repository. They remain as history and a rollback source.

Stage 7G does retire the old authoring UI:

- no GitHub token input on `/admin/`
- no browser-side GitHub content writes
- routine publishing should use Admin 2.0

## Pricing Boundary

Legacy serial pricing is migrated so existing site behavior can continue after the move to D1/R2.

Future NovelForge one-click import should not overwrite pricing. Pricing should stay controlled by Admin 2.0.

## Access Boundary

`/admin/api/content/legacy-migration` is under the existing `/admin/api/*` route family. Production Cloudflare Access must continue to protect:

```text
/admin
/admin/*
/admin-v2
/admin-v2/*
```

Verify unauthenticated requests to `/admin/api/content/legacy-migration` redirect to Access before executing production migration.

## Rollback

If migrated content has a problem:

1. Unpublish or archive the affected backend entries in Admin 2.0.
2. The dynamic Worker frontend will stop rendering those backend entries.
3. Static Astro pages and legacy Markdown remain in the repo as a fallback until a later cleanup stage removes them.

## Production Verification

After deployment:

1. Visit `/admin-v2/` and confirm Cloudflare Access appears.
2. Scan and dry-run migration from the `迁移` tab.
3. Execute migration.
4. Confirm migrated Blog entries appear in the Admin 2.0 content list.
5. Open one migrated Blog detail route.
6. Confirm migrated serial and chapter entries appear in Admin 2.0.
7. Open one migrated serial route and one migrated chapter route.
8. Visit `/admin/` and confirm it is a retirement notice, not a GitHub-token editor.
