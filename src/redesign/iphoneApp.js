import { stationHref } from './routes.js';

export const stationAppStoreUrl = 'https://apps.apple.com/app/id6822797145';
export const iphoneAppHref = locale => stationHref(locale, 'music') + 'iphone/';

export const iphoneAppCopy = {
  'zh-Hant': {
    title: 'iPhone App · Station Cat Music', music: '音樂小站', explore: '探索音樂', navigation: '音樂與 App',
    availability: 'iPhone · 已在 App Store 上架', available: '已上架', headline: ['喜歡的歌，', '隨身收藏。'],
    intro: '讀歌詞與創作故事，記下自己的聽歌靈感。\n收藏喜歡的作品，前往音樂平台收聽。',
    download: 'App Store 免費下載', featuresLink: '了解 App', requirements: '免費 · iOS 18.0 或以上 · 無需 Station Cat 帳號',
    featuresTitle: '歌曲、故事，還有你的筆記',
    features: [
      { title: '讀一首歌背後的故事', text: '探索單曲與專輯，閱讀已公開的歌詞、作品介紹與創作故事。' },
      { title: '把靈感留在自己的筆記裡', text: '按主題整理筆記，離線也能閱讀與編輯。筆記僅保存在這台裝置。' },
      { title: '收藏作品，前往平台收聽', text: '搜尋歌曲與藝人、收藏喜歡的作品，再開啟你慣用的音樂平台收聽。' },
    ],
    languages: '支援語言', screenshot: 'Station Cat Music iPhone App：探索作品、收藏歌曲，前往音樂平台收聽。',
    discover: '也可以，先在小站逛逛。', discoverText: '發現更多好聽的作品，讓音樂陪你走過平凡的日子。', back: '返回全部作品',
  },
  'zh-Hans': {
    title: 'iPhone App · Station Cat Music', music: '音乐小站', explore: '探索音乐', navigation: '音乐与 App',
    availability: 'iPhone · 已在 App Store 上架', available: '已上架', headline: ['喜欢的歌，', '随身收藏。'],
    intro: '读歌词与创作故事，记下自己的听歌灵感。\n收藏喜欢的作品，前往音乐平台收听。',
    download: 'App Store 免费下载', featuresLink: '了解 App', requirements: '免费 · iOS 18.0 或以上 · 无需 Station Cat 账号',
    featuresTitle: '歌曲、故事，还有你的笔记',
    features: [
      { title: '读一首歌背后的故事', text: '探索单曲与专辑，阅读已公开的歌词、作品介绍与创作故事。' },
      { title: '把灵感留在自己的笔记里', text: '按主题整理笔记，离线也能阅读与编辑。笔记仅保存在这台设备。' },
      { title: '收藏作品，前往平台收听', text: '搜索歌曲与艺人、收藏喜欢的作品，再打开你惯用的音乐平台收听。' },
    ],
    languages: '支持语言', screenshot: 'Station Cat Music iPhone App：探索作品、收藏歌曲，前往音乐平台收听。',
    discover: '也可以，先在小站逛逛。', discoverText: '发现更多好听的作品，让音乐陪你走过平凡的日子。', back: '返回全部作品',
  },
  en: {
    title: 'iPhone App · Station Cat Music', music: 'The music station', explore: 'Explore music', navigation: 'Music and app',
    availability: 'iPhone · Now on the App Store', available: 'Available now', headline: ['Your favorite songs,', 'always with you.'],
    intro: 'Read lyrics and the stories behind the music. Keep your own notes, save favorites, and listen on your preferred music platform.',
    download: 'Download on the App Store', featuresLink: 'Explore the app', requirements: 'Free · iOS 18.0 or later · No Station Cat account needed',
    featuresTitle: 'Songs, stories, and your own notes',
    features: [
      { title: 'Find the story behind a song', text: 'Explore singles and albums, with published lyrics, introductions, and stories from the creator.' },
      { title: 'Make space for your own words', text: 'Organize notes by topic and read or edit them offline. Notes stay on this device.' },
      { title: 'Save favorites and choose where to listen', text: 'Search by song or artist, save the works you love, and open your preferred music service to listen.' },
    ],
    languages: 'Languages', screenshot: 'Station Cat Music for iPhone: discover music, save favorites, and open listening platforms.',
    discover: 'Or, stay a little longer.', discoverText: 'Find your next favorite song here at the station.', back: 'Explore all music',
  },
  ja: {
    title: 'iPhone App · Station Cat Music', music: '音楽の駅', explore: '音楽を探す', navigation: '音楽とアプリ',
    availability: 'iPhone · App Store で配信中', available: '配信中', headline: ['好きな曲を、', 'いつもそばに。'],
    intro: '歌詞や制作の物語を読んで、感じたことを自分のノートに。\n好きな作品を保存して、音楽配信サービスで楽しめます。',
    download: 'App Store で無料ダウンロード', featuresLink: 'アプリについて', requirements: '無料 · iOS 18.0 以降 · Station Cat アカウント不要',
    featuresTitle: '曲と物語、そして自分のノート',
    features: [
      { title: '曲が生まれた物語を読む', text: 'シングルやアルバムを探して、公開されている歌詞、作品紹介、制作の物語を読めます。' },
      { title: '感じたことをノートに残す', text: 'テーマ別に整理したノートを、オフラインでも読み書きできます。ノートはこの端末だけに保存されます。' },
      { title: 'お気に入りを保存して、聴きに行く', text: '曲名やアーティストで検索して作品を保存。使い慣れた音楽配信サービスを開いて聴けます。' },
    ],
    languages: '対応言語', screenshot: 'Station Cat Music の iPhone アプリ：曲を探してお気に入りに保存し、音楽配信サービスへ。',
    discover: '小さな駅でもう少し。', discoverText: 'お気に入りの曲を見つけて、いつもの日々に音楽を。', back: 'すべての作品を見る',
  },
};
