# 音乐系统交接记录

2026-09-13 M6 内容流程调整：按用户明确决定，在 `codex/music-optional-source-materials` 将整个音乐后台的来源材料改为可选；未提供/pending 可继续技术核对和显式发布，blocked 仍拦截，且不伪造权利通过记录。合同见 [OPTIONAL_SOURCE_MATERIALS](OPTIONAL_SOURCE_MATERIALS.md)。本包交付实现与合同供独立审查，无远程迁移、部署、开关、配额或正式内容发布。M6 真实媒体、公开播放器及上线验收继续独立推进；本地执行/session 材料不入库。以下为历史记录。

2026-09-12 M6-01/M6-04：#152 已合并为 `main@3664d10`。当前分支 `codex/music-m6-staging-validation` 将四个音乐管理页与四语正式音乐页纳入隔离预发的精确路由/静态依赖闭包，维护部署通过生成配置强制五闸关闭。0006–0008 只落到独立 MUSIC_DB，备份、响应、计数、截图及 session 等执行材料全部留在仓库外。正式站、支付、生产会员、导航、正式作品及任何业务开闸未改。合同和回退边界见 [M6_STAGING_SURFACES](M6_STAGING_SURFACES.md)；后续仍需已登录 Access、完整 M6 回归、真机和正式内容验收。以下为历史记录。

2026-09-12 M5-03B：#151 已按用户授权合并为 main@38dc176，当前分支 `codex/music-featured-management` 补齐人工主推与管理收尾。首页最多 1 主推/6 次级/6 集合，主推必须当前免费；保存一次替换三组位置，通过 D1 primary 条件事务同时保护推荐/catalogVersion/审计/回执。公开目录当次过滤下架和损坏目标，主推失效回退到有效免费次级或最新免费曲，并显式区分回退来源。前台卡片不创建第二个 audio，不以推荐授予 VIP。合同见 [M5_FEATURED_MANAGEMENT](M5_FEATURED_MANAGEMENT.md)。本包不部署、不远程应用 0006/0007/0008，不改白名单/开关/配额，不上传本地执行或 session 材料。独立审查后下一阶段是 M6。以下为历史记录。

2026-09-12 M5-02：按用户授权合并 #150（main@db29263）后，在 `codex/music-role-preview` 实现访客、普通账号、有效 VIP、过期 VIP 四角色的只读收听界面预演。使用新读的已保存草稿/发布版本与服务器时间，默认按当前开关显示；显式模拟开放及抢先结束只影响本页显示，不能授权、播放或发布。复用既有管理 GET，补齐两个版本的有界素材元数据，不读 R2 或会员库。合同见 [四角色预览](M5_ROLE_PREVIEW.md)。下一项为 M5-03 人工主推与管理收尾；无部署、迁移、开关或白名单变更，本地执行/session 材料不上传。以下为历史记录。

2026-09-12 M5-01B：按用户授权合并 #149（main@cbbb975）后进入专辑多文件上传，分支 `codex/music-album-batch-upload`。每批 50 首、逐首 MP3/WAV、原键与会话恢复、显式把成功曲目加入草稿专辑已实现，PR #150 待独立审查，详见 [批量上传合同](M5_ALBUM_BATCH_UPLOAD.md)。专辑 listeningMode 不批量改单曲权限；无部署、新迁移、预发白名单/配额/开关修改。本地执行及 session 材料不上传。后续仍为 M5-02 四角色公开预览、M5-03 人工主推/管理收尾。以下为历史记录。

## 当前：M5-03A 专辑模型与管理

#146/#147/#148 已按用户授权合并，基线 main@9e51b4c。PR #149 / 当前分支 codex/music-album-management 实现专辑模型与管理，合同和预发顺序见 [M5_ALBUM_MANAGEMENT](M5_ALBUM_MANAGEMENT.md)。包含 0007 本地迁移、已有集合 API 扩展、专辑/歌单后台、曲序与成员封面、公开四语分类和安全链接；不批量改曲目权限，VIP 仍逐次走 /audio。后续 M5-01B 批量上传依赖此模型，四角色预览和主推收尾继续待办。

专项、全仓测试、原生 D1/R2 与构建已通过；新增后台浏览器回归由 PR CI 执行。无部署、远程迁移、旗/配额/白名单变更，本地执行记录/图片/session 材料不发布。当前预发尚不支持新后台路径和静态依赖，须独立调整、验收后部署；回退旧代码前要关 public，避免旧代码把专辑投影为部分歌单。以下待审表述为当时历史，当前合并状态以上方为准。

## 历史：M5-01A 后台 WAV 转 MP3

2026-09-12，用户授权直接进入 M5。从 `codex/music-share-cards@566cde6` 创建 `codex/music-admin-wav-transcode`，#146/#147 尚未合并。PR #148 已实现浏览器 Worker 转码、取消、输入边界和原会话恢复，本地专项/全仓测试与构建通过，待独立 review；原 WAV 留在本机，转换后仍走已有上传与服务端核验。后续专辑模型/管理与批量上传分包推进，M5 未整体完成。合同见 [M5_WAV_TRANSCODE](M5_WAV_TRANSCODE.md)。本地执行材料不进入 PR；无部署、远程迁移、业务开关或支付/VIP 改动。

## 前一切片：M4-06 歌曲分享卡片

用户追加歌曲卡片并选定第 3 套留白明信片。`codex/music-share-cards` 基于待审 #146，交付四语卡片面板、1200×630 横版和 1080×1800 竖版 PNG、真实歌曲二维码及当前发布状态驱动的 OG/Twitter 元数据，合同见 [M4_SHARE_CARDS](M4_SHARE_CARDS.md)。字体固定并核 hash，封面有界解码，渲染前过双旗/原子限流/发布投影；分享不接音频、身份或本机偏好。先审合 #146，再 retarget 本 PR 到 main 独立审查。新增旗缺省关闭，无远程迁移、部署、ops 或已有业务旗改动；设计/执行/session 材料仅本地。真实社交平台与设备验收留 M6，下一开发阶段 M5。

## 历史：M4-05 统计与隐私

M4-04/#145 已复审并合入 main@c4fbd28。codex/music-analytics-privacy 实现明确同意后的最小播放里程碑、真实累计时长、撤回/有界传输、D1 原子限流与去重、30/365/90 天保留及每小时有界清理、四语隐私和 Access 保护的只读汇总。会员中心到达、付费激活/续费仍不可用，未改原账本。合同见 [M4_ANALYTICS_PRIVACY](M4_ANALYTICS_PRIVACY.md)，待独立 review。0006 未远程应用，新增旗缺省关闭，未部署或扩大预发白名单；执行记录、图像、身份与 session 材料仅本地。下一阶段 M5，WAV→MP3 和专辑计划保持，真实设备与云端验收仍属 M6。

## 历史：M4-04 分享与会员回跳

M4-03/#144 已复查并合入 main@8f14131。codex/music-sharing-return 实现四语本站分享、目录外歌曲/完整歌单直达、剪贴板降级、会员中心显式返回和最多60秒只读资格同步。小范围会员页导航集成保留原兑换/支付保护；恢复不拉音频、看 B 不换 A，分享或成功 URL 不提供权限。合同见 [M4_SHARING_RETURN](M4_SHARING_RETURN.md)，待独立 review；下一项 M4-05。未部署、迁移、开闸或修改账本，本机设计/执行/session 材料不发布。真实设备与真实支付/身份同步仍属 M6，M5 WAV 转码及专辑计划保持。

## 历史：M4-03 歌词与本机记录

M4-02/#143 已复审并合入 main@7609f4d。用户授权进入 M4-03，分支 codex/music-lyrics-local-data 增加四语 TXT/LRC、试听源起点同步、手动暂停跟随、收藏与最近、本地版本/variant 进度、v1 迁移和存储失败降级。恢复保持无源暂停，当前资格来自新读取，用户操作优先；合同见 [M4_LYRICS_LOCAL_DATA](M4_LYRICS_LOCAL_DATA.md)。本地实现完成待独立 review，下一项 M4-04。无 Worker、迁移、业务旗、支付/VIP 或部署改动；设计图、执行记录和 session 材料不发布。M5-01A WAV 转码、M5-01B 专辑上传与 M5-03 专辑会员配置继续留在计划内。

## 历史：M4-02 手机详情与大字

用户追加“专辑”分类，随 #143 增加四语入口及空状态，不将已有歌单伪装成专辑。M5-01B 整张批量上传、M5-03 专辑管理与会员专享配置已记入计划，尚未实施；播放仍逐曲授权。

基于 main@86d06a9（#142），codex/music-mobile-design 按用户选定第一套设计实现手机曲库、详情/筛选/菜单与固定底栏。面板移动原节点，保持同一 audio；“看 B 不换 A”、原资格守卫和队列规则保持。补齐焦点循环/恢复、返回与异步 Back 竞态、底栏动态留白、200%根字号及队列移除确认修复。合同见 [M4_MOBILE_PANELS](M4_MOBILE_PANELS.md)，本地验证完成待独立 review。无部署、迁移、业务开关或支付/VIP 改动。设计图与执行记录仅本地保留；下一项 M4-03 尚未开始。

## 历史：M4-01 曲库与四语页面

基于 M3-04/#141 已合入的 main@d381af2，在 codex/music-library-routes 实现四语正式页面、公开总闸与编码路径保护、真实公开目录筛选/歌单及50条增量展示。浏览状态与音频分离，播放全部使用完整筛选结果，语言切换保留公开标识且不自动加载音频。合同和本地复现方法见 [M4_LIBRARY_ROUTES](M4_LIBRARY_ROUTES.md)。本地实现、测试/构建与浏览器检查通过，待独立 review；不部署、不添加公开导航或 sitemap，不改资格/支付/数据迁移。执行材料仅本地保留。下一项 M4-02；跨目录窗口分享直达留 M4-04，人工主推/搜索别名需后续公开合同支持，M5-01A WAV 转码计划不变。

## 历史：M3-04 系统媒体控制

2026-09-11，M3-03/#140 已按复审合入 main@751cbd5。用户授权进入 M3-04，分支 codex/music-system-media-controls：系统动作复用现有内核/队列/资格守卫，主动播放协调音乐标签页，支持缺失时保留网页播放，音量写入按能力降级。合同与本机复现入口见 [M3_SYSTEM_CONTROLS](M3_SYSTEM_CONTROLS.md)。专项、全仓测试、构建和实际30分钟观察通过，PR #141 待独立 review。未部署、未挂正式音乐路由或新增账号/Cookie 通道；M4 单独推进，M5-01A WAV 转码计划仍有效。执行材料仅保留本地。

## 历史：M3-03 资格生命周期交付

2026-09-11，基于 main@5b76920，在 codex/music-player-access-lifecycle 完成 M3-03 本地实现。新增资格生命周期模块与只传递失效信号的会员中心通知；受保护 full 在到期、账号变化及前台复核时卸源，普通 free/preview 保持；已知可用资格下主动继续可恢复合法位置，账号变化清旧位置。媒体 error 先一次 access 复核，普通媒体失败再交回有界队列。合同见 [M3_ACCESS_LIFECYCLE](M3_ACCESS_LIFECYCLE.md)，下一阶段 M3-04。测试入口纳入 npm test；本地执行记录、截图、夹具状态与 session 材料不发布。未修改 Worker、迁移、支付/VIP 账本或业务开关，未部署或挂正式路由。M5-01A 仍为后续计划。

## 历史：M3-02 队列已合并

2026-09-11，按用户复审补充列表播放重建队列的界面提示与合同，播放逻辑未改；最新提交 88c90b1 完整 CI 通过后，#139 合入 main@5b76920。下一功能任务为 M3-03 资格变化，随后 M3-04 系统控制；没有部署、开放正式音乐路由或修改业务开关。本地验证材料未上传。下述 M5-01A 计划仍有效，不因队列合并而提前实现。

## 待办：M5 后台 WAV 转 MP3 计划

2026-09-11 用户确认将“后台选择 WAV → 浏览器内转 MP3 → 上传”纳入 M5。记为 M5-01A（M5-01 子任务，TODO），独立 PR 实现；本次只更新项目记忆，不实施功能。原 WAV 留在管理员电脑，生成的 MP3 沿用受保护上传与服务端核验；进度、取消、失败恢复和文件/资源上限一并完成，依赖尚未选定。具体边界见 [TASKS](TASKS.md) 与 [DECISIONS](DECISIONS.md)。功能进度以 [CURRENT_PHASE](CURRENT_PHASE.md) 为准；本地执行记录和 session 材料继续不发布。以下为历史交接。

## 历史：隔离预发更新

用户批准先做隔离预发；#134/#135 已顺序合并，main@e077c4b 的 CI 全绿。本轮复用 #129 的专用 Access 入口及独立 MUSIC_DB/R2，部署源码 cdc481c、Worker `244276f2-4143-444b-abcd-1d0b7b301f94`，配额 0、五开关 false。0004/0005 已应用，独立限流密钥已配置；既有文档漏记 #129 部署的问题已在当前阶段更正。

0005 的裸 CASE/END 触发云端迁移拆句错误，失败后已确认无部分表/回执；改成等价条件 RAISE 后正常迁移通过。本地全仓测试、staging 6/6、限流 11/11、原生 D1/R2 25/25 与构建通过。线上后台登录加载、匿名 Access 拦截、D1 主库 schema/零数据以及真实限流 SQL 与全局失败回滚通过，临时计数数据已移除。迁移前后备份本地恢复通过。

见 [STAGING_APP](STAGING_APP.md) 的完整证据与限制：浏览器工具未能直接打开 diagnostics JSON，未声称已验收其登录态 200；当前仅后台/管理 API，公开 API 与媒体/VIP 联调、可信头、云端多实例、真机、预算告警和恢复演练仍待做。无生产部署、媒体上传或真实对象删除。

## 历史：M2-05B 限流与诊断

清理草稿 PR #134 / 89f3382 的远端 CI 全绿。第二批分支 `codex/music-rate-limits` 基于 #134，新增 MUSIC_DB-only 0005，以单语句/触发器原子扣取来源和全局分钟预算；总闸关闭仍零读写，超限和故障在曲目/会员/R2 前拒绝。来源只存类别/窗口 HMAC。新增 Access 只读汇总诊断，无个人资料/key/hash/secret，详见 [M2_RATE_LIMITS](M2_RATE_LIMITS.md)。

专项 11/11、公开 9/9、媒体 10/10、原生 D1/R2 runtime 25/25 通过。全仓 `npm test` 与 `npm run build` 通过（146 页、111 条 sitemap）；没有新增依赖、修改生产配置/cron/queues、远程迁移、真实维护、部署或开闸。真实跨区域/多实例、来源头、阈值/成本、真机和恢复演练未验证。两批先后复审，本地 M2-05 完成后下一开发任务为 M3-01 单一音频实例与状态机。

## 历史：M2-05A 清理与配额回收

PR #133 已合并 `main@1f6181e`，用户授权 M2-05，分支 `codex/music-storage-cleanup`。新增 0004（仅 MUSIC_DB）、只读分页 dry-run、独立维护开关下的单项清理、数据库停用与双向引用保护、R2 写入证明和删除后幂等回收。保留全部上传/资产/审计/幂等记录；未知迟到写入继续计费。详见 [M2_CLEANUP](M2_CLEANUP.md)。

专项 15/15、原生 D1/R2 23/23、uploads 11/11、admin 23/23、collections 9/9、全仓 `npm test` 与 `npm run build` 均通过（146 页、111 条 sitemap）。远端 CI 待 PR 创建后运行。未迁移云端、未删真实对象、未改业务开关、未部署；真实多实例及恢复演练未运行。第二批继续 M2-05B 跨实例限流与诊断。

## 历史：M2-01 公开读取

2026-09-11，基线 `main@e2bf795`，分支 `codex/music-public-catalog`。公开目录、曲目详情、歌单详情、封面/歌词以及 capabilities/access 已接 Worker。公开 JSON 只用字段白名单，共享缓存不含账号资格；VIP 和资格响应保持 `private, no-store`。歌单不改变单曲策略，下架、版本冲突和存储异常在字节读取前关闭。详见 [M2_PUBLIC_READ](M2_PUBLIC_READ.md)。

专项单元回归 9/9，Miniflare 原生 D1/R2 runtime 20/20，全仓 `npm test` 与 `npm run build` 通过，构建 146 页、111 条 sitemap。没有 UI、新迁移、配额、云端操作、正式内容、部署或开闸。M2-05 的回收、外部一致限流和诊断仍未完成；下一个功能阶段才是 M3 播放器。

## 最新：M2-03 歌单管理

PR #131 已合并为 main@837f09a；用户随后授权在分支 `codex/music-playlist-admin` 闭合 M2-03。新增受保护的歌单列表/详情/创建/保存/排序接口，复用既有 Access、同源、自定义请求头、If-Match、幂等回执、审计和 D1 条件事务。发布、已发布编辑/排序及下架会递增 `catalogVersion`；私有草稿操作不会。歌单关系不改变单曲免费/VIP 策略。

空歌单不能发布，事务内会重查至少一首曲目仍公开；曲目后续全部下架时，公共投影隐藏整张空歌单。专门回归 9/9，admin 23/23、foundation 17/17、Miniflare runtime 19/19、全仓 `npm test` 与构建通过（146 页、111 条 sitemap），详见 [M2_COLLECTIONS](M2_COLLECTIONS.md)。没有迁移、UI、云端读写、部署或开闸；M2-01 公开歌单读取与 M5-03 可视化排序仍未实现。

## 最新：M2-04 单曲媒体协议

用户授权从 main@9fc9e95 开始 M2-04，分支 `codex/music-media-protocol`。full/preview 版本化入口已接生产 Worker 路由，但公开开关仍默认关闭且没有新增绑定；关闭时不碰 D1/R2。每次请求读取当前发布修订，VIP full 在 R2 前复用原会员实时资格，preview 只读独立短文件。GET/HEAD、单 Range、If-Range、200/206/416、no-store 和无 304 合同已完成，详见 [M2_MEDIA_PROTOCOL](M2_MEDIA_PROTOCOL.md)。

本地媒体 10/10、会员 21/21、存储 12/12、Miniflare runtime 18/18、全仓 npm test/build 通过。没有部署、开闸、迁移、云端读写、正式音频、播放器或 UI。M2-03 歌单继续保持 IN_PROGRESS；它不阻断单曲媒体协议开发，但公开上线前应按最终曲库产品范围闭合。下一步先审查本轮，再由用户决定补歌单、M2-05 或继续播放器基础。

## 最新：独立预发存储

PR #127 已合并 main@726a586。用户批准建独立存储，已创建 station-cat-music-staging（8fe1a3e1-7325-4d87-a7e6-2c51338b9158）与 station-cat-music-staging-private，迁移 0001–0003 完成，配额 0，桶公开入口均关闭。资源/核验/备份详见 [STAGING_STORAGE](STAGING_STORAGE.md)。ops/music-staging-storage.jsonc 只用于存储运维，不是部署配置。生产库/桶未改，未部署、上传或开闸；测试 Worker 禁止接入这些云资源。以下“最新”为历史阶段。

## 最新：简洁音乐后台基础 UI

PR #126 已合并 main@c3cba1c；本轮分支 codex/music-admin-workspace，用户授权 UI，不含部署。新增 /admin/music/，Product Design 参照现有文章后台；范围、恢复协议和验证记录见 [M5_ADMIN_WORKSPACE](M5_ADMIN_WORKSPACE.md)。全仓、6 项客户端、11 项上传、17 项 runtime 与构建通过；CLI 浏览器 6 用例已接 CI 但待运行。内置浏览器已验证隔离上传/审核/发布链路和 390px。后续不得声称真实音乐/云端/听审或公开播放器已验收。

PR #127 初审后已复现并修复 audio.play() 测试失败：含 build 的 npm run test:browser:music-admin -- --repeat-each=3 为 18/18，通过完整发布/下架/归档；client 6/6、admin 20/20。上段“待运行”为首轮交付历史。下一步核对修复提交的远端 CI 再复审；浏览器刷新恢复 journal 的策略未改，主动重新载入才 GET 曲目。纯本地预览器使用假身份和临时数据库，禁止部署。下面“最新”标题均属较早阶段历史。

日期：2026-09-10。最新交接：PR #125 已合并，私有上传与审核发布 API 本地完成，待独立 PR 审查。下方其他阶段内容均为历史，最新状态以本节与 CURRENT_PHASE 为准。

## 最新：M2 私有上传与审核发布

基线 main@1ca7e02，分支 codex/music-private-uploads。11 项上传测试、17 项本地 workerd/D1/R2、npm test/build 通过，145 页/111 sitemap。见 [M2_PRIVATE_UPLOADS](M2_PRIVATE_UPLOADS.md)。上传流/配额预留、complete 真实文件校验、私有审阅下载、技术确认和成功发布 API 已连通；旧公开版/权利/事务边界保留。

0003 只能用于 MUSIC_DB，本地默认 quota=0，需另批配置。一次写入会话不可接管，丢响应先查状态/complete；失败或过期预留仍计费，安全清理和配额回收留 M2-05，不可直接删除会话/回执。无新依赖；image-size 候选撤回，原 9 项 audit 告警未处理。无云端资源/迁移/部署/正式音乐或 UI。fixture Worker 含假身份和上传测试前缀，绝不可部署。

下一步先审查；之后可授权简洁后台基础 UI，使用 Product Design。公开音频 Range/VIP 守卫、歌单、清理/外部限流和真机/预发仍未完成，不能因为本地发布成功就开闸。PDF/图像仅有限结构检查，MP3 不是完整解码，试听语义同源和真实权利必须人工核对。

## 历史：M2-ADMIN

用户授权管理接口接入，基线 main@9dc86e3，分支 codex/music-admin-api。20 项管理接口、21 项会员、25 项发布、14 项本地 workerd/D1/R2 测试和全仓 npm test/build 通过，145 页/111 sitemap。见 [M2_ADMIN_API](M2_ADMIN_API.md)。

完成音乐专用 Access JWT actor（不采信 email/Host/local bypass）、同源/custom-header 防护、64 KiB JSON 上限与读超时、草稿新版本、人工权利记录、下架/归档/审计。写操作同批事务/零命中回滚/幂等回执；旧公开版与历史不被草稿保存覆盖。未接完整验证器，所以 HTTP publish 固定 503。#121 重复 Cookie 对齐、异常 clock/budget 和迟到 rejection 回归已完成；#122 畸形 metadata 422 有回归。

下一批是 M2-02 私有上传、配额/租约、完整验证器与技术审核，再接成功发布闭环。歌单、公共媒体、清理/限流和真实预发仍待做。没有创建资源、迁移、部署、上传正式内容、UI 或音乐开闸；测试 stub 不代表正式审核，禁止部署 fixture Worker。以后涉及 UI 仍必须 Product Design。

## 历史：M2-RUNTIME

用户授权先做运行环境与存储适配。基线 main@3c48aa4，分支 codex/music-runtime-storage；12 项存储、10 项本地 workerd/D1/R2 测试、全仓测试通过。正常 npm ci 可重建；运行时套件进入独立 CI 步骤，源代码与合成夹具均可从仓库复现。见 [M2_RUNTIME_STORAGE](M2_RUNTIME_STORAGE.md)。

完成规范音频 key 与条件 GET、原生 BYOB 每块不超过 64 KiB、共享 GET/解析期限和取消清理，完整本地 D1 发布/回执重放/末尾零命中回滚，32 MiB/4 MiB 单读与四并发。测试用独立 reader D1 核对 INTEGER 账号和 UTC TEXT 期限的只读资格查询，不使用真实会员资料。

尚未创建云端 MUSIC_DB/R2、迁移/部署、发布音乐或开闸；没有 UI。真实预发、实际套餐 CPU/整体 heap/多实例、对象删除竞态、完整证据验证与人工试听仍待做。测试权利/证据 stub 不代表完整生产发布。#121 Cookie/异常 clock、空歌单、#122 metadata 422 留管理/媒体接口批次。以后 UI 按要求调用 Product Design。

新增固定测试依赖的告警已通过限定子依赖版本处理；原站 9 项依赖告警仍存在，不宣称 npm audit 全绿。原站依赖大版本升级单独处理。

## 历史：音乐 M1-05

用户授权合并 #122（main@ac8ac76）后，再批准本批解析器开发。分支 codex/music-mp3-validation 增加流式测时/hash、严格帧/ID3/预算检查、对象与试听源绑定；没有迁移或路由。21 项解析测试及 24 项发布测试通过，五份本地合成 MP3 与独立 FFmpeg packet 计数一致，本地 workerd 测量与截断拒绝通过；npm test/build 通过，145 页/111 sitemap。

详见 [M1_MP3_VALIDATION](M1_MP3_VALIDATION.md)。M1 本地基础完成，不等于真实资源交付；没有上传正式音乐、创建库/桶、部署、修改会员/支付或开闸。结构解析不是完整解码或语义同源证明；支持范围与 CPU/内存边界已明确，FFmpeg 仅本地生成测试文件，不进入应用。

下一步按授权做 M2，先补预发独立 D1 完整 publish/回滚、真实对象核验和 Access JWT + Origin/CSRF。#121 的重复 Cookie/异常 clock/生产查询、空歌单、#122 metadata 错误分类均仍待处理；D1/R2 删除竞态未解决。依赖审计另有原有版本 9 项告警，两项新库无列入告警，不混入本批全站升级。后续 UI 必须 Product Design。

## 历史：音乐 M1-04

用户批准先合并 #121 再开工。核验已审核 head 73229af、CI 通过后标 ready，合并为 main@233d716。分支 codex/music-conditional-publication 实施条件发布、双审核指纹、幂等回执保护和独立迁移 0002；23 项发布测试通过，npm test/build 通过（145 页/111 sitemap），本地 D1 增量迁移和 changes() 零行整批回滚合同验证通过。

见 [M1_PUBLICATION](M1_PUBLICATION.md)。未改 Worker/支付/会员、未接路由、未部署/创建资源/上传或发布真实作品。缺省验证器仍返回 503；本地注入结果不是 MP3 或 R2 验收。下一步 M1-05 真 MP3 解析，再推进 M2。未来 UI 开发仍须 Product Design。

#120 mutations REPLACE/UPDATE 保护和发布统一校验已完成；空歌单留 M2。#121 重复 Cookie、异常配置和真实 D1 会话查询仍留 M2；本地发布 guard 实测不能替代资格适配的生产验证。

## 历史：音乐 M1-03

用户要求“先合并，然后做 M1-03”。PR #120 CI 通过后标 ready，以已审核的 77f5411 合并为 main@8994fa4。未部署音乐、未执行迁移、未创建音乐资源。

分支 codex/music-readonly-vip：新增 membership.js 只读适配和 access.js 合同，复用原会员日期/资格判断与四语会员中心路径。18 项测试包含真实兑换与人工审核函数的隔离联测，不是生产交易。详见 [M1_VIP_ADAPTER](M1_VIP_ADAPTER.md)。本批没有 UI；涉及 UI 的后续批次仍要求 Product Design 和桌面/移动验收。

退款规则早已确定为 #119 人工审核且已上线，用户报告真实验收完成。以下 M0 的“待确认”句子只保留历史，不构成当前阻断项。#120 三项非阻塞建议已在 M1_VIP_ADAPTER 分配到 M1-04/M2，尚未实现，不把本 PR 当作已修。

下一步审查 M1-03，然后 M1-04 条件发布与 M1-05 真 MP3 解析；无生产部署或开闸授权。

## 历史：音乐 M1-01 / M1-02

用户确认退款后台登录后验收和真实撤销已经人工完成，随后批准本轮音乐隔离开发并要求涉及 UI 时调用 UI 技能。PR #118/#119 已上线；不再把退款规则或部署标成待确认，也不把人工验收扩展为 Safari/多实例测试。

分支 codex/music-m1-foundation，基线 main@dee3cdf。新增独立 migrations-music 初始化、src/music/policy.js、catalog.js 与 Node/SQLite 测试，详见 [M1 基础](M1_FOUNDATION.md)。本地 D1 模拟器迁移及完整性检查通过；npm test/build 通过，17 项音乐测试，145 页面/111 sitemap。无 UI，不跑音乐 Playwright。

未改 Worker、原会员模块、支付、wrangler、导航或生产数据库；未创建真实音乐桶/库、上传素材、发布或开闸。下一步审查本轮，然后 M1-03 资格适配、M1-04 发布事务、M1-05 MP3 实测。以后涉及页面/播放器 UI/后台 UI，必须调用 Product Design 技能，并做桌面/移动端验证。

## 历史：原会员独立修复进行中

M0 PR #117 已合并为 19a4436。用户要求在下一阶段前修复会员与回跳。独立分支 codex/fix-membership-redemption-safety 实施原会员原子兑换、账号绑定幂等回执、浏览器持久重试、严格 UTC 有效期与共享安全回跳；新增迁移 0036，仅本地测试，未改价格或生产资源。见 [修复说明](../reader-membership-safety.md)。

退款对 VIP 的撤销规则仍在等待用户确认，尚未实现；不能把这部分标为已关闭。M1–M6 保持 TODO，不自动继续音乐开发。M0 历史审计入口现改跑正确行为回归，旧复现保存在 git@19a4436。

本次原会员修复验证：npm test、npm run build 通过，144 页/111 sitemap；支付浏览器 30 例通过。新增迁移只用于内存测试，生产未执行；本批按独立 Draft PR 送审，不自动部署或推进音乐阶段。

## 历史：用户授权开工后的 M0

用户在文档规划后明确“好的，开工吧”；本轮按已说明范围只执行 M0，不自动继续 M1、不改原支付。

已完成 M0-01 至 M0-05：核对真实 Worker/VIP/后台/路由/语言/资源，新增 DECISIONS、MEMBERSHIP_INTEGRATION、COMMERCIAL_RULES、TEST_MATRIX、OPERATIONS 和 evidence/audit-current-membership.mjs，更新记忆与任务状态。fetch 后 origin/main 仍是 3b8bbc8。

关键发现：现有 VIP 每账号仅一条期限行，没有多 grant/显式终身/退款撤销合同。真实 Worker + 内存数据库测试复现相同请求键双扣点、会员写失败仍扣点、未来开始时间仍 active、退款保留 VIP；会话查询写 last_seen，回跳 helper 可把 slash-backslash 解析为站外。均未修改，原会员修复单独提出；不凭负积分撤销、不另造会员账本。

验证：M0 审计脚本、npm test、npm run build 均 exit 0；144 页、111 条 sitemap。公开 payments/status 匿名 GET HTTP 200，响应时间 2026-09-09T12:06:10Z，仍 100 积分/USD10、10 点/1 月；没有读取生产会员、发送真实交易或创建资源。未跑 Playwright/真机，未部署。

用户随后要求开 PR 审查，本变更按独立 M0 Draft PR 送审；不包含功能修复，不自动合并或部署。下方 PREP 的未提交状态属于历史记录。

PR #117 审查无 P1/P2。两项 P3 已在文档中修正：Worker 函数行号按基线核准；语言切换明确使用音乐专用映射，繁中直接到 `/music/`，而非仅扩展 standalone 正则。原会员/回跳修复仍须独立 PR；审查通过不代表部署、开闸或批准改支付。

下一步建议：先授权独立修复原会员原子性/幂等与共享回跳校验；退款/续期关联政策需用户确认后处理。音乐 M1 可先做隔离数据/策略/发布守卫/解析器，真实 VIP 接入依赖合同解决，默认四开关关闭。M0 DONE 不是商业开闸批准。

本地持久化入口 PROJECT_CONTEXT -> CURRENT_PHASE -> TASKS -> MEMBERSHIP_INTEGRATION。新会话先读这些文件，不把下面 PREP 的历史“未审计/未运行”当作最新状态。

## PREP 历史记录

## 本轮输入

- 用户提供 Station_Cat_Music_开发文档_v1.1_VIP整合版.md。
- 用户提供 Codex_音乐页面开发启动指令_v1.1.md。
- 用户明确要求暂不动工，只读文档、拆任务并纳入记忆。

两份来源保存在 DEVELOPMENT_SPEC.md 和 CODEX_START.md；原文保持独立，不覆盖彼此。它们描述未来系统，不代表功能已存在或已获得部署授权。

## 已完成

- 阅读完整规格第0–23节、附录及配套启动指令。
- 新增 docs/music 下的两份规格副本与 PROJECT_CONTEXT、CURRENT_PHASE、TASKS、HANDOFF 四份记录。
- 按 M0–M6 拆分32项 TODO，另将 PREP 文档准备标 DONE。
- 记录私有媒体、统一VIP、独立试听、版本化发布、真机验收及分阶段授权门槛。
- 记录规格快照4e0bd66已落后于本地origin/main 3b8bbc8；没有借此推断生产会员/退款细节。
- 新建本地 codex/music-planning 分支，以已合并的 main@3b8bbc8 为基线。

## 验证与未执行

实际操作仅为文档读取、仓库状态/文件清单检查及文档写入；交付前核对来源副本、相对链接、任务编号/数量和仅docs/music变更。

未运行 npm test、构建、Playwright 或任何音乐功能测试；本轮不修改运行时，无需用无关构建冒充音乐验收。未深入审计 Worker/VIP/退款、未联网复核来源条款/费率、未登录管理后台、未查询会员、未创建R2/D1、未上传音乐、未迁移、未收费、未发布、未部署。未提交、未推送或创建PR。

尚待真正实施时补充的 DECISIONS、MEMBERSHIP_INTEGRATION、COMMERCIAL_RULES、TEST_MATRIX、OPERATIONS 已列入 M0-05，不创建内容重复或假装已核实的空壳证据。

## PREP 时的下一次接续建议

先读 PROJECT_CONTEXT.md、CURRENT_PHASE.md、TASKS.md 和用户最新要求。若用户明确授权启动，先开展 M0 只读现状核对，将真实代码映射、退款依赖及需授权事项写明，再决定后续阶段；不能根据 CODEX_START 原文自动继续 M1。

需要向用户索取正式内容时，集中提出实际必要材料：少量候选完整MP3、对应独立试听、封面/歌词和权利核对材料。不要现在要求用户准备全500首，也不要把30首、免费比例或每月4–8首的运营示例变成硬性承诺。

音乐模块与已有游戏内音乐不是同一项目，不改写 docs/cat-life-game-music.md，也不覆盖原站根目录阶段记录。
