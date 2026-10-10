-- Read-only pre-cutover check, after 0012-0018 and actual game/home publishing.
-- No fixture IDs, insertion, publication, R2 mutation or entitlement change.
SELECT
  (SELECT COUNT(*) FROM station_track_publications WHERE status='published') AS published_tracks,
  (SELECT COUNT(*) FROM station_promotions WHERE status='published') AS published_promotions,
  (SELECT COUNT(*) FROM station_clips WHERE status='published') AS published_clips,
  (SELECT COUNT(*) FROM station_games WHERE status='published') AS published_games,
  (SELECT COUNT(*) FROM station_games g JOIN station_game_revisions r ON r.id=g.id AND r.revision=g.published_revision
  WHERE g.status='published' AND g.slug='cat-life-game' AND g.runtime_key='cat-life' AND r.state='sealed'
    AND r.launch_url='/games/cat-life/' AND json_array_length(r.screenshot_ids_json)>0) AS game_contract,
  (SELECT COUNT(*) FROM station_home_configs WHERE status='published') AS published_homes,
  (SELECT COUNT(*) FROM station_home_configs h JOIN station_home_revisions r ON r.id=h.id AND r.revision=h.published_revision
  JOIN station_games g ON g.id=r.featured_game_id AND g.status='published' AND g.slug='cat-life-game'
  WHERE h.id='ca710000-0000-4000-8000-000000000001' AND h.status='published' AND r.state='sealed'
    AND r.featured_track_id IS NULL AND json_array_length(r.selected_track_ids_json)=0
    AND json_array_length(r.selected_clip_ids_json)=0 AND json_array_length(r.selected_update_ids_json)=0) AS home_contract;
