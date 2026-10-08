# Station Cat 改版执行记录

本目录保存音乐与游戏改版的需求基线、仓库盘点和后续验收证据。产品定位是个人品牌推广，大部分音乐在各音乐平台发行，网站提供作品展示、推广内容和平台入口。

## 当前执行约定

用户于 2026-10-05 要求从第一个任务开始，每个任务完成后提交 GitHub PR，由用户审查通过后再进入下一个任务。T01 至 T11 已审查通过并在各自审查头 CI 通过后合并。T06 原头 `8ac1d499` 的销户审计失败已通过只读清单修订解决；修订头 `31e19a6` 经用户复审及托管 CI 通过后合并。本轮仅执行 **T12 游戏作品页与存档入口**，审查后才进入 T13。

这项约定优先于基线文档中建议的 R0–R7 批次及启动指令中的连续推进方式；三份规范正文已按本次审查同步逐项执行要求。PR 创建、构建通过与生产发布是独立状态；本轮没有生产发布授权，待用户审查的 PR 不自动合并。

| 任务 | 状态 | 交付或进入条件 |
| --- | --- | --- |
| T01 仓库与运行方式盘点 | 审查通过，已合并 | [PR #186](https://github.com/xdgf558/caption-ai-landing-site/pull/186)，修订头 CI 通过，已补音乐后代路径与原生资料库范围 |
| T02 路由与业务依赖清单 | 审查通过，已合并 | [PR #187](https://github.com/xdgf558/caption-ai-landing-site/pull/187)，当前头 CI 通过；[说明](T02-route-and-service-inventory.md)、[逐地址 CSV](T02-route-inventory.csv) 作为源码依赖基线，实际 HTTP 留 T20 验证 |
| T03 权益、存档与素材核对 | 审查通过，已合并 | [PR #188](https://github.com/xdgf558/caption-ai-landing-site/pull/188)，审查头 CI 重跑通过，合并为 `b15b233`；[权限矩阵、存档格式与素材缺口](T03-entitlements-saves-and-materials.md)、[验证摘要](T03-evidence/verification-summary.json)、[内存存档核对工具](tools/audit-local-save-contract.mjs)；素材继续“稍后确定” |
| T04 视觉变量与导航组件 | 审查通过，已合并 | [PR #189](https://github.com/xdgf558/caption-ai-landing-site/pull/189)，审查头 `f3d17c3` CI 通过，合并为 `0fe6b4e`；用户新图与五项导航已确认；[交付说明](T04-visual-system-and-navigation.md)、[选定记录](T04-evidence/gentle-station/design-selection.json)、[历史设计 QA](T04-evidence/gentle-station/design-qa.md) |
| T05 首页与首页配置 | 审查通过，已合并 | [PR #190](https://github.com/xdgf558/caption-ai-landing-site/pull/190)，审查头 `c4df9ff` CI 通过，合并为 `781c8d9`；[配置合同](T05-home-and-configuration.md)、[设计 QA](T05-evidence/design-qa.md)、[证据清单](T05-evidence/manifest.json)；默认素材待定，预览仍隔离 |
| T06 兼容数据模型与迁移 | 修订复审通过，已合并 | [PR #191](https://github.com/xdgf558/caption-ai-landing-site/pull/191)，修订头 `31e19a6` 的托管 CI 通过，合并为 `1c81fc7`；[字段映射、迁移与回退](T06-data-model-and-migration.md)、[演练报告](T06-evidence/migration-rehearsal.json)、[清单修订证据](T06-evidence/schema-audit-repair.json)；生产 schema 未确认 |
| T07 公开查询与资源权限 | 审查通过，已合并 | [PR #192](https://github.com/xdgf558/caption-ai-landing-site/pull/192)，审查头 `0b9d7b6` 的完整 CI 通过，合并为 `828d5a9`；[查询与权限合同](T07-public-queries-and-resource-access.md)、[验证摘要](T07-evidence/verification-summary.json)；生产绑定与 schema 仍未确认 |
| T08 音乐目录与单曲页 | 第二次复审通过，已合并 | [PR #193](https://github.com/xdgf558/caption-ai-landing-site/pull/193)、[页面与播放合同](T08-music-catalog-and-detail.md)、[修订记录](T08-review-fixes.md)、[第一次修订设计 QA](T08-review-evidence/design-qa.md)、[第一次修订证据](T08-review-evidence/verification-summary.json)、[开关修订证据](T08-gate-evidence/verification-summary.json)；审查头 `f09f8de9` 的完整托管 CI 通过，合并为 `14cbead7`；生产开关关闭，旧入口未退役，真实素材待定 |
| T09 音频播放器与请求竞态 | 审查通过，已合并 | [PR #194](https://github.com/xdgf558/caption-ai-landing-site/pull/194)，审查头 `00fe1096` 的完整托管 CI 通过，合并为 `7e46ed37`；[播放器合同与验收](T09-audio-player-and-request-races.md)、[验证摘要](T09-evidence/verification-summary.json)、[设计 QA](T09-evidence/design-qa.md)；缓冲及会话内准备窗口的 P3 限制保留 |
| T10 发行平台入口与降级 | 审查通过，已合并 | [PR #195](https://github.com/xdgf558/caption-ai-landing-site/pull/195)，审查头 `9c687670` 的完整托管 CI 通过，合并为 `7ecaab47`；[平台合同与验收](T10-release-platforms-and-fallbacks.md)、[验证摘要](T10-evidence/verification-summary.json)、[设计 QA](T10-evidence/design-qa.md)；历史测试时序和真实平台验收的 P3 边界保留 |
| T11 短视频与 MV 播放 | 审查通过，已合并 | [PR #196](https://github.com/xdgf558/caption-ai-landing-site/pull/196)，审查头 `d804f4b1` 的完整托管 CI 通过，合并为 `99b0ba00`；[播放合同与验收](T11-clips-and-mv-playback.md)、[最终源码验证摘要](T11-evidence/verification-summary.json)、[设计 QA](T11-evidence/design-qa.md)；真实媒体与真机的 P3 缺口保留 |
| T12 游戏作品页与存档入口 | 原头审查无阻断，CI 修订待复审 | [PR #197](https://github.com/xdgf558/caption-ai-landing-site/pull/197)、[页面合同](T12-game-pages-and-save-safety.md)、[CI 修订说明](T12-ci-browser-review-fixes.md)、[发布检查跟进证据](T12-release-check-evidence/verification-summary.json)；`16cde762` 浏览器检查失败，`e3b577bc` 因发布检查仍引用旧用例名称在 npm test 停止；已同步名称，新头须独立 CI 及用户复审，尚未合并 |
| T13–T22 | 未开始 | 沿用任务清单中的依赖，每个任务单独提交、审查后继续 |

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

T05 审查头 `c4df9ff4e5f26bc9a66fb3e9ff00b67fa51f1f71` 的 [CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37476783579/job/112314142325) 于 2026-10-06 14:35:30 UTC 成功，随后经用户批准合并为 `781c8d9e04c729406f6083aac9e865b0e21ad966`。T06 分支为 `codex/station-cat-redesign-t06`，从该合并提交开始，追加独立 MUSIC_DB 的网站快照、平台、素材、推广、首页、归因和路由提案模型。旧音乐物理表与音频权益保留，旧清理视图兼容保护新增引用；没有远程迁移、后台发布或正式页面挂载。T06 原头的 [CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37486032731) 在账号删除 schema 审计失败，已补只读分类并保留所有未批准/未启用开关。

T06 修订审查头 `31e19a67f7c9cb7f5f79d7771b87748b697ca2ab` 的 [托管 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37491024228/job/112363480480) 于 2026-10-06 16:25:10 UTC 成功。用户复审通过后，于 2026-10-07 05:07:15 UTC squash 合并为 `1c81fc7c9fd0e1399314f15408ae38ed58ddbd65`。T07 分支 `codex/station-cat-redesign-t07` 从该实际合并提交建立，新增默认关闭的 `/api/station/content` 查询与受控资源分发，未修改 T06 迁移或生产绑定。生产 MUSIC_DB schema 仍未确认；运行时先检查实际绑定、表列、默认 D1 迁移账本与扩展清理视图，缺失时拒绝查询。正式页面、关于语言内容、旧音乐后代映射和旧入口关闭仍属于后续任务。

T03 已记录当前游戏启动流程在合成内存中覆盖损坏 JSON 的行为。T12 必须使用可区分缺失、损坏、不支持版本和不可访问存储的只读检测，并保护恢复衔接，不能把现有自动新建函数当作“继续游戏”检查。该发现不影响 T03 核对交付，但 A13 尚未完成。

T07 审查头 `0b9d7b67974f447d8e543415fce64ec84d2ba25f` 的 [完整 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37577847229/job/112650635781) 于 2026-10-07 06:16:59 UTC 成功，随后于 06:18:41 UTC squash 合并为 `828d5a9d345e171dd2d28b159943c09beeaa63c4`。T08 分支 `codex/station-cat-redesign-t08` 从该实际合并提交开始。默认关闭的 HTML 路由、有限目录查询和显式播放适配器已经实现，正式启用仍要求生产绑定/schema/资源核对与后续发布授权；游戏介绍尚属 T12，原生关联尚未扩大。

T08 原审查头 `8a314220` 的托管 CI 在旧音乐 staging 静态包核验失败（新增共享 musicLyrics 代码块未获精确文件名匹配）。第一次修订补充该代码依赖并修正关闭态/未映射详情路径回退和权限待确认文案；第二次修订将接管条件统一为页面、查询两个开关均开启，只开页面时也交回旧处理器。原失败记录不改写为通过，新修订头仍须独立托管 CI 和用户复审，本机通过不替代托管结果。

T08 第二次复审头 `f09f8de960227301ef34d06d438a79c1d7a4490a` 的 [完整托管 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37592569293/job/112697326340) 于 2026-10-07 08:49:31 UTC 成功，30 个步骤全部通过。用户复审通过后，于 08:54:44 UTC squash 合并为 `14cbead7d868d23154baf263c8d86b616c8d2268`。这是 T09 分支 `codex/station-cat-redesign-t09` 的实际主分支基线。历史 T08 修订记录保留当时的等待状态，不作为当前状态。

T09 审查头 `00fe1096ac3b2452d7b1a664c0fc0c45b8336585` 的 [完整托管 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37601788613/job/112727652731) 于 2026-10-07 10:08:22 UTC 完成，31 个步骤全部成功。用户审查通过后，于 12:09:47 UTC squash 合并为 `7e46ed374597cba3365b10c2bd4dc09e2db51b7a`；[独立 CI](T10-evidence/T09-approved-head-ci.json) 与 [合并状态](T10-evidence/T09-merge-result.json) 可复核。历史 T09 文档保留当时等待状态，不作为当前头的 CI 记录。共享播放器挂在默认关闭的新音乐壳中；持续完整播放期间不重新核权、已经缓冲内容可能播完、30 秒准备窗口仅限页面会话的 P3 边界继续保留，T10 没有更改播放器核心。

T10 分支 `codex/station-cat-redesign-t10` 从上述实际合并提交建立，增加安全的平台可用状态、原生 HTTPS 入口和四语言手动/按钮复制降级，复用现有平台记录与运营排序。审查头 `9c68767014b1ef968d5e017d85f0887bcc6661eb` 的 [完整托管 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37622314516/job/112795355911) 于 2026-10-07 13:05:04 UTC 完成，32 个步骤全部成功。用户审查通过后，于 13:14:01 UTC squash 合并为 `7ecaab47e98204ad30a6e5e7a35d10b641311a73`；[独立 CI](T11-evidence/T10-approved-head-ci.json) 与 [合并状态](T11-evidence/T10-merge-result.json) 可复核。历史 T10 文档保留当时等待状态，不作为当前头 CI。63 项公开查询和 18 项关闭态回归早于最终地址收紧的 P3 边界保留；合成外链未真实点击，也没有真机、内置浏览器或 VoiceOver 验收。

T11 分支 `codex/station-cat-redesign-t11` 从该实际主分支建立。首页组件及歌曲页复用点击创建的原生 inline 视频播放器，接入 T09 音视频互斥、即时清理、关闭焦点恢复、错误重试和播放结束入口。隔离首页只绑定公开首页/推广已选视频，正式首页仍未挂载。最终源码的 274 项本地测试、主构建、独立四语言首页构建及 staging 资源核验通过，完整原始日志与哈希单独保存；本地构建仍使用空正文选项，不能替代生产包或本 PR 实际头托管 CI。

T11 审查头 `d804f4b173e0ba67bb4b6aa193b106e39fa7d85e` 的 [完整托管 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37633497177/job/112833555385) 于 2026-10-07 14:35:32 UTC 完成，33 个步骤全部成功。用户审查通过后，于 14:37:20 UTC squash 合并为 `99b0ba003c1618018e40c5c756d44f2b94ef7f63`；[独立 CI](T12-evidence/T11-approved-head-ci.json) 与 [合并状态](T12-evidence/T11-merge-result.json) 可复核。插画加合成音的视频、未点击原链接、移动浏览器/VoiceOver、生产资源和缓存撤销的 P3 边界继续保留。

当前任务为 T12，分支 `codex/station-cat-redesign-t12` 从上述实际合并提交建立。新增默认关闭的四语言游戏目录和介绍页，使用 T03 实际旧游戏截图；介绍与 `/games/cat-life/` 运行目录分离。只读存档状态、现有账号会话与运行端写入保护已接通：异常槽位暂停启动、自动保存和后续云衔接，显式恢复先备份原文，再替换相容文件。最终源码 177 项本地测试、空正文主构建及 staging 资源核验通过，原始日志与源码哈希可独立复算。A13/A14/A19 仅完成本机夹具范围，生产云同步和真机仍未验收。T13 网站媒体协调尚未实施。本批不执行远程迁移、开关启用、生产发布或旧入口退役，待用户审查后再继续。

用户于 2026-10-08 审查 T12 未发现阻断，继续保留已发云写入/跨标签页比较不是原子操作及生产验收缺口。随后核对发现原头 `16cde7622e8f729875d1a5625a03fb44e78950ec` 的托管 CI 在 146 项浏览器检查中有 4 项失败、142 项通过，后续步骤未执行，因此没有合并或开始 T13。修订恢复 schema 0–2 空猫列表的既有迁移、处理退出时预期写入拒绝，并同步旧浏览器夹具与缓存身份验收；本机新一轮 178 项测试、空正文构建、staging 资源检查通过。原头的 177 项及截图保留为历史，修订原始日志和源码哈希单独保存。修订头仍待独立托管 CI 和用户复审，本地通过不替代它。

修订头 `e3b577bcc7d4adb49682f5e568125691adec5719` 的托管 CI 于新加坡时间 2026-10-08 07:32:00 在 npm test 失败：发布配置检查漏同步上一轮改名的浏览器用例。该运行没有到达浏览器步骤。当前只同步该名称断言，完整 npm test 和空正文构建通过；上一轮 44 个源码/依赖锚点字节仍完全一致，178 项结果及视觉记录按历史验证复用，不声称本次重跑或替代新头托管结果。用户指出的并发覆盖窗口继续保留，仍未合并、未进入 T13。
