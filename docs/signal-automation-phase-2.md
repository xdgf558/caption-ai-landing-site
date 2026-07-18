# Signal Automation Phase 2

Phase 2 collects technology, economy, AI, market, and research items from approved sources. Collection creates review candidates only; it never publishes a Signal brief.

## Free Official Sources

- OpenAI News uses the official `https://openai.com/news/rss.xml` feed and needs no API key.
- Anthropic News uses a provider-specific HTML adapter. It only fetches `https://www.anthropic.com/news` and only accepts article links under `/news/`.
- GitHub Changelog, Google company news, Federal Reserve Board press releases, and arXiv use their official RSS or Atom endpoints.
- FRED uses the official observations API and a free registered API key. The seed configuration tracks CPI, unemployment, nonfarm payrolls, the effective federal funds rate, and the 10-year Treasury yield.
- Hacker News remains a community discovery source. It is a lead, not a primary factual source.

## FRED Setup

Create a free FRED API key, store it only as a Worker secret, and then enable the `fred-api` source in Admin:

```sh
npx wrangler secret put FRED_API_KEY
```

The key is never stored in D1, returned by the Admin API, written to candidate metadata, or forwarded across redirects. The FRED adapter always calls the fixed `api.stlouisfed.org` endpoint and rejects redirects.

## Collection Boundaries

- Every database-configured URL must be a public HTTP(S) URL and pass the existing DNS and private-address checks before fetch.
- Responses are streamed with a byte limit and a timeout.
- RSS and Atom reject DTD and entity declarations.
- Provider adapters have fixed host and path constraints instead of accepting database-controlled selectors.
- Queue retries and stale-run recovery remain responsible for transient failures.
- Collected entries enter the candidate queue for deterministic scoring and human review in phase 3.

## Deployment

Do not deploy this correction independently. When the full Signal automation project is approved, apply migrations in order through Wrangler:

1. `0019_signal_automation.sql`
2. `0020_signal_collection.sql`
3. `0021_signal_candidate_triage.sql`
4. `0022_signal_source_adapters.sql`
