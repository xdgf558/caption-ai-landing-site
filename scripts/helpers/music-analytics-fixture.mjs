// Synthetic metadata for isolated SQL tests; never a publication/rights approval.
export async function seedAnalyticsTrack(db,{now=Date.now(),accessMode='vip'}={}) {
  const id=crypto.randomUUID(), revision=crypto.randomUUID(), audio=crypto.randomUUID(), preview=crypto.randomUUID();
  const insert=async (table,values)=>{
    const keys=Object.keys(values);
    await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...Object.values(values)).run();
  };
  await insert('music_tracks',{id,slug:`analytics-${id}`,created_at:now-30000,updated_at:now-10000});
  for(const [asset,kind,duration] of [[audio,'audio',120000],[preview,'preview',30000]]) {
    await insert('music_assets',{id:asset,owner_track_id:id,state:'validated',kind,format:'mp3',content_type:'audio/mpeg',byte_size:100,
      duration_ms:duration,object_key:`fixture-only/${asset}`,sha256:'a'.repeat(64),etag:'fixture',created_at:now-20000,
      ...(kind==='preview' ? {derived_from_asset_id:audio,source_start_ms:0,source_end_ms:30000} : {})});
  }
  await insert('music_track_revisions',{id:revision,track_id:id,revision_no:1,state:'sealed',metadata_json:'{}',
    audio_asset_id:audio,preview_asset_id:preview,access_mode:accessMode,created_at:now-15000,
    technical_reviewed_at:now-12000,technical_fingerprint:'b'.repeat(64)});
  await db.prepare("UPDATE music_tracks SET lifecycle='published',published_revision_id=?,first_published_at=?,published_at=? WHERE id=?")
    .bind(revision,now-10000,now-10000,id).run();
  return {id,revision,audio,preview};
}
