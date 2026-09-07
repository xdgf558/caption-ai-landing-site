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
- Shared persistence rejects legacy writes to an existing `x_article` with HTTP 409 (`ARTICLE_EDITOR_REQUIRED`) and an `editUrl` of `/admin/articles/`. It checks before body upload and again in the atomic UPSERT condition, so a stale preflight cannot bypass source isolation. Legacy payloads cannot opt into the article writer by submitting a source kind or version token. Generic content selectors and legacy brief lists exclude articles at query time; only the dedicated article editor can update them.
- Historical brief URLs remain unchanged. `/signal/?view=archive` (and localized equivalents) reuses the original listing helper, including `public`/`unlisted` visibility and `featured`/`sort_order` ordering, with only articles excluded. Previous/next links stay within legacy briefs. Existing collection configuration and cron are not changed; collected briefs appear only in the archive, not as new Articles.
- Sitemap caches can delay newly published full-text URLs by up to one hour, as before. The public article list itself is dynamically generated.

Enter in a title or URL field saves a draft (or saves an already-published entry without changing its status). Publishing an unpublished entry requires the explicit **发布文章** button. Filtering or paging with unsaved edits asks for confirmation and retains the editor contents; cancellation restores the prior list filter.

Canonical URLs retain only content-defining query parameters: article page 1 uses `/signal/`, subsequent pages use `?page=N`, and the legacy collection uses `?view=archive`. Localized equivalents follow the same rule. Tracking and other unused query parameters are omitted. Archive currently retains its existing single-page, 50-entry listing; its canonical therefore does not include pagination. HEAD skips article-card rendering. Malformed article source links are skipped rather than breaking the collection.

## Article Share Cards

Published article rows and reading pages provide a localized **分享卡片 / Share card** action. The browser generates a 1080 x 1440 PNG containing the Station Cat logo, title, summary, website publication date and QR code. It supports image download, long-press image saving, copying the canonical URL, and native file sharing when the browser supports it. WeChat destination selection is controlled by the operating system; this is not a WeChat SDK integration and does not automatically post to Moments or groups.

QR codes use the existing `qrcode-generator` dependency and point to the fixed `https://wwwstationcat.org` canonical article URL without tracking parameters. Link-only articles point to their existing website wrapper with the X original link; they remain `noindex` and excluded from the sitemap. Published text only is embedded into escaped button metadata. No article is published, no content write/API credential is added, and no server-side PNG generation is required. The legacy brief card endpoints remain unchanged. Downloaded images are snapshots and cannot be recalled when an article changes or is withdrawn.

PNG generation handles long mixed-language text, preserves a four-module QR quiet zone, and falls back to text branding if the logo cannot load. Closing a dialog invalidates pending generation and revokes its object URL. Copy permission failures retain a selectable URL; native-share failures retain image saving. `scripts/article-browser-tests/share.spec.mjs` checks the actual PNG dimensions and QR pixels, copy/download, native file-share payload, link-only wrappers, focus restoration, failure/retry, long text, and 390/1280px layout. Native WeChat and iOS long-press saving still require a real-device acceptance check.

## Local Verification

Run `npm test` and `npm run build`. `scripts/test-signal-articles.mjs` exercises the real Worker handlers with temporary SQLite and in-memory R2: URL validation, Origin, preview escaping, drafts, duplicate links, concurrent edits, immutable revision bodies, publication/unpublication, archive preservation, sitemap visibility and uploads.

For local UI review, run `node scripts/serve-article-preview.mjs` and open `http://127.0.0.1:4179/admin/articles/` or `/signal/`. This binds only to localhost, uses disposable example content, and never connects to production D1/R2. Link metadata recognition intentionally returns the manual fallback in this local preview. Stop/restart clears preview edits.

Before production release, review desktop/mobile publishing, cover upload, preview, draft reload, conflict error, withdrawal and legacy navigation. No real article should be published as part of deployment without separate approval.

`npm run test:browser:articles` runs the dedicated Chromium workflow and 390/1280px layout checks with an isolated preview on port 4183. It is separate from the game's browser suite and does not reuse the interactive preview's content. CI now runs this suite after the normal build. Regression coverage includes Enter retaining draft status, explicit publication, both legacy writes returning 409, legacy selectors excluding articles, dirty-list navigation, cover upload, preview, stale edits and withdrawal. The suite has been executed locally successfully, alongside `npm test` and the production build.
