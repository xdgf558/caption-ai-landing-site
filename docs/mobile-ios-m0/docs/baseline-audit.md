# M0 基线审计

2026-09-15（Asia/Singapore）。采用完整开发文档及启动指令 v1.0.1，原文件已复制到 docs/specs，SHA256 见 evidence/spec-sha256.json。v1.0 旧规格停止用于实施。

结论：可以作为开发基线；已完成本地盘点、最小原生媒体实验与四项故障模型。**M0 真机、Keychain 签名及真实认证联调关卡尚未通过；没有进入 M1，也不具备发布条件。**

## 真实代码与生产

GitHub `git ls-remote` 返回 main=`3dc0007323b9cced51761bd0e6f59bcce215cf67`，本地 landing-site-novel-library-night HEAD 相同。参考文档中的 f0537685 为历史值。

只读 Cloudflare deployments list 再次确认最新部署 `f09a24f0-8616-420c-8d2e-672c0fb8bb8b`，2026-09-15T14:47:10Z，版本 `1d9e4830-495e-4db6-a7ca-b681e3f41408` 承接100%流量。脱敏记录见 evidence/production-deployments.json。未查询生产数据库或账户资料。

生产可核对源码为 本地发布记录目录 `novel-library-night-deploy-20260915/source`（不随本PR提交）；与 main 已跟踪且双方存在的文件逐个比较，有9个差异，见 evidence/main-production-diff.json（这个数字不包括生产额外生成资源）。涉及封面展示优化及相关公共 API、播放器、系统控制和测试。不能直接用 main 覆盖生产。发布仍须使用既有完整来源/构建/核验流程，M0 没有重建部署包。

用户工作区仍为 ` M README.md`、`?? node_modules`，前者产品介绍改动、后者既有依赖链接均保留。没有新远端、PR、提交、迁移或上线操作。

## 只读实现盘点

下表源码路径相对上述生产源码目录；行号为本次读取版本。

| 领域 | 已观察实现 | 复用与缺口 |
|---|---|---|
| 注册 | worker.js:3748；reader_accounts、reader_password_credentials，PBKDF2-SHA256 100000 次，用户名/email 校验及唯一约束；成功建立网站会话 | 复用现有验证与 ID；新增专用移动认证页面/授权码服务，不复制注册数据库。 |
| 登录 | worker.js:3879；按用户名/email 查询、验证密码、创建 Cookie 会话 | 本次所读普通登录 handler 无额外 TOTP 步骤，不可把“支持 TOTP 重置”宣称成登录已强制2FA。移动敏感操作的新近认证与适用 TOTP 需显式实现。 |
| 找回/改密 | worker.js:4140 请求邮件重置返回410；4165确认支持 TOTP 找回与旧 token 路径；4448改密校验当前密码 | 复用限流、TOTP消费和密码规则。重置已有 reader_sessions 撤销；新增 native_sessions 后必须同步撤销，不更改密码算法参数。 |
| TOTP | worker.js:3984/4009/4074，状态/设置/确认；migrations 0012/0013 | 保留账号作用域、验证码防重放与失败限流；M2 冻结 mobile recent-auth 证明，不能从 session 未过期推断刚完成2FA。 |
| 会话/退出 | worker.js:3487建立哈希会话30天，4623附近查询active账号，4666读取，5908注销当前哈希；Cookie HttpOnly/SameSite=Lax/HTTPS Secure | 新增稳定原生session、access/refresh分离、90天绝对界限；旧 Cookie 路由保持。 |
| CSRF/Origin | 音乐/若干敏感写入口有专门校验，旧 Cookie SameSite=Lax；未发现所有 reader handler 共用的统一 Origin 前置层 | 不宣称全站同一保护；新认证页面明确设计同源CSRF与重定向白名单。不得为了原生而移除现有校验。 |
| 全站VIP | src/readerMembership.js、src/music/membership.js；reader_memberships 一条有限 member期间；音乐查询使用D1 first-primary | 复用身份与连续有效期；保留旧 membershipStatus。新 music-only 来源禁止写回全站表。 |
| 积分/购买 | /api/readers/credits、membership/redeem，reader_credit_ledger、reader_membership_redemptions、Creem记录 | 仅盘点；App v1.0不展示、不调用付款写接口。没有真实购买测试。 |
| 音乐内容/发布 | src/music/catalog.js/publicHttp.js；独立 MUSIC_DB；草稿、审核、已发布、effectiveAccess、版本、独立试听 | 复用公共投影；不暴露对象键，不放开草稿，不改后台发布。 |
| 音频 | src/music/mediaResponse.js；GET/HEAD、Range206/416、If-Range、R2读取前鉴权，严格v/variant | 原URL不加token。新增mobile grant+独立Bearer入口，底层可共享Range/存储服务。 |
| 权益变化 | src/scripts/musicAccessLifecycle.js；到期先清能力/卸载受保护源，再刷新 | 原生保留同样的失败停止原则，增加连续时钟硬截止与操作序号。 |
| 收藏/历史 | src/scripts/musicLocalData.js，stationcat.music.v2，本机localStorage；收藏500/最近50/位置1000 | 未找到账号共享API；规格5000收藏、1000/90天历史为新目标，不是已有能力。需账号隔离、版本/墓碑、historyEpoch。 |
| 账号删除 | 未找到规格对应prepare/confirm/status路由或持久化删除作业 | 新增完整账号生命周期；非logout别名。游戏购买及财务引用阻止简单DELETE，详见迁移清单。 |
| Apple/原生 | src与迁移目录未发现/api/mobile/v1、native_auth_codes/native_sessions或Apple订阅表实现 | 属新增工作，v1.1交易/验签后做，不提前开购买。 |

该盘点是相关调用链与迁移的审计，不是对单体 worker 全部业务做完整安全审查；未触碰真实账号、订单、数据库或密钥。

## 本地实验与证据等级

| 层级 | 实际结果 | 不代表 |
|---|---|---|
| 既有网站自动化 | node --test 5个文件：81项，80通过、1失败、0跳过；含TOTP原有脚本 | 不等于真实用户登录/支付、所有网站测试。 |
| Python故障模型 | 31项通过；包含四个真正子进程退出点、SQLite多连接并发与回滚 | 不等于D1 batch、Keychain数据保护或生产后端。 |
| 本机HTTP服务 | 16个GET/HEAD/Range身份矩阵通过；拒绝响应没有音频字节 | 固定测试身份映射，不是正式token校验/R2。 |
| iOS27模拟器 | SwiftUI探针运行；AVPlayer item ready，实际播放/seek；真实HEAD+Range携带Bearer；音频缓冲至4.049s，仍在rate=1时3s硬截止pause/取消/移除；12s迟到503没有恢复 | 不等于iPhone锁屏、后台调度、AirPlay、蓝牙/来电验收。 |
| Keychain | 临时无开发签名工程实际返回-34018，item写/读未通过 | 文件journal测试不能替代它。额外临时entitlement尝试导致无法启动，已撤回，未改开发者账号。 |
| 认证/系统集成 | HTTPS callback SDK构造成功；音频session与远程暂停命令注册成功 | 没有真实HTTPS回调/PKCE交换、系统控制操作或2小时锁屏测试。 |

原生记录见 evidence/native-probe.jsonl，媒体请求见 native-requests.jsonl，仅记录布尔认证与范围，不含凭据。模拟器音量0以免干扰用户，播放时钟推进证明解码/运行，不声称实测听感。

既有失败仍是 test-music-library.mjs:125：旧期望 `/cover?v=3`，实际 `/cover?v=3&size=display`。未删除断言或改业务掩盖。M1前要将封面性能分支与基线测试对齐，并同时保护分享原图；报告不能写“全部测试通过”。

## 未关闭的关卡

1. 具有正确签名配置的最小iOS工程/Keychain权限，真机首次解锁前后及四个终止点恢复。
2. 已授权的隔离后端和测试账号，实际D1事务/复制一致性、AASA、PKCE及撤销联调。
3. iOS18和当前系统实体iPhone，后台/锁屏/耳机/AirPlay及全缓冲硬截止误差。
4. 全站删除的财务、游戏权益和备份保留策略；不是单纯技术删表。
5. main与生产来源差异/一个旧测试失败，需在后续集成前解决。

当前没有证据要求放宽v1.0.1的四项规格。M0本地交付可审查，下一步按 docs/M1-tasks.md 开始工程与契约；不自动执行M1。
