import { createMusicShareCards, shareMusicCardFile } from './musicShareCardClient.js';
import { musicShareUrl, shareMusicLink } from '../music/navigation.js';
import { musicXShareHref } from '../music/shareCard.js';

export function mountMusicShareCardPanel(root, { t, locale, origin, navigator, fetcher, panels }) {
  const dialog = root.querySelector('[data-share-card-dialog]'); if (!dialog) return null;
  const abort = new AbortController(), $ = selector => dialog.querySelector(selector);
  const on = (node, name, fn) => node.addEventListener(name, fn, { signal: abort.signal });
  let track = null, key = '', format = 'poster', actionEpoch = 0, retryTimer = null;
  const targetUrl = () => musicShareUrl(origin, locale, track.type === 'album' ? { collection: track.slug } : { track: track.id });
  const message = $('[data-card-message]'), image = $('[data-card-image]'), save = $('[data-card-save]'), native = $('[data-card-native]');
  const hideInput = () => { $('[data-card-url]').hidden = true; $('[data-card-url]').value = ''; };
  const controller = createMusicShareCards({ fetcher, origin, locale, onChange(state) {
    actionEpoch++; hideInput(); clearInterval(retryTimer); retryTimer = null;
    $('[data-card-retry]').disabled = false;
    image.hidden = state.status !== 'ready'; save.hidden = state.status !== 'ready'; native.disabled = state.status !== 'ready';
    dialog.dataset.cardFormat = state.format;
    $('[data-card-retry]').hidden = state.status !== 'error';
    $('[data-card-busy]').hidden = state.status !== 'loading';
    if (state.imageUrl) { image.src = state.imageUrl; save.href = state.imageUrl; image.alt = t(state.data.kind === 'album' ? '专辑分享卡片：{title}' : '歌曲分享卡片：{title}', { title: state.data.title }); }
    else { image.removeAttribute('src'); save.removeAttribute('href'); }
    if (state.data) { $('[data-card-track]').textContent = state.data.title; $('[data-card-x]').href = musicXShareHref(state.data.title, state.data.url); }
    const code = state.code === 'SHARE_RATE_LIMITED' ? '制作太频繁，请稍后重试。' : state.code === 'SHARE_TRACK_UNAVAILABLE' ? '内容已不可用，无法制作卡片。' : '卡片暂时无法制作，仍可复制链接。';
    message.textContent = state.status === 'loading' ? t('正在制作分享卡片…') : state.status === 'ready' ? t('分享卡片已准备好。') : state.status === 'error' ? t(code) : '';
    if (state.status === 'error' && state.code === 'SHARE_RATE_LIMITED' && state.retryAfter > 0) {
      const until = Date.now() + state.retryAfter * 1000;
      const updateRetry = () => {
        const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        $('[data-card-retry]').disabled = seconds > 0;
        message.textContent = seconds > 0 ? t('请在 {seconds} 秒后重试。', { seconds }) : t('重新制作卡片');
        if (!seconds) { clearInterval(retryTimer); retryTimer = null; }
      };
      updateRetry(); retryTimer = setInterval(updateRetry, 1000);
    }
  } });
  const open = (opener = root.querySelector('[data-share-music="track"]')) => {
    if (!track) return;
    $('[data-card-heading]').textContent = t(track.type === 'album' ? '分享专辑' : '分享歌曲');
    $('[data-card-hint]').textContent = t(track.type === 'album' ? '将这张专辑分享给朋友，扫码即可打开专辑页面。' : '将这首歌分享给朋友。扫码后打开歌曲页面，收听资格以页面为准。');
    format = 'poster'; $('[data-card-track]').textContent = track.title;
    $('[data-card-x]').href = musicXShareHref(track.title, targetUrl());
    dialog.querySelectorAll('[data-card-format]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cardFormat === format)));
    panels.open('share', opener);
    void controller.prepare(track, format);
  };
  on(dialog, 'close', () => { if (!dialog.open) { actionEpoch++; controller.close(); } });
  // Browser Forward can restore a presentation-only share marker. Rebuild from the
  // current public track rather than reviving a revoked blob or storing media in history.
  const observer = new MutationObserver(() => {
    if (dialog.open && track && controller.snapshot().status === 'idle') void controller.prepare(track, format);
    else if (!dialog.open && controller.snapshot().status !== 'idle') controller.close();
  });
  observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  // Keep keyboard-focused actions below the sticky heading at enlarged text sizes.
  const heading = dialog.querySelector('.station-music-share-heading');
  const headingObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    dialog.style.setProperty('--music-share-heading-space', `${heading.getBoundingClientRect().height + 18}px`);
  }) : null;
  headingObserver?.observe(heading);
  on(image, 'error', () => { if (controller.snapshot().status === 'ready') controller.imageFailed(); });
  on($('[data-card-retry]'), 'click', () => { if (track) void controller.prepare(track, format); });
  dialog.querySelectorAll('[data-card-format]').forEach(button => on(button, 'click', () => {
    if (!track || format === button.dataset.cardFormat) return;
    format = button.dataset.cardFormat;
    dialog.querySelectorAll('[data-card-format]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    void controller.prepare(track, format);
  }));
  on(native, 'click', async () => {
    const state = controller.snapshot(); if (state.status !== 'ready') return;
    const epoch = ++actionEpoch;
    const result = await shareMusicCardFile(state.blob, state.data.title, { navigator });
    if (abort.signal.aborted || epoch !== actionEpoch || !dialog.open) return;
    if (result !== 'cancelled') message.textContent = t(result === 'shared' ? '分享窗口已完成。' : '无法分享图片，请保存或长按图片。');
  });
  on($('[data-card-copy]'), 'click', async () => {
    if (!track) return;
    const epoch = ++actionEpoch, state = controller.snapshot(); hideInput();
    const url = state.data?.url || targetUrl();
    const result = await shareMusicLink({ title: track.title, url }, { navigator, copyOnly: true });
    if (abort.signal.aborted || epoch !== actionEpoch || !dialog.open) return;
    message.textContent = t(result.status === 'copied' ? '链接已复制。' : '请选中并复制下面的链接。');
    if (result.status === 'manual') { const input = $('[data-card-url]'); input.hidden = false; input.value = url; input.focus(); input.select(); }
  });
  return { open, update(value) {
    const next = value ? JSON.stringify(value.type === 'album' ? ['album',value.id,value.slug,value.version,value.title,value.description,value.trackIds] : ['track',value.id,value.audioVersion,value.effectiveAccess,value.previewAvailable]) : '';
    if (next !== key) { actionEpoch++; controller.close(); if (dialog.open) panels.close(); key = next; }
    track = value;
  }, destroy() { clearInterval(retryTimer); headingObserver?.disconnect(); observer.disconnect(); abort.abort(); controller.destroy(); } };
}
