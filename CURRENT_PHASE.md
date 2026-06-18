# Current Phase

Novel reading module Stage 8A: NovelForge one-click import API.

7H is complete:

1. Admin 2.0 can upload cover images into `CONTENT_BUCKET`.
2. Uploaded covers use the R2 key convention `content/media/covers/{yyyy}/{mm}/{slug}-{timestamp}-{token}.{ext}`.
3. Content entries continue to store `cover_r2_key` and `cover_alt`; no schema migration is required.
4. Public dynamic content APIs expose `coverUrl`, and dynamic Blog / serial cards render covers when available.

Product direction:

- New admin features should be built in `/admin-v2/`.
- GitHub remains for site/app code, not routine chapter or blog publishing.
- Pricing rules stay editable in Admin 2.0; NovelForge import must not overwrite pricing automatically.
- External publishing tools should write into the same D1/R2 backend content platform as Admin 2.0.

8A scope:

1. Add `POST /api/novelforge/import` for NovelForge AI.
2. Authenticate the import API with a dedicated `NOVELFORGE_PUBLISH_TOKEN` Bearer token.
3. Accept the `station-cat-novelforge-import.v1` contract and `novelforge-standard-publish-package` payload.
4. Import project metadata as `novel_series` and chapter bodies as `novel_chapter`.
5. Store bodies in `CONTENT_BUCKET`, metadata in D1, and import audit records in `content_imports` / `admin_audit_logs`.
6. Return stable remote IDs, Admin 2.0 preview links, public publish links, and per-item status results.

Next stages:

- Stage 8B: Admin 2.0 NovelForge import review, retry, and conflict-resolution flow.
