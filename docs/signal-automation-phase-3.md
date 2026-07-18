# Signal Automation Phase 3

Phase 3 turns collected Signal items into a reviewable queue. It remains deterministic, uses no paid API, and never publishes. The only automatic status transition is reopening a rejected candidate when a genuinely new occurrence is merged into it.

## Candidate Processing

- Score every candidate from 0 to 100 using source trust, recency, Station Cat site relevance, content completeness, and clickbait penalties.
- Persist a score breakdown and plain-language reasons so an editor can understand the result.
- Merge exact canonical URLs and exact content hashes into one primary candidate.
- Merge identical normalized title fingerprints only when both reports share a category, the title contains at least four meaningful tokens, and their timestamps are within 72 hours. Generic titles stay separate and may only receive an advisory cluster.
- Preserve every fetched report in `signal_candidate_occurrences`, including its source, URL, summary, timestamp, and merge reason.
- If a new occurrence belongs to a rejected primary candidate, restore that candidate to `new` and record the automatic transition in `signal_candidate_reviews`. A replay of an already stored occurrence does not reopen it.
- If the recent in-memory merge pool misses an older exact URL or content-hash match, rely on the global uniqueness guard, then look up the persisted candidate and attach the occurrence there. New primary candidates and their primary occurrences are inserted in one D1 batch.
- Show one primary candidate in the review queue, with the merged report and distinct source counts beside it.
- Group merely similar titles into an event cluster using token similarity. These clusters remain advisory and are labelled separately from true duplicate merges.

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
4. `0022_signal_source_adapters.sql`
5. `0023_signal_candidate_deduplication.sql`
6. `0024_signal_operations.sql`

Phase 4 consumes only shortlisted candidates, saves an editable content-platform draft, and keeps public publishing behind an explicit editor action. See `docs/signal-automation-phase-4.md`.
