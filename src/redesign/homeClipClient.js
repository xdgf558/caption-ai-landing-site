import { mountStationClips } from './clipClient.js';
import { stationHomeClipModel } from './clipView.js';
import { peekStationMusicSession } from './musicPlayerView.js';

export function mountStationHomeClips() {
  const root = document.querySelector('[data-sc-home-clips]'), data = document.getElementById('sc-home-clips-bootstrap');
  if (!root || root.dataset.clipsMounted || !data || data.textContent.length > 512 * 1024) return () => {};
  let value; try { value = JSON.parse(data.textContent); } catch { return () => {}; }
  const model = stationHomeClipModel(value.home, value.clips);
  if (!model.clips.length) return () => {};
  root.dataset.clipsMounted = 'true';
  const music = peekStationMusicSession() || { pause() {}, subscribe(fn) { fn({ status: 'idle' }); return () => {}; } };
  const dispose = mountStationClips(root, model, music);
  return () => { dispose(); delete root.dataset.clipsMounted; };
}
