# 销户数据分类矩阵（草案）

由实际迁移在内存 SQLite 中重建；不是生产数据扫描。分类未批准，无执行入口。

| 数据库 / 表 | 拟定处理分类 | 外键删除行为 |
| --- | --- | --- |
| reader / `admin_audit_logs` | `admin_audit_review` | 无外键；仍须核对软关联/JSON |
| reader / `admin_content_settings` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `ai_insights` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `chapter_stats` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `content_entries` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `content_imports` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `content_pricing_rules` | `publisher_content_keep` | FK 0 (entry_id) → content_entries (id)：CASCADE |
| reader / `content_revisions` | `publisher_content_keep` | FK 0 (entry_id) → content_entries (id)：CASCADE |
| reader / `download_rate_limits` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `game_commerce_events` | `financial_review` | FK 0 (purchase_id) → game_purchases (id)：RESTRICT；FK 1 (account_id) → reader_accounts (id)：RESTRICT |
| reader / `game_commerce_rate_limits` | `private_data_purge` | 无外键；仍须核对软关联/JSON |
| reader / `game_entitlement_events` | `financial_review` | FK 0 (product_id) → game_products (product_id)：RESTRICT；FK 1 (entitlement_id) → game_entitlements (id)：RESTRICT；FK 2 (account_id) → reader_accounts (id)：RESTRICT |
| reader / `game_entitlements` | `financial_review` | FK 0 (purchase_id) → game_purchases (id)：RESTRICT；FK 1 (product_id) → game_products (product_id)：RESTRICT；FK 2 (account_id) → reader_accounts (id)：RESTRICT |
| reader / `game_products` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `game_purchases` | `financial_review` | FK 0 (reversal_ledger_id) → reader_credit_ledger (id)：RESTRICT；FK 1 (ledger_id) → reader_credit_ledger (id)：RESTRICT；FK 2 (product_id) → game_products (product_id)：RESTRICT；FK 3 (account_id) → reader_accounts (id)：RESTRICT |
| reader / `membership_refund_review_items` | `financial_review` | FK 0 (reversal_id) → membership_refund_reviews (reversal_id)：NO ACTION；FK 1 (redemption_ledger_id) → reader_credit_ledger (id)：NO ACTION |
| reader / `membership_refund_reviews` | `financial_review` | FK 0 (account_id) → reader_accounts (id)：NO ACTION；FK 1 (reversal_id) → reader_credit_ledger (id)：NO ACTION |
| reader / `mobile_assert` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_browser_flows` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_codes` | `credentials_purge` | FK 0 (account_id) → reader_accounts (id)：NO ACTION |
| reader / `mobile_deletion_outbox` | `receipt_minimal` | FK 0 (job_id) → mobile_deletions (id)：NO ACTION |
| reader / `mobile_deletions` | `receipt_minimal` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_playback_grants` | `credentials_purge` | FK 0 (session_id) → mobile_sessions (id)：CASCADE；FK 1 (account_id) → reader_accounts (id)：CASCADE |
| reader / `mobile_rate_limits` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_refresh_operations` | `credentials_purge` | FK 0 (family_id) → mobile_sessions (family_id)：CASCADE |
| reader / `mobile_refresh_tokens` | `credentials_purge` | FK 0 (family_id) → mobile_sessions (family_id)：CASCADE |
| reader / `mobile_sessions` | `credentials_purge` | FK 0 (account_id) → reader_accounts (id)：NO ACTION |
| reader / `novel_entitlements` | `financial_review` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `novel_orders` | `financial_review` | FK 0 (account_id) → reader_accounts (id)：SET NULL |
| reader / `novel_payment_events` | `financial_review` | FK 0 (order_id) → novel_orders (id)：SET NULL |
| reader / `novel_tips` | `financial_review` | FK 0 (account_id) → reader_accounts (id)：SET NULL；FK 1 (order_id) → novel_orders (id)：SET NULL |
| reader / `product_feedback` | `soft_link_review` | 无外键；仍须核对软关联/JSON |
| reader / `reader_accounts` | `identity_tombstone` | 无外键；仍须核对软关联/JSON |
| reader / `reader_bookmarks` | `private_data_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_comments` | `comments_decision` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_credit_accounts` | `financial_review` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_credit_ledger` | `financial_review` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_game_save_backups` | `private_data_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_game_save_rate_limits` | `private_data_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_game_save_recovery_events` | `private_data_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_game_saves` | `private_data_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_login_tokens` | `credentials_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_membership_redemptions` | `financial_review` | FK 0 (ledger_id) → reader_credit_ledger (id)：NO ACTION；FK 1 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_memberships` | `financial_review` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_password_credentials` | `credentials_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_sessions` | `credentials_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_totp_credentials` | `credentials_purge` | FK 0 (account_id) → reader_accounts (id)：CASCADE |
| reader / `reader_totp_reset_attempts` | `soft_link_review` | 无外键；仍须核对软关联/JSON |
| reader / `reading_events` | `private_data_purge` | FK 0 (account_id) → reader_accounts (id)：SET NULL |
| reader / `signal_automation_alerts` | `publisher_content_keep` | FK 0 (source_id) → signal_sources (id)：SET NULL；FK 1 (run_id) → signal_collection_runs (id)：SET NULL |
| reader / `signal_automation_runtime` | `publisher_content_keep` | FK 0 (last_run_id) → signal_collection_runs (id)：SET NULL |
| reader / `signal_candidate_occurrences` | `publisher_content_keep` | FK 0 (run_id) → signal_collection_runs (id)：SET NULL；FK 1 (source_id) → signal_sources (id)：RESTRICT；FK 2 (candidate_id) → signal_candidates (id)：CASCADE |
| reader / `signal_candidate_reviews` | `publisher_content_keep` | FK 0 (candidate_id) → signal_candidates (id)：CASCADE |
| reader / `signal_candidates` | `publisher_content_keep` | FK 0 (run_id) → signal_collection_runs (id)：SET NULL；FK 1 (source_id) → signal_sources (id)：RESTRICT |
| reader / `signal_collection_runs` | `publisher_content_keep` | FK 0 (previous_run_id) → signal_collection_runs (id)：SET NULL |
| reader / `signal_collection_tasks` | `publisher_content_keep` | FK 0 (source_id) → signal_sources (id)：RESTRICT；FK 1 (run_id) → signal_collection_runs (id)：CASCADE |
| reader / `signal_model_rollout` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `signal_sources` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `waitlist_entries` | `soft_link_review` | 无外键；仍须核对软关联/JSON |
| reader / `waitlist_settings` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_admin_audit_logs` | `admin_audit_review` | 无外键；仍须核对软关联/JSON |
| music / `music_analytics_admission_guard` | `anonymous_analytics_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_analytics_daily` | `anonymous_analytics_ttl` | FK 0 (track_id) → music_tracks (id)：NO ACTION |
| music / `music_analytics_events` | `anonymous_analytics_ttl` | FK 0 (track_id, revision_no) → music_track_revisions (track_id, revision_no)：NO ACTION |
| music / `music_analytics_health` | `anonymous_analytics_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_analytics_rates` | `anonymous_analytics_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_assets` | `publisher_content_keep` | FK 0 (owner_track_id, derived_from_asset_id) → music_assets (owner_track_id, id)：NO ACTION；FK 1 (owner_track_id) → music_tracks (id)：NO ACTION |
| music / `music_collection_assets` | `publisher_content_keep` | FK 0 (owner_collection_id) → music_collections (id)：NO ACTION |
| music / `music_collection_tracks` | `publisher_content_keep` | FK 0 (track_id) → music_tracks (id)：NO ACTION；FK 1 (collection_id) → music_collections (id)：NO ACTION |
| music / `music_collection_upload_sessions` | `admin_audit_review` | FK 0 (asset_id) → music_collection_assets (id)：NO ACTION |
| music / `music_collections` | `publisher_content_keep` | FK 0 (cover_asset_id) → music_collection_assets (id)：NO ACTION；FK 1 (cover_track_id) → music_tracks (id)：NO ACTION |
| music / `music_featured_home` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_featured_items` | `publisher_content_keep` | FK 0 (collection_id) → music_collections (id)：NO ACTION；FK 1 (track_id) → music_tracks (id)：NO ACTION |
| music / `music_membership_attributions` | `anonymous_analytics_ttl` | FK 0 (entry_track_id) → music_tracks (id)：NO ACTION |
| music / `music_mutations` | `admin_audit_review` | 无外键；仍须核对软关联/JSON |
| music / `music_publication_guards` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_rate_sources` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_rate_windows` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_rights_evidence` | `publisher_content_keep` | FK 0 (asset_id) → music_assets (id)：NO ACTION；FK 1 (review_id) → music_rights_reviews (id)：NO ACTION |
| music / `music_rights_reviews` | `admin_audit_review` | FK 0 (revision_id) → music_track_revisions (id)：NO ACTION |
| music / `music_settings` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_share_rate_sources` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_share_rate_windows` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_track_revisions` | `publisher_content_keep` | FK 0 (track_id, lyrics_asset_id) → music_assets (owner_track_id, id)：NO ACTION；FK 1 (track_id, cover_asset_id) → music_assets (owner_track_id, id)：NO ACTION；FK 2 (track_id, preview_asset_id) → music_assets (owner_track_id, id)：NO ACTION；FK 3 (track_id, audio_asset_id) → music_assets (owner_track_id, id)：NO ACTION；FK 4 (track_id) → music_tracks (id)：NO ACTION |
| music / `music_tracks` | `publisher_content_keep` | FK 0 (id, published_revision_id) → music_track_revisions (track_id, id)：NO ACTION；FK 1 (id, draft_revision_id) → music_track_revisions (track_id, id)：NO ACTION |
| music / `music_upload_cleanup` | `admin_audit_review` | FK 0 (asset_id) → music_assets (id)：NO ACTION；FK 1 (upload_id) → music_upload_sessions (id)：NO ACTION |
| music / `music_upload_sessions` | `admin_audit_review` | FK 0 (asset_id) → music_assets (id)：NO ACTION |
