# T10 发行平台入口与降级

本批从 T09 实际合并提交 `7e46ed374597cba3365b10c2bd4dc09e2db51b7a` 开始，沿用 T07 公开查询和 T08 默认关闭的音乐页。完成的范围是平台入口、可用状态和复制降级，未进入 T11，也未修改生产开关、绑定、迁移、游戏或账号支付服务。真实主推、发行链接、试听开关和视频仍按用户答复“稍后确定”保留。

T09 的审查头 `00fe1096ac3b2452d7b1a664c0fc0c45b8336585` 独立托管 CI 已全部成功后合并；[原始 CI](T10-evidence/T09-approved-head-ci.json)、[合并结果](T10-evidence/T09-merge-result.json) 对应同一头。T10 的本地通过和前批 CI 不代替本批头提交的独立托管结果。

## 平台记录与公开投影

继续读取 `station_platform_links`，没有新建发行或会员模型。网易云、汽水、Apple Music 与既有 YouTube、Spotify 使用相同提供商接口。服务端依旧要求所属作品已发布、平台为 `live`、运营核验时间有效且不在未来、URL 满足提供商 HTTPS 白名单、地区适用、运营排序有效，才返回公开 `platforms[]`。URL 核验是后台记录与结构校验，没有执行外部 HTTP 存活检查。

新增公开 `platformAvailability` 只含状态与允许的文字说明，不包含待发行、下架、地区不适用或核验失败的 URL、存储键或私有字段。非法 JSON、未知提供商或无效元数据不用于推断已经发行。可信地区只取 Worker 的 `request.cf.country`；查询参数及伪造 `CF-IPCountry` 不能改变可用性。地区筛选只限制是否可用，不决定用户的平台偏好。

| 数据状态 | 公开行为 |
| --- | --- |
| 可用的 live 记录 | 保留原接口的核验 HTTPS 地址，显示原生链接和复制备用入口 |
| planned | 仅显示提供商及“即将上线”，不输出网址或复制按钮 |
| 全部 removed | 显示目前没有可用入口，不保留旧网址 |
| 已核验但地区不适用 | 显示地区说明，不输出该记录网址 |
| 限地区但访客地区未知 | 提示地区尚未确认，不当成确定的地区拒绝 |
| 无记录、非法或未来核验时间 | 显示待确认，不推断未发行或已下架 |

同一次查询可以同时返回可用链接和其他提供商的待发行/地区说明。查询沿用按 `sort_order,id` 的稳定顺序；首页继续使用运营显式选择的 ID 顺序，没有根据设备、IP 或浏览器自动选平台。公开数组仍限 25 条；前端也检查作品和链接 UUID、状态、核验时间、提供商与 HTTPS 地址，重复链接 ID 全部拒绝，不按到达顺序选第一条。

`buildHomeView()` 的正常链接也收紧到同一提供商 URL 规则。T05 双重标记的独立夹具可继续使用内部说明地址，但内部夹具地址不会进入复制控件。首页组件复用复制降级；它仍未挂载正式首页，本轮的实际浏览器证据来自音乐详情页，首页只有投影回归和构建证据，正式接入后须复核。

## 点击和复制

链接保留原生 `<a href="https://…" target="_blank" rel="noopener noreferrer">`。页面不拦截点击、不调用 `window.open()`、不等待统计请求，也不以倒计时判定平台 App 已打开。仓库没有本期可复用的可靠 App 唤起接入，因此本批只保留 HTTPS 与复制；不写虚构的平台 App 成功状态。

原生 `<details>` 提供“打不开平台？复制链接”，内含有提供商标签的只读 URL。没有 JavaScript 时仍可展开并选取网址，增强复制按钮保持隐藏。有 JavaScript 时，点击或键盘触发后立即调用 Clipboard API；只有 `writeText()` 成功完成才显示已复制，拒绝或缺失时聚焦、选取只读网址并提示手动复制。新的复制尝试和页面卸载会阻止旧结果回写。复制输入、按钮和折叠控件的高度至少 44px，四语言都有文案及 `role=status` 反馈。

内置浏览器打开外链失败时，用户可展开复制入口，在系统浏览器中打开。页面不要求确认已经唤起 App。实际 IAB 验证了 Enter 展开、Enter 复制成功和完整选取只读 URL；拒绝、缺失权限及迟到结果由可控替身验证。没有运行真实微信、网易云、汽水、iOS 或 Android WebView，也没有声称合成地址能够播放真实作品。

`observeStationPlatform()` 只为 T18 预留可选观察回调，白名单维度为公开作品 ID、链接 ID、提供商。同步抛错、Promise 拒绝或一直等待都不改变原生导航。默认没有统计网络请求、会话标识或新事件写入；本批的统计故障证据是观察回调替身，不是生产统计端点故障验收。有效试听仍按主文档口径留给 T18，旧统计系统没有在本批重写。

## 本地预览与验证

先运行 `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build`，再执行 `npm run test:redesign:platforms`。该命令同时运行 12 项策略/复制/本地查询案例和 3 项实际编译 Worker、临时 D1 的页面案例，依赖已构建的 Astro 音乐壳；CI 已安排在正式 Build 和音乐页检查之后，不能在尚无 `dist` 的阶段运行。

`STATION_MUSIC_PREVIEW_PLATFORM_CASES=1 node scripts/serve-station-music-preview.mjs` 开启本地一次性平台夹具，预览为 `http://127.0.0.1:4208/music/tracks/local-sample-1/`。五条导航分别展示可用、未发行、下架、地区不适用及核验无效。地址全部是不存在作品的合成 URL，横幅明确标注；默认未设置该变量时仍不增加任何发行链接。服务只监听 loopback、只接收 GET/HEAD，不转发浏览器凭证，运行时禁止向外网发送请求。

预览夹具曾因 live 记录的空核验时间违反已有 CHECK 而无法启动，已改为 2030 年未来核验时间，继续测试无法公开的状态，没有修改数据库约束。最初 IAB 页面因服务未启动进入错误页，随后按浏览器文档在同一 IAB 创建新标签恢复，没有绕过 URL 策略。

| 检查 | 结果与证据 |
| --- | --- |
| 新平台专项 | 15/15，见 [platforms.log](T10-evidence/platforms.log) |
| 公开查询、页面与首页投影 | 63/63，见 [public-and-pages.log](T10-evidence/public-and-pages.log) |
| 既有公开/音乐 Worker 与关闭态静态包回归 | 18/18，见 [worker-runtime.log](T10-evidence/worker-runtime.log)；最终构建后关闭态另核验 1/1，见 [closed-production-assets.log](T10-evidence/closed-production-assets.log) |
| 本地构建 | 157 页、111 条公开 sitemap 路径，见 [build.log](T10-evidence/build.log)；使用空正文选项，不是生产发布包 |
| 首页独立夹具编译 | 85 页，见 [home-preview-build.log](T10-evidence/home-preview-build.log)；内部说明链接不含真实平台观察标记或复制控件，不代表正式首页已挂载 |
| 最终静态 staging 包 | 8 页、34 个精确依赖，见 [staging-assets.log](T10-evidence/staging-assets.log)，不作为远程部署证据 |
| 浏览器 | 五状态、四语言、键盘复制及手动选择，见 [观察记录](T10-evidence/browser-observations.json)、[视口](T10-evidence/viewport-measurements.json)、[控制台](T10-evidence/browser-console.json)、[设计 QA](T10-evidence/design-qa.md) |

较早的 63 项及 18 项回归在前端核验日期增加 ISO 字符串前缀检查之前执行；最终专项 15 项、构建、截图与关闭态 1 项检查在该收紧后完成。没有把先前日志写成最终构建后全套重跑。T09 播放器核心未变，本批没有重跑其 147 项作为新的独立证明；CI 保留原播放器及账号、支付、原生、游戏检查。

证据及被测源码哈希在 [verification-summary.json](T10-evidence/verification-summary.json)，截图实际尺寸在 [image-metadata.json](T10-evidence/image-metadata.json)。托管结果仍须按提交到 PR 的当前头核对。

## 后续边界

生产 MUSIC_DB 的迁移账本、绑定、清理视图和真实媒体仍未远程确认，两个页面/查询开关继续关闭。没有远程迁移、发行状态配置、生产部署、旧入口关闭或账号清理。下架后重新查询会移除链接，但已经加载的页面不会实时订阅后台变更，不能用同次投影测试证明线上缓存失效。

持续完整播放期间不重新核权、缓冲内容可能继续播完，以及 30 秒准备窗口只在页面会话内，仍是 T09 的已审查 P3 边界。本批没有改动完整播放授权、准备窗口或旧播放器。

实现参考原生链接及剪贴板的官方文档：[HTML a](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a)、[Clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)；Apple 的推广链接说明见 [Apple Music for Artists](https://artists.apple.com/support/1117-apple-music-marketing-tools)。这些资料不证明本期作品已在平台发行。
