// T03 evidence only: actual local game modules, synthetic data and memory-only storage.
// Does not load main.js, open a browser, access real storage, or request HTTP.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('Use --output <local JSON path>');
const gameRoot = 'public/games/cat-life/';
const index = await readFile(resolve(root, gameRoot, 'index.html'), 'utf8');
const modules = [...index.matchAll(/<script src="\.\/(src\/js\/(?:core\/namespace|data\/[^"/]+|state\/[^"/]+|utils\/(?:format|storage|catArt))\.js)"/g)].map(m => m[1]);
assert.ok(modules.includes('src/js/state/saveMigrations.js'));
assert.ok(modules.includes('src/js/state/saveSystem.js'));
const scripts = await Promise.all(modules.map(async path => ({path,code:await readFile(resolve(root,gameRoot,path),'utf8')})));
const cases = [];
function fixture(initial = new Map(), {unreadable = false} = {}) {
  const storage = new Map(initial), writes = [], warnings = [];
  const context = vm.createContext({window:{},console:{warn:()=>warnings.push('warning')},
    localStorage:{getItem(key){if(unreadable)throw new Error('Synthetic storage access denied');return storage.get(key)??null;},
      setItem(key,value){if(unreadable)throw new Error('Synthetic storage access denied');storage.set(key,value);writes.push(key);},
      removeItem(key){if(unreadable)throw new Error('Synthetic storage access denied');storage.delete(key);}},
    fetch(){throw new Error('Network forbidden in save audit');}});
  for(const {path,code} of scripts)vm.runInContext(code,context,{filename:path,timeout:1000});
  return {game:context.window.CatGame,storage,writes,warnings};
}
const fresh = fixture(), schema = fresh.game.config.saveSchemaVersion, key = fresh.game.config.storageKey;
const valid = fresh.game.state.createNewGame();valid.player.gold=42;
const validRaw = JSON.stringify(valid);

{
  const f=fixture(), value=f.game.state.saveSystem.loadGame();
  assert.equal(value,null);assert.equal(f.writes.length,0);
  cases.push({id:'missing',readResult:'null',writes:0,sourcePreserved:true,limitation:'null alone cannot distinguish absence from a read/parse failure'});
}
{
  const f=fixture(new Map([[key,validRaw]])), value=f.game.state.saveSystem.loadGame();
  assert.equal(value.schemaVersion,schema);assert.equal(value.player.gold,42);assert.equal(f.storage.get(key),validRaw);assert.equal(f.writes.length,0);
  cases.push({id:'valid-current',readResult:'compatible progress',gold:value.player.gold,writes:0,sourcePreserved:true});
}
{
  const legacy={version:'1.0.0',meta:{createdAt:'2025-01-01T00:00:00.000Z'},player:{coins:27},cats:[],inventory:{},settings:{musicVolume:55}};
  const raw=JSON.stringify(legacy), f=fixture(new Map([[key,raw]])), value=f.game.state.saveSystem.loadGame();
  assert.equal(value.schemaVersion,schema);assert.equal(value.player.gold,27);assert.equal(value.settings.bgmVolume,55);assert.equal(value.settings.sfxVolume,55);assert.equal(f.storage.get(key),raw);assert.equal(f.writes.length,0);
  cases.push({id:'legacy-v0',readResult:'migrated copy',schemaVersion:value.schemaVersion,gold:value.player.gold,writes:0,sourcePreserved:true});
}
{
  const raw='{synthetic-broken-json', f=fixture(new Map([[key,raw]]));
  assert.equal(f.game.state.saveSystem.loadGame(),null);assert.equal(f.storage.get(key),raw);assert.equal(f.writes.length,0);
  cases.push({id:'corrupt-json-read',readResult:'null',writes:0,sourcePreserved:true,limitation:'same read result as a missing save'});
  const value=f.game.state.saveSystem.loadOrCreateGame();
  assert.equal(value.schemaVersion,schema);assert.notEqual(f.storage.get(key),raw);assert.deepEqual(f.writes,[key]);
  cases.push({id:'corrupt-json-start',readResult:'new progress',writes:f.writes.length,sourcePreserved:false,
    finding:'existing loadOrCreateGame overwrites corrupt bytes in synthetic memory; do not reuse for T12 continue detection'});
}
{
  const f=fixture(new Map([[key,validRaw]]),{unreadable:true});
  assert.equal(f.game.state.saveSystem.loadGame(),null);assert.equal(f.writes.length,0);
  assert.throws(()=>f.game.state.saveSystem.loadOrCreateGame(),/Synthetic storage access denied/);
  assert.equal(f.storage.get(key),validRaw);
  cases.push({id:'storage-denied',readResult:'null',startResult:'write error',writes:0,sourcePreserved:true,limitation:'read error is hidden; it must not be classified as an empty save'});
}
{
  const future={...valid,schemaVersion:schema+1},raw=JSON.stringify(future),f=fixture(new Map([[key,raw]]));
  assert.equal(f.game.state.saveSystem.loadGame(),null);assert.equal(f.game.state.saveSystem.getStorageKey(),key+':compat-v'+schema);assert.equal(f.storage.get(key),raw);
  f.game.state.saveSystem.loadOrCreateGame();assert.equal(f.storage.get(key),raw);assert.deepEqual(f.writes,[key+':compat-v'+schema]);
  cases.push({id:'future-schema',readResult:'separate compatibility slot',writes:f.writes.length,sourcePreserved:true,writeKey:f.writes[0],limitation:'a new compatibility save is not continuation of the future save'});
}
{
  const raw='{}',f=fixture(new Map([[key,raw]])),value=f.game.state.saveSystem.loadGame();
  assert.equal(value.schemaVersion,schema);assert.equal(f.storage.get(key),raw);assert.equal(f.writes.length,0);
  cases.push({id:'empty-object',readResult:'normalizer fills defaults',writes:0,sourcePreserved:true,limitation:'normalization success alone does not prove meaningful compatible progress'});
}
const evidence={schemaVersion:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceFilesModified:false,storage:'synthetic Map only',network:'forbidden',gameVersion:fresh.game.config.version,saveSchema:schema,
  saveKey:key,sourceModules:modules,cases,findings:['T12 needs a read-only save status check that distinguishes missing, corrupt, inaccessible and unsupported saves; existing startup/load helpers are insufficient.']};
await writeFile(resolve(process.argv[outputIndex+1]),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({cases:cases.length,gameVersion:evidence.gameVersion,saveSchema:schema,knownUnsafeCase:'corrupt-json-start',productionStorageAccessed:false}));
