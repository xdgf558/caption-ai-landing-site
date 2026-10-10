// Read-only deployment contract. Runtime flags cannot change an upstream Assets
// router. A T22 release must satisfy this before any public closure activation.
export const migrationWorkerPaths = Object.freeze([
  '/', '/about/', '/robots.txt', '/sitemap.xml', '/sitemaps/tracks-1.xml', '/apps/', '/apps/example/', '/devlog/',
  '/signal/', '/novel/story/chapter/chapter-one/', '/works/story/chapter-one/', '/games/', '/games/cat-life/',
  '/music/', '/music/tracks/example/', '/library/', '/%6dusic/descendant/',
  ...['en','ja','zh-hans','zh-hant'].flatMap(locale => ['/', '/about/', '/music/', '/games/', '/library/', '/apps/', '/signal/', '/works/story/chapter-one/'].map(path => '/' + locale + path))
]);
export function inspectMigrationRouting(patterns) {
  const match = path => patterns === true || (Array.isArray(patterns) && patterns.some(pattern =>
    typeof pattern === 'string' && new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(path)));
  const missing = migrationWorkerPaths.filter(path => !match(path));
  return { satisfied: missing.length === 0, missing };
}
