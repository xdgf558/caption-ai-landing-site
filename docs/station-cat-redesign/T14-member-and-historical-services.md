# T14 会员与历史服务回归

本批在现有四语言 `/library/` 入口增加“温柔小站”会员壳，保留旧账号、积分、有限期会员、书柜/收藏、购买确认、两步验证、订单与售后。网页音乐收藏、本机游戏槽位、账号云存档和原生音乐资料库明确分开。没有修改价格、权益期限、退款或销户协议，没有代选主推或发行素材。交付停在 T14 独立 PR，需用户审查后才能进入 T15。

## 基线与开关

分支 `codex/station-cat-redesign-t14` 从实际 main `d2c7f6b4a759734286c1496bd042f673c49756de` 建立。T13 [PR #198](https://github.com/xdgf558/caption-ai-landing-site/pull/198) 审查头 `84fbf0ef4eab4ac9ec1b9df2f250c75b5482f222` 的 [CI 37745379135](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37745379135) 成功后于 2026-10-08 08:36:02 UTC（新加坡 16:36:02）squash 合并；[合并事实](T14-evidence/T13-merge-result.json)、[精确头 CI](T14-evidence/T13-approved-head-ci.json) 分别保存。

`STATION_MEMBER_PAGES_ENABLED` 默认未设置，只有 boolean true/string `true` 接管会员页。该入口是已有读者服务的展示壳，独立于音乐公开查询/页面开关，不需要先查询 MUSIC_DB。关闭态在检查方法和访问 ASSETS 之前返回 null，让原处理器继续服务；四语言原静态页未改为默认新壳。新 `/member/site-shell/{locale}/` 只是生成通用空模板，Worker 在开关两种状态都返回 404。新模板包含在构建中，但不包含账号、凭证或私有数据。

| 地址与方法 | 新开关开启 | 关闭或不匹配 |
| --- | --- | --- |
| GET/HEAD `/zh-hant/library/`、`/zh-hans/library/`、`/en/library/`、`/ja/library/` | 通用四语言新壳；私有数据由原接口取回 | null，原页面继续 |
| GET/HEAD `/library/` 及上述无斜线形式 | 301 到相应正式四语言入口，根入口默认繁中，保留原查询 | null，不提前占用旧地址 |
| 其他方法的会员页 | 405，Allow GET, HEAD | null，由原处理器决定 |
| `/member/site-shell/*` 与已识别语言前缀形式 | 404 | 同样 404 |
| ASSETS 缺失、超时、不合法通用模板 | 本语言 503 | 不读取绑定 |

页面始终 private,no-store / noindex,nofollow，禁止嵌入；canonical 在本机使用本机 origin，在非本机使用 `https://wwwstationcat.org`，只含规范路径。旧订单/重置 token 不进入元信息和语言切换。本机 canonical 不是正式索引验收。ASSETS 截止只停止等待，不取消已发出的服务请求。

## 服务与权限矩阵

下表是本机一次性 D1/R2 中实际 Worker 的 HTTP 合同回归，不是生产响应。账号均为合成资料：当前会员 GentleMember，历史购买者 ArchiveFriend（没有当前会员），到期账号 ExpiredFriend。历史购买者有一个小说权益、一个阅读书签和一个装扮权益；云存档 revision=4 仅为展示“存在”的小 JSON，不能启动游戏，不作为有效游戏存档或云同步证据。

| GET 服务 | 游客 | 当前会员 | 历史购买者 | 到期账号 |
| --- | --- | --- | --- | --- |
| `/api/readers/session` | 200 authenticated=false | 200 当前账号 | 200 当前账号 | 200 当前账号 |
| `/api/readers/credits` | 200 未登录 | 100 积分、当前会员 | 23 积分、没有会员 | 0 积分、没有当前会员 |
| `/api/novels/library` | 200 未登录 | 原会员、无单独小说购买 | 原小说购买 1 条、没有会员 | 无购买/当前会员 |
| `/api/readers/bookmarks` | 200 未登录 | 0 条 | 原阅读书签 1 条 | 0 条 |
| `/api/readers/totp/status` | 200 未登录 | 原状态 | 原状态 | 原状态 |
| `/api/readers/game-saves/cat-life` | 200 未登录 | save=null | 原账号 revision=4 元数据 | save=null |
| `/api/games/cat-life/entitlements` | 200 未登录 | 0 项 | 原装扮 1 项 | 0 项 |

完整响应形状、所属账号和权限断言可从 [实际运行时测试](../../scripts/test-station-member-runtime.mjs)、[原始专项日志](T14-evidence/member-tests.log)、[逐请求状态及缓存头](T14-evidence/http-contract.json) 复算。匿名接口沿用旧 200+authenticated=false 合同，不人为改为全体 401。历史小说/装扮购买访问原 `/api/music/me/capabilities?locale=en` 时依旧 `membershipStatus=none` / `canPlayVipFull=false`，不会产生音乐 VIP。

历史订单继续使用 `/api/novels/payments/order?order=<原订单凭据>`，不新增订单表或订单列表接口。原服务未绑定账号的旧打赏 token 允许游客查询；绑定账号的订单：游客 401、不同账号 403、原账号 200、未知 token 404。显示只投影金额、币种和交付/审核/退款/失败/到期状态，不返回支付地址、原 token 或内部 metadata。`refunded`/`credits_reversed` 优先于旧 `fulfillment.complete`，不根据订单显示发放任何权益。界面字段称“原订单编号”，实际需原服务可识别的订单 token；内部数字 ID 不替代凭据。输入不写本机键、浏览器地址、历史或新增统计；读取请求仍按原服务合同携带查询，不能因此声称网络/边缘访问日志匿名化。

四个旧 GET 入口（session、credits、bookmarks、novels/library）额外统一 private,no-store / noindex,nofollow / Vary:Cookie；原正文、状态和 Set-Cookie 保留。旧处理器抛出异常时返回安全 503 `READER_SERVICE_UNAVAILABLE`，不泄露 SQL/堆栈。这项 Worker 响应策略部署后不依赖会员页面开关；其他服务沿用原策略。读者 GET 仍可能更新原会话 last_seen_at、初始化既有积分账户，不宣称对 D1 全部 SELECT-only。

POST 登录/退出、密码/两步验证、会员兑换、购买确认及书签写入仍走原服务；NOWPayments/Creem 回调、原生 `/api/mobile`、AASA、销户关闭态和游戏运行路径没有改动。测试覆盖实际旧登录/退出 Cookie；没有发真实订单或商户请求，其他财务回归沿用仓库原测试。

## 本机与云端、会话边界

`stationcat.music.v2` 与 v1 回退只读现有 UUID 收藏/最近播放，展开后有界读取原公开歌曲标题；不发音频请求、不迁移 v1、不修复损坏值、不上传。v2 存在时不会用 v1 遮盖损坏；损坏或存储不可访问显示未确认，不伪装成 0 首。旧 UUID 分享入口继续通向实际可映射详情，待定/失效曲目显示可解释的不可用状态。原生 `/api/mobile/v1/me/music/*` 是 App 独立的账号资料库；本批保留并回归原生能力，没有据网页收藏声称已覆盖 App 收藏。

本机游戏检测复用 T12 `CatGameSaveStatus.inspect`，确认身份后只读游客槽位或该账号成员槽位；不执行 select、loadOrCreateGame、游客领用、云恢复或写回。区分缺失、损坏、不可访问、未来/不支持版本。云端只展示原 GET 返回的存在、revision、更新时间；是否有效、与本机是否一致继续交原游戏确认。入口保留 `/games/cat-life/` 实际运行地址，不替换成介绍路径。

新读取控制器与旧账号面板展示用 generation/账号 ID 防止迟到数据回写。服务卡在会话变化时 AbortController 取消等待中的读取，正文有大小/时间边界，异常不会变成空云档；旧主面板读取使用 epoch 忽略迟到响应，没有把所有旧请求改为可取消。跨标签页会话消息、storage、focus/bfcache 和显式重试会重新核对。当前 TOTP 原响应没有 account ID，只能按会话 epoch 防迟到，不能当成新的服务端所属证明。成功登录、退出和外部身份变化清空隐藏认证字段、QR/密钥、旧余额/书柜/订单状态与未完成支付确认。

所有进入会员的新壳入口用完整载入，包括导航/搜索/页脚、首页会员卡、游戏介绍和音乐拒绝提示，避免共享播放器和旧账号脚本留在同一 SPA 实例。音乐来源保留白名单公开 UUID 的 returnTo；登录后留在会员页，显式“返回音乐”才回原曲目。实测返回后 audio 保持暂停、没有 src；权限入口仍要求确认，未自动授权、续费或播放。会员页没有 audio/video/iframe。

这些保护是展示层：已经发出的财务/云写入不被撤销；Cookie 切换与服务端写入、本机比较与 setItem 仍不原子。T12 的生产云冲突与跨进程窗口、T13 退出等待一秒后移除 iframe 和同源无 sandbox 的 P2 边界继续保留。本批不修复游戏核心或写成存档/安全隔离验收通过。

## 验证与交付

新增 `test:redesign:member` 32 项（19 个模型/竞态/关闭态/响应策略 + 13 个实际 Worker 运行时用例）；最终 T14、音乐播放器、游戏保存/路由、游戏会话、原生音乐及独立原生资料库回归分别落盘。完整 npm test 含原会员、退款、支付、游戏、四语言等既有断言，通过记录保留原日志，不捏造统一测试总数。每份日志有真实命令、结束时间及 SHA-256；[验证摘要](T14-evidence/verification-summary.json) 与 [文件清单](T14-evidence/manifest.json) 保存实际源码和依赖锚点，可独立复算，不能代替 PR 精确头托管 CI。

在仓库根目录运行 `node docs/station-cat-redesign/tools/capture-member-verification.mjs --verify` 可逐字节核对已提交源码及原始证据；不需要原本临时日志，也不发请求。重跑功能验收应执行摘要中的真实 npm 命令，哈希核对本身不计新增测试。

主构建使用 `ALLOW_EMPTY_SERIAL_CONTENT=1` 和关闭遥测，产生 165 页，是开发构建而非生产包。独立会员预览使用自有配置/cache/output，12 个通用会员/音乐/游戏模板；首页预览单独核对修改的会员链接。旧 music staging 精确依赖增加 Astro 拆出的 `musicPlayerCore.<hash>.js`，不放宽 MemberServices、source map 或其他前缀；最终八页与 36 个资源核验。托管 CI 增加独立会员构建/测试，当前头结果需另外核对。

本机预览 `http://127.0.0.1:4214/zh-hant/library/`，场景控制 `http://127.0.0.1:4214/__fixture/`。监听 loopback，合成账号/密码/订单在控件页明确标注。账号场景使用原登录接口创建新本地会话，真实退出已撤销的会话不复活；不会转发未知生产 Cookie。预览只放行有限旧账号操作及读取，拒绝外站网络、商户下单、云 PUT/POST；数据库和 R2 一次性，未读取生产凭证或远程迁移。控件页和故障注入不进入生产页面/流程。

实际 IAB 检查四语言、1440/360 及当前会员 390 的宽度；手机仅视口模拟。真实本机登录/退出、书柜/安全、历史订单、退款、损坏/旧收藏、跨标签页旧余额迟到、服务失败/统一重试、音乐手动返回有 DOM/截图记录。[设计 QA](T14-evidence/design-qa.md) 保留同一输入中的原图/实现对照、手机退出修订；[原始观察](T14-evidence/browser-observations.json) 包含中间状态，最终成功以 final-confirmed-*、final-unified-retry-* 等条目为准，不把观察中失败/旧状态改写成通过。

A14/A19 仅本机合同、存储降级模型和界面范围完成。生产 D1/MUSIC_DB schema、真实历史账户/退款/会员、真实 R2/云冲突、真机、内置浏览器、VoiceOver、浏览器禁用存储、全套键盘和旧地址线上退出仍未验收。没有部署、启用任一生产开关、远程迁移、账号清理、关闭旧入口或开始 T15。
