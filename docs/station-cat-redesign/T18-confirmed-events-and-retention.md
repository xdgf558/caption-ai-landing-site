# T18 事件接收、去重与受控保留

本批把新网站的统计接到已确认的播放器、视频和游戏操作，按主开发文档统一有效试听口径。分支从 T17 的实际 squash 提交 `73fc199dcd367a3721ce0115e2bf34aead80ff90` 建立，T17 [PR #202](https://github.com/xdgf558/caption-ai-landing-site/pull/202) 的精确头 CI 与合并事实分别保存于 [证据目录](evidence/T18/)。本批仅实现 T18；T19 聚合、报表与 12 个月聚合保留尚未开始。

## 事件合同

| 事件 | 浏览器确认点 | 接收端约束 |
| --- | --- | --- |
| `track_view` | 单曲数据加载成功、页面可见并已允许统计 | 当前发布歌曲；同 session/song 按接收时间滑动 30 分钟一次 |
| `preview_start` | 原生播放器进入真实 playing，非 loading/buffering | 已发布、启用推广试听；同 playback_id 一次 |
| `full_audio_start` | 已取得旧播放授权后原生 playing | 再核对当前旧版本和原权益；不从网站音频模式授予会员 |
| `preview_qualified` | 前台实际累计至少 10 秒，或原生媒体实际 ended | 同 session/song/playback 的开始事件必须存在；同 playback_id 一次 |
| `platform_click` | 用户原生点击或鼠标中键点击有效平台链接 | 当前 live、已发行、核验过的合法链接；地区只取可信 `request.cf.country`；同 interaction_id 一次 |
| `clip_start` | 当前视频实例原生 playing | 当前发布歌曲及其已发布短片；同 playback_id 一次 |
| `clip_complete` | 原生 ended 且没有跳过主要内容 | 匹配 clip_start；同 playback_id 一次 |
| `game_launch_request` | 创建 launch_id 后发起当前 iframe 尝试 | 当前公开游戏记录；同 launch_id 一次 |
| `game_ready` | 同源、同 frame、同协议/game/launch 的 ready 消息 | 对应 launch_request 已存在；iframe load 不算 ready |
| `save_success` | 运行端写入本机槽位，并回读相同字节成功后通知 | 已 ready 的同一实例；仅 local 操作 UUID，一次；不包含存档正文 |

新的有效试听不沿用旧音乐 `qualified_play` 的 `min(30秒,时长×50%)`，也不采用旧 `play_complete` 的 90% 阈值。旧统计 API、旧字典和旧保留规则仍独立存在，T19 不得把两种有效播放混作同一指标。

实际播放累计使用单调时钟和媒体进度的连续增量，排除暂停、等待、隐藏时间、拖动跳跃及超过两秒的采样空档。拖动到末尾本身不触发结束。视频累计跳过超过一秒（包括从非零进度开始的新视频实例）时保守地拒绝完成事件，不用播放百分比代替 ended。原生系统事件仍是浏览器的声明，不能作为防作弊、媒体权利、订单、会员授权或唯一访客的证明。

`save_success` 当前覆盖本机写入确认；云 PUT/POST 发出、排队、临时快照和未确认响应都不算云保存成功。本批未修复 T12 已发云写入无法取消/回滚、localStorage 比较和 setItem 不是跨进程原子操作，以及 T13 同源 iframe/一秒退出等待的边界。

## 隐私选择与交付范围

四语言音乐、游戏和新会员壳在统计条件完整时显示页脚选择，默认不采集新事件，支持明确允许、暂不统计和撤回。GPC 优先于保存的选择；共用旧 `stationcat.music.analytics.disabled.v1` 拒绝键。允许选择仅在当前分页暂存，最长一天。存储不可访问时显式选择可以仅对当前页面生效，并标记 memory 范围。

短期随机访问 session 采用 30 分钟活动窗口，context 在渠道改变时更新，firstCampaign 单独保存；事件入队即冻结这些值，后续渠道变化或重试不修改已排队事件。Campaign 的来源和媒介由服务端登记记录派生，并复用 T16/T17 当前推广、权利和资源检查；未知、无效或失效来源降为 unknown。firstCampaign 仅接受结构合法的已登记 ID，允许保留历史首次来源。服务端检查是接收时的快照，不是 D1/R2/Access 跨系统原子保证，也不能证明用户来自该渠道。

事件只有固定 20 字段，不能附加账号、邮箱、订单、Cookie、完整播放地址、歌词、存档内容、原始 IP、User-Agent 或原查询。设备只分 mobile/desktop/unknown。请求带同源 Cookie 仅供完整播放的旧权限核对，Cookie 不写事件。防滥用计数保存每分钟更换的 HMAC 来源键，最长两小时；它与随机会话都不能当作唯一用户或不可识别化的保证。

队列仅在内存中，最多 100 项；每批最多 20 项且属于同一 session。跨 30 分钟会话的队列分批发送，避免整批被拒绝。超时或 408/429/5xx 最多重试两次，保持同一 UUID 和维度，尊重不超过 60 秒的 Retry-After。满队列、页面退出、长时间离线或无匹配开始事件时可能丢失统计；播放和跳转不等候它。播放/游戏实例跨过访问会话失效后，缺少同会话开始事件的后续完成声明会被忽略。

撤回会清空当前队列、会话和选择，并停止后续浏览器采集；AbortSignal 不能撤销已被服务器接收或已提交的 D1 事件。元数据请求时限也只放弃等待，不取消已发出的 D1 查询。本批不提供删除已接受事件的用户接口或账号销户执行器。

## 开关、迁移与保留

新增 `/api/station/events` POST 和 `/api/station/events/config` GET/HEAD。生产配置没有加入启用值。接收端必须同时满足：

- `STATION_EVENTS_ENABLED=true`
- `STATION_CONTENT_PUBLIC_ENABLED=true`
- `STATION_EVENTS_PRIVACY_VERSION=station-events-v1`
- `STATION_EVENTS_RETENTION_ENABLED=true`

任一条件不满足时，在方法、正文和绑定读取前停用；config 返回 available=false，接收返回 503。页面开关仍分别由 T08/T12/T14 控制。接收端拒绝跨源、错误方法、GPC 声明、未知维度、非 JSON、压缩正文、超过 32768 字节或 20 项的批次。限流按事件单位同时核算 session/source/global 的 120/600/12000 每分钟预算，重试也计入；同一 D1 事务超预算整体回滚。config 核对也计入 source/global。错误响应为 private, no-store 和固定代码/请求 UUID，不输出内部错误。

一次性兼容迁移 [0016](../../migrations-music/0016_station_event_collection.sql) 扩展 T06 事件表，追加去重/访问/到期索引及三个受控辅助表。它不改旧歌曲、账号、支付或游戏 schema，不在请求中执行，不可反复重放。接收前核对实际 MUSIC_DB 的 0016 账本、字段、保留健康状态和未清理到期记录；缺失或不健康时不接受采集。远程 0012–0016、目标绑定和实际数据仍未确认；启用前应检查现有事件是否与新增唯一索引冲突，不能自行删除历史行来通过迁移。

原始事件按服务器接收时间设置 90 天到期，客户端时间只供诊断，偏差超过五分钟标记异常；访问和限流窗口不用客户端时间。每小时现有 scheduled 独立执行清理，即使事件采集关闭也运行。保留清理开关仍单独控制它。每次最多十轮、每轮最多 1000 事件和 1000 计数，提前一小时清理到期窗口；删除授权守卫和事件删除在同一 D1 batch 内，提交前移除守卫。它不能删除存活事件、内容、读者账户或旧音乐统计。

关闭或失败的清理不会保证物理数据已到期删除；健康记录超过两小时或仍存在到期积压时停止新采集，需恢复 scheduled 并处理积压。90 天策略启用前必须确认定时任务、监控和运营隐私文本。本批不宣称生产已经满足保留期限。销户清单仍 approved=false、executionEnabled=false；新增三表独立分类为 redesign_analytics_review，115 表清单与既有迁移哈希核对通过，不授权账号清理。

## 本机验证与交付

[验证摘要](evidence/T18/verification-summary.json) 保存命令、原始日志 gzip、可复算哈希和源码锚点；[设计 QA](evidence/T18/design-qa.md) 保存四语言、五视口和键盘证据。T18 专项 40 项，相关播放器/平台/短片/游戏/会员/Campaign/音乐回归 355 项，销户审计 12 项通过。完整 npm test、开发主构建和 8 页/37 文件的 staging 依赖核验另行保存。本地 Node 24，托管 CI 使用 Node 22，必须单独核对精确 PR 头；本机通过不代替它。

完整 npm test 在可信国家字段收紧后、最终跨会话队列分批修订前运行。最后的分批修订由其后的 40 项事件专项、355 项相关回归、主构建和 staging 核验覆盖；不把较早的完整 npm test 或独立夹具构建写成最终源码的全套重跑。各日志保留实际修改时间，摘要明确这一区别。

IAB 实测未同意时试听正常且零事件；允许后短合成试听自然 ended，保存一个开始和一个有效试听；30 秒合成短片自然 ended 保存完成；撤回或 503 注入均不影响试听。预览重启后的第二份临时 D1 中，真实旧游戏启动和 ready 各一条，实际“你好，小伙伴”操作回读本机存档后追加 save_success。两阶段分别记录，计数不相加，不证明云同步。预览使用固定游客只读身份夹具，不转发账号凭证，拒绝云存档写入。

本地预览：`http://127.0.0.1:4218/zh-hans/music/tracks/permanent-free/`，`ALLOW_EMPTY_SERIAL_CONTENT=1 npm run preview:redesign:events` 可重建。仅监听 loopback，输出 noindex；合成音、插画短片、测试推广/权利和本机游戏操作不代表实际素材发行、版权、生产资源、云冲突、iOS/Android/内置浏览器或 VoiceOver 验收。空正文构建不是生产包。主推作品、真实平台链接、运营试听开关和视频仍“稍后确定”。

本批交由独立 PR 审查；不自动合并、开始 T19、部署、打开任何生产开关、执行远程迁移或关闭旧入口。

实现参考：[D1 Worker API 的 batch 事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Worker 最佳实践](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。这些文档不构成本项目生产验收证据。
