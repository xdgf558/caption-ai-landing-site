# 关闭态候选的本地验收补充 · 2026-10-03

承接网站 #184 的关闭态合并。本批没有部署、远程迁移、写入生产 marker、开启原生功能、安装手机或上传 App Store。iOS 仍为 0.1.0 (4)，首版不售卖订阅。

## 链接覆盖

原 AASA 只声明 `/music/`，不能覆盖网站实际生成的其他语言音乐链接。现按已有页面和规范化路由精确声明十条正式音乐路径，R2 只声明两条根音乐路径；认证 callback 单独保留，不扩大到 `/*`。配套 iOS 解析相同路径并拒绝编码别名。详见 [链接合同](link-association-contract.md)。

两仓共享 74 条正反例，包含网站真实分享助手生成的四语歌曲／专辑地址，以及无效域、路径、query、编码和 callback。iOS 冷／暖测试调用真实 AppModel 初始化与链接选择逻辑，必须保持零授权和零音频请求。这些测试没有调用操作系统 Universal Link 投递。

## 新增跨仓测试入口

`scripts/helpers/mobile-production-fixture.mjs` 将真实 `src/worker.js` 打包到临时 Miniflare，应用完整网站、原生、音乐 schema 与候选 marker，创建合成普通/VIP 账号、两首合成 MP3 和混合专辑。正式 profile 的域名、PKCE、账号、权限和同步检查均走产品代码；请求仍在本机执行。内层 Worker 入口另需每次测试随机生成的内部 proof，防止绕过桥接直接调用调试端口。

`scripts/helpers/mobile-production-service.mjs` 仅监听随机 loopback 端口，对每次请求校验随机 proof、Host、路由、方法、header、编码、大小、请求总量和截止时间；临时目录 0700、ready 文件 0600。转发保留响应状态、Cookie 与 Location，但不跟随重定向。Worker 出站请求被拒绝，bootstrap 密码及认证响应不写入持久证据。

配套 iOS 使用真实 NativeAuthenticationService、NativeMusicAPI、AuthorizedMediaChannel、NativeLibraryAPI 和 ScopedLibrary；替身仅承担本地网络输送、自动填写授权表单和内存安全存储。测试涵盖 PKCE 登录、refresh、免费／VIP 授权、HEAD/Range、两会话资料同步、账号隔离、生产销户拒绝和退出撤销。测试用合成收听事件，不冒充实际播放五秒的证据。

iOS 新增独立 `backend-production-fixture.json`，固定本批网站 Git 提交、相关目录完整文件集合及逐文件 SHA256，启动前拒绝脏文件、缺失／新增依赖和共享矩阵差异。旧 recovery/media/library 三份依赖清单保持不变。最终固定版本运行结果由 iOS `evidence/production-local-summary.json` 记录；不同运行的旧成功报告须在启动时失效。

## 网站本地验证

| 检查 | 结果 |
| --- | --- |
| `npm run test:mobile:production` | 115 项 Node/Miniflare + 12 项 Python，通过；包含链接矩阵、原有生产防护及新增服务边界 |
| `npm run test:mobile:r2` | 12 项通过，覆盖隔离认证、权限、封面与入口 |
| `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` | 153 页和 postbuild 通过；缺少私有小说内容，此 dist 不能用于生产部署 |

工具链：Node 24.15.0，依赖为当前锁文件中的 Miniflare/workerd。网站测试不需要 Cloudflare 账号凭据。稳定 Xcode CI 与 PR 状态在提交审查时另行核对，不由本地结果推定。

## 仍需分别验收

- 跨仓实现兼容：本机真实 Worker 与 Swift 链路的证据，不能替代正式 HTTPS、真实资料和平台实际部署。
- AASA：路径合同已补齐；正式站点响应、Apple CDN、正式签名 entitlement 和实体机冷／暖链接投递仍待另行授权验收。
- 资源归属：见 [只读平台核验](resource-ownership-20261003.md)。身份 marker 仅防误绑，必须结合真实账号资源清单及当前 Worker 绑定；不能由 marker 内容推出所有权。
- 原生生产开关、订阅销售、生产销户与 App Store 发布继续关闭。独立密钥、恢复方案、外部销户 adapter、账务保留及备份政策等发布条件按原检查表继续推进。

用户先前完成的实体机离线播放验收保留，本批未要求重复。
