# Stage 7A: Backend Content Platform Foundation

Stage 7 moves Station Cat content operations away from GitHub Markdown as the daily publishing system.

GitHub remains the code repository. Routine serial fiction chapters, blog posts, pricing rules, import records, and Admin 2.0 audit history should move to Cloudflare Workers, D1, and R2.

## Goals

- Keep the existing static Astro pages working while the backend platform is introduced.
- Add backend tables for serialized novels and blog/devlog content.
- Define R2 object key conventions for Markdown, rendered HTML, covers, attachments, and imports.
- Add thin Worker API routes that Admin 2.0 can use in Stage 7C.
- Do not remove the old `/admin/` GitHub-token Markdown flow yet.

## Storage Model

### D1

`migrations/0007_backend_content_platform.sql` adds:

- `content_entries`: shared metadata for `blog_post`, `novel_series`, and `novel_chapter`.
- `content_revisions`: revision records for rollback and publishing history.
- `content_imports`: Markdown/import job records.
- `content_pricing_rules`: generic pricing rules for later Admin 2.0 controls.
- `admin_audit_logs`: who changed what, when.

Existing tables stay in place:

- `reader_accounts`
- `reader_sessions`
- `novel_entitlements`
- `novel_orders`
- `novel_tips`
- `novel_payment_events`
- `reader_credit_accounts`
- `reader_credit_ledger`

### R2

Stage 7A defined the key layout before the bucket was wired into production. Stage 7B adds the dedicated `CONTENT_BUCKET` binding.

```text
content/blog/{locale}/{slug}/body.md
content/blog/{locale}/{slug}/body.html

content/novels/{seriesSlug}/series/{locale}/body.md
content/novels/{seriesSlug}/series/{locale}/body.html

content/novels/{seriesSlug}/chapters/{chapterNumber}-{chapterSlug}/{locale}/body.md
content/novels/{seriesSlug}/chapters/{chapterNumber}-{chapterSlug}/{locale}/body.html

content/imports/{yyyy}/{mm}/{importId}-{filename}
```

The Worker looks for an optional `CONTENT_BUCKET` binding before accepting body uploads. This prevents novel/blog content from accidentally being written into the existing downloads bucket.

## API Skeleton

### Admin

All admin routes are still covered by the existing `/admin` Cloudflare Access guard.

```text
GET  /admin/api/content/schema
GET  /admin/api/content/entries
POST /admin/api/content/entries
```

`GET /admin/api/content/schema` returns:

- supported entry types
- locales
- statuses
- access levels
- R2 key conventions
- whether `CONTENT_BUCKET` is configured

`GET /admin/api/content/entries` lists backend content metadata. Filters:

- `type` or `entryType`
- `locale` or `language`
- `status`
- `parentSlug` or `series`
- `limit`

`POST /admin/api/content/entries` upserts metadata into `content_entries`, creates a `content_revisions` record, and writes an `admin_audit_logs` row. If the payload includes `markdown` or `html`, the request requires `CONTENT_BUCKET`.

### Public

```text
GET /api/content/entries
```

This returns only `published` backend content entries with `public` or `unlisted` visibility. It does not return chapter or blog body content. Frontend pages are still static in Stage 7A.

## Entry Types

```text
blog_post
novel_series
novel_chapter
```

Supported locales:

```text
zh-Hant
zh-Hans
en
ja
```

Supported statuses:

```text
draft
scheduled
published
archived
```

Supported access levels:

```text
free
paid
supporter
member
```

## Migration Path

1. Keep current `src/content/devlog`, `src/content/serials`, and `src/content/serialChapters` as the public source.
2. Start writing new backend content entries through Admin 2.0 APIs.
3. In Stage 7B, move protected chapter bodies from generated Worker modules to R2-backed reads.
4. Stage 7C adds `/admin-v2/` for novels, chapters, blog/devlog, orders, entitlements, revisions, and audit logs.
5. In Stage 7G, migrate legacy Markdown files into D1/R2 and remove the old GitHub-token authoring flow.

## Production Setup Still Needed

Before using body upload in production:

1. Create a dedicated R2 bucket, for example `station-cat-content`.
2. Add a `CONTENT_BUCKET` binding to `wrangler.toml`.
3. Deploy after confirming the bucket exists.
4. Keep `/admin/api/content/*` covered by Cloudflare Access.

Stage 7B now adds this binding for protected chapter delivery. Deployments after 7B require the `station-cat-content` bucket to exist.
