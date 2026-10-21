# YouTube clips — 1.0.1 companion API (2026-10-21)

Status: local development only. No production clip, website deployment, database migration or service activation is part of this change. The owner has no first-batch URLs yet; published content stays empty. Pair with the iOS `codex/youtube-shorts-1.0.1` candidate 1.0.1 (14). Publish the reviewed website API before distributing that client.

## Admin and storage

Choose **作品内容 → 视频 → 播放来源 → YouTube 短片**. Paste one HTTPS Shorts/watch/youtu.be URL, enter the title/summary, and confirm display rights plus embedding enabled. This is an operator assertion, not a server verification that YouTube will play it. Saving creates a draft; preflight, publish, unpublish, scheduled publication and rollback use the existing revision/concurrency/idempotency flow. Changing the URL clears the form confirmation. The usual local video/poster fields are disabled in this mode.

The ID and confirmation live in `station_clip_revisions.metadata_json.youtube` beside the revision's existing metadata. Only the validated 11-character ID is retained; sharing query identifiers are discarded. Local media/poster/duration/subtitles must be empty. No migration, video upload, remote fetch, thumbnail proxy, MP4 extraction or credential is introduced. Parent publication and rights checks remain in preflight; parent removal/unpublication hides the clips.

## Explicit compatibility contract

`GET /api/station/content/tracks/{canonical-slug}/clips?locale=zh-Hans&include=youtube` returns the existing file clips and new YouTube references under the existing no-store policy. Pagination and maximum counts are unchanged. A YouTube item adds `provider: youtube`, `youtubeVideoId`, `watchUrl` (canonical HTTPS watch URL). `mediaUrl`, `posterUrl`, and `durationMs` are null; the existing clip ID, track identity, revision, title, summary and publication metadata remain.

Omitting `include` preserves the old file-only result. Global `/clips`, homepage and promotion selection remain file-only; invalid or duplicate `include` values fail closed. The web player is not silently handed an unsupported DTO. Internal rights confirmation, storage keys and original sharing parameters are never returned.

## Local validation

- `npm run test:redesign:clips`: 35 passed, including real temporary Miniflare/D1 create/replay/draft/publication/unpublication/rollback/parent withdrawal, strict URL validation, admin publish eligibility and old-client filtering. Test IDs are synthetic; no YouTube call occurs.
- `npm run test:redesign:content-admin`: 142 passed.
- `npm run test:redesign:public`: 64 passed.
- `npm run test:music:staging`: 22 passed; full `npm test` exited 0 after the explicit staging import allowlist correction.
- `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build`: 185 pages plus postbuild passed. This intentionally incomplete local content build is not a production deployment package.

Raw logs and temporary DBs stay outside version control. Initial [hosted run 39540369197](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/39540369197) at `8170d4f9a024398edadad4b7e1c7c5d54e641d7f` failed in `Run tests`: the staging module-graph allowlist omitted the newly imported pure `redesign/youtubeClip.js` helper. The fix lists only that module, preserving graph traversal and external-import restrictions; local staging and full npm tests pass. The original failure log digest is retained in `verification.json`; the new head still requires a complete hosted run. Real operator URLs, actual HTTPS publication-to-device playback and embedding/region/age restrictions need separate acceptance before distribution.

## Privacy and release boundary

The new iOS player makes an explicit third-party connection only after a tap. It uses the official YouTube iframe, keeping branding, controls and advertisements intact. The website does not add telemetry for these clicks. Before distributing 1.0.1, review and publish a YouTube-specific privacy-policy update and review the Apple privacy answers against actual provider handling; the current 1.0 policy/questionnaire are not silently changed here. Nonpersistent WebView storage and youtube-nocookie do not mean Google receives no data.

References: [official iframe API](https://developers.google.com/youtube/iframe_api_reference), [embedded player identity and controls](https://developers.google.com/youtube/terms/required-minimum-functionality), [Google privacy](https://policies.google.com/privacy).
