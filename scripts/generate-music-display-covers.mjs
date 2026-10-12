// Run before a music production release. Only anonymous public covers are read.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const maxBytes = 5242880, maxSources = 1000, maxPages = 1000;
const legacyCover = /^\/api\/music\/(?:tracks\/[a-f0-9-]{36}|collections\/[a-z0-9-]{1,100})\/cover\?v=[1-9][0-9]*$/;
const websiteCover = /^\/api\/station\/content\/assets\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function read(url, max, fetchImpl) {
  let response;
  for(let attempt=0; attempt<3; attempt++) {
    response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if(response.status!==503 || attempt===2) break;
    await response.body?.cancel(); await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(response.status, 200, url);
  const reader = response.body.getReader(), parts = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    length += value.length; assert.ok(length <= max, 'Response exceeds budget'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}
export async function generateMusicDisplayCovers({ origin = 'https://wwwstationcat.org', outputRoot = process.cwd(), fetchImpl = fetch, pageSize = 50 } = {}) {
  assert.ok(Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 50);
  const paths = new Set(), add = (items, pattern) => {
    assert.ok(Array.isArray(items), 'Invalid public cover catalogue');
    for (const item of items) {
      assert.ok(item && typeof item === 'object' && !Array.isArray(item));
      if (item.coverUrl == null) continue;
      assert.match(item.coverUrl, pattern); paths.add(item.coverUrl);
      assert.ok(paths.size <= maxSources, 'Public cover source budget exceeded');
    }
  };
  // The website publication pointer may differ from the old audio publication,
  // including a website-only song whose music_tracks lifecycle is still draft.
  // Follow the source cursor even when a filtered page has no visible items.
  const cursors = new Set(); let cursor = null;
  for (let page = 0; ; page++) {
    assert.ok(page < maxPages, 'Website cover pagination budget exceeded');
    const path = '/api/station/content/tracks?locale=zh-Hans&limit=' + pageSize + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const data = JSON.parse(await read(origin + path, 2097152, fetchImpl));
    assert.equal(data.schemaVersion, 1); add(data.items, websiteCover);
    assert.ok(data.items.length <= pageSize, 'Website cover page exceeds requested size');
    if (data.nextCursor === null) break;
    assert.equal(typeof data.nextCursor, 'string'); assert.match(data.nextCursor, /^[A-Za-z0-9_-]{1,512}$/);
    assert.ok(!cursors.has(data.nextCursor), 'Website cover cursor did not advance');
    cursors.add(data.nextCursor); cursor = data.nextCursor;
  }
  const catalog = JSON.parse(await read(origin + '/api/music/catalog?locale=zh-Hans', 2097152, fetchImpl));
  assert.equal(catalog.schemaVersion, 2); add(catalog.tracks, legacyCover); add(catalog.collections, legacyCover);
  const manifest = {}, report = [], seen = new Map();
  await mkdir(resolve(outputRoot, 'public/api/music/__cover-files'), { recursive: true });
  for (const path of paths) {
    // Website asset URLs (without size) and versioned legacy URLs return the
    // original bytes. The source hash, rather than either publication ID, keys
    // the manifest, so shared artwork is encoded only once.
    const original = await read(origin + path, maxBytes, fetchImpl), sourceHash = hash(original);
    let entry = seen.get(sourceHash);
    if (!entry) {
      entry = { sourceBytes: original.length };
      const input = sharp(original, { limitInputPixels: 16777216 }), meta = await input.metadata();
      const save = async (bytes, contentType, extension) => {
        if (bytes.length >= original.length) return null;
        const sha256 = hash(bytes), path = `/api/music/__cover-files/${sha256}.${extension}`;
        await writeFile(resolve(outputRoot, 'public' + path), bytes);
        return { path, sha256, bytes: bytes.length, sourceBytes: original.length, contentType };
      };
      const pipeline = input.clone().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true });
      const display = await save(await (meta.hasAlpha ? pipeline.webp({ quality: 82 }) : pipeline.jpeg({ quality: 82 })).toBuffer(),
        meta.hasAlpha ? 'image/webp' : 'image/jpeg', meta.hasAlpha ? 'webp' : 'jpg');
      const card = await save(await input.clone().resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(), 'image/webp', 'webp');
      // Each size earns its place independently. A card-only entry is valid;
      // the existing delivery handler falls back to the original for display.
      if (display) Object.assign(entry, display);
      if (card) entry.card = card;
      if (display || card) manifest[sourceHash] = entry;
      seen.set(sourceHash, entry);
    }
    report.push({ publicSource: path, sourceSha256: sourceHash, sourceBytes: original.length,
      displayBytes: entry.bytes ?? null, cardBytes: entry.card?.bytes ?? null });
  }
  // Only replace the manifest after both catalogues and every image succeeded.
  await mkdir(resolve(outputRoot, 'src/music'), { recursive: true });
  await writeFile(resolve(outputRoot, 'src/music/displayCoverManifest.js'), '// Generated by npm run build:music:display-covers. No runtime image encoding.\nexport const musicDisplayCoverManifest = Object.freeze(' + JSON.stringify(manifest, null, 2) + ');\n');
  await mkdir(resolve(outputRoot, '.generated'), { recursive: true });
  await writeFile(resolve(outputRoot, '.generated/music-display-cover-generation.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
    method: 'Anonymous current website covers and versioned legacy track/collection covers; offline resize, no production writes.', items: report }, null, 2) + '\n');
  return { manifest, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifest } = await generateMusicDisplayCovers();
  console.log(`Prepared ${Object.keys(manifest).length} public display covers.`);
}
