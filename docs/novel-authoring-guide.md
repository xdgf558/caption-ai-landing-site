# Station Cat 小说连载发布指南

当前发布入口是 Admin 2.0。

阶段 7G 后，旧 `/admin/` GitHub Token Markdown 编辑器已经退役。小说章节和网站 Blog/Devlog 的日常发布都应通过 `/admin-v2/` 完成：正文进入 R2，元数据、收费规则、导入记录和审计日志进入 D1。

旧 `src/content` Markdown 文件仍保留为历史和回滚来源。需要批量迁移时，在 Admin 2.0 的 `迁移` 页签里先扫描、模拟，再执行导入。

后端化设计见 [backend-content-platform-7a.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/backend-content-platform-7a.md:1)，迁移流程见 [legacy-content-migration-7g.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/legacy-content-migration-7g.md:1)。

## 历史 Markdown 目录

```text
src/content/serials/
  novel-slug.md

src/content/serialChapters/
  novel-slug-001-chapter-slug.md
```

## Slug 规则

- 小说 `seriesSlug` 使用小写英文、数字和连字符。
- 章节 `chapterSlug` 使用小写英文、数字和连字符。
- 章节文件名建议使用 `seriesSlug-章号-chapterSlug.md`。
- 章号固定三位数，例如 `001`、`002`、`012`。

示例：

```text
src/content/serials/deng-hai-liang-zhe.md
src/content/serialChapters/deng-hai-liang-zhe-001-prologue-light.md
src/content/serialChapters/deng-hai-liang-zhe-002-city-after-midnight.md
```

## 新增一本小说

### Admin 2.0

1. 打开 `/admin-v2/`。
2. 在 `内容` 页签点击 `新作品`。
3. 填写标题、Slug、语言、简介、标签、状态和可见性。
4. 在 Markdown 正文区写作品介绍，或点击 `导入 Markdown` 读取本地 `.md` 文件。
5. 在 `Pricing` 区域设置免费/付费/打赏/多章折扣规则。
6. 点击 `打开 Worker 预览` 检查页面。
7. 点击 `保存到后端内容平台`。

### Markdown 模板参考

1. 复制 [serial.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/templates/serial.md:1)。
2. 在本地填写后，通过 Admin 2.0 的 `导入 Markdown` 读取。
3. 填好 `title`、`seriesSlug`、`author`、`description`、`tagline`、`status`。
4. 如果这本书要在首页和书架页主推，把 `featured` 设为 `true`。
5. `latestChapterSlug` 和 `latestChapterNumber` 跟最新已发布章节保持一致。

## 新增一章

### Admin 2.0

1. 打开 `/admin-v2/`。
2. 在 `内容` 页签点击 `新章节`。
3. 填写 `seriesSlug`、章节 Slug、章节序号、标题、摘要、访问级别和发布时间。
4. 在 Markdown 正文区写章节正文，或点击 `导入 Markdown` 读取本地 `.md` 文件。
5. 付费章节把访问级别设为 `paid` 或 `supporter`。
6. 点击 `打开 Worker 预览` 检查门禁或正文展示。
7. 点击 `保存到后端内容平台`。

### Markdown 模板参考

1. 复制 [serial-chapter.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/templates/serial-chapter.md:1)。
2. 在本地填写后，通过 Admin 2.0 的 `导入 Markdown` 读取。
3. `seriesSlug` 必须和小说文件一致。
4. `chapterNumber` 决定目录和上一章 / 下一章顺序。
5. 只有 `status: "published"` 的章节会出现在前台。

## 发布状态

小说状态：

- `planned`：筹备中
- `serializing`：连载中
- `completed`：已完结
- `paused`：暂停更新

章节状态：

- `draft`：草稿，不显示
- `scheduled`：已排期，不显示
- `published`：已发布，显示在目录和章节页

## 阅读权限字段

章节可以标记阅读方式：

- `free`：免费
- `paid`：付费章节
- `supporter`：支持者章节

`paid` / `supporter` 章节会走读者账户、NOWPayments 订单和授权检查。

## 小说收费设置

Admin 2.0 的 `Pricing` 区域是小说收费规则的主入口。它会保存到 D1 `content_pricing_rules`，并供前台 `/api/novels/pricing`、NOWPayments 下单和阅读点解锁使用。

- `priceMode`：免费、免费 + 打赏、单章购买、分卷购买或会员阅读
- `freeChapters`：展示用免费章节数
- `tipsEnabled`：是否显示作品页打赏区
- `tipAmounts` / `tipCurrency`：打赏金额和币种
- `chapterPriceAmount` / `chapterPriceCurrency`：单章解锁价格
- `supporterPriceAmount` / `supporterPriceCurrency`：支持者解锁价格
- `bundlePurchasesEnabled`：是否开启多章折扣配置
- `chapterBundleDiscounts`：一次购买多章的折扣规则

这些规则不再依赖 GitHub Markdown 发布。保存内容后，可以在 Admin 2.0 的 `生效价格预览` 中读取公共 pricing API，确认前台展示和后台设置一致。

多章折扣配置示例：

```yaml
bundlePurchasesEnabled: true
chapterBundleDiscounts:
  - chapters: 5
    discountPercent: 10
  - chapters: 10
    discountPercent: 18
```

开启多章购买后，读者在某个付费章节可以一次解锁从当前章开始、按章节顺序排列的后续多章。Worker 会重新计算应付金额，并在 IPN `confirmed` / `finished` 后为这些章节逐条写入阅读授权。

## 发布检查

代码变更后至少跑：

```bash
npm run build
git diff --check
```

日常内容发布不需要重新部署代码。通过 Admin 2.0 保存并预览即可；如果是生产内容，先确认 Cloudflare Access 正常保护 `/admin-v2/` 和 `/admin/api/*`。
