export const musicCopy = Object.freeze({
  'zh-Hant': {
    title: '音樂小站', tagline: '選一首，讓日常慢下來。', intro: '音樂記錄情緒，也陪你走過平凡的日子。',
    featured: '本期主推', selected: '精選作品', all: '全部作品', search: '搜尋歌名或藝名', searchAction: '搜尋',
    sort: '排序方式', default: '小站推薦順序', release: '最新發行', more: '載入更多作品', clear: '清除搜尋',
    empty: '還沒有找到這首歌。', emptyHelp: '試試其他歌名或藝名，或看看全部作品。', preparing: '小站正在準備新的音樂。',
    failed: '作品暫時無法載入。', retry: '重新載入', notFound: '這首作品目前無法公開查看。', back: '回到音樂小站',
    preview: '試聽', play: '播放', pause: '暫停',
    platforms: '選擇收聽平台', visit: '開啟', pending: '平台連結將在確認後更新。', detail: '查看作品',
    platformInfo: '平台發行資訊', platformPlanned: '即將上線', platformRegion: '目前不適用於你的地區', platformRegionUnknown: '地區適用資訊待確認', platformUnavailable: '目前沒有可用的平台入口。', platformBackup: '打不開平台？複製連結', platformHelp: '可複製網址，在系統瀏覽器中開啟；也可以選取下方網址手動複製。', platformUrl: '平台網址', platformCopy: '複製', platformCopying: '正在複製…', platformCopied: '連結已複製。', platformManual: '無法自動複製，請選取網址手動複製。',
    favorite: '收藏', favorited: '已收藏', local: '收藏保存在此設備。', temporary: '儲存暫時不可用；收藏僅在本次瀏覽保留。',
    corrupt: '本機記錄無法讀取；原始資料已保留，本次使用暫存收藏。', limit: '最多收藏 500 首，請先移除部分收藏。',
    lyrics: '歌詞', readLyrics: '展開歌詞', reading: '正在讀取歌詞…', lyricsFailed: '歌詞暫時無法讀取。', story: '關於這首歌',
    short: '音樂短影片', mv: '音樂錄影帶', watch: '觀看原影片', related: '也許你會喜歡',
    clipPlay: '播放影片', clipClose: '關閉影片', clipRetry: '重試影片', clipChoose: '切換影片', clipLoading: '正在載入影片…', clipPlaying: '影片播放中', clipFailed: '影片暫時無法播放。請重試。', clipBlocked: '瀏覽器未允許播放。請點擊重試。',
    loading: '正在載入…', shown: '已顯示', songs: '首作品', releaseDate: '發行日期', volume: '音量', seek: '播放進度',
    close: '收起播放器', player: '小站播放器', playbackFailed: '暫時無法播放，請重試或選擇收聽平台。',
    stale: '歌曲設定已更新，請重新載入作品。',
    blocked: '瀏覽器尚未開始播放，請再次點擊播放。', ended: '播放完畢', paused: '已暫停', buffering: '正在緩衝…', clipsFailed: '影片資訊暫時無法載入。'
  },
  en: {
    title: 'The music station', tagline: 'Pick a song. Let the day slow down.', intro: 'Songs for the feelings and the ordinary days we share.',
    featured: 'In the spotlight', selected: 'Selected songs', all: 'All songs', search: 'Search songs or artists', searchAction: 'Search',
    sort: 'Sort songs', default: 'Station order', release: 'Latest releases', more: 'Load more songs', clear: 'Clear search',
    empty: 'We haven’t found that song yet.', emptyHelp: 'Try another title or artist, or browse all songs.', preparing: 'New music is on its way.',
    failed: 'Songs could not be loaded.', retry: 'Try again', notFound: 'This song is not publicly available.', back: 'Back to music',
    preview: 'Preview', play: 'Play', pause: 'Pause',
    platforms: 'Choose where to listen', visit: 'Open', pending: 'Listening links will appear once confirmed.', detail: 'Explore song',
    platformInfo: 'Release information', platformPlanned: 'Coming soon', platformRegion: 'Not available in your region', platformRegionUnknown: 'Regional availability is not confirmed', platformUnavailable: 'No listening links are currently available.', platformBackup: 'Link not opening? Copy it', platformHelp: 'Copy a link and open it in your system browser, or select the address below to copy it manually.', platformUrl: 'Listening URL', platformCopy: 'Copy', platformCopying: 'Copying…', platformCopied: 'Link copied.', platformManual: 'Automatic copy is unavailable. Select the address to copy it manually.',
    favorite: 'Save song', favorited: 'Saved', local: 'Saved on this device.', temporary: 'Storage is unavailable; saved songs last for this visit only.',
    corrupt: 'Local data could not be read. The original is preserved; this visit uses temporary saves.', limit: 'Up to 500 saved songs. Remove one first.',
    lyrics: 'Lyrics', readLyrics: 'Read lyrics', reading: 'Loading lyrics…', lyricsFailed: 'Lyrics could not be loaded.', story: 'Behind the song',
    short: 'Music shorts', mv: 'Music video', watch: 'Watch the original', related: 'You might also like',
    clipPlay: 'Play video', clipClose: 'Close video', clipRetry: 'Retry video', clipChoose: 'Switch video', clipLoading: 'Loading video…', clipPlaying: 'Video playing', clipFailed: 'This video could not play. Please try again.', clipBlocked: 'The browser did not allow playback. Click retry.',
    loading: 'Loading…', shown: 'Showing', songs: 'songs', releaseDate: 'Release date', volume: 'Volume', seek: 'Playback position',
    close: 'Close player', player: 'Station player', playbackFailed: 'Playback is unavailable. Try again or choose a listening platform.',
    stale: 'Song settings changed. Reload the song.',
    blocked: 'Your browser has not started playback. Click play again.', ended: 'Finished', paused: 'Paused', buffering: 'Buffering…', clipsFailed: 'Video information could not be loaded.'
  },
});

export const providerNames = Object.freeze({ netease: '網易雲音樂', qishui: '汽水音樂', apple_music: 'Apple Music', youtube: 'YouTube', spotify: 'Spotify' });
export function providerName(provider, locale) {
  if (provider === 'netease') return locale === 'zh-Hans' ? '网易云音乐' : locale === 'zh-Hant' ? '網易雲音樂' : 'NetEase Music';
  if (provider === 'qishui') return locale === 'zh-Hans' ? '汽水音乐' : locale === 'zh-Hant' ? '汽水音樂' : 'Qishui Music';
  return providerNames[provider] || '';
}
