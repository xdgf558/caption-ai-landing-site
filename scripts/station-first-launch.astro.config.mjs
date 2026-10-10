import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

// Only build-station-first-launch.mjs finalizes this directory for review.
export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  site: 'https://wwwstationcat.org',
  outDir: './.generated/station-first-launch-assets',
  cacheDir: './.generated/station-first-launch-astro',
  trailingSlash: 'always',
});
