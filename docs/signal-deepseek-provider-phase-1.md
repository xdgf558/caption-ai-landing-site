# Signal DeepSeek Provider Phase 1

Phase 1 adds an isolated DeepSeek model adapter for Signal brief generation. It does not switch the production generator away from Workers AI and does not call DeepSeek from any Worker route yet.

## Adapter Contract

`createDeepSeekSignalDraftAdapter()` implements the existing `run(model, request)` contract used by `generateSignalBriefDraft()`:

- The endpoint is fixed to `https://api.deepseek.com/chat/completions`.
- Only `deepseek-v4-pro` and `deepseek-v4-flash` are accepted. Deprecated aliases are rejected.
- Workers AI `json_schema` requests are converted to DeepSeek JSON Object mode, with the server-owned schema appended to the system instruction.
- Thinking mode is disabled for predictable structured output, latency, and cost during editorial generation.
- Responses are capped at 2 MiB and normalized to `{ provider, model, response, usage }`.
- One retry is allowed for timeouts, HTTP 408/429, HTTP 5xx, network failures, or malformed success envelopes.
- Authentication, balance, unsupported model, and other HTTP 4xx failures are not retried.
- Provider error bodies and the API key are never included in returned error messages.

The adapter uses the Worker-native `fetch` API and adds no SDK dependency.

## Configuration

The API key must be stored as a Worker Secret and must never be committed:

```bash
npx --yes wrangler@latest secret put DEEPSEEK_API_KEY
```

The intended Phase 2 model setting is:

```text
SIGNAL_BRIEF_DEEPSEEK_MODEL=deepseek-v4-pro
```

Phase 1 deliberately leaves the current production settings unchanged:

```text
SIGNAL_BRIEF_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
SIGNAL_BRIEF_FALLBACK_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

## Phase 2 Boundary

Phase 2 will choose the provider in the authenticated Signal draft handler, use DeepSeek V4 Pro as the configured primary model, and retain Workers AI as a fallback. That wiring, provider metadata, quality validation, and any live API smoke test are intentionally outside this PR.

Only public candidate titles and summaries are intended to be sent to the provider. Reader accounts, Admin identity, secrets, private content, D1 records, and R2 objects must not be included in model requests.

Official references:

- https://api-docs.deepseek.com/
- https://api-docs.deepseek.com/api/create-chat-completion/
- https://api-docs.deepseek.com/guides/json_mode/
- https://api-docs.deepseek.com/guides/thinking_mode/
