# 原生生产接入候选 · 2026-10-03

这批交付把原生账号、曲库和个人同步接到独立的生产配置合同，并在本机合成资源中验证完整网站 schema 共存。它不是生产启用：未读取真实账号或秘密，未部署 Worker、执行生产迁移、填充生产 marker、安装正式客户端或上传 App Store。首版仍不售卖订阅；完整销户也尚未接入生产。

## 本批实现

- 服务器使用 `station-native-production-v1`，只接受 `https://wwwstationcat.org` 与精确 `/auth/mobile/callback`；隔离环境拒绝正式域名及其大小写、末尾点别名。密钥版本须为 `production-vN`，这只校验命名，不证明实际密钥与 R2 独立。
- 每次生产原生请求验证 reader D1、catalog D1 和私有音频 R2 的独立身份标记；失败时在限流及业务写入前停止。标记防止误绑，不代替云资源归属核验，也不授权复制 R2 测试资料。
- 原有网页账号密码/TOTP、会员、音乐权限继续复用；Cookie 与原生 Bearer 不互相替代。新生产 AASA 路由受同一配置与资源检查控制，仅关联 `2AM5S7BM2N.org.stationcat.music`。资源路由不会被静态文件遮盖。
- 原生生产销户 prepare/confirm/status 在访问数据前硬性拒绝；配置返回 `accountDeletion:false`，维护任务不消费生产销户 outbox。设置环境变量也不能解锁。R1 实验执行器未被搬入产品运行时。
- iOS 配套工作树增加严格的 production profile、一次性配置解析和能力上限；正式销户没有服务、UI 或 API 请求路径。四个提交配置保持关闭，未生成本机激活文件，版本仍为 `0.1.0 (4)`。

共存检查发现并修复了共享注册路径的账号归属缺口：网页与原生注册现在只能原子创建全新账号，既存邮箱即使尚无密码也被拒绝；唯一约束保护并发，密码写入失败回滚新账号。新用户网页注册仍创建原 Cookie 会话，原生注册仍不自动发会话。**历史 magic-link 账号不能借注册表单附加密码**；这类账号的密码迁移需要另行验证邮箱或已有会话所有权，不能将“复用账号 ID”当成归属证明。已具备密码的旧账号登录不受此限制。

## 验证记录

| 检查 | 本地结果与边界 |
| --- | --- |
| `npm run test:mobile:production` | 26 项 Node/Miniflare + 12 项 Python 通过；含默认关闭、错误绑定、完整旧 schema 共存、网页/原生注册竞态与回滚、TOTP、Cookie/Bearer、AASA、会员与同步隔离、迁移预演 |
| 原有 auth / music / library / R2 | 31 + 18 + 23 + 12 = 84 项通过；与上行共 122 项专项检查，零失败、零跳过 |
| `npm test` | 整站测试链通过，含既有音乐生产候选检查 |
| `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` | 153 页及 postbuild 通过；此处允许缺失私有小说内容，**不能将这个 dist 用作生产包** |
| iOS 配套 | 前两轮定向 Swift 测试分别 59、94 项通过，最终 profile 10 项通过（各轮有重叠，不累计成独立用例数），配置生成器 4 项通过，四配置模拟器构建通过；实际 Info.plist 开关均为 NO、origin/profile 空 |

网站验证使用 Node 24.15.0、锁定的本地 Miniflare/workerd 与临时 D1/R2。所谓 production 请求，是向本机 Worker 分派正式 URL 的合成测试，不是正式 HTTPS、真实账号、线上音源或 Apple CDN 联调。iOS 使用本地 Xcode 27 beta 6 / iOS 26.4 模拟器；固定稳定 CI、真实签名与正式域名回跳尚未验证。这批尚未推送或取得远端 CI 结果。

## 候选与后续步骤

[`build-mobile-production-candidate.mjs`](../../scripts/build-mobile-production-candidate.mjs) 接受外置资源清单及 binding 清单，只创建权限为 0600 的新文件，所有原生及音乐开关关闭、origin/callback 为空、不含秘密。它继承既有音乐候选构建器，并不会保留线上音乐已激活状态，因此**不能直接用它覆盖现网部署配置**。发布前需对照真实配置、现有定时任务/队列/存储和此前生产差异，单独审查激活增量。

[`migration-rehearsal.md`](migration-rehearsal.md) 说明 37 份网站迁移与 5 份原生/marker 候选的内存预演。15 张新增表及 5 个显式索引未进入正式 `migrations/` 目录；reader/catalog marker 表仍为空，没有生成可自动执行的生产迁移。

下一批应先确定并核验真实生产资源、独立密钥及可回退迁移方案，在授权的真实快照预发副本上检查共存，再做正式身份的 HTTPS/AASA/系统回跳和真机验收。网站当前 observability 记录策略与隔离环境不同；启用前须验证平台请求日志不会泄露 code/state、grant 或凭据，仅不调用 console 不足以证明脱敏。生产销户和上架仍需补齐真实服务 adapter、政策、备份恢复和支持渠道；具体见 [`external-lifecycle-checklist.md`](external-lifecycle-checklist.md)。用户已完成的真机离线播放验收保留，不重复计为本批测试。
