import { stationHref } from './routes.js';

export const stationTestFlightUrl = 'https://testflight.apple.com/join/eEtSur8y';
export const appleTestFlightUrl = 'https://apps.apple.com/us/app/testflight/id899247664?mt=8';
export const iphoneAppHref = locale => stationHref(locale, 'music') + 'iphone/';

export const iphoneAppCopy = {
  'zh-Hant': {
    title: 'iPhone App · Station Cat Music', music: '音樂小站', explore: '探索音樂', navigation: '音樂與 App',
    beta: 'iPhone · TestFlight 公測', headline: ['喜歡的歌，', '隨身收藏。'],
    intro: '探索 Station Cat 的歌曲與專輯，\n收藏喜歡的作品，前往音樂平台收聽。',
    join: '加入 iOS 公測', stepsLink: '查看安裝步驟', noAccount: '無需註冊 Station Cat 帳號',
    steps: '如何安裝 iOS 公測版', first: '先安裝 TestFlight', firstText: '在 iPhone 上安裝 Apple 官方的 TestFlight App。',
    getTestFlight: '取得 TestFlight', second: '再加入公測，接受邀請並安裝',
    secondText: '點擊「加入 iOS 公測」，在 TestFlight 中接受邀請並安裝 Station Cat Music。',
    languages: '支援語言', screenshot: 'Station Cat Music iPhone App：探索作品、收藏歌曲，前往音樂平台收聽。',
    discover: '也可以，先在小站逛逛。', discoverText: '發現更多好聽的作品，讓音樂陪你走過平凡的日子。', back: '返回全部作品',
  },
  'zh-Hans': {
    title: 'iPhone App · Station Cat Music', music: '音乐小站', explore: '探索音乐', navigation: '音乐与 App',
    beta: 'iPhone · TestFlight 公测', headline: ['喜欢的歌，', '随身收藏。'],
    intro: '探索 Station Cat 的歌曲与专辑，\n收藏喜欢的作品，前往音乐平台收听。',
    join: '加入 iOS 公测', stepsLink: '查看安装步骤', noAccount: '无需注册 Station Cat 账号',
    steps: '如何安装 iOS 公测版', first: '先安装 TestFlight', firstText: '在 iPhone 上安装 Apple 官方的 TestFlight App。',
    getTestFlight: '获取 TestFlight', second: '再加入公测，接受邀请并安装',
    secondText: '点击「加入 iOS 公测」，在 TestFlight 中接受邀请并安装 Station Cat Music。',
    languages: '支持语言', screenshot: 'Station Cat Music iPhone App：探索作品、收藏歌曲，前往音乐平台收听。',
    discover: '也可以，先在小站逛逛。', discoverText: '发现更多好听的作品，让音乐陪你走过平凡的日子。', back: '返回全部作品',
  },
  en: {
    title: 'iPhone App · Station Cat Music', music: 'The music station', explore: 'Explore music', navigation: 'Music and app',
    beta: 'iPhone · TestFlight beta', headline: ['Your favorite songs,', 'always with you.'],
    intro: 'Explore Station Cat songs and albums, save your favorites, and listen on your preferred music platform.',
    join: 'Join the iOS beta', stepsLink: 'How to install', noAccount: 'No Station Cat account needed',
    steps: 'Install the iOS beta in two steps', first: 'Install TestFlight', firstText: 'Get Apple’s official TestFlight app on your iPhone.',
    getTestFlight: 'Get TestFlight', second: 'Join the beta and install the app',
    secondText: 'Tap “Join the iOS beta”, then accept the invitation and install Station Cat Music in TestFlight.',
    languages: 'Languages', screenshot: 'Station Cat Music for iPhone: discover music, save favorites, and open listening platforms.',
    discover: 'Or, stay a little longer.', discoverText: 'Find your next favorite song here at the station.', back: 'Explore all music',
  },
  ja: {
    title: 'iPhone App · Station Cat Music', music: '音楽の駅', explore: '音楽を探す', navigation: '音楽とアプリ',
    beta: 'iPhone · TestFlight ベータ版', headline: ['好きな曲を、', 'いつもそばに。'],
    intro: 'Station Cat の曲やアルバムを見つけて、お気に入りに保存。音楽配信サービスで楽しめます。',
    join: 'iOS ベータ版に参加', stepsLink: 'インストール方法', noAccount: 'Station Cat のアカウント登録は不要です',
    steps: '2 ステップでベータ版をインストール', first: 'TestFlight をインストール', firstText: 'Apple 公式の TestFlight アプリを iPhone にインストールします。',
    getTestFlight: 'TestFlight を入手', second: 'ベータ版に参加してインストール',
    secondText: '「iOS ベータ版に参加」をタップし、TestFlight で招待を受け入れ、Station Cat Music をインストールしてください。',
    languages: '対応言語', screenshot: 'Station Cat Music の iPhone アプリ：曲を探してお気に入りに保存し、音楽配信サービスへ。',
    discover: '小さな駅でもう少し。', discoverText: 'お気に入りの曲を見つけて、いつもの日々に音楽を。', back: 'すべての作品を見る',
  },
};
