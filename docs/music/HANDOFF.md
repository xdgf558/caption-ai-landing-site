# 音乐系统交接记录

## 最新：M2-04 单曲媒体协议

用户授权从 main@9fc9e95 开始 M2-04，分支 `codex/music-media-protocol`。full/preview 版本化入口已接生产 Worker 路由，但公开开关仍默认关闭且没有新增绑定；关闭时不碰 D1/R2。每次请求读取当前发布修订，VIP full 在 R2 前复用原会员实时资格，preview 只读独立短文件。GET/HEAD、单 Range、If-Range、200/206/416、no-store 和无 304 合同已完成，详见 [M2_MEDIA_PROTOCOL](M2_MEDIA_PROTOCOL.md)。

本地媒体 10/10、会员 21/21、存储 12/12、Miniflare runtime 18/18、全仓 npm test/build 通过。没有部署、开闸、迁移、云端读写、正式音频、播放器或 UI。M2-03 歌单继续保持 IN_PROGRESS；它不阻断单曲媒体协议开发，但公开上线前应按最终曲库产品范围闭合。下一步先审查本轮，再由用户决定补歌单、M2-05 或继续播放器基础。

## 最新：独立预发存储

PR #127 已合并 main@726a586。用户批准建独立存储，已创建 station-cat-music-staging（8fe1a3e1-7325-4d87-a7e6-2c51338b9158）与 station-cat-music-staging-private，迁移 0001–0003 完成，配额 0，桶公开入口均关闭。资源/核验/备份详见 [STAGING_STORAGE](STAGING_STORAGE.md)。ops/music-staging-storage.jsonc 只用于存储运维，不是部署配置。生产库/桶未改，未部署、上传或开闸；测试 Worker 禁止接入这些云资源。以下“最新”为历史阶段。

## 最新：简洁音乐后台基础 UI

PR #126 已合并 main@c3cba1c；本轮分支 codex/music-admin-workspace，用户授权 UI，不含部署。新增 /admin/music/，Product Design 参照现有文章后台；范围、恢复协议和验证记录见 [M5_ADMIN_WORKSPACE](M5_ADMIN_WORKSPACE.md)。全仓、6 项客户端、11 项上传、17 项 runtime 与构建通过；CLI 浏览器 6 用例已接 CI 但待运行。内置浏览器已验证隔离上传/审核/发布链路和 390px。后续不得声称真实音乐/云端/听审或公开播放器已验收。

PR #127 初审后已复现并修复 audio.play() 测试失败：含 build 的 npm run test:browser:music-admin -- --repeat-each=3 为 18/18，通过完整发布/下架/归档；client 6/6、admin 20/20。上段“待运行”为首轮交付历史。下一步核对修复提交的远端 CI 再复审；浏览器刷新恢复 journal 的策略未改，主动重新载入才 GET 曲目。纯本地预览器使用假身份和临时数据库，禁止部署。下面“最新”标题均属较早阶段历史。

日期：2026-09-10。最新交接：PR #125 已合并，私有上传与审核发布 API 本地完成，待独立 PR 审查。下方其他阶段内容均为历史，最新状态以本节与 CURRENT_PHASE 为准。

## 最新：M2 私有上传与审核发布

基线 main@1ca7e02，分支 codex/music-private-uploads。11 项上传测试、17 项本地 workerd/D1/R2、npm test/build 通过，145 页/111 sitemap。见 [M2_PRIVATE_UPLOADS](M2_PRIVATE_UPLOADS.md)。上传流/配额预留、complete 真实文件校验、私有审阅下载、技术确认和成功发布 API 已连通；旧公开版/权利/事务边界保留。

0003 只能用于 MUSIC_DB，本地默认 quota=0，需另批配置。一次写入会话不可接管，丢响应先查状态/complete；失败或过期预留仍计费，安全清理和配额回收留 M2-05，不可直接删除会话/回执。无新依赖；image-size 候选撤回，原 9 项 audit 告警未处理。无云端资源/迁移/部署/正式音乐或 UI。fixture Worker 含假身份和上传测试前缀，绝不可部署。

下一步先审查；之后可授权简洁后台基础 UI，使用 Product Design。公开音频 Range/VIP 守卫、歌单、清理/外部限流和真机/预发仍未完成，不能因为本地发布成功就开闸。PDF/图像仅有限结构检查，MP3 不是完整解码，试听语义同源和真实权利必须人工核对。

## 历史：M2-ADMIN

用户授权管理接口接入，基线 main@9dc86e3，分支 codex/music-admin-api。20 项管理接口、21 项会员、25 项发布、14 项本地 workerd/D1/R2 测试和全仓 npm test/build 通过，145 页/111 sitemap。见 [M2_ADMIN_API](M2_ADMIN_API.md)。

完成音乐专用 Access JWT actor（不采信 email/Host/local bypass）、同源/custom-header 防护、64 KiB JSON 上限与读超时、草稿新版本、人工权利记录、下架/归档/审计。写操作同批事务/零命中回滚/幂等回执；旧公开版与历史不被草稿保存覆盖。未接完整验证器，所以 HTTP publish 固定 503。#121 重复 Cookie 对齐、异常 clock/budget 和迟到 rejection 回归已完成；#122 畸形 metadata 422 有回归。

下一批是 M2-02 私有上传、配额/租约、完整验证器与技术审核，再接成功发布闭环。歌单、公共媒体、清理/限流和真实预发仍待做。没有创建资源、迁移、部署、上传正式内容、UI 或音乐开闸；测试 stub 不代表正式审核，禁止部署 fixture Worker。以后涉及 UI 仍必须 Product Design。

## 历史：M2-RUNTIME

用户授权先做运行环境与存储适配。基线 main@3c48aa4，分支 codex/music-runtime-storage；12 项存储、10 项本地 workerd/D1/R2 测试、全仓测试通过。正常 npm ci 可重建；运行时套件进入独立 CI 步骤，源代码与合成夹具均可从仓库复现。见 [M2_RUNTIME_STORAGE](M2_RUNTIME_STORAGE.md)。

完成规范音频 key 与条件 GET、原生 BYOB 每块不超过 64 KiB、共享 GET/解析期限和取消清理，完整本地 D1 发布/回执重放/末尾零命中回滚，32 MiB/4 MiB 单读与四并发。测试用独立 reader D1 核对 INTEGER 账号和 UTC TEXT 期限的只读资格查询，不使用真实会员资料。

尚未创建云端 MUSIC_DB/R2、迁移/部署、发布音乐或开闸；没有 UI。真实预发、实际套餐 CPU/整体 heap/多实例、对象删除竞态、完整证据验证与人工试听仍待做。测试权利/证据 stub 不代表完整生产发布。#121 Cookie/异常 clock、空歌单、#122 metadata 422 留管理/媒体接口批次。以后 UI 按要求调用 Product Design。

新增固定测试依赖的告警已通过限定子依赖版本处理；原站 9 项依赖告警仍存在，不宣称 npm audit 全绿。原站依赖大版本升级单独处理。

## 历史：音乐 M1-05

用户授权合并 #122（main@ac8ac76）后，再批准本批解析器开发。分支 codex/music-mp3-validation 增加流式测时/hash、严格帧/ID3/预算检查、对象与试听源绑定；没有迁移或路由。21 项解析测试及 24 项发布测试通过，五份本地合成 MP3 与独立 FFmpeg packet 计数一致，本地 workerd 测量与截断拒绝通过；npm test/build 通过，145 页/111 sitemap。

详见 [M1_MP3_VALIDATION](M1_MP3_VALIDATION.md)。M1 本地基础完成，不等于真实资源交付；没有上传正式音乐、创建库/桶、部署、修改会员/支付或开闸。结构解析不是完整解码或语义同源证明；支持范围与 CPU/内存边界已明确，FFmpeg 仅本地生成测试文件，不进入应用。

下一步按授权做 M2，先补预发独立 D1 完整 publish/回滚、真实对象核验和 Access JWT + Origin/CSRF。#121 的重复 Cookie/异常 clock/生产查询、空歌单、#122 metadata 错误分类均仍待处理；D1/R2 删除竞态未解决。依赖审计另有原有版本 9 项告警，两项新库无列入告警，不混入本批全站升级。后续 UI 必须 Product Design。

## 历史：音乐 M1-04

用户批准先合并 #121 再开工。核验已审核 head 73229af、CI 通过后标 ready，合并为 main@233d716。分支 codex/music-conditional-publication 实施条件发布、双审核指纹、幂等回执保护和独立迁移 0002；23 项发布测试通过，npm test/build 通过（145 页/111 sitemap），本地 D1 增量迁移和 changes() 零行整批回滚合同验证通过。

见 [M1_PUBLICATION](M1_PUBLICATION.md)。未改 Worker/支付/会员、未接路由、未部署/创建资源/上传或发布真实作品。缺省验证器仍返回 503；本地注入结果不是 MP3 或 R2 验收。下一步 M1-05 真 MP3 解析，再推进 M2。未来 UI 开发仍须 Product Design。

#120 mutations REPLACE/UPDATE 保护和发布统一校验已完成；空歌单留 M2。#121 重复 Cookie、异常配置和真实 D1 会话查询仍留 M2；本地发布 guard 实测不能替代资格适配的生产验证。

## 历史：音乐 M1-03

用户要求“先合并，然后做 M1-03”。PR #120 CI 通过后标 ready，以已审核的 77f5411 合并为 main@8994fa4。未部署音乐、未执行迁移、未创建音乐资源。

分支 codex/music-readonly-vip：新增 membership.js 只读适配和 access.js 合同，复用原会员日期/资格判断与四语会员中心路径。18 项测试包含真实兑换与人工审核函数的隔离联测，不是生产交易。详见 [M1_VIP_ADAPTER](M1_VIP_ADAPTER.md)。本批没有 UI；涉及 UI 的后续批次仍要求 Product Design 和桌面/移动验收。

退款规则早已确定为 #119 人工审核且已上线，用户报告真实验收完成。以下 M0 的“待确认”句子只保留历史，不构成当前阻断项。#120 三项非阻塞建议已在 M1_VIP_ADAPTER 分配到 M1-04/M2，尚未实现，不把本 PR 当作已修。

下一步审查 M1-03，然后 M1-04 条件发布与 M1-05 真 MP3 解析；无生产部署或开闸授权。

## 历史：音乐 M1-01 / M1-02

用户确认退款后台登录后验收和真实撤销已经人工完成，随后批准本轮音乐隔离开发并要求涉及 UI 时调用 UI 技能。PR #118/#119 已上线；不再把退款规则或部署标成待确认，也不把人工验收扩展为 Safari/多实例测试。

分支 codex/music-m1-foundation，基线 main@dee3cdf。新增独立 migrations-music 初始化、src/music/policy.js、catalog.js 与 Node/SQLite 测试，详见 [M1 基础](M1_FOUNDATION.md)。本地 D1 模拟器迁移及完整性检查通过；npm test/build 通过，17 项音乐测试，145 页面/111 sitemap。无 UI，不跑音乐 Playwright。

未改 Worker、原会员模块、支付、wrangler、导航或生产数据库；未创建真实音乐桶/库、上传素材、发布或开闸。下一步审查本轮，然后 M1-03 资格适配、M1-04 发布事务、M1-05 MP3 实测。以后涉及页面/播放器 UI/后台 UI，必须调用 Product Design 技能，并做桌面/移动端验证。

## 历史：原会员独立修复进行中

M0 PR #117 已合并为 19a4436。用户要求在下一阶段前修复会员与回跳。独立分支 codex/fix-membership-redemption-safety 实施原会员原子兑换、账号绑定幂等回执、浏览器持久重试、严格 UTC 有效期与共享安全回跳；新增迁移 0036，仅本地测试，未改价格或生产资源。见 [修复说明](../reader-membership-safety.md)。

退款对 VIP 的撤销规则仍在等待用户确认，尚未实现；不能把这部分标为已关闭。M1–M6 保持 TODO，不自动继续音乐开发。M0 历史审计入口现改跑正确行为回归，旧复现保存在 git@19a4436。

本次原会员修复验证：npm test、npm run build 通过，144 页/111 sitemap；支付浏览器 30 例通过。新增迁移只用于内存测试，生产未执行；本批按独立 Draft PR 送审，不自动部署或推进音乐阶段。

## 历史：用户授权开工后的 M0

用户在文档规划后明确“好的，开工吧”；本轮按已说明范围只执行 M0，不自动继续 M1、不改原支付。

已完成 M0-01 至 M0-05：核对真实 Worker/VIP/后台/路由/语言/资源，新增 DECISIONS、MEMBERSHIP_INTEGRATION、COMMERCIAL_RULES、TEST_MATRIX、OPERATIONS 和 evidence/audit-current-membership.mjs，更新记忆与任务状态。fetch 后 origin/main 仍是 3b8bbc8。

关键发现：现有 VIP 每账号仅一条期限行，没有多 grant/显式终身/退款撤销合同。真实 Worker + 内存数据库测试复现相同请求键双扣点、会员写失败仍扣点、未来开始时间仍 active、退款保留 VIP；会话查询写 last_seen，回跳 helper 可把 slash-backslash 解析为站外。均未修改，原会员修复单独提出；不凭负积分撤销、不另造会员账本。

验证：M0 审计脚本、npm test、npm run build 均 exit 0；144 页、111 条 sitemap。公开 payments/status 匿名 GET HTTP 200，响应时间 2026-09-09T12:06:10Z，仍 100 积分/USD10、10 点/1 月；没有读取生产会员、发送真实交易或创建资源。未跑 Playwright/真机，未部署。

用户随后要求开 PR 审查，本变更按独立 M0 Draft PR 送审；不包含功能修复，不自动合并或部署。下方 PREP 的未提交状态属于历史记录。

PR #117 审查无 P1/P2。两项 P3 已在文档中修正：Worker 函数行号按基线核准；语言切换明确使用音乐专用映射，繁中直接到 `/music/`，而非仅扩展 standalone 正则。原会员/回跳修复仍须独立 PR；审查通过不代表部署、开闸或批准改支付。

下一步建议：先授权独立修复原会员原子性/幂等与共享回跳校验；退款/续期关联政策需用户确认后处理。音乐 M1 可先做隔离数据/策略/发布守卫/解析器，真实 VIP 接入依赖合同解决，默认四开关关闭。M0 DONE 不是商业开闸批准。

本地持久化入口 PROJECT_CONTEXT -> CURRENT_PHASE -> TASKS -> MEMBERSHIP_INTEGRATION。新会话先读这些文件，不把下面 PREP 的历史“未审计/未运行”当作最新状态。

## PREP 历史记录

## 本轮输入

- 用户提供 Station_Cat_Music_开发文档_v1.1_VIP整合版.md。
- 用户提供 Codex_音乐页面开发启动指令_v1.1.md。
- 用户明确要求暂不动工，只读文档、拆任务并纳入记忆。

两份来源保存在 DEVELOPMENT_SPEC.md 和 CODEX_START.md；原文保持独立，不覆盖彼此。它们描述未来系统，不代表功能已存在或已获得部署授权。

## 已完成

- 阅读完整规格第0–23节、附录及配套启动指令。
- 新增 docs/music 下的两份规格副本与 PROJECT_CONTEXT、CURRENT_PHASE、TASKS、HANDOFF 四份记录。
- 按 M0–M6 拆分32项 TODO，另将 PREP 文档准备标 DONE。
- 记录私有媒体、统一VIP、独立试听、版本化发布、真机验收及分阶段授权门槛。
- 记录规格快照4e0bd66已落后于本地origin/main 3b8bbc8；没有借此推断生产会员/退款细节。
- 新建本地 codex/music-planning 分支，以已合并的 main@3b8bbc8 为基线。

## 验证与未执行

实际操作仅为文档读取、仓库状态/文件清单检查及文档写入；交付前核对来源副本、相对链接、任务编号/数量和仅docs/music变更。

未运行 npm test、构建、Playwright 或任何音乐功能测试；本轮不修改运行时，无需用无关构建冒充音乐验收。未深入审计 Worker/VIP/退款、未联网复核来源条款/费率、未登录管理后台、未查询会员、未创建R2/D1、未上传音乐、未迁移、未收费、未发布、未部署。未提交、未推送或创建PR。

尚待真正实施时补充的 DECISIONS、MEMBERSHIP_INTEGRATION、COMMERCIAL_RULES、TEST_MATRIX、OPERATIONS 已列入 M0-05，不创建内容重复或假装已核实的空壳证据。

## PREP 时的下一次接续建议

先读 PROJECT_CONTEXT.md、CURRENT_PHASE.md、TASKS.md 和用户最新要求。若用户明确授权启动，先开展 M0 只读现状核对，将真实代码映射、退款依赖及需授权事项写明，再决定后续阶段；不能根据 CODEX_START 原文自动继续 M1。

需要向用户索取正式内容时，集中提出实际必要材料：少量候选完整MP3、对应独立试听、封面/歌词和权利核对材料。不要现在要求用户准备全500首，也不要把30首、免费比例或每月4–8首的运营示例变成硬性承诺。

音乐模块与已有游戏内音乐不是同一项目，不改写 docs/cat-life-game-music.md，也不覆盖原站根目录阶段记录。
