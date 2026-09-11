-- MUSIC_DB only. No resource creation, feature enablement or analytics events.
CREATE TABLE music_rate_windows (
  category TEXT NOT NULL CHECK (category IN ('catalog','artwork','audio')),
  window_start INTEGER NOT NULL CHECK (window_start>=0 AND window_start%60000=0),
  hits INTEGER NOT NULL CHECK (hits BETWEEN 1 AND 1000000),
  PRIMARY KEY (category,window_start)
) STRICT;
CREATE TABLE music_rate_sources (
  category TEXT NOT NULL CHECK (category IN ('catalog','artwork','audio')),
  window_start INTEGER NOT NULL CHECK (window_start>=0 AND window_start%60000=0),
  source_hash TEXT NOT NULL CHECK (length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  hits INTEGER NOT NULL CHECK (hits BETWEEN 1 AND 1000000),
  PRIMARY KEY (category,window_start,source_hash)
) STRICT;
CREATE INDEX music_rate_sources_expiry ON music_rate_sources(window_start);
CREATE INDEX music_rate_windows_expiry ON music_rate_windows(window_start);

-- Each accepted source increment and its global increment are one SQLite statement.
-- A denied UPSERT has no INSERT/UPDATE and therefore consumes no global capacity.
CREATE TRIGGER music_rate_source_insert AFTER INSERT ON music_rate_sources
BEGIN
  INSERT INTO music_rate_windows(category,window_start,hits) VALUES(NEW.category,NEW.window_start,1)
  ON CONFLICT(category,window_start) DO UPDATE SET hits=hits+1;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'MUSIC_RATE_COUNTER_INVALID') END;
END;
CREATE TRIGGER music_rate_source_update AFTER UPDATE ON music_rate_sources
BEGIN
  UPDATE music_rate_windows SET hits=hits+1 WHERE category=NEW.category AND window_start=NEW.window_start;
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'MUSIC_RATE_COUNTER_INVALID') END;
END;
CREATE TRIGGER music_rate_source_identity BEFORE UPDATE ON music_rate_sources
WHEN NEW.category<>OLD.category OR NEW.window_start<>OLD.window_start OR NEW.source_hash<>OLD.source_hash OR NEW.hits<>OLD.hits+1
BEGIN SELECT RAISE(ABORT,'MUSIC_RATE_COUNTER_INVALID'); END;
