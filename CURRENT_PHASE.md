# Current Phase

Novel reading module phase 7G: legacy Markdown migration and old authoring path retirement.

Current task: make Admin 2.0 the operating center for routine content publishing.

7G adds:

1. A generated legacy content manifest built from `src/content/devlog`, `src/content/serials`, and `src/content/serialChapters`.
2. A protected Admin API at `/admin/api/content/legacy-migration` for scanning, dry-running, and executing migration into D1/R2.
3. An Admin 2.0 migration tab that shows create/update counts before writing anything.
4. Import batch records in `content_imports`, revision rows, pricing rule sync, and audit logs for migrated entries.
5. A retired `/admin/` page that points content work to `/admin-v2/` instead of exposing the old GitHub-token Markdown editor.

Product direction:

- New admin features should be built in `/admin-v2/`.
- GitHub remains for site/app code, not routine chapter or blog publishing.
- Pricing rules stay editable in Admin 2.0; future NovelForge import should not overwrite pricing automatically.

Out of scope for 7G: cover image upload and NovelForge one-click import. Cover upload is tracked as a later 7H media-management option; NovelForge import belongs to a future Stage 8.
