import { Application, Assets, Container, Graphics, Sprite } from 'pixi.js';
import { OrangeCatRig } from './rig.js';
import { sampleMotion, duration, clamp, BOWL } from './motion.js';
import './styles.css';

const $=selector=>document.querySelector(selector);
const stage=$('#main-stage'),loading=$('#loading'),play=$('#pause'),replay=$('#replay'),timeline=$('#timeline');
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const state={action:'idle',time:0,speed:1,playing:!reduceMotion.matches,bones:false,ready:false};
const descriptions={idle:'四只脚踩稳，胸腹轻轻呼吸，尾巴独立摆动。',walk:'看落地的脚：身体继续向前，脚掌不沿地面滑行。',eat:'张嘴取食，猫粮入口，再闭嘴咀嚼；脚掌和食碗保持原位。'};
const captions={idle:'01 / 待机',walk:'02 / 走一小段',eat:'03 / 去吃饭'};
let app,rig,world,bowl,shadow,resizeObserver,lastUI=0;

function syncControls() {
  document.querySelectorAll('[data-action]').forEach(button=>{const current=button.dataset.action===state.action;button.classList.toggle('is-active',current);button.setAttribute('aria-pressed',String(current));});
  $('#action-caption').textContent=captions[state.action];$('#motion-description').textContent=descriptions[state.action];
  play.textContent=state.playing?'暂停':state.time>=duration[state.action]?'重新播放':'播放';
  $('#speed-output').textContent=state.speed+'×';
  timeline.value=String(Math.round(state.time/duration[state.action]*1000));
  $('#time-output').textContent=state.time.toFixed(1)+' / '+duration[state.action].toFixed(1)+' s';
  $('#frame-readout').textContent=state.time.toFixed(2).padStart(5,'0')+' s';
}
function draw(render=true) {
  if(!state.ready)return;
  const pose=sampleMotion(state.action,state.time);
  rig.draw(pose,state.bones);bowl.visible=pose.bowl;
  shadow.position.x=pose.rootX;shadow.scale.x=1+pose.breath*.003;
  if(render)app.render();
}
function syncPlayback() { if(!app||!state.ready)return; if(state.playing&&!document.hidden)app.ticker.start();else app.ticker.stop(); syncControls();draw(); }
function setAction(action) {
  if(!(action in duration))return;
  state.action=action;state.time=0;state.playing=!reduceMotion.matches;
  syncPlayback();
}
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>setAction(button.dataset.action)));
play.addEventListener('click',()=>{if(state.time>=duration[state.action])state.time=0;state.playing=!state.playing;syncPlayback();});
replay.addEventListener('click',()=>{state.time=0;state.playing=true;syncPlayback();});
timeline.addEventListener('input',()=>{state.playing=false;state.time=Number(timeline.value)/1000*duration[state.action];syncPlayback();});
$('#speed').addEventListener('change',event=>{state.speed=Number(event.target.value);syncControls();});
$('#bones').addEventListener('change',event=>{state.bones=event.target.checked;draw();});
stage.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();play.click();}});
reduceMotion.addEventListener('change',()=>{if(reduceMotion.matches){state.playing=false;syncPlayback();}});
document.addEventListener('visibilitychange',syncPlayback);

function resize() {
  if(!app||!world)return;
  const {width,height}=stage.getBoundingClientRect();if(!width||!height)return;
  app.renderer.resize(width,height);
  const scale=Math.min(width/960,height/550);world.scale.set(scale);world.position.set((width-960*scale)/2,(height-550*scale)/2);
  draw();
}

async function initialize() {
  app=new Application();
  await app.init({width:960,height:600,resolution:Math.min(devicePixelRatio||1,2),autoDensity:true,backgroundColor:0xfaf6ed,antialias:true,preference:'webgl',autoStart:false});
  stage.appendChild(app.canvas);app.canvas.setAttribute('aria-hidden','true');
  const names=['torso','head','front-leg','back-leg','tail','bowl','mouth-open','kibble'];
  const textures=Object.fromEntries(await Promise.all(names.map(async name=>[name,await Assets.load('./assets/'+name+(name==='bowl'?'.png':'.webp'))])));
  const response=await fetch('./assets/rig-meta.json');if(!response.ok)throw new Error('rig-metadata');const meta=await response.json();
  const feedingResponse=await fetch('./assets/feeding-meta.json');if(!feedingResponse.ok)throw new Error('feeding-metadata');const feedingMeta=await feedingResponse.json();
  world=new Container();app.stage.addChild(world);
  // Stage floor is deliberately neutral; graphics are ground/contact guides,
  // not a replacement for the raster character artwork.
  const floor=new Graphics().rect(0,431,960,119).fill({color:0xf1e6d3}).moveTo(0,431).lineTo(960,431).stroke({color:0xdac6a6,width:1});
  world.addChild(floor);
  shadow=new Graphics().ellipse(0,430,164,11).fill({color:0x92724c,alpha:.12});world.addChild(shadow);
  bowl=new Sprite(textures.bowl);bowl.anchor.set(.5,1);bowl.position.set(BOWL.x,BOWL.baseY);bowl.width=BOWL.width;bowl.height=BOWL.height;world.addChild(bowl);
  rig=new OrangeCatRig(textures,meta,feedingMeta);world.addChild(rig.root);
  state.ready=true;loading.hidden=true;play.disabled=false;replay.disabled=false;timeline.disabled=false;
  $('#engine-status').textContent='WebGL · 分层骨骼';
  resizeObserver=new ResizeObserver(resize);resizeObserver.observe(stage);resize();syncControls();
  app.ticker.maxFPS=60;
  app.ticker.add(ticker=>{
    if(state.playing&&!document.hidden){state.time=Math.min(duration[state.action],state.time+Math.min(ticker.deltaMS/1000,.05)*state.speed);if(state.time>=duration[state.action]){if(state.action==='idle')state.time=0;else {state.playing=false;syncPlayback();}}draw(false);}
    lastUI+=ticker.deltaMS;if(lastUI>90){syncControls();lastUI=0;}
  });syncPlayback();
  // Explicit read-only diagnostics and deterministic seek for preview QA only.
  window.catPreview={getSnapshot:()=>({...state,pose:sampleMotion(state.action,state.time),renderer:'WebGL',vertices:rig.body.vertices.length/2,tickerRunning:app.ticker.started}),seek:(action,time)=>{state.action=action in duration?action:'idle';state.time=clamp(time,0,duration[state.action]);state.playing=false;syncPlayback();}};
}
initialize().catch(error=>{console.error('Preview initialization failed',error);loading.hidden=false;loading.textContent='动画未能加载。请确认浏览器支持 WebGL，并刷新重试。';$('#engine-status').textContent='未能加载';});
window.addEventListener('pagehide',()=>{resizeObserver?.disconnect();app?.ticker.stop();});
window.addEventListener('pageshow',event=>{if(event.persisted&&state.ready){resizeObserver?.observe(stage);resize();syncPlayback();}});
