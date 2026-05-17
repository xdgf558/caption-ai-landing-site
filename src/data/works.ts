export const worksCopy = {
  en: {
    title: 'Works from Station Cat',
    description: 'A small archive of X videos, posts, AI experiments, cats, meals, app builds, and strange ideas from Station Cat.',
    eyebrow: 'Works',
    heroTitle: 'Works from Station Cat',
    heroDescription: 'A small archive of videos, posts, AI experiments, cats, meals, app builds, and strange ideas originally posted on X.',
    heroNote: 'Open the original post on X to watch, reply, repost, or follow Station Cat.',
    follow: 'Follow on X',
    visit: 'Visit Station Cat',
    featuredEyebrow: 'Featured Works',
    featuredTitle: 'Selected posts and experiments.',
    featuredEmpty: 'Featured works will appear here soon.',
    allEyebrow: 'All Works',
    allTitle: 'The public archive.',
    allEmpty: 'New works will appear here soon.',
    ctaTitle: 'Follow the original posts.',
    ctaDescription: 'Station Cat keeps the living conversation on X. This page keeps a small, tidy archive for the website.',
    viewApp: 'View SnapCopy',
    watch: 'Watch on X',
    embedFallback: 'View this post on X',
    invalid: 'Invalid X post URL.'
  },
  'zh-Hant': {
    title: 'Station Cat 作品集',
    description: 'Station Cat 在 X 上發布的影片、貼文、AI 實驗、貓、飯桌、App 開發和奇怪想法小存檔。',
    eyebrow: 'Works',
    heroTitle: 'Station Cat 作品集',
    heroDescription: '這裡整理一些原本發布在 X 上的影片、貼文、AI 實驗、貓咪、飯桌、App 開發和奇怪想法。',
    heroNote: '想觀看、回覆、轉發或追蹤 Station Cat，可以打開 X 原貼文。',
    follow: '關注我的 X',
    visit: '回到 Station Cat',
    featuredEyebrow: '精選作品',
    featuredTitle: '一些近期貼文和實驗。',
    featuredEmpty: '新的精選作品很快會出現在這裡。',
    allEyebrow: '全部作品',
    allTitle: '公開存檔。',
    allEmpty: '新的作品很快會出現在這裡。',
    ctaTitle: '去 X 看原貼文。',
    ctaDescription: 'Station Cat 會把正在發生的對話留在 X，這個頁面則整理成一個乾淨的小存檔。',
    viewApp: '查看 SnapCopy',
    watch: '在 X 上查看',
    embedFallback: '在 X 上查看這篇貼文',
    invalid: 'X 原貼文連結無效。'
  },
  'zh-Hans': {
    title: 'Station Cat 作品集',
    description: 'Station Cat 在 X 上发布的视频、帖子、AI 实验、猫、饭桌、App 开发和奇怪想法小存档。',
    eyebrow: 'Works',
    heroTitle: 'Station Cat 作品集',
    heroDescription: '这里整理一些原本发布在 X 上的视频、帖子、AI 实验、猫咪、饭桌、App 开发和奇怪想法。',
    heroNote: '想观看、回复、转发或关注 Station Cat，可以打开 X 原帖。',
    follow: '关注我的 X',
    visit: '回到 Station Cat',
    featuredEyebrow: '精选作品',
    featuredTitle: '一些近期帖子和实验。',
    featuredEmpty: '新的精选作品很快会出现在这里。',
    allEyebrow: '全部作品',
    allTitle: '公开存档。',
    allEmpty: '新的作品很快会出现在这里。',
    ctaTitle: '去 X 看原帖。',
    ctaDescription: 'Station Cat 会把正在发生的对话留在 X，这个页面则整理成一个干净的小存档。',
    viewApp: '查看 SnapCopy',
    watch: '在 X 上查看',
    embedFallback: '在 X 上查看这篇帖子',
    invalid: 'X 原帖链接无效。'
  },
  ja: {
    title: 'Station Cat の作品',
    description: 'Station Cat が X に投稿した動画、投稿、AI 実験、猫、食卓、アプリ開発、少し不思議なアイデアの小さなアーカイブです。',
    eyebrow: 'Works',
    heroTitle: 'Station Cat の作品',
    heroDescription: 'X に投稿した動画、投稿、AI 実験、猫、食卓、アプリ開発、少し不思議なアイデアをまとめた小さなアーカイブです。',
    heroNote: '視聴、返信、リポスト、フォローは X の元投稿から行えます。',
    follow: 'Xでフォロー',
    visit: 'Station Cat に戻る',
    featuredEyebrow: 'Featured Works',
    featuredTitle: '選んだ投稿と実験。',
    featuredEmpty: '新しい作品はここに表示されます。',
    allEyebrow: 'All Works',
    allTitle: '公開アーカイブ。',
    allEmpty: '新しい作品はここに表示されます。',
    ctaTitle: '元投稿を X で見る。',
    ctaDescription: 'Station Cat のリアルタイムな会話は X に残し、このページでは小さく整理して保存しています。',
    viewApp: 'SnapCopy を見る',
    watch: 'Xで見る',
    embedFallback: 'この投稿を X で見る',
    invalid: 'X の投稿URLが無効です。'
  }
} as const;

export const getSortedWorks = (works: any[]) =>
  works
    .filter((work) => work.data.status === 'published')
    .sort((a, b) => {
      const orderDiff = a.data.sortOrder - b.data.sortOrder;
      if (orderDiff !== 0) return orderDiff;
      return new Date(b.data.publishedAt ?? 0).getTime() - new Date(a.data.publishedAt ?? 0).getTime();
    });
