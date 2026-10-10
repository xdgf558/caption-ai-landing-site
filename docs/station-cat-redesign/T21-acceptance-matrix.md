# T21 A01–A22 验收矩阵

本表不是全项通过单。所有日志是本机最终源码检查；D1/R2、身份、订单、版权和平台记录使用合成夹具。浏览器操作仅为 Codex IAB，物理设备与生产列不能从专项计数推导。整体性能与导出缺口见 [T21 报告](T21-core-regression-and-device-verification.md)。

| 项 | 本批证据与实际结果 | 证据层级/状态 | 尚未完成 |
| --- | --- | --- | --- |
| A01 首屏与静音 | 空首页无 audio/video/iframe；搜索/五导航可用。[HTTP](T21-evidence/final-core/logs/acceptance.log)、[截图](T21-evidence/browser/01-home-pending.png) | 原生本机 HTTP + IAB，通过夹具空态 | 已发布真实主推/游戏首页及生产首屏 |
| A02 推广游客试听 | 已启用合成推广有独立试听；游客完整核权 401。停止/草稿/未来推广拒绝试听。[公开查询](T21-evidence/final-core/logs/public.log)、[HTTP](T21-evidence/final-core/logs/acceptance.log)、[原生媒体](T21-evidence/browser/03-preview-native.png) | 合成权益、本机真实可解码媒体，通过 | 运营确定推广、真实素材及生产开关组合 |
| A03 Apple 待发行 | planned/removed/地区不适用不输出目标；正常链接受地址白名单和验证约束。[平台](T21-evidence/final-core/logs/platforms.log)、[公开](T21-evidence/final-core/logs/public.log) | 模型 + 本机查询，通过 | 真实 Apple 发行状态/URL/设备点击 |
| A04 试听结束 | 原生 1.045 秒试听自然 ended，状态“播放完毕”，没有完整音频资源；一次 start/qualified。[截图](T21-evidence/browser/04-preview-ended.png)、[事件](T21-evidence/browser/native-ended-event-observations.json) | IAB + 临时 D1，通过合成试听 | 真实试听长度、授权与真机播放 |
| A05 A→B 竞态 | 迟到核权、加载和 play 结果不能覆盖新请求；离页与刷新只恢复公开曲目/进度。[播放器](T21-evidence/final-core/logs/player.log) | 注入延迟的核心回归，通过 | 物理设备/真实网络快速切歌 |
| A06 音视频互斥 | 原生视频开始音乐暂停；Escape 移除视频且不恢复音乐，焦点回原触发器。[媒体观察](T21-evidence/browser/browser-checks.json)、[截图](T21-evidence/browser/05-clip-native.png)、[专项](T21-evidence/final-core/logs/clips.log) | IAB 真实解码合成媒体，通过 | 真实 MV/短视频及真机 |
| A07 游戏进入/退出 | 原 v1.28.0 引擎载入 87 金币，单 iframe，进入暂停音乐、退出清理并恢复焦点。[截图](T21-evidence/browser/07-game-ready.png)、[专项](T21-evidence/final-core/logs/game-session.log) | 本机真实引擎，通过 | 生产云/设备；1 秒退出与同源边界保留 |
| A08 引擎失败与 ready | 实际 main.js 503 可重试，失败后 0 iframe、无 game_ready；协议测试验证 load 不是 ready。[截图](T21-evidence/browser/11-game-boot-failure.png)、[事件](T21-evidence/browser/boot-failure-and-optout-observations.json)、[专项](T21-evidence/final-core/logs/game-session.log) | IAB 实际失败 + 协议回归，通过 | 生产故障/真机资源失败；无 ready 超时由核心测试覆盖 |
| A09 play 拒绝 | rejected play 保持暂停/错误，不伪造 playing 或 preview_start；迟到失败不污染新请求。[播放器](T21-evidence/final-core/logs/player.log)、[事件客户端](T21-evidence/final-core/logs/events.log) | 拒绝注入回归，通过 | 浏览器自动播放策略/真实媒体拒绝 |
| A10 平台点击非阻塞 | 原生 HTTPS 不 await 统计；503/复制失败不阻断导航。[平台](T21-evidence/final-core/logs/platforms.log)、[事件](T21-evidence/final-core/logs/events.log) | 客户端控制回归，通过 | 真实链接点击及外部 App 唤起 |
| A11 Campaign 与恶意参数 | 登记精确元组保留；恶意/重复/超长归为 bounded unknown，无开放重定向。[HTTP](T21-evidence/final-core/logs/acceptance.log)、[Campaign](T21-evidence/final-core/logs/campaigns.log) | 原生本机 HTTP + 模型，通过 | 真实推广短链和旧 src 映射核验 |
| A12 幂等与统计口径 | 同一批 event_id 重发 accepted=0；10 秒资格通过，暂停/隐藏/seek 不累计；自然短试听结束一次 qualified。[HTTP](T21-evidence/final-core/logs/acceptance.log)、[专项](T21-evidence/final-core/logs/events.log)、[原生 ended](T21-evidence/browser/native-ended-event-observations.json) | 原生本机 HTTP + 核心 + IAB，通过 | 生产采集、清理健康/保留期、真机后台行为 |
| A13 存档 | 有效可继续；损坏/未来版本分开显示，原文保留；不可访问、缺失、导入与并发保护由专项覆盖。[损坏](T21-evidence/browser/08-corrupt-save-preserved.png)、[未来](T21-evidence/browser/10-future-save.png)、[游戏](T21-evidence/final-core/logs/games.log) | 本机部分通过 | 原始导出未观察到下载落盘；生产云冲突、跨进程覆盖窗口、真机 |
| A14 历史权益与原生资料库 | 小说/积分/装扮不授予音乐 VIP，旧账号/订单 GET 与原生音乐/资料库合同保留。[会员](T21-evidence/final-core/logs/member.log)、[原生音乐](T21-evidence/final-core/logs/native-music.log)、[原生资料库](T21-evidence/final-core/logs/native-library.log)、[旧回归](T21-evidence/final-core/logs/legacy.log) | 合成会员/订单 + 原生合同，通过 | 历史真实账号、订单、支付回调、云存档；不把本地收藏当账号同步 |
| A15 草稿与定时失败 | 草稿/未来/发布失败不进公开快照或 sitemap；默认关闭与 schema 拒绝先于写入。[后台](T21-evidence/final-core/logs/content-admin.log)、[公开](T21-evidence/final-core/logs/public.log)、[迁移](T21-evidence/final-core/logs/migration.log) | 原生本机 D1/R2/Worker + 核心，通过 | 生产 Access/schema/定时器/索引 HTTP |
| A16 控件不遮挡 | 五宽度 clientWidth=scrollWidth；手机 dock bottom=nav top=780，页脚统计控件在上方可用。[几何](T21-evidence/browser/responsive-geometry.json)、[截图](T21-evidence/browser/13-mobile-footer-controls.png) | IAB 视口，通过 | iOS safe-area、键盘弹出、触屏与真机 |
| A17 旧地址关闭 | 仅隔离：/apps/ 真 410，未知 /blog/ 404，/games/cat-life/ 200，私有模板 404；任一组合开关关闭回原处理。[HTTP](T21-evidence/final-core/logs/acceptance.log)、[迁移](T21-evidence/final-core/logs/migration.log) | 上线前预验，通过夹具 | T22 补 Assets Worker 范围；上线后实际 URL/方法/权限与旧入口关闭独立验收 |
| A18 编辑冲突与恢复 | 原生 D1 CAS、丢回执原操作恢复；成功后身份核验失败保留原键；快照封存等待在途写入。[后台](T21-evidence/final-core/logs/content-admin.log)、[报表](T21-evidence/final-core/logs/reports.log) | 合成 Access + 原生本机事务，通过 | 实际 Access 多管理员/生产资源；跨 D1/R2/Access 无原子提交 |
| A19 撤回/存储拒绝/统计失败 | 撤回后原生试听继续且无试听事件；重新允许新事件正常。503 不阻断媒体/HTTP；拒绝存储采用内存或明确不可用。[前后观察](T21-evidence/browser/boot-failure-and-optout-observations.json)、[专项](T21-evidence/final-core/logs/events.log)、[HTTP](T21-evidence/final-core/logs/acceptance.log) | IAB + 核心 + 原生 HTTP，通过 | 真机隐私模式/存储政策、生产故障 |
| A20 撤销与新鲜资源 | 撤销权利/替换对象后新公开响应拒绝已知媒体 URL，首页/平台投影删除失效引用；条件请求不能绕过。[公开](T21-evidence/final-core/logs/public.log)、[短片](T21-evidence/final-core/logs/clips.log)、[后台](T21-evidence/final-core/logs/content-admin.log) | 原生本机 D1/R2 + 核心，通过 | 生产缓存/真实对象/权利/撤销时效；已缓冲音频边界保留 |
| A21 内置浏览器降级 | 有 HTTPS 与手动/按钮复制；复制失败不拦截原生链接。[平台](T21-evidence/final-core/logs/platforms.log) | 降级逻辑通过，真实客户端未验证 | 抖音/微信、iOS/Android 实际唤起失败和复制 |
| A22 键盘与读屏 | 搜索/视频 Escape 回原触发器；游戏返回恢复焦点；核权失败焦点修复和三项回归。[观察](T21-evidence/browser/browser-checks.json)、[专项](T21-evidence/instrumentation-final/logs/acceptance.log) | IAB 键盘部分通过 | VoiceOver/屏幕阅读器与所有真机控件朗读 |

本机歌曲 LCP 超标、原始导出落盘、真实素材/发行/权利、指定设备与生产查询均为未满足项；矩阵中的“通过”仅描述明确列出的证据范围。没有生产验收通过、部署授权、旧入口关闭或 T22 执行记录。
