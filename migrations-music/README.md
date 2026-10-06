# Music Database Migrations

These migrations target an independent `MUSIC_DB`, never `WAITLIST_DB`.
They are intentionally outside the existing production `migrations/` directory.
On 2026-09-10, the owner authorized isolated staging storage: migrations 0001-0003
were applied to the new staging MUSIC_DB only. See the
[resource record](../docs/music/STAGING_STORAGE.md). No production music binding,
Worker deployment, positive upload quota or public launch has been configured.

`0001_music_foundation.sql` initializes an empty database once. A pre-existing
schema must be inspected and migrated explicitly, not overwritten or silently
accepted. Future changes append numbered files; do not edit an applied migration.
Existing explicitly free content must retain its access policy.

`0002_music_publication.sql` appends private approval fingerprints, transaction
guards, catalog/preview settings and append-only mutation receipt protection.
Old receipts are retained; expires_at does not authorize deletion or replacement.
Existing drafts need fresh trusted approvals before publication. No production
resource has been migrated. See [conditional publication](../docs/music/M1_PUBLICATION.md).

Run the isolated schema/domain tests with `npm run test:music:foundation`
and transactional command tests with `npm run test:music:publication`.
For D1 compatibility checks use a separate temporary Wrangler configuration,
synthetic local database ID and `--local`; never the site's production binding.
Provisioning and remote migration require separate approval.

See [M1 contract](../docs/music/M1_FOUNDATION.md) for constraints and incomplete
publication, authentication, parsing and media-delivery responsibilities.

`0011_music_share_rate_limits.sql` adds independent share-image source/global
counters and their atomic increment guards. It does not alter ordinary artwork,
audio or catalog counters, music content, permissions, or quotas. Apply it before
deploying a Worker that uses the `share` category. A rollback to the previous Worker
may leave these additive tables in place; the old Worker ignores them.

`0012_station_redesign.sql` adds website publication snapshots, retained track
routes, platform links, clips/games and their media, explicit asset-use reviews,
promotion/home snapshots, campaigns, new analytics event storage and route
proposals. Existing music physical tables and full-audio policies are retained.
The old cleanup reference view keeps its six output columns and also protects new
cover, lyrics, preview and review references. Its view replacement and every
backfill must execute in the same atomic migration batch.

Existing songs backfill to website drafts only. The sole initial home draft has
no selected content; no promotion, platform release, preview authorization, game,
video, license or redirect is inferred. Replays preserve newer drafts, published
snapshots, aliases and post-migration data. A rollback to the old application
keeps the extension schema and the expanded reference view; do not overwrite new
data with a pre-migration backup or drop these tables.

Run `npm run test:redesign:model` and `npm run rehearse:redesign:migration` for
ephemeral local SQLite/D1 verification. The rehearsal has no remote option or
existing database target. See [T06 mapping and rollback](../docs/station-cat-redesign/T06-data-model-and-migration.md)
for fields, deployment prerequisites and the remaining T07/T16/T18 responsibilities.
Merging this file does not apply it to staging or production.
