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
| reader / `content_pricing_rules` | `publisher_content_keep` | entry_id → content_entries：CASCADE |
| reader / `content_revisions` | `publisher_content_keep` | entry_id → content_entries：CASCADE |
| reader / `download_rate_limits` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `game_commerce_events` | `financial_review` | purchase_id → game_purchases：RESTRICT；account_id → reader_accounts：RESTRICT |
| reader / `game_commerce_rate_limits` | `private_data_purge` | 无外键；仍须核对软关联/JSON |
| reader / `game_entitlement_events` | `financial_review` | product_id → game_products：RESTRICT；entitlement_id → game_entitlements：RESTRICT；account_id → reader_accounts：RESTRICT |
| reader / `game_entitlements` | `financial_review` | purchase_id → game_purchases：RESTRICT；product_id → game_products：RESTRICT；account_id → reader_accounts：RESTRICT |
| reader / `game_products` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `game_purchases` | `financial_review` | reversal_ledger_id → reader_credit_ledger：RESTRICT；ledger_id → reader_credit_ledger：RESTRICT；product_id → game_products：RESTRICT；account_id → reader_accounts：RESTRICT |
| reader / `membership_refund_review_items` | `financial_review` | reversal_id → membership_refund_reviews：NO ACTION；redemption_ledger_id → reader_credit_ledger：NO ACTION |
| reader / `membership_refund_reviews` | `financial_review` | account_id → reader_accounts：NO ACTION；reversal_id → reader_credit_ledger：NO ACTION |
| reader / `mobile_assert` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_browser_flows` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_codes` | `credentials_purge` | account_id → reader_accounts：NO ACTION |
| reader / `mobile_deletion_outbox` | `receipt_minimal` | job_id → mobile_deletions：NO ACTION |
| reader / `mobile_deletions` | `receipt_minimal` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_rate_limits` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| reader / `mobile_refresh_operations` | `credentials_purge` | family_id → mobile_sessions：CASCADE |
| reader / `mobile_refresh_tokens` | `credentials_purge` | family_id → mobile_sessions：CASCADE |
| reader / `mobile_sessions` | `credentials_purge` | account_id → reader_accounts：NO ACTION |
| reader / `novel_entitlements` | `financial_review` | account_id → reader_accounts：CASCADE |
| reader / `novel_orders` | `financial_review` | account_id → reader_accounts：SET NULL |
| reader / `novel_payment_events` | `financial_review` | order_id → novel_orders：SET NULL |
| reader / `novel_tips` | `financial_review` | account_id → reader_accounts：SET NULL；order_id → novel_orders：SET NULL |
| reader / `product_feedback` | `soft_link_review` | 无外键；仍须核对软关联/JSON |
| reader / `reader_accounts` | `identity_tombstone` | 无外键；仍须核对软关联/JSON |
| reader / `reader_bookmarks` | `private_data_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_comments` | `comments_decision` | account_id → reader_accounts：CASCADE |
| reader / `reader_credit_accounts` | `financial_review` | account_id → reader_accounts：CASCADE |
| reader / `reader_credit_ledger` | `financial_review` | account_id → reader_accounts：CASCADE |
| reader / `reader_game_save_backups` | `private_data_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_game_save_rate_limits` | `private_data_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_game_save_recovery_events` | `private_data_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_game_saves` | `private_data_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_login_tokens` | `credentials_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_membership_redemptions` | `financial_review` | ledger_id → reader_credit_ledger：NO ACTION；account_id → reader_accounts：CASCADE |
| reader / `reader_memberships` | `financial_review` | account_id → reader_accounts：CASCADE |
| reader / `reader_password_credentials` | `credentials_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_sessions` | `credentials_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_totp_credentials` | `credentials_purge` | account_id → reader_accounts：CASCADE |
| reader / `reader_totp_reset_attempts` | `soft_link_review` | 无外键；仍须核对软关联/JSON |
| reader / `reading_events` | `private_data_purge` | account_id → reader_accounts：SET NULL |
| reader / `signal_automation_alerts` | `publisher_content_keep` | source_id → signal_sources：SET NULL；run_id → signal_collection_runs：SET NULL |
| reader / `signal_automation_runtime` | `publisher_content_keep` | last_run_id → signal_collection_runs：SET NULL |
| reader / `signal_candidate_occurrences` | `publisher_content_keep` | run_id → signal_collection_runs：SET NULL；source_id → signal_sources：RESTRICT；candidate_id → signal_candidates：CASCADE |
| reader / `signal_candidate_reviews` | `publisher_content_keep` | candidate_id → signal_candidates：CASCADE |
| reader / `signal_candidates` | `publisher_content_keep` | run_id → signal_collection_runs：SET NULL；source_id → signal_sources：RESTRICT |
| reader / `signal_collection_runs` | `publisher_content_keep` | previous_run_id → signal_collection_runs：SET NULL |
| reader / `signal_collection_tasks` | `publisher_content_keep` | source_id → signal_sources：RESTRICT；run_id → signal_collection_runs：CASCADE |
| reader / `signal_model_rollout` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `signal_sources` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| reader / `waitlist_entries` | `soft_link_review` | 无外键；仍须核对软关联/JSON |
| reader / `waitlist_settings` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_admin_audit_logs` | `admin_audit_review` | 无外键；仍须核对软关联/JSON |
| music / `music_analytics_admission_guard` | `anonymous_analytics_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_analytics_daily` | `anonymous_analytics_ttl` | track_id → music_tracks：NO ACTION |
| music / `music_analytics_events` | `anonymous_analytics_ttl` | track_id → music_track_revisions：NO ACTION；revision_no → music_track_revisions：NO ACTION |
| music / `music_analytics_health` | `anonymous_analytics_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_analytics_rates` | `anonymous_analytics_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_assets` | `publisher_content_keep` | owner_track_id → music_assets：NO ACTION；derived_from_asset_id → music_assets：NO ACTION；owner_track_id → music_tracks：NO ACTION |
| music / `music_collection_assets` | `publisher_content_keep` | owner_collection_id → music_collections：NO ACTION |
| music / `music_collection_tracks` | `publisher_content_keep` | track_id → music_tracks：NO ACTION；collection_id → music_collections：NO ACTION |
| music / `music_collection_upload_sessions` | `admin_audit_review` | asset_id → music_collection_assets：NO ACTION |
| music / `music_collections` | `publisher_content_keep` | cover_asset_id → music_collection_assets：NO ACTION；cover_track_id → music_tracks：NO ACTION |
| music / `music_featured_home` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_featured_items` | `publisher_content_keep` | collection_id → music_collections：NO ACTION；track_id → music_tracks：NO ACTION |
| music / `music_membership_attributions` | `anonymous_analytics_ttl` | entry_track_id → music_tracks：NO ACTION |
| music / `music_mutations` | `admin_audit_review` | 无外键；仍须核对软关联/JSON |
| music / `music_publication_guards` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_rate_sources` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_rate_windows` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_rights_evidence` | `publisher_content_keep` | asset_id → music_assets：NO ACTION；review_id → music_rights_reviews：NO ACTION |
| music / `music_rights_reviews` | `admin_audit_review` | revision_id → music_track_revisions：NO ACTION |
| music / `music_settings` | `publisher_content_keep` | 无外键；仍须核对软关联/JSON |
| music / `music_share_rate_sources` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_share_rate_windows` | `short_ttl` | 无外键；仍须核对软关联/JSON |
| music / `music_track_revisions` | `publisher_content_keep` | track_id → music_assets：NO ACTION；lyrics_asset_id → music_assets：NO ACTION；cover_asset_id → music_assets：NO ACTION；preview_asset_id → music_assets：NO ACTION；audio_asset_id → music_assets：NO ACTION；track_id → music_tracks：NO ACTION |
| music / `music_tracks` | `publisher_content_keep` | id → music_track_revisions：NO ACTION；published_revision_id → music_track_revisions：NO ACTION；draft_revision_id → music_track_revisions：NO ACTION |
| music / `music_upload_cleanup` | `admin_audit_review` | asset_id → music_assets：NO ACTION；upload_id → music_upload_sessions：NO ACTION |
| music / `music_upload_sessions` | `admin_audit_review` | asset_id → music_assets：NO ACTION |
