// Operator-side helper only. Never import into a Worker or deploy a fixture route.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);
export const stagingOrigin = 'https://music-staging.wwwstationcat.org';
export const stagingRoot = fileURLToPath(new URL('../../', import.meta.url));
const configPath = 'ops/music-staging-app.jsonc';
export async function stagingConfig() {
  const config = JSON.parse((await readFile(resolve(stagingRoot, configPath), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.name, 'station-cat-music-staging');
  assert.equal(config.account_id, '3f5394e0ef5a531c63c0ceaa74262e0d');
  assert.deepEqual(config.routes, [{ pattern: new URL(stagingOrigin).hostname, custom_domain: true }]);
  assert.equal(config.vars.MUSIC_STAGING_EXPECTED_HOST, new URL(stagingOrigin).hostname);
  assert.equal(config.vars.MUSIC_CLEANUP_ENABLED, 'false');
  assert.equal(config.vars.MUSIC_ANALYTICS_ENABLED, 'false');
  assert.deepEqual(config.d1_databases.map(db => [db.binding, db.database_id]), [
    ['MUSIC_DB', '8fe1a3e1-7325-4d87-a7e6-2c51338b9158'],
    ['MUSIC_STAGING_MEMBERSHIP_DB', 'cb7bbad3-bfbb-457d-b2f2-6fd3b02df651']
  ]);
  assert.deepEqual(config.r2_buckets.map(db => [db.binding, db.bucket_name]), [['MUSIC_BUCKET', 'station-cat-music-staging-private']]);
  return config;
}

export async function stagingSql(sql, binding = 'MUSIC_DB') {
  await stagingConfig();
  assert.ok(['MUSIC_DB', 'MUSIC_STAGING_MEMBERSHIP_DB'].includes(binding));
  assert.ok(process.env.MUSIC_STAGING_WRANGLER_CLI, 'Set MUSIC_STAGING_WRANGLER_CLI to the installed Wrangler CLI file.');
  try {
    const { stdout } = await run(process.execPath, [process.env.MUSIC_STAGING_WRANGLER_CLI,
      'd1', 'execute', binding, '--remote', '--config', configPath, '--command', sql, '--json'],
    { cwd: stagingRoot, maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
    const results = JSON.parse(stdout);
    assert.ok(results.every(result => result.success));
    return results;
  } catch {
    // exec errors contain the entire argv/SQL. Never echo identity hashes or raw D1 errors.
    throw new Error(`Staging D1 operation failed (${binding}); inspect the protected Wrangler log locally.`);
  }
}

export const sqlValue = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
export async function privateJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export async function stagingClient() {
  await stagingConfig();
  const tokenPath = process.env.MUSIC_STAGING_ACCESS_TOKEN_FILE;
  assert.ok(tokenPath, 'Use cloudflared access token to save the staging application token in a mode-600 file.');
  const token = (await readFile(tokenPath, 'utf8')).trim();
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const dir = await mkdtemp(resolve(tmpdir(), 'music-staging-http-'));
  const request = async (path, { method = 'GET', headers = {}, body, json, anonymous = false, session } = {}) => {
    const url = new URL(path, stagingOrigin);
    assert.ok(path.startsWith('/') && url.origin === stagingOrigin && !url.username && !url.password);
    const id = randomUUID(), headerFile = resolve(dir, `${id}.headers`), output = resolve(dir, `${id}.body`), responseHeaders = resolve(dir, `${id}.response`);
    const values = { ...(anonymous ? {} : { 'cf-access-token': token }), ...headers };
    if (session !== undefined) {
      assert.match(session, /^[A-Za-z0-9_-]{1,512}$/);
      values.Cookie = `station_cat_music_staging_session=${session}`;
    }
    if (!['GET', 'HEAD'].includes(method)) {
      values.Origin = stagingOrigin;
      values['X-Requested-With'] = 'StationCatMusicAdmin';
      values['Idempotency-Key'] ||= randomUUID();
    }
    if (json !== undefined) { values['Content-Type'] = 'application/json'; body = Buffer.from(JSON.stringify(json)); }
    for (const [key, value] of Object.entries(values)) {
      assert.match(key, /^[A-Za-z0-9-]+$/);
      assert.ok(!/[\r\n]/.test(value));
    }
    await writeFile(headerFile, Object.entries(values).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n', { mode: 0o600 });
    const args = ['--silent', '--show-error', '--max-time', '30', '--header', `@${headerFile}`, '--dump-header', responseHeaders,
      '--output', output, '--write-out', '%{http_code}', ...(method === 'HEAD' ? ['--head'] : ['--request', method])];
    const bodyFile = resolve(dir, `${id}.input`);
    if (body !== undefined) { await writeFile(bodyFile, body, { mode: 0o600 }); args.push('--data-binary', `@${bodyFile}`); }
    try {
      // No redirect following: an expired Access session must not turn into a login-page 200.
      const { stdout } = await run('curl', [...args, url.href], { maxBuffer: 1024 * 1024, timeout: 35000 });
      // curl need not create an output file for a bodyless 304 response.
      const data = method === 'HEAD' || Number(stdout) === 304 ? Buffer.alloc(0) : await readFile(output);
      const blocks = (await readFile(responseHeaders, 'utf8')).trim().split(/\r?\n\r?\n/);
      const parsedHeaders = Object.fromEntries(blocks.at(-1).split(/\r?\n/).slice(1).map(line => {
        const i = line.indexOf(':'); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
      }));
      const result = { status: Number(stdout), headers: parsedHeaders, data };
      if (method !== 'HEAD' && data.length && parsedHeaders['content-type']?.includes('application/json')) result.json = JSON.parse(data);
      return result;
    } catch { throw new Error(`Staging HTTP request failed (${method} ${url.pathname}); no automatic mutation retry.`); }
    finally { await Promise.all([headerFile, output, responseHeaders, bodyFile].map(file => rm(file, { force: true }))); }
  };
  return { request, close: () => rm(dir, { recursive: true, force: true }) };
}
