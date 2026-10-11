# L04：正式生产 MUSIC_DB 迁移

**生产 MUSIC_DB 的 `0012–0018` 已全部执行并逐份确认。** 最后提交核对时间为 2026-10-11 21:50:29，新加坡时间。生产后验收于 21:54:40 通过：精确 18 条账本、32 张 Station 新表，旧歌曲/修订/资产计数 12/49/35，12 首未发布网站草稿和 1 个空首页草稿。没有公开发布指针、主推、平台、游戏、视频、权利、事件或报表记录。

本批基线为 `b2ba1205855f65e609d1efb9b1de21fee0db0cc6`，沿用已审查并合并的 [L03 PR #210](https://github.com/xdgf558/caption-ai-landing-site/pull/210)。执行前独立确认审查头 `098481848ff1fe164e464819205649ebf80f72ad` 的[完整托管 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/38140010738) 成功。七份 SQL 的顺序、字节数、SHA-256 和 MUSIC_DB 目标摘要与 L03 固定清单一致，没有修改迁移 SQL。

## 授权、即时复核与新备份

用户本次明确选择立即执行，并授权从确认起 30 分钟的维护窗口。记录窗口为 **21:44:17–22:14:17**，接受音乐库请求可能短暂受阻的影响；本批操作于 **21:59:20** 完成。这个窗口只用于 MUSIC_DB 新完整备份、七份迁移和验收，没有复用 L02 窗口。

执行前即时读取实际部署、绑定、库身份、账本、结构和开关。部署仍为单版本 `67d6e6b0-42f5-4696-8ed5-bc1096a49ebf`，单版本 100%；MUSIC_DB 仍为精确 `0001–0011`，没有 Station 对象，结构与 L02 备份一致，未观察到开启的 Station 开关。每份执行前后也检查部署、目标、账本前缀与预期结构。

**21:44:35** 完成 MUSIC_DB 的新完整 SQL 导出，383,771 字节，SHA-256 为 `b6af24eb47ecd7f3a3f2b3a7452278358b1538580dde464054ff0796134e3070`。新备份在本机 SQLite 恢复、完整性/外键核对和七份迁移验证通过，27 张旧业务表的 748 行类型化数据保持一致。L02 备份为 746 行；这次没有把旧备份或结构相同当成数据冻结。

新 SQL、原始结构/响应、恢复锚点和 CLI 日志均保存在仓库外 0700/0600 私有目录，原 L02 备份未改写。本次没有刷新 WAITLIST_DB 或 R2；备份不是跨 D1/R2 的原子快照，异地副本仍未确认。执行前捕获了 MUSIC_DB 恢复锚点，没有执行生产恢复。上述恢复与旧值保留是新 SQL 的本机证据，持续生产写入期间没有宣称生产每个旧值完全不变。

## 逐份执行

固定 Wrangler **4.131.1**，使用 `d1 migrations apply <实际音乐库名> --remote --config <单库私有配置>`。每次配置只有 MUSIC_DB，目录只有本次的一份已核对 SQL；每份完成后读取实际账本和结构，确认预期前缀后才进入下一份。未知结果、非零退出、账本/结构不符、目标/部署变化或窗口到期都会停止后续写入，不自动重试、不删账本、不整体覆盖恢复。

| 迁移 | 生产核对时间（新加坡） | 账本条数 |
| --- | --- | --- |
| `0012_station_redesign.sql` | 21:45:15 | 12 |
| `0013_station_media_uploads.sql` | 21:45:56 | 13 |
| `0014_station_content_operations.sql` | 21:46:32 | 14 |
| `0015_station_campaign_links.sql` | 21:47:09 | 15 |
| `0016_station_event_collection.sql` | 21:47:47 | 16 |
| `0017_station_reports.sql` | 21:48:24 | 17 |
| `0018_station_report_window_seals.sql` | 21:50:29 | 18 |

七份各自提交，不是一个整体事务。`0018` 执行前另外只读确认：聚合快照、作业、聚合恢复凭据、事件、保留围栏和已激活聚合健康状态均为零。没有因为 `0018` 最终为空便推断清理前为空。

`ops/station-production-migration.json` 和 L03 私有执行包仍保存关闭态准备提案；它们的历史标记没有改成生产事实。本次实际授权与执行事实记录在 [production-migration.json](L04-evidence/production-migration.json)。

## 生产后验收与兼容性修正

实际 D1 查询确认 18 条精确账本、32 张新表；旧对象结构保留，只有 `music_asset_references` 与 `music_storage_charges` 两个视图按规范扩展。旧计数仍为 12/49/35，12 首网站作品为草稿，首页为空草稿。推广、平台、游戏、视频、权利、新媒体、事件、报表、在途事件和保留围栏均为空，封存初值为 0/0。

最初的完整验收请求返回 400。拆成单条查询后定位到 `PRAGMA integrity_check` 被该生产 D1 SQL API 拒绝；这不是迁移重试。将只读清单改为 Cloudflare [官方支持的 `PRAGMA quick_check`](https://developers.cloudflare.com/d1/sql-api/sql-statements/#pragma-quick_check)，再逐条执行完整的 28 条清单：`quick_check=ok`，外键检查无违规。**生产 quick_check 不等同完整 SQLite integrity_check。** 本机新备份恢复的完整检查保留为独立证据，未替代生产查询。新增回归通过原生 D1 实际执行完整后验收清单，避免只在普通 SQLite 上验证。

匿名 HTTP 冒烟于 21:51:41 通过：旧 `/api/music/catalog?locale=zh-Hant` GET 为 200，返回 11 首公开曲目；现有 `/games/cat-life/` 和首页 HEAD 为 200。HEAD 没有启动游戏，匿名目录没有核对账号、会员或订单权限，这些结果不是新版路由、云冲突、真机或 VoiceOver 验收。

## 发布边界与审查材料

本批没有 Worker 部署、R2/WAITLIST_DB 写入、Station 开关变更或内容发布。旧小说等入口尚未执行关闭。首发继续采用品牌与游戏、音乐主推留空、试听/视频关闭的方案，真实内容发布、资源权利、完整生产配置、Worker-first、HTTP/Access、回退、监控、性能与真机验收留在后续批次。

`ops/station-release-readiness.json` 的生产结构门已依据本次真实结果标为通过；其他门继续按各自证据保留，整体 `launchReady=false`、`productionDeployed=false`、`legacyClosureVerified=false`。生产备份门没有把仅刷新音乐库标成全站资源全部重新备份；当前头完整托管 CI 需独立核对。

歌曲页 LCP 3.37–3.43 秒、在途云写入、本机跨进程窗口、1 秒游戏退出、同源 iframe、失败上传配额和跨系统事务边界继续保留，本批未修复这些问题。

审查材料：[实际迁移与生产查询](L04-evidence/production-migration.json)、[新音乐库备份与本机验证](L04-evidence/fresh-music-backup.json)、[旧服务 HTTP 冒烟](L04-evidence/legacy-http-smoke.json)、[本机验证](L04-evidence/validation.json)。后续工作继续一批一 PR，本批不自动合并或进入部署。
