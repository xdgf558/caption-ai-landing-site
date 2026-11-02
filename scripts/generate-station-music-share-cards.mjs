// Offline only: input is an operator-reviewed snapshot of public release copy.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stationMusicShareAssetPath } from '../src/redesign/musicShareAssets.js';
import { safeDescription, stationMusicShareLabels } from '../src/redesign/musicSharePage.js';
import { normalizeMusicCardCover } from '../src/music/shareCardRender.js';
import { renderStationMusicShareCard } from '../src/redesign/musicShareRender.js';
import { MUSIC_SHARE_FONT_BYTES, MUSIC_SHARE_FONT_SHA256 } from '../src/music/shareCard.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function generateStationMusicShareCards(targets, outputRoot) {
  assert(Array.isArray(targets) && targets.length <= 4000, 'Invalid release snapshot');
  const font = await readFile(resolve(source, 'public/fonts/music/NotoSerifSC-Bold.otf'));
  const icon = await readFile(resolve(source, 'public/images/station-music-app/icon.webp'));
  assert.equal(font.length, MUSIC_SHARE_FONT_BYTES); assert.equal(sha(font), MUSIC_SHARE_FONT_SHA256);
  assert.equal(sha(icon), '09982b6d542f43087aa196e15c17bdd2640ea0bb2a2d56eadbc6118fa5cae9de');
  const items = [], seen = new Set();
  for (const entry of targets) {
    assert(['tracks','albums'].includes(entry.kind));
    assert(typeof entry.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) && entry.slug.length <= 100);
    assert(['zh-Hans','zh-Hant','en','ja'].includes(entry.locale));
    const copy = stationMusicShareLabels[entry.locale];
    assert(typeof entry.title === 'string' && entry.title.trim() && entry.title.length <= 200);
    assert(typeof entry.artist === 'string' && entry.artist.length <= 120);
    assert(typeof entry.description === 'string' && entry.description.length <= 32000);
    const target = {kind:entry.kind === 'albums' ? 'album' : 'track', title:entry.title, artist:entry.artist,
      description:safeDescription(entry.description), cover:null};
    let cover = null;
    if (entry.cover) {
      assert(typeof entry.cover.path === 'string' && /^[a-f0-9]{64}$/.test(entry.cover.sha256));
      const bytes = await readFile(entry.cover.path);
      assert.equal(sha(bytes), entry.cover.sha256, 'Cover source differs from release snapshot');
      cover = normalizeMusicCardCover(bytes, entry.cover.contentType);
      target.cover = {sha256:entry.cover.sha256};
    }
    const path = await stationMusicShareAssetPath(target, entry.kind, entry.slug, entry.locale);
    assert(!seen.has(path), 'Duplicate release target'); seen.add(path);
    const image = await renderStationMusicShareCard(target, copy, cover, font, icon);
    assert(image.length > 0 && image.length <= 5242880, 'Rendered card exceeds image budget');
    const output = resolve(outputRoot, 'public' + path);
    await mkdir(dirname(output), {recursive:true}); await writeFile(output, image);
    items.push({kind:entry.kind, slug:entry.slug, locale:entry.locale, path, bytes:image.length, sha256:sha(image),
      sourceCoverSha256:entry.cover?.sha256 || null});
  }
  await mkdir(resolve(outputRoot, '.generated'), {recursive:true});
  await writeFile(resolve(outputRoot, '.generated/station-music-share-cards.json'), JSON.stringify({generatedAt:new Date().toISOString(), items}, null, 2) + '\n');
  return items;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'Usage: node generate-station-music-share-cards.mjs snapshot.json output-root');
  const targets = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const items = await generateStationMusicShareCards(targets, resolve(process.argv[3]));
  console.log(`Prepared ${items.length} fingerprinted share cards. No production writes.`);
}
