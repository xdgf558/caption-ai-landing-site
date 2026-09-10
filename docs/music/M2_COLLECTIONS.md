# M2-03: 歌单管理合同

日期：2026-09-10。基线：`main@837f09a`。分支：`codex/music-playlist-admin`。

状态：本地实现与测试完成，未部署。本文只关闭 M2-03 的歌单管理数据面；公开目录与歌单读取仍属 M2-01，后台可视化排序仍属 M5-03。

## 管理接口

所有路径继续经过音乐专用 Access JWT actor、管理员 allowlist、同源 `Origin`、`X-Requested-With: StationCatMusicAdmin`、64 KiB JSON 上限、`Idempotency-Key` 和私有 `no-store` 响应。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET/HEAD | `/admin/api/music/collections` | 50 条分页列表，可按状态和标题/slug 搜索 |
| POST | `/admin/api/music/collections` | 创建私有草稿，服务端 UUID，版本从 1 开始 |
| GET/HEAD | `/admin/api/music/collections/{id}` | 读取四语资料、状态、版本和精确曲目顺序 |
| PATCH | `/admin/api/music/collections/{id}` | 全量保存资料并执行发布、下架或归档状态转换 |
| PUT | `/admin/api/music/collections/{id}/tracks` | 原子替换最多 500 首曲目的顺序 |

既有表 `music_collections` 和 `music_collection_tracks` 已能表达本合同，因此没有新增迁移。歌单 slug 创建后保持不变；归档为终态；已发布歌单必须先下架为草稿才能归档。输入只接受四种站点语言，标题原文必填，曲目 ID 必须唯一且不能指向已归档歌曲。

## 发布与权限边界

歌单只保存曲目引用和顺序，不复制或改变 `access_mode`、`policy_version`、发布修订或 VIP 资格。歌单可以同时包含免费、VIP 和尚未发布的内部曲目；公开投影只保留当时仍发布的曲目，每首歌继续执行自己的访问策略。

空歌单不能发布。发布事务会在写入时重新确认至少一首曲目仍为 `published`，避免校验后并发下架留下空公开歌单。已发布歌单因曲目后续全部下架而过滤为空时，公共投影隐藏整张歌单，不生成虚假的 0 首入口。

创建、资料/状态更新和排序都复用 `music_mutations`、`music_admin_audit_logs` 与 `music_publication_guards`。条件事务比较完整歌单行、旧顺序、曲目生命周期及需要时的 `catalogVersion`；每一步用 `changes()` 转成 NOT NULL guard，零命中整批回滚。响应丢失只能用原 actor、route、key 和请求内容读取原回执。

只有会改变公共投影的操作递增 `catalogVersion`：发布、下架、已发布资料更新、已发布排序更新。私有草稿编辑、草稿排序和草稿归档不递增。

## 本地验证

- `npm run test:music:collections`：9/9。覆盖创建/读取/分页、输入拒绝、幂等重放、If-Match、同源、状态转换、空歌单、非法曲目、权限不变、精确排序、逐步零写入回滚、并发保存和发布时曲目并发下架。
- `npm run test:music:admin`：23/23。`capabilities.collections=true`，既有 Access、上传、发布与身份边界保持通过。
- `npm run test:music:foundation`：17/17。公共投影过滤顺序与 VIP 策略不变，过滤后为空的歌单被隐藏。
- `npm run test:music:runtime`：19/19。真实本地 Miniflare D1 验证 JSON 顺序 guard、发布、重排和 `catalogVersion`。

- `npm test`：通过，新增歌单套件已进入 `pretest`。
- `npm run build`：通过，146 页、111 条 sitemap 路由。

没有云端 D1/R2、生产多实例、公开歌单 HTTP、后台歌单 UI、播放器、Safari 或正式内容验收。

## 回滚

本批没有迁移和对象写入。代码回滚会使歌单管理路径恢复不可用，但不得删除已有歌单、关联行、审计或幂等回执。合并不等于部署；即使部署，公开音乐开关与前台接口仍未完成，不能据此开放音乐栏目。
