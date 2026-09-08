import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = fileURLToPath(new URL('../../../public/games/cat-life/src/vendor/cat-motion/', import.meta.url));
await mkdir(outDir, { recursive: true });
await build({ configFile: false, root, publicDir: false, build: { outDir, emptyOutDir: false, target: 'es2020', minify: true,
  lib: { entry: root + 'src/game-entry.js', name: 'StationCatMotion', formats: ['iife'], fileName: () => 'runtime.js' } } });
for (const name of ['torso', 'head', 'front-leg', 'back-leg', 'tail', 'mouth-open', 'kibble']) await copyFile(root + 'public/assets/' + name + '.webp', outDir + name + '.webp');
await copyFile(root + 'public/PIXI-LICENSE.txt', outDir + 'PIXI-LICENSE.txt');
