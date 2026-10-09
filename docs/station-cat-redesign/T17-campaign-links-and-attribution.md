# T17 Campaign、推广链接与归因上下文

T17 从 T16 实际合并提交 `4ddec4f6de058ef5bb5b2633600788762bbceca4` 开始。T16 PR #201 的精确审查头 `982e2e8db59f14874718524a073cdf714a881898` 经完整 CI `37875077351`（38 步成功）后，于新加坡时间 2026-10-09 11:11:43 squash 合并；[GitHub 合并事实](evidence/T17/T16-merge-result.json) 与 [精确头 CI](evidence/T17/T16-approved-head-ci.json) 独立保存。本轮只实现 T17，单独开 PR，等待用户审查。

## 登记与发布边界

既有 `/admin/music/content/` 的“推广歌曲”模块新增 Campaign 面板。创建要求该歌曲当前网站资料已公开、专门推广配置已公开且启用，封面及关联资源当前就绪并有批准的使用权利。可选素材必须是该推广版本选中的同歌曲公开视频；无视频时关联歌曲资料。沿用 T16 的资源身份、R2 HEAD、权利和发布图核对，旧完整音频权益不因登记而变化。

同一视频投放不同渠道分别登记不同 Campaign。编号、source、medium、歌曲、素材、落地语言/路径和 content 登记后固定；修改渠道或素材另建记录。编辑角色可登记草稿，可发布管理员可启用、停用和重新核对后启用。草稿不提供可复制地址或二维码；停用保留记录与旧 src 映射。当前推广或资源失效时，新查询不提供有效链接，既有 URL 解析为 unknown。推广失效时仍能手动停用历史 Campaign。

Campaign 操作使用独立说明与原控制器的身份隔离、原命令幂等恢复。登记输入不标记网站草稿为修改，也不阻止推广表单保存。重复编号及已占用旧 src 返回明确错误。列表按 20 条游标分页，每个 Campaign 最多 5 个明确旧 src；操作记录复用原审计表。

## 单一地址与二维码

`campaignLinks.js` 是复制、QR 和旧分享规范化的唯一地址生成器。固定站点源为 `https://wwwstationcat.org`，目标只能是该歌曲的四语言规范单曲页。请求 Host 和调用方不能提交任意 URL、redirect、landingPath 或 content。生成四个参数：`utm_source`、`utm_medium`、`utm_campaign`（登记编号）和 `utm_content`（素材 UUID 或 `track`）。页面 canonical、语言切换、歌词和内部链接去掉归因参数；不会向平台网址附加这些参数。

二维码使用项目已经锁定的 qrcode-generator 1.4.4，M 纠错、4 module 白色静区；预览和 SVG 下载编码同一完整地址，无短链或中转地址。本机实际复制、下载所得 SVG，以及 sharp + jsQR 独立解码的相等结果见 [下载核对](evidence/T17/downloaded-qr-check.json)。扫描和发行渠道的真实设备验收未进行。

UTM 必须同时提供四个单值，并精确匹配一个当前有效登记行及当前歌曲。旧 `src` 只使用 `station_campaign_legacy_sources` 的明确映射，不凭渠道名猜测。混用 src/UTM、重复参数、未知 UTM 键、非法 token、查询串超过 2,048 字符或 40 项均归 unknown。没有归因参数与 referrer 时为 direct_or_unknown；外部 referrer 只说明未知入口，不产生推断渠道。规范化未知输入仅保留固定 `utm_campaign=unknown`，不保留恶意原文、认证 token 或任意目标地址。

## 会话与归因上下文

`attributionSession.js` 区分访问 sessionId 与 context.id。同一访问会话保存首次合法 Campaign 编号；新的合法 Campaign 改变随后生成的上下文，已经取得的快照是独立拷贝。清洁内部导航或歌词浏览继续当前上下文；unknown 入口替换当前上下文，不覆盖首次合法编号。解析服务、schema 或资源异常也降为 unknown，避免重新沿用上一个合法渠道，音乐内容读取继续独立进行。

默认 30 分钟无活动后开始新会话，工厂参数接受 5–120 分钟；本批没有后台阈值编辑器。使用 sessionStorage 的短期随机 UUID；存储读写被拒绝时只保留当前页面内存并标明 memory 范围。会话刷新恢复、超时、未来时钟、损坏状态、顺序进入两个 Campaign 和快照不变由工厂专项核对。尊重 GPC 及原音乐统计拒绝键，拒绝后不分配 ID 并尝试清除本批状态。

sessionStorage 不是唯一访客或跨标签页身份合同，新/复制标签页的行为不能用于推断真实人数。此模块只发出页面内 `station:attribution-context`，没有事件 POST、原始查询/referrer/URL、账号或跨设备标识；没有重写既有事件。T18 才接入受控事件接收、隐私许可、event_id 去重、事件时刻快照、播放确认和主文档的有效试听口径。T19 才消费聚合指标。本批的深拷贝测试不证明“已入库事件不会变化”，因为新事件尚未采集。

## 迁移、权限和关闭态

新增一次性 MUSIC_DB 迁移 `0015_station_campaign_links.sql`：为既有 Campaign 增加 content_value 与 edit_version，新增明确旧 src 映射及索引/保留触发器。既有记录 content_value 为空，保持未核验，不猜测素材或自动启用。不可变维度不能直接 UPDATE；旧映射不能替换、更新或删除。迁移不创建推广、主推、事件、会员授权或路由关闭记录，既有迁移文件未改。

新管理 API 仍先经原 Access、允许名单、同源写入与 CSRF。写入同时要求 `STATION_CONTENT_ADMIN_ENABLED=true` 与 `STATION_CAMPAIGNS_ENABLED=true`，缺一时在读取绑定前拒绝。原 T16 的只读关联列表在 Campaign 关闭态保留；新 API 检查实际表列及 0015 账本，缺失返回 503，绝不在请求中安装 schema。

公开归因需要显式 Campaign 开关；默认关闭不查询 Campaign。音乐目录、详情及可映射分享仍要求原页面/查询两个开关同时开启，缺一继续返回 null 给旧处理器。Campaign 关闭时保留原 T08 参数规范化行为，不创建本批会话上下文。所有部署配置和默认生产开关字节保持原样，没有远程执行 0012–0015，没有生产部署或旧入口关闭。

创建/启用以新鲜依赖图和路由作为 guard，与目标行、别名、原 receipt 和审计在同一个 D1 batch 提交；停用用 If-Match/CAS，竞争者只有一个成功。实际原生 D1 夹具核对了重放及竞争。[D1 batch 文档](https://developers.cloudflare.com/d1/worker-api/d1-database/) 描述同批失败回滚。R2 和 Access 不在 D1 事务内，HEAD/身份检查与提交之间仍有跨系统窗口，数据库不会自动回滚外部资源变化。解析和资源分发继续逐请求校验，已渲染链接或上下文不会被主动远程撤回。

销户只读清单为 112 表：读者 64、旧音乐 27、网站 21。新增别名表归 publisher_content_keep，`approved` 和 `executionEnabled` 保持 false；不扩展读者销户删除作品、别名或事件的权限。新事件表的保留周期与受控清理仍属 T18/上线前政策工作。

## 本机验证与交付

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| T17 专项 | 35 项通过 | SQLite、会话工厂、独立 QR 解码、实际 Worker/Access 与临时原生 D1/R2 |
| 音乐目录/详情回归 | 26 项通过 | 双开关回退、分享映射、真实合成资源及旧完整音频核权 |
| T16 后台回归 | 37 项通过 | 版本、发布、定时、原回执与身份恢复 |
| staging 契约 | 21 项通过 | 精确模块白名单和静态依赖闭包 |
| 销户审计 | 12 项通过 | 112 表归类与未启用状态 |
| 完整 npm test / 主开发构建 / staging 资源 | 通过 | 167 页；8 页、37 份依赖，构建使用空正文选项 |

原始压缩日志、退出结果、源码锚点、截图与下载文件哈希在 [验证摘要](evidence/T17/verification-summary.json)。本机构建 `ALLOW_EMPTY_SERIAL_CONTENT=1` 不是生产正文包。新 T17 验证已加入托管 CI 的 Build 后步骤，但本 PR 精确头的远程结论要单独核对，本机通过不替代它。

本地预览：`ALLOW_EMPTY_SERIAL_CONTENT=1 npm run preview:redesign:campaigns`，地址 `http://127.0.0.1:4217/admin/music/content/`。它只接受精确 loopback Host 和限定路径，写入要求同源 Origin/原 CSRF；临时 Access JWT 仅注入服务端，不发给浏览器，出站限测试证书。所有绑定/开关仅用于本机临时 Miniflare，重启重置。二维码中生产域名是合同提案，不证明该链接已在生产可用。

IAB 走通空 Campaign 时保存推广草稿、登记同素材第三个渠道、实际复制和下载、重复编号拒绝、折叠后操作说明、停止推广后停用、恢复后重新核对启用；落地页 DOM 确认登记归因、清洁 canonical/内部链接。320/390/768/1024/1440 视口均未横向溢出，与 T16 源图同宽比较，见 [设计 QA](evidence/T17/design-qa.md)。这些证据是桌面视口和合成账号/素材，视频对象是 100 字节夹具，不能证明真实版权、素材播放、iOS/Android、平台内置浏览器、VoiceOver 或生产资源。

主推、真实平台地址、试听启用、视频及素材授权仍待用户。T15 失败上传占配额、没有删除入口；游戏已发云写入、Cookie/localStorage 并发窗口、退出等待与同源 iframe 边界继续保留。本批不自动合并，不开始 T18，不迁移、部署、开生产开关或关闭旧入口。
