# NovelForge Import Review 8C

Stage 8C adds an Admin 2.0 review flow for content pushed from NovelForge.

## Admin Flow

1. NovelForge calls `POST /api/novelforge/import` with the publish token.
2. The Worker stores an import backup in R2 when `CONTENT_BUCKET` is configured.
3. The Worker writes an import row to `content_imports` and creates or updates linked `content_entries`.
4. Admin opens `/admin-v2/` and switches to `导入审核`.
5. Admin reviews the import batch, linked series, chapters, cover key, remote ids, public links, and pricing summary.
6. Admin can open any linked entry in the content editor to adjust body, cover, status, or pricing.
7. Admin can publish all draft or scheduled entries in the import batch after review.

## API

- `GET /admin/api/content/imports?type=novelforge&limit=50`
  - Lists NovelForge import batches with linked backend content entries.
  - Includes admin edit links, public paths, remote ids, warning and error arrays.

- `POST /admin/api/content/imports/review`
  - Body: `{ "action": "publish", "importId": 123 }`
  - Publishes only linked `draft` and `scheduled` entries for the selected NovelForge import.
  - Does not change Markdown, HTML, cover keys, or pricing rules.
  - Writes an `admin_audit_logs` row.

## Boundaries

- Pricing is still controlled by Admin 2.0 content pricing fields and the global pricing template.
- Review publishing intentionally does not apply NovelForge pricing suggestions.
- The old GitHub-token Markdown admin path remains deprecated for routine authoring.
- No new D1 migration is required; this uses `content_imports`, `content_entries`, `content_pricing_rules`, and `admin_audit_logs` from previous stages.
