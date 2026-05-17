import type { Locale } from './site';

export const devlogLocales = [
  { lang: 'zh-Hant', pathLocale: 'zh-hant' },
  { lang: 'zh-Hans', pathLocale: 'zh-hans' },
  { lang: 'en', pathLocale: 'en' },
  { lang: 'ja', pathLocale: 'ja' }
] as const;

export const devlogCopy = {
  'zh-Hant': {
    title: 'Station Cat 開發博客',
    description: 'Station Cat 的開發進度、產品實驗、上架準備和創作記錄。',
    eyebrow: 'Dev Blog',
    heroTitle: '開發進度和一些正在長出來的東西。',
    heroDescription:
      '這裡會記錄 Station Cat 的網站調整、SnapCopy 開發進度、上架準備、AI 實驗和一些產品想法。',
    buildNotes: 'Build notes',
    postCount: '篇開發記錄',
    postsLabel: '開發博客文章',
    empty: '目前還沒有這個語言的開發記錄。',
    back: '返回開發博客',
    titleSuffix: 'Station Cat 開發博客',
    statuses: {
      building: '開發中',
      shipped: '已完成',
      note: '記錄',
      maintenance: '維護'
    }
  },
  'zh-Hans': {
    title: 'Station Cat 开发博客',
    description: 'Station Cat 的开发进度、产品实验、上架准备和创作记录。',
    eyebrow: 'Dev Blog',
    heroTitle: '开发进度和一些正在长出来的东西。',
    heroDescription:
      '这里会记录 Station Cat 的网站调整、SnapCopy 开发进度、上架准备、AI 实验和一些产品想法。',
    buildNotes: 'Build notes',
    postCount: '篇开发记录',
    postsLabel: '开发博客文章',
    empty: '目前还没有这个语言的开发记录。',
    back: '返回开发博客',
    titleSuffix: 'Station Cat 开发博客',
    statuses: {
      building: '开发中',
      shipped: '已完成',
      note: '记录',
      maintenance: '维护'
    }
  },
  en: {
    title: 'Station Cat Dev Blog',
    description: 'Development updates, product experiments, launch notes, and creative records from Station Cat.',
    eyebrow: 'Dev Blog',
    heroTitle: 'Build notes from the station.',
    heroDescription:
      'A running log for Station Cat website updates, SnapCopy progress, launch preparation, AI experiments, and product ideas.',
    buildNotes: 'Build notes',
    postCount: 'dev notes',
    postsLabel: 'Dev blog posts',
    empty: 'No dev notes are available in this language yet.',
    back: 'Back to Dev Blog',
    titleSuffix: 'Station Cat Dev Blog',
    statuses: {
      building: 'Building',
      shipped: 'Shipped',
      note: 'Note',
      maintenance: 'Maintenance'
    }
  },
  ja: {
    title: 'Station Cat 開発ログ',
    description: 'Station Cat の開発進捗、プロダクト実験、公開準備、制作メモ。',
    eyebrow: 'Dev Blog',
    heroTitle: '開発の進捗と、少しずつ育っているもの。',
    heroDescription:
      'Station Cat のサイト更新、SnapCopy の開発状況、公開準備、AI 実験、プロダクトのアイデアを記録します。',
    buildNotes: 'Build notes',
    postCount: '件の開発ログ',
    postsLabel: '開発ログの記事',
    empty: 'この言語の開発ログはまだありません。',
    back: '開発ログへ戻る',
    titleSuffix: 'Station Cat 開発ログ',
    statuses: {
      building: '開発中',
      shipped: '公開済み',
      note: 'メモ',
      maintenance: 'メンテナンス'
    }
  }
} satisfies Record<Locale, {
  title: string;
  description: string;
  eyebrow: string;
  heroTitle: string;
  heroDescription: string;
  buildNotes: string;
  postCount: string;
  postsLabel: string;
  empty: string;
  back: string;
  titleSuffix: string;
  statuses: Record<'building' | 'shipped' | 'note' | 'maintenance', string>;
}>;

export const devlogPathPrefix = {
  'zh-Hant': '',
  'zh-Hans': '/zh-hans',
  en: '/en',
  ja: '/ja'
} satisfies Record<Locale, string>;

export const dateLocale = {
  'zh-Hant': 'zh-Hant',
  'zh-Hans': 'zh-Hans',
  en: 'en',
  ja: 'ja'
} satisfies Record<Locale, string>;

export const pathLocaleToLang = (locale: string): Locale => {
  if (locale === 'zh-hans') return 'zh-Hans';
  if (locale === 'ja') return 'ja';
  if (locale === 'en') return 'en';
  return 'zh-Hant';
};

export const devlogPath = (lang: Locale, slug?: string) => {
  const prefix = devlogPathPrefix[lang];
  return `${prefix}/devlog/${slug ? `${slug}/` : ''}`;
};

export const devlogSlug = (post: { id: string; data: { postSlug?: string } }) =>
  post.data.postSlug || post.id.replace(/\.md$/, '').replace(/\.(zh-Hant|zh-Hans|en|ja)$/i, '');

export const formatDevlogDate = (date: Date, lang: Locale) =>
  new Intl.DateTimeFormat(dateLocale[lang], {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
