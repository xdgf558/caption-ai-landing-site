import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const wranglerSource = read('wrangler.toml');
const workerSource = read('src/worker.js');

assert.match(wranglerSource, /\[ai\]\s+binding = "AI"/, 'Wrangler should expose a Workers AI binding.');
assert.match(wranglerSource, /NOVEL_TRANSLATION_MODEL/, 'Wrangler should declare the novel translation model.');
assert.match(workerSource, /\/api\/novelforge\/translations\/english/, 'Worker should expose the NovelForge translation sync endpoint.');
assert.match(workerSource, /ctx\.waitUntil/, 'NovelForge import should trigger translation in the background.');
assert.match(workerSource, /x-stationcat-local-admin-bypass/, 'Translation backfill should support a dev-only local bypass header.');
assert.match(workerSource, /hasLocalAdminBypass\(env\)/, 'The local translation bypass should depend on the existing local admin guard.');
assert.match(workerSource, /skipSeries/, 'Manual chapter backfills should be able to skip repeated series translation.');
assert.match(workerSource, /novelTranslationChunkConcurrency = 3/, 'Long chapter translation should use bounded chunk concurrency.');
assert.match(workerSource, /source_lang: 'zh'/, 'The default translation model should receive a source language.');
assert.match(workerSource, /target_lang: 'en'/, 'The default translation model should receive a target language.');

const chunks = hooks.splitNovelTranslationChunks(['第一段'.repeat(120), '第二段'.repeat(120)].join('\n\n'), 300);
assert(chunks.length >= 2, 'Long novel text should be split before calling Workers AI.');
assert(chunks.every((chunk) => chunk.length <= 300), 'Translation chunks should respect the requested max length.');

const calls = [];
const translationEnv = {
  AI: {
    async run(model, input) {
      calls.push({ model, input });
      return { translated_text: 'Hello, Station Cat.' };
    }
  }
};

const translated = await hooks.translateNovelTextToEnglish(translationEnv, '你好，Station Cat。', {
  chunkMaxLength: 500,
  context: 'unit test',
  field: 'body'
});

assert.equal(translated, 'Hello, Station Cat.');
assert.equal(calls.length, 1);
assert.equal(calls[0].model, '@cf/meta/m2m100-1.2b');
assert.deepEqual(calls[0].input, {
  source_lang: 'zh',
  target_lang: 'en',
  text: '你好，Station Cat。'
});

const env = {
  AI: {
    async run(model, input) {
      calls.push({ model, input });
      return { response: '```markdown\nHello, Station Cat.\n```' };
    }
  },
  NOVEL_TRANSLATION_MODEL: '@cf/test/translator'
};

const fallbackTranslated = await hooks.translateNovelTextToEnglish(env, '你好，Station Cat。', {
  chunkMaxLength: 500,
  context: 'unit test',
  field: 'body'
});

assert.equal(fallbackTranslated, 'Hello, Station Cat.');
assert.equal(calls.length, 2);
assert.equal(calls[1].model, '@cf/test/translator');
assert.match(calls[1].input.prompt, /Return only the English translation/);

const englishIndexRoute = hooks.parseDynamicContentRoute('/en/novel/');
assert.deepEqual(englishIndexRoute, {
  basePath: '/en/novel/',
  chapterSlug: '',
  kind: 'novel-index',
  locale: 'en',
  readerVersion: 'v2',
  seriesSlug: ''
});

const englishSeriesRoute = hooks.parseDynamicContentRoute('/en/novel/book/');
assert.deepEqual(englishSeriesRoute, {
  basePath: '/en/novel/',
  chapterSlug: '',
  kind: 'novel-series',
  locale: 'en',
  readerVersion: 'v2',
  seriesSlug: 'book'
});

assert.equal(hooks.dynamicSeriesPath(englishSeriesRoute, 'book'), '/en/novel/book/');
assert.equal(hooks.dynamicChapterPath(englishSeriesRoute, 'book', 'ch1'), '/en/novel/book/chapter/ch1/');

console.log('novel English translation tests passed');
