# Station Cat Music iOS 原生 App 完整开发文档

文档版本：v1.0.1（四项可靠性与安全规格修订）
编制日期：2026-09-15
文档状态：开发设计，可用于拆分任务；不代表代码已经实现、部署或通过苹果审核。
适用对象：产品负责人、Codex、iOS 开发、后端开发、测试与发布人员。
技术方向：SwiftUI 原生客户端，复用 Station Cat 账号、音乐后台与 R2 内容存储。

## 阅读导航

| 阅读目的 | 对应章节 |
|---|---|
| 确认产品范围、会员与老用户规则 | 第 0 至 4 节 |
| 实现架构、页面和原生播放 | 第 5 至 7 节 |
| 实现账号、媒体授权和个人数据 | 第 8 至 10 节 |
| 对齐数据结构与 API | 第 11 至 12 节 |
| 后续实现音乐包月 | 第 13 至 14 节 |
| 处理网站兼容、安全与审核 | 第 15 至 17 节 |
| 性能、测试及分阶段交付 | 第 18 至 20 节 |
| 发布、执行规则和资料依据 | 第 21 至 26 节 |

## 0. 阅读约定与已冻结决策

本文是主开发规格。文中的“必须”属于验收要求；“默认”属于本方案选定的工程方案，可通过书面变更调整；“待核验”表示尚未具备足够证据。所有性能数值、缓存上限、会话期限和测试数量均为设计目标，不属于现网实测数据。

### 0.1 已确定的产品决策

| 编号 | 决策 |
|---|---|
| D01 | 使用 SwiftUI 开发真正的 iOS 原生音乐客户端，不采用 Capacitor 或整站 WebView 套壳。 |
| D02 | 网站和 App 使用同一 Station Cat 用户账号及用户 ID，老用户无需重新注册。 |
| D03 | 音乐 VIP 与全站 VIP 为不同产品。约 1 美元/月只购买音乐权益。 |
| D04 | 全站 VIP 继续保留目前已公布的音乐权益，保护已有付费用户。 |
| D05 | 音乐 VIP 在网站音乐频道和 iOS App 互通；不授予小说、软件、游戏、积分等其他权益。 |
| D06 | 首版发布原生听歌与已有会员使用能力；苹果音乐包月放在后续版本实施。 |
| D07 | 后续音乐包月使用 StoreKit 2 自动续费订阅，付款后直接开通音乐 VIP，不经过积分兑换。 |
| D08 | 后台集中计算权益，客户端不自行计算会员资格或修改到期时间。 |
| D09 | 歌曲、专辑、歌词、封面继续从现有后台发布，客户端不内置整个曲库。 |
| D10 | 首版不开放第三方结账、积分充值、全站 VIP 购买或外部购买引导。 |

### 0.2 本文选定的默认值

产品名称暂用 **Station Cat Music**。部署目标默认 **iOS 18.0 及以上**，首发仅承诺 iPhone 体验。该最低系统版本是产品选择；构建 SDK 必须满足实际送审时的要求。苹果目前列明，自 2026-04-28 起上传需使用 Xcode 26 或更高版本及对应的新 SDK；开始开发和送审前都应重新核对。[S01]

音乐包月的美区候选价格为 **US$0.99/月**，符合“约 1 美元”的意图。最终价格由产品负责人在 App Store Connect 确认，App 使用 StoreKit 返回的本地化价格，不写死美元价格或自行换汇。默认不提供免费试用、年付、家庭共享、优惠码和带年度承诺的按月付款产品。

首版保留简体中文、繁体中文、英文、日文四种界面语言。翻译缺失回退至英文；歌曲原文和歌词不自动翻译。视觉延续现有深色猫咪品牌，使用原生控件重新实现。

### 0.3 尚未确认的事项

尚未核验开发者账号和协议状态、Bundle ID 可用性、实际生产发布包、全部数据库迁移、完整认证实现、曲目逐项商业授权、目标上架国家与地区、真实听歌负载、Apple 内购商品配置以及实体 iPhone 表现。没有这些信息也可以完成本地架构与接口设计，正式发布必须关闭相关待办。

本文的仓库基线是读取到的 `xdgf558/caption-ai-landing-site` 主线提交：

```text
f0537685bc6f90df437997ee6a885a63fe03b037
```

该提交属于代码参考基线。不要将 GitHub 主线与用户电脑的未提交修改、生产 Worker 发布包视为同一版本。[R01]

### 0.4 本次修订及执行优先级

本文 v1.0.1 替代主开发文档 v1.0。**文档版本与 App 版本分别管理：App 首发仍为 v1.0，音乐订阅仍安排在 App v1.1。**产品范围、统一账号、独立音乐 VIP 和全站 VIP 的现有音乐权益均不改变。

| 规格问题 | 本次冻结的处理方式 | 关联章节 |
|---|---|---|
| 只凭媒体 URL 无法验证实际请求者 | VIP 完整媒体必须同时携带独立的移动会话 Bearer；逐次比对账号及会话。URL 单独转发无效，不承诺完整凭据泄露后仍无法重放。 | 7、8.4、9、11、12、19、20 |
| 到期后验证超时或 503 的播放行为缺失 | 引入明确的播放硬截止与保守单调时钟换算；超时不延长授权，到点暂停且清理受保护播放源，恢复验证后仍等待用户主动播放。 | 4.4、7、9.4、12.3 至 12.5、19 |
| 删除确认成功但回执响应丢失 | 先准备删除并保存查询凭据，再发送明确确认；查询凭据独立于已撤销登录会话，重启可恢复查询。 | 8.5、11、12.2、12.8、16.3、19、20 |
| 刷新中途结束 App 后丢失 requestId | 发送前持久化同一刷新操作；令牌与待处理操作单记录原子切换；短期轮换结果与不含可用令牌的去重元数据分开保存。 | 8.3、11、12.5、12.7、19、20 |

这四项均为 v1.0 的 P0。启动指令必须使用对应 v1.0.1 文件。不能一边实施旧的单凭 URL 或删除后才返回查询凭据的流程，一边只在测试文档写新版预期。

本次修订以原文及四项审查意见为依据；没有重新读取最新仓库、检查生产数据库或执行 iOS/服务端业务测试。第 2 节和 [R01] 至 [R07] 保留原文的历史代码核验范围。第 25 节新增安全参考资料；所有新增时限和重试数值属于本项目设计值。

## 1. 项目目标与成功标准

### 1.1 产品目标

让听众通过 iPhone 持续收听 Station Cat 的音乐作品，获得锁屏、后台、耳机控制、收藏和最近播放等完整体验；为后续独立音乐订阅和听众创作反馈预留清晰接口。

原生 App 应服务于日常听歌。首版导航只围绕发现、曲库和我的，不搬入软件商城、游戏、小说阅读或全站积分中心。

### 1.2 首版完成标准

首版必须在真实 iPhone 上完成以下闭环：游客浏览和听免费歌；既有账号登录；全站 VIP 完整播放 VIP 曲目；普通用户只取得独立试听资源；锁屏和切换应用继续播放；耳机、控制中心与 App 状态一致；退出、账号限制及会员到期后正确执行权限；收藏与最近播放可保存；用户能发起账号删除。

程序成功编译、模拟器截图、网页移动端预览、Mock 数据播放均不足以证明上述闭环已经完成。

### 1.3 后续音乐订阅完成标准

有效的苹果订阅仅产生 `music.full_playback` 权限。网站音乐频道与 App 都能识别；小说接口仍拒绝仅有音乐 VIP 的用户。购买、续费、取消后到期、退款、恢复购买、账号冲突、网络失败、重复通知及漏通知均有经过测试的处理流程。

## 2. 现有系统核验与复用边界

### 2.1 本次核验结果

| 参考文件 | 已确认的代码事实 | 对本项目的影响 |
|---|---|---|
| `src/music/publicHttp.js` | 存在曲库、歌曲、合集、封面、歌词、播放资格及用户能力路由。 | 可以复用内容和投影逻辑；新增移动端版本化适配。 |
| `src/music/catalog.js` | 输出歌曲 ID、版本、时长、歌词格式、试听信息、动态访问策略等；完整音频目前为 MP3。 | 首版按现有格式接入，不同时引入新转码系统。 |
| `src/music/membership.js` | 从 `station_cat_reader_session` Cookie 读取会话，关联 `reader_accounts`、`reader_sessions` 和 `reader_memberships`。 | 统一账号有基础；原生设备会话仍需新增。 |
| `src/music/access.js` | 免费、试听、VIP 开关、账号状态和会员有效性参与服务端访问决策。 | 新增音乐权益应接入公共决策层，不能绕过旧规则。 |
| `src/music/mediaResponse.js` | 音频读取前鉴权；支持 GET/HEAD、Range、206/416、If-Range；查询参数只接受规定的 `v` 和 `variant`。 | 保留分段传输；不能在旧 URL 随意追加 token；新增受限的原生媒体入口。 |
| `src/data/reader-library-client.js` | 存在四语会员中心路径、密码及二步验证相关错误提示，并包含积分和付款相关界面信息。 | App 登录页应为专用认证流程，不能直接加载完整会员中心。 |

依据：[R02] 至 [R07]。读取到的客户端提示不能证明所有认证服务端行为已完成核验。

### 2.2 保留项

保留原有用户 ID、账号密码验证逻辑、账号限制、现有积分余额及交易账本、全站 VIP 记录、现有支付回调、曲目发布生命周期、免费时段与抢先听策略、独立试听文件、生产资源绑定、现有网站 UI 与开关行为。

不得借 iOS 项目批量改名 `reader_*` 表、迁移全部用户、修改老用户密码算法参数、替换 Creem 配置、重建音乐数据库或统一重构 `worker.js`。确有必要的修改必须单独提交并证明兼容性。

### 2.3 必须新增的能力

移动端认证与设备会话；细分权益计算；版本化移动端接口；原生媒体授权适配；收藏及历史的共享数据接口；账号删除的完整实现；原生客户端；后续 StoreKit 服务及苹果交易账本。

若仓库最新版本已经实现其中某项，M0 核验后复用，禁止创建平行的第二套实现。

## 3. 版本范围

### 3.1 v1.0：原生音乐客户端

必须包含：发现页、曲库和搜索、专辑/官方歌单、歌曲详情、完整播放器、迷你播放器、队列、循环和随机、锁屏与后台播放、耳机控制、歌词显示、睡眠定时、收藏、最近播放、统一账号、会员状态、设置、隐私与条款、清除本地缓存、发起账号删除、音乐链接分享与深链。

网站只需增加共享权益和必要的同步适配，不再进行视觉重构。音乐评分暂不列入首版验收；现有评分能力如已经上线，保留其兼容性。

v1.0 不展示包月价格、未上线购买按钮或“即将支持离线”等未交付承诺。内部测试可以使用隔离环境的音乐权益测试数据，生产环境不得提供普通用户可调用的赠送接口。

### 3.2 v1.1：独立音乐 VIP 包月

增加一个音乐月付商品、原生订阅页、购买和恢复、订阅管理、服务端验签、通知与补偿对账、网站音乐权益同步、账号绑定冲突处理、退款处理及付费指标。上线后即使暂停新购买，也必须继续提供已有付费权益、恢复和订阅管理。

### 3.3 后续独立版本

听众评分与反馈、用户自建歌单、离线下载、其他音质、CarPlay、Apple Watch、iPad/Mac 专门布局、Android、年付与优惠功能分别立项。不得把这些事项作为 v1.0 的隐含依赖。

## 4. 账号、产品与权益模型

### 4.1 统一身份，独立产品

账号身份以现有数据库用户 ID 为准。App API 中将其编码为不含隐私的字符串，不用邮箱充当长期主键。Apple Account、Station Cat 账号、设备会话是三种不同概念，界面及日志必须区分。

| 身份或有效产品 | 免费歌曲 | VIP 歌曲试听 | VIP 完整音乐 | 小说等权益 | 赠送积分 |
|---|---|---|---|---|---|
| 游客 | 可听 | 资源存在时可听 | 不可听 | 按现有规则 | 无 |
| 普通已登录账号 | 可听 | 资源存在时可听 | 不可听 | 按现有规则 | 无 |
| 音乐 VIP | 可听 | 可听 | 可听 | 不额外授予 | 无 |
| 全站 VIP | 可听 | 可听 | 继续包含 | 按已公布范围与开关 | 不因本项目改变 |
| 音乐 VIP 和全站 VIP 同时有效 | 可听 | 可听 | 可听，来源可同时存在 | 按全站 VIP 规则 | 不因本项目改变 |

会员权益不凌驾于账号封禁、内容下架、版权撤回、系统停服等限制之上。

### 4.2 权益键

```text
music.full_playback
novels.vip_read
```

首版只让新的权益聚合层计算音乐权限；小说付费访问继续由旧的全站 VIP 和逐章授权规则判断。只有后续经过专项迁移后，小说才可改为读取统一权益键。

必须禁止如下实现：音乐订阅成功后写 `reader_memberships.membership_level = 'member'`；把音乐 VIP 到期时间写入全站会员到期字段；用一个全局 `isVIP` 布尔值放开所有产品。

### 4.3 权益计算规则

```text
身份已认证，账号处于 active：
  来源 A = 当前有效的全站 VIP，且按现有规则覆盖音乐
  来源 B = 当前有效的独立音乐订阅期间
  音乐完整播放权益 = 来源 A 或来源 B

某首歌可以完整播放：
  歌曲已发布且当前可用，并且
  当前生效策略为免费，或者
  VIP 分发开关允许且账号具有音乐完整播放权益
```

实际实现必须继续沿用曲目 `effectiveAccess`、`audioVersion`、`nextPolicyChangeAt` 等既有规则，不在 App 端把抢先听、限时免费、下架时间重新计算一遍。[R03][R05]

时间采用服务端 UTC。有效区间为 `startsAt <= now < endsAt`。不同来源不相互累加时长，不把未来尚未开始的订阅期间提前当作有效。当前音乐访问有效期按覆盖当前时点的连续有效区间合并计算；在实现初期可以选择更早重新验证，不能越过权益空档放行。

### 4.4 多来源的撤销

| 变化 | 处理 |
|---|---|
| 音乐订阅到期，全站 VIP 有效 | 音乐保持可用，订阅状态显示已到期。 |
| 全站 VIP 到期，音乐订阅有效 | 音乐保持可用，小说回到原规则。 |
| 一笔苹果交易退款 | 撤销相应交易产生的音乐授权，不删除其他有效来源。 |
| 取消苹果自动续费 | 保留已付费期间的权益，到期后再判断。 |
| 账号被限制或删除 | 停止账号关联权限；保留按政策必须保存的最小交易记录。 |
| 权益查询失败 | 不改变会员事实、不新增授权；已有当前曲目仅可在最后验证的播放硬截止之前继续，到点进入 verificationRequired 并暂停。明确拒绝优先立即停止，详见第 9.4 节。 |

### 4.5 重复购买策略

已有全站 VIP 且没有独立音乐订阅的用户：订阅页展示“全站 VIP 已包含音乐权益”，不主动提供新增音乐包月购买操作。已有音乐订阅的用户始终可以查看状态和管理续费，即使后来又取得全站 VIP。

用户后来从网站购买全站 VIP 时，应提示可能与苹果音乐包月重叠；不得声称后台会自动取消苹果续费。首版不做跨渠道折算、自动延长、自动退款或抵扣。收到来自 App Store 订阅管理页的合法新交易，仍须正常验证、记录和处理，不能只靠隐藏 App 内按钮假设重叠永远不会发生。

## 5. 总体技术架构

### 5.1 模块分工

| 层 | 责任 |
|---|---|
| SwiftUI 界面 | 页面布局、导航、无障碍、加载与错误展示。 |
| Feature 状态层 | 发现、曲库、账号、音乐库和订阅等页面的可测试状态。 |
| PlaybackService | 全 App 唯一播放实例、队列、进度、切歌与系统音频状态。 |
| AuthService | 浏览器认证回调、设备会话、令牌刷新、退出与失效传播。 |
| EntitlementService | 获取和缓存服务端权益快照，不自行授予权限。 |
| MusicRepository / LibraryRepository | API 请求、DTO 映射、缓存、同步与数据隔离。 |
| StoreService | v1.1 的商品、购买、交易监听、恢复及结果提交。 |
| 现有 Worker 内的新增适配层 | 校验请求、解析身份、调用原有音乐与新的权益服务。 |
| D1 / 现有数据库 | 用户、会员、会话、音乐元数据、新增同步和交易数据。 |
| 私有 R2 | 现有音频及相关资源；完整付费音频不开放匿名桶 URL。 |

第一版不新建微服务集群，不引入第三方订阅聚合平台，不复制身份数据库。苹果验签模块在 v1.1 前先验证与 Workers 运行时的兼容性；仅当官方库确有未解决的运行时阻碍时，再独立部署最小验签服务，并保持后台权益为唯一权威。Cloudflare 提供 Node.js 兼容能力，但具体库与证书验证流程仍需实际测试。[S12]

### 5.2 iOS 技术选型

Swift、SwiftUI、Observation、Swift Concurrency、URLSession、AVFoundation、MediaPlayer、AuthenticationServices、Security/Keychain、StoreKit 2。持久化默认使用 SwiftData 保存非敏感缓存与个人同步队列，不用 iCloud 同步代替站点账号同步。

播放服务与 UI 状态在明确的主执行域更新；网络、解析和存储任务与 UI 分离。启用严格并发检查，避免用未说明原因的 `@unchecked Sendable` 掩盖数据竞争。不将 AVPlayer 跨执行域随意传递。依赖优先使用苹果框架，第三方依赖必须锁定版本并记录许可证。

### 5.3 仓库组织

默认新增独立 iOS 仓库 `station-cat-music-ios`，名称待实际创建确认；现有网站仓库只承载后端、共享网页适配和契约修改。本次文档交付不创建任何远端仓库。

```text
StationCatMusic/
  App/
  Features/
    Discover/
    Catalog/
    Album/
    Player/
    Library/
    Account/
    Subscription/
    Settings/
  Core/
    API/
    Auth/
    Entitlements/
    Playback/
    Persistence/
    Diagnostics/
  DesignSystem/
  Resources/
  Tests/
  UITests/
  Config/
docs/
  api-contract/
  decisions/
  testing/
  release/
```

现有仓库建议新增 `src/mobile/`、`src/entitlements/`，v1.1 再增加 `src/appleSubscriptions/`。遵守仓库现有目录约定；不要为对齐本文目录批量移动已有音乐模块。

## 6. 页面与交互规格

### 6.1 全局规则

底部三个导航入口为“发现、曲库、我的”。播放后出现迷你播放器，位于底部导航上方；点击展开全屏播放器。切换标签、进入账号页或查看条款不重建播放器。应用冷启动、登录成功或收到深链都不自动发声，播放需由用户操作触发。

视觉采用深色背景、低密度排版、封面主体和暖色强调色；使用语义化设计令牌。按钮默认有效点击区域不小于 44pt，此处作为项目设计要求。动态字体、VoiceOver、降低动态效果和高对比度必须测试。价格与权限不可仅靠颜色表达。

### 6.2 页面清单

| 页面 | 必须内容与行为 | 错误或空状态 |
|---|---|---|
| 发现 | 后台精选、近期发布、专辑入口；不使用假推荐数量。 | 无精选时显示最新曲目；失败可重试。 |
| 曲库 | 曲名、艺名、封面、时长、当前免费/音乐 VIP 标记；搜索和基础筛选。 | 无结果与网络失败分开提示。 |
| 专辑/官方歌单 | 封面、简介、曲序、逐首播放、播放全部。 | 下架歌曲不可播放；全部不可用时停止。 |
| 歌曲详情 | 曲目信息、创作说明、歌词入口、收藏、分享。 | 缺少简介或歌词时自然省略。 |
| 全屏播放器 | 封面、标题、艺名、进度、播放控制、循环、随机、队列、歌词、定时。 | 试听明确标识；权限变化不静默跳回开头。 |
| 队列 | 当前和后续歌曲，可移除未播放项；支持清空后续。 | 空队列不崩溃，不无限寻找下一首。 |
| 我的 | 收藏、最近播放、账号和音乐权益卡片、设置。 | 游客显示本机数据及可选登录。 |
| 登录 | 系统认证窗口，登录现有账号或按现有规则注册。 | 取消返回原页面，不当成错误反复弹窗。 |
| 账号 | 昵称或脱敏账号、全站 VIP 与音乐 VIP 分项状态、退出。 | 网络失败保留可辨识的旧状态和更新时间。 |
| 设置 | 语言、移动网络播放、缓存大小和清除、历史开关、条款、隐私、支持、删除账号。 | 删除账号与清缓存分开。 |
| 音乐订阅 v1.1 | 当前权益、真实月价、购买/恢复、管理续费、条款。 | 商品加载失败不展示假价格或可点付款按钮。 |

### 6.3 搜索与排序

首版按曲名、艺名、已有标签进行搜索，不接入 AI 搜索。新移动端列表接口支持关键词、类型及游标；中文搜索默认精确包含与基础标准化，不承诺拼音或错别字纠正。默认排序为发布时间倒序，再以 ID 稳定排序。

输入停止约 300ms 后触发搜索，取消旧任务，迟到结果不能覆盖新查询。无网络时允许搜索已缓存的有限曲库，并明确显示“仅搜索本机缓存”。

### 6.4 歌词

现有内容包含 TXT/LRC 信息，首版兼容两种格式。[R03] TXT 显示静态文本；LRC 解析合法时间戳、同一行多个时间戳和可识别的偏移信息。坏行忽略，严重解析失败回退纯文本。对大小和行数设上限，禁止将歌词当 HTML 执行。

试听文件可能截取歌曲中段。歌词高亮必须使用 `previewSourceStartSec` 与实际试听进度换算，不能直接把试听第 5 秒当成完整曲目的第 5 秒。没有授权的完整音频 URL 不得为歌词拖动而请求。

### 6.5 睡眠定时

提供关闭、15/30/60 分钟及“本首结束”。使用单调时钟计算倒计时；更改系统时间不改变剩余时长。到点暂停且取消自动切下一首，清晰显示已停止。暂停时定时器默认继续倒计时，界面在设置时说明。App 被强制结束后不承诺继续运行定时器。

## 7. 原生播放服务

### 7.1 播放状态

```text
idle
loading
playing
paused
buffering
interrupted
ended
permissionDenied
verificationRequired
failed
```

状态附带当前曲目 ID、媒体版本、完整/试听变体、播放位置、队列位置、循环方式、随机顺序、`playbackValidUntil`、对应的本机连续单调时钟截止点、`authorizationSequence` 和用户播放意图。`permissionDenied` 表示已获得可信拒绝；`verificationRequired` 表示原授权已结束且尚未取得新授权，不等同于会员已过期。不能仅用 `isPlaying` 推断音频是否真的输出。

### 7.2 播放请求过程

用户点播放后，客户端取得歌曲最新状态和播放授权；只有收到允许的授权结果，才建立 AVPlayerItem。授权失败不能先加载完整文件再用前端暂停伪装试听。

公共歌曲和独立试听可以走现有匿名媒体路径；VIP 完整播放使用第 9 节的专用资源加载器和“grant + Bearer”入口。两类入口最终共用内容有效性、版本和权限检查。[R05][R06] 匿名完整曲目的限时免费边界也受第 9.4 节约束，不能通过旧 URL 或预缓冲绕过已知策略截止。

一次用户操作对应一个播放请求标识。用户连续点选 A、B 两首时，A 的迟到网络结果不能覆盖 B；旧下载、歌词加载与封面任务都要可取消或忽略。授权结果还必须匹配当前 accountScope、sessionId、playbackRequestId 和授权操作序号；账号切换、删除、明确拒绝或硬截止后，旧回调不得重新启动音频。

### 7.3 队列行为

默认顺序播放，支持列表循环和单曲循环。随机播放维护实际随机队列，返回上一首时回到上一首真实播放记录；切换随机开关不跳走当前曲目。队列去重与保留重复曲目的规则由操作决定，首版“播放专辑”按专辑顺序逐项进入。

普通用户在混合列表中可以播放明确标识的试听。试听资源不存在或曲目下架时跳过并提示原因。一次连续跳过最多检查当前队列长度，全部不可用则停止，不无限请求。

播放到达最后已验证的硬截止时，立即暂停并取消受保护媒体加载、移除 AVPlayerItem 和可控缓冲；不等待权限查询返回。查询超时、断网或 503 时显示“暂时无法确认播放权限”，不继续沿用旧授权；服务端明确拒绝则显示对应原因。保留公开曲名和进度。恢复权益后等待用户再次播放，不自动出声。完整状态表见第 9.4 节。

### 7.4 系统集成

音频会话采用适合媒体播放的配置，启用音频后台能力。锁屏与切换应用下播放属于明确支持目标。[S02]

通过 Now Playing 和 Remote Command 维护标题、艺名、封面、时长、已播放时间和速率，响应播放、暂停、切歌及进度跳转。[S03] 系统显示与 App 内状态来自同一 PlaybackService。退出或清空播放内容时清除系统展示。

耳机断开默认暂停，不自动转为扬声器继续播放。来电或其他系统中断期间保存用户意图；中断结束仅在系统允许恢复、用户此前在播放且期间未手动暂停时尝试恢复。发生媒体服务重置时重建播放器依赖，保留可恢复状态。

支持经真机验证的系统 AirPlay 音频输出选择，不请求 Apple Music 曲库权限。受保护曲目只允许保持第 9 节认证约束的输出路径；不得为让接收端直接拉流而移除 Bearer 或生成匿名付费音频 URL。M0/M4 必须验证资源加载器与音频路由兼容性；无法验证的路径不得标为已支持。独立 CarPlay 界面与手表播放不在首版内。

### 7.5 缓冲、网络与重试

媒体失败后先区分网络错误、访问令牌过期、grant 截止、明确撤销、内容版本变化与下架。访问令牌过期按第 8.3 节恢复同一刷新操作，各媒体请求最多重放一次；grant 过期必须重新取得播放授权。任何重试均不得越过第 9.4 节的暂停规则。429 尊重 `Retry-After`；普通可重试错误采用有上限的指数退避与抖动。连续失败转为用户可操作的重试状态。

不能因网络断开，将下载过的完整音频自动变成离线 VIP 功能。断网时当前已获授权曲目的现有缓冲只可在最后已验证的硬截止之前使用；到点必须暂停并清理可控播放源。第一版不实现 DRM，系统音频管线残余数据和已经交付的字节存在无法远程收回的边界；不能把这个边界解释成允许 App 忽略截止继续播完整首。对 URL 单独转发的防护与完整凭据泄露的限制，见第 9.5 节。

### 7.6 播放验收重点

至少覆盖长时间锁屏、来电、中断恢复、蓝牙耳机断连、控制中心快速连续操作、Wi-Fi 与蜂窝切换、会员临近到期、播放期间下架、连续拖动、歌词错位以及 App 重启。实体 iPhone 测试结果必须单独留档。

## 8. 统一认证与设备会话

### 8.1 首版选定的登录路径

使用 `ASWebAuthenticationSession` 打开站点的专用移动端认证页，继续使用既有账号、注册、密码及适用的二步验证规则；完成后通过一次性授权码回到 App，并交换移动端凭据。系统认证窗口只承担身份认证，音乐界面保持原生。

采用外部用户代理、授权码和 PKCE S256 的安全原则，避免在 App 内复制密码验证与重置逻辑，也不在安装包内保存客户端密钥。[S04] 此处是第一方客户端认证设计；未经完整协议实现与测试，不宣称提供通用 OAuth 身份服务。

专用认证页仅包含登录、必要注册/找回、二步验证、条款和隐私，不显示积分购买、Creem 入口、全站导航或推广。不能用 User-Agent 或审核账号临时隐藏购买入口，真实用户与审核人员访问相同认证产品。

### 8.2 授权码流程

1. App 生成高熵 `state`、PKCE verifier 和 S256 challenge，保存在当前认证任务中。
2. 打开 `/auth/mobile/authorize`，携带固定客户端 ID、精确回调地址、state 和 challenge。
3. 服务器按既有规则完成账号验证与所需校验，创建绑定账号、客户端、回调和 challenge 的一次性授权码。
4. 使用已验证域名的 HTTPS 回调回到 App；只返回 code 和 state，不返回密码、长期 Cookie 或刷新令牌。
5. App 校验 state 和回调来源，将 code、verifier、clientId、redirectUri 发送至令牌交换端点。
6. 服务器原子消费授权码，为该账号建立独立移动端会话，返回 access token 与 refresh token。
7. App 获取 `/me` 和 `/me/entitlements`，刷新界面，不自动播放音乐。

授权码默认 90 秒有效、单次使用、服务器仅存哈希。交换失败或用户取消后清理本次认证上下文。回调地址必须精确白名单匹配，不允许任意 `returnUrl`、开放重定向或用户指定域名。PKCE 缺失、错误或降级都拒绝。

HTTPS 回调、Associated Domains 与 AASA 的真机闭环是 M0 技术验证项。回调域名默认 `wwwstationcat.org`，最终路径需确认无既有冲突。无法验证时不得宣称单点登录完成。

### 8.3 移动会话与可恢复刷新

#### 8.3.1 会话和持久化对象

| 项目 | 默认设计 |
|---|---|
| Access token | 不透明随机令牌，15 分钟；服务器保存哈希，App 默认只保存在内存。 |
| Refresh token | 不透明随机令牌；闲置 30 天失效，绝对最长 90 天；每次新的逻辑刷新轮换一次。 |
| 本机保存 | 用单个 Keychain 记录保存当前 refresh token、generation 和 pendingRefresh；采用 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`，不加入云同步。 |
| 服务端关联 | 绑定 accountId、稳定 sessionId、客户端类型、tokenFamilyId、generation、到期及撤销信息。刷新不改变 sessionId。 |
| 重置或封禁 | 统一撤销相关网站和移动会话，并使其旧媒体 grant 不再可用。 |
| 设备信息 | 只保存粗粒度可识别设备标签，不采集设备指纹或 IMEI。 |

Keychain 的上述保护等级适合首次解锁后的后台访问；设备重启后尚未首次解锁时仍可能无法读取。[S19] 读取失败必须区分临时受保护、真正不存在与损坏，不能把暂不可读当作空记录并立即创建新刷新操作。

持久化逻辑对象 `NativeCredentialEnvelope` 至少包含：`schemaVersion`、environment、accountId、sessionId、tokenFamilyId、generation、currentRefreshToken、refreshExpiresAt、absoluteExpiresAt、`pendingRefresh`。pendingRefresh 含 `refreshRequestId`、oldGeneration、canonicalRequestDigest、createdAt 和状态 prepared。当前旧 refresh token 已在同一 envelope 中，不另存一份明文副本。

#### 8.3.2 发送前保存，成功后原子替换

同一会话的刷新由一个 AuthService actor 单飞串行执行。所有页面、播放器及后台调用都必须复用它；不得各自刷新。首次版本不允许多个扩展进程共同写该 Keychain 记录，未来增加扩展须先设计跨进程协调。

1. 读取并验证当前 envelope。若已有 pendingRefresh，恢复该操作，不产生新 ID。
2. 没有 pending 时，为当前 generation 生成随机唯一 `refreshRequestId`，将 pending 与旧令牌作为同一个 Keychain item 更新，确认写入成功后才允许发送 HTTP 请求。
3. 请求体由持久化数据重建；网络超时、任务取消、进入后台、进程被结束，都保留同一 ID、同一旧令牌、同一 generation 和同一业务请求内容。
4. 响应必须匹配当前账号作用域、sessionId、requestId，且 nextGeneration 等于 oldGeneration + 1。不能仅以 HTTP 200 判断可接收。
5. 通过一次单记录替换，把新 refresh token、nextGeneration、有效期和 `pendingRefresh = null` 一并写入 Keychain。不得先删 pending、先删旧令牌或先向内存发布新 access token。
6. 确认持久化成功后才向等待者发布新 access token，并让原业务请求最多重放一次。写入失败保留旧 envelope，进入持久化故障状态，不启动下一代刷新。

崩溃恢复必须只能观察到两种完整状态：旧令牌 + 原 pending，或新令牌 + 无 pending。若实际持久化无法达到这个目标，应先修复存储协议，不能靠 `UserDefaults` 标记或进程内变量补救。Keychain 单记录写入、应用终止边界及失败码必须在 M2 验证，不能把跨多个 item 的顺序写入当作原子操作。

#### 8.3.3 服务端幂等、轮换与重放分流

默认把同一次已提交轮换结果加密保留 **120 秒**，从第一次成功提交开始计算，重复请求不续期。此值替代旧文档的 30 秒；它是项目恢复窗口，不是协议标准。凭据和原始有效期保持不变，响应外层的 requestId/serverNow 可反映本次传输。

服务端以经过哈希验证的旧 refresh token 定位会话和 generation，以 `(familyId, oldGeneration, refreshRequestId, canonicalRequestDigest)` 定位同一次逻辑操作。不得信任客户端单独传来的 familyId/accountId 撤销任意会话。

| 请求情形 | 处理 |
|---|---|
| 当前有效 generation 的首次合法操作 | 原子轮换至下一代，同时提交操作元数据和加密结果；成功提交后才返回。 |
| 同一旧 token、同一 ID、同一请求，120 秒内且下一代仍为当前代 | 返回原 token 对和原有效期，不再次轮换，不撤销家族。 |
| 同一操作，120 秒结果窗口已结束 | 返回 `409 REFRESH_RECOVERY_EXPIRED`；不返回旧结果，不产生新 token，不将此操作误判为盗用。App 重新认证。 |
| 同一操作，但会话已推进到更高代 | 返回 `409 REFRESH_RESULT_SUPERSEDED`，不倒退、不重新返回过时凭据、不自动撤销。App 无本地可信新代时重新认证。 |
| 同一 requestId 的请求内容/绑定冲突 | `409 REFRESH_IDEMPOTENCY_MISMATCH`，不交付凭据。 |
| 已消费旧 token 以另一个 requestId 出现 | 作为重放处理，撤销该会话家族并返回 `401 REFRESH_REUSE_DETECTED`。 |
| 不认识的 token，或账号/家族已撤销、删除、过期 | 拒绝；不返回短期缓存结果，不改变不相关会话。 |

并发轮换使用数据库原子条件更新及唯一约束。会话推进、消费旧 token、记录 operation、保存加密响应必须同成同败。不能依赖 Worker 进程内锁；也不能把一次影响零行的条件更新当成异常后假设后续写入已回滚。M0/M2 要证明实际存储方案在冲突和部分写失败下正确。

**加密响应与幂等墓碑分开清理。**响应到期删除密文，仍保留旧 token 哈希、family/generation、requestId、请求摘要和提交状态，最迟到原家族绝对期限后按安全保留政策清理。只有这样，超过 120 秒的同一操作才能被识别为恢复窗口结束。墓碑不保存可使用的原始 token。账号撤销时立即停止任何结果重放；加密密钥轮换期间也要明确旧结果的恢复或重新登录行为。

RFC 9700 给出刷新令牌轮换和重放检测原则；本项目的 crash journal、幂等窗口和错误码是具体工程选择。[S18] requestId 只用于标识操作，不是持有证明；旧 token 与同一 ID 一同泄露时，窗口内仍有被重放的风险。不能把轮换宣传为绝对防盗。

#### 8.3.4 启动、超时与迟到响应

冷启动必须先恢复 pendingRefresh，再允许发起需要刷新的其他请求。无 pending 时才可为当前令牌建立下一次操作。HTTP 超时或 503 保留 pending，默认以 2/4/8 秒带抖动重试，一轮最多 3 次；后续网络恢复或用户重试仍使用相同 ID，不为了重试生成新 ID。

超过 120 秒不代表旧请求一定到达服务器。App 先用同一 pending 交给服务器裁决：未执行则正常轮换；已执行且结果过期则返回明确恢复错误并重新认证。不能根据本机钟表或“看起来过了很久”自行改成新 ID 重用旧 token。

收到迟到响应前再次检查 envelope 和账号作用域；当前已退出、已登录 B、已完成更高代或正在确认删除时，丢弃旧结果，不能恢复旧会话。退出/删号优先于刷新成功。原生令牌交换初始 Keychain 保存失败时不标成已登录；一次性授权码不能凭新请求 ID 无限重放，必要时重新启动认证。

永久损坏或确定丢失 journal 时转重新认证，不猜测旧刷新是否执行。手动退出清理认证 envelope；第 16.3 节独立的删号进度凭据不随认证清理一起删除。

### 8.4 身份解析边界

新移动端私有 API 使用 `Authorization: Bearer ...`。旧网站保留 Cookie。两种路径最终返回内部 `principal = {accountId, sessionId, clientType}`，业务层据此鉴权。VIP 媒体 GET/HEAD/Range 也必须解析独立 Bearer，并与 grant 的 accountId 和 sessionId 同时匹配；不得仅由 URL 内 grant 反查出账号就认定来访者已经登录。

私有端点收到无效 Bearer 后不能回退为 Cookie 或游客。若出现多个冲突的身份凭据，应拒绝并记录不含凭据的错误码。原生请求不携带网站 Cookie，不把 Safari Cookie 复制到 Keychain，也不伪造现有 `station_cat_reader_session`。

全站敏感写接口继续保留原 CSRF/Origin 等保护；原生支持通过新路由实现，不以“App 不受 CORS 限制”为理由关闭网站保护。权限只读取服务端身份，不接受请求正文里的 accountId 决定操作对象。

### 8.5 登录和退出的数据隔离

用户退出后，停止账号关联的 VIP 播放，撤销当前会话，清除认证 envelope、权益快照及当前账号个人缓存。队列可以保留公开曲目 ID，但不能自动继续播放付费源。已经持久化的删除进度凭据使用独立 Keychain 命名空间，不由 logout、清缓存或账号切换批量清理；仅供该删除任务的最小状态查询，不能获得原账号权限。

切换账号必须重新创建该账号的个人数据作用域。A 的收藏、历史、待同步事件和订阅提交不得写入 B。StoreKit 返回的旧交易由服务端按原始绑定处理，不能绑定给当前恰好登录的账号。

## 9. 原生媒体授权与 R2 交付

### 9.1 入口与实际请求者认证

旧媒体路由继续保留，不能改变其严格查询参数约定。新增完整路径：

```text
POST /api/mobile/v1/music/tracks/{trackId}/playback-grants
GET  /api/mobile/v1/music/media/{opaqueGrant}/audio
HEAD /api/mobile/v1/music/media/{opaqueGrant}/audio
```

创建授权提交 `audioVersion` 和 `variant`。VIP full 必须提供有效移动端 Bearer。服务器调用公共曲目访问决策，允许后产生限定歌曲、版本、变体与期限的 grant。游客仅可取得服务器当前确认的免费完整曲目或独立试听资源，不取得账号专属 VIP grant。

**受保护媒体的每一次 GET、HEAD、Range，包括重试、拖动和并发加载，都同时要求 URL 中的 grant 及 `Authorization: Bearer <accessToken>`。**校验顺序为：验证实际 Bearer 和账号状态；查验 grant；严格比对 accountId、sessionId、authMode、trackId、版本和变体；检查 grant 截止、内容状态、当前权益及开关；全部通过后才触碰 R2 交付媒体。服务器可以先只读检索 grant 元数据确定 authMode，但其中记录的账号只代表预期绑定，不能充当调用者认证。对无 Bearer 的受保护路由直接 401；对有效 B 会话使用 A 的 grant 返回 403，B 本身也是 VIP 时仍拒绝。

同账号不同 session 也不能共享旧 grant，各自重新申请。合法刷新只更换 token generation，保留 sessionId，新的有效 Bearer 可继续使用尚未过期的本会话 grant。伪造 accountId/sessionId header、IP、User-Agent 或 `Origin` 均不构成身份依据。

`authMode` 由服务端产生且不可更改：`session_bearer` 用于所有账号绑定的授权；`public` 只用于当前免费媒体/独立试听。公开 grant 不承担防分享目标，必须继续验证资源策略；限时免费转 VIP 后旧 public full 不再放行。无效 Bearer 不回退匿名。不得通过把 grant.authMode 设为 public 给 VIP 完整文件开后门。

通过内部公共媒体服务复用内容、版本和 Range 处理；禁止伪造 Request/Cookie 调用旧鉴权模块。媒体鉴权依赖数据库失败返回 503，不返回付费字节，不从旧“曾授权”缓存绕过当前请求的鉴权。[S17]

### 9.2 Grant 与凭据保护

默认 grant 上限 10 分钟；其实际 `expiresAt` 为发放时刻加 10 分钟、当前 access token 到期、会话有效边界、已知连续权益截止（VIP full）和下一内容策略变化边界的最小值。无适用边界的项忽略；身份或期限无法验证时不发放。客户端在申请前可先恢复/完成必要刷新，避免取得仅剩极短时间的 grant。

服务器仅存 grant 哈希，记录 trackId、audioVersion、variant、authMode、accountId/sessionId、issuedAt、expiresAt、playbackValidUntil、revalidateAt 和撤销状态。`session_bearer` 的 accountId/sessionId 必填；`public` 必须留空。绑定完整性用数据库约束和服务端校验保证。

grant 允许本媒体的多次 GET/HEAD/Range，不能读一次就失效。它不允许枚举其他资源或从 preview 升级 full；access token 单独存在也不能跳过曲目授权和版本检查。

真实 access token 不放入播放 URL、歌词、分享链接、Cookie 拼接或媒体请求正文。URL 中 grant 和 Authorization 都需要在代理、Worker、错误日志、崩溃诊断、录屏与测试输出中脱敏；认证相关响应使用 `private, no-store`。拒绝把任何媒体认证转发到重定向目标；首版媒体路由不返回 3xx，CDN/域名配置也要测试。

### 9.3 原生资源加载与返回语义

首版受保护 MP3 使用专用 `AVAssetResourceLoaderDelegate` 适配：AVPlayer 接收仅供本 App 内部识别的自定义 scheme 资源；加载器按精确白名单映射到真实 HTTPS 媒体 URL，以 URLSession 发起带 Bearer 的 HEAD/Range 请求，再向 AVAssetResourceLoadingRequest 交付内容信息和字节。该方案基于苹果资源加载委托接口，具体锁屏、拖动和取消行为须先通过 M0 实验。[S20]

不得使用未文档化的 `AVURLAssetHTTPHeaderFieldsKey` 作为发布方案，不假设普通 URLSession 的 header 会自动出现在 AVPlayer 的所有后续请求，也不以 URL-only 降级解决联调困难。

加载器必须处理 content information、requestedOffset/currentOffset/requestedLength、取消、并发、401 刷新、416、版本更新和有限缓冲。使用有界分段及背压，不将整首先下载完再交给播放器，不持久化受保护音频；同一资源请求只 finish 一次。离开页面不销毁播放服务，账号切换及硬截止会取消该账号所有媒体请求。测试必须观察真正发出的 HTTP 请求，不能只断言某个配置字典包含 Authorization。

服务端继续返回准确的 Content-Type、Content-Length、Accept-Ranges、Content-Range、ETag、If-Range。合法单段返回 206；不可满足范围返回 416。旧接口不支持范围的处理保留旧测试约定。[R06] 对受保护请求，无论是否命中 ETag/Range，都先完成鉴权；错误响应不暴露 R2 键和其他账号资源信息。

VIP 媒体不能进入公共 CDN 响应缓存。R2 桶密钥、对象管理凭据及服务端密钥不下发客户端。第一版沿用 MP3 和独立试听，不引入 HLS、DRM、无损、离线或全曲库打包。

### 9.4 截止、超时与暂停状态机

#### 9.4.1 时间字段

| 字段 | 定义 |
|---|---|
| `accessValidUntil` | 当前已验证、连续覆盖音乐权益的截止，属于权益信息；不能单独拿来无限延长媒体播放。 |
| `expiresAt` | 当前 grant 的服务端到期时刻，包含第 9.2 节的各项上限。 |
| `playbackValidUntil` | 客户端允许当前资源继续输出的硬边界；首版规定与本次 grant.expiresAt 相等。 |
| `revalidateAt` | 提前申请新授权的目标时间；默认 issuedAt 后 60 秒，与硬截止前 5 秒取较早值且不早于 issuedAt。 |

`/me/entitlements` 的全局 revalidateAt 只是权益查询目标；它不能覆盖当前曲目更早的媒体期限。只有成功、属于当前会话与当前播放操作的完整新 grant 响应，才可更新当前资源的硬边界。HTTP 200 的错误正文、媒体字节、token 刷新成功、普通权益缓存或 503 均不能延长边界。已经取得明确拒绝后，迟到的旧允许结果失效。为相同歌曲、版本和变体取得新 grant 后，加载器必须一起切换活动媒体 URL 和硬截止，不能只延长倒计时却仍永久请求旧 grant。仍在途的旧 grant 请求受旧截止约束；媒体版本变化需要重建 PlayerItem。新授权只延长同一当前播放操作，不替其他队列曲目授权。

客户端记录授权请求发送/接收的连续单调时钟 t0/t1，使用服务端返回的 serverNow 和 playbackValidUntil 计算剩余预算。默认保守公式：`remaining = max(0, playbackValidUntil - serverNow - (t1 - t0) - 2秒安全裕量)`，本机截止为 `t1 + remaining`。采用包含休眠时间的连续单调时钟；时间戳异常、负值、缺失或无法确认计时锚点时停止新授权。冷启动不复用旧进程的时钟锚点，重新授权且不自动播放。

#### 9.4.2 行为表

| 情形 | 当前 VIP 完整曲目 | 界面/重试 |
|---|---|---|
| 尚未到 revalidateAt，授权有效 | 正常播放。 | 维护硬截止。 |
| 到 revalidateAt，重新验证中 | 原硬截止前可继续当前已授权项。 | 异步有限重试，截止计时不能等待网络任务结束。 |
| 截止前遇到超时、断网、503、429 | 不新建无授权播放源，已有缓冲最多使用至原截止。 | 显示暂不可验证；不修改会员事实，不延长时间。 |
| 截止前取得完整新 grant | 验证作用域和操作序号后安装新边界；必要时重建资源并恢复进度。 | 原本播放且无其他暂停原因时可连续播放。 |
| 到达本机硬截止，新授权尚未成功 | 暂停、取消媒体任务、移除 AVPlayerItem 和可控音频缓冲、取消自动切下一首，设置 requiresExplicitResume。 | verificationRequired；无无限等待网络或播放至本首结束的例外。 |
| 服务端明确账号撤销/限制、权限拒绝或内容下架 | 无论原截止是否到达，立即执行上述停止动作。 | permissionDenied 或内容不可用。 |
| 普通 access token 到期 | 单飞恢复第 8.3 节刷新；未获新媒体授权仍沿用原硬截止。 | 401 不触发无限刷新，明确撤销不得刷新。 |
| 截止后查询恢复为允许 | 可更新待播放状态，仍保持暂停，不恢复旧 PlayerItem。 | 用户再次点播放时取有效 grant；不自动发声。 |

暂停后可保留公开标题、封面和进度，供解释与重新播放。试听须用户主动选择，不自动切成另一音源来掩盖授权失败。睡眠定时、手动暂停、登出和删除等其他停止原因拥有同等或更高优先级，晚到授权不能覆盖。

每次新请求服务器按当前时间拒绝已过期 grant；客户端用独立截止任务、播放器状态回调及前后台/系统控制入口交叉检查。到点应先停止，不能 await 一个无明确超时的网络查询。权限/播放授权请求默认单次总时限 5 秒，截止事件优先取消等待；提前重试可用 2/4/8 秒带抖动，一轮最多 3 次，并尊重 Retry-After，不越过本机截止延续播放。

#### 9.4.3 撤销和缓存的边界

每次媒体请求都检查即时状态；一个已建立的响应和已发送给设备的字节可能无法立即撤回。服务器可取消仍受控的响应，客户端必须清除自己控制的加载与播放。不能承诺毫秒级远程撤销、修改过的客户端必定守时或已交付音频被收回。

前台及可执行音频后台任务条件下，到期即触发停止是项目要求。系统音频管线存在残余输出和调度误差，需记录真机实测；M0/M4 必须测试“全曲已缓冲 + 到期前后持续 503/超时”。如果暂停控制无法达标，该关卡保持未通过，不用“后台无法保证”免除客户端截止逻辑。

### 9.5 防分享目标与非目标

首版必须做到：复制 A 的受保护播放 URL、不带 Bearer 时失败；带 B 的 Bearer 时失败；带 A 另一会话的 Bearer 时失败。合法 A 会话的多次 Range 和刷新后请求在期限内成功。

如果攻击者取得 A 的 URL 和同一有效会话 Bearer，服务器会把请求识别为该会话。仅在数据库绑定 accountId/sessionId，无法再证明请求来自原实体设备。Bearer 的这个限制有明确协议定义。[S17] IP、User-Agent、deviceId 字符串都不能替代密码学持有证明。

“完整凭据被盗后仍阻止重放”需要另行设计发送者约束，例如 RFC 9449 的 DPoP，并评估资源加载、密钥、nonce、重放缓存和服务端验证。[S21] 本次不强行加入该依赖，也不把它与 DRM、音频不可复制或禁止录音混为一谈。

## 10. 收藏、最近播放与跨端同步

### 10.1 收藏

登录用户的收藏以服务端记录为准。服务端按 `(accountId, trackId)` 唯一保存，支持添加、取消和游标读取。客户端缓存按账号隔离，离线可以排队，显示待同步状态。

每次写入携带 `mutationId` 和已知资源版本，服务器去重并检测冲突。相同 mutationId 不能重复改变状态。旧版本冲突时返回当前状态；客户端展示同步结果，禁止不受控地无限覆盖。删除使用带版本的墓碑或等价同步机制；墓碑过期后，旧同步游标必须失效并触发全量刷新。

默认离线队列最长保留 30 天，墓碑至少保留 35 天；接口幂等响应可短期保存，状态版本和重复识别要避免过期重试重新执行旧操作。默认每账号最多 5,000 个收藏，超限明确提示。

### 10.2 最近播放

记录实际开始播放且达到有效阈值的事件，默认累计实际输出不少于 5 秒。仅拖动进度或加载文件不算收听。每个播放会话有 eventId；服务端去重，同一曲目在最近列表中合并显示最近一次。

首版最近历史默认最多 1,000 条或 90 天，以较先达到的限制为准。用户可关闭历史记录或清空历史；关闭后停止新增个人历史，不能仅隐藏界面却继续上传。登录状态下，该设置属于账号级偏好，服务器也必须拒绝新增历史；本机离线时立即停止记录，上线后同步关闭偏好。播放队列和精确续播位置首先保存在本机，不承诺远程控制其他设备。清空历史时服务器递增 `historyEpoch`，客户端旧离线事件携带旧 epoch 时被拒绝并清理，防止其他设备把已经删除的历史重新写回。

来自客户端的收听时长可以伪造，不能作为付费授权、现金奖励或积分奖励的可信依据。

### 10.3 游客与网站同步

游客收藏与历史保存在独立本机作用域。登录后只在明确询问并同意时合并游客收藏；个人历史默认不自动关联到新账号。取消合并不能丢失服务器已有数据。

共享账号不意味着网站现有本地收藏自动变成云数据。M0 必须查明网页当前存储方式；需要新增网页适配时，作为单独兼容任务交付。未完成前产品文案只承诺已实现的同步范围。

### 10.4 缓存

封面磁盘缓存默认 150MB，其他元数据及个人缓存默认 20MB，超过后按可恢复性与 LRU 清理。受保护音频不主动持久化。提供清除缓存按钮及大小估计；清缓存不退出账号、不清服务端收藏、不取消订阅。

## 11. 数据结构规格

以下提供逻辑表和关键约束；可执行迁移文件由实施阶段生成。M0 需对齐实际数据库类型、迁移框架、索引和事务能力，随后生成可运行迁移及回滚/前滚脚本。

### 11.1 保持现有权威数据

`reader_accounts` 继续维护账号身份和状态；`reader_sessions` 维护网站会话；`reader_memberships` 保持全站 VIP 的原语义；现有积分与支付表保持原业务。音乐发布表和素材表保留原生命周期与约束。[R03][R04]

### 11.2 v1.0 新增或复用表

| 逻辑表 | 关键字段及约束 |
|---|---|
| `native_auth_codes` | code_hash 主键；account_id、client_id、redirect_uri、pkce_challenge、expires_at、consumed_at。消费必须原子化。 |
| `native_sessions` | id、account_id、access_token_hash、access_expires_at、refresh_token_hash、refresh_expires_at、absolute_expires_at、token_family_id、refresh_generation、created_at、last_used_at、revoked_at。令牌哈希唯一；sessionId 在刷新期间稳定；支持 generation 条件更新。 |
| `native_refresh_operations` | family_id + old_generation 唯一；family_id + request_id 唯一；old_refresh_token_hash、request_digest、result_generation、committed_at、replay_result_ciphertext、replay_until、metadata_expires_at。密文默认 120 秒，墓碑保留到家族绝对期限；两类清理分离。此表替代旧文档的 native_refresh_retries 设计，不能在短期清理时丢掉同操作识别能力。 |
| `music_playback_grants` | token_hash、track_id、revision_no、variant、auth_mode、account_id、session_id、issued_at、expires_at、playback_valid_until、revalidate_at、revoked_at。session_bearer 必须同时绑定账号与会话，public 必须二者为空；首版 playback_valid_until = expires_at。索引覆盖清理和撤销。 |
| `music_user_favorites` | account_id + track_id 唯一；state、version、updated_at、last_mutation_id；保留取消收藏的同步版本。 |
| `music_user_recent` | account_id + track_id 唯一；last_played_at、variant、updated_at；按账号与时间索引。 |
| `music_user_preferences` | account_id 唯一；history_enabled、history_epoch、version、updated_at。关闭历史与清空操作由服务端执行。 |
| `music_user_mutations` | account_id + mutation_id 唯一；operation、result_version、过期信息；承担必要幂等和事件去重。 |
| `account_deletion_jobs` | deletion_request_id 主键；account_id、prepare_request_id、prepare_digest、confirm_request_id、scope_version、status、prepared_at、prepare_expires_at、confirmed_at、阶段进度、完成时间、deletion_receipt_hash、receipt_expires_at。准备阶段与确认后的任务明确区分；同账号最多一个待准备/进行中的任务。确认与账号阻止访问、会话失效、outbox 记录原子提交。 |
| `account_deletion_outbox` | deletion_request_id + action 唯一；任务进度、attempts、retry_at、脱敏错误。发布任务失败可补偿，不能先撤销账号再依赖未持久化内存消息。 |

所有账号外键与现有类型匹配。用户请求中的标识不能代替认证主体；删除个人数据时不得级联删除共享曲目。删除状态最小记录不能因账号行删除而一并级联清除；个人数据清理后解除不再需要的账号关联，凭 receipt 仍可查询该任务至凭据到期。

客户端另有两个独立 Keychain 命名空间：`NativeCredentialEnvelope` 和 `DeletionRecoveryEnvelope`。前者含 refresh token 与 pendingRefresh，登出会清理；后者含删除请求 ID、查询凭据、确认操作 ID、状态和凭据到期，登出及清缓存不清理。原子更新和字段约束分别以第 8.3、16.3 节为准。

### 11.3 v1.1 新增表

| 逻辑表 | 关键字段及约束 |
|---|---|
| `apple_account_links` | account_id、app_account_token UUID；token 唯一、由服务器生成，不使用邮箱或原始数字 ID。 |
| `apple_purchase_intents` | id、account_id、product_id、app_account_token、created_at、expires_at、可选 transaction_id；意图用于关联交互，不替代 Apple 交易事实。 |
| `apple_subscription_bindings` | environment + bundle_id + original_transaction_id 唯一绑定一个 account_id；记录 app_account_token 与绑定状态。 |
| `apple_transactions` | environment + bundle_id + transaction_id 唯一；original_transaction_id、product_id、purchase_date、expires_date、revocation_date、ownership_type、signed_date、已验签原文或受控存储引用、校验状态。 |
| `apple_subscription_states` | 每个原始订阅链的续费状态、grace_period_expires_at、billing_retry 标记、最后核对时间、服务端版本。 |
| `apple_notification_inbox` | environment + notification_uuid 唯一；接收、验签、入队、处理状态、重试次数、下次重试及脱敏错误。 |
| `apple_reconciliation_jobs` | 按订阅链合并任务；原因、优先级、最近执行、下一次执行及结果。 |

每次续费是一笔新交易。不得把同一原始订阅链的所有交易压成不可追踪的一个到期字段。权益可以使用可重建投影加速，但原始交易及全站会员记录仍是来源。

### 11.4 数据原则

金额不用二进制浮点数做账；苹果财务金额与用户界面价格分别按其来源和币种保存，不假设都是美元。各类时间统一保存 UTC 并在 API 输出 ISO 8601；客户端本地化展示。

交易、通知和权益投影的更新应原子执行，或采用可恢复事务外盒机制。持久化失败不能先回应“已完成”。禁止将真实交易作为可丢弃的缓存。

## 12. API 契约

### 12.1 通用规范

新增路由前缀 `/api/mobile/v1`。下表全部是计划接口，不能声称现网已存在。允许内部调用已有音乐服务；不要通过服务器 HTTP 回调自身公共 URL 串联业务。

JSON 使用 UTF-8。成功响应包含 `data`、`requestId`、`serverNow`；错误响应包含稳定的 `error.code`、`error.retryable`，可选 `retryAfterSeconds` 和安全的用户提示键。`error.message` 不直接透出 SQL、供应商原文或凭据。

客户端忽略不认识的可选字段，对新增枚举值提供明确 fallback；未知权益和未知支付状态不得默认放行。ID 使用字符串，时长明确使用秒或毫秒，分页默认 50、最大 100。公开内容可以按版本缓存，身份、授权与订阅响应均禁止共享缓存。

### 12.2 端点总表

| 方法与路径 | 认证 | 说明 | 阶段 |
|---|---|---|---|
| GET `/config` | 无 | API 能力、最低支持版本、商店链接、购买可用标记；不返回密钥。 | v1.0 |
| GET 站点根路径 `/auth/mobile/authorize` | 系统浏览器认证 | 认证交互页，不拼接 API 前缀。 | v1.0 |
| POST `/auth/token` | code + PKCE | 交换一次性授权码。 | v1.0 |
| POST `/auth/refresh` | refresh token + 固定 refreshRequestId | 同一操作跨进程恢复；轮换和结果幂等，第 12.7 节。 | v1.0 |
| POST `/auth/logout` | Bearer | 撤销当前移动会话。 | v1.0 |
| GET `/me` | Bearer | 账号公开资料与状态。 | v1.0 |
| GET `/me/entitlements` | Bearer | 分项权益及来源、有效期、验证期限。 | v1.0 |
| GET `/music/catalog` | 无 | 分页曲库，可搜索及筛选。 | v1.0 |
| GET `/music/featured` | 无 | 当前有效精选，不返回草稿。 | v1.0 |
| GET `/music/tracks/{id}` | 无 | 歌曲详情和版本，不返回受保护对象键。 | v1.0 |
| GET `/music/collections/{slug}` | 无 | 专辑或官方歌单详情。 | v1.0 |
| POST `/music/tracks/{id}/playback-grants` | VIP full 必须 Bearer | 创建限定版本与变体的授权。 | v1.0 |
| GET/HEAD `/music/media/{grant}/audio` | session_bearer 模式必须 grant + Bearer | 每次含 Range 的请求比对账号、sessionId；public 仅按第 9.1 节用于免费/试听。 | v1.0 |
| GET `/me/music/favorites` | Bearer | 收藏增量或分页读取。 | v1.0 |
| PUT `/me/music/favorites/{id}` | Bearer | 期望收藏状态、mutationId、版本。 | v1.0 |
| GET `/me/music/recent` | Bearer | 最近播放列表。 | v1.0 |
| GET/PATCH `/me/music/preferences` | Bearer | 获取/修改历史开关和同步版本，写入检查版本。 | v1.0 |
| POST `/me/music/listens` | Bearer | 最小事件上报，幂等；检查 historyEnabled 和 historyEpoch。 | v1.0 |
| DELETE `/me/music/recent` | Bearer + 确认 | 清理当前账号历史。 | v1.0 |
| POST `/me/deletion-requests/prepare` | Bearer + 新近认证 + Idempotency-Key | 接受预先持久化的请求 ID 和 receipt 哈希；只准备，不撤销会话。 | v1.0 |
| POST `/me/deletion-requests/{id}/confirm` | Bearer + 新近认证 + Idempotency-Key | 用户明确确认；原子受理删除并阻止账号访问。receipt 单独不能确认。 | v1.0 |
| GET `/deletion-requests/{id}/status` | Authorization: DeletionReceipt | 不需要登录；仅查该 receipt 对应任务的最小状态。 | v1.0 |
| GET `/subscriptions/music/offering` | Bearer | 商品 ID、购买资格、服务条款版本；不伪造地区价格。 | v1.1 |
| POST `/subscriptions/apple/purchase-intents` | Bearer | 返回服务端 appAccountToken 和购买意图 ID。 | v1.1 |
| POST `/subscriptions/apple/transactions` | Bearer | 提交已获得交易的 JWS，服务端独立验证和绑定。 | v1.1 |
| GET `/subscriptions/music/status` | Bearer | 该账号音乐订阅与全站音乐覆盖状态。 | v1.1 |
| POST `/subscriptions/apple/reconcile` | Bearer + 限流 | 恢复/补偿核对请求，不接受客户端期限。 | v1.1 |
| POST `/webhooks/apple/subscriptions` | Apple 签名 | 站点根级独立通知路径，不使用用户 Bearer。 | v1.1 |

删除准备和确认位于 `/api/mobile/v1/me/deletion-requests/prepare` 与 `/api/mobile/v1/me/deletion-requests/{id}/confirm`，删除查询位于 `/api/mobile/v1/deletion-requests/{id}/status`，不经过登录重定向。认证交互页为 `/auth/mobile/authorize`；Apple 通知为 `/webhooks/apple/subscriptions`。其余条目均添加 `/api/mobile/v1` 前缀。OpenAPI 必须写出完整路径和不同认证方式。旧文档的单步删除计划接口停止采用；若 M0 发现已有实现，先做迁移评估，不直接覆盖现网。

### 12.3 权益响应示例

以下是虚构测试数据，用于说明契约。

```json
{
  "data": {
    "accountId": "sample-account-42",
    "music": {
      "canPlayVipFull": true,
      "accessValidUntil": "2026-10-15T12:00:00Z",
      "revalidateAt": "2026-09-15T12:05:00Z",
      "sources": [
        {
          "kind": "music_subscription",
          "provider": "apple",
          "status": "active",
          "validUntil": "2026-10-15T12:00:00Z",
          "autoRenewEnabled": true
        }
      ]
    },
    "siteVip": { "active": false, "validUntil": null }
  },
  "requestId": "sample-request-001",
  "serverNow": "2026-09-15T12:00:00Z"
}
```

`revalidateAt` 是该权益快照的再次查询目标时间，`accessValidUntil` 是当前连续覆盖期的边界，两者不能互换。当前曲目还受第 12.4 节 grant 的较早 playbackValidUntil 约束。全局权益 200 或 token 刷新成功不能单独延长媒体授权，账号会话失效、内容策略或系统开关也可提前拒绝播放。

### 12.4 创建播放授权

```json
{
  "audioVersion": 3,
  "variant": "full"
}
```

```json
{
  "data": {
    "playbackUrl": "https://wwwstationcat.org/api/mobile/v1/music/media/EXAMPLE_ONLY/audio",
    "expiresAt": "2026-09-15T12:10:00Z",
    "playbackValidUntil": "2026-09-15T12:10:00Z",
    "revalidateAt": "2026-09-15T12:01:00Z",
    "authMode": "session_bearer",
    "sessionId": "sample-session-7",
    "audioVersion": 3,
    "variant": "full",
    "durationSeconds": 213.5,
    "previewSourceStartSeconds": null
  },
  "requestId": "sample-request-002",
  "serverNow": "2026-09-15T12:00:00Z"
}
```

示例 URL 仅说明格式，不包含现有凭据。假定示例会话、access token、权益和内容策略都允许至少至 12:10；真实接口必须按较早边界缩短。实际响应只允许 HTTPS 和预设媒体域名，不返回 access token。后端不能信任客户端提交的时长、访问类型、authMode 或存储对象地址。

客户端加载器发送下列类型的实际请求，示例只显示结构，不能复制为真实凭据：

```http
GET /api/mobile/v1/music/media/EXAMPLE_ONLY/audio HTTP/1.1
Host: wwwstationcat.org
Authorization: Bearer EXAMPLE_ACCESS_TOKEN_ONLY
Range: bytes=0-65535
```

同一 URL 缺少有效 Bearer 必须失败。资源加载器根据 authMode 选择路径；未知 authMode 直接拒绝受保护加载。每次响应安装前验证账号、sessionId、曲目、版本、变体和操作序号，适用第 9.4 节的时钟换算与暂停要求。

### 12.5 错误语义

| HTTP | 错误码示例 | 客户端行为 |
|---|---|---|
| 400 | `INVALID_INPUT`、`INVALID_VARIANT` | 不重试，记录安全诊断。 |
| 401 | `AUTH_REQUIRED`、`ACCESS_TOKEN_EXPIRED` | 仅可恢复的访问令牌过期按第 8.3 节恢复同一次刷新，各业务请求最多重放一次。 |
| 401 | `SESSION_EXPIRED`、`SESSION_REVOKED`、`REFRESH_REUSE_DETECTED` | 停止账号受保护播放并重新认证，不循环刷新。 |
| 403 | `MUSIC_VIP_REQUIRED`、`ACCOUNT_RESTRICTED`、`GRANT_PRINCIPAL_MISMATCH` | 停止受保护源；账号不匹配不能回退匿名或自动改写 grant。 |
| 404 | `NOT_FOUND`、`PREVIEW_UNAVAILABLE` | 更新列表/提示试听不可用。 |
| 409 | `VERSION_CONFLICT`、`MUTATION_CONFLICT`、`ACCOUNT_BINDING_CONFLICT` | 按业务刷新或联系支持，不能通用无限重试。 |
| 409 | `REFRESH_RECOVERY_EXPIRED`、`REFRESH_RESULT_SUPERSEDED`、`REFRESH_IDEMPOTENCY_MISMATCH` | 不重用旧 token 生成新 requestId；按第 8.3 节重新认证或保留已验证的新代，不因同一操作误撤销。 |
| 409 | `DELETION_PREPARATION_EXISTS`、`DELETION_OPERATION_CONFLICT` | 保留原任务和凭据；同 ID 不同内容拒绝，不创建重复删除。 |
| 410 | `GRANT_EXPIRED` | 当前源停止，重新取得有效授权后等待用户播放；不得单凭全局 VIP 标记续用。 |
| 410 | `DELETION_PREPARATION_EXPIRED` | 不删除账号；用户重新确认准备流程，不能自动重新提交破坏性操作。 |
| 410 | `TRACK_UNAVAILABLE` | 停止该内容并移出可播放集合。 |
| 429 | `RATE_LIMITED` | 尊重等待时间。 |
| 503 | `ENTITLEMENT_UNAVAILABLE`、`MEDIA_UNAVAILABLE` | 保留暂不可验证语义；不得延长原 playbackValidUntil，到点必须暂停。 |
| 503 / 网络失败 | 刷新或删除操作结果未知 | 保留已持久化的操作 ID/凭据，按对应恢复协议处理，不能换 ID 盲目重做。 |
| 404 | `DELETION_STATUS_UNAVAILABLE` | 查询凭据无效、未知请求或凭据过期统一对外响应；不能据此推断删除已成功或从未发生。 |

旧网站路由保留现有错误码。新移动端可映射为统一语义；测试证明映射不会改变原有购买与会员行为。

### 12.6 兼容策略

开发时提交 OpenAPI 和代表性响应 fixtures。增加可选字段可保持 v1；删除字段、改变字段含义或权限模型，需要新版本或明确迁移。游标与版本不匹配时返回可识别的全量刷新信号。服务器同时回归网站、当前客户端和仍在支持期的旧客户端。

强制升级仅用于无法安全兼容的情况，必须提供原因与有效的商店入口。不能把暂时网络错误解释为客户端版本过旧。

### 12.7 刷新请求与恢复契约

`POST /api/mobile/v1/auth/refresh` 不使用网站 Cookie，不经“收到 401 再调用自己”的通用刷新拦截器。下面是虚构示例：

```json
{
  "clientId": "station-cat-ios",
  "refreshToken": "EXAMPLE_OLD_REFRESH_TOKEN_ONLY",
  "refreshRequestId": "sample-refresh-operation-17",
  "generation": 4
}
```

clientId、ID 和 generation 仅作绑定与并发校验，服务端通过 token 哈希确定真实会话。请求摘要由服务端按已冻结字段规范计算，不能接受客户端声明“摘要相同”作为幂等证明。同一个 ID 的重试不可修改请求内容。

```json
{
  "data": {
    "accountId": "sample-account-42",
    "sessionId": "sample-session-7",
    "tokenFamilyId": "sample-family-7",
    "refreshRequestId": "sample-refresh-operation-17",
    "previousGeneration": 4,
    "generation": 5,
    "accessToken": "EXAMPLE_NEW_ACCESS_TOKEN_ONLY",
    "accessExpiresAt": "2026-09-15T12:15:00Z",
    "refreshToken": "EXAMPLE_NEW_REFRESH_TOKEN_ONLY",
    "refreshExpiresAt": "2026-10-15T12:00:00Z",
    "absoluteExpiresAt": "2026-12-14T12:00:00Z",
    "replayUntil": "2026-09-15T12:02:00Z"
  },
  "requestId": "sample-http-response-17",
  "serverNow": "2026-09-15T12:00:00Z"
}
```

重复传输保持 data 中的原令牌和所有原期限。外层 requestId 标识 HTTP 请求，不能替代持久化的 refreshRequestId；后者不得由每次请求自动生成的日志 ID 充当。敏感响应禁止缓存与正文日志。收到响应后先完成第 8.3 节的 Keychain 原子写入，再向其他业务发布成功。

### 12.8 删除准备、确认与无会话查询

本节所有路径添加 `/api/mobile/v1` 前缀。客户端先生成随机 deletionRequestId、prepareRequestId 和至少 256 bit 的随机 `deletionReceipt`，把原 receipt 保存在独立 Keychain envelope。prepare 只发送该随机值的 SHA-256 哈希，服务器无需生成或重复下发明文查询凭据。receipt 的精确字节和编码规则须写进 OpenAPI：32 个随机字节，传输为无填充 base64url，哈希对象为解码后的 32 字节；禁止混淆为编码字符串的哈希。

```http
POST /api/mobile/v1/me/deletion-requests/prepare HTTP/1.1
Authorization: Bearer EXAMPLE_ACCESS_TOKEN_ONLY
Idempotency-Key: sample-prepare-operation-1
Content-Type: application/json
```

```json
{
  "deletionRequestId": "sample-deletion-request-1",
  "deletionReceiptHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "scopeVersion": "station-account-v1"
}
```

上面的 ID 和全零哈希只用于结构说明，实际测试须用密码学安全随机源生成 receipt；生产拒绝格式错误、已知占位值和不可接受的请求。服务器仅取得哈希时无法证明客户端原值的随机熵，不能声称已从哈希验证其足够随机；随机生成质量由客户端实现和测试保证。prepare 返回 deletionRequestId、status=prepared、scopeVersion、prepareExpiresAt、receiptExpiresAt 和 serverNow。准备默认 10 分钟有效，receipt 从准备成功时起默认 14 天。此时不撤销会话、不标记账号待删除、不发送实际删除任务。

App 已确认本机存在原始 receipt，且已获得成功 prepare/状态查询结果后，才展示最终确认操作。用户明确确认时，先将固定 confirmRequestId 和 confirmAttempted 写入同一删除 envelope，再发送：

```http
POST /api/mobile/v1/me/deletion-requests/sample-deletion-request-1/confirm HTTP/1.1
Authorization: Bearer EXAMPLE_ACCESS_TOKEN_ONLY
Idempotency-Key: sample-confirm-operation-1
Content-Type: application/json
```

```json
{ "confirmedScopeVersion": "station-account-v1" }
```

prepare/confirm 均验证当前账号及服务端认可的新近认证，默认不超过 5 分钟，并遵守既有二步验证要求。`deletionReceipt` 只允许查询，单独不能 prepare/confirm、撤销、取消删除或重新登录。confirmation 不额外返回“唯一一次才知道”的关键恢复秘密。

confirm 原子提交受理状态、account 禁用/待删除标记、所有相关会话失效及删除 outbox，再返回 `202 accepted` 和同一个 deletionRequestId。响应丢失时，用早已保存的 receipt 查询：

```http
GET /api/mobile/v1/deletion-requests/sample-deletion-request-1/status HTTP/1.1
Authorization: DeletionReceipt EXAMPLE_QUERY_CREDENTIAL_ONLY
```

```json
{
  "data": {
    "deletionRequestId": "sample-deletion-request-1",
    "status": "processing",
    "confirmAccepted": true,
    "stage": "personal_data_cleanup",
    "confirmedAt": "2026-09-15T12:00:00Z",
    "completedAt": null,
    "receiptExpiresAt": "2026-09-29T11:58:00Z"
  },
  "requestId": "sample-status-read-1",
  "serverNow": "2026-09-15T12:01:00Z"
}
```

查询只返回该任务阶段与安全时间信息，不返回姓名、邮箱、会员、交易细节或账号行。status=prepared 时还须返回 scopeVersion、prepareExpiresAt、receiptExpiresAt 和 confirmAccepted=false，供 prepare 响应丢失后恢复确认页面；确认已受理的各状态返回 confirmAccepted=true 与 confirmedAt。confirmAccepted=false 只是本次强一致快照，不能证明在途确认稍后不会提交。它使用独立认证中间件和强一致任务读取，不能受旧 Bearer 的撤销影响，也不能跳转到登录页。客户端不得对该请求附加当前账号 Bearer 或套用普通 401 自动刷新拦截器。receipt 不放进 URL、普通分析事件或工单。无效/过期/错误任务查询统一为 404 DELETION_STATUS_UNAVAILABLE，避免枚举；记录安全错误但不暴露凭据。

相同 prepareId + 相同请求返回原准备结果；相同 confirmId 不创建重复任务。删除确认已提交后，旧 Bearer 的重试可以收到 401，客户端应查询 status 确认，不要求服务器重新接受已撤销会话。详细恢复表见第 16.3 节。

## 13. v1.1 音乐 VIP 商品与购买体验

### 13.1 商品定义

| 项目 | 定义 |
|---|---|
| 展示名称 | Station Cat 音乐 VIP，其他语言准确表达相同权益。 |
| 类型 | 普通按月自动续费订阅，无年度承诺。 |
| 候选价格 | 美区 US$0.99/月，最终以 App Store Connect 配置为准。 |
| Product ID 示例 | `org.stationcat.music.vip.monthly`，尚未注册；真实 ID 冻结后不可随意更名。 |
| Subscription Group | 一个音乐订阅组，首期一个月付商品。 |
| 权益 | 已发布并标记为 VIP 的音乐完整在线播放；网站与 App 共用。 |
| 不包含 | 小说、软件、游戏、积分、离线下载、无损音质、家庭共享。 |
| 自动续费 | 用户可通过苹果管理后续续费；状态和当前付费有效期分别展示。 |

后续增加音乐年付时优先放入同组同等级。将来在 iOS 销售包含音乐的全站 VIP 时，必须重新评估苹果订阅组的升级/降级规则，不可随意新建一个会与音乐重复收费的组。业务产品划分与苹果订阅组是不同层面的设计。[S05]

### 13.2 订阅页要求

显示 StoreKit 实时返回的 `displayPrice` 和本地化周期，并明确“仅音乐权益”。展示当前登录的 Station Cat 账号、当前音乐权益来源、自动续费说明、服务条款和隐私政策、恢复购买及管理订阅入口。[S05]

商品未返回、商店不可用、地区不支持、服务器关闭新购买或账号存在冲突时，不允许按假价格发起付款。不读取网站积分包价格作为苹果订阅价格，也不复用全站 VIP 的商品介绍。

游客点击订阅先进入登录，登录成功后返回原订阅页，由用户再次主动确认购买。不得在登录后自动弹出苹果扣款流程。

### 13.3 购买流程

1. 客户端获取该账号权益和可用商品 ID，检查全站 VIP 是否已覆盖。
2. 服务端创建默认 10 分钟有效的购买意图，并返回该账号稳定的 UUID `appAccountToken`。意图过期只影响新购买交互，不能据此拒绝归属明确、已验证但延迟完成的真实 Apple 交易。
3. 客户端从 StoreKit 加载商品，显示真实价格，用户确认后调用 purchase 并传入 appAccountToken。
4. 处理成功、用户取消、pending、未验证和失败结果。pending 只显示等待，不开通会员。
5. 对 verified 交易提交 JWS 至后台；后台独立验证，不信任客户端布尔值。
6. 服务器把交易幂等记录、绑定到正确账号并提交音乐权益后，返回 `fulfilled`。
7. 客户端重新读取权益并展示结果，随后 finish 已完成交付的交易。
8. 付款过程中 App 被结束，下一次启动通过交易监听及恢复逻辑补齐。

StoreKit 提供交易验证结果、交易监听和 appAccountToken，finish 应在交付完成之后执行；App 启动时即建立交易监听。[S06] 本项目将“交付完成”定义为服务端已持久化并可实际用于音乐鉴权，不以本地弹出成功提示代替。

### 13.4 响应丢失与后台暂不可用

购买成功但后台不可用时显示“付款结果正在同步，请勿重复购买”，把可安全保存的交易标识与待处理状态放入账号隔离队列。不能显示“购买失败”诱导再次扣款，也不能因为本地已 verified 就给网站授予权限。

接口可返回 `202 processing`，附状态查询标识。客户端采用有限轮询，超时后保留待同步入口，后续由交易监听、通知和对账继续处理。相同 transactionId 的重传必须返回相同绑定和交付结果。

如果返回账号冲突，只能提供原账号登录或支持路径，不对当前账号展示开通成功。对于已核实交付到原绑定账号或明确撤销的终态，制定可审计的交易确认处理；后台状态不明确时不得提前 finish 丢失恢复机会。

### 13.5 恢复与订阅管理

启动时监听 `Transaction.updates`，读取当前交易并向后台核对；正常同步不主动弹出 Apple Account 密码窗口。用户点“恢复购买”后才调用显式同步 API，再提交可验证交易核对。[S06]

恢复购买不应再次扣款。没有购买、只有过期购买、网络不可用、属于其他 Station Cat 账号分别显示结果。管理订阅打开系统管理界面，回到 App 后刷新后台状态。卸载 App、退出登录或清除缓存不应被文案描述为取消续费。

退款入口优先调用苹果提供的退款请求体验或官方支持渠道；请求退款不等于批准退款，不能在申请时立即撤销所有权益。

## 14. 苹果交易服务与权益状态机

### 14.1 验证责任

后端应使用 Apple App Store Server Library 或等价经过完整安全审查的实现。验签需要确认 Apple 信任链、签名、适用证书检查、bundleId、appAppleId（按环境要求）、environment 和商品 ID 白名单。不能只 Base64 解码 JWS，也不能直接信任请求内附带的任意根证书。[S07]

交易 ID、到期时间、退款时间、产品和购买归属从通过验证的 Apple 数据中读取。客户端传来的 expiresAt、isVIP、price 或 accountId 均不能作为授权依据。服务端 API 密钥、Issuer ID 配套私钥和验签配置只能保存在服务端受控配置中。

Apple 官方库与 Cloudflare Workers 的完整链验证、网络检查、时间校验和异常路径必须先在隔离环境跑通。编译成功不足以证明兼容。需要额外服务时只拆出最小 Apple 验签/查询适配，不能顺带迁走现有账号与音乐系统。[S07][S12]

### 14.2 交易与账号绑定

`appAccountToken` 由后台按 Station Cat 账号生成和保存，在同一账号多台设备上保持稳定。订阅链使用 `(environment, bundleId, originalTransactionId)` 唯一绑定；单笔交易使用 `(environment, bundleId, transactionId)` 去重。

首次绑定时同时检查 verified token 与本次认证账号是否匹配。已有绑定优先遵守原归属，用户切换账号、邮箱变化或更换设备不应转移订阅。不要尝试读取用户 Apple Account 邮箱来完成映射。创建新购买意图时再次查询有效权益，降低网页与 App 同时购买产生重叠的概率；已经真实发生的合法 Apple 交易仍按第 4.5 节处理。

缺少 appAccountToken 的交易：已存在可信订阅链绑定时按原绑定处理；尚未绑定时进入待核验流程，不允许“谁先上传交易就归谁”。首期关闭主动推广的站外内购、优惠码等额外购买路径，但恢复流程仍需承受合法的历史和系统端交易。

家庭共享首期不开启。将来启用前单独设计共享所有权与账号分配；不能直接把同一原始交易无限授予多个站点账号。

### 14.3 状态与音乐权限

| 订阅状态 | 音乐权益 | 界面行为 |
|---|---|---|
| 待付款或 pending | 不新增 | 等待系统确认，不提示再次付款。 |
| Active，自动续费开启 | 有效期间内开放 | 显示有效期/预计续费相关信息，以苹果状态为准。 |
| Active，自动续费关闭 | 有效期间内继续开放 | 显示“续费已关闭，可使用至……” 。 |
| Billing grace period | 仅在已启用且苹果确认的宽限期内开放 | 提示更新付款方式。 |
| Billing retry，无有效已付费期间或宽限期 | 不新增 | 保留管理入口，不能自行赠送一段无限宽限期。 |
| Expired | 此来源无效 | 检查是否还有全站 VIP 覆盖。 |
| Refunded/Revoked | 撤销对应交易或期间 | 重新计算其他有效来源。 |
| Refund reversed | 经验证后重建适用来源 | 重新计算，不能恢复所有历史退款。 |
| 状态暂不可验证 | 不新增长期授权 | 使用明确标识的最后已验证边界，随后要求核对。 |

首期建议在测试完成后配置 3 天账单宽限期，但只以 Apple 返回的真实宽限截止时间执行。宽限期开关、适用用户和 Sandbox 配置由 App Store Connect 的实际选项确认。[S08]

不能用“最后收到的通知类型”直接覆盖状态。一个旧续费通知晚于退款消息到达时，不能复活已撤销期间；对某个旧期间退款，也不能误删后续独立有效续费期间。

### 14.4 App Store Server Notifications V2

通知入口公开接收 Apple 签名消息，不使用网站 CSRF、用户 Cookie 或登录跳转。需要严格大小限制、验签、限流保护和可恢复入站记录。

流程为：接收有界请求，校验签名及环境，按 notificationUUID 去重，持久化待处理记录，成功后返回 2xx，再异步处理订阅状态。内部持久化失败返回可重试错误，不能先 200 再把消息丢在内存里。这里的异步由实际部署的队列/任务系统承担，不依赖人工定时检查。

嵌套的 transaction 和 renewal info 同样需要验证。收到不认识但签名有效的事件时保留受控记录并触发核对，不能把未知类型默认视为开通或退款。测试通知不得产生任何会员权限。

首期必须覆盖订阅、续费、续费设置变化、续费失败、宽限结束、到期、退款、退款撤销、撤销及测试消息。Apple 的消费信息请求单独处理，不把“收到退款相关请求”当成已退款。[S07][S09]

### 14.5 幂等与乱序

对每条订阅链串行化或使用数据库版本比较控制并发；所有写入都有唯一约束。优先将通知视为刷新提示，结合已经验证的交易与订阅状态重建当前快照。有争议的先后顺序通过 Server API 核对，不能单凭客户端时间或通知到达时间决定。

建议测试夹具至少覆盖：购买通知早于客户端提交；同一通知重放；同一交易从两个设备提交；退款先到、旧续费后到；下一期已续费时上一期退款；恢复后再次收到相同消息；系统宕机后重放；部分数据库写入失败。

### 14.6 主动补偿核对

购买、恢复、登录后发现权益不一致时，优先创建按订阅链去重的核对任务。后台对接近到期、处于扣款重试/宽限和处理失败的订阅提高优先级。

初期目标：高风险状态每 6 小时以内核对一次，其他活跃订阅每天核对一次；结合规模、Apple 限制和费用调整。通知历史恢复和事务查询按游标续取，不每次重复拉取全部交易。连续失败进入可见的死信/异常队列并告警，不静默吞掉。

这些频率属于项目运维目标，不代表 Apple 承诺的通知送达时限。服务端确认权益后，当前活跃网页及 App 下一次刷新应读取同一结果。

### 14.7 测试环境隔离

本地 StoreKit 测试、Sandbox/TestFlight 与生产购买分别标记。生产接口不得接受本地 `.storekit` 测试生成的数据作为真实付费交易。环境选择不能由客户端随意提交的 `sandbox=true` 决定，必须通过已验证的 Apple 数据和受控配置确认。

App Review 可能测试 Sandbox 交易，因此正式构建的后端需要有可审计的审核/测试路径：Sandbox 交易存入独立命名空间，仅测试授权账号取得测试权益；不写真实收入或生产付费账本。可读取 Sandbox 权益的资格由后台受控测试账号配置决定，普通客户端不能通过 header 或 query 开启；用于测试的账本不参与普通账号的生产音乐权限计算。审核说明提供可使用该路径的账号和步骤，所有正常审核功能与真实用户版本保持一致。

不得全局拒收 Sandbox 导致审核无法测试，也不得无差别把 Sandbox 数据授予所有生产账号。上述隔离需要专项自动化测试和审核账号真机测试。

## 15. 网站兼容与数据库迁移

### 15.1 分步迁移

第一步：盘点用户、会员、音乐、积分和支付接口，确认真实生产发布基线及未部署变更。只读检查，保存接口 fixtures 和回归样本。

第二步：添加新表、索引与移动端入口，不改变旧表含义。迁移先在隔离数据库执行，记录行数、索引、时间和失败恢复办法。

第三步：新增统一的音乐权益服务，先只接入既有全站 VIP。将其结果与旧音乐判定做影子比较，确认不存在权限差异。

第四步：让移动端读取新服务，同时保留旧网站 API 的外部契约。移动端媒体适配完成后再对网站音乐入口进行必要适配。

第五步：v1.1 增加独立音乐交易来源；用测试账号验证 music-only 可以听歌且无法阅读小说。最后提交网站会员音乐状态的分项展示。

第六步：开启苹果购买前，确认通知、恢复、重算和关闭新购买后的已有权益继续服务均可工作。

### 15.2 旧接口语义保护

旧网站的 `membershipStatus` 不应被悄悄解释成“任意产品会员”。保留全站会员字段的旧含义；音乐完整播放结果通过明确的音乐权限字段或新版本契约提供。

如网页原来只在全站 VIP active 时调用完整音频，必须调整音乐网页的调用条件以支持独立音乐会员；不修改小说模块条件。现有 `validUntil` 的消费者也需逐项核验，避免将会话验证期限当成订阅结束时间。[R04][R05]

### 15.3 回滚与前滚

新表采用增量迁移。回滚客户端或 UI 不删除新用户数据和真实订单。只要已有独立音乐订阅，后端就不能直接退回一个完全不认识音乐订阅的旧版本。

购买入口开关仅停止新订单发起，不能停止接收合法续费通知或停止服务已有权益。对权益计算缺陷优先回退到已验证的兼容实现或前滚修复。已收到的付费事件继续持久化，不能因功能开关关闭而丢弃。

涉及生产迁移、支付配置、真实扣款或发布的操作，需要产品负责人明确授权，Codex 不从本文推导自动执行权限。

## 16. 安全、隐私与账号删除

### 16.1 安全基线

强制 HTTPS，保留系统证书验证，不允许为了调试在发布包设置全局不安全网络例外。登录、刷新、播放授权、写入和恢复分别限流；限制请求体、分页、关键词及歌词大小。R2 对象按授权流式发送，不将完整文件读进 Worker 内存。

所有数据库操作使用参数化查询；收藏、历史和删除只操作当前身份。支付 webhook 不执行任意外链请求；Apple API 主机固定白名单，防止恶意 URL 或伪造通知造成服务端请求滥用。

敏感凭据进入受控 secret 存储，不进入 Git、截图、录屏、工单或模型日志。日志只留 requestId、稳定错误码、耗时和必要的脱敏标识。普通用户不具有管理授权、上传曲目或修改权益能力。

第一版不加入证书固定，避免无配套轮换机制导致大面积断连；优先依赖系统 TLS 和正确认证。App Attest 等增强措施可后续评估，不替代服务端鉴权。

### 16.2 隐私最小化

首版不采集广告标识，不做跨 App 跟踪，不索取通讯录、相册、位置、麦克风或 Apple Music 媒体库权限。系统分享封面或播放音乐不应顺带申请这些权限。

个人收藏和历史属于功能数据；诊断与产品分析分开。默认仅保留提供服务必要的最小日志。新增第三方崩溃或分析 SDK 前，核对其真实收集字段、隐私清单和数据处理方式，再修改隐私政策及 App Store 的申报。App 隐私说明应覆盖实际集成的第三方数据行为。[S10]

建议保留策略：脱敏调试日志 7 天，必要安全日志 30 天，播放历史按第 10 节；财务记录的保留期限在上线前按适用义务确认并公开说明，不在本文虚构一个统一法定年限。

### 16.3 账号删除与结果恢复

#### 16.3.1 用户含义与时限

设置中提供“删除 Station Cat 账号”。这是整个共享账号的删除入口，必须列明网站、音乐、小说及其他关联服务的影响，与退出登录和清除缓存分别呈现。

存在苹果订阅时提示删除账号不会自动停止后续扣款，提供系统管理和适用退款入口；用户仍可立即发起删除，不能强迫等待订阅到期。[S11] 本版采用立即删除流程，不增加自动延后至订阅到期的隐含逻辑。

目标为确认已在服务端受理后立即阻止账号访问，正常情况下 7 天内完成在线个人数据处理；实际期限写入隐私政策并验证任务执行能力。准备删除尚未确认时，账号继续正常。备份清理与最小财务记录保留按已确认政策执行，不因逻辑状态变为 completed 就声称所有法定留存记录也已删除。

#### 16.3.2 先持久化恢复凭据，再允许确认

客户端使用独立的 `DeletionRecoveryEnvelope`：environment、deletionRequestId、prepareRequestId、原始 deletionReceipt、scopeVersion、prepareExpiresAt、receiptExpiresAt、confirmRequestId、confirmAttempted、lastKnownStatus。初始未知期限可为空，获得服务端结果后补齐；本机未获得这些期限不能直接确认。

**在任何 prepare 请求之前就生成并成功保存查询凭据。**第 12.8 节选择客户端生成高熵 receipt、服务器仅保存其哈希，避免“prepare 返回的秘密也丢失”的第二个恢复缺口。确认前再检查原凭据可读，且 prepared 状态和范围版本匹配。Keychain 保存失败时停止发送，不使用日志或剪贴板临时保存秘密。

用户最终确认时，先持久化 confirmRequestId 和 confirmAttempted，再发送唯一逻辑确认。将进度凭据保存在与登录 envelope 分开的 Keychain item；撤销登录、清缓存及登录另一账号都不能误删它。

#### 16.3.3 服务端状态与原子受理

```text
prepared -> accepted -> processing -> completed
prepared -> preparation_expired
accepted / processing -> retrying -> processing / completed
retrying -> attention_required -> processing / completed
```

prepared 只是准备，不触发删除；准备超时后禁止确认。accepted 表示删除确认已经持久化且账号访问已阻止。processing、retrying 和 attention_required 都不恢复账号访问。completed 表示已完成公开说明的在线数据处理，不能用于表示“仅收到请求”。

服务端确认必须在同一原子边界内完成：核对任务归属、准备期限、范围版本、新近认证和幂等键；写入 confirmRequestId 与 accepted；阻止账号新活动；撤销网站/移动会话并使关联媒体 grant 无效；创建可恢复 outbox。不能先撤销会话后才尝试写任务或依靠不可靠的内存入队。

同账号最多一个未结束的准备/删除流程，并发设备不能创建两次破坏性任务。所有相关账号入口要尊重该访问阻止标记。删除执行可分阶段重试，但每阶段幂等；外部队列发布失败由已提交 outbox 补偿。删除任务最小状态和 receipt 哈希独立保留至查询期限，不被账号外键级联提前删除。

#### 16.3.4 网络失败与重启恢复

| 失败或查询结果 | 必须处理 |
|---|---|
| prepare 响应丢失 | 原 receipt 和请求 ID 已保存；查询同一任务，或使用仍有效认证重试同一 prepare。不会因准备自动删除账号。 |
| prepare/confirm 前本机存储失败 | 不发送后续请求；明确提示稍后重试。不能造成服务器已撤销会话而本机没有查询凭据。 |
| confirm 响应丢失、超时或 App 被结束 | 下次进入先展示“正在确认删除进度”，用原 receipt 查询，不要求再次登录，不创建新删除任务。 |
| status 为 accepted/processing/retrying/attention_required | 显示实际进度，停止账号功能，定向清理认证与个人缓存，保留查询凭据。失败重试由后台任务执行。 |
| status 为 completed | 显示已完成规定范围处理；保留可查询结果至凭据到期或用户明确清理进度凭据。 |
| status 为 prepared | 只说明当前快照尚未显示受理；若原 confirm 可能在途，继续查询。用户可主动重试同一 confirm，不在 App 重启时自动重新确认。 |
| status 为 preparation_expired | 不创建删除任务；用户要继续需重新完成明确的准备和确认。 |
| 查询超时或 503 | 状态保持未知/处理中，有限重试，不能宣布成功或失败，不能重新注册或换 ID 盲目删除。 |
| receipt 无效、过期、本机丢失或换设备 | 不凭公开 ID、邮箱或已撤销 Bearer 下发新秘密；提供经过身份核验的支持路径，不能自动承诺可恢复。 |

客户端默认前台按 2/4/8/30 秒有限查询，一次最多 5 次，之后保留手动刷新和进度入口，不无限后台轮询。任何前台查询都只能读取状态；不能在重启或网络恢复时隐式作出新的破坏性确认。

prepared 状态查询和 confirm 的竞态以原子确认与强一致状态读取处理。一次 prepared/404 结果不能证明稍后不会有在途确认提交；因此不能自动放弃旧 ID、建立第二个删除流程或声称用户已取消。若账号认证仍有效，也须通过既有任务归属和唯一约束恢复原任务。

#### 16.3.5 查询凭据的最小权限

receipt 是只读任务查询凭据，可在默认 14 天期限内多次使用，不是读取一次即失效。它不能获得个人资料、暂停/取消删除、登录、支付或转移会员。查询限制请求频率与输出字段，使用 no-store；凭据和哈希不写普通日志。

查询到期不等于删除任务终止；异常任务继续恢复并告警。若实际处理超过 14 天，支持渠道须有受控核验办法，不能开放仅凭邮箱或任务 ID 的公开查询。App 清除进度凭据前提示本机将失去自动查询能力；这不取消已经受理的删除。

已删除账号再次注册不继承原数据或订阅绑定。未到期苹果订阅的恢复需求走可验证、有审计的支持流程，同名邮箱不能自动转移。最小必要交易关联记录限制访问、用途和保留期限。

## 17. 内容与 App Store 发布要求

### 17.1 持续价值与技术架构

原生架构不构成审核保证。App 必须提供实际可用、足够完整的音乐体验，不能只有空曲库或宣传页面；功能描述、截图和实际版本一致。审核要求在提交前重新核对。[S13]

首版按符合条件的音乐内容消费 App 规划，允许登录访问已有权益。Reader App 包含音乐，但具体资格由实际产品和审核决定。[S14]

不申请 External Link Account Entitlement 作为首版依赖。该外链授权与同时提供 iOS 内购存在资格限制；本项目默认不做外链购买，因此 v1.1 加入内购时不会依赖这一授权。不同店面的其他规则仍需在发布时核对。[S14]

### 17.2 登录与删除

自有账号登录继续使用 Station Cat 体系；若后续引入第三方登录，重新核对苹果 4.8 条款。免费内容无需强制登录。账号创建、删除、隐私和支持入口均必须可用。[S11][S13]

### 17.3 内容授权

每首商业发布的曲目应有生成/制作记录、适用商业使用依据、歌词和封面授权、必要的内容标记以及负责人核对状态。不得把“AI 生成”自动视为全部素材拥有排他版权。

Suno 的适用授权应按相关条款及每首作品的实际生成/取得记录核验；本次未验证用户的套餐和曲目证据。[S15] 原后台若已有版权审核流程继续保留，App 不增加绕过发布审核的路径。

### 17.4 内购提交

首次加入内购或订阅需要随 App 新版本提交，按照 App Store Connect 完成商品信息和审核材料。[S16] 配置未就绪不影响先做本地 StoreKit 测试，但不能据此宣称真实购买已通过。

提交材料包含：真实截图、准确名称和类别、隐私和条款、支持联系方式、账号删除路径、免费/试听/会员规则、可用审核账号、可测试曲目、审核说明、订阅恢复和管理步骤。Age Rating、构建 SDK、隐私 API 原因声明和目标地区要求在发布前核对。[S01][S10]

本项目不默认全球上架。具体店面、主体资质、内容分发资格与本地运营要求属于发布前检查项，未完成的地区不勾选发布。

### 17.5 审核说明草稿

下面是待按实际实现更新的英文材料，不能将未完成能力写进提交版本：

```text
Station Cat Music is a native music listening app for the Station Cat catalog.
Users can listen to free tracks without signing in. Eligible existing Station Cat
members can sign in with the same account to access covered music.

The app provides background audio, Lock Screen controls, a playback queue,
favorites, and listening history. Account deletion is available in Settings.

For the subscription release: Music VIP provides music access only. It does not
include novels, software, games, or Station Points. Purchases are handled through
Apple In-App Purchase. Restore Purchases and Manage Subscription are available
from the Music VIP screen.

Review account, test tracks, environment details, and exact verification steps:
[Complete with working information before submission.]
```

## 18. 性能、成本与可观测性

### 18.1 设计目标

下列数值用于建立测试目标，必须记录测试设备、网络、内容规模、构建版本和样本数。没有实测不得标成已达标。

| 项目 | 首期目标 |
|---|---|
| 冷启动到可操作骨架 | 代表设备上 P95 不超过 2 秒；内容加载另计。 |
| 正常网络首次出声 | 指定测试网络下 P95 不超过 3 秒，至少 100 次样本。 |
| 公开列表/权益 API | 指定地区测试 P95 不超过 800ms；Apple 外部查询单独计量。 |
| 播放授权 API | 正常业务路径 P95 不超过 1 秒，不包含用户认证交互。 |
| 长时间播放 | 连续 2 小时锁屏测试无应用自身引起的中断或异常内存增长。 |
| 操作稳定性 | 连续 200 次切歌、拖动、暂停和恢复不重复播放、不崩溃。 |
| 耗电与网络 | 无每秒网络轮询、无重复完整文件下载；与同机基准相比记录差异。 |
| 订阅交付 | Apple 交易可验证且依赖正常时，后台确认后 5 秒内可读取权益作为测试目标。 |

### 18.2 费用模型

首期费用主要来自开发者账号、现有 Worker 与数据库请求、R2 存储及读取操作、日志、可能的邮件服务和后续 Apple 交易处理。不要将“使用 R2”理解为整个音乐服务没有任何调用或运营成本。

按实际账单和最新供应商价格计算，不在配置中把费用写死。基础估算公式：

```text
单曲存储字节 ≈ 音频码率(bit/s) × 秒数 ÷ 8
月请求量 ≈ 播放次数 × 每次实际媒体/鉴权请求数 + 页面及后台任务请求
月收入 = 按币种核实的有效支付金额 - 渠道费用 - 税费 - 退款等
可用经营余量 = 月收入 - 基础设施 - 内容制作 - 运维及其他成本
```

MP3 Range 请求次数由播放器、拖动和网络状态决定，应从真实测试取得，不能一律按每首歌一次请求估计。增加短期 grant 和每次媒体校验也会产生数据库开销；先测量再决定安全的缓存或优化方案。

### 18.3 必须观察的指标

客户端关注启动失败、首次播放延迟、缓冲、播放失败码、音频中断、歌词解析失败、登录和刷新失败。服务端关注 API 错误率、媒体读取失败、鉴权耗时、拒绝原因、数据库时间、清理任务失败和限流。

v1.1 增加购买未交付、通知积压、验签失败、账号冲突、异常退款、恢复失败、对账滞后和交易投影不一致。每个真实订单应能使用受控内部 ID 追踪，不需要把用户邮件、完整交易或媒体凭据暴露给客户端日志。

### 18.4 初期告警与处置

建议将持续 5 分钟的显著错误率提升、通知积压超过 15 分钟、已验证购买长期未交付、迁移异常及数据库失败设为告警条件。阈值按真实基线校准，不能依赖固定百分比掩盖小流量下每笔付费失败。

支付故障的首要动作是停止新的购买引导并保持已有权益和通知记录；媒体故障优先恢复流式读取，不能通过开放私有桶临时解决；鉴权异常优先保守拒绝新授权并记录影响，随后核实并补偿受影响的合法用户。

## 19. 测试策略与验收矩阵

### 19.1 测试分层

单元测试覆盖状态机、时间边界、权益聚合、DTO、歌词解析、同步冲突和错误映射。集成测试覆盖数据库、认证交换、媒体 Range、事务幂等和迁移。UI 测试覆盖核心流程、空状态、四语布局和无障碍。真机专项负责锁屏、音频路由、认证回调和内购。现有网站测试必须继续运行。

所有自动化夹具使用虚构账号、授权测试素材和隔离数据库。不得把生产 Cookie、真实密码、Apple 私钥或真实交易敏感信息提交到测试仓库。

### 19.2 P0 验收矩阵

| ID | 场景 | 必须结果 | 版本 |
|---|---|---|---|
| A01 | 老账号登录 App | 回到同一用户 ID，没有创建重复用户。 | 1.0 |
| A02 | 用户取消系统认证窗口 | 返回原页面，不循环弹窗。 | 1.0 |
| A03 | 错误/过期/重放授权码，错误 PKCE 或 state | 拒绝，无会话泄露。 | 1.0 |
| A04 | 修改回调地址、开放重定向尝试 | 精确白名单拒绝。 | 1.0 |
| A05 | 多请求同时令牌过期 | 一次刷新，各请求最多重试一次。 | 1.0 |
| A06 | 刷新响应丢失，120 秒内按持久化 ID 重试 | 同 token 对、同期限，无重复轮换或误撤销。 | 1.0 |
| A07 | 已消费旧刷新令牌以新 requestId 重放 | 验证真实 token 绑定后撤销对应家族；未知 token 不能按客户端 familyId 撤销他人。 | 1.0 |
| A08 | 退出、重置凭据、账号限制 | 对应会话失效，VIP 媒体不可继续申请。 | 1.0 |
| A09 | 切换 A/B 账号 | 收藏、历史、待同步任务及权益互不串号。 | 1.0 |
| A10 | pending 已存，HTTP 尚未发送就结束 App | 重启恢复原 ID 和旧代；服务器只轮换一次。 | 1.0 |
| A11 | 服务端已提交，响应未达就结束 App | 重启 120 秒内用原 pending 获取原结果，不误撤销。 | 1.0 |
| A12 | 收到响应但新 envelope 尚未保存就崩溃 | 恢复旧 token + 原 pending，原子保存后再发布成功。 | 1.0 |
| A13 | 新 envelope 保存后、内存发布前崩溃 | 读到新代且无旧 pending，不回退或重放旧代。 | 1.0 |
| A14 | 120 秒后重启，同 pending 有已提交/未发送两种状态 | 已提交返回恢复过期并重新认证、不误撤销；未发送的原操作可正常执行。 | 1.0 |
| A15 | pending 保存失败，或轮换结果保存失败 | 前者零 HTTP 发送；后者不发布新 token、不启动下一代，保留可恢复旧状态。 | 1.0 |
| A16 | 首次解锁前 Keychain 不可读 | 等待可读，不删记录、不新造 requestId、不误当游客登录成功。 | 1.0 |
| A17 | 刷新在途时退出、删除或切换账号 | 迟到成功丢弃，不复活会话、不串号、不清除删除查询凭据。 | 1.0 |
| A18 | 并发刷新、CAS 失配、事务任一步失败 | 只有一个有效下一代；操作记录与令牌同成同败，无半提交。 | 1.0 |
| A19 | 同操作重试，但服务端已推进到更高代 | 返回 superseded，不下发过时 token、不撤销合法更高代。 | 1.0 |
| A20 | 同 requestId 修改请求内容 | 稳定冲突错误，无第二次轮换或凭据泄露。 | 1.0 |
| A21 | 短期结果清理后、或家族撤销后收到旧请求 | 同操作墓碑仍可识别；撤销后绝不重放原成功凭据。 | 1.0 |
| E01 | 游客免费完整播放 | 无需登录，服务端确认当前为免费。 | 1.0 |
| E02 | 普通用户请求 VIP full | 被服务端拒绝，无法取得完整资源。 | 1.0 |
| E03 | 独立试听 | 返回独立试听资产，无法改变参数升级为 full。 | 1.0 |
| E04 | 现有全站 VIP | 音乐及原有其他服务按旧规则正常。 | 1.0 |
| E05 | 音乐会员聚合模型测试 | 音乐允许，小说与积分权限不增加。 | 1.0 模型、1.1 实际 |
| E06 | 两种会员重叠，一种到期 | 其他有效来源继续生效。 | 1.0 模型、1.1 实际 |
| E07 | 权益服务返回 503 | 不误报会员已退款/到期；不延长当前媒体硬截止，到点暂停。 | 1.0 |
| E08 | 限时免费转 VIP、抢先听策略变化 | 以服务端最新策略为准。 | 1.0 |
| E09 | 曲目下架、版本更新 | 下架拒绝；版本冲突刷新且不播放旧受限资源。 | 1.0 |
| E10 | 硬截止时权限请求持续 503 或超时 | 截止任务先暂停、取消媒体、清理 PlayerItem；不 await 网络完成。 | 1.0 |
| E11 | 软校验失败但尚有已验证播放时间 | 当前缓冲可用至原硬截止；不新增无授权曲目，不滚动延长。 | 1.0 |
| E12 | 截止暂停后收到有效新 grant | 更新状态但不自动播放，用户主动操作后才出声。 | 1.0 |
| E13 | 截止前明确拒绝，稍后旧成功结果到达 | 立即暂停，旧结果不得撤销拒绝或启动音频。 | 1.0 |
| E14 | 改系统时间、设备休眠、重启恢复旧缓存 | 连续单调时钟不延长预算；新进程重新授权。 | 1.0 |
| E15 | Retry-After 或刷新重试时间晚于硬截止 | 到点仍暂停，不将等待期当作宽限。 | 1.0 |
| E16 | 新 grant 到达已过期、时间缺失或与会话不符 | 不安装授权；安全裕量、RTT 与序号校验有效。 | 1.0 |
| M01 | HEAD/GET、普通和尾部 Range | 长度、200/206、Content-Range 正确。 | 1.0 |
| M02 | 越界 Range、If-Range 命中/不命中 | 符合契约，保留旧网站行为。 | 1.0 |
| M03 | 同一 grant 多次并发 Range | 可合法拖动，不按首次请求就作废。 | 1.0 |
| M04 | grant 用于其他曲目/版本/账号/会话 | 逐次校验实际 Bearer 与资源绑定并拒绝；不能只从 grant 反查账号。 | 1.0 |
| M05 | grant 过期、账号撤销、权限撤销 | 新媒体请求拒绝；原源停止，重新获准后仍需用户主动播放。 | 1.0 |
| M06 | 私有音频缓存与日志 | 无公共缓存泄露，无明文 grant/Authorization 日志。 | 1.0 |
| M07 | 只复制 A 的 VIP URL，分别 GET/HEAD/Range | 全部缺少实际会话认证而拒绝，无 R2 媒体交付。 | 1.0 |
| M08 | A 的 VIP URL 搭配 B 的有效 Bearer，B 也为 VIP | accountId 不匹配，403，不回退或重新绑定。 | 1.0 |
| M09 | A 的 grant 搭配 A 另一设备会话 Bearer | sessionId 不匹配；该设备须申请自己的 grant。 | 1.0 |
| M10 | A 原会话正常刷新 token 后继续 Range | sessionId 稳定，在 grant 有效期内合法请求成功。 | 1.0 |
| M11 | 真机资源加载、拖动、取消、锁屏后再次加载 | 每次实际请求均携带正确 Bearer，取消与有限缓冲正确。 | 1.0 |
| M12 | 篡改 authMode、将 full 伪装 public/preview | 服务端拒绝；公开免费路径也尊重到期策略。 | 1.0 |
| M13 | 条件请求、CDN 缓存、3xx 和鉴权依赖失败 | 不绕过认证、不向其他域转发凭据、503 不返回付费音频。 | 1.0 |
| P01 | 锁屏连续播放两小时 | 播放和系统信息一致，无自身引起的停止。 | 1.0 |
| P02 | 耳机播放/暂停/切歌及系统进度跳转 | 与 App 状态一致，没有双重播放器。 | 1.0 |
| P03 | 来电和其他音频中断 | 正确暂停，按用户意图恢复。 | 1.0 |
| P04 | 蓝牙耳机断开 | 默认暂停，不突然外放。 | 1.0 |
| P05 | Wi-Fi/蜂窝切换和断网恢复 | 有限重试，无无限重缓冲循环。 | 1.0 |
| P06 | 快速点 A/B、切页面、进入账号 | 最后用户指令胜出，页面不重建播放。 | 1.0 |
| P07 | 全队列不可用 | 停止并解释，不无限跳歌。 | 1.0 |
| P08 | 试听从中段开始并显示 LRC | 高亮与原歌曲时间对应。 | 1.0 |
| P09 | 到期、定时结束、系统时间修改 | 不依赖墙上时钟延长权限，不自动续播。 | 1.0 |
| P10 | 真机锁屏，全曲已预缓冲，截止前后持续超时/503 | 执行硬截止停止，不播至曲终；记录系统管线残余与调度误差，不声称 DRM。 | 1.0 |
| P11 | AirPlay/系统输出切换与认证资源加载 | 支持路径不去掉 Bearer、不转为匿名 VIP URL；未验证路径不宣称支持。 | 1.0 |
| L01 | 离线收藏与服务器同时修改 | 冲突明确、幂等、无无限覆盖。 | 1.0 |
| L02 | 删除历史、关闭历史 | 服务端清理/停止新增，非仅隐藏 UI。 | 1.0 |
| L03 | 游客登录与合并 | 仅按明确选择合并，不丢原有数据。 | 1.0 |
| S01 | 四语、最大动态字体、VoiceOver | 核心按钮可访问，长标题不挡控制。 | 1.0 |
| S02 | 有效订阅账号准备并确认删除 | 清楚提示续费与全站影响；已保存进度凭据，确认受理后可查询至完成。 | 1.0/1.1 |
| S03 | 删除失败与重试 | 不假报完成，可监控、可恢复。 | 1.0 |
| S04 | prepare 响应丢失后重启 | 预存 receipt 可查询，原 ID 可幂等恢复；账号未因准备被撤销。 | 1.0 |
| S05 | confirm 已提交但响应丢失，所有会话已撤销 | 原 receipt 无需登录即可查到 accepted/processing/completed，不创建第二任务。 | 1.0 |
| S06 | 删除确认在途时退出 App，重启或登录 B | 只恢复原任务查询，不自动确认删除、不混用 B 凭据。 | 1.0 |
| S07 | 删除 envelope 存储失败或确认前 receipt 不可读 | 不发送破坏性确认；无先撤销会话再寻找回执的路径。 | 1.0 |
| S08 | receipt 访问其他任务、账号资料、确认/取消接口 | 只读本任务最小状态，越权全部拒绝。 | 1.0 |
| S09 | prepared 超时且从未确认 | preparation_expired，账号保持正常，无删除任务执行。 | 1.0 |
| S10 | confirm 事务失败、outbox 发布失败、查询 503 | 事务同成同败；已提交 outbox 可恢复；查询失败不假报完成。 | 1.0 |
| S11 | receipt 超期、丢失或设备更换 | 受控支持路径，不凭邮箱/公开任务 ID 下发秘密，不推断删除结果。 | 1.0 |
| S12 | 账号行已清理，但 receipt 仍在查询有效期 | 最小任务结果仍可读，无已删除账号资料泄露。 | 1.0 |
| S13 | 两设备并发准备、重复确认、prepared 查询与在途确认竞争 | 一个逻辑删除，旧 ID 恢复；不自动另建任务，不因快照误报取消。 | 1.0 |
| S14 | 登出、清缓存与账号切换 | 独立删除查询凭据保留；用户明确清理进度凭据不取消服务端删除。 | 1.0 |
| B01 | StoreKit 成功购买 | 后端 verified 并入账后才交付音乐权益。 | 1.1 |
| B02 | 用户取消/Ask to Buy pending | 不开通，不显示已扣款完成。 | 1.1 |
| B03 | 客户端未验证、伪造 JWS、错误商品 | 拒绝，不能触发全站会员写入。 | 1.1 |
| B04 | 支付后断网/杀进程 | 重启可恢复，重复提交只一笔逻辑交易。 | 1.1 |
| B05 | 交易属于 A，当前登录 B | 不迁移绑定；显示可解决的冲突路径。 | 1.1 |
| B06 | 网站仅音乐会员访问小说 | 小说继续拒绝，原积分余额不变。 | 1.1 |
| B07 | 自动续费关闭但尚未到期 | 音乐保留到真实有效期结束。 | 1.1 |
| B08 | 宽限、扣款重试、宽限结束 | 按验证状态处理，无自造宽限。 | 1.1 |
| B09 | 退款与旧续费通知乱序 | 不复活退款期间，不误伤其他有效来源。 | 1.1 |
| B10 | 上一期退款、下一期仍有效 | 保留合法下一期权益。 | 1.1 |
| B11 | 退款撤销 | 仅恢复经验证应恢复的期间。 | 1.1 |
| B12 | 同通知重放/不同设备提交同交易 | 唯一约束与投影均幂等。 | 1.1 |
| B13 | 通知遗漏、持久化失败、队列积压 | 保留可重试语义，补偿核对可恢复。 | 1.1 |
| B14 | Sandbox/本地交易混入生产 | 隔离有效，真实收入和普通用户权益不受影响。 | 1.1 |
| B15 | 审核账号测试 Sandbox 购买 | 正式构建可完成已说明的审核流程。 | 1.1 |
| B16 | 下架新购买入口 | 已有订阅、通知、恢复和管理继续工作。 | 1.1 |
| B17 | App Store 商品或价格加载失败 | 无假价格、无不可用购买入口。 | 1.1 |
| B18 | Apple 收费成功，后台交付失败 | 清楚显示处理中，不引导重复付款。 | 1.1 |
| R01 | 现有网站登录/积分购买/兑换/小说 | 原回归全部通过。 | 每阶段 |
| R02 | 数据库迁移/旧客户端/回滚演练 | 无旧权益回退，无真实交易丢失。 | 每阶段 |

### 19.3 测试设备与环境

至少使用最低支持系统的代表设备、较小屏幕设备和当前支持系统的实际设备；其中一台连接蓝牙耳机。没有指定型号时按测试机实际能力记录，不凭浏览器宽度替代真机。

运行本地 StoreKit 测试、Sandbox 和 TestFlight 测试，并分别留存结果。Apple 真实生产交易需要独立授权和财务安排，不能由 Codex 自动发起购买验证。

### 19.4 四项规格的故障注入要求

测试用可控制的时钟、可丢弃指定响应的代理、可中断的持久化层和隔离数据库。以下属于待实施测试方案；文档校对或示例推演不能作为业务测试通过证据。

播放：把 grant/权益截止缩短至测试用短期限，预缓冲音频，在到期前持续注入 503、超时和 429；断言到点触发 pause、取消 URLSession、移除 PlayerItem，系统播放状态归零，迟到允许结果不自动发声。分别测前台、锁屏与音频输出切换。

刷新：在“pending 已写未发送、服务端已轮换未返回、响应已到未保存、新记录已存未发布”四个断点强制结束进程。重启检查 requestId、旧/新 generation、服务端轮换计数及 family 撤销原因。另跨越 120 秒窗口和短期密文清理任务验证墓碑分流。

删除：在 prepare 与 confirm 的每一侧分别丢响应、结束客户端和中断队列发布；确认本机始终在可能发生破坏性请求前拥有 receipt。撤销全部会话后只使用查询认证恢复，测试账号行清理后查询记录仍存续，以及误删本机缓存不会再发送新确认。

媒体：记录实际请求方法及“认证是否存在/匹配”的布尔断言，不记录令牌；覆盖无 Bearer、B 的 Bearer、同账号其他 session、合法刷新后的本 session，并验证被拒绝路径未调用 R2 交付。复制 URL + 原会话完整 Bearer 不属于本版防盗验收承诺，须在威胁模型中明确。

### 19.5 完成证据

每个任务附提交 SHA、实际执行命令、测试摘要、关键截图或录屏、未覆盖项、风险和回退方式。禁止把跳过、环境缺失、Mock 成功或只做静态检查写成全部通过。

## 20. 实施阶段、任务与下一阶段输入

### M0：基线审计与技术验证

输入：本文、两个代码工作区（iOS 尚无则建立本地空工程）、现有仓库 AGENTS.md、实际生产发布记录和可用测试环境。

任务：确认最新 main 与生产版本差异；只读盘点账号/注册/密码重置/二步验证/注销/会员/音乐/积分/发布流程；核验现有收藏历史接口；确认绑定与数据模型。用隔离测试数据验证 AVAssetResourceLoaderDelegate + URLSession 的 MP3、grant + Bearer、Range、锁屏与 HTTPS 认证回调；演示 URL 单独转发/跨账号/跨会话拒绝及到期超时暂停。完成刷新 journal、删除准备/确认/查询及存储原子性的最小可执行实验；选择当前受支持工具链，冻结 API 约定和 Bundle ID 候选。不得把这些实验直接连到生产删除或刷新写接口。

交付：`docs/baseline-audit.md`、`docs/decisions/ADR-001-architecture.md`、`docs/decisions/ADR-002-security-recovery.md`、接口清单、风险清单和运行时验证记录。ADR-002 必须逐项说明四项修订、威胁边界、时限、失败状态和崩溃断点。注明 Mock、模型实验、真实隔离后台与实体设备各自证据，不能混称完成。

验收：没有擅改生产数据；明确每个可复用模块与缺口；关键技术阻碍有证据。没有真机或签名条件时先完成可执行的本地部分，将相关发布关卡保留为未通过。

下一阶段输入：审计文件、冻结的认证/媒体方案、经过确认的迁移清单和契约。

### M1：工程骨架、契约与测试基础

任务：创建 SwiftUI 工程、配置环境与统一设计令牌，建立 APIClient、错误模型、缓存作用域和依赖注入；提交 OpenAPI、虚构 fixtures、Mock 服务以及 iOS/后端 CI；声明支持系统和语言。

交付：可启动的三标签 App、可执行单元测试、自动化构建方案和 README。尚未实现的后台接口不伪装为已上线。

验收：无硬编码生产令牌、无默认连接生产写接口；测试可复现，页面可访问；CI 能明确报告未配置的签名步骤。

下一阶段输入：固定接口版本、测试夹具、工程目录与构建命令。

### M2：统一认证与账号生命周期

任务：实现专用认证页、授权码交换、稳定设备 session 和持久化刷新操作；完成结果幂等、墓碑清理及 Keychain 原子切换。接入 App；实现删除准备、明确确认、独立 receipt 查询与 outbox；退出/删号与迟到刷新互斥。不扩大全站付款 UI。

交付：认证端到端测试、账号隔离测试、删除任务处理与状态查询；安全边界说明。

验收：A01 至 A21、S02 至 S14 的适用 v1.0 项目及相关故障注入通过；老网站认证回归通过。必须包含真实进程终止与 Keychain 恢复证据。注册与找回保持现有安全要求，不能跳过二步验证以换取登录成功。

下一阶段输入：稳定 principal 接口、会话撤销机制、Keychain 策略与错误映射。

### M3：权益适配与媒体后端

任务：抽出音乐细分权益决策，先只接入已有全站 VIP；实现 grant + 独立会话逐次认证、authMode 约束、硬截止和有限授权重取；复用 Range 和资源验证；添加 music-only 隔离模型及 URL 转发负向测试；保护旧会员语义。

交付：增量迁移、接口集成测试、旧/新决策影子对照记录和媒体真机验证。

验收：E01 至 E16、M01 至 M13 的适用后端/集成项目；不能出现付费资源匿名访问或音乐权限提升小说权限，不能只有 grant 元数据绑定而缺少实际请求者匹配。客户端暂停专项在 M4 完成。

下一阶段输入：可真实播放的测试曲目、权限 fixtures、媒体错误矩阵和经过验证的音频 URL 行为。

### M4：原生播放与内容界面

任务：实现发现、曲库、详情、专辑、单实例播放器、队列、歌词、后台和系统控制、睡眠定时及深链。完成音频状态机单测和真机中断测试。

交付：可连续听歌的测试版本、四语页面、锁屏和耳机验证材料。

验收：P01 至 P11、E10 至 E16 的客户端项目、无障碍与基础性能目标有真实结果。到期任务必须能独立于超时网络暂停当前源；失败项可定位，不用不受控重试掩盖。

下一阶段输入：稳定播放器接口和当前性能/兼容性记录。

### M5：个人音乐库与 v1.0 发布准备

任务：收藏和历史同步、游客隔离、缓存清理、设置/隐私/条款、网站必要适配；完整回归和 TestFlight；整理内容授权与审核材料。

交付：v1.0 候选构建、后台发布清单、隐私数据清单、测试报告、回滚方案、审核说明。

验收：全部 v1.0 P0 通过；未实现的购买功能不出现在正式 UI；生产变更经过单独授权。

下一阶段输入：已发布版本行为基线、旧客户端契约、真实用户反馈和可用内购配置。

### M6：苹果订阅后端

任务：冻结商品和价格候选、验证官方验签库运行；建立交易/通知/绑定/对账数据；实现环境隔离、权益投影和音乐网页识别；暂不开放新购买。

交付：Apple Sandbox 验证报告、服务端安全与乱序测试、独立音乐权限回归。

验收：伪造交易无法授权，重复通知幂等，客户端换账号不能转移购买，Sandbox 不污染生产，音乐用户不能阅读受限小说。

下一阶段输入：稳定购买/验证接口、商品 ID、appAccountToken 绑定规则、恢复协议和测试账号。

### M7：StoreKit 客户端与 v1.1 送审

任务：实现真实商品展示、购买/监听/恢复/管理、账号冲突和交付中状态；完成 B01 至 B18；更新隐私和审核说明，提交新版本和订阅商品。

交付：v1.1 候选构建、StoreKit/Sandbox/TestFlight 结果、购买故障手册与审核素材。

验收：所有付费 P0 通过；月价和权益一致；产品负责人确认价格、地区、协议和提交。没有通过相关配置检查时停止在测试阶段。

下一阶段输入：生产已验证指标、订单异常清单、真实内容需求。

### M8：后续优化

根据真实故障和使用情况优先改进可靠性，再单独开发听众评分、用户歌单、年付、离线或其他平台。增加权益时更新能力矩阵、商品说明、数据结构和老会员保护策略，不修改既有商品含义而不作迁移。

## 21. 发布、配置与回退清单

### 21.1 配置项

| 项目 | 要求 |
|---|---|
| Bundle ID / Team ID | 使用已确认值，示例不能进入实际发布配置。 |
| Dev / Staging / Production API | 显式环境配置，不根据随机请求参数切换数据源。 |
| Associated Domains / AASA | 只允许认证回调和已验证音乐深链路径；真机验证。 |
| Background Audio | 与真实播放器能力一致，不开启无关后台模式。 |
| 数据库与 R2 绑定 | 复用已核实环境，不覆盖未知生产资源。 |
| Native auth secrets | 服务端受控存储、可轮换；安装包内无固定认证密钥。 |
| Apple 商品和组 | v1.1 前确认 ID、地区、真实价格、宽限、家庭共享关闭。 |
| Apple Server API 配置 | 正确环境、Bundle ID、App Apple ID、签名密钥和信任配置。 |
| Webhook / 任务系统 | 可接收、可持久化、可重试、可查询死信。 |
| 购买开关 | 只控制新购买，不控制已经售出权益是否兑现。 |
| 支持及法律页面 | 实际存在、可从 App 打开、与本版本数据和价格一致。 |

### 21.2 v1.0 发布前

完成代码和数据库备份/恢复演练；核对生产发布基线；迁移先上兼容后端再发布依赖它的客户端；所有主功能真机验收；外部购买入口排查；账号删除可完成且确认响应丢失仍可查询；四项新增安全恢复故障注入通过；隐私申报和内容授权完整；审核账号可用；版本号、截图、实际功能一致。

### 21.3 v1.1 发布前

除 v1.0 项目外，增加商品可用性、协议税务银行资料状态核验、服务端验签、实际 Sandbox 通知、恢复、退款、账号冲突、双会员覆盖、停新购继续服务、漏通知补偿和本地交易隔离测试。

本次交付不读取或修改用户的 Apple 财务资料，也不代办协议、真实交易或上架提交。

### 21.4 发布后观察

从灰度或有限范围发布开始，观察播放、认证和权益错误以及支持反馈。发生有实际影响的回归时暂停扩量。对收费后未交付用户提供明确处理与支持，不以后台日志“成功”替代用户实际可播放的验证。

## 22. 风险登记与禁止事项

| 风险 | 优先级 | 处理要求 |
|---|---|---|
| 音乐月付写入全站 VIP 表 | P0 | 独立交易与权益来源，小说负向测试。 |
| Cookie 方案直接搬到原生导致播放无权限 | P0 | 独立设备会话与受限媒体适配，真机验证。 |
| 完整文件先下发再做试听限制 | P0 | 只下发独立试听资源。 |
| URL 绑定账号却未认证实际请求者 | P0 | 每次媒体请求验证 grant + Bearer，逐项比对 accountId/sessionId。 |
| 已到期但查询超时/503 时一直播放 | P0 | 硬截止独立暂停并清理受保护源，失败不续期，恢复后不自动发声。 |
| 删除确认响应丢失导致无法查询 | P0 | 先持久化 receipt，再准备/确认；独立查询认证与持久化 outbox。 |
| 刷新中止后生成新 requestId 误触发重放 | P0 | 持久化原操作、原子换代、短期结果与墓碑分离；无 journal 时重新认证。 |
| 交易绑定到当前登录的错误账号 | P0 | verified appAccountToken + 原始订阅链唯一绑定。 |
| 通知重复/乱序改变错误期限 | P0 | 唯一约束、状态重建、补偿查询。 |
| 先 finish 后服务端交付失败 | P0 | 持久化交付后确认，保留恢复队列。 |
| 关购买时关掉老用户权益 | P0 | 开关边界分离，付费回归。 |
| App 删除账号后苹果仍续费 | P0 | 明确提示和系统管理入口，立即删除仍可用。 |
| 原生代码编译但锁屏行为错误 | P0 | 真机长时音频测试。 |
| 生产源与 main 不一致 | P0 | 发布前基线核验，不直接覆盖生产。 |
| Apple 验签库无法完整运行 | P0 | 提前技术验证，禁止关闭验签绕过。 |
| 同一账号收藏/历史跨端冲突 | P1 | 有版本、幂等与明确合并策略。 |
| 只有少量内容而承诺长期大量更新 | P1 | 按实际可提供内容描述持续价值。 |
| 低价订阅无法覆盖运营成本 | P1 | 观察真实调用和付费数据，价格变更另评估。 |
| 升级后台破坏旧版 App | P1 | 契约版本和兼容窗口测试。 |

以下做法禁止进入生产：全局 `isVIP` 放行；信任客户端传来的期限；仅解码 JWS 不验签；为了测试关闭 TLS；开放私有 R2；使用审核专用隐藏功能欺骗审核；未经审查开外部购买；删除真实订单以回滚；把模拟器结果称为实体 iPhone 验收；在未确认的地区自动全球发布。

## 23. Codex 执行规范

一次只完成一个明确里程碑，先读仓库 AGENTS.md 和真实 Git 状态，保留用户未提交改动。本文的占位 ID、URL 示例、fixtures 和默认数值不能被误当成现网事实。

每次交付按“本阶段目标、实际改动、测试与证据、兼容性、未完成项、下一阶段输入”说明。安全关键行为必须有自动化负向测试；不能把 TODO、空实现或 Mock 作为完成。

除非用户另外明确要求，不创建远端仓库、不提交或合并 PR、不部署 Worker、不运行生产迁移、不改支付配置、不创建真实订阅、不接受开发者协议、不执行真实扣款、不提交 App Store 审核。可以在授权的本地开发目录完成代码与测试。

需要额外配置时列出具体缺项，同时继续完成不依赖该项的本地工作。无法签名或连接真机时照实记录，禁止用截图或假日志填补。

### 23.1 每个 PR 的最小说明

```text
里程碑及对应文档章节：
修改范围：
现有行为是否改变：
数据库/接口兼容策略：
自动化测试及实际结果：
真机测试及实际结果：
尚未验证项：
安全和隐私影响：
发布与回退条件：
下一阶段输入：
```

## 24. 开发开始与发布前待办

### 24.1 不阻塞本地开发

最终 App 名称、Bundle ID、品牌图标、启动页素材、四语最终文案、支持联系信息、生产域名回调具体路径，可以先用明确标识的开发占位，随后冻结。不得把占位内容提交到商店。

### 24.2 阻塞真实联调或发布

真实认证流程及测试账号；数据库迁移权限与隔离环境；媒体素材授权；Apple Developer 和签名能力；AASA 域名控制；官方库验签兼容；内购协议及真实商品；测试/生产交易隔离；账号删除保留政策；上架店面及所需资格；可用真机和全部 P0 验收。

### 24.3 规格变更规则

新增权益、更改定价范围、修改账号绑定、开放离线、加入第三方支付、改变老会员权益或扩大平台范围，必须更新本文版本、兼容策略和测试矩阵。页面样式微调可以在不改变业务行为的前提下单独提交。

## 25. 参考来源与核验范围

原文资料核验日期：2026-09-15。本次 v1.0.1 针对四项规格核对并新增 [S17] 至 [S21] 的安全/接口依据；[S01] 至 [S16] 作为原文参考保留，没有在本次逐项重新验证。外部平台规则会变化，开发和提交时复核。下列链接用于追踪依据；模块划分、120 秒恢复窗口、2 秒裕量、14 天查询期限、状态机及故障注入要求均属于本项目设计，不代表平台规定。

### 25.1 现有代码基线

[R01] 主线核验提交：
https://github.com/xdgf558/caption-ai-landing-site/commit/f0537685bc6f90df437997ee6a885a63fe03b037

[R02] 音乐公共接口：
https://github.com/xdgf558/caption-ai-landing-site/blob/f0537685bc6f90df437997ee6a885a63fe03b037/src/music/publicHttp.js

[R03] 曲库与公开投影：
https://github.com/xdgf558/caption-ai-landing-site/blob/f0537685bc6f90df437997ee6a885a63fe03b037/src/music/catalog.js

[R04] 现有音乐会员读取：
https://github.com/xdgf558/caption-ai-landing-site/blob/f0537685bc6f90df437997ee6a885a63fe03b037/src/music/membership.js

[R05] 音乐权限决策：
https://github.com/xdgf558/caption-ai-landing-site/blob/f0537685bc6f90df437997ee6a885a63fe03b037/src/music/access.js

[R06] 音频鉴权与 Range 交付：
https://github.com/xdgf558/caption-ai-landing-site/blob/f0537685bc6f90df437997ee6a885a63fe03b037/src/music/mediaResponse.js

[R07] 四语会员客户端与提示：
https://github.com/xdgf558/caption-ai-landing-site/blob/f0537685bc6f90df437997ee6a885a63fe03b037/src/data/reader-library-client.js

这些文件用于确认部分现有行为；本次未执行仓库测试，未读取全部源码，也未核对生产数据库和用户电脑上的未提交改动。完整审计安排在 M0。

### 25.2 平台与协议资料

[S01] Apple, Upcoming Requirements。用于 SDK、年龄分级及发布前要求核对。
https://developer.apple.com/news/upcoming-requirements/

[S02] Apple, Configuring Audio Settings for iOS and tvOS。用于播放音频会话及后台模式。该资料为归档指南，具体 API 需按当前 SDK 验证。
https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/MediaPlaybackGuide/Contents/Resources/en.lproj/ConfiguringAudioSettings/ConfiguringAudioSettings.html

[S03] Apple, Refining the User Experience。用于 Now Playing 与远程控制，同样需按当前 SDK 核验。
https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/MediaPlaybackGuide/Contents/Resources/en.lproj/RefiningTheUserExperience/RefiningTheUserExperience.html

[S04] RFC 8252, OAuth 2.0 for Native Apps。用于原生应用外部用户代理及 PKCE 安全原则。
https://www.rfc-editor.org/rfc/rfc8252

[S05] Apple, Auto-renewable Subscriptions。用于商品组、地区价格和订阅呈现。
https://developer.apple.com/app-store/subscriptions/

[S06] Apple, Meet StoreKit 2, WWDC21。用于商品、verified 交易、appAccountToken、finish、交易监听和用户主动恢复的工作流程；代码名称按当前 SDK 复核。
https://developer.apple.com/videos/play/wwdc2021/10114/

[S07] Apple, Meet the App Store Server Library, WWDC23。用于 JWS、信任链、服务端验证与 Server API。
https://developer.apple.com/videos/play/wwdc2023/10143/

[S08] Apple, Enable Billing Grace Period for Auto-renewable Subscriptions。
https://developer.apple.com/help/app-store-connect/manage-subscriptions/enable-billing-grace-period-for-auto-renewable-subscriptions/

[S09] Apple, App Store Server Notifications。当前接口入口，完整字段与新事件在实现时以文档和官方库为准。
https://developer.apple.com/documentation/appstoreservernotifications

[S10] Apple, App Privacy Details。用于数据收集和第三方行为申报。
https://developer.apple.com/app-store/app-privacy-details/

[S11] Apple, Offering Account Deletion in Your App。用于删除入口、订阅提醒和立即删除选项。
https://developer.apple.com/support/offering-account-deletion-in-your-app/

[S12] Cloudflare, Node.js Compatibility。用于 Workers 运行时兼容性边界。
https://developers.cloudflare.com/workers/runtime-apis/nodejs/

[S13] Apple, App Review Guidelines。用于完整性、支付、登录、隐私及内容等审核要求。
https://developer.apple.com/app-store/review/guidelines/

[S14] Apple, Distributing Reader Apps with a Link to Your Website。用于 Reader App 和外链授权资格边界。
https://developer.apple.com/support/reader-apps/

[S15] Suno, Terms of Service。仅作为逐曲核验适用条款的入口，不代表已经确认用户拥有各首作品的商业授权。
https://suno.com/terms-of-service

[S16] Apple, Submit an In-App Purchase。用于首次内购随版本送审流程。
https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/

[S17] RFC 6750, The OAuth 2.0 Authorization Framework: Bearer Token Usage，特别是第 1.2、2.1、2.3 节。用于 Bearer 的持有者语义、Authorization header 以及 URL 凭据泄露边界。
https://www.rfc-editor.org/rfc/rfc6750

[S18] RFC 9700, Best Current Practice for OAuth 2.0 Security，第 2.2、4.14 节。用于访问令牌约束、刷新轮换与重放检测；不规定本项目的 120 秒窗口或 crash journal。
https://www.rfc-editor.org/rfc/rfc9700

[S19] Apple, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly。用于 Keychain 首次解锁后的可访问性及本设备保护策略；不应据此假设跨多个 Keychain item 具有事务性。
https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly

[S20] Apple, AVAssetResourceLoaderDelegate。用于 URL asset 的资源加载委托接口。自定义 scheme + URLSession 媒体适配是本项目待真机验证的设计，不代表官方对本项目完整播放链路提供保证。
https://developer.apple.com/documentation/avfoundation/avassetresourceloaderdelegate

[S21] RFC 9449, OAuth 2.0 Demonstrating Proof of Possession (DPoP)。用于解释未来可选的发送者约束及其与普通 Bearer 的区别；本版本不宣称已实现 DPoP。
https://www.rfc-editor.org/rfc/rfc9449

## 26. 最终验收结论模板

```text
文档版本：
验收的代码/后端发布版本：
验收环境：
已完成里程碑：
已通过的 P0 项目：
未通过或未覆盖项目：
实体 iPhone 测试设备与系统：
现有网站回归结果：
数据库迁移及恢复结果：
媒体请求身份匹配与硬截止测试结果：
刷新四个崩溃断点与窗口外恢复结果：
删除确认响应丢失与无会话查询结果：
Apple 测试环境与交易验证结果：
已确认的内容/隐私/店面资料：
是否具备本阶段发布条件：
发布授权记录：
```

项目主线保持不变：SwiftUI 原生听歌、统一 Station Cat 账号、约 1 美元/月的独立音乐 VIP、保留全站 VIP 现有音乐权益。先完成稳定的基础客户端，再以独立可验证的版本上线音乐订阅。
