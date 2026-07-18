# Signal Automation Phase 4

Phase 4 converts reviewed Signal candidates into an editable brief draft. It uses the existing content platform for storage and keeps public publishing behind an explicit human action.

## Editorial Workflow

1. An editor shortlists candidates in the Admin queue.
2. The editor selects 3 to 10 shortlisted candidates, a brief date, and an optional category.
3. `POST /admin/api/signal/drafts/generate` asks Workers AI for structured draft fields.
4. The server validates exact candidate coverage, builds the Markdown itself, and saves a `signal_brief` entry with `status = draft`.
5. Admin loads the saved draft into the existing manual Signal editor for fact checking and rewriting.
6. Candidates stay `shortlisted` while the draft is generated or edited.
7. Only an explicit save with `status = published` changes associated shortlisted candidates to `used`.
8. If a linked candidate was rejected after draft generation, Admin asks whether to exclude it from this publication. Confirmed exclusions are removed from the stored automation metadata and reported in the save result.

The generator never publishes a page, changes candidate review decisions, or trusts source URLs returned by the model.

## Safety Boundaries

- The route is protected by the existing Cloudflare Access Admin gate and also verifies the Admin actor before generation.
- Both draft generation and the final Signal import handler require an explicit Admin actor; neither writes audit history under a fallback identity.
- Only candidates whose current database status is exactly `shortlisted` are accepted.
- RSS and API text is labeled as untrusted reference material in the prompt. Instructions embedded in source content must be ignored.
- Workers AI is asked for JSON Schema output, but the server still validates every required field, candidate ID, duplicate, and omission.
- Source labels and HTTP(S) links are rebuilt from database candidates rather than copied from model output.
- A date cannot overwrite an existing manually created or published brief. Regeneration is limited to an existing automation draft for that date.
- Regenerating an existing automation draft requires explicit confirmation. Content revisions remain available for recovery.
- Candidate provenance is server-owned. Final saves use automation metadata already stored on the content entry and reject client attempts to replace its candidate IDs.
- A publication race is reported back to Admin if any guarded `shortlisted -> used` update no longer applies.

## Storage And Configuration

Phase 4 reuses `content_entries`, content revisions, R2 bodies, imports, and Admin audit logs. It adds no migration.

The default model is configured with `SIGNAL_BRIEF_MODEL` in `wrangler.toml` and uses `@cf/meta/llama-3.1-8b-instruct-fast`, which Cloudflare lists as supporting JSON Schema output. It uses the existing Workers AI binding and can be changed without modifying the editorial contract. The output budget scales from 3,200 tokens for three candidates to 6,400 tokens for ten candidates, while the prompt asks for concise fields. The implementation is intended to stay within the account's available Workers AI allocation; usage should still be monitored before production rollout.

## Deployment

Do not deploy this phase independently. When the full Signal automation project is approved, apply the existing migrations in order before deploying:

1. `0019_signal_automation.sql`
2. `0020_signal_collection.sql`
3. `0021_signal_candidate_triage.sql`
4. `0022_signal_source_adapters.sql`

No Phase 4 migration is required.
