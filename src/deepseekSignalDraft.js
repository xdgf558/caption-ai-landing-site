export const deepSeekChatCompletionsUrl = 'https://api.deepseek.com/chat/completions';
export const defaultDeepSeekSignalDraftModel = 'deepseek-v4-pro';

const supportedDeepSeekModels = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
const defaultTimeoutMs = 30_000;
const defaultMaxAttempts = 2;
const defaultRetryDelayMs = 250;
const maxRequestBytes = 2 * 1024 * 1024;
const maxResponseBytes = 2 * 1024 * 1024;

const cleanText = (value, maxLength = 1000) => String(value ?? '').trim().slice(0, maxLength);

const deepSeekError = (code, message, options = {}) => {
  const error = new Error(message);
  error.code = code;
  error.status = options.status || 502;
  error.retriable = options.retriable === true;
  if (Number.isInteger(options.providerStatus)) error.providerStatus = options.providerStatus;
  return error;
};

const normalizeInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const normalizeDeepSeekSignalDraftModel = (value) => {
  const model = cleanText(value || defaultDeepSeekSignalDraftModel, 80);
  if (!supportedDeepSeekModels.has(model)) {
    throw deepSeekError('DEEPSEEK_MODEL_UNSUPPORTED', 'DeepSeek 模型配置无效。', {
      status: 500,
      retriable: false
    });
  }
  return model;
};

export const isDeepSeekApiKeyConfigured = (value) => cleanText(value, 512).length > 0;

const normalizeMessages = (value) => {
  if (!Array.isArray(value) || !value.length) {
    throw deepSeekError('DEEPSEEK_REQUEST_INVALID', 'DeepSeek 请求缺少消息内容。', {
      status: 500,
      retriable: false
    });
  }
  return value.map((message) => {
    const role = cleanText(message?.role, 20);
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!['assistant', 'system', 'user'].includes(role) || !content.trim()) {
      throw deepSeekError('DEEPSEEK_REQUEST_INVALID', 'DeepSeek 请求消息格式无效。', {
        status: 500,
        retriable: false
      });
    }
    return { role, content };
  });
};

const addJsonSchemaInstruction = (messages, responseFormat) => {
  const schema = responseFormat?.type === 'json_schema' ? responseFormat.json_schema : null;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return messages;
  const instruction = `Return one valid JSON object matching this JSON Schema exactly: ${JSON.stringify(schema)}`;
  const systemIndex = messages.findIndex((message) => message.role === 'system');
  if (systemIndex === -1) return [{ role: 'system', content: instruction }, ...messages];
  return messages.map((message, index) =>
    index === systemIndex ? { ...message, content: `${message.content}\n\n${instruction}` } : message
  );
};

const readResponseTextLimited = async (response) => {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
      throw deepSeekError('DEEPSEEK_RESPONSE_TOO_LARGE', 'DeepSeek 返回内容超过安全限制。', {
        retriable: false
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxResponseBytes) {
        await reader.cancel();
        throw deepSeekError('DEEPSEEK_RESPONSE_TOO_LARGE', 'DeepSeek 返回内容超过安全限制。', {
          retriable: false
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const cancelResponseBody = async (response) => {
  if (!response?.body || typeof response.body.cancel !== 'function') return;
  try {
    await response.body.cancel();
  } catch {
    // The provider status is still authoritative if its body cannot be cancelled.
  }
};

const parseResponseEnvelope = (text) => {
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
};

const retryDelayFromResponse = (response, baseDelayMs, attempt) => {
  const retryAfter = cleanText(response.headers.get('retry-after'), 80);
  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2000, Math.round(seconds * 1000));
  const dateDelay = Date.parse(retryAfter) - Date.now();
  if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(2000, dateDelay);
  return Math.min(2000, baseDelayMs * 2 ** attempt);
};

const providerErrorFromResponse = (response) => {
  if ([401, 403].includes(response.status)) {
    return deepSeekError('DEEPSEEK_AUTH_FAILED', 'DeepSeek API 鉴权失败，请检查 Worker Secret。', {
      status: 503,
      retriable: false,
      providerStatus: response.status
    });
  }
  if (response.status === 402) {
    return deepSeekError('DEEPSEEK_BALANCE_REQUIRED', 'DeepSeek API 余额不足，请充值后重试。', {
      status: 503,
      retriable: false,
      providerStatus: response.status
    });
  }
  const retriable = response.status === 408 || response.status === 429 || response.status >= 500;
  return deepSeekError(
    retriable ? 'DEEPSEEK_TEMPORARILY_UNAVAILABLE' : 'DEEPSEEK_REQUEST_REJECTED',
    retriable ? 'DeepSeek API 暂时不可用，请稍后重试。' : 'DeepSeek API 拒绝了当前请求。',
    { status: retriable ? 503 : 502, retriable, providerStatus: response.status }
  );
};

const buildRequestBody = (model, request) => {
  const messages = addJsonSchemaInstruction(normalizeMessages(request?.messages), request?.response_format);
  const body = {
    model,
    messages,
    response_format: { type: 'json_object' },
    stream: false,
    thinking: { type: 'disabled' }
  };
  const maxTokens = normalizeInteger(request?.max_tokens, 3200, 1, 64_000);
  body.max_tokens = maxTokens;
  const temperature = Number(request?.temperature);
  if (Number.isFinite(temperature)) body.temperature = Math.min(2, Math.max(0, temperature));
  return body;
};

const serializeRequestBody = (requestBody) => {
  const serialized = JSON.stringify(requestBody);
  if (new TextEncoder().encode(serialized).byteLength > maxRequestBytes) {
    throw deepSeekError('DEEPSEEK_REQUEST_TOO_LARGE', 'DeepSeek 请求内容超过安全限制。', {
      status: 413,
      retriable: false
    });
  }
  return serialized;
};

export const createDeepSeekSignalDraftAdapter = (options = {}) => {
  const apiKey = cleanText(options.apiKey, 512);
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = normalizeInteger(options.timeoutMs, defaultTimeoutMs, 1000, 120_000);
  const maxAttempts = normalizeInteger(options.maxAttempts, defaultMaxAttempts, 1, 3);
  const retryDelayMs = normalizeInteger(options.retryDelayMs, defaultRetryDelayMs, 0, 2000);

  return {
    provider: 'deepseek',
    async run(model, request) {
      if (!isDeepSeekApiKeyConfigured(apiKey)) {
        throw deepSeekError('DEEPSEEK_NOT_CONFIGURED', 'DeepSeek API 尚未配置，当前继续使用 Workers AI。', {
          status: 503,
          retriable: false
        });
      }
      if (typeof fetchImpl !== 'function') {
        throw deepSeekError('DEEPSEEK_FETCH_UNAVAILABLE', 'DeepSeek 请求客户端不可用。', {
          status: 500,
          retriable: false
        });
      }
      const selectedModel = normalizeDeepSeekSignalDraftModel(model);
      const requestBody = buildRequestBody(selectedModel, request);
      const serializedRequestBody = serializeRequestBody(requestBody);
      let lastError = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(deepSeekChatCompletionsUrl, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json'
            },
            body: serializedRequestBody,
            redirect: 'error',
            signal: controller.signal
          });
          if (!response.ok) {
            await cancelResponseBody(response);
            const error = providerErrorFromResponse(response);
            if (error.retriable && attempt + 1 < maxAttempts) {
              lastError = error;
              await sleep(retryDelayFromResponse(response, retryDelayMs, attempt));
              continue;
            }
            throw error;
          }

          const text = await readResponseTextLimited(response);
          const envelope = parseResponseEnvelope(text);
          const choice = envelope?.choices?.[0];
          const content = choice?.message?.content;
          if (typeof content !== 'string' || !content.trim()) {
            const error = deepSeekError('DEEPSEEK_RESPONSE_INVALID', 'DeepSeek 返回的响应结构无效。', {
              status: 502,
              retriable: true
            });
            if (attempt + 1 < maxAttempts) {
              lastError = error;
              await sleep(Math.min(2000, retryDelayMs * 2 ** attempt));
              continue;
            }
            throw error;
          }

          return {
            id: cleanText(envelope.id, 160),
            model: cleanText(envelope.model || selectedModel, 160),
            provider: 'deepseek',
            response: content,
            usage: envelope.usage && typeof envelope.usage === 'object' ? envelope.usage : null,
            metadata: {
              finishReason: cleanText(choice?.finish_reason, 80) || null
            }
          };
        } catch (error) {
          if (error?.name === 'AbortError') {
            lastError = deepSeekError('DEEPSEEK_TIMEOUT', 'DeepSeek API 请求超时，请稍后重试。', {
              status: 504,
              retriable: true
            });
          } else {
            lastError = error?.code
              ? error
              : deepSeekError('DEEPSEEK_NETWORK_ERROR', 'DeepSeek API 网络请求失败，请稍后重试。', {
                  status: 503,
                  retriable: true
                });
          }
          if (!lastError.retriable || attempt + 1 >= maxAttempts) throw lastError;
          await sleep(Math.min(2000, retryDelayMs * 2 ** attempt));
        } finally {
          clearTimeout(timer);
        }
      }

      throw lastError || deepSeekError('DEEPSEEK_NETWORK_ERROR', 'DeepSeek API 网络请求失败，请稍后重试。', {
        status: 503,
        retriable: true
      });
    }
  };
};
