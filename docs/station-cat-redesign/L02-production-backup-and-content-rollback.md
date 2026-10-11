# L02 真实备份、隔离恢复与内容回退

本批完成两个生产 D1 的完整导出、三个生产 R2 桶的全部对象备份，以及这些真实数据在全新本机 D1/R2 克隆中的恢复核对。另准备独立的品牌维护 Worker：回退时仍关闭旧小说、产品与下载入口，并保留账号、历史订单、通用积分、支付回调、原生服务和 `/games/cat-life/`。代码继续采用一批一 PR 审查；本批没有生产导入、迁移、部署、开关变更或实际入口关闭。

## 已执行的备份

用户在本聊天选择“工具核对完毕后立即导出”，此前问题已说明 D1 导出会短暂阻塞数据库请求。使用已安装的 Wrangler 4.131.1，在明确维护窗口内按官方支持的 `d1 export --remote` 导出完整结构和数据，没有表数上限或 schema-only 回退。两个库均无虚拟表。导出于 2026-10-11 新加坡时间 16:53 完成；窗口已经结束，不可拿原窗口文件再次执行。

| 资源 | 实际范围 | 本机恢复核对 |
| --- | --- | --- |
| WAITLIST_DB | SQL 19,985,743 字节；51 张业务表 | 全表、18,545 行（含序列记录）、类型化内容、结构、序列、完整性与外键一致 |
| MUSIC_DB | SQL 383,482 字节；28 张业务表 | 全表、758 行（含序列记录）、类型化内容、结构、序列、完整性与外键一致 |
| CONTENT_BUCKET | 326 对象，311,151,276 字节 | 全量流式写入新的本机 R2，再逐对象读回 SHA、大小和 HTTP/custom 元数据 |
| DOWNLOADS_BUCKET | 140 对象，8,436,915,956 字节 | 同上；139 个单段 ETag 一致，1 个分段对象保留原 ETag 但不宣称原生重建该 ETag |
| MUSIC_BUCKET | 37 对象，113,910,767 字节 | 同上；37 个单段 ETag 一致 |

R2 共 503 对象、8,861,977,999 字节。无分页元数据时继续 `start_after` 至空页，不把短页认定为完整；每页按 UTF-8 字节序整理，拒绝重复、倒退和游标循环。读取原始响应流，避免 HTTP 自动解压改写存储字节；大小、SHA-256 和单段 MD5 分别核对。断流仅对明确的传输故障有限重试，资源变化和哈希错误不会被重试掩盖。每桶备份前后完整元数据一致，最终 17:49 新加坡时间只读复核版本、绑定、两个库的结构和三个桶的完整元数据仍一致。

原付款与受保护正文兼容清单按已合并基线 `41a4ff62` 原样单独保存，没有重新生成空指针。旧内容的 852 条非空 R2 引用与音乐的 37 条引用全部存在于对应备份；37 个音乐资产的字节数、SHA 与 ETag 也一致。此核对覆盖源码识别的 `*_r2_key` 和 `object_key` 字段，不证明外部链接、Access 身份合同、素材权利或应用流程已经验收。

真实 SQL、对象键、对象正文、客户数据、带签名 URL 的 Wrangler 日志及生产变量都只留在仓库外的私有目录（目录 0700、文件 0600）；只读核对本机 FileVault 为 On。Git/PR 仅提交[汇总证据](L02-evidence/backup-and-restore.json)、源码、合成测试及本机预览截图。私有工作目录标识为 `L02-20261011-v1`，维护者可在本机 `.station-cat-private-backups` 中查找；它不是异地备份。备份保留到上线及回退验收后至少 30 天，实际删除另经维护者确认，本批不提供自动清理。

## 恢复与可复核边界

完整 D1 dump 会将触发器与数据放在被引用表/视图之前。恢复工具让 SQLite 解析每一条语句，按建表、全部数据、索引/视图/触发器执行；保留源 dump 原文和 SHA。Wrangler 把含触发器的多语句文件当成一个请求，因此本机原生导入使用完整数据文件及独立 schema 文件，避免整个 dump 超出单条 D1 限制。每个克隆使用随机新 UUID，固定 `--local`，不含生产账号或数据库 ID，拒绝覆盖既有目录。

读回全部数据，不限 1000 行；区分 NULL、64 位整数、浮点、BLOB 与含 NUL 的 TEXT，核对 AUTOINCREMENT 序列高水位。原生导入会调整 DDL 排版，结构核对采用保留字面量和逻辑的 SQLite token、列与外键定义，不能表述成原生 DDL 字节完全相同。恢复的完整类型指纹、`integrity_check` 和 `foreign_key_check` 均通过。

R2 使用新的随机本机桶和新持久化目录；外发网络被拒绝。完整对象流写入后，再从原生 R2 逐对象流式读回，比对全部字节与 HTTP/custom 元数据。502 个单段 ETag 一致；分段 ETag、原上传时间、版本身份和存储类不由本机模拟器重建，源记录继续保存在私有 manifest。没有把“备份能恢复”写成生产 Access、完整灾备流程或真实会员/游戏冲突验收。

数据库导出与 R2 复制发生在不同时间，线上未被持续冻结；这是一组已核对的完整资源备份，**不是跨 D1/R2 的同一事务快照**。最终结构/列表一致也不能证明业务行冻结。后续迁移和切换前仍须重新评估备份新鲜度、在途写入与最新引用，不能直接把本次备份当成任意未来时点的生产回滚数据。

## 保持旧内容关闭的回退包

`src/stationContentRollback.js` 是独立替代入口；原 `worker.js` 与主 `wrangler.toml` 不挂载它。该入口本身固定关闭 Station 独立功能，直接维护旧内容关闭合同，不依赖新 `station_*` 表或五个页面开关来决定关闭。即使输入全部页面开关为 true，也不会开放旧正文。

| 地址范围 | 回退行为 |
| --- | --- |
| 品牌首页、新音乐/游戏介绍和新单曲地址 | 四语言维护页，503、Retry-After、noindex、private/no-store；页面不播放媒体 |
| 旧小说/作品别名、旧产品附属页、旧下载、旧内容 API、专辑及未保留的音乐后代 | 410，不跳转首页、不查询新内容 schema；此故障回退合同不区分旧命名空间内的存在/未知实体 |
| 会员页 | 保留 T14 账号壳、原服务查询与直接游戏入口，不以音乐 schema 判断登录权限 |
| `/games/cat-life/` 及运行资源，原账号/订单/支付/积分/云存档、原生 `/api/mobile`、AASA、管理员 | 交给原处理器；分类不是方法或身份授权，仍沿用原核验 |
| 小说共享 checkout | 拒绝小说、打赏和带旧系列的积分包；通用积分交回原权限与校验 |
| 新 Station API、内部模板、robots/sitemap | Station API 503，内部模板/ sitemap 404，robots 全站 Disallow |

运行目录仍执行原嵌入规则，不能改到新游戏介绍。既有队列继续由原处理器接管，定时 Signal 新采集停用；这不宣称取消在途请求。原订单、余额、历史权益和存档不删除。维护页沿用用户确认的温柔小站壳和插画；[视觉核对](L02-evidence/design-qa.md)包含桌面、手机、语言与主要按钮。

从**经审查的完整私有生产配置**派生回退配置：

```sh
node scripts/build-station-content-rollback-config.mjs \
  --baseline "$station_reviewed_config" \
  --baseline-sha256 "$station_reviewed_config_sha256" \
  --output "$station_content_rollback_config"
```

生成器保持原业务绑定/变量，设置专用回退入口、L01 精简 Assets 与 Worker-first，拒绝输入哈希不符和覆盖输出；它只准备文件，不部署。本批使用明确的合成完整基线运行 Wrangler `deploy --dry-run`，确认打包成功，**未核验完整生产基线或部署回退版本**。不能从 dry-run 推导真实资源绑定、Access 或生产恢复成功。

## 操作入口与本批验证

```sh
npm run build:station:first-launch
npm run test:station:backup
npm run test:station:content-rollback
npm run test:station:first-launch
npm test
node scripts/serve-station-first-launch-preview.mjs --content-rollback
```

专用首发构建没有使用 `ALLOW_EMPTY_SERIAL_CONTENT`；33 项新增专项、11 项 L01 关闭合同、30 项 T22 准备合同与原项目完整回归通过，结果和源码哈希见[验证记录](L02-evidence/validation.json)。CI 只运行合成的离线备份/恢复与 Worker 权限回归，绝不执行实际生产导出或导入。本 PR 精确头的完整托管 CI 仍须单独核对。

手工备份 CLI 提供 `inventory`、`export`、`objects` 和只读 `verify`；真实导出必须提供当前窗口文件及其 SHA。恢复 CLI 提供 `databases`、`verify-databases` 和 `objects`，只写新的本机克隆。真实备份路径、窗口文件、恢复文件和日志不得提交 Git，失败或部分复制不能成为完整证据。

生产 Worker 仍为 `67d6e6b0`；MUSIC_DB 仍只有 0001–0011，没有新作品模型。上线检查表仅将本次真实备份/恢复登记通过，`launchReady=false`、`productionDeployed=false`、`legacyClosureVerified=false`。完整生产配置、0012–0018、真实游戏/空音乐首页发布、素材权利、受保护 HTTP 合同与实际回退监控仍未完成。T21 歌曲 LCP 3.37–3.43 秒失败保留；真机与 VoiceOver 不由视口模拟替代。在途云写入、本机跨进程窗口、1 秒退出、同源 iframe 与失败上传配额也未被本批修复。

官方操作依据：[D1 导入/导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、[R2 对象列表](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/)。合并本 PR 不授权生产迁移、回退部署、公开切换或关闭现有线上入口。
