import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { rehearseStationRelease } from './helpers/station-release-rehearsal.mjs';

if (process.argv.length !== 2) throw new Error('Fixed ephemeral local rehearsal only; no remote or database arguments.');
const output = new URL('../.generated/station-release-rehearsal/', import.meta.url);
const { report, backups, objectManifest } = await rehearseStationRelease();
await mkdir(output, { recursive: true });
for (const [phase, databases] of Object.entries(backups)) for (const [name, backup] of Object.entries(databases)) {
  await writeFile(new URL(phase + '-' + name + '-synthetic.sql', output), backup.sql, { mode: 0o600 });
}
await writeFile(new URL('rehearsal.json', output), JSON.stringify(report, null, 2) + '\n');
await writeFile(new URL('synthetic-object-manifest.json', output), JSON.stringify(objectManifest, null, 2) + '\n');
console.log(JSON.stringify({ output: fileURLToPath(output), ...report }, null, 2));
