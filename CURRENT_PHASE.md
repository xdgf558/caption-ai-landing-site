# Current Phase

Novel reading module Stage 7H: Admin 2.0 cover image and media upload, backed by R2.

7G is complete:

1. Legacy Blog/Devlog, serial metadata, and serial chapter Markdown have been imported into D1/R2.
2. The old GitHub-token Markdown editor at `/admin/` has been retired.
3. The one-time legacy migration endpoint, Admin 2.0 migration tab, build script, and generated manifest have been removed from the Worker bundle.
4. Old `src/content` Markdown files remain in the repository as history and rollback references.

Product direction:

- New admin features should be built in `/admin-v2/`.
- GitHub remains for site/app code, not routine chapter or blog publishing.
- Pricing rules stay editable in Admin 2.0; future NovelForge import should not overwrite pricing automatically.

7H scope:

1. Admin 2.0 can upload cover images into `CONTENT_BUCKET`.
2. Uploaded covers use the R2 key convention `content/media/covers/{yyyy}/{mm}/{slug}-{timestamp}-{token}.{ext}`.
3. Content entries continue to store `cover_r2_key` and `cover_alt`; no schema migration is required.
4. Public dynamic content APIs expose `coverUrl`, and dynamic Blog / serial cards render covers when available.

Next stages:

- Stage 8: NovelForge one-click import API and Admin 2.0 import review flow.
