# R1 销户最终校验候选 — 2026-10-02

用户确认真机离线验收完成，并确认暂无财务保留与备份政策，本批先完成隔离实现。已确认的业务选择不变：公开评论匿名保留，个人资料清理不被余额或争议阻塞，不自动退款、清零或恢复权益。真实政策草案 approved / executionEnabled 仍为 false。

## 本批实现

- 候选评论迁移位于 `scripts/isolated-lifecycle/migrations/`，**不在生产迁移目录**。作者改为可空 / SET NULL，按列复制正文、审核状态和时间，保留三组索引。前置检查及 SQL 自身拒绝未知结构、索引、引用和触发器。回滚遇到匿名作者直接拒绝，不伪造作者或删除评论。迁移不匿名任何行；原有个人清理阶段执行作者解除和元数据最小化。正文仍可能含作者自述。
- 个人阶段补清理 `reader_totp_reset_attempts` 的精确账号作用域，最终复查残留；其他账号、IP 或 identifier 派生计数不猜测归属、不按邮箱查删。
- `retention-plan.js` 只读审查 14 张财务表的全部列及精确账号/订单/账本/购买关联。未知 schema、JSON、矛盾关联或超过 200 行的 JSON 扫描均阻断。报告仅含计数、列分类和政策摘要，不返回个人值、不写财务数据。候选保留字段不是法律或经营政策批准。
- `finalizer.js` 仅接受显式 synthetic-finality-v1、isolated / synthetic-r1 来源、审查结构和原有写屏障。固定政策版本及 SHA-256 摘要；期限从确认时间计算，不随重试延后，审计期限不短于已有 14 天回执查询期。重新检查个人残留，财务个人字段仍非空时报告 FINANCIAL_MINIMIZATION_REQUIRED，不绕过写屏障清洗财务数据。
- 最终消费者采用 30 秒持久租约和版本 CAS，在同一个 D1 batch 再检查财务个人字段、跨账号关联、扫描上限及账号 TOTP 残留，再原子提交 completed / outbox / 独立资金案件状态。失败回滚，进程重启或租约到期可恢复。余额与账本金额保持不变。已最小化的合成数据满足全部条件后可得到既有 completed 回执，响应无新增个人信息。

## 尚未实现的范围

四类 soft_links / admin_audit / providers / backups 记录是**特权、离线、合成人工审查凭据的引用**。摘要自身不证明清理执行。模块没有支持邮件、支付服务、日志或备份平台的真实适配器；测试模拟这些前提，不能作为真实外部清理证据。未知所有权的反馈、候补名单及审计不能用邮箱全文搜索自动删除。

恢复屏障逻辑上独立于旧快照；预检及持久化重启测试拒绝已删除账号。调用方必须传入当前控制账簿，不能把账簿与旧快照一起回滚；函数无法证明调用方没有传入旧账簿。**这不是 Cloudflare 平台备份恢复的实现或实测。**

真实财务字段和期限、运营主体/地区、提供方与备份处置、支持身份核验、迟到支付回调隔离仍须完成。财务最小化执行器、到期物理清除和真正独立恢复控制面未实现。因此本批是最终条件候选，不把 R1 整体或完整销户上线记为完成。所有文件仅由测试导入，没有 src/、Worker、定时任务或部署入口。

## iOS 联动

客户端继续使用既有 prepare / confirm / receipt-only status，严格验证任务、状态、确认/完成时间及回执到期；非法响应保留旧凭据。终态回执与新申请在同一个 Keychain item 原子归档，结果未知或未完成请求不被替换。有效确认后仅清理对应 environment / account 的个人库，阻止在途同步重写，失败及重启可重试。回执、游客、其他账号/环境和公共离线歌曲保留。回执归档尚未实施经营保留期，未完成凭据不得自动丢弃。

## 验证

```sh
python3 scripts/test-account-deletion-audit.py
python3 scripts/test-comment-author-migration.py
python3 scripts/test-comment-author-migration.py --preflight
npm run test:mobile:lifecycle
ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build
```

Miniflare 使用临时真实 D1、持久文件和随机 loopback，出站请求全部拒绝。覆盖账号隔离、TOTP 范围、缺失/过期政策与证明、财务残留阻断、回执跨任务访问、租约接管、重启、事务失败和迟到关联。虚构测试政策没有写入真实草案。空小说构建仅作本地验证，不能部署；最新远端 CI 在开 PR 后另行核对。本批未部署、未安装实体手机、未启用生产销户或订阅。

首次提交本地结果：`test:mobile:lifecycle` 的回执/财务只读 14 项、D1 评论迁移 5 项、既有生命周期 9 项及最终条件 10 项，共 38 项通过；Python 结构审计 11 项、评论迁移 15 项通过，只读 preflight 无阻断。网站 153 页构建和 postbuild 检查通过。iOS 指定模拟器局部测试 69 项通过（新增生命周期 16 项），OpenAPI 67 个正例、21 个反例以及源码/四语守卫通过。iOS 使用本机 Xcode 27 beta 6，服务端使用 Node 24.15.0；这些结果不替代远端固定工具链、实体机或生产验收。

## PR #182 复审修复 — TOTP 计数写入屏障

隔离 schema 新增账号作用域的 INSERT / UPDATE 屏障，并纳入执行前必须匹配的 guard manifest。INSERT 同样拦截 UPSERT；UPDATE 同时检查旧、新作用域与账号，拒绝把冻结账号行改名或把无关限流行改为冻结账号计数。只有精确匹配 String(accountId) 的活跃账号可以写入账号计数，DELETE 清理以及 ip / ip_ua / identifier_ip 作用域继续工作。冻结后至 completed、进程重启后均由数据库约束保护，不只检查完成事务中的瞬时残留。

新增实际 D1 回归使用产品 `reserveReaderTotpResetAttempt`：先读到活跃账号，将计数写入暂停，完成冻结/个人清理/最终条件后再释放；迟到请求被拒绝，账号计数保持零且 completed 回执不变，重启同一持久 D1 后仍成立。另覆盖 UPSERT、单独锁定 UPDATE、作用域改写、活跃账号限流阈值、非账号限流、缺失任一屏障拒绝运行及注入旧残留后继续拒绝完成。该测试没有执行完整密码重置 HTTP 或生产库。

修复后完整 `test:mobile:lifecycle` 40/40、Python 26/26、153 页构建与 postbuild、diff 检查通过。配套 iOS 单向确认修复的局部测试为 71/71；最新远端 CI 随修复提交重新执行。生产迁移、产品 Worker 与配置没有变更。
