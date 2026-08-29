import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(projectRoot, 'scripts/assets/station-cat-og.html');
const outputPath = resolve(projectRoot, 'public/images/social/station-cat-og.png');
const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

let chromePath = '';
for (const candidate of candidates) {
  try {
    await access(candidate);
    chromePath = candidate;
    break;
  } catch {
    // Try the next supported browser location.
  }
}

if (!chromePath) {
  throw new Error('Google Chrome or Chromium is required to capture the social preview. Set CHROME_BIN to its executable path.');
}

await mkdir(dirname(outputPath), { recursive: true });
await execFileAsync(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1200,630',
  `--screenshot=${outputPath}`,
  pathToFileURL(sourcePath).toString()
]);

console.log('Captured the 1200x630 Station Cat social preview.');
