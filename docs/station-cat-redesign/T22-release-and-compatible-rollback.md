# T22 灰度与兼容回退准备

本批交付关闭态候选配置生成器、临时 D1/R2 备份恢复和应用回退演练、发布检查表及执行说明。**准备完成、生产已发布、旧入口关闭已核验是三个独立状态。** 生产发布条件尚未满足，本 PR 不执行生产备份、迁移、版本上传、部署、开关启用或旧入口关闭。前端与 Worker 产品源码、主 `wrangler.toml`、既有迁移和依赖版本保持原样；新增 CI 只运行本机检查。

分支 `codex/station-cat-redesign-t22` 从 T21 已合并的 `07088e0068a368f298575d8870d7bf2b94591328` 开始。[T21 PR #206](https://github.com/xdgf558/caption-ai-landing-site/pull/206) 精确头 `8cf0b4ae` 的 [CI 38047071665](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/38047071665) 43 步成功，2026-10-10 20:35:16 新加坡时间 squash 合并。T21 的性能、设备和生产缺口继续作为发布门槛。

## 生产只读事实

[只读清单](T22-evidence/production-readonly-inventory.json) 使用既有缓存 Wrangler 4.131.1 的部署/版本读取和 MUSIC_DB 三条 schema-only SELECT。没有导出生产数据、读取业务行、读取 R2 对象或执行写入。证据只保存允许的资源标识、迁移文件名、视图 SQL 与有限公开开关，没有身份邮件、凭据、其他变量或请求日志。

观察时 `caption-ai-landing-site` 最新部署是 `038582b5-b641-4780-addb-e3b5d8f4e280`，2026-09-16 10:58:22 UTC，100% 指向 `67d6e6b0-42f5-4696-8ed5-bc1096a49ebf`。实际绑定 WAITLIST_DB、MUSIC_DB 和 MUSIC_BUCKET 与已有生产资源对应。MUSIC_DB 账本只有 0001–0011；没有 `station_*` 表，`music_asset_references` 未包含新版网站引用。**生产尚不具备启用新版查询的 schema 条件。** 公开变量白名单仍显示旧 `MUSIC_PUBLIC_ENABLED=true`、`MUSIC_VIP_DELIVERY_ENABLED=true`；没有把旧音乐服务误记成关闭。

版本读取没有返回实际 Assets 路由策略，不能据此声称生产 Worker-first 已补齐。仓库主配置仍缺 T20 的部分优先路径；R2/Access 实际权限、素材权利和完整运行配置也没有因此通过。此清单是一个时点的观察，发布前必须重新比对精确目标版本、账号和绑定。

## 候选配置与切换边界

`scripts/build-station-release-candidate.mjs` 必须显式接收**经审核的完整现有部署 JSON 配置及其 SHA-256**，要求私有输入/输出均在检出目录之外，输出以 `wx` 和 0600 新建，拒绝覆盖已有文件/符号链接。缺 MUSIC_DB、错误账号/域名/入口/Assets、重复绑定、读者库误作音乐库、已知测试库、错误音乐桶和隐藏 env 覆盖都会拒绝。结构校验不证明云端资源身份或 schema。

候选保留完整基线中现有账号、支付、原生和旧音乐变量及其他配置，新增 15 个 Station 控制开关均为 false。主配置不是完整生产基线，不能直接作为输入。路径明确转成绝对路径，版本、日期、队列、cron 和 Access 沿用已审核基线。基线有其他相对构建/模块路径时，先在审核材料中明确其绝对目标；不能依赖输出目录猜测。

候选 `assets.run_worker_first=true`，覆盖首页、所有语言别名、音乐后代、无斜线/编码路径、退休入口、robots 与全部 sitemap 分片。它满足 T20 的整个优先路径合同，原生 Assets 演练从这个配置读取同一设置；主生产配置没有被替换。每个请求都会先执行 Worker，正式切换前需评估额外请求/延迟成本。依据 [Cloudflare Assets 配置](https://developers.cloudflare.com/workers/static-assets/binding/)，这可避免静态页面抢先绕过处理器。

公开切换的五个组成开关为 `STATION_ROUTE_MIGRATIONS_ENABLED`、`STATION_CONTENT_PUBLIC_ENABLED`、`STATION_MUSIC_PAGES_ENABLED`、`STATION_GAME_PAGES_ENABLED`、`STATION_MEMBER_PAGES_ENABLED`。首页/退出层要求全部开启；音乐、游戏、会员处理器各有既有双开关条件，**不能把它们当成跨处理器原子开关，也不能用部分开启作为公开灰度状态**。准备时全部关闭；受保护环境使用完整组合；授权切换时上传同一完整配置并一次部署该精确版本。统计、上传、内容后台、定时发布和索引按各自条件独立批准，不随着五个页面开关自动打开。

灰度采用受保护环境中的真实歌曲与测试存档演练、关闭态发布包/版本验证、最终公开 100% 切换。用户要求新版上线后直接关闭旧公开入口，因此不安排新旧公开页面的百分比并行。通过切换检查后立即复核 T20 的 301/404/410 和确定实体映射，账号、支付、章节、下载、原生和 `/games/cat-life/` 继续由原处理器决定权限。旧界面只在故障时作为受控回退版本恢复。Cloudflare 的版本/资产是一组发布材料，存储状态不随版本回退；见 [版本与部署](https://developers.cloudflare.com/workers/versions-and-deployments/) 和 [回退限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。

## 本机演练

```sh
ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build
npm run test:redesign:release
npm run rehearse:redesign:release
npm run check:redesign:release
node scripts/verify-station-release-readiness.mjs --require-ready
```

最后一条在当前未满足发布门槛时**预期退出 2**，不是检查失败被忽略。默认检查命令只验证检查表格式并列出缺项，不负责发起部署。修改 JSON 或“passed”字段不授予操作权限，不替代证据审核。

演练没有 remote/database/config 参数，只创建固定名称的可丢弃 Miniflare 实例，监听 loopback 并拒绝所有外部 fetch。读者库复用既有代表性迁移夹具，音乐库从 0001–0011 开始；先备份，再以每份迁移和账本同一 D1 batch 应用 0012–0018，不把一次性 ALTER 放进请求链重放。原生 Assets 使用真实构建和原 Worker，夹具开关请求头仅存在于测试入口，不会进入生产入口。

迁移前和新写入后分别恢复到**全新的独立 D1 克隆**；R2 原对象和新增对象也分别恢复到空桶，逐对象核对字节 SHA-256 和 HTTP/custom metadata。数据库逐表核对 SQL schema、SQLite quote() 生成的原值、行数和自增序列，包括空序列及删除过夹具行留下的 ID 高水位。原生 D1 外键检查与独立 SQLite 的 integrity_check 分开记录。工具拒绝向已有表的读者/音乐库恢复，不会将旧备份回灌到演练活库。

实际通过的断言包括：旧音乐读取/原有行和历史小说权益/会员不变，回填仍未发布，无推广回退；新订单与积分账本保留，余额 125→225；云存档经原 HTTP PUT 从 revision 4→5，旧界面回退后继续 PUT 到 6；新增网站草稿、待发行平台和一次受控事件保留。内容回退调用现有 T16 服务，复制旧封存快照到 revision 4，迁移后编辑的 revision 3 仍可见；撤销当前封面权利后，下一次回退被拒绝。合法审核新增清理保护引用，不能要求它们退回迁移前的零引用。

公开主页、旧介绍退出、语言/编码地址、robots/sitemap 分片经过原生 HTTP。游戏运行端切换前后字节一致；统计关闭后音乐页和游戏仍可访问。关闭一个组成开关只验证首页退出层回退，相关处理器双开关权限由专项继续检查。服务状态比较只证明这些夹具路径保持原处理结果，401/503 或相同状态不是完整权限验收。

订单和余额使用直接合成 SQL 写入，非商户回调；云存档使用现有处理器但仍是临时读者库，非真实云冲突。R2 使用小型合成对象核对备份/身份，不证明可解码媒体或真实权利。这些字节**没有替换 T21 的 PNG 性能夹具**，不用于 LCP 通过声明。演练不能承诺 D1、R2、Access 的跨系统原子性。

## 上线检查表与剩余条件

[执行说明](T22-execution-runbook.md) 给出已核对 CLI 的备份、迁移、版本切换和回退命令；[机器可读检查表](../../ops/station-release-readiness.json) 逐项记录证据，当前 `launchReady=false`、`productionDeployed=false`、`legacyClosureVerified=false`。

生产仍需要正式内容构建、0012–0018 升级后的实际字段/账本/清理视图核验、生产备份在隔离环境恢复、R2 引用与素材权利、主推和真实平台链接/试听/视频确认、真实歌曲与测试存档演练、完整生产 URL/身份/方法合同、兼容回退版本和监控证据。T21 歌曲页 LCP 3.37–3.43 秒仍超过 2.5 秒，不得用更小合成图宣布修复；应准备真实授权的尺寸合适、压缩过的海报/封面，在相同网络重测。iPhone、Android、稳定桌面浏览器、抖音/微信、VoiceOver、导出落盘和现场 p75 INP 均保留未验收。

既有边界继续保留：在途云 PUT/POST 不取消或回滚；Cookie/服务端写入及 localStorage 比较/setItem 非原子；游戏退出最多等待 1 秒，同源 iframe 没有 sandbox；缓冲中的完整音频可能继续播放；失败上传占用配额且无删除入口；视频不逐帧解码；D1/R2/Access 发布资源不是一个事务；旧 src 归因未核验，会话不是唯一访客；采集依赖单独清理健康。网页 `stationcat.music.v2` 与原生个人资料库独立，AASA 未扩大。账号清理依然未获批准、未启用。

最终本机测试、原始日志、演练报告、SQL/对象 manifest 和文件哈希见 [证据目录](T22-evidence/README.md)。T22 精确头完整托管 CI 在 PR 提交后独立核对，本地结果或 T21 CI 不替代它。全部开发任务材料交付也不等于网站已经上线。
