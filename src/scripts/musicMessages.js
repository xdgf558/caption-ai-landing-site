// UI text only; catalog titles/tags retain the server's actual translation/original.
export const musicLocales = ['zh-Hans', 'zh-Hant', 'en', 'ja'];
const rows = `
歌曲详情|歌曲詳情|Song details|曲の詳細
关闭详情|關閉詳情|Close details|詳細を閉じる
筛选歌曲|篩選歌曲|Filter songs|曲を絞り込む
关闭筛选|關閉篩選|Close filters|絞り込みを閉じる
查看歌曲|查看歌曲|Show songs|曲を表示
打开菜单|打開選單|Open menu|メニューを開く
关闭菜单|關閉選單|Close menu|メニューを閉じる
菜单|選單|Menu|メニュー
播放列表说明|播放清單說明|How the queue works|再生リストについて
音乐小站|音樂小站|Music at Station Cat|音楽の小駅
选一首，让日常慢下来。|選一首，讓日常慢下來。|A song for a slower day.|一曲選んで、ひと息。
音乐播放器|音樂播放器|Music player|音楽プレーヤー
队列设置|佇列設定|Queue settings|再生設定
播放全部|播放全部|Play all|すべて再生
随机|隨機|Shuffle|シャッフル
顺序播放|順序播放|In order|順番に再生
列表循环|清單循環|Repeat queue|全曲リピート
单曲循环|單曲循環|Repeat track|1曲リピート
{mode}，点击切换循环方式|{mode}，點擊切換循環方式|{mode}; change repeat mode|{mode}：リピート方法を変更
队列|佇列|Queue|再生リスト
点击列表的播放按钮，会按当前列表重建队列；底栏继续播放保留原队列。|點擊清單的播放按鈕，會按目前清單重建佇列；底欄繼續播放保留原佇列。|Playing a song here replaces the queue with these results. Resume in the bottom player to keep your queue.|一覧の再生ボタンで、この結果から再生リストを作り直します。下部の再生ボタンなら今のリストを保ちます。
正在整理曲目…|正在整理曲目…|Loading songs…|曲を読み込み中…
重新加载|重新載入|Reload|再読み込み
选择歌曲|選擇歌曲|Choose a song|曲を選択
当前歌曲|目前歌曲|Song details|曲の詳細
暂无封面|暫無封面|No artwork|ジャケット未登録
尚未播放|尚未播放|Ready to play|未再生
正在载入|正在載入|Loading|読み込み中
正在播放|正在播放|Playing|再生中
已暂停|已暫停|Paused|一時停止中
正在缓冲|正在緩衝|Buffering|バッファリング中
播放结束|播放結束|Ended|再生終了
暂不可播放|暫不可播放|Unavailable|再生できません
资格暂不可用|資格暫不可用|Access unavailable|資格を確認できません
播放遇到问题|播放遇到問題|Playback problem|再生エラー
播放资格与版本|播放資格與版本|Access and versions|再生資格とバージョン
从头播放完整版|從頭播放完整版|Play full track from start|フル版を最初から再生
播放试听|播放試聽|Play preview|試聴する
重新核验资格|重新核驗資格|Check access again|資格を再確認
重新加载曲目|重新載入曲目|Reload songs|曲を再読み込み
前往会员中心|前往會員中心|Membership centre|会員センターへ
播放控制|播放控制|Playback controls|再生コントロール
上一首；超过三秒时回到开头|上一首；超過三秒時回到開頭|Previous; restart after three seconds|前の曲：3秒経過後は曲の先頭へ
播放|播放|Play|再生
暂停|暫停|Pause|一時停止
试听|試聽|Preview|試聴
下一首|下一首|Next|次の曲
播放进度|播放進度|Playback position|再生位置
音量|音量|Volume|音量
静音|靜音|Mute|ミュート
取消静音|取消靜音|Unmute|ミュート解除
请用设备音量按键调节音量。|請用裝置音量按鍵調節音量。|Use your device volume buttons.|音量は端末のボタンで調節してください。
待播队列|待播佇列|Up next|次に再生
关闭队列|關閉佇列|Close queue|再生リストを閉じる
从歌曲列表开始播放或点击“播放全部”会重建队列；只浏览歌曲不改变待播顺序。随机播放时，上一首返回实际收听历史。|從歌曲清單開始播放或點擊「播放全部」會重建佇列；只瀏覽歌曲不改變待播順序。隨機播放時，上一首返回實際收聽歷史。|Starting from the song list or Play all replaces the queue. Browsing leaves it unchanged. In shuffle mode, Previous follows your listening history.|一覧から再生するか「すべて再生」でリストを作り直します。閲覧だけでは変わりません。シャッフル中の「前の曲」は再生履歴をたどります。
队列为空，选择歌曲或点击播放全部。|佇列為空，選擇歌曲或點擊播放全部。|Your queue is empty. Choose a song or Play all.|再生リストは空です。曲を選ぶか、すべて再生してください。
没有下一首可完整收听的曲目时，将停止播放。|沒有下一首可完整收聽的曲目時，將停止播放。|Playback stops if no next full track is available.|次にフル再生できる曲がなければ停止します。
移除并播放下一首|移除並播放下一首|Remove and play next|削除して次の曲へ
移除并停止|移除並停止|Remove and stop|削除して停止
取消|取消|Cancel|キャンセル
加入当前曲目|加入目前曲目|Add current song|現在の曲を追加
清空并停止|清空並停止|Clear and stop|空にして停止
免费完整收听|免費完整收聽|Free full track|無料フル再生
VIP 完整收听|VIP 完整收聽|VIP full track|VIPフル再生
VIP · 可试听|VIP · 可試聽|VIP · preview available|VIP・試聴あり
VIP · 暂无试听|VIP · 暫無試聽|VIP · no preview|VIP・試聴なし
重新播放|重新播放|Play again|もう一度再生
重试播放|重試播放|Retry playback|再生を再試行
继续播放|繼續播放|Resume|再開
这首作品暂未提供试听。|這首作品暫未提供試聽。|No preview is available for this song.|この曲には試聴がありません。
{time}，共 {duration}|{time}，共 {duration}|{time} of {duration}|{time} / {duration}
选择：{title}|選擇：{title}|View: {title}|詳細：{title}
{action}：{title}|{action}：{title}|{action}: {title}|{action}：{title}
小站还在准备音乐，稍后再来听听。|小站還在準備音樂，稍後再來聽聽。|Music is on its way. Come back soon.|音楽を準備中です。またお立ち寄りください。
曲目暂时无法加载，请稍后重试。|曲目暫時無法載入，請稍後重試。|Songs could not be loaded. Please try again.|曲を読み込めませんでした。再試行してください。
当前浏览器的多个音乐标签页会独立播放。|目前瀏覽器的多個音樂分頁會獨立播放。|Music tabs play independently in this browser.|このブラウザーでは音楽タブがそれぞれ再生されます。
已在另一个音乐标签页播放；点击播放可切回这里。|已在另一個音樂分頁播放；點擊播放可切回這裡。|Playing in another music tab. Press Play to return here.|別の音楽タブで再生中です。再生ボタンでこちらに戻せます。
暂不可用|暫不可用|Unavailable|利用できません
完整收听|完整收聽|Full track|フル再生
仅手动试听|僅手動試聽|Manual preview only|手動で試聴のみ
暂无试听|暫無試聽|No preview|試聴なし
当前曲目|目前曲目|Current song|現在の曲
{action}队列曲目：{title}|{action}佇列曲目：{title}|{action} queued song: {title}|リストの曲を{action}：{title}
移出队列：{title}|移出佇列：{title}|Remove from queue: {title}|リストから削除：{title}
移除「{title}」后：|移除「{title}」後：|After removing “{title}”:|「{title}」を削除した後：
队列最多保留 500 首，重复曲目只保留一次。|佇列最多保留 500 首，重複曲目只保留一次。|The queue holds up to 500 unique songs.|再生リストは重複なしで最大500曲です。
队列中暂无可完整收听的曲目，可以选择单曲试听。|佇列中暫無可完整收聽的曲目，可以選擇單曲試聽。|No full tracks are available in this queue. You can preview songs individually.|フル再生できる曲がありません。各曲を個別に試聴できます。
已到队列末尾。|已到佇列末尾。|End of queue.|再生リストの最後です。
已到队列开头。|已到佇列開頭。|Start of queue.|再生リストの先頭です。
试听已结束，再次收听请手动播放。|試聽已結束，再次收聽請手動播放。|Preview ended. Press Play to listen again.|試聴が終了しました。もう一度聴くには再生してください。
连续三首播放失败，已停止。请稍后手动重试。|連續三首播放失敗，已停止。請稍後手動重試。|Stopped after three playback failures. Please try again later.|再生に3回連続で失敗したため停止しました。後でもう一度お試しください。
可播放的曲目暂时无法载入，请稍后手动重试。|可播放的曲目暫時無法載入，請稍後手動重試。|Available songs could not be loaded. Please try again later.|再生可能な曲を読み込めません。後でもう一度お試しください。
这首曲目暂不可播放。|這首曲目暫不可播放。|This song is unavailable.|この曲は再生できません。
暂时无法回到开头，请稍后重试。|暫時無法回到開頭，請稍後重試。|Could not return to the start. Please try again.|先頭に戻れません。再試行してください。
暂时无法播放，请重试或选择另一首。|暫時無法播放，請重試或選擇另一首。|Unable to play. Retry or choose another song.|再生できません。再試行するか、別の曲を選んでください。
浏览器尚未开始播放，请再次点击播放。|瀏覽器尚未開始播放，請再次點擊播放。|Playback did not start. Press Play again.|再生を開始できませんでした。もう一度再生してください。
资格暂时无法确认，请重新核验；也可尝试免费曲或试听。|資格暫時無法確認，請重新核驗；也可嘗試免費曲或試聽。|Access could not be confirmed. Check again, or try a free track or preview.|資格を確認できません。再確認するか、無料の曲や試聴をお試しください。
正在重新核验资格，请稍候。|正在重新核驗資格，請稍候。|Checking access. Please wait.|資格を確認中です。お待ちください。
请登录后重新核验，或手动播放试听。|請登入後重新核驗，或手動播放試聽。|Sign in and check again, or play a preview.|ログインして再確認するか、試聴してください。
账号状态受限，请前往会员中心查看。|帳號狀態受限，請前往會員中心查看。|Your account is restricted. Visit the membership centre.|アカウントが制限されています。会員センターをご確認ください。
当前没有完整收听资格，可手动播放试听或前往会员中心。|目前沒有完整收聽資格，可手動播放試聽或前往會員中心。|Full playback is not available. Play a preview or visit the membership centre.|フル再生の資格がありません。試聴するか、会員センターをご確認ください。
歌曲已更新或暂不可用，请重新加载曲目。|歌曲已更新或暫不可用，請重新載入曲目。|This song has changed or is unavailable. Reload songs.|曲が更新されたか、利用できません。曲を再読み込みしてください。
浏览曲库|瀏覽曲庫|Browse music|曲を探す
最新发布|最新發布|Latest releases|新着
免费精选|免費精選|Free picks|無料のおすすめ
按最新发布选取免费作品。|按最新發布選取免費作品。|Free tracks, newest first.|新しい無料の曲からご紹介。
搜索歌曲、创作者或标签|搜尋歌曲、創作者或標籤|Search songs, creators or tags|曲名・制作者・タグで検索
搜索|搜尋|Search|検索
风格|風格|Genre|ジャンル
心情|心情|Mood|気分
收听方式|收聽方式|Access|再生タイプ
全部|全部|All|すべて
免费|免費|Free|無料
歌单|歌單|Collections|コレクション
全部歌曲|全部歌曲|All songs|すべての曲
清除筛选|清除篩選|Clear filters|絞り込みを解除
显示 {shown} / {total} 首|顯示 {shown} / {total} 首|Showing {shown} of {total} songs|{total}曲中{shown}曲を表示
再显示 50 首|再顯示 50 首|Show 50 more|さらに50曲表示
没有匹配的歌曲，试试其他条件。|沒有符合的歌曲，試試其他條件。|No songs match. Try different filters.|該当する曲がありません。条件を変えてみてください。
当前目录中未找到此歌曲或歌单。|目前目錄中未找到此歌曲或歌單。|This song or collection is not in the current catalog.|この曲またはコレクションは現在の曲一覧にありません。
开启 JavaScript 后可浏览和播放音乐。|開啟 JavaScript 後可瀏覽和播放音樂。|Enable JavaScript to browse and play music.|音楽の閲覧と再生にはJavaScriptを有効にしてください。
{count} 首|{count} 首|{count} songs|{count}曲
音乐作品、歌单与免费试听。|音樂作品、歌單與免費試聽。|Original music, collections and free previews.|音楽作品、コレクションと無料試聴。
`;
export const musicMessages = Object.fromEntries(rows.trim().split('\n').map(line => { const [key, ...values] = line.split('|'); return [key, [key, ...values]]; }));
export function musicText(locale = 'zh-Hans') {
  const index = Math.max(0, musicLocales.indexOf(locale));
  return (key, values = {}) => (musicMessages[key]?.[index] ?? key).replace(/\{(\w+)\}/g, (all, name) => String(values[name] ?? all));
}
