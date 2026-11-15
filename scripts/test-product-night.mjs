import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const slugs = ['caption-ai','mindbudget','privatepinyin','nodepilot','novelforge-ai','simplecut-pro'];
const locales = [['zh-Hant','/zh-hant'],['en','/en']];
const read = path => readFileSync(`dist${path}index.html`, 'utf8');
for (const [,prefix] of locales) {
  for (const slug of slugs) {
    const html = read(`${prefix}/apps/${slug}/`);
    assert.match(html, /<body class="[^"]*product-night/);
    const menu = html.match(/<div class="pn-mobile-locales">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(menu, `${prefix}/${slug}: mobile language menu exists`);
    for (const [lang,targetPrefix] of locales) {
      assert.ok(menu.includes(`href="${targetPrefix}/apps/${slug}/"`), `${slug}: ${lang} keeps product`);
    }
    const footer = html.slice(html.indexOf('<footer'));
    const legalPrefix = prefix;
    for (const page of ['privacy','terms']) {
      assert.ok(footer.includes(`href="${legalPrefix}/${page}/"`));
      assert.ok(existsSync(`dist${legalPrefix}/${page}/index.html`));
    }
  }
  for (const path of ['caption-ai/download','caption-ai/support','privatepinyin/support','caption-ai/privacy','novelforge-ai/download']) {
    const html = read(`${prefix}/apps/${path}/`);
    assert.doesNotMatch(html.match(/<body[^>]*>/)?.[0] ?? '', /product-night/, `${path} retains existing theme`);
  }
}
for (const retired of ['/zh-hans','/ja']) assert.ok(!existsSync(`dist${retired}/apps/caption-ai/index.html`), `${retired}: retired locale is not built`);
console.log('12 product landing pages: language routes and legal links passed; 10 supporting pages retain existing theme; retired locales absent.');
