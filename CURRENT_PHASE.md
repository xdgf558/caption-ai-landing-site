# Current Phase

Novel reading module Stage 8B: Admin 2.0 pricing defaults.

8A is complete:

1. `POST /api/novelforge/import` is available for NovelForge AI.
2. The import API uses `NOVELFORGE_PUBLISH_TOKEN` Bearer authentication.
3. Imported projects save as `novel_series`; imported chapters save as `novel_chapter`.
4. NovelForge receives stable remote IDs, Admin 2.0 preview links, public publish links, and per-item status results.

Product direction:

- New admin features should be built in `/admin-v2/`.
- GitHub remains for site/app code, not routine chapter or blog publishing.
- Pricing rules stay editable in Admin 2.0; NovelForge import must not overwrite pricing automatically.
- External publishing tools should write into the same D1/R2 backend content platform as Admin 2.0.

8B scope:

1. Add an Admin 2.0 pricing template panel.
2. Store global novel pricing defaults in D1 `admin_content_settings`.
3. Allow admins to save the current pricing panel as the default template.
4. Allow admins to apply the default template to the current form.
5. Automatically apply the default template when creating a new `novel_series`.
6. Keep existing entries unchanged unless the admin explicitly saves them.

Next stages:

- Stage 8C: Admin 2.0 NovelForge import review, retry, and conflict-resolution flow.
