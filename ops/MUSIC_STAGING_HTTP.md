# Isolated music staging HTTP workflow

This runbook describes the code and operator procedure. Keep execution reports,
deployment snapshots, counters, backups, session state and acceptance evidence
outside the repository, including sanitized reports. Do not attach them to a PR.

## Request and identity boundaries

The existing staging host and administrator allowlist protect every route with
Cloudflare Access before any music or identity binding is used. Public read routes
reuse the normal catalog, media and rate-limit handlers. Access authorization does
not grant music VIP access; each full-audio request still checks reader eligibility.

`MUSIC_STAGING_MEMBERSHIP_DB` binds a separate synthetic identity database. Its
migration directory contains only the three tables used by the existing membership
reader. Never apply those migrations to a production reader database. The staging
adapter consumes only `station_cat_music_staging_session`, strips incoming cookies,
and translates that opaque token for the shared reader. Production reader cookies
cannot supply staging identity. Responses are private, uncached and marked noindex.

The staging configuration enables Access-protected public reads and VIP delivery.
Uploads, analytics and cleanup execution remain disabled. There is no seed, login,
debug or IP-override HTTP endpoint, and no fixture Worker may be deployed.

The checked-in configuration is the later read-acceptance configuration. For every
schema migration or maintenance deployment, first run
`npm run build:music:staging-maintenance-config` and deploy only the generated,
ignored `.generated/music-staging-maintenance.jsonc`. The generator asserts the
isolated target and forces public, uploads, VIP delivery, analytics and cleanup to
false; never use the checked-in public/VIP values during a maintenance window.

Run `npm run build:music:staging-assets` before deployment. The build copies only
the four music administration pages, the four localized music pages and their
recursive static dependencies. Its checker fails if a copied dependency is absent
or blocked by the Worker gate. The exact page list and rollback contract are in
[M6_STAGING_SURFACES](../docs/music/M6_STAGING_SURFACES.md).

## Operator preparation

Use `cloudflared access login --quiet` for the configured staging application.
Save the application's `cloudflared access token` output to a private mode-600 file,
then set `MUSIC_STAGING_ACCESS_TOKEN_FILE` to that path. Also set
`MUSIC_STAGING_WRANGLER_CLI` to the installed Wrangler entrypoint and
`MUSIC_STAGING_RECORD_DIR` to a private directory outside the repository.

The local helper pins the staging host, account, databases and bucket. It passes
HTTP credentials through temporary private header files and never follows redirects.
Do not import this helper into deployed code. A token or transport failure must be
investigated without automatically retrying an uncertain upload.

Before migrations or initial samples, deploy the guarded entrypoint with all five
music flags closed and
confirm that catalog/audio return `MUSIC_PUBLIC_DISABLED` without counter changes.
In an explicitly authorized fixture window, keep public reads closed and temporarily
enable uploads. `node ops/seed-music-staging-http.mjs` requires an empty catalog for
a new run and permits only a 1 MiB test quota. It uses checked-in synthetic MP3s, a
solid-color PNG and plainly labelled test text. Uploads and binary validation use
the real admin APIs; recovery queries status/completion rather than repeating PUT.

The catalogue seed is a synthetic read-path fixture. It deliberately creates no
approved rights record or fictitious Suno generation/download facts. Its metadata
and immutable audit entry identify this scope. It does not validate commercial
rights, listening review or the production publication workflow. Completed uploads
and their charges must remain; do not hand-delete sessions or objects to reset tests.

## Bounded checks and restoration

After sample preparation, disable uploads and enable only the Access-protected
public/VIP reads. Run these local commands individually:

- `node ops/check-music-staging-http.mjs smoke`: catalog, collection, artwork,
  lyrics, preview, full audio, HEAD/Range and synthetic identity cases.
- `node ops/check-music-staging-http.mjs revocation`: revoke/expire a synthetic
  identity after successful access and verify subsequent audio denial.
- `node ops/check-music-staging-http.mjs fault`: temporarily fail the global rate
  update, verify 503 and atomic rollback, and remove the trigger in `finally`.
- `node ops/check-music-staging-http.mjs limits`: with temporary source/global
  limits of catalog 4/8, artwork 4/4 and audio 4/8, check forged source headers and
  three bounded groups of twelve concurrent requests. Cloudflare front-layer
  rejection and application admission are separate assertions.
- `node ops/check-music-staging-http.mjs counting`: in the same low-limit
  configuration, verify that GET, HEAD and 304 each consume one source slot.
- Restore the checked-in default limits, then run
  `node ops/check-music-staging-http.mjs finish`. It revokes synthetic sessions,
  verifies that fault triggers are absent, clears only the isolated test counters,
  and checks retained uploads, charges and foreign keys.

These mutation/fault modes are explicit maintenance operations, not routine health
checks. Do not run them alongside unrelated staging use. All generated state and
reports stay in the private local record directory; do not publish their contents.
Short HTTP bursts do not establish sustained cross-region load, Worker isolate
coverage, physical-device playback or cloud disaster recovery readiness. Production
deployment and formal content approval remain separate decisions.
