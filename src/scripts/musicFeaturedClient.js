import { uuid } from './musicAdminClient.js';

const item = value => value && uuid(value.id) && typeof value.label === 'string' && value.label.length <= 200 &&
  Object.keys(value).every(key => ['id','label','status','type','effectiveAccess'].includes(key));

export function createFeaturedJournal(storage, actor) {
  if (typeof actor !== 'string' || !actor) throw new Error('无法核对管理员身份。');
  const key = 'station-music-featured:v1:' + actor;
  let state;
  try { state = JSON.parse(storage.getItem(key) || '{"pending":null,"workspace":null}'); }
  catch { throw new Error('推荐恢复记录不可读，请保留此标签页并联系维护者。'); }
  const validate = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('推荐恢复记录不可读。');
    if (value.pending !== null) {
      const op = value.pending;
      if (op?.path !== '/featured' || op.method !== 'PUT' || !uuid(op.key) || !/^"edit-[1-9][0-9]*"$/.test(op.etag) ||
        !op.body || Object.keys(op).some(name => !['path','method','body','key','etag'].includes(name))) throw new Error('推荐原操作记录不可读。');
    }
    const workspace = value.workspace;
    if (workspace !== null && (!Number.isSafeInteger(workspace.editVersion) || workspace.editVersion < 1 ||
      !(workspace.primary === null || item(workspace.primary)) || !Array.isArray(workspace.secondary) || workspace.secondary.length > 6 ||
      !Array.isArray(workspace.collections) || workspace.collections.length > 6 ||
      workspace.secondary.some(value => !item(value)) || workspace.collections.some(value => !item(value)) ||
      typeof workspace.reason !== 'string' || workspace.reason.length > 1000 || typeof workspace.dirty !== 'boolean')) {
      throw new Error('推荐编辑记录不可读。');
    }
  };
  const write = next => { validate(next); storage.setItem(key,JSON.stringify(next)); state=next; };
  write(state);
  return { get:() => state, update:patch => write({...state,...patch}) };
}

export function reorderFeatured(rows, from, to) {
  if (!Array.isArray(rows) || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice(), [row] = next.splice(from,1); next.splice(to,0,row); return next;
}
