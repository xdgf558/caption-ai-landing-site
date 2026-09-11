# 音乐预发独立存储

2026-09-11 更新：下方是首次创建记录。#129 已部署专用 Access 后台，本轮又更新至 Worker 244276f2 并应用 0004/0005、配置限流 secret；五开关 false、配额仍 0。当前版本、迁移修复与备份见 [STAGING_APP](STAGING_APP.md)。

2026-09-10，用户批准先创建独立存储。基线 main@726a58602f421f41287a092b439c2d1c6062b0f7（PR #127）。仅创建存储、初始化音乐 schema 和验收；没有部署 Worker/后台、配置正配额、上传媒体或开闸。

## 资源身份

| 项目 | 实际值 |
| --- | --- |
| Cloudflare account | 3f5394e0ef5a531c63c0ceaa74262e0d |
| D1 名称 / binding | station-cat-music-staging / MUSIC_DB |
| D1 UUID | 8fe1a3e1-7325-4d87-a7e6-2c51338b9158 |
| D1 地区 | APAC；验收由 SIN primary 返回 |
| R2 名称 / binding | station-cat-music-staging-private / MUSIC_BUCKET |
| R2 创建时间 | 2026-09-10T11:35:56.539Z |
| R2 地区 / 类别 | APAC / Standard |
| R2 公开性 | r2.dev disabled；无自定义域名 |
| R2 对象数 / 占用 | 0 / 0 B（创建后查询） |
| 部署 SHA | 无，本轮没有 Worker 部署 |

创建前已核对本站 station-cat-waitlist UUID 为 c4a8cb1a-6a94-4e8f-a6fb-a734afafca63，新 UUID 与它不同。既有 station-cat-content / station-cat-downloads 桶未复用。没有读取或复制会员业务数据，没有向这些生产资源执行写操作。

[存储管理配置](../../ops/music-staging-storage.jsonc) 只有新库、新桶和四个 false 开关，没有 main、assets、routes、WAITLIST_DB、队列或支付配置。仅用于显式 --config 的存储运维，**不是可部署的预发应用配置**。生产 wrangler.toml 未改；云端 Worker 绑定尚未接入。假身份预览器和 scripts/helpers 禁止部署或连接这组云端资源。

## 迁移与核验

Wrangler 4.130.0。创建后 sqlite_schema 查询没有业务表，仅 Cloudflare 内部表。先导出备份，再对新 MUSIC_DB 执行 migrations apply；目录仅 migrations-music。三份 SQL 与 main 一致，未改写。

| 文件 | D1 applied_at（UTC） | SHA-256 |
| --- | --- | --- |
| 0001_music_foundation.sql | 2026-09-10 11:38:07 | d63ea6a4f2870d7a15c49f2c5af5c7c75a8a4fef14821cd8041995a0d4d70008 |
| 0002_music_publication.sql | 2026-09-10 11:38:08 | 8b301c3a1d13be40eb574ce7d950531ed39492dc321f95627b2cb0c9c061e3b9 |
| 0003_music_uploads.sql | 2026-09-10 11:38:08 | fb0cc9eafa2bee35cb2ba6efacfd0125837a812fdc809a174e330c950d5f83b3 |

验收 SQL 时间：2026-09-10 11:38:52 UTC。music_* 共 15 表、35 触发器、10 索引、1 视图。catalogVersion=0、previewLimitMs=45000、**storageQuotaBytes=0**。曲目、素材、上传会话、审计、mutation 回执均为 0。PRAGMA foreign_key_check 无错误；验收语句 changes/rows_written 均为 0。再次 migrations list 显示无待执行迁移。

操作均显式指定 --config ops/music-staging-storage.jsonc 和 MUSIC_DB，没有使用默认生产迁移目录。以后只追加 SQL，不编辑已应用迁移。

本地配置类型生成通过，输出仅 MUSIC_DB/MUSIC_BUCKET 与四个 false 变量，临时类型文件不入仓。music:foundation 17/17 通过，npm run build 与构建后验证通过（111 sitemap 路由），git diff --check 通过。未更改运行时代码或生产配置。

## 备份

迁移前后 SQL 与 verification.json 保存在操作者本地 music-staging-storage-records-20260910 目录，未纳入 git。没有会员数据、密钥或临时导出签名链接。迁移后 SQL 已在本地内存 SQLite 恢复：integrity_check=ok，3 条迁移、配额 0、曲目 0，外键检查通过。**不等于云端灾难恢复演练。**

| 文件 | SHA-256 |
| --- | --- |
| before-migrations.sql | 12b4d609d563571a2bbe9615dadd52fa835ee6f0e29cdf77ef6c64ca8ec3cb68 |
| after-migrations.sql | 7f40f8787eeeb71265bf243deadd7c9f6b9614ba781b6a2247788a6b8bf170f2 |
| verification.json | e63ad5e47a57b6654606daf7f867fa9947c71496379ff0870ff1db4bfc6c11a8 |

## 后续边界

下一步另行确认正式代码隔离预发部署、Access JWT/allowlist、受限凭据及测试身份来源。不可将预发回调接入生产支付或复制生产会员库。上传须另批正配额与开关，公开、VIP 交付、统计继续关闭。

0 配额是应用层上传限制，不是 Cloudflare 账户账单硬上限；预算/告警、套餐 CPU、实际听审、云端完整发布/回滚、多实例及恢复演练仍待验收。不能为消除 503 而部署假身份测试 Worker。

命令依据：[D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)、[R2 Public Buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)。实际私有性已经 CLI 查询，不仅依据桶名或默认值。
