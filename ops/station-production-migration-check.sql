-- Post-migration, read-only MUSIC_DB checks. These SELECTs require 0012–0018.
-- Do not run against WAITLIST_DB, initialize a ledger, or replay migrations.
-- Returned counts are compared with the immediate preflight/rehearsal; this
-- does not prove unchanged legacy row values while production writes continue.
SELECT id,name FROM d1_migrations ORDER BY id;
SELECT count(*) AS station_tables FROM sqlite_master WHERE type='table' AND name GLOB 'station_*';
SELECT count(*) AS tracks FROM music_tracks;
SELECT count(*) AS revisions FROM music_track_revisions;
SELECT count(*) AS assets FROM music_assets;
SELECT count(*) AS draft_tracks FROM station_track_publications WHERE status='draft' AND draft_revision=1 AND published_revision IS NULL;
SELECT count(*) AS published_tracks FROM station_track_publications WHERE published_revision IS NOT NULL OR status<>'draft';
SELECT count(*) AS promotions FROM station_promotions;
SELECT count(*) AS promotion_revisions FROM station_promotion_revisions;
SELECT count(*) AS platform_links FROM station_platform_links;
SELECT count(*) AS games FROM station_games;
SELECT count(*) AS clips FROM station_clips;
SELECT count(*) AS rights FROM station_asset_rights;
SELECT count(*) AS media_assets FROM station_media_assets;
SELECT count(*) AS homes FROM station_home_configs;
SELECT count(*) AS published_homes FROM station_home_configs WHERE published_revision IS NOT NULL OR status<>'draft';
SELECT count(*) AS home_revisions FROM station_home_revisions;
SELECT count(*) AS nonempty_home_revisions FROM station_home_revisions WHERE featured_track_id IS NOT NULL OR featured_game_id IS NOT NULL OR selected_track_ids_json<>'[]' OR selected_clip_ids_json<>'[]' OR selected_update_ids_json<>'[]';
SELECT count(*) AS analytics_events FROM station_analytics_events;
SELECT count(*) AS report_snapshots FROM station_report_snapshots;
SELECT count(*) AS report_jobs FROM station_report_jobs;
SELECT count(*) AS inflight_events FROM station_event_inflight;
SELECT singleton,sealed_before,updated_at FROM station_report_window_seal;
SELECT count(*) AS retention_guards FROM station_report_retention_guard;
SELECT count(*) AS asset_reference_view FROM sqlite_master WHERE type='view' AND name='music_asset_references' AND instr(sql,'station_track_revisions')>0 AND instr(sql,'station_asset_rights')>0;
SELECT count(*) AS storage_charges_view FROM sqlite_master WHERE type='view' AND name='music_storage_charges' AND instr(sql,'station_media_upload_sessions')>0 AND instr(sql,'station_media_assets')>0;
-- Remote D1 accepts quick_check; integrity_check is rejected by its SQL API.
-- This checks record/page consistency, not full SQLite integrity equivalence.
PRAGMA quick_check;
PRAGMA foreign_key_check;
