# Station Cat Music iPhone 页面 — 第三方案 Design QA

Date: 2026-10-16 (Asia/Singapore)

source visual truth: `docs/station-cat-redesign/iphone-app-evidence/selected-option-3.png`

implementation: `http://127.0.0.1:4240/music/iphone/`

implementation screenshot: `docs/station-cat-redesign/iphone-app-evidence/desktop-final.jpg`

## 比较条件与证据

源图 1122 × 1402 px；实现视口为 1122 × 1402 CSS px，截图也是 1122 × 1402 px（有效采样密度 1:1）。全图比较使用原始尺寸，无拉伸。双方都是繁体中文、浅色网页、未登录、iPhone App 分页选中、安装说明展开。真实 App 截图内部为简体中文，以真实产品为准。

- 全图同输入并排比较：`docs/station-cat-redesign/iphone-app-evidence/comparison-final.jpg`，左为第三方案原图，右为浏览器截图。
- 字体、标题、说明和主要操作的同输入局部比较：`docs/station-cat-redesign/iphone-app-evidence/comparison-actions.jpg`；两侧按各自内容位置裁取 610 × 500 px，没有缩放。
- 手机繁中：`docs/station-cat-redesign/iphone-app-evidence/mobile-zh.jpg`，390 × 844 CSS px 视口，390 × 2205 px 全页。
- 手机英文：`docs/station-cat-redesign/iphone-app-evidence/mobile-en.jpg`，390 × 844 CSS px 视口，390 × 2298 px 全页。
- 平板日文：`docs/station-cat-redesign/iphone-app-evidence/tablet-ja.jpg`，834 × 1112 CSS px 视口，834 × 1479 px 全页。
- 手机全页截图中的底部导航固定在截图时的视口底部，这是已有全站导航；实际滚动时保持固定，全页截图不是静态页面布局。

## 比较历史

第一轮：`docs/station-cat-redesign/iphone-app-evidence/comparison-initial.jpg`，结果 blocked。

- [P2，已修复] 主按钮继承通用按钮的 13px 字号，视觉主次不足。为 `.station-gentle .sc-iphone-join` 明确 21px 字号与 58px 高度，手机使用 17px；最终局部比较确认主按钮足够醒目。
- [P2，已修复] 标题偏小、简介断行为三行，改变首屏密度。桌面标题上限调至 78px，中文简介设置语义换行，保持两行；最终全图和局部比较确认层级、换行与方案接近。
- [P2，已修复] 主区域起点偏低、安装链接另占一行，造成安装说明后移。调整顶部与 hero 留白，桌面 TestFlight 链接与步骤标题同排；窄屏保持自然换行，834px 日文截图确认无重叠。

第二轮：修复后以相同桌面视口重新截图，与实际源图一起进行全图及局部比较；没有遗留可确认的 P0/P1/P2。

## 五项保真检查

**字体与排版：**沿用站点现有系统无衬线/CJK 字体，源图是生成式概念图，不假定它使用可识别的字库。主标题保持粗重两行，App 名称、简介、主要操作、安装说明形成相同顺序的层级。局部比较没有截断、字形压缩或按钮文字拥挤。英文和日文使用各自的换行与字号规则，没有强制中文行宽。

**间距与布局：**保留左侧介绍和安装说明、右侧 App 展示、底部返回音乐的结构。右侧真实截图与左侧顶部对齐；细分隔线、圆角和轻阴影对应原方案。手机改为单列，公测按钮在首屏可见，安装锚点可直接到达步骤；390px 和 834px 的文档宽度都等于视口，无水平溢出。

**颜色与 tokens：**使用现有浅色背景、深蓝正文、紫色链接和浅紫步骤标记。主按钮深色、文字浅色，链接保留清晰焦点。原图背后的装饰色块省略，保留轻阴影，避免制作仿图形。

**图片与资产：**使用项目实际 App 图标和真实产品截图。按比例缩至 WebP，图标 6,912 字节，截图 85,220 字节；OS 状态栏由展示区域裁切，App 内部没有重画。真实截图的字形、内部空间和背景细节与概念图不同，属于产品真实性所需的差异。全页 logo 沿用现有资源，箭头和地球来自现有 Lucide 图标库。所有图片加载成功，没有压缩损坏或拉伸。

**文案与内容：**页面聚焦发现、收藏、外部平台收听，以及两步安装。公测 URL、App 名称、四种支持语言、无需 Station Cat 账号均与 Apple 公共邀请页核对。没有虚构下载量、测试人数、离线下载或完整播放能力。

## 有意差异

页面作为独立下载介绍，不请求音乐数据库。底部保留“返回全部作品”，不复制概念图中的实时主推歌曲卡片，避免下载说明依赖歌曲查询或硬编码生产作品。页头、页脚和手机底部导航沿用当前站点，因此与生成图中的装饰文案略有不同。以上差异保持第三方案的主体构图和用户明确要求的独立子页面。

## 功能与可访问性检查

- 音乐页 iPhone App 入口可进入独立页；返回作品链接可回到音乐页。
- 安装步骤锚点点击后到达 `#install`，标题在可见区域。
- 语言菜单真实点击后保留 `/music/iphone/` 子路径，英文、日文页面正确切换；四语路由也经过原 Worker 回归。
- 主 CTA 是指向真实 TestFlight 邀请的外链；实际邀请页面确认是 Station Cat Music。没有接受邀请、安装 App 或修改测试群组。
- Tab 可从主操作移至安装链接；焦点显示 3px 深色轮廓。所有链接是原生语义控件，截图有说明性 alt。
- 浏览器 error 日志为空。
- 71/71 相关回归通过，22/22 staging 测试通过；首发候选构建通过，staging 包 8 个页面、39 个精确资源生成与检查通过。

## Findings / Follow-up polish

没有剩余 P0/P1/P2。P3：有序步骤的 CSS 计数在当前 AX 导出中可能重复呈现数字；视觉显示正常，原生列表和步骤标题仍可理解。后续真机 VoiceOver 验收可细化计数器的朗读方式。

没有真机安装、Safari 或 VoiceOver 验收。移动端为浏览器视口检查，不声称已完成设备级测试。尚未部署或改动生产数据。

## Implementation checklist

- [x] 第三方案原图与最终实现同输入全图、局部核对。
- [x] 修复两轮之间发现的全部 P2 差异。
- [x] 桌面、手机、平板及较长翻译排版验证。
- [x] 公测、安装、音乐入口、返回导航和语言切换核对。
- [x] 构建、路由与隔离资源检查通过。

final result: passed
