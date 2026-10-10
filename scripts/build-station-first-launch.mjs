import { readFile, readdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { releaseRoot } from './build-station-release-candidate.mjs';
import { checkFirstLaunchScope, firstLaunchHtmlAllowed } from './helpers/station-first-launch.mjs';

export const firstLaunchAssets = join(releaseRoot, '.generated/station-first-launch-assets');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compatibilityFiles = ['src/generated/novelPaymentConfig.js', 'src/generated/protectedSerialContent.js'];
async function filesIn(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error('STATION_FIRST_LAUNCH_ASSET_TYPE');
  }
  return files.sort();
}
async function runAstro() {
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(releaseRoot, 'node_modules/astro/astro.js'), 'build',
      '--config', 'scripts/station-first-launch.astro.config.mjs'], { cwd: releaseRoot, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', resolve);
  });
  if (status !== 0) throw new Error('STATION_FIRST_LAUNCH_ASTRO');
}
export async function buildFirstLaunch() {
  if (process.env.ALLOW_EMPTY_SERIAL_CONTENT) throw new Error('STATION_FIRST_LAUNCH_DEVELOPMENT_BUILD');
  const scope = checkFirstLaunchScope(JSON.parse(await readFile(join(releaseRoot, 'ops/station-first-launch.json'))));
  // Preserve tracked compatibility manifests for historical settlements. This
  // build deliberately retires static fiction; it never regenerates empty
  // prices/body pointers or uploads/deletes a protected-content object.
  const compatibility = await Promise.all(compatibilityFiles.map(async path => ({ path, sha256: sha(await readFile(join(releaseRoot, path))) })));
  await runAstro();
  for (const row of compatibility) if (sha(await readFile(join(releaseRoot, row.path))) !== row.sha256) throw new Error('STATION_FIRST_LAUNCH_COMPATIBILITY_CHANGED');
  for (const locale of ['en', 'ja', 'zh-hans', 'zh-hant']) {
    await copyFile(join(firstLaunchAssets, locale, '404/index.html'), join(firstLaunchAssets, locale, '404.html'));
  }
  const removed = [];
  for (const file of await filesIn(firstLaunchAssets)) {
    const path = '/' + relative(firstLaunchAssets, file).replaceAll('\\', '/');
    const page = path.replace(/index\.html$/, '').replace(/\.html$/, '/');
    if ((path.endsWith('.html') && path !== '/404.html' && !firstLaunchHtmlAllowed(page)) ||
      path === '/_redirects' || path === '/robots.txt' || /\/(?:sitemap[^/]*\.xml|sitemaps\/)/.test(path)) {
      await rm(file); removed.push(path);
    }
  }
  // Redirects, robots and sitemaps are owned by the Worker after cutover.
  // The static fallback also remains unindexable if an upstream route bypasses it.
  await writeFile(join(firstLaunchAssets, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  const entries = await Promise.all((await filesIn(firstLaunchAssets)).map(async file => {
    const bytes = await readFile(file);
    return { path: relative(firstLaunchAssets, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) };
  }));
  for (const file of entries.filter(row => row.path.endsWith('.html'))) {
    const page = '/' + file.path.replace(/index\.html$/, '').replace(/\.html$/, '/');
    if (file.path !== '404.html' && !firstLaunchHtmlAllowed(page)) throw new Error('STATION_FIRST_LAUNCH_LEGACY_HTML');
  }
  const report = { schemaVersion: 1, profile: scope.profile, productionDeployed: false, compatibility,
    removedHtml: removed.filter(path => path.endsWith('.html')), staticRedirectsRemoved: removed.includes('/_redirects'),
    htmlCount: entries.filter(row => row.path.endsWith('.html')).length, files: entries };
  await writeFile(join(releaseRoot, '.generated/station-first-launch-manifest.json'), JSON.stringify(report, null, 2) + '\n');
  return { profile: scope.profile, productionDeployed: false, htmlCount: report.htmlCount,
    removedHtmlCount: report.removedHtml.length, fileCount: entries.length, compatibilityPreserved: true };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildFirstLaunch())); }
  catch (error) { console.error(error?.message || 'STATION_FIRST_LAUNCH_BUILD'); process.exitCode = 1; }
}
