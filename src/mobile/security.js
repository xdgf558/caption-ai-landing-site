const encoder = new TextEncoder();
export const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export const randomSecret = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const decode = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error('Noncanonical encoding');
  return bytes;
};
export const hashBytes = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b => b.toString(16).padStart(2,'0')).join('');
export const hash = text => hashBytes(encoder.encode(text));
export const challenge = async verifier => encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))));
export const equal = async (a,b) => {
  const x = encoder.encode(String(a)), y = encoder.encode(String(b));
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x,y);
};
export class MobileError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireValue(condition, code = 'INVALID_REQUEST', status = 400) {
  if (!condition) throw new MobileError(code,status);
}
export const validID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
export const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const iso = ms => new Date(ms).toISOString();
export function configuration(env) {
  requireValue(env.MOBILE_AUTH_ENABLED === 'true' && env.MOBILE_ENVIRONMENT === 'isolated', 'SERVICE_UNAVAILABLE',503);
  const origin = new URL(env.MOBILE_AUTH_ORIGIN);
  requireValue(origin.protocol === 'https:' && origin.origin === env.MOBILE_AUTH_ORIGIN && !origin.username && !origin.password &&
    !['wwwstationcat.org','stationcat.org'].includes(origin.hostname), 'SERVICE_UNAVAILABLE',503);
  const redirect = new URL(env.MOBILE_REDIRECT_URI);
  requireValue(redirect.origin === origin.origin && redirect.pathname === '/auth/mobile/callback' && !redirect.search && !redirect.hash, 'SERVICE_UNAVAILABLE',503);
  const keys = JSON.parse(env.MOBILE_RESULT_KEYS_JSON || '{}');
  requireValue(typeof env.MOBILE_RESULT_KEY_VERSION === 'string' && keys[env.MOBILE_RESULT_KEY_VERSION] &&
    Object.values(keys).every(k => decode(k).length === 32), 'SERVICE_UNAVAILABLE',503);
  return {origin:origin.origin, redirect:redirect.href, keys, keyVersion:env.MOBILE_RESULT_KEY_VERSION};
}
export async function seal(value, config, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw',decode(config.keys[config.keyVersion]),'AES-GCM',false,['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,encoder.encode(JSON.stringify(value)));
  return JSON.stringify({keyVersion:config.keyVersion,iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))});
}
export async function unseal(value, config, aad) {
  const box=JSON.parse(value);
  requireValue(config.keys[box.keyVersion], 'SERVICE_UNAVAILABLE',503);
  const key=await crypto.subtle.importKey('raw',decode(config.keys[box.keyVersion]),'AES-GCM',false,['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(box.iv),additionalData:encoder.encode(aad)},key,decode(box.ciphertext))));
}
export async function readBody(request, form = false) {
  requireValue(request.headers.get('content-type')?.split(';')[0] === (form ? 'application/x-www-form-urlencoded' : 'application/json'));
  const reader=request.body?.getReader(); requireValue(reader);
  const chunks=[]; let size=0;
  while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength;
    if(size>8192){await reader.cancel(); throw new MobileError('INVALID_REQUEST',413);} chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new MobileError('INVALID_REQUEST',400);}
  if(form){const pairs=new URLSearchParams(text);requireValue(new Set(pairs.keys()).size===[...pairs].length);return Object.fromEntries(pairs);}
  let value;try{value=JSON.parse(text);}catch{throw new MobileError('INVALID_REQUEST',400);}
  requireValue(value && !Array.isArray(value) && typeof value==='object');return value;
}
export function exactKeys(body, keys) { requireValue(Object.keys(body).length===keys.length && keys.every(k=>Object.hasOwn(body,k))); }
export const assertChanged = db => db.prepare('INSERT INTO mobile_assert(value) VALUES (CASE WHEN changes() = 1 THEN 1 ELSE 0 END)');
export const clearAssert = db => db.prepare('DELETE FROM mobile_assert');
