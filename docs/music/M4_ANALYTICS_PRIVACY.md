# M4-05 收听统计与隐私

基于 M4-04/#145 已合入的 main@c4fbd28。本包实现可选第一方事件、最小只读汇总与四语隐私说明。不开生产统计、不开音乐入口，不修改支付、积分、VIP 或上传清理；不附带设计验收、HTTP 执行记录、身份或 session 材料。

## 启用与拒绝

未配置时 `MUSIC_PUBLIC_ENABLED` 与 `MUSIC_ANALYTICS_ENABLED` 默认关闭。已有 `ops/music-staging-app.jsonc` 的公开读旗为 true、统计旗为 false；本包没有修改它们，不据配置文件推断远程部署状态。以下条件全部满足才接收事件：两个开关打开、`MUSIC_ANALYTICS_PRIVACY_VERSION=music-analytics-v1`、`MUSIC_ANALYTICS_RETENTION_ENABLED=true`、MUSIC_DB 已应用 0006、最近两小时清理成功且没有已过期统计数据、请求通过限流、浏览器提供对应版本的明确同意。缺少任一项拒绝采集；播放、登录、收藏和原会员权益不等待统计。

隐私版本是部署者完成告知和适用依据核对后的配置确认，不是法律结论，也不是播放令牌。本包不替运营者确认经营地区的适用依据。缺少配置时不采集，不使用观察模式或第三方 SDK。

- GET/HEAD `/api/music/analytics/config`：返回可用性、同意版本和保留期。开关关闭或隐私配置缺失时零 D1/R2；已配置时先走既有 catalog 原子限流，再读统计清理状态。
- POST `/api/music/events`：只收本站 Origin、`X-Requested-With: StationCatMusicAnalytics` 和 JSON；同源以外、压缩请求、重复/额外 query、错误方法拒绝。开关检查在读取 body 与数据库之前。
- GET/HEAD `/admin/api/music/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD`：现有 Access JWT 和管理员允许列表保护，只读。UTC 两端日期包含在区间内，一次最多 31 天，默认最近 7 天，最远 365 天。无数据、关闭、故障分别给 `available:false` 和原因，不能画成 0 人。

新配置均未写入生产/预发 vars；旧配置缺省关闭。当前预发白名单不包含公开统计路径。本包不扩大白名单，未验证 Access 下的无凭证统计请求，不能绕过 Access 或把服务凭证交给浏览器。

## 事件与口径

收听统计只反映同意且成功送达的客户端报告，不能证明真人、付费、授权或全站收听总量。统计绝不参与 `/audio` 的逐次资格判断，不是计费或分账凭据。

| 事件 | 触发与限制 |
| --- | --- |
| play_start | 当前资源真正进入 playing；点击、loading、选中和页面恢复不计。每次播放会话一次 |
| qualified_play | 累计真实收听达到 min(30 秒, 当前音频时长 × 50%)；完整与试听分开 |
| play_complete | 自然 ended 且累计收听达到当前音频时长的 90%；试听完成仍标 preview |
| preview_end | 当前试听自然结束；暂停后的迟到 ended 不计 |
| vip_cta_click | 明确点击曲目详情的会员入口；只代表意向 |

暂停/恢复保持 playSessionId，切源、卸源重开、错误后重试、新一轮循环更换。内核新增只供观察的 playbackGeneration，队列传递 restart，明确区分同一 URL 的“播放全部重开”与暂停恢复；不改变源地址、手势同步 play 或资格守卫。统计订阅先于队列续播，避免 ended 被下一首的同步状态覆盖。播放开始后才生成播放会话；在已播放的歌曲中途同意，不补造此前的开始或时长。

累计时长取单调时钟与媒体进度的交集。暂停、缓冲、seek、倒退、媒体时间大跳和超过 2 秒的采样空隙不累加；后台节流、慢速或变速会造成保守少计，不承诺锁屏精确统计。播放不等待上传统计。一次播放的里程碑只入队一次。

服务端仍校验当前发布的 sealed 修订、音频 variant 和数据库已知时长；qualified/complete/preview_end 必须已有同播放会话的 play_start。发布状态检查与插入同一事务。事件 ID 与同匿名会话/播放会话/事件种类双重唯一；同匿名会话、曲目、variant 的 qualified_play 在服务端接收时刻滚动 30 分钟内最多一次，不按整点窗口重置。

每日汇总用服务器 receivedAt 的 UTC 日期。accessKind 根据当时修订策略和抢先结束时间在服务端推导，区分免费完整版、VIP 策略完整版和试听；VIP 策略不是已核验 VIP 听众。0006 将旧日汇总原值保留为 unknown，不猜历史访问策略。新事件与汇总增量在同一 D1 事务；回执丢失重传不再计次，汇总失败回滚事件。

## 最小数据与有界传输

请求只允许 `{consentVersion, events}`。每个事件仅允许 eventId、eventType、playSessionId、anonymousSessionId、trackId、revisionNo、variant、occurredAt、listenedMs、entrySource。entrySource 是 catalog/collection/detail/player/membership 固定枚举，当前播放事件固定 player，会员按钮固定 detail。禁止额外 metadata、完整 URL、邮箱、Cookie、账号、金额和客户端授予/撤销事件；伪造 `vip_grant_confirmed` / `vip_grant_reversed` 返回 403。occurredAt 与服务器时差最多正负 5 分钟。

请求最多 20 条、实际 UTF-8 body 最多 16 KiB；不依赖 Content-Length 声明，流式计长和读取超时。应用错误只返回固定 code，不回传原事件、对象 key、秘密或数据库异常。

客户端仅在明确同意后写 `stationcat.music.analytics.v1` 到 sessionStorage：版本、随机匿名会话 ID、最长 24 小时失效时间；不扩展 `stationcat.music.v2`，不写 Cookie/localStorage/BroadcastChannel。不做设备指纹；支持并尊重浏览器 GPC。存储失败保持关闭。

传输队列仅内存，含在途事件合计最多 100 条，单批最多 20 条、失败最多重试两次，保留原 eventId 与冻结的重试批次。没有无限前台重发、离线持久队列或 sendBeacon。会员按钮在导航前启动一次不等待的 keepalive 请求；关页只允许已启动的请求完成，不排空剩余队列，也不启动新重试。浏览器可以丢弃请求，统计显示的是实际收到的事件。

撤回立刻停止采集、清空队列、取消在途请求并移除统计会话，收藏与播放不变。已到服务器的请求无法因取消追回，已接收记录按保留期失效。再次同意使用新随机会话。

## 原子限流

独立 `music_analytics_rates` 使用 MUSIC_DB primary 上的 D1 batch。每分钟按本次 body 的事件数量计费：匿名会话 60、来源 IP 600、全局 12000；三项同事务增加，任一超额回滚整个 admission，返回 429 + Retry-After。阈值是预发观察起点，固定分钟边界仍有突发，不是压测结论。

来源只信 CF-Connecting-IP，复用既有规范化与按类别/分钟的 HMAC（`MUSIC_RATE_LIMIT_SECRET`）；不存原始 IP，不使用 X-Forwarded-For。轮换匿名 ID 仍受来源/全局限制。缺 secret、IP、schema 或数据库故障返回 503。

Admission 与事件插入是两个事务：通过字段校验的失败曲目请求和重试也占事件预算，避免失败请求反复无成本读取发布资料；统计插入失败不退还 admission。事件计数去重和限流预算是两种口径。

## 保留期与运维边界

0006 不改写已应用的 0001–0005。日表迁移保留旧值、增加访问策略维度，新增去重/校验/汇总触发器及限流/清理健康表。没有远程迁移回执或远程切分器验收记录；本地 SQLite/workerd 成功不等于远程 Wrangler apply 已通过。

原始事件最多 30 天、无会话标识的每日汇总最多 365 天、归因引用最多 90 天、临时统计限流行最多 2 小时。当前不写归因引用，但清理涵盖该预留表。汇总长期保留不含匿名会话 ID，原始记录删除后无法重建其逐会话详情。

主 Worker 现有每小时 scheduled 分支并行调用 `runMusicAnalyticsRetention`；不新增 cron，不影响原 Signal 错误的传播。`MUSIC_ANALYTICS_RETENTION_ENABLED` 缺省 false，false 时零 DB；true 时只操作音乐统计表，不删 R2，不涉及 MUSIC_CLEANUP_ENABLED。每轮最多删除原始/日汇总/限流各 1000 行、归因 100 行，最多 20 轮；提前一小时清理，只有全部目标过期行清完才更新 last_sweep_at。失败/积压记固定警告，健康过期或仍有超期行时拒绝新采集和报表。

这些是清理目标与失败保护，不是基础设施宕机时的删除 SLA。部署者须单独验收定时调度、积压告警和数据库备份的保留策略。采集停用后要保留清理任务，直到相关记录都到期；不能同时关清理或回退到没有清理逻辑的旧 Worker 后宣称保留期仍受保证。

未来启用顺序：保持 public/analytics 关闭 → 单独授权并备份 MUSIC_DB、应用 0006 → 配置并验证每小时 retention（预发无 cron 时另行部署决策）→ 核对隐私告知/适用依据和版本、可信入口头及 secret → 隔离入口 HTTP/限流/拒绝/撤回验收 → 最后另行批准打开入口和统计。任何一步失败不跳过同意、限流或 VIP。

D1 batch 的回滚和 first-primary 使用参考 [Cloudflare D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/)；body 限制遵循 [Workers 请求处理建议](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)。

## 不可用归因与验证入口

membership_center_open 尚未采集，付费激活与续费缺少可安全核验的 grant 适配；三个指标明确 unavailable。未增加 24 小时来源线索、账号查询、checkout、兑换或退款调用。已有 VIP 登录、成功 URL、积分到账和音乐 CTA 都不被计为新付费 VIP。

`npm run test:music:analytics` 覆盖同意/撤回、播放时长、队列竞态、冻结重试、输入白名单、真实 body 限制、原子限流、去重、回滚、保留期及不可用指标。`test:music:runtime` 通过真实本地 workerd/D1 执行迁移与并发/回滚路径。CI 管理端浏览器测试核对只读不可用、分类和失败清旧数据。常规 npm test、主站 build 与独立播放器 build 继续执行。

本机公开页面预览可显式设置 `MUSIC_ANALYTICS_PREVIEW=true`，并在忽略的 `.generated/music-analytics-preview-state.json` 中设置 available 布尔值；只额外允许本站统计 POST 校验与计数，不保存事件/session 内容、不代理、不接生产。其他 POST 仍拒绝，未设置时保持原只读预览；它不代替真实 D1、MP3、云端身份、隐私依据或真机验收。M6 真机与跨区域验证仍待办。下一阶段为 M5 管理工作区，包括既定的 WAV→MP3 和整张专辑上传。
