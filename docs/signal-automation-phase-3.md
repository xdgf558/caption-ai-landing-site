# Signal Automation Phase 3

Phase 3 turns collected Signal items into a reviewable queue. It remains deterministic, uses no paid API, and never publishes or changes candidate status automatically.

## Candidate Processing

- Score every candidate from 0 to 100 using source trust, recency, content completeness, topic keywords, and clickbait penalties.
- Persist a score breakdown and plain-language reasons so an editor can understand the result.
- Group similar titles into an event cluster using token similarity. Clustering is advisory; all source items remain visible.
- Keep exact URL and content-hash deduplication from phase 2.

## Human Review

- Filter the Admin queue by status, category, source, score, and text query.
- Shortlist, reject, or restore a candidate with an optional note.
- Treat `used` as a terminal state in this phase so a published item cannot be changed accidentally.
- Record each decision in `signal_candidate_reviews` and the existing Admin audit log.
- Re-score up to the 500 most recent candidates on demand without calling an external service. Older candidates keep their previous score until they enter a future scoring batch.
- Re-scoring rebuilds advisory clusters only within that 500-item batch, so cluster assignments can differ slightly from incremental collection results.

## Deployment

Do not deploy this phase independently. When the full Signal automation project is ready, apply migrations in order through Wrangler:

1. `0019_signal_automation.sql`
2. `0020_signal_collection.sql`
3. `0021_signal_candidate_triage.sql`

Phase 4 consumes only shortlisted candidates, saves an editable content-platform draft, and keeps public publishing behind an explicit editor action. See `docs/signal-automation-phase-4.md`.
