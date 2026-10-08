# T13 游戏运行与媒体协调

日期：2026-10-08。分支 `codex/station-cat-redesign-t13`，基线为 T12 实际 squash 合并提交 `31ba265c2a125c35f8d17204cb160e96e433e967`。用户授权本批开发及独立 PR，审查后才继续 T14。

## 行为与运行边界

从新版游戏介绍的已核对入口点击进入时，先关闭 T11 视频并销毁视频节点，暂停 T09 音乐、撤销完整播放准备与待处理握手、卸载音频源，再创建一个同源游戏 iframe。运行时隐藏站点导航、页脚和播放器，父页面锁定滚动。游戏账号状态、云冲突和内部导航保留。原登录链接使用 `_top`，进入既有账号页；账号页的 framing 防护不放宽。

外部返回按钮保持可见，手机最小高度 44px，原生 dialog 支持 Escape。正常退出向当前游戏发送消息，游戏沿用 T12 的受保护保存路径，暂停 tick/BGM 与后续排队的云同步，再确认停止。父页面最多等待 1 秒，随后设为 about:blank、移除 iframe、清除该实例的监听和计时器。失败、超时、重试、页面离开及 BFCache 返回均退役旧实例。返回聚焦原入口，失败聚焦重试；异步只读核对完成时协调焦点，用户后续操作不会被强制抢回。

音乐返回后仍暂停，仅可恢复公开曲目及进度，不恢复完整音频地址或自动播放。音乐页与游戏页复用一个持久播放器，Astro 切换到不含播放器的页面时销毁会话。游戏期间拒绝新音乐播放/完整核权，父页面捕获原生媒体 play 也会暂停它。

介绍仍为 `/{locale}/games/cat-life-game/`，引擎仍为 `/games/cat-life/`。无 JavaScript 和修饰键打开仍使用既有运行链接。本批不创建新的引擎、账号、支付或存档系统。

## 就绪与退出协议

| 字段/状态 | 合同 |
| --- | --- |
| protocol / game_id | `station-cat-game/v1` / 固定 `cat-life` |
| launch_id | 每次用户尝试新建 UUID v4，仅关联当前实例，不是账号授权 |
| origin / source | 当前站点 origin 与当前 iframe contentWindow；退出来自当前 parent |
| ready | 既有 startGame() 完成且未阻止存档才发送；iframe load 不算成功 |
| recovery | 独立恢复状态，清除启动计时；迟到 ready 不能改为成功 |
| failed | 启动前引擎异常或脚本失败；可选图片错误不误判为引擎失败 |
| exit / stopped | 当前父页退出请求与运行端停止确认；旧消息不能影响重试 |

默认启动超时 `GAME_START_TIMEOUT_MS=20000`，停止确认上限 `GAME_STOP_TIMEOUT_MS=1000`。本机合成媒体/87 金币存档的正常就绪记录约 82–118ms，不是生产性能测量。缺少就绪桥接的夹具实际超时后恢复导航，保留可读存档并显示重试。超时控制器不调用新建、删除或重置存档 API。启动中快速返回后，迟到账号核对不能创建游戏。

## 默认关闭与 HTTP

`STATION_GAME_PAGES_ENABLED` 与 `STATION_CONTENT_PUBLIC_ENABLED` 必须同时为 true。任一关闭时，运行策略适配器在方法、地址校验或读取 ASSETS 前返回 null；目录/作品页沿用 T12 关闭态合同。

仅精确 `/games/cat-life/`、GET/HEAD、单个 `sc_entry=1` 和单个有效 UUID v4 `sc_launch_id` 的成功 HTML 允许同源嵌入：`frame-ancestors 'self'`、`X-Frame-Options: SAMEORIGIN`、private/no-store/noindex。其他游戏、脚本、未标记/重复/非法参数、独立运行和半开状态不改变原响应。GET 沿用响应流，HEAD 取消未使用的体。`public/_headers` 的 DENY/`frame-ancestors 'none'` 默认策略未修改。

经典桥接在独立窗口、未标记或非法地址上不启用。消息不带存档、账号、音频地址或鉴权令牌。没有开生产开关、远程迁移、发布、旧入口关闭或新增事件采集。

## 本机证据与复现

`npm run preview:redesign:game-session` 构建私有八页 Astro 图并启动 [loopback 预览](http://127.0.0.1:4213/games/cat-life-game/)。临时 Worker、D1/R2、合成音视频、游客会话及故障均为夹具；只接受 loopback Host 的 GET/HEAD，不转发真实 Cookie/Authorization，出站请求禁用。目录由实际 Worker 处理，游戏是现有引擎。私有页面和测试控件不进入生产构建；播放器及测试触发器在同一模块图中，避免第二个音乐控制器。

最终本机检查：媒体/会话/入口专项 68 项、作品/存档/实际 Worker 专项 52 项通过；既有音乐页 26 项、平台 15 项和短视频 32 项通过。去掉重复入口/视频用例后合计 164 个不同专项用例。完整 npm test 通过。主构建通过，仍使用 `ALLOW_EMPTY_SERIAL_CONTENT=1`，不是生产正文包；私有图 8 页；staging 核验 8 页/35 个精确资源。

IAB 实际操作覆盖试听→游戏、视频→游戏、返回焦点、Escape、Astro 跨页播放器、两次失败重试、缺少就绪超时、延迟会话快速返回、损坏恢复与原文保留。最终重启后的 DOM 观察在 `T13-evidence/browser-observations.json`；正常运行 warn/error 为空，故意脚本 503 单列为故障。

四语言 360/1440、繁中 768/1280 和 390×844 有运行截图。批量浏览器会话中断后，四语言手机及日文桌面尺寸重新逐项保存于 responsive.json；未落盘的批量 DOM 数值不计为独立测量。已记录的返回按钮至少 44px，父页无横向溢出。

完整日志、源码/证据 SHA-256 与摘要在 T13-evidence 的 verification-summary.json、source-manifest.json、evidence-manifest.json。首次适配器失败原始日志保留，沙箱超时仅保留执行记录（见 execution-notes.md）：首次放行后，资源夹具误把 Miniflare 第二参数当目录，引起 7 个失败，已改为单参数包装，最终 52 项重跑通过。它是测试适配器问题，不改写失败记录。

## 验收范围与待办

| 验收 | 本批证据 | 仍未证明 |
| --- | --- | --- |
| A07/A08 媒体协调与恢复 | 实际 T09/T11 控制器、iframe、单实例清理与点击/键盘返回 | iOS/Android、内置浏览器、VoiceOver、生产媒体 |
| A13 存档保护 | 实际旧 main 的损坏原文、待处理核对退出、受保护停止；浏览器恢复原文保留 | 生产云冲突、真实账号/订单、原文导出落盘 |

T12 限制保留：已经发出的云 PUT/POST 不因退出而取消或回滚；Cookie 核对与服务端写入不是原子操作，localStorage 比较与 setItem 也不是跨进程原子操作。本批仅停止后续排队同步和实例，不把这些窗口标为修复。

生产 MUSIC_DB 的 0012 账本/清理视图、ASSETS 策略在真实边缘的组合、R2 权利与撤销仍需独立确认。主推/平台链接/试听开关/视频仍由用户稍后确定。托管 CI 对本 PR 精确头单独判断，本机通过不替代它。T14 未开始，合并和生产动作不在本批范围。

技术参考：[postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)、[frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)、[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。
