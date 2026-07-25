CREATE INDEX IF NOT EXISTS idx_content_entries_source
  ON content_entries (source_kind, source_ref, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_imports_type_filename
  ON content_imports (import_type, filename);
