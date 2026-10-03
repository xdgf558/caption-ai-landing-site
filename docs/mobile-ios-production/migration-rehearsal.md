# 原生迁移本地预演

`scripts/preview-mobile-production-migrations.py` 只在新建的内存 SQLite 中重建仓库 schema。它按顺序执行 37 份 `migrations/*.sql`，写入两个明确标记为合成数据的网页账号、网页会话、积分账户及流水，再执行 4 份 `migrations-mobile/*.sql` 和空的 `migrations-mobile-candidate/0001_binding_identity.sql`。所有 SQL 的文件名和精确 SHA-256 固定在脚本中；缺失、额外文件、符号链接或内容变化均失败关闭，修改来源后须重新审查代码中的摘要，不能通过命令行跳过。

2026-10-03 的本地结果为通过：原有 50 张表及其 schema、数据、自增计数保持一致，两个合成余额仍为 137 和 0；候选新增 15 张表、5 个显式索引，报告列出 11 项外键依赖。每一步检查 `foreign_keys`、`foreign_key_check` 与 `integrity_check`，新增原生表和 marker 表均保持零行。主键及 UNIQUE 自动索引由表定义涵盖，不计入 5 个显式索引。使用的本机 SQLite 为 3.54.0，42 份 SQL 的报告清单摘要为 `92a60c022d583a3eb860050ee093aeee953e300ee8d117d138f0d044a6603b69`。

运行下面的命令会把完整 JSON 报告输出到终端；报告包含每份 SQL 的相对路径、字节数、SHA-256、工具自身摘要、既有表数据指纹、新增表/索引及外键依赖。外键保留 PRAGMA 原始 `id` / `seq`，对应 `constraintId` / `columnSequence`；按 `table + constraintId` 分组、按 `columnSequence` 排序，可完整恢复复合外键各列的配对。需要文件时可以追加 `--output /本机目录/新的报告.json`，只允许新建 JSON 文件，已有路径不会覆盖。

```sh
python3 -B scripts/preview-mobile-production-migrations.py
python3 -B scripts/test-mobile-production-migrations.py
```

12 项本地测试全部通过，覆盖完整预演、缺失/额外/改动/损坏来源、既有余额或 schema 改写、关闭外键、外部数据库 ATTACH/VACUUM、非空 marker、外键违规、缺少索引、意外表、复合外键配对以及报告不得覆盖或在失败后伪装成功。部分测试仅在测试进程中替换输入摘要，以确认即使审查选择了新 SQL，额外的运行边界仍会拒绝不安全改动；产品脚本没有这种开关。复合外键测试也仅修改临时副本，在内存库中验证两列的约束编号及顺序不会丢失。

工具不接受生产 URL、数据库路径或云凭据，不使用网络、Cloudflare CLI 或任何用户数据库，也不生成执行迁移、部署、回滚、销户或填充 marker 的命令。它只证明上述固定来源在空内存库和合成数据中的结果，未读取真实快照、线上迁移状态、正式音乐库或任何真实账号数据。后续仍须另行审查真实快照的预发一致性、D1 行为、资源归属和发布步骤；本报告不构成生产迁移许可。
