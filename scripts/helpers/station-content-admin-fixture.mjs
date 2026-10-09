import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { stationMediaTestDatabase, stationMediaMigrationStatements } from './station-media-fixture.mjs';
import { seedLegacyFixture, insertFixture } from './station-redesign-database.mjs';
import { memoryBucket } from './station-content-fixture.mjs';
export const contentOperationsMigration='0014_station_content_operations.sql';
export const contentOperationsSql=readFileSync(new URL('../../migrations-music/'+contentOperationsMigration,import.meta.url),'utf8');
export function contentOperationsStatements() {
  const parser=new DatabaseSync(':memory:');try {
    const groups=stationMediaMigrationStatements();for(const group of groups)for(const sql of group.statements)parser.exec(sql);
    let rest=contentOperationsSql;const statements=[];
    while(rest.trim()){const s=parser.prepare(rest),sql=s.sourceSQL;s.run();statements.push(sql);rest=rest.slice(sql.length);}
    return [...groups,{name:contentOperationsMigration,statements}];
  }finally{parser.close();}
}
export async function seedContentAdminFixture(db,bucket) {
  const {tracks}=await seedLegacyFixture(db,{materializeAsset:async a=>{
    const object=await bucket.put(a.object_key,new Uint8Array(100),{httpMetadata:{contentType:a.content_type}});return {etag:object.etag};
  }});
  // Old songs added after 0012 need explicit registration, not request backfill.
  // These are controlled local test fixtures with no production or rights claim.
  return {tracks};
}
export async function contentAdminFixture({migrated=true}={}) {
  const f=stationMediaTestDatabase();if(migrated)f.sql.exec(contentOperationsSql);
  f.sql.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT)');
  for(const name of ['0012_station_redesign.sql','0013_station_media_uploads.sql',...(migrated?[contentOperationsMigration]:[])]) await insertFixture(f.db,'d1_migrations',{name,applied_at:new Date().toISOString()});
  const memory=memoryBucket();const content=await seedContentAdminFixture(f.db,memory.bucket);
  return {...f,...content,...memory,sqlState:f.state,runtime:{db:f.db,bucket:memory.bucket,session:f.db.withSession('first-primary')}};
}
