CREATE TABLE IF NOT EXISTS signal_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  publisher TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  trust_tier TEXT NOT NULL DEFAULT 'primary',
  endpoint_url TEXT NOT NULL UNIQUE,
  homepage_url TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'en',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  fetch_interval_minutes INTEGER NOT NULL DEFAULT 360,
  max_items_per_run INTEGER NOT NULL DEFAULT 30,
  requires_api_key INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  last_fetched_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_type IN ('rss', 'api', 'page')),
  CHECK (category IN ('ai', 'tech', 'economy', 'market', 'research', 'general')),
  CHECK (trust_tier IN ('primary', 'established', 'community')),
  CHECK (is_enabled IN (0, 1)),
  CHECK (fetch_interval_minutes BETWEEN 15 AND 10080),
  CHECK (max_items_per_run BETWEEN 1 AND 100),
  CHECK (requires_api_key IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_signal_sources_enabled_category
  ON signal_sources (is_enabled, category, name);

CREATE INDEX IF NOT EXISTS idx_signal_sources_type_enabled
  ON signal_sources (source_type, is_enabled, name);

CREATE TABLE IF NOT EXISTS signal_collection_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'queued',
  requested_source_ids_json TEXT NOT NULL DEFAULT '[]',
  source_count INTEGER NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  finished_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (trigger_type IN ('scheduled', 'manual', 'retry')),
  CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_signal_collection_runs_status_created
  ON signal_collection_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_collection_runs_created
  ON signal_collection_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS signal_candidates (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  run_id TEXT,
  external_id TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'new',
  relevance_score REAL,
  content_hash TEXT NOT NULL DEFAULT '',
  raw_payload_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES signal_sources(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id) REFERENCES signal_collection_runs(id) ON DELETE SET NULL,
  UNIQUE (source_id, canonical_url),
  CHECK (category IN ('ai', 'tech', 'economy', 'market', 'research', 'general')),
  CHECK (status IN ('new', 'shortlisted', 'rejected', 'used'))
);

CREATE INDEX IF NOT EXISTS idx_signal_candidates_status_published
  ON signal_candidates (status, published_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_candidates_source_created
  ON signal_candidates (source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_candidates_run_created
  ON signal_candidates (run_id, created_at DESC);

INSERT OR IGNORE INTO signal_sources (
  id, name, publisher, source_type, category, trust_tier,
  endpoint_url, homepage_url, language, is_enabled,
  fetch_interval_minutes, max_items_per_run, requires_api_key,
  config_json, notes, created_by, updated_by
)
VALUES
  (
    'google-company-news', 'Google company news', 'Google', 'rss', 'tech', 'primary',
    'https://blog.google/feed/', 'https://blog.google/', 'en', 1,
    360, 30, 0, '{"adapter":"rss"}',
    'Official Google company and product news feed.', 'migration-0019', 'migration-0019'
  ),
  (
    'github-changelog', 'GitHub Changelog', 'GitHub', 'rss', 'tech', 'primary',
    'https://github.blog/changelog/feed/', 'https://github.blog/changelog/', 'en', 1,
    180, 40, 0, '{"adapter":"rss"}',
    'Official GitHub product changelog feed.', 'migration-0019', 'migration-0019'
  ),
  (
    'federal-reserve-press', 'Federal Reserve press releases', 'Federal Reserve Board', 'rss', 'economy', 'primary',
    'https://www.federalreserve.gov/feeds/press_all.xml', 'https://www.federalreserve.gov/newsevents.htm', 'en', 1,
    180, 30, 0, '{"adapter":"rss"}',
    'Official Federal Reserve Board press release feed.', 'migration-0019', 'migration-0019'
  ),
  (
    'arxiv-ai-recent', 'arXiv AI recent submissions', 'arXiv', 'api', 'research', 'primary',
    'https://export.arxiv.org/api/query?search_query=cat%3Acs.AI%20OR%20cat%3Acs.LG%20OR%20cat%3Acs.CL&sortBy=submittedDate&sortOrder=descending&max_results=50',
    'https://arxiv.org/', 'en', 1, 720, 50, 0, '{"adapter":"atom"}',
    'Recent AI, machine learning, and computational linguistics papers.', 'migration-0019', 'migration-0019'
  ),
  (
    'hacker-news-top', 'Hacker News top stories', 'Hacker News', 'api', 'tech', 'community',
    'https://hacker-news.firebaseio.com/v0/topstories.json', 'https://news.ycombinator.com/', 'en', 1,
    60, 30, 0, '{"adapter":"hacker_news"}',
    'Community discovery signal. Treat as a lead, not a primary factual source.', 'migration-0019', 'migration-0019'
  ),
  (
    'openai-news', 'OpenAI Newsroom', 'OpenAI', 'page', 'ai', 'primary',
    'https://openai.com/news/', 'https://openai.com/news/', 'en', 0,
    360, 30, 0, '{"adapter":"html"}',
    'Paused until the HTML source adapter is implemented.', 'migration-0019', 'migration-0019'
  ),
  (
    'anthropic-news', 'Anthropic News', 'Anthropic', 'page', 'ai', 'primary',
    'https://www.anthropic.com/news', 'https://www.anthropic.com/news', 'en', 0,
    360, 30, 0, '{"adapter":"html"}',
    'Paused until the HTML source adapter is implemented.', 'migration-0019', 'migration-0019'
  ),
  (
    'fred-api', 'FRED economic data API', 'Federal Reserve Bank of St. Louis', 'api', 'economy', 'primary',
    'https://api.stlouisfed.org/fred/series/observations', 'https://fred.stlouisfed.org/', 'en', 0,
    360, 30, 1, '{"adapter":"fred","secretBinding":"FRED_API_KEY"}',
    'Paused until series selection and FRED_API_KEY are configured.', 'migration-0019', 'migration-0019'
  );
