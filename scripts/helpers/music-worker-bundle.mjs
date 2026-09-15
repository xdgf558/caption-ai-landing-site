import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { build } from 'esbuild';

// Match Wrangler's compiled WASM imports, rather than feeding Uint8Arrays to workerd.
export async function musicWorkerBundle(options) {
  const wasm = new Map();
  const bundle = await build({ ...options, bundle: true, format: 'esm', platform: 'browser',
    conditions: ['workerd', 'worker'], write: false,
    plugins: [{ name: 'wasm-modules', setup(builder) {
      builder.onResolve({ filter: /\.wasm$/ }, args => {
        const name = basename(args.path), contents = readFileSync(resolve(args.resolveDir, args.path));
        if (wasm.has(name) && !wasm.get(name).equals(contents)) throw new Error('WASM module name collision');
        wasm.set(name, contents); return { path: './' + name, external: true };
      });
    } }]
  });
  const modulesRoot = '/music-worker-test';
  return { modulesRoot, modules: [
    { type: 'ESModule', path: `${modulesRoot}/index.mjs`, contents: bundle.outputFiles[0].text },
    ...[...wasm].map(([name, contents]) => ({ type: 'CompiledWasm', path: `${modulesRoot}/${name}`, contents }))
  ] };
}
