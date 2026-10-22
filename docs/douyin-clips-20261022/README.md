# Douyin clip source — development only

2026-10-22. The owner requested Douyin link integration while explicitly postponing deployment until the submitted iOS 1.0 release is live. This branch extends the merged YouTube implementation; it does not deploy either provider, publish clips, or change the pending Apple submission. No real Douyin links were supplied for this task.

## Admin workflow and API

In the existing clip editor, select **抖音**, associate the clip with its song, and enter a single-video URL. Supported canonical forms are `https://www.douyin.com/video/<id>` and `https://www.iesdouyin.com/share/video/<id>/`. Known bounded share fields can be stripped during normalization; arbitrary parameters, encoded path aliases, credentials, ports, fragments, profile/live URLs and non-HTTPS origins are rejected. Video IDs are 16–20 ASCII digits stored as strings, never rounded JavaScript numbers.

For `https://v.douyin.com/<code>/`, the **解析抖音链接** button calls the authenticated, same-origin admin endpoint `POST /admin/api/music/site-content/clips/resolve-douyin`. It requires a publisher role in addition to the existing admin session, request-origin and mutation-header checks. The editor role is rejected before resolution and cannot use the resolve button. Both slash-terminated and non-slash short URLs are accepted; the existing bounded share-field allowlist is stripped before the request. Unknown fields, duplicate fields and unsafe values still require the publisher to copy a canonical video URL instead. Resolution is a single six-second attempt with at most three manual redirects between explicitly supported Douyin hosts/paths. It forwards no cookies or authorization, cancels response bodies without reading HTML or media, rejects arbitrary/relative redirect targets, and does not save the submitted share URL to the mutation journal or database. It returns a canonical video identity and `playabilityVerified: false`. Challenge pages and unsupported redirects require the editor to supply the canonical URL instead. No scraping or media extraction fallback exists.

Parsing an identity does not prove embedding availability or rights. The publisher must confirm the display rights and check the actual video before saving/publishing. Only the normalized ID and explicit manual confirmation enter revision metadata. Switching source creates a new draft under the existing revision/idempotency workflow. Local media, YouTube and Douyin sources are mutually exclusive. The clip list labels Douyin as manually confirmed, not server-verified playback.

The track-clips endpoint accepts the explicit values `include=youtube`, `include=douyin`, `include=youtube,douyin` or `include=douyin,youtube` (a unique provider set, independent of order). Default clients and existing website pages continue receiving only first-party clips. Existing YouTube clients do not receive Douyin items. Unknown/duplicate options fail closed. A Douyin DTO contains `provider`, `douyinVideoId`, canonical `watchUrl`, clip revision and parent identity, with `mediaUrl`, `posterUrl` and `durationMs` null. It exposes no share tokens, iframe HTML, object keys or local download URL. The current public song and clip revisions are revalidated; draft, revoked and removed-parent records stay unavailable. External clips cannot be referenced by the existing website/home first-party players.

No migrations, bindings, production/native flags, logging configuration, effective privacy pages or Apple questionnaire are changed.

## Local verification

The new suite uses synthetic video IDs, actual isolated Miniflare/D1 state, and a fake transport for third-party redirects. It covers source normalization, mutually exclusive payloads, protected admin requests, short-link deadline/redirect/identity boundaries, publication/edit/replay/rollback/revocation, current-parent checks and old-client compatibility. There are no requests to actual Douyin videos.

The final command/results and toolchain are recorded in `verification.json`. The admin regression and staging import gate also passed. `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` produced 185 pages with postbuild checks; this is an empty-private-novel **local validation build**, not a production package. The ordinary build correctly refused to proceed without private novel source directories.

The iOS companion requests `include=youtube,douyin` and checks the official embed API only after a user tap. Its player uses [Douyin's official iframe endpoint](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/iframe-player/get-iframe-by-video); this website change does not call that API or claim real playback validation.

## Deferred release

After 1.0 is formally live, review and explicitly authorize a new deployment. Recheck this API alongside the deployed cover/cache and effective privacy overlays; a build from current repository main alone is not the existing production artifact. In particular, preserve the L29/L31 cover variants and L30 effective privacy pages. Deploy the reviewed website API before distributing iOS 1.0.2 (15). An older API rejects the new include option and the client shows a retry state.

Before publishing actual clips or distributing the client, obtain owner-supplied links, check rights and official embedding, verify real HTTPS playback/region/account/sound behavior on an iPhone, and review the third-party privacy disclosure. Synthetic local tests do not establish those results. No deployment, content publication, signing, installation or upload was performed in this task.

## Review follow-up

The review of `e21e2b8` identified three P3 hardening items. Publisher-only resolution, optional short-link trailing slashes with bounded attribution stripping, and order-independent provider selection are now covered by regressions. Unknown share parameters remain intentionally rejected; this change does not infer permission to follow arbitrary hosts or forwarding parameters. The prior head passed hosted CI run `39714452378`; that result is not evidence for the follow-up commit.
