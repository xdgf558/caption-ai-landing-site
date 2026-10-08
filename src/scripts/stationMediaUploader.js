import { createJournal, hashFile, request, uuid } from './musicAdminClient.js';
import { STATION_MEDIA_LIMITS, stationMediaType } from '../redesign/mediaFormats.js';

export const mediaKindNames = { short_video: '歌曲短片', mv: '音乐 MV', poster: '视频海报', game_screenshot: '游戏截图' };
const terminal = job => ['completed','rejected','expired'].includes(job.stage);
export function mediaFileFormat(kind, file) {
  if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > STATION_MEDIA_LIMITS[kind]) throw new Error('文件大小不符合限制。');
  let format = file.name.split('.').pop().toLowerCase(); if (format === 'jpg') format = 'jpeg';
  try { return { format, type: stationMediaType(kind, format) }; }
  catch { throw new Error('视频请选择 MP4；图片请选择 JPEG、PNG 或 WebP。'); }
}
export function createStationMediaJournal(storage, actorId) {
  const journal = createJournal(storage, 'site-media:' + actorId);
  const jobs = journal.get().jobs;
  if (jobs.length > 50 || jobs.some(j => !uuid(j.id) || !uuid(j.reserveKey) || !uuid(j.writeKey) || !uuid(j.completeKey) ||
    !uuid(j.command?.ownerId) || !Object.hasOwn(mediaKindNames, j.command?.kind) ||
    !/^[a-f0-9]{64}$/.test(j.command?.sha256) || !Number.isSafeInteger(j.command?.byteSize) || j.command.byteSize < 1 ||
    (j.uploadId && !uuid(j.uploadId)))) throw new Error('上传恢复记录不可读，请保留此标签页并联系维护者。');
  return journal;
}

// Tab-local journal, server actor ownership, and original idempotency keys cover
// reload/lost receipts. Files, media URLs and Access credentials are never saved.
export function createStationMediaUploader({ actorId, journal, requester = request, onChange = () => {} }) {
  let busy = false;
  const jobs = () => journal.get().jobs;
  const update = (id, patch) => { journal.update({ jobs: jobs().map(j => j.id === id ? { ...j, ...patch } : j) }); onChange(); return jobs().find(j => j.id === id); };
  const current = id => { const job = jobs().find(j => j.id === id); if (!job) throw new Error('上传记录不存在。'); return job; };
  const verifyActor = async () => {
    const status = await requester('/site-uploads/status');
    if (status.actorId !== actorId) throw Object.assign(new Error('管理员身份已变化，请刷新页面后核对上传。'), { code: 'STATION_MEDIA_ACTOR_CHANGED' });
    if (!status.enabled) throw Object.assign(new Error('素材上传暂未启用，请核对服务状态和存储配额。'), { code: 'STATION_MEDIA_UPLOADS_DISABLED' });
  };
  const settle = (id, result) => update(id, { stage: result.status === 'completed' ? 'completed' : result.expired ? 'expired' : result.status,
    result, error: null, uploadId: result.uploadId, assetId: result.assetId });
  async function resume(id, file) {
    let job = current(id);
    if (terminal(job)) return job;
    if (!job.uploadId) {
      await verifyActor(); job = update(id, { stage: 'reserving', error: null });
      const result = await requester('/site-uploads', { method: 'POST', body: job.command, key: job.reserveKey });
      if (!uuid(result.uploadId) || !uuid(result.assetId)) throw Object.assign(new Error('上传回执无效，请保留记录并查询原操作。'), { uncertain: true });
      job = update(id, { uploadId: result.uploadId, assetId: result.assetId, stage: 'reserved' });
    }
    await verifyActor();
    let state = await requester('/site-uploads/' + job.uploadId);
    job = settle(id, state);
    if (terminal(job)) return job;
    if (state.status === 'reserved') {
      if (!file) return job;
      const type = mediaFileFormat(job.command.kind, file);
      if (type.format !== job.command.format || file.size !== job.command.byteSize || await hashFile(file) !== job.command.sha256) throw new Error('请重选原文件；内容不同的文件需要另建版本。');
      await verifyActor(); job = update(id, { stage: 'writing', error: null });
      await requester('/site-uploads/' + job.uploadId + '/body', { method: 'PUT', body: file, raw: true, type: type.type, key: job.writeKey, timeout: 125000 });
    }
    await verifyActor(); job = update(id, { stage: 'validating', error: null });
    state = await requester('/site-uploads/' + job.uploadId + '/complete', { method: 'POST', body: {}, key: job.completeKey, timeout: 45000 });
    return settle(id, state);
  }
  async function exclusive(task) {
    if (busy) throw new Error('正在核对上传，请稍候。');
    busy = true; onChange();
    try { return await task(); }
    finally { busy = false; onChange(); }
  }
  async function recover(id, file) {
    return exclusive(async () => {
      try { return await resume(id, file); }
      catch (error) { update(id, { error: error.code || error.message || '上传结果未确认' }); throw error; }
    });
  }
  return {
    busy: () => busy, jobs: () => structuredClone(jobs()), pending: () => jobs().find(j => !terminal(j)) || null,
    async start({ file, ownerId, kind, progress }) {
      return exclusive(async () => {
        if (jobs().some(j => !terminal(j))) throw new Error('请先查询并处理当前上传，再创建下一项。');
        if (!uuid(ownerId)) throw new Error('请先选择对应作品。');
        const { format } = mediaFileFormat(kind, file), sha256 = await hashFile(file, progress);
        const job = { id: crypto.randomUUID(), fileName: file.name.slice(0, 240), stage: 'prepared', createdAt: Date.now(),
          reserveKey: crypto.randomUUID(), writeKey: crypto.randomUUID(), completeKey: crypto.randomUUID(),
          command: { ownerId, kind, format, byteSize: file.size, sha256 }, uploadId: null, assetId: null, error: null };
        journal.update({ jobs: [...jobs().filter(terminal).slice(-19), job] }); onChange();
        try { return await resume(job.id, file); }
        catch (error) { update(job.id, { error: error.code || error.message || '上传结果未确认' }); throw error; }
      });
    }, recover
  };
}
