# Stage 7D: Dynamic Frontend Content Reads

Stage 7D connects Admin 2.0 content to the public site without requiring a rebuild for routine new Blog/Devlog posts or serial fiction updates.

## What Changed

- Public content metadata remains in D1 `content_entries`.
- Public free bodies are read from `CONTENT_BUCKET` using the stored HTML key first, then Markdown as a fallback.
- Static Astro index pages keep their existing content and fetch backend-published entries through `/api/content/entries`.
- Backend-only Blog and serial detail URLs are rendered by the Worker before the static asset fallback.
- Protected backend chapter pages render a gate first, then load paid body HTML through `/api/novels/chapters/protected-content` after entitlement checks.

## Public APIs

```text
GET /api/content/entries?entryType=blog_post&locale=zh-Hant
GET /api/content/entries?entryType=novel_series&locale=zh-Hant
GET /api/content/body?type=blog_post&locale=zh-Hant&slug={postSlug}
GET /api/content/body?type=novel_chapter&locale=zh-Hant&series={seriesSlug}&chapter={chapterSlug}
```

`/api/content/body` only returns body HTML for `accessLevel: "free"`. Protected chapter text must continue through the reader session and entitlement-protected endpoint.

## Dynamic Routes

The Worker can render backend-published detail pages for:

```text
/devlog/{postSlug}/
/{locale}/devlog/{postSlug}/
/works/{seriesSlug}/
/works/{seriesSlug}/{chapterSlug}/
/{locale}/works/{seriesSlug}/
/{locale}/works/{seriesSlug}/{chapterSlug}/
```

Index pages remain static and load backend additions client-side. This avoids hiding legacy Markdown content before Stage 7G imports the old files into D1/R2.

## Static Fallback

If D1 content tables are missing, no matching backend entry exists, or the backend entry is not published/public, the Worker returns `null` and lets `env.ASSETS.fetch(request)` serve the existing static Astro page.

This is intentional. Stage 7D should be reversible by unpublishing backend entries or removing the D1/R2 bindings without breaking the existing site.

## Current Product Boundary

- `member` access currently maps to the same entitlement path as `paid` because the existing `novel_entitlements` model supports `paid`, `supporter`, and `all`.
- Backend index content is appended to static pages, not merged server-side with old Markdown content.
- Legacy Markdown migration remains Stage 7G.
- Full backend pricing consumption remains Stage 7E.
- Fuller order/account/entitlement management remains Stage 7F.

## Deployment Verification

After deployment:

1. Publish a test Blog post from `/admin-v2/` with `status: published`, `visibility: public`, and `accessLevel: free`.
2. Confirm the matching Devlog index still shows static posts and appends the backend test post.
3. Open `/devlog/{postSlug}/` or `/{locale}/devlog/{postSlug}/` and confirm the Worker renders the backend body.
4. Publish a test serial and a free chapter from `/admin-v2/`.
5. Confirm the serial appears on the matching works index without hiding legacy serials.
6. Open the backend-only series and chapter URLs.
7. For a paid chapter, confirm unauthenticated readers see the gate and authenticated entitled readers can load the protected body.
