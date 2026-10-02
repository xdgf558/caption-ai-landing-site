-- REVIEW CANDIDATE ONLY: not in a production migration directory or deploy script.
-- Use an atomic D1 batch / migration transaction after the read-only preflight.
-- This changes author compatibility only. It anonymizes no rows and approves no policy.
CREATE TABLE candidate_reader_comments_assert (value INTEGER NOT NULL CHECK(value=1));
INSERT INTO candidate_reader_comments_assert SELECT CASE WHEN
 (SELECT group_concat(signature,'|') FROM (
  SELECT cid||':'||name||':'||type||':'||"notnull"||':'||COALESCE(dflt_value,'NULL')||':'||pk signature
  FROM pragma_table_info('reader_comments') ORDER BY cid
 )) = '0:id:TEXT:0:NULL:1|1:account_id:INTEGER:1:NULL:0|2:series_slug:TEXT:1:NULL:0|3:chapter_slug:TEXT:1:NULL:0|4:locale:TEXT:1:''zh-Hant'':0|5:body:TEXT:1:NULL:0|6:status:TEXT:1:''pending'':0|7:source_path:TEXT:1:'''':0|8:metadata_json:TEXT:1:''{}'':0|9:ip_hash:TEXT:1:'''':0|10:user_agent_hash:TEXT:1:'''':0|11:reviewed_by:TEXT:1:'''':0|12:reviewed_at:TEXT:0:NULL:0|13:hidden_reason:TEXT:1:'''':0|14:created_at:TEXT:1:CURRENT_TIMESTAMP:0|15:updated_at:TEXT:1:CURRENT_TIMESTAMP:0'
 AND (SELECT replace(replace(replace(replace(sql,' ',''),char(10),''),char(9),''),'"','')
  FROM sqlite_master WHERE type='table' AND name='reader_comments')='CREATETABLEreader_comments(idTEXTPRIMARYKEY,account_idINTEGERNOTNULL,series_slugTEXTNOTNULL,chapter_slugTEXTNOTNULL,localeTEXTNOTNULLDEFAULT''zh-Hant'',bodyTEXTNOTNULL,statusTEXTNOTNULLDEFAULT''pending'',source_pathTEXTNOTNULLDEFAULT'''',metadata_jsonTEXTNOTNULLDEFAULT''{}'',ip_hashTEXTNOTNULLDEFAULT'''',user_agent_hashTEXTNOTNULLDEFAULT'''',reviewed_byTEXTNOTNULLDEFAULT'''',reviewed_atTEXT,hidden_reasonTEXTNOTNULLDEFAULT'''',created_atTEXTNOTNULLDEFAULTCURRENT_TIMESTAMP,updated_atTEXTNOTNULLDEFAULTCURRENT_TIMESTAMP,FOREIGNKEY(account_id)REFERENCESreader_accounts(id)ONDELETECASCADE)'
 AND (SELECT count(*) FROM pragma_foreign_key_list('reader_comments'))=1
 AND EXISTS(SELECT 1 FROM pragma_foreign_key_list('reader_comments')
  WHERE "table"='reader_accounts' AND "from"='account_id' AND "to"='id' AND on_delete='CASCADE' AND on_update='NO ACTION')
 AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='reader_comments')=0
 AND (SELECT group_concat(name,'|') FROM (
  SELECT name FROM pragma_index_list('reader_comments') WHERE origin='c' ORDER BY name
 ))='idx_reader_comments_account_created|idx_reader_comments_chapter_status_created|idx_reader_comments_status_updated'
 AND (SELECT group_concat(name,'|') FROM pragma_index_info('idx_reader_comments_chapter_status_created'))='series_slug|chapter_slug|locale|status|created_at'
 AND (SELECT group_concat(name,'|') FROM pragma_index_info('idx_reader_comments_account_created'))='account_id|created_at'
 AND (SELECT group_concat(name,'|') FROM pragma_index_info('idx_reader_comments_status_updated'))='status|updated_at'
 AND NOT EXISTS(SELECT 1 FROM pragma_index_list('reader_comments') WHERE origin='c' AND ("unique"!=0 OR partial!=0))
 AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo('idx_reader_comments_chapter_status_created') WHERE "key"=1 AND ("desc"!=0 OR coll!='BINARY' OR cid<0))
 AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo('idx_reader_comments_account_created') WHERE "key"=1 AND ("desc"!=0 OR coll!='BINARY' OR cid<0))
 AND NOT EXISTS(SELECT 1 FROM pragma_index_xinfo('idx_reader_comments_status_updated') WHERE "key"=1 AND ("desc"!=0 OR coll!='BINARY' OR cid<0))
 AND NOT EXISTS(SELECT 1 FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f ON f."table"='reader_comments' WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name!='_cf_METADATA')
 AND NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('view','trigger') AND instr(lower(sql),'reader_comments')>0)
 AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check('reader_comments'))
 THEN 1 ELSE 0 END;

CREATE TABLE candidate_reader_comments (
  id TEXT PRIMARY KEY,
  account_id INTEGER,
  series_slug TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_path TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  hidden_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE SET NULL
);


INSERT INTO candidate_reader_comments (id, account_id, series_slug, chapter_slug, locale, body, status, source_path, metadata_json, ip_hash, user_agent_hash, reviewed_by, reviewed_at, hidden_reason, created_at, updated_at)
 SELECT id, account_id, series_slug, chapter_slug, locale, body, status, source_path, metadata_json, ip_hash, user_agent_hash, reviewed_by, reviewed_at, hidden_reason, created_at, updated_at FROM reader_comments;
INSERT INTO candidate_reader_comments_assert SELECT CASE WHEN
 (SELECT count(*) FROM reader_comments)=(SELECT count(*) FROM candidate_reader_comments)
 AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check('candidate_reader_comments'))
 THEN 1 ELSE 0 END;
DROP TABLE reader_comments;
ALTER TABLE candidate_reader_comments RENAME TO reader_comments;
CREATE INDEX idx_reader_comments_chapter_status_created
  ON reader_comments (series_slug, chapter_slug, locale, status, created_at);

CREATE INDEX idx_reader_comments_account_created
  ON reader_comments (account_id, created_at);

CREATE INDEX idx_reader_comments_status_updated
  ON reader_comments (status, updated_at);

DROP TABLE candidate_reader_comments_assert;
