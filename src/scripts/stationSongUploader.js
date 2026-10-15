import { request, hashFile, inspectUploadFile, uuid } from './musicAdminClient.js';

// One actor-scoped upload, retained until its website draft acknowledges the
// asset reference. Lost receipts replay only original keys; bytes are never
// automatically sent twice after a PUT has started.
export function createSongUploader({ actorId, storage, verifyActor, requester = request, inspect = inspectUploadFile, hash = hashFile }) {
  const key = 'station-song-upload:v1:' + actorId;
  if(typeof actorId!=='string'||!actorId)throw new Error('请先核对管理员。');
  let job = JSON.parse(storage.getItem(key) || 'null'), busy = false;
  if (job !== null && (typeof job!=='object' || Array.isArray(job) || !uuid(job.ownerId) || !['cover', 'lyrics'].includes(job.kind) || typeof job.name!=='string' || job.name.length>240 || !({jpeg:'image/jpeg',png:'image/png',webp:'image/webp',txt:'text/plain',lrc:'text/plain'})[job.format] || job.type!==({jpeg:'image/jpeg',png:'image/png',webp:'image/webp',txt:'text/plain',lrc:'text/plain'})[job.format] || !(job.kind==='cover'?['jpeg','png','webp']:['txt','lrc']).includes(job.format) || !uuid(job.reserveKey) || !uuid(job.writeKey) || !uuid(job.completeKey) ||
    !['prepared','reserved','writing','uploaded','completed','rejected','expired'].includes(job.stage) || !Number.isSafeInteger(job.size) || job.size < 1 || job.size>(job.kind==='cover'?5*1048576:131072) || !/^[a-f0-9]{64}$/.test(job.sha256) ||
    (job.uploadId && !uuid(job.uploadId)) || (job.assetId && !uuid(job.assetId)))) throw new Error('上传恢复记录不可读，请保留此标签页。');
  const write = value => { storage.setItem(key, JSON.stringify(value)); job = value; };
  const verify = async () => { const identity = await verifyActor(); if (identity.actorId !== actorId) throw new Error('管理员已变化，请重新载入工作区。'); };
  const run = async task => { if (busy) throw new Error('上传正在处理，请稍候。'); busy = true; try { return await task(); } finally { busy = false; } };
  async function resume(file) {
    if (!job) throw new Error('没有待核对的上传。');
    await verify();
    if (['rejected','expired'].includes(job.stage)) throw new Error('此上传已拒绝或过期，请重新选择文件。');
    if (!job.uploadId) {
      const result = await requester('/uploads', { method: 'POST', key: job.reserveKey,
        body: { trackId: job.ownerId, kind: job.kind, format: job.format, byteSize: job.size, sha256: job.sha256 } });
      if (!uuid(result.uploadId) || !uuid(result.assetId)) throw new Error('上传回执无效，请核对原上传。');
      write({ ...job, uploadId: result.uploadId, assetId: result.assetId, stage: 'reserved' });
    }
    await verify();
    const state = await requester('/uploads/' + job.uploadId);
    if (state.trackId !== job.ownerId || state.assetId !== job.assetId || state.uploadId !== job.uploadId || state.declaredBytes !== job.size || state.contentType !== job.type) throw new Error('上传记录与当前文件不一致，已停止。');
    await verify();
    if (state.expired || state.status === 'rejected' || state.cleanupState) {
      write({ ...job, stage: state.status === 'rejected' ? 'rejected' : 'expired' });
      throw new Error('此上传已拒绝或过期，请重新选择文件。');
    }
    if (state.status === 'completed') { write({ ...job, stage: 'completed' }); return { ...job }; }
    if(!['reserved','uploading'].includes(state.status))throw new Error('上传正在处理中，请稍后再次核对。');
    if (state.status === 'reserved') {
      if (job.stage !== 'reserved') throw new Error('文件发送结果尚未确认，请稍后再次核对上传。');
      if (!file || file.size !== job.size || await hash(file) !== job.sha256) throw new Error('请重新选择原文件，再点击“继续上传”。');
      await verify(); write({ ...job, stage: 'writing' });
      await requester('/uploads/' + job.uploadId + '/body', { method: 'PUT', key: job.writeKey, body: file, raw: true, type: job.type, timeout: 130000 });
      write({ ...job, stage: 'uploaded' });
    }
    await verify();
    const result = await requester('/uploads/' + job.uploadId + '/complete', { method: 'POST', key: job.completeKey, body: {} });
    if (result.uploadId !== job.uploadId || result.assetId !== job.assetId || result.status !== 'completed') throw new Error('文件校验结果尚未确认，请核对原上传。');
    await verify(); write({ ...job, stage: 'completed' }); return { ...job };
  }
  return {
    pending: () => job && !['rejected','expired'].includes(job.stage) ? { ...job } : null,
    async start(ownerId, kind, file) { return run(async () => {
      if (!uuid(ownerId) || !['cover','lyrics'].includes(kind)) throw new Error('请先保存歌曲资料。');
      if (job && !['rejected','expired'].includes(job.stage)) throw new Error('请先核对原上传。');
      const { format, type } = await inspect(kind, file), sha256 = await hash(file);
      await verify();
      write({ ownerId, kind, format, type, size: file.size, sha256, name: file.name.slice(0,240), stage: 'prepared',
        reserveKey: crypto.randomUUID(), writeKey: crypto.randomUUID(), completeKey: crypto.randomUUID(), uploadId: null, assetId: null });
      return resume(file);
    }); },
    recover: file => run(() => resume(file)),
    async acknowledge(ownerId, assetId) { await verify(); if (job?.stage !== 'completed' || job.ownerId !== ownerId || job.assetId !== assetId) throw new Error('素材引用尚未确认。'); write(null); }
  };
}
