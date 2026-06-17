# Station Cat 小说连载发布指南

当前采用 Git 内容流：小说和章节都用 Markdown 文件管理，网站构建时自动生成书架、作品页和章节页。阶段三开始，`/admin/` 后台可以直接导入完整 Markdown，不必每次手动进入仓库改文件。

## 目录

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

### 后台导入

1. 打开 `/admin/`。
2. 输入只授权当前 repo 的 GitHub fine-grained token，权限需要 Contents: Read and write。
3. 切到 `連載小說`。
4. 点击 `新小说 Markdown`。
5. 选择 `小说资料`，粘贴完整 Markdown，或点击 `选择 Markdown 文件` 读取本地 `.md` 文件。
6. 点击 `解析 Markdown`，确认目标路径是 `src/content/serials/{seriesSlug}.md`。
7. 点击 `保存小说 Markdown`。

### 手动文件

1. 复制 [serial.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/templates/serial.md:1)。
2. 放到 `src/content/serials/{seriesSlug}.md`。
3. 填好 `title`、`seriesSlug`、`author`、`description`、`tagline`、`status`。
4. 如果这本书要在首页和书架页主推，把 `featured` 设为 `true`。
5. `latestChapterSlug` 和 `latestChapterNumber` 跟最新已发布章节保持一致。

## 新增一章

### 后台导入

1. 打开 `/admin/` 并切到 `連載小說`。
2. 点击 `新小说 Markdown`。
3. 选择 `章节正文`，粘贴完整章节 Markdown，或点击 `选择 Markdown 文件` 读取本地 `.md` 文件。
4. 点击 `解析 Markdown`，确认目标路径是 `src/content/serialChapters/{seriesSlug}-{number}-{chapterSlug}.md`。
5. 点击 `保存小说 Markdown`。

### 手动文件

1. 复制 [serial-chapter.md](/Users/shaola/Downloads/软件开发/多品牌网站开发相关/landing-site/docs/templates/serial-chapter.md:1)。
2. 放到 `src/content/serialChapters/{seriesSlug}-{number}-{chapterSlug}.md`。
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

Admin 的 `連載小說` 面板里已经有可视化收费设置。它会更新小说资料 Markdown 的这些字段：

- `priceMode`：免费、免费 + 打赏、单章购买、分卷购买或会员阅读
- `freeChapters`：展示用免费章节数
- `tipsEnabled`：是否显示作品页打赏区
- `tipAmounts` / `tipCurrency`：打赏金额和币种
- `chapterPriceAmount` / `chapterPriceCurrency`：单章解锁价格
- `supporterPriceAmount` / `supporterPriceCurrency`：支持者解锁价格
- `bundlePurchasesEnabled`：是否开启多章折扣配置
- `chapterBundleDiscounts`：一次购买多章的折扣规则

这些字段不只是页面展示。`npm run build` 会先运行 `scripts/build-novel-payment-config.mjs`，把小说 Markdown 和章节顺序生成到 `src/generated/novelPaymentConfig.js`。Worker 创建 NOWPayments 订单时会读取这个生成配置，并以它作为单章、支持者、打赏按钮和多章折扣的价格来源。

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

每次新增或修改小说内容后，至少跑：

```bash
npm run build
git diff --check
```

如果页面结构、章节顺序、上一章 / 下一章都正确，再开 PR 审查。
