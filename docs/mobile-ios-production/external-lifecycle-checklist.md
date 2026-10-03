# 正式账号接入：真实服务与完整销户清单

本清单依据仓库代码、迁移和 2026-10-03 R1 实现盘点，不是线上资源扫描。未读取生产数据库、服务控制台、秘密、备份或私有运维材料；配置中的 binding 或 provider 名只证明仓库存在接入约定，不证明线上已启用、实际资源范围或保留期。正式账号与曲库接入可以继续实现和本地验证；完整销户须满足下列独立条件，不能因认证已接通就宣称销户完成。

已确认的业务选择继续适用：公开评论匿名保留；余额和争议独立建案，不阻塞明确归属的个人资料清理；不自动退款、清零或恢复可用权益。匿名评论正文仍可能含作者自述，须保留删除或举报处理渠道。经营主体尚未确定的字段和期限保持待定，不沿用合成测试里的数字作为真实政策。

## R1 已有能力与生产边界

最新依据是 [`docs/mobile-ios-r1-execution-20261003.md`](../mobile-ios-r1-execution-20261003.md)。10 月 2 日报告中“财务执行器尚未实现”是历史状态，不能用于描述当前合成实现。

| 已有实现 | 已验证的合成能力 | 正式使用仍缺少 |
| --- | --- | --- |
| [`scripts/isolated-lifecycle/executor.js`](../../scripts/isolated-lifecycle/executor.js) | 已确认冻结账号的凭据、个人资料、评论作者关联及身份字段分阶段清理；租约、限量批次、事务失败恢复和写入屏障 | 正式迁移、真实旧结构兼容、调度/重试/告警、与网站写入及迟到回调共存的屏障 |
| [`scripts/isolated-lifecycle/financial-executor.js`](../../scripts/isolated-lifecycle/financial-executor.js)、[`retention-plan.js`](../../scripts/isolated-lifecycle/retention-plan.js) | 14 张财务表按精确关系最小化；保留期后检查案件与实际零余额，再按依赖顺序清除；不修改余额制造通过 | 真实字段与 JSON 分类、期限和案件流程；历史孤立或矛盾关联处理；生产支付回调兼容 |
| [`scripts/isolated-lifecycle/external-cleanup.js`](../../scripts/isolated-lifecycle/external-cleanup.js) | 第三个独立合成服务 D1 的完整资源盘点、真实 fixture 内容删除、幂等操作、持久重试、独立 readback 与防重建屏障 | 仅有 `createSyntheticCleanupAdapter`，没有邮件、支付、日志或云备份的真实清理 adapter；成功布尔值或人工摘要不能替代执行核验 |
| [`scripts/isolated-lifecycle/control-ledger.js`](../../scripts/isolated-lifecycle/control-ledger.js)、[`restore-control.js`](../../scripts/isolated-lifecycle/restore-control.js) | 独立 CONTROL、保护 anchor、不可变墓碑、隔离旧快照重放、分批就绪验证和短期读取准入 | 真实独立存储、可信资源 registry、原子 CAS、备份来源核验及不可旁路的并发读取准入；本地文件 anchor 不是跨进程 CAS 服务 |
| [`scripts/isolated-lifecycle/execution-orchestrator.js`](../../scripts/isolated-lifecycle/execution-orchestrator.js)、[`finalizer.js`](../../scripts/isolated-lifecycle/finalizer.js) | 核对当前 CONTROL、财务最小化、全部外部资源独立结果及最终事务，满足条件才提交 `completed` | 产品消费者和生产完成契约；不能直接部署这些依赖 Node 文件/SQLite 与 synthetic profile 的测试模块 |

这些执行模块只由合成测试导入，不是产品 Worker、HTTP 或定时任务。真实 [`docs/mobile-ios-m2/deletion-plan/policy-draft.json`](../mobile-ios-m2/deletion-plan/policy-draft.json) 的 `approved`、`executionEnabled` 仍为 `false`。现产品 [`src/mobile/deletion.js`](../../src/mobile/deletion.js) 的 outbox 消费者只到 `attention_required / retention_policy_review`，不会完成跨产品删除。原生认证、音乐和销户能力必须分别控制，未接完整销户时不得开放会冻结正式账号的 prepare/confirm 流程或宣传其已可用。

恢复实验的限制详见 [`scripts/isolated-lifecycle/CONTROL-RESTORE.md`](../../scripts/isolated-lifecycle/CONTROL-RESTORE.md)：触发器不能阻断任意 SELECT；包含 financial/external 扩展的快照尚不在当前恢复契约内；千条规模测试验证的是分批就绪和固定成本准入，空 reader 的删除重放调度由 fixture 跳过，不能当作千个真实账号的完整恢复验收。

## 服务、资源与归属映射

每个真实 adapter 的资源键应包含固定服务身份、reader namespace、资源类型和 provider/resource ID，并与已核验账号或订单关系绑定。不能假设不同 reader 的相同数字账号 ID 属于同一人。具体资源 ID、秘密和含个人值的执行证据保存在受控运维位置，本文件只记录字段映射和完成条件。

| 范围 | 仓库证据与现有接入 | 需核实的实际资源及归属 | 所缺实现与核验 |
| --- | --- | --- | --- |
| 邮件 | [`wrangler.toml`](../../wrangler.toml) 的 `EMAIL` / `send_email`、`READER_EMAIL_FROM`；[`src/worker.js`](../../src/worker.js) 的 `sendReaderLoginEmail`、`sendReaderPasswordResetEmail`、支付及运维告警发送函数 | 实际邮件服务账户、投递记录、收件人/抑制名单、告警邮件副本及客服收件箱；建立 message ID 到账号/业务事件的可靠映射，不能仅按邮箱批量删除 | 发信实现不是删除 adapter。需要资源发现、服务支持的删除/最小化、不可删除部分的保留依据及到期处理、独立结果核查。邮箱重置 request 端点当前返回 `EMAIL_PASSWORD_RESET_DISABLED`；函数存在不代表找回邮件链路已启用 |
| 支付 | [`src/worker.js`](../../src/worker.js) 的 Creem checkout/product/webhook 与 NOWPayments invoice/IPN；[`migrations/0005_novel_payments.sql`](../../migrations/0005_novel_payments.sql)、[`0030_creem_reversals_and_event_ids.sql`](../../migrations/0030_creem_reversals_and_event_ids.sql) | 分别核实 Creem 与 NOWPayments 是否仍有真实数据；按 `provider`、`provider_order_id/payment_id/invoice_id/event_id`、`order_id` 和 account 关联盘点订单、付款、退款、争议、客户资料及 payload | 现有 adapter 处理交易，不负责销户。需区分可删客户资料与必须保留凭据，按服务限制执行/核验；迟到及重复 webhook 不得重新创建登录身份或可用权益。`CREEM_MODE=production` 不证明线上凭据或历史数据范围 |
| 应用和平台日志 | [`wrangler.toml`](../../wrangler.toml) 开启 observability、采样 1；[`wrangler.mobile-r2.jsonc`](../../wrangler.mobile-r2.jsonc) 关闭 observability；[`src/music/diagnostics.js`](../../src/music/diagnostics.js)、[`src/worker.js`](../../src/worker.js) 有应用诊断/告警 | Worker 请求与应用日志、可能启用的导出目的地、错误诊断、CI/人工运行产物；逐项确认是否包含 IP、账号、邮箱、code/state、grant URL、Authorization 或请求正文 | 没有日志清理 adapter。需要采集字段最小化、权限和保留配置、错误字段脱敏、删除或到期核验；应用不主动打印 token 不能证明平台请求 URL 已脱敏。不能为了排障把原始敏感请求写进日志 |
| D1 与备份 | 正式 `WAITLIST_DB` 约定见 [`wrangler.toml`](../../wrangler.toml)；生产音乐候选见 [`scripts/build-music-production-candidate.mjs`](../../scripts/build-music-production-candidate.mjs)；已有运维备份说明见 [`ops/MUSIC_RELEASE_PREPARATION.md`](../../ops/MUSIC_RELEASE_PREPARATION.md) | 实际 D1 数据集、平台恢复能力、SQL 导出、本地/云端副本、持有人和访问范围；备份清单用可信 namespace、快照身份/摘要关联，不能仅靠文件名或本地任务状态 | 没有 Cloudflare 平台备份/恢复 adapter。需确定删除、隔离至到期或恢复后重放的处置，部署独立 CONTROL/anchor，验证旧快照恢复全过程在准入前封锁认证、读取和后台写入；控制面不能随旧快照一起回滚 |
| R2 与内容副本 | 正式 `CONTENT_BUCKET`、`DOWNLOADS_BUCKET`；音乐独立 `MUSIC_BUCKET` 约定见 [`src/music/runtime.js`](../../src/music/runtime.js)；内容导入和修订结构见 [`migrations/0007_backend_content_platform.sql`](../../migrations/0007_backend_content_platform.sql) | 发布者音频、封面、授权资料、内容修订和导入备份，与普通 reader 个人数据分别核验；确认是否另有真实读者上传资产 | 公开内容和发布者资产不随普通读者销户删除。若有读者资产，需要确定 owner/resource 映射和引用关系后实现清理；不能按邮箱、对象前缀或共享资源推测所有权 |
| 软关联 | [`migrations/0001_waitlist.sql`](../../migrations/0001_waitlist.sql) 的 `waitlist_entries.email/normalized_email`；[`0018_product_feedback.sql`](../../migrations/0018_product_feedback.sql) 的 `contact_email/metadata_json`；[`0013_reader_totp_reset_attempts.sql`](../../migrations/0013_reader_totp_reset_attempts.sql) 的 scope/key | 候补名单、反馈、自由文本、identifier/IP 派生限流键；邮箱对应的订阅/联系身份不自动等于 reader 所有权 | 已能精确清理 `scope='account'` 的账号计数；其他 scope 和反馈/名单仍需确认映射。禁止全库字符串搜索删除；无法证明归属应明确列为待处理范围，不伪造“无残留” |
| 管理审计 | [`migrations/0007_backend_content_platform.sql`](../../migrations/0007_backend_content_platform.sql) 的 `admin_audit_logs`；音乐迁移中的 `music_admin_audit_logs`、mutation/upload/review 记录；[`retention-plan.js`](../../scripts/isolated-lifecycle/retention-plan.js) 分类管理人字段 | `actor_email`、主体引用、reason/note/metadata 中的读者资料；管理员身份、发布者和被操作的 reader 需分别识别 | 需保留必要审计事实并最小化读者值，核实不可变日志能力和期限；不能因为 actor 邮箱相同就删除整条管理审计。合成 `admin_audit` adapter 不等于上述真实表处理已接通 |

评论与财务外键不能靠直接删除账号解决。正式 [`migrations/0017_reader_comments.sql`](../../migrations/0017_reader_comments.sql) 仍是作者 `NOT NULL / ON DELETE CASCADE`；匿名作者候选迁移在 [`scripts/isolated-lifecycle/migrations/0001_comment_authors_forward.sql`](../../scripts/isolated-lifecycle/migrations/0001_comment_authors_forward.sql)。财务/游戏表混合 `CASCADE`、`SET NULL` 和 `RESTRICT`；空账号、孤立 provider 引用或未知 JSON 须单独盘点，不能为通过 DELETE 改写约束。

## 经营主体需要补齐的决定

这些是尚缺的业务输入，不要求暂停已经授权的代码、契约和本地测试。经确认的决定应写入有版本的政策，再由实现固定摘要及起算时间；重试不能延长期限。

| 决定 | 需要提供的明确内容 |
| --- | --- |
| 适用范围 | 运营主体、经营地区、用户范围、实际服务提供方及责任联系人；据此确定保留依据，而非套用测试政策 |
| 财务最小字段 | 逐表确定金额、币种、交易/provider 引用、账本/争议关联、时间、幂等及防重复回调标识的必要性；单独决定 `customer_email`、payment URL、reason/note、actor 信息和 raw JSON 的删除或最小化规则。内部账号/订单 ID 仍是可关联数据，不称为匿名 |
| 保留期限 | 为财务、争议、删除回执/审计、墓碑/控制面、邮件、平台日志和各类备份分别确定期限、起算事件、例外及到期执行责任。现技术 TTL 或合成 policy 数字不是经营保留批准；本文件不预设天数 |
| 客服与身份核验 | 指定可用支持入口、未绑定/丢失 TOTP 的恢复和销户核验办法、最少所需材料、限制访问人员、无法确认身份时的处置，以及评论正文个人信息请求的处理方式 |
| 余额与争议 | 个人清理继续，资金案独立保留并禁止恢复可用权益；明确谁处理未结余额、退款/拒付、争议与迟到支付，怎样记录结果及通知用户。不会因销户自动退款/清零。非零余额或未结案件不能被标记为满足财务最终清除条件 |
| 完成与例外告知 | 区分个人资料清理完成、必要记录继续保留、外部平台待处理和回执到期；说明用户可查询/联系的渠道。提供方限制或不可删除备份必须有明确处置与证据，不能写成已经物理删除 |

## 正式启用前的阻断项

正式认证/曲库接入与完整销户是不同交付条件。以下清单用于判断相应能力是否可启用，不增加对本地开发的重复审批。本次范围不包含生产迁移、部署、真实数据查询或真实账号清理。

- [ ] **正式账号/曲库：** 固定生产 origin/callback、资源身份及独立密钥配置；在完整正式 reader 迁移加 native 增量上验证旧网站会话、会员、注册/找回和曲库共存；不复制 R2 测试账号、歌曲、token 或密钥。
- [ ] **正式账号/曲库：** native Cookie/Bearer 不互认；密码/TOTP 变更与账号限制使原生会话和受保护 grant 失效；会员到期、下架、音频版本和限免边界在取流时仍复核；网站原有权限不变。
- [ ] **正式账号/曲库：** 未具备完整销户时，关闭该能力和 prepare/confirm 写入口，不能仅隐藏按钮；检查配置响应与客户端行为一致。注册后无法使用现有 TOTP 找回的情形有真实可用的说明/支持路径。
- [ ] **完整销户：** 正式旧 schema、精确外键/软关联和真实提供方资源范围已核验；未知归属、孤立关系和超过既有扫描边界的情况有可恢复处理路径。
- [ ] **完整销户：** 评论匿名迁移与个人/财务写入屏障具备正式升级、回滚和回归证据；迟到的登录、TOTP、同步、支付、管理写入不能复活已清理资料或权益。已有匿名作者时不能直接反向恢复 NOT NULL。
- [ ] **完整销户：** 上述业务字段、期限、支持/案件流程落实；真实政策有版本、明确适用范围和执行条件。合成 `approved:true` 不可作为启用依据。
- [ ] **完整销户：** 每个真实 adapter 有完整盘点、固定作用域、幂等操作、失败重试、独立结果核查和资源重建限制；处理成功但本地回执丢失时可恢复，不接受仅凭返回成功或手填摘要完成。
- [ ] **完整销户：** 独立 CONTROL/anchor 与真实备份恢复准入已落地；当前所有生产 schema 扩展纳入恢复契约；旧快照、控制面不可用/回退、并发新删除、重启和读途中水位变化都保持阻断。
- [ ] **完整销户：** 产品消费者、调度、积压告警和最小回执查询已接通；最终事务重新核查全部条件才报告 `completed`。到期财务清除与销户回执查询分别实现，不能重新运行完成编排代替历史查询。
- [ ] **生产操作：** 有可执行的备份、升级、回退和关闭方案及敏感信息不外泄的验证记录；在相应生产操作进入本次授权范围后执行，不能把本地 Miniflare 或合成恢复结果冒充线上验收。

## 可并行推进的工作包

| 工作包 | 可立即完成的交付物 | 依赖与完成证据 |
| --- | --- | --- |
| 账号与曲库接入 | 独立生产配置合同、原生迁移候选、注册/找回入口、销户 capability gate、完整 reader + 独立音乐库共存测试 | 不依赖真实保留期限；本地验证旧 Web 行为、正式模式默认关闭、权限与失效边界，保留真实部署差距 |
| 服务 adapter 契约 | 邮件/支付/日志/软关联的资源 inventory、命名空间、操作/核验结果模型与失败重试测试 | 可以先定义契约及模拟失败；真实 provider 选择、能力和数据映射未核实前不声称清理已接通 |
| 数据与政策矩阵 | 以 [`schema-inventory.json`](../mobile-ios-m2/deletion-plan/schema-inventory.json) 和 `retention-plan.js` 为底稿，补每类字段的依据、期限、所有权和例外 | 经营主体填决定；真实旧数据盘点待有对应范围后进行，不读取或发布个人值作为开发夹具 |
| 恢复控制面 | 独立存储/CAS/registry 设计、所有扩展 schema 的恢复契约、分批验证与准入并发测试 | 在可信控制面和真实备份流程接入前保持实验边界；需要覆盖控制面中断与旧备份防复活 |
| 产品执行与运维 | 生命周期状态机、队列/租约/重试/告警、客服资金案、回执到期及诊断脱敏方案 | 依赖已明确的完成契约和真实 adapter；个人清理、资金保留/争议及最终到期清除各自报告状态 |

本清单不触发网络查询、迁移、部署或数据删除。完成这些工作包中的代码和合成验证后，应更新逐项证据与剩余缺口；不能仅以测试数量或 R1 `completed` fixture 推定正式完整销户已经就绪。
