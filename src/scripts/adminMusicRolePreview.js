import { createMusicRolePreviewReader, musicRolePreview } from './musicRolePreview.js';
import { formatMusicTime } from './musicPlayerCatalog.js';
import { musicText } from './musicMessages.js';

const labels = { visitor:'访客', account:'普通账号', vip:'有效 VIP', expired:'过期 VIP' };
const reasons = {
  PUBLIC_DISABLED:'公开音乐入口尚未开放。', NOT_PUBLISHED:'此版本当前未公开。', AUDIO_MISSING:'尚未保存完整音频，无法预演播放按钮。',
  FREE:'免费精选', VIP_ACTIVE:'VIP 完整收听', VIP_DISABLED:'VIP 资格有效，完整音频暂未开放。',
  LOGIN:'请登录后重新核验，或手动播放试听。', EXPIRED:'当前没有完整收听资格，可手动播放试听或前往会员中心。',
  VIP_REQUIRED:'当前没有完整收听资格，可手动播放试听或前往会员中心。'
};

export function mountAdminMusicRolePreview({ root, request, actorId, onAssets, onAuthError }) {
  const $ = key => root.querySelector('[data-role-' + key + ']');
  const el = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
  let context = {}, snapshot = null, key = '', state = 'empty';
  const available = () => context.active && context.id && !context.blocked && !document.hidden;
  function draw() {
    $('cards').replaceChildren(); $('action').textContent = ''; $('detail').hidden = true;
    $('unsaved').hidden = !context.dirty;
    $('refresh').disabled = !available() || state === 'loading';
    $('controls').disabled = state !== 'ready';
    if (state !== 'ready' || !snapshot) { $('flags').textContent = ''; return; }
    try {
      const revision = $('revision').value;
      $('boundary').disabled = snapshot.row[revision]?.policy.accessMode !== 'early_access';
      if ($('boundary').disabled) $('time').value = 'read';
      const view = musicRolePreview(snapshot.row, snapshot.flags, { revision, locale:$('locale').value, scenario:$('scenario').value, at:$('time').value });
      const t = musicText($('locale').value);
      $('notice').textContent = `${revision === 'draft' ? '已保存草稿' : '发布版本'} v${view.revisionNumber} · 读取于 ${view.readAt}（UTC）。` +
        (snapshot.row.editVersion !== context.editVersion ? ' 服务器版本已变化，本地编辑内容未被覆盖；写入前请重新读取。' : '') +
        (view.simulated ? ' 正在假设此版本发布且公开入口、VIP 完整播放均开放；实际开关不变。' : ' 按读取到的发布状态与开关展示。');
      $('flags').textContent = `实际开关快照：公开入口${snapshot.flags.public ? '开' : '关'} · VIP 完整播放${snapshot.flags.vipDelivery ? '开' : '关'}`;
      $('policy').textContent = '此刻策略：' + (view.policy.effectiveAccess === 'free' ? '免费' : 'VIP') +
        (view.policy.accessMode === 'early_access' ? ` · 抢先结束 ${view.policy.earlyAccessUntil}，之后${view.policy.postEarlyAccessMode === 'free' ? '免费' : 'VIP'}` : '') +
        ($('time').value === 'boundary' ? ' · 正在模拟结束时刻' : '');
      $('material').textContent = `${view.coverAvailable ? '已关联封面' : '未关联封面'} · ${view.lyricsAvailable ? '已关联歌词' : '未关联歌词'}。发布后的封面与歌词对四种身份均公开展示；此处不加载素材。`;
      $('story').textContent = view.story || '尚未填写创作故事。'; $('detail').hidden = false;
      for (const role of view.roles) {
        const card = el('section', '', 'role-card'); card.dataset.previewRole = role.role; card.setAttribute('aria-label', labels[role.role]);
        const header = el('header', ''), identity = el('h3', labels[role.role]); header.append(identity, el('span','模拟','badge'));
        const content = el('div',''); content.lang = $('locale').value;
        content.append(el('h4',view.title), el('p',view.creatorName + (view.durationSec ? ' · ' + formatMusicTime(view.durationSec) : ''),'muted'), el('p',view.summary));
        const reason = role.reason === 'VIP_DISABLED' && role.role !== 'vip' ? 'VIP 完整音频暂未开放。' : reasons[role.reason];
        content.append(el('p', t(reason), 'role-message'));
        const action = el('button', role.variant === 'preview' ? t('播放试听') : role.variant === 'full' ? t('播放') : t('暂不可播放'), 'primary');
        action.type = 'button'; action.disabled = !role.variant; action.dataset.previewVariant = role.variant || '';
        action.onclick = () => { $('action').textContent = `${labels[role.role]}：这里只演示${role.variant === 'full' ? '完整播放' : '独立试听'}按钮，不会请求音频。核对声音请前往“素材”。`; };
        content.append(action);
        if (role.variant === 'preview') content.append(el('p',t('试听') + ' · ' + formatMusicTime(view.previewDurationSec) + ' · ' + t('仅手动试听'),'muted'));
        if (['LOGIN','EXPIRED','VIP_REQUIRED'].includes(role.reason)) {
          const membership = el('button', t('会员中心')); membership.type = 'button'; membership.className = 'role-membership';
          membership.onclick = () => { $('action').textContent = `${labels[role.role]}：正式页面前往既有会员中心；本预览不跳转、不登录，也不修改会员资格。`; };
          content.append(membership);
        }
        card.append(header, content); $('cards').append(card);
      }
    } catch {
      $('cards').replaceChildren(); $('notice').textContent = '此版本的数据不完整或暂不支持预览，请重新读取并核对素材与策略。';
    }
  }
  const reader = createMusicRolePreviewReader({ request, actorId, onChange(next) {
    state = next.state; snapshot = next.state === 'ready' ? next : null;
    if (snapshot) {
      for (const option of $('revision').options) option.disabled = !snapshot.row[option.value];
      if (!snapshot.row[$('revision').value]) $('revision').value = snapshot.row.draft ? 'draft' : 'published';
    }
    $('notice').textContent = state === 'loading' ? '正在读取已保存版本与开关…' : state === 'error' ? '无法确认预览数据或后台身份，请重新读取；旧预览已清除。' : next.message || '保存曲目后可预览四种身份的收听界面。';
    draw();
    if (next.denied || next.message === 'ROLE_PREVIEW_ACTOR_CHANGED') onAuthError();
  } });
  const refresh = () => { if (available()) return reader.read(context.id); };
  $('refresh').onclick = refresh;
  $('assets').onclick = onAssets;
  root.querySelectorAll('select').forEach(select => select.addEventListener('change', draw));
  document.addEventListener('visibilitychange', () => { reader.clear('预览已清除，请重新读取。'); if (!document.hidden) refresh(); });
  window.addEventListener('pagehide', () => reader.clear());
  return { update(next) {
    context = next;
    const nextKey = available() ? next.id + ':' + next.editVersion : '';
    if (nextKey !== key) { key = nextKey; reader.clear(); if (key) refresh(); }
    $('unsaved').hidden = !next.dirty;
    $('refresh').disabled = !available() || state === 'loading';
  } };
}
