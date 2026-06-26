CREATE TABLE IF NOT EXISTS chapter_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_slug TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  total_events INTEGER NOT NULL DEFAULT 0,
  unique_sessions INTEGER NOT NULL DEFAULT 0,
  account_readers INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  close_count INTEGER NOT NULL DEFAULT 0,
  completion_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  bookmark_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  avg_read_time_seconds INTEGER NOT NULL DEFAULT 0,
  avg_scroll_depth REAL NOT NULL DEFAULT 0,
  completion_rate REAL NOT NULL DEFAULT 0,
  drop_off_rate REAL NOT NULL DEFAULT 0,
  engagement_score REAL NOT NULL DEFAULT 0,
  scroll_depth_distribution_json TEXT NOT NULL DEFAULT '{}',
  drop_off_points_json TEXT NOT NULL DEFAULT '[]',
  event_window_start TEXT,
  event_window_end TEXT,
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (series_slug, chapter_slug, locale)
);

CREATE INDEX IF NOT EXISTS idx_chapter_stats_series_updated
  ON chapter_stats (series_slug, updated_at);

CREATE INDEX IF NOT EXISTS idx_chapter_stats_chapter
  ON chapter_stats (series_slug, chapter_slug, locale);

CREATE INDEX IF NOT EXISTS idx_chapter_stats_engagement
  ON chapter_stats (engagement_score, completion_rate);
