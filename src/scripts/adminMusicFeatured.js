import { request } from './musicAdminClient.js';
import { createFeaturedJournal, reorderFeatured } from './musicFeaturedClient.js';

const $ = id => document.getElementById(id), el = (tag,text) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; return node; };
let actor,journal,editVersion=1,primary=null,secondary=[],collections=[],dirty=false,busy=false,locked=false,ready=false,dragged=null;
const errors={MUSIC_FEATURED_CONFLICT:'推荐已被其他操作更新。当前编排已保留，请载入新版本后核对。',MUSIC_FEATURED_PRIMARY_NOT_FREE:'首页主推必须是当前可免费完整收听的已发布歌曲。',MUSIC_FEATURED_TRACK_UNAVAILABLE:'有推荐歌曲已下架或版本失效，请移除后再保存。',MUSIC_FEATURED_COLLECTION_UNAVAILABLE:'有推荐歌单或专辑已下架，请移除后再保存。',MUSIC_DATABASE_UNAVAILABLE:'推荐服务暂不可用，请核对数据库迁移。',ADMIN_AUTH_REQUIRED:'后台登录已过期，请重新登录。',ADMIN_FORBIDDEN:'没有音乐管理权限。'};
const status=(message,error=false)=>{$('featured-status').textContent=message;$('featured-status').dataset.error=String(error);};
const label=value=>value?.label||value?.id||'未知内容';
const workspace=()=>({editVersion,primary,secondary,collections,reason:$('featured-reason').value,dirty});
function persist(){if(journal)journal.update({workspace:workspace()});}
function sync(){
  const blocked=busy||locked||!ready||!!journal?.get().pending;
  $('featured-version').textContent=`编辑版本 ${editVersion}${dirty?' · 未保存':''}`;
  $('featured-save').disabled=blocked||!dirty||!$('featured-reason').value.trim();
  $('featured-reload').disabled=busy;$('featured-merge').hidden=!locked;$('featured-merge').disabled=busy;
  $('featured-retry').hidden=!journal?.get().pending;$('featured-retry').disabled=busy||locked;
  for(const node of document.querySelectorAll('form input,form button,.featured-order button,#featured-primary button'))node.disabled=blocked||node.dataset.boundary==='true';
}
function changed(message){dirty=true;try{persist();render();status(message);}catch(error){locked=true;status(error.message,true);}sync();}
async function run(action){if(busy)return;busy=true;sync();try{await action();}catch(error){if([401,403].includes(error.status))locked=true;if(error.status===409)locked=true;status(errors[error.code]||error.message,true);}finally{busy=false;render();sync();}}
async function checkActor(){const current=await request('/status');if(actor&&current.actorId!==actor)throw Object.assign(new Error('管理员账号已变化，请重新打开工作区。'),{status:403});if(!current.capabilities.featured)throw new Error('推荐管理尚不可用。');return current;}
const item=(row,kind='track')=>({id:row.id,label:Object.values(row.title||{}).find(Boolean)||row.slug||row.id,
  status:kind==='track'?row.lifecycle:row.status,...(kind==='track'?{effectiveAccess:row.effectiveAccess}:{type:row.type})});
function apply(response){
  const tracks=new Map(response.tracks.map(row=>[row.id,item(row)])),groups=new Map(response.collections.map(row=>[row.id,item(row,'collection')]));
  editVersion=response.editVersion;primary=response.primaryTrackId?tracks.get(response.primaryTrackId)||{id:response.primaryTrackId,label:response.primaryTrackId,status:'unavailable',effectiveAccess:null}:null;
  secondary=response.secondaryTrackIds.map(id=>tracks.get(id)||{id,label:id,status:'unavailable',effectiveAccess:null});
  collections=response.collectionIds.map(id=>groups.get(id)||{id,label:id,status:'unavailable',type:null});
  dirty=false;$('featured-reason').value='';render();
}
function renderPrimary(){
  const home=$('featured-primary');home.replaceChildren();
  if(!primary){home.append(el('p','尚未设置主推。公开页会从有效的免费推荐或最新免费曲中回退。'));return;}
  const row=el('div');row.className='featured-current';const copy=el('div');copy.append(el('strong',label(primary)),el('small',primary.status==='published'&&primary.effectiveAccess==='free'?'已发布 · 免费完整收听':'当前已失效，公开页不会展示'));
  const remove=el('button','移除主推');remove.type='button';remove.onclick=()=>{primary=null;changed('主推已移除，请保存编排。');};row.append(copy,remove);home.append(row);
}
function renderOrder(target,values,kind){
  const list=$(target),empty=$(target+'-empty');list.replaceChildren();empty.hidden=values.length>0;
  values.forEach((value,index)=>{const row=el('li');row.draggable=true;row.dataset.id=value.id;const copy=el('div');
    const detail=kind==='secondary'?(value.status==='published'?(value.effectiveAccess==='free'?'免费':'VIP'):'已失效'):(value.status==='published'?(value.type==='album'?'专辑':'歌单'):'已失效');
    copy.append(el('strong',`${index+1}. ${label(value)}`),el('small',detail));const actions=el('div');actions.className='music-actions';
    for(const [name,delta] of [['上移',-1],['下移',1],['移除',0]]){const button=el('button',name);button.type='button';button.dataset.boundary=String(delta===-1&&index===0||delta===1&&index===values.length-1);
      button.disabled=button.dataset.boundary==='true';button.setAttribute('aria-label',`${name} ${label(value)}`);button.onclick=()=>{const current=kind==='secondary'?secondary:collections;
        const next=delta?reorderFeatured(current,index,index+delta):current.filter(entry=>entry.id!==value.id);if(kind==='secondary')secondary=next;else collections=next;changed(`${kind==='secondary'?'歌曲':'集合'}顺序已调整，请保存。`);};actions.append(button);}
    row.ondragstart=event=>{if(busy||locked||journal?.get().pending){event.preventDefault();return;}dragged={kind,id:value.id};event.dataTransfer.effectAllowed='move';};
    row.ondragover=event=>{if(dragged?.kind===kind)event.preventDefault();};row.ondrop=event=>{event.preventDefault();if(dragged?.kind!==kind)return;const current=kind==='secondary'?secondary:collections;
      const next=reorderFeatured(current,current.findIndex(entry=>entry.id===dragged.id),index);if(kind==='secondary')secondary=next;else collections=next;dragged=null;changed('顺序已调整，请保存。');};row.ondragend=()=>{dragged=null;};
    row.append(copy,actions);list.append(row);});
}
function render(){renderPrimary();renderOrder('featured-secondary',secondary,'secondary');renderOrder('featured-collections',collections,'collection');}
async function searchTracks(kind){
  const query=$(kind==='primary'?'featured-primary-query':'featured-secondary-query').value.trim();
  const response=await request('/tracks?status=published&q='+encodeURIComponent(query)),target=$(kind==='primary'?'featured-primary-results':'featured-secondary-results');target.replaceChildren();
  const rows=response.items.filter(row=>kind!=='primary'||row.effectiveAccess==='free');
  for(const row of rows){const value=item(row),button=el('button',`${kind==='primary'?'设为主推':'添加'} · ${label(value)} · ${value.effectiveAccess==='free'?'免费':'VIP'}`);button.type='button';button.onclick=()=>{
      if(kind==='primary'){primary=value;secondary=secondary.filter(entry=>entry.id!==value.id);}
      else if(primary?.id===value.id){status('这首歌已是主推，无需重复添加。',true);return;}
      else if(secondary.some(entry=>entry.id===value.id)){status('这首歌已在次级推荐中。',true);return;}
      else if(secondary.length>=6){status('次级推荐最多 6 首。',true);return;}
      else secondary=[...secondary,value];
      changed(kind==='primary'?'已选择主推，请保存编排。':'已加入次级推荐，请保存编排。');};target.append(button);}
  if(!rows.length)target.append(el('p',kind==='primary'?'没有找到可作为主推的免费已发布歌曲。':'没有找到已发布歌曲。'));
}
async function searchCollections(){const query=$('featured-collections-query').value.trim(),response=await request('/collections?status=published&q='+encodeURIComponent(query)+'&type=');const target=$('featured-collections-results');target.replaceChildren();
  for(const row of response.items){const value=item(row,'collection'),button=el('button',`添加 · ${label(value)} · ${value.type==='album'?'专辑':'歌单'}`);button.type='button';button.onclick=()=>{
    if(collections.some(entry=>entry.id===value.id))status('这个集合已在推荐中。',true);else if(collections.length>=6)status('首页集合最多 6 个。',true);else{collections=[...collections,value];changed('已加入首页集合，请保存编排。');}};target.append(button);}if(!response.items.length)target.append(el('p','没有找到已发布歌单或专辑。'));}
async function replay(){const op=journal.get().pending;if(!op)return;await checkActor();let result;try{result=await request(op.path,op);}catch(error){if(!error.uncertain)journal.update({pending:null});throw error;}const fresh=await request('/featured');apply(fresh);journal.update({pending:null,workspace:workspace()});status(result.replayed?'已核对原操作，编排已保存。':'首页推荐已保存。');}
async function save(){if(journal.get().pending)throw new Error('请先核对上一笔操作。');persist();const body={primaryTrackId:primary?.id||null,secondaryTrackIds:secondary.map(value=>value.id),collectionIds:collections.map(value=>value.id),reason:$('featured-reason').value.trim()};
  journal.update({pending:{path:'/featured',method:'PUT',body,key:crypto.randomUUID(),etag:`"edit-${editVersion}"`}});await replay();}
for(const kind of ['primary','secondary'])$(kind==='primary'?'featured-primary-search':'featured-secondary-search').onsubmit=event=>{event.preventDefault();run(()=>searchTracks(kind));};
$('featured-collections-search').onsubmit=event=>{event.preventDefault();run(searchCollections);};
$('featured-reason').oninput=()=>{try{persist();}catch(error){locked=true;status(error.message,true);}sync();};
$('featured-save').onclick=()=>run(save);
$('featured-retry').onclick=()=>run(replay);
$('featured-merge').onclick=()=>run(async()=>{await checkActor();const fresh=await request('/featured');editVersion=fresh.editVersion;locked=false;dirty=true;persist();status('已载入服务器的新版本号，当前编排仍保留。请核对后重新保存。');});
$('featured-reload').onclick=()=>run(async()=>{if(dirty&&!window.confirm('放弃当前未保存的首页编排？'))return;await checkActor();locked=false;apply(await request('/featured'));persist();status('已重新载入首页推荐。');});
window.addEventListener('beforeunload',event=>{if(busy||dirty||journal?.get().pending){event.preventDefault();event.returnValue='';}});
async function boot(){const service=await checkActor();actor=service.actorId;journal=createFeaturedJournal(sessionStorage,actor);const fresh=await request('/featured');const saved=journal.get().workspace;
  if(saved?.dirty){editVersion=saved.editVersion;primary=saved.primary;secondary=saved.secondary;collections=saved.collections;dirty=true;$('featured-reason').value=saved.reason;render();}
  else apply(fresh);ready=true;persist();status(journal.get().pending?'有一笔结果待确认的操作，请核对原操作。':dirty?'已恢复未保存的首页编排。':'首页推荐已载入。');}
run(boot);
