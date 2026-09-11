# 音乐隔离预发：部署与验收

2026-09-11。用户批准先做隔离预发；#134、#135 已顺序合入 `main@e077c4b`，两个合并后的 CI 均通过。本轮更新既有预发，不部署正式站、不开放音乐、不执行对象清理。

## 实际部署

此前 #129 已部署受 Access 保护的后台，旧阶段文档漏记此事。旧版本为 `f24a7a08-b42c-4dfc-a7f8-ce3db86aaa49`，并非本轮首次创建预发。

| 项目 | 核验结果 |
| --- | --- |
| 入口 | https://music-staging.wwwstationcat.org/admin/music/ |
| Worker | `station-cat-music-staging` |
| 源码提交 | `cdc481ceb02df2df0c0dbb391302b9a86e6563c1`（基于 `main@e077c4b`） |
| 版本 | `244276f2-4143-444b-abcd-1d0b7b301f94` |
| 创建时间 | 2026-09-11 04:09:52 UTC |
| 配置 | `ops/music-staging-app.jsonc`，显式指定，不使用生产配置 |
| 数据库 | `station-cat-music-staging` / `8fe1a3e1-7325-4d87-a7e6-2c51338b9158` |
| 桶 | `station-cat-music-staging-private`；r2.dev disabled，无自定义公开域，0 对象 / 0 B |
| 绑定 | MUSIC_DB、MUSIC_BUCKET、5 个后台静态文件对应的 ASSETS；没有生产库、支付、队列或定时处理器 |
| 防护 | 专用 Access 应用、Worker JWT/邮箱复核、严格主机/路由白名单、`run_worker_first:true` |
| 替代入口 | `workers_dev:false`、`preview_urls:false` |
| 功能开关 | public、uploads、VIP delivery、analytics、cleanup 全部 false |
| 配额与业务数据 | storageQuotaBytes=0；曲目、资产、上传、清理、审计均为 0 |

部署版本读取确认上述资源 ID、五个 false 开关与 `MUSIC_RATE_LIMIT_SECRET` 的 secret binding；只有 fetch handler。密钥为新生成的 32 随机字节，以 secret bulk 文件接口上传，临时文件已删除，仓库和记录不保存密钥值。

## 迁移兼容性修复

0004 于 04:06:17 UTC 应用成功。0005 初次经 Wrangler 4.130.0 的远程迁移接口失败：`incomplete input: SQLITE_ERROR`。随后只读核验：没有 0005 回执，也没有任何 `music_rate_*` 表/触发器，失败已完整回滚。

触发器中的裸 `SELECT CASE ... END;` 会被远端语句切分误认为触发器结束，与 [workers-sdk #4727](https://github.com/cloudflare/workers-sdk/issues/4727) 描述一致。把两处检查改为等价的 `SELECT RAISE(ABORT,...) WHERE changes()<>1;`，保留源与全局计数同语句提交、全局失败回滚源的语义。只修改尚未成功应用的 0005；已应用的 0001–0004 不改写。0005 随后于 04:08:34 UTC 通过正常 migrations apply 成功应用，未手填迁移回执。

本地 SQLite/workerd 测试解析完整 SQL，不能证明远程迁移入口的切分兼容性；本次实测补上了这部分证据。

## 验收证据

- `npm test` 通过；限流专项 11/11、staging gate 6/6、原生 D1/R2 runtime 25/25 通过，包含故障回滚和并发预算。
- `npm run build:music:staging-assets` 通过：146 页面、111 sitemap 路由，仅打包 5 个后台文件；dry-run、绑定类型生成通过，实际 Worker startup 6 ms。
- 已登录浏览器刷新后，后台显示“曲库已载入”“公开入口未开放”，占用/配额均 0.0 KiB。
- 无 Cookie 的后台、diagnostics、CSS、catalog 请求均 302 到专用 Cloudflare Access 主机；未绕过鉴权读取资源。
- 真实 D1 主库查询确认迁移 0001–0005、计数表/触发器、配额视图齐备，外键检查无错误，只读核验 rows_written=0。
- 真实 D1 SQL 验证来源上限 1、全局上限 2：同源第二次和全局第三次均不写入；限定测试窗口的临时故障触发器忽略全局更新时，实际报 `MUSIC_RATE_COUNTER_INVALID`，源/全局仍各计 2。测试触发器与两条临时来源计数已清除，来源与全局计数均回到 0。此项不是 HTTP 压测或跨区域多实例验收。

浏览器工具直接导航 diagnostics JSON 时返回 `net::ERR_BLOCKED_BY_CLIENT`，未独立确认该接口的已登录 HTTP 200/body；不把后台加载、schema 齐备或 secret 存在说成诊断响应已验收。匿名鉴权保护已验证。

## 备份与后续边界

迁移前后 SQL、只读核验 JSON、部署绑定、匿名响应摘要、远程计数实验与脚本保存在本地 `music-staging-validation-records-20260911/`，不提交备份、临时下载链接或凭据。

| 备份 | SHA-256 |
| --- | --- |
| before.sql | `7f40f8787eeeb71265bf243deadd7c9f6b9614ba781b6a2247788a6b8bf170f2` |
| after.sql | `49d359108af27d37f15689ff33ffb673bc4627e319d905b97237468f967266e1` |

备份在本地内存 SQLite 恢复，integrity_check=ok，外键无错；这不是云端灾难恢复演练。

当前入口只开放受 Access 保护的后台与管理 API，公开 catalog/audio 路由未加入预发白名单；限流密钥和表已就绪，不表示已开放流量。上传与清理仍关闭，未上传媒体或复制生产会员数据。公开 API 接线、受控测试配额/样本、隔离 VIP 身份、可信 IP 头、真实 HTTP 限流/多实例/拖动播放、真机和恢复演练仍待后续联调。

回退 Worker 不回退 D1 schema；旧代码仍会高估已释放的预留，且不具备本轮诊断与限流能力。当前无业务数据、未清理对象。任何后续开放均使用具备现行 VIP/限流守卫的版本，不以旧版本绕过校验。
