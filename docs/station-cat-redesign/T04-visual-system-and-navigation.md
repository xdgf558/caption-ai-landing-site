# T04 温柔小站视觉系统与五项导航

当前依据是用户于 **2026-10-06** 提供的 [《Station Cat 温柔小站首页.png》](T04-evidence/gentle-station/source.png)。用户明确要求采用新设计，随后确认 **“采用新图的五项导航（会员沿用现有账号入口）”**。这两项指令取代原模板 2 与四入口建议，三份仓库规范已同步；原模板、选择和验证文件保留为历史证据，不能用它们证明当前界面通过。

本项在 [PR #189](https://github.com/xdgf558/caption-ai-landing-site/pull/189) 内更新，以已合并 T03 的 `b15b2337b7323eb100ac90ed13ca09389bcecbc4` 为基线。仍是一任务一 PR，等待用户审查；T05–T22 未开始，没有生产部署或旧入口关闭。

## 当前实现

[gentle.css](../../src/redesign/gentle.css) 用 `.station-gentle` 隔离新视觉变量：浅白 `#fcfbff`、深蓝文字 `#171c38`、次要文字 `#58628b`、紫蓝操作 `#333b84`、音乐粉 `#a1317b`、游戏蓝 `#09618a`，配粉色、浅蓝、淡紫卡片，圆角卡片与胶囊按钮。内容上限 1296px，站点宽度上限 1356px，间距以 4/8/12/16/24/32/48px 为基准，主要操作目标至少 44px。

标题改用粗无衬线字，首屏中文 39px / 900；字体栈按 Noto Sans TC/SC 与系统 CJK 字体回退，品牌手写副标采用系统楷体回退。没有依赖字集不完整的旧标题子集或外站字体加载，实际字形以设备字体为准。[Noto 官方使用说明](https://github.com/notofonts/noto-docs/blob/main/docs/website/use.md) 作为字体风格核对来源；本机观测不代表跨平台字体完全一致。

[BrandNavigation.astro](../../src/components/redesign/BrandNavigation.astro) 提供 **首页、音乐、游戏、会员、关于**。桌面导航居中，右侧为搜索、语言和进入小站；小于 768px 使用五项手机底栏，顶部保留品牌、搜索和语言。当前入口有可见标识与 `aria-current`。四语言菜单保留完整可读名称、键盘操作、Escape 关闭与焦点返回。

搜索弹窗只筛选这五个站点入口，包含输入、结果、空态、关闭和焦点返回，不宣称完成 T08 的曲目目录搜索。原生 search 输入会先消费 Escape 清空内容，已在捕获阶段处理，确保一次 Escape 关闭并返回搜索按钮；[实际交互记录](T04-evidence/gentle-station/interaction-observations.json) 保留修复前失败和修复后通过。

[routes.js](../../src/redesign/routes.js) 保留现有四语言首页/音乐规则。会员接到已有 `/zh-hant/library/`、`/zh-hans/library/`、`/en/library/`、`/ja/library/`，`my` 作为链接兼容别名；不新建账号或权益体系。关于复用真实存在的 **`/about/`**，目前只有繁中生产页，语言切换不假造其他生产版本。本地关于样例同样使用繁中。正式接入前须更新它的品牌内容，并在 T20 地址计划中覆盖原清单对旧关于内容的退役提案：新版关于保留该地址，旧小说/工具介绍不能继续作为新版内容。T02 的 CSV 保留当时源码与构建盘点，不把这次选择改写成 HTTP 验收。

音乐语言切换继续保留单个有效 `track`、`collection`，移除其他参数；未来单曲 ASCII slug 保持实体。旧命名空间匹配器、别名、重定向和 AASA 未修改。游戏目录仍为未来 `/games/`，实际运行地址 **`/games/cat-life/`** 保持不变；未来介绍 `/games/cat-life-game/` 不占用运行目录。

[StationBrandLayout.astro](../../src/layouts/StationBrandLayout.astro) 提供品牌页脚、五项入口、现有政策/联系地址、可选 player 插槽和 gameRuntime 开关。默认无选中媒体时隐藏整个 dock。游戏布局隐藏所有站点控件，但实际暂停、启动失败恢复、退出衔接仍留 T13。

[chrome.js](../../src/redesign/chrome.js) 继续用实际尺寸计算底栏与占位，正文末尾预留 `导航主体 + player 高度 + 安全区域 + 24px`，dock 位于底栏上方。它仅处理几何与监听清理，不读存储、不控制音频或存档。

## 新图素材与首页样例

[GentleStationFixture.astro](../../scripts/fixtures/station-redesign/site/components/GentleStationFixture.astro) 按新图展示夜色猫咪首屏、并排音乐/游戏卡片、推广说明、三张动态卡片和页脚；手机与平板文字/插画分排，卡片纵向排列，避免正文落入插画深色区域。

用户只提供一张合成设计图，没有独立原始插画。用内置 image_gen 按图重建 hero、音乐封面、游戏封面、日常缩略图与透明猫头标志，未用 CSS 绘画、emoji 或自绘 SVG 代替。原图与重建图的笔触、局部文字和构图存在小幅差异，不能宣称逐像素提取。资源路径、完整提示词与处理信息见 [素材记录](T04-evidence/gentle-station/asset-prompts.md)、[导出记录](T04-evidence/gentle-station/asset-processing.json)。四张插画只在夹具中使用，WebP 总资源（含标志）约 1.18MB；标志提供透明 128px 派生图。

实心音乐、游戏、耳机、爪印等采用 [Phosphor 官方图标](https://github.com/phosphor-icons/core/tree/2b75f3ad12b420c9504ef05df8d2564a28f8500e/assets/fill)，固定版本与 MIT 许可随文件保存；箭头、搜索、心形等复用已有 Lucide。网易云/汽水待配置按钮采用普通音乐/耳机符号，不伪造平台商标。

《晚一点告白》沿用新图作为 **设计示例**，不是替用户选定主推；T03 的《原来已经这么远》仍只保留其公开目录回退候选记录。主推、外部链接、试听开关和视频仍是用户答复的 **“稍后确定”**。样例将发行/主打徽章改为示例标记，未配置平台按钮显示待配置并禁用，试听按钮禁用且有可读说明；没有音频或视频。T05 正式页面须按真实配置隐藏不可用试听，不能把这里的示例按钮当成已开启试听。

愿望清单只展示本次页面内可撤销的选中状态，刷新清空，并明确未同步账号；不写入网页本地键，不接原生资料库或服务器。动态文案、封面与游戏插画不作为真实发布记录、实际游戏截图或存档验收证据。页脚仅沿用真实已有 X 链接，其他未配置社交入口禁用；没有代填推广平台 URL。图中 `stationcat.co` 和 2024 年是视觉内容，站点域名仍是 `https://wwwstationcat.org`。

## 隔离运行与现网边界

运行 `npm run preview:redesign`，打开 **http://127.0.0.1:4204/**。单独 Astro 构建输出 `.generated/station-redesign-preview`；loopback 服务器仅允许自身 Host、GET/HEAD 和固定图片白名单，不加载 Worker、凭证、账号、数据库、存档或媒体服务。

40 个夹具地址只验证导航和语言规则，复用同一视觉样例，不是正式目录、账号、政策或关于页面业务实现。底部折叠检查区、测量 dock 和 34px 安全区域开关只属于夹具。原有 Header、BaseLayout、生产页面与服务未接入本项 shell。正常输出可复制新品牌图片，但没有新 shell、夹具插画或调试控件。

## 实际验证

| 核对 | 本轮结果与证据 |
| --- | --- |
| 链接合同 | `npm run test:redesign:routes` **7/7**；四语言、五项入口、账号/关于复用、安全查询、未来实体、游戏运行地址和政策；[日志](T04-evidence/gentle-station/route-tests.txt) |
| 隔离编译 | `npm run build:redesign:preview` **40 页**；[日志](T04-evidence/gentle-station/preview-build.txt) |
| 正常构建 | `ALLOW_EMPTY_SERIAL_CONTENT=1 ASTRO_TELEMETRY_DISABLED=1 npm run build` **153 页、111 sitemap 项**，原有构建检查通过；[日志](T04-evidence/gentle-station/main-build.txt)。空正文构建不作为生产包或部署证明 |
| 构建隔离 | 扫描 271 个 HTML/JS/CSS 文件，夹具标记匹配为 0；[结果](T04-evidence/gentle-station/build-isolation.json) |
| 五个宽度 | 375/390/768/1280/1440px 无横向溢出；手机底栏五个目标高度 51px，主 CTA 44px；[初次尺寸](T04-evidence/gentle-station/responsive-observations.json)，768px 最终以 [平板记录](T04-evidence/gentle-station/tablet-final-observations.json) 为准 |
| 四语言 | 四语言 375/768px 检查，手机均无溢出；修复孤立换行后，[手机记录](T04-evidence/gentle-station/locale-final-observations.json) 与 [平板最终记录](T04-evidence/gentle-station/tablet-final-observations.json)；平板正文和插画矩形不重叠 |
| 实际交互 | 五入口逐一点击选中；会员进入既有资料库，关于进入繁中 /about/；搜索结果/空态/关闭，愿望状态/刷新清空，skip link、Escape 返回，语言点击保留公共歌曲/歌单参数；[记录](T04-evidence/gentle-station/interaction-observations.json) |
| 底部叠放 | 390×844，导航主体 64px + 增高占位 125px + 模拟安全 34px + 24px = **247px**；占位底边/导航顶边均 746px，末端操作底边 573.14px < 占位顶边 621px；[记录](T04-evidence/gentle-station/stack-runtime-observations.json) |
| 游戏布局模拟 | 可见站点控件 0、底部预留 0；恢复后导航可见，关闭占位返回触发按钮；只验证 shell，不证明实际游戏衔接 |
| 静音/控制台 | audio/video 数量 0、默认 dock 隐藏，所检查标签 error/warn 为 0；[记录](T04-evidence/gentle-station/console-observations.json) |
| 视觉 QA | 新图与最新实现放在同一输入中，同宽全页及导航/首屏/卡片/动态局部对照；修复导航、字重、密度、日常插画、换行、搜索 Escape 和平板可读性后通过；[报告](T04-evidence/gentle-station/design-qa.md)、[并排](T04-evidence/gentle-station/comparison-final.jpg) |

桌面源内容为 1356×996px；内置浏览器 CSS 视口 1371×996px、DPR 1，实际内容宽 1356px，滚动条 15px，页脚底边 997.77px。比较排除了源浏览器框与夹具检查区；没有把额外 15px 当成布局溢出。截图是本机内置浏览器视口模拟，非实体手机、实际读屏、生产云服务或 HTTP 验收。完整长截图中的固定导航留在初始视口位置，判断遮挡采用独立 viewport 截图和几何记录。

当前 [桌面截图](T04-evidence/gentle-station/desktop-review.jpg)、[手机首屏](T04-evidence/gentle-station/mobile-home-390.jpg)、[叠放截图](T04-evidence/gentle-station/mobile-stacked-390.jpg) 与 [文件校验清单](T04-evidence/gentle-station/evidence-manifest.json) 可独立审阅。CI 保留既有检查与超时设置，并执行本项路由测试和隔离编译；远程当前提交的状态以 PR Checks 为准，本地通过不替代远程状态。

## 后续依赖

A01/A16/A22 本项仅验证样例静音、组件几何、可读名称和键盘路径，不能标记整个首页、真实播放器或全部无障碍已验收。实际推广配置/空态留 T05–T07，音乐功能留 T08–T11，游戏目录/损坏槽位只读识别与防覆盖留 T12，媒体衔接留 T13，会员/历史服务回归留 T14。网页 stationcat.music.v2 与原生 /api/mobile/v1/me/music/* 仍独立。750000 字节云存档上限、历史购买不授予音乐 VIP 和 T03 损坏 JSON 覆盖风险继续有效。

T04 审查通过后再进入 T05。回退本项可还原该 PR 的 opt-in 布局与夹具；现网未切换，账号、支付与存档无需业务回滚。旧公开入口只在新版完成并上线后的授权范围内处理。
