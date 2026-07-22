# Signal DeepSeek Provider Phase 3

Phase 3 adds a server-owned rollout gate, an unpublished Admin smoke test, and an immediate kill switch. It does not enable DeepSeek in the committed production configuration and does not publish smoke-test output.

## Safety Model

DeepSeek becomes the primary Signal brief model only when all of these conditions are true:

1. `SIGNAL_BRIEF_DEEPSEEK_ENABLED=1` is present in the deployed Worker configuration.
2. `DEEPSEEK_API_KEY` is configured as a Worker Secret.
3. Migration `0025_signal_model_rollout.sql` has been applied.
4. The database rollout mode is `live`.

Any missing table, failed settings query, disabled deployment gate, or missing Secret fails closed. The normal draft path then uses Workers AI. Enabling `live` additionally requires a configured Workers AI fallback and a successful smoke test for the same DeepSeek model within the previous 24 hours.

The environment variable is a deployment-level availability gate. The D1 setting is the operator-controlled live switch. Neither can enable DeepSeek alone.

## Admin Workflow

The “每日简报” module now includes a compact “简报生成模型” section:

- Choose `deepseek-v4-pro` or `deepseek-v4-flash` while the rollout is off.
- Select 3–10 shortlisted candidates in the existing candidate queue.
- Run “测试所选候选”. The server calls only DeepSeek, runs the full Phase 2 quality gate, and returns a temporary preview.
- Confirm that the preview is complete Traditional Chinese, source numbers are preserved, and signal/noise analysis is distinct.
- Enable the primary model only after the smoke status is fresh and Workers AI fallback is available.
- Use “关闭主模型” as the immediate kill switch. No Secret deletion or redeploy is required.

The smoke path does not write a content entry, upload Markdown, publish a URL, or change candidate statuses. It stores only sanitized readiness data and an Admin audit record. Provider response bodies and API keys are never persisted.

## Migration

Apply migrations in this order:

1. `0007_backend_content_platform.sql`
2. `0019_signal_automation.sql`
3. `0020_signal_collection.sql`
4. `0021_signal_candidate_triage.sql`
5. `0022_signal_source_adapters.sql`
6. `0023_signal_candidate_deduplication.sql`
7. `0024_signal_operations.sql`
8. `0025_signal_model_rollout.sql`

The singleton `signal_model_rollout` row stores the selected model, rollout mode, last smoke result, sanitized usage, and operator identity. Audit history remains in `admin_audit_logs`.

## Controlled Activation

1. Deploy Phase 3 with the committed `SIGNAL_BRIEF_DEEPSEEK_ENABLED=0` default.
2. Apply migration `0025_signal_model_rollout.sql`.
3. Configure `DEEPSEEK_API_KEY` with `wrangler secret put`; never place it in `wrangler.toml`.
4. In a separate activation change, set `SIGNAL_BRIEF_DEEPSEEK_ENABLED=1` and deploy. The D1 rollout mode remains `off`, so normal drafts still use Workers AI.
5. Run one authenticated Admin smoke test with representative public candidates.
6. Enable the primary model in Admin, generate one draft, and verify provider/model/fallback metadata.
7. Exercise “关闭主模型” once and verify the next draft reports `provider = workers-ai`.

The committed flag remains `0` in this phase, so merging the code cannot activate DeepSeek by itself.

Official references:

- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://api-docs.deepseek.com/api/create-chat-completion/
