# M3 第一批：隔离原生曲库与授权媒体

2026-09-17。本批为 M3 媒体后端和原生播放集成的第一批，不能标记整个 M3/M4 完成。生产未部署、未启用移动认证或音乐开关，没有连接现网账号、D1/R2、付款或 StoreKit。

## 实现范围

- `/api/mobile/v1/music/catalog`：复用已发布内容投影，四语、搜索、free/vip 筛选，最多 100 条一页，整体上限沿现有曲库 500 条。
- `/music/featured`、`/music/collections/{slug}`：发布集合、成员顺序与分页；推荐响应只带最多六个集合的前十首，完整成员通过集合分页读取。未发布成员不暴露。
- `/music/tracks/{id}`：歌曲资料、展示版封面 URL、普通/LRC 歌词。LRC 复用网页解析器（offset、多时间标签、Unicode）；绑定 audioVersion。歌词读取最多 128 KiB，序列化歌词最多 192 KiB。
- `/me/entitlements`：只读现有 `reader_memberships`，映射到 `music.canPlayVipFull` 与 `siteVip`。没有音乐订阅售卖/账本，没有授予小说权限或重写全站会员。
- `POST /music/tracks/{id}/playback-grants`：服务端选择 public/session_bearer；校验版本、变体、当前发布状态与访问策略。无登录可取免费完整曲和独立试听；VIP 完整曲需要原生会话和全站 VIP。
- `GET/HEAD /music/media/{grant}/audio`：逐请求验证，拒绝额外 query，不接收 URL token；VIP 必须匹配原账号和原 session。刷新同一 session 的新 access token 可继续使用未过期的 grant。网页 Cookie 不提供原生权限，错误 Bearer 不回退匿名。

所有接口仍在 M2 的 HTTPS origin/环境/密钥门控后。额外要求 `MOBILE_MUSIC_ENABLED=true` 与已有 `MUSIC_PUBLIC_ENABLED`；VIP 完整曲还要求 `MUSIC_VIP_DELIVERY_ENABLED`。**未把这些值写入任何部署配置。** 配置里的能力是显式功能开关，不是健康检查或现网启用证明。

## 权限、时间与资源边界

凭据表在隔离 WAITLIST_DB 的 `migrations-mobile/0002_music_playback_grants.sql`，音乐资料仍在独立 MUSIC_DB，音频仍走 MUSIC_BUCKET。这里只给出增量迁移，未应用到远端。原生凭据只存 SHA-256、账号/session、歌曲版本/变体和期限，既不存原始 grant 也不存 R2 key。public 的账号/session 必须为空。到期凭据由原生维护任务清理；销户盘点扩为 87 表，新增表归入 credentials_purge，清理策略仍未批准且没有执行入口。

有效期最多十分钟，同时受登录 access token、session 绝对期限、全站 VIP 到期和下一音乐策略边界限制。响应 `expiresAt == playbackValidUntil`；每次媒体请求重新读数据库，不缓存资格。授权失败、数据库错误、资源变更、版本变化均不能读出付费字节。R2 对象身份、ETag、HEAD、单 Range、416 逻辑从原网页函数抽出共用，网页权限流程保持原样。媒体返回 private/no-store、Vary: Authorization，无重定向。

目录/授权准备有五秒预算；超时后取消歌词读取并丢弃迟到结果。音频 body 仍按 R2 流传输，不在 Worker 全量缓冲。IP 限流分为普通 120、grant 30、媒体 600 次/分钟，避免音频分段消耗登录的限流桶。实际部署前还需按目标码率与访问量评估配额。

D1 与 R2 没有跨绑定原子事务；这些检查属于每个媒体请求的资格校验，不能撤回已发送字节。客户端硬截止与清理缓冲是补充边界，必须一起保留。

## 本机验证

- `node --test --test-timeout=90000 scripts/test-mobile-music.mjs scripts/test-mobile-auth.mjs scripts/test-music-media.mjs scripts/test-music-membership.mjs`：76 项通过（新增原生音乐 16 项、原生认证 29 项及原网页媒体/会员回归）。
- 销户审计 11/11；87 表分类与复合外键快照检查通过。
- `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build`：153 页和 postbuild 断言通过。这是缺少小说内容的本机编译验证，**不得用于生产部署**。
- 原生端使用 `scripts/helpers/mobile-music-service.mjs` 桥接到真实本机 workerd + 临时 D1/R2，只有随机 loopback 端口并要求一次性测试 proof，出站请求禁用。音频来自仓库中本机生成的正弦波，不含真实用户音乐或账号。
- 实际 iOS 模拟器 AVPlayer 播放进度、seek、HEAD/Range Bearer、客户端硬截止清缓冲、撤销后无 R2 读取已通过。对应驱动与日志说明在 iOS 仓库。

## 后续门槛

本机 HTTP 测试桥不代表真实 HTTPS/AASA 回调验收；本机 Xcode 27 beta 不替代固定 Xcode 26.4.1 CI 或实体 iPhone。PR 后须完成远端稳定 CI。实体机锁屏/后台/中断、正式签名、域名与 Team ID、长曲弱网续期、完整队列/系统控制、个人数据同步、完整销户执行、StoreKit 均不在本批已完成声明中。旧 M2 崩溃恢复仍使用其独立固定后端提交，本批不更改该验收基线。

## PR #174 审查修复：推荐配置

原生 featured 现在按共享投影中的主推荐、次推荐和集合 ID 顺序映射，保留配置主推荐在最新六首之外的情况；不会把普通目录前六项当作推荐。共享网页投影的 `primarySource=latest` 自动回退不会进入原生推荐页，因此清空配置得到空数组；网页原有回退行为未改。回归使用真实临时 D1/R2 的七首免费歌曲和三个专辑，断言主推荐、次推荐顺序、集合顺序以及清空后的结果。相同 fixture 供 iOS 的真实 Worker → NativeMusicAPI → AppModel 发现页数据测试使用。

## M3 第二批隔离测试支持

新增三分钟本机合成正弦波（64 kbps 单声道，约 1.44 MB），保留 FFmpeg 生成参数、包时长及 SHA-256；不含真实歌曲或用户资料。测试服务在 ready 前准备长曲与推荐数据，减少把准备耗时计入产品五秒网络预算的偶发失败。每次稳定性场景创建独立合成账号；限免和 VIP 到期采用真实系统时间，变更仅作用于临时 D1。控制入口仍只在 loopback fixture 服务，要求随机 proof，不属于 Worker 产品路由。未更改生产运行时、认证、配额或开关。iOS 将按真实 60 秒 revalidate 周期读取新 grant；故障场景可收紧客户端截止，不能延长服务端许可。

## M4 真实认证轮换探针支持

测试服务增加独立的刷新凭据种子与仅含代数/撤销/绝对期限的证据查询。种子写入临时 D1，客户端随后使用真实 NativeAuthenticationService、Keychain journal 和原 Worker refresh 路由；连续播放超过五分钟，以原三分钟音频自然循环，不伪造时钟或延长五分钟 access token 寿命。无产品运行时、生产配置或迁移变更。新接口仍受 loopback 临时 proof 保护，不记录可用令牌。
