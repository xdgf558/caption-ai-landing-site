import { request } from './musicAdminClient.js';
import { createCollectionJournal, reorderCollection } from './musicCollectionClient.js';
const $=id=>document.getElementById(id), all=s=>[...document.querySelectorAll(s)];
const stateNames={draft:'草稿',published:'已发布',archived:'已归档'}, typeNames={album:'专辑',playlist:'歌单'};
const label=row=>Object.values(row.title||{}).find(Boolean)||row.slug;
const el=(tag,text)=>{const node=document.createElement(tag); if(text!==undefined)node.textContent=text; return node;};
let actor,journal,current=null,order=[],dirty=false,orderDirty=false,busy=false,locked=false,ready=false,dragged=null;
let cursors=[null],page=0,nextBefore=null,memberBefore=null,memberQuery='';
const errors={MUSIC_COLLECTION_CONFLICT:'内容已被其他操作更新。请重新载入后核对，当前编辑已保留。',MUSIC_ALBUM_TRACKS_NOT_PUBLISHED:'专辑所有成员都必须已发布，不能发布不完整专辑。',MUSIC_ALBUM_POLICY_MISMATCH:'成员曲目的当前收听范围不一致。请先在曲目工作区调整并审核发布，或选择沿用单曲设置。',MUSIC_ALBUM_COVER_INVALID:'封面必须来自专辑成员已发布的封面；移除此成员前请先更换或清空指定封面。',MUSIC_COLLECTION_EMPTY:'至少需要一首已发布歌曲。',MUSIC_DATABASE_UNAVAILABLE:'专辑服务尚不可用，请核对数据库迁移或稍后重试。',ADMIN_AUTH_REQUIRED:'后台登录已过期，请重新登录后核对原操作。',ADMIN_FORBIDDEN:'没有音乐管理权限。'};
const status=(text,error=false)=>{$('collection-status').textContent=text; $('collection-status').dataset.error=String(error);};
function formValue() {
  const title={},description={};
  all('[data-collection-title]').forEach(n=>{title[n.dataset.collectionTitle]=n.value.trim();});
  all('[data-collection-description]').forEach(n=>{description[n.dataset.collectionDescription]=n.value.trim();});
  return {slug:$('collection-slug').value.trim(),originalLocale:$('collection-locale').value,title,description,
    type:current.type,listeningMode:current.type==='album'?$('album-listening-mode').value:'mixed',coverTrackId:current.type==='album'?$('album-cover-track').value||null:null};
}
function persist() { if(journal&&current)journal.update({workspace:{current,order,form:formValue(),reason:$('collection-reason').value,orderReason:$('collection-order-reason').value,dirty,orderDirty}}); }
function sync() {
  const blocked=busy||locked||!ready||!!journal?.get().pending, archived=current?.status==='archived';
  for(const id of ['collection-new-album','collection-new-playlist','collection-prev','collection-next']) $(id).disabled=blocked;
  $('collection-prev').disabled ||= page===0; $('collection-next').disabled ||= !nextBefore;
  all('#collection-search-form input,#collection-search-form select,#collection-search-form button,#collection-list button').forEach(n=>n.disabled=blocked);
  all('#collection-list button').forEach(n=>n.setAttribute('aria-current',String(n.dataset.collectionId===current?.id)));
  $('collection-fields').disabled=blocked||archived||orderDirty;
  all('#member-search-form input,#member-search-form button,#member-results button,#member-more,#collection-order button,#collection-order-reason').forEach(n=>n.disabled=blocked||archived||!current?.id||dirty||n.dataset.boundary==='true');
  $('collection-order-save').disabled=blocked||archived||!current?.id||dirty||!orderDirty;
  for(const action of ['publish','unpublish','archive']) $('collection-'+action).disabled=blocked||!current?.id||archived||dirty||orderDirty||
    (action==='unpublish'?current.status!=='published':current.status!=='draft');
  $('collection-reload').disabled=busy;
  $('collection-retry').hidden=!journal?.get().pending; $('collection-retry').disabled=busy||locked;
  if(current){$('collection-version').textContent=dirty||orderDirty?'有未保存修改':current.id?'编辑版本 '+current.editVersion:'尚未保存';
    all('[data-collection-title]').forEach(n=>n.required=n.dataset.collectionTitle===$('collection-locale').value);
    $('collection-reason').required=!!current.id;
  }
}
function canEditOrder(){return ready&&!busy&&!locked&&!journal?.get().pending&&!!current?.id&&current.status!=='archived'&&!dirty;}
function localOrder(edit){if(!canEditOrder())return;try{edit();orderDirty=true;persist();renderOrder();status('曲序已调整，请保存曲序。');}catch(e){locked=true;status(e.message,true);}sync();}
async function run(fn) { if(busy)return; busy=true;sync();try{await fn();}catch(e){if([401,403,409].includes(e.status))locked=true;status(errors[e.code]||e.message,true);}finally{busy=false;sync();} }
async function checkActor(){const r=await request('/status');if(actor&&r.actorId!==actor)throw Object.assign(new Error('管理员账号已变化，请重新打开工作区。'),{status:403});if(!r.capabilities.collections)throw new Error('集合管理尚不可用。');return r;}
function ask(title,text,reason=false){return new Promise(resolve=>{const d=$('collection-confirm');$('collection-confirm-title').textContent=title;$('collection-confirm-text').textContent=text;$('collection-confirm-reason-label').hidden=!reason;$('collection-confirm-reason').required=reason;$('collection-confirm-reason').value='';d.returnValue='';d.addEventListener('close',()=>resolve(d.returnValue==='yes'?{reason:$('collection-confirm-reason').value.trim()}:null),{once:true});d.showModal();});}
$('collection-confirm-reason').onkeydown=e=>{if(e.key==='Enter')e.preventDefault();};
const leave=async()=>!(dirty||orderDirty)||!!await ask('放弃未保存修改？','已保存的版本保持不变。');
function applyForm(form){$('collection-slug').value=form.slug||'';$('collection-locale').value=form.originalLocale||'zh-Hans';all('[data-collection-title]').forEach(n=>n.value=form.title?.[n.dataset.collectionTitle]||'');all('[data-collection-description]').forEach(n=>n.value=form.description?.[n.dataset.collectionDescription]||'');$('album-listening-mode').value=form.listeningMode||'mixed';$('album-cover-track').value=form.coverTrackId||'';}
function renderOrder(focusId,action){
  $('collection-order').replaceChildren();$('collection-order-empty').hidden=order.length>0;
  order.forEach((row,index)=>{const li=el('li');li.className='collection-member';li.draggable=true;const info=el('div'),actions=el('div');actions.className='music-actions';
    info.append(el('strong',`${index+1}. ${label(row)}`),el('small',`${stateNames[row.lifecycle]||row.lifecycle} · ${row.effectiveAccess==='free'?'免费':row.effectiveAccess==='vip'?'VIP':row.lifecycle==='published'?'保存后核对收听范围':'未发布'}`));
    for(const [name,delta] of [['上移',-1],['下移',1],['移除',0]]){const b=el('button',name);b.type='button';b.setAttribute('aria-label',`${name} ${label(row)}`);b.dataset.memberId=row.id;b.dataset.move=name;b.dataset.boundary=String(delta===-1&&index===0||delta===1&&index===order.length-1);
      b.onclick=()=>{localOrder(()=>{order=delta?reorderCollection(order,index,index+delta):order.filter(t=>t.id!==row.id);});const buttons=all('#collection-order button').filter(n=>n.dataset.memberId===row.id&&!n.disabled);(buttons.find(n=>n.dataset.move===name)||buttons[0]||$('collection-order-save')).focus();};actions.append(b);}
    li.ondragstart=e=>{if(!canEditOrder()){e.preventDefault();return;}dragged=row.id;e.dataTransfer.effectAllowed='move';};li.ondragover=e=>{if(dragged)e.preventDefault();};
    li.ondrop=e=>{e.preventDefault();if(!dragged)return;localOrder(()=>{order=reorderCollection(order,order.findIndex(t=>t.id===dragged),index);});dragged=null;};li.ondragend=()=>dragged=null;
    li.append(info,actions);$('collection-order').append(li);
  });
  if(focusId)all('#collection-order button').find(n=>n.dataset.memberId===focusId&&n.dataset.move===action)?.focus();
}
function fill(row){current=row;order=(row.tracks||[]).map(t=>({...t}));dirty=false;orderDirty=false;$('collection-workspace').hidden=false;$('collection-empty').hidden=true;
  $('collection-heading').textContent=row.id?label(row):'新建'+typeNames[row.type];$('collection-state').textContent=typeNames[row.type]+' · '+stateNames[row.status];$('collection-slug').readOnly=!!row.id;$('album-fields').hidden=row.type!=='album';
  $('album-cover-track').replaceChildren(new Option('自动使用首个有封面的成员曲目',''),...order.map(t=>new Option(label(t)+(t.hasPublishedCover?'':'（暂无已发布封面）'),t.id)));
  applyForm(row);$('collection-reason').value='';$('collection-order-reason').value='';$('member-results').replaceChildren();$('member-more').hidden=true;memberBefore=null;
  $('collection-publish-help').textContent=row.type==='album'?'专辑必须全员已发布且范围一致。成员下架或权限变化后不再符合条件时，公开入口会隐藏整张专辑。':'歌单只展示其中仍公开的曲目；至少一首公开曲目才可发布。';
  if(row.status==='published')$('collection-publish-help').textContent+=' 当前已发布，保存资料或曲序会更新公开内容。';
  renderOrder();sync();
}
async function loadList(){const p=new URLSearchParams({q:$('collection-search').value.trim(),status:$('collection-status-filter').value,type:$('collection-type-filter').value});if(cursors[page])p.set('before',cursors[page]);const r=await request('/collections?'+p);nextBefore=r.nextBefore;$('collection-list').replaceChildren();
  for(const row of r.items){const b=el('button');b.className='track-row';b.type='button';b.dataset.collectionId=row.id;b.append(el('strong',label(row)),el('small',`${typeNames[row.type]} · ${stateNames[row.status]} · ${row.trackCount} 首`));b.onclick=()=>run(async()=>{if(await leave()){await load(row.id);status('已载入。');}});$('collection-list').append(b);}if(!r.items.length)$('collection-list').append(el('p','暂无符合条件的内容。'));$('collection-page').textContent=`第 ${page+1} 页`;
}
async function load(id){fill(await request('/collections/'+id));persist();}
async function replay(){const op=journal.get().pending;if(!op)return;await checkActor();let result;try{result=await request(op.path,op);}catch(e){if(!e.uncertain)journal.update({pending:null});throw e;}
  await load(result.collectionId);await loadList();journal.update({pending:null});status('操作已确认并保存。');
}
async function mutate(path,method,body){if(journal.get().pending)throw new Error('请先核对原操作。');persist();journal.update({pending:{path,method,body,key:crypto.randomUUID(),...(current.id?{etag:`"edit-${current.editVersion}"`}:{})}});await replay();}
$('collection-form').onsubmit=e=>{e.preventDefault();if(!$('collection-form').reportValidity())return;run(async()=>{if(current.status==='published'&&!await ask('更新已发布资料？','保存后立即更新公开专辑或歌单；单曲权限不变。'))return;const body=formValue();if(current.id)Object.assign(body,{status:current.status,reason:$('collection-reason').value.trim()});await mutate(current.id?'/collections/'+current.id:'/collections',current.id?'PATCH':'POST',body);});};
all('#collection-form input,#collection-form textarea,#collection-form select').forEach(n=>n.addEventListener('input',()=>{dirty=true;try{persist();}catch(e){locked=true;status(e.message,true);}sync();}));
$('collection-order-save').onclick=()=>run(async()=>{const reason=$('collection-order-reason').value.trim();if(!reason)throw new Error('请填写曲序修改说明。');if(current.status==='published'&&!await ask('更新已发布曲序？','保存后立即更新公开曲序。'))return;await mutate('/collections/'+current.id+'/tracks','PUT',{trackIds:order.map(t=>t.id),reason});});
for(const [action,target] of [['publish','published'],['unpublish','draft'],['archive','archived']])$('collection-'+action).onclick=()=>run(async()=>{const confirmed=await ask({publish:'发布？',unpublish:'下架为草稿？',archive:'归档？'}[action],`${label(current)}。${action==='archive'?'归档后不提供恢复。':'此次操作不改变任何单曲的播放权限。'}`,true);if(confirmed)await mutate('/collections/'+current.id,'PATCH',{slug:current.slug,originalLocale:current.originalLocale,title:current.title,description:current.description,type:current.type,listeningMode:current.listeningMode,coverTrackId:current.coverTrackId,status:target,reason:confirmed.reason});});
for(const type of ['album','playlist'])$('collection-new-'+type).onclick=()=>run(async()=>{if(await leave()){fill({type,slug:'',originalLocale:'zh-Hans',title:{},description:{},status:'draft',listeningMode:'mixed',coverTrackId:null,tracks:[]});persist();status('先保存资料，再添加歌曲。');}});
async function searchMembers(more=false){if(!more){memberQuery=$('member-search').value.trim();memberBefore=null;$('member-results').replaceChildren();}const p=new URLSearchParams({q:memberQuery});if(memberBefore)p.set('before',memberBefore);const r=await request('/tracks?'+p);memberBefore=r.nextBefore;
  $('member-results').replaceChildren();
  for(const row of r.items){if(row.lifecycle==='archived')continue;const b=el('button','添加 '+label(row));b.type='button';b.onclick=()=>{if(!canEditOrder())return;if(order.some(t=>t.id===row.id)){status('曲目已在列表中。');return;}if(order.length>=500){status('最多添加 500 首。',true);return;}localOrder(()=>order.push({...row}));};$('member-results').append(b);}if(!$('member-results').children.length)$('member-results').append(el('p','没有找到可添加的歌曲。'));$('member-more').hidden=!memberBefore;
}
$('member-search-form').onsubmit=e=>{e.preventDefault();run(()=>searchMembers());};$('member-more').onclick=()=>run(()=>searchMembers(true));
$('collection-search-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(await leave()){page=0;cursors=[null];await loadList();}});};
$('collection-prev').onclick=()=>run(async()=>{if(await leave()){page--;await loadList();}});$('collection-next').onclick=()=>run(async()=>{if(await leave()){cursors[++page]=nextBefore;await loadList();}});
$('collection-retry').onclick=()=>run(async()=>{if(await ask('重试原操作？','沿用原内容、版本和幂等键核对，不创建新的操作。'))await replay();});
$('collection-reload').onclick=()=>run(async()=>{if(!journal){await boot();return;}await checkActor();locked=false;if(journal?.get().pending){status('身份已核对，请明确重试原操作。');return;}if(!await leave())return;await loadList();ready=true;if(current?.id)await load(current.id);status('已重新载入。');});
window.addEventListener('beforeunload',e=>{if(busy||dirty||orderDirty||journal?.get().pending){e.preventDefault();e.returnValue='';}});
async function boot(){const service=await checkActor();actor=service.actorId;journal=createCollectionJournal(sessionStorage,actor);await loadList();ready=true;const saved=journal.get().workspace;if(saved){fill(saved.current);order=saved.order;applyForm(saved.form);$('collection-reason').value=saved.reason||'';$('collection-order-reason').value=saved.orderReason||'';dirty=saved.dirty;orderDirty=saved.orderDirty;renderOrder();}status(journal.get().pending?'有一笔结果待确认的操作，请核对原操作。':'专辑与歌单已载入。');}
run(boot);
