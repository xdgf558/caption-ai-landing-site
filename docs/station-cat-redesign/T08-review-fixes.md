# T08 复审修订

修订对象为 [PR #193](https://github.com/xdgf558/caption-ai-landing-site/pull/193) 原头 `8a314220ef4365984fd8b691472e8c9807cbecdb` 及第一次修订头 `620ae94bebb01f5b9df5979e8d446766b439da9f`。第二次修订补齐两开关联合接管条件，仍停留在 T08，提交后等待用户复审；没有合并、进入 T09、发布、远程迁移、启用开关或关闭旧入口。

## 关闭态和未映射地址

`handleStationMusicPage()` 在任一开关未开启时，对目录、详情语法及旧分享统一返回 null，交回原命名空间处理器；不读取 D1/R2/ASSETS，不先验证查询和方法。只开页面开关或只开查询开关都不接管这些地址。`/music/tracks/vip/` 不再被新处理器提前返回 503。返回 null 不意味着原处理器有作品详情；既有处理器自行决定状态，当前隔离夹具的音乐公开开关开启时，未知后代仍返回旧 `NOT_FOUND`，非 GET/HEAD 返回旧 `METHOD_NOT_ALLOWED`。

两个开关均开启后，详情查询的 404（查无公开实体或已撤销发布）同样返回 null，不先为该地址生成新详情或规范化跳转。只有实际 T07 查询成功才使用新页面或 302。内部 `music/site-shell` 静态壳保持外部 404；两个开关均开启而实际绑定、schema 或资源不可用时仍拒绝并返回 503。

专项覆盖不完整开关组合的 GET/HEAD/POST、非法查询、详情与旧分享，包含字符串及布尔值开关，绑定 getter 在误读时直接抛错。实际 Worker/D1/R2 覆盖双开关缺失、仅查询开启、仅页面开启；根页、语言别名、无斜线、旧 UUID/专辑/单层后代逐一比对原处理器的状态、相关响应头及正文，详情维持旧 404/405。两个开关均开启的正常 SSR、规范化、未映射详情及缺绑定 503 仍保留验证。

第二次修订先将新关闭态测试运行在第一次修订代码上，复现“仅页面开启的 GET /music/ 返回 Response 而非 null”的失败，再调整入口联合判断。失败复现及本次完整专项、构建、staging 核验日志分别保存于 [开关修订证据](T08-gate-evidence/verification-summary.json)，不覆盖第一次修订证据。

第二次修订的 `npm run test:redesign:music` 为 26/26，staging gate 为 21/21；空正文构建为 157 页、111 sitemap 地址，旧音乐 staging 包仍为 8 页、33 个精确依赖。以上均为本机证据，新提交的完整托管 CI 仍须独立核对。

## 完整播放入口

公开 DTO 的 `fullPlayback` 继续只是旧版本引用的私有握手提示，追加 `requiresAccessCheck: true`；该标记表示尚需核验，不表示已获得免费或会员授权。前端要求精确握手地址和该标记，四语言先显示确认完整收听权限及解释，通过私有会话/旧权限/R2 核验后才显示准备播放。

游客、普通账号和到期会员仍由旧接口拒绝，成功会员仍需旧权益。免费夹具在确认成功前后都不设置 audio src；第二次显式点击才播放。失败、关闭播放器及恢复页面继续回到待确认态。没有根据回填 `site_audio_mode` 发放任何新权益，原生音乐资料库也未改动。

初次新说明在手机网格占据封面列，视觉复核后调整为整行；四语言 320 px 视口无水平溢出。初始/最终截图、实际状态及设计 QA 在 [修订证据](T08-review-evidence/)。

## 预览元数据与 CI 回归

loopback 请求的 canonical、OG URL/图片和 hreflang 现在使用实际本机来源；公开主机仍保持正式域名，不根据转发头选择来源。始终保留 private/no-store 与 noindex；这不完成 T20 正式索引验收。

原头的 [CI](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/37585511430/job/112674592325) 于 2026-10-07 07:37:40 UTC 失败。具体为 `Verify isolated music staging package` 拒绝 `/_astro/musicLyrics.BMGksCdJ.js`；此前 T08 专项、构建和其他已执行步骤通过，后续步骤被跳过，不能称完整 CI 通过。

本次只为该新增共享歌词依赖补充精确文件名族 `musicLyrics.<hash>.js`，没有扩大到任意 `_astro` 文件或新页面/API；增加 GET/HEAD 允许及相近名称、map、POST 拒绝检查。最终构建的本机 staging 包核验为 8 页、33 个精确依赖，通过原核验脚本。修订头托管 CI 仍须独立核对，原头失败记录保持原状。

## 第一次修订验证

- `npm run test:redesign:music`：26/26，包含 15 项单元/SQLite/渲染适配与 11 项实际 Worker/D1/R2/构建壳测试。
- `node --test --test-timeout=90000 scripts/test-station-content-public.mjs scripts/test-station-content-runtime.mjs scripts/test-music-staging-gate.mjs`：56/56。
- `ALLOW_EMPTY_SERIAL_CONTENT=1 npm run build`：157 页、111 sitemap 地址；这是空正文验证构建，不是生产包。
- `node scripts/build-music-staging-assets.mjs`，随后 `node scripts/check-music-staging-assets.mjs`：8 页、33 个精确依赖。
- IAB：四语言窄屏、桌面目录/详情、权限提示、游客拒绝、免费合成资源确认/显式播放/关闭、实际 loopback canonical；最终控制台无 warning/error。模拟视口不等于真机或 VoiceOver。

第一次修订完整日志与 SHA-256 在 [验证清单](T08-review-evidence/verification-summary.json)，第二次开关修订另见 [验证清单](T08-gate-evidence/verification-summary.json)。原 T08 及第一次修订证据各自保留，不能替代新头的托管 CI。第二次修订没有改动 UI，沿用第一次的视觉结果，没有增加真机或新的视觉验收结论。真实推广、平台链接、试听配置及视频继续“稍后确定”，生产 MUSIC_DB 0012 账本/视图仍未远程确认。
