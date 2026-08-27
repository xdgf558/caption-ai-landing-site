import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getReaderErrorMessageKey,
  getReaderLibraryMessages,
  getReaderLibraryPath,
  readerErrorMessageKeys,
  readerLibraryClientMessages,
  readerLibraryPaths
} from '../src/data/reader-library-client.js';

const locales = ['en', 'ja', 'zh-Hant', 'zh-Hans'];
const expectedPaths = {
  en: '/en/library/',
  ja: '/ja/library/',
  'zh-Hant': '/zh-hant/library/',
  'zh-Hans': '/zh-hans/library/'
};

assert.deepEqual(readerLibraryPaths, expectedPaths);
for (const locale of locales) {
  assert.equal(getReaderLibraryPath(locale), expectedPaths[locale]);
}

const referenceKeys = Object.keys(readerLibraryClientMessages.en).sort();
for (const locale of locales) {
  const messages = getReaderLibraryMessages(locale);
  assert.deepEqual(Object.keys(messages).sort(), referenceKeys, `${locale} must expose the full client message set`);
  for (const key of referenceKeys) {
    assert.ok(String(messages[key]).trim(), `${locale}.${key} must not be empty`);
  }
}

assert.equal(getReaderLibraryMessages('en').membershipActive, 'Membership active');
assert.equal(getReaderLibraryMessages('ja').paymentCancelled, '支払いはキャンセルされました。Station Points は変更されていません。');
assert.equal(getReaderLibraryMessages('zh-Hans').bookmarkDeleted, '书签已删除。');
assert.equal(getReaderLibraryMessages('zh-Hant').totpBound, '兩步驗證器已綁定。');

for (const [code, key] of Object.entries(readerErrorMessageKeys)) {
  assert.equal(getReaderErrorMessageKey(code), key);
  for (const locale of locales) {
    assert.ok(getReaderLibraryMessages(locale)[key], `${code} must resolve for ${locale}`);
  }
}

const [librarySource, chapterSource] = await Promise.all([
  readFile(new URL('../src/components/ReaderLibraryPage.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SerialChapterPage.astro', import.meta.url), 'utf8')
]);

assert.match(librarySource, /messages:\s*getReaderLibraryMessages\(lang\)/);
assert.match(librarySource, /errorMessageKeys:\s*readerErrorMessageKeys/);
assert.match(librarySource, /const localizedApiMessage =/);
assert.match(librarySource, /formatReaderMessage\('paymentReturnedPending'\)/);
assert.doesNotMatch(librarySource, /USDT|USDC|FDUSD|reader-pay-chip|reader-pay-currency/);
assert.equal(
  (librarySource.match(/chapterCostFallback:/g) || []).length,
  locales.length,
  'Every Member Center locale must provide a safe chapter-cost fallback'
);
const libraryServerMarkup = librarySource.slice(
  librarySource.indexOf('<BaseLayout'),
  librarySource.indexOf('  <script>')
);
assert.match(libraryServerMarkup, /id="reader-credit-cost">\{copy\.chapterCostFallback\}<\/p>/);
assert.doesNotMatch(
  libraryServerMarkup,
  /id="reader-credit-cost">\{copy\.chapterCost\}<\/p>/,
  'Server-rendered Member Center markup must not expose the {cost} template'
);
assert.doesNotMatch(
  librarySource.slice(librarySource.indexOf('<script>')),
  /[\u4e00-\u9fff]/,
  'Member Center runtime script must not contain fixed Chinese UI copy'
);

assert.match(chapterSource, /const libraryPath = getReaderLibraryPath\(locale\)/);
assert.match(chapterSource, /href=\{libraryReturnHref\}/);
assert.match(chapterSource, /define:vars=\{\{ bookmarkCopy, libraryPath,/);
assert.match(chapterSource, /define:vars=\{\{ interactionCopy,[^\n]+libraryPath,/);
assert.match(chapterSource, /define:vars=\{\{ accessGateCopy, libraryPath \}\}/);
assert.doesNotMatch(chapterSource, /href="\/library\/"/);
assert.doesNotMatch(chapterSource, /window\.location\.href = `\/library\//);

console.log('reader library locale checks passed');
