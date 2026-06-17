import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, '.generated/protected-serial-content/manifest.json');

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  console.error(`Unable to read ${path.relative(rootDir, manifestPath)}.`);
  console.error('Run npm run build:novel-payment-config before uploading protected serial content.');
  throw error;
}

const bucket = process.env.CONTENT_BUCKET_NAME || manifest.bucket || 'station-cat-content';
const files = Array.isArray(manifest.files) ? manifest.files : [];

if (!files.length) {
  console.log('No protected serial content files to upload.');
  process.exit(0);
}

for (const file of files) {
  const key = String(file.key || '').replace(/^\/+/, '');
  const localPath = String(file.localPath || '');
  if (!key || !localPath) {
    throw new Error(`Invalid protected content manifest entry: ${JSON.stringify(file)}`);
  }

  const target = `${bucket}/${key}`;
  console.log(`Uploading ${localPath} -> r2://${target}`);
  await run('npx', ['--yes', 'wrangler@latest', 'r2', 'object', 'put', target, '--file', localPath]);
}

console.log(`Uploaded ${files.length} protected serial content file(s) to ${bucket}.`);
