# T22 证据索引

[最终核心记录](final-core/verification-summary.json) 的 **21 个命令全部退出 0**，403 个被跟踪及非忽略未跟踪源码/配置锚点在运行开始/结束一致。原始日志保留在 `final-core/logs/`，每项有实际计数、退出码、时间、字节和 SHA-256：完整 `npm test` 562 项 Node 测试及额外脚本断言；T22 专项 30 项，集成验收 14；模型 26、公开查询 35、音乐页 26、游戏 52、会员 32、内容后台 37、事件 40、报表 71、退出/路由 24、原生音乐 18、原生资料库 23、原生生产合同 115。重复执行不相加为独立用例总数。销户分类 Python 12 项通过，依然未批准/启用。`core/` 保留补充内容桶、下载桶缺失校验之前的历史记录，不替代最终源码的重跑。

主 Astro **空正文构建** 176 页及 postbuild、staging 8 页/37 份精确资源检查通过，均不是生产内容包。T22 没有改动前端/Worker 产品源码或性能素材，不重跑/改写 T21 的 LCP 和真机结论。本批 CI 新增本机配置/回退步骤，精确 PR 头的完整托管 CI 仍须单独核对。

| 文件 | 证明范围 |
| --- | --- |
| [local-rehearsal.json](local-rehearsal.json) | 新建临时 D1/R2、原 Worker/Assets、0012–0018 原子 batch+账本、14 个断言、40 次原生 HTTP 观察；其中 `remoteOperations=0` 仅指这次本机演练 |
| [before-music-synthetic.sql.gz](before-music-synthetic.sql.gz)、[before-reader-synthetic.sql.gz](before-reader-synthetic.sql.gz) | 迁移前合成逻辑备份：音乐 28 表、读者代表性夹具 36 表；不是完整生产 schema |
| [after-music-synthetic.sql.gz](after-music-synthetic.sql.gz)、[after-reader-synthetic.sql.gz](after-reader-synthetic.sql.gz) | 保留新订单、余额、存档及内容回退后独立恢复；音乐 60 表，schema/SQL 原值/序列一致 |
| [synthetic-object-manifest.json](synthetic-object-manifest.json) | 对象 key、字节和 SHA-256；迁移前 24 个对象、之后新增截图共 25 个，分别恢复空桶并核 metadata；小型合成字节不作为媒体/权利/性能证明 |
| [production-readonly-inventory.json](production-readonly-inventory.json) | 独立的生产控制平面与 schema-only SELECT 事实：确切当前版本、实际绑定、0001–0011 账本/旧清理视图，无 station 表；远程写入为零 |
| [tooling/verification.json](tooling/verification.json) | 缓存 Wrangler 4.131.1；本机 dry-run、类型生成与命令 help；`--require-ready` 按未满足门槛退出 2 |
| [T21-approved-head-ci.json](T21-approved-head-ci.json)、[T21-merge-result.json](T21-merge-result.json) | T21 精确头的 43 步 CI 与已授权合并事实，不能代替 T22 CI |
| [manifest.json](manifest.json) | 最终证据文件及相关源码/配置的 SHA-256；manifest 不给自身做循环哈希 |

Wrangler types 首次因沙箱 `listen EPERM` 未完成；仅允许临时 loopback 后重跑成功，首次日志与成功日志分别保留。生成类型的 runtime 为 Wrangler 自带 workerd 1.20260911.1；应用演练使用仓库锁定 Miniflare/workerd，不能混作同一工具链。生成的完整类型以 gzip 保存，不接入生产源码。

早期工具调试失败保留在 `tooling/initial-*-tests.log`：D1 不支持 integrity_check、空自增序列差异、夹具传参/语言目标/引用保护比较和权利 edit_version；这些没有被标成产品阻断，也没有通过改生产逻辑绕过。最终 `final-core/` 源码已修正并全套重跑；首次备份 API 失败原记录见 `tooling/initial-d1-integrity-failure.log`。读者/音乐恢复均先检查目标全空，原生 D1 外键一致与独立 SQLite 完整性检查分别记录，自增序列包括删除过夹具行的高水位。

未完成生产备份/恢复、迁移、版本上传、公开切换、索引/统计启用或旧入口关闭。读者状态比较、合成订单、原生临时云 PUT、40 次 HTTP 及 403 个锚点均不能替代生产权限/真实商户/并发冲突、指定真机或 VoiceOver 验收。
