import { request, createJournal, hashFile, fileFormat, assetUrl, bytes, policyForSave, uuid } from './musicAdminClient.js';
import { mountMusicAdminAnalytics } from './musicAdminAnalytics.js';
import { createWavConverter } from './musicWavClient.js';
import { isWav, WAV_PROFILE } from './musicWav.js';
import { mountAdminMusicRolePreview } from './adminMusicRolePreview.js';

const $ = id => document.getElementById(id), all = selector => [...document.querySelectorAll(selector)];
const names = { draft:'草稿', published:'已发布', unpublished:'已下架', archived:'已归档', audio:'完整音频', preview:'独立试听', cover:'封面', lyrics:'歌词', evidence:'权利凭证' };
let service, journal, actor, track = null, assets = {}, evidence = [], busy = false, locked = false, dirty = false, assetsDirty = false, reviewDirty = false;
let items = [], cursors = [null], page = 0, nextBefore = null, filter = '', query = '', activeStep = 0, auditBefore = null;
const value = id => $(id).value.trim();
const revision = () => track?.draft || track?.published;
const status = (text, error = false) => { $('music-status').textContent = text; $('music-status').dataset.error = String(error); };
const el = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const wavConverter = createWavConverter();
const rolePreview = mountAdminMusicRolePreview({ root:$('role-preview'), request, actorId:() => actor,
  onAssets:() => tab(1,true), onAuthError:() => { locked = true; stopAudio(); status('后台身份已失效或发生变化，请重新登录并读取当前版本。',true); sync(); } });
function uploadLabels() {
  for (const kind of ['audio', 'preview']) {
    document.querySelector('[data-upload-kind="' + kind + '"] span').textContent = isWav($('file-' + kind).files[0]) ? '转换并上传' : '上传';
  }
}
for (const kind of ['audio', 'preview']) {
  $('file-' + kind).addEventListener('change', uploadLabels);
  $('wav-cancel-' + kind).onclick = () => wavConverter.cancel();
}
async function prepareUploadFile(file, kind, recoveryJob) {
  if (!isWav(file) || !['audio', 'preview'].includes(kind)) return { file };
  if (recoveryJob && recoveryJob.conversion !== WAV_PROFILE) throw new Error('此会话需要原始 MP3 文件，不能用新的转换替代。');
  const panel = $('wav-progress-' + kind), meter = panel.querySelector('progress'), label = panel.querySelector('label');
  panel.hidden = false; meter.value = 0; label.textContent = '正在本机转换 0%';
  status('正在本机转换 WAV。原文件留在本机，转换成功后才开始上传。');
  try {
    const result = await wavConverter.convert(file, kind, p => { meter.value = p; label.textContent = '正在本机转换 ' + p + '%'; });
    return { file: result.file, conversion: result.profile, seconds: result.info.seconds };
  } finally { panel.hidden = true; }
}
const localTime = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,19); };
const errorMessages = {
  ADMIN_AUTH_REQUIRED:'后台登录已过期，请重新登录后回到此页核对。', ADMIN_FORBIDDEN:'此账号没有音乐管理权限。',
  MUSIC_BINDINGS_UNAVAILABLE:'音乐环境尚未配置。', MUSIC_NOT_CONFIGURED:'音乐环境尚未配置。', MUSIC_DATABASE_UNAVAILABLE:'音乐数据库尚不可用。',
  MUSIC_EDIT_CONFLICT:'曲目已被其他操作更新。请重新载入后核对，当前内容已保留。',
  MUSIC_PUBLICATION_CONFLICT:'发布版本已变化，请重新载入核对。', MUSIC_REVIEW_STALE:'草稿已变化，请重新进行权利和技术核对。',
  RIGHTS_REVIEW_REQUIRED:'权利资料不完整，请核对来源、日期、授权说明和凭证。',
  RIGHTS_EXCEPTION_REQUIRED:'此作品需要例外授权依据及对应凭证。', PREVIEW_REQUIRED:'VIP 或抢先作品必须提供独立试听文件。',
  MUSIC_FREE_PROMISE_PROTECTED:'已向公众开放免费的作品不能改为付费收听。',
  MUSIC_STORAGE_QUOTA:'存储配额不足；失败和过期上传仍占用额度。', MUSIC_UPLOADS_DISABLED:'上传尚未开放。',
  MUSIC_UPLOADS_NOT_CONFIGURED:'上传配额或迁移尚未配置。', MUSIC_ASSET_REFERENCE:'素材与当前曲目或原曲不匹配。',
  UPLOAD_EXPIRED:'上传会话已过期；预留额度尚未回收。', UPLOAD_REJECTED:'文件已被拒绝，预留额度尚未回收。',
  MUSIC_INVALID_PUBLICATION:'发布资料不完整，请核对标题、分类、音频和试听。'
};
function persist() {
  if (!journal || $('workspace').hidden) return;
  const inputs = {};
  all('#workspace input:not([type=file]), #workspace select, #workspace textarea').forEach(e => {
    if (e.closest('#role-preview')) return;
    const key = e.id || (e.dataset.right ? 'r:' + e.dataset.right : e.dataset.titleLocale ? 't:' + e.dataset.titleLocale : e.dataset.summaryLocale ? 's:' + e.dataset.summaryLocale : '');
    if (key && !e.dataset.tech) inputs[key] = e.type === 'checkbox' ? e.checked : e.value;
  });
  journal.update({ workspace: { track, assets, evidence, inputs, dirty, assetsDirty, reviewDirty, activeStep } });
}
function stopAudio() { all('audio').forEach(a => { a.onerror = null; a.pause(); a.removeAttribute('src'); a.load(); }); }
function sync() {
  const blocked = busy || locked || !!journal?.get().pending || !service;
  const archived = track?.lifecycle === 'archived', unsaved = dirty || assetsDirty;
  $('track-new').disabled = blocked;
  $('metadata-fields').disabled = blocked || archived;
  $('rights-fields').disabled = blocked || !track?.draft || unsaved || archived;
  $('technical-fields').disabled = blocked || !track?.draft || unsaved || reviewDirty || track?.rights?.status !== 'approved' || archived;
  all('[data-upload-kind], .upload-control input, #preview-start, #preview-end').forEach(e => { e.disabled = blocked || !track?.draft || !service?.capabilities.uploads || dirty || archived ||
    (!!e.dataset.uploadKind && journal?.get().jobs.some(j => j.trackId === track?.id && j.kind === e.dataset.uploadKind && ['reserved','writing'].includes(j.stage))); });
  all('[data-remove-asset]').forEach(e => { e.disabled = blocked || archived; });
  $('assets-save').disabled = blocked || !track || !assetsDirty || dirty || archived;
  $('track-publish').disabled = blocked || unsaved || reviewDirty || !track?.draft || !track.draft.technicalReviewedAt || track?.rights?.status !== 'approved';
  $('track-unpublish').disabled = blocked || unsaved || track?.lifecycle !== 'published';
  $('track-archive').disabled = blocked || unsaved || track?.lifecycle !== 'unpublished';
  all('#search-form input, #search-form button, #track-filter, .track-row').forEach(e => { e.disabled = blocked; });
  $('list-prev').disabled = blocked || page === 0; $('list-next').disabled = blocked || !nextBefore;
  $('music-reload').disabled = busy; $('mutation-retry').hidden = !journal?.get().pending; $('mutation-retry').disabled = busy;
  $('audit-open').disabled = busy || !service; $('audit-next').disabled = busy;
  all('[data-resume-upload]').forEach(e => { e.disabled = blocked; });
  $('save-reason-label').hidden = !track; $('save-reason').required = !!track;
  $('early-options').hidden = value('access-mode') !== 'early_access';
  $('early-until').required = value('access-mode') === 'early_access';
  $('track-version').textContent = unsaved ? '有未保存修改' : track ? '编辑版本 ' + track.editVersion : '未保存';
  $('assets-state').textContent = assetsDirty ? '有未保存的素材引用' : '素材与草稿一致';
  $('draft-notice').textContent = track?.published ? '保存修改不会替换已发布版本' : '保存草稿不会发布';
  uploadLabels();
  rolePreview.update({ id:track?.id, editVersion:track?.editVersion, active:activeStep === 3,
    dirty:dirty || assetsDirty || reviewDirty, blocked });
}
async function run(action) {
  if (busy) return;
  busy = true; sync();
  try { await action(); }
  catch (e) {
    if ([401,403].includes(e.status)) { locked = true; stopAudio(); }
    if (e.status === 409 && !e.code?.startsWith('UPLOAD_') && e.code !== 'MUSIC_STORAGE_QUOTA') locked = true;
    status((errorMessages[e.code] || e.message) + (e.code ? ' (' + e.code + ')' : ''), true);
  } finally { busy = false; sync(); }
}
async function checkActor() {
  const current = await request('/status');
  if (current.actorId !== actor) throw Object.assign(new Error('管理员账号已变化。请重新打开后台，不会重放其他账号的操作。'), { status:403 });
  service = current; renderService();
  return current;
}
function ask(title, description, reason = false) {
  return new Promise(resolve => {
    $('confirm-title').textContent = title; $('confirm-description').textContent = description;
    $('confirm-reason-label').hidden = !reason; $('confirm-reason').required = reason; $('confirm-reason').value = '';
    const dialog = $('confirm-dialog'); dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes' ? { reason:value('confirm-reason') } : null), { once:true });
    dialog.showModal();
  });
}
$('confirm-reason').onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); };
async function canLeave() { return !(dirty || assetsDirty || reviewDirty) || !!await ask('放弃未保存的修改？', '已上传的文件仍保留在上传会话中，不会被删除。'); }
function tab(index, focus = false) {
  index = Number.isInteger(index) && index >= 0 && index < 4 ? index : 0;
  if (index === 1 && activeStep === 3) renderAssets();
  activeStep = index;
  if (index === 3) stopAudio();
  for (let i = 0; i < 4; i++) { $('panel-' + i).hidden = i !== index; $('step-' + i).setAttribute('aria-selected', String(i === index)); $('step-' + i).tabIndex = i === index ? 0 : -1; }
  if (focus) $('step-' + index).focus();
  sync();
}
for (let i = 0; i < 4; i++) {
  $('step-' + i).onclick = () => { tab(i); persist(); };
  $('step-' + i).onkeydown = e => { const next = { ArrowRight:(i+1)%4, ArrowLeft:(i+3)%4, Home:0, End:3 }[e.key]; if (next !== undefined) { e.preventDefault(); tab(next,true); persist(); } };
}
function renderList() {
  $('track-list').replaceChildren();
  if (!items.length) $('track-list').append(el('p','暂无符合条件的曲目。','muted'));
  for (const row of items) {
    const b = el('button',undefined,'track-row'); b.type = 'button'; b.setAttribute('aria-current',String(row.id === track?.id));
    b.append(el('strong',Object.values(row.title || {}).find(Boolean) || row.slug),el('small',(names[row.lifecycle] || row.lifecycle) + ' · ' + row.slug));
    b.onclick = () => run(async () => { if (await canLeave()) { await loadTrack(row.id); status('已载入曲目。'); } });
    $('track-list').append(b);
  }
  $('list-page').textContent = '第 ' + (page + 1) + ' 页';
}
async function loadList() {
  const params = new URLSearchParams({ status:filter, q:query }); if (cursors[page]) params.set('before',cursors[page]);
  const r = await request('/tracks?' + params); items = r.items; nextBefore = r.nextBefore; renderList();
}
function fill(row) {
  stopAudio(); track = row; assets = { ...(revision()?.assets || { audio:null,preview:null,cover:null,lyrics:null }) }; evidence = [...(row?.rights?.evidenceIds || [])];
  all('#workspace form').forEach(f => f.reset()); const r = revision(), m = r?.metadata;
  $('workspace-empty').hidden = true; $('workspace').hidden = false;
  $('track-heading').textContent = m?.title?.[m.originalLocale] || (row ? row.slug : '新曲目');
  $('track-state').textContent = row ? names[row.lifecycle] : '未保存';
  $('track-slug').value = row?.slug || ''; $('track-slug').readOnly = !!row?.published;
  $('original-locale').value = m?.originalLocale || 'zh-Hans';
  $('creator-name').value = m?.creatorName || 'Station Cat'; $('track-language').value = m?.language || '';
  $('track-instrumental').checked = !!m?.instrumental;
  $('track-title').value = m?.title?.[value('original-locale')] || ''; $('track-summary').value = m?.summary?.[value('original-locale')] || '';
  for (const key of ['genres','moods']) $('track-' + key).value = (m?.[key] || []).join(', ');
  $('track-story').value = m?.story || '';
  all('[data-title-locale]').forEach(e => e.value = m?.title?.[e.dataset.titleLocale] || '');
  all('[data-summary-locale]').forEach(e => e.value = m?.summary?.[e.dataset.summaryLocale] || '');
  $('access-mode').value = r?.policy.accessMode || 'vip'; $('early-until').value = localTime(r?.policy.earlyAccessUntil);
  $('post-early').value = r?.policy.postEarlyAccessMode || 'vip';
  all('[data-right]').forEach(e => { const v = row?.rights?.review?.[e.dataset.right]; e.value = e.type === 'datetime-local' ? localTime(v) : v || ''; });
  $('rights-decision').value = row?.rights?.status || 'pending';
  dirty = false; assetsDirty = false; reviewDirty = false; renderAssets();
  document.querySelector('[data-right="exceptionEvidenceAssetId"]').value = row?.rights?.review?.exceptionEvidenceAssetId || '';
  renderReview(); renderList(); renderJobs(); sync();
}
async function loadTrack(id) {
  const row = await request('/tracks/' + id); fill(row); persist();
}
function rememberJob(job) {
  const jobs = journal.get().jobs.filter(j => j.localId !== job.localId); jobs.push(job); journal.update({ jobs }); renderJobs();
}
function attach(job, result) {
  job = { ...job, ...result, stage:'completed' }; rememberJob(job);
  if (track?.id === job.trackId) {
    if (job.kind === 'evidence') { if (!evidence.includes(job.assetId)) evidence.push(job.assetId); }
    else { assets[job.kind] = job.assetId; if (job.kind === 'audio') assets.preview = null; }
    assetsDirty = true; renderAssets(); persist();
  }
}
async function applyResult(op, result) {
  if (op.effect === 'reserve') rememberJob({ ...op.job, uploadId:result.uploadId, assetId:result.assetId, stage:'reserved' });
  else if (op.effect === 'complete') attach(op.job,result);
  else {
    // A draft revision drops its old rights approval; preserve the editable evidence package locally.
    const carried = evidence.slice(), previousRights = all('[data-right]').map(e => [e.dataset.right,e.value]);
    await loadTrack(result.trackId || op.trackId);
    if (op.effect === 'draft') {
      evidence = carried; renderAssets(); previousRights.forEach(([key,v]) => { const e = document.querySelector('[data-right="' + key + '"]'); if (e) e.value = v; }); persist();
    }
    await loadList();
  }
}
async function sendPending() {
  const op = journal.get().pending;
  if (!op) return;
  await checkActor();
  let result;
  try { result = await request(op.path,op); }
  catch (e) {
    if (!e.uncertain) journal.update({ pending:null });
    throw e;
  }
  // Keep the key until its result is reflected in the local recovery state.
  await applyResult(op,result); journal.update({ pending:null }); status('操作已确认。');
  return result;
}
async function mutate(path, method, body, effect, extra = {}) {
  if (journal.get().pending) throw new Error('请先核对上一笔操作。');
  persist(); const op = { path, method, body, effect, trackId:track?.id, key:crypto.randomUUID(), etag:track ? '"edit-' + track.editVersion + '"' : undefined, ...extra };
  journal.update({ pending:op }); return sendPending();
}
function metadata() {
  const originalLocale = value('original-locale'), title = {}, summary = {};
  all('[data-title-locale]').forEach(e => { if (e.value.trim()) title[e.dataset.titleLocale] = e.value.trim(); });
  all('[data-summary-locale]').forEach(e => { if (e.value.trim()) summary[e.dataset.summaryLocale] = e.value.trim(); });
  title[originalLocale] = value('track-title'); summary[originalLocale] = value('track-summary');
  const tags = id => value(id).split(/[,，]/).map(s => s.trim()).filter(Boolean);
  return { originalLocale,title,summary,creatorName:value('creator-name'),instrumental:$('track-instrumental').checked,language:value('track-language'),
    genres:tags('track-genres'),moods:tags('track-moods'),story:value('track-story') };
}
async function saveDraft(assetOnly = false) {
  const meta = assetOnly ? revision().metadata : metadata();
  const policy = assetOnly ? revision().policy : policyForSave(value('access-mode'),value('early-until'),value('post-early'),track?.published?.policy);
  const input = { slug:track?.published ? track.slug : value('track-slug'),metadata:meta,policy,assets };
  if (track) Object.assign(input,{ revisionId:revision().id,reason:assetOnly ? '更新曲目素材' : value('save-reason') });
  await mutate(track ? '/tracks/' + track.id : '/tracks',track ? 'PATCH' : 'POST',input,'draft');
  status('草稿已保存。修改后的版本需重新审核，已发布版本保持不变。');
}
function renderAssets() {
  all('[data-asset-kind]').forEach(container => {
    const kind = container.dataset.assetKind; container.querySelectorAll('audio').forEach(a => { a.onerror = null; a.pause(); a.removeAttribute('src'); a.load(); });
    container.replaceChildren();
    const ids = kind === 'evidence' ? evidence : [assets[kind]].filter(Boolean);
    if (!ids.length) container.append(el('p','尚未添加','muted'));
    ids.forEach((id,i) => {
      if (['audio','preview'].includes(kind)) {
        const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = assetUrl(id); audio.setAttribute('aria-label',kind === 'preview' ? '独立试听' : '完整音频试听');
        audio.onplay = () => all('audio').forEach(other => { if (audio !== other) other.pause(); });
        audio.onerror = () => status('音频无法播放，请核对文件或后台登录状态。',true); container.append(audio);
      } else if (kind === 'cover') {
        const img = document.createElement('img'); img.src = assetUrl(id); img.alt = '当前曲目封面'; img.width = 112; img.height = 112;
        img.onerror = () => { img.alt = '封面暂不可用'; }; container.append(img);
      } else { const a = el('a',kind === 'evidence' ? '查看凭证 ' + (i+1) : '下载歌词'); a.href = assetUrl(id); a.target = '_blank'; a.rel = 'noopener noreferrer'; container.append(a); }
      const info = track?.assets?.find(a => a.id === id) || journal?.get().jobs.find(j => j.assetId === id);
      container.append(el('p',(info?.durationMs ? (info.durationMs/1000).toFixed(2) + ' 秒 · ' : '') + (info?.byteSize || info?.actualBytes || info?.size ? bytes(info.byteSize || info.actualBytes || info.size) : '已验证素材'),'muted'));
      const remove = el('button','移除引用'); remove.type = 'button'; remove.dataset.removeAsset = kind;
      remove.onclick = () => {
        if (kind === 'evidence') evidence = evidence.filter(x => x !== id); else { assets[kind] = null; if (kind === 'audio') assets.preview = null; }
        assetsDirty = true; renderAssets(); persist(); sync();
      }; container.append(remove);
    });
  });
  const select = document.querySelector('[data-right="exceptionEvidenceAssetId"]'), selected = select.value;
  select.replaceChildren(new Option('未选择',''),...evidence.map((id,i) => new Option('凭证 ' + (i+1),id))); select.value = selected;
  $('evidence-count').textContent = '当前关联凭证：' + evidence.length + ' 份';
  $('upload-availability').textContent = !track ? '请先保存曲目草稿。' : !track.draft ? '已发布版本不可直接上传，请先保存一份新草稿。' :
    !service?.capabilities.uploads ? '上传尚未开放或未配置正配额。' : '文件验证通过后，保存素材到草稿。VIP 试听不得超过 45 秒或原曲一半，以较短者为准。';
}
function renderReview() {
  const r = track?.draft;
  $('rights-details').open = !!r && track?.rights?.status !== 'approved';
  $('technical-details').open = !!r && track?.rights?.status === 'approved' && !r.technicalReviewedAt;
  $('rights-state').textContent = ({ approved:'已通过', pending:'待审核', blocked:'不通过' })[track?.rights?.status] || '待审核';
  $('technical-state').textContent = revision()?.technicalReviewedAt ? '已核对' : '待核对';
  $('review-state').textContent = !r ? '发布版本已封存。修改资料需先保存为新草稿。' : '当前草稿 v' + r.number + '。修改资料、素材或权利后，须重新核对。';
  $('check-preview').hidden = $('check-source').hidden = !assets.preview; $('check-artwork').hidden = !assets.cover;
  $('publication-summary').textContent = (track?.published ? '已发布 v' + track.published.number + '。' : '尚未发布。') +
    (service?.flags.public ? '' : '公开音乐入口尚未开放，发布记录不代表公众可收听。');
}
function renderJobs() {
  const jobs = journal?.get().jobs.filter(j => j.trackId === track?.id) || [];
  $('upload-recovery').hidden = !jobs.length; $('upload-sessions').replaceChildren();
  jobs.forEach(job => {
    const label = { completed:'已验证',rejected:'已拒绝，仍占预留额度',expired:'已过期，仍占预留额度' }[job.stage];
    const row = el('div',undefined,'upload-session'); row.append(el('strong',names[job.kind] + ' · ' + job.name),el('p',label || '待核对 · ' + (job.uploadId || '等待预留回执'),'muted'));
    const b = el('button',job.stage === 'completed' ? '关联到当前草稿' : '查询并恢复'); b.type = 'button'; b.dataset.resumeUpload = job.localId;
    b.onclick = () => run(async () => {
      if (!track?.draft || dirty) throw new Error('请先保存当前资料为草稿，再恢复素材。');
      if (job.stage === 'completed') attach(job,job); else await resumeUpload(job);
    });
    row.append(b); $('upload-sessions').append(row);
  });
}
async function resumeUpload(job, file) {
  await checkActor();
  const current = await request('/uploads/' + job.uploadId);
  if (current.trackId !== job.trackId) throw new Error('会话与曲目不匹配。');
  if (current.status === 'completed') { attach(job,current); status('已恢复验证成功的素材，请保存到草稿。'); return; }
  if (current.expired || ['expired','rejected'].includes(current.status)) {
    rememberJob({ ...job,stage:current.expired ? 'expired' : 'rejected' });
    throw new Error('上传已过期或被拒绝；预留额度仍保留。请核对后重新选择文件创建新会话。');
  }
  if (current.status === 'reserved') {
    file ||= $('file-' + job.kind).files[0];
    if (file && isWav(file)) ({ file } = await prepareUploadFile(file,job.kind,job));
    if (!file || file.size !== job.size || await hashFile(file) !== job.sha256) throw new Error('请重新选择原文件，再点击此会话的“查询并恢复”。');
    // Conversion may take minutes. Recheck the actor immediately before any PUT.
    await checkActor();
    rememberJob({ ...job,stage:'writing' });
    status('正在上传 ' + job.name + '，请保持页面打开。');
    // Once PUT begins, never replay bytes. Query/complete is the recovery path.
    try { await request('/uploads/' + job.uploadId + '/body',{ method:'PUT',raw:true,type:job.type,body:file,key:job.writeKey,timeout:130000 }); }
    catch (e) { status('上传结果待核对，请使用会话的查询并恢复。',true); throw e; }
  }
  status('正在核验文件内容…');
  await mutate('/uploads/' + job.uploadId + '/complete','POST',{},'complete',{ job });
  status('文件已验证，请保存素材到草稿。');
}
all('[data-upload-kind]').forEach(button => { button.onclick = () => run(async () => {
  const kind = button.dataset.uploadKind, source = $('file-' + kind).files[0]; if (!source) throw new Error('请先选择文件。');
  if (kind === 'evidence' && evidence.length >= 10) throw new Error('每曲最多关联 10 份凭证。');
  const input = { trackId:track.id,kind };
  if (kind === 'preview') {
    const start = Number(value('preview-start')), end = Number(value('preview-end'));
    if (!assets.audio || !value('preview-end') || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('请先上传原曲，并填写有效的试听来源区间。');
    Object.assign(input,{ sourceAssetId:assets.audio,sourceStartMs:Math.round(start*1000),sourceEndMs:Math.round(end*1000) });
  }
  const { file,conversion,seconds } = await prepareUploadFile(source,kind);
  if (kind === 'preview' && conversion && Math.abs(seconds * 1000 - (input.sourceEndMs - input.sourceStartMs)) > 250) throw new Error('试听 WAV 时长与填写的来源区间不一致，请核对后重试。');
  const { format,type } = fileFormat(kind,file); Object.assign(input,{ format,byteSize:file.size });
  input.sha256 = await hashFile(file,p => status('正在校验文件 ' + p + '%'));
  const job = { localId:crypto.randomUUID(),trackId:track.id,kind,name:file.name,size:file.size,sha256:input.sha256,type,writeKey:crypto.randomUUID(), ...(conversion ? { conversion } : {}) };
  const result = await mutate('/uploads','POST',input,'reserve',{ job });
  await resumeUpload({ ...job,uploadId:result.uploadId,assetId:result.assetId },file);
  $('file-' + kind).value = ''; sync();
}); });
$('track-form').onsubmit = e => { e.preventDefault(); if ($('track-form').reportValidity()) run(() => saveDraft()); };
$('assets-save').onclick = () => run(() => saveDraft(true));
$('rights-form').onsubmit = e => { e.preventDefault(); run(async () => {
  if (!await ask('提交权利核对？','结论：' + $('rights-decision').selectedOptions[0].textContent + '。此次核对会使原技术审核失效。')) return;
  const review = {};
  all('[data-right]').forEach(e => { const key = e.dataset.right; review[key] = e.type === 'datetime-local' && e.value ? new Date(e.value).toISOString() : e.value.trim(); });
  if (!review.sourceSongUrl) review.sourceSongUrl = null;
  await mutate('/revisions/' + track.draft.id + '/rights-review','PUT',{ status:value('rights-decision'),review,evidenceIds:evidence,reason:value('rights-reason') },'rights');
}); };
$('technical-form').onsubmit = e => { e.preventDefault(); run(async () => {
  const checks = Object.fromEntries(all('[data-tech]').map(e => [e.dataset.tech,e.checked]));
  if (!checks.audioListened || (assets.preview && (!checks.previewListened || !checks.previewSourceConfirmed)) || (assets.cover && !checks.artworkChecked)) throw new Error('请先完成实际试听和图像核对，再勾选对应确认项。');
  await mutate('/revisions/' + track.draft.id + '/technical-review','PUT',{ ...checks,reason:value('technical-reason') },'technical');
}); };
for (const action of ['publish','unpublish','archive']) $('track-' + action).onclick = () => run(async () => {
  const label = { publish:'发布',unpublish:'下架',archive:'归档' }[action];
  const confirm = await ask(label + '曲目？',$('track-heading').textContent + ' · ' + ({ free:'免费精选',vip:'VIP 专享',early_access:'VIP 抢先听' })[revision()?.policy.accessMode] +
    (action === 'archive' ? '。归档后本工作区不提供恢复操作。' : action === 'publish' ? '。将封存当前审核版本；不改变公开入口开关。' : '。将停止公开展示此曲目。'),true);
  if (!confirm) return;
  const input = { reason:confirm.reason };
  if (action !== 'archive') input.revisionId = (action === 'publish' ? track.draft : track.published).id;
  if (action === 'publish') input.confirmedPolicyVersion = track.draft.policy.policyVersion;
  await mutate('/tracks/' + track.id + '/' + action,'POST',input,action);
});
all('#workspace input:not([type=file]), #workspace select, #workspace textarea').forEach(e => e.addEventListener('input',() => {
  if (e.closest('#role-preview')) return;
  if (e.closest('#track-form')) dirty = true;
  if (e.closest('#rights-form')) reviewDirty = true;
  if (e.id === 'track-title' || e.id === 'track-summary') {
    const selector = e.id === 'track-title' ? 'titleLocale' : 'summaryLocale';
    all(selector === 'titleLocale' ? '[data-title-locale]' : '[data-summary-locale]').find(x => x.dataset[selector] === value('original-locale')).value = e.value;
  }
  if (e.dataset.titleLocale === value('original-locale')) $('track-title').value = e.value;
  if (e.dataset.summaryLocale === value('original-locale')) $('track-summary').value = e.value;
  try { persist(); } catch { locked = true; status('无法保存恢复记录，已暂停写操作。',true); } sync();
}));
$('original-locale').onchange = () => { $('track-title').value = all('[data-title-locale]').find(e => e.dataset.titleLocale === value('original-locale')).value; $('track-summary').value = all('[data-summary-locale]').find(e => e.dataset.summaryLocale === value('original-locale')).value; persist(); };
$('track-new').onclick = () => run(async () => { if (await canLeave()) { fill(null); tab(0); persist(); status('新曲目会先保存为草稿。'); $('track-title').focus(); } });
async function changeList(target, newFilter = filter, newQuery = query) {
  if (!await canLeave()) { $('track-filter').value = filter; $('track-search').value = query; return; }
  const previous = { page,filter,query,cursors:[...cursors] };
  page = target; filter = newFilter; query = newQuery; if (target === 0) cursors = [null];
  try { await loadList(); } catch (e) { ({page,filter,query,cursors} = previous); throw e; }
}
$('search-form').onsubmit = e => { e.preventDefault(); run(() => changeList(0,value('track-filter'),value('track-search'))); };
$('track-filter').onchange = () => run(() => changeList(0,value('track-filter'),query));
$('list-prev').onclick = () => run(() => changeList(page-1));
$('list-next').onclick = () => run(async () => { cursors[page+1] = nextBefore; await changeList(page+1); });
$('mutation-retry').onclick = () => run(async () => { if (await ask('重试原操作？','沿用原内容、版本和幂等键核对结果，不创建新的操作。')) await sendPending(); });
async function loadAudit(append = false) {
  const result = await request('/audit' + (append && auditBefore ? '?before=' + auditBefore : ''));
  if (!append) $('audit-list').replaceChildren();
  if (!result.items.length && !append) $('audit-list').append(el('p','暂无操作记录。'));
  result.items.forEach(item => { const row = el('article',undefined,'audit-entry'); row.append(el('strong',item.action),el('p',item.actorId + ' · ' + new Date(item.createdAt).toLocaleString()),el('p','目标：' + item.targetId,'muted'),el('p',JSON.stringify(item.summary),'muted')); $('audit-list').append(row); });
  auditBefore = result.nextBefore; $('audit-next').hidden = !auditBefore;
}
$('audit-open').onclick = () => run(async () => { await loadAudit(); $('audit-dialog').showModal(); });
$('audit-close').onclick = () => $('audit-dialog').close(); $('audit-next').onclick = () => run(() => loadAudit(true));
function restore(saved) {
  fill(saved.track); assets = saved.assets; evidence = saved.evidence; renderAssets();
  for (const [key,v] of Object.entries(saved.inputs || {})) {
    const e = key.startsWith('r:') ? document.querySelector('[data-right="' + key.slice(2) + '"]') :
      key.startsWith('t:') ? document.querySelector('[data-title-locale="' + key.slice(2) + '"]') :
      key.startsWith('s:') ? document.querySelector('[data-summary-locale="' + key.slice(2) + '"]') : $(key);
    if (e && e.closest('#workspace')) { if (e.type === 'checkbox') e.checked = v; else e.value = v; }
  }
  dirty = saved.dirty; assetsDirty = saved.assetsDirty; reviewDirty = !!saved.reviewDirty; tab(saved.activeStep || 0); renderReview(); sync();
}
function renderService() {
  const next = service;
  $('environment').textContent = next.flags.public ? '公开入口已开放' : '公开入口未开放';
  $('storage').textContent = next.storage ? '已占用 ' + bytes(next.storage.chargedBytes) + ' / ' + bytes(next.storage.quotaBytes) + (next.storage.nearQuota ? ' · 配额紧张' : '') : '上传配额尚未配置';
}
async function boot() {
  const next = await request('/status');
  if (actor && actor !== next.actorId) { locked = true; stopAudio(); throw new Error('管理员账号已切换，请重新打开页面。'); }
  actor = next.actorId; journal ||= createJournal(sessionStorage,actor); service = next;
  renderService();
  await loadList();
  const saved = journal.get().workspace;
  if (saved) restore(saved);
  const params = new URLSearchParams(location.search), target = params.get('track');
  if (params.getAll('track').length === 1 && uuid(target) && target !== track?.id) {
    if (journal.get().pending) { status('请先核对此标签页的原操作，再打开目标曲目。',true); return; }
    if (!await canLeave()) { status('已保留原编辑内容，未切换到目标曲目。'); return; }
    await loadTrack(target); status('已载入目标曲目，请逐首补齐素材和审核。'); return;
  }
  status(journal.get().pending ? '有一笔结果待确认的操作。请核对并重试原操作。' : saved ? '已恢复此标签页的编辑内容。' : '曲库已载入。');
}
$('music-reload').onclick = () => run(async () => {
  if (journal?.get().pending) { await checkActor(); status('请使用“核对并重试原操作”，避免重复写入。'); return; }
  if (!await canLeave()) return;
  if (!service) { await boot(); return; }
  service = await checkActor(); locked = false;
  if (track) await loadTrack(track.id); await loadList(); status('已重新读取当前版本。');
});
window.addEventListener('beforeunload',e => { if (dirty || assetsDirty || reviewDirty || busy || journal?.get().pending) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('pagehide',() => { stopAudio(); wavConverter.cancel(); });
run(boot);
mountMusicAdminAnalytics();
