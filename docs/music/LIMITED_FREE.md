# Limited-free music

The track editor offers `limited_free` with a required custom end time in the administrator's local timezone. The API stores an unambiguous UTC `freeUntil`. A new or changed deadline must be in the future. Saving remains a draft operation; the existing technical review and explicit publication flow applies.

Before the deadline, a published track is free. At and after the deadline it is VIP-only. The shared policy resolver decides this on every catalog/access/audio request, including HEAD, conditional and Range requests. No cron or scheduled policy mutation is needed. Independent previews are required for publication, because the full track will become protected. Existing permanent-free publication promises remain protected. Other tracks are not changed.

The public player displays the deadline. Its in-memory clock is anchored to the capabilities response and monotonic elapsed time; a missing initial clock does not permit promotional full playback. At expiration it updates the queue, unloads full audio without sufficient VIP eligibility and refreshes access. It never automatically switches to a preview or resumes after refresh. Hidden/background timers remain subject to browser scheduling; foreground refresh and every new server audio request recheck access. Previously delivered bytes cannot be revoked by a server.

Four-role previews can simulate the deadline. Collections and featured projections use the same current policy; album listening-scope rules still apply. Analytics label new events using server receipt time, without rewriting earlier aggregates.

## Schema and deployment

Apply only the new `0010_music_limited_free.sql` after 0001–0009. Back up MUSIC_DB first, validate the backup, use the normal migration runner, then deploy the complete matching Worker and static assets. Execution records, resource IDs and session material remain outside the repository. Readiness rejects a missing `free_until` column. No bindings, secrets, quotas, music switches or member/payment data change.

The nullable `music_track_revisions.free_until` column is stored over `access_mode='vip'`; existing sealed-revision immutability and publication transaction guards include the deadline. Normal policies retain their prior JSON shape and fingerprints. Migration 0010 updates only the analytics aggregation trigger and the new column; historical migrations are unchanged.

An older Worker treats a promotional revision as VIP immediately, so rolling back the Worker can end free access early. It does not turn a promotion into permanent free access. Worker rollback does not remove schema. Close public access first when investigating an authorization failure; do not bypass the shared guard.
