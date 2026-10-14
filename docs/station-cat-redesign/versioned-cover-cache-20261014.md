# Versioned public cover cache — 2026-10-14

The platform-listening iOS client can reuse cover thumbnails on the device after
their first successful download. This requires the matching website change;
clients must keep revalidating older URLs that still return `max-age=0`.

## Public contract

Public track list/detail projections retain their original `coverUrl` and add
the nullable `coverCacheVersion` field. It is the lowercase 64-character SHA-256
of the current cover source, and is only emitted after the existing ownership,
publication, rights and R2 readiness checks succeed. It is a public image cache
identity, not an audio grant or an account capability.

The controlled image route accepts:

```
/api/station/content/assets/<cover UUID>?size=card&v=<coverCacheVersion>
/api/station/content/assets/<cover UUID>?size=display&v=<coverCacheVersion>
```

`v` requires `size`, cannot be duplicated, must be lowercase 64-character hex,
and must match the current approved cover. Invalid query syntax returns 400;
a no-longer-current version or cover returns 404. Non-cover content cannot use
this image cache contract. Existing URLs and the legacy music/admin routes keep
their existing `private, max-age=0, must-revalidate` behavior.

Only a successfully selected and fetched generated JPEG/WebP derivative gets:

```
Cache-Control: private, max-age=86400, must-revalidate
CDN-Cache-Control: no-store
Cloudflare-CDN-Cache-Control: no-store
```

The versioned 304 path still verifies the current publication, schema, rights,
rate admission, source R2 HEAD, conditional source GET and the generated file's
response. Missing/invalid generated files fall back to the source with
`no-store`, even with a previously valid `If-None-Match`. Errors remain
`no-store`, and reserved generated file paths remain inaccessible directly.

## Freshness and rollout boundary

The 24-hour lifetime permits private device cache hits without another image
request. It does not proactively erase a previously downloaded image when an
operator withdraws it. Fresh directory results remove or replace the cover URL
and version, and the client should use those results to stop displaying an old
cover. Every subsequent resource request still performs all current checks.
This policy only concerns public imagery; playback, membership and personal
library decisions are never cached through it.

Deploy the reviewed website contract before enabling versioned reuse in the
installed client. An older server without this nullable field remains usable,
but does not authorize the new persistent image reuse. No production flags,
bindings, migrations or payment configuration are changed by this implementation.

## Local verification

Six affected test suites passed 81/81 with zero failures or skips: public
content, controlled covers, actual Worker/D1/R2 runtime, derivative generation,
legacy public music and authenticated admin thumbnails. New cases cover
version syntax, non-image rejection, replacement, withdrawal, rights, disabled
gates/schema, R2 replacement/failure, conditional generated-file fallback and
actual Miniflare 200/304 cache headers.

`git diff --check` passed. `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` and its
postbuild checks passed for 181 pages. This checkout lacks private novel source;
the empty-content build is local validation only and must not be deployed.

The current first-launch asset profile was separately built with
`env -u ALLOW_EMPTY_SERIAL_CONTENT npm run build:station:first-launch`. It passed
with `brand-games`, 60 retained HTML files, 126 retired HTML files removed, and
426 total asset files. Its protected-content/payment compatibility manifests
were preserved and matched `origin/main` base `cca4357`. Outputs are under
`.generated/station-first-launch-assets` and
`.generated/station-first-launch-manifest.json`; the report explicitly records
`productionDeployed: false`. This candidate follows the current site's retired
fiction routing and does not fabricate or replace private novel source.

Existing installed dependencies were compared against package-lock version 3:
all 338 present package versions matched exactly, and the 153 absent records
were optional dependencies. Offline direct dependency validation exited 0.
The worktree reuses the existing local dependency directory, without changing
package files or the lockfile.

The local implementation and verification above performed no production mutation or deployment.
The user selected pull-request review before any website deployment or new phone installation.
