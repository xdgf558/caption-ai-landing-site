# Station Cat 改版执行记录

本目录保存音乐与游戏改版的需求基线、仓库盘点和后续验收证据。产品定位是个人品牌推广，大部分音乐在各音乐平台发行，网站提供作品展示、推广内容和平台入口。

## 当前执行约定

用户于 2026-10-05 要求从第一个任务开始，每个任务完成后提交 GitHub PR，由用户审查通过后再进入下一个任务。T01、T02、T03 已审查通过并在各自当前提交 CI 通过后合并；本轮交付 **T04 视觉变量与导航组件**，审查通过后才进入 T05。

这项约定优先于基线文档中建议的 R0–R7 批次及启动指令中的连续推进方式；三份规范正文已按本次审查同步逐项执行要求。PR 创建、构建通过与生产发布是独立状态；本轮没有生产发布授权，待用户审查的 PR 不自动合并。

| 任务 | 状态 | 交付或进入条件 |
| --- | --- | --- |
| T01 仓库与运行方式盘点 | 审查通过，已合并 | [PR #186](https://github.com/xdgf558/caption-ai-landing-site/pull/186)，修订头 CI 通过，已补音乐后代路径与原生资料库范围 |
| T02 路由与业务依赖清单 | 审查通过，已合并 | [PR #187](https://github.com/xdgf558/caption-ai-landing-site/pull/187)，当前头 CI 通过；[说明](T02-route-and-service-inventory.md)、[逐地址 CSV](T02-route-inventory.csv) 作为源码依赖基线，实际 HTTP 留 T20 验证 |
| T03 权益、存档与素材核对 | 审查通过，已合并 | [PR #188](https://github.com/xdgf558/caption-ai-landing-site/pull/188)，审查头 CI 重跑通过，合并为 `b15b233`；[权限矩阵、存档格式与素材缺口](T03-entitlements-saves-and-materials.md)、[验证摘要](T03-evidence/verification-summary.json)、[内存存档核对工具](tools/audit-local-save-contract.mjs)；素材继续“稍后确定” |
| T04 视觉变量与导航组件 | 完成，待审查 | 用户新图“温柔小站”已取代模板 2，并确认五项导航；[代码接入、范围与验证](T04-visual-system-and-navigation.md)、[当前选择](T04-evidence/gentle-station/design-selection.json)、[当前设计 QA](T04-evidence/gentle-station/design-qa.md)，隔离预览 `npm run preview:redesign` |
| T05–T22 | 未开始 | 沿用任务清单中的依赖，每个任务单独提交、审查后继续 |

## 需求基线

以下三份 v1.1 Markdown 文档来自用户确认后的本地开发文档包。仓库副本在移除行尾空格后，依据本次审查同步了一任务一 PR 的执行顺序。产品范围没有改写，原始文档包未修改。

- [主开发文档](specs/Station_Cat_Website_Redesign_Development_v1.1.md)
- [22 项实施任务](specs/Station_Cat_Redesign_Implementation_Tasks_v1.1.md)
- [通用 Codex 启动指令](specs/Station_Cat_Redesign_Codex_Start_v1.1.md)

已确认的约束：有效试听按主文档的前台实际累计至少 10 秒或试听结束计算，同一 `playback_id` 一次；推广歌曲由既有后台的专门模块配置，游客试听随独立公开试听开关验收；新版开发完成并上线后关闭被替代的旧公开入口，同时保护账号、支付、历史权益和存档服务。

T04 原先用 UI 技能生成 3 个模板、选择第 2 张。用户于 2026-10-06 提供“温柔小站”新图并要求采用，随后确认首页、音乐、游戏、会员、关于五项导航；该指令取代旧模板与四入口建议，仓库规范已同步。当前按 `product-design:image-to-code` 与设计 QA 流程实现新图，原模板与证据保留为历史记录。视觉样例只用于本地隔离预览，图中《晚一点告白》与插画不作为实际主推、发行或游戏截图证据。

## 本轮代码基线

目标仓库为 [xdgf558/caption-ai-landing-site](https://github.com/xdgf558/caption-ai-landing-site)，独立本地检出从 `main` 的 `6cbb19725cd12ae718ea395711f920adef346824` 开始。T01 分支为 `codex/station-cat-redesign-t01`，修订提交 `020e970f7376601e8c6708562e3143f79f056d35` 是 T02 的盘点基线；T02 工作分支为 `codex/station-cat-redesign-t02`。已有其他本地检出没有修改。

T01 至 T03 修改文档、核对工具与证据。T01 当前头 CI 通过后合并为 `eef728d`；T02 当前头 `877a331` 的 CI 通过后合并为 `dffc4c2`；T03 审查头 `d6d1638` 的 CI 重跑全部通过后合并为 `b15b233`。T04 分支为 `codex/station-cat-redesign-t04`，以已合并 T03 的 `main` 为基线，新增尚未接入生产页面的视觉布局与导航、隔离夹具和 CI 编译检查；没有修改 API、数据库迁移、生产配置、付费规则或游戏运行文件。

T03 已记录当前游戏启动流程在合成内存中覆盖损坏 JSON 的行为。T12 必须使用可区分缺失、损坏、不支持版本和不可访问存储的只读检测，并保护恢复衔接，不能把现有自动新建函数当作“继续游戏”检查。该发现不影响 T03 核对交付，但 A13 尚未完成。
