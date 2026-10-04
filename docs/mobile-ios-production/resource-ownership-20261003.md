# Cloudflare resource ownership: read-only platform check

Checked on **2026-10-03**, between **12:20 and 12:50 UTC** (20:20–20:50 Asia/Singapore). This is an observation of existing platform resources and deployed bindings, not approval to activate native production services.

## Method and evidence boundary

The repository does not install Wrangler. This check reused the already-cached **Wrangler 4.131.1**, matching the version recorded for the earlier R2 setup; no package installation or upgrade was performed. Command syntax was checked against that executable's help. `whoami --json` confirmed an existing **OAuth Token** session and account **`3f5394e0ef5a531c63c0ceaa74262e0d`**. The account was then explicitly selected for resource and version queries.

The evidence below comes from authenticated Cloudflare control-plane reads: `d1 list --json`, `r2 bucket list`, `deployments list --name … --json`, `versions view … --name … --json`, `r2 bucket dev-url get …`, and `r2 bucket domain list …`. Output was filtered in memory before display: no credentials, email addresses, secret values, other environment values, object keys, database rows or request logs are included. Resource-detail CLI debug logging was discarded. No SQL query/export, object read, migration, marker write, deployment, binding change or feature enablement was performed.

These platform observations establish that the resources are visible in the selected Cloudflare account and that the observed deployed versions bind their stated resource IDs/names. They are stronger evidence than a self-written marker. They do **not** establish legal ownership of every stored record, correctness of its schema/data, exclusive access, historical access, or future resource identity after a deployment. Existing local/remote marker contents were neither read nor used as proof.

## Account resources and actual bindings

| Role | Platform resource | Platform identity | Binding observed in deployed Worker |
| --- | --- | --- | --- |
| Production reader D1 | `station-cat-waitlist` | `c4a8cb1a-6a94-4e8f-a6fb-a734afafca63` | `caption-ai-landing-site` → `WAITLIST_DB` |
| Production music D1 | `station-cat-music-production` | `876b9acd-fee6-4919-8c50-4ea6f7ab9372` | `caption-ai-landing-site` → `MUSIC_DB` |
| Production private audio bucket | `station-cat-music-production-private` | Created `2026-09-13T12:10:35.255Z` in the account above | `caption-ai-landing-site` → `MUSIC_BUCKET` |
| Isolated reader D1 | `station-cat-music-r2-reader` | `254cd4bd-49e3-4459-8d68-5c9995e8465f` | `station-cat-music-r2` → `WAITLIST_DB` |
| Isolated music D1 | `station-cat-music-r2-catalog` | `19595ea0-7359-4ab3-b168-d82247edefa5` | `station-cat-music-r2` → `MUSIC_DB` |
| Isolated private audio bucket | `station-cat-music-r2-audio` | Created `2026-09-21T23:54:14.291Z` in the account above | `station-cat-music-r2` → `MUSIC_BUCKET` |

Both D1 pairs have distinct IDs. The production music ID is also distinct from existing music staging IDs `8fe1a3e1-7325-4d87-a7e6-2c51338b9158` and `cb7bbad3-bfbb-457d-b2f2-6fd3b02df651`, which were present in the same fresh D1 list. The account currently returned ten D1 resources; no database was created, repurposed or deleted.

For **both** music buckets, the fresh platform queries returned **r2.dev public access disabled** and **no connected custom domains**. This confirms those two public-bucket exposure settings; it is not an audit of every Worker route, S3 credential or other principal capable of reading the buckets.

The first R2 bucket-list request reached the local 55-second command deadline. One subsequent read succeeded. The timeout was not treated as evidence that a bucket was missing. The remaining resource lists, version details and public-access checks completed successfully.

## Deployed versions and visible switches

`deployments list` returned the following latest entries by creation time; each assigned **100%** to one version. `versions view` then supplied that exact version's binding metadata.

| Worker | Deployment ID and creation time | Version ID |
| --- | --- | --- |
| `caption-ai-landing-site` | `038582b5-b641-4780-addb-e3b5d8f4e280`, `2026-09-16T10:58:22.445582Z` | `67d6e6b0-42f5-4696-8ed5-bc1096a49ebf` |
| `station-cat-music-r2` | `a24699d6-39bb-4663-a150-81f36ce4c24e`, `2026-09-24T15:12:10.615396Z` | `114ef63a-cc1a-4c78-af0f-9fade8983d74` |

For the website version, the inspected plain-text switch allowlist showed `MUSIC_PUBLIC_ENABLED=true` and `MUSIC_VIP_DELIVERY_ENABLED=true`, consistent with the existing web music service. No `MOBILE_*` value appeared in that plain-text allowlist. This observation must not be misreported as all web music being closed, nor as successful deployment of the new native production implementation. No secret binding values were read; a missing plain-text value alone is not a runtime endpoint test.

For the isolated R2 version, the inspected plain-text metadata showed:

- `MOBILE_ENVIRONMENT=isolated`.
- `MOBILE_AUTH_ORIGIN=https://station-cat-music-r2.yehao1105.workers.dev` and `MOBILE_REDIRECT_URI=https://station-cat-music-r2.yehao1105.workers.dev/auth/mobile/callback`.
- `MOBILE_AUTH_ENABLED`, `MOBILE_MUSIC_ENABLED`, `MOBILE_PERSONAL_SYNC_ENABLED`, `MOBILE_FREE_OFFLINE_ENABLED`, `MUSIC_PUBLIC_ENABLED` and `MUSIC_VIP_DELIVERY_ENABLED` all `true`.

The active website's production music bindings are not present in the repository's base `wrangler.toml`; they are supplied by the existing production candidate workflow. This check records the actual deployed bindings rather than inferring them from that base file. The isolated binding values agree with `wrangler.mobile-r2.jsonc`.

## What remains before production enablement

The resource-account and observed-deployment binding comparison is complete for the named D1/R2 resources at the time above. Any future production candidate must compare **its exact bindings** against a fresh platform observation again; this document cannot authorize a changed deployment. Platform and marker checks serve different purposes and neither replaces the other.

This pass did not inspect production table schemas, install native migrations/markers, verify production key separation, examine platform request logging or retention, perform native production login/playback/personal-sync requests, test production AASA/Apple CDN/OS delivery, or upload an App Store build. Those activation checks remain pending. Local cross-repository tests and the existing isolated R2 deployment do not constitute a live production end-to-end result.

No activation authorization is inferred from this inventory. Production native authentication, catalog delivery, personal synchronization, AASA rollout, account deletion and App Store release remain subject to their separate release checks and explicit enablement decision.
