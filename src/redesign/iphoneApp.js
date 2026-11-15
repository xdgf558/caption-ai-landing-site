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
};
