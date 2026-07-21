import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const signalDraftSource = read('src/signalDraft.js');
const workerSource = read('src/worker.js');
const adminSource = read('src/pages/admin-v2/index.astro');
const wranglerSource = read('wrangler.toml');
const phaseTwoDoc = read('docs/signal-deepseek-provider-phase-2.md');

assert.match(workerSource, /createDeepSeekSignalDraftAdapter/);
assert.match(workerSource, /isDeepSeekApiKeyConfigured\(env\.DEEPSEEK_API_KEY\)/);
assert.match(workerSource, /SIGNAL_BRIEF_DEEPSEEK_ENABLED/);
assert.match(workerSource, /generateSignalBriefDraftWithProviders\(providerPlan/);
assert.match(workerSource, /providerAttempts: draft\.providerAttempts/);
assert.match(workerSource, /qualityVersion: draft\.qualityVersion/);

assert.match(signalDraftSource, /SIGNAL_DRAFT_AI_OUTPUT_TRUNCATED/);
assert.match(signalDraftSource, /SIGNAL_DRAFT_AI_OUTPUT_FACTUAL_INVALID/);
assert.match(signalDraftSource, /hasRepeatedEditorialText/);
assert.match(signalDraftSource, /findUnsupportedNumericFacts/);
assert.match(signalDraftSource, /finishReason: draft\.finishReason/);

assert.match(adminSource, /draft\.automation\?\.provider === 'deepseek'/);
assert.match(adminSource, /主模型失败后已自动回退/);
assert.match(wranglerSource, /SIGNAL_BRIEF_DEEPSEEK_ENABLED = "1"/);
assert.match(wranglerSource, /SIGNAL_BRIEF_DEEPSEEK_MODEL = "deepseek-v4-pro"/);

assert.match(phaseTwoDoc, /does not publish a brief automatically/i);
assert.match(phaseTwoDoc, /DEEPSEEK_API_KEY/);
assert.match(phaseTwoDoc, /No database migration is required/);
assert.match(phaseTwoDoc, /authenticated Admin smoke test/);

console.log('Signal DeepSeek phase 2 provider routing, quality gate, metadata, and Admin checks passed.');
