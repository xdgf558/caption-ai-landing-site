import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
for(const locale of ['zh-hant','zh-hans','en','ja']){
 const html=await readFile(`dist/${locale}/library/index.html`,'utf8');
 assert.match(html,/station-home-night reader-center-page reader-center-night/);
 for(const id of ['reader-auth-shell','reader-login-form','reader-register-fields','reader-reset-fields','reader-credits-panel','reader-membership-panel','reader-library-content','reader-account-panel','reader-totp-panel','reader-checkout-dialog']) assert.ok(html.includes(`id="${id}"`),`${locale}: ${id}`);
 for(const target of ['zh-hant','zh-hans','en','ja']) assert.ok(html.includes(`href="/${target}/library/"`),`${locale}: localized member navigation ${target}`);
 assert.ok(!html.includes('__preview'),'No preview account controls in shipped page');
}
const novel=await readFile('dist/novel/index.html','utf8');
assert.match(novel,/station-home-night station-novel-night/);
for(const hook of ['data-serials-bookshelf','data-bookshelf-filter','data-bookshelf-preview','data-backend-content-shelf'])assert.ok(novel.includes(hook),hook);
for(const route of ['zh-hant/apps/index.html','zh-hant/points/index.html','zh-hant/privacy/index.html','music/index.html']){
 const html=await readFile(`dist/${route}`,'utf8');
 assert.doesNotMatch(html,/class="[^\"]*(?:reader-center-night|station-novel-night)/,`${route} theme scope`);
}
console.log('Novel/member night build: four member locales, routes, functional hooks and theme isolation passed.');
