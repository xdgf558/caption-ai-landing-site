import { bytes as musicBytes, request } from './musicAdminClient.js';
import { createStationMediaJournal, createStationMediaUploader, mediaKindNames, mediaFileFormat } from './stationMediaUploader.js';

const el = id => document.getElementById(id);
const bytes = size => size < 1024 ? `${size} B` : musicBytes(size);
const labels = { prepared: '准备上传', reserving: '正在预留', reserved: '待发送文件', writing: '上传中', uploading: '上传待确认', uploaded: '等待校验',
  validating: '校验中', completed: '就绪 · 待审核', rejected: '校验失败', expired: '会话已过期' };
const errors = {
  STATION_MEDIA_UPLOADS_DISABLED: '素材上传暂未启用，请稍后重新核对。', STATION_MEDIA_SCHEMA_UNAVAILABLE: '素材服务暂不可用，请联系维护者核对配置。',
  MUSIC_UPLOADS_NOT_CONFIGURED: '上传配额尚未配置，请先核对总配额。', MUSIC_STORAGE_QUOTA: '存储配额不足，请先核对总配额。',
  ADMIN_AUTH_REQUIRED: '管理员登录已失效，请重新登录后查询原操作。', ADMIN_FORBIDDEN: '当前账号没有素材管理权限。', ADMIN_AUTH_UNAVAILABLE: '暂时无法核对管理员身份。',
  STATION_MEDIA_DRAFT_REQUIRED: '对应作品已变化，请重新选择可以编辑的草稿。', STATION_MEDIA_UPLOAD_CONFLICT: '上传状态已变化，请查询原记录。',
  STATION_VIDEO_STRUCTURE_INVALID: '视频结构未通过校验，请从原文件重新导出 MP4。', STATION_VIDEO_UNSUPPORTED: '视频编码或容器不受支持，请导出 H.264 / AAC 的 MP4。',
  STATION_VIDEO_METADATA_TOO_LARGE: '视频索引过大，请重新导出文件后上传。', STATION_MEDIA_STRUCTURE_INVALID: '图片未通过校验，请重新导出 JPEG、PNG 或静态 WebP。',
  STATION_MEDIA_HASH_MISMATCH: '文件完整性核对失败，请查询原记录并重新选择文件。', STATION_MEDIA_STORAGE_MISMATCH: '已存文件与上传记录不一致，请保留记录并联系维护者。',
  UPLOAD_SIZE_MISMATCH: '实际文件大小不符，请查询原记录后重试。', FILE_TOO_LARGE: '文件超过此用途的大小限制。', UPLOAD_EXPIRED: '此上传会话已过期，请另建版本。',
  UPLOAD_REJECTED: '原文件未通过校验，请另建版本。', UPLOAD_NOT_READY: '文件尚未准备好，请查询原记录。',
  UPLOAD_WRITE_UNCONFIRMED: '上传结果尚未确认，请查询原操作。', STATION_MEDIA_VALIDATION_UNCONFIRMED: '校验结果尚未确认，请继续查询并校验。',
  STATION_MEDIA_STORAGE_TIMEOUT: '文件校验暂时超时，请继续查询并校验。', STATION_MEDIA_STORAGE_UNAVAILABLE: '存储服务暂不可用，请保留记录后重试。'
};
let controller, actorId, enabled = false, ownerCursor = null, historyCursor = null, recent = [], ownersEpoch = 0, ownersBusy = false, loading = false, recovering = false;
function notice(message, error = false) { el('media-status').textContent = message; el('media-status').dataset.error = String(error); }
const errorText = error => errors[error?.code || error] || (typeof error?.message === 'string' && !/^[A-Z_]+$/.test(error.message) ? error.message : '结果暂时无法确认，请保留记录并查询原操作。');
function gate() {
  const busy = loading || recovering || !!controller?.busy(), pending = controller?.pending();
  el('media-fields').disabled = !enabled || busy || !!pending;
  el('media-reload').disabled = busy;
  el('media-more-history').disabled = busy;
  el('media-start').disabled = ownersBusy || !el('media-owner').value;
  el('media-recovery-note').hidden = !pending;
  el('media-phase').textContent = pending ? labels[pending.stage] || '等待查询' : '待选择';
  el('media-progress').hidden = !busy;
  if (busy && pending) { el('media-meter').removeAttribute('value'); el('media-progress-label').textContent = labels[pending.stage] || '正在核对'; }
}
function render() {
  gate();
  const local = controller?.jobs() || [], linked = new Set(local.map(j => j.uploadId).filter(Boolean));
  const records = [...local.slice().reverse(), ...recent.filter(r => !linked.has(r.uploadId)).map(result => ({ result, stage: result.expired ? 'expired' : result.status, fileName: mediaKindNames[result.kind], command: { kind: result.kind, byteSize: result.declaredBytes } }))];
  el('media-history').replaceChildren();
  if (!records.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = '还没有上传记录。选一份素材，开始准备作品。'; el('media-history').append(li); }
  for (const job of records) {
    const row = document.createElement('li'), header = document.createElement('header'), title = document.createElement('strong'), badge = document.createElement('span');
    title.textContent = job.fileName || mediaKindNames[job.command.kind]; badge.className = 'badge';
    badge.textContent = (job.error || job.result?.errorCode) && !['completed','rejected','expired'].includes(job.stage) ? '需要核对' : labels[job.stage] || '等待查询';
    badge.dataset.phase = job.error || ['rejected','expired'].includes(job.stage) ? 'failed' : job.result?.phase || 'uploading'; header.append(title, badge); row.append(header);
    const description = document.createElement('p'); description.className = 'muted';
    description.textContent = [mediaKindNames[job.command.kind], bytes(job.command.byteSize), job.result?.width && `${job.result.width} × ${job.result.height}`, job.result?.durationMs && `${(job.result.durationMs/1000).toFixed(1)} 秒`].filter(Boolean).join(' · '); row.append(description);
    if (job.assetId || job.result?.assetId) { const id = document.createElement('p'); id.className = 'muted'; id.textContent = '素材编号：' + (job.assetId || job.result.assetId); row.append(id); }
    if (job.error || job.result?.errorCode) { const p = document.createElement('p'); p.textContent = errorText(job.error || job.result.errorCode); row.append(p); }
    if (!['completed','rejected','expired'].includes(job.stage)) {
      const actions = document.createElement('div'); actions.className = 'media-history-actions';
      const query = document.createElement('button'); query.type = 'button'; query.textContent = '查询并继续校验'; query.disabled = !!controller?.busy() || loading || recovering;
      query.addEventListener('click', () => recover(job)); actions.append(query);
      if (job.id) {
        const input = document.createElement('input'); input.type = 'file'; input.accept = job.command.format === 'mp4' ? '.mp4' : '.jpg,.jpeg,.png,.webp';
        input.setAttribute('aria-label', '为 ' + job.fileName + ' 重选原文件'); input.disabled = !!controller?.busy() || loading || recovering;
        const send = document.createElement('button'); send.type = 'button'; send.textContent = '重选原文件并继续'; send.disabled = !!controller?.busy() || loading || recovering;
        send.addEventListener('click', () => { if (!input.files?.[0]) return notice('请在原记录中选择原文件，再继续。', true); void recover(job, input.files[0]); });
        actions.append(input, send);
      }
      row.append(actions);
    }
    el('media-history').append(row);
  }
}
async function history(append = false) {
  const data = await request('/site-uploads' + (append && historyCursor ? '?cursor=' + encodeURIComponent(historyCursor) : ''));
  recent = append ? [...recent, ...data.items] : data.items; historyCursor = data.nextCursor;
  el('media-more-history').hidden = !historyCursor; render();
}
async function loadOwners(append = false) {
  const epoch = ++ownersEpoch, kind = el('media-kind').value;
  ownersBusy = true; gate();
  if (!append) { ownerCursor = null; el('media-owner').replaceChildren(new Option('正在读取作品…', '')); el('media-more-owners').hidden = true; }
  try {
    const data = await request('/site-uploads/owners?kind=' + kind + (append && ownerCursor ? '&cursor=' + encodeURIComponent(ownerCursor) : ''));
    if (epoch !== ownersEpoch) return;
    if (!append) el('media-owner').replaceChildren(new Option('请选择作品草稿', ''));
    for (const owner of data.items) el('media-owner').append(new Option(owner.title + (owner.parentTitle ? ' · ' + owner.parentTitle : ''), owner.id));
    if (el('media-owner').options.length === 2) el('media-owner').selectedIndex = 1;
    ownerCursor = data.nextCursor; el('media-more-owners').hidden = !ownerCursor;
    el('media-owner-empty').hidden = el('media-owner').options.length > 1;
  } catch (error) { if (epoch === ownersEpoch) notice(errorText(error), true); throw error; }
  finally { if (epoch === ownersEpoch) { ownersBusy = false; gate(); } }
}
async function initialize() {
  if (loading || recovering || controller?.busy()) return;
  loading = true; enabled = false; gate();
  try {
    const status = await request('/site-uploads/status');
    if (actorId && actorId !== status.actorId) { notice('管理员身份已变化，请刷新页面重新核对。', true); return; }
    actorId = status.actorId; el('media-actor').textContent = actorId;
    el('media-quota').textContent = `已计入 ${bytes(status.storage.chargedBytes)} / 总配额 ${bytes(status.storage.quotaBytes)}`;
    enabled = status.enabled;
    if (!controller) controller = createStationMediaUploader({ actorId, journal: createStationMediaJournal(sessionStorage, actorId), onChange: render });
    await history(); await loadOwners(); notice(enabled ? controller.pending() ? '原上传已保留，请查询记录后继续。' : '选择所属作品和素材，上传后会自动校验。' : errors.MUSIC_UPLOADS_NOT_CONFIGURED);
  } catch (error) { enabled = false; notice(errorText(error), true); }
  finally { loading = false; render(); }
}
async function recover(job, file) {
  if (loading || recovering || controller?.busy()) return;
  recovering = true; render();
  try {
    if (job.id) await controller.recover(job.id, file);
    else {
      const status = await request('/site-uploads/status'); if (status.actorId !== actorId) throw new Error('管理员身份已变化，请刷新页面重新核对。');
      const state = await request('/site-uploads/' + job.result.uploadId);
      if (!state.expired && ['uploading','uploaded','validating'].includes(state.status)) await request('/site-uploads/' + state.uploadId + '/complete', { method: 'POST', body: {}, key: crypto.randomUUID(), timeout: 45000 });
      else if (state.status === 'reserved') notice('此记录尚未发送文件，请回到创建它的标签页继续。');
    }
    recovering = false; await initialize();
  } catch (error) { notice(errorText(error), true); try { await history(); } catch {} render(); }
  finally { recovering = false; render(); }
}
el('media-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const ready = await controller.start({ file: el('media-file').files?.[0], ownerId: el('media-owner').value, kind: el('media-kind').value,
      progress: value => { el('media-progress').hidden = false; el('media-meter').value = value; el('media-progress-label').textContent = '核对本机文件 · ' + value + '%'; } });
    el('media-file').value = ''; el('media-file-name').textContent = '还没有选择文件。';
    await initialize(); notice(ready.stage === 'completed' ? '素材已就绪。可以在之后的内容编辑中选择这份素材。' : '上传记录已保留，请查询并继续。');
  } catch (error) { notice(errorText(error), true); render(); }
});
el('media-kind').addEventListener('change', () => {
  const video = ['short_video','mv'].includes(el('media-kind').value);
  el('media-file').value = ''; el('media-file-name').textContent = '还没有选择文件。'; el('media-file').accept = video ? '.mp4' : '.jpg,.jpeg,.png,.webp';
  el('media-file-limit').textContent = video ? 'MP4 · 最大 256 MiB · 最长 30 分钟' : 'JPEG / PNG / WebP · 最大 10 MiB · 最大 4096 × 4096';
  el('media-format-help').textContent = video ? '视频需使用 H.264 画面，可搭配 AAC 音频。请保留本机原文件。' : '请选择静态图片。透明 PNG、WebP 可以保留透明背景。'; void loadOwners().catch(() => {});
});
el('media-file').addEventListener('change', () => {
  const file = el('media-file').files?.[0]; el('media-file-name').textContent = file ? file.name + ' · ' + bytes(file.size) : '还没有选择文件。';
  if (file) try { mediaFileFormat(el('media-kind').value, file); } catch (error) { notice(errorText(error), true); }
});
el('media-owner').addEventListener('change', gate);
el('media-more-owners').addEventListener('click', () => { void loadOwners(true).catch(() => {}); });
el('media-more-history').addEventListener('click', () => { void history(true).catch(error => notice(errorText(error), true)); });
el('media-reload').addEventListener('click', () => { void initialize(); });
window.addEventListener('beforeunload', event => { if (controller?.busy()) { event.preventDefault(); event.returnValue = ''; } });
void initialize();
