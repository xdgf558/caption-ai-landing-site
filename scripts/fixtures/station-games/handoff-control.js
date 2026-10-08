import { getStationMusicSession } from '../../../src/redesign/musicPlayerView.js';
import { mountStationClips } from '../../../src/redesign/clipClient.js';
import '../../../src/redesign/clips.css';
// Disposable loopback-only controls. Product behavior is exercised through the
// actual T09/T11 controllers and the ordinary T13 entry, never mock UI states.
let dispose = () => {};
async function mount() {
  if (!document.querySelector('[data-sc-game-entry]') || document.querySelector('[data-t13-fixture]')) return;
  const panel = document.createElement('aside'); panel.dataset.t13Fixture = '';
  panel.style.cssText = 'padding:16px;margin:16px auto;max-width:1180px;border:1px dashed #7990b1;border-radius:12px;background:#f4f7ff;color:#243e60;font:13px/1.8 system-ui';
  const note = document.createElement('p'); note.textContent = 'T13 本地隔离验收：合成音视频，87 金币测试存档。开关只在临时 Worker 内打开；故障场景不连接生产。'; panel.append(note);
  for (const [scenario, title] of [['valid', '正常启动'], ['boot-failure', '模拟引擎脚本失败'], ['never-ready', '模拟缺少就绪（20 秒）'], ['delayed-session', '模拟启动慢与快速返回'], ['corrupt', '损坏存档恢复']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.dataset.handoffCase = scenario;
    button.style.cssText = 'padding:8px 12px;margin:4px;min-height:44px;border:1px solid #bdcbe0;border-radius:8px;background:white;color:#234e70';
    button.addEventListener('click', async () => {
      if (window.localStorage.getItem('scT12OwnedOriginV1') !== 'agent-preview-only') return;
      const response = await fetch('/__fixture/select?scenario=' + scenario, { cache: 'no-store' });
      if (response.ok) location.reload();
    }); panel.append(button);
  }
  const proof = document.createElement('p'); proof.dataset.handoffProof = ''; panel.append(proof); document.body.append(panel);
  const interval = setInterval(() => {
    const runtime = document.querySelector('[data-sc-game-dialog]'), audio = document.querySelector('[data-sc-music-audio]');
    proof.textContent = '启动状态：' + (runtime?.dataset.gameState || 'idle') + '；实际就绪耗时：' + (runtime?.dataset.readyAfterMs || '暂无') +
      'ms；游戏实例：' + document.querySelectorAll('[data-sc-game-host] iframe').length + '；音乐暂停：' + audio?.paused;
  }, 200);
  let clipsDispose = () => {}, ownedDialog = null;
  dispose = () => { clearInterval(interval); clipsDispose(); ownedDialog?.remove(); panel.remove(); };
  try {
    const locale = document.documentElement.lang, response = await fetch('/api/station/content/tracks/vip?locale=' + locale);
    const { track } = await response.json();
    const play = document.createElement('button'); play.type = 'button'; play.textContent = '播放合成试听'; play.dataset.handoffMusic = '';
    play.style.cssText = 'padding:8px 12px;margin:4px;min-height:44px';
    play.addEventListener('click', () => getStationMusicSession(locale)?.play(track, 'preview')); panel.append(play);
    const clipResponse = await fetch('/api/station/content/tracks/vip/clips?locale=' + locale);
    const { items } = await clipResponse.json();
    const musicPage = await fetch('/' + (locale === 'zh-Hant' ? '' : locale === 'zh-Hans' ? 'zh-hans/' : locale + '/') + 'music/tracks/vip/');
    const parsed = new DOMParser().parseFromString(await musicPage.text(), 'text/html');
    let dialog = document.querySelector('[data-sc-clip-dialog]');
    if (!dialog) { ownedDialog = parsed.querySelector('[data-sc-clip-dialog]'); if (!ownedDialog) return; document.body.append(ownedDialog); dialog = ownedDialog; }
    const video = document.createElement('button'); video.type = 'button'; video.textContent = '播放合成短视频'; video.dataset.scClip = items[0].id;
    video.style.cssText = play.style.cssText; panel.append(video);
    clipsDispose = mountStationClips(panel, { mode: 'detail', locale, track, clips: items }, getStationMusicSession(locale));
    const enter = document.createElement('button'); enter.type = 'button'; enter.textContent = '进入游戏（验证媒体互斥）'; enter.dataset.handoffFromVideo = '';
    enter.style.cssText = play.style.cssText; enter.addEventListener('click', () => document.querySelector('[data-sc-game-launch]')?.click());
    dialog.querySelector('.sc-video-actions').append(enter);
  } catch { note.textContent += ' 测试媒体不可用。'; }
}
document.addEventListener('astro:before-swap', () => dispose());
document.addEventListener('astro:page-load', mount);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
