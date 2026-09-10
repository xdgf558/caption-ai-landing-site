# M2-ADMIN: management control API

Historical PR #125 slice. Uploads, private asset review, technical approval and real-byte publication are now implemented locally in [M2_PRIVATE_UPLOADS](M2_PRIVATE_UPLOADS.md). The fixed-503 publication statements below describe the earlier slice, not current behavior. Public media delivery and cloud rollout remain pending.

Baseline: PR #124 merged at `9dc86e3`. Branch: `codex/music-admin-api`.
Status: first management-control slice locally implemented and validated; M2 remains IN_PROGRESS.

This is the first reviewable management slice of M2-01/M2-03, not all of M2.
No cloud resources, remote migrations, official uploads, deployment or music launch are authorized by this change.
No new UI: Product Design remains mandatory when M3/M4/M5 UI work starts.

## Routes

All routes live under `/admin/api/music`. Responses are private/no-store with no CORS opt-in.

| Method | Suffix | Behavior |
| --- | --- | --- |
| GET/HEAD | `/status` | Read-only schema/settings readiness, flags and explicit implemented capabilities |
| GET/HEAD | `/tracks` | 50-item list, `before` row cursor, optional `status` and `q` |
| POST | `/tracks` | New private draft; default VIP; no pre-attached assets |
| GET/HEAD | `/tracks/{id}` | Current draft, published edition, rights record and minimal referenced asset metadata |
| PATCH | `/tracks/{id}` | Full replacement draft input, new revision, preserve old published edition |
| PUT | `/revisions/{id}/rights-review` | Pending/blocked/manual approved rights record for the current draft |
| POST | `/tracks/{id}/publish` | Explicit 503 `MUSIC_TECHNICAL_VERIFIER_UNAVAILABLE`; no production verifier fallback |
| POST | `/tracks/{id}/unpublish` | Existing conditional publication transaction; safe with all public flags off |
| POST | `/tracks/{id}/archive` | Only an already unpublished track; retain all revision, asset and audit rows |
| GET/HEAD | `/audit` | 50-item audit list with `before` cursor |

Unknown endpoints, including uploads, asset delivery, technical-review and collections, do not fall through to static files.
The four runtime flags remain default false and are not added to wrangler in this PR.
Even explicitly enabling all flags cannot enable unimplemented uploads or publication.
Metadata administration and taking content offline do not depend on the public delivery flag.

## Security and request contract

- The existing Worker admin gate runs first. Music then derives its actor from a verified Access JWT and the configured email allowlist, never the client email header, a reader account, a forged Host or the local admin bypass flag.
- Actual RSA signature, issuer, audience, expiry and allowlist checks reuse the existing verifier. Local unit tests use ephemeral signing keys and stub only the JWKS transport, not signature verification.
- Writes require exact same-origin `Origin`, `X-Requested-With: StationCatMusicAdmin`, and JSON. Cross-site/same-site Fetch Metadata is rejected. No wildcard origin/CORS, form or text/plain fallback.
- JSON is counted while reading with a 64 KiB cap, strict UTF-8, and a 3-second body-read deadline. Compressed request bodies are rejected. No remote URLs or object keys are accepted for fetching.
- All writes require caller-persisted `Idempotency-Key` (16-128 base64url characters). Existing-item writes also require `If-Match: "edit-N"`. Missing version is 428; stale edit is 409. The successful response has an edit ETag, distinct from media ETags.
- Unknown fields are rejected. Drafts accept `slug`, `metadata`, `policy`, `assets`; PATCH additionally requires the source `revisionId` and `reason`. `assets` contains nullable `audio/preview/cover/lyrics` IDs, not durations, hashes or object locations. Metadata and policy follow the existing publication shapes.
- Rights writes accept `status`, structured `review`, up to 10 unique `evidenceIds`, and `reason`. Actor/time/fingerprint come from the server. Approval validates the existing commercial-use/official-download/UTC/exception contract and same-track validated evidence. It is a manual rights assertion, not independent legal verification or successful audio verification.

## Transactions and immutable history

Creation, save, rights and archive use one D1 batch for conditions, business writes, audit and receipt. Every expected row count is checked with `changes()` and a NOT NULL guard; a zero-row statement rolls back the batch. The helpers do not create/migrate tables.
Receipts are actor/route/key scoped and append-only. A different payload under the same key conflicts. A lost post-commit response or identical race reads the original receipt, never invents a new key. Do not delete receipts as cache just because `expires_at` has elapsed.

PATCH creates a new revision each time, even for unpublished drafts. Old draft/review rows remain for history; they are not the current editable revision. Old published revisions stay sealed and publicly selected until a future successful publish. Slugs cannot change after first publication. New drafts have no carried approval. Rights changes clear technical approval. Neither endpoint accepts an approval fingerprint.

Published-policy version transitions still use M1 policy validation. The free-promise rule is rechecked by the existing publication service when successful publication is eventually wired. Archiving requires unpublish first; it clears active pointers without deleting assets or prior editions. There is no restore/archive-to-publish shortcut in this slice.

## Remaining gates

- M2-02: real private streaming uploads, quota reservation, concurrency leases, terminal sessions and recovery. No placeholder upload endpoint is represented as working.
- Complete resource validator, protected evidence/media reads and real listening confirmation. Technical approval and successful HTTP publish must be added together with those prerequisites. Test proofs never enter production imports.
- M2-03 collections, M2-04 public/VIP media protocol and per-request eligibility, M2-05 cleanup/consistent limits remain outstanding.
- Real independent database IDs, private bucket settings, preproduction D1/R2 behavior, CPU/memory/multi-instance and billing/backup evidence require separate authorization. Local workerd is not production evidence.

PR #121 follow-ups in this slice: duplicate reader cookies use the existing first-cookie rule; invalid clock/budget returns unavailable rather than throwing; error handling never calls a failed clock again; late query rejection is consumed. No reader membership/credit writes were added.

## Validation on 2026-09-10

- `npm test`: passed, including `test:music:admin` 20 cases, membership 21, publication 25, MP3 21 and storage 12, plus existing payments/member/refund/game/article/site regression suites.
- `npm run test:music:runtime`: 14/14 passed in local Miniflare/workerd, including four new management HTTP tests: draft/save/rights, final receipt `RAISE(IGNORE)` rollback, identical-key four-way creation plus competing saves, unpublish/archive retaining sealed history.
- Native D1 statements expose a `.statement` string; the transaction helper explicitly distinguishes count descriptors rather than accidentally unwrapping native statements. Both native runtime and the SQL fault-injection adapter cover this representation.
- `npm run build`: passed, 145 static pages and 111 sitemap routes. No music UI/routes added to public navigation.
- `git diff --check`: passed. No new dependencies or migration files; existing MUSIC_DB migrations 0001/0002 are prerequisites, not executed remotely here.
- Local runtime initially could not bind loopback in the sandbox; rerun with permission for local sockets passed. No remote fixture Worker was created/deployed.

Unit tests include valid/invalid Access JWT signatures through the real Worker, forged email/Host/local-bypass rejection, stream size and stalled-body cancellation, mutation identity/replay/lost-response, cross-track assets, rights rollback, draft conflict, sealed-public-edition preservation and audit pagination.
All resource/rights fixtures are synthetic, not production legal/decoding/listening evidence. Browser/Safari UI testing and real Cloudflare/multi-instance testing were not performed in this API-only slice. Existing dependency audit findings were not remediated; the dependency lockfile is unchanged.

## Rollback

This PR does not add tables or alter original membership/payment handlers. Reverting these management routes makes them unavailable; it must not delete music revisions, audits or mutation receipts or replace the existing safe publication service. A later deploy requires its own approval and verified bindings. Do not deploy `scripts/helpers/music-runtime-worker.js`.
