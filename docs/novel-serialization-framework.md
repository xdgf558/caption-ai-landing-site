# Station Cat 小说连载与付费阅读框架

## 目标

在现有 `Station Cat` 主页和站点结构上，新增一个长期可扩展的小说发布板块，用来承载：

- 长篇小说连载
- 免费章节阅读
- 打赏作者
- 单章 / 分卷 / 全书付费阅读
- 后续扩展为会员、预售、番外和实体周边

这个框架优先贴合当前仓库能力：

- 前台：Astro 静态内容页
- 动态层：Cloudflare Worker
- 数据：Cloudflare D1
- 现有内容体系：`astro:content`

不建议把它做成一个完全独立的新站。更适合把它做成 `Station Cat` 主页里的新内容支柱，和现在的 `Apps / Serials / Dev Blog` 并列。

## 产品定位

这个板块不要被设计成“普通博客”或“文档列表”，而应该是一个清晰的小说阅读入口。

建议名称：

- 中文：`连载小说` / `小说站台`
- 英文：`Serial Fiction`
- 日文：`連載小説`

建议读者心智：

- 可以先免费读开头
- 喜欢再打赏
- 追更读者可以买单章或整卷
- 长期支持者可以获得提前章节或番外

## 主页框架

### 1. 首页新增一个内容板块

在 [src/components/StationHome.astro](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/src/components/StationHome.astro) 里新增一个独立 section，位置建议放在：

- `Tools on the bench` 之后
- `Build log` 之前

这样它既不是工具区的附庸，也不会被当成普通文章列表。

### 2. 首页板块结构

建议做成一个“书架 + 连载状态”的组合，而不是一排普通卡片。

区块内容：

- 一个主视觉小说卡
- 小说名
- 一句话简介
- 当前更新状态
- 最近更新章节
- 两个主按钮

按钮建议：

- `开始阅读`
- `支持作者`

辅助信息建议：

- `连载中`
- `已更新至 第 12 章`
- `每周二 / 周五更新`
- `前 3 章免费`

### 3. 首页可扩展形式

如果后面你不止一部长篇，可以从“一本主推 + 两本次级入口”扩展成：

- `Featured serial`
- `Recent updates`
- `Completed works`

## 站点信息架构

第一版先直接复用现有 `works/` 路由壳层，把用户看到的入口改造成小说阅读模块。等内容稳定、后台和付费体系落地后，再决定是否迁移到独立 `serials/` 路由组。

### 核心路由

- `/works/`
  - 小说首页，展示所有连载 / 已完结作品
- `/works/[series]/`
  - 单本小说主页
- `/works/[series]/[chapter]/`
  - 章节阅读页
- `/works/[series]/support/`
  - 打赏与购买入口页（后续阶段）
- `/library/`
  - 用户已购章节 / 已解锁书库

### 多语言路由

沿用现有站点做法：

- `/zh-hans/works/`
- `/works/` 作为英文默认，`/zh-hant/works/` 作为繁中入口
- `/en/works/` 可保留为壳层别名
- `/ja/works/`

但第一阶段不要强迫每章四语同步。可以先这样处理：

- 小说正文只发布主语言版本
- 站点导航、按钮、付费提示、状态文案保持多语言
- 如果将来有翻译版，再给章节增加 `language` 维度

## 内容模型

### 1. 新增内容集合

在 [src/content.config.ts](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/src/content.config.ts) 里新增两个 collection：

- `serials`
- `serialChapters`

### 2. `serials` 建议字段

每本书一份元数据：

```ts
title: string
slug: string
description: string
coverImage: string
status: 'serializing' | 'completed' | 'paused' | 'planned'
language: 'zh-Hant' | 'zh-Hans' | 'en' | 'ja'
updateSchedule?: string
tags: string[]
featured: boolean
priceMode: 'free' | 'tip-optional' | 'chapter-paid' | 'volume-paid' | 'member'
freeChapters: number
latestChapterSlug?: string
latestChapterNumber?: number
publishedAt: date
updatedAt?: date
```

### 3. `serialChapters` 建议字段

每章一个 markdown / mdx 文件：

```ts
seriesSlug: string
chapterNumber: number
chapterSlug: string
title: string
excerpt: string
status: 'draft' | 'scheduled' | 'published'
access: 'free' | 'paid' | 'supporter'
wordCount?: number
publishedAt?: date
updatedAt?: date
nextChapterSlug?: string
prevChapterSlug?: string
volume?: string
```

### 4. 内容目录建议

```text
src/content/serials/
  long-novel.md

src/content/serialChapters/
  long-novel-001.md
  long-novel-002.md
  long-novel-003.md
```

## 页面框架

### 1. 小说首页 `/works/[series]/`

这是最重要的中间页，既要像产品页，也要像作品页。

建议模块：

- 封面 + 标题 + 简介
- 连载状态
- 更新时间 / 更新频率
- 免费阅读范围
- 最近章节
- 目录
- 支持作者区
- 阅读须知

CTA 建议：

- `从第一章开始`
- `阅读最新一章`
- `打赏作者`
- `购买本卷`

### 2. 章节页 `/works/[series]/[chapter]/`

章节页的重点不是花哨，而是阅读稳定。

建议模块：

- 章节标题
- 章节编号
- 发布时间
- 正文
- 章节底部导航
- 打赏 / 购买 / 解锁 CTA

如果是付费章节：

- 不要一上来整页锁死
- 建议保留：
  - 章节标题
  - 简介 / 前言
  - 前 1 到 3 段试读
  - 解锁按钮

### 3. 支持页 `/works/[series]/support/`

这个页面承担转化，不只是“放一个支付按钮”。

建议拆成三段：

- `请作者喝咖啡`
- `解锁单章`
- `支持整卷 / 全书`

每段都要写清楚读者得到什么。

## 付费模式框架

### 建议不要一开始就做太复杂

最适合你的顺序是：

1. 免费阅读 + 打赏
2. 单章付费
3. 分卷购买
4. 长期支持会员

### 推荐的权限层级

#### `free`

- 所有人可读

#### `supporter`

- 打赏过的读者可读特典、番外或提前章节

#### `paid_chapter`

- 买过单章即可读该章

#### `paid_volume`

- 买过整卷即可读这一卷所有章节

#### `member`

- 月度支持者可读全部连载或指定作品

## 打赏与支付架构

### 推荐策略

为了和你现在的站点结构最顺，建议支付层做成“支付提供商抽象层”，不要把业务逻辑直接写死在某一家支付平台上。

也就是：

- Worker 负责创建订单、接收 webhook、发放阅读权限
- 支付平台只负责收款

### 第一阶段建议

#### 打赏

最简单：

- 使用 `NOWPayments Donation Tools` 或 `Payment Button` 做打赏入口
- 用单独的小说支持页承接作者说明、打赏用途和感谢文案

适合原因：

- 上线快
- 不需要先做复杂商品系统
- 可以先验证有没有读者愿意支持

#### 付费阅读

建议使用 `NOWPayments Payment API` 创建动态订单，而不是把“单章购买”也都做成静态按钮。

原因：

- 章节价格、卷价格、活动折扣更灵活
- 更适合用 `IPN / webhook` 发放阅读权限
- 后面扩成会员也更顺

### 为什么这样拆

打赏和购买本质不同：

- 打赏：支持作者，不要求严格授权
- 购买：需要稳定发放阅读权限

所以前者可以先快，后者需要可验证。

### NOWPayments 主通道建议

建议把 `NOWPayments` 作为唯一主通道，并在 Worker 里把它封成一个 provider 模块。

这样拆最稳：

- 打赏：优先用 `Donation Tools` 或 `Payment Button`
- 单章 / 分卷购买：统一走 `Payment API`
- 订单回调：统一收进 `POST /api/novels/webhooks/nowpayments`

这样做的好处是：

- 首页或支持页可以很快挂上可用的打赏入口
- 付费章节仍然保持可控的订单与授权逻辑
- 以后要加别的支付方式，也只是在 Worker 里再接一个 provider

### 币种与定价建议

站内价格建议始终用法币做主价格源，例如：

- `USD`
- `CNY` 对应的站内展示价

但在创建支付时，再由 Worker 调用 `NOWPayments` 生成实际支付订单。

这样不要把章节价格直接写死成某一种币值，因为：

- 加密货币价格会波动
- 后面做促销或调整章节价格更方便
- 同一章可以允许读者自行选择不同支付币种

第一阶段建议只开放少量可理解的币种：

- `USDTTRC20`
- `USDTERC20`
- `USDC`

如果你想兼顾更广用户，再额外开放：

- `BTC`
- `ETH`

### 订单状态与权限发放

`NOWPayments` 这类加密支付比普通卡支付更需要状态分层。

建议 `novel_orders.status` 至少支持：

- `waiting`
- `confirming`
- `confirmed`
- `finished`
- `failed`
- `expired`
- `refunded`

权限发放规则建议：

- `confirmed` 或 `finished` 才发放付费阅读权限
- `waiting` / `confirming` 只显示“付款确认中”
- `failed` / `expired` 不发权限
- `refunded` 需要走人工复核或手动回收策略

### 退款与文案边界

因为加密支付和普通信用卡支付体验不同，建议在支持页和章节解锁页都明确写清：

- 支付成功后通常需要等待链上确认
- 一旦章节权限发放，默认不自动退款
- 如需特殊处理，走人工客服邮箱

这样能避免后面因为读者不理解支付流程而产生纠纷。

## 账户与权限框架

你现在站里还没有真正的用户系统，所以这里不要一上来做用户名密码。

### 推荐登录方式

第一阶段建议：

- 邮箱登录
- Magic link

理由：

- 对小说读者更轻
- 购买记录好绑定
- 不需要维护密码找回

### 用户最小模型

建议 D1 中至少有：

- `reader_accounts`
- `reader_sessions`
- `novel_orders`
- `novel_entitlements`
- `novel_tips`

### 权限判断逻辑

章节页请求时：

1. 识别用户 session
2. 查询该用户对该章节或该卷是否有 entitlement
3. 有权限则返回全文
4. 没权限则返回试读 + 购买模块

## D1 数据表建议

### `novel_series`

记录作品本身：

- `id`
- `slug`
- `title`
- `status`
- `price_mode`
- `free_chapter_count`
- `featured`

### `novel_chapters`

记录章节元信息：

- `id`
- `series_id`
- `chapter_number`
- `chapter_slug`
- `title`
- `access_level`
- `price_cents`
- `status`

### `reader_accounts`

- `id`
- `email`
- `normalized_email`
- `display_name`
- `created_at`

### `reader_sessions`

- `id`
- `reader_id`
- `session_token_hash`
- `expires_at`

### `novel_orders`

- `id`
- `reader_id`
- `provider`
- `provider_order_id`
- `provider_payment_id`
- `order_type`
- `series_id`
- `chapter_id`
- `price_amount`
- `price_currency`
- `pay_amount`
- `pay_currency`
- `payment_url`
- `status`
- `provider_status`
- `expires_at`
- `created_at`

### `novel_entitlements`

- `id`
- `reader_id`
- `series_id`
- `chapter_id`
- `access_type`
- `source_order_id`
- `granted_at`
- `expires_at`

### `novel_tips`

- `id`
- `reader_id`
- `series_id`
- `provider`
- `provider_payment_id`
- `provider_order_id`
- `amount_cents`
- `currency`
- `message`
- `status`
- `created_at`

## Worker API 框架

建议在 [src/worker.js](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/src/worker.js) 上新增一组小说接口，而不是把所有逻辑塞进页面端。

### 建议 API

- `POST /api/novels/auth/request-link`
- `POST /api/novels/auth/verify`
- `POST /api/novels/tips/create`
- `POST /api/novels/checkout/create`
- `POST /api/novels/webhooks/nowpayments`
- `GET /api/novels/library`
- `GET /api/novels/access?series=...&chapter=...`

### 责任分工

Astro：

- 渲染页面
- 展示目录和试读
- 调用 Worker API

Worker：

- 订单创建
- `NOWPayments` 回调验签
- entitlement 发放
- 会话校验
- 已购书库查询

### NOWPayments 在 Worker 里的职责建议

可以把支付层拆成下面 4 个动作：

1. `createTipOrder`
   - 创建打赏订单
   - 返回支付链接或支付二维码数据
2. `createReadingOrder`
   - 创建单章 / 分卷购买订单
   - 记录 `series_id` / `chapter_id` / `reader_id`
3. `handleNowPaymentsWebhook`
   - 校验 IPN
   - 更新订单状态
   - 发放或拒绝 entitlement
4. `getReaderLibrary`
   - 汇总读者已解锁章节和已购卷

建议额外准备的环境变量：

- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
- `NOWPAYMENTS_PAYOUT_WALLET` 或你的收款配置

## 首页与导航改造建议

### 顶部导航

现有 [src/data/navigation.ts](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/src/data/navigation.ts) 建议新增一项：

- `小說` / `小说` / `Serials` / `連載`

路径：

- `/works/`

### 首页板块文案建议

繁中：

- 标题：`正在連載的長篇小說`
- 副文案：`這裡會連載我自己製作的長篇故事。可以先免費讀開頭，喜歡再繼續追更或支持作者。`

简中：

- 标题：`正在连载的长篇小说`
- 副文案：`这里会连载我自己制作的长篇故事。可以先免费读开头，喜欢再继续追更或支持作者。`

英文：

- `Long-form serial fiction in progress`

日文：

- `連載中の長編小説`

## 推荐的分阶段上线顺序

### Phase 1：内容先上线

先做：

- 小说首页板块
- 小说列表页
- 单本小说页
- 章节页
- 免费试读

暂时不做：

- 登录
- 付费权限

目的：

- 先开始连载
- 验证读者是否愿意追更

### Phase 2：加打赏

新增：

- 支持页
- `NOWPayments` 打赏按钮
- 打赏记录表
- 打赏后感谢页

目的：

- 先验证愿意付费支持的人群

### Phase 3：加付费阅读

新增：

- 邮箱登录
- 支付订单
- entitlement
- 已购书库
- 付费章节解锁
- `NOWPayments IPN` 回调处理

目的：

- 真正建立可持续变现

### Phase 4：高级运营

后续可加：

- 提前章节
- 分卷售卖
- 完结包
- 会员制
- 评论 / 读者卡片
- 催更订阅

## 具体到当前仓库的新增文件建议

### 内容层

- `src/content/serials/`
- `src/content/serialChapters/`

### 数据层

- `src/data/serials.ts`
- `src/data/serials.ts`

### 页面层

- `src/pages/works/index.astro`
- `src/pages/works/[series]/index.astro`
- `src/pages/works/[series]/[chapter].astro`
- `src/pages/works/[series]/support.astro`
- `src/pages/library.astro`

### 组件层

- `src/components/SerialsHubPage.astro`
- `src/components/SerialCard.astro`
- `src/components/SerialChapterList.astro`
- `src/components/SerialDetailPage.astro`
- `src/components/SerialChapterPage.astro`
- `src/components/PaywallCard.astro`
- `src/components/SupportAuthorCard.astro`

### 动态层

- `src/worker.js` 增加小说 API

### 数据库迁移

- `migrations/0003_novel_series.sql`
- `migrations/0004_novel_reader_access.sql`

## 我对你这个站的推荐方案

如果按“最稳、最像你现在网站”的方向，我建议你这样做：

1. 先把小说作为 `Station Cat` 首页里的第四个内容支柱，和 `Apps / Serials / Dev Blog` 并列。
2. 先上线免费连载和打赏，不要第一天就把整套付费墙堆上去。
3. 付费阅读按“章节试读 + 解锁全文”做，不要按段落碎片化付费。
4. 技术上坚持 `Astro content + Worker + D1` 这条线，不引入笨重 CMS。
5. 支付层做成 provider abstraction，但主实现直接落在 `NOWPayments`，后续如果你要补别的支付方式，再在 Worker 层扩展。

## 最终建议

最适合你的不是“小说博客”，而是一个：

- 有作品感的小说主页
- 有章节秩序的阅读系统
- 有创作者支持入口的变现闭环

也就是说，它应该更像：

- `作品站台 + 连载系统 + 轻量会员框架`
- `内容发布 + 打赏支持 + 付费解锁`

而不是：

- `普通文章分类`

如果你要继续往下做，我建议下一步直接进入页面和数据结构落地：

1. 先做首页小说板块和 `/works/` 列表页
2. 再做 `astro:content` 的 `serials` / `serialChapters` 集合
3. 最后接打赏和付费权限
