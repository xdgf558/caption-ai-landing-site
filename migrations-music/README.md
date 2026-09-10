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
