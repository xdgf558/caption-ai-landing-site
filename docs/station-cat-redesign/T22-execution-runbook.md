# T22 生产执行说明与回退检查表

这是审阅材料，以下远程命令**本批均未执行**。生产备份、迁移、上传、切换、开关和旧入口关闭必须有对应执行授权。只读事实见 [T22 清单](T22-evidence/production-readonly-inventory.json)；它不是永久绑定合同。运行前确认本 PR 精确头完整 CI、所有 [发布门槛](../../ops/station-release-readiness.json)、实际配置/资源和维护窗口。

## 版本和受保护验证

使用缓存/经批准的 **Wrangler 4.131.1**，先核对 `--version` 和各子命令 `--help`；不要自动安装 latest、升级兼容日期或更换生产身份。仓库没有安装 Wrangler，本机 dry-run 与 types 使用既有缓存可执行文件，日志重定向至本机临时目录，遥测关闭。示例用一个 Bash 数组表示已核对工具路径：

```sh
station_wr=(node /Users/shaola/.npm/_npx/d77349f55c2be1c0/node_modules/wrangler/bin/wrangler.js)
```

在其他机器上用经批准的同版本路径替换。提前明确 `station_reviewed_config`、`station_closed_config`、`station_active_config`、`station_backup_dir`、`station_music_database`、`station_reader_database`、`station_new_version` 和 `station_rollback_version`；这些值必须来自本次审核/实际执行结果，不从 Git HEAD 猜 Cloudflare version ID，不把占位文字当成可执行值。

受保护环境先复核账号/Access、独立库桶和禁止对生产写入的边界。使用一首**真实且权利确认**的歌曲，核验推广开关、平台按钮、10 秒实际前台试听/自然结束、无自动播放；用测试账号验证存档恢复/导出及身份切换。不以《晚一点告白》、回退候选《原来已经这么远》或合成素材替运营配置。完整生产构建禁止 `ALLOW_EMPTY_SERIAL_CONTENT=1`；缺正文、平台链接或权利时停止，不复制开发空包。

从当前真实部署与经审核源配置合成**完整私有基线 JSON**，包括旧音乐和原生/账号/支付变量、全部绑定、Access、队列、cron 与资产路径；生产密钥通过既有密钥通道保留，不写进仓库/PR/日志。审核并锁定文件哈希，相关构建/模块路径必须明确。生成关闭态候选：

```sh
node scripts/build-station-release-candidate.mjs \
  --baseline "$station_reviewed_config" \
  --baseline-sha256 "$station_reviewed_config_sha256" \
  --output "$station_closed_config"
"${station_wr[@]}" deploy --dry-run --config "$station_closed_config" --outdir "$station_private_bundle_dir"
"${station_wr[@]}" types "$station_private_types_path" --config "$station_closed_config"
```

生成器只关闭 Station 的 15 个开关并补 Worker-first；它保留输入中旧音乐/会员/原生/支付状态。不能用旧 `build:music:production-candidate` 的默认关闭变量盲目替换现有已开的音乐服务。dry-run 和 types 成功只证明编译/配置形状，本机关闭态 ID 是明确的假 ID，不能复制到生产。

## 备份和兼容迁移

生产导出前记录两库/桶实际身份、迁移文件 SHA-256、内容发布指针/revision/edit_version、原始路由/软关联、订单/余额/授权/存档版本验证摘要，以及当前部署/回退版本与代码、完整配置和资产 manifest。私人数据保存在私有加密备份位置，校验哈希、访问权限和保留期限；PR 只放脱敏结果。D1 导出可能短暂阻塞请求，先批准维护窗口；参见 [D1 导出说明](https://developers.cloudflare.com/d1/best-practices/import-export-data/)。

```sh
"${station_wr[@]}" d1 export "$station_music_database" --remote --config "$station_reviewed_config" --output "$station_backup_dir/music-before.sql"
"${station_wr[@]}" d1 export "$station_reader_database" --remote --config "$station_reviewed_config" --output "$station_backup_dir/readers-before.sql"
```

只导出 MUSIC_DB 不覆盖读者订单/余额/权益/云存档。另备份 CONTENT_BUCKET、MUSIC_BUCKET 与仍保留的旧内容引用：导出全部引用关系与对象清单，按对象 key、大小、SHA-256、ETag/HTTP/custom metadata 逐一保存；包含待发布和封存 revision 引用，不能只保存当前首页封面。确认分页完整，冻结管理员内容/资源编辑或在导出后重新比对引用和对象身份；记录跨库/桶各自时间与差异，不能宣称共同事务快照。R2 没有本批实现的一键全桶备份，必须先审阅完整分页/对象恢复工具和实际证据，缺它时备份门槛不通过。

将实际 D1 导出恢复到独立隔离库，将 R2 对象恢复到独立私有桶，再运行逐表/序列/引用/对象哈希、旧读取与权限回归。确认旧支付记录、积分账本、小说/游戏授权和存档相容。T22 的本机逻辑导出仅是有边界的合成夹具工具，不能替代真实大库/虚拟表的恢复验证；也不能指定它连接生产。

迁移只面向已核对 MUSIC_DB 的 `migrations-music`；读者库不应用 Station 作品迁移。观察时实际 pending 是 0012–0018，执行时重新以账本为准：

```sh
"${station_wr[@]}" d1 migrations list MUSIC_DB --remote --config "$station_reviewed_config"
"${station_wr[@]}" d1 migrations apply MUSIC_DB --remote --config "$station_reviewed_config"
```

此命令会写库，须另行授权。各迁移按正式账本一次执行；有失败时保留已成功的版本和失败证据，核对失败版本是否完整回滚，再按现状修复，不重放整个目录。0012 草稿回填不授权发布或完整收听；0018 会废弃旧的不可信聚合快照/任务，可在保留期限内从原始回执重建，过期数据不能补造；它保留外部平台数据及业务订单/存档。不能为“纯追加迁移”隐去这项受控失效行为。

应用后 SELECT 核对 0012–0018 账本、实际表/列/触发器、清理/配额视图和保留规则，复跑实际账号、历史权益、支付回调、受控资源与存档合同。不要从本地 SQL 文件推定 schema 已就绪。不可逆的旧业务表/字段删除另行安排，本流程没有 down migration 或 DROP 业务表步骤。

## 公开切换与旧入口核验

所有检查通过且获公开切换授权后，生成单独审核的 active 配置，将五个组成开关一起设为 true，保留闭合的上传/定时等独立控制和已有账号/原生/音乐/支付配置。索引另在正式域名和对应内容/HTTP 验收后批准；采集需要隐私版本、健康清理及独立授权，不能随页面顺带启用。active 文件与关闭态基线做结构化 diff、锁定哈希，重跑 dry-run 和实际受保护验收。

```sh
"${station_wr[@]}" versions upload --config "$station_active_config" --tag station-cat-t22 --message "Reviewed Station Cat cutover"
"${station_wr[@]}" versions deploy "$station_new_version@100" --config "$station_active_config" --message "Approved public cutover and legacy exits"
```

上传仍是远程操作，不在准备阶段执行；上传回执给出 `station_new_version`，再核对才部署。`versions upload` 不更改流量，但不会替你应用 routes/domain/cron 的变化；本次维持这些配置，若有变化须单独审核。版本/配置变动不得默默丢掉既有队列、原生或金融绑定/密钥。不要默认加 `--keep-vars` 掩盖完整配置缺项；当前 dashboard 值必须先纳入已审基线。

公开切换后立即针对生产实例化完整 T20 清单：既有/新 D1 slug、旧音乐后代匹配器、四语言/繁中别名、无斜线/编码路径、合法 `track`/`collection`、外部推广链接和已发布原生版本。先验确定实体映射，再判无对应地址；已知退出应真实 410、未知 404、可映射地址到同一实体，不回首页制造软 404。实际 GET/HEAD、其他方法、游客/普通账号/会员/历史购买者逐处理器核验。780 行源码清单、静态方法提示和 176 行缺服务配置结果不是生产通过记录。

核验同时记录新版首页/目录/详情/关于/会员、实时 sitemap/robots、回调/登录、章节/下载、AASA 与 `/api/mobile`、`/games/cat-life/` 的实际状态；新介绍不能占用运行目录。正式单曲路径不在原 AASA 覆盖内，不能在上线报告里声称原生关联已经扩大。私有壳仍拒绝访问。分别保存**部署回执**和**旧入口关闭核验**，缺后者不标关闭完成。

## 监控、停止与回退

切换窗口建议先观察 30 分钟，再 24 小时和 7 天复核；这些是待运营确认的门槛建议，不是已启用的自动系统。每项保存版本、窗口、样本分母和与旧版本的同类基线。数据不足或指标未接通不能宣称正常。只保留项目既有隐私/保留政策允许的聚合，不新增完整 URL/query、会话、订单或存档正文日志。

| 信号 | 分母/成功定义 | 停止条件与动作 |
| --- | --- | --- |
| 账号、历史权益、支付一致性、存档损坏 | 同一测试身份/订单/存档版本的前后核验 | 任一确认的错误授权、权益丢失、余额/订单异常或覆盖损坏，立即停止扩量并回退界面；保留业务库和在途写入证据 |
| HTML/API 5xx、关键 404、受控资源失败 | 版本内已确认请求；预期退休 404/410另计 | 关键路径单次确认不可用即暂停；普通 5xx >1% 且 10 分钟≥100 请求则暂停切换观察并调查 |
| 试听/完整播放失败 | 用户已触发的原生播放尝试；权限拒绝另计 | 失败 >2% 且≥100 尝试，或合法权益持续被拒绝，停止并评估回退；不把未开始播放的页面浏览当分母 |
| 游戏就绪/退出与保存 | launch request、经过消息身份核验的 ready、实际保存尝试 | 确认启动/退出丢数据立即回退；其余失败 >2% 且≥100 尝试暂停；`save_success`只代表本机回读，不证明云同步 |
| 平台跳转与页面性能 | 真实平台链接抽检、真实媒体/指定设备实测 | 错链接/不可用目标停止对应推广；移动 LCP≤2.5s、CLS≤0.1，现场有足够样本后另核 p75 INP≤200ms |
| 采集/清理/报表不可用 | 受控采集响应、清理健康与账本、聚合覆盖 | 单独关闭 `STATION_EVENTS_ENABLED`，必要时停报表聚合；音乐、游戏和账号继续。清理另按保留政策，不用采集故障授权删除 |

界面回退优先使用**预先验证的、兼容新 schema 的受控旧界面版本**。它应保留 T12 的损坏存档写入保护及当前账号/支付/原生服务配置和资产；不能只因“曾在线上”就选择 9 月 16 日的旧 Worker，亦不能从 Git 初始提交猜其兼容性。必要时从本批同一 Worker/资产生成 Station 关闭态版本，实现旧界面且保留现有服务修复。先核对待回退版本确实还可部署、绑定资源仍存在。

```sh
"${station_wr[@]}" versions deploy "$station_rollback_version@100" --config "$station_reviewed_config" --message "Authorized compatible interface rollback"
```

命令修改流量，不能在本批执行。恢复旧内容配置时通过 T16 后台回退，使用当前 If-Match/幂等键重新审核资源，追加新 revision，不直接改旧封存快照或批量写指针。账号/历史权益/支付/存档服务继续保留；新订单、新余额/账本、新云存档和新作品/事件仍在现有库里。

**界面回退不使用 `d1 execute --remote --file old-backup.sql`、D1 Time Travel 或旧 R2 快照覆盖活库。** 存储灾难恢复是另一流程：先隔离复制当前状态、差异分析/对账、逐记录恢复及保护新写入，经明确审核后执行，不提供未经审核的一键覆库命令。在途云写入、localStorage 跨进程竞争、1 秒退出和同源 iframe 边界不会因版本切换变成原子操作。

回退后重新核验订单/权益/余额、存档最新 revision 和后续写入、旧音乐权限、游戏运行端、原生资料库、素材引用与所有必要服务；保存恢复版本、时间、数据一致性和仍未通过的验收。只有实际有部署回执与 HTTP/身份证据，才更新生产状态。准备阶段一直保持聊天/审查开放，不自动开始新任务或清理旧版本。
