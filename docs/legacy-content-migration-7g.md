# Stage 7G: Legacy Markdown Migration

Stage 7G retires the old GitHub-token Markdown authoring path and moves routine Blog/Devlog plus serialized novel publishing into Admin 2.0.

Current status: production migration has completed. The one-time migration tab, `/admin/api/content/legacy-migration` endpoint, generated manifest, and build script have been removed from the active Worker bundle.

## What Changed

- Stage 7G originally generated a legacy manifest from:
  - `src/content/devlog`
  - `src/content/serials`
  - `src/content/serialChapters`
- The production migration wrote legacy metadata to D1 and legacy Markdown/HTML bodies to R2.
- The temporary migration UI and Worker endpoint were removed after verification.
- The old `/admin/` page no longer exposes the GitHub fine-grained-token editor. It now points administrators to `/admin-v2/`.

## Historical Migration Flow

The active Admin 2.0 interface no longer exposes this flow. During 7G rollout, the temporary process was:

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

The importer was idempotent. Running it again updated the same backend entries by `(entry_type, locale, parent_slug, slug)` instead of creating duplicates.

## Safety Boundary

Stage 7G does not delete legacy Markdown files from the repository. They remain as history and a rollback source.

Stage 7G does retire the old authoring UI:

- no GitHub token input on `/admin/`
- no browser-side GitHub content writes
- routine publishing should use Admin 2.0

## Pricing Boundary

Legacy serial pricing was migrated so existing site behavior can continue after the move to D1/R2.

Future NovelForge one-click import should not overwrite pricing. Pricing should stay controlled by Admin 2.0.

## Access Boundary

The temporary migration endpoint has been removed. Cloudflare Access must still protect `/admin`, `/admin/*`, `/admin-v2`, and `/admin-v2/*` for all active admin pages and APIs.

## Rollback

If migrated content has a problem:

1. Unpublish or archive the affected backend entries in Admin 2.0.
2. The dynamic Worker frontend will stop rendering those backend entries.
3. Static Astro pages and legacy Markdown remain in the repo as a fallback unless a later archival cleanup removes them.

## Post-Migration Cleanup

Completed cleanup:

1. Removed the `legacyContentManifest` import and migration route from `src/worker.js`.
2. Deleted the generated `src/generated/legacyContentManifest.js` file.
3. Removed the `scripts/build-legacy-content-manifest.mjs` build step.
4. Removed the Admin 2.0 `迁移` tab and controls.
5. Kept old Markdown files as repository history and rollback references.

## Production Verification Completed

After 7G deployment:

1. Visit `/admin-v2/` and confirm Cloudflare Access appears.
2. Scan and dry-run migration from the `迁移` tab.
3. Execute migration.
4. Confirm migrated Blog entries appear in the Admin 2.0 content list.
5. Open one migrated Blog detail route.
6. Confirm migrated serial and chapter entries appear in Admin 2.0.
7. Open one migrated serial route and one migrated chapter route.
8. Visit `/admin/` and confirm it is a retirement notice, not a GitHub-token editor.

After cleanup deployment, verify `/admin-v2/` no longer shows a migration tab and `/admin/api/content/legacy-migration` is no longer routed by the Worker.
