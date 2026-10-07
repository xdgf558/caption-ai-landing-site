import { sha256 } from '@noble/hashes/sha2.js';

const identity = input => Array.from(sha256(new TextEncoder().encode(JSON.stringify([input.locale, input.q, input.sort]))),
  byte => byte.toString(16).padStart(2, '0')).join('');
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function readMusicCursor(cursor, input) {
  if (!cursor || Object.keys(cursor).sort().join(',') !== 'group,id,order,scope,sort,time,v' || cursor.v !== 2 ||
    cursor.sort !== input.sort || cursor.scope !== identity(input) || ![0, 1].includes(cursor.group) ||
    !integer(cursor.order) || !integer(cursor.time) || cursor.time > 8640000000000000 ||
    typeof cursor.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cursor.id) ||
    (input.sort === 'release' && cursor.order !== 0)) throw new TypeError('Invalid music cursor');
  return cursor;
}
export function musicCursorFor(row, input) {
  const cursor = { v: 2, sort: input.sort, group: row.catalog_group, order: row.catalog_order,
    time: row.catalog_time, id: row.id, scope: identity(input) };
  readMusicCursor(cursor, input);
  return btoa(JSON.stringify(cursor)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
