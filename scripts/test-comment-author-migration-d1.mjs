// Candidate migration acceptance on temporary synthetic D1 only.
// No R1 triggers, production binding, HTTP execution entry or outgoing requests.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';

const persist=mkdtempSync(join(tmpdir(),'candidate-comment-d1-'));
const migrationFiles=['migrations','migrations-mobile'].flatMap(directory=>
 readdirSync(directory).filter(name=>name.endsWith('.sql')).sort().map(name=>join(directory,name)));
const candidatePath=direction=>`scripts/isolated-lifecycle/migrations/0001_comment_authors_${direction}.sql`;
const indexNames=['idx_reader_comments_account_created','idx_reader_comments_chapter_status_created','idx_reader_comments_status_updated'];
let mf,db;

// SQLite's parser splits trigger/statement bodies correctly. Candidate guard
// statements run against this disposable parser schema, never against a file.
function parseStatements(parser,sql){
 const result=[];
 while(sql.trim()){
  const statement=parser.prepare(sql);statement.run();
  result.push(statement.sourceSQL);sql=sql.slice(statement.sourceSQL.length);
 }
 return result;
}
function candidateStatements(direction){
 const parser=new DatabaseSync(':memory:');
 try{
  for(const path of migrationFiles)parser.exec(readFileSync(path,'utf8'));
  if(direction==='rollback')parser.exec(readFileSync(candidatePath('forward'),'utf8'));
  return parseStatements(parser,readFileSync(candidatePath(direction),'utf8'));
 }finally{parser.close();}
}
const migrateCandidate=direction=>db.batch(candidateStatements(direction).map(sql=>db.prepare(sql)));
const rows=async()=> (await db.prepare('SELECT * FROM reader_comments ORDER BY id').all()).results;
const schema=async()=> (await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' ORDER BY type,name").all()).results;
const indexes=async()=> (await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='reader_comments' ORDER BY name").all()).results;
async function seed(){
 for(const account of [1,2]){
  await db.prepare('INSERT INTO reader_accounts(id,email,normalized_email) VALUES(?,?,?)')
   .bind(account,`fixture${account}@example.test`,`fixture${account}@example.test`).run();
  for(const [number,status] of ['approved','pending','hidden','deleted'].entries()){
   await db.prepare(`INSERT INTO reader_comments(id,account_id,series_slug,chapter_slug,locale,body,status,source_path,
    metadata_json,ip_hash,user_agent_hash,reviewed_by,reviewed_at,hidden_reason,created_at,updated_at)
    VALUES(?,?,'fixture-series','chapter','zh-Hant',?,?, '/fixture','{"fixture":true}','fixture-ip','fixture-ua',
    'fixture-reviewer','2026-09-21 00:00:00','fixture-hidden-reason','2026-09-20 00:00:00','2026-09-21 00:00:00')`)
    .bind(`comment-${account}-${number}`,account,`Fixture ${account} ${status}`,status).run();
  }
 }
}
before(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("No migration HTTP entry",{status:404})}}',
  compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{DB:'candidate-comment-synthetic'},d1Persist:persist,
  outboundService:()=>new Response('',{status:503})});
 db=await mf.getD1Database('DB');
 const parser=new DatabaseSync(':memory:');
 try{
  for(const path of migrationFiles){
   const sql=parseStatements(parser,readFileSync(path,'utf8'));
   await db.batch(sql.map(statement=>db.prepare(statement)));
  }
 }finally{parser.close();}
 await seed();
},{timeout:120000});
after(async()=>{await mf?.dispose();rmSync(persist,{recursive:true,force:true});},{timeout:30000});

test('D1 forward preserves every field, all indexes and moderation; anonymous rollback is atomic', {timeout:120000},async()=>{
 const beforeRows=await rows(),beforeIndexes=await indexes();
 await migrateCandidate('forward');
 assert.deepEqual(await rows(),beforeRows);
 assert.deepEqual(await indexes(),beforeIndexes);
 assert.deepEqual((await indexes()).filter(row=>row.sql).map(row=>row.name),indexNames);
 const columns=(await db.prepare('PRAGMA table_info(reader_comments)').all()).results;
 assert.equal(columns.find(column=>column.name==='account_id').notnull,0);
 assert.equal((await db.prepare('PRAGMA foreign_key_list(reader_comments)').all()).results[0].on_delete,'SET NULL');
 await db.prepare('UPDATE reader_comments SET account_id=NULL WHERE account_id=1').run();
 const anonymousRows=await rows(),anonymousSchema=await schema();
 assert.deepEqual(anonymousRows.filter(row=>row.account_id===2),beforeRows.filter(row=>row.account_id===2));
 assert.deepEqual(anonymousRows.filter(row=>row.account_id===null).map(({account_id,...row})=>row),
  beforeRows.filter(row=>row.account_id===1).map(({account_id,...row})=>row));
 const visible=(await db.prepare("SELECT c.id FROM reader_comments c LEFT JOIN reader_accounts a ON a.id=c.account_id WHERE c.status='approved' ORDER BY c.id").all()).results;
 assert.deepEqual(visible.map(row=>row.id),['comment-1-0','comment-2-0']);
 await assert.rejects(()=>migrateCandidate('rollback'),/CHECK constraint failed/);
 assert.deepEqual(await rows(),anonymousRows);assert.deepEqual(await schema(),anonymousSchema);
 // Explicit synthetic reset creates the independent non-anonymous rollback case.
 await db.prepare("UPDATE reader_comments SET account_id=1 WHERE id LIKE 'comment-1-%'").run();
});

test('D1 rollback with no anonymous author restores required authors and original indexes', {timeout:120000},async()=>{
 const beforeRows=await rows(),beforeIndexes=await indexes();
 await migrateCandidate('rollback');
 assert.deepEqual(await rows(),beforeRows);assert.deepEqual(await indexes(),beforeIndexes);
 assert.equal((await db.prepare('PRAGMA table_info(reader_comments)').all()).results.find(row=>row.name==='account_id').notnull,1);
 assert.equal((await db.prepare('PRAGMA foreign_key_list(reader_comments)').all()).results[0].on_delete,'CASCADE');
 await assert.rejects(()=>db.prepare("UPDATE reader_comments SET account_id=NULL WHERE id='comment-1-0'").run(),/NOT NULL constraint failed/);
});

test('D1 forward refuses unknown indexes atomically and retains all rows', {timeout:120000},async()=>{
 await db.prepare('CREATE INDEX candidate_unknown_index ON reader_comments(body)').run();
 const beforeRows=await rows(),beforeSchema=await schema();
 await assert.rejects(()=>migrateCandidate('forward'),/CHECK constraint failed/);
 assert.deepEqual(await rows(),beforeRows);assert.deepEqual(await schema(),beforeSchema);
 await db.prepare('DROP INDEX candidate_unknown_index').run();
});

test('D1 forward refuses inbound comment foreign keys without cascading dependent rows', {timeout:120000},async()=>{
 await db.prepare('CREATE TABLE candidate_inbound_comments(id TEXT PRIMARY KEY,comment_id TEXT REFERENCES reader_comments(id) ON DELETE CASCADE)').run();
 await db.prepare("INSERT INTO candidate_inbound_comments VALUES('fixture-reference','comment-1-0')").run();
 const beforeRows=await rows(),beforeSchema=await schema();
 await assert.rejects(()=>migrateCandidate('forward'),/CHECK constraint failed/);
 assert.deepEqual(await rows(),beforeRows);assert.deepEqual(await schema(),beforeSchema);
 assert.equal((await db.prepare('SELECT count(*) n FROM candidate_inbound_comments').first()).n,1);
 await db.prepare('DROP TABLE candidate_inbound_comments').run();
});

test('D1 forward refuses unknown columns atomically and retains all rows', {timeout:120000},async()=>{
 await db.prepare("ALTER TABLE reader_comments ADD COLUMN candidate_unknown_private TEXT NOT NULL DEFAULT 'fixture'").run();
 const beforeRows=await rows(),beforeSchema=await schema();
 await assert.rejects(()=>migrateCandidate('forward'),/CHECK constraint failed/);
 assert.deepEqual(await rows(),beforeRows);assert.deepEqual(await schema(),beforeSchema);
});
