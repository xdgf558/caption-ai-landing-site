import { createMusicAnalytics } from './musicAnalytics.js';

export function mountMusicAnalytics(root,player,{fetcher,t,getViewedTrack,getVariant}={}) {
  const panel=root.querySelector('[data-analytics-controls]'); if(!panel) return null;
  const button=panel.querySelector('[data-analytics-accept]'), withdraw=panel.querySelector('[data-analytics-withdraw]');
  const notice=panel.querySelector('[data-analytics-status]'), abort=new AbortController();
  const analytics=createMusicAnalytics(player,{fetcher,onChange(state){
    const messages={checking:'正在核对统计设置…',enabled:'匿名有效播放统计已开启，可随时关闭。',
      declined:'你已关闭此标签页的匿名播放统计。',unavailable:'本站统计暂未开放，收听与收藏照常可用。',
      'storage-unavailable':'浏览器无法保存匿名统计设置，统计保持关闭。','privacy-signal':'已按浏览器隐私偏好关闭统计。'};
    notice.textContent=t(messages[state.status]);
    button.disabled=state.status!=='declined'; button.hidden=state.enabled;
    withdraw.hidden=!state.enabled;
  }});
  button.addEventListener('click',()=>{if(analytics.accept()) withdraw.focus();},{signal:abort.signal});
  withdraw.addEventListener('click',()=>{if(analytics.withdraw()) button.focus();},{signal:abort.signal});
  root.querySelector('[data-membership-link]').addEventListener('click',()=>{
    const track=getViewedTrack(); analytics.cta(track,track ? getVariant(track)||'full' : null);
  },{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') void analytics.refresh();},{signal:abort.signal});
  void analytics.refresh();
  return {destroy(){abort.abort();analytics.destroy();}};
}
