# Current Phase

Novel reading module post-7G cleanup: legacy migration tooling has been removed after production migration.

Current task: keep Admin 2.0 as the operating center for routine content publishing and prepare Stage 7H media management.

7G is complete:

1. Legacy Blog/Devlog, serial metadata, and serial chapter Markdown have been imported into D1/R2.
2. The old GitHub-token Markdown editor at `/admin/` has been retired.
3. The one-time legacy migration endpoint, Admin 2.0 migration tab, build script, and generated manifest have been removed from the Worker bundle.
4. Old `src/content` Markdown files remain in the repository as history and rollback references.

Product direction:

- New admin features should be built in `/admin-v2/`.
- GitHub remains for site/app code, not routine chapter or blog publishing.
- Pricing rules stay editable in Admin 2.0; future NovelForge import should not overwrite pricing automatically.

Next stages:

- 7H: cover image and media upload in Admin 2.0, backed by R2.
- Stage 8: NovelForge one-click import API and Admin 2.0 import review flow.
