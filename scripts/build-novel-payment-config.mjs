import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { load as parseYaml } from 'js-yaml';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serialsDir = path.join(rootDir, 'src/content/serials');
const chaptersDir = path.join(rootDir, 'src/content/serialChapters');
const outputPath = path.join(rootDir, 'src/generated/novelPaymentConfig.js');
const protectedContentOutputPath = path.join(rootDir, 'src/generated/protectedSerialContent.js');
const protectedContentBuildDir = path.join(rootDir, '.generated/protected-serial-content');
const protectedContentFilesDir = path.join(protectedContentBuildDir, 'files');
const protectedContentManifestPath = path.join(protectedContentBuildDir, 'manifest.json');
const protectedContentBucketName = 'station-cat-content';

const cleanSlug = (value, maxLength = 120) =>
  String(value || '')
    .trim()
    .slice(0, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizePriceAmount = (value, fallback) => {
  const amount = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  return Math.round(amount * 100) / 100;
};

const normalizePositiveInteger = (value, fallback = 0) => {
  const amount = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(amount) || amount < 0) return fallback;
  return amount;
};

const normalizeCurrency = (value, fallback = 'USD') => {
  const currency = String(value || '').trim().toUpperCase();
  return currency === 'USD' ? 'USD' : fallback;
};

const normalizeLocale = (value) => {
  const locale = String(value || '').trim();
  return ['zh-Hant', 'zh-Hans', 'en', 'ja'].includes(locale) ? locale : 'zh-Hant';
};

const paddedChapterNumber = (value) => String(normalizePositiveInteger(value, 0)).padStart(3, '0');

const buildProtectedChapterHtmlR2Key = ({ chapterNumber, chapterSlug, language, seriesSlug }) =>
  `content/novels/${seriesSlug}/chapters/${paddedChapterNumber(chapterNumber)}-${chapterSlug}/${language}/body.html`;

const normalizeTipAmounts = (value) => {
  const items = Array.isArray(value) ? value : [];
  const amounts = items
    .map((amount) => normalizePriceAmount(amount, null))
    .filter((amount) => amount && amount > 0);
  return amounts.length ? Array.from(new Set(amounts)).sort((a, b) => a - b) : [3, 5, 10];
};

const normalizeBundleDiscounts = (value) => {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => ({
      chapters: normalizePositiveInteger(item?.chapters, 0),
      discountPercent: normalizePriceAmount(item?.discountPercent, 0)
    }))
    .filter((item) => item.chapters > 1 && item.discountPercent > 0 && item.discountPercent < 100)
    .sort((a, b) => a.chapters - b.chapters || a.discountPercent - b.discountPercent);
};

const extractFrontmatter = (markdown, filePath) => {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!match) {
    throw new Error(`Missing frontmatter: ${path.relative(rootDir, filePath)}`);
  }
  const frontmatter = parseYaml(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error(`Invalid frontmatter: ${path.relative(rootDir, filePath)}`);
  }
  return frontmatter;
};

const splitMarkdown = (markdown, filePath) => {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (!match) {
    throw new Error(`Missing frontmatter: ${path.relative(rootDir, filePath)}`);
  }
  const frontmatter = parseYaml(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error(`Invalid frontmatter: ${path.relative(rootDir, filePath)}`);
  }
  return {
    body: markdown.slice(match[0].length),
    frontmatter
  };
};

const readMarkdownFrontmatters = async (dir) => {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();
  return Promise.all(
    files.map(async (file) => {
      const filePath = path.join(dir, file);
      return {
        file,
        data: extractFrontmatter(await readFile(filePath, 'utf8'), filePath)
      };
    })
  );
};

const readMarkdownEntries = async (dir) => {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();
  return Promise.all(
    files.map(async (file) => {
      const filePath = path.join(dir, file);
      const markdown = await readFile(filePath, 'utf8');
      const { body, frontmatter } = splitMarkdown(markdown, filePath);
      return {
        body,
        file,
        filePath,
        data: frontmatter
      };
    })
  );
};

const serialEntries = await readMarkdownFrontmatters(serialsDir);
const chapterEntries = await readMarkdownEntries(chaptersDir);

const series = {};
for (const entry of serialEntries) {
  const seriesSlug = cleanSlug(entry.data.seriesSlug || entry.file.replace(/\.md$/, ''));
  if (!seriesSlug) continue;

  series[seriesSlug] = {
    seriesSlug,
    priceMode: ['free', 'tip-optional', 'chapter-paid', 'volume-paid', 'member'].includes(entry.data.priceMode)
      ? entry.data.priceMode
      : 'free',
    freeChapters: normalizePositiveInteger(entry.data.freeChapters, 0),
    tipsEnabled: entry.data.tipsEnabled !== false,
    tipAmounts: normalizeTipAmounts(entry.data.tipAmounts),
    tipCurrency: normalizeCurrency(entry.data.tipCurrency, 'USD'),
    chapterPriceAmount: normalizePriceAmount(entry.data.chapterPriceAmount, 1.99),
    chapterPriceCurrency: normalizeCurrency(entry.data.chapterPriceCurrency, 'USD'),
    supporterPriceAmount: normalizePriceAmount(entry.data.supporterPriceAmount, 4.99),
    supporterPriceCurrency: normalizeCurrency(entry.data.supporterPriceCurrency, 'USD'),
    bundlePurchasesEnabled: Boolean(entry.data.bundlePurchasesEnabled),
    chapterBundleDiscounts: normalizeBundleDiscounts(entry.data.chapterBundleDiscounts),
    chapters: []
  };
}

for (const entry of chapterEntries) {
  const seriesSlug = cleanSlug(entry.data.seriesSlug);
  const chapterSlug = cleanSlug(entry.data.chapterSlug);
  if (!seriesSlug || !chapterSlug || !series[seriesSlug]) continue;

  series[seriesSlug].chapters.push({
    chapterSlug,
    chapterNumber: normalizePositiveInteger(entry.data.chapterNumber, 0),
    access: ['free', 'paid', 'supporter'].includes(entry.data.access) ? entry.data.access : 'free',
    status: ['draft', 'scheduled', 'published'].includes(entry.data.status) ? entry.data.status : 'draft'
  });
}

for (const item of Object.values(series)) {
  item.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber || a.chapterSlug.localeCompare(b.chapterSlug));
}

const output = `// Generated by scripts/build-novel-payment-config.mjs from src/content/serials and src/content/serialChapters.
// Do not edit this file by hand.

export const novelPaymentConfig = ${JSON.stringify({ series }, null, 2)};
`;

const protectedChapters = {};
const protectedContentFiles = [];
const markdownProcessor = await createMarkdownProcessor({});

await rm(protectedContentBuildDir, { recursive: true, force: true });

for (const entry of chapterEntries) {
  const seriesSlug = cleanSlug(entry.data.seriesSlug);
  const chapterSlug = cleanSlug(entry.data.chapterSlug);
  const access = ['paid', 'supporter'].includes(entry.data.access) ? entry.data.access : 'free';
  const status = ['draft', 'scheduled', 'published'].includes(entry.data.status) ? entry.data.status : 'draft';
  if (!seriesSlug || !chapterSlug || !series[seriesSlug] || access === 'free' || status !== 'published') continue;

  const chapterNumber = normalizePositiveInteger(entry.data.chapterNumber, 0);
  const language = normalizeLocale(entry.data.language);
  const rendered = await markdownProcessor.render(entry.body, {
    fileURL: entry.filePath,
    frontmatter: entry.data
  });
  const htmlR2Key = buildProtectedChapterHtmlR2Key({
    chapterNumber,
    chapterSlug,
    language,
    seriesSlug
  });
  const htmlFilePath = path.join(protectedContentFilesDir, htmlR2Key);

  protectedChapters[`${seriesSlug}/${chapterSlug}`] = {
    access,
    chapterNumber,
    chapterSlug,
    excerpt: String(entry.data.excerpt || ''),
    headings: rendered.metadata.headings || [],
    htmlR2Key,
    language,
    seriesSlug,
    title: String(entry.data.title || '')
  };

  await mkdir(path.dirname(htmlFilePath), { recursive: true });
  await writeFile(htmlFilePath, rendered.code);
  protectedContentFiles.push({
    byteLength: Buffer.byteLength(rendered.code),
    chapterSlug,
    contentType: 'text/html; charset=utf-8',
    key: htmlR2Key,
    localPath: path.relative(rootDir, htmlFilePath),
    seriesSlug
  });
}

const protectedContentOutput = `// Generated by scripts/build-novel-payment-config.mjs from protected src/content/serialChapters entries.
// Do not edit this file by hand.
// This manifest intentionally stores R2 keys only. Protected HTML bodies are uploaded to R2.

export const protectedSerialContent = ${JSON.stringify({ chapters: protectedChapters }, null, 2)};
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);
await writeFile(protectedContentOutputPath, protectedContentOutput);
await mkdir(protectedContentBuildDir, { recursive: true });
await writeFile(
  protectedContentManifestPath,
  `${JSON.stringify(
    {
      bucket: protectedContentBucketName,
      files: protectedContentFiles,
      generatedAt: new Date().toISOString()
    },
    null,
    2
  )}\n`
);
console.log(`Generated ${path.relative(rootDir, outputPath)}`);
console.log(`Generated ${path.relative(rootDir, protectedContentOutputPath)}`);
console.log(`Generated ${path.relative(rootDir, protectedContentManifestPath)}`);
