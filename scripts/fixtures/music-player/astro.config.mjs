import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
// Separate build graph: no sample page/art/audio is emitted by the site build.
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  srcDir: './scripts/fixtures/music-player/site',
  publicDir: './.generated/music-player-no-public',
  outDir: './.generated/music-player-preview',
  cacheDir: './.generated/music-player-astro',
  trailingSlash: 'always'
});
