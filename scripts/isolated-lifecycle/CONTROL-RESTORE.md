# 独立删除台账与旧 reader 恢复实验

本模块只用于本地 `synthetic-r1` 数据。CONTROL 是独立的持久数据库，不能放进 reader 的备份、恢复或覆盖流程；其 SQL 位于 `control-schema.sql`。恢复实验也不接入普通执行器或任何 HTTP/定时任务入口。它没有实现 Cloudflare 备份服务、真实备份清理、生产读取代理或生产销户完成证明。

## 可信输入与边界

调用方必须提供以下上下文：

```js
const ctx = {
  environment: 'isolated',
  dataset: 'synthetic-r1',
  controlProfile: 'synthetic-control-v1',
  namespace: 'synthetic-reader-primary',
  anchorStore: {
    async load() { /* Anchor 或 null */ },
    async compareAndSwap(expected, next) { /* 真正原子 CAS，返回 boolean */ }
  },
  async assertReaderNamespace(db, namespace) {
    /* 用可信 binding registry 核对数据库身份和 namespace */
  }
};
```

生产替代实现需要把 anchor 放在独立、持久、受保护且可原子 CAS 的存储中，不能和 reader 或 CONTROL 一起回滚。anchor 是 `{schemaVersion:1, ledgerId, namespace, watermark, digest}`，本身没有时间有效期。模块信任 anchorStore 与 binding registry；如果攻击者能够同时改写 CONTROL、anchor 和这两个可信实现，本模块不能发现这种改写。测试中的独立文件、原子 rename 与 D1 对象身份 registry 只是单进程本地替身，文件替身不是跨进程 CAS 服务。

每次恢复必须给出可信备份清单中的 `snapshotDigest`（SHA-256）、`readerRef`（UUID）和新的 `restoreId`（UUID）。模块记录并比对清单摘要，但不负责取得或验证备份文件的来源签名；调用方必须先验证文件与清单相符。namespace 标识具体 reader 数据集，不能按用户请求临时选择，也不能让恢复操作自行把陌生 binding 加入 registry。

## CONTROL 登记与非原子恢复

`initializeControlLedger(control, ledgerId, ctx)` 只创建固定版本的空台账。CONTROL 只允许五张固定表及对应 SQL/索引/trigger，包含独立的 `r1_control_restore_verifications` 验证进度和封存结果。登记和完整审计核对来源 dataset、版本、namespace、ledger ID、连续序号、全链摘要与保护 anchor；每次准入改为核对受保护的完成结果及当前水位，不重复扫描全链。`registerDeletionTombstone(control, sourceReader, jobId, ctx)` 先调用现有来源隔离检查，并确认任务已有确认凭据、确认时间、`station-account-v1` scope，且相应账户已冻结。来源检查透传 `executionProfile`/`completionProfile`，可使用单独审查的扩展来源 schema。

不可变墓碑仅含任务、账户和 scope 的准确关联，禁止 UPDATE/DELETE；新增墓碑与 head 推进在 CONTROL 一个 batch 中提交。它不修改 reader，不按邮箱搜索或查删财务数据。登记相同任务与相同 payload 是幂等的，同账户冲突任务失败关闭。本地实现最多接受 10,000 条墓碑；达到上限时在任何新写入前返回 `CONTROL_CAPACITY_REACHED`，已有台账仍可核对/读取。恢复就绪核验每批最多 25 条，持久保存进度；扩大 10,000 条容量上限仍须另行审查。

CONTROL batch 与外部 anchor CAS 无跨库事务。如果 CONTROL 已提交但 anchor CAS 前中断，普通 snapshot/admission 返回 `CONTROL_ANCHOR_PENDING`。`reconcileControlAnchor(control, sourceReader, ctx)` 或重试同一个登记会验证受保护的旧 anchor 仍是完整链前缀，并逐项重新核对所有未锚定的来源任务仍已确认和冻结；随后才 CAS 推进 anchor。改写已锚定前缀、回退水位、来源不符或并发 CAS 失败都不能放行。空台账首次 provision 则先 CAS 保护 genesis，再提交 CONTROL 初始化；中断后仅允许同一保护 genesis、同 ledger ID、同 namespace 且无任何墓碑/恢复任务时重试。已初始化的 CONTROL 丢失 anchor 一律拒绝，不能从旧 CONTROL 重新生成 anchor。初始化是可信的新建台账管理操作，不能作为丢失控制面历史的恢复手段。

`readControlSnapshot(control, ctx)` 返回当前保护 snapshot；`assertControlSnapshot(control, expected, ctx)` 核对是否仍为同一水位和摘要；`readControlTombstones(control, snapshot, ctx)` 在同一校验下读取精确墓碑关联。`readControlCheckpoint` / `assertControlCheckpoint` 只核对固定 schema、台账身份、保护 anchor、head 和主键定位的末条摘要；`readControlTombstonePage` 每次最多读取 25 条，核对连续序号、上一批保存的链摘要及每条内容摘要，最后一批必须到达保护水位对应的摘要。完整链审计和受限 checkpoint 是不同用途的接口。输出没有邮件、个人正文或财务金额。墓碑记录含必要的内部账户/任务标识，不应作为公开报告输出。

## 恢复、重放和读取准入

恢复调用方必须从创建恢复 binding 起就禁止路由、读取、认证及后台写入。原始旧 reader 没有恢复 gate，绝不可直接开放。`beginControlledRestore(control, reader, {restoreId, readerRef, snapshotDigest}, ctx)` 先验证固定 schema，然后持久安装 `r1_restore_gate` 和写屏障，保存 `blocked`，最后才读取 CONTROL 并进入 `replaying`；始终返回 `ready:false`。即使 CONTROL 缺失，已安装的 gate 也保持 `blocked`。

恢复 schema 校验精确比较表、列定义、索引与 trigger SQL，只接受当前迁移加基线 R1 fixture，可选 `completionProfile:'synthetic-finality-v1'`。不接受金融执行、外部任务等新 execution-profile 表；包含这些表的快照必须有独立审查的恢复契约后才能处理。本恢复 binding 不可交给普通 executor，因为它增加了恢复专用表及 trigger。

`replayControlledRestoreStep(control, reader, restoreId, ctx)` 以持久 cursor/phase/revision 重放当前水位的全部墓碑。每一阶段先重新冻结相关账户，再按精确账户关联移除凭据和私人数据、匿名化公开评论、清除账户 scope 的 TOTP 计数并替换身份；评论正文和审核状态保留，财务表不写入。每次最多处理 200 行，阶段变更和写入在 reader batch 中提交，并在返回前再次核对 CONTROL。任意一步中断后可继续，重放全部结束以前仍返回 `ready:false`。

`verifyControlledRestore(control, reader, restoreId, nowEpochMs, ctx)` 要求全部墓碑重放结束。每次最多核验 25 条墓碑对应的个人残留，将验证 cursor、连续链摘要和 CAS version 持久保存在独立 CONTROL 库；未完成时返回 `ready:false` 和 `verificationCursor`，调用方可以重启后续跑。首次验证固定 reader 的 `data_revision` 与工作流 `revision`，不能在保留旧进度的同时采纳后续修订号。任一受控凭据、私人、财务、评论、TOTP 或账户表的 INSERT / UPDATE / DELETE 都会通过同事务 trigger 推进 `data_revision`；数据变化后旧验证代失效，从头核验。修订号不允许回退。

完成最后一批后，reader gate 先转为 `ready`，再在 CONTROL 同一事务中封存验证结果并使 plan 就绪。封存结果绑定 ledger ID、namespace、restore ID、readerRef、snapshotDigest、水位、摘要、数据/工作流修订号和验证版本；reader `ready` 本身不能准入。两库之间中断只允许在完整 cursor、完整链摘要、相同数据修订号及相邻工作流修订号全部匹配时续做封存，不能凭未完成进度生成结果。

证明的 `issuedAt` 在全量验证完成后以入参时间加实际单调耗时计算，`expiresAt` 固定为其后 30 秒。已经封存且没有变化的验证结果可以直接签发新鲜短期证明。`assertRestoreAdmission(control, reader, proof, nowEpochMs, ctx)` 只进行有界的 schema、CONTROL checkpoint、anchor、plan、gate、封存结果及版本检查，不查询个人业务表、不运行 `foreign_key_check`、不枚举全部墓碑。所有准入等待耗时仍计入 30 秒有效期，结束时过期也拒绝。缺失 CONTROL/anchor、旧 proof、旧水位、数据变化或新删除都拒绝；新删除推进 head 时，CONTROL 也会持久封锁旧恢复计划，需新 restoreId 从当前完整水位重放。

这依赖受保护 CONTROL 与未经旁路的数据库触发器。准入会检查固定 schema，但不能把有界 checkpoint 当成每次重新审计全部历史；拥有原始管理权限、移除触发器后篡改旧数据再还原 schema 的操作超出该边界。对来源未经信任或经历管理 SQL 操作的快照，必须重新执行完整链审计及从头就绪验证，不能复用原封存结果。本批只修改合成实验 schema，旧实验数据库需重新创建，没有自动升级或生产迁移。

这些 trigger 只能限制写操作，SQLite trigger **不能阻断 SELECT**。真实读取边界必须由调用方对每次请求/认证/后台访问调用 `assertRestoreAdmission` 并检查返回的当前水位，且不能在检查后的长任务中忽略水位变化。`withControlledRestoreRead(control, reader, proof, nowEpochMs, ctx, read)` 在 admission 后执行纯读取 callback，结果返回前再核对同一 CONTROL 水位、reader 数据/工作流修订号、封存版本和计入 admission/callback/最终核验耗时后的证明期限；读途中新增删除、数据修改或证明过期会使读取结果被丢弃。callback 必须纯读取，不得写入、提前返回到外部、记录/发送结果或 streaming，否则无法撤回已产生的副作用。跨数据库的检查与后续读取没有原子性；生产仍需串行准入、租约或等价一致性机制。本实验不能声称所有未经包装的 raw SQL 都被隔离。重启后的持久 `ready` 标志也不能代替新鲜的 admission 检查。

恢复就绪只表示被墓碑覆盖的个人数据重放完成；它不表示财务保留期限已审批、外部服务已清理、所有备份已删除或真实账户已完整销户。

## 本地验证

`node --test --test-timeout=600000 scripts/test-deletion-restore-control.mjs` 使用互不相同的持久 source/CONTROL/restored Miniflare 数据库及独立 anchor 文件，构造删除前的完整旧 reader SQL 快照。测试覆盖未确认任务拒绝、namespace 与 schema 漂移、初始化和追加 CAS 中断重试、旧 reader 封锁、个人重放、另一账户及财务数据保留、持久重启、CONTROL 篡改/回退、并发新增删除、读取 await 中变更水位导致结果丢弃、证明过期及缺失控制库/anchor。另用真实持久 SQLite 验证 10,000 条容量边界拒绝不改变 head/记录/anchor，既有记录仍可读取和幂等核对。Miniflare 只监听本地回环地址，Worker 返回 404，外向请求替身返回 503；不加载远端凭据或生产 binding。

`node --test --test-timeout=600000 scripts/test-deletion-restore-scale.mjs` 另用真实持久 Miniflare D1 构造 1,000 条完整哈希链墓碑。空 reader 的重放完成位置由 fixture 设置，该测试专门验证独立就绪核验，不冒充千条删除任务的完整重放验收。全部墓碑都实际分批核验，覆盖续跑、重启、固定 SQL 次数准入，以及数据/水位变化后旧结果失效；较小 fixture 继续真实执行全部重放阶段。
