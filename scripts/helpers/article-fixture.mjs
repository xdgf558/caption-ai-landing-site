import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Ephemeral D1/R2 substitutes for local tests, never connected to Cloudflare.
export function createArticleFixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0007_backend_content_platform.sql', import.meta.url), 'utf8'));
  const prepare = (sql) => {
    let params = [];
    const statement = sqlite.prepare(sql);
    return {
      bind(...values) { params = values; return this; },
      async first() { return statement.get(...params) || null; },
      async all() { return { results: statement.all(...params) }; },
      async run() { const result = statement.run(...params); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
    };
  };
  const objects = new Map();
  const bucket = {
    async put(key, body, options = {}) {
      const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, options });
      return { key, size: bytes.length, etag: 'local-fixture' };
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { body: object.bytes, size: object.bytes.length, httpEtag: '"local-fixture"', text: async () => object.bytes.toString(),
        writeHttpMetadata(headers) { for (const [key, value] of Object.entries(object.options.httpMetadata || {})) headers.set(key === 'contentType' ? 'content-type' : 'cache-control', value); } };
    }
  };
  const env = { WAITLIST_DB: { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } }, CONTENT_BUCKET: bucket,
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) } };
  return { env, sqlite, objects };
}
