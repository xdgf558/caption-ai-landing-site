# Signal DeepSeek Provider Phase 2

Phase 2 connects the Phase 1 DeepSeek adapter to authenticated Signal brief generation and strengthens the server-owned quality gate. It does not publish a brief automatically.

## Generation Order

1. When `SIGNAL_BRIEF_DEEPSEEK_ENABLED=1`, `DEEPSEEK_API_KEY` is configured, and the Phase 3 D1 rollout mode is `live`, the selected DeepSeek model is the primary generator. The committed production default remains disabled.
2. DeepSeek receives only the selected public candidate title, summary, publisher, category, and publication time.
3. DeepSeek retries once for a malformed, truncated, untranslated, factually invalid, or editorially weak result.
4. If DeepSeek remains unavailable or fails validation, generation falls back to the existing Workers AI primary and fallback models.
5. The saved automation metadata records the provider, model, finish reason, normalized token usage, quality version, fallback state, and a sanitized provider-attempt trail.

Authentication failures, balance failures, timeouts, rate limits, and provider response bodies are never copied into public content. Provider attempts retain only a short internal error code, model, provider, finish reason, and status.

## Quality Gate

The Worker owns the final Markdown and rejects model output when any of these checks fail:

- JSON is incomplete or `finish_reason` reports an output-length truncation.
- Candidate IDs are missing, duplicated, or assigned to the wrong item.
- Human-readable fields are mostly English or show a strong Simplified Chinese signal instead of `zh-Hant`.
- A generated item introduces a number that does not appear in its corresponding source candidate or brief date.
- `signal` and `noise` repeat or paraphrase one another.
- Multiple items reuse substantially the same signal or noise sentence.
- Editorial analysis is too short or uses the known generic controversy template.
- The brief title and description are effectively the same text.

Numeric provenance currently validates Arabic numerals only. Invented Chinese-number words such as `三千` or `兩百`, and unit conversions expressed without a matching Arabic numeral, remain prompt-enforced limitations that require editorial review.

The retry prompt identifies the failed quality class without sending private records or administrator data to the model.

## Configuration

Non-secret Worker variables:

```text
SIGNAL_BRIEF_DEEPSEEK_ENABLED=0
SIGNAL_BRIEF_DEEPSEEK_MODEL=deepseek-v4-pro
SIGNAL_BRIEF_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
SIGNAL_BRIEF_FALLBACK_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

The DeepSeek key remains a Worker Secret:

```bash
npx --yes wrangler@latest secret put DEEPSEEK_API_KEY
```

Keep `SIGNAL_BRIEF_DEEPSEEK_ENABLED=0` to use only Workers AI without deleting the Secret. Change it to `1` only during a controlled activation after the Secret and smoke-test path are ready.

## Rollout Boundary

Phase 2 itself requires no database migration. Merging it keeps DeepSeek disabled. Phase 3 adds the D1 rollout gate, unpublished Admin smoke test, 24-hour readiness window, and immediate kill switch documented in `docs/signal-deepseek-provider-phase-3.md`.

Official references:

- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://api-docs.deepseek.com/api/create-chat-completion/
- https://api-docs.deepseek.com/guides/json_mode/
