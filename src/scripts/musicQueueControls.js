import { musicText } from './musicMessages.js';
const repeatText = { off: '顺序播放', all: '列表循环', one: '单曲循环' };

export function mountMusicQueueControls(root, { queue, player, getVisibleTracks, getAllTracks = getVisibleTracks, panels = null }) {
  const t = musicText(root.dataset.locale);
  const $ = selector => root.querySelector(selector), abort = new AbortController();
  const dialog = $('[data-queue-dialog]'), list = $('[data-queue-list]');
  const rows = new Map();
  let signature = '', pendingRemoval = null, queueOpener = null;
  const toggles = [...root.querySelectorAll('[data-queue-toggle]')];
  const on = (node, event, callback) => node.addEventListener(event, callback, { signal: abort.signal });
  const text = (selector, value) => { const node = $(selector); if (node.textContent !== value) node.textContent = value; };
  const render = state => {
    text('[data-queue-count]', String(state.items.length));
    text('[data-repeat-label]', t(repeatText[state.repeat]));
    $('[data-repeat]').setAttribute('aria-label', t('{mode}，点击切换循环方式', { mode: t(repeatText[state.repeat]) }));
    $('[data-repeat]').dataset.active = String(state.repeat !== 'off');
    $('[data-repeat-one-icon]').toggleAttribute('hidden', state.repeat !== 'one');
    $('[data-repeat-icon]').toggleAttribute('hidden', state.repeat === 'one');
    $('[data-shuffle]').setAttribute('aria-pressed', String(state.shuffle));
    $('[data-play-all]').disabled = getVisibleTracks().length === 0;
    $('[data-previous]').disabled = !state.activeTrackId || !state.items.length;
    $('[data-next]').disabled = !state.items.length;
    for (const selector of ['[data-queue-notice]', '[data-dock-queue-notice]']) {
      text(selector, t(state.notice?.message || '')); $(selector).hidden = !state.notice;
    }
    $('[data-queue-empty]').hidden = state.items.length > 0;
    $('[data-queue-clear]').disabled = !state.items.length;
    const selected = getAllTracks().find(track => track.id === state.activeTrackId);
    $('[data-queue-add]').disabled = !selected || state.items.some(track => track.id === selected.id);
    const nextSignature = state.items.map(track => track.id).join(',');
    if (nextSignature !== signature) {
      const focused = document.activeElement?.closest('[data-queue-id]');
      const focusId = focused?.dataset.queueId, focusRemove = document.activeElement?.hasAttribute('data-queue-remove');
      signature = nextSignature; rows.clear();
      const fragment = document.createDocumentFragment();
      for (const track of state.items) {
        const row = $('[data-queue-template]').content.firstElementChild.cloneNode(true);
        row.dataset.queueId = track.id; fragment.append(row); rows.set(track.id, row);
      }
      list.replaceChildren(fragment);
      if (dialog.open && focusId) {
        (rows.get(focusId)?.querySelector(focusRemove ? '[data-queue-remove]' : '[data-queue-play]') || $('[data-queue-close]')).focus();
      }
    }
    for (const [index, track] of state.items.entries()) {
      const row = rows.get(track.id), current = state.activeTrackId === track.id;
      row.dataset.current = String(current);
      row.querySelector('[data-queue-title]').textContent = track.title;
      row.querySelector('[data-queue-meta]').textContent = `${index + 1} · ${!track.available ? t('暂不可用') : track.canPlayFull ? t('完整收听') : track.previewAvailable ? t('仅手动试听') : t('暂无试听')}${current ? ` · ${t('当前曲目')}` : ''}`;
      const play = row.querySelector('[data-queue-play]');
      play.disabled = (!track.available || (!track.canPlayFull && !track.previewAvailable)) &&
        !(current && ['loading', 'playing', 'buffering'].includes(player.snapshot().status));
      play.setAttribute('aria-label', t('{action}队列曲目：{title}', { action: current && ['loading', 'playing', 'buffering'].includes(player.snapshot().status) ? t('暂停') : t('播放'), title: track.title }));
      row.querySelector('[data-queue-remove]').setAttribute('aria-label', t('移出队列：{title}', { title: track.title }));
    }
    if (pendingRemoval && pendingRemoval !== state.activeTrackId) {
      pendingRemoval = null;
      if (dialog.open && $('[data-queue-confirm]').contains(document.activeElement)) $('[data-queue-close]').focus();
    }
    $('[data-queue-confirm]').hidden = !pendingRemoval;
  };
  on($('[data-play-all]'), 'click', () => queue.playAll(getVisibleTracks()));
  on($('[data-previous]'), 'click', () => queue.previous());
  on($('[data-next]'), 'click', () => queue.next());
  on($('[data-shuffle]'), 'click', () => queue.setShuffle(!queue.snapshot().shuffle));
  on($('[data-repeat]'), 'click', () => queue.setRepeat({ off: 'all', all: 'one', one: 'off' }[queue.snapshot().repeat]));
  for (const toggle of toggles) on(toggle, 'click', () => {
    queueOpener = toggle;
    if (panels) panels.open('queue', toggle); else if (!dialog.open) dialog.showModal();
    toggles.forEach(node => node.setAttribute('aria-expanded', 'true'));
  });
  on($('[data-queue-close]'), 'click', () => panels ? panels.close() : dialog.close());
  on(dialog, 'close', () => {
    pendingRemoval = null; $('[data-queue-confirm]').hidden = true;
    toggles.forEach(node => node.setAttribute('aria-expanded', 'false'));
    if (!panels) queueOpener?.focus();
  });
  on(list, 'click', event => {
    const button = event.target.closest('button'), row = button?.closest('[data-queue-id]');
    if (!row || !list.contains(row) || button.disabled) return;
    if (button.hasAttribute('data-queue-play')) queue.playQueued(row.dataset.queueId);
    else if (queue.remove(row.dataset.queueId)?.requiresConfirmation) {
      pendingRemoval = row.dataset.queueId;
      text('[data-queue-confirm-title]', t('移除「{title}」后：', { title: row.querySelector('[data-queue-title]').textContent }));
      $('[data-queue-confirm]').hidden = false; $('[data-remove-next]').focus();
    }
  });
  const removeCurrent = action => {
    const id = pendingRemoval; pendingRemoval = null;
    if (id) queue.remove(id, { currentAction: action });
    $('[data-queue-confirm]').hidden = true; $('[data-queue-close]').focus();
  };
  on($('[data-remove-next]'), 'click', () => removeCurrent('next'));
  on($('[data-remove-stop]'), 'click', () => removeCurrent('stop'));
  on($('[data-remove-cancel]'), 'click', () => {
    const id = pendingRemoval; pendingRemoval = null; $('[data-queue-confirm]').hidden = true;
    (rows.get(id)?.querySelector('[data-queue-remove]') || $('[data-queue-close]')).focus();
  });
  on($('[data-queue-add]'), 'click', () => {
    const track = getAllTracks().find(item => item.id === player.snapshot().activeTrackId);
    if (track) queue.append([track]);
  });
  on($('[data-queue-clear]'), 'click', () => { pendingRemoval = null; queue.clear(); $('[data-queue-close]').focus(); });
  const unsubscribe = queue.subscribe(render);
  return { destroy() { unsubscribe(); abort.abort(); if (dialog.open) dialog.close(); } };
}
