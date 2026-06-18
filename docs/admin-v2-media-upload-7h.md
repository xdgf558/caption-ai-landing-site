# Stage 7H: Admin 2.0 Media Upload

Stage 7H adds cover image upload to Admin 2.0 and keeps all routine authoring work centered in the new backend content platform.

## What Changed

- Admin 2.0 has a cover image picker, upload button, R2 key field, alt text field, and live cover preview.
- Uploads go to `CONTENT_BUCKET`; no new database migration is required because `content_entries.cover_r2_key` and `content_entries.cover_alt` already exist.
- Public content JSON includes `coverUrl` when an entry has a safe R2 media key.
- Dynamic Blog / serial cards and dynamic Blog / serial detail pages render cover images when available.

## R2 Key Convention

Uploaded cover images use:

```text
content/media/covers/{yyyy}/{mm}/{slug}-{timestamp}-{token}.{ext}
```

Supported image types:

```text
image/jpeg
image/png
image/webp
image/gif
image/avif
```

Maximum upload size is 5MB.

## Worker Routes

Admin upload route:

```text
POST /admin/api/content/media
```

The route accepts `multipart/form-data`:

```text
file: image file
mediaKind: covers
slug: content slug
title: content title
```

Successful response:

```json
{
  "ok": true,
  "media": {
    "key": "content/media/covers/2026/06/example-1780000000000-abcdef123456.webp",
    "url": "/api/content/media?key=content%2Fmedia%2Fcovers%2F2026%2F06%2Fexample-1780000000000-abcdef123456.webp",
    "contentType": "image/webp",
    "size": 123456
  }
}
```

Public read route:

```text
GET  /api/content/media?key={r2Key}
HEAD /api/content/media?key={r2Key}
```

The read route only serves safe keys under `content/media/`.

## Admin Flow

1. Open `/admin-v2/` through Cloudflare Access.
2. Create or edit a Blog, novel series, or chapter.
3. In the Media panel, choose a cover image.
4. Click `上传封面`.
5. Confirm the preview appears and `Cover R2 Key` is filled.
6. Save the content entry.
7. Open the public Blog / serial page and confirm the cover renders.

## Security Notes

- `POST /admin/api/content/media` must stay protected by Cloudflare Access with the rest of `/admin/api/content/*`.
- The public read route validates that the key is a safe `content/media/` key and does not allow `..`, backslashes, double slashes, or unsafe characters.
- Uploads are written with immutable cache metadata; public media reads include `x-content-type-options: nosniff`.
- Upload actions write `admin_audit_logs` when the D1 content tables are available.

## Review Checklist

1. Run `npm run build`.
2. Run `npx --yes wrangler@latest deploy --dry-run`.
3. Upload a small cover in `/admin-v2/` on a protected environment.
4. Save the entry and reload it to confirm the key and preview persist.
5. Confirm `/api/content/entries` returns `coverUrl`.
6. Confirm the public dynamic Blog / serial card and detail page render the cover.
