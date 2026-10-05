# T04 视觉变量与导航组件

用户在三张 UI 模板的选择问答中明确回复 **“2”**。本项采用第 2 张的米白纸面、深色衬线标题、墨绿操作与书页式留白，实现可复用布局、四入口导航和底部空间计算，并提供隔离的 Astro 预览。首页配置、推广内容读取、实际播放器、游戏目录及“我的”功能分别继续属于后续任务。

T03 已由用户审查通过，原审查头 `d6d163889e596cda0e95f3e835ffd12a9459b76a` 的 [CI 重跑 attempt 2](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37319304002/attempts/2) 全部通过后，[PR #188](https://github.com/xdgf558/caption-ai-landing-site/pull/188) 于 2026-10-05 14:59:02 UTC 合并为 `b15b2337b7323eb100ac90ed13ca09389bcecbc4`。T04 以该 `main` 为基线单独提交，等待用户审查，不连续进入 T05。

## 选择与素材证据

设计阶段直接使用 `product-design:index`、`product-design:ideate`，分别生成三张图片；选择后使用 `product-design:image-to-code` 与设计 QA 流程。三个方案及选定记录都保存在仓库中：[模板 1](T04-evidence/template-1.png)、[选中的模板 2](T04-evidence/template-2-selected.png)、[模板 3](T04-evidence/template-3.png)、[选择记录](T04-evidence/template-selection.json)。

金色坐猫标志沿用 `public/images/home-night/cat-mark.webp`。预览音乐图片来自 T03 核对过的公开候选封面；游戏图片复用 T03 的本地夹具截图。两张图片均为真实来源的静态展示，未用 CSS 绘画、emoji 或自绘 SVG 代替。导航及箭头沿用项目已有 `@lucide/astro`，细线图标与所选方案相符。

《原来已经这么远》仍只作为视觉核对的候选素材。用户先前答复的主推歌曲、平台入口、试听开关和视频 **“稍后确定”** 继续有效；本项没有生成或修改运营配置。夹具没有音频、视频、播放按钮或平台外链。“平台发行信息待更新”不能推断歌曲尚未在外部平台发行。

## 代码与接入约定

[journal.css](../../src/redesign/journal.css) 把现有纸面、墨色和墨绿调色板整理为 `--sc-*` 变量，作用域限于 `.station-journal`。显示文字采用 Times New Roman / Georgia，中文采用 Songti 系统字体回退；正文采用系统无衬线字体。没有把字集不完整的游戏标题子集字体用于所有文本。字体与字形的本次截图验证限于本机浏览器，跨平台字形和真机结果留待后续设备验证。

核心颜色为纸面 `#fffaf4`、墨色 `#1f2d29`、次要文字 `#64736d`、操作 `#08796d`、悬停 `#075e55`；选中导航的陶红加深为 `#b9412d`，保持可读对比度。间距以 4 / 8 / 12 / 16 / 24 / 32 / 48px 为基准，正文内容上限 1120px，手机操作目标至少 44px。所选模板的矩形按钮与细分隔线优先于早期规范里的圆角参考。

[BrandNavigation.astro](../../src/components/redesign/BrandNavigation.astro) 提供首页、音乐、游戏、我的四个入口。桌面采用顶部文字导航；小于 768px 时采用底部图标与文字，顶部保留品牌和语言菜单。当前入口具有可见选中状态和 `aria-current`。语言选项有完整的读屏名称，原生 disclosure 支持键盘打开，Escape 关闭后焦点返回触发器。

[routes.js](../../src/redesign/routes.js) 为该布局提供统一链接规则，保留现有繁中根首页与音乐根页、简中/英文/日文前缀，以及四种语言已有的 `/library/` 账号入口。新的游戏目录链接为 `/{locale}/games/`；目录尚属 T12，本项只在夹具中提供这些地址。原生资料库仍是独立 `/api/mobile/v1/me/music/*`，本项没有把网页入口或本机收藏当作原生同步能力。

语言切换保留音乐根页的单个有效 `track` 与 `collection`，移除其余参数；预留单曲 ASCII slug 路径可保持对应实体。音乐命名空间匹配器、语言别名和现有无斜线重定向没有修改。旧后代地址的实体映射仍须由 T08/T20 完成，本函数不是 HTTP 迁移处理器，也没有扩充 AASA。

游戏运行地址 `/games/cat-life/` 保持原地址；语言链接不会另造带语言前缀的运行目录。未来介绍路径 `/games/cat-life-game/` 与运行地址分开。本项未修改游戏运行文件、存档模块或启动链。

[StationBrandLayout.astro](../../src/layouts/StationBrandLayout.astro) 提供正文、法律与联系页脚、可选 `player` 插槽，以及 `gameRuntime` 布局开关。默认 `playerSelected=false`，未选中曲目时整个占位容器隐藏；T09 接入真实播放器时须同步外层 `data-sc-player-dock` 的 `hidden` 状态。游戏布局隐藏所有 `data-station-chrome` 控件，包括导航和播放器，但真实媒体暂停、启动失败恢复与退出游戏衔接仍属于 T13。

[chrome.js](../../src/redesign/chrome.js) 用 ResizeObserver 测量底部导航与播放器外层的实际高度，安全区域单独计算。正文末尾统一预留 `导航高度 + 播放器高度 + 安全区域 + 24px`，播放器位于导航和安全区域之上。字体、文字换行、窗口尺寸与占位显隐变化后重新计算，并提供监听清理；不访问任何存储或媒体状态。

## 隔离预览与现网边界

运行 `npm run preview:redesign`，打开 `http://127.0.0.1:4204/zh-hans/`。构建图位于 `scripts/fixtures/station-redesign`，输出仅到 `.generated/station-redesign-preview`。服务器只监听 loopback，限制 GET/HEAD，图片只按固定白名单读取，不加载 Worker、凭证、账号、数据库、音频或存档。

39 个夹具地址用于检验语言链接和导航选中状态，内容复用同一个视觉样例；它们不是正式首页、音乐目录、游戏介绍、账号或政策页面的业务实现。底部“本地预览检查”折叠区及“底部占位测量”只属于夹具，不进入生产构建。占位不是试听播放器；34px 安全区域开关是人工模拟，不是真机测量。

现有 `Header`、`HomeHeader`、`BaseLayout` 与所有生产页面保持原有接入。本项新增布局尚未被任何生产页面使用，正常站点构建没有夹具资源或测试控件。账号、支付、会员、历史权益、网页/原生收藏、游戏运行、D1/R2 配置、AASA 和旧 URL 清单未改变；没有发布或关闭旧入口。

## 已执行验证

| 核对项 | 实际结果与证据 |
| --- | --- |
| 链接规则 | `npm run test:redesign:routes` 6/6，通过四语言 URL、音乐安全查询、未来实体路径、运行地址保护、选中状态及法律链接；[原始日志](T04-evidence/route-tests.txt) |
| 夹具编译 | `npm run build:redesign:preview` 成功，39 个静态样例；[原始日志](T04-evidence/preview-build.txt) |
| 正常构建 | `ALLOW_EMPTY_SERIAL_CONTENT=1 ASTRO_TELEMETRY_DISABLED=1 npm run build` 成功，153 页、111 个 sitemap 条目，原有构建核对通过；[原始日志](T04-evidence/main-build.txt)。空正文构建不作为生产包或部署证据 |
| 五个宽度 | 375、390、768、1280、1440px 本地浏览器检查均无横向溢出；手机导航目标高度 51px；[观测 JSON](T04-evidence/responsive-observations.json) |
| 四种语言 | 每种语言均在 375 / 768px 检查，按钮保持单行，导航和语言链接正确；[观测 JSON](T04-evidence/locale-observations.json) |
| 底部叠放 | 390×844px 视口，导航主体 64px、增高占位实测 125px、模拟安全区域 34px，正文预留 247px；占位底边等于导航顶边，最后一个操作在占位上方；[观测 JSON](T04-evidence/stack-and-runtime-observations.json)、[截图](T04-evidence/mobile-stacked-390.jpg) |
| 游戏布局开关 | 模拟游戏布局后网站控件可见数为 0，正文底部预留为 0；恢复布局后导航恢复；不代表实际游戏媒体衔接通过 |
| 键盘 | 首个 Tab 到跳转正文链接，Enter 后正文获得焦点；语言菜单 Escape 关闭并返回触发器；收起占位后返回检查按钮；[观测 JSON](T04-evidence/keyboard-observations.json) |
| 分享与入口 | 实际点击语言链接保留歌曲/歌单安全标识，四个手机入口选中状态正确；[语言切换](T04-evidence/language-switch-observations.json)、[导航及控制台](T04-evidence/navigation-and-console-observations.json) |
| 初次静音 | 夹具默认占位隐藏，`audio/video` 数量为 0；所检查页面浏览器 error/warn 为 0。真实推广试听须由后续任务另验 |
| 构建隔离 | 正常输出没有 `preview-assets/`、夹具操作或本项 opt-in shell；[核对 JSON](T04-evidence/build-isolation.json) |
| 设计对照 | 保存全页、导航与文字区域的并排对照；修复字体混用、平板按钮折行和标题比例后复验；[QA 报告](T04-evidence/design-qa.md) |

本机 Node 为 24.15.0。日志保存原始输出内容，只移除行尾空白。截图来自 Codex 内置浏览器，视口模拟不等于实体手机，截图内容宽度可能排除浏览器滚动条。手机 full-page 截图中固定导航仍位于首次视口底部，这是长截图特性；判断遮挡使用独立视口截图和页末几何记录。

桌面结果：[最终截图](T04-evidence/desktop-final.jpg)、[原图/实现并排](T04-evidence/comparison-final.jpg)。手机结果：[首屏](T04-evidence/mobile-home-390.jpg)、[底部叠放](T04-evidence/mobile-stacked-390.jpg)。平板修正结果：[768px](T04-evidence/locale-zh-Hans-768.jpg)。

CI 新增明确的链接测试与隔离预览编译步骤，保留原检查与超时设置。T04 的远程当前头检查状态由本 PR 的 Checks 栏记录；本地通过不能替代该状态。

## 验收与后续

A01 本项只确认样例导航与默认静音，正式首页公开内容留 T05。A16 的底部计算通过本地几何验证，真实播放器与歌词仍留 T08/T09。A22 已确认本项键盘操作、名称和焦点返回，完整音视频弹层与实际读屏/设备验收继续由 T11/T21 完成。本项没有把这些编号标成整个改版已验收通过。

T03 对损坏存档自动覆盖的记录继续有效；T12 必须先完成四类只读检查与恢复保护，不能用现有自动创建函数检测“继续游戏”。T04 审查通过后再进入 T05，素材待定时采用实际空态，所有生产发布和旧入口关闭仍遵循用户后续授权及 T20–T22 的先后顺序。
