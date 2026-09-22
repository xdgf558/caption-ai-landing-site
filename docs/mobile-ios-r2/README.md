# R2 isolated HTTPS integration — deployment and acceptance status

Status on 2026-09-22: **the isolated service is deployed; HTTPS API, native integration, actual system-browser login/callback and OS-dispatched cold/warm Universal Links have passed on the simulator. Production and physical-device acceptance remain separate.** This is not a production release package.

The dedicated entry is `src/mobile/isolatedWorker.js`, configured by `wrangler.mobile-r2.jsonc`. Its fixed origin is `https://station-cat-music-r2.yehao1105.workers.dev`. The Apple association uses only `2AM5S7BM2N.org.stationcat.music.staging`; production `org.stationcat.music` is not associated with this test origin. The registered team is `2AM5S7BM2N`.

The entry delegates authentication and music requests to the actual product handlers against separate test storage. It serves the AASA JSON directly, restricts callback/share paths, marks the login page as test-only, and does not expose fixture provisioning, administrative, purchasing, registration or password-reset endpoints. It does not replace production `src/worker.js` or production Wrangler configuration. Account deletion remains the existing restricted workflow, not a completed erasure service.

## Local validation completed

- 51/51 tests passed across `test-mobile-r2.mjs`, `test-mobile-auth.mjs` and `test-mobile-music.mjs` with real local Miniflare D1/R2. New coverage exercises AASA, route isolation, capabilities, real password verification, PKCE code exchange, single-use codes, refresh replay, authenticated personal-library access, rejection of cookie fallback, logout and an empty catalog.
- Wrangler 4.131.1 dry-run bundling and binding-type generation passed, using compatibility date 2026-07-30.
- Site build and postbuild assertions passed with `ALLOW_EMPTY_SERIAL_CONTENT=1`. The checkout lacks novel content, so this generated site output must not be deployed as a production package.
- Offline synthetic seed preparation generated two test accounts and two synthetic three-minute tracks. Credentials and result keys are kept only in ignored mode-0600 files under `.generated/r2/private`; they must not be committed or included in evidence logs.
- The album supplement was checked against all real music migrations, foreign keys and publication triggers in temporary in-memory SQLite. It creates a draft album, its independent generated PNG cover, two track memberships, publication and featured placement. Public catalog projection passed, and existing track, revision, asset and rights rows were unchanged. Repeated preparation refuses to overwrite the retained seed.

## Dedicated remote resources and deployment

The retired database was backed up and deleted only after explicit user authorization. The freed slot has now been used by the separate R2 catalog database; it is no longer an available slot. See [resource inventory](resource-inventory.md) for the approval history and exact identities.

| Binding/resource | Dedicated name | ID or status |
| --- | --- | --- |
| `WAITLIST_DB` | `station-cat-music-r2-reader` | `254cd4bd-49e3-4459-8d68-5c9995e8465f`; 9 reader/mobile migration copies applied |
| `MUSIC_DB` | `station-cat-music-r2-catalog` | `19595ea0-7359-4ab3-b168-d82247edefa5`; 11 music migrations applied |
| `MUSIC_BUCKET` | `station-cat-music-r2-audio` | Private R2 bucket; 6 synthetic audio/preview/lyrics objects plus the album PNG |
| Worker | `station-cat-music-r2` | Dedicated entry and `wrangler.mobile-r2.jsonc`; no production routes or assets |

The remote data contains two synthetic accounts, two synthetic three-minute tracks and one synthetic two-track album (`r2-synthetic-album`) with an independent 256 × 256 generated PNG. The free/VIP track policies remain distinct inside the mixed-access album. No production account, music, membership or payment data was imported.

The initial code deployment reported version `dd8b772c-026e-4926-bbde-a10a88725b94`. Dedicated `MOBILE_RESULT_KEYS_JSON` and, subsequently, `MUSIC_RATE_LIMIT_SECRET` were registered on this isolated Worker. Secret values are excluded from this document and evidence. The initial version identifier is a deployment-history reference, not a claim that subsequent secret registration preserved the active version identifier.

## Remote validation completed

- `scripts/verify-mobile-r2-https.mjs --run` completed 9 groups and 68 requests over real HTTPS. It exercised AASA and capabilities, blocked routes, catalog/featured tracks/lyrics, real password verification and PKCE code exchange, single-use codes, refresh-result replay, free and VIP grants with HEAD/Range authorization, cross-session favorites/history, account isolation and logout. The run created and revoked three sessions. Its redacted evidence is retained locally in `.generated/r2/https-evidence.json`; it contains no credentials, grant URLs or callback secrets.
- Apple's association CDN returned HTTP 200 with the expected staging App ID and paths. Direct-origin and CDN JSON checks do not prove that an installed app has received and accepted the association.
- iOS `Tests/R2HTTPSIntegrationTests.swift` passed on iOS 26.4.1 in 72.019 seconds against the deployed HTTPS service. It exercised the actual native authentication, catalog, album, lyrics, VIP playback and personal-library code, including refresh, two-session favorites/history isolation and an AVPlayer playback interval of five seconds. The media run observed two HEAD and nine Range requests. Test sessions were revoked during cleanup.
- The native test performs the authorization form exchange through an HTTP test substitute; it does **not** launch `ASWebAuthenticationSession`. This establishes real HTTPS/native service integration, not system-browser callback or Universal Link acceptance.

The additional public smoke passed at 2026-09-22T06:46:47Z: five groups, 21 requests, no authenticated sessions. It verifies the published album's exact track order, featured placement, cover GET/HEAD, byte count, PNG SHA-256 and single-part R2 ETag/MD5, and HTTP fallback/AASA paths for song/album links. This is not OS link-dispatch acceptance. The cover check initially identified a missing isolated rate-limit secret (503); the dedicated secret was added, and local regression tests now assert both missing-secret refusal and configured delivery. No rate limit was weakened.

Redacted summaries are committed with this report: [HTTPS API](evidence/20260922-https-api.json) and [public album/cover](evidence/20260922-https-public.json). The final `npm run test:mobile:r2` entry passed 11/11 tests, including constrained seed import/reimport and the cover regression.

The shared mobile sign-in form now inherits the page font for inputs/buttons with a 16px minimum, preserving user zoom. This fixes the iPhone focus magnification observed in the real system browser. Four-language form assertions and mobile-auth/R2 entry tests passed (35/35). Only the isolated Worker was updated, to version `93a57800-a25c-40e6-8d56-be956fab5941`; production was not deployed.

After the user explicitly authorized XCTest UI automation as an alternative to the unresponsive computer-control interface, actual OS link delivery passed on an iPhone 17 Pro simulator running iOS 26.4.1: warm/cold × track/album, 36.439 seconds, zero failures. The first cold-track run exposed an iOS startup race; the iOS product fix queues the latest valid link until account/catalog initialization completes. Eight deterministic startup tests also pass. Each UI case observed no Playing/Pause UI for three seconds; this does not substitute for physical/audio acceptance.

The actual ASWebAuthenticationSession run then found a real form POST failure: `no-referrer` causes a non-CORS form navigation to send `Origin: null` under the [Fetch standard](https://fetch.spec.whatwg.org/#append-a-request-origin-header). Only form HTML now uses `strict-origin`, which sends origin without path/query. The exact Origin check is unchanged; missing/null/foreign values still return 403 without consuming a flow or creating a code. APIs, the 302 code redirect and callback HTML retain `no-referrer`. Local mobile-auth/R2 tests passed 36/36, and a real Chrome/temporary-Miniflare comparison reproduced old-policy 403 versus new-policy 302. [Redacted browser evidence](evidence/20260922-form-origin.json).

The isolated deployment was updated to version `b3f418bb-94e6-42ab-8be0-2dd4a128045a`. Actual Staging system-browser sign-in, HTTPS callback, authenticated UI and signed-out cleanup subsequently passed on iOS 26.4.1 in **40.091 seconds**, zero failures. This uses the real product browser and authentication model, not the earlier HTTP substitute. The accompanying iOS `docs/R2-system-ui-evidence.json` records source hashes, passing run identities and retained failures.

## Remaining acceptance work

The computer-control interface could not inspect Device Hub, so the user authorized XCTest UI automation. Both actual system-browser login/callback and OS Universal Link delivery have now passed as described above. Earlier driver failures and the initial product failures are retained locally; none are counted as passing attempts. Raw XCTest screenshots/logs/results may contain synthetic typed inputs and remain private, excluded from CI uploads.

Physical iPhone, locked Keychain/background playback, network changes, AirPlay and complete account deletion remain separate release checks. Production configuration remains unchanged, no subscriptions are sold, and no App Store upload has occurred. These local results predate the pull-request CI; consult the paired PR checks for the stable remote validation result. Local builds and the isolated remote results do not authorize a production rollout.

## Reproduction notes

Use `node scripts/prepare-mobile-r2.mjs --require-provisioned` before any explicit R2 deployment command. The offline seed refuses to overwrite existing identities and now creates `rate-limit-secrets.json` for a fresh environment, in addition to the result-encryption secret. Provision both dedicated secrets before testing covers. Existing initialized environments must retain their IDs/passwords and keys; do not rerun the seed to repair a missing secret.

`node scripts/verify-mobile-r2-https.mjs --run` uses only the named synthetic accounts and resets their disposable test history. `--run --only-public` performs read-only public checks without reading credentials or creating sessions. Running the script without `--run` makes no requests. Both modes retain redacted evidence locally. Ordinary CI runs local synthetic tests only and never deploys or invokes this public HTTPS probe.
