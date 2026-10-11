# L03：MUSIC_DB 生产迁移准备

本批从已合并 L02 的 `8b8a5b3facc5decb6f1989bcf54f0096bd5b431b` 准备 `0012–0018` 执行包，完成真实生产只读核对和真实备份的隔离迁移演练。**没有远程迁移、导出、部署、开关启用或旧入口关闭。** 用户沿用一批一 PR：审查本执行包和当前头完整 CI 后，再确认生产执行及维护窗口。

首发仍为品牌与游戏，音乐主推留空、推广试听与视频关闭。迁移本身不会发布游戏或首页；实际内容发布、完整生产部署配置、Worker-first、HTTP/Access、监控、真机与性能属于后续上线工作。

## 固定范围与生产依据

`ops/station-production-migration.json` 固定七份文件的顺序、字节数与 SHA-256，也固定真实 MUSIC_DB 的目标摘要。真实数据库 ID、名字、账号绑定、原始结构和账本只保存在仓库外私有目录。生成配置只有一个 MUSIC_DB 绑定，没有 Worker 入口、Assets、R2、变量、路由或发布指针，不替换主配置。WAITLIST_DB 及账号、支付、积分、游戏存档和原生资料库没有迁移操作。

| 文件 | 既有影响及新模型 |
| --- | --- |
| `0012_station_redesign.sql` | 新作品/修订/地址/游戏/推广等模型；替换 `music_asset_references`，旧歌曲只回填网站草稿和规范地址，首页为空草稿 |
| `0013_station_media_uploads.sql` | 上传会话与配额；替换 `music_storage_charges`，追加新媒体计费 |
| `0014_station_content_operations.sql` | 权利编辑版本、幂等操作与发布作业 |
| `0015_station_campaign_links.sql` | 注册推广链接与旧来源映射，未把旧来源记为核验通过 |
| `0016_station_event_collection.sql` | 会话、确认事件、去重与受控保留；不启用采集或清理 |
| `0017_station_reports.sql` | 聚合快照、人工平台数据、恢复凭据与健康状态 |
| `0018_station_report_window_seals.sql` | 清除封存前聚合快照/作业/相应恢复凭据，重置聚合健康；保留人工平台数据，增加封存与在途写入围栏 |

`0018` 有删除语句，不能描述成全部只追加。当前 `0011` 基线尚无新报表数据，首次顺序执行时被清理的表为空；如果发现提前创建的 Station 表、非零新迁移前缀或异常账本，本准备器拒绝继续，不能绕过核对重放文件。回填的 `site_audio_mode` 仍仅是未发布草稿提示，不授予免费或会员权限。

2026-10-11 **20:20:30 新加坡时间**的只读核对：活动版本为 `67d6e6b0-42f5-4696-8ed5-bc1096a49ebf`，单版本 100%；生产 MUSIC_DB 的账本仍为精确 `0001–0011`，没有 `station_*` 对象，12 首歌曲、49 份旧修订、35 项旧资产。结构摘要与 L02 导出一致，绑定和活动部署未变化，未观察到启用的 Station 变量。原始响应保存在本机私有目录，没有进入 Git。

这些 SELECT 不能证明导出后的数据没有变化。原备份是 L02 的真实、非跨资源原子备份；本次执行包的 `freshnessAcceptedForExecution=false`，没有自动刷新备份或沿用已经过期的导出维护窗口。异地副本仍未确认。

## 准备、校验与演练

三个操作只接受明确的私有目录；未知操作、`apply`、`--remote`、`--env` 或额外参数都被 CLI 拒绝。`inventory` 只读取部署/版本/绑定/数据库信息及固定 SELECT；没有调用 Wrangler 的 `migrations list`，因为固定版本 CLI 的 list 路径会初始化迁移账本。

```sh
node scripts/station-production-migration.mjs inventory --backup "$backup_dir" --directory "$snapshot_dir"
node scripts/station-production-migration.mjs prepare --backup "$backup_dir" --snapshot "$snapshot_dir" --directory "$packet_dir"
node scripts/station-production-migration.mjs verify --directory "$packet_dir"
node scripts/rehearse-station-production-migration.mjs --backup "$backup_dir" --packet "$packet_dir" --directory "$rehearsal_dir"
```

目录必须在仓库外且权限为 0700，文件为 0600；拒绝覆盖既有执行包、重复/额外迁移、符号链接、SQL 哈希变化、目标替换和添加其他资源。`verify` 也重新核对来源备份与只读快照；快照超过 24 小时会拒绝，本限制只是审查资料的有效期，不是生产执行时的新鲜度合同。

执行包的 `packet.json` 保存精确的提案命令参数数组，目标使用实际数据库名、`--remote`、固定私有配置及 Wrangler **4.131.1** 路径。这个命令只作为后续操作参考保存，没有执行器；`executionEnabled=false`、`executionReady=false`、`proposedCommand.executed=false`。校验执行包不会授予权限或运行该命令。

本机演练使用 L02 的真实 MUSIC_DB SQL，全新 SQLite 和全新原生 D1，网络出口封闭。原生 D1 实际使用固定 Wrangler 的 `d1 migrations apply <随机本机库名> --local --config <独立本机配置> --persist-to <新目录>`；本机配置没有 account_id、生产 UUID 或预览库。真实源备份不改写。

两种引擎均保留 27 张旧业务表的全部 746 行类型化数据、旧结构和旧序列；只有上述两个视图被按规范扩展，旧配额计费结果不变。最终 18 条账本、32 张新 Station 表、12 首网站草稿和 1 个空首页草稿，没有主推、平台链接、试听推广、游戏、视频或公开发布指针。完整性和外键检查通过；原生 D1 再次执行迁移无变化。新账本的 `applied_at` 使用引擎各自的实际执行时间，因此两个最终全库指纹不同；结构和旧数据摘要一致。

合成回归另覆盖单份失败的 DDL/账本回滚与成功前缀保留、`0018` 的聚合清理和人工数据保留、权限/目标/配置篡改、过期快照，以及游戏运行 slug `cat-life` 的拒绝。真实演练是本机证据，不证明生产迁移、HTTP、会员、R2/Access 或发布成功。

## 生产执行与中止合同

生产写入不在本批操作中。下一次执行之前，必须核对本 PR 审查通过及精确头完整托管 CI，并明确当前 MUSIC_DB 的维护窗口、可能短暂不可用的影响、备份新鲜度与恢复选择。需要刷新全量导出时，要使用新的有效导出窗口；不复用 L02 过期窗口。执行前再次读取实际部署、绑定、库身份、账本、结构和开关，记录恢复锚点与校验摘要。完整生产部署配置不来自本迁移配置。

按七份固定文件顺序执行，每份文件及其账本登记独立提交。**七份文件不是一个原子事务**；某份失败时已完成前缀仍保留。这与已安装 Wrangler 的实现/help 和 [Cloudflare 迁移说明](https://developers.cloudflare.com/workers/wrangler/commands/#d1-migrations-apply)一致。

任一文件失败、结果未知、部署/目标/结构变化、出现未知或跳号账本，都立即停止。只读确认实际账本和结构，不自动重试、不手动删账本、不从头重放 `0018`。部分完成必须重新审查剩余前缀及恢复方案；没有全库自动覆盖恢复。当前旧 Worker 继续使用旧模型，Station 开关维持关闭，待生产验收后才进入内容与部署阶段。

`ops/station-production-migration-check.sql` 为独立的只读后验收清单，必须在完整迁移之后针对 MUSIC_DB 使用：18 条精确账本、32 张 Station 表、旧计数与立即执行前基线核对、草稿和空发布边界、两个扩展视图、空封存初值、完整性/外键。计数不证明持续写入下每个旧值都不变。本批未执行该清单的生产版本。

回退不删除新表，也不覆盖持续写入的数据。后续上线如果需要内容回退，沿用 L02 已审查的独立维护入口，保持旧小说等内容关闭；不能把旧 Worker 版本回退当作重新开放旧内容的授权。歌曲页 LCP 3.37–3.43 秒、真机、Access、生产云冲突、在途写入、本机跨进程窗口、1 秒退出、同源 iframe、失败上传配额与跨系统事务边界继续保留。

`ops/station-release-readiness.json` 继续为未部署、未验证旧入口关闭，整体未达到 launchReady。本批合并只保存执行准备与本机证据。
