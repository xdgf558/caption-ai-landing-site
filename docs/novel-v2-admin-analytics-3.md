# Novel V2 Admin Analytics - Phase 3

第三阶段把 Novel V2 阅读事件从原始流水聚合到后台统计表，供 Admin 2.0 查看章节阅读表现。

## D1 Migration

部署前先应用：

```bash
npx wrangler d1 migrations apply station-cat-waitlist --remote
```

本阶段新增：

- `migrations/0015_chapter_stats.sql`
- `chapter_stats`：按 `series_slug + chapter_slug + locale + window_days` 保存聚合指标

## Admin APIs

- `GET /admin/api/novels/analytics/stats`
  - 查询已聚合章节统计
  - 支持 `seriesSlug`、`chapterSlug`、`windowDays` / `sinceDays`、`limit`

- `POST /admin/api/novels/analytics/aggregate`
  - 从 `reading_events` 重新聚合统计
  - 支持 `seriesSlug`、`chapterSlug`、`windowDays` / `sinceDays`、`limit`

同一章节可以同时保留 7、30、90、365 天等不同窗口的聚合记录，后台列表只展示当前选择窗口的数据，避免混合口径。

这些接口走现有 Admin 保护路径，不对普通读者开放。

## Metrics

每章统计包含：

- 阅读事件数
- 阅读会话数
- 平均阅读时间
- 平均滚动深度
- 完成率
- 流失率
- 滚动深度分布
- 流失点
- 喜欢、书签、评论草稿等互动计数
- 综合互动分

## Admin UI

`/admin-v2/` 新增「统计」tab：

1. 选择 `seriesSlug`、可选 `chapterSlug`。
2. 选择统计窗口。
3. 点击「重新聚合」写入 `chapter_stats`。
4. 点击章节卡片查看滚动深度分布和流失位置。
