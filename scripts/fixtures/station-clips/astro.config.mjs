import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('../../../', import.meta.url)),
  srcDir: './scripts/fixtures/station-clips/site', publicDir: './.generated/station-clips-no-public',
  outDir: './.generated/station-clip-home-preview', cacheDir: './.generated/station-clip-home-astro', trailingSlash: 'always' });
