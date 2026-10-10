# T21 核心回归与设备验证

本批交付 A01–A22 的本机证据、可复现的集成验收夹具和一次键盘焦点修复。**本机功能检查通过不等于发布验收通过**：限速夹具的歌曲页 LCP 未达到 2.5 秒目标，真实素材、生产资源、原始存档下载落盘和指定真机仍未验收。T22 未开始，生产开关、迁移、部署和旧入口保持原状。

## 基线与代码变化

分支 `codex/station-cat-redesign-t21` 从 T20 合并提交 `2cf2bf2d2c2e678fb7dfa646cdfb5d745d3dc5b7` 建立。[T20 合并事实](T21-evidence/T20-merge-result.json) 与[精确头 CI](T21-evidence/T20-approved-head-ci.json) 分开保存：PR #205 头 `661e93e9` 的 CI `38011585239` 42 步成功，2026-10-10 18:29:26 新加坡时间 squash 合并。

实际浏览器中，完整收听按钮在核权期间变为 disabled，原生焦点落到 body；游客被拒绝后焦点没有回来。`src/redesign/musicClient.js` 现在在请求完成后，仅当按钮原先持有焦点、仍在页面内且可用、用户没有移到其他控件时恢复它。离页、正在打开的对话框和新的用户焦点不被抢走。核权时机、原权益校验和音频地址没有改变。三个专项测试覆盖成功/拒绝、新焦点、离页及仍禁用状态；[修复后的实际截图](T21-evidence/browser/06-access-focus-fixed.png) 中游客被拒绝且没有完整音频 src。

其余新增内容为本机测试与报告：`createStationRouteRuntime` 接受显式夹具 bindings/videoCases，默认行为保持；新的 core preview 组合原 Worker、原生 Assets、临时 D1/R2、0012–0018 本地账本、合成媒体和旧游戏运行端。CI 增加 `test:redesign:acceptance`，没有修改 wrangler、依赖锁文件或迁移。

## 可复现范围

在仓库根目录执行：

```sh
ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build
node scripts/build-station-clip-home-preview.mjs
npm run build:redesign:game-session
npm run build:redesign:member
npm run test:redesign:acceptance
npm run verify:redesign:core
npm run preview:redesign:core
```

预览默认 `http://127.0.0.1:4221/`。限速预览可另外运行 `STATION_CORE_PREVIEW_PORT=4222 STATION_CORE_NETWORK=mobile-lab npm run preview:redesign:core`。构建必须先完成；预览命令不会自动构建。主构建允许空小说正文，只用于开发与测试，不是生产包。

预览仅监听 loopback，验证 Host、方法与同源事件请求，输出 private/no-store 和 noindex。浏览器真实 Cookie、Access 凭证、身份和开关请求头不会转发。除了临时合成事件，禁止后台、财务和云存档写入；外部请求由测试运行时拒绝。存档选项只替换带夹具标记的可丢弃槽位，已有非夹具槽位拒绝覆盖。控制条可以选择缺失、有效、损坏、未来版本、存储不可访问、身份失败、引擎失败和无 ready 确认；故障场景不是生产设置。

首页始终保留主推资料待定空态。歌曲《晚一点告白》、VIP 等标题/权益、短视频和 Campaign 都是测试数据，不作为本期主推、实际会员、发行记录或版权证明。音频是 4.049 秒合成完整文件和独立 1.045 秒试听，视频为插画加合成音的可解码 MP4。真实发行链接没有点击或验收。

## 测试记录与时序

[最终核心运行](T21-evidence/final-core/verification-summary.json) 的 29 个命令均退出 0；完整 `npm test` 有 562 项 Node 测试，另含不采用 Node 计数的脚本断言。播放器专项 149、公开查询 35、内容后台 37、事件 40、报表 71、迁移 24、原生音乐 18、原生资料库 23、原生生产合同 115 项通过；相关命令与每次实际计数均在摘要中，重复执行的测试不相加成独立用例总数。销户审计的 12 项 Python 检查通过，销户仍未批准/启用。

主构建、隔离首页/游戏/会员构建、旧 staging 资源构建及精确依赖检查通过。`final-core` 在焦点修复后运行，保存原始日志、退出码、时长和 SHA-256；387 个当时已被 Git 跟踪的源码锚点在该次运行内未变。新建未跟踪工具不在这一旧锚点集合内，不能把这个布尔值当成所有新文件的证明。

之后仅调整本机控制条选项、PerformanceObserver 的 LCP 元素诊断和证据采集器的未跟踪源码范围，分别在 [fixture-final](T21-evidence/fixture-final/verification-summary.json) 重跑 14 项验收及 24 项迁移，在 [instrumentation-final](T21-evidence/instrumentation-final/verification-summary.json) 重跑 14 项验收。最后 [tooling-final](T21-evidence/tooling-final/verification-summary.json) 以包含新文件的 392 个源码锚点再次运行 14 项验收，开始/结束锚点一致。生产焦点源码与全套 `final-core` 相同。[证据 manifest](T21-evidence/manifest.json) 为最终交付文件单独保存哈希；日志未裁剪或清除空白。

`core/` 是焦点修复前的初次通过记录，仅保留排查历史，不覆盖最终源码。首次既有 `npm run test:browser` 因缺少锁定版本的 Chromium headless shell，148 项均未启动，不是 148 项行为失败；原日志为 [browser-regression.log](T21-evidence/browser-regression.log)。补充官方 Chrome Headless Shell 151.0.7922.34（Playwright v1234）后，重跑 **148 项全部通过，耗时 2.3 分钟**；[最终原始日志](T21-evidence/browser-regression-final.log) 独立保存，不覆盖首次失败。这是现有游戏/旧首页浏览器回归，不是新版在真实手机或稳定版浏览器通过。T21 托管 CI 必须按新 PR 的精确头独立核对，T20 或本机结果不能替代。

## 实际界面检查

按 Product Design audit 的截图与实际操作核对既有温柔小站，没有重新选择视觉模板。

1. **首页：本机健康。** 待定首页没有音视频或 iframe，没有自动出声或最新免费回退；五导航与搜索可使用。[首页](T21-evidence/browser/01-home-pending.png)、[搜索键盘](T21-evidence/browser/02-search-keyboard.png)。
2. **歌曲与权限：功能健康，性能待处理。** 原生试听自然结束，完整播放仍先核权；游客 401 没有完整音频。核权失败后的焦点缺口已修复。[试听](T21-evidence/browser/03-preview-native.png)、[结束](T21-evidence/browser/04-preview-ended.png)、[权限焦点](T21-evidence/browser/06-access-focus-fixed.png)。
3. **短视频：本机健康。** 点击后才创建一个原生视频，音乐暂停；Escape 清理视频，焦点回到原按钮，音乐没有自动恢复。[短视频](T21-evidence/browser/05-clip-native.png)。
4. **游戏进入/返回：本机健康，已有风险保留。** 有效槽位启动原 v1.28.0 引擎并加载 87 金币，只保留一个 iframe；返回后音乐暂停，焦点回到继续按钮。[实际运行端](T21-evidence/browser/07-game-ready.png)。退出 1 秒等待和同源无 sandbox 并未因此消失。
5. **恢复与错误：部分验收。** 损坏与未来版本分别显示恢复/不兼容提示，原文保留。引擎 main.js 被夹具故意拒绝后可重试，不残留 iframe 或写入 game_ready。[损坏提示](T21-evidence/browser/08-corrupt-save-preserved.png)、[运行端保护](T21-evidence/browser/09-runtime-recovery.png)、[未来版本](T21-evidence/browser/10-future-save.png)、[引擎失败](T21-evidence/browser/11-game-boot-failure.png)。原始导出已实际点击，但 IAB 未观察到下载事件，文件落盘未验收。
6. **手机尺寸与键盘：视口范围健康。** 375、390、768、1280、1440 × 844 中没有横向溢出；手机播放器上边在底部导航之上，页脚统计按钮可滚动到两者上方。搜索与视频关闭恢复焦点。[几何记录](T21-evidence/browser/responsive-geometry.json)、[页脚控件](T21-evidence/browser/13-mobile-footer-controls.png)。这些不是物理手机或 VoiceOver 通过。

[浏览器观察](T21-evidence/browser/browser-checks.json) 保存每次事实与时间。撤回统计后实际试听仍完成且没有 preview_start/preview_qualified；重新允许后，一次 1.045 秒自然结束分别产生一个 start 和 qualified，符合“10 秒或自然结束”，不是沿用旧 30 秒/50% 字典。[撤回记录](T21-evidence/browser/boot-failure-and-optout-observations.json)、[重新允许与自然结束](T21-evidence/browser/native-ended-event-observations.json)。

## 设备与网络

实际宿主为 macOS 27.0.1（26A434）、Darwin arm64、Node v24.15.0。手工浏览器为 Codex IAB，实际 UA `Chrome/155.0.0.0`；UA 不证明桌面 Chrome 稳定版或 Safari。可用连接只包含 IAB/MCP App；尝试创建桌面 Chrome 验收页返回 browser unavailable。补装的 Chromium 是自动化测试运行包，不是用户桌面浏览器。

| 指定环境 | 本批事实 | 状态 |
| --- | --- | --- |
| IAB 桌面及 375/390/768/1280/1440 视口 | 实际操作、截图、焦点和 DOM 几何 | 已验本机范围 |
| iPhone Safari / Android Chrome | 没有对应物理设备 | 未验证 |
| 桌面 Safari / Chrome / Edge 当前稳定版 | 未取得对应可控浏览器；Chrome 连接尝试不可用 | 未验证 |
| 抖音 / 微信内置浏览器 | 无真实客户端，没有真实 HTTPS 跳转或唤起 | 未验证 |
| VoiceOver / 真机 safe-area / 触屏 | 未运行屏幕阅读器或物理手机 | 未验证 |
| 生产现场 p75 INP ≤200 ms | 未发布、没有 field 数据 | 未验证 |

限速夹具设置每个响应 150 ms 延迟和 200000 字节/秒（1.6 Mbps），不压缩、不做 CPU 降速，也不模拟多个响应共用一条链路。没有可用 Chrome DevTools MCP，因此未输出 Lighthouse 分数、trace 或 INP。此记录是受限本机实验，不能称为标准 4G、低端手机或现场 Web Vitals。

| 390 × 844，DPR 1；不滚动/播放的加载 | LCP 三轮（ms） | CLS 三轮 | 对文档目标的本机结论 |
| --- | --- | --- | --- |
| 待定首页 | 1588 / 1628 / 1604 | 0 / 0 / 0 | 该受限实验满足 2500 ms / 0.1 |
| 合成歌曲页，含短视频海报 | 3432 / 3392 / 3372 | 0 / 0 / 0 | LCP 未通过，不能宣布性能验收完成 |

每轮均在图片完成、采样时刻至少 8 秒后读取，不使用刚返回页面时的临时 LCP。[六轮原始值](T21-evidence/browser/mobile-lab-runs.json)、[首页实际手机尺寸](T21-evidence/browser/16-phone-lab-home-1.png)、[歌曲页](T21-evidence/browser/17-phone-lab-song-1.png)。之前桌面预检和未完成加载采样单独标为 excluded，不计入表格。

[第四轮诊断](T21-evidence/browser/song-lcp-diagnostic.json) 明确 LCP 是短视频海报 `/api/station/content/assets/ca760000-0000-4000-8000-000000000502`，3404 ms，传输 415109 字节（含传输开销），不是音频请求。其余封面各约 243 KB，浏览器 lazy 阈值仍提前请求下方推荐图。当前使用的是可解码 PNG 合成素材，不能通过换一张更小的夹具图宣布产品修复。正式海报/封面尚未确定；应准备有权使用的压缩 WebP/JPEG、按实际显示尺寸控制体积，并在相同网络和指定设备上复测。若仍超标，再根据实际关键资源顺序调整页面加载。**歌曲性能是 T22 发布前的未满足条件，本批没有给出生产性能通过。**

## A01–A22 与发布前剩余条件

[逐项验收矩阵](T21-acceptance-matrix.md) 将模拟核心、原生本机 HTTP/媒体、浏览器实际观察与生产缺口分别列出。A17 本机退出规则不等于生产关闭；780 行来源清单、176 页空正文构建或静态方法提示都不作为生产 URL/身份合同。

生产 MUSIC_DB/R2/Access、0012–0018 实际 schema/迁移账本/清理视图和真实订单权益没有远程核对。网站主推、平台链接、试听开关、视频与素材权利仍“稍后确定”；网页 `stationcat.music.v2` 和原生 `/api/mobile/v1/me/music/*` 独立保留。AASA 仍只覆盖既有音乐根页/认证回调。

T20 所要求的 Worker 优先处理范围尚未进入生产 Assets 配置；五个退出开关任一关闭仍交回原处理。T22 必须先补齐路由合同、确定发布/回退及备份条件，经过实际发布授权后再上线和关闭被替代旧入口，并进行实际 HTTP/方法/权限核验。本批不会启动该工作。

此前审查接受的限制继续保留：已发云 PUT/POST 不取消/回滚，Cookie 与写入并非原子操作；localStorage 比较/setItem 不是跨进程原子操作；游戏退出最多等 1 秒，同源 iframe 无 sandbox；已缓冲完整音频可继续播放，30 秒准备窗口仅限页面会话；失败上传占配额且无对象删除入口，视频不逐帧解码；D1、R2、Access 不跨系统原子提交，发布指针不因后续资源失败自动回滚；旧 src 映射未核验，活动会话不等于唯一访客；清理健康、清理开关和采集开关分别存在。`save_success` 仅表示本机写入后回读成功，不是云同步成功。

如需撤回本批产品变化，仅回退焦点恢复调用/帮助函数即可，不需要数据库回退。移除测试工具或 CI 步骤不改变生产内容、订单或存档。当前交付是可审查的 T21 回归证据与局部修复，未满足的性能/设备/素材/生产条件保留为发布门槛。
