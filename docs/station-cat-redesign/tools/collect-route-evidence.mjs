// Read-only source/build inventory. Does not import the Worker, call HTTP, or read local credentials.
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('Use --output <local JSON path>');
const output = resolve(process.argv[outputIndex + 1]);
const tracked = execFileSync('git', ['ls-files', 'src', 'public'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const files = tracked.filter(p => /\.(?:js|mjs|ts|astro|html)$/.test(p) && !p.includes('/vendor/'));
const endpoints = [], patterns = [], maps = [], callers = [];
const receiverFiles = ['src/worker.js', 'src/music/adminHttp.js', 'src/music/publicHttp.js',
  'src/music/mediaResponse.js', 'src/music/shareCardHttp.js', 'src/music/analytics.js',
  'src/music/pagePaths.js', 'src/music/pageHttp.js', 'src/music/coverDisplay.js',
  'src/mobile/http.js', 'src/mobile/music.js', 'src/mobile/productionAssociation.js'];
const equals = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken]);
for (const file of files) {
  const text = await readFile(resolve(root, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const line = n => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const literal = new Map();
  function collect(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isStringLiteralLike(n.initializer)) literal.set(n.name.text, n.initializer.text);
    ts.forEachChild(n, collect);
  }
  collect(source);
  function value(n) {
    if (!n) return null;
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isIdentifier(n)) return literal.get(n.text) ?? null;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = value(n.left), b = value(n.right); return a !== null && b !== null ? a + b : null;
    }
    return null;
  }
  function method(n) {
    for (let p = n; p && !ts.isSourceFile(p); p = p.parent) {
      if (ts.isIfStatement(p)) {
        // Exclude the sibling else-if chain: its methods belong to other routes.
        // These are source hints, not an executed proof of the HTTP contract.
        const branch = p.expression.getText(source) + '\n' + p.thenStatement.getText(source);
        const found = [...branch.matchAll(/request\.method\s*(?:===?|!==?)\s*['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]/g)].map(x => x[1]);
        for (const match of branch.matchAll(/\[([^\]]+)\]\.includes\(request\.method\)/g)) {
          found.push(...[...match[1].matchAll(/['"](GET|HEAD|POST|PUT|PATCH|DELETE)['"]/g)].map(x => x[1]));
        }
        if (file === 'src/music/adminHttp.js' && /\bread\b/.test(branch)) found.push('GET', 'HEAD');
        if (found.length) return [...new Set(found)].sort().join('|');
      }
    }
    return ['src/music/publicHttp.js', 'src/music/mediaResponse.js', 'src/music/shareCardHttp.js', 'src/music/pageHttp.js'].includes(file) ? 'GET|HEAD (handler)' : 'see handler';
  }
  function visit(n) {
    if (receiverFiles.includes(file)) {
      if (ts.isBinaryExpression(n) && equals.has(n.operatorToken.kind)) {
        let lhs = n.left.getText(source), rhs = value(n.right);
        if (/(?:pathname|^path$)/.test(lhs) && rhs?.startsWith('/')) {
          if (file === 'src/mobile/music.js' && lhs === 'path') rhs = '/api/mobile/v1' + rhs;
          endpoints.push({ path: rhs, source: file, line: line(n), methods: method(n) });
        }
      }
      if (n.kind === ts.SyntaxKind.RegularExpressionLiteral && n.getText(source).startsWith('/^\\/') && !n.getText(source).startsWith('/^\\/+')) {
        patterns.push({ expression: n.getText(source), source: file, line: line(n) });
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'startsWith') {
        const p = value(n.arguments[0]);
        if (p?.startsWith('/') && !['/en/', '/ja/', '/zh-hans/'].includes(p) && /path/.test(n.expression.expression.getText(source))) patterns.push({ expression: 'prefix:' + p, source: file, line: line(n) });
      }
      if (ts.isArrayLiteralExpression(n)) {
        const strings = n.elements.map(value).filter(x => x?.startsWith('/api/') || x?.startsWith('/auth/mobile/'));
        if (strings.length === n.elements.length && strings.length) {
          for (const path of strings) endpoints.push({ path, source: file, line: line(n), methods: method(n) });
        }
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^(downloadFiles|externalDownloadRedirects|pageRedirects)$/.test(n.name.text) && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isStringLiteralLike(p.name)) continue;
          maps.push({ path: p.name.text, map: n.name.text, target: value(p.initializer), source: file, line: line(p), methods: 'GET|HEAD' });
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(source);
  // Literal caller evidence includes link/data definitions; prefixes and templates require manual review.
  if (file !== 'src/worker.js' && !file.startsWith('src/music/') && !file.startsWith('src/mobile/')) {
    const regex = /["'`](\/(?:api|admin\/api|auth\/mobile|novel|works|downloads|games\/cat-life|(?:en|ja|zh-hans|zh-hant)\/(?:library|points))[^"'`\s<>]*)["'`]/g;
    for (const m of text.matchAll(regex)) callers.push({ path: m[1], source: file, line: text.slice(0, m.index).split('\n').length });
  }
}
const redirects = [];
const redirectText = await readFile(resolve(root, 'public/_redirects'), 'utf8');
for (const [i, l] of redirectText.split('\n').entries()) {
  const m = /^(\/\S*)\s+(\/\S*)\s+(\d{3})\s*$/.exec(l);
  if (m) redirects.push({ path: m[1], target: m[2], status: Number(m[3]), source: 'public/_redirects', line: i + 1 });
}
const staticPaths = execFileSync('rg', ['--files', 'dist', '-g', 'index.html', '--hidden', '--no-ignore'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const staticRoutes = [];
for (const p of staticPaths) {
  const d = relative('dist', dirname(p)).replaceAll('\\', '/');
  const path = d ? '/' + d + '/' : '/';
  const candidates = [`src/pages/${d ? d + '/' : ''}index.astro`, `src/pages/${d}.astro`, `public/${d ? d + '/' : ''}index.html`];
  if (/(^|\/)devlog\//.test(path) && path.split('/').filter(Boolean).at(-1) !== 'devlog') candidates.push(path.startsWith('/devlog/') ? 'src/pages/devlog/[slug].astro' : 'src/pages/[locale]/devlog/[slug].astro');
  if (/^\/(en|ja|zh-hans)\/devlog\/$/.test(path)) candidates.push('src/pages/[locale]/devlog/index.astro');
  let source = null;
  for (const candidate of candidates) { try { await access(resolve(root, candidate)); source = candidate; break; } catch {} }
  if (!source) throw new Error('Unmapped generated route: ' + path);
  staticRoutes.push({ path, source, line: 1 });
}
const sitemap = [...(await readFile(resolve(root, 'dist/sitemap.xml'), 'utf8')).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
const result = {
  schemaVersion: 1,
  applicationBaseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  evidenceOnly: true, httpVerified: false, productionSchemaVerified: false,
  staticRoutes: staticRoutes.sort((a, b) => a.path.localeCompare(b.path, 'en')), sitemap,
  endpoints, patterns, maps, redirects, callers
};
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, staticRoutes: staticRoutes.length, sitemap: sitemap.length, endpoints: endpoints.length,
  patterns: patterns.length, mapPaths: maps.length, assetRedirects: redirects.length, literalCallerReferences: callers.length }));
