# Signal Automation Phase 5

Phase 5 adds the explicit editorial review and publication workflow for automated Signal briefs. Collection, scoring, and AI drafting remain advisory; no scheduled task can publish public content.

## Admin Workflow

1. **今日候选** defaults to items published or collected in the last 24 hours. Editors can switch to seven days or all records.
2. Editors shortlist and select 3 to 10 candidates, then generate an AI draft as in Phase 4.
3. Generated entries appear in the dedicated **简报草稿** queue.
4. **编辑** loads the stored Markdown into the existing Signal editor. Saving with draft status creates the normal content revision.
5. **重新生成** requires confirmation and preserves previous revisions.
6. **删除** is a soft delete: the entry becomes `archived`, while R2 bodies, revisions, audit history, and candidate review decisions remain intact.
7. **批准发布** reads the title, Markdown, sources, and candidate provenance from server storage and reuses the existing Signal import publication path.
8. If linked candidates are no longer shortlisted, Admin requires an explicit exclusion confirmation before publication.

## API

- `GET /admin/api/signal/drafts?status=draft&limit=30`
  - Lists server-owned automation drafts and returns aggregate draft, scheduled, published, and archived counts.
- `POST /admin/api/signal/drafts`
  - `{ "action": "archive", "entryId": 41 }` archives a draft.
  - `{ "action": "approve", "entryId": 41 }` approves and publishes a stored draft.
  - `allowCandidateExclusions: true` is accepted only after Admin confirms a candidate-state conflict.
- `GET /admin/api/signal/candidates?sinceHours=24`
  - Limits the candidate queue to a bounded recent window. `0` means all records.

Every route is behind the shared Cloudflare Access Admin gate and performs its own Admin actor check for direct handler safety.

## Data Integrity

- Draft deletion uses a guarded `draft -> archived` update.
- The archive update, content revision, and audit row are written in one D1 batch and tied to a unique archive timestamp.
- Candidate states are never changed by draft generation, editing, regeneration, or deletion.
- Approval payloads are rebuilt from `content_entries`, R2 Markdown, and server-owned automation metadata. Browser-supplied titles, bodies, or candidate IDs are not used by the approval action.
- Final publication retains the Phase 4 guarded `shortlisted -> used` transition and reports concurrent candidate-state changes.

## Storage And Deployment

Phase 5 reuses the content platform, R2 bodies, revisions, imports, candidate tables, and Admin audit logs. It adds no migration.

Do not deploy this phase independently. After all six Signal automation phases are approved, apply the existing migrations in order and deploy once:

1. `0019_signal_automation.sql`
2. `0020_signal_collection.sql`
3. `0021_signal_candidate_triage.sql`
4. `0022_signal_source_adapters.sql`
5. `0023_signal_candidate_deduplication.sql`

No Phase 5 migration is required.
