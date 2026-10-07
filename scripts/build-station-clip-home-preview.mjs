import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';

// Build a separate, never-deploy homepage graph from actual local T07 responses.
// Its media still goes through the anonymous loopback preview's D1/R2 handler.
const runtime = await createStationMusicRuntime({ videoCases: true });
const models = {};
try {
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const get = async path => {
      const response = await runtime.mf.dispatchFetch('https://wwwstationcat.org/fixture-pages-on/api/station/content/' + path);
      assert.equal(response.status, 200); return response.json();
    };
    const { home } = await get('home?locale=' + locale);
    assert(home.music && home.clips.length === 1);
    const { items } = await get('tracks/vip/clips?locale=' + locale + '&limit=4');
    models[locale] = { home, clips: items };
  }
} finally { await runtime.close(); }
await mkdir('.generated', { recursive: true });
await writeFile('.generated/station-clip-home-models.json', JSON.stringify(models));
const result = spawnSync(process.execPath, ['node_modules/astro/astro.js', 'build', '--config', 'scripts/fixtures/station-clips/astro.config.mjs'], { stdio: 'inherit' });
assert.equal(result.status, 0);
