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
5. 选择 `小说资料`，粘贴完整 Markdown。
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
3. 选择 `章节正文`，粘贴完整章节 Markdown。
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

当前阶段仍然是静态展示，不做真实支付拦截。

但章节可以先标记未来阅读方式：

- `free`：免费
- `paid`：未来付费章节
- `supporter`：未来支持者章节

这些字段会在目录和章节页展示，为后续 NOWPayments 和账户系统预留位置。

## 发布检查

每次新增或修改小说内容后，至少跑：

```bash
npm run build
git diff --check
```

如果页面结构、章节顺序、上一章 / 下一章都正确，再开 PR 审查。
