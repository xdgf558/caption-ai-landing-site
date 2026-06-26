CREATE TABLE IF NOT EXISTS ai_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_slug TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  window_days INTEGER NOT NULL DEFAULT 30,
  insight_json TEXT NOT NULL DEFAULT '{}',
  model TEXT NOT NULL DEFAULT 'station-cat-insight-v1',
  source_stats_updated_at TEXT,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (series_slug, chapter_slug, locale, window_days)
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_series_generated
  ON ai_insights (series_slug, window_days, generated_at);

CREATE INDEX IF NOT EXISTS idx_ai_insights_chapter
  ON ai_insights (series_slug, chapter_slug, locale, window_days);
