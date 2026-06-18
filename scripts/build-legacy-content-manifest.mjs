import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { load as parseYaml } from 'js-yaml';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(rootDir, 'src/content');
const outputPath = path.join(rootDir, 'src/generated/legacyContentManifest.js');

const sourceDirs = {
  devlog: path.join(contentDir, 'devlog'),
  serials: path.join(contentDir, 'serials'),
  serialChapters: path.join(contentDir, 'serialChapters')
};

const locales = new Map([
  ['zh-hant', 'zh-Hant'],
  ['zh-hans', 'zh-Hans'],
  ['en', 'en'],
  ['ja', 'ja']
]);

const cleanSlug = (value, maxLength = 160) =>
  String(value || '')
    .trim()
    .slice(0, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeLocale = (value) => locales.get(String(value || '').trim().toLowerCase()) || 'zh-Hant';

const normalizePositiveInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeAmount = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
};

const normalizeCurrency = (value, fallback = 'USD') => {
  const currency = String(value || '').trim().toUpperCase();
  return currency === 'USD' ? 'USD' : fallback;
};

const normalizeDate = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

const normalizeTags = (value) => (Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean);

const normalizeStatus = (value, fallback = 'published') => {
  const status = String(value || '').trim().toLowerCase();
  return ['draft', 'scheduled', 'published', 'archived'].includes(status) ? status : fallback;
};

const normalizeDevlogStatus = (data) => (data.draft === true ? 'draft' : 'published');

const splitMarkdown = (markdown, filePath) => {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (!match) throw new Error(`Missing frontmatter: ${path.relative(rootDir, filePath)}`);
  const frontmatter = parseYaml(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error(`Invalid frontmatter: ${path.relative(rootDir, filePath)}`);
  }
  let body = markdown.slice(match[0].length).trim();
  const nestedFrontmatter = /^---\n[\s\S]*?\n---\n?/.exec(body);
  if (nestedFrontmatter) body = body.slice(nestedFrontmatter[0].length).trim();
  return {
    body,
    frontmatter
  };
};

const readMarkdownEntries = async (dir) => {
  let files = [];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();
  } catch {
    return [];
  }

  return Promise.all(
    files.map(async (file) => {
      const filePath = path.join(dir, file);
      const markdown = await readFile(filePath, 'utf8');
      const { body, frontmatter } = splitMarkdown(markdown, filePath);
      return {
        body,
        data: frontmatter,
        file,
        filePath,
        sourceRef: path.relative(rootDir, filePath)
      };
    })
  );
};

const renderHtml = async (processor, entry) => {
  const rendered = await processor.render(entry.body, {
    fileURL: entry.filePath,
    frontmatter: entry.data
  });
  return rendered.code;
};

const buildBlogEntry = async (processor, entry) => {
  const data = entry.data;
  const slugSource = data.postSlug || entry.file.replace(/\.md$/, '').replace(/\.(zh-Hant|zh-Hans|en|ja)$/i, '');
  const locale = normalizeLocale(data.language);

  return {
    accessLevel: 'free',
    authorName: 'Station Cat',
    description: String(data.description || data.summary || ''),
    entryType: 'blog_post',
    excerpt: String(data.summary || data.description || ''),
    html: await renderHtml(processor, entry),
    locale,
    markdown: entry.body,
    metadata: {
      legacyCollection: 'devlog',
      legacyFile: entry.sourceRef,
      legacyStatus: String(data.status || 'note')
    },
    publishedAt: normalizeDate(data.pubDate || data.date),
    revisionSummary: `Imported legacy Markdown from ${entry.sourceRef}`,
    slug: cleanSlug(slugSource),
    sourceKind: 'legacy-markdown',
    sourceRef: entry.sourceRef,
    status: normalizeDevlogStatus(data),
    tags: normalizeTags(data.tags),
    title: String(data.title || ''),
    visibility: 'public'
  };
};

const buildSeriesPricing = (data) => ({
  bundlePurchasesEnabled: Boolean(data.bundlePurchasesEnabled),
  chapterBundleDiscounts: (Array.isArray(data.chapterBundleDiscounts) ? data.chapterBundleDiscounts : [])
    .map((rule) => ({
      discountPercent: normalizeAmount(rule?.discountPercent, 0),
      minimumChapters: normalizePositiveInteger(rule?.minimumChapters ?? rule?.chapters, 0)
    }))
    .filter((rule) => rule.minimumChapters > 1 && rule.discountPercent > 0),
  chapterCredits: normalizePositiveInteger(data.chapterCredits, 0),
  chapterPriceAmount: normalizeAmount(data.chapterPriceAmount, 0),
  chapterPriceCurrency: normalizeCurrency(data.chapterPriceCurrency),
  creditPacks: Array.isArray(data.creditPacks) ? data.creditPacks : [],
  freeChapters: normalizePositiveInteger(data.freeChapters, 0),
  mode: ['free', 'tip-optional', 'chapter-paid', 'volume-paid', 'member'].includes(data.priceMode) ? data.priceMode : 'free',
  supporterPriceAmount: normalizeAmount(data.supporterPriceAmount, 0),
  supporterPriceCurrency: normalizeCurrency(data.supporterPriceCurrency),
  tipAmounts: (Array.isArray(data.tipAmounts) ? data.tipAmounts : []).map((amount) => normalizeAmount(amount, 0)).filter((amount) => amount > 0),
  tipCurrency: normalizeCurrency(data.tipCurrency),
  tipsEnabled: data.tipsEnabled !== false
});

const buildSeriesEntry = async (processor, entry) => {
  const data = entry.data;
  const seriesSlug = cleanSlug(data.seriesSlug || entry.file.replace(/\.md$/, ''));

  return {
    accessLevel: 'free',
    authorName: String(data.author || 'Station Cat'),
    coverAlt: String(data.coverAlt || ''),
    coverR2Key: String(data.coverImage || ''),
    description: String(data.description || data.tagline || ''),
    entryType: 'novel_series',
    excerpt: String(data.tagline || data.description || ''),
    featured: Boolean(data.featured),
    html: await renderHtml(processor, entry),
    locale: normalizeLocale(data.language),
    markdown: entry.body,
    metadata: {
      availabilityNote: String(data.availabilityNote || ''),
      coverLabel: String(data.coverLabel || ''),
      latestChapterNumber: normalizePositiveInteger(data.latestChapterNumber, 0),
      latestChapterSlug: cleanSlug(data.latestChapterSlug || ''),
      legacyCollection: 'serials',
      legacyFile: entry.sourceRef,
      serialStatus: String(data.status || 'planned'),
      totalPlannedChapters: normalizePositiveInteger(data.totalPlannedChapters, 0),
      updateSchedule: String(data.updateSchedule || '')
    },
    pricing: buildSeriesPricing(data),
    publishedAt: normalizeDate(data.publishedAt),
    revisionSummary: `Imported legacy Markdown from ${entry.sourceRef}`,
    slug: seriesSlug,
    sourceKind: 'legacy-markdown',
    sourceRef: entry.sourceRef,
    status: 'published',
    subtitle: String(data.subtitle || data.tagline || ''),
    tags: normalizeTags(data.tags),
    title: String(data.title || seriesSlug),
    visibility: 'public'
  };
};

const buildChapterEntry = async (processor, entry) => {
  const data = entry.data;
  const chapterNumber = normalizePositiveInteger(data.chapterNumber, 0);
  const chapterSlug = cleanSlug(data.chapterSlug || entry.file.replace(/\.md$/, ''));
  const seriesSlug = cleanSlug(data.seriesSlug);

  return {
    accessLevel: ['free', 'paid', 'supporter'].includes(data.access) ? data.access : 'free',
    authorName: 'Station Cat',
    chapterNumber,
    description: String(data.excerpt || ''),
    entryType: 'novel_chapter',
    excerpt: String(data.excerpt || ''),
    html: await renderHtml(processor, entry),
    locale: normalizeLocale(data.language),
    markdown: entry.body,
    metadata: {
      legacyCollection: 'serialChapters',
      legacyFile: entry.sourceRef,
      nextChapterSlug: cleanSlug(data.nextChapterSlug || ''),
      prevChapterSlug: cleanSlug(data.prevChapterSlug || '')
    },
    parentSlug: seriesSlug,
    publishedAt: normalizeDate(data.publishedAt),
    readingMinutes: normalizePositiveInteger(data.readingMinutes, 0),
    revisionSummary: `Imported legacy Markdown from ${entry.sourceRef}`,
    slug: chapterSlug,
    sourceKind: 'legacy-markdown',
    sourceRef: entry.sourceRef,
    status: normalizeStatus(data.status, 'draft'),
    title: String(data.title || chapterSlug),
    visibility: 'public',
    volumeTitle: String(data.volume || ''),
    wordCount: normalizePositiveInteger(data.wordCount, 0)
  };
};

const processor = await createMarkdownProcessor({});
const [devlog, serials, serialChapters] = await Promise.all([
  readMarkdownEntries(sourceDirs.devlog),
  readMarkdownEntries(sourceDirs.serials),
  readMarkdownEntries(sourceDirs.serialChapters)
]);

const entries = [
  ...(await Promise.all(devlog.map((entry) => buildBlogEntry(processor, entry)))),
  ...(await Promise.all(serials.map((entry) => buildSeriesEntry(processor, entry)))),
  ...(await Promise.all(serialChapters.map((entry) => buildChapterEntry(processor, entry))))
].filter((entry) => entry.slug && entry.title);

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'src/content legacy Markdown',
  totals: {
    blogPosts: devlog.length,
    novelSeries: serials.length,
    novelChapters: serialChapters.length
  },
  entries
};

const output = `// Generated by scripts/build-legacy-content-manifest.mjs from src/content legacy Markdown.
// Do not edit this file by hand.

export const legacyContentManifest = ${JSON.stringify(manifest, null, 2)};
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);

console.log(`Generated ${path.relative(rootDir, outputPath)} with ${entries.length} legacy content entries.`);
