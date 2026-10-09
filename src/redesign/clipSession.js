// One native video per attempt, created only inside a user gesture. A retired
// element has no source/listeners; late events and play promises cannot revive it.
export function createStationClipSession({ clips, createVideo, pauseMusic, mount = () => {}, view = () => {}, observer=()=>{} }) {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  let clip = null, video = null, handlers = null, generation = 0, status = 'idle', error = null, destroyed = false;
  let playbackId=null;
  const observe=()=>{try{observer({clip,video,playbackId,status});}catch{}};
  const snapshot = () => ({ clip, status, error, generation });
  const emit = () => { if (!destroyed) { view(snapshot());observe();} };
  function unload(node) {
    if (!node) return;
    node.pause(); node.removeAttribute('src'); node.removeAttribute('poster'); node.load(); node.remove();
  }
  function stop() {
    generation++; handlers?.abort(); handlers = null;
    const previous = video; video = null;playbackId=null;unload(previous);observe();
  }
  function failed(code) { stop(); status = 'error'; error = code; emit(); }
  function open(id) {
    const next = byId.get(id); if (destroyed || !next) return false;
    stop(); clip = next; status = 'loading'; error = null;
    try {
      pauseMusic(); // Also cancels a pending private handshake through T09 pause().
      const node = createVideo(); video = node; handlers = new AbortController();
      playbackId=crypto.randomUUID();
      const attempt = generation, live = () => !destroyed && attempt === generation && video === node;
      const listen = (type, fn) => node.addEventListener(type, () => { if (live()) fn(); }, { signal: handlers.signal });
      node.controls = true; node.playsInline = true; node.preload = 'none';
      node.setAttribute('playsinline', ''); node.setAttribute('aria-label', clip.title);
      node.poster = clip.posterUrl; node.src = clip.mediaUrl;
      listen('play', () => { try { pauseMusic(); } catch { failed('PLAY_FAILED'); } });
      listen('playing', () => { status = 'playing'; emit(); });
      listen('waiting', () => { status = 'buffering'; emit(); });
      listen('pause', () => { if (!node.ended) { status = 'paused'; emit(); } });
      listen('ended', () => { status = 'ended'; emit(); });
      listen('timeupdate',observe);listen('seeking',observe);listen('seeked',observe);
      listen('error', () => failed('PLAY_FAILED'));
      mount(node, clip); emit();
      Promise.resolve(node.play()).then(() => { if (!live()) unload(node); }, cause => {
        if (live()) failed(cause?.name === 'NotAllowedError' ? 'PLAY_NOT_ALLOWED' : 'PLAY_FAILED');
      });
    } catch { failed('PLAY_FAILED'); }
    return true;
  }
  return {
    snapshot, open,
    retry() { return clip ? open(clip.id) : false; },
    pause() { video?.pause(); },
    close() { stop(); clip = null; status = 'idle'; error = null; emit(); },
    destroy() { stop(); destroyed = true; clip = null; status = 'idle'; }
  };
}
