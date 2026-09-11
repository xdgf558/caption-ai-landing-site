import { sha256 } from '@noble/hashes/sha2.js';

export const API = '/admin/api/music';
export const limits = { audio: 32 * 1048576, preview: 4 * 1048576, cover: 5 * 1048576, lyrics: 131072, evidence: 10 * 1048576 };
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const assetUrl = id => { if (!uuid(id)) throw new Error('无效素材编号'); return API + '/assets/' + id; };
export const bytes = n => n < 1048576 ? (n / 1024).toFixed(1) + ' KiB' : (n / 1048576).toFixed(1) + ' MiB';
export function fileFormat(kind, file) {
  let format = file.name.split('.').pop().toLowerCase();
  if (format === 'jpg') format = 'jpeg';
  const allowed = { audio: ['mp3'], preview: ['mp3'], cover: ['jpeg', 'png', 'webp'], lyrics: ['txt', 'lrc'], evidence: ['jpeg', 'png', 'pdf'] };
  if (!allowed[kind]?.includes(format) || file.size < 1 || file.size > limits[kind]) throw new Error('文件格式或大小不符合限制。');
  return { format, type: ({ mp3:'audio/mpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', txt:'text/plain', lrc:'text/plain', pdf:'application/pdf' })[format] };
}
export async function hashFile(file, progress = () => {}) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 65536) {
    hash.update(new Uint8Array(await file.slice(offset, offset + 65536).arrayBuffer()));
    progress(Math.min(100, Math.round((offset + 65536) / file.size * 100)));
  }
  return Array.from(hash.digest(), b => b.toString(16).padStart(2,'0')).join('');
}
export function policyForSave(mode, until, after, previous) {
  const candidate = { accessMode: mode, earlyAccessUntil: mode === 'early_access' ? new Date(until).toISOString() : null,
    postEarlyAccessMode: mode === 'early_access' ? after : null, policyVersion: 1 };
  if (previous) candidate.policyVersion = previous.policyVersion + Number(['accessMode','earlyAccessUntil','postEarlyAccessMode'].some(k => candidate[k] !== previous[k]));
  return candidate;
}
export async function request(path, { method = 'GET', body, key, etag, raw = false, type, timeout = 30000 } = {}) {
  const id = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
  const route = typeof path === 'string' ? path.split('?')[0] : '';
  if (!new RegExp('^/(?:status|analytics|tracks|audit|uploads|tracks/' + id + '(?:/(?:publish|unpublish|archive))?|uploads/' + id +
    '(?:/(?:body|complete))?|revisions/' + id + '/(?:rights-review|technical-review)|assets/' + id + ')$','i').test(route) ||
    !['GET','POST','PATCH','PUT'].includes(method)) throw new Error('无效管理路径');
  const headers = {};
  if (method !== 'GET') {
    headers['X-Requested-With'] = 'StationCatMusicAdmin';
    headers['Content-Type'] = raw ? type : 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    if (etag) headers['If-Match'] = etag;
  }
  let response, data;
  try {
    response = await fetch(API + path, { method, credentials:'same-origin', cache:'no-store', redirect:'error',
      signal:AbortSignal.timeout(timeout), headers, ...(body === undefined ? {} : { body:raw ? body : JSON.stringify(body) }) });
    data = await response.json();
  } catch { throw Object.assign(new Error('网络或登录状态无法确认。请重新登录后核对原操作，不要重复创建。'), { uncertain:true }); }
  if (!response.ok || data.ok !== true) {
    const code = data.code || 'MUSIC_ADMIN_UNAVAILABLE';
    throw Object.assign(new Error(code), { code, status:response.status, uncertain:response.status >= 500 || [408,429].includes(response.status) });
  }
  return data;
}

// Tab-local, actor-scoped journal. Never store audio, credentials or Access tokens.
export function createJournal(storage, actorId) {
  if (typeof actorId !== 'string' || !actorId) throw new Error('无法核对管理员身份');
  const key = 'station-music-admin:v1:' + actorId;
  let state = JSON.parse(storage.getItem(key) || '{"pending":null,"jobs":[],"workspace":null}');
  if (!state || !Array.isArray(state.jobs)) throw new Error('本地恢复记录不可读，请保留此标签页并联系维护者。');
  const write = next => { storage.setItem(key, JSON.stringify(next)); state = next; };
  write(state); // Fail closed before writes when browser storage is unavailable.
  return { get: () => state, update: patch => write({ ...state, ...patch }) };
}
