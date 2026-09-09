# 会员接入记录

最新状态（2026-09-09）：M1-03 已完成独立只读资格与 capabilities/access 合同，见 [M1_VIP_ADAPTER](M1_VIP_ADAPTER.md)。没有连接线上路由或媒体。原会员 #118 的原子幂等/UTC/回跳修复、#119 的人工退款审核均已上线；用户报告真实兑换和人工撤销验收完成。下方所有 G1–G4、拟议未实现状态及行号均为 M0 历史基线，不得把历史缺陷当成当前未修，也不得把用户报告扩大为代理的 Safari/并发实测。

## 以下为 M0 历史核对

核对日期：2026-09-09。代码基线：3b8bbc8c324e65e721d9b1b989d6d87b988f447d。以下是源码与隔离测试结论，不是生产数据库审计，也不代表已实现音乐适配器。

## 唯一现有来源

| 位置 | 当前行为 | 音乐接入结论 |
| --- | --- | --- |
| `src/worker.js:4737` getReaderFromSession | Cookie 哈希查询 reader_sessions，要求未撤销、未过期，关联账号 status=active；成功后 UPDATE last_seen_at | 资格来源可复用，但原函数不是只读；需独立审查的只读入口/选项，保留其他调用方默认行为 |
| `migrations/0009_reader_memberships.sql` | account_id 是主键，每账号仅一条会员记录；expires_at NOT NULL | 不是多 grant 账本，没有独立 revoke、全站 scope 或终身字段；不得虚构这些能力 |
| `src/worker.js:1499` getActiveReaderMembership | 只检查 account_id 与 expires_at > CURRENT_TIMESTAMP；缺绑定/缺表返回 null | 缺基础设施与无资格混在一起；不能直接满足音乐 503/fail-closed 合同 |
| `src/worker.js:1483` readerMembershipToJson | 无 expires_at 也标 active；日期去空格换 T 再用 JS Date | 与 SQL/NOT NULL 约束不一致；不能据此推断“空日期=终身”。音乐应明确 UTC 校验 |
| `src/worker.js:1513` getReaderMembershipSettings | 从 admin_content_settings 读兑换开关、点数、周期、小说付费内容覆盖规则，有默认值 | 价格展示读取现有配置；小说覆盖开关不是已确认的音乐权限字段 |
| `src/worker.js:6296` handleNovelAccessCheck | 小说 member 级别可仅凭登录阅读；paid 分支才查会员/小说单项权益 | 小说 member、单章/整本权限均不能直接映射全站 VIP |
| `src/worker.js:6656` getReaderCreditSummary | 会 ensureReaderCreditAccount，包含余额/账单/会员资料 | 不把这份可写且含额外私人信息的接口用作音频请求鉴权 |

免费注册账号、积分余额、后台 Access 身份、游戏商品权益、VIP 图标和支付返回参数都不是 VIP 资格来源。未来音乐代码只从可信会话取得 accountId，禁止信任请求体里的 accountId/isVip/expiry。

现行 `membership_level='member'` 是原有兑换写入的值，UI 名称已是 VIP；不能为了音乐把它改名或凭任意 level 字符串授予全站权利。需要在原会员模块确认并集中表达这个映射。

## 已复现的差异

运行：`node docs/music/evidence/audit-current-membership.mjs`。脚本用真实 Worker 兑换路由、真实 Creem webhook handler、现有 SQL 迁移及内存 SQLite；禁止网络。回跳 helper 单独从源码提取执行，不实际跳转。完整证据与限制见 [测试记录](TEST_MATRIX.md)。

### G1 兑换原子性与重试

`src/worker.js:8646` redeemReaderMembershipWithCredits 依次独立执行扣点、会员 upsert、ledger INSERT，未组成事务。每次产生新 sourceRef，路由没有请求幂等键合同。

- 相同 Idempotency-Key 连续两次请求均 200，余额 100 -> 90 -> 80，期限延长两次。现在不是服务端承诺的幂等接口；不能把网络未知结果直接重试。
- 注入会员 INSERT 失败：响应 400，余额 80 -> 70，会员记录和兑换账单未更新。
- 这证明本地故障场景存在风险，不证明生产已经出现丢点或重复扣费。

建议独立原会员修复：账号绑定的请求幂等键、响应重放、扣点/权益/账单原子提交、并发守卫、失败回滚与响应丢失测试；前端只对同一意图复用键。不改变 10 点/1 个月、续期计算或既有会员权益。原支付代码修改须另获授权。

### G2 退款/拒付与撤销

`src/worker.js:10223` handleCreemWebhook 将 refund.created/dispute.created 交给 `applyCreditReversalFromOrder`（9092）与 `recordReaderCreditReversal`（9009）。现有批处理撤销积分包入账，不更新 reader_memberships。

隔离测试完成签名充值入账、兑换、签名退款：退款扣回 100 点后，会员行完全不变，查询仍 active。重复退款的积分幂等由原有测试覆盖，但那不等于 VIP 撤销。

reader_memberships 的 source_ref 在每次续期被覆盖；ledger 有兑换审计信息，但没有“哪次充值资助了哪个有效期限”的完整已实现合同。混合余额、赠送积分、多次续期、部分退款及拒付不能由音乐模块猜测。

上线依赖：由原会员模块明确并实现退款/撤销规则及来源关联，提供可信只读资格；或由用户明确批准不同产品规则并修订规格。当前不得用负积分直接封禁、撤销所有会员、猜测 FIFO、为音乐另建期限表，也不能宣称退款链路满足规格。

### G3 起止、范围、多 grant、终身

现有查询未检查 started_at。测试把开始时间设为明天、到期为未来，接口仍返回 active。正常兑换写入当前时间，但导入或人工数据不满足未来期边界。

当前架构只能确认单行有限期续购；没有独立多 grant、显式终身、显式撤销状态。把这些场景写入 mock 只能测试未来合同，不能证明现有来源支持。需要原会员层说明受支持的字段/状态与不支持时的拒绝行为；真实有多个合法 grant 时才谈有效 grant 合并。

### G4 返回地址

`src/worker.js:286` cleanRedirectPath 和 `src/components/ReaderLibraryPage.astro:1440` 的 returnTo 校验只拒绝非 `/` 前缀及 `//`。隔离执行确认 `/\\outside.example` 被 helper 接受，WHATWG URL 会解析为外站。未向外站发送请求；本结论不声称窃取会话。

拟修：共享严格同源相对路径校验，拒绝反斜线、控制字符、协议相对及编码变体；解析后再次核对 origin。音乐回跳另限制四语音乐路径和有限查询参数，保留合法歌曲/歌单 ID，不信任任意 next/URL。不直接沿用现有 helper。

会员中心 checkout 当前 returnPath 固定为 readerLibraryPath；兑换成功刷新会员但没有音乐回跳。`payment=success` 只触发订单复查，不是音乐授权；未来显示明确返回音乐入口，最多等待 60 秒同步，恢复暂停，仍按服务端资格授权。

## 拟议只读边界，尚未实现

音乐适配器输出“匿名/普通账号/有效 VIP/资格服务不可用”的最小结果及可验证 expiry，不输出邮箱、积分账单或原始会员 metadata。服务端每次受保护 GET/HEAD/Range 请求重查，不跨请求长期缓存；当前请求内可复用可信结果。

会话与账号可用性确认后，由原会员来源检查真实受支持的范围、开始/到期、撤销信息。缺数据库/表、异常或不受支持的会员记录，不能当成允许；资格服务故障为 503，而不是促购。正常匿名/无资格不查私人资料；免费曲与独立试听不被会员数据库故障拖死。

鉴权不写 session、账户、积分、会员期限或归因账本。需检查 D1 读复制策略以避免撤销后读到旧状态；当前仓库没有 withSession 使用，生产复制配置未核实。

M1 可以先写隔离领域/存储与上述失败合同，但真实 VIP 交付保持关闭。G1/G2/G3 的原会员修复不能混进音乐适配器；G4 的共享校验与回归应独立可审查。
