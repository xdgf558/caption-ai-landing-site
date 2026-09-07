# Signal Articles Publishing

The Signal landing pages now present manually curated X Articles. This change does not connect a paid X API, run account scraping, publish real articles, change commerce rollout, or deploy automatically.

## Publishing

Open `/admin/articles/` from the **文章** link in Admin. Paste an X Article URL, fill in its title and summary, optionally upload a cover, then preview and publish. Drafts and published articles remain editable; **下架** removes an article from public pages without deleting its history.

**识别链接** is best effort. It requests only the normalized public X URL, with no credentials or redirects, a six-second timeout and a 256 KiB response limit. A login page, challenge, unavailable metadata or network failure leaves manual entry available. It does not extract the full article or download its cover. Metadata suggestions never overwrite fields already filled in.

The optional **站内正文** field accepts the existing safe Signal Markdown format (headings, paragraphs and lists; raw HTML is escaped). Without a body, the public article card opens X directly. With a body, it opens a local reading page and retains the original X link. Readers do not need a Station Cat account. Publication dates are website publication dates, not inferred X publication dates.

All four interface languages show the manually published collection with each entry's original language marked. Content is not automatically translated. A local reading page uses the entry's own language URL. Local full-text pages have Article JSON-LD and enter the sitemap; link-only detail URLs are `noindex, follow` and excluded from the sitemap.

## Boundaries

- Accepted URLs: `https://x.com/i/article/<id>` and `https://x.com/statiocat/status/<id>` for posts sharing Articles. Twitter/www aliases normalize to x.com; query strings and fragments are removed. Credentials, non-HTTPS, other hosts/accounts and arbitrary paths are rejected.
- A sharing-post link cannot prove it is an Article, and an `/i/article/` URL cannot prove its author. The administrator confirms that it is their long article. Equivalent sharing-post and article URLs cannot be deduplicated across different IDs without additional metadata; reuse the same canonical link.
- Same normalized link + language cannot be created twice. Saved link and language are immutable; changing them requires a new entry.
- Title: 240 characters. Summary: 1,200. Optional body: 120,000. JSON requests are stream-bounded to 520,000 bytes. Covers use the existing 5 MiB image upload limit; multipart requests are stream-bounded to 6 MiB before parsing. SVG is not accepted.
- Existing `/admin/*` Access authentication and private response headers apply. Writes also require same-origin Origin. No public write route or new credential is introduced.
- Existing `content_entries`, `content_revisions`, `admin_audit_logs` and R2 storage are reused; no database migration is required. Articles use `source_kind = x_article`. Version-token compare-and-swap rejects stale edits. Unique R2 keys preserve the live body and older revisions if a competing save loses. Failed or abandoned uploads can leave unused R2 objects; garbage collection is not part of this change.
- The generic legacy content editor is an advanced administrative path and does not use this simplified editor's version token. Avoid editing the same article through both interfaces at once.
- Historical brief URLs remain unchanged. `/signal/?view=archive` (and localized equivalents) retains the previous archive presentation. Existing collection configuration and cron are not changed; collected briefs appear only in the archive, not as new Articles.
- Sitemap caches can delay newly published full-text URLs by up to one hour, as before. The public article list itself is dynamically generated.

## Local Verification

Run `npm test` and `npm run build`. `scripts/test-signal-articles.mjs` exercises the real Worker handlers with temporary SQLite and in-memory R2: URL validation, Origin, preview escaping, drafts, duplicate links, concurrent edits, immutable revision bodies, publication/unpublication, archive preservation, sitemap visibility and uploads.

For local UI review, run `node scripts/serve-article-preview.mjs` and open `http://127.0.0.1:4179/admin/articles/` or `/signal/`. This binds only to localhost, uses disposable example content, and never connects to production D1/R2. Link metadata recognition intentionally returns the manual fallback in this local preview. Stop/restart clears preview edits.

Before production release, review desktop/mobile publishing, cover upload, preview, draft reload, conflict error, withdrawal and legacy navigation. No real article should be published as part of deployment without separate approval.

`npm run test:browser:articles` runs the dedicated Chromium workflow and 390/1280px layout checks with an isolated preview on port 4183. It is separate from the game's browser suite and does not reuse the interactive preview's content. In this implementation session, the equivalent manual publishing workflow and mobile layout were checked through the in-app browser; the standalone Playwright suite awaits permission to execute.
