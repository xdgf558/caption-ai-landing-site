# T09 音频播放器与请求竞态

T09 从 T08 的实际 squash 合并提交 `14cbead7d868d23154baf263c8d86b616c8d2268` 开始。T08 审查头 `f09f8de960227301ef34d06d438a79c1d7a4490a` 的完整托管 CI 已成功，30 个步骤全通过；[托管运行](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37592569293/job/112697326340)与[基线证据](T09-evidence/T08-approved-head-ci.json)可核对。T09 自身的托管结果必须以本 PR 当前头单独确认，不能沿用这份基线通过记录。

本批实现新音乐壳中的单一音频会话，保持用户确认的温柔小站和五项导航。它仍由 `STATION_MUSIC_PAGES_ENABLED` 与 `STATION_CONTENT_PUBLIC_ENABLED` 共同门控，未开启任一开关时保持 T08 的空返回合同。没有正式页面启用、远程迁移或旧入口关闭；主推歌曲、平台、试听和视频仍由用户稍后确定。

## 所有权与导航

`musicSession.js` 拥有曲目、准备请求、原生播放器和本机收藏服务；`musicClient.js` 只拥有当前页面的目录、歌词及操作监听。`musicPlayerView.js` 拥有持久底部播放器的操作和状态展示。曲目按钮不创建新 audio，页面卸载只取消自己的请求与监听。

音乐壳采用项目锁定的 Astro 5.18.1 `ClientRouter` 与固定 `transition:persist` 名称。目录、详情、语言切换、前进和后退继续使用同一 DOM audio、地址、播放位置和 `playbackId`。浏览另一首详情不选中那首歌；已知同一歌曲的公开本地化 DTO 仅更新显示。已知发布/推广版本变化或试听关闭会卸载旧选择，不保留已知失效音频。页面操作及底部几何在 `astro:after-swap` 绑定，`astro:page-load` 是有去重保护的初始/补充入口。新音乐壳正文与播放器禁用页面切换动画；原生切换快照层不接收指针事件，避免刚换页的按钮被覆盖。

其他正式页面尚未接入新壳。从音乐跳往现有账号、关于或其他旧页面会正常整页导航，`pagehide` 卸载音频并保存公开选择；返回后保持暂停。T09 不宣称当前线上全站导航已持久化，也不扩大游戏运行目录或原生 AASA 的关联。全站挂载、短视频互斥和游戏协调仍需后续任务接入。

依据：[Astro 的客户端导航、生命周期和持久媒体说明](https://docs.astro.build/en/guides/view-transitions/)。快照覆盖层依据 [MDN 的 ::view-transition 说明](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::view-transition)。没有升级框架或更改 Worker 兼容日期。

## 播放会话

共享 `musicPlayerCore.js` 增加 `playbackId` 和 `onPlaybackStart`，旧数字 `playbackGeneration`、默认 UUID 音频适配器、队列及统计客户端仍保留。原生当前资源满足 `readyState`、`paused`、`ended` 和当前播放意图检查后，`playing` 才确认开始并回调一次；`play()` Promise 完成、点击或加载不产生开始回调。

| 操作 | ID 与媒体状态 |
|---|---|
| 首次主动播放、切歌/切资源版本 | 创建新 ID，进入 loading，等待原生 playing |
| 暂停后继续、拖动进度、缓冲恢复 | 沿用同一 ID，不重复开始回调 |
| 自然结束 | ended，不自动切歌或重播 |
| 结束后主动重播 | 新 ID，从零开始；完整资源先重新核权 |
| NotAllowedError | paused 与可重试提示，不产生开始回调或最近播放记录 |
| 刷新 | 选择保持暂停，ID 不保存、不自动设 src |
| 关闭或已知账号失效 | 卸载源，取消过期工作；账号变化不授予权限 |

新版解码时长可能略短于 MP3 包元数据。新会话启用 `resetRestoredEnd`，在原生元数据确认后将位于实际末尾的恢复进度归零；旧播放器默认行为不变。自然结束后页面离开也保存零进度，避免下一次主动播放直接落在结尾。

本批的开始回调是 T18 可接入的前端观察点，不是事件接收器，没有写入 `station_analytics_events` 或新匿名会话。有效试听仍按主文档要求留到 T18 的前台实际累计 10 秒或实际结束；没有改写旧音乐 `qualified_play`/`play_complete` 的历史阈值，也未把两套统计混在一起。本机最近播放仅在实际开始回调更新。

## 请求与完整资源

完整播放继续使用 T07 的私有 `/playback?variant=full` 握手和精确地址校验。公共 `fullPlayback` 只表示待确认入口。检查成功之后还需用户明确点击，检查过程没有 src 或自动 play；不从回填 `site_audio_mode`、历史购买或本机数据推导会员授权。

准备请求带递增 `requestVersion` 与 AbortController。新的选曲、核权、关闭、页面切换或账号通知取消旧请求；即使旧 fetch 忽略 abort，其结果也被请求版本拒绝。旧原生 play Promise 与媒体事件继续由核心的源代数、调用代数和原生资源属性拒绝。

完整资源暂停时立即卸载缓冲，保存内存进度；继续前重新握手并等待第二次用户点击。同一次暂停/继续保留 ID 与进度。账号通知复用现有 `watchReaderSession`，只作失效信号，立即卸载完整源、取消已准备的地址；不承载账号、Cookie 或权限。BFCache/整页离开卸载源，恢复后不自动播放。准备成功只在当前内存意图中暂留 30 秒，点击时再次检查该时间；这不是权限有效期，资源 HTTP 仍由旧真实权益校验决定。

本批没有接入旧 catalog 版本的 `musicAccessLifecycle` 到新网站 DTO，也没有增加新的会员到期轮询。旧播放器的到期/账号生命周期回归仍通过；新版实际会员到期、续费、会话过期与生产缓冲行为必须在 T14/T20 的真实权限回归确认，不能由本地匿名或合成会员结果推断。已下载的浏览器字节不是新的会员授权凭证。

## 刷新恢复与资料库边界

新增每标签页 `sessionStorage` 键 `stationcat.station-playback.v1`，只存 schema、歌曲 UUID、slug、网站 revision、variant、preview revision、进度和保存时间，最长保留 30 天、读取上限 1024 字符。不会存音频地址、存储键、完整握手、Cookie、账号、权益或 playback ID。

恢复先按验证过的 slug 读取当前公开 DTO，核对对象、当前公开状态与版本；请求失败或已撤下不选回退作品。版本变化归零；试听关闭不恢复旧源。完整资源仅显示暂停选择，新的握手完成前核心无完整音频源。恢复请求不能覆盖随后用户新选的歌。

损坏、未来 schema、存储拒绝或写入失败保留原始数据并退为临时内存。初始读取不写入。既有 `stationcat.music.v2` 收藏、最近播放和音量设置复用；旧 current/positions/queue 不改写为网站 revision。网页本机键和原生 `/api/mobile/v1/me/music/*` 继续是独立系统，不据此宣称账号云同步已完成。

## 验收证据及边界

[验证摘要](T09-evidence/verification-summary.json)列出命令、数量、日志与文件哈希；[设计 QA](T09-evidence/design-qa.md)记录截图对照与五个视口。新增 24 个会话案例，加上既有核心、队列、本机资料、旧统计与权益生命周期，共 147 项回归通过。T08 页面/真实 Worker 临时 D1/R2 的 26 项通过，两个开关与未知地址回退保持原样。staging 的 21 项门控测试、8 页/34 个精确依赖、关闭生产资产和品牌路由检查通过。

共享代码拆出了旧包使用的 `musicLocalData.<hash>.js` 和 `readerSessionEvents.<hash>.js`，仅扩展这两个精确家族的 GET/HEAD；相似前缀、map、写方法、新 `ClientRouter` 和 `MusicShell` 脚本仍被旧 staging 拒绝。生产配置、迁移和绑定未改。

浏览器使用本地 127.0.0.1:4208 的实际 Worker/SSR。4 秒完整音和 1 秒独立试听是仓库已有 FFmpeg 正弦波，非真实歌曲；封面为视觉示例，预览不转发身份或出站联网。浏览器记录证明单实例、跨详情/语言/后退、暂停、核权、原生结束/重播、刷新静音、匿名完整资源拒绝和键盘操作。拒绝 play、忽略 abort、损坏存储与账号通知使用可控测试双验证，不声称真实浏览器政策、真实订单、版权或生产会员验收。手机尺寸只是视口模拟，没有真机或 VoiceOver 通过记录。

构建使用 `ALLOW_EMPTY_SERIAL_CONTENT=1`，不作为生产包、部署或索引验收。T09 在独立 PR 等待用户审查；不会提前进入 T10。
