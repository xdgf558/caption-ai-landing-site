# T06 兼容数据模型与迁移

本任务基于 T05 已合并的 `781c8d9e04c729406f6083aac9e865b0e21ad966`。T05 审查头 `c4df9ff` 的 [CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37476783579/job/112314142325) 成功后，[PR #190](https://github.com/xdgf558/caption-ai-landing-site/pull/190) 于 2026-10-06 14:38:42 UTC 合并。T06 单独提交 PR，用户审查通过后才进入 T07。

交付是兼容 SQL、字段映射、隔离 SQLite / 原生本地 D1 演练和旧读取回归。没有远程迁移、生产发布、正式页面挂载、后台编辑器或旧入口关闭。主推、真实平台链接、试听开关和视频继续“稍后确定”。

## 现有结构与逻辑模型对应

现有 `music_track_revisions` 的封存条件要求完整音频，封存后不可修改。直接放宽它会影响旧播放器、权限、发布指纹和原生音乐 API。因此保留歌曲根 `music_tracks.id`、封存版本与资源，另存网站作品页的发布快照。没有站内音频的作品也能有网站版本，完整音频仍指回旧版本并调用旧权限校验。

新增结构全部属于独立 `MUSIC_DB`，不修改账号、支付、积分、存档的 `migrations/`，也不修改 `migrations-mobile/`。主 `wrangler.toml` 和现有隔离配置不能证明生产 MUSIC_DB 已配置或 schema 已迁移。

| 规范实体 | 复用部分 | 新结构 / 映射 | 边界 |
| --- | --- | --- | --- |
| Track | music_tracks.id、原音频版本与资源 | station_track_publications、station_track_revisions、station_track_routes | 网站公开与旧音频公开独立，不重建歌曲 ID |
| TrackTranslation | metadata_json.title[locale]、summary[locale]、originalLocale、原歌词资源格式 | 网站快照复制相同 JSON，另存 lyrics_asset_id | 不新建翻译服务；原 story 是单份文本，不能称为已有四语言故事 |
| PlatformLink | 无现成发行记录可推断 | station_platform_links | 发行时间、真实 URL、核验信息由后台登记 |
| MediaAsset | music_assets 的 audio / preview / cover / lyrics / evidence | station_media_assets 存视频、海报、游戏截图；station_asset_rights 存独立公开使用范围 | 不自动批准资源或替换完整音频审核 |
| Clip | 原歌曲 ID | station_clips、station_clip_revisions | 一个主歌曲；自身网站发布状态独立 |
| ClipPublication | 无真实发布记录可推断 | station_clip_publications | 多渠道真实发布 ID，与网站公开独立 |
| Game | 原运行目录、runtime key、存档服务 | station_games、station_game_revisions | 介绍 slug 不得为 cat-life，不占用运行目录 |
| HomeConfig | T05 配置固定 ID | station_home_configs、station_home_revisions | 初始空草稿，文件配置与正式查询未接入 DB |
| PromotionTrackConfig | 歌曲 ID、独立旧 preview 资源 | station_promotions、station_promotion_revisions | 旧精选不是推广授权，迁移不创建推广记录 |
| Campaign | 歌曲、素材稳定 ID | station_campaigns | 链接生成和参数解析留 T17 |
| AnalyticsEvent | 旧事件、报表、计数保持原样 | station_analytics_events | 独立的新事件字典，T18 实现新口径采集 |
| RouteMigration | T02 源码清单作为审核输入 | station_route_migrations | 存提案，不导入 CSV、不执行地址动作 |
| PublishAudit | music_admin_audit_logs、唯一 request_id、原管理员身份 | actor→actor_id；object_id→target_id；revision / 类型→summary_json；timestamp→created_at | T16 同事务追加审计，不建第二套账号 |

多语言 JSON 沿用现有格式。SQL 仅保证对象合法，不验证 locale、原始 JSON 重复键、文案与长度；T07/T16 必须限定四语言、拒绝歧义键并执行现有转义。歌词继续通过资源适配读取，不公开存储键。Track 的 released_at 来源是已核验平台的 external_released_at；T07/T08 生成发行排序，未知则为空，不能用网站发布时间补成已发行。

## 字段、默认、空值与唯一约束

下表的字段表省略 station_ 表名前缀，涵盖新增物理字段；精确类型、CHECK、外键、索引和触发器以 [0012 SQL](../../migrations-music/0012_station_redesign.sql) 为准。日期均为 UTC epoch 毫秒，与原音乐库一致，展示层转成 ISO 时间；资源时长为毫秒，前端展示时换算为秒。

### 五类发布根与快照的共同字段

Track、Clip、Game、Home、Promotion 的根键为 id 或 track_id，快照键为同一对象键与 revision 联合主键。

| 字段 | 来源 / 默认 | NULL 含义和约束 |
| --- | --- | --- |
| id / track_id | 新对象生成稳定 UUID；歌曲复用原 ID；必填 TEXT | 不改写、替换或物理删除；无 SQL 自动生成账号 |
| status | 新 TEXT，draft | draft / scheduled / published / archived |
| draft_revision | 新 INTEGER，NULL | 没有编辑草稿；只能指向同对象 draft 快照 |
| published_revision | 新 INTEGER，NULL | 没有选择发布快照；只能指向同对象 sealed，归档可保留历史指针 |
| edit_version | 新 INTEGER，1 | 正整数，T16 用旧值 CAS 并递增 |
| scheduled_at | 新 INTEGER，NULL | 无排程；scheduled 必填，定时任务尚未启用 |
| published_at | 新 INTEGER，NULL | 无网站发布；published 必须有时间和快照，服务端仍要检查未来时间 |
| created_at / updated_at | 新 INTEGER，必填；回填复制旧根时间 | 非负，updated_at 不小于 created_at |
| revision | 新 INTEGER，必填 | 正整数，同对象不可重复 |
| state | 新 TEXT，draft | draft / sealed；sealed 禁止更新、删除、OR REPLACE |
| created_at（快照） | 新 INTEGER，必填 | 非负，封存后不变 |
| metadata_json（歌曲 / Clip / Game） | 复用格式的新快照 TEXT，{} | JSON 对象，空对象表示未填写 |

首页空草稿采用 0 作为确定的迁移创建时间，不是发行时间。发布快照与随后编辑的草稿可以并存。T07 必须按 published_revision 读取，不能读 draft 或要求已发布版本等于最新 edit_version。封存与切指针须同事务完成；快照约束不代表资源、权限、审核或缓存已经实现。

### 歌曲、地址、平台

| 表 / 字段 | 来源 / 默认 | 空值含义与约束 |
| --- | --- | --- |
| track_publications.origin | 新，manual | manual / legacy_backfill；重放只处理严格符合初始状态的回填对象 |
| track_revisions.legacy_revision_id | 原 music_track_revisions.id，NULL | 无旧音频版本；同歌曲联合外键，不改写旧版本 |
| track_revisions.site_audio_mode | 新，none | none / preview / free_full / existing_entitlement；后两项要求旧版本引用，实际权限重新调用旧策略 |
| track_revisions.duration_ms | 原 audio.duration_ms 或 NULL | 正数；未知时不虚构 |
| track_revisions.cover_asset_id / lyrics_asset_id | 原资源 ID 或 NULL | 无封面 / 歌词；同歌曲、正确 kind，禁止已认领清理的资源 |
| track_routes.slug / track_id | 原 slug、原歌曲 ID，必填 | slug PK，长度 1–100，每歌仅一个 canonical，alias 永久保留原主人 |
| track_routes.role / origin / created_at | 必填 / managed / 必填 | canonical 或 alias；managed 使用规范小写连字符，legacy_backfill 原样保留旧 schema 接受的 slug |
| platform_links.id / track_id / provider | 新稳定 ID、原歌曲 ID、必填 provider | netease / qishui / apple_music / youtube / spotify；扩展 provider 需后续明确迁移 |
| platform_links.territories_json | 新，["*"] | 非空规范集合，* 为全球，或排序去重的大写两字符代码；不混合全球与地区 |
| platform_links.status | 新，planned | planned / live / unavailable / removed |
| platform_links.url / verified_at | 新，NULL / NULL | 未登记 / 未核验；live 必须同时有 HTTPS URL 和核验时间 |
| platform_links.external_released_at | 新，NULL | 未确认外部发行时间，不从网站时间推断 |
| platform_links.sort_order / version | 新，0 / 1 | 非负排序 / 正整数修改版本 |
| platform_links.created_at / updated_at | 新，必填 | 非负，更新时间不小于创建时间 |

平台唯一键为 `(track_id, provider, territories_json)`；不同序列表示同一集合时会被拒绝。不同集合可能重叠，SQL 不处理真实地区可用性或逐国重叠优先级，留 T10/T16。HTTPS 是格式约束，实际域名、规范化、外链核验、SSRF 防护仍需服务端。

歌曲更名同事务把当前 canonical 变为 alias，再插入新 canonical。已公开的旧根 slug 不改写。旧后台也不能占用另一歌曲的新地址。非规范旧 slug 原样保留在草稿；T08/T20 先完成正规详情、语言别名、查询分享和音乐后代映射，再执行跳转。

### Clip、游戏、素材、推广与首页

| 表 / 字段 | 来源 / 默认 | 空值含义与约束 |
| --- | --- | --- |
| clips.track_id / type | 原歌曲 ID / 必填 | short_video 或 mv；主人、类型稳定 |
| clip_revisions.media_asset_id / poster_asset_id | 新，NULL / NULL | 未配置文件 / 海报；同 Clip 且 kind 正确 |
| clip_revisions.duration_ms / subtitles_json | 新，NULL / {} | 未知时长 / 无字幕；实际格式留 T16 |
| clip_publications.id / clip_id / channel / post_id / post_url | 新，必填 | (channel, post_id) 唯一；HTTPS 发布记录，不代表网站公开 |
| clip_publications.external_published_at / created_at | 新，必填 | UTC 毫秒，不用网站时间填充 |
| games.slug / runtime_key | 新，必填 / NULL | 唯一且稳定的 slug，不得为 cat-life；未绑定草稿可补已核实 runtime key，绑定后不改指向，不承诺存档或兼容性 |
| game_revisions.launch_url | 新，NULL | 未配置运行地址；本地 /games/.../ 格式，实际可信范围留 T12 |
| game_revisions.supported_devices_json / screenshot_ids_json | 新，[] / [] | 不声明未经验证的设备；截图 ID 必须归此 Game |
| media_assets.id / owner_clip_id / owner_game_id | 新稳定 ID / NULL / NULL | 主人恰好一个非空；游戏截图归 Game，视频和海报归 Clip |
| media_assets.kind / object_key / content_type | 新，必填 | short_video / mv / poster / game_screenshot；键唯一，主人、键、kind 不可改写 |
| media_assets.state | 新，reserved | reserved / uploading / uploaded / validated / rejected / revoked |
| media_assets.byte_size / duration_ms / width / height / sha256 / etag | 新，NULL | 尚未测量；uploaded / validated 要大小及校验值，validated 视频要时长、图像要尺寸 |
| media_assets.created_at | 新，必填 | validated 字节属性不可改写，只能撤销；revoked 不重新激活 |
| asset_rights.id / music_asset_id / media_asset_id / scope | 新，ID 与 scope 必填；两种资产引用默认 NULL | 两种引用恰好一项，scope 与 kind 相同；每资源每 scope 唯一 |
| asset_rights.status / basis / reviewer_id / reviewed_at / created_at | pending / NULL / NULL / NULL / 必填 | approved / blocked 需要依据、审核人、审核时间；不替代旧完整音频审核 |
| promotion_revisions.enabled / preview_enabled | 新，0 / 0 | 未推广 / 未开启试听；不从旧精选推断 |
| promotion_revisions.preview_asset_id | 原独立 preview，NULL | 开启须填写，同歌且 preview，不能指向完整音频 |
| promotion_revisions.selected_platform_ids_json / selected_clip_ids_json | 新，[] / [] | 去重且同歌；公开、核验、就绪与权利条件留 T07/T16 |
| promotion_revisions.sort_order | 新，0 | 非负 |
| home_revisions.featured_track_id / featured_game_id | 新，NULL / NULL | 不自动选作品；引用推广根 / 游戏介绍根 |
| home_revisions.selected_track_ids_json / selected_clip_ids_json | 新，[] / [] | 存在、去重，最多 3 歌 / 4 视频 |
| home_revisions.selected_update_ids_json | 新，[] | 最多 3；尚未接入真实公开动态来源，保留空值，不新建文章系统 |

scope 包含 cover / preview / lyrics / short_video / mv / poster / game_screenshot。存在性约束允许草稿组合，公开资格由 T07/T16 验证整张引用图。validated 字样不是 R2 存在、结构或许可证明。旧 preview 继续要求独立文件与原派生来源规则，不能用前端暂停完整音频模拟试听。

新视频、海报、游戏截图只有模型，没有上传入口或 R2 文件。T16 上传时必须沿用管理员鉴权、CSRF、保留期，并把新素材纳入容量计费；现有 music_storage_charges 只覆盖旧音乐上传，本次不声称视频上传和额度已经可用。

### 归因、事件、路由提案

| 表 / 字段 | 来源 / 默认 | 空值、唯一与边界 |
| --- | --- | --- |
| campaigns.id / source / medium / track_id / landing_path | 新，必填；歌曲 ID 复用 | ID 唯一，本地路径格式；完整规范化、归因维度和落地对象校验留 T17 |
| campaigns.clip_id | 新，NULL | 无视频；有值须同歌曲 |
| campaigns.status / created_at / updated_at | draft / 必填 / 必填 | draft / active / archived，更新时间不小于创建时间 |
| analytics_events.event_id / event_name | 新，必填 | event_id PK，禁止更新、替换、删除；仅主规范 10 种事件，不接受 qualified_play |
| analytics_events.occurred_at / received_at | 新，必填 | 客户端声称 / 服务端接收时间；可信接收时间由 T18 服务器生成 |
| analytics_events.track_id / clip_id / game_id / campaign_id / platform_link_id | 新，NULL；引用稳定 ID | 对应事件要对应对象；Clip、PlatformLink 与 track_id 联合外键，不能借另一歌曲素材 |
| analytics_events.session_id | 新，必填 | 长度 1–128，统计会话，不能用于账号鉴权 |
| analytics_events.playback_id / interaction_id / launch_id / save_operation_id | 新，NULL | 对应播放、点击、启动、存档事件要相应会话或操作 ID |
| route_migrations.old_path / action / reason / created_at | 新，必填 | old_path PK，keep / redirect / retire / service |
| route_migrations.new_path / approved_at | 新，NULL / NULL | 无目标 / 未批准；redirect 要不同目标，service / retire 不带新目标 |

新事件表没有自由 JSON、IP、referrer、媒体 URL 或凭证字段。存入事件不证明 playing、前台有效 10 秒、视频结束、game_ready 或存档成功。T18 才实现同 playback_id 一次、30 分钟浏览去重、拒绝统计策略、限流和异常时间处理。历史事件保留原口径，不能合并成新有效试听总量。

## 迁移与幂等

`0012` 只能接在独立音乐库 `0001–0011` 后完整原子执行。新增 18 张表，保留所有旧物理表与数据。仅扩展 `music_asset_references` 的判断，保持 id、revision_ref、evidence_ref、rights_ref、derived_ref、audit_ref 六个输出字段。`DROP VIEW / CREATE VIEW` 同事务替换查询定义，不删除业务行。

回填先登记旧 ID 与原样 slug；同歌曲已有任何地址登记时不覆盖。随后仅为没有网站根的歌曲创建 draft，再严格匹配初始 origin、edit_version、空指针和不存在 revision 1 的条件，复制旧发布或草稿版本的 metadata、资源及可用时长。只有 sealed 且有 audio 时映射完整模式：free→free_full，其余→existing_entitlement；限免仍保留 VIP 基础策略与 free_until。最后填初始草稿指针和 T05 同 ID 空首页草稿。不生成平台、推广、权利、视频、游戏、Campaign 或路由批准。

幂等是业务重放不覆盖现有和新增资料，不意味着任意同名生产 schema 都正确。应用前仍须核对账本、源表、已有 station 表与约束；部分手工 schema 或归属冲突需要明确处理，不能靠 IF NOT EXISTS 掩盖。

旧清理视图将新网站 cover / lyrics、推广 preview 计入 revision_ref，将新音乐资源权利范围计入 rights_ref。旧计划与执行返回 ASSET_REFERENCED，在 R2 调用前停止；已经被旧清理器认领的资源不能获得新引用。认领和引用因此在同一库事务内互斥，保留快照也保留文件。

旧后台仍可创建、保存、发布旧音频及使用原幂等收据，但不同步网站快照。迁移后由旧后台新增的歌在再次业务回填时可获得网站草稿。正式编辑、发布、撤销和双向协作留 T16，重放脚本不是运行时同步任务。

## 隔离证据与复跑

- `npm run test:redesign:model`：26 项模型和兼容检查，含原生本地 D1 回滚。
- `npm run rehearse:redesign:migration`：输出 SQLite 与原生本地 D1 同源报告。
- 完整输出、旧领域回归和构建命令见 [验证摘要](T06-evidence/verification-summary.json)。

工具固定使用内存 SQLite 和临时 Miniflare MUSIC_DB、账号哨兵库、故障库；loopback 随机端口，禁止出站网络。没有任意数据库名、凭证、远程开关或参数，不加载生产 Worker 或真实账户。SQLite 解析完整语句，D1 以每个迁移文件单个 prepared batch 执行。

[演练报告](T06-evidence/migration-rehearsal.json) 含 SQL SHA-256、8 首旧合成记录、5 首旧公开记录、四语言结果及新增资料哈希。比较现有目录 / 详情加载、投影、数据库就绪与清理引用，旧音乐行逐行不变。重放迁移不变；新增网站发布版本、编辑草稿、平台、推广、游戏、首页版本、Campaign、事件、路由提案后再重放，所有新行保持。

原生 D1 还将迁移误投到余额哨兵库，并在末尾追加外键失败，确认旧行不变、整批新增 DDL 与回填不存在，旧视图恢复。这只是合成绑定隔离和事务证据，不能当成生产 schema、真实订单、会员、R2 或 HTTP 权限验收。

## 上线前置与回退

合并不应用远程迁移。T07 之前不得假定生产 D1 已有新 schema。正式迁移另行核对实际独立 MUSIC_DB、账本、0001–0011、旧资料和备份，再在真实 schema 副本演练。迁移账本与业务幂等不同，本地 D1 batch 不代表已验证 Wrangler 远程迁移管理。

应用回退恢复前版 Worker / 页面，保留全部 0012 表、快照和迁移后新行。旧程序继续读取原字段，扩展清理视图继续保护新引用。不要 DROP TABLE、批量清空、删除账号或用迁移前备份覆盖现库。未提交批次由事务回滚；已提交并有新写入时，采用追加兼容修复迁移，不整库历史覆盖。

新增的无站内音频作品不进入旧播放器；回退暂时隐藏新版功能并保留资料。发布冲突、审核和恢复操作在 T16 再完整验收 A18。本批为 A14/A15/A18 提供模型证据，整体业务验收仍未通过。生产会员订单、缓存撤销、旧音乐后代地址、原生资料库、游戏损坏存档恢复和四语言关于内容继续留后续任务。

## CI 清单修订（2026-10-06）

用户已审查头 `8ac1d499` 的模型和业务边界；该头的托管 [CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37486032731) 随后在账号删除 schema 审计处失败。11 项中 2 项因为新增的 18 张表未登记到既有只读分类清单而拒绝通过；既有账号删除行为检查、26 项模型检查、原生音乐及账号恢复步骤均通过。尚未运行的后续构建和浏览器步骤不能称为通过。

本次修订只补 [销户审查草案](../mobile-ios-m2/deletion-plan/README.md) 的新表分类、生成清单和回归。16 张发布者内容表继续保留，权利登记归管理员审核；新事件字典单独标为待审查，不套用旧统计 TTL。reader 数据库及其分类、旧 music 表及其分类、迁移 SQL 和运行时保持不变。政策 `approved` / `executionEnabled` 仍为 false，没有新增清理执行入口。

完整修订输出与差异核对见 [清单修订证据](T06-evidence/schema-audit-repair.json)。PR #191 保持未合并，修订头须重新获得审查及托管 CI 通过后才进入 T07。原审查的回填音频模式边界、实际 schema 前置核对和一次性迁移账本要求继续有效。
