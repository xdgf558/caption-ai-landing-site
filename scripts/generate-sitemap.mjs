import { execFile } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteOrigin = 'https://wwwstationcat.org';

export const requiredDynamicIndexRoutes = [
  '/novel/',
  '/en/novel/',
  '/signal/',
  '/en/signal/',
  '/ja/signal/',
  '/zh-hans/signal/',
  '/zh-hant/signal/'
];

const excludedPrefixes = [
  '/apps/',
  '/points/',
  '/privacy/',
  '/support/',
  '/terms/',
  '/admin/',
  '/admin-v2/',
  '/devlog/',
  '/en/devlog/',
  '/ja/devlog/',
  '/zh-hans/devlog/',
  '/zh-hant/devlog/',
  '/works/',
  '/en/works/',
  '/ja/works/',
  '/zh-hans/works/',
  '/zh-hant/works/',
  '/library/',
  '/en/library/',
  '/ja/library/',
  '/zh-hans/library/',
  '/zh-hant/library/'
];

export const shouldIncludeSitemapRoute = (route) => {
  if (!route || !route.startsWith('/')) return false;
  if (route === '/404/' || /\/(?:en|ja|zh-hans|zh-hant)\/404\/$/.test(route)) return false;
  return !excludedPrefixes.some(
    (prefix) => route === prefix || route === prefix.slice(0, -1) || route.startsWith(prefix)
  );
};

const collectIndexFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectIndexFiles(path)));
    if (entry.isFile() && entry.name === 'index.html') files.push(path);
  }
  return files;
};

const indexFileToRoute = (distRoot, file) => {
  const path = relative(distRoot, file).split(sep).join('/');
  if (path === 'index.html') return '/';
  return `/${path.replace(/\/index\.html$/, '')}/`;
};

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const resolveLastmod = async () => {
  if (process.env.SOURCE_DATE_EPOCH) {
    const timestamp = Number.parseInt(process.env.SOURCE_DATE_EPOCH, 10);
    if (Number.isFinite(timestamp)) return new Date(timestamp * 1000).toISOString().slice(0, 10);
  }
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%cs', '--', 'src', 'public'], {
      cwd: projectRoot
    });
    const date = stdout.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  } catch {
    // Build environments without Git metadata still receive a valid sitemap date.
  }
  return new Date().toISOString().slice(0, 10);
};

export const generateSitemap = async ({ distRoot, lastmod = '', outputPath = join(distRoot, 'sitemap.xml') }) => {
  const staticRoutes = (await collectIndexFiles(distRoot)).map((file) => indexFileToRoute(distRoot, file));
  const routes = [...new Set([...staticRoutes, ...requiredDynamicIndexRoutes])]
    .filter(shouldIncludeSitemapRoute)
    .sort((left, right) => left.localeCompare(right, 'en'));
  const resolvedLastmod = lastmod || (await resolveLastmod());
  const body = routes
    .map(
      (route) =>
        `  <url><loc>${xmlEscape(new URL(route, siteOrigin).toString())}</loc><lastmod>${xmlEscape(resolvedLastmod)}</lastmod></url>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  await writeFile(outputPath, xml, 'utf8');
  return { lastmod: resolvedLastmod, routes, xml };
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const result = await generateSitemap({ distRoot: resolve(projectRoot, 'dist') });
  console.log(`Generated sitemap.xml with ${result.routes.length} public routes and lastmod ${result.lastmod}.`);
}
