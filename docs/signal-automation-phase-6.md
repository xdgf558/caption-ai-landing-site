# Signal Automation Phase 6

Phase 6 completes the operational layer for the Signal automation pipeline. It does not change the editorial rule established in phases 1–5: collected items become review candidates, AI output becomes a draft, and only an administrator can publish a brief.

## Runtime Model

- Cloudflare Cron checks due sources at minute 17 of every UTC hour.
- The primary Queue keeps batch size and concurrency at one because run aggregation is a read/aggregate/update sequence.
- Source and response failures use the existing three-attempt retry path with exponential backoff.
- Unhandled infrastructure failures exhaust the primary Queue retries and move to `station-cat-signal-collection-dlq`.
- The DLQ consumer marks the matching task and run failed, records a critical alert, and leaves the failed sources available for an Admin retry.
- Queued or running jobs with no progress for 120 minutes are terminated and recorded as critical stale-run alerts.
- Completed run history is retained for 90 days. Resolved alerts are retained for 30 days.

## Health And Alerts

Migration `0024_signal_operations.sql` adds:

- `signal_automation_runtime`, a singleton Cron heartbeat and latest-run record.
- `signal_automation_alerts`, a deduplicated alert history for scheduler gaps, scheduler failures, stale runs, failed runs, repeated source failures, queue failures, and dead letters.

The Admin operations band shows the last Cron, latest run, open alert count, and sources with consecutive failures. Failed or partial runs expose **重试失败来源**; the retry creates a new `retry` run containing only failed source IDs. Open alerts can be marked resolved without deleting their history.

Critical alerts use the existing `EMAIL` binding. Recipients come from `SIGNAL_ALERT_EMAILS`, falling back to `ADMIN_ALLOWED_EMAILS`. Warning alerts remain visible in Admin but do not send email. Each open critical incident sends at most once; resolving and later reopening the incident permits a new notification.

Worker logs are emitted as structured JSON with `component: "signal_automation"`. Workers observability is enabled in `wrangler.toml` so Cron, Queue, and DLQ events can be filtered together.

## Admin API

- `GET /admin/api/signal/operations`
  - Returns health, heartbeat, latest and active runs, alerts, failed-source summaries, notification setup, and retention policy.
- `POST /admin/api/signal/operations`
  - `{ "action": "retry_run", "runId": "..." }` queues only failed tasks from a partial or failed run.
  - `{ "action": "resolve_alert", "alertId": "..." }` marks an open alert resolved.

Both methods are protected by the shared Cloudflare Access gate and repeat the Admin actor check inside the handler. Retry and resolution actions are written to `admin_audit_logs`.

## One-Time Production Runbook

Do not run this checklist until Phase 6 is reviewed and approved.

1. Confirm both queues exist. Create only the missing queue:

   ```sh
   npx wrangler queues list
   npx wrangler queues create station-cat-signal-collection
   npx wrangler queues create station-cat-signal-collection-dlq
   ```

2. Apply all unapplied D1 migrations in order:

   ```sh
   npx wrangler d1 migrations apply station-cat-waitlist --remote
   ```

   The Signal sequence must be:

   1. `0019_signal_automation.sql`
   2. `0020_signal_collection.sql`
   3. `0021_signal_candidate_triage.sql`
   4. `0022_signal_source_adapters.sql`
   5. `0023_signal_candidate_deduplication.sql`
   6. `0024_signal_operations.sql`

3. Keep paid data providers disabled. The default production path uses free RSS, Atom, official pages, Hacker News, and optionally the free FRED API key.
4. Optionally set dedicated alert recipients with `SIGNAL_ALERT_EMAILS`; otherwise `ADMIN_ALLOWED_EMAILS` is used.
5. Validate configuration without publishing:

   ```sh
   npx wrangler deploy --dry-run
   ```

6. After final approval, deploy once. Cron configuration can take several minutes to propagate.
7. In Admin, run **立即采集**, confirm candidates arrive, confirm the operations band updates, then test **重试失败来源** only with a deliberately failed source.
8. Confirm Worker observability contains `cron_completed` and queue events, and confirm the public `/signal/` pages remain human-published content only.

Phase 6 is not deployed as part of this PR review cycle.
