import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  srcDir: './scripts/fixtures/station-handoff/site/src',
  publicDir: fileURLToPath(new URL('../../../public/', import.meta.url)),
  outDir: fileURLToPath(new URL('../../../.generated/station-game-handoff-preview/', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../.generated/station-game-handoff-cache/', import.meta.url)),
  trailingSlash: 'always',
  vite: { server: { fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } } }
});
