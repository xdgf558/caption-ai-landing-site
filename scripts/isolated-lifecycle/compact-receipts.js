import {encodeLibraryReceipt,decodeLibraryReceipt} from '../../src/mobile/libraryReceipts.js';
// Explicit synthetic experiment only. No TTL deletion, no request replay, no production scheduler.
export async function compactFixtureReceipts(db,{environment,dataset,account}){
 if(environment!=='isolated'||dataset!=='synthetic-r1'||!Number.isSafeInteger(account)||account<1)throw Error('ISOLATION_REQUIRED');
 if((await db.prepare('SELECT dataset FROM r1_fixture_provenance WHERE id=1').first())?.dataset!==dataset)throw Error('SYNTHETIC_DATA_REQUIRED');
 const rows=(await db.prepare(`SELECT id,digest,result FROM mobile_music_operations WHERE account_id=? AND substr(result,1,1)='{' AND length(result)>30 ORDER BY id LIMIT 200`).bind(account).all()).results;
 const changes=rows.map(row=>({row,packed:encodeLibraryReceipt(decodeLibraryReceipt(row.result))}));
 // Preserve short receipts (e.g. accepted:true) when the new representation is not smaller.
 const writes=changes.filter(x=>x.packed.length<x.row.result.length).map(({row,packed})=>db.prepare(`UPDATE mobile_music_operations SET result=? WHERE account_id=? AND id=? AND digest=? AND result=?`).bind(packed,account,row.id,row.digest,row.result));
 if(writes.length)await db.batch(writes);
 return {scanned:rows.length,compacted:writes.length,forgotten:0};
}

export async function restoreFixtureReceipts(db,{environment,dataset,account}){
 if(environment!=='isolated'||dataset!=='synthetic-r1'||!Number.isSafeInteger(account)||account<1)throw Error('ISOLATION_REQUIRED');
 if((await db.prepare('SELECT dataset FROM r1_fixture_provenance WHERE id=1').first())?.dataset!==dataset)throw Error('SYNTHETIC_DATA_REQUIRED');
 const rows=(await db.prepare("SELECT id,digest,result FROM mobile_music_operations WHERE account_id=? AND substr(result,1,1)='[' ORDER BY id LIMIT 200").bind(account).all()).results;
 const writes=rows.map(row=>db.prepare('UPDATE mobile_music_operations SET result=? WHERE account_id=? AND id=? AND digest=? AND result=?').bind(JSON.stringify(decodeLibraryReceipt(row.result)),account,row.id,row.digest,row.result));
 if(writes.length)await db.batch(writes);return rows.length;
}
