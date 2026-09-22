# R2 isolated integration: resource inventory

Checked on 2026-09-22. Initial inspection was read-only. The user subsequently explicitly authorized backup followed by deletion; execution is recorded below.

## Retired database and inspection evidence

| Database | ID | Evidence before retirement | Current status |
| --- | --- | --- | --- |
| mindbudget-telemetry-staging | 776d171d-ec10-4a90-9235-b537e063e04b | Created 2026-08-28; reported size 12 KiB; sqlite_master contained only Cloudflare's internal _cf_KV table and no business tables; no reference found in active Worker bindings; no reference in the account's one Pages project's production/preview bindings | Backed up, verified and deleted after explicit authorization |

The internal table row-count query was denied by Cloudflare (SQLITE_AUTH). This assessment does not claim that internal metadata is empty. No business records were read. Historical Worker versions, external scripts and other users' local configuration were not exhaustively audited; lack of an active binding alone is not proof that a database will never be used again.

## Keep

- `station-cat-music-staging` and `station-cat-music-staging-identities`: bound to the existing music staging Worker.
- `mindbudget-telemetry-development`: bound to the active development Worker.
- Production databases and databases whose retirement is not established remain untouched.

## Actions and approval status

### Completed after explicit authorization

The user confirmed “可以，先备份一下，然后删除”. Wrangler 4.131.1 exported the specified database successfully, then the export was restored into an in-memory SQLite database with an `integrity_check` result of `ok`. The 32-byte export contains no business tables; Cloudflare's internal tables are not part of this exported application schema. SHA-256: `309d1516f5d4f4f792b17106f7b761312f848c634e3028d70e6eb8ed39df7398`.

Backup SQL, export/delete logs, hash and restore-verification manifest are retained outside the repository in `cloudflare-resource-backups/20260922-mindbudget-telemetry-staging/` under the shared workspace. The directory is private and files use owner-only permissions.

Wrangler then successfully deleted only `776d171d-ec10-4a90-9235-b537e063e04b`. A fresh database list at that point confirmed its name/ID absent, nine databases remaining, and all three named databases in the Keep section still present. The released slot was subsequently used to create `station-cat-music-r2-catalog`, as recorded below. No backup/deletion approval remains pending for this resource.

### Prior inspection history

Before the final backup/deletion authorization, the user requested that this database stop being used (停用). At that earlier stage it was retained pending clarification because D1 retention still consumes a slot and there is no pause action. A read checked all seven active Worker scripts and the single Pages project: neither had a binding to this database, so no unbinding was necessary. This was an inspection-only intermediate state, superseded by the completed deletion above.

The initial full-export attempt was rejected by automatic approval review because the user had then authorized candidate inspection, not copying potentially sensitive contents. That rejected attempt produced no backup and made no mutation. The later explicit “先备份一下，然后删除” authorization allowed the successful export, verification and deletion described above; it was not inferred from elapsed time. The original database ID cannot be restored by importing the SQL backup into a new database.

## Active dedicated R2 resources

The initial catalog-create attempt encountered the account's ten-database limit. After the authorized retirement released a slot, creation succeeded. These resources now back the deployed isolated service:

| Resource | Name | ID / contents |
| --- | --- | --- |
| Identity D1 (`WAITLIST_DB`) | `station-cat-music-r2-reader` | `254cd4bd-49e3-4459-8d68-5c9995e8465f`; 9 migration copies, two synthetic accounts and native test state |
| Catalog D1 (`MUSIC_DB`) | `station-cat-music-r2-catalog` | `19595ea0-7359-4ab3-b168-d82247edefa5`; 11 migrations, two synthetic long tracks and one mixed-access synthetic album |
| Private R2 (`MUSIC_BUCKET`) | `station-cat-music-r2-audio` | Six synthetic audio/preview/lyrics objects and one generated album-cover PNG |
| Worker | `station-cat-music-r2` | `https://station-cat-music-r2.yehao1105.workers.dev`; dedicated `src/mobile/isolatedWorker.js` entry |

The initial Worker code version was `dd8b772c-026e-4926-bbde-a10a88725b94`. It has its own result-encryption secret and artwork-rate secret; values are neither copied from production nor retained in this inventory. Exact bindings are recorded in `wrangler.mobile-r2.jsonc`. This environment has no production routes, public registration/reset, subscription sales or production data import. The original music staging and MindBudget development resources listed above were not repurposed.

Real HTTPS API smoke, Apple CDN association retrieval, album/cover checks, native HTTPS integration, actual system-browser login/callback and cold/warm OS Universal Link delivery have passed on the simulator. The final isolated form-policy deployment used Worker version `b3f418bb-94e6-42ab-8be0-2dd4a128045a`. See [acceptance status](README.md) for the evidence and its limits. Production resources remain unchanged.
