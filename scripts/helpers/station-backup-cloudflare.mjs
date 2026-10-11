import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { realpath, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PRODUCTION_ACCOUNT_ID } from '../../src/mobile/environment.js';

const run = promisify(execFile);
const apiRoot = 'https://api.cloudflare.com/client/v4/accounts/' + PRODUCTION_ACCOUNT_ID;
const fail = code => { throw new Error('STATION_BACKUP_' + code); };

// CLI-only control-plane adapter. Tokens are obtained through Wrangler and
// retained in memory. This module is never imported by a deployed Worker.
export async function backupCloudflare(wranglerPath, logDirectory) {
  const cli = await realpath(wranglerPath);
  const require = createRequire(cli);
  const packagePath = require.resolve('wrangler/package.json');
  const version = JSON.parse(await readFile(packagePath)).version;
  if (version !== '4.131.1') fail('WRANGLER_VERSION');
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const env = { ...process.env, WRANGLER_LOG_PATH: logDirectory, WRANGLER_SEND_METRICS: 'false' };
  const { stdout } = await run(process.execPath, [cli, 'auth', 'token', '--json'], {
    env, cwd: logDirectory, timeout: 60000, maxBuffer: 1024 * 1024,
  }).catch(() => fail('AUTHENTICATION'));
  let token;
  try { token = JSON.parse(stdout).token; } catch { fail('AUTHENTICATION'); }
  if (typeof token !== 'string' || token.length < 20) fail('AUTHENTICATION');
  const { fetch, request: rawRequest, EnvHttpProxyAgent } = await import(require.resolve('undici'));
  const dispatcher = new EnvHttpProxyAgent();
  async function request(path, { query = {}, metadataSql, headers = {}, signal } = {}) {
    if (!path.startsWith('/') || path.includes('://') || /[\r\n?#]/.test(path)) fail('API_PATH');
    const url = new URL(apiRoot + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    if (!url.href.startsWith(apiRoot + '/')) fail('API_PATH');
    const response = await fetch(url, {
      method: metadataSql ? 'POST' : 'GET', redirect: 'error', dispatcher,
      signal: signal || AbortSignal.timeout(120000),
      headers: { Authorization: 'Bearer ' + token, ...headers, ...(metadataSql ? { 'Content-Type': 'application/json' } : {}) },
      ...(metadataSql ? { body: JSON.stringify({ sql: metadataSql }) } : {}),
    }).catch(() => fail('API_TRANSPORT'));
    if (!response.ok) { await response.body?.cancel(); fail('API_HTTP_' + response.status); }
    return response;
  }
  async function json(path, options) {
    const response = await request(path, options);
    const bytes = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) { await response.body?.cancel().catch(() => {}); fail('METADATA_SIZE'); }
      bytes.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(bytes)); } catch { fail('API_JSON'); }
    if (body.success !== true) fail('API_RESULT');
    return body;
  }
  return {
    version,
    json,
    async schema(databaseId) {
      if (!/^[0-9a-f-]{36}$/.test(databaseId)) fail('DATABASE_ID');
      const data = await json('/d1/database/' + databaseId + '/query', {
        metadataSql: "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name",
      });
      if (data.result?.length !== 1 || data.result[0].success !== true || !Array.isArray(data.result[0].results)) fail('SCHEMA');
      return data.result[0].results;
    },
    async object(bucket, key, signal) {
      // The management API requires literal slash separators. Local filenames
      // are hashes; object keys can never become filesystem paths.
      if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucket) ||
          typeof key !== 'string' || !key || key.split('/').some(part => part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(key)) fail('OBJECT_KEY');
      const url = apiRoot + '/r2/buckets/' + bucket + '/objects/' + key.split('/').map(encodeURIComponent).join('/');
      // fetch() transparently decodes Content-Encoding. R2 backups need the
      // stored bytes, including objects whose metadata declares gzip.
      const response = await rawRequest(url, { method: 'GET', dispatcher, signal,
        headersTimeout: 120000, bodyTimeout: 120000,
        headers: { Authorization: 'Bearer ' + token, 'Accept-Encoding': 'identity' },
      }).catch(() => fail('API_TRANSPORT'));
      if (response.statusCode !== 200) { response.body.destroy(); fail('API_HTTP_' + response.statusCode); }
      return { headers: new Headers(Object.entries(response.headers).flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).filter(value => value !== undefined).map(value => [key, value]))),
        body: response.body };
    },
    async exportDatabase(config, binding, output, log) {
      if (!['WAITLIST_DB', 'MUSIC_DB'].includes(binding)) fail('DATABASE_BINDING');
      // Full supported export; no table limit or schema-only fallback. This
      // operation is called only after the operator's maintenance window gate.
      const args = [cli, 'd1', 'export', binding, '--remote', '--config', config, '--output', output, '--skip-confirmation'];
      const result = await run(process.execPath, args, { env, cwd: dirname(config), timeout: 600000, maxBuffer: 16 * 1024 * 1024 })
        .catch(async error => { await writeFile(log, (error.stdout || '') + (error.stderr || ''), { mode: 0o600 }); fail('EXPORT_FAILED'); });
      // Wrangler logs a signed download URL. Keep both streams private.
      await writeFile(log, result.stdout + result.stderr, { mode: 0o600 });
    },
    async close() { token = undefined; await dispatcher.close(); },
  };
}
