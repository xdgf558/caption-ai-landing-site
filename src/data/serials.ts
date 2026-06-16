import type { CollectionEntry } from 'astro:content';

export type SiteLocale = 'en' | 'ja' | 'zh-Hant' | 'zh-Hans';
export type SerialEntry = CollectionEntry<'serials'>;
export type SerialChapterEntry = CollectionEntry<'serialChapters'>;

export const worksRootByLocale: Record<SiteLocale, string> = {
  en: '/works/',
  ja: '/ja/works/',
  'zh-Hant': '/zh-hant/works/',
  'zh-Hans': '/zh-hans/works/'
};

const serialStatusLabels: Record<SiteLocale, Record<SerialEntry['data']['status'], string>> = {
  en: {
    planned: 'Preparing',
    serializing: 'Serializing',
    completed: 'Completed',
    paused: 'Paused'
  },
  ja: {
    planned: '準備中',
    serializing: '連載中',
    completed: '完結',
    paused: '一時停止'
  },
  'zh-Hant': {
    planned: '籌備中',
    serializing: '連載中',
    completed: '已完結',
    paused: '暫停更新'
  },
  'zh-Hans': {
    planned: '筹备中',
    serializing: '连载中',
    completed: '已完结',
    paused: '暂停更新'
  }
};

const priceModeLabels: Record<SiteLocale, Record<SerialEntry['data']['priceMode'], string>> = {
  en: {
    free: 'Free reading',
    'tip-optional': 'Free + tip',
    'chapter-paid': 'Per chapter',
    'volume-paid': 'Per volume',
    member: 'Members'
  },
  ja: {
    free: '無料公開',
    'tip-optional': '無料 + 支援',
    'chapter-paid': '章ごと購入',
    'volume-paid': '巻ごと購入',
    member: '会員向け'
  },
  'zh-Hant': {
    free: '免費閱讀',
    'tip-optional': '免費 + 打賞',
    'chapter-paid': '單章購買',
    'volume-paid': '分卷購買',
    member: '會員閱讀'
  },
  'zh-Hans': {
    free: '免费阅读',
    'tip-optional': '免费 + 打赏',
    'chapter-paid': '单章购买',
    'volume-paid': '分卷购买',
    member: '会员阅读'
  }
};

export const serialsCopy = {
  en: {
    navLabel: 'Serials',
    title: 'Station Cat Serials',
    description: 'A quiet reading shelf for long-form fiction published on Station Cat.',
    eyebrow: 'Serial Fiction',
    heroTitle: 'A reading shelf for long-form fiction.',
    heroDescription: 'The old works archive is now being reshaped into a home for serialized novels, chapter order, and future reader support.',
    heroNote: 'Version one stays simple: read-only pages, chapter order, and a structure ready for future support and paid access.',
    heroPrimary: 'Open the featured serial',
    heroSecondary: 'Browse the shelf',
    featuredEyebrow: 'Featured serial',
    featuredTitle: 'The current long-form project.',
    shelfEyebrow: 'Shelf',
    shelfTitle: 'All serial projects.',
    featuredEmpty: 'A featured serial will appear here soon.',
    shelfEmpty: 'The reading shelf is being prepared.',
    openSeries: 'Open series',
    readChapter: 'Read chapter',
    readLatest: 'Read latest chapter',
    readFirst: 'Read from chapter one',
    backShelf: 'Back to shelf',
    backHome: 'Back to Station Cat',
    synopsisEyebrow: 'Synopsis',
    synopsisTitle: 'What this work is holding onto.',
    chapterEyebrow: 'Reading order',
    chapterLabel: 'Chapter',
    chapterTitle: 'Published chapters',
    chapterEmpty: 'The first chapter is still being prepared.',
    latestLabel: 'Latest',
    scheduleLabel: 'Schedule',
    accessLabel: 'Access',
    freeLabel: 'Free chapters',
    statusLabel: 'Status',
    chapterWordCount: 'words',
    previousChapter: 'Previous chapter',
    nextChapter: 'Next chapter',
    chapterBack: 'Back to series',
    seriesCtaNote: 'The first version keeps reading open and lightweight.',
    latestFallback: 'First chapter coming soon.'
  },
  ja: {
    navLabel: '連載小説',
    title: 'Station Cat 連載小説',
    description: 'Station Cat で公開していく長編小説のための、小さな読書棚です。',
    eyebrow: '連載小説',
    heroTitle: '長編小説のための読書棚。',
    heroDescription: 'もともとの作品集モジュールを、長編連載、章順、今後の読者サポートに向いた入口へ組み替えていきます。',
    heroNote: '第一版は読みやすさを優先し、静かな一覧、作品ページ、章ページから始めます。',
    heroPrimary: '注目作品を開く',
    heroSecondary: '棚を見る',
    featuredEyebrow: '主推作品',
    featuredTitle: '現在進行中の長編プロジェクト。',
    shelfEyebrow: '読書棚',
    shelfTitle: '公開中の連載一覧。',
    featuredEmpty: '注目作品はまもなくここに表示されます。',
    shelfEmpty: '読書棚を準備中です。',
    openSeries: '作品を見る',
    readChapter: '章を読む',
    readLatest: '最新章を読む',
    readFirst: '第一章から読む',
    backShelf: '棚に戻る',
    backHome: 'Station Cat に戻る',
    synopsisEyebrow: '作品紹介',
    synopsisTitle: 'この物語の入り口。',
    chapterEyebrow: '章順',
    chapterLabel: '第',
    chapterTitle: '公開済みの章',
    chapterEmpty: '第一章はまだ準備中です。',
    latestLabel: '最新章',
    scheduleLabel: '更新予定',
    accessLabel: '公開方式',
    freeLabel: '無料章数',
    statusLabel: '更新状態',
    chapterWordCount: '語',
    previousChapter: '前の章',
    nextChapter: '次の章',
    chapterBack: '作品ページへ',
    seriesCtaNote: '第一版は軽く読める構成から始めます。',
    latestFallback: '第一章はまもなく公開予定です。'
  },
  'zh-Hant': {
    navLabel: '連載小說',
    title: 'Station Cat 連載小說',
    description: '一個放長篇小說、更新順序和後續讀者支持入口的小書架。',
    eyebrow: '連載小說',
    heroTitle: '給長篇小說的一個閱讀書架。',
    heroDescription: '原本的作品集模組，先被改造成長篇連載入口，讓小說、章節順序和後續支持功能都能有固定位置。',
    heroNote: '第一版先維持輕量：小說書架、作品頁、章節頁，先把閱讀秩序搭起來。',
    heroPrimary: '打開主推作品',
    heroSecondary: '看全部書架',
    featuredEyebrow: '主推作品',
    featuredTitle: '目前正在準備的長篇作品。',
    shelfEyebrow: '書架',
    shelfTitle: '目前公開的連載。',
    featuredEmpty: '主推作品很快會出現在這裡。',
    shelfEmpty: '小說書架正在整理中。',
    openSeries: '打開作品',
    readChapter: '閱讀章節',
    readLatest: '閱讀最新章',
    readFirst: '從第一章開始',
    backShelf: '回到書架',
    backHome: '回到 Station Cat',
    synopsisEyebrow: '作品簡介',
    synopsisTitle: '這部作品目前的入口。',
    chapterEyebrow: '章節順序',
    chapterLabel: '第',
    chapterTitle: '已公開章節',
    chapterEmpty: '第一章還在整理中。',
    latestLabel: '最新章',
    scheduleLabel: '更新節奏',
    accessLabel: '閱讀方式',
    freeLabel: '免費章數',
    statusLabel: '更新狀態',
    chapterWordCount: '字',
    previousChapter: '上一章',
    nextChapter: '下一章',
    chapterBack: '回到作品頁',
    seriesCtaNote: '第一版先把閱讀做穩，後面再接打賞和付費。',
    latestFallback: '首章很快會在這裡亮起來。'
  },
  'zh-Hans': {
    navLabel: '连载小说',
    title: 'Station Cat 连载小说',
    description: '一个放长篇小说、更新顺序和后续读者支持入口的小书架。',
    eyebrow: '连载小说',
    heroTitle: '给长篇小说的一个阅读书架。',
    heroDescription: '原本的作品集模块，先被改造成长篇连载入口，让小说、章节顺序和后续支持功能都能有固定位置。',
    heroNote: '第一版先保持轻量：小说书架、作品页、章节页，先把阅读秩序搭起来。',
    heroPrimary: '打开主推作品',
    heroSecondary: '看全部书架',
    featuredEyebrow: '主推作品',
    featuredTitle: '目前正在准备的长篇作品。',
    shelfEyebrow: '书架',
    shelfTitle: '目前公开的连载。',
    featuredEmpty: '主推作品很快会出现在这里。',
    shelfEmpty: '小说书架正在整理中。',
    openSeries: '打开作品',
    readChapter: '阅读章节',
    readLatest: '阅读最新章',
    readFirst: '从第一章开始',
    backShelf: '回到书架',
    backHome: '回到 Station Cat',
    synopsisEyebrow: '作品简介',
    synopsisTitle: '这部作品目前的入口。',
    chapterEyebrow: '章节顺序',
    chapterLabel: '第',
    chapterTitle: '已公开章节',
    chapterEmpty: '第一章还在整理中。',
    latestLabel: '最新章',
    scheduleLabel: '更新节奏',
    accessLabel: '阅读方式',
    freeLabel: '免费章数',
    statusLabel: '更新状态',
    chapterWordCount: '字',
    previousChapter: '上一章',
    nextChapter: '下一章',
    chapterBack: '回到作品页',
    seriesCtaNote: '第一版先把阅读做稳，后面再接打赏和付费。',
    latestFallback: '首章很快会在这里亮起来。'
  }
} as const;

export const getSerialStatusLabel = (status: SerialEntry['data']['status'], locale: SiteLocale) => serialStatusLabels[locale][status];

export const getPriceModeLabel = (priceMode: SerialEntry['data']['priceMode'], locale: SiteLocale) => priceModeLabels[locale][priceMode];

export const getVisibleSerials = (serials: SerialEntry[]) =>
  [...serials].sort((a, b) => {
    if (a.data.featured !== b.data.featured) {
      return a.data.featured ? -1 : 1;
    }
    const leftDate = (a.data.updatedAt ?? a.data.publishedAt).getTime();
    const rightDate = (b.data.updatedAt ?? b.data.publishedAt).getTime();
    return rightDate - leftDate;
  });

export const getPublishedChapters = (chapters: SerialChapterEntry[], seriesSlug: string) =>
  chapters
    .filter((chapter) => chapter.data.seriesSlug === seriesSlug && chapter.data.status === 'published')
    .sort((a, b) => a.data.chapterNumber - b.data.chapterNumber);

export const getLatestChapter = (chapters: SerialChapterEntry[]) => {
  if (chapters.length === 0) return undefined;
  return [...chapters].sort((a, b) => b.data.chapterNumber - a.data.chapterNumber)[0];
};

export const getSeriesHref = (basePath: string, seriesSlug: string) => `${basePath}${seriesSlug}/`;

export const getChapterHref = (basePath: string, seriesSlug: string, chapterSlug: string) => `${basePath}${seriesSlug}/${chapterSlug}/`;
