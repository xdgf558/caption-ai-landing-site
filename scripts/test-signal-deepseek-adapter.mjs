import assert from 'node:assert/strict';

import {
  createDeepSeekSignalDraftAdapter,
  deepSeekChatCompletionsUrl,
  defaultDeepSeekSignalDraftModel,
  isDeepSeekApiKeyConfigured,
  normalizeDeepSeekSignalDraftModel
} from '../src/deepseekSignalDraft.js';

const apiKey = 'test-deepseek-secret';
const draftPayload = {
  title: '每日信號簡報',
  description: '今日值得留意的公開訊號。',
  category: 'tech',
  items: []
};
const responseEnvelope = (content = JSON.stringify(draftPayload), finishReason = 'stop') => ({
  id: 'chatcmpl-test',
  model: 'deepseek-v4-pro',
  choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
  usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 }
});
const request = {
  messages: [
    { role: 'system', content: 'Return JSON for an editorial brief.' },
    { role: 'user', content: '{"source_data":[]}' }
  ],
  max_tokens: 4200,
  response_format: {
    type: 'json_schema',
    json_schema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title']
    }
  },
  temperature: 0.2
};

assert.equal(defaultDeepSeekSignalDraftModel, 'deepseek-v4-pro');
assert.equal(normalizeDeepSeekSignalDraftModel('deepseek-v4-flash'), 'deepseek-v4-flash');
assert.equal(isDeepSeekApiKeyConfigured(' secret '), true);
assert.equal(isDeepSeekApiKeyConfigured(''), false);
assert.throws(
  () => normalizeDeepSeekSignalDraftModel('deepseek-chat'),
  (error) => error.code === 'DEEPSEEK_MODEL_UNSUPPORTED'
);

await assert.rejects(
  createDeepSeekSignalDraftAdapter({ fetchImpl: async () => new Response() }).run('deepseek-v4-pro', request),
  (error) => error.code === 'DEEPSEEK_NOT_CONFIGURED' && error.retriable === false
);

const calls = [];
const adapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseEnvelope()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
});
const result = await adapter.run('deepseek-v4-pro', request);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, deepSeekChatCompletionsUrl);
assert.equal(calls[0].init.method, 'POST');
assert.equal(calls[0].init.headers.authorization, `Bearer ${apiKey}`);
assert.equal(calls[0].init.redirect, 'manual');
assert.equal(calls[0].init.body.includes(apiKey), false);
const sentBody = JSON.parse(calls[0].init.body);
assert.equal(sentBody.model, 'deepseek-v4-pro');
assert.equal(sentBody.max_tokens, 4200);
assert.equal(sentBody.temperature, 0.2);
assert.equal(sentBody.stream, false);
assert.deepEqual(sentBody.thinking, { type: 'disabled' });
assert.deepEqual(sentBody.response_format, { type: 'json_object' });
assert.match(sentBody.messages[0].content, /JSON Schema/);
assert.match(sentBody.messages[0].content, /"required":\["title"\]/);
assert.equal(result.provider, 'deepseek');
assert.equal(result.model, 'deepseek-v4-pro');
assert.equal(result.response, JSON.stringify(draftPayload));
assert.equal(result.usage.total_tokens, 200);
assert.equal(result.metadata.finishReason, 'stop');

const truncatedAdapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  fetchImpl: async () =>
    new Response(JSON.stringify(responseEnvelope('{"title":"unfinished"', 'length')), { status: 200 })
});
const truncatedResult = await truncatedAdapter.run('deepseek-v4-pro', request);
assert.equal(truncatedResult.response, '{"title":"unfinished"');
assert.equal(truncatedResult.metadata.finishReason, 'length');

const retryCalls = [];
const retryDelays = [];
let cancelledErrorBodies = 0;
const retryAdapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  retryDelayMs: 10,
  sleep: async (milliseconds) => retryDelays.push(milliseconds),
  fetchImpl: async () => {
    retryCalls.push(true);
    if (retryCalls.length === 1) {
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '0' }),
        body: {
          cancel: async () => {
            cancelledErrorBodies += 1;
          }
        }
      };
    }
    return new Response(JSON.stringify(responseEnvelope()), { status: 200 });
  }
});
const retried = await retryAdapter.run('deepseek-v4-pro', request);
assert.equal(retryCalls.length, 2);
assert.deepEqual(retryDelays, [0]);
assert.equal(cancelledErrorBodies, 1);
assert.equal(retried.provider, 'deepseek');

let oversizedRequestCalls = 0;
const oversizedRequestAdapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  fetchImpl: async () => {
    oversizedRequestCalls += 1;
    return new Response(JSON.stringify(responseEnvelope()), { status: 200 });
  }
});
await assert.rejects(
  oversizedRequestAdapter.run('deepseek-v4-pro', {
    ...request,
    messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }]
  }),
  (error) => error.code === 'DEEPSEEK_REQUEST_TOO_LARGE' && error.retriable === false && error.status === 413
);
assert.equal(oversizedRequestCalls, 0);

let authCalls = 0;
const authAdapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  fetchImpl: async () => {
    authCalls += 1;
    return new Response(JSON.stringify({ error: { message: `invalid key ${apiKey}` } }), { status: 401 });
  }
});
await assert.rejects(
  authAdapter.run('deepseek-v4-pro', request),
  (error) =>
    error.code === 'DEEPSEEK_AUTH_FAILED' &&
    error.retriable === false &&
    error.providerStatus === 401 &&
    !error.message.includes(apiKey)
);
assert.equal(authCalls, 1);

let rejectedCalls = 0;
const rejectedAdapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  fetchImpl: async () => {
    rejectedCalls += 1;
    return new Response(JSON.stringify({ error: { message: 'invalid request' } }), { status: 400 });
  }
});
await assert.rejects(
  rejectedAdapter.run('deepseek-v4-pro', request),
  (error) => error.code === 'DEEPSEEK_REQUEST_REJECTED' && error.retriable === false
);
assert.equal(rejectedCalls, 1);

let invalidResponseCalls = 0;
const invalidResponseAdapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  retryDelayMs: 0,
  sleep: async () => {},
  fetchImpl: async () => {
    invalidResponseCalls += 1;
    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
  }
});
await assert.rejects(
  invalidResponseAdapter.run('deepseek-v4-pro', request),
  (error) => error.code === 'DEEPSEEK_RESPONSE_INVALID' && error.retriable === true
);
assert.equal(invalidResponseCalls, 2);

let timeoutCalls = 0;
const timeoutAdapter = createDeepSeekSignalDraftAdapter({
  apiKey,
  maxAttempts: 1,
  fetchImpl: async () => {
    timeoutCalls += 1;
    const error = new Error('request aborted');
    error.name = 'AbortError';
    throw error;
  }
});
await assert.rejects(
  timeoutAdapter.run('deepseek-v4-pro', request),
  (error) => error.code === 'DEEPSEEK_TIMEOUT' && error.retriable === true && !error.message.includes(apiKey)
);
assert.equal(timeoutCalls, 1);

console.log('Signal DeepSeek adapter request limits, metadata, retry, and error checks passed.');
