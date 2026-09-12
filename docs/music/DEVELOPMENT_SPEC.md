# Station Cat Music 在线音乐页面开发文档

2026-09-13 规则更新：整个音乐后台的来源材料已改为可选，详见 [OPTIONAL_SOURCE_MATERIALS](OPTIONAL_SOURCE_MATERIALS.md)。以下历史描述中必填来源/凭证及必须先取得 approved 的要求被替代；明确 blocked 仍阻止技术核对/发布，主动提交 approved 的完整性校验和技术核对要求保留。

版本：v1.1（现有 VIP 音乐权益整合版）  
文档日期：2026-09-09  
目标网站：`https://wwwstationcat.org/`  
目标仓库：`xdgf558/caption-ai-landing-site`  
交付对象：站点所有者、Codex、代码审查人员  
交付性质：产品与实施规格修订；本次仅更新文档，未修改仓库代码、会员价格、支付产品或生产资源，也未运行网站功能测试。  
替代关系：本文完整替代 v1.0 的实施规格；已开发部分先做差异核对，不得直接覆盖数据库或重置既有项目进度。

## 0. 执行摘要

在 Station Cat 原网站新增音乐栏目，展示站长通过 Suno 创作、经人工核对可用于本站商业运营的作品。采用“免费精选完整收听、VIP 专属曲库、指定新歌提前体验”的组合，音乐权益直接并入现有全站 VIP。

**本次已确认的经营决策：继续使用 R2；首发不出售独立音乐会员，不增加音乐附加费，不调整现有 VIP 价格。有效的既有全站 VIP 自动获得音乐权益，会员有效期、原有权益和已购独立商品保持原规则。**

访客免登录浏览、收听免费歌曲、试听 VIP 歌曲、查看歌词和故事，以及在本浏览器收藏和分享。会员完整收听资格由现有账号及服务端 VIP 权益判断，积分余额或前端 VIP 标记均不能作为资格依据。

技术上沿用 Astro、单一 HTMLAudioElement、现有 Cloudflare Worker，新增独立 MUSIC_DB 与私有 R2 Standard MUSIC_BUCKET。既有会员数据仍留在原系统，音乐通过只读适配层查询，禁止创建另一套音乐会员到期表。每次完整音频请求，包括 HEAD 和 Range，都执行当前发布状态和访问资格检查。

VIP 歌曲采用独立短音频提供试听，默认上限 45 秒，短曲按第 10 节裁剪。禁止向免费访客传输完整文件后仅靠 JavaScript 倒计时停止。所有已发布作品的封面、歌词、介绍及基本播放器能力保持开放。

音乐页内切换列表、歌单、详情和歌词保持播放。整页刷新、语言切换、跳往小说或游戏等栏目只保存进度，返回后由用户手动继续。全站连续播放、离线缓存、访客下载、自动续费改造和独立音乐套餐均不作为首发销售承诺。

本次同步修改产品范围、商业规则、数据模型、接口合同、播放状态、发布门槛、权限测试、统计口径和实施任务。v1.0 的“首发全部免费、会员鉴权不在范围内、统计只留待后续”等条款已被替换。

## 1. 已核实基础、设计假设与待确认事项

### 1.1 已核实的网站基础

以下来自本次读取的网站仓库文件，代表读取时的配置，不代表音乐功能已经存在。来源索引见第 23 节。[R1][R2][R3][R4][R5][R6][R7][R8]

| 项目 | 已确认内容 | 对本项目的影响 |
| :--- | :--- | :--- |
| 网站与仓库 | Station Cat，`xdgf558/caption-ai-landing-site` | 在原仓库中增量开发 |
| 前端 | `package.json` 声明 Astro `^5.0.0`、TypeScript `^5.6.0` | 沿用现有版本和锁文件，不为音乐页升级整个站点 |
| Node | `engines.node` 为 `>=22.13` | 遵循项目环境约束 |
| 服务入口 | `src/worker.js` | 只增加音乐路由分发，不改写原有业务 |
| 静态部署 | `wrangler.toml` 配置 `ASSETS`，静态资源目录为 `dist` | 音乐页面壳由 Astro 构建 |
| 已有存储 | `WAITLIST_DB`、`CONTENT_BUCKET`、`DOWNLOADS_BUCKET` | 不将现有桶设为公开，不修改原业务表 |
| 后台 | 已有 `/admin-v2/`；已有封面上传与后台保护设计 | 在后台增加音乐工作区，复用鉴权能力 |
| 公共布局 | `src/layouts/BaseLayout.astro` | 沿用页头、页脚、SEO 和语言字段 |
| 语言 | 公共布局支持 `en`、`ja`、`zh-Hant`、`zh-Hans`，默认 `zh-Hant` | 音乐页面接入同一语言机制 |
| 样式 | 暖白底、绿色主色、珊瑚色强调 | 首版保持主站风格，不整体改成深色音乐软件 |
| 播放持续性 | 本次读取的 BaseLayout 未配置 Astro ClientRouter | 首版不承诺全站导航不断播 |
| 仓库约束 | 根目录已有 `AGENTS.md` 与阶段文件 | 音乐任务使用独立文档，不覆盖其他项目记忆 |
| 现有收款设计 | `docs/creem-payments.md` 说明 Station Points 通过 Creem 一次性购买 | 复用现有会员中心，不擅自新建订阅产品或改写充值 Webhook |
| 会员配置迹象 | Worker 的内容定价归一化含会员积分成本和按月时长配置 | 必须进一步核对全站 VIP 权益与作品级权限，不能由这些字段直接判定全站资格 |

读取到的仓库树版本为 `4e0bd665548cec5a82c1c2ad22e9771f148bc909`。实施开始时必须重新检查工作分支及实际差异；不得将本次读取结果当作永久不变的代码状态。

### 1.2 本文采用的设计默认值

以下为本次确认方案下的开发默认值。作品数、试听长度和更新频率属于可配置设计参数，不代表现有经营数据。

| 项目 | 默认值 |
| :--- | :--- |
| 栏目名称 | Station Cat Music，中文显示“音乐小站”或相应繁体文案 |
| 运营主体 | 站长个人创作展示 |
| 首版范围 | 一个音乐栏目，加一个后台音乐工作区 |
| 内容规模 | 先按最多 500 首已发布歌曲设计 |
| 上传人员 | 现有后台管理员，访客不可上传 |
| 收听方式 | 免费曲免登录完整播放；VIP 曲提供短试听，有效全站 VIP 完整播放 |
| 个人收藏 | 当前浏览器本地保存，不生成全站点赞量 |
| 运营指标 | 首发实现第一方收听与会员入口漏斗；隐私和开关满足上线要求后启用，不伪造数据 |
| 初始曲库 | 使用站长实际提供的作品；测试歌曲不得混入正式曲库 |
| 播放来源 | 合法取得的音频文件上传至站点私有 R2 |
| 来源材料 | 整个后台可选；明确不通过仍阻止发布，选择通过仍核验完整依据。见 OPTIONAL_SOURCE_MATERIALS |
| 会员模式 | 复用现有全站 VIP；已有有效会员新增音乐权益，无附加费 |
| 定价及结算 | 读取现有产品与会员中心配置，首发不改价、不增加自动续费 |
| 新歌抢先 | 默认提前 7 天，逐曲记录确切结束时间及结束后 free/vip 去向 |
| 下载与商用 | 首发无音频下载功能，收听权益不包含第三方商用许可 |

### 1.3 暂时无法验证的事项

尚未检查用户的 Suno 账户、每首歌生成和下载时的套餐、原始歌词与封面权利、既有授权邮件、实际音频文件、Cloudflare 账户剩余额度及当前生产 Access 策略。因此不能宣称所有现有作品均可公开发布，也不能承诺新增功能零费用。

用户已说明全站 VIP 已上线；本次没有读取生产会员名单、实际售价、退款处理结果或每个权益的范围。仓库付款文档与部分配置代码只能证明存在相关设计，不能证明自动续费已经开通，也不能证明退款已自动撤销所有相关会员权益。[R7][R8]

M0 必须明确：当前全站 VIP 的唯一服务端判定、账号状态、起止时间、赠送及历史权益、撤销逻辑、会员中心语言路由，以及购买成功后的到账核验方式。未知项保持待核对，禁止用代码默认价、积分余额或任意小说权限代替。查询不到可靠资格时，对受保护完整音频关闭访问，免费歌曲及试听继续工作。

这些事项不阻碍使用自制测试音频和隔离会员 fixtures 开发。正式作品发布必须通过第 3 节的检查；生产资源创建、付费套餐变更和正式部署仍需由有权限的站点所有者执行或授权。

## 2. 产品定位与版本范围

### 2.1 核心体验

访客进入页面后，应能快速理解这里是站长的音乐创作集，找到一首想听的歌曲并开始播放。音乐应与站点已有的猫、早餐、小说和独立作品内容形成自然联系。

建议栏目介绍文案：

> 把日常、故事和一点奇怪的灵感，做成可以反复听的声音。

歌曲说明统一允许展示“使用 Suno 创作”，并填写真实的歌词、编曲调整或后期制作参与情况。没有真实人声演唱时，不虚构歌手身份或真人演唱经历。

### 2.2 P0：首发必须完成

| 模块 | 必须交付的能力 |
| :--- | :--- |
| 音乐首页 | 推荐作品、最新发布、搜索、风格和心情筛选 |
| 播放器 | 播放、暂停、上一首、下一首、进度拖动、音量、静音 |
| 队列 | 列表播放、随机播放、单曲循环、列表循环、查看和移除待播项 |
| 详情 | 封面、歌曲名、创作者、简介、创作故事、歌词、来源说明 |
| 歌单 | 管理员创建主题歌单、排序、整单播放 |
| 本地数据 | 收藏、最近播放、播放位置和设置恢复 |
| VIP 整合 | 复用现站账号、资格和会员中心，既有 VIP 自动获得完整收听权 |
| 试听及分层 | free/vip/early_access 标签、独立试听文件、免费队列过滤 |
| 到期和异常 | 登出、到期、资格撤销、账号切换、付款待同步、权限服务故障 |
| 基础运营统计 | 免费/试听/完整收听分开统计，会员入口点击与可验证的权益激活归因 |
| 分享 | 稳定歌曲链接、复制链接、可用时调用系统分享 |
| 手机体验 | 响应式布局、底部播放器、全屏详情、触控操作 |
| 后台 | 上传、试听、编辑、授权核对、发布、下架、归档 |
| 安全与运维 | 鉴权、资源隔离、Range 播放、审计、错误反馈、回滚 |

### 2.3 P1：上线后再增加

单曲独立 SEO 页面和专属分享卡片、深入的留存与续购分析、桌面歌词时间点编辑器、批量导入、睡眠定时器、夜间主题、专辑展示、服务器可控的媒体缓存优化。统计基础事件与有效资格核对属于 P0，复杂看板和归因实验属于 P1。

### 2.4 P2：有实际需求后评估

全站跨页连续播放、与小说阅读页联动、账号收藏同步、可安装 PWA、多码率与异步转码任务系统。离线缓存、下载或商业授权需要单独的产品与权利评估。

独立音乐会员、自动扣费改造、新增年度或终身套餐、按次扣积分、单曲交易、访客上传、第三方音乐搜索和 AI 音乐生成服务均不在首发范围内。音乐的 VIP 完整收听能力已纳入 P0。

### 2.5 会员权益矩阵

| 权益 | 访客及普通账号 | 有效全站 VIP |
| :--- | :--- | :--- |
| 免费精选 | 完整收听，正常使用不限次数 | 完整收听 |
| VIP 曲库 | 独立短片段试听，默认至多约 45 秒 | 完整收听 |
| 指定新歌抢先体验 | 抢先期内试听，之后按预设去向开放 | 发布后即可完整收听 |
| 歌词、封面、故事、来源说明 | 开放 | 开放 |
| 切歌、进度、循环、基础队列 | 在可听资源范围内开放 | 开放 |
| 本机收藏与播放记录 | 开放 | 开放 |
| 主动文件下载、离线缓存 | 不提供 | 不提供 |
| 视频配乐、广告、再分发或转售许可 | 不包含 | 不包含 |

两类用户使用的免费完整歌曲应为相同版本与音质。不会为收费故意劣化基础播放器，不额外收取歌词、暂停或音量功能费用。无广告是本项目首发选择，不虚构“去广告”增值权益。

### 2.6 定价、老会员与结算边界

首发沿用现有 VIP 价格、购买方式、周期和生效规则。音乐额外费用为零；现有月卡、年卡或其他已合法取得的全站 VIP，只要仍有效且满足原系统账号规则，都按同一音乐权限映射处理。已有明确终身全站权益时不得将其误判为过期，也不能因空到期时间自动制造终身权益。

新用户从音乐页面点击“开通 Station Cat VIP”，进入现有本地化会员中心。会员中心承担价格显示、充值或兑换、登录和支付；音乐页不新建收款接口，不直接扣积分。金额与最小实际付款门槛来自现有服务端配置，不能把积分折算月费写成用户当次一定只支付的金额。配置暂时不可读时显示“前往会员中心查看”，不回退至猜测价格。

老会员不补差价、不缩短有效期、不重新收费。原站独立出售的软件、游戏商品及单章内容保持原规则，不能将“音乐加入 VIP”扩写成未经确认的全站一切商品免费。

首发不新增自动续费，不自动用余额续会员，不将一次性支付转换成周期扣款。现网若已存在可靠的自动续费流程则保持其原行为，音乐只读其有效资格；付款待处理或前端成功返回均不能自行延长 VIP。

后续独立评估自动续费时，需重新设计明确同意、周期与费用披露、取消入口、失败重试、服务期截止和退款处理。Creem 支持周期订阅，平台能力不代表本站已集成。[S15][S16]

### 2.7 内容组合与运营默认值

可按“30 首精选，约 10 首免费、20 首 VIP”规划初始曲库；这属于运营目标，不要求虚构歌曲或凑数上线。前台只展示真实已发布作品，不把全部优质作品都隐藏在试听后。

每月筛选发布 4 至 8 首、更新一个主题歌单作为内部工作目标，不在付款页面自动生成保证数量的承诺。优先尝试阅读专注、猫咪日常及小说/游戏主题配乐。观察两到三个实际会员周期后再评估定价，付费转化未验证前不宣称商业模式已经成功。

新歌抢先体验默认 7×24 小时，后台发布前可选其他正整数天数并明确显示。抢先结束后必须预设进入 `free` 或 `vip`，显示确切日期；不能用无限延后的日期永久冒充抢先。已发布作品的访问规则变更属于版本化发布并记审计。原则上不将曾公开承诺免费的作品突然转为 VIP；确需调整先核对已披露规则并单独确认。

### 2.8 转化交互与宣传约束

试听完成只在当前播放器显示一次非模态提示：“这首作品收录于 VIP 曲库。开通 Station Cat VIP 后可完整收听，现有 VIP 无须额外付费。”提供“已有会员，登录”和“查看会员权益”；已登录普通账号不重复显示登录按钮。

不强制跳转、不重复弹窗、不伪造倒计时、不自动发起付款。登录态未知、资格同步中或服务暂不可用时不能误导用户再次购买。会员中心必须展示音乐权益范围、试听规则、个人站内收听用途、退款及联系入口；尚未实现的全站连续播放、下载、离线和定制歌曲不能写成已含权益。

会员中心返回音乐页后重新核对服务器资格，恢复当前歌曲选择并保持暂停。用户再次点击才播放完整版本；默认从完整歌曲开头开始，不把试听文件的本地进度错误当成原曲进度。

## 3. Suno 作品使用与发布检查

### 3.1 截至文档日期核对到的规则

Suno 当前条款标注于 2026-08-10 修订、2026-09-03 生效。条款将商业使用与合规官方下载关联；免费或 Basic 输出及条款所指的 Remix 另有限制，并限制通过非官方渠道取得音频及掩盖来源标记。[S1]

2026-09-03 更新的付费订阅帮助页表示，订阅期间下载的歌曲获得商业使用权，同时提示商业使用授权不保证版权保护。[S2]

仍在线的 2025-12-17 帮助页写明，后续订阅默认不追溯授予免费期作品商业权利。它与新页面的概括措辞存在需要逐曲确认的边界；免费期生成、后续付费下载的旧作品不能仅凭“现在是会员”自动放行。[S3]

本文提供工程风险控制，不替代具体作品及经营地区的法律意见。网站免费收听也不足以单独证明全部使用均属于非商业用途。

### 3.2 本项目的来源材料策略（2026-09-13 更新）

用户已明确来源材料在整个音乐后台改为可选，详见 [OPTIONAL_SOURCE_MATERIALS](OPTIONAL_SOURCE_MATERIALS.md)。未提供材料或 pending 均不阻止上传、技术核对和显式发布，不自动写成 approved。明确 blocked 仍阻止技术核对/发布；管理员主动填写 approved 时沿用完整依据及凭证校验。已有记录和私有凭证保留，缺材料不等于已确认授权。

实际试听、资源字节与独立试听核验继续必需。可选材料一旦保存或变更，仍参与版本指纹及并发校验。存在投诉或明显冒充、侵权疑点时，仍先下架、记录原因再核对；既有文件和凭证保留，不自动生成授权结论。

### 3.3 后台权利记录

建议使用独立私有数据对象 `MusicRightsReview`：

```ts
type MusicRightsReview = {
  id: string;
  revisionId: string;
  sourcePlatform: 'suno';
  sourceSongUrl: string | null;
  sourceSongId: string | null;
  generatedAt: string | null;
  downloadedAt: string | null;
  planAtGeneration: 'free' | 'pro' | 'premier' | 'other' | 'unknown';
  planAtDownload: 'free' | 'pro' | 'premier' | 'other' | 'unknown';
  downloadMethod: 'official' | 'unknown';
  outputKind: 'standard' | 'remix' | 'other' | 'unknown';
  permittedUse: 'commercial' | 'personal_only' | 'unclear';
  authorizationBasis: string;
  termsCheckedAt: string;
  evidenceAssetIds: string[];
  lyricsRightsNotes: string;
  coverRightsNotes: string;
  audioInputRightsNotes: string;
  reviewStatus: 'pending' | 'approved' | 'blocked';
  reviewerId: string | null;
  reviewedAt: string | null;
};
```

资料和审批属于后台数据。前台只返回简短创作来源、公开署名和使用说明，禁止返回订阅账单、授权邮件、管理员信息和证据文件地址。

仅对主动提交的 approved 记录要求 `permittedUse=commercial`、`downloadMethod=official`、完整依据与凭证；套餐名称本身不能生成 approved。免费期、Remix 或其他例外批准仍需明确许可依据与指定凭证。未提供/pending 不受该必填门槛约束，blocked 不能由普通备注覆盖。

审批绑定具体版本。更换音频、歌词或影响权利判断的内容后，旧审批失效，新版本重新核对。试听片段必须关联同一完整音频并通过来源区间和人工试听核对；材料可选不取消技术核验。

本站出售会员访问服务，不向听众承诺作品的独占版权。商业化上线前确认商品描述与支付服务支持范围：Creem 将音频列为支持的数字商品示例，但仍要求适当许可和清晰的服务、退款及联系方式。[S16] 核对涉及的实际销售地区与现行站点条款；不能用本开发文档代替法律审查，也不能新增一律不退款条款。

### 3.4 下载与署名

首版对免费用户和 VIP 均不提供音频下载按钮、下载授权 API 或离线缓存。合法收听时仍会向浏览器传输音频，技术上无法保证文件永不被保存；本项目不宣称 DRM。

页面建议写明：

> 本站提供个人在线欣赏。VIP 在有效期内可完整收听会员曲库；收听权益不包含下载授权、视频或广告配乐商用、转售及再分发。其他使用请联系站长确认。

不要自动标注“无版权音乐”“可任意商用”或“百分之百独占版权”。音频处理不得以隐藏 Suno 来源、套餐或下载状态为目的移除相关标记。[S1]

## 4. 页面结构与视觉规范

### 4.1 页面信息架构

| 区域 | 内容 | 交互 |
| :--- | :--- | :--- |
| 原站页头 | 现有导航加“音乐” | 沿用原菜单和语言切换 |
| 栏目介绍 | 标题、创作来源、VIP 已包含音乐说明 | 主按钮“播放免费精选”，次入口查看会员权益 |
| 推荐作品 | 一张主封面、作品简介 | 点击播放或打开详情 |
| 检索区 | 搜索框、风格、心情、语言、有词/纯音乐 | 更新列表，不停止当前播放 |
| 主题歌单 | 管理员发布的精选歌单 | 查看或整单播放 |
| 曲目列表 | 封面、歌名、创作者、时长、收藏、免费/VIP/抢先标签 | VIP 标记与实际有效状态一致，按钮为播放或试听 |
| 会员状态 | 有效资格、到期时间或待核对状态 | 已有 VIP 显示“音乐权益已包含”，不重复销售 |
| 详情面板 | 封面、歌词、故事、署名 | 桌面侧栏，手机抽屉 |
| 固定播放器 | 当前曲、主控制、进度、队列入口 | 全音乐页保持一个实例 |
| 原站页脚 | 现有链接及音乐使用说明 | 不另造完整站点页脚 |

主推区域优先有一首可完整播放的免费作品。全 VIP 歌单可展示，但给普通用户清晰的试听/会员说明，不能将“播放全部”伪装成全部免费。

推荐最多 1 首主推作品、6 首次级推荐、6 个首页歌单入口。歌单数量不足时按实际数量显示，不制造占位作品。

### 4.2 桌面与手机布局

桌面内容宽度沿用主站 `--max: 1120px`。上方为推荐区，下方以曲库为主。歌词或歌曲详情作为右侧面板或弹层，不同时堆叠多个大封面。

手机采用单列：推荐作品、筛选、歌单、歌曲列表。底部迷你播放器展示封面、歌曲名、播放/暂停和下一首；点击歌曲信息展开详情，再展示进度条、上一首、循环与队列。

页面内容底部预留播放器高度及 `env(safe-area-inset-bottom)`，保证列表最后一行和页脚可以被看见。横屏、小屏和系统大字体下不得出现遮挡。

### 4.3 色彩、排版与动效

沿用现有全局变量，不向根元素注入新的主题覆盖。[R4]

```css
.station-music-page {
  --music-bg: var(--bg);
  --music-surface: var(--surface);
  --music-surface-soft: var(--surface-soft);
  --music-text: var(--ink);
  --music-muted: var(--muted);
  --music-border: var(--line);
  --music-accent: var(--teal);
  --music-highlight: var(--coral);
}
```

建议封面采用方形，卡片圆角 16px，主按钮高度至少 44px。歌名保持清晰，长歌名允许换行或截断，完整标题可在详情查看。

首版使用轻微按钮反馈和实际播放状态指示，不做持续旋转的大唱片、自动背景视频或全屏粒子效果。不使用假声波冒充真实音频分析。后续需要真实频谱时才引入 Web Audio，并重新验证跨域、耗电和移动端兼容性。

所有新增样式使用 `.station-music-*` 或组件作用域，禁止全局修改 `button`、`audio`、`body`、`main` 影响小说和游戏。

### 4.4 歌单方向

以下只作为内容编排建议，管理员可以修改名称和数量：清晨咖啡、深夜小站、猫咪午后、小说配乐、专注时刻。仅在实际有对应作品时展示，不将建议名称当成现有曲库事实。

## 5. 路由、语言与分享

### 5.1 首版路由

```text
/music/                                默认语言音乐首页
/en/music/                             英文音乐首页
/ja/music/                             日文音乐首页
/zh-hans/music/                        简体中文音乐首页
/zh-hant/music/                        按现站规则处理的繁体别名或本地化路径
/music/?track={trackId}                 打开指定歌曲，默认暂停
/music/?collection={collectionSlug}     打开指定歌单
/admin-v2/music/                       音乐后台
/admin/api/music/*                     受保护的音乐后台接口
/api/music/*                           音乐接口；公开目录与受保护完整音频分别处理
```

语言别名、尾斜杠和 canonical 最终必须按仓库现有路由规则统一，不能同时为相同语言内容制造两套自指 canonical。公共音乐页要和现有语言菜单对应，不能跳到不存在的路径。

### 5.2 音乐页内部导航

曲库、歌单、本地收藏和详情属于同一页面应用状态。点击内部条目时使用状态更新与 `history.pushState/replaceState`，不做整页跳转；实现 `popstate` 还原浏览状态。

音频切换与详情切换分离。查看 B 歌曲详情时，A 歌曲可继续播放，底部始终显示真正正在播放的 A。用户点击 B 的播放按钮后才换歌。

筛选、打开详情、关闭抽屉和后退都不得重新创建音频元素。切换站点语言的首版行为按整页导航处理，暂停并保存位置，不承诺无缝继续。

### 5.3 分享规则

复制歌曲链接使用本站的 `trackId`，不得复制 R2 key、Cookie、带个人资格的令牌或临时 Suno 播放地址。VIP 歌曲允许分享详情，接收者按自己的资格试听或完整播放。首版链接打开后定位该歌并展示明确播放按钮，不自动发声。

支持系统分享时使用 Web Share；取消分享不报错。不支持时降级为复制链接，复制失败时显示可选中的链接文本。

首版所有歌曲链接使用音乐栏目级社交预览卡片。不能只在浏览器中修改 OG 标签就宣称每首歌已有独立分享预览。专属单曲卡片和搜索索引放在 P1，由服务端返回对应元数据。

P1 路由建议为 `/music/tracks/{slug}/`，采用与既有 Worker 动态内容机制兼容的服务端输出，返回实际歌曲的 title、description、OG、canonical 和结构化数据。读取不到已发布作品时返回真实 404/410，不返回看似正常的空白 200 页面。

## 6. 播放器与队列规则

### 6.1 单一音频内核

首版只使用一个 `HTMLAudioElement`。曲目卡片、底部播放器和详情页都是同一状态的视图。

默认 `preload="none"`、关闭 autoplay。列表加载不请求全部音频。封面和时长由公开目录提供；选中但未播放的歌曲无需自动读取媒体内容。

页面初始化并行读取公开目录和本用户 capabilities。点击播放时，根据已取得的状态同步设置 `variant=full` 或 `variant=preview` 的同源音频地址并调用 `play()`，不先等待统计、歌词或签名链接。免费曲直接 full；受保护曲已确认 VIP 才默认 full，资格未知时按钮明确为“试听”，不展示虚假开通结论。

完整播放最终以媒体接口的服务端资格检查为准，capabilities 仅用于界面。先试听后确认 VIP 时不突然切源，用户主动点“播放完整版”后再从完整文件开头播放。调用 `play()` 的 Promise 错误须捕获，实际状态由媒体事件更新。[S4][S5]

### 6.2 状态机

```ts
type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'access_required'
  | 'access_unavailable'
  | 'error';

type RepeatMode = 'off' | 'all' | 'one';

type PlayerState = {
  status: PlayerStatus;
  activeTrackId: string | null;
  activeAudioVersion: number | null;
  activeVariant: 'full' | 'preview' | null;
  activePolicyVersion: number | null;
  accessExpiresAt: string | null; // 仅为 UI 到期提示，服务端重新核验
  fullDurationSec: number | null;
  previewSourceStartSec: number | null;
  queue: string[];
  queueIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  currentTimeSec: number;
  durationSec: number | null;
  volume: number;
  muted: boolean;
  lastError: { code: string; message: string } | null;
  sourceGeneration: number;
};
```

主要事件映射：开始载入为 `loading`，实际 `playing` 事件进入播放，等待数据且有播放意图时进入 `buffering`，用户暂停后保持 `paused`，最终结束后由队列规则决定下一首或 `ended`。

快速连续点击 A、B、C 时使用递增 `sourceGeneration` 或等效取消机制，旧请求及旧 `play()` Promise 不能将 UI 改回 A。切源产生的预期 `AbortError` 不显示成播放故障。事件监听和初始化必须幂等。

### 6.3 控制行为

| 操作 | 明确规则 |
| :--- | :--- |
| 首次播放 | 必须由访客主动点击 |
| 点击当前播放曲的播放按钮 | 切换播放/暂停，不重置进度 |
| 点击另一首的播放按钮 | 换歌并从头播放 |
| 上一首 | 当前进度超过 3 秒时先回到开头；否则回到上一首 |
| 下一首 | 按实际队列推进，手动下一首不受单曲循环约束 |
| 拖动进度 | 拖动时显示预览，提交后设置 currentTime，并限制在有效范围 |
| 音量 | 桌面端支持调节；移动浏览器不能软件调节时提示使用设备音量 |
| 列表末尾 | full 模式按 repeat 处理；preview 自然结束后停止，不自动循环试听或连续展示收费提示 |
| 单曲循环 | 仅自然结束重复当前歌曲，用户手动切歌仍生效 |
| 刷新或重进 | 恢复选择，重新获取资格，保持暂停；只恢复与当前版本及 variant 相匹配的位置 |
| 列表为空 | 不显示假播放状态，给出选择歌曲提示 |

试听进度条只表示短文件自身的播放范围，旁边单独显示完整歌曲时长，不能把 45 秒片段伪装成可拖动四分钟的完整音频。LRC 同步时用试听起点加本地媒体进度定位原曲歌词，完整歌词仍开放。

时长以当前媒体的有效 `duration` 为运行时依据。`NaN`、`Infinity` 或未知时长显示占位，不输出异常数字；保存的进度超出新音频长度时进行裁剪。

### 6.4 队列与随机播放

点击列表中的播放按钮时，以当时筛选结果及排序创建队列快照，同时保存曲目访问类型。之后修改搜索条件只改变浏览列表，不悄悄替换待播内容。“播放全部”属于显式替换队列动作。

免费用户的“播放全部”、下一首和自动续播只选择当时可完整收听的 free 曲；跳过 VIP 属于权限过滤，不计入三次网络故障重试。全 VIP 列表没有可完整曲目时停止并解释，不无限遍历。

用户明确点击某首 VIP 歌曲可以单独试听，试听结束停止。此时 repeat=one/all 不触发无限短片段循环，也不会自动进入下一段 VIP 试听；手动下一首按可完整收听队列推进。有效 VIP 可连续完整播放所有已发布作品，资源下架或资格变化时重新过滤。

首版队列最多 500 首，同一首歌不重复插入；上限达到时给出提示。移除待播歌曲不影响当前声音，移除当前歌曲时按用户确认的明确动作切至下一首或停止。

随机播放采用已洗牌的待播集合和历史栈。一个随机轮次中不重复歌曲；存在多首时不得连续抽中同一首。上一首优先返回实际历史。关闭随机后保留当前歌，并回到原始队列相应位置。

连续故障自动跳过的次数上限为 3。达到上限停止并提示重试，禁止在全曲库失效时无限请求。只有用户重新发起播放，或成功播放持续 10 秒后，才重置连续故障计数。

### 6.5 移动端和系统媒体控制

对 `navigator.mediaSession` 做能力检测；支持时更新标题、创作者、封面和播放状态，并注册播放、暂停、前后曲及可用的 seek 操作。逐项注册并捕获不支持的动作。[S6]

锁屏播放、蓝牙按键、切后台后的保活均作为尽力支持项，必须在真实设备上记录结果。不得承诺页面关闭、系统强制回收或任意后台状态下持续播放。

首版不启用 Wake Lock，不为音乐持续点亮屏幕。切后台时停止无意义的动画和高频 UI 更新，但不能因为页面隐藏就主动暂停正常收听。

### 6.6 多标签页

支持 BroadcastChannel 时，让最后一次明确点击播放的标签页取得本站音乐播放优先权，其他本站音乐页暂停。消息携带实例 ID，避免互相重复暂停。缺少相关能力时保留基本播放，并将多标签协调列为降级项。

提供“在独立标签页收听”的普通用户触发链接，方便访客继续浏览主站；该入口不承诺突破浏览器后台限制。

### 6.7 到期、登出、账号切换和升级

本用户 capabilities 包含 `serverNow`、`validUntil` 和有限的资格说明；客户端用它安排一次性到期复核，并在页面回到前台、账号登录/登出、收到本站账号变更消息时重新读取。浏览器时间不能决定服务端资格。

收到确定的到期或撤销结果时，若当前 full 曲仍受 VIP 限制，暂停、保存 full 位置并清空该音频源，提示恢复试听或进入会员中心。若作品已结束抢先期并变为 free，重新读取确认后可按免费规则继续；不把所有 VIP 标签永远写死。

收到本人明确登出或切换账号时，立即暂停并卸载受保护完整源，清空内存中的旧资格，不把 A 账号授权继承给 B。免费曲无需因此强制停止。本地收藏保留，内存权限、付款提示与用户标识不得写入公开目录或本地播放快照。

播放响应已经传出的字节无法追回，系统后台计时器也可能暂停。验收口径为“服务端在后续新请求中按当前资格拒绝、前端在感知变化后处理”，不能承诺到期瞬间清除所有设备缓存。

媒体元素通常不能直接向页面暴露 HTTP 401/403 等业务详情。播放失败后只允许发起一次轻量 access 查询确定原因：未登录提示登录，已确认非 VIP 提示会员权益，503 提示资格服务暂不可用，版本冲突或下架按内容错误处理。不得把所有解码/网络错误展示成要求付款，也不得预先 fetch 完整歌曲来探测资格。

## 7. 歌词、搜索与本地记录

### 7.1 歌词

首版支持纯文本与 LRC。歌词由站长填写或上传，网站不自动推断“歌词一定是原创”，也不自动识别时间点。

LRC 至少支持 `[mm:ss]`、`[mm:ss.xx]`、`[mm:ss.xxx]`、同一句多个时间标签及毫秒 `offset`。解析后转成按时间排序的 `{ startMs, text }[]`；相同时间点合并展示，非法行跳过并在后台列出警告。

文件限制为 128 KiB，最多 5,000 行；拒绝含 NUL 的输入。只按文本渲染，不允许歌词中的 HTML、脚本或链接自动执行。

同步歌词使用媒体真实进度查找当前行，不另开独立累加时钟。缺少有效时间标签时降级为普通歌词。用户手动滚动后暂停自动跟随，点击“回到当前歌词”恢复；屏幕阅读器不逐秒播报每句歌词。

纯音乐显示“这首作品为纯音乐”，无歌词的有声歌曲显示“暂未提供歌词”，不得混用两种状态。

### 7.2 搜索和筛选

首版在不超过 500 首的公开元数据中客户端检索。搜索字段包括歌名、创作者、管理员补充的搜索别名和标签，不扫描未公开歌词和私有创作提示词。

输入进行 Unicode NFKC 规范化、去除两端空格及大小写统一。简繁检索通过可编辑别名补足，不承诺自动准确转换全部作品名。

多个筛选组之间使用 AND，同一风格或心情组内部多选使用 OR。默认按实际发布时间倒序，顺序相同时按 ID 稳定排序。首版不提供没有数据依据的“热门”排名。

### 7.3 本地持久化

使用独立键名 `stationcat.music.v2`，包括 schemaVersion、收藏 ID、最近播放 ID、队列快照、播放设置、音频版本、variant 与保存位置。首次读取旧 `stationcat.music.v1` 时只迁移通过校验的收藏/队列/设置；旧进度缺少 variant 的条目保持暂停并要求重新选择，不默认为 VIP full。

每条进度至少绑定 trackId、revisionNo、variant、assetVersion，试听和完整播放分开保存。不得持久化 `isVip=true`、会员 Cookie、付款令牌或将缓存的到期时间用作授权。旧本地数据迁移失败时保留可导出的原文本并降级，不静默清空收藏。

收藏最多 500 首，最近播放最多 50 首。播放位置每 5 秒节流保存，并在暂停和 `pagehide` 时尽力保存。位置保存超过 30 天可以忽略，收藏持续保留至用户清除。

捕获 localStorage 不可用、空间不足和 JSON 损坏，降级到内存。读取时验证结构，不把本地字符串当作可信 HTML。歌曲下架后保留可清理的失效提示，播放时重新校验。

用户可执行“清除本机音乐记录”。不要声称这些记录会跨设备同步，也不要将它们并入网站已有小说或游戏存档。

## 8. 技术架构与现站集成

### 8.1 推荐架构

```text
访客浏览器
  Astro 音乐页面壳
  TypeScript 播放状态与原生 audio
  当前浏览器的本地收藏与播放记录
        |
        v
现有 Cloudflare Worker 的音乐路由模块
  /api/music/*            公开目录/试听 + 按资格保护的完整音频
  /admin/api/music/*      管理与上传，受既有后台鉴权保护
        |
        +---- 现有账号与 VIP 权益服务/原数据库
        |        只读资格适配，不复制会员账本、不新增音乐收款
        |
        +---- MUSIC_DB       独立 D1，音乐内容、管理和必要统计
        |
        +---- MUSIC_BUCKET   私有 R2 Standard，完整音频/试听/封面/歌词/证据
```

首版不新增 React、Next.js、独立 Node 服务、Redis、HLS、消息队列或在线转码平台。后续确有规模瓶颈时再引入相应组件。

这是一项站内功能扩展，保留现有构建链、依赖锁文件、Cloudflare Worker 入口和原业务路由。原项目没有的模块路径、数据库表、绑定和接口在本文中均为拟新增内容。

### 8.2 资源隔离

新增资源绑定建议如下，实际名称和 ID 由实施时创建结果决定：

```toml
# 拟新增配置示意，不能带占位 ID 部署到生产。
[[d1_databases]]
binding = "MUSIC_DB"
database_name = "station-cat-music"
database_id = "REPLACE_WITH_ACTUAL_ID"
migrations_dir = "migrations/music"

[[r2_buckets]]
binding = "MUSIC_BUCKET"
bucket_name = "station-cat-music"
```

音乐数据库独立创建，避免音乐迁移或统计写入直接修改小说、支付与游戏表；共享 Worker 与账户配额仍需监控。既有账号和会员数据留在原数据源，通过只读适配查询，不能假定两个 D1 数据库可跨库 join 或跨库原子提交。音乐桶保持私有，关闭公开 `r2.dev` 访问，不绑定绕过 Worker 的公开资源域名。

已有 `CONTENT_BUCKET` 和 `DOWNLOADS_BUCKET` 不改变权限。音乐音频不存入 Git、不随 `dist` 构建发布；测试文件单独管理并明确许可证。

开发和预发布使用独立绑定，不连接生产音乐库。任何创建付费资源和修改生产绑定的动作必须由站点所有者授权。

### 8.3 拟新增模块

```text
src/
  components/music/
    MusicHero.astro
    MusicLibrary.astro
    MusicTrackRow.astro
    MusicCollectionCards.astro
    MusicPlayer.astro
    MusicDetailPanel.astro
    MusicVipBanner.astro
    MusicAccessNotice.astro
  pages/
    music/index.astro
    admin-v2/music/index.astro
    ...按现站规则加入本地化音乐页面
  scripts/music/
    bootstrap.ts
    player-engine.ts
    player-store.ts
    queue.ts
    music-api.ts
    library-state.ts
    lyrics.ts
    persistence.ts
    media-session.ts
    tab-coordination.ts
    access-store.ts
    analytics.ts
  music/
    routes.js
    repository.js
    schemas.js
    publication.js
    upload-service.js
    media-response.js
    rights-review.js
    access-policy.js
    membership-adapter.js
    preview-validation.js
    analytics-service.js
    cleanup.js
  styles/music.css

migrations/music/
  0001_music_core.sql
  0002_music_vip_access.sql
  0003_music_analytics.sql

docs/music/
  DEVELOPMENT_SPEC.md
  PROJECT_CONTEXT.md
  CURRENT_PHASE.md
  TASKS.md
  DECISIONS.md
  TEST_MATRIX.md
  HANDOFF.md
  OPERATIONS.md
  MEMBERSHIP_INTEGRATION.md
  COMMERCIAL_RULES.md

tests/music/
  ...单元测试、集成测试及浏览器测试
```

前端采用 TypeScript；后端可保持仓库现有 JavaScript 风格并补充 JSDoc 和运行时校验。最终测试目录和 runner 应贴合现仓库习惯，不同时建立多套重复测试框架。

迁移文件名为规划示例。已经执行的 0001 保持内容不变，新增 VIP 字段和统计表分别通过后续迁移添加；第 9 节描述所有迁移完成后的最终模型。新环境按顺序执行完整迁移链，旧环境只执行未应用的部分。当前分支已占用的编号顺延，不在多个迁移中重复创建同一字段，也不改写已执行迁移的校验值。

### 8.4 Worker 集成原则

在 `src/worker.js` 中增加一个薄路由入口，将音乐请求交给独立模块。保留现有错误处理、日志关联 ID 和管理鉴权流程。

`/admin/api/music/*` 必须在经过既有后台权限校验之后分发。不能因为路由前缀较长、看起来不公开，便直接进入处理函数。

`/api/*` 和 `/admin*` 已出现在当前静态资源的 Worker 优先规则中。[R2] 音乐首页的无尾斜杠跳转和本地化路径仍须按现站逻辑补齐；不使用全站 SPA fallback 掩盖失效路由。

缺少 `MUSIC_DB` 或 `MUSIC_BUCKET` 时，音乐接口返回可识别的 503，其他栏目继续正常工作。关闭音乐功能开关时，不得让整站启动失败。现有会员服务不可用时，VIP 完整音频返回 503；免费曲和独立试听不依赖会员查询成功。

### 8.5 复用现有 VIP 的只读适配合同

下列类型和函数为拟新增内部合同，名称不代表仓库已经存在。M0 必须在 `MEMBERSHIP_INTEGRATION.md` 记录它们映射到的真实函数、表、字段、路由和证据位置。

```ts
type SiteVipSnapshot = {
  subjectId: string | null; // 内部使用，不进入公共 catalog
  authenticated: boolean;
  accountUsable: boolean;
  activeSiteVip: boolean;
  validFrom: string | null;
  validUntil: string | null;
  explicitlyLifetime: boolean;
  checkedAt: string;
  sourceGrantId: string | null; // 仅内部审计或核对
  state: 'active' | 'none' | 'expired' | 'revoked' | 'unavailable';
};

// 输入来自已验证的现有会话；禁止接受客户端传入 accountId 作为身份。
declare function resolveExistingSiteVip(
  request: Request,
  existingServices: unknown // 规格占位；M0 替换为实际已有服务的类型。
): Promise<SiteVipSnapshot>;
```

实现要求：先复用现有服务端登录验证和全站权益判定；必要时只导出或提取小范围只读 helper，并增加回归测试。禁止在音乐模块中重建密码认证、直接根据邮箱白名单授予 VIP 或复制积分支付代码。后台 Cloudflare Access 管理身份与听众 VIP 分属两个权限域；管理员在公开页面试听 VIP 完整曲也走普通用户资格，草稿预览使用受保护后台入口。

全站 VIP 与作品级 `member/supporter/paid` 权限必须区分。积分余额大于零、买过章节、拥有游戏商品、普通注册或仅拥有某本小说的权限均不自动授予全站 VIP。计划标识和 grant scope 采用当前系统可证实的映射清单，不随意把任意 `access_level=all` 扩大到音乐。

日期按原会员系统计算并以服务端 UTC 比较。有限期资格要求当前时间处于 `[validFrom, validUntil)`，同时账号和 grant 未失效。提前续购的未来段不能提前开启；多份合法 grant 按原规则取有效并集，不因撤销一份就误删其他独立购买期。空结束日期只有在来源明确记录终身资格时才按无期限处理。音乐不重新把“一个月”换算为 30 天。

已安排周期末取消的会员，在原系统确认已付款有效期内继续有资格；退款、拒付、撤销或账号限制影响资格的方式必须沿用并核验原系统规则。付款失败不产生新周期，不能只看支付平台 `active` 字符串而忽略本地已确认服务期限。[S15][S18]

**退款接入的必须核对项：** 当前充值文档记录退款可冲回积分并产生负余额，没有在该文档中证明已兑换的全站 VIP 会同步撤销。[R7] 不得把负积分直接当作全站封禁，也不能宣称退款闭环已完成。M0 要跟踪实际退款到 grant 的关系；如未定义，列为商业化上线阻断项，提出原会员服务的最小修正及授权范围，继续使用测试 fixtures 开发。音乐无权自行决定其他商品退款政策。

生产资料未可读时，输出“待生产核对”，禁止篡改真实会员字段来试验。共享服务缺少可信映射时 `state=unavailable`，VIP 完整访问关闭，免费和试听仍开放。

### 8.6 付款后恢复与授权新鲜度

会员 CTA 只构建同站白名单内的真实会员中心路径，并携带经校验的相对 `returnPath`、trackId 和来源标识。M0 复用原重定向清理器并额外拒绝外域、协议相对地址和异常编码；不能从 query string 读取待扣金额、用户 ID 或资格。

从会员中心返回、页面重新可见或用户点击“刷新权益”时读取 capabilities。`payment=success`、订单号、客户端账单截图或浏览器缓存不能授予访问。若原系统仍在处理，显示“会员权益正在同步”，可按 2/4/8/10 秒递增间隔轮询，单次回访最多 60 秒；超时停止并保留返回会员中心入口，不重新发起购买。

每次受保护完整音频请求读取当前权威资格，首发不使用跨请求的 VIP 布尔缓存。若原系统启用 D1 读副本，资格查询必须使用具备当前状态保证的既有路径或显式主库读取；客户端/UI 缓存不能替代。两库读取不能组成全局事务，收听授权只保证检查时刻的状态，播放响应中途撤销的边界见第 12 节。[S9]

## 9. 数据模型与版本控制

### 9.1 数据组织原则

歌曲身份、可编辑版本、已发布版本、文件及权利记录分离。已发布版本保持不可变，管理员编辑时创建新草稿，不能边填写表单边改变访客正在收听的版本。

主标识使用服务器生成的随机 UUID。`slug` 用于可读链接及未来 SEO，首次发布后默认保持稳定；需要改名时仅修改标题，避免随意改变分享地址。

所有时间使用 UTC 的 ISO 8601 字符串或统一毫秒时间戳，数据库中只选用一种方案。界面显示再按用户语言和站点时区格式化。

### 9.2 首版数据表

| 表 | 主要字段 | 关键约束 |
| :--- | :--- | :--- |
| `music_tracks` | id、slug、lifecycle、draft_revision_id、published_revision_id、edit_version、first_published_at、published_at、created_at、updated_at | slug 唯一；生命周期合法；发布指针必须属于同一歌曲 |
| `music_track_revisions` | id、track_id、revision_no、state、metadata_json、audio_asset_id、preview_asset_id、cover_asset_id、lyrics_asset_id、access_mode、early_access_until、post_early_access_mode、policy_version、technical_reviewed_at、created_at | `(track_id, revision_no)` 唯一；已发布版本不可修改 |
| `music_assets` | id、owner_track_id、kind、object_key、state、content_type、byte_size、duration_ms、derived_from_asset_id、source_start_ms、source_end_ms、sha256、etag、created_at | object_key 唯一；kind 与资源用途相符 |
| `music_rights_reviews` | id、revision_id、review_json、review_status、reviewer_id、reviewed_at | revision_id 唯一；证据仅管理端读取 |
| `music_collections` | id、slug、title_json、description_json、status、version、created_at、updated_at | slug 唯一；版本用于并发编辑 |
| `music_collection_tracks` | collection_id、track_id、position | 同一歌单不可重复同一曲目；排序稳定 |
| `music_upload_sessions` | id、asset_id、actor_id、status、declared_bytes、actual_bytes、expires_at、created_at | 一次上传会话不能覆盖已完成资源 |
| `music_admin_audit_logs` | id、actor_id、action、target_id、summary_json、request_id、created_at | 追加写入；不记录令牌和证据全文 |
| `music_mutations` | actor_id、route、idempotency_key、request_hash、result_json、expires_at | 三字段组合唯一，防重复发布 |
| `music_settings` | key、value_json、updated_at | 保存 catalogVersion、资源预算与功能开关 |
| `music_analytics_events` | event_id、event_type、play_session_id、anonymous_session_id、track_id、revision_no、variant、occurred_at、received_at、attributes_json | event_id 唯一；字段白名单；不存 Cookie/支付原文 |
| `music_analytics_daily` | date_utc、metric、track_id、variant、value | 联合唯一；聚合可重建；无数据不同于数值 0 |
| `music_membership_attributions` | verified_grant_ref、anonymous_session_id、entry_track_id、observed_at、qualification、reversed_at | 仅可验证新资格使用；引用去重；不能作为会员授权表 |

关键索引至少覆盖：曲目 lifecycle、发布时间排序、revision.track_id、资源归属、上传过期时间、审计时间、歌单关联。所有业务查询使用参数绑定，排序字段使用服务端白名单。

歌曲修订中的素材引用必须经过归属、状态和 kind 检查；不能用另一个歌曲的私有证据 assetId 作为音频或封面引用。

### 9.3 生命周期

```text
歌曲：draft → published → unpublished → archived
                       ↘ 新草稿 → 再发布
文件：reserved → uploading → uploaded → validated
                           ↘ rejected
权利核对：pending → approved / blocked
```

编辑已发布作品时保留原发布指针，新草稿独立编辑和预览。发布操作将已校验、已审批的新版本锁定，并原子切换发布指针。

下架操作清空公开可用状态，保留音频、修订和审批用于恢复或调查。重新发布必须再次确认资源存在、审批适用，不能仅修改一个前端布尔值。

归档前先下架。首版不提供一键不可恢复删除歌曲，文件清理仅处理未引用、已过保留期的对象。

### 9.4 公共字段与私有字段

公开目录只允许返回：ID、slug、标题、公开创作者名、简短介绍、标签、语言、纯音乐标识、完整时长、封面 URL、音频版本、歌词类型、公开发布时间，以及 accessMode、effectiveAccess、policyVersion、试听可用性与时长、试听原曲起点、抢先结束时间和结束去向。禁止把本用户的 canPlayFull、到期日或身份嵌入可共享缓存的目录。

完整版故事和歌词单独请求，降低目录体积。Suno 来源链接可以由站长选择公开。

`first_published_at` 只在首次公开时设置，`published_at` 记录当前公开版本实际生效时间，不能由草稿创建时间代替。

私有内容包括生成提示词、生成和下载套餐、订阅凭证、审核备注、对象 key、管理身份、上传会话、未发布修订、任何访问凭据。API 必须显式组装公开对象，禁止直接 JSON 序列化数据库行。

### 9.5 并发与一致性

编辑响应返回 `editVersion`，写请求使用 `If-Match: "edit-{editVersion}"`，例如 `If-Match: "edit-7"`。该值与音频文件的 ETag 分开。发布请求同时指定待发布的 `revisionId`。版本过期返回 409，要求管理员重新读取后合并，禁止最后写入无提示覆盖前一次编辑。

发布和下架需要在同一数据库原子操作中完成：校验版本、更新状态/指针、递增 catalogVersion、写入审计与幂等结果。D1 `batch()` 可提供批次事务，但一个条件 UPDATE 影响 0 行不会自动成为 SQL 错误，不能误以为所有后续语句会自然回滚。[S9]

实现时必须采用受同一条件保护的写入、数据库约束或事务内 guard 设计，保证版本冲突时没有任何副作用。先单独读取版本再无条件批量写入的方案不通过验收。

公开音频入口读取当前发布状态，首版不启用可能导致下架判断滞后的读副本或陈旧状态缓存。

### 9.6 歌曲访问策略与抢先开放

```ts
type TrackAccessPolicy = {
  accessMode: 'free' | 'vip' | 'early_access';
  earlyAccessUntil: string | null;
  postEarlyAccessMode: 'free' | 'vip' | null;
  policyVersion: number;
};
```

该策略属于不可变发布修订。`free` 允许完整公开播放；`vip` 完整播放要求有效全站 VIP；`early_access` 在服务端当前时间 `< earlyAccessUntil` 时要求 VIP，达到该时间后立即按 `postEarlyAccessMode` 判断。边界采用 UTC，等于结束时间即进入后续状态，不依赖定时任务是否执行。

首次使用 early_access 时，结束时间必须晚于首次生效时间，默认加 7×24 小时，且必须填写后续类型。后续编辑已结束的作品可保留历史时间，系统按后续状态展示，不能因文案修改重新开始抢先期。管理员明确更改该策略须生成新修订，后台记录旧值、新值和原因。

发布、访问标签、抢先设置和政策变更递增 `policyVersion`、`catalogVersion`。无写入发生的自然到期也会改变 effectiveAccess，因此目录 ETag 必须基于实际公开投影，不能只依赖 catalogVersion；前端用 `nextPolicyChangeAt` 安排重拉，后台鉴权始终实时计算。

缺失或未知的 accessMode 不能回退成免费。全新草稿默认 `vip` 且须管理员明确确认后发布。已部署 v1.0 的已发布曲目迁移为 `free`，保留旧公开承诺，不批量加付费墙；原来的合法免费身份须记录为迁移依据。迁移追加执行，有检查点和备份，不重跑已有迁移。

### 9.7 试听数据一致性

资源 kind 增加 `preview`，与完整 `audio` 分离。preview 的 `derived_from_asset_id` 必须指向当前修订的完整音频，两个 ID 和 object key 不同；不能把完整资源引用伪装为 preview。

源音频变化时，旧试听自动失去发布资格。试听源范围、服务端测得时长、文件 hash 和管理员试听确认共同绑定版本，不能复用来自另一首歌的短文件。片段内容与原曲对应关系需管理员核对，长度校验不代表系统已验证全部音频语义一致。

权限数据继续使用原系统；`music_membership_attributions` 只存最小可验证引用供统计，绝不能根据此表判断用户是否为 VIP，也不在音乐数据库复制支付账本。

## 10. 文件与上传发布流程

### 10.1 首版文件规格

| 资源 | 支持类型 | 限制 | 处理方式 |
| :--- | :--- | :--- | :--- |
| 播放音频 | MP3，`audio/mpeg` | 单文件最多 32 MiB；建议每首 20 分钟以内 | 优先保留合规取得的 MP3，避免无必要重复转码 |
| 试听音频 | 独立 MP3，`audio/mpeg` | 单文件最多 4 MiB；时长上限按 10.6 | 独立文件，服务端确认长度和源绑定 |
| 封面 | JPEG、PNG、WebP | 最多 5 MiB，建议 1200×1200，尺寸上限 4096×4096 | 不接收 SVG、HTML 或动画文件 |
| 歌词 | UTF-8 TXT、LRC | 最多 128 KiB，最多 5,000 行 | 解析和文本化展示 |
| 私有证据 | JPEG、PNG、PDF | 单文件最多 10 MiB | 仅后台授权下载，不通过公开媒体接口提供 |

文件体积和类型是首版强制限制，20 分钟属于运营建议。客户端上报时长只作预检；受保护歌曲及试听的发布必须通过第 10.6 节的服务端实际时长检查。该检查未实现或失败时禁止发布 VIP/early_access，不以客户端 metadata 或人工勾选绕过长度门槛。音频不满足强制规格时显示原因，不自动调用云端模型或启动昂贵转码。

后台技术检查需要独立验证真实字节数、允许的 MIME 和文件结构头，不能只相信文件名。MP3 结构检查并不等同于完整音频解码，管理员仍需试听确认。客户端提供的 duration 和 MIME 只作为提示，运行时播放以媒体实际数据为准。

任何原文件和相关来源标记应妥善保留。后续确需转换格式时，另行记录处理过程及来源，不以处理音频为由剥离必须保留的来源信息。[S1]

### 10.2 对象 key

对象 key 由服务端生成，使用不可预测且不可覆盖的标识：

```text
music/audio/{trackId}/{assetId}.mp3
music/previews/{trackId}/{assetId}.mp3
music/covers/{trackId}/{assetId}.webp
music/lyrics/{trackId}/{assetId}.lrc
music/evidence/{trackId}/{assetId}.pdf
```

扩展名依实际验证后的类型确定。禁止使用原始文件名直接拼路径，禁止由访客传入任意 R2 key。替换文件时创建新 assetId，保留旧发布版本的引用。

所有路径都在私有桶内。只知道路径或 assetId 不足以访问草稿和证据。

### 10.3 管理员上传流程

1. 进入既有后台身份验证后的音乐工作区，创建草稿歌曲。
2. 选择本机合法取得的文件，前端预检类型、大小和可播放性。
3. 创建上传会话，服务器确认身份、归属、类型、体积和剩余项目配额，分配唯一对象 key。
4. 浏览器向同源受保护 PUT 接口传输原始字节，显示真实上传状态。
5. Worker 流式写入 R2，同时执行实际字节上限检查，不将整首歌曲读入内存。
6. 完成接口核对 R2 对象、会话字节数和结构检查结果；成功后资源进入 validated。
7. 管理员选择 free/vip/early_access，按需上传独立试听并填写起止位置；试听完整和短文件，填写曲目资料，来源材料与权利核对可选。
8. 执行发布。服务器复核草稿、资源、审批、访问策略、试听源绑定及时长，再原子切换发布版本。
9. 前台下一次目录请求即可读取发布结果，不要求重新构建整个网站。

浏览器上传进度无法可靠计算时显示明确的处理中状态，不伪造精确百分比。单批最多 10 首，首版按串行上传，失败可针对单项重新发起会话。

### 10.4 上传安全与失败恢复

上传请求体限制和内存限制应以部署时的 Cloudflare 官方文档与实际套餐核对，本站自己的限制必须更严格，不能只依赖平台拒绝超大请求。[S11]

`Content-Length` 可以缺失或不可信，服务器仍需统计真实输入长度；超限或与声明不符时中止，标记失败并清理不完整资源。

会话采用受条件保护的状态更新，防止两个请求同时向同一对象 key 上传。完成后的会话不接受覆盖；重试创建新会话，或在已完成情况下返回已存结果。

上传成功但浏览器没收到响应时，管理员可重新查询会话并完成确认。文件写入成功但发布失败时保持私有，不自动设为公开。

未完成上传会话默认 24 小时过期。清理任务只能删除确定没有任何修订引用的过期资源，执行删除前再次核对引用，防止与发布动作竞态。不能按文件创建时间直接清空一个目录。

首版不接受“输入任意音频网址自动抓取”，以避免 SSRF、临时链接和授权来源混淆。

### 10.5 发布阻断条件

以下任一条件成立则禁止发布，并在后台显示具体字段或原因：缺少有效音频、音频超规格、封面不合规、标题为空、草稿版本冲突、资源归属不符、技术试听未确认、明确 blocked，或主动提交的 approved 未满足第 3.3 节完整性校验、已发布数量超上限、访问策略未确认或非法、抢先规则不完整、VIP/early_access 缺少有效独立试听、试听超过时长上限或与当前源音频不匹配。

封面允许选择内置静态默认图，因此没有自定义封面不必阻塞发布。纯音乐无需歌词；有声曲目没有歌词可以发布，但必须正确显示缺少歌词的状态。

### 10.6 独立试听生成与时长强校验

默认 `previewLimitMs=45000`，首发后台只允许设置 15000 至 45000 毫秒的上限。实际片段目标长度为 `min(previewLimitMs, floor(fullDurationMs × 0.5))`。例如 4 分钟作品默认 45 秒，40 秒作品最多约 20 秒，避免短歌曲被完整放入试听。

站长在本地从合规取得的原文件裁剪，再通过受保护上传入口上传 MP3；后台可提供起点选择和本地制作指引。首发不在 Worker 中运行 FFmpeg、不接入付费在线转码，也不要求用户在 Suno 上重新生成同一首歌。后续可另建本地辅助脚本，但它只能帮助管理员制作，不能作为服务端权限校验的替代。

服务端需用经过测试的、支持输入长度上限的 MP3 帧解析实现，计算完整和试听文件的实际样本时长，正确处理 VBR、ID3 和编码填充。上传验证可分块读取已私有保存的对象，不能整曲常驻内存；解析总字节数和执行时间有上限。只相信文件头标注的码率/时长或“字节数÷标称码率”不通过验收。解析器与依赖在 M1 单独评审；不支持、损坏、歧义或超资源预算的文件退回本地规范化处理。

允许编码边界至多 250ms 的时长容差，技术字段记录实际值；前台显示“约 45 秒试听”等对应实际标签。要求 `sourceStartMs >= 0`、`sourceEndMs > sourceStartMs`、`sourceEndMs <= fullDurationMs`，片段实际时长在目标上限加容差以内，并与所填范围长度在容差内一致。VIP/early_access 永远不能通过先输出完整 MP3 再对 HTTP Range 偏移做限制来提供试听。

完整文件替换、试听替换或政策更改需要发布新修订。preview 验证通过也不能覆盖使用权审批；裁剪属于有记录的后期处理，不可用来掩盖来源标记。[S1]

## 11. API 合同

以下路径和字段全部是拟新增合同。现有会员、登录与支付路径由 M0 核实后映射，不能把这里的适配函数当作现成接口。

### 11.1 公开内容与当前用户能力

| 方法 | 路径 | 用途与权限 |
| :--- | :--- | :--- |
| GET | `/api/music/catalog?locale={locale}` | 已发布曲目与歌单的匿名公共投影，不含用户资格 |
| GET | `/api/music/tracks/{trackId}?locale={locale}` | 已发布作品详情、访问规则、试听说明 |
| GET | `/api/music/tracks/{trackId}/lyrics?v={revisionNo}` | 当前已发布歌词，免费开放 |
| GET、HEAD | `/api/music/tracks/{trackId}/audio?v={revisionNo}&variant=full` | free 可匿名；受保护曲逐请求核对全站 VIP |
| GET、HEAD | `/api/music/tracks/{trackId}/audio?v={revisionNo}&variant=preview` | 只返回当前修订独立试听文件，允许匿名 |
| GET、HEAD | `/api/music/tracks/{trackId}/cover?v={revisionNo}` | 当前已发布封面 |
| GET | `/api/music/collections/{slug}?locale={locale}` | 已发布曲目及策略，不能因加入免费歌单而解锁 VIP |
| GET | `/api/music/me/capabilities?locale={locale}` | 当前访问者的最小能力与真实会员中心路径，始终 no-store |
| GET | `/api/music/tracks/{trackId}/access?v={revisionNo}` | 播放错误后的轻量当前资格判断，不返回音频，no-store |
| POST | `/api/music/events` | 开关与隐私条件满足后的第一方事件；不授予资格、不阻塞播放 |

`variant` 必须显式为 full/preview，省略或非法返回 400，禁止自动回退到完整文件。只有已有 v1.0 客户端的迁移场景可临时兼容“省略视为 full”，该兼容仍须经过同样的当前访问检查，记录移除时间并测试。

locale 只接受原站四种语言标识，作品名回退至真实原文。目录最多 500 首，包含摘要和策略，不包含故事全文、所有歌词、私有材料和会员身份。未发布/不存在统一 404，已公开后下架可返回 410。

### 11.2 目录响应示例

以下为结构示例，不代表真实作品。schemaVersion 升级为 2。

```json
{
  "schemaVersion": 2,
  "catalogVersion": 13,
  "locale": "zh-Hant",
  "nextPolicyChangeAt": null,
  "tracks": [
    {
      "id": "b0944906-1ed3-4fa6-8fdc-b71e9a794481",
      "slug": "example-track",
      "title": "示例作品",
      "creatorName": "Station Cat",
      "summary": "仅供开发说明。",
      "durationSec": 240,
      "language": "instrumental",
      "instrumental": true,
      "genres": ["ambient"],
      "moods": ["calm"],
      "coverUrl": "/api/music/tracks/b0944906-1ed3-4fa6-8fdc-b71e9a794481/cover?v=1",
      "audioVersion": 1,
      "lyricsKind": "none",
      "accessMode": "vip",
      "effectiveAccess": "vip",
      "policyVersion": 1,
      "previewAvailable": true,
      "previewDurationSec": 45,
      "previewSourceStartSec": 35,
      "earlyAccessUntil": null,
      "postEarlyAccessMode": null,
      "publishedAt": "2026-09-09T00:00:00Z"
    }
  ],
  "collections": []
}
```

前端只按 trackId、revisionNo、variant 构造同源音频入口，不取得 R2 原始地址。Suno 公开来源 URL 必须为白名单内的 HTTPS 页面，不能嵌入脚本协议。

capabilities 返回以下最小字段，具体售价仍交给原会员中心：

```ts
type MusicCapabilities = {
  authenticated: boolean;
  membershipStatus: 'active' | 'none' | 'expired' | 'revoked' | 'unavailable';
  canPlayVipFull: boolean;
  validUntil: string | null;
  lifetime: boolean;
  serverNow: string;
  membershipCenterPath: string | null;
  loginPath: string | null;
  musicVipDeliveryEnabled: boolean;
};
```

任何资格服务故障返回 503/`MEMBERSHIP_UNAVAILABLE`，不能降级成成功返回 none 并诱导再购买。匿名已确定无会话时返回正常的无 VIP 视图。access 读取先验证歌曲和版本，再返回 `effectiveAccess`、`canPlayFull`、`canPreview`、`reason`；它是 UI 辅助，音频入口仍重新检查。

### 11.3 后台接口

| 方法 | 路径 | 用途 |
| :--- | :--- | :--- |
| GET、POST | `/admin/api/music/tracks` | 列表、创建草稿 |
| GET、PATCH | `/admin/api/music/tracks/{id}` | 读取/保存草稿及访问策略，If-Match 必须匹配 |
| POST | `/admin/api/music/tracks/{id}/publish` | 完成审批、试听及策略核对后发布 |
| POST | `/admin/api/music/tracks/{id}/unpublish` | 下架并记录原因 |
| POST | `/admin/api/music/tracks/{id}/archive` | 已下架作品归档 |
| PUT | `/admin/api/music/revisions/{id}/rights-review` | 保存私有核对材料 |
| POST | `/admin/api/music/uploads` | 创建明确 kind 的上传会话 |
| GET | `/admin/api/music/uploads/{id}` | 查询上传与验证状态 |
| PUT | `/admin/api/music/uploads/{id}/body` | 受保护流式传输 |
| POST | `/admin/api/music/uploads/{id}/complete` | 核验字节、格式和所需时长 |
| GET、HEAD | `/admin/api/music/assets/{id}` | 受保护草稿试听、封面和证据访问 |
| GET、POST | `/admin/api/music/collections` | 读取、新建歌单 |
| PATCH | `/admin/api/music/collections/{id}` | 资料和公开状态 |
| PUT | `/admin/api/music/collections/{id}/tracks` | 原子更新排序 |
| GET | `/admin/api/music/audit` | 分页审计 |
| GET | `/admin/api/music/analytics?from={date}&to={date}` | 已部署统计的聚合值与可用性说明 |

草稿 PATCH 增加 previewAssetId、sourceStartMs/sourceEndMs 以及 accessPolicy 字段；服务端执行归属和测量结果校验，不接收客户端 `approved=true` 跳过检查。除管理员正常内容编辑外，无新建音乐会员或退款权限的接口。

后台 limit 默认 50、上限 100；发布、下架、创建会话和歌单写入使用 Idempotency-Key，同一键不同请求内容返回 409，记录默认保存 24 小时。媒体上传大文件使用原始 body，元数据 JSON 最多 64 KiB。

### 11.4 错误、状态和客户端处理

标题最多 120 字符、创作者名 80、摘要 500、故事 8000；标签最多 12 个且单个至多 32 字符，按统一 Unicode 计数验证。

```json
{
  "error": {
    "code": "VIP_REQUIRED",
    "message": "这首作品的完整版需要有效的 Station Cat VIP。",
    "requestId": "request-example"
  }
}
```

| 错误 | HTTP | 处理 |
| :--- | :--- | :--- |
| INVALID_INPUT / INVALID_VARIANT | 400 | 修正请求，不偷偷改为 full |
| AUTH_REQUIRED / UNAUTHORIZED | 401 | 受保护资源需要登录；后台身份失效按原规则处理 |
| VIP_REQUIRED / MEMBERSHIP_EXPIRED / ENTITLEMENT_REVOKED | 403 | 使用匿名试听或显示正确会员状态，不自动付款 |
| ACCOUNT_RESTRICTED / FORBIDDEN | 403 | 遵循原系统账号规则，不给出付费即可解除的承诺 |
| NOT_FOUND / PREVIEW_UNAVAILABLE | 404 | 无资源，无完整音频回退 |
| VERSION_CONFLICT | 409 | 重读当前版本，不沿用旧策略 |
| TRACK_UNAVAILABLE | 410 | 作品下架，移出可播放集合 |
| FILE_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | 413 / 415 | 上传失败不公开 |
| RIGHTS_REVIEW_REQUIRED / PREVIEW_INVALID / QUOTA_EXCEEDED | 422 | 明确后台阻断原因 |
| RANGE_NOT_SATISFIABLE | 416 | 仅在已授权后返回对象总长 |
| RATE_LIMITED | 429 | 带 Retry-After，允许用户稍后重试 |
| MUSIC_NOT_CONFIGURED / MEMBERSHIP_UNAVAILABLE / VIP_DELIVERY_DISABLED | 503 | 服务暂不可用，禁止诱导重新购买或免费放开 VIP |
| INTERNAL_ERROR | 500 | 关联 requestId，不泄露内部堆栈 |

保留 `UPLOAD_EXPIRED` 等原上传错误，使用 409 或 410 与会话状态一致。所有资格响应及其错误使用 `Cache-Control: private, no-store` 和 `Vary: Cookie`；HEAD 错误不带 body。音频失败不包装成 200 MP3，不 302 跳向付款或登录 HTML。

### 11.5 播放权限判定顺序

先检查功能开关、合法路径和 variant，再查当前已发布修订及服务器计算的访问策略；preview 仅映射合法短文件。full 若有效策略为 free 则无需查询 VIP；若为 vip 则验证既有会话和全站资格后读取对象。所有条件请求、Range、HEAD 与错误路径执行相同守卫。

确认 grant、退款或会员周期的任何写操作仍留在原会员系统。音乐 events、catalog、capabilities、access、audio、cover、lyrics 均无权扣款、扣积分、延长或撤销会员。

## 12. 音频传输、Range 与下架

### 12.1 每次请求的检查顺序

先按第 11.5 节检查功能开关、发布版本、variant、实时访问策略和必要会员资格，再核对资源归属，最后读取私有 R2 对象。受保护请求在资格通过前不能执行 R2 HEAD/GET 并返回完整文件信息；不存在或未发布资源先按统一 404/410 处理。禁止通用 `?key=任意路径` 桶读取入口。

首版每次音频请求都通过 Worker。GET、HEAD、Range、If-Range、有效条件缓存请求使用同一资格守卫。未授权返回无文件大小/ETag的 401/403 或资格故障 503，不能通过条件请求绕过权限。

### 12.2 HTTP 行为

进度拖动和断点读取需要正确处理 HTTP Range。R2 Workers API 可返回指定范围的对象数据及相关元数据，最终 HTTP 状态和响应头仍须由应用正确组装。[S7][S8]

| 请求 | 响应要求 |
| :--- | :--- |
| GET，无 Range | 200，返回完整流和完整 Content-Length |
| GET，单一有效范围 | 206，返回对应字节，准确 Content-Range 与范围长度 |
| `bytes=0-1` | 206，只返回两个字节 |
| `bytes=1000-` | 从指定偏移至结尾 |
| `bytes=-500` | 返回末尾最多 500 字节 |
| 有效但完全超出范围 | 416，并返回 `Content-Range: bytes */{totalSize}` |
| 不支持的多范围或无效语法 | 首版按明确策略忽略 Range，返回完整 200；不伪造 multipart 响应 |
| HEAD | 200，无响应体，返回完整对象头，忽略 Range |
| If-Range 与强 ETag/日期匹配 | 按单范围响应 |
| If-Range 不匹配或弱 ETag | 忽略 Range，返回完整 200 |
| If-None-Match / If-Modified-Since | 首发媒体不返回 304；完成授权后提供当前 200/206，配合 no-store 防止个人缓存复用 |
| 不支持的方法 | 405，并提供 Allow |

范围数字必须校验为安全整数，超大、负值和反向范围按既定策略处理。请求结束位置超出末尾时裁剪；后缀长度超过全长时返回完整长度的有效范围。

以上协议行为同时适用于 full 和 preview，但 preview 的总长度、范围、ETag 只对应独立短文件。请求超出短文件尾部不能读取源音频后续字节。

响应必须具有正确的 `Content-Type: audio/mpeg`、`Accept-Ranges: bytes`、ETag、`X-Content-Type-Options: nosniff`。ETag 使用符合 HTTP 格式的值；不要把完整文件大小错误填写为 206 的 Content-Length。[S8]

媒体返回原始字节，不做 gzip/brotli 变换，不用 JSON helper 包装媒体响应。直接流式返回 R2 body，不整曲 `arrayBuffer()`，不先完整下载到浏览器再创建播放 Blob。

### 12.3 首版缓存策略

为保证发布状态和会员资格可控，首版 full/preview 音频及所有资格响应使用 `Cache-Control: private, no-store`、`Vary: Cookie`，包括 401/403/409/410/416/503。歌词和自定义封面使用 no-store。明确不进入应用 Cache API、CDN Cache Everything 规则或 Service Worker。静态默认封面、JS 和 CSS 沿用现站静态缓存策略。

公开目录使用 ETag 和 `max-age=0, must-revalidate`，缓存键包含 locale，公开投影不含任何用户资格。ETag 纳入自然到期后的实际访问状态；不能只用 catalogVersion 在抢先到期后仍返回旧 304。capabilities/access 后台全部 no-store，不能将响应混入目录缓存。

该选择会增加媒体读取请求和重复封面流量，是首版明确接受的成本取舍。P1 优化缓存时必须同时设计下架失效、版本化和监控；不能只把音频设置成一年 immutable 缓存就结束。

### 12.4 下架效果边界

下架成功后，新的完整音频、试听、歌词、封面及详情请求被拒绝；公共目录下一次校验后不再显示该歌。已经收到的字节、正在传输的响应或用户已保存的文件无法追回。

会员到期、撤销和服务开关变化也按后续请求生效。现有响应中途不追加周期性扣费/资格写入，首次授权后的流不会被描述为完全可撤回。

因此验收应检查“后续新请求不再取得资源”，不能写成“所有正在播放的设备瞬间停止”。需要紧急停用时，可关闭音乐公开入口并保留后台，供管理员排查。

### 12.5 跨域与防滥用

首版页面与媒体同源，音频通过浏览器已有的安全会话 Cookie 访问，不在 URL 中嵌入身份。响应不允许 `Access-Control-Allow-Origin: *` 搭配凭据，也不把跨站 Cookie 降级为前端可读。公共内容和受保护音频分别设置最小跨域策略。只有后续采用独立媒体域名时，才配置明确 origin 白名单和必要 CORS 响应头，并测试 Range、HEAD 和预检请求。

CORS、Referer 检查和隐藏 URL 都不能保证阻止下载或盗链。可以在后续通过可观测的请求速率限制降低异常流量，不能将这些措施宣传为 DRM。

首版配置可调整的音频请求速率保护，采用较宽松阈值并给正常拖动留出空间，例如以每来源一分钟 120 次作为预发布观察起点；这是设计初值，需压测后确认，不能直接当作真实访问规律。不得仅依赖 Worker 进程内 Map 作为全局限流。

### 12.6 不允许的替代实现

不把 VIP 完整音频放到公开 `r2.dev`、公开桶自定义域名、Git、dist 或静态 public 目录。仅关闭 `r2.dev` 还不足以证明没有其他公开域名，M0/M6 要核查所有暴露路径。[S17]

不使用长期签名链接代替实时会员状态，不通过前端 `isVip` 或支付成功 query 授权，不以 CORS/Referer 作为核心权限。不把所有异常降级成免费完整播放。未来 CDN 缓存或短时播放令牌须单独评审失效边界、Range 和撤销延迟。

## 13. 后台工作区与日常运营

### 13.1 后台页面

沿用 Admin 2.0 的导航、身份、表单样式与操作提示，新建“音乐”入口。[R5] 不在公网建立新的管理员注册系统。

管理列表支持草稿、已发布、已下架、已归档四个状态筛选，以及按标题搜索。表格展示封面、标题、音频/试听状态、free/vip/early_access 类型、当前有效类型、抢先结束及去向、权利核对、发布时间、最后修改和操作。

编辑页面分成基本资料、完整音频与试听、封面/歌词/故事、会员访问策略、使用权核对、发布预览六个区域。发布按钮旁展示未满足的条件，不能让管理员不断尝试后才逐个发现问题。

### 13.2 必要运营能力

可将一首歌设为首页主推，或加入多个歌单；推荐位和歌单不能绕过歌曲的发布状态。主推歌曲下架后，首页自动去掉对应推荐，并显示其他有效作品或普通介绍。

拖拽排序同时提供上移、下移按钮。保存使用版本控制，失败时保留当前操作内容并提示重载合并。

发布、下架和归档均记录操作人、时间、歌曲版本与原因。下架操作提供明确确认框，避免点错；上传、编辑和查看预览无需多余二次确认。

### 13.3 站长发布一首歌的实际流程

在 Suno 官方允许的下载入口取得音乐，并保存相应记录；将文件保存在自己的备份目录。进入网站后台，点击“新增歌曲”，上传音频和封面，填写名称、公开署名、标签与故事。有歌词时粘贴文本或导入 LRC，纯音乐勾选对应选项。

选择免费、VIP 或抢先；受保护作品上传并核对独立试听，抢先作品填写结束时间及后续去向。完成完整/试听双文件检查和使用权核对后，分别预览“访客、普通账号、有效 VIP、过期 VIP”四种界面，再点击发布。后台模拟只影响预览 UI，不生成可带到公开接口的权限参数。正式页面试听开头、中间和结尾，拖动一次进度条，再复制本站歌曲链接分享。

后续改介绍或换封面会形成新草稿。新版本发布前，访客继续看到旧版本；替换音频或歌词后重新完成对应检查。

### 13.4 发布检查清单

核对歌曲名称和真实署名，确认没有复制未授权歌词、图像或音频输入。试听确认没有损坏、异常静音和明显剪辑错误，歌词文件不会执行脚本。确认来源说明、封面、手机排版、分享链接和后台权利材料；验证免费账号无法取得 VIP 完整文件，且已有 VIP 无需额外购买。免费封面和歌词仍能正常显示。

发现争议时先下架并保留原始记录，不擅自删除全部凭证，也不在页面自动生成侵权已成立或授权已确认的结论。

### 13.5 会员权益说明的运营同步

音乐上线前同步现有会员中心与相关商品说明，明确“现有 VIP 已包含音乐”和个人站内欣赏范围；实际价款、期限和原有商品边界不变。站点支持/退款页面提供可用联系途径，不能因音乐技术方案而自动替换全站条款。

资格服务异常或 `MUSIC_VIP_DELIVERY_ENABLED=false` 时，音乐页停止音乐专属促购文案并显示服务提示，会员中心标明音乐暂不可用；不能因关闭音乐而关闭整个站点的合法会员管理、取消、退款或历史 Webhook。

## 14. 安全、隐私与非功能要求

### 14.1 管理鉴权

复用现有 Cloudflare Access 及 Worker 内的管理员校验，但必须在实际代码中核对完整流程。后端验证 JWT 签名、签发者、受众、有效期和管理员允许范围；不能只相信可伪造的邮箱头或前端角色字段。Cloudflare 提供 JWT 验证方式，实施时遵循当前官方文档。[S10]

所有管理写接口还需校验请求来源，并使用与既有会话兼容的 CSRF 防护。来源列表不得通过通配符包含任意网站。

调试模式不允许绕过线上后台鉴权。临时预览域名和未来新增域名同样要检查保护范围，不能假设主域名的 Access 策略自动保护所有部署入口。

### 14.2 文件和接口安全

用户不可传入桶名、任意 object key、远程抓取地址或文件系统路径。后端使用明确资源映射，不通过拼接字符串推断资源权限。

音频、图片和证据采用各自固定 Content-Type；证据文件通过受保护接口并使用下载响应，不在公开 HTML 中内嵌。上传检查无法提供绝对的恶意文件识别保证，因此严格限制类型、访问方式及权限。

公开页面使用纯文本输出歌曲名、故事和歌词。需要富文本时另行引入受审查的白名单渲染器；首版不支持原始 HTML。

仅在相关音乐路由上审查必要 CSP 配置，例如公共音频只允许本站，后台试听额外允许本地 Blob。不得直接修改全站 CSP 并破坏既有脚本、付款或游戏。

### 14.3 本地数据与隐私

首版收藏与完整历史保存在浏览器；会员核验使用既有账号。启用第 16 节第一方事件后，只上报最小统计字段，不上传收藏列表或完整浏览历史。不引入广告追踪、设备指纹或第三方音乐播放器 SDK，也不能继续宣称所有收听行为均只在本地。

实际托管平台可能记录请求日志，不能宣称服务器完全没有访问记录。站点隐私说明应加入本地存储、会员资格核对、实际日志、可选第一方事件、保留期与清除/退出方式。针对实际经营地区核对同意或其他适用依据，依据未确认时统计默认关闭，不影响播放和会员权益。

应用日志不写完整 IP、Cookies、Access JWT、授权证据、原始上传内容或支付原文。会员身份只在服务端必要范围使用，音乐公共 API 不返回账号资料。日志保留期应明确配置；首版音乐管理审计建议保留 180 天，长期授权凭证另按作品管理需要保存并限制访问。

### 14.4 无障碍

按钮可通过键盘操作，图标按钮具备可访问名称，播放状态使用文本及语义传递，不仅依赖颜色。进度和音量使用原生 range 控件或具有完整键盘语义的替代方案。

普通正文对比度目标至少 4.5:1，大字及相应非文本控件按适用标准检查。焦点清晰，弹层可关闭并把焦点还给触发按钮，触控目标按至少 44px 设计。遵循用户减少动画的设置。[S12]

快捷键仅在焦点位于播放器区域或显式启用时使用，不能抢占搜索框、表单和页面阅读中的 Space、方向键。

### 14.5 性能验收目标

以下为本项目目标，尚无实测结果：

| 项目 | 目标与测量口径 |
| :--- | :--- |
| 音乐专属首屏 JS | gzip 后不超过 80 KiB，不含主站既有公共代码 |
| 曲库目录 | 500 首时 gzip 后不超过 250 KiB，不含歌词和长故事 |
| 初始音频请求 | 未点击播放时为 0，不预加载整个列表 |
| 列表渲染 | 每次展示 50 条，客户端分页或增量展示 |
| 首次有声 | 在预发布中定义 20 Mbps、100ms RTT 条件，至少 30 次样本，p75 不超过 3 秒 |
| 搜索响应 | 500 首在指定参考设备上 p95 不超过 150ms，记录设备 |
| 页面稳定性 | 预设图片尺寸，防止播放器出现时整体跳动 |
| 长时间播放 | 连续播放 30 分钟，无持续增长的监听器、计时器和对象 URL |
| 弱网失败 | 明确显示重试，不无限加载或无限换歌 |

自动化结果必须记录运行条件，不能将一次本地快速测试当作全球访问体验结论。

## 15. 异常与降级设计

| 情况 | 预期行为 |
| :--- | :--- |
| 没有任何正式作品 | 显示“音乐还在整理中”，保留栏目介绍，不放虚假歌曲 |
| 目录请求失败 | 显示重试；不删除用户本地收藏 |
| 指定歌曲不存在或已下架 | 提示作品暂不可用，可返回曲库 |
| 版本已替换 | 重新读取作品；明确提示版本变化，不把旧进度硬套入新歌 |
| 音频 404/410 | 停止该曲，按队列规则有限跳过或等待用户操作 |
| 音频网络中断 | 暂时显示缓冲；超时后给出重试按钮并保存位置 |
| 受保护音频 401/403 | 做一次轻量 access 复核，正确提示登录/到期，禁止自动再次收费 |
| 会员服务超时或未知 | VIP full 503，免费/试听继续，显示服务提示而非非会员结论 |
| 试听不存在或超长 | 发布被阻断；运行时不回退完整文件 |
| 试听自然结束 | 停止，保留非模态会员入口，不循环试听、不强制跳转 |
| 付费返回尚未到账 | 有上限地同步资格，不根据 return URL 授权 |
| 抢先期自然结束 | 服务器实时按后续类型判定，前端重新获取目录 |
| 中途登出或切换账号 | 暂停并卸载 VIP full 源，清理旧内存资格，保留收藏 |
| play 被浏览器拒绝 | 保持暂停，提示再次点击播放 |
| 文件解码失败 | 提示音频格式或文件可能有问题，记录技术错误码 |
| 封面加载失败 | 使用站点自带默认封面 |
| 歌词解析失败 | 降级显示可读纯文本，后台显示解析警告 |
| 系统分享被取消 | 正常结束交互，不报故障 |
| localStorage 不可用 | 内存运行，提示本次设置无法长期保存 |
| Media Session 不支持 | 保留网页控制，不显示失效承诺 |
| 后台登录过期 | 保存可安全恢复的文字草稿，提示重新登录，不保存令牌 |
| 音乐绑定未配置 | 音乐返回配置错误，主站原功能不受影响 |
| 上传断线 | 保留会话状态，允许确认或重新上传，文件不公开 |
| 发布过程中数据库失败 | 保持原公开版本，不能只上传成功就显示已发布 |
| 连续快速切歌 | 只有最后一次明确选择生效，状态和声音一致 |

加载超时建议采用 15 秒提示阈值，可配置。超时后仍允许手动重试，不能直接判定用户网络永久不可用。

## 16. 第一方统计与会员转化评估

### 16.1 首发范围、开关及隐私

P0 实现最小事件采集和管理员聚合查看，默认 `MUSIC_ANALYTICS_ENABLED=false`。运营者完成隐私说明、适用依据与保留期配置后再启用；需要同意的环境必须先取得有效同意，没有现成同意管理或依据不清楚时保持关闭。听歌、登录和现有会员权益不以同意非必要统计为条件。

记录缺失时返回 `available=false` 和原因，不能以 0 冒充没有访客或无人购买。严禁假播放量、将音频 GET 次数当播放次数、将所有 VIP 营收记为音乐收入。

### 16.2 最小事件与口径

| 事件 | 产生方与触发 | 统计含义 |
| :--- | :--- | :--- |
| `play_start` | 浏览器收到真实 playing，每次播放会话一次 | 实际开始，不以按钮点击代替 |
| `qualified_play` | 累计真实播放达到 min(30 秒, 当前文件时长×50%) | 初步有效收听，full/preview 分开 |
| `play_complete` | 自然 ended 且累计实际时长≥当前文件90% | 完整播完所选文件；preview 不算完整歌曲 |
| `preview_end` | 试听自然结束 | 试听走完后可展示权益提示 |
| `vip_cta_click` | 用户明确点击开通/权益入口 | 音乐到会员中心意向 |
| `membership_center_open` | 已集成的真实会员中心到达事件 | 未实现到达采集则标不可用，不以点击推定到达 |
| `vip_grant_confirmed` | 服务端核验原会员系统的真实新增 grant | 资格实际取得；区分积分兑换、直购、赠送/历史 |
| `vip_grant_reversed` | 服务端核验该 grant 的有效撤销 | 修正激活归因，不直接更改账户 |

play_session_id 在一次选曲开始时创建；暂停继续沿用，切源/新循环换新 ID。用真实播放时段累计，排除暂停、buffering 与 seek 跳跃，不能用拖到结尾构造 complete。qualified、complete、preview_end 各自每会话最多一次，事件 ID 数据库唯一约束去重。

同一匿名会话同曲同 variant 的 qualified 每 30 分钟最多计一次，循环与重复播放另记原始 start。所有口径属于本项目选择，不能宣传为音乐行业统一标准。

### 16.3 事件接口、限制与数据保留

事件批次最多 20 条，JSON 最多 16 KiB；允许字段为 eventId、eventType、playSessionId、anonymousSessionId、trackId、revisionNo、variant、occurredAt、累计收听毫秒数及固定来源枚举。服务端记录 receivedAt，验证时间容差、ID 格式、曲目状态、variant 和已知时长。拒绝任意 metadata，禁止提交 email、完整 URL、Cookie、支付金额或客户端 accountId。

客户端只能提交表中浏览器事件；伪造 `vip_grant_confirmed/reversed` 返回 403。合法事件接口即使失败也不阻塞播放，缓冲队列最多 100 条且仅内存保存；后台批量上报失败最多重试两次，不在回到前台时上传无限积压。

请求按匿名会话及滥用保护约束做外部一致的限流，初值每会话每分钟 60 个事件，正常播放不受影响；它只是预发观察参数。无必要不长期保存 IP 或可跨站识别符。

随机统计会话 ID 只在获准统计后写入 sessionStorage，不生成持久设备指纹。原始事件默认保存 30 天，匿名汇总 365 天，归因最小引用 90 天，期满删除或不可逆聚合；原会员账本与合法财务记录继续按原系统规则管理。拒绝或撤回可选统计后停止收集并清除统计会话，保留基本本地收藏功能。

### 16.4 会员激活归因与安全隔离

首发不为音乐新建收款。仅在统计开关及相应隐私条件满足后，音乐 CTA 可保存最多 24 小时的来源线索，用户返回后由服务端只读核验当前账号的新 grant；归因采用最近一次合格音乐入口，标为“关联激活”，不声称因果关系。

只有存在原系统可验证的 grant ID、创建时间、来源和访问周期时才写 `vip_grant_confirmed`。以前已有效的 VIP 登录、赠送会员、失败订单、待处理充值、仅完成积分入账而未取得 VIP 都不得计为新的付费 VIP。赠送可以独立统计，既有会员使用音乐进入另一张指标。

原服务无法安全提供来源/时间/唯一引用时，将付费激活及续购指标标为 unavailable；M0 建立最小只读查询方案，禁止为追踪而扩大音乐数据库访问所有付款资料。测试环境允许 fixtures，生产不得伪造成功事件。

音乐统计库与原会员库无跨库事务。原会员交易成功不等待音乐统计写入；统计失败记待核对并用原系统可验证记录幂等补记，不能重新调用充值或兑换接口。退款/撤销同理，由原系统确定事实后更新归因。禁止因为统计故障回滚用户已成功购买的会员。

积分兑换会员对应资格消费，不能将历史充值包的全部现金金额当作当月音乐收入；没有可靠分摊时只显示次数。将来按会员收入评估音乐效益，单独说明新增收入/续购贡献估算和成本，保持与实际付款账本区分。

### 16.5 看板与评估周期

首发后台显示日期范围、免费 full、VIP full、preview 的 start/qualified/complete、试听结束与 VIP CTA 点击；展示失败量、样本量和指标可用性。小样本比率旁必须展示分子分母，分母为零显示暂无样本。

P1 在真实账号和历史数据允许的情况下，评估会员使用率、7 日回访、到期后再次兑换、自动续费成功率及关联开通率。手动兑换和自动续费分别定义分母及观察窗口。没有跨天识别依据的匿名会话不能推导 7 日独立用户留存。

至少观察两到三个完整会员周期，再评估价格或独立音乐套餐。高收听量不等于付费意愿；使用音乐的会员续购更多也可能源自原有兴趣差异，不能直接视为音乐造成的提升。

## 17. 成本、配额与增长

### 17.1 资源需求判断

该设计用于播放已生成的音频，不在访客收听时调用 Suno 或云端音乐生成模型，因此本项目没有按收听次数触发的模型生成调用。

主要成本来自 R2 存储及操作、Worker 请求和 CPU、D1 读取写入，以及原站本身的订阅和域名。Suno 创作和下载相关费用属于素材生产费用，需要单独核对，不能混入“每次播放的 AI 成本”。VIP 通过既有收款系统取得，支付手续费和退款成本沿用实际原账本；首发音乐模块不新增独立支付交易。

Cloudflare 当前公布的 R2 Standard 存储价格为每 GB-month 0.015 美元，包含每月 10 GB-month 存储、100 万次 Class A 和 1,000 万次 Class B 的免费用量；R2 本身的出站流量不收取费用，但接入其他计量服务可能另计。剩余免费额度及最终账单取决于用户整个账户用量和适用计费规则。[S13]

音乐文件固定使用 R2 Standard；不把经常访问的播放文件默认转为 Infrequent Access。低频层有数据取回费用，Standard 的免出站规则不会免除 Worker/D1 请求、CPU 或存储操作。[S13][S14]

### 17.2 明确假设下的体积测算

假设每首歌 4 分钟、平均码率 192 kbps，使用十进制 MB/GB，暂不计封面、标签和传输重试：

```text
单首大小 = 192,000 bit/s × 240 s ÷ 8
         = 5,760,000 bytes
         ≈ 5.76 MB

100 首大小 ≈ 576 MB ≈ 0.576 GB
500 首完整音频 ≈ 2.88 GB
单首 45 秒、192 kbps 试听 ≈ 1.08 MB
假设 500 首均保留一份该规格试听 ≈ 0.54 GB
完整音频加试听 ≈ 3.42 GB，不含封面、证据、多版本和备份

每月完整播放 10,000 次的数据量
         ≈ 5.76 MB × 10,000
         ≈ 57.6 GB
```

该计算只是码率假设下的容量估算。实际 VBR 文件按真实 byte_size 统计；每次播放会产生多少个 Range 请求需实测，不能按一次播放等于一次 R2 GET 估算总请求成本。

授权证据、原始备份、多版本文件以及既有站点用量都可能增加存储。R2 免出站费不等于整个音乐功能永远免费。[S13][S14]

### 17.3 首版预算与保护

后台显示音乐桶已登记文件总量、上传中预留量、已发布数量和清理待办。项目存储配额必须在上线前配置；配额接近 80% 时提醒管理员，达到 100% 时停止新上传，已发布播放保持可用。

配额统计同时考虑上传预留，防止多个上传请求绕过剩余额度。定期与实际 R2 对象清单对账，不能只加不减或忽略失败对象。

启用 Cloudflare 的实际账单提醒和服务用量监控。收到异常流量时优先检查请求次数和错误比例，必要时限制异常来源；不自动删除用户作品来省费用。

### 17.4 扩容触发条件

超过 500 首时先调整分页和搜索合同。需要大文件、无损格式或批量制作时，新增离线或异步转码流程；不要把 FFmpeg 塞进现有音乐读取 Worker。

全球访问量明显增长后，再评估公开音频缓存、专用媒体域名和访问撤回时效。付费访问已纳入当前规格；以后新增多码率、自适应传输或令牌化缓存时，重新评估权限新鲜度、失效和请求成本，不能破坏现有完整/试听隔离。

## 18. 测试矩阵与验收标准

### 18.1 单元测试

| 编号 | 内容 | 必须覆盖的边界 |
| :--- | :--- | :--- |
| U01 | 状态机 | 播放、暂停、缓冲、结束、失败、快速切源 |
| U02 | 队列 | 空列表、单曲、尾曲、重复加入、移除当前曲 |
| U03 | 随机循环 | 不立即重复、历史回退、轮次重建、手动切歌 |
| U04 | LRC | 多时间标签、offset、毫秒位数、乱码、非法行 |
| U05 | 本地恢复 | 旧 schema、损坏 JSON、过期进度、下架歌曲 |
| U06 | 输入校验 | 超长字符、未知枚举、异常 URL、过多标签 |
| U07 | 公开投影 | 不包含证据、原始 key、管理员信息和草稿 |
| U08 | Range | 开放结尾、后缀、越界、超大整数、多范围 |
| U09 | 发布规则 | 来源材料留空/pending 可继续、明确 blocked 拒绝、资源缺失、错归属、旧技术核对不适用 |
| U10 | 版本控制 | 冲突时发布指针、catalogVersion 和审计均不被错误修改 |
| U11 | 访问策略 | free/vip/early_access、结束前/等于/后、未知枚举不放行 |
| U12 | 会员映射 | 全站与作品级隔离、起止边界、多 grant、终身显式证明、撤销与故障 |
| U13 | 试听校验 | 两种资源不同、同源绑定、短曲半长、45秒上限、250ms容差、VBR损坏 |
| U14 | 权限队列 | 无免费曲、混合列表、试听结束不循环、权限跳过不计网络错误 |
| U15 | 归因与事件 | 重放去重、篡改事件拒绝、赠送/老会员不算新付费、积分充值不算VIP激活 |
| U16 | 迁移 | v1.0免费曲保持free，本地记录缺少variant不误恢复VIP源 |

### 18.2 Worker 和存储集成测试

| 编号 | 场景 | 通过条件 |
| :--- | :--- | :--- |
| I01 | 未登录管理请求 | 不能读写音乐私有记录 |
| I02 | 伪造身份头、过期 JWT、错误 audience | 均拒绝 |
| I03 | 跨站写入请求 | 被现有会话对应的防护机制拒绝 |
| I04 | 从公网读取草稿、证据或其他桶 | 不能获得资源 |
| I05 | 超限、错 MIME 和中断上传 | 不公开、不越过配额，残留可清理 |
| I06 | 两个并发上传同一会话 | 最多一个进入有效写入，不覆盖已验证资源 |
| I07 | 重复完成与重复发布 | 幂等，不重复版本或审计 |
| I08 | 编辑已发布作品 | 草稿变化不影响当前公开版本 |
| I09 | 发布时注入数据库错误 | 不出现部分发布状态 |
| I10 | GET/HEAD/Range/If-Range | 状态、头部、字节内容和长度都准确 |
| I11 | 发布后下架 | 新目录请求无作品，新媒体请求被拒绝 |
| I12 | 下架后请求旧版本 URL | 无法继续取得新响应的音频 |
| I13 | 丢失 MUSIC_DB/MUSIC_BUCKET | 音乐可诊断失败，原站其他路由不报错 |
| I14 | 清理与发布并发 | 被修订引用的文件不能被删除 |
| I15 | 多语言缓存 | 不交叉返回其他语言目录 |
| I16 | 匿名/普通账号请求VIP full | GET/HEAD/Range/条件请求均拒绝，不能泄露大小或ETag |
| I17 | VIP请求full、任意人请求preview | 返回各自正确文件，preview越界不能读到原曲后续 |
| I18 | 到期/撤销/登出/账号切换 | 后续请求失效，旧Cookie或本地缓存不复用，其他合法grant保留 |
| I19 | early_access自然结束 | 无cron也按配置进入free/vip；目录ETag随有效状态变化 |
| I20 | 用户A/B与缓存 | A的会员响应/状态不可被B或匿名用户复用 |
| I21 | 会员查询超时 | VIP full 503，免费/试听正常，无免费放行及重复购买诱导 |
| I22 | 付款返回及异步同步 | query伪造不能解锁，旧会员不新记开通，重试不重复扣积分 |
| I23 | 退款路径 | 依原系统真实grant撤销影响后续音乐访问；仅负积分不自创全站封禁 |
| I24 | 统计跨库失败 | 原交易照常成功，幂等补记不重做交易，无客户端资格写入 |
| I25 | 音乐VIP开关关闭 | 免费仍可听，VIP full 503，绝不能变免费；主站会员管理仍可用 |
| I26 | 会员资格服务映射缺失 | 上线被阻断，对已发布受保护资源关闭访问，fixtures不入生产 |

Range 必须用已知内容的本地测试文件逐字节比对。不能只测试响应状态码，也不能以“可播放一次”代替拖动和边界测试。

### 18.3 浏览器自动化

利用仓库现有 Playwright 能力，测试桌面宽屏、平板、390px 手机和 320px 窄屏。媒体自动播放策略在 CI 中可能与真实终端不同，测试脚本放宽限制的结果不能替代真机验证。

覆盖：首次不自动发声、点击后真实播放、进度变化、拖动、歌词跟随、暂停刷新后恢复、搜索时不断播、打开另一曲详情时不换歌、浏览器后退、重复初始化、键盘操作、空状态、慢网、图片失败和无障碍基础检查。新增匿名、普通、有效 VIP、过期 VIP 四种视图；验证试听进度与歌词偏移、从会员中心返回保持暂停、付费状态未同步、登录状态未知、账号切换及没有免费歌曲时的队列行为。

音频测试使用测试环境自产或授权短文件，并在测试报告写明来源。不要将测试歌曲计入生产作品数量。

### 18.4 真实设备验收

至少覆盖实际 iPhone Safari、Android Chrome、macOS Safari/Chrome、Windows Edge/Chrome。以实施当天可获得的正式版本和前一个主版本为范围，记录实际设备和版本号，不在文档中猜测未来浏览器版本。

重点验证 iPhone 主动播放、锁屏、回到前台、蓝牙控制、系统音量、网络切换和来电中断后的状态。标记每项为通过、降级或不支持，并附复现步骤。

播放暂停不能仅看按钮图标。验收人员应确认声音、媒体状态、进度和系统控制一致。

### 18.5 现站回归

运行仓库已有测试和构建，检查首页、语言切换、小说列表和阅读、游戏、支付、会员入口、后台上传、原有 sitemap 和 404 路由。

音乐功能未启用时，原有页面的控制台错误、加载脚本体积和请求数量不应无理由增加。原有游戏音频不能被新播放器全局监听器意外接管。

### 18.6 上线判定

P0 功能完成，全部权限和发布一致性测试通过，关键 Range 用例通过，真实 iPhone 主要收听流程通过，现站回归通过，备份和回滚演练有记录，真实作品完成技术试听并按可选来源材料合同处理明确阻止结论、全站会员映射和退款/撤销依赖已明确、媒体缓存隔离与试听强校验通过、会员说明与售卖权益一致，才可判定首发具备上线条件。

测试未运行、依赖未安装或缺少真机时，报告必须明确写未验证，不能以静态代码检查替代通过结论。

### 18.7 商业化专项验收场景

使用隔离账号和自制测试音频完成三条链路：免费访客完整播放 free；普通账号只拿到 vip 的 preview；有效全站 VIP 获取同一首的完整内容。分别在音频开头、中间、尾部测试 Range，不以隐藏按钮作为安全证据。

准备 early_access 到期进入 free、到期仍为 vip 两首测试条目，通过受控服务端时间测试等于边界时刻。检查合法续购、取消续费但尚未到期、资格撤销、退款关联未完成和负积分等案例，不只测试 `isVip=true/false`。

浏览器开发者工具网络记录确认：无资格用户从未收到完整版；公开目录不含个人到期信息；试听和完整版没有共用资源；切账号后旧完整源卸载。截图只能作为交互补充，不能替代 HTTP 字节和权限测试。

## 19. Codex 分阶段实施任务

每一阶段都应单独形成可审查的小 PR。完成代码不等于完成阶段，必须提交测试结果、已知限制和下一阶段输入。

| 阶段 | 前置输入 | 工作范围 | 验收与交付 |
| :--- | :--- | :--- | :--- |
| M0 现状核对 | 本文、当前工作分支、根 AGENTS 与原阶段文档 | 核对路由、鉴权、语言、构建、资源及全站VIP真实语义、原价、付款返回、退款；建立音乐任务文档 | 明确实际集成点和版本；不修改生产资源；记录差异和决策 |
| M1 领域与数据 | M0 结果 | 数据与追加迁移、访问策略、会员适配合同、试听解析、并发guard、权利检查 | 本地迁移通过；权限字段不泄露；冲突无副作用；提供测试 |
| M2 媒体与后台 API | M1 | 私有资源与独立试听、上传、发布/下架、逐请求VIP验证、Range/HEAD、错误合同 | 上传到发布闭环在预发可测；逐字节范围测试通过 |
| M3 前台核心播放器 | 已稳定的公开 API | 单一audio、full/preview状态、权限队列、循环、进度、到期/登出恢复 | 声音与状态一致；快速切源、空队列、故障有边界 |
| M4 曲库与手机体验 | M3 | 推荐、搜索、详情、歌词、收藏、VIP提示及会员中心返回、最小统计、本地化 | 页面内切换不断播；本地记录和多语言路由正确 |
| M5 管理工作区 | M2 与现有后台 | 上传与双文件试听、核对、四角色预览、访问策略/抢先、推荐/歌单/统计看板 | 站长不修改代码即可发布；后台状态和错误可理解 |
| M6 回归与上线准备 | M1 至 M5 | 真机、会员/退款专项、隐私/条款、权限、性能、备份、回滚、正式内容检查 | P0 验收记录齐全；形成发布说明和待办；经授权后上线 |

M3 可以使用本地 mock 进行开发，但生产构建必须连接真实合同。Mock、测试曲库和假统计均不得进入正式 API。

每个 PR 限定职责范围。禁止为了方便播放器开发重构全站路由、升级 Astro 主版本、替换后台登录或随意改动支付逻辑。允许小范围只读权益适配和已核实会员中心文案/回跳接入；需要修正原会员退款或资格缺陷时，单独列最小PR、测试和授权要求，不夹带价格或扣款变化。

### 19.1 阶段交接文件

`docs/music/PROJECT_CONTEXT.md` 记录目标、现有架构、首版范围和已确认约束；`CURRENT_PHASE.md` 记录当前阶段、分支、提交和阻塞项；`TASKS.md` 使用固定任务编号及 TODO/IN_PROGRESS/DONE/BLOCKED 状态。

`DECISIONS.md` 记录单一audio、页内持续播放、私有R2 Standard、独立D1、统一VIP、独立试听、权利审批和缓存策略。`MEMBERSHIP_INTEGRATION.md` 保存真实资格/路由映射及退款核对；`COMMERCIAL_RULES.md` 保存已确认权益、原价复用、对外承诺和禁止事项。`HANDOFF.md` 记录本次改动、实际执行命令、测试输出摘要、未验证项和下一步。

这些文件用于持续开发上下文，不宣称能够让 Codex 永远不遗忘。每次会话必须先读取并核对代码状态，文档与代码冲突时先说明差异。

### 19.2 每个任务的定义

```text
任务编号：M2-04
目标：实现带统一权限守卫的 full/preview 单范围读取
前置：已发布版本、有效访问策略、会员适配和R2映射可用
范围：仅 GET/HEAD 与 Range 响应，不涉及后台 UI
改动：media-response.js 与相关测试
验收：授权200/206/416、未授权401/403、后缀范围、If-Range、逐字节和短片段边界通过
排除：多范围 multipart、长期 CDN 缓存
证据：测试命令、结果、提交号
下一阶段输入：稳定音频 URL 合同与错误码
```

### 19.3 本地验证命令

仓库目前存在以下脚本，可作为基础入口；开始时先读取当前 package.json，以实际分支为准。[R1]

```bash
npm ci
npm test
npm run build
npm run test:browser
```

音乐专属测试、迁移和检查脚本由 M0/M1 增补并固定依赖版本。不能在交付说明中写一个尚未创建的 `npm run music:test` 并声称已经成功运行。

涉及 Wrangler 的预发检查命令，应在 M0 核对安装方式后写入 OPERATIONS。不要通过无版本约束的工具升级改变现网运行时，也不要在测试脚本中默认执行生产部署。

### 19.4 已按 v1.0 开发时的增量顺序

先记录当前提交和已完成 M 阶段，不重置已有 TASKS。建立 v1.1 差异清单：新增策略/试听数据、免费旧曲回填、会员只读适配、媒体守卫、播放器 variant、后台访问策略、会员说明、统计和专项测试。

先部署能读取新字段但保持功能关闭的兼容代码，再执行追加迁移；迁移时既有公开作品保持 free。只有确认旧音频入口也经过新守卫后，才允许管理员首次发布 vip/early_access。不能先发布VIP元数据再等待媒体权限修补。

未受保护的 v1.0 代码不能用于包含VIP数据的生产回滚。必须预留一个懂得新策略的安全回退版本，或先从入口完全关闭音乐媒体访问后回退，详见第20.4节。

## 20. 发布、监控与回滚

### 20.1 配置与开关

拟新增运行时开关如下，后台只读检查始终需完整鉴权：

| 开关 | 默认 | 行为 |
| :--- | :--- | :--- |
| `MUSIC_PUBLIC_ENABLED` | false | 控制公开目录/详情/媒体总入口 |
| `MUSIC_UPLOADS_ENABLED` | false | 控制后台新上传 |
| `MUSIC_VIP_DELIVERY_ENABLED` | false | 控制VIP受保护完整播放；关闭返回503，不能变成免费 |
| `MUSIC_ANALYTICS_ENABLED` | false | 控制可选统计；还须满足相应隐私条件 |

`MUSIC_VIP_DELIVERY_ENABLED` 不改变原站会员资格或价格；仅免费试运行时不宣传尚未开放的VIP音乐交付能力。功能关闭优先于任何缓存或资格成功分支。

前台导航入口在正式启用音乐时随站点发布加入。测试阶段直接访问受控预发 URL，避免导航提前暴露尚未配置的功能。

生产变量、数据库 ID、桶名、Access 配置和管理密钥不写入公共前端配置。复用原后台身份范围，不在音乐代码中硬编码某个管理员邮箱。

### 20.2 上线顺序

先完成独立预发资源与本地迁移验证，再部署默认关闭的音乐功能。验证后台、完整/试听上传、发布与下架，以及free、vip、early_access三种类型。正式作品须经人工确认；测试夹具只留在隔离环境。

执行全站回归和真机测试，检查原有路由、支付、游戏及后台均正常。备份当前音乐数据库与资源清单，确认可回滚版本和关闭开关的方法。

全站VIP映射与退款依赖有结论，媒体私有/范围/到期/缓存测试通过，并核对现有会员中心金额和售卖说明不变后，由站点所有者确认启用公开及VIP交付开关、发布导航入口。最初只放少量已核对作品，确认真实请求和错误表现后再增加内容；不设虚构的并发目标和播放量。

### 20.3 监控

至少关注目录与音频请求的 5xx/401/403/404/410/416 比例、资格查询错误与延迟、试听超限验证失败、首播失败原因、上传失败、发布失败、R2 操作量、D1 读取写入量、资源配额和后台鉴权异常。

将正常的无VIP 403、下架410、资格服务故障503与程序错误区分，不能将一切非 200 都当成系统事故。日志只记录诊断所需的资源 ID、状态和请求关联信息。

前端错误上报及第16节事件按各自开关和隐私依据启用，不上传完整历史。未部署的指标明确不可用；管理员问题反馈和服务错误监控仍应提供，不虚构实时看板。

### 20.4 回滚

出现大面积VIP故障时可先关闭VIP交付开关并停止音乐促购，保持免费作品与试听可用。必要时关闭音乐总入口，保留主站会员管理、取消/退款及受保护后台。回退 Worker 与静态页面时保持已新增数据兼容，禁止在代码回滚脚本中删除数据库表或批量清空 R2。

版本变更采用追加迁移。破坏性清理需要单独维护步骤、备份和明确授权，不能夹带在普通音乐页面发布中。

一旦有VIP曲发布，禁止直接部署不认识访问策略的旧v1.0媒体处理器。安全回退必须继续执行新权限守卫；若该版本不可用，先在不会随回退代码失效的受控入口完全阻断 `/api/music/*` 音乐服务，再回退，不能指望旧代码读取新开关。恢复前重新验证权限，不能用删除VIP字段恢复兼容。

验收需要演练：关闭VIP交付后完整请求503且试听正常；关闭总入口后所有新音乐请求失败且原站正常；回退期间VIP资源不公开、会员账本不变、文件不丢失。已购会员的服务中断说明与补偿按站点既有政策处理，代码不擅自退款或扣除有效期。

### 20.5 备份与保留

原始音频在站长本地保留独立副本。音乐数据库定期导出，资源清单与关键权利证据进行受控备份；备份位置和访问范围由站点所有者确认，不放在公开仓库。

清理任务先 dry-run 输出待删除对象及其无引用依据，再执行受限批次。音乐清理可以与现有调度入口组合，但不得覆盖原有 Signal 定时任务、队列或其错误处理。

## 21. 首发完成定义

首版完成必须同时满足以下条件：

| 领域 | 完成条件 |
| :--- | :--- |
| 内容 | 正式试运行至少有合法free和vip作品及有效试听；抢先流程用隔离fixture或真实已核对作品验收，不凑数 |
| 收听 | PC 和实际 iPhone 可点击播放、暂停、切曲与拖动 |
| 连续性 | 音乐页内部浏览、歌词与歌单切换不重建音频 |
| 管理 | 上传、草稿、预览、核对、发布、下架和歌单流程可用 |
| 权限 | 草稿/证据私有，VIP完整版逐请求鉴权，试听不含完整文件，管理写入完整校验 |
| 会员 | 既有有效全站VIP自动包含音乐，原价/周期/支付规则不变，到期/撤销有真实依据 |
| 访问策略 | free/vip/early_access及自然到期按服务端规则一致生效 |
| 转化 | 真实会员中心回跳并重新验证，不靠成功URL解锁，不重复购买 |
| 商业说明 | 个人站内欣赏范围、下载/商用不含、支持/退款说明清楚，不承诺未实现功能 |
| 统计 | 最小事件与去重可验证，隐私条件和开关明确，未可验证指标显示不可用 |
| 发布一致性 | 新草稿不影响旧发布版本，冲突和失败不造成部分发布 |
| 媒体协议 | 正确返回音频类型、Range、HEAD、长度和状态码 |
| 本地记录 | 收藏可迁移，位置区分版本与full/preview；到期不删除记录，存储失败仍可播放 |
| 分享 | 本站歌曲链接可打开对应作品，失效链接有正确提示 |
| 回归 | 原站主要功能、语言和后台无阻断性回归 |
| 运维 | 有实际备份、监控入口说明、回滚步骤和已知限制 |
| 文档 | 阶段和交接文件更新，未验证项明确列出 |

不能将页面截图漂亮、静态构建成功或单首歌在开发机上能播放，单独作为整体完成证明。

## 22. 可直接交给 Codex 的启动指令

将本开发文档放入仓库 `docs/music/DEVELOPMENT_SPEC.md`。配套启动指令单独放入 `docs/music/CODEX_START.md`，不要用启动指令文件覆盖完整规格。

```text
请在 xdgf558/caption-ai-landing-site 的当前工作分支中，
按照 docs/music/DEVELOPMENT_SPEC.md v1.1 开发 Station Cat Music。

先读取 AGENTS.md、原项目阶段文件、音乐当前阶段、package.json、
wrangler.toml、Worker、公共布局、后台鉴权、现有会员中心与支付说明。
先核对实际分支，不把文档里的历史代码快照当成当前生产状态。

如果尚未开工，先完成 M0，并在可验证范围内继续 M1。
如果已按 v1.0 开发，保留已有进度，建立 v1.1 差异清单，
按第19.4节增量实现。不要重置数据、重跑迁移或覆盖别的项目记忆。
本次不部署生产、不创建付费资源、不修改真实VIP价格或扣费规则。

必须遵守：
1. 原站Astro增量开发，单一HTMLAudioElement，保留其他业务。
2. 私有R2 Standard MUSIC_BUCKET和独立MUSIC_DB继续采用；不迁到VPS。
3. 免费精选免登录完整播放；VIP曲独立短试听；现有有效全站VIP完整播放。
4. 音乐并入原VIP，额外收费为零，不新增音乐月卡、自动续费或按次扣点。
5. 复用现有服务端账号与全站VIP，只读适配；不复制会员期限或支付账本。
   积分余额、作品级权限、客户端isVip、付款成功URL均不能授予音乐VIP。
6. M0核对真实全站范围、起止日期、多grant、终身、退款和资格撤销路径。
   未证实的生产配置列上线前置条件，不能猜测；开发用隔离fixtures继续。
7. 独立试听默认至多45秒，短曲按半长上限；服务端时长解析、源绑定和发布阻断。
   禁止完整音频先发给免费用户，再由JS倒计时暂停。
8. GET/HEAD/Range/条件请求共用当前发布与会员守卫；完整/试听物理隔离。
   VIP资格故障返回503，不能免费放开；免费曲和试听不依赖VIP服务成功。
9. 实现free/vip/early_access，默认7天抢先并明确结束后去向，服务器时间判定。
10. 队列过滤、试听结束停止、到期/登出/账号切换、歌词偏移、本地v1迁移都需测试。
11. 会员中心复用现有价格和流程；返回后只读核验资格，保持暂停，不再扣费。
12. 最小第一方统计独立开关，隐私条件满足后启用，不把试听或Range请求当完整收听。
13. 草稿/证据隔离、上传实际字节限制、幂等、并发guard、私有缓存均须测试。
14. 不新增全站ClientRouter，不承诺跨页不断播、下载、离线、商用授权或完全防复制。
15. 不改变原独立商品权益，不发布测试音频/假统计/未核对作品，不擅自改退款政策。
16. 上线过VIP曲后，禁止回滚到会公开完整音频的旧v1.0处理器。

维护 docs/music/PROJECT_CONTEXT.md、CURRENT_PHASE.md、TASKS.md、
DECISIONS.md、TEST_MATRIX.md、HANDOFF.md、OPERATIONS.md、
MEMBERSHIP_INTEGRATION.md、COMMERCIAL_RULES.md。

每阶段输出：任务编号、改动文件、实际测试命令与结果、未验证项、
迁移影响、现站回归、回滚边界、会员与退款映射证据、下一阶段输入。
没有实际执行的测试明确写“未运行”，不要将设计方案写成已上线能力。
```

## 23. 来源与核对记录

以下为文档使用的仓库读取和英文官方/技术来源。R1至R6及原技术来源来自v1.0的核对记录；v1.1于2026-09-09重新读取付款文档和会员配置片段，并复核Suno使用条款、R2计费/私有访问、D1、Creem商品与订阅资料。其他技术来源实施时继续复核。文中产品参数、阶段编号、页面布局、配额和验收阈值属于本项目设计，不能作为来源平台的既有规定引用。

### 23.1 已读取的用户网站仓库文件

| 编号 | 文件与用途 | 读取到的 blob SHA |
| :--- | :--- | :--- |
| R1 | `package.json`：框架声明、依赖和测试脚本 | `4865156e1c3829ed241c15de4829649f0f86fd21` |
| R2 | `wrangler.toml`：站点域名、Worker、D1/R2 绑定和路由 | `8f9069ec213d13cbbb70c581df275523f512c273` |
| R3 | `src/layouts/BaseLayout.astro`：布局、语言和 SEO | `572f016c5e41c8261508882fe586e1d62228fb90` |
| R4 | `src/styles/global.css` 第 1 至 100 行：已有色彩变量 | `3a5e9eb158c55773a14c8b8fce442c243762f31c` |
| R5 | `docs/admin-v2-media-upload-7h.md`：现有后台封面上传设计 | `d4be01bff366f6be8881a705c1174713a6ee5588` |
| R6 | `AGENTS.md`：原仓库工作约束 | `48ee247b099fede0f834c99b39339c7d905f0f6e` |
| R7 | `docs/creem-payments.md`：一次性Station Points、Webhook与已知退款限制 | `47d7df7bc2860bd82ea56174fad684f681d4ba16` |
| R8 | `src/worker.js` 第755至835行：会员积分成本和按月时长配置归一化，仅为部分代码 | `4f6f6741fdd283713bf3a20cec64aee01f20bc33` |

仓库位置：`https://github.com/xdgf558/caption-ai-landing-site`。本次没有完整审计Worker，没有读取生产控制台或会员名单；M0需要补做真实全站VIP、退款撤销和路由核对。较早的 `docs/novel-reader-credits-6a.md` 仍记载旧NOWPayments方案，其支付通道已被R7的Creem说明取代，不能将旧文档用作新音乐收款依据。

### 23.2 Suno 官方英文来源

**[S1] Suno Terms of Service。** 页面列明 2026-08-10 修订、2026-09-03 生效。本文仅摘述与站外文件使用、商业使用条件及来源有关的部分，具体作品仍须结合适用条款和凭证。

`https://suno.com/terms-of-service`

**[S2] What rights do I have with a paid subscription?** 帮助页更新于 2026-09-03，解释订阅期间下载的作品使用权和版权保护的区别。

`https://help.suno.com/en/articles/9601665`

**[S3] If I subscribe, do I get rights for the songs I made before subscribing?** 帮助页更新于 2025-12-17。免费期旧作品追溯授权的说明仍在线，不能忽略其与新页面概括表述的适用边界。

`https://help.suno.com/en/articles/2425729`

补充核对：Suno 官方下载政策更新，说明 2026-09-03 起的新下载安排。

`https://suno.com/blog/suno-updates-tos`

### 23.3 浏览器、Cloudflare 与无障碍来源

**[S4] MDN：HTMLMediaElement.play()。** 调用返回 Promise，可能被浏览器策略拒绝。

`https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play`

**[S5] MDN：Autoplay guide for media and Web Audio APIs。** 用于核对用户手势、自动播放限制和失败处理。

`https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay`

**[S6] MDN：Media Session API。** 用于系统媒体信息和控制的渐进增强，不构成后台保活保证。

`https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API`

**[S7] MDN：HTTP range requests。** 用于范围请求、条件读取、206、416 和相应响应头。

`https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests`

**[S8] Cloudflare R2 Workers API reference。** 用于私有桶读取、range、流式 body 和 HTTP 元数据。

`https://developers.cloudflare.com/r2/api/workers/workers-api-reference/`

**[S9] Cloudflare D1 Database API。** 用于参数绑定、batch 事务及会话一致性能力核对。

`https://developers.cloudflare.com/d1/worker-api/d1-database/`

**[S10] Cloudflare：Validate JWTs。** 用于应用侧验证 Cloudflare Access 身份。

`https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/`

**[S11] Cloudflare Workers Limits。** 实施时核对请求体、内存和运行时约束。

`https://developers.cloudflare.com/workers/platform/limits/`

**[S12] W3C：How to Meet WCAG 2.2。** 用于键盘、焦点、文本/控件对比度等无障碍核对。

`https://www.w3.org/WAI/WCAG22/quickref/`

**[S13] Cloudflare R2 Pricing。** 用于 Standard 存储、操作额度和出站费用说明，实际费用受整个账户和平台计费规则影响。

`https://developers.cloudflare.com/r2/pricing/`

**[S14] Cloudflare Workers Pricing。** 用于说明 Worker 等连接服务仍可能产生费用。

`https://developers.cloudflare.com/workers/platform/pricing/`

### 23.4 v1.1 商业整合补充来源

**[S15] Creem：Subscriptions。** 周期订阅与状态说明；用于未来扩展边界，不证明本站已开通自动续费。

`https://docs.creem.io/features/subscriptions/introduction`

**[S16] Creem：Account Reviews。** 音频属于支持商品示例；核对许可、产品说明、支持、取消及退款要求。

`https://docs.creem.io/merchant-of-record/account-reviews/account-reviews`

**[S17] Cloudflare R2：Public buckets；Use R2 from Workers。** 桶默认私有，公开域名与r2.dev分别控制；通过Worker绑定读取时由应用实现授权。

`https://developers.cloudflare.com/r2/buckets/public-buckets/`

`https://developers.cloudflare.com/r2/api/workers/workers-api-usage/`

**[S18] Creem：Webhooks。** 用于核对付款成功、计划取消、过期和付款失败事件的差异；实际站点资格仍以已验证的本地服务期及撤销规则为准。

`https://docs.creem.io/code/webhooks`

上述规则可能更新。工程默认45秒试听、7天抢先、免费比例、运营频率、统计保留期及是否推出新套餐均为本站产品决策，不冒充平台要求。

## 附录：文档变更记录

| 版本 | 日期 | 变更 |
| :--- | :--- | :--- |
| v1.0 | 2026-09-09 | 原始免费音乐栏目规格：现站集成、播放器、歌单、歌词、私有媒体、权利核对、后台、协议与阶段任务 |
| v1.1 | 2026-09-09 | 保留私有R2 Standard，音乐并入现有VIP且不改价；新增免费/VIP/抢先策略、独立试听与时长校验、会员只读适配、付款返回/到期/退款依赖、隐私统计、追加迁移、专项测试与安全回滚；同步启动指令 |

### 本次文档校对范围

完整保留并核对0至23节的实施链路，去除与新范围冲突的“全部免费”“无需会员鉴权”“付费收听留待以后”等要求。检查数据字段、音频variant、缓存、试听长度、会员访问、统计、阶段任务和完成定义相互一致。本文的检查属于文档静态核对，网站实际测试和生产验证尚未执行。
