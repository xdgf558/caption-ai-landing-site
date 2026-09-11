# M4-01 四语页面与曲库

本批在已合并 M3-04 的单音频内核上接入正式页面源码。不是生产开放；不部署、不改音乐功能开关、不加入页头/页脚入口或 sitemap。M4-02 详情抽屉/大字体专项、M4-03 歌词及本地数据、M4-04 分享与会员回跳、M4-05 统计另行交付。

## 路由与门禁

四个主路径为 `/music/`（繁中）、`/zh-hans/music/`、`/en/music/`、`/ja/music/`。各自 canonical，互相 hreflang，目前均 noindex/nofollow。`/zh-hant/music/` 与无尾斜线路径由 Worker 302 至主路径；仅保留唯一、格式合法的 track UUID 和 collection slug，去除其他参数，重复参数不采信。静态页面不含作品、账号或资格数据。

HTML GET/HEAD 必须先通过 `MUSIC_PUBLIC_ENABLED === "true"`，关闭时 503/private no-store 且零 ASSETS/D1/R2 读取。缺静态绑定或读取异常失败关闭；非法子路径（含直接 index.html）不落到静态文件。正常音乐壳也使用 private no-store，避免开闸响应在关闸后被正缓存复用。页面通过门禁不代替 API 限流或音频实时 VIP 核验。

`run_worker_first` 加入 `/music`、`/music/*` 及 `/*%*`。最后一项让带编码的路径先经过 Worker，再由音乐路由单次解码识别，避免静态资源路由解码后绕过门禁；非音乐编码路径沿用原有 Worker 处理。其代价是这些编码静态请求也会经过 Worker，不增加数据读取。Miniflare 原生 assets 路由回归覆盖编码字母/斜杠/HTML 文件。真实预发边缘规范化与 Access 白名单仍需部署阶段验收。

语言菜单有独立音乐映射，繁中直接到 `/music/`，切换时只保留合法歌曲/歌单参数。整页语言切换重新加载元数据，保持暂停、无音频 src；本批不实现跨页进度保存。不修改现有会员中心路径或登录/Cookie 通道。

## 数据与浏览

目录读取继续使用 M3-03 的同一轮 catalog/capabilities 请求与资格生命周期。客户端白名单扩展到公开摘要、genres、moods、publishedAt 及已发布歌单；封面仍自造同源版本地址，未知私有字段不进入状态。作品名与标签使用服务端实际翻译或原文，不伪造译文。

默认按发布时间倒序，ID 稳定次序。搜索对公开标题/创作者/风格/心情执行 NFKC、trim 和大小写规范化；不同筛选组 AND，风格/心情组内多选 OR。标签仅从当前公开目录生成。搜索别名尚无公开字段，因此本批不读取私有 metadata 或宣称别名检索；后续需另行扩展公开白名单。

“免费精选”明确为最新发布的免费作品，非热门、运营主推或个人推荐。现有公开合同没有推荐位字段，M5-03 的人工主推/排序仍待实现。本批用真实歌单选择器按管理员顺序展示，可筛选或整单播放；不会因在歌单中而获得 VIP 权限。

目录最多 500 首，每次增量展示 50 行。播放全部和列表播放以完整筛选结果（最多 500 首）建立队列，而非只取已经渲染的 50 行。筛选、展开标签、增量展示、浏览详情和历史后退不会改写队列或音频 src。主动查看 B 时 A 可继续播放；右侧为 B，底栏始终反映 A。查看/后退不自动播放，播放仍在用户动作内同步调用既有内核。

歌曲/歌单查询定位当前目录内的公开作品。目录之外或不可用的 ID 显示“当前目录中未找到”，不静默播放第一首，也不声称该作品全站不存在。跨 500 首目录窗口的详情/歌单直达读取留 M4-04，与正式分享一并完成；本批页面不提供分享按钮。

首次、空库、筛选无结果、读失败及重试有四语状态。界面以 textContent 呈现公开文本，封面 lazy load；列表重建中止旧封面监听，并尽量保留行焦点。历史只保存本页浏览条件，不保存账号、资格、媒体地址或 Cookie；无新增 localStorage、统计或广播字段。

## 本地验证与后续

`npm run test:music:library` 纳入 npm test，覆盖真实 Worker 门禁、原生静态路由、查询清洗、四语路由、公开白名单、500 曲、标签/搜索/排序、歌单次序、完整队列与词典占位符。`npm run build` 构建正式页面；原 `build:music:player-preview` 保留 M3 隔离预览。浏览器仍需核对真实 DOM 和音频状态，单元测试不代替真机。

本机正式页面预览：先 `npm run build`，再以 `MUSIC_LIBRARY_PREVIEW=true MUSIC_PLAYER_PREVIEW_PORT=4207 node scripts/serve-music-player-preview.mjs` 启动，访问 `/zh-hans/music/` 等路径。附加 `MUSIC_PLAYER_PREVIEW_SCENARIO=library-500`、`empty` 或 `catalog-error` 可复现边界。本机服务只接受 loopback Host 与 GET/HEAD，无远端代理、凭据或数据库；使用合成 WAV 与本地封面，不等同 MP3/Range/VIP 验收，也不执行生产 Worker 门禁。

本地执行记录、截图、状态及 session 材料仅保留忽略目录，不进入 PR。真实媒体、可信入口头、多实例、设备/系统媒体键属 M6；发布前仍需隔离预发、正式内容权利核验及用户开闸决定。回退代码不能代替先关闭公开总闸；本批无迁移或资产变更。

参考：[Cloudflare Worker 优先路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[URL 规范化](https://developers.cloudflare.com/rules/normalization/how-it-works/)。
