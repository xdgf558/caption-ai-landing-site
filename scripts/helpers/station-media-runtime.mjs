import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { stationMediaMigrationStatements, seedStationMediaDrafts, mediaActor } from './station-media-fixture.mjs';

const team = 'https://station-media-fixture.cloudflareaccess.com', audience = 'station-media-fixture-only';
export async function createStationMediaRuntime({ assets = () => new Response(null, { status: 404 }), quota = 512 * 1048576 } = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'station-media-fixture-key', alg: 'RS256', use: 'sig' };
  const token = async (patch = {}) => {
    const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const raw = b64({ alg: 'RS256', kid: jwk.kid }) + '.' + b64({ iss: team, aud: [audience], email: mediaActor, exp: Math.floor(Date.now()/1000) + 3600, ...patch });
    return raw + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(raw))).toString('base64url');
  };
  const output = await build({ entryPoints: [fileURLToPath(new URL('station-media-runtime-worker.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wasm': 'binary' } });
  const mf = new Miniflare({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-05-17',
    host: '127.0.0.1', port: 0, d1Databases: { MUSIC_DB: 'station-media-local', WAITLIST_DB: 'station-media-readers-local', EMPTY_DB: 'station-media-empty-local' },
    r2Buckets: { MUSIC_BUCKET: 'station-media-local' },
    bindings: { MUSIC_UPLOADS_ENABLED: 'true', STATION_MEDIA_UPLOADS_ENABLED: 'true', CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: audience,
      ADMIN_ALLOWED_EMAILS: mediaActor + ',other-media-fixture@example.test' }, serviceBindings: { ASSETS: assets },
    outboundService: request => new URL(request.url).href === team + '/cdn-cgi/access/certs'
      ? Response.json({ keys: [jwk] }) : new Response('Outbound network disabled in local media fixture', { status: 403 }) });
  try {
    const db = await mf.getD1Database('MUSIC_DB'), bucket = await mf.getR2Bucket('MUSIC_BUCKET');
    for (const g of stationMediaMigrationStatements()) for (let i = 0; i < g.statements.length; i += 20) {
      try { await db.batch(g.statements.slice(i, i + 20).map(sql => db.prepare(sql))); }
      catch (error) { throw new Error('Local fixture migration ' + g.name + ', batch ' + i + ': ' + error.message, { cause: error }); }
    }
    await db.prepare("UPDATE music_settings SET value_json=? WHERE key='storageQuotaBytes'").bind(JSON.stringify(quota)).run();
    const content = await seedStationMediaDrafts(db);
    return { mf, db, bucket, content, token, actorToken: await token(), async close() { await mf.dispose(); } };
  } catch (error) { await mf.dispose(); throw error; }
}
