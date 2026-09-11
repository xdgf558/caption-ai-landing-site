import { fetchMusicLyrics, currentLyricIndex } from './musicLyrics.js';

export function mountMusicLyrics(root, { t, fetcher, document = root.ownerDocument } = {}) {
  const panel = root.querySelector('[data-lyrics-panel]');
  const message = root.querySelector('[data-lyrics-message]'), content = root.querySelector('[data-lyrics-content]');
  const back = root.querySelector('[data-lyrics-follow]'), retry = root.querySelector('[data-lyrics-retry]');
  const abort = new AbortController();
  let track = null, state = null, key = '', epoch = 0, request = null, timer = null, parsed = null, active = -1, following = true, loading = false;
  const on = (node, event, handler) => node.addEventListener(event, handler, { signal: abort.signal });
  const stop = () => { epoch++; request?.abort(); request = null; clearTimeout(timer); loading = false; };
  const highlight = () => {
    const matches = track && state?.activeTrackId === track.id && state.activeAudioVersion === track.audioVersion;
    const index = matches && parsed?.kind === 'lrc' ? currentLyricIndex(parsed.lines, state.currentTimeSec, state.activeVariant === 'preview' ? state.previewSourceStartSec || 0 : 0) : -1;
    back.hidden = following || index < 0;
    if (index === active) return;
    if (active >= 0) content.children[active]?.removeAttribute('aria-current');
    active = index;
    if (index >= 0) {
      const line = content.children[index]; line?.setAttribute('aria-current', 'true');
      // Scroll only the lyric region, never the page or another song's drawer.
      if (line && following && panel.open && !document.hidden && content.getClientRects().length) content.scrollTo({ top: line.offsetTop - content.clientHeight / 2 + line.offsetHeight / 2, behavior: 'auto' });
    }
  };
  const load = async () => {
    if (!panel.open || !track || parsed || loading) return;
    if (track.instrumental) { message.textContent = t('这首作品为纯音乐'); return; }
    if (track.lyricsKind === 'none') { message.textContent = t('暂未提供歌词'); return; }
    stop(); const generation = epoch, selected = track;
    request = new AbortController(); loading = true; retry.hidden = true;
    message.textContent = t('正在加载歌词…');
    timer = setTimeout(() => request?.abort(), 8000);
    try {
      const result = await fetchMusicLyrics(selected, { fetcher, signal: request.signal });
      if (generation !== epoch) return;
      parsed = result; content.replaceChildren();
      if (result.kind === 'lrc') for (const row of result.lines) { const node = document.createElement('p'); node.textContent = row.text || ' '; content.append(node); }
      else content.textContent = result.text;
      message.textContent = result.kind === 'txt' && result.warnings ? t('时间标记不可用，显示普通歌词。') : result.kind === 'lrc' ? t('手动滚动可暂停跟随。') : '';
      highlight();
    } catch {
      if (generation === epoch) { message.textContent = t('歌词暂时无法加载，请重试。'); retry.hidden = false; }
    } finally { if (generation === epoch) { clearTimeout(timer); request = null; loading = false; } }
  };
  on(panel, 'toggle', () => { if (panel.open) { active = -1; void load(); highlight(); } else stop(); });
  on(retry, 'click', () => { parsed = null; void load(); });
  const manual = () => { following = false; back.hidden = active < 0; };
  on(content, 'wheel', manual); on(content, 'touchmove', manual); on(content, 'pointerdown', manual);
  on(content, 'keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) manual(); });
  on(back, 'click', () => { following = true; active = -1; highlight(); });
  return {
    update(value, snapshot) {
      track = value; state = snapshot;
      const next = track ? `${track.id}:${track.audioVersion}:${track.lyricsKind}:${track.instrumental}` : '';
      if (next !== key) { stop(); key = next; parsed = null; active = -1; following = true; content.replaceChildren(); content.scrollTop = 0; message.textContent = ''; retry.hidden = true; back.hidden = true; }
      if (!document.hidden) { void load(); highlight(); }
    },
    destroy() { stop(); abort.abort(); }
  };
}
