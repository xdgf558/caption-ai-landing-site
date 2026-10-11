import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { mkdir, open, readFile, realpath, lstat, rename, unlink, statfs } from 'node:fs/promises';
import { dirname, resolve, relative, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

export const backupRoot = fileURLToPath(new URL('../../', import.meta.url));
export const backupHash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error('STATION_BACKUP_' + code); };
const check = (value, code) => { if (!value) fail(code); };
export const compareObjectKeys = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
// The management endpoint can expose an HTTP weak tag for HTML while the
// listing gives the opaque tag alone. Keep bytes/SHA verification separate.
export const backupEtag = value => typeof value === 'string' ? value.replace(/^W\/"([0-9a-f]{32})-gzip"$/i, '"$1"').replace(/^W\//, '').replace(/^"|"$/g, '') : null;
export const backupSinglePartMd5 = value => /^[0-9a-f]{32}$/i.test(backupEtag(value) || '') ? backupEtag(value).toLowerCase() : undefined;
export function stableBackupJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableBackupJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableBackupJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export async function privateBackupDirectory(path, { create = false, fresh = false } = {}) {
  const target = resolve(path), parent = await realpath(dirname(target)), root = await realpath(backupRoot);
  const rel = relative(root, parent);
  const destination = relative(root, join(parent, target.split(sep).at(-1)));
  check((rel === '..' || rel.startsWith('..' + sep)) && (destination === '..' || destination.startsWith('..' + sep)), 'PRIVATE_PATH');
  if (create) await mkdir(target, { recursive: !fresh, mode: 0o700 });
  const info = await lstat(target), actual = await realpath(target);
  check(info.isDirectory() && !info.isSymbolicLink() && actual === join(parent, target.split(sep).at(-1)) && (info.mode & 0o077) === 0, 'PRIVATE_DIRECTORY');
  return actual;
}
export async function privateBackupJson(path, value, { replace = false } = {}) {
  const parent = await privateBackupDirectory(dirname(path));
  const destination = join(parent, resolve(path).split(sep).at(-1));
  const temporary = replace ? destination + '.' + randomUUID() + '.tmp' : destination;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  if (replace) {
    const old = await lstat(destination).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    check(!old || (old.isFile() && !old.isSymbolicLink() && (old.mode & 0o077) === 0), 'PRIVATE_FILE');
    await rename(temporary, destination);
  }
  return destination;
}
export async function hashBackupFile(path, { expectedMd5 } = {}) {
  const info = await lstat(path);
  check(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0, 'PRIVATE_FILE');
  const hash = createHash('sha256'), md5 = expectedMd5 ? createHash('md5') : null; let bytes = 0;
  for await (const chunk of createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) { bytes += chunk.length; hash.update(chunk); md5?.update(chunk); }
  check(!md5 || md5.digest('hex') === expectedMd5, 'BODY_MD5');
  return { bytes, sha256: hash.digest('hex') };
}
function validateObject(row) {
  check(row && typeof row.key === 'string' && row.key.length > 0 && Buffer.byteLength(row.key) <= 1024 &&
    !/[\u0000-\u001f\u007f]/.test(row.key) && row.key.split('/').every(part => part !== '.' && part !== '..') &&
    Number.isSafeInteger(row.size) && row.size >= 0 && typeof row.etag === 'string' && row.etag.length > 0 &&
    row.ssec !== true, 'OBJECT_METADATA');
  check(Object.values(row.custom_metadata || {}).every(value => typeof value === 'string'), 'OBJECT_METADATA');
  return row;
}
export function validateBackupBucketManifest(manifest, bucket) {
  check(manifest?.schemaVersion === 1 && manifest.complete === true && manifest.bucket === bucket &&
    Array.isArray(manifest.objects) && Number.isSafeInteger(manifest.bytes) && manifest.bytes >= 0 &&
    /^[0-9a-f]{64}$/.test(manifest.metadataSha256 || ''), 'OBJECT_MANIFEST');
  const keys = new Set(), metadata = []; let bytes = 0;
  for (const row of manifest.objects) {
    check(row && typeof row.key === 'string' && row.metadata?.key === row.key &&
      row.file === backupHash(row.key) + '.bin' && row.bytes === row.metadata.size &&
      /^[0-9a-f]{64}$/.test(row.sha256 || ''), 'OBJECT_MANIFEST_RECORD');
    validateObject(row.metadata);
    check(!keys.has(row.key), 'OBJECT_MANIFEST_DUPLICATE');
    keys.add(row.key); metadata.push(row.metadata); bytes += row.bytes;
    check(Number.isSafeInteger(bytes), 'OBJECT_TOTAL_SIZE');
  }
  metadata.sort((a, b) => compareObjectKeys(a.key, b.key));
  check(bytes === manifest.bytes, 'OBJECT_MANIFEST_BYTES');
  check(backupHash(stableBackupJson(metadata)) === manifest.metadataSha256, 'OBJECT_MANIFEST_METADATA');
  return { count: keys.size, bytes, metadataSha256: manifest.metadataSha256 };
}
async function readPrivateBackupJson(path) {
  const actual = await hashBackupFile(path), source = await readFile(path);
  check(actual.bytes === source.length && actual.sha256 === backupHash(source), 'MANIFEST_CHANGED');
  let value; try { value = JSON.parse(source); } catch { fail('MANIFEST_JSON'); }
  return { value, sha256: actual.sha256 };
}
export async function readBackupBucketSummary(root, plan, { required = true } = {}) {
  const source = await readPrivateBackupJson(join(root, 'buckets', 'summary.json')).catch(error => {
    if (!required && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!source) return null;
  const summary = source.value;
  check(Array.isArray(plan.buckets) && plan.buckets.length > 0 &&
    new Set(plan.buckets.map(row => row.bucket)).size === plan.buckets.length &&
    new Set(plan.buckets.map(row => row.binding)).size === plan.buckets.length &&
    summary?.complete === true && Array.isArray(summary.buckets) &&
    summary.buckets.length === plan.buckets.length, 'BUCKET_SUMMARY');
  const entries = new Map();
  for (const row of summary.buckets) {
    check(row?.complete === true && plan.buckets.some(target => target.bucket === row.bucket) &&
      !entries.has(row.bucket) && Number.isSafeInteger(row.objects) && row.objects >= 0 &&
      Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[0-9a-f]{64}$/.test(row.metadataSha256 || '') &&
      /^[0-9a-f]{64}$/.test(row.manifestSha256 || ''), 'BUCKET_SUMMARY_RECORD');
    entries.set(row.bucket, row);
  }
  return { entries, sha256: source.sha256 };
}
export async function readCompletedBucketBackup(root, target, expected) {
  const source = await readPrivateBackupJson(join(root, 'buckets', target.binding, 'manifest.json'));
  const manifest = source.value, inventory = validateBackupBucketManifest(manifest, target.bucket);
  if (expected) check(source.sha256 === expected.manifestSha256 && inventory.count === expected.objects &&
    inventory.bytes === expected.bytes && inventory.metadataSha256 === expected.metadataSha256, 'OBJECT_MANIFEST_HASH');
  return { target, manifest, manifestSha256: source.sha256, ...inventory };
}
export async function readCompletedBucketBackups(root, plan) {
  const summary = await readBackupBucketSummary(root, plan), buckets = [];
  for (const target of plan.buckets) buckets.push(await readCompletedBucketBackup(root, target, summary.entries.get(target.bucket)));
  return { buckets, summarySha256: summary.sha256 };
}
export async function inventoryBackupObjects(cloud, bucket, { perPage = 1000 } = {}) {
  check(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucket) && Number.isSafeInteger(perPage) && perPage > 0 && perPage <= 1000, 'BUCKET');
  const objects = [], keys = new Set(), cursors = new Set();
  let cursor, marker, pages = 0, pagination = 'start_after';
  while (true) {
    check(++pages <= 100000, 'PAGINATION_LIMIT');
    const query = { per_page: perPage, ...(cursor ? { cursor } : marker ? { start_after: marker } : {}) };
    const page = await cloud.json('/r2/buckets/' + bucket + '/objects', { query });
    check(Array.isArray(page.result) && page.result.length <= perPage, 'OBJECT_LIST');
    let last = marker;
    // The management API does not promise array order. Sort the returned
    // page, then advance start_after by its greatest UTF-8 key; every key in
    // subsequent pages still has to exceed that marker.
    for (const row of page.result.map(validateObject).sort((a, b) => compareObjectKeys(a.key, b.key))) {
      check(!keys.has(row.key), 'PAGINATION_DUPLICATE');
      if (!cursor) check(last === undefined || compareObjectKeys(last, row.key) < 0, 'PAGINATION_ORDER');
      last = row.key; keys.add(row.key); objects.push(row);
    }
    const info = page.result_info;
    if (info?.is_truncated === false) break;
    if (info?.is_truncated === true) {
      check(page.result.length > 0 && typeof info.cursor === 'string' && info.cursor.length > 0 && !cursors.has(info.cursor), 'PAGINATION_CURSOR');
      cursors.add(info.cursor); cursor = info.cursor; pagination = 'cursor'; continue;
    }
    // Missing result_info cannot turn a short page into an asserted complete
    // listing. Continue with the documented start_after key to an empty page.
    check(!cursor, 'PAGINATION_INCOMPLETE');
    if (!page.result.length) break;
    marker = last;
  }
  objects.sort((a, b) => compareObjectKeys(a.key, b.key));
  const bytes = objects.reduce((sum, row) => sum + row.size, 0);
  check(Number.isSafeInteger(bytes), 'OBJECT_TOTAL_SIZE');
  return { bucket, objects, bytes, count: objects.length, pages, pagination,
    metadataSha256: backupHash(stableBackupJson(objects)), complete: true };
}
export async function streamBackupFile(body, output, expectedBytes, { copy = false, expectedMd5 } = {}) {
  check(Number.isSafeInteger(expectedBytes) && expectedBytes >= 0, 'BODY_SIZE');
  const hash = createHash('sha256'), md5 = expectedMd5 ? createHash('md5') : null; let bytes = 0;
  // Acquire ownership before touching the source. An exclusive-open failure
  // must not delete an existing backup or cancel a live source stream.
  const file = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const source = copy ? createReadStream(body, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }) : body;
    for await (const chunk of source) {
      bytes += chunk.length; check(bytes <= expectedBytes, 'BODY_SIZE'); hash.update(chunk); md5?.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const written = await file.write(chunk, offset, chunk.length - offset);
        check(written.bytesWritten > 0, 'FILE_WRITE'); offset += written.bytesWritten;
      }
    }
    check(bytes === expectedBytes, 'BODY_SIZE');
    check(!md5 || md5.digest('hex') === expectedMd5, 'BODY_MD5');
    await file.sync();
    return { bytes, sha256: hash.digest('hex') };
  } catch (error) { await unlink(output).catch(() => {}); throw error; }
  finally { await file.close(); }
}
export async function backupProductionBucket(cloud, bucket, directory, onProgress = () => {}) {
  const root = await privateBackupDirectory(directory);
  const snapshot = await inventoryBackupObjects(cloud, bucket);
  const space = await statfs(root);
  check(space.bavail * space.bsize > snapshot.bytes + 512 * 1024 * 1024, 'DISK_SPACE');
  const statePath = join(root, 'progress.json');
  const existing = await readFile(statePath, 'utf8').then(JSON.parse).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing) check(existing.bucket === bucket && existing.metadataSha256 === snapshot.metadataSha256 && Array.isArray(existing.objects), 'RESUME_SNAPSHOT_CHANGED');
  const completed = new Map((existing?.objects || []).map(row => [row.key, row]));
  check(completed.size === (existing?.objects || []).length, 'RESUME_DUPLICATE');
  const state = { schemaVersion: 1, bucket, startedAt: existing?.startedAt || new Date().toISOString(),
    metadataSha256: snapshot.metadataSha256, complete: false, objects: [] };
  const data = join(root, 'objects'); await mkdir(data, { mode: 0o700, recursive: true }); await privateBackupDirectory(data);
  await privateBackupJson(statePath, state, { replace: true });
  for (const row of snapshot.objects) {
    const filename = backupHash(row.key) + '.bin', destination = join(data, filename), previous = completed.get(row.key);
    let verified;
    if (previous) {
      check(previous.file === filename && stableBackupJson(previous.metadata) === stableBackupJson(row), 'RESUME_METADATA');
      verified = await hashBackupFile(destination, { expectedMd5: backupSinglePartMd5(row.etag) });
      check(verified.bytes === row.size && verified.sha256 === previous.sha256, 'RESUME_HASH');
    } else {
      // A crash after rename but before progress commit is recovered only by
      // re-downloading; unrecorded bytes are never promoted into a backup.
      const stray = await lstat(destination).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (stray) { check(stray.isFile() && !stray.isSymbolicLink() && (stray.mode & 0o077) === 0, 'PRIVATE_FILE'); await unlink(destination); }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await cloud.object(bucket, row.key, AbortSignal.timeout(1800000));
          const etag = backupEtag(response.headers.get('etag'));
          const declared = response.headers.get('content-length');
          if (!response.body || etag !== backupEtag(row.etag) || (declared !== null && Number(declared) !== row.size)) {
            if (typeof response.body?.destroy === 'function') response.body.destroy();
            else await response.body?.cancel();
            fail('OBJECT_CHANGED');
          }
          verified = await streamBackupFile(response.body, destination, row.size, { expectedMd5: backupSinglePartMd5(row.etag) });
          break;
        } catch (error) {
          const transient = ['ECONNRESET','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(error.code) ||
            /^STATION_BACKUP_(?:API_TRANSPORT|API_HTTP_(?:429|502|503|504))$/.test(error.message || '');
          if (!transient || attempt === 2) throw error;
          await pause(500 * (attempt + 1));
        }
      }
    }
    state.objects.push({ key: row.key, file: filename, ...verified, metadata: row });
    await privateBackupJson(statePath, state, { replace: true });
    onProgress({ bucket, completed: state.objects.length, total: snapshot.count, bytes: state.objects.reduce((sum, item) => sum + item.bytes, 0) });
  }
  const after = await inventoryBackupObjects(cloud, bucket);
  check(after.metadataSha256 === snapshot.metadataSha256, 'BUCKET_CHANGED');
  state.complete = true; state.completedAt = new Date().toISOString(); state.bytes = snapshot.bytes;
  state.inventoryPages = snapshot.pages; state.pagination = snapshot.pagination;
  validateBackupBucketManifest(state, bucket);
  await privateBackupJson(join(root, 'manifest.json'), state);
  await privateBackupJson(statePath, state, { replace: true });
  return { bucket, complete: true, objects: snapshot.count, bytes: snapshot.bytes, metadataSha256: snapshot.metadataSha256,
    manifestSha256: (await hashBackupFile(join(root, 'manifest.json'))).sha256, copiedAt: state.completedAt,
    crossResourceAtomic: false };
}
