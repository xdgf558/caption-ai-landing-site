import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// workerd expects imported WASM to be a compiled module, not inlined bytes.
export async function bundleWasmWorker({ plugins = [], ...options }) {
  const wasm = new Map(), modulesRoot = '/wasm-worker-test';
  const output = await build({ bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd'], write: false, ...options,
    plugins: [...plugins, { name: 'compiled-wasm', setup(builder) { builder.onResolve({ filter: /\.wasm$/ }, args => {
      const name = basename(args.path), contents = readFileSync(resolve(args.resolveDir, args.path));
      if (wasm.has(name) && !wasm.get(name).equals(contents)) throw new Error('Conflicting WASM module: ' + name);
      wasm.set(name, contents); return { path: './' + name, external: true };
    }); } }] });
  return { modulesRoot, modules: [{ type: 'ESModule', path: modulesRoot + '/index.mjs', contents: output.outputFiles[0].text },
    ...[...wasm].map(([name, contents]) => ({ type: 'CompiledWasm', path: modulesRoot + '/' + name, contents }))] };
}
