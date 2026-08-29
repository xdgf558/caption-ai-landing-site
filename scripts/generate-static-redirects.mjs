import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const localizedNotFoundLocales = ['en', 'ja', 'zh-hans', 'zh-hant'];

for (const locale of localizedNotFoundLocales) {
  await copyFile(
    resolve(distRoot, locale, '404', 'index.html'),
    resolve(distRoot, locale, '404.html')
  );
}

console.log('Static trailing-slash redirects are resolved by the Worker after asset lookup.');
console.log(`Generated ${localizedNotFoundLocales.length} localized 404.html fallbacks.`);
