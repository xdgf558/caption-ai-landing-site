# NovelForge Writing API 5

第五阶段把网站后台已经聚合好的阅读统计、AI 洞察和趋势数据开放给 NovelForge 写作端读取。这个接口是只读机器接口，不替代 Admin 2.0，也不会修改正文、收费规则或读者数据。

## Auth

所有接口都使用和导入接口相同的 Bearer token：

```http
Authorization: Bearer <NOVELFORGE_PUBLISH_TOKEN>
X-NovelForge-Contract: station-cat-novelforge-analytics.v1
```

`X-NovelForge-Contract` 可以省略。为了兼容旧客户端，也接受 `station-cat-novelforge-import.v1`。章节正文接口也接受 `station-cat-novelforge-content.v1`。如果传入其他 contract，会返回 `NOVELFORGE_CONTRACT_HEADER_UNSUPPORTED`。

## Endpoints

### 单章正文

```http
GET /api/novelforge/chapters/:chapterId/content
GET /api/novelforge/chapters/:seriesSlug/:chapterSlug/content
```

`chapterId` 推荐使用网站返回给 NovelForge 的远端章节 ID，例如 `chapter_8`。也可以用 `:seriesSlug/:chapterSlug` 组合读取指定章节。接口会读取网站后端内容平台当前保存的正文，优先返回 R2 中的 Markdown；如果只有 HTML，会转换成适合软件端读取的纯文本。

返回结构会在顶层直接提供软件端最常用字段：

```json
{
  "ok": true,
  "id": "chapter_8",
  "title": "章节标题",
  "body": "网站当前公开正文",
  "status": "published",
  "updatedAt": "2026-06-28T00:00:00.000Z",
  "bodyFormat": "markdown",
  "source": "markdown-r2"
}
```

### 单章统计

```http
GET /api/novelforge/analytics/chapter/:chapterIdOrSlug?windowDays=30
GET /api/novelforge/analytics/chapter/:seriesSlug/:chapterSlug?windowDays=30
GET /api/novelforge/analytics/chapter?seriesSlug=book&chapterSlug=ch8&windowDays=30
```

`chapterIdOrSlug` 单独使用时必须是 NovelForge 保存的远端 ID，例如 `chapter_8`。如果使用章节 slug，必须同时提供作品 slug：要么走 `/chapter/:seriesSlug/:chapterSlug`，要么走 `?seriesSlug=book&chapterSlug=ch8`。这样可以避免不同作品里同名章节 slug 拿错统计。返回内容包括章节元信息、旧阅读路径、Novel V2 阅读路径和当前窗口的 `chapter_stats`。

### 单章 AI Insight

```http
GET /api/novelforge/analytics/insights/:chapterIdOrSlug?windowDays=30
GET /api/novelforge/analytics/insights/:seriesSlug/:chapterSlug?windowDays=30
GET /api/novelforge/analytics/insights?seriesSlug=book&chapterSlug=ch8&windowDays=30
```

返回 `ai_insights` 中已生成的结构化洞察，并附带同窗口的 `chapter_stats`。如果统计重新聚合后洞察还没有重新生成，`insight.stale` 会是 `true`。

### 作品趋势

```http
GET /api/novelforge/analytics/trend/:bookIdOrSlug?windowDays=30&limit=50
GET /api/novelforge/analytics/trend?seriesSlug=book&windowDays=30&limit=50
```

`bookIdOrSlug` 可以是 `work_2` 或作品 slug。返回整本书当前窗口内的章节统计列表，按章节序号排序，适合 NovelForge 写作端绘制章节表现趋势。

## Query

- `windowDays` / `sinceDays`: 统计窗口，1 到 365 天，默认 30。
- `locale` / `language`: 内容语言，默认 `zh-Hant`。
- `seriesSlug` / `series` / `bookSlug`: 作品 slug。
- `chapterSlug` / `chapter`: 章节 slug。
- `limit`: 趋势列表上限，1 到 100，默认 50。

## Response Shape

接口统一返回 `cache-control: no-store`。

```json
{
  "ok": true,
  "stage": "novelforge-writing-api-5",
  "resource": "chapter",
  "windowDays": 30,
  "chapter": {
    "remoteId": "chapter_8",
    "entryType": "novel_chapter",
    "slug": "ch8",
    "parentSlug": "book",
    "title": "Chapter Eight",
    "paths": {
      "public": "/novel/book/chapter/ch8/",
      "legacy": "/zh-hant/works/book/ch8/",
      "readerV2": "/novel/book/chapter/ch8/"
    },
    "urls": {
      "public": "https://wwwstationcat.org/novel/book/chapter/ch8/",
      "legacy": "https://wwwstationcat.org/zh-hant/works/book/ch8/",
      "readerV2": "https://wwwstationcat.org/novel/book/chapter/ch8/",
      "preview": "https://wwwstationcat.org/admin-v2/?contentId=8"
    }
  },
  "stats": {
    "completionRate": 0.5,
    "engagementScore": 0.61,
    "dropOffPoints": []
  }
}
```

## Error Codes

- `NOVELFORGE_TOKEN_NOT_CONFIGURED`: 生产环境没有配置 `NOVELFORGE_PUBLISH_TOKEN`。
- `NOVELFORGE_TOKEN_INVALID`: Bearer token 缺失或不正确。
- `NOVELFORGE_CONTRACT_HEADER_UNSUPPORTED`: contract header 不受支持。
- `CONTENT_DATABASE_NOT_CONFIGURED`: D1 绑定缺失。
- `CONTENT_TABLES_NOT_READY`: 内容表未初始化。
- `CHAPTER_STATS_NOT_READY`: 需要先应用 `migrations/0015_chapter_stats.sql`。
- `AI_INSIGHTS_NOT_READY`: 需要先应用 `migrations/0016_ai_insights.sql`。
- `NOVELFORGE_SERIES_NOT_FOUND`: 找不到对应作品。
- `NOVELFORGE_SERIES_REQUIRED`: 使用章节 slug 查询时缺少作品 slug。请改用 `seriesSlug + chapterSlug`、`/seriesSlug/chapterSlug` 或 `chapter_N` 远端 ID。
- `NOVELFORGE_CHAPTER_NOT_FOUND`: 找不到对应章节。
- `CONTENT_BUCKET_NOT_CONFIGURED`: 章节正文保存在 R2，但生产环境没有配置 `CONTENT_BUCKET` 绑定。
- `NOVELFORGE_CHAPTER_CONTENT_READ_FAILED`: 章节正文读取失败，通常是 R2 对象过大或临时不可读。

## Deployment Notes

本阶段不新增 migration。它依赖前三个阶段已经上线的：

1. `migrations/0014_reading_events.sql`
2. `migrations/0015_chapter_stats.sql`
3. `migrations/0016_ai_insights.sql`

写作端只读取已经聚合和生成的数据。若某章没有统计或洞察，接口会返回 `stats: null` 或 `insight: null`，不会自动触发后台聚合。
