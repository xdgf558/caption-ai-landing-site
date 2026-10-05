# T02 路由与业务依赖清单

核验日期：2026-10-05。目标仓库：`xdgf558/caption-ai-landing-site`，域名：`https://wwwstationcat.org`。本轮基线为 T01 修订提交 `020e970f7376601e8c6708562e3143f79f056d35`；应用代码仍是 `6cbb19725cd12ae718ea395711f920adef346824`，T01 只增加、修订文档。

用户已审查 T01。音乐后代路径、原生账号资料库，以及三份规范正文的一任务一 PR 顺序已在 T01 补齐。修订头 `020e970` 的 CI 通过后，T01 已合并为 `eef728d`，T02 PR 基于更新后的 main。本任务交付地址清单和保留方案，供 T03、T12、T14、T20 使用。表中的动作是后续实施提案，本次没有修改路由、公开入口、生产配置、迁移或存档。

## 交付与覆盖范围

[逐地址 CSV](T02-route-inventory.csv) 共 **780 条记录**，含具体路径、无斜线别名、查询参数模板、动态路径模板和原始匹配器。它不是“780 个已验证的生产 URL”。每条包含内容类型、方法提示、调用者、拟定动作、替代地址、理由、现有行为、源码位置、静态 sitemap 标记和验证状态。

| 证据来源 | 数量 | 含义与限制 |
| --- | ---: | --- |
| 本地 `dist/**/index.html` | 153 | 含 Astro 页面与复制的游戏入口；生成文件不证明线上 HTTP 200 |
| 本地 `dist/sitemap.xml` | 111 | 静态构建中的路径；生产 Worker 还会合并 D1 发布内容 |
| 源码端点定义出现次数 | 125 | 包含同一路径的多处条件；不是去重后的 API 数量 |
| 原始匹配器 | 37 | 包括语言前缀、动态 ID、音乐后代命名空间、后台及原生前缀 |
| Worker 固定映射 | 151 | 140 个 R2 下载地址、1 个外部下载跳转、10 个页面跳转 |
| `public/_redirects` | 17 | 当前资源层跳转；是否先经过 Worker 取决于 `run_worker_first` |
| 站内字面量调用引用 | 265 | 源码链接/数据定义/请求位置；拼接地址和外部客户端另行人工核对 |

CSV 对静态路径、上述 sitemap、固定映射、端点定义及原始匹配器的覆盖核对通过。动态 D1 slug、未提供的外部推广地址和正式原生客户端安装版本仍有缺口，见文末。

| 拟定动作 | 记录数 | 后续实施含义 |
| --- | ---: | --- |
| `keep` | 12 | 更新品牌/音乐页面，或保留游戏运行路径；继续执行当前权限与开关 |
| `redirect` | 38 | 有对应保留内容才指向同一实体、同一语言的新地址或规范别名 |
| `retire` | 218 | 新版上线后退出旧公开栏目；有效旧内容无替代时 410，非法或不存在路径 404 |
| `service` | 512 | 保留业务契约或现有拒绝规则；不等于全部匿名放行，也不等于全部写入 sitemap |

`methods` 是源码提示，不是生产权限证明；`see handler` 或“见 handler”表示需逐处理器核验。`source` 使用本轮基线的仓库相对路径及行号。`caller` 有确切引用时列出位置，超过 6 个只列代表引用；无确切字面量时记录调用模块或外部调用缺口，不能将其理解为完整访问日志。`sitemap=yes` 仅表示出现在本地静态 XML。

## 语言、别名与公开入口

根首页 `/` 为繁体中文，`/zh-hant`、`/zh-hant/` 是指向根首页的别名；其他首页为 `/en/`、`/ja/`、`/zh-hans/`。服务页和旧 Apps 介绍使用显式四种语言前缀。无前缀 `/apps/*` 当前指向英文，而 `/library` 当前指向繁体资料库，不能统一猜成同一种语言。

| 路径范围 | 当前源码行为 | 拟定处理与例外 |
| --- | --- | --- |
| `/`、`/en/`、`/ja/`、`/zh-hans/`、品牌 about | 静态品牌页面 | 保留并按新版定位更新；繁体首页别名直接规范化 |
| 四种语言的 `/{locale}/apps/` 和工具介绍；无前缀 `/apps/*` | 静态介绍或英文跳转 | 旧公开目录退出；游戏介绍、下载/Android、账号/支持服务的精确例外先匹配 |
| 四种语言的 `/{locale}/apps/cat-life-game/`，及无前缀别名 | 游戏介绍；运行链接另指 `/games/cat-life/` | 等 T12 实现后直接映射到 `/{locale}/games/cat-life-game/`；无前缀沿用英文 |
| `/games/cat-life/`、`/games/cat-life/index.html`、整个资源前缀 | 实际游戏运行与相对资源 | 保留；不得分配为新游戏介绍页或套用公开栏目关闭规则 |
| 五种前缀下 `signal/`、`signal/:slug/`、卡片图片和 `devlog/`、`devlog/:slug/` | 动态 CMS 与部分构建文章；无斜线补斜线 | 旧文章与卡片公开入口退出；移除跳向已退出页面的补斜线链 |
| `/novel/`、`/en/novel/` 及系列公开目录 | novel v2 动态解析 | 公开目录退出；章节与历史权益的服务例外先处理 |
| 五种前缀的 `/works/`、系列和章节别名 | 当前 301 到 novel，保留 query；非英文最终到根 novel | 目录/系列公开别名直接退出；历史章节别名映射到授权阅读，不跳通用首页 |
| `/ja/novel/*`、`/zh-hans/novel/*`、`/zh-hant/novel/*` | 当前 novel parser 不承认这些前缀 | 作为候选失效旧链接列出，不能写成已存在的小说页面 |
| `/{locale}/library/`、points、privacy、terms、support；无前缀别名 | 既有账号、余额、政策及支持能力 | 保留当前规范化与业务功能；新版导航接入不要求重建这些服务 |
| `/{locale}/apps/:product/download/`、Android 页面、`/downloads/*` | 历史下载说明、R2 文件或外部跳转 | 保留下载/售后契约；原下载详情不能随 Apps 介绍整段关闭 |

依据：[语言与旧别名](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/public/_redirects#L1)、[动态解析](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/worker.js#L18969)、[Worker 跳转规则](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/worker.js#L22461)。CSV 已列出构建页的无斜线路径；模板家族补充所有解析器实际支持的语言，不凭页面文件推断动态内容是否存在。

旧作品退出时还要限制 `/api/content/entries`、`/api/content/body` 和相关媒体的公开内容范围，避免仍从公共接口取出已退出的旧文章/小说；历史授权正文继续通过受保护接口获取。后台管理、NovelForge 鉴权服务不因公开频道退出而删除。此项需 T14/T20 按内容类型、引用关系和用户权益验证，不能只做前端导航隐藏。

## 音乐地址的完整边界

四个规范音乐页为 `/music/`、`/zh-hans/music/`、`/en/music/`、`/ja/music/`；`/zh-hant/music/` 和所有无斜线形式也会进入音乐处理器。正式分享选择是唯一合法 `?track=<UUID>` 或 `?collection=<slug>`；当前生成函数过滤非法/重复选择和其他 query，UUID 转小写。这是现有分享契约，推广 UTM/src 的新归因规则仍由 T17 实现，不能先宣称已有。

`isMusicPagePath` 在解码、反斜线替换和重复斜线归一化后使用 `/music(?:\/|$)`，匹配的是五种前缀的整个音乐命名空间。`handleMusicPage` 则仅接受根页，且先检查方法与 `MUSIC_PUBLIC_ENABLED`：GET/HEAD 的开关关闭返回 503，打开后未知后代返回 404，合法根页/别名按 `musicPageHref` 返回 302 或读取 ASSETS。这两个匹配范围不能混为一谈。

| 补充范围 | 清单与后续处理 |
| --- | --- |
| 五种前缀的 `music/:legacyDescendant/*` | 记录匹配器覆盖范围；当前不证明详情页存在，新 `/music/tracks/:slug/` 必须先解析，再处理无对应实体的遗留后代 |
| 带/不带斜线的 `?track=:trackId` | T06/T09 建稳定 ID 到真实 slug 的映射，直接进入同歌曲、同语言详情；未完成映射的有效实体不能被当作不存在而关闭 |
| 带/不带斜线的 `?collection=:slug` | 本期没有新合集详情路由规格，保留有效合集选择及原生合集读取；不得自动改为单曲或首页 |
| `music//…`、`en//music/…`、`/%6dusic/…`、`/en%2Fmusic/…`、`music%5C…`、`zh-hant/music/index.html` | 归一化会影响命名空间命中，根页处理器仍使用原始 pathname；T20 需测试 raw 请求与 ASSETS/Worker 次序，不能仅测试 URL 生成函数 |
| `/api/music/__cover-files/*` 及编码变体 | 继续直接拒绝原始私有生成文件；公共封面经实时发布/资源校验的 cover API 读取，不被 API/静态图片保留范围放行 |

依据：[广义匹配与分享参数](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/music/pagePaths.js#L2)、[根页面 gate 与跳转](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/music/pageHttp.js#L17)、[原始封面拒绝](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/worker.js#L22869)。

网页 `stationcat.music.v2` 保存本机收藏、最近播放、队列、设置和播放位置，另保留旧 v1 数据。原生 `/api/mobile/v1/me/music/*` 是另一套账号资料库：favorites GET/PUT、recent GET/DELETE、preferences GET/PATCH、listens POST；使用 `mobile_music_*` 表、版本/CAS、history epoch 和幂等操作，且受认证、音乐、个人同步开关约束。T14 必须分别回归，不能因本机键仍在就确认账号资料已覆盖。本次不把现有原生同步转换为网页云同步，也不自动开启现有关闭能力。

依据：[网页本机数据](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/scripts/musicLocalData.js#L1)、[原生个人资料库](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/mobile/library.js#L7)、[原生分发入口](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/mobile/http.js#L116)。

## 业务服务依赖

这些服务在 CSV 中单列为 `service`。保留指保持方法、响应契约、鉴权、已有开关和数据关系；不表示新增权限。API POST/PUT/PATCH/DELETE 不套用公开页面的 301 跳转。

| 业务 | 保留地址或模式 | 调用者、边界与后续验证 |
| --- | --- | --- |
| 网页账号与认证 | `/api/readers/register`、login、magic-link、verify、session、logout、密码/TOTP；四语言 library | `ReaderLibraryPage.astro`、reader 客户端和游戏；保留会话、CSRF/同源与原业务验证 |
| 会员、余额、权益 | `/api/readers/credits`、membership/redeem；`/api/novels/access`、library、credits/unlock | 会员中心、历史授权阅读和音乐能力投影；复用现有账号，公开小说退出不删权益 |
| 订单与支付回调 | `/api/novels/payments/*`、`/api/novels/webhooks/nowpayments`、creem | 网页订单与商户服务端；保留 POST 签名验证、幂等和历史订单读取，正式商户配置/真实订单尚未核验 |
| 历史阅读与书签 | `/novel/:series/chapter/:chapter/`、`/en/novel/…`；works 章节别名；bookmarks、protected-content、阅读事件 | 已购用户、资料库与历史分享；T14 先接入必要服务，T20 验证匿名公开退出与已授权访问同时成立 |
| 游戏云存档与恢复 | `/api/readers/game-saves/cat-life` GET/PUT，`/recovery` GET/POST | `cloud-sync.js`、游戏会员登录；保留版本冲突、恢复备份与登录要求，不能把异常/403/503 当作空存档 |
| 游戏购买与装扮 | `/api/games/cat-life/catalog`、entitlements、redemptions；`/admin/api/games/cat-life/*` | `commerce.js`、会员中心及后台；保留既有账户与历史购买关联 |
| 网页音乐 | `/api/music/catalog`、tracks/ID、cover、lyrics、access、audio、collections、share.png、me/capabilities、events | `musicPlayerClient.js`、分享、后台和 analytics；完整音频仍受现有权益校验，推广试听只在后续按独立配置接入 |
| 原生音乐与账号资料 | `/api/mobile/v1/music/*`、me/entitlements、`/me/music/*` | 正式 App 完整调用版本未知；保留 Bearer 会话、音频许可、离线许可条件与独立账号资料库 |
| 原生登录与删除 | `/auth/mobile/*`、`/api/mobile/v1/auth/*`、me、deletion-requests | 浏览器授权表单、系统回调与 App；保留 PKCE、回调参数和生产 gate；生产删除当前仍关闭，不因改版开启 |
| 系统关联 | `/.well-known/apple-app-site-association` | 当前 AASA 只声明精确音乐根路径/别名和 auth callback；新单曲后代链接需后续专项兼容，不能声称已被原生关联覆盖 |
| 后台与 CMS | `/admin`、`/admin-v2`、`/admin/api/*` | 保留 Access gate、发布/编辑角色与历史业务；新推广配置仍复用已有后台 |
| NovelForge 外部服务 | `/api/novelforge/*`，含 analytics 与 chapter content 的 segment parser | 外部写作客户端；保留专用 Bearer 服务，正式客户端版本/调用全集未知 |
| 下载与支持 | CSV 的 140 个 R2 下载路径、1 个外部下载地址、下载说明/Android、support/privacy/terms | 已安装产品、历史链接和售后；具体 R2 对象可用性、外部下载主机状态与全量外链未知 |

主要分发证据：[网页服务](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/worker.js#L22937)、[订单与内容](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/worker.js#L23031)、[原生服务](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/mobile/http.js#L48)、[精确 AASA](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/mobile/productionAssociation.js#L23)、[生产删除关闭条件](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/mobile/environment.js#L64)。逐接口、下载及后台地址的位置以 CSV 为准。

## 游戏运行地址保留方案

当前网站包内的 Cat Life 为 `1.28.0`、存档 schema 3，产品数据记录上游 `0cc839f`。本任务只盘点网站集成；`cat-life-game` 是独立上游仓库，不是本次网站改版目标。

新介绍页拟定 `/{locale}/games/cat-life-game/`，与运行目录 `/games/cat-life/` 分开。四种语言的旧 Apps 游戏介绍直接跳到各自新介绍，无前缀旧地址沿用英文。T12 实现介绍、T13 验证媒体切换、T14 接入会员服务后，T20 才验证旧介绍关闭规则。

| 保留点 | 实施约束与验收落点 |
| --- | --- |
| 运行与相对资源 | 保留 `/games/cat-life/`、index.html 和整个资源目录；加载 JS/CSS、猫图、音频及分享字体；不先关闭目录再补资源 |
| 语言入口 | 继续带 `?lang=`，沿用网站 locale 到游戏语言的现有映射；游戏 integration 的繁体选择目前回退简体，不能擅自宣称独立繁体游戏界面已完成 |
| 本机保存 | 保留 `catGameSaveV1`，会员键 `catGameSaveV1:member:<accountId>`，以及 cloud-sync 的同步标记、游客认领和 `catGameLocalBackupV1:` 备份键；不改 schema、不清键、不覆盖坏存档 |
| 同源 | 保持生产协议/域名和游戏路径；localStorage 按 origin 隔离，路径稳定还保护相对资源、安装/分享入口与返回链接 |
| 云保存 | 保留 GET/PUT 与恢复 GET/POST；区分游客、未登录、无云存档、版本冲突、损坏、未来 schema 和服务异常；T03/T12/T14 做真实格式与隔离数据核验 |
| 权益与会话 | 登录后仍使用原账户 ID 关联存档/购买；不把网页 Cookie 直接转为原生 Bearer 权限，也不迁移账号体系 |
| 返回与导航 | `site-integration.js` 当前仍引用旧游戏介绍、Apps、会员中心；T12/T14 在关闭前更新介绍/目录返回链接，保留登录和会员操作，T13 验证退出后网站媒体保持暂停 |
| 安全与缓存 | 保留 `_headers` 的 no-cache、noindex、同源脚本与现有 CSP；任何嵌入/启动策略改变在 T13 单独验证，不通过放宽 CSP 解决加载问题 |

依据：[游戏产品与运行地址](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/data/products/cat-life-game.ts#L6)、[本机键与 schema](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/public/games/cat-life/src/js/core/namespace.js#L4)、[会员键](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/public/games/cat-life/src/js/main.js#L590)、[云保存与备份](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/public/games/cat-life/cloud-sync.js#L2)、[返回入口](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/public/games/cat-life/site-integration.js#L15)、[运行目录响应头](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/public/_headers#L25)。

## T20/T22 的执行顺序与搜索配置

T20 以本清单准备规则，在隔离环境核验实际 GET/HEAD 状态、Location、query、语言、鉴权与加载资源。服务精确例外及合法新音乐详情先于旧公开目录规则，最后再回退 ASSETS；需同时核对 `run_worker_first`、Worker 和资源层 `_redirects`，避免资源直接绕过关闭规则。历史授权阅读的例外需结合用户身份/内容权限验证，不能简单使用章节前缀匿名放行。

对有对应内容的旧路径执行直接映射，避免连续跳转及跳到已退役目标；无对应内容的旧公开页真实返回 404/410。同步处理页面 canonical/hreflang、站内生成链接、分享/二维码、静态 sitemap 和 Worker 合并的动态 sitemap，清理旧内容缓存。当前音乐根页的关闭开关、私有资源拒绝和 API gate 都需保留各自语义。

本地 sitemap 的 111 条不能代表线上完整 sitemap；[Worker 会查询 D1 已发布内容后合并](https://github.com/xdgf558/caption-ai-landing-site/blob/020e970f7376601e8c6708562e3143f79f056d35/src/worker.js#L19208)。源码存在的 migration 不能证明生产 schema 或动态内容已就绪。T20 准备、验证规则，T22 仅在新版开发完成、正式上线后关闭被替代的旧公开入口。本轮没有生产发布或关闭授权。

## 缺口与后续任务

| 未确认项 | 当前结论 | 后续落点 |
| --- | --- | --- |
| 生产 D1 schema、MUSIC_DB/R2 绑定、Access 策略、真实会员/订单/存档 | 仅能定位仓库代码与迁移；没有读取生产数据或验证权限配置 | T03 记录真实状态与隔离样本，不从迁移文件推断已应用 |
| D1 文章/小说/音乐真实 slug、已购章节与旧分享 ID | CSV 用模板覆盖 parser，不能列全量真实实体或构造发布记录 | T03/T06 获取获准的数据依据；T20 补逐实体迁移映射 |
| 未提供的受保护小说内容目录 | 构建使用 `ALLOW_EMPTY_SERIAL_CONTENT=1`，目录空缺被允许 | 不能作为生产包；历史阅读回归需实际授权内容/资源 |
| 平台推广、社交历史帖子、QR、邮件、旧域名及商户地址 | 源码和当前构建不能覆盖所有外部入口 | T17/T20 补已知推广/Campaign/日志清单，并保留未获取标记 |
| 正式原生 App 与外部 NovelForge 客户端的调用版本 | 仓库服务和测试 fixture 可定位；完整安装客户端清单未获取 | T14/T20 做客户端兼容；新详情 AASA 另行验证 |
| 部署提交、线上状态、真实下载对象 | 本地代码/构建不证明当前部署；未对生产逐地址请求 | 实际 HTTP 检查按任务约定在 T20 完成 |

## 验证与复核方式

本轮构建 `ALLOW_EMPTY_SERIAL_CONTENT=1 ASTRO_TELEMETRY_DISABLED=1 npm run build` 通过：153 个入口 HTML、111 条静态 sitemap，postbuild 的站点基础和四语言音乐入口检查通过。使用允许空受保护内容的条件已记录，结果不是生产包或部署证据。

既有 `test-site-foundation.mjs`、`test-cat-life-game-integration.mjs`（含内容 manifest）、`test-reader-library-locales.mjs`、`test-novel-v2-reader-routes.mjs` 通过；`test-music-sharing-return.mjs` 20 项通过、无跳过。以上核对现有源代码契约，不代替 T20 的隔离 HTTP 回归或真实订单/存档测试。

[只读证据采集器](tools/collect-route-evidence.mjs) 读取 Git 跟踪的 src/public、已构建页面和 sitemap，使用现有 TypeScript 解析库提取定义/调用线索；它不导入 Worker、不请求 HTTP、不读取凭证或生产库，只写指定的本地 JSON 输出。构建完成后在仓库根目录复核：

```sh
node docs/station-cat-redesign/tools/collect-route-evidence.mjs --output /tmp/station-cat-route-evidence.json
```

该工具重现原始来源数量和位置，CSV 的动作/例外由本报告的业务规则人工审定，不由工具自动转换为关闭配置。CSV 唯一路径、必填字段、来源文件/行号、上述原始定义覆盖和服务 API/下载/游戏运行保留边界已校验。远程 CI 需按各 PR 当前 head SHA 另行查看，不使用旧提交通过记录替代。

T02 完成的是 A17 的逐地址与服务保留盘点证据；真实响应验收保留给 T20。按用户约定，本项独立 PR 待审查，通过后才进入 T03，不按 R0–R7 分组自动推进。
