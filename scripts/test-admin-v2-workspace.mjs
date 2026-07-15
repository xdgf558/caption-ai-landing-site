import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('../src/pages/admin-v2/index.astro', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

for (const label of ['发布', '运营', '反馈', '数据']) {
  assert.ok(adminSource.includes(`>${label}</span>`), `Admin navigation should include the ${label} group.`);
}

for (const tab of ['content', 'imports', 'signal', 'commerce', 'accounts', 'access', 'comments', 'feedback', 'analytics', 'audit']) {
  assert.equal(
    adminSource.match(new RegExp(`data-admin-v2-tab="${tab}"`, 'g'))?.length,
    1,
    `Admin navigation should expose one ${tab} module button.`
  );
}

for (const id of [
  'content-form',
  'content-entry-type',
  'content-status',
  'content-locale',
  'content-slug',
  'content-title',
  'content-markdown',
  'content-save',
  'content-save-status',
  'entry-pricing-panel',
  'revision-list'
]) {
  assert.equal(adminSource.match(new RegExp(`id="${id}"`, 'g'))?.length, 1, `Admin editor should keep one #${id} hook.`);
}

assert.ok(
  adminSource.indexOf('admin-v2-editor-body') < adminSource.indexOf('>发布设置</strong>'),
  'The primary Markdown editor should appear before secondary publishing settings.'
);
assert.match(adminSource, /class="admin-v2-disclosure" id="entry-pricing-panel"/);
assert.match(adminSource, /class="admin-v2-disclosure admin-v2-history"/);
assert.match(adminSource, /form="content-form" data-content-save-button/);
assert.match(adminSource, /tab\.setAttribute\('aria-pressed', String\(isActive\)\)/);
assert.match(adminSource, /content-preview-disclosure'\)\.open = true/);

assert.match(stylesSource, /body\.admin-v2-page \{/);
assert.match(stylesSource, /grid-template-columns: 260px minmax\(0, 1fr\)/);
assert.match(stylesSource, /@media \(max-width: 1040px\)/);
assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.admin-v2-page \.nav-wrap/);
assert.match(stylesSource, /\.admin-v2-main \.admin-v2-panel \.admin-file-input/);

console.log('admin v2 workspace redesign tests passed');
