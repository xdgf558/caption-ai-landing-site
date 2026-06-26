# Novel V2 Phase 4: AI Insight

第四阶段在第三阶段 `chapter_stats` 的基础上生成结构化章节洞察，给后台和后续 NovelForge 反馈链路使用。

## Migration

- `migrations/0016_ai_insights.sql`
- 新增 `ai_insights`
- 唯一口径：`series_slug + chapter_slug + locale + window_days`
- 部署前需要先应用：
  1. `0014_reading_events.sql`
  2. `0015_chapter_stats.sql`
  3. `0016_ai_insights.sql`

## Admin API

- `POST /admin/api/novels/analytics/insights/generate`
  - 从当前窗口的 `chapter_stats` 生成洞察并写入 `ai_insights`
  - 支持 `seriesSlug`、`chapterSlug`、`windowDays`、`limit`
- `GET /admin/api/novels/analytics/insights`
  - 按当前窗口读取已生成洞察
  - 支持 `seriesSlug`、`chapterSlug`、`windowDays`、`limit`

## Insight Shape

`insight_json` 保持文档中的结构：

```json
{
  "strong_points": ["章节完成率较好，读者愿意读到后段"],
  "weak_points": ["开头流失最明显"],
  "character_popularity": {
    "main": 0.61,
    "supporting": 0.42,
    "villain": 0.54
  },
  "suggestions": ["优先打磨开篇第一屏，让主角目标、危险或异常点更快出现。"]
}
```

另外保留 `summary`、`risk_level`、`evidence`，方便后台直接展示和后续调试。

## Admin UI

`/admin-v2/` 的「统计」tab 新增：

1. 生成洞察按钮。
2. 章节详情里的 `AI Insight` 区块。
3. 当前窗口无洞察时提示先生成。

## Current Model

当前使用 `station-cat-insight-v1` 本地规则生成器，不依赖外部 LLM 密钥。后续要接真实模型时，只需要替换 Worker 里的生成函数，D1 表、API 和后台 UI 可以继续复用。
