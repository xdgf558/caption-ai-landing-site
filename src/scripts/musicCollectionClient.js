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
