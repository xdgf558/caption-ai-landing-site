# Station Cat 改版执行记录

本目录保存音乐与游戏改版的需求基线、仓库盘点和后续验收证据。产品定位是个人品牌推广，大部分音乐在各音乐平台发行，网站提供作品展示、推广内容和平台入口。

## 当前执行约定

用户于 2026-10-05 要求从第一个任务开始，每个任务完成后提交 GitHub PR，由用户审查通过后再进入下一个任务。T01 至 T05 已审查通过并在各自当前提交 CI 通过后合并；T06 的 `8ac1d499` 已获用户审查通过，但该头 CI 因缺失新增表的销户审计分类失败。本轮修订 **T06 的只读 schema 清单**，修订头复审及 CI 通过后才合并并进入 T07。

这项约定优先于基线文档中建议的 R0–R7 批次及启动指令中的连续推进方式；三份规范正文已按本次审查同步逐项执行要求。PR 创建、构建通过与生产发布是独立状态；本轮没有生产发布授权，待用户审查的 PR 不自动合并。

| 任务 | 状态 | 交付或进入条件 |
| --- | --- | --- |
| T01 仓库与运行方式盘点 | 审查通过，已合并 | [PR #186](https://github.com/xdgf558/caption-ai-landing-site/pull/186)，修订头 CI 通过，已补音乐后代路径与原生资料库范围 |
| T02 路由与业务依赖清单 | 审查通过，已合并 | [PR #187](https://github.com/xdgf558/caption-ai-landing-site/pull/187)，当前头 CI 通过；[说明](T02-route-and-service-inventory.md)、[逐地址 CSV](T02-route-inventory.csv) 作为源码依赖基线，实际 HTTP 留 T20 验证 |
| T03 权益、存档与素材核对 | 审查通过，已合并 | [PR #188](https://github.com/xdgf558/caption-ai-landing-site/pull/188)，审查头 CI 重跑通过，合并为 `b15b233`；[权限矩阵、存档格式与素材缺口](T03-entitlements-saves-and-materials.md)、[验证摘要](T03-evidence/verification-summary.json)、[内存存档核对工具](tools/audit-local-save-contract.mjs)；素材继续“稍后确定” |
| T04 视觉变量与导航组件 | 审查通过，已合并 | [PR #189](https://github.com/xdgf558/caption-ai-landing-site/pull/189)，审查头 `f3d17c3` CI 通过，合并为 `0fe6b4e`；用户新图与五项导航已确认；[交付说明](T04-visual-system-and-navigation.md)、[选定记录](T04-evidence/gentle-station/design-selection.json)、[历史设计 QA](T04-evidence/gentle-station/design-qa.md) |
| T05 首页与首页配置 | 审查通过，已合并 | [PR #190](https://github.com/xdgf558/caption-ai-landing-site/pull/190)，审查头 `c4df9ff` CI 通过，合并为 `781c8d9`；[配置合同](T05-home-and-configuration.md)、[设计 QA](T05-evidence/design-qa.md)、[证据清单](T05-evidence/manifest.json)；默认素材待定，预览仍隔离 |
| T06 兼容数据模型与迁移 | CI 清单修订，待复审 | [PR #191](https://github.com/xdgf558/caption-ai-landing-site/pull/191)，原审查头 `8ac1d499` 的 CI 因 18 张新表未登记失败；[字段映射、迁移与回退](T06-data-model-and-migration.md)、[演练报告](T06-evidence/migration-rehearsal.json)、[验证摘要](T06-evidence/verification-summary.json)、[清单修订证据](T06-evidence/schema-audit-repair.json)；生产 schema 未确认 |
| T07–T22 | 未开始 | 沿用任务清单中的依赖，每个任务单独提交、审查后继续 |

## 需求基线

以下三份 v1.1 Markdown 文档来自用户确认后的本地开发文档包。仓库副本在移除行尾空格后，依据本次审查同步了一任务一 PR 的执行顺序。产品范围没有改写，原始文档包未修改。

- [主开发文档](specs/Station_Cat_Website_Redesign_Development_v1.1.md)
- [22 项实施任务](specs/Station_Cat_Redesign_Implementation_Tasks_v1.1.md)
- [通用 Codex 启动指令](specs/Station_Cat_Redesign_Codex_Start_v1.1.md)

已确认的约束：有效试听按主文档的前台实际累计至少 10 秒或试听结束计算，同一 `playback_id` 一次；推广歌曲由既有后台的专门模块配置，游客试听随独立公开试听开关验收；新版开发完成并上线后关闭被替代的旧公开入口，同时保护账号、支付、历史权益和存档服务。

T04 原先用 UI 技能生成 3 个模板、选择第 2 张。用户于 2026-10-06 提供“温柔小站”新图并要求采用，随后确认首页、音乐、游戏、会员、关于五项导航；该指令取代旧模板与四入口建议，仓库规范已同步。当前按 `product-design:image-to-code` 与设计 QA 流程实现新图，原模板与证据保留为历史记录。视觉样例只用于本地隔离预览，图中《晚一点告白》与插画不作为实际主推、发行或游戏截图证据。

## 本轮代码基线

目标仓库为 [xdgf558/caption-ai-landing-site](https://github.com/xdgf558/caption-ai-landing-site)，独立本地检出从 `main` 的 `6cbb19725cd12ae718ea395711f920adef346824` 开始。T01 分支为 `codex/station-cat-redesign-t01`，修订提交 `020e970f7376601e8c6708562e3143f79f056d35` 是 T02 的盘点基线；T02 工作分支为 `codex/station-cat-redesign-t02`。已有其他本地检出没有修改。

T01 至 T03 修改文档、核对工具与证据。T01 当前头 CI 通过后合并为 `eef728d`；T02 当前头 `877a331` 的 CI 通过后合并为 `dffc4c2`；T03 审查头 `d6d1638` 的 CI 重跑全部通过后合并为 `b15b233`。T04 审查头 `f3d17c3` 的 CI 通过后合并为 `0fe6b4e`，增加尚未接入生产页面的视觉布局、导航与隔离夹具。

T05 分支为 `codex/station-cat-redesign-t05`，基线为已合并 T04 的 `0fe6b4ece67f47df3d3cb20dfeaa4969833459a1`。新增首页组件、文件配置、公开记录白名单投影、状态夹具和测试；普通构建不含新首页或夹具标记。主推、平台、试听和视频仍待定，发布配置与媒体播放没有接入生产。关于仅现有 `/about/` 和未知音乐后代的 T08/T20 映射缺口继续保留。T05 托管 CI 以该任务 PR 当前头为准，本地空正文构建不作为生产包或远程通过证据。

T05 审查头 `c4df9ff4e5f26bc9a66fb3e9ff00b67fa51f1f71` 的 [CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37476783579/job/112314142325) 于 2026-10-06 14:35:30 UTC 成功，随后经用户批准合并为 `781c8d9e04c729406f6083aac9e865b0e21ad966`。T06 分支为 `codex/station-cat-redesign-t06`，从该合并提交开始，追加独立 MUSIC_DB 的网站快照、平台、素材、推广、首页、归因和路由提案模型。旧音乐物理表与音频权益保留，旧清理视图兼容保护新增引用；没有远程迁移、后台发布或正式页面挂载。T06 原头的 [CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37486032731) 在账号删除 schema 审计失败，已补只读分类并保留所有未批准/未启用开关。修订头的 CI 与复审需单独确认，不能沿用原头审查或 T05 的通过记录；T07 尚未编码。

T03 已记录当前游戏启动流程在合成内存中覆盖损坏 JSON 的行为。T12 必须使用可区分缺失、损坏、不支持版本和不可访问存储的只读检测，并保护恢复衔接，不能把现有自动新建函数当作“继续游戏”检查。该发现不影响 T03 核对交付，但 A13 尚未完成。
