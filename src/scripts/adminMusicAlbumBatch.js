import { request, uuid, bytes } from './musicAdminClient.js';
import { createBatchJournal, createBatchPlan, createAlbumBatch } from './musicAlbumBatch.js';
import { createWavConverter } from './musicWavClient.js';
const $=id=>document.getElementById(id), el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const names={waiting:'待处理',prepared:'文件已校验',created:'草稿已创建',reserved:'已预留',writing:'上传待核对',verified:'音频已验证',ready:'草稿已完成',retired:'会话已停用',cancelled:'已取消'};
const errors={MUSIC_STORAGE_QUOTA:'剩余配额不足，请处理配额后继续原批次。',UPLOAD_INCOMPLETE:'上传尚未确认。请稍后核对原会话，不会重复发送文件。',UPLOAD_NOT_READY:'上传尚未确认。请稍后核对原会话，不会重复发送文件。',UPLOAD_EXPIRED:'上传会话已过期，额度由维护流程处理。',UPLOAD_REJECTED:'文件被服务端拒绝，请核对文件与会话。',MUSIC_EDIT_CONFLICT:'曲目已被其他操作更新，请在曲目工作区核对。',MUSIC_COLLECTION_CONFLICT:'专辑已有更新，请核对服务器曲序后再继续。'};
let actor,album,batch,busy=false;
const converter=createWavConverter();
const showService=s=>{$('batch-quota').textContent=s.storage?`已占用 ${bytes(s.storage.chargedBytes)} / ${bytes(s.storage.quotaBytes)}`:'配额以每次服务端预留为准';};
function status(text,error=false){$('batch-status').textContent=text;$('batch-status').dataset.error=String(error);}
function ask(title,text){return new Promise(resolve=>{const d=$('batch-confirm');$('batch-confirm-title').textContent=title;$('batch-confirm-text').textContent=text;d.returnValue='';d.addEventListener('close',()=>resolve(d.returnValue==='yes'),{once:true});d.showModal();});}
async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){status(errors[e.code]||e.message,true);}finally{busy=false;render();}}
const rowNodes=new Map();
function makeRow(r){const li=el('li');li.className='batch-row';li.dataset.rowId=r.id;
  const head=el('div');head.className='batch-row-header';const title=el('strong'),badge=el('span');badge.className='badge';head.append(title,badge);
  const info=el('small'),fields=el('div');fields.className='batch-row-fields';
  const titleLabel=el('label','曲名'),input=el('input');input.maxLength=120;input.value=r.title;input.addEventListener('input',()=>{try{batch.edit(r.id,{title:input.value.trim()});}catch(e){input.value=batch.state().state.batch.rows.find(row=>row.id===r.id).title;status(e.message,true);}});titleLabel.append(input);
  const policyLabel=el('label','单曲收听范围'),select=el('select');for(const [v,t] of [['','请逐首确认'],['free','免费'],['vip','VIP']])select.append(new Option(t,v));select.value=r.mode;select.onchange=()=>{try{batch.edit(r.id,{mode:select.value});}catch(e){status(e.message,true);}};policyLabel.append(select);fields.append(titleLabel,policyLabel);
  const actions=el('div');actions.className='batch-controls';const up=el('button','上移'),down=el('button','下移'),cancel=el('button','取消此项');
  for(const b of [up,down,cancel])b.type='button';up.onclick=()=>run(()=>batch.move(r.id,-1));down.onclick=()=>run(()=>batch.move(r.id,1));cancel.onclick=()=>run(()=>batch.cancelRow(r.id));actions.append(up,down,cancel);
  const reselectLabel=el('label','重新选择原文件'),file=el('input');file.type='file';file.accept='.mp3,.wav';file.onchange=()=>run(()=>{if(file.files[0]){batch.replace(r.id,file.files[0]);status('已选择文件，点击继续时会核对原文件证明。');}});reselectLabel.append(file);
  const error=el('p');error.className='batch-error';const link=el('a','前往曲目工作区补齐与审核');
  li.append(head,info,fields,actions,reselectLabel,error,link);return {li,title,badge,info,input,select,up,down,cancel,reselectLabel,file,error,link};
}
function render(){const snap=batch?.state(),b=snap?.state.batch,pending=!!snap?.state.pending,blocked=busy||snap?.busy;
  $('batch-fields').disabled=!album||!!b||blocked;$('batch-setup').hidden=!!b;$('batch-workspace').hidden=!b;$('batch-reload').disabled=blocked;
  if(!b)return;
  const ready=b.rows.filter(r=>r.stage==='ready'),added=ready.filter(r=>b.album.expectedIds.includes(r.trackId));
  $('batch-summary').textContent=`草稿完成 ${ready.length} / ${b.rows.length} · 已加入 ${added.length}`;
  const live=new Set(b.rows.map(r=>r.id));for(const [id,node] of rowNodes)if(!live.has(id)){node.li.remove();rowNodes.delete(id);}
  b.rows.forEach((r,i)=>{let n=rowNodes.get(r.id);if(!n){n=makeRow(r);rowNodes.set(r.id,n);}if($('batch-rows').children[i]!==n.li)$('batch-rows').insertBefore(n.li,$('batch-rows').children[i]||null);
    n.title.textContent=`${i+1}. ${r.name}`;n.badge.textContent=names[r.stage];n.info.textContent=bytes(r.size)+(batch.hasFile(r.id)?' · 原文件已选':' · 文件未保留在浏览器中');
    n.input.disabled=n.select.disabled=blocked||pending||b.started||r.stage==='cancelled';
    n.up.disabled=blocked||pending||b.started||i===0;n.down.disabled=blocked||pending||b.started||i===b.rows.length-1;
    n.cancel.disabled=blocked||pending||!!r.trackId||r.stage==='cancelled';
    n.reselectLabel.hidden=['ready','retired','cancelled','verified'].includes(r.stage);n.file.disabled=blocked||pending;
    n.error.hidden=!r.error;n.error.textContent=r.error;n.link.hidden=!r.trackId;if(r.trackId)n.link.href='/admin/music/?track='+r.trackId;
  });
  $('batch-start').textContent=b.started?'继续批次':'确认并开始上传';$('batch-start').disabled=blocked||pending||b.rows.every(r=>['ready','retired','cancelled'].includes(r.stage));
  $('batch-stop').hidden=!snap.busy;$('batch-stop').disabled=!snap.busy;
  $('batch-retry').hidden=!pending||blocked;$('batch-retry').disabled=blocked;
  $('batch-add').disabled=blocked||pending||ready.length===added.length;
  $('batch-add').textContent=`将 ${ready.length-added.length} 首成功曲目加入专辑`;
  $('batch-sync-album').disabled=blocked||pending;$('batch-clear').disabled=blocked||pending;
  $('batch-cancel-remaining').disabled=blocked||pending||b.rows.every(r=>r.trackId||r.stage==='cancelled');
  $('batch-progress').hidden=!snap.phase;
  if(snap.phase){$('batch-progress-label').textContent=snap.phase.text+(snap.phase.percent===null?'':` ${snap.phase.percent}%`);if(snap.phase.percent===null)$('batch-meter').removeAttribute('value');else $('batch-meter').value=snap.phase.percent;}
}
async function boot(){const query=new URLSearchParams(location.search),id=query.get('album');if(query.getAll('album').length!==1||!uuid(id))throw new Error('请从已保存的草稿专辑进入多文件上传。');
  const s=await request('/status');if(actor&&actor!==s.actorId)throw new Error('管理员账号已变化，请使用原账号重新登录。');
  if(!s.capabilities.collections)throw new Error('专辑管理尚不可用。');
  const a=await request('/collections/'+id);if(a.type!=='album')throw new Error('多文件上传仅用于专辑。');actor=s.actorId;album=a;
  $('batch-album-title').textContent=Object.values(a.title).find(Boolean)||a.slug;
  showService(s);
  if(!batch)batch=createAlbumBatch({journal:createBatchJournal(sessionStorage,actor,id),actor,converter,onChange:render,onService:showService});
  status(batch.state().state.pending?'已恢复待确认操作。请明确核对原操作。':batch.state().state.batch?'已恢复本标签页清单；未自动上传。':'先选择文件，生成清单后逐首确认。');render();
}
$('batch-form').onsubmit=e=>{e.preventDefault();run(()=>{const files=[...$('batch-files').files];const plan=createBatchPlan(album,files,{locale:$('batch-locale').value,creator:$('batch-creator').value,language:$('batch-language').value,instrumental:$('batch-instrumental').checked});batch.select(plan,files);$('batch-files').value='';status('清单已生成。请逐首确认曲名、收听范围与顺序。');});};
$('batch-start').onclick=()=>run(async()=>{const b=batch.state().state.batch;if(!b.started&&!await ask('开始创建并上传？',`将依次创建 ${b.rows.filter(r=>r.stage!=='cancelled').length} 首曲目草稿，并按每行的免费或 VIP 设置保存。上传不代表发布。`))return;await batch.continue();const rows=batch.state().state.batch.rows;status(rows.every(r=>r.stage==='ready')?'全部音频已验证并保存为草稿，请确认加入专辑。':'本轮处理已停止。请核对各行状态，再将成功曲目加入专辑。');});
$('batch-stop').onclick=()=>{batch.stop();status('已请求停止后续处理；已发送的上传仍需等待结果并核对。');};
$('batch-retry').onclick=()=>run(async()=>{if(await ask('核对原操作？','使用原内容、版本和幂等键核对。此操作不会重传音频文件，也不会自动继续下一首。')){await batch.retry();status('原操作已确认。可继续批次。');}});
$('batch-add').onclick=()=>run(async()=>{const b=batch.state().state.batch,n=b.rows.filter(r=>r.stage==='ready').length;if(await ask('将成功曲目加入草稿专辑？',`${n} / ${b.rows.length} 首草稿完成。本批成功曲目按清单顺序加入专辑；未完成项保留，不会发布专辑。`)){await batch.addReady();status('成功曲目已加入草稿专辑，仍需逐曲补齐资料和审核。');}});
$('batch-sync-album').onclick=()=>run(async()=>{if(await ask('采用服务器当前曲序？','保留服务器当前的所有成员和顺序。此后仅追加尚未在专辑中的成功曲目，不覆盖其他编辑。')){await batch.refreshAlbum();status('已采用服务器曲序作为新的追加起点。');}});
$('batch-cancel-remaining').onclick=()=>run(async()=>{if(await ask('取消未开始的曲目？','仅取消还未创建草稿的项。已创建的曲目、已预留及结果未知的上传继续保留，需分别处理。')){batch.cancelRemaining();status('已取消未开始项，已有草稿与会话保持原状。');}});
$('batch-clear').onclick=()=>run(async()=>{if(await ask('结束此批次？','仅清除本标签页的已处理清单。服务端草稿、已上传文件与预留额度均保留；未确认操作不能清除。')){batch.clear();rowNodes.clear();$('batch-rows').replaceChildren();await boot();}});
$('batch-reload').onclick=()=>run(boot);
window.addEventListener('beforeunload',e=>{const snapshot=batch?.state(),b=snapshot?.state.batch;if(b&&(snapshot.busy||snapshot.state.pending||!b.started||b.rows.some(r=>!['cancelled','retired'].includes(r.stage)&&(r.stage!=='ready'||!b.album.expectedIds.includes(r.trackId))))){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>batch?.destroy());
run(boot);
