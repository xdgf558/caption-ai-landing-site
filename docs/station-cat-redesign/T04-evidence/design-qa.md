> Historical evidence for superseded template 2. The current user-selected 温柔小站 source and QA are in [gentle-station/design-qa.md](gentle-station/design-qa.md). This report does not accept the revised UI.

# T04 所选模板设计 QA

**Findings**

本次 T04 范围内没有未解决的 P0 / P1 / P2。已分别修复不完整字体造成的字形混用、平板按钮折行和标题比例问题，并重新捕获当前实现与原图并排比较。此结果只评估视觉体系、导航与布局夹具；不表示 T05 首页业务、真实播放器或游戏启动链验收通过。

源图：`docs/station-cat-redesign/T04-evidence/template-2-selected.png`，1159×1358px，用户明确选择的第 2 张。实现：`http://127.0.0.1:4204/zh-hans/`，当前截图 `docs/station-cat-redesign/T04-evidence/desktop-final.jpg`，1174×1491px。CSS 视口 1174×900px，浏览器报告 devicePixelRatio=1。截图工具在其他捕获中可能排除滚动条，实际像素尺寸由 sharp 读取，不以视口尺寸代替。

状态：简中、米白主题、首页导航选中、默认占位隐藏、没有音视频、候选歌曲及真实游戏静态图片加载成功。夹具检查区默认折叠。

**Comparison evidence**

全页对照为 `docs/station-cat-redesign/T04-evidence/comparison-final.jpg`：源图在左，当前实现在右。实现先裁至 CSS 页脚底部 1383px，排除其下的开发检查区，再从 1174px 等比例归一至 1159px 宽（0.987223），得到 1159×1365px。源图与实现均按 1×像素比较，底部多出的 7px 按纸面背景补齐，不拉伸内容。

导航与大字排版需要能读清细节，另有同一归一尺寸下的并排区域：`comparison-navigation.jpg`（顶部 110px）与 `comparison-typography.jpg`（y=130–400px）。没有把分别打开的图片当作并排证据。

手机与平板属于所选桌面方案的响应式延展，没有独立手机源图，不能声称逐像素复刻手机设计。以 `mobile-home-390.jpg`、`mobile-stacked-390.jpg`、`locale-zh-Hans-768.jpg` 和观测 JSON 验证折行、控制位置、点击尺寸与正文预留。

**Required fidelity surfaces**

| 表面 | 检查结论 |
| --- | --- |
| 字体与层级 | Times New Roman / Georgia 的显示标题与 Songti 中文回退保持书页风格；正文为系统无衬线。初稿不完整的游戏字体已移除，汉字粗细统一；标题与按钮没有异常折行。系统字体的跨平台字形差异须在 T21 实机核对，本次仅确认本机渲染 |
| 间距与布局 | 品牌、左右首屏、封面/作品文字、游戏图文和细分隔线的顺序及主要比例保持源图。正文宽度上限 1120px；375 / 390 / 768 / 1280 / 1440px 无水平溢出。平板 CTA 与桌面游戏标题比例已修正 |
| 颜色与变量 | 米白、墨色、墨绿与暖金标志保持选定方向；沿用现有纸面/墨绿调色板，陶红选中状态加深以保证可读性。细线、低圆角矩形按钮和克制阴影一致；没有加入额外推广横幅或浮动装饰 |
| 图像 | 猫标志使用既有真实 raster，封面使用候选原图，游戏使用 T03 本地截图。加载、比例和清晰度正常；游戏截图保留原始内部 UI，没有复制造假的示意内容。生成源图里的照片与游戏画面有插值变化，实际原素材优先；未以 CSS/SVG 绘图代替 |
| 文案与状态 | 四种语言的品牌/导航/按钮文字明确。候选作品、缺平台信息与无试听状态真实；没有把素材待定写成未发行或把占位写成试听。开发检查文案只在独立夹具中，生产输出核对没有该内容 |

**Comparison history**

| 轮次 | 当时结果与修复 | 修复后的证据 |
| --- | --- | --- |
| 1 | blocked：[P2] 游戏字集字体混入普通文字，部分汉字粗细不同；显示标题过宽、首屏留白偏大。移除不完整字集，显示字体改为 Times New Roman，统一中文回退并缩短首屏下边距 | 初稿 `comparison-initial.jpg` / `desktop-initial.jpg`；修正 `comparison-revised.jpg` / `desktop-revised.jpg` |
| 2 | blocked：[P2] 768px 首屏按钮把“探索音乐”折成两行。按钮改为 nowrap，平板右栏从 170px 增至 200px | 初稿 `width-768.jpg`；修正 `locale-zh-Hans-768.jpg`，四语言在 375 / 768px 的按钮均为单行、49 / 52px 高，见 `locale-observations.json` |
| 3 | blocked：[P2] 桌面游戏标题比源图明显偏小。改为 4.6vw、最大 56px，当前视口实测 54.004px | 修正前 `desktop-before-game-title.jpg` / `comparison-before-game-title.jpg`；修正后 `desktop-final.jpg` / `comparison-final.jpg` |
| 4 | passed：重新比较全页、导航、大字区域与已修正的平板状态，没有 T04 范围内可操作的 P0 / P1 / P2 | 当前三张 `comparison-*.jpg` 以及独立手机视口截图 |

**Interactions and accessibility**

首个 Tab 聚焦跳转正文，Enter 后正文获得焦点；语言菜单键盘展开，Escape 后收起并返回 summary；收起占位后焦点回到检查按钮。语言链接有完整 aria-label，底部导航提供图标加文字与 aria-current；手机链接实测 51px 高。菜单选项原生 AX 输出的细节有限，完整屏幕阅读器验收仍需 T21，未将代码名称和一次 AX 观察等同于读屏通过。

四个手机入口已逐一点击，选中状态正确；实际语言切换保留有效 track / collection 并移除其他参数。浏览器记录中 error / warn 为 0。默认 audio / video 数量为 0。

底部叠放用 390×844px 视口检查：导航主体 64px、占位实测 125px、人工安全区域 34px，正文预留 247px；占位底边与导航顶边相接，页末目标位于占位上方。游戏布局开关隐藏网站控件，预留清零；真实游戏与媒体衔接没有在本夹具执行。

**Open Questions / Follow-up Polish**

[P3] 源图右侧叶片与小字为首页装饰，T04 的组件和隔离样例没有实现该插画；未用代码形状替代。是否保留装饰可在 T05 首页内容设计中决定。原始封面/游戏图与生成图的艺术化插值、法律页脚触控空间和字体的轻微差异属于明确的真实素材、无障碍与系统字体约束，不要求仿造生成图内的游戏 UI。

实体手机、其他浏览器、字体回退、完整读屏、真实播放器、持久播放和游戏暂停/恢复不在本次图像对照的覆盖范围。A01 / A16 / A22 只记录 T04 局部验证，尚未标成整站验收通过。

**Implementation Checklist**

- 所选模板、当前渲染和归一并排对照已保存。
- 字体混用、平板折行和标题比例问题已修复并复验。
- 五个宽度、四种语言、键盘、底部高度、游戏布局开关与控制台检查已记录。
- 夹具输出与生产构建隔离；T04 单独提交 PR，等待用户审查。

final result: passed
