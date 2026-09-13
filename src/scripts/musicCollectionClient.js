import { uuid } from './musicAdminClient.js';
// Separate from track/upload recovery: navigating to this editor cannot consume
// or overwrite an uncertain upload operation in the same browser tab.
export function createCollectionJournal(storage, actor) {
  if (typeof actor !== 'string' || !actor) throw new Error('无法核对管理员身份。');
  const key = 'station-music-collections:v1:' + actor;
  let state;
  try { state = JSON.parse(storage.getItem(key) || '{"pending":null,"workspace":null}'); }
  catch { throw new Error('专辑恢复记录不可读，请保留此标签页并联系维护者。'); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('专辑恢复记录不可读。');
  const validate = value => {
    const op=value.pending;
    if (op != null) {
      const id=op.path?.split('/')[2];
      const route=op.path==='/collections'&&op.method==='POST' || uuid(id)&&
        (op.path===`/collections/${id}`&&op.method==='PATCH' || op.path===`/collections/${id}/tracks`&&op.method==='PUT');
      if (!route || !uuid(op.key) || !op.body || typeof op.body!=='object' || Array.isArray(op.body) ||
        Object.keys(op).some(k=>!['path','method','body','key','etag'].includes(k)) ||
        (op.method!=='POST'&&!/^"edit-[1-9][0-9]*"$/.test(op.etag))) throw new Error('专辑原操作记录不可读，请保留记录并联系维护者。');
    }
    if(value.coverJobs !== undefined && (!Array.isArray(value.coverJobs) || value.coverJobs.length>31 || value.coverJobs.some(j=>
      !j||!uuid(j.key)||!uuid(j.writeKey)||!uuid(j.completeKey)||!uuid(j.body?.collectionId)||
      !['new','reserved','writing','completed','failed'].includes(j.stage)||
      !['jpeg','png','webp'].includes(j.body.format)||j.type!==({jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[j.body.format])||
      !Number.isSafeInteger(j.body.byteSize)||j.body.byteSize<1||j.body.byteSize>5242880||!/^[a-f0-9]{64}$/.test(j.body.sha256)||
      (j.uploadId!=null&&!uuid(j.uploadId))||(j.assetId!=null&&!uuid(j.assetId))||
      Object.keys(j).some(k=>!['key','writeKey','completeKey','type','stage','body','uploadId','assetId'].includes(k))||
      Object.keys(j.body).some(k=>!['collectionId','format','byteSize','sha256'].includes(k))))) throw new Error('封面恢复记录不可读。');
    const w=value.workspace;
    if (w != null && (!w.current || !['album','playlist'].includes(w.current.type) || !w.form ||
      !Array.isArray(w.order) || w.order.length>500 || w.order.some(t=>!uuid(t?.id)))) throw new Error('专辑编辑记录不可读。');
  };
  const write = next => { validate(next); storage.setItem(key,JSON.stringify(next)); state=next; };
  write(state);
  return { get:() => state, update:patch => write({...state,...patch}) };
}
export function reorderCollection(rows, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from<0 || to<0 || from>=rows.length || to>=rows.length) return rows;
  const next=rows.slice(), [row]=next.splice(from,1); next.splice(to,0,row); return next;
}

// Editing the simplified form must not erase translations that have no visible control.
export function collectionChineseText(previous, title, description) {
  return { title:{...previous?.title,'zh-Hans':title.trim()},
    description:{...previous?.description,'zh-Hans':description.trim()} };
}
