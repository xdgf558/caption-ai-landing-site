# M0 接入决策

2026-09-11 M5 范围补充（用户已确认，待实现）：把“后台选择 WAV → 浏览器内转为 MP3 → 上传”纳入 M5-01 的子任务 M5-01A，单独 PR 实现。管理员不必另开转换软件；页面提供转换/校验/上传进度、取消、明确的失败重试及大文件限制。原 WAV 留在管理员电脑并保留来源信息，服务端接收生成的 MP3，继续执行现有格式、实际时长、大小、配额、独立试听与审核发布校验；客户端转码不授予发布或媒体权限。

转换在管理员浏览器内执行，不在 Cloudflare Worker 运行 FFmpeg，不上传 WAV 母带，也不接付费在线转码。ffmpeg.wasm 仅为可行候选，具体依赖、编码参数、WAV 支持范围、输入上限和浏览器资源预算在 M5 实施时评审；转出的完整/试听 MP3 仍分别限制 32 MiB/4 MiB。转换失败可明确重试，上传结果未知仍须核对原会话，不能因转换流程绕过现有 PUT 恢复约束。本次仅更新计划，不安装依赖、不实施转码、不部署；本地执行记录、截图和 session 材料仍不发布。

2026-09-11 M2-05B：复用独立 MUSIC_DB 的原子计数实现来源/全局限流，不新增服务；类别和分钟进入来源 HMAC，缺 secret/迁移或计数失败均阻断公开内容访问。固定窗口初值须预发验证；10 分钟后可回收、每请求分批回收，不承诺无流量时准点物理删除。诊断仅 Access 只读汇总，原有 Signal 调度保持原状。见 [M2_RATE_LIMITS](M2_RATE_LIMITS.md)。

2026-09-11 M2-05A：清理采用永久 D1 停用记录、双向引用触发器、R2 写入证明与删除后计费回收。先只读 dry-run，每次执行一项，最小保留期为会话到期后 7 天；执行维护开关缺省关闭。已开始写入但对象缺失时保留全部额度，不根据超时猜测可以回收。未改旧业务开关与调度，详见 [M2_CLEANUP](M2_CLEANUP.md)。

2026-09-10 M1-05 补充：#122 已合并，真 MP3 流式解析及本地编码样本/workerd 验证完成，见 [M1_MP3_VALIDATION](M1_MP3_VALIDATION.md)。采用严格支持集和保守编码样本时长，不用 LAME trim 缩短试听限额；不把结构检查当作完整解码、语义同源或 R2 原子性证明。M2 尚未接线，下文较早的未选型表述属历史。

2026-09-10 最新补充：PR #121 已合并。M1-04 条件发布及审核指纹、append-only 回执、零命中回滚 guard 已实现并本地验证，见 [M1_PUBLICATION](M1_PUBLICATION.md)。没有生产路由或真实资源验证器，后续依次 M1-05 与 M2；下方推进段是 M0/M1 初始决策历史，以 CURRENT_PHASE 为准。

日期：2026-09-09。下方保留 M0 接入方案；M1-01/02 数据与纯策略实现见 [M1 基础](M1_FOUNDATION.md)，M1-03 单次主库只读资格及 capabilities/access 合同见 [只读 VIP 适配](M1_VIP_ADAPTER.md)。路由/媒体服务/UI 等仍未接入。完整要求以 [原规格](DEVELOPMENT_SPEC.md) 为准。

## 当前系统与最小边界

| 集成点 | 已核对现状 | 后续方案 |
| --- | --- | --- |
| 构建 | Astro 静态站点；Node >=22.13；BaseLayout + Header/Footer/LanguageSwitcher；无全站 ClientRouter | 沿用现有壳，独立音乐页面和客户端模块，单一 audio；不引入 React/新服务 |
| Worker | `src/worker.js` 同时处理旧业务、Access、动态内容和资源 | 仅插入薄音乐路由，领域/媒体/管理模块独立；未配置音乐不影响原站 |
| 后台 | `/admin-v2/` 现有工作区；Worker 全局 enforceAdminAccess 在 dispatch 前执行 | 后续加入音乐入口；`/admin/api/music/*` 复用相同 JWT/邮箱门禁；不新增登录系统 |
| 写请求安全 | 全局 Access 校验身份；文章 handler 等各自做 Origin 校验 | 音乐管理写请求统一验证同源 Origin/CSRF，不把 Access 误当全局写请求校验 |
| 会员 | 单账号单期限行，详情见 MEMBERSHIP_INTEGRATION | 原会员来源只读适配；现有缺口先记录，禁止另造音乐 VIP 账本 |
| 存储 | 现有 WAITLIST_DB、CONTENT_BUCKET、DOWNLOADS_BUCKET；没有 MUSIC_DB/MUSIC_BUCKET | 音乐 D1/R2 独立，现有会员库仅只读；真实资源创建另获授权 |
| 调度 | 既有 signal cron 和 queue consumers | 音乐自然到期不依赖 cron；清理接入须保留全部原调度，先 dry-run |
| 测试 | npm test、npm run build、既有 Playwright 配置 | 新音乐测试单独接入 CI；现有游戏音乐测试不算本站曲库测试 |

## 路由与语言

计划四语主路径 `/music/`（繁中）、`/zh-hans/music/`、`/en/music/`、`/ja/music/`；`/zh-hant/music/` 作为繁中别名重定向至 `/music/`，保留经过校验的歌曲/歌单查询。四个主路径各自 canonical 与互相 hreflang，别名不进 sitemap。该方案待 M2/M4 实装回归，不声称当前路径存在。

`LanguageSwitcher.astro` 的 standalone 正则目前只有 points/library/terms/privacy。音乐必须有独立的显式语言映射：繁中直接指向 `/music/`，另三语分别指向上述主路径，不能仅将 music 加进 standalone 正则，否则繁中会生成 `/zh-hant/music/`。别名重定向只用于兼容外部链接，不能作为语言切换的正常中转。会员中心仍保持 `/zh-hant/library/` 等现有路径，不随音乐规划改动。

M4 回归必须断言四语音乐页的繁中选项直接为 `/music/`、切换不经过别名、合法歌曲/歌单查询被保留；另测直接访问 `/zh-hant/music/` 时重定向及 canonical/hreflang 一致。上述为未来验收要求，当前没有实现或运行这些测试。

`wrangler.toml` 的 run_worker_first 已有 /api/*、/admin/* 和本地化路径，但缺 /music 与 /music/*；新增时一并检查无尾斜线路由与关闭闸门行为，不能让静态 assets 绕过音乐开关。

实际会员中心是 `/zh-hant/library/`、`/zh-hans/library/`、`/en/library/`、`/ja/library/`，复用 `src/data/reader-library-client.js`。导航、页脚、积分页 VIP 说明和 sitemap 等到音乐验收/上线批准后更新，不提前承诺可用。

播放器仅在音乐页面内部切换详情/搜索/歌单时连续播放。去其他栏目、切语言或整页重载保存进度，回来暂停；不改全站导航。

## 安全与内容

按原规格执行独立 preview/full、服务端限资源 MP3 验证、不可变发布版、权利与技术双门槛。试听测时方案尚未选型，不使用浏览器 duration 或码率估算替代真实帧样本验证。

发布事务必须显式处理 CAS 零命中：SQL 没有抛错不代表业务成功。不能只检查 batch 没报错便推进发布/审计。Cloudflare 对 batch 的说明是语句失败才回滚，业务 guard 仍需设计并实测：[D1Database 官方接口](https://developers.cloudflare.com/d1/worker-api/d1-database/)。

MUSIC_PUBLIC_ENABLED、MUSIC_UPLOADS_ENABLED、MUSIC_VIP_DELIVERY_ENABLED、MUSIC_ANALYTICS_ENABLED 默认 false。保护未知状态，不把 VIP 服务故障变成免费；不缓存私人资格，也不放公开音频域名。

## 推进顺序

2026-09-09 后续确认：PR #118/#119 已部署，用户报告真实兑换、退款后台登录后验收及真实撤销已人工完成。退款采用人工审核，确认关联后只撤未用期限，保留审计，不按负积分取消全部 VIP。无回执/无法验证的历史记录仍需核对。本轮仅批准音乐 M1-01/02 隔离实现，不改原支付，不开放音乐；涉及 UI 必须调用 Product Design 技能。

先交付 M0 证据。M1 从独立本地迁移、领域策略、发布守卫与解析器可行性开始；真实 VIP 适配依赖原会员合同，不能用假 grants 掩盖差异。原会员原子性/幂等、退款撤销和共享返回地址修复分别提出授权与 PR，避免混进音乐功能。

资源创建、生产迁移、部署、真实作品发布、公开/VIP 开闸、统计启用是不同节点；M0 完成只表示风险与接口已梳理，不表示以上任何一项获得批准。
