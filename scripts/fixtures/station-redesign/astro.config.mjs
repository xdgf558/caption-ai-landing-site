import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

// A separate graph, like the existing music-player fixture. Never publish this output.
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  srcDir: './scripts/fixtures/station-redesign/site',
  publicDir: './.generated/station-redesign-no-public',
  outDir: './.generated/station-redesign-preview',
  cacheDir: './.generated/station-redesign-astro',
  trailingSlash: 'always',
});
