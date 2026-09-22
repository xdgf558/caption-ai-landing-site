// Export the synthetic fixture without bypassing destination publication triggers.
import assert from 'node:assert/strict';
const quote=x=>x===null?'NULL':typeof x==='number'?String(x):"'"+String(x).replaceAll("'","''")+"'";
export function catalogImport(snapshot){
 const allowed=['music_settings','music_featured_home','music_tracks','music_assets','music_track_revisions','music_rights_reviews','music_rights_evidence','music_featured_items'];
 for(const [name,rows] of Object.entries(snapshot))assert.ok(!rows.length||allowed.includes(name),'Unexpected populated fixture table');
 const rows=name=>snapshot[name]||[];
 let sql='PRAGMA defer_foreign_keys=ON;\n';
 const insert=(table,row)=>{assert.ok(Object.keys(row).every(k=>/^[a-z_][a-z0-9_]*$/.test(k)));sql+=`INSERT${['music_settings','music_featured_home'].includes(table)?' OR IGNORE':''} INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});\n`;};
 for(const table of ['music_settings','music_featured_home'])for(const row of rows(table))insert(table,row);
 for(const row of rows('music_tracks'))insert('music_tracks',{...row,lifecycle:'draft',draft_revision_id:null,published_revision_id:null,first_published_at:null,published_at:null});
 // Preview references must follow the corresponding original audio asset.
 for(const row of [...rows('music_assets')].sort((a,b)=>Number(!!a.derived_from_asset_id)-Number(!!b.derived_from_asset_id)))insert('music_assets',row);
 for(const row of rows('music_track_revisions'))insert('music_track_revisions',{...row,state:'draft'});
 for(const table of ['music_rights_reviews','music_rights_evidence'])for(const row of rows(table))insert(table,row);
 for(const row of rows('music_track_revisions'))sql+=`UPDATE music_track_revisions SET state=${quote(row.state)} WHERE id=${quote(row.id)};\n`;
 for(const row of rows('music_tracks'))sql+=`UPDATE music_tracks SET ${['lifecycle','draft_revision_id','published_revision_id','first_published_at','published_at'].map(k=>`${k}=${quote(row[k])}`).join(',')} WHERE id=${quote(row.id)};\n`;
 for(const row of rows('music_featured_items'))insert('music_featured_items',row);
 return sql;
}
