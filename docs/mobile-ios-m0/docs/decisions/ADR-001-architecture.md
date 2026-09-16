# ADR-001 · 原生客户端与既有系统的边界

状态：M0 本地决策，2026-09-15；配套主规格/启动指令均为 v1.0.1。不是 M1 产品实现或发布批准。

## 产品与工程

SwiftUI 原生 iPhone，最低 iOS 18，简中/繁中/英文/日文。首版只有发现、曲库、我的及播放器；不展示积分、Creem 或苹果购买。音乐包月安排 App v1.1，仅授予 music.full_playback，候选美元价格只作为规划，真实 UI 使用 StoreKit displayPrice。全站 VIP 保留原音乐权益，小说仍使用旧规则。

本机仅安装 Xcode 27 beta 6（27A5252f）。本轮使用 iOS 27 模拟器验证，deployment target 为 iOS 18；这不证明 iOS 18 兼容，也不是正式发布工具链核验。M1 必须选定适合 CI 的稳定 Xcode 并锁版本，严格并发检查；本轮 Swift 5 模式最小探针不得直接搬成产品播放器。

建议正式仓库名 station-cat-music-ios，Bundle ID 候选 org.stationcat.music（未注册、未确认可用）。当前目录 station-cat-music-ios-m0 为独立本地实验；没有远端仓库。临时模拟器标识 org.stationcat.m0.probe 不得用于商店。

## 单一数据来源

reader_accounts 的整数主键继续作为身份，外部 DTO 转字符串。注册/登录/重置复用现有校验，不新建用户数据库。专用认证页应复用服务函数，不嵌入带付款入口的会员中心，不拷贝 Cookie。原生认证返回 principal={accountId,sessionId,clientType}；网站 Cookie 解析仍保持旧契约。

音乐目录、发布状态、effectiveAccess、audioVersion、独立试听、封面展示版及分享原图复用 src/music。新增版本化 adapter，不通过 Worker HTTP 调自己的旧接口，也不伪造 Cookie。播放器不访问 R2 管理接口或对象键。

音乐访问决策分别检查账号、来源、内容与开关。只接入全站 VIP 时先做新旧判定影子比较。music-only 模型不能写 reader_memberships 或影响小说、积分；Apple 来源后续单独入账和聚合。

## 原生组件

一个 PlaybackService 维护 AVPlayer、用户意图、队列、歌词、授权序号和截止；页面只观察。AuthService actor 统一刷新、存储和登出失效。MusicRepository 与 LibraryRepository 管网络和账号隔离。SwiftData 只保存非敏感元数据/同步队列；两个 Keychain envelope 分别处理认证和删除恢复。

播放按 AVAssetResourceLoaderDelegate 自定义 scheme + URLSession 带认证分段加载。公开资源也接受服务器提供的策略截止。HTTPS 精确主机白名单、不转发 3xx 认证、不使用未文档化 AVURLAssetHTTPHeaderFieldsKey。本轮 HTTP 仅为硬编码 127.0.0.1 的合成音频探针；正式版本必须移除这个例外。

ASWebAuthenticationSession 使用 HTTPS callback，候选 /auth/mobile/callback；认证入口 /auth/mobile/authorize。当前只证明 SDK 构造可编译运行，未部署 AASA、未运行真实浏览器授权码/PKCE 交换。App 的音乐深链与认证回调各自验证。

## 数据库边界

账号、全站会员、积分在 WAITLIST_DB；音乐元数据在 MUSIC_DB，音频在私有 R2。不能声称跨这两个 D1 与队列有一个事务。

建议 native_sessions、refresh operations、deletion jobs/outbox 及媒体 grant 身份绑定放在账号数据库，使会话推进/删除受理有同库原子边界。跨 MUSIC_DB 的内容状态仍由每次媒体授权读取。删除受理事务通过账号不可访问状态使全部旧 grant 失效，而非要求跨库批量删除 grant 才能生效。接口必须逐次检查账号和会话；后续清理可异步。M2/M3 需在实际隔离 D1 验证，包括复制一致性和故障路径。

## 兼容与待决项

保留现有网页 membershipStatus 含义、音频 v/variant 参数和错误约定。封面展示版 size=display 与海报原图不得混淆。游客网页 localStorage 不自动转成账号数据，迁移需明确同意；历史默认不合并。

M1 冻结关闭历史也递增 historyEpoch；清空同样递增。服务端同时核验 enabled + epoch，避免重新开启后旧设备补传关闭期间历史。此为对主文档第 10 节的具体化，需进入契约测试。

[Apple 资源加载委托](https://developer.apple.com/documentation/avfoundation/avassetresourceloaderdelegate)和 [HTTPS callback](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/callback/https(host:path:)) 为接口依据；本地 SDK 编译与运行证据在 evidence。它们不构成对本项目后台、锁屏或签名的保证。
