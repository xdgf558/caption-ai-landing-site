# T01 仓库与运行方式盘点

盘点日期：2026-10-05（UTC+08:00）。状态：交付待验收。本轮范围为 T01；完整旧 URL 退出清单属于 T02，权限与素材矩阵属于 T03。

## 结论与代码版本

Station Cat 主站的目标仓库是 `xdgf558/caption-ai-landing-site`，使用 Astro 静态页面、原生浏览器脚本和 Cloudflare Worker 服务层。现有代码已经具备账号、会员、支付、后台内容管理、独立音乐子系统和 Cat Life 游戏本地/云端存档，后续应在这些实现上增量改版。

| 项目 | 核验结果 |
| --- | --- |
| GitHub 仓库 | [xdgf558/caption-ai-landing-site](https://github.com/xdgf558/caption-ai-landing-site) |
| 起始分支 | `main`，独立检出时工作树干净 |
| 起始提交 | [`6cbb19725cd12ae718ea395711f920adef346824`](https://github.com/xdgf558/caption-ai-landing-site/commit/6cbb19725cd12ae718ea395711f920adef346824) |
| 提交时间与主题 | 2026-10-04 09:01:03 +08:00；Merge pull request #185 from xdgf558/codex/native-release-verification |
| 本轮工作分支 | `codex/station-cat-redesign-t01` |
| 正式域名 | `https://wwwstationcat.org/` |
| 域名对应依据 | [Astro 配置 L3–6](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/astro.config.mjs#L3-L6)、[站点数据 L1–5](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/data/site.ts#L1-L5)、[Worker 自定义域名配置 L115–117](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/wrangler.toml#L115-L117) 三者一致 |
| 线上观察 | 公开读取[首页](https://wwwstationcat.org/)仍包含 Apps、游戏、音乐、积分价格、小说、文章和会员等旧版多栏目内容；这不证明上述 Git 提交已部署 |

本次新建独立本地 Git 检出，保留其他本地项目中的未提交工作。另一个 `xdgf558/cat-life-game` 仓库是游戏上游来源，不是本次网站改版的目标仓库。网站当前实际集成版本和来源提交见 [产品数据 L6–12](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/data/products/cat-life-game.ts#L6-L12)，游戏修改应先以网站集成副本为依据核对。

本文的代码链接固定在盘点提交，便于后续复核。未读取私密配置值、浏览器会话或生产凭据。生产数据库、R2 权限和 Cloudflare 实际部署状态均没有通过管理端核验。

## 状态判定

“已实现”表示找到实际代码及调用路径，不等于线上已经启用；“配置中”表示仓库声明了绑定或开关，远程生效状态仍需确认；“仅有文案/需求”表示没有足够的对应执行代码；“暂无法确认”表示需要远程权限、真实资源或设备证据。本报告按这四类区分事实。

## 框架、构建与服务层

| 内容 | 现状及状态 | 代码依据 |
| --- | --- | --- |
| 框架与语言 | 已实现：Astro 5.18.1，TypeScript 5.9.3；包类型为 ESM，Node 要求 `>=22.13` | [package.json L1–8](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/package.json#L1-L8)，[Astro 锁定依赖](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/package-lock.json#L2192)，[TypeScript 锁定依赖](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/package-lock.json#L6321) |
| 包管理 | 已实现：npm，根目录 `package-lock.json`；没有为本轮引入其他包管理方式 | [package-lock.json](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/package-lock.json) |
| 前端 | 已实现：`src/pages/` 文件路由、`.astro` 组件、`src/scripts/` 浏览器 JS 和 CSS；全站基础布局没有客户端路由持久容器 | [BaseLayout L91–99](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/layouts/BaseLayout.astro#L91-L99) |
| 构建 | 已实现：先生成小说付费/受保护正文配置，再执行 Astro；postbuild 生成 404、sitemap 并核对产物 | [package.json L32–38](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/package.json#L32-L38) |
| Worker 入口 | 已实现：`src/worker.js` 按顺序处理移动端、后台、音乐、账号、支付、动态内容，再回落到 `ASSETS` | [Worker L22863–22899](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22863-L22899)、[动态内容与静态回落 L23359–23375](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L23359-L23375) |
| 部署配置 | 配置中：Worker 名称 `caption-ai-landing-site`，兼容日期 `2026-05-17`，静态目录 `dist`；敏感路由配置 `run_worker_first` | [wrangler.toml L1–5](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/wrangler.toml#L1-L5)、[L30–70](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/wrangler.toml#L30-L70) |
| 后台任务 | 已实现且有配置声明：每小时 cron、资讯采集队列；Worker scheduled 同时调用音乐统计保留期清理和移动端维护 | [触发器及队列声明 L75–96](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/wrangler.toml#L75-L96)、[Worker L23381–23402](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L23381-L23402) |
| CI | 已实现：PR 和 main push 触发；Node 22，npm ci，单元/契约、隔离运行、移动端、Playwright 和构建检查；这两份 workflow 没有生产部署步骤 | [ci.yml L3–96](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/.github/workflows/ci.yml#L3-L96)、[orange-cat-preview.yml L17–37](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/.github/workflows/orange-cat-preview.yml#L17-L37) |

已读取[仓库 AGENTS.md](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/AGENTS.md#L1-L5)：要求改动保持范围、保护现有路由并在交付前构建。本轮遵守该要求；StoryCat 专项限制没有被当作整个改版任务的技术事实。

## 路由与语言现状

| 路由族 | 实际入口和生成方式 | 对应实现 |
| --- | --- | --- |
| 首页及语言 | `/` 默认繁体；`/zh-hant/`、`/zh-hans/`、`/en/`、`/ja/` 各有页面，内容语言枚举为 `zh-Hant`、`zh-Hans`、`en`、`ja` | [site.ts L5–13](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/data/site.ts#L5-L13)，[src/pages](https://github.com/xdgf558/caption-ai-landing-site/tree/6cbb19725cd12ae718ea395711f920adef346824/src/pages) |
| 旧公开栏目 | 现有导航同时包含 Apps、游戏、积分、小说、文章、会员；音乐入口受构建开关控制 | [navigation.ts L4–49](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/data/navigation.ts#L4-L49) |
| 音乐 | `/music/` 默认繁体，另有三种语言路径；现有单曲/合集选择通过 `?track=`、`?collection=`，不是主文档建议的独立 slug 详情路由 | [pagePaths.js L1–19](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/pagePaths.js#L1-L19)、[pageHttp.js L17–21](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/pageHttp.js#L17-L21) |
| 游戏介绍与运行 | 四种语言介绍页为 `/{locale}/apps/cat-life-game/`；开始按钮直接打开 `/games/cat-life/?lang=...` 静态游戏 | [产品路径 L7–11](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/data/products/cat-life-game.ts#L7-L11)、[启动 URL L182](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/components/CatLifeGameLanding.astro#L182) |
| 账号与服务 | 四种语言 `/library/` 页面使用现有 `/api/readers/*`；游戏读写、积分、会员与支付仍走 Worker | [账号和游戏服务 L22937–23009](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22937-L23009) |
| 后台 | `/admin/`、`/admin-v2/`、`/admin/music/` 及 `/admin/api/*`，由 Worker 先鉴权后分发 | [后台门禁 L22882–22894](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22882-L22894) |
| 动态内容及旧地址 | Worker 还提供小说、文章、内容查询和既有重定向；静态目录不是完整服务路由清单 | [重定向 L22901–22914](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22901-L22914)、[内容查询 L23059–23068](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L23059-L23068) |

以上只定位路由族，不制定或执行逐地址关闭动作。T02 需要同时检查静态页面、Worker 路由、语言别名、既有跳转和历史服务调用；本轮保持旧入口可用。

## 数据库、CMS、鉴权、支付与存储

| 模块 | 状态与实际行为 | 关键依据 |
| --- | --- | --- |
| 主数据 | 已实现且声明绑定：`WAITLIST_DB` 为 Cloudflare D1，除 waitlist 外还承载账号、会员、订单、积分、CMS、评论和游戏存档。远程表/迁移版本暂无法确认 | [绑定 L98–101](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/wrangler.toml#L98-L101)、[主迁移目录](https://github.com/xdgf558/caption-ai-landing-site/tree/6cbb19725cd12ae718ea395711f920adef346824/migrations) |
| 音乐数据 | 已实现：独立 `MUSIC_DB`，迁移放在 `migrations-music/`；runtime 明确拒绝与 `WAITLIST_DB` 共用。主 `wrangler.toml` 没有声明 `MUSIC_DB` / `MUSIC_BUCKET` | [runtime.js L13–17](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/runtime.js#L13-L17)、[迁移说明 L3–24](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/migrations-music/README.md#L3-L24)、[主配置](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/wrangler.toml) |
| 迁移方式 | 已实现：主目录 `0001`–`0037`，音乐目录 `0001`–`0011` 为 SQL 增量迁移。历史 staging 文档记录不代表生产已迁移；T01 没有执行远程迁移 | [主迁移目录](https://github.com/xdgf558/caption-ai-landing-site/tree/6cbb19725cd12ae718ea395711f920adef346824/migrations)、[音乐迁移目录](https://github.com/xdgf558/caption-ai-landing-site/tree/6cbb19725cd12ae718ea395711f920adef346824/migrations-music) |
| CMS | 已实现：Astro 内容集合与 D1 后台内容并存，`content_entries`、版本、正文引用、价格和审核记录由 Worker 管理，正文和媒体可放 R2。README 的“后台仅用 GitHub Contents API 写 Markdown”不足以描述当前实现 | [Astro 内容集合 L1–83](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/content.config.ts#L1-L83)、[CMS SQL](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/migrations/0007_backend_content_platform.sql#L1)、[后台正文读取 L3383](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/pages/admin-v2/index.astro#L3383) |
| 用户鉴权 | 已实现：注册、密码登录、magic link、密码重置、TOTP、会话和注销。音乐会员读取沿用 `station_cat_reader_session`，查询主库会话/账号/会员，校验撤销与到期 | [账号路由 L22937–22982](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22937-L22982)、[music/membership.js L4–74](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/membership.js#L4-L74) |
| 管理鉴权 | 已实现，配置有声明：Cloudflare Access 外层加 Worker JWT 验证，音乐 API 通过 `musicAdminActor` 验证身份。实际 Access 策略暂无法确认 | [JWT 校验 L117–175](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/adminAccess.js#L117-L175)、[管理 API L67–80](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/adminHttp.js#L67-L80) |
| 会员与音乐权限 | 已实现：现有有限期限站点会员；歌曲政策包括免费、VIP、抢先听及限免。每次 full 音频读取经服务端权限检查；preview 是独立变体。实际用户的已购权益与生产开关暂无法确认 | [会员解释 L43–62](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/membership.js#L43-L62)、[access.js L43–72](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/access.js#L43-L72)、[mediaResponse.js](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/mediaResponse.js) |
| 支付 | 已实现：NOWPayments 和 Creem webhook 路由及签名校验，Creem 有事件 ID、退款和争议处理；不应随旧小说栏目退出删除这些服务。生产商户、回调配置及真实订单状态暂无法确认 | [回调路径 L371–375](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L371-L375)、[NOWPayments L9932–9955](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L9932-L9955)、[Creem L10040–10078](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L10040-L10078) |
| 对象存储 | 配置中：主配置声明 `DOWNLOADS_BUCKET`、`CONTENT_BUCKET` 与静态 `ASSETS`；音乐实现需要独立 `MUSIC_BUCKET`。受保护正文与音频由服务端读取；实际桶隐私/CDN 设置暂无法确认 | [R2 绑定 L103–109](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/wrangler.toml#L103-L109)、[受保护正文入口 L6298](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L6298)、[音乐资源检查 L12–17](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/runtime.js#L12-L17) |
| 音乐后台 | 已实现：草稿、版权审核、技术审核、上传、发布、下架、专辑/歌单、精选、存储配额、统计和清理能力；启用需要对应数据库、桶和开关 | [adminHttp.js L1–18](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/adminHttp.js#L1-L18)、[状态与能力 L92–105](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/adminHttp.js#L92-L105) |
| 收藏与最近播放 | 已实现：`stationcat.music.v2` 保存浏览器收藏、最近播放、队列、设置及位置，不是账号云同步。需保留现有键与兼容逻辑 | [musicLocalData.js L1–41](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/scripts/musicLocalData.js#L1-L41) |
| 原生移动端 | 已实现：`/api/mobile/*` 和 `/auth/mobile/*` 路由、独立门禁、认证及资料/音乐能力；本轮网站改版没有改动此系统 | [Worker L22866–22867](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22866-L22867)、[mobile/http.js L48–64](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/mobile/http.js#L48-L64) |

主配置没有音乐绑定/开关，与公开首页读取到音乐展示不能合并为“音乐生产服务已启用”的结论。页面入口、构建开关 `PUBLIC_MUSIC_ENTRY_ENABLED`、Worker 的 `MUSIC_PUBLIC_ENABLED`、VIP 交付和统计开关是不同层次，分别见 [music-entry.js L1–3](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/data/music-entry.js#L1-L3)、[runtime.js L5–9](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/runtime.js#L5-L9) 和 [音乐 HTML 门禁 L11–22](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/pageHttp.js#L11-L22)。远程实际配置和部署提交留作待核验事项。

## 游戏启动与存档

网站当前集成游戏为 Cat Life `1.28.0`，存档 schema 为 `3`，游客原键为 `catGameSaveV1`，云存档上限配置为 `750000` 字节。依据是 [namespace.js L1–7](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/public/games/cat-life/src/js/core/namespace.js#L1-L7)，不是上游仓库或旧说明中的推测。

| 环节 | 状态和接入依据 |
| --- | --- |
| 运行入口 | 已实现：介绍页启动链接打开独立静态运行目录。保留 `/games/cat-life/` 和同源存储作用域，见[启动 URL](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/components/CatLifeGameLanding.astro#L182) |
| 本地读写 | 已实现：saveSystem 读取动态 activeStorageKey，写本地后通知云同步；会员键追加 `:member:{accountId}`。见 [saveSystem L1–21](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/public/games/cat-life/src/js/state/saveSystem.js#L1-L21)、[main.js L588–598](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/public/games/cat-life/src/js/main.js#L588-L598) |
| 格式迁移 | 已实现：检查不兼容版本，在克隆数据上逐级迁移；未来版本抛 `SAVE_SCHEMA_UNSUPPORTED`。见 [saveMigrations L56–80](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/public/games/cat-life/src/js/state/saveMigrations.js#L56-L80) |
| 云同步和恢复 | 已实现：`cloud-sync.js` 调用 `/api/readers/game-saves/cat-life`，有同步标记、本地备份、冲突选择和恢复入口；Worker 提供 GET/PUT、恢复 GET/POST，数据由主 D1 存档表保存。见 [cloud-sync L1–18](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/public/games/cat-life/cloud-sync.js#L1-L18)、[服务路由 L22985–22994](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22985-L22994)、[迁移 0031](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/migrations/0031_reader_game_saves.sql)、[迁移 0032](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/migrations/0032_reader_game_save_recovery.sql) |
| 游戏购买权益 | 已实现：`/api/games/cat-life/catalog`、`entitlements`、`redemptions` 及后台接口，不能只保留静态 HTML 就认定历史权益安全。见 [Worker L22997–23009](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L22997-L23009) |
| 改版中的“继续游戏”及就绪确认 | 仅有需求：新官网需根据有效兼容存档展示继续按钮，并确认运行端就绪；当前介绍页主要是启动链接，尚不能认定改版验收已通过 |

不改域名、存储键、账号标识或运行地址，就能为后续页面改版减少存档迁移范围；实际历史存档兼容性和用户恢复仍需 T12/T13 的专门验证。

## 与 v1.1 产品要求的差异

| 产品要求 | 当前事实 | 后续任务 |
| --- | --- | --- |
| 个人品牌、音乐与游戏为主要公开内容 | 当前仍是多栏目站点；新首页和精简导航属于需求，尚未实现 | T02、T04、T05；T04 先调用 UI 技能提供 3 个模板，等待用户选择 |
| 专门推广歌曲模块、独立公开试听开关、真实平台入口、关联视频与 Campaign | 已有精选编排，可设置主推歌曲、次级歌曲及合集；主推要求当前免费完整可听。现有字段不覆盖此次推广配置，不能把精选模块直接视为需求已完成 | T06、T10、T11、T15；证据：[featured 输入 L26–32](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/featured.js#L26-L32)、[主推校验 L103–104](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/featured.js#L103-L104) |
| 独立官方单曲页和统一语言 URL 生成 | 已有查询参数选曲和语言路径帮助函数，缺少改版要求的正式详情路由映射 | T07–T09；复用 [pagePaths.js](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/pagePaths.js) |
| 全站跨页持续播放、音乐/视频/游戏统一协调 | 已有单个 MusicPlayer 组件、状态机和队列；组件挂载在音乐页面，`pagehide` 会销毁，BaseLayout 没有持久播放器。不能把页内选曲能力等同于全站连续播放 | T09、T11、T13；[组件音频 L17–18](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/components/MusicPlayer.astro#L17-L18)、[销毁 L498–507](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/scripts/musicPlayerClient.js#L498-L507) |
| 有效试听为前台实际累计至少 10 秒或试听结束，同 playback_id 一次 | 当前 `qualified_play` 阈值是 `min(30 秒, 时长×50%)`，`play_complete` 使用 90% 累计阈值，另发 `preview_end`。没有主文档的 `preview_qualified` 事件；采样也不能替代明确的前台时间排除 | T17、T18 严格按主文档统一口径；[客户端 L67–94](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/scripts/musicAnalytics.js#L67-L94)、[服务端事件/字段 L10–12](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/analytics.js#L10-L12) |
| Campaign 登记、试听/外站点击/游戏漏斗和真实分母 | 已有音乐匿名事件和去重、日汇总；waitlist 另有 UTM 字段。没有证据证明已实现此次跨内容 Campaign 和平台点击报表 | T17–T19；[音乐事件接收 L114–142](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/music/analytics.js#L114-L142)、[waitlist UTM L3160–3171](https://github.com/xdgf558/caption-ai-landing-site/blob/6cbb19725cd12ae718ea395711f920adef346824/src/worker.js#L3160-L3171) |
| 上线后关闭被替代的旧公开入口 | 当前旧导航、页面、动态服务与重定向均存在；本轮没有执行关闭。逐地址规则必须同时保护账号、支付、订单/积分、权益、游戏和存档依赖 | T02 制定清单，T20 隔离验证，T22 新版上线后执行 |

现有会员资格、歌曲收费政策和已购权益不在 T01 中调整。游客是否有站内试听要由推广模块配置决定；没有公开试听的歌曲仍可通过真实平台入口推广，不以整站音乐发布或开放 VIP 完整资源作为改版前提。

## 实际运行验证

验证环境为本次独立检出的 macOS 本机，Node `v24.15.0`、npm `11.12.1`；CI 使用 Node 22，本机结果不代替 CI。依赖从 npm 本地缓存按锁文件安装，没有改变 lockfile。

| 命令 | 本轮结果 |
| --- | --- |
| `npm ci --offline --no-audit --no-fund` | 通过，安装 338 个包 |
| `ALLOW_EMPTY_SERIAL_CONTENT=1 ASTRO_TELEMETRY_DISABLED=1 npm run build` | 通过，生成 153 个页面、111 条公开 sitemap 路由；postbuild 基础、四语言音乐告知和入口检查通过 |
| `ALLOW_EMPTY_SERIAL_CONTENT=1 ASTRO_TELEMETRY_DISABLED=1 npm test` | 通过，包含 package.json 的 pretest 与 test 链；覆盖现有音乐、会员、后台、游戏存档/购买、账号、支付和内容等契约检查 |
| `ASTRO_TELEMETRY_DISABLED=1 npm run test:music:runtime` | 通过，33 项 Miniflare 隔离 Workers/D1/R2 测试全部通过，无跳过；使用本地合成资源，未触及生产库/桶 |

首次 `npm test` 在默认沙盒中因本机 `127.0.0.1` HTTP 监听被禁止而中断（`listen EPERM`）；放行本地隔离测试后完整重跑通过。该中断没有通过改测试或放宽应用权限来规避。

仓库不包含 `src/content/serials`、`src/content/serialChapters` 正文目录，因此使用与 CI 相同的 `ALLOW_EMPTY_SERIAL_CONTENT=1`。构建会明确输出内容为空的提示；这次成功证明公开代码基线可构建，不证明历史私有小说正文已恢复，也不能直接作为完整生产内容包。

本轮没有执行 Playwright 全套浏览器测试、移动端完整专门套件、真机测试、线上支付、生产资源读取或远程迁移。CI 定义了更广的检查，PR 的 Actions 结果需要单独审阅。

### 后续可用命令及边界

```sh
# 锁文件安装、静态前端开发
npm ci
npm run dev

# 缺少私有小说正文时的公开代码构建
ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build
npm run preview

# 现有检查入口
ALLOW_EMPTY_SERIAL_CONTENT=1 npm test
npm run test:music:runtime
npm run test:browser
```

`astro dev` / `astro preview` 只运行静态前端，不自动提供 Worker 的账号、支付、D1/R2 和后台 API。动态路径可先用现有隔离测试核验，再在后续任务中接入明确的本地测试环境；不要把前端预览视为完整业务联调。

发布配置入口是 `wrangler.toml`，README 描述了 Wrangler 部署方式，但根 package.json 未锁定 Wrangler CLI，且现有 CI 没有生产发布步骤。本轮没有运行部署、绑定资源、上传受保护正文或应用远程迁移；T22 需要核实实际发布工具版本、内容包、资源配置和回退版本后准备上线。

## 待确认事项与本轮回退

| 暂无法确认的事项 | 缺口及影响 |
| --- | --- |
| 线上实际部署 SHA、音乐启用方式 | 仅有公开页面观察和仓库配置，需要 Cloudflare 的只读部署/绑定证据，才能判断入口、API、数据库和媒体是否属于同一部署 |
| 主库与音乐库远程迁移版本 | 未访问服务凭据、未查询远程 schema；后续新增迁移前需要确认，不假定全部本地迁移已经应用 |
| R2/CDN 隐私与真实试听资源 | 未核对远程桶设置、真实对象或公开 URL；配置名称和单元测试不能证明生产完整资源不会公开泄露 |
| 有效会员、真实订单和历史存档 | 代码路径已定位，尚未用脱敏生产证据核验实际权益及数据；T03、T12–T16 需要对应业务证据 |
| 首批歌曲、平台链接、视频和游戏推广素材 | T01 没有创建虚构上线记录；素材完整性与发布状态留给 T03 核对 |
| 手机、内置浏览器与桌面真实行为 | T01 未进行设备验收；媒体策略、外站跳转和存储限制留给相应实现及 T21 验证 |

本轮 Git 差异仅新增本目录中的报告和三份 v1.1 规范副本。未修改应用或生产数据；撤销本轮文档提交即可回退，不需要回滚数据库或关闭线上入口。

用户审查 T01 PR 通过后，进入 T02 旧路由和服务依赖清单；未获通过前不继续其他开发任务。
