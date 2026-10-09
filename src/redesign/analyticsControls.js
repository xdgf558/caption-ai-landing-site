import { createStationEvents } from './analyticsClient.js';
import { uuid } from './publicValidation.js';

// Browser lifecycle only; the Worker never imports this mutable UI singleton.
let mounted=null;
export function observeStationEvent(name,details,immediate=false){return mounted?.collector.enqueue(name,details,immediate)??false;}
export function stationRuntimeGameId(){return mounted?.collector.snapshot().config?.runtimeGameId??null;}
export const stationEventsAllowed=()=>mounted?.collector.snapshot().enabled===true;
export function mountStationAnalytics(){
  const panel=document.querySelector('[data-sc-event-controls]');
  if(!panel || panel.dataset.mounted)return ()=>{};
  const music=document.getElementById('sc-music-bootstrap'),generic=document.getElementById('sc-event-bootstrap');let model;
  try{const node=music||generic;if(!node||node.textContent.length>512*1024)return ()=>{};model=JSON.parse(node.textContent);}catch{return ()=>{};}
  if(!(music?model.analytics?.enabled:model.enabled)){panel.hidden=true;return ()=>{};}
  panel.hidden=false;panel.dataset.mounted='true';
  const handlers=new AbortController(),accept=panel.querySelector('[data-sc-event-accept]'),withdraw=panel.querySelector('[data-sc-event-withdraw]'),notice=panel.querySelector('[data-sc-event-status]');
  const messages=JSON.parse(panel.querySelector('[data-sc-event-copy]').textContent);
  let disposed=false,viewConfirmed=false;
  function trackView(){
    if(disposed || viewConfirmed || document.visibilityState!=='visible'||model.mode!=='detail'||model.error||!uuid(model.track?.id))return;
    viewConfirmed=true;if(!observeStationEvent('track_view',{trackId:model.track.id}))viewConfirmed=false;
  }
  const collector=createStationEvents({attribution:model.attribution?.enabled?model.attribution:{kind:'direct_or_unknown'},
    deviceClass:()=> navigator.userAgentData?.mobile===true || matchMedia('(pointer: coarse)').matches?'mobile':'desktop',
    onChange(state){
      if(disposed)return;
      notice.textContent=(messages[state.status]||messages.unavailable)+(state.enabled&&state.scope==='memory'?' '+messages.memory:'');
      accept.disabled=!['choice','declined'].includes(state.status);accept.hidden=state.enabled;withdraw.hidden=!state.enabled&&state.status!=='choice';withdraw.textContent=state.enabled?messages.withdraw:messages.decline;
      if(!state.enabled)viewConfirmed=false;else queueMicrotask(trackView);
    }});
  mounted?.dispose();
  const dispose=()=>{if(disposed)return;disposed=true;handlers.abort();collector.destroy();delete panel.dataset.mounted;if(mounted?.collector===collector)mounted=null;};
  mounted={collector,dispose};
  accept.addEventListener('click',()=>{if(collector.accept())withdraw.focus();},{signal:handlers.signal});
  withdraw.addEventListener('click',()=>{collector.withdraw();accept.focus();},{signal:handlers.signal});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){viewConfirmed=false;void collector.refresh();trackView();}else void collector.flush();},{signal:handlers.signal});
  document.addEventListener('station:attribution-context',event=>{if(event.detail?.enabled)collector.enter(event.detail.context);},{signal:handlers.signal});
  window.addEventListener('pagehide',()=>{void collector.flush();},{signal:handlers.signal});
  window.addEventListener('storage',event=>{if(event.key==='stationcat.music.analytics.disabled.v1'&&event.newValue==='1')collector.withdraw();},{signal:handlers.signal});
  void collector.refresh();return dispose;
}
