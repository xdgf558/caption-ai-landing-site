# M2 原生认证：本地隔离服务

2026-09-16。本工作树基于 `df20f70dddf53f091aa8b68abebdab72dc9f3ecf`，分支 `codex/music-ios-m2`。配套 iOS 仓库 `xdgf558/station-cat-music-ios` 的分支为 `codex/m2-auth`，基于 M1 合并 `4cbdec03f34659411640a660f39034a123e1fe7c`。用户暂时没有隔离 HTTPS 域名和 Apple Developer Team ID，已选择先实现本地版本。

**未部署，未执行远端迁移，未连接真实账号。** 这是独立审查的实现基础，不是完整 M2 / App Store 验收。所有生产配置原样保留；不要用这个工作树覆盖存在独立差异的生产冻结来源。

## 实现范围

`src/mobile` 提供 `/auth/mobile/*` 专用系统浏览器账号页、`/api/mobile/v1/auth/{token,refresh,logout,reauth}`、`/api/mobile/v1/me`、删除 prepare/confirm/status。`src/worker.js` 在已有 Worker 内转发这些新路径，并复用旧账号密码、TOTP、注册和找回实现；旧网站函数的 createWebSession 参数默认保持 true。原生注册/找回传 false，不生成 Cookie，需明确重新登录。

旧网站的密码重置邮件入口当前关闭，原生找回沿用 TOTP 核验，不新增邮件或绕过二步验证。专用页面只有账号操作，无积分、付款、会员购买导流。登录是第一方 code + PKCE 设计，不宣称通用 OAuth 服务。

仅当 `MOBILE_AUTH_ENABLED=true`、`MOBILE_ENVIRONMENT=isolated`、合法 HTTPS origin / 精确 callback 和版本化加密 key 同时存在时开放；硬性拒绝两个现有生产域名。当前没有在 wrangler 配置写入任何这些字段，未配置时新路由返回 503，维护任务直接退出。iOS 四配置另有默认关闭的客户端门控。

数据库扩展在 `migrations-mobile/0001_native_auth.sql`，**不在部署使用的 migrations 目录**，没有生产执行脚本。复用隔离库中的 reader 表，不复制身份账户。测试加载 reader 基础迁移与此扩展，在临时 D1 目录执行，结束后清除。

## 验证

```sh
npm run test:mobile:auth
npm test
ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build
```

第一项使用 `scripts/helpers/mobile-runtime-worker.js`，只限本机测试。包含 fixture 路由，**绝不能部署**。Miniflare 只监听 127.0.0.1，随机测试 key 和虚构账号，每个外部请求统一返回 503。虚构 HTTPS origin 通过 dispatchFetch 注入，不能当成真实 TLS / AASA。

结果：29 项隔离运行时测试通过；网站完整 `npm test` 通过；153 页面构建、111 公开 sitemap 路由及站点断言通过。空小说构建仅作编译验证。`npm test` 最初因沙箱不允许 localhost 监听而中断，开放本机监听后重跑成功，无生产操作。CI 新增专用认证测试步骤，尚未推送执行远端 CI。

专项测试覆盖：实际网站 fetch 路由；旧账号同一 ID；授权码单次并发兑换；错误 PKCE / redirect / Cookie / Origin；TOTP 必须且不可复用；原生注册与 TOTP 重置成功不创建网页会话；并发同 ID 刷新返回同一结果；改变请求冲突；旧 token 新 ID 只撤销其家族；未知 token 不影响其他人；superseded 与超时墓碑；撤销和密码/因子改变；D1 故障回滚；近期认证；删除两设备冲突与跨账号禁止；outbox 回滚；receipt 独立最小查询/过期/账号行已移除；查询 503；请求大小与限流；服务运行时重启与保留旧 key 的加密轮换。

## 安全与保留边界

- 每次关联读取使用 D1 first-primary session；无效 Bearer 永不降级 Cookie。
- access 5 分钟、refresh 滚动 30 天、家族绝对上限 90 天，均以服务端时间为准。token 仅存哈希，响应 no-store，无凭据日志。
- 同次刷新结果以 AES-GCM 保留 120 秒，AAD 绑定家族、请求 ID 和服务器摘要。结果清理后保留墓碑和旧 token 哈希至绝对到期；不能提早删掉后误判重放。密钥是显式版本 map，新写用 active key，旧结果仍需对应旧 key。
- 零行 CAS 插入 CHECK 失败使 D1 batch 全部回滚；不只依赖 JS 对 meta.changes 的事后检查。刷新结果、下一代与操作记录同成同败。
- 无 Authorization 的 logout 仅接受 refreshToken 做所属家族撤销；包括已消费的旧代，可关闭旋转竞态。它不能访问资料或换发 token；未知 token 同样确认。客户端遇网络失败只宣称本机已退出、服务器未确认。
- 删除准备有效 10 分钟；receipt 32 字节，服务端存解码字节 SHA-256，查询有效 14 天；近期认证 5 分钟。confirm 必须正常 Bearer 和近期密码/TOTP 核验，receipt 不能代替确认。
- confirm 受理的同一事务中冻结全站账号、撤销 web/native session 与登录 token、写持久 outbox。prepared 超期不撤销账号；查询失败不假定 completed。
- outbox 当前只进入 `attention_required / retention_policy_review`。没有物理删除跨产品资料、金融记录或游戏存档，也不宣称 completed。完整保留/匿名化规则、实际消费者与人工处置流程批准之前不能作为可上线删除功能。
- 最小删除任务无账号外键，账号行移除后 receipt 仍可查。receipt 过期后不再披露状态；任务/outbox 的清理保留期尚待产品数据政策确认，当前不会擅自删除记录。

## 后续启用前条件

需要独立 HTTPS origin、已登记 Team/App ID、AASA、服务端密钥托管、仅隔离数据库绑定及审查后的迁移流程；再测 ASWebAuthenticationSession、真实重启恢复、iPhone 首次解锁前 Keychain 与多设备竞争。A11–A13 三个时点的真实进程故障、实体机证据和全站账号删除完成路径目前不足。音频授权、个人同步与 StoreKit 属于后续阶段，不能通过开启本次 auth 标志冒充完成。

配套 iOS `docs/M2-report.md` 有主规格 A01–A21 / S02–S14 逐组证据和未完成项；M0/M1 文档保持历史原貌。


## M2 恢复验收补充（2026-09-16）

在已合并网站 #172 / iOS #2 的基础上，新增 [全站销户数据与执行方案草案](deletion-plan/README.md)，覆盖 86 张实际迁移表和 10 项内存数据库风险测试。政策尚未批准，消费者仍停在 retention_policy_review，没有接入真实清理。

`scripts/helpers/mobile-crash-service.mjs` 是配套 iOS A11–A13 进程终止测试的本机桥接器。它启动真实隔离 Worker 和临时 D1，只监听 loopback，以随机密钥保护测试入口，屏蔽全部外部请求；合成账号通过真实授权码流程创建会话。A11 在服务端提交后扣留响应，A12/A13 由原生测试目标在 Keychain 写入前/后退出进程。配套驱动及精确来源版本见 iOS `docs/M2-recovery-acceptance.md`。辅助服务绝不能部署。

本机三组实际进程终止与恢复已通过，使用原有 120 秒重放期限、真实模拟器 Keychain，无假时钟或产品故障钩子。它们补足此前 A11–A13 的本机故障证据，但不代表真实 HTTPS/AASA、实体 iPhone、锁定设备 Keychain 或完整销户通过。本轮重跑 29 项隔离认证、10 项销户审计测试及 153 页编译验证；空小说构建仍不是生产包。此前各阶段记录保留为历史证据。
