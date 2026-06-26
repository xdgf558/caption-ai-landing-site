# NovelForge Import API 8A

Stage 8A implements the minimum website-side API needed by NovelForge AI for one-click publishing into the Station Cat backend content platform.

The implementation follows the NovelForge contract file:

```text
/Volumes/AI作品素材/软件开发/AI小说生成器/docs/station-cat-publish-api-contract.md
```

## Endpoint

Production API Base URL:

```text
https://wwwstationcat.org
```

Import endpoint:

```http
POST /api/novelforge/import
Authorization: Bearer <NOVELFORGE_PUBLISH_TOKEN>
Content-Type: application/json
X-NovelForge-Contract: station-cat-novelforge-import.v1
```

NovelForge may normalize any of these user-entered base URLs to the same endpoint:

```text
https://wwwstationcat.org
https://wwwstationcat.org/api/novelforge
https://wwwstationcat.org/api/novelforge/import
```

## Secret

Configure the production publish token as a Cloudflare Worker secret or environment variable:

```text
NOVELFORGE_PUBLISH_TOKEN=<strong random token>
```

This endpoint is not protected by Cloudflare Access because it is a machine-to-machine API. It must reject missing or invalid tokens with `401`.

## Request Contract

The request body must use:

```json
{
  "contract": "station-cat-novelforge-import",
  "contractVersion": 1,
  "mode": "draft",
  "publishPackage": {
    "format": "novelforge-standard-publish-package",
    "version": 1
  }
}
```

Supported `changedItems[].localType` values:

- `project`: imports or updates the novel series metadata.
- `cover`: updates cover metadata on the series.
- `chapter`: imports or updates a chapter body.

If `changedItems` is omitted and `onlyChanged` is `false`, the Worker expands the full `publishPackage.project`, `publishPackage.cover`, and `publishPackage.chapters` payload into import items.

## Import Behavior

- `mode: "draft"` saves imported series and chapters with `status: "draft"`.
- `mode: "publish"` saves imported series and chapters with `status: "published"`.
- Project metadata is saved as `content_entries.entry_type = "novel_series"`.
- Chapter text is saved as `content_entries.entry_type = "novel_chapter"`.
- Markdown and rendered HTML bodies are stored in `CONTENT_BUCKET`.
- D1 stores metadata, status, visibility, access level, revision rows, import rows, and audit logs.
- Existing entries are found by remote ID first, then by `{entryType, locale, parentSlug, slug}`.
- Existing `access_level`, `visibility`, and `pricing_json` are preserved.
- NovelForge `pricingSuggestion` is saved only under `metadata.novelforge.pricingSuggestion`; Admin 2.0 remains the source of truth for live pricing.

## Success Response

```json
{
  "ok": true,
  "remoteBookId": "work_123",
  "previewUrl": "https://wwwstationcat.org/admin-v2/?contentId=123",
  "publishUrl": "https://wwwstationcat.org/novel/novel-slug/",
  "message": "Imported as draft.",
  "items": [
    {
      "localType": "project",
      "localId": "project_1",
      "remoteId": "work_123",
      "status": "created",
      "message": "Project metadata imported."
    },
    {
      "localType": "chapter",
      "localId": "chapter_1",
      "remoteId": "chapter_456",
      "status": "created",
      "message": "Chapter imported."
    }
  ],
  "requestId": "novelforge:project_1:abcdef1234567890",
  "remoteIds": {
    "cover": "cover_123",
    "project": "work_123"
  }
}
```

## Error Response

```json
{
  "ok": false,
  "error": {
    "code": "NOVELFORGE_TOKEN_INVALID",
    "message": "Invalid publish token."
  },
  "errors": []
}
```

Common error codes:

- `NOVELFORGE_TOKEN_NOT_CONFIGURED`: the production secret is missing.
- `NOVELFORGE_TOKEN_INVALID`: the Bearer token is missing or invalid.
- `NOVELFORGE_CONTRACT_HEADER_UNSUPPORTED`: `X-NovelForge-Contract` is not supported.
- `NOVELFORGE_CONTRACT_UNSUPPORTED`: request `contract` or `contractVersion` is unsupported.
- `NOVELFORGE_PACKAGE_UNSUPPORTED`: publish package format or version is unsupported.
- `NOVELFORGE_PROJECT_REQUIRED`: `publishPackage.project` is missing.
- `CONTENT_TABLES_NOT_READY`: D1 content tables are unavailable.

## URL Rules

Preview link:

```text
https://wwwstationcat.org/admin-v2/?contentId={content_entries.id}
```

The Admin 2.0 page reads `contentId` on boot and opens the imported item for review.

Publish link:

```text
https://wwwstationcat.org/novel/{seriesSlug}/
```

Novel publish links now use the V2 reader entry without a locale prefix. Older `/works/` links remain compatibility redirects.

## Remote ID Rules

NovelForge should persist the returned remote IDs and send them back in future `changedItems[].remoteId`.

Series remote ID:

```text
work_{content_entries.id}
```

Chapter remote ID:

```text
chapter_{content_entries.id}
```

Cover remote ID:

```text
cover_{series_content_entries.id}
```

Accepted legacy aliases for future updates:

```text
content_entry:{id}
novel_series:{id}
novel_chapter:{id}
work_{id}
chapter_{id}
cover_{id}
```

## Production Verification

1. Configure `NOVELFORGE_PUBLISH_TOKEN` in Cloudflare.
2. Send a `draft` import request with one project and one chapter.
3. Confirm the response returns `ok: true`, `remoteBookId`, `previewUrl`, `publishUrl`, and item `remoteId` values.
4. Open `previewUrl` through Cloudflare Access and confirm Admin 2.0 loads the imported item.
5. Confirm the series and chapter appear in Admin 2.0 as drafts.
6. Confirm pricing remains unchanged until edited in Admin 2.0.
7. Send a second request with returned remote IDs and changed text; confirm the same entries are updated instead of duplicated.
