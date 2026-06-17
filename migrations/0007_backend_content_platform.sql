CREATE TABLE IF NOT EXISTS content_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  slug TEXT NOT NULL,
  parent_slug TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'public',
  access_level TEXT NOT NULL DEFAULT 'free',
  author_name TEXT NOT NULL DEFAULT 'Station Cat',
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  chapter_number INTEGER,
  volume_title TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  seo_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  pricing_json TEXT NOT NULL DEFAULT '{}',
  body_format TEXT NOT NULL DEFAULT 'markdown',
  markdown_r2_key TEXT NOT NULL DEFAULT '',
  html_r2_key TEXT NOT NULL DEFAULT '',
  import_r2_key TEXT NOT NULL DEFAULT '',
  cover_r2_key TEXT NOT NULL DEFAULT '',
  cover_alt TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  reading_minutes INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL DEFAULT 'backend',
  source_ref TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  published_at TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entry_type, locale, parent_slug, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_entries_type_status
  ON content_entries (entry_type, status, published_at);

CREATE INDEX IF NOT EXISTS idx_content_entries_parent
  ON content_entries (entry_type, locale, parent_slug, chapter_number, sort_order);

CREATE INDEX IF NOT EXISTS idx_content_entries_slug
  ON content_entries (entry_type, locale, slug);

CREATE INDEX IF NOT EXISTS idx_content_entries_updated
  ON content_entries (updated_at);

CREATE TABLE IF NOT EXISTS content_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  pricing_json TEXT NOT NULL DEFAULT '{}',
  markdown_r2_key TEXT NOT NULL DEFAULT '',
  html_r2_key TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES content_entries(id) ON DELETE CASCADE,
  UNIQUE (entry_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_content_revisions_entry
  ON content_revisions (entry_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS content_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_type TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  entries_created INTEGER NOT NULL DEFAULT 0,
  entries_updated INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_imports_status
  ON content_imports (import_type, status, created_at);

CREATE TABLE IF NOT EXISTS content_pricing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER,
  scope_type TEXT NOT NULL DEFAULT 'entry',
  entry_type TEXT NOT NULL DEFAULT '',
  series_slug TEXT NOT NULL DEFAULT '',
  chapter_slug TEXT NOT NULL DEFAULT '',
  rule_type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  credits INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  minimum_chapters INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entry_id) REFERENCES content_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_pricing_rules_entry
  ON content_pricing_rules (entry_id, is_enabled);

CREATE INDEX IF NOT EXISTS idx_content_pricing_rules_scope
  ON content_pricing_rules (scope_type, entry_type, series_slug, chapter_slug, is_enabled);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  target_slug TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target
  ON admin_audit_logs (target_type, target_id, created_at);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor
  ON admin_audit_logs (actor_email, created_at);
