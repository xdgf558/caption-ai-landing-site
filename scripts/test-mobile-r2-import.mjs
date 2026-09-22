import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {catalogImport} from './helpers/mobile-r2-import.mjs';
import {setup,close,seed,music} from './helpers/mobile-music-fixture.mjs';

// Only temporary synthetic Miniflare state and in-memory SQLite are used here.
// No .generated/private inputs, production resources, credentials or outbound network.
const tablesSQL="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'music_%' ORDER BY name";
let snapshot;
function normalized(rows) {
  return rows.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function databaseSnapshot(database) {
  return Object.fromEntries(database.prepare(tablesSQL).all().map(({name})=>{
    assert.match(name,/^music_[a-z_]+$/);
    return [name,normalized(database.prepare(`SELECT * FROM ${name}`).all())];
  }));
}
function migratedDatabase() {
  const database=new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;');
  for(const file of readdirSync('migrations-music').filter(x=>x.endsWith('.sql')).sort()) {
    database.exec(readFileSync('migrations-music/'+file,'utf8'));
  }
  assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(database.prepare('PRAGMA recursive_triggers').get().recursive_triggers,1);
  return database;
}
function apply(database,input) {
  const sql=catalogImport(input);
  database.exec('BEGIN IMMEDIATE');
  try {database.exec(sql);database.exec('COMMIT');}
  catch(error) {database.exec('ROLLBACK');throw error;}
}
before(async()=>{
  await setup();
  const free=await seed('free',null,"[00:00.00]Synthetic import: apostrophe ' and 中文\n[00:05.00]Free test only");
  await seed('vip',null,'[00:00.00]Synthetic VIP import\n[00:05.00]Test only');
  await music.prepare("INSERT INTO music_featured_items(slot_kind,position,track_id) VALUES('primary',0,?)").bind(free.id).run();
  snapshot={};
  for(const {name} of (await music.prepare(tablesSQL).all()).results) {
    assert.match(name,/^music_[a-z_]+$/);
    snapshot[name]=(await music.prepare(`SELECT * FROM ${name}`).all()).results;
  }
});
after(async()=>{await close();});

test('R2 import preserves the complete fixture with actual foreign keys and publication triggers enabled',()=>{
  const database=migratedDatabase();
  try {
    // Input order cannot be relied upon: derived previews deliberately precede originals.
    const input=structuredClone(snapshot);
    input.music_assets.sort((a,b)=>Number(!!b.derived_from_asset_id)-Number(!!a.derived_from_asset_id));
    apply(database,input);
    const expected=Object.fromEntries(Object.entries(snapshot).map(([name,rows])=>[name,normalized(rows)]));
    assert.deepEqual(databaseSnapshot(database),expected);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    assert.equal(database.prepare("SELECT count(*) n FROM music_tracks WHERE lifecycle='published'").get().n,2);
    assert.equal(database.prepare("SELECT count(*) n FROM music_track_revisions WHERE state='sealed'").get().n,2);
    assert.equal(database.prepare('SELECT count(*) n FROM music_rights_evidence').get().n,2);
    assert.equal(database.prepare('SELECT count(*) n FROM music_featured_items').get().n,1);
    // The import must not disable or drop the real publication protection.
    assert.throws(()=>database.exec("UPDATE music_track_revisions SET metadata_json='{}'"),/MUSIC_SEALED_REVISION/);
    assert.throws(()=>database.exec("UPDATE music_assets SET state='uploaded' WHERE state='validated'"),/MUSIC_VALIDATED_ASSET/);
    assert.deepEqual(databaseSnapshot(database),expected);
  }finally{database.close();}
});

test('reimport rejects duplicate identities and does not overwrite any existing fixture data',()=>{
  const database=migratedDatabase();
  try {
    apply(database,snapshot);
    const before=databaseSnapshot(database);
    const modified=structuredClone(snapshot);
    modified.music_tracks[0].slug='must-not-overwrite';
    modified.music_track_revisions[0].metadata_json=JSON.stringify({title:{en:'must not replace'}});
    for(const candidate of [snapshot,modified]) {
      assert.throws(()=>apply(database,candidate),/MUSIC_TRACK_IDENTITY/);
      assert.deepEqual(databaseSnapshot(database),before);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
    }
  }finally{database.close();}
});

test('export refuses unexpected populated tables before generating a partial import',()=>{
  assert.throws(()=>catalogImport({...snapshot,music_admin_audit_logs:[{id:'unapproved-import'}]}),/Unexpected populated fixture table/);
});
