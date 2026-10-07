# T07 公开查询与资源权限

本任务从 T06 实际合并提交 `1c81fc7c9fd0e1399314f15408ae38ed58ddbd65` 开始，增加作品查询和受控媒体响应。当前生产配置没有设置 `STATION_CONTENT_PUBLIC_ENABLED`，默认关闭；没有远程迁移、正式页面挂载、账号清理、部署或旧入口关闭。主推歌曲、真实平台链接、试听开关和视频仍按用户答复“稍后确定”保留待定。

T06 修订头 `31e19a67f7c9cb7f5f79d7771b87748b697ca2ab` 已经用户复审通过，[该头 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37491024228/job/112363480480) 成功后合并。本任务的托管 CI 必须核对 T07 PR 的当前头，不能沿用 T06 或本地通过记录。继续执行一任务一 PR，T08 未开始。

## 查询合同

新增 namespace 为 `/api/station/content`，独立于原 `/api/music/tracks/:UUID` 与 `/api/mobile`。所有接口仅接受 GET/HEAD，错误返回 `{code,message,request_id}` 及对应 `X-Request-ID`；HEAD 不返回正文。默认语言繁中，支持四个规范语言值；单个参数只能出现一次，未知参数、伪造权限参数、非法 slug/UUID、无效游标及超长输入返回 400。URL 不接受认证 token 或外部资源目标。

| 相对于 namespace 的路径 | 参数与结果 |
| --- | --- |
| `/tracks` | `locale,limit,cursor,q`；歌曲列表，q 按标题与艺名查找 |
| `/tracks/:slug` | `locale`；当前网站发布详情和最多 6 个有效相关作品 |
| `/clips`、`/tracks/:slug/clips` | `locale,limit,cursor`；已发布且父歌曲网站发布有效的视频 |
| `/games`、`/games/:slug` | 列表 `locale,limit,cursor`，详情 `locale`；游戏摘要及已注册运行路径 |
| `/home` | `locale`；读取固定首页 ID 的已发布快照，送入 T05 白名单投影 |
| `/assets/:UUID` | 不接受查询参数；当前公开封面、歌词、海报、视频、游戏截图的受控字节响应 |
| `/tracks/:slug/playback` | `variant=preview\|full,locale`；校验通过后返回受控 audioPath、时长及版本 |
| `/tracks/:slug/audio` | `variant,v`；preview 另需 `p`，分别对应网站作品与推广发布版本 |

列表默认 20、最多 50 条，按网站 `published_at DESC, id ASC` 排序，以时间和 ID 作为游标，SQL 最多取 `limit+1` 条。每次只扫描一个有限源页；资源或元数据失效的行被过滤，因此可能返回空 items 和非空 nextCursor。游标按已扫描行推进，消费者必须继续读取直到 nextCursor 为空，不能把空页当作全部结束。默认排序是网站发布顺序；最新外部发行排序在 T08 实现。T07 不接收任意排序字段或 SQL 标识符。

公开 DTO 逐字段建立，不透传数据库行或 metadata。歌曲只输出身份、规范地址、标题/艺名、摘要、已发布时间、适用已核验平台、就绪封面及可用试听承诺；详情另有纯文本介绍、就绪歌词和相关作品。不输出完整音频路径、存储键、哈希、ETag、内部版本引用、权利说明、账号/会话或凭证。平台发行时间来自当前适用 live 记录，不从网站发布时间推断。缺失封面允许目录纯文本展示，首页沿用 T05 的有效封面要求。

草稿、定时/未来时间、归档和没有封存发布指针的对象不出现在任何公开关联。正在编辑的 draft_revision/edit_version 不覆盖已封存快照。元数据拒绝重复或转义重复键、原型键、过深/过长内容及歧义 ID；未知额外字段不被转发。有效 alias 可查询，但响应只使用当前 canonical slug。旧音乐后代、语言别名、非规范遗留 slug 和分享地址的完整实体映射仍留 T08/T20，这里不执行 HTTP 路由迁移。

## 绑定和 schema 就绪

启用后先检查实际 env 的 MUSIC_DB/MUSIC_BUCKET：DB 必须支持 primary session，且不能与 WAITLIST_DB 是同一绑定；Bucket 必须支持 GET 与 HEAD。随后先运行旧音乐就绪检查，再读取 18 张 station_* 表的显式必需列、默认 `d1_migrations` 中 `0012_station_redesign.sql` 的记录，以及 `music_asset_references` 的扩展引用结构。缺失列、账本或扩展视图均返回 503，不自动安装 schema。

这证明每次请求的绑定能读取本接口所需结构，不能代替人工核对生产数据库 ID、完整 schema/触发器及迁移版本。此批没有远程查询生产绑定或迁移；仅文件存在、本地演练通过、Wrangler 配置名称或账本中的名称都不能独立证明生产已经升级。测试账本只在临时数据库中显式建立，不是运行时安装行为；未来若运营改变默认迁移账本名称，需要先调整就绪合同。

原 T06 的 `0012_station_redesign.sql` 不修改，其 SHA-256 为 `6e5a31d58a33d3e8c5520becf1aa5f4f7e4adac4c2d5e31ceb10a2e3e7ed3498`。

## 试听和完整音频

游客试听必须同时满足当前网站发布、当前封存且启用的推广版本、独立试听开关、同属歌曲的 validated preview 及 approved 权利登记。资源需要有审核人、时间及依据；不得已经进入旧清理流程，音乐与新媒体两张表出现相同资源 ID 时视为歧义。preview 必须来源于同属歌曲的 validated 完整音频，且 ID/键分开、剪辑区间在完整时长内、时长与区间相符并严格短于完整歌曲。没有另设固定试听时长上限。

试听只 HEAD/GET 独立剪辑，不读取完整文件，不查询游客账号。未开启或无效引用为 404 PREVIEW_UNAVAILABLE，已经宣称就绪但 R2 缺失/改变/故障为 503 CONTENT_MEDIA_UNAVAILABLE。公开目录缺失或改变的对象不输出试听承诺，服务故障则返回可重试的 503。停止推广、关闭试听或切换发布版本会在下一次请求失效；旧 v/p 返回 409，没有复用旧授权快照或肯定缓存。

完整音频的 `site_audio_mode=free_full/existing_entitlement` **仅是未发布回填提示，或发布者引用意图**。它不授予免费或会员资格。请求还必须开启旧 MUSIC_PUBLIC_ENABLED；加载旧歌曲当前封存发布版本，要求与网站 legacy_revision_id 一致，再调用现有 `resolveMusicAccess()`。免费窗口、early_access、普通账号、有限期 reader_membership、会员过期、会话撤销和账号限制仍按旧合同判断；VIP 另要求旧 MUSIC_VIP_DELIVERY_ENABLED。

不登录 401 AUTH_REQUIRED，普通账号 403 VIP_REQUIRED，会员过期 403 MEMBERSHIP_EXPIRED，受限账号 403 ACCOUNT_RESTRICTED，会员读取故障/超时 503 MEMBERSHIP_UNAVAILABLE，版本改变 409。每次 audio GET、HEAD、Range 都重新做完整校验，拒绝时不读取完整文件 R2，包括 HEAD。历史小说/积分/装扮购买没有新增授权入口。旧歌曲下架或网站引用旧版本时，不把回填提示升级为权益。

playback/audio 的成功及错误均 `private, no-store; Vary: Cookie`。仅授权后的私有 playback JSON 含受控 audioPath，没有直连 R2 URL或签名。通用 `/assets/:UUID` 拒绝 audio、preview 和非当前发布引用，会员身份也不能绕过这条边界。受控路径不是访问凭证，后续请求仍须鉴权。

## 公开素材、平台和首页

公开图片、歌词及视频须属于当前对象及字段，并满足 validated 状态、明确类型/大小/尺寸、当前 approved 权利登记，R2 HEAD 的键、ETag、大小、Content-Type 必须一致。视频的封面和视频都有效、时长与记录相符后才出现在列表；父歌曲失效、资源或权利撤销后，视频列表和通用素材地址均失效。游戏仅已注册 `runtime_key=cat-life` 且精确 `/games/cat-life/` 才输出运行入口，介绍页继续 `/{locale}/games/cat-life-game/`；任意存储路径不自动注册新游戏或存档能力。

媒体 GET 使用条件 ETag 及 Range，流式返回 body；HEAD 无正文。对象在 HEAD/GET 间改变、读取失败或超时均拒绝。整个请求的元数据 I/O 有 10 秒上限，迟到的 R2 body 会取消。无效 Range 沿用旧解析合同，越界为 416；If-Range 不匹配返回完整响应。If-None-Match 不绕过新校验，不返回可能保留旧权限的 304。公开 JSON/素材 `no-store`，私有音频 `private, no-store`；复用旧 catalog/artwork/audio 限流，429 带 Retry-After，限流器失败为 503。

R2 就绪校验是当前 validated/审核记录与对象身份匹配，不在每次请求重新解码视频、MP3 或计算全文件 SHA-256。测试使用合成 100 字节对象证明 HTTP/存储身份和权限流程，不能作为合法媒体、实际版权或生产资源验证。真实上传与解码仍是 T15，发布前校验/审核后台是 T16。

平台仅输出 live、已核验且时间不在未来的记录，HTTPS provider 精确主机白名单，排除凭证、token、跳转目标及片段。区域只信任 Worker request.cf.country；没有地区信息时只输出全局入口，客户端查询或 CF-IPCountry/X-Country 不能选择地区。尚未上线或地址不可用不被包装成发行。网易云旧片段分享地址需要 T10 规范化后再存储；此次不保留任意片段或擅自生成运营链接。

首页读取当前发布快照与服务端验证后的关联，再调用 T05 投影，保持空态、主推推广门控、视频双重选择及安全地址。数据库查询和 R2 校验已在服务端接入该 API，但 StationBrandLayout/Home 仍没有挂载生产页面，没有缓存失效系统或新生活文章系统。首页动态仍为空。新事件表没有接收器/清理/匿名会话保证，旧 qualified_play 和 90% 完成规则未改；新统计口径在 T18 按主文档独立实施。销户仍关闭，路由迁移表仍是提案。

## 本地验证

完整输出与 SHA-256 保存在 [验证摘要](T07-evidence/verification-summary.json)，可从 PR 独立复算。新增 29 项 Node/SQLite HTTP、失效与故障测试以及 6 项 Miniflare 实际生产 Worker 分发/D1/R2 检查，共 35 项通过。Worker 通过实际 src/worker.js 打包，测试前缀只在本地 helper，正式入口不导入该 helper。回环 Miniflare 禁止外部请求，沙箱 EPERM 后重试成功。

旧领域回归 185 项通过：本机组首次 107 项通过，唯一回环静态资产项被 EPERM 拦截，单独重试 1 项通过；旧 Workers/原生音乐/T06 模型 77 项通过。销户清单审计 12 项通过，分类、关闭开关及既有迁移保持不变。CI 增加 `npm run test:redesign:public` 并放在长链之前，托管全链尚需核对 PR 当前头。

`ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` 通过，153 页、111 sitemap 地址、构建基础检查通过；这是空正文构建，不是生产包、远程部署或完整内容验收。T07 没有视口、真机、VoiceOver、实际会员/订单、远程 R2 或 AASA 新实体覆盖证据；这些仍按后续任务验收。前端设计继续采用用户“温柔小站”图与五项导航，前端任务继续使用 UI 技能。
