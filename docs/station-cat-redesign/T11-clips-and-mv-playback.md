# T11 短视频与 MV 播放

本批将已发布作品的受控视频从封面导航接入按需播放器。歌曲页与隔离首页复用同一播放器：点击后创建原生 inline video，先暂停网站音频；切换、关闭或离开页面会立即卸载旧媒体；错误提供重试及经过核验的原链接，播放结束提供所属歌曲和当前可用平台入口。

## 基线与范围

用户审查通过 T10 后，独立核对 PR #195 的审查头 `9c68767014b1ef968d5e017d85f0887bcc6661eb`。[托管 CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37622314516/job/112795355911) 于 2026-10-07 13:05:04 UTC 完成，32 个步骤全部成功。随后于 13:14:01 UTC squash 合并为 `7ecaab47e98204ad30a6e5e7a35d10b641311a73`，本批分支 `codex/station-cat-redesign-t11` 从实际主分支建立。独立记录见 [CI](T11-evidence/T10-approved-head-ci.json) 和 [合并结果](T11-evidence/T10-merge-result.json)。

T10 的 P3 边界保留：原 63 项公开查询和 18 项关闭态记录早于最终地址收紧，不能当作其最终源码全套重跑；没有点击合成平台外链或完成 iOS、Android、平台内置浏览器、VoiceOver 验收。本批在最终源码上重跑相关回归，不改写历史证据。

本批不修改 Worker 处理器、迁移、生产绑定、支付、账号或游戏。音乐页仍要求 `STATION_CONTENT_PUBLIC_ENABLED` 和 `STATION_MUSIC_PAGES_ENABLED` 同时开启才接管路径，默认关闭。正式首页仍未挂载；新首页视频行为只在组件及独立本地构建中验收。主推、发行链接、试听开关与真实视频继续“稍后确定”。不执行远程迁移、部署或旧入口关闭，不进入 T12。

## 数据与资源合同

| 接口或组件 | 本批行为 |
| --- | --- |
| `clipView.js` | 只接受所属歌曲一致、当前已发布、数量及字段有界、ID 无歧义的 short_video / mv。封面与视频地址必须为不同的精确 `/api/station/content/assets/<uuid>` 受控路径，不接受外域媒体或私有查询参数。 |
| 首页选片 | 可选公开 clips DTO 只能绑定 T05 首页/推广投影已选的短视频及其所属封面，不能从额外 DTO 添加卡片。普通调用 `clipModels=[]` 保持原详情导航。 |
| 原影片入口 | 只使用已核验、非未来时间且符合现有提供商 HTTPS 规则的原链接；没有合格入口则隐藏。不会把播放器媒体路径显示成第三方原链接。 |
| 播放结束入口 | 只返回该视频所属的当前语言歌曲页及 T10 已上线、核验且适用的平台链接；没有可用平台就只显示歌曲入口。不会自动续播网站音频。 |
| 资源授权 | 沿用 T07 每次访问的发布、所属对象、素材状态、权利及 R2 校验。视频读取不授予完整歌曲播放权益，不改变 T09 私有握手或旧会员判断。 |

首次 HTML 只渲染封面、时长、普通原链接和空 dialog，不含 video、iframe 或 eager media source。歌曲页的播放按钮仅在客户端验证通过后显示；无 JavaScript 保留原链接。首页卡片保留普通详情页加 `#clip-<id>` 的导航：未加载脚本、没有匹配 DTO 或不支持原生 dialog 时仍可进入作品。T07 公开查询本身未改动。

## 播放、互斥与焦点

`clipSession.js` 在用户点击或键盘激活时创建唯一原生 video，设置 controls、playsinline 和 preload=none，并在构造与原生 play 前暂停 T09 会话。视频状态由原生 playing、waiting、pause、ended 和 error 事件确认，play promise 成功本身不被写成“正在播放”。

切换、关闭、错误与销毁都递增尝试版本、取消监听、暂停并删除媒体/封面地址，再 load 和移除旧元素。迟到的 play promise 或原生事件不能恢复旧元素或覆盖新尝试。T09 尚在核权时启动视频会取消该音频意图；新音频 loading/playing/buffering 意图会立即关闭视频。关闭保持音乐暂停，不自动恢复原音频。

原生 dialog 使用可见标题、自动聚焦的关闭按钮和四语言状态文本。关闭操作先停止媒体，再执行最多 150ms 的离场动画；动画完成后焦点回到具体触发卡片，卡片消失时回到主内容。关闭动画不持有播放资源，快速重开或旧 close 事件不销毁新尝试。Tab/Shift+Tab 的 HTML 操作边界留在弹层内，原生视频控件保留自己的键盘顺序。Escape、pagehide 和 Astro 页面卸载均清理媒体与监听。

原生解码错误显示通用失败和重试，NotAllowedError 显示浏览器阻止提示。重试创建新 video；若存在合格原链接则始终可以原生打开。没有新增跨域 iframe、Apple Music 嵌入、App 唤起或统计采集器，后续统计仍留 T18。

## 本地夹具与可复算验证

`tests/fixtures/station-video/gentle-synthetic.mp4` 是已选插画加 440Hz 合成测试音，30 秒、640×360、12fps、H.264/yuv420p + AAC。文件为 239372 字节，SHA-256 为 `e636211940913a0534c5c81c66a11600747860689fc56a07d52bce5f35f7c5b4`。两个不同视频记录共用同一测试文件，仅用于切换验收；另一个 100 字节故意损坏片段验证真实浏览器解码错误，不能当作已解码视频证据。原影片地址为不同的合成提供商链接，不代表实际发行。

可选视频夹具只写一次性本地 D1/R2；默认旧夹具不变。编译 Worker 禁止对外请求，预览只监听 loopback、接受 GET/HEAD、不转发浏览器 Cookie 或授权头，并加 noindex/no-store。独立首页图使用本地 T07 公开查询返回的四语言首页和 clips DTO，输出到 `.generated/station-clip-home-preview`；没有加入正式页面图或部署配置。

最后一次源码构建及完整回归的原始日志、SHA-256 和源码哈希见 [验证摘要](T11-evidence/verification-summary.json)。所有测试在最终首页接入及播放结束入口完成、主构建和独立首页构建成功后执行：

| 验证 | 通过数 | 原始日志 |
| --- | ---: | --- |
| 视频策略、DOM 替身及编译 Worker/D1/R2 | 31（22 + 9） | [clips.log](T11-evidence/clips.log) |
| 公开查询与资源回归 | 35 | [public.log](T11-evidence/public.log) |
| 音乐页面回归 | 26 | [music.log](T11-evidence/music.log) |
| 平台入口回归 | 15 | [platforms.log](T11-evidence/platforms.log) |
| 音频播放器回归 | 147 | [player.log](T11-evidence/player.log) |
| 首页投影回归 | 19 | [home.log](T11-evidence/home.log) |
| 生产关闭态静态资源回归 | 1 | [closed-production-assets.log](T11-evidence/closed-production-assets.log) |
| 合计 | 274 | 全部通过，无失败/跳过 |

`ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build` 成功生成 157 页，独立首页预览生成 4 页，本地 staging 构建和资源依赖核验通过。两份构建日志以 gzip 保留原始字节（包括构建器的行尾空格），摘要分别记录压缩文件及原始内容哈希；测试日志保持纯文本。空正文选项只用于本地验收，不是生产包。上述本地记录不能代替本 PR 实际头的托管 CI。

```sh
ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build
node scripts/build-station-clip-home-preview.mjs
npm run test:redesign:clips
STATION_MUSIC_PREVIEW_VIDEO_CASES=1 STATION_MUSIC_PREVIEW_HOME_CLIPS=1 node scripts/serve-station-music-preview.mjs
```

本机首页为 `http://127.0.0.1:4208/__preview/home-clips/zh-Hant/`，歌曲视频测试为 `http://127.0.0.1:4208/music/tracks/vip/`。四语言首页分别使用 zh-Hant、zh-Hans、en、ja 的预览路径；歌曲页使用正式形状的语言前缀。运行 encoder 的可选重建方法见 [夹具说明](../../tests/fixtures/station-video/README.md)，CI 只读取已核对的文件，不下载 encoder。

## 浏览器证据与验收边界

本机 Codex IAB/Chromium 核对首页与歌曲页点击播放、音乐已播放后启动视频、连续切换、自然播放结束、错误重试、Escape/Tab/Shift+Tab 焦点及四语言。最终五种 CSS 视口为 1440×900、768×900、390×844、375×844、320×740；宽度无水平溢出，关闭与选择控件至少 44px。实际状态见 [browser-observations.json](T11-evidence/browser-observations.json)、[viewport-measurements.json](T11-evidence/viewport-measurements.json) 和 [设计 QA](T11-evidence/design-qa.md)。记录将早期观察与完整最终源码观察分开，150ms 关闭动画的即时/完成状态也分别记载。

浏览器真实完成合成 MP4 解码播放、暂停音频、自然 ended 和故意坏片段的 error。浏览器授权拒绝、迟到核权、计时器竞态、pagehide/dispose 与未支持 dialog 等通过可控 DOM/会话策略验收，不冒充真实移动浏览器证明。没有以 evaluate 修改 DOM、存储或权限制造成功。当前标签 warn/error 控制台记录为空；本地请求记录只含公开路径、方法、变体和响应状态。

A06 的本地互斥与清理路径已验证；A09 有真实解码失败和策略级授权拒绝；A22 有本机键盘与语义标签验证，但真实 VoiceOver 尚未验收。这些任务证据不自动标记相关整体验收通过。真实 MV、音轨和使用权、iOS/Android/内置浏览器、读屏、生产 schema/绑定及缓存撤销仍需后续核验。T09 完整音频持续播放不重新核权、缓冲可能播完及 30 秒准备窗口仅在页面会话的 P3 限制继续保留。

PR 停在用户审查。合并本批不授权生产开关、部署或旧入口/旧播放器关闭。
