# T20 旧地址退出与搜索配置

T20 在本机隔离环境实现旧公开入口退出、新品牌首页与四语言关于页、站内导航和搜索元数据。当前生产配置和开关保持原状；本任务交付独立 PR，用户审查后决定合并。生产迁移、发布和旧入口关闭属于 T22，T21 的真实媒体及设备验收尚未执行。

## 基线与边界

分支 `codex/station-cat-redesign-t20` 从 T19 实际合并提交 `062ee92416f391099711bf397c9d15cedd7d8ef9` 开始。T19 [PR #204](https://github.com/xdgf558/caption-ai-landing-site/pull/204) 的复审头 `f029902929d9dcc8272d5f700d21f7f0010dd837` 在完整 CI `37939570685` 的 41 步成功后，于 2026-10-09 15:07:15 UTC（新加坡 23:07:15）squash 合并。[合并事实](T20-evidence/T19-merge-result.json) 与 [精确头 CI](T20-evidence/T19-approved-head-ci.json) 分开保存。

T02 的 780 行仍是源码地址与业务依赖基线。迁移按实际处理器和数据判断，不把 CSV 的邻近方法提示当成权限合同，不执行 `station_route_migrations` 中的提案。网页 `stationcat.music.v2` 与原生 `/api/mobile/v1/me/music/*` 分别保留；账号、历史订单、会员、完整音频、云存档、支付回调和真实游戏仍由既有服务判断权限。

## 默认关闭与上游路由前提

退出层在原公共 HTML、命名空间和静态重定向之前，在管理员 Access 检查之后执行。以下五开关必须全部开启；缺任一项，在解析方法或读取绑定之前返回 `null`，交回原调度：

- `STATION_ROUTE_MIGRATIONS_ENABLED`
- `STATION_CONTENT_PUBLIC_ENABLED`
- `STATION_MUSIC_PAGES_ENABLED`
- `STATION_GAME_PAGES_ENABLED`
- `STATION_MEMBER_PAGES_ENABLED`

`STATION_SEARCH_INDEXING_ENABLED` 另外控制索引，且要求主机为 `https://wwwstationcat.org`。其他预览主机即使开索引开关仍 noindex。原 T08/T12/T14 的独立页面开关行为保留；T20 返回 `null` 不屏蔽这些既有处理器自己获准的行为。

隔离环境采用原生 Miniflare Assets 路由，所有请求先到 Worker，解析实际 Astro 构建的 `_headers`/`_redirects`。主 `wrangler.toml` 未修改；其 `run_worker_first` 不能覆盖全部首页、关于、旧应用、游戏和搜索地址。开关无法修改上游路由。[只读配置合同](../../src/redesign/routeMigrationProfile.js) 和报告明确返回 `primaryRouting.satisfied=false`，不冒充生产切换就绪。T22 必须补齐并核对该范围，再授权启用与关闭。

## 旧地址与服务顺序

| 地址类型 | 隔离启用后的结果 |
| --- | --- |
| 四语言首页、关于 | 温柔小站；地址别名/无斜线 301。首页读取 T07 已发布白名单投影，草稿保留空态；关于补齐四语言品牌正文。 |
| 应用、日志、资讯、小说介绍等退休公开入口 | 已知静态和实际已发布旧内容返回真正 410；不存在的后代 404；动态查询故障 503，不用故障推断不存在。 |
| 旧 `apps/cat-life-game` 介绍 | 实际已发布新游戏实体存在且目标规范地址吻合后，301 到对应 `/games/cat-life-game/`。根旧应用目录原为英语，根介绍保持英语目标。目标未就绪 503。 |
| `/games/cat-life/` 与运行脚本/素材 | 先按服务放行，原地址、原字节及嵌入策略保留，不改到介绍页。 |
| 音乐目录、旧 `?track=` 及音乐后代 | 复用 T08 已发布实体映射，含编码/语言/无斜线别名。旧发布歌曲仍存在而新实体未发布时 503；确认不存在才 404；未知后代不进入旧软 200 页面。 |
| 有效旧 `?collection=` | 保留旧专辑处理器，没有新建专辑详情；规范化只保留合法选择和安全推广参数。 |
| 章节与旧 `/works/:series/:chapter/` | 保留实际存在的 root/en 阅读地址。未登录 303 到现有账号入口并带受控返回地址；登录后规范化或交回旧阅读处理器，购买检查保留。小说 member 是登录要求，不是音乐 VIP。 |
| 下载、应用支持/条款/隐私、账号、AASA、原生、支付与存档 API | 原处理器继续决定方法、状态、身份和权限，T20 不额外授予访问权。 |

路径只解码一次，拒绝二次编码、控制字符、查询/片段注入；清理重复推广参数和私密 token。退休/故障页 noindex、private/no-store，不重定向首页制造软 404。重定向来自确定的同站实体或规范地址，不执行任意数据库目标。

路由提案的软关联输出单独审核结果，`approved_at` 不会让提案自动执行；实体、阅读权限和 HTTP 留 T22 核对。没有新增迁移、业务写入或生产清理。

## 首页、链接和搜索

首页复用现有组件、位图和 CSS，移除本机夹具验收控件。私有 Astro 模板位于原受控 `/music/site-shell/`；公开根页仅由完整组合开启后的 Worker 渲染，默认生产构建仍生成旧公开页面。主推、平台、试听和短片由 T07/T16 已发布投影决定，音频模式不授予完整播放。素材继续待定，无免费回退或例歌发行。

组合开启时，仅 GET/HEAD、200、text/html 响应统一处理元数据；API、后台、认证、下载、私有模板和游戏运行端排除。原状态、Cookie、安全头保留，页面 private/no-store。公共规范页输出 canonical 和四语言 hreflang；筛选目录/旧专辑、登录阅读 noindex，私有阅读无公共 canonical/语言关联。语言切换沿用合法 track/collection，关于不再回到繁中地址。

旧页头/页脚改五导航；退休内容链接去掉可点击地址，章节链接保留，旧游戏介绍链接指向新介绍，运行目录不改写。搜索弹窗只过滤五个入口，不是全文搜索。

实时 `/sitemap.xml` 列出 base 和全部音乐/游戏分片。base 是四语言首页、音乐、游戏、关于，不列会员、章节、旧内容、素材或游戏运行目录。作品重新经过当前发布、权利和资源投影，失效引用排除；每个实体统一投影再输出四语言，避免反复读取同一资源。

分片按稳定 UUID 区间与 `at` 上界切分，每页最多 10 个候选。撤回前页歌曲不会因 OFFSET 位移让后页漏项；当前区间超过预算则 503，不截断；每类超过 10000 候选同样拒绝。D1/R2 无跨系统快照，sitemap 不保证一次抓取全局不可变；各分片继续检查当前权利和资源。

本机 robots Disallow 全站；正式主机额外获准索引后不屏蔽退休地址，让爬虫能看到真实 404/410，并指向实时 sitemap。AASA 未扩大，新单曲路由不因此获得原生关联覆盖。

## 备份与逐地址证据

[基线文件及路径](T20-evidence/baseline-source-and-paths.json) 在改动前保存 168 个 HTML 构建地址与关键源码哈希。静态清单固定 T19 基线和 T02 CSV 哈希，可用 `node scripts/build-station-legacy-inventory.mjs --check` 复算；应用支持、隐私、条款、下载从退休列表排除。

每次演练在第一个 HTTP 请求前保存 [合成引用备份](T20-evidence/fixture-reference-backup.json) 和 [恢复边界](T20-evidence/recovery-boundary.json)。仅临时夹具，实际生产未导出/备份/迁移/物理删除，源码文件未删除，Git 基线可恢复。生产备份和引用导出仍是 T22 条件。

[最终 HTTP 报告](T20-evidence/route-http-report.json) 保留 780 行，626 个 literal 地址分别请求关闭态/隔离启用态，154 行模板和匹配器没有冒充具体 HTTP：

| 验证标签 | 行数 | 含义 |
| --- | ---: | --- |
| isolated-response-observed | 35 | 本机新页或规范化响应 |
| source-template-or-matcher | 154 | 源码模板/匹配器，关键实例另由专项覆盖 |
| original-handler-status-retained | 260 | 服务由原处理器保留相同状态/目标，不是完整权限通过 |
| unchanged-fixture-unavailable | 176 | 两态均缺真实服务配置，保持未验收 |
| isolated-exit-status-observed | 154 | 对应 301/404/410 或目标未就绪 503 |
| existing-member-page-canonicalization | 1 | 根 library 别名由已有 T14 规范化到繁中账号入口 |

响应保存 GET、状态、Location、缓存、robots、有限完整正文 SHA-256。所有行 `productionVerified=false`、`methodsAndPermissionContractVerified=false`。数量、原 sitemap=yes、相同状态或合成素材不等于生产验收；生产动态 slug、外部推广链接、正式客户端和身份/方法合同仍需补齐。

## 最终验证与预览

生产源码修改完成后重跑检查，原始日志与源码哈希见 [验证摘要](T20-evidence/verification-summary.json) 和 `T20-evidence/logs/`：

- T20 24 项：五开关、方法/编码、原生 Assets、退休/映射/未就绪、四语言、章节登录/历史购买、服务/AASA/游戏字节/存档、完整分片与撤回前页无漏项、索引条件及故障关闭。
- 公开查询 35、音乐页 26、游戏/存档 52、会员 32、独立原生音乐 18，共 163 项。
- 旧/新共享播放器 149 项；T04 路由 7、T05 首页 19 项。
- 完整 `npm test`、12 项销户分类审计、空正文 Astro 构建、staging 8 页/37 份精确资源通过。空正文构建不是生产包。

播放器原生路由用例初次在沙箱因 `listen EPERM` 失败；原始日志保留，相同源码允许 loopback 后重跑 149 项通过，没有据此改生产逻辑。

只读预览 `http://127.0.0.1:4220/` 仅接受 loopback GET/HEAD，不转发真实 Cookie/认证、无外网出口；首页是草稿待定状态，目录是合成资料。可用 `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run preview:redesign:routes` 重建。IAB 保存默认桌面、1356/390/320 首页及 320/390/768 关于证据，实际语言切换/搜索焦点通过，控制台无 warning/error。[设计 QA](../../design-qa.md) passed。

本机证据不代替本 PR 精确头完整托管 CI。T20 只覆盖隔离 A14/A15/A17，不将全部 A01–A22、生产资源/云冲突、真机/VoiceOver 标为通过。已发出的云写入、本机跨进程窗口、退出 1 秒等待及同源 iframe 边界保留此前限制。

T21 继续核心回归与设备/真实素材；T22 才准备并按实际授权执行生产配置、备份、开关、索引和上线后直接关闭。目前未合并本 PR、部署、远程迁移、启用生产开关、账号清理或关闭生产旧入口。
