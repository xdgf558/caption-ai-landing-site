import { request, hashFile, fileFormat, uuid } from './musicAdminClient.js';
import { WAV_LIMITS, WAV_PROFILE, isWav } from './musicWav.js';

export const BATCH_LIMIT = 50;
export const BATCH_BYTES = 1024 * 1048576;
const locales = ['zh-Hans','zh-Hant','en','ja'];
const stages = ['waiting','prepared','created','reserved','writing','verified','ready','retired','cancelled'];
const keysOnly = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
const ids = a => Array.isArray(a) && a.length <= 500 && a.every(uuid) && new Set(a).size === a.length;
const string = (v,n) => typeof v === 'string' && v.length <= n && !/[\u0000-\u001f\u007f]/.test(v);
const version = v => Number.isSafeInteger(v) && v > 0;
const copy = v => structuredClone(v);
const fail = text => { throw new Error(text); };
const policy = accessMode => ({accessMode,earlyAccessUntil:null,postEarlyAccessMode:null,policyVersion:1});
function draft(batch,row) {
  return {slug:'track-'+row.id,metadata:{originalLocale:batch.locale,title:{[batch.locale]:row.title},summary:{[batch.locale]:''},
    creatorName:batch.creator,instrumental:batch.instrumental,language:batch.language,genres:[],moods:[],story:''},policy:policy(row.mode),assets:{}};
}
function command(batch,kind,rowId) {
  const row = batch.rows.find(r=>r.id===rowId);
  if (kind === 'order') return {path:`/collections/${batch.album.id}/tracks`,method:'PUT',etag:`"edit-${batch.album.version}"`,
    body:{trackIds:[...batch.album.baseIds,...batch.rows.filter(r=>r.stage==='ready'&&!batch.album.baseIds.includes(r.trackId)).map(r=>r.trackId)],reason:'专辑多文件上传：加入已验证的曲目草稿'}};
  if (!row) fail('批次曲目记录不可读。');
  if (kind === 'create') return {path:'/tracks',method:'POST',body:draft(batch,row)};
  if (kind === 'reserve') return {path:'/uploads',method:'POST',body:{trackId:row.trackId,kind:'audio',format:'mp3',byteSize:row.output.size,sha256:row.output.sha256}};
  if (kind === 'complete') return {path:`/uploads/${row.uploadId}/complete`,method:'POST',body:{}};
  if (kind === 'save') return {path:`/tracks/${row.trackId}`,method:'PATCH',etag:`"edit-${row.editVersion}"`,
    body:{...draft(batch,row),assets:{audio:row.assetId},revisionId:row.revisionId,reason:'专辑多文件上传：关联已验证的完整音频'}};
  fail('批次原操作不可读。');
}
function validate(state) {
  if (!keysOnly(state,['batch','pending'])) fail('批次恢复记录不可读。');
  const b = state.batch, op=state.pending;
  if (b !== null) {
    if (!keysOnly(b,['id','album','locale','creator','language','instrumental','started','rows']) || !uuid(b.id) ||
      !locales.includes(b.locale) || !string(b.creator,80) || !b.creator.trim() || !string(b.language,40) || !b.language.trim() || typeof b.instrumental!=='boolean' || typeof b.started!=='boolean' ||
      !keysOnly(b.album,['id','title','version','baseIds','expectedIds']) || !uuid(b.album.id) || !string(b.album.title,120) || !version(b.album.version) || !ids(b.album.baseIds) || !ids(b.album.expectedIds) ||
      !Array.isArray(b.rows) || !b.rows.length || b.rows.length>BATCH_LIMIT || new Set([...b.album.baseIds,...b.rows.map(r=>r.trackId||r.id)]).size>500 || new Set(b.rows.map(r=>r.id)).size!==b.rows.length) fail('批次恢复记录不可读。');
    let size=0;
    for (const r of b.rows) {
      if (!keysOnly(r,['id','name','size','title','mode','stage','output','trackId','revisionId','editVersion','uploadId','assetId','writeKey','error']) || !uuid(r.id) ||
        !string(r.name,260) || !Number.isSafeInteger(r.size) || r.size<1 || r.size>(isWav(r)?WAV_LIMITS.audio:32*1048576) ||
        !string(r.title,120) || (b.started&&r.stage!=='cancelled'&&!r.title.trim()) || !['','free','vip'].includes(r.mode) || (b.started&&r.stage!=='cancelled'&&!r.mode) || !stages.includes(r.stage) || !string(r.error,500)) fail('批次曲目记录不可读。');
      size+=r.size;
      for(const k of ['trackId','revisionId','uploadId','assetId','writeKey']) if(r[k]!=null&&!uuid(r[k])) fail('批次编号无效。');
      if (r.output!=null && (!keysOnly(r.output,['size','sha256','conversion']) || !Number.isSafeInteger(r.output.size) || r.output.size<1 || r.output.size>32*1048576 || !/^[a-f0-9]{64}$/.test(r.output.sha256) || ![null,WAV_PROFILE].includes(r.output.conversion))) fail('批次文件证明无效。');
      if (r.editVersion!=null&&!version(r.editVersion)) fail('批次版本无效。');
      if (['prepared','created','reserved','writing','verified','ready','retired'].includes(r.stage)&&!r.output) fail('缺少文件证明。');
      if (['created','reserved','writing','verified','ready','retired'].includes(r.stage)&&(!r.trackId||!r.revisionId||!r.editVersion)) fail('缺少曲目证明。');
      if (['reserved','writing','verified','ready','retired'].includes(r.stage)&&(!r.uploadId||!r.assetId||!r.writeKey)) fail('缺少会话证明。');
    }
    if(size>BATCH_BYTES) fail('批次文件总大小超限。');
    const trackIds=b.rows.map(r=>r.trackId).filter(Boolean);
    if(new Set(trackIds).size!==trackIds.length) fail('批次曲目重复。');
  }
  if (op!==null) {
    if (!b || !keysOnly(op,['kind','rowId','key','request']) || !uuid(op.key) || !['create','reserve','complete','save','order'].includes(op.kind) ||
      JSON.stringify(op.request)!==JSON.stringify(command(b,op.kind,op.rowId))) fail('批次原操作不匹配，请保留记录并联系维护者。');
  }
}
// Separate actor + album scope. Media bytes and authentication material never enter this journal.
export function createBatchJournal(storage,actor,albumId) {
  if (!actor||typeof actor!=='string'||!uuid(albumId)) fail('无法核对管理员或专辑。');
  const key=`station-music-album-batch:v1:${actor}:${albumId}`;
  let state;
  try {state=JSON.parse(storage.getItem(key)||'{"batch":null,"pending":null}');} catch {fail('批次恢复记录不可读，请保留此标签页。');}
  const write=next=>{validate(next);if(next.batch&&next.batch.album.id!==albumId)fail('批次专辑不匹配。');storage.setItem(key,JSON.stringify(next));state=copy(next);};
  write(state);
  return {get:()=>copy(state),update:patch=>write({...state,...patch})};
}
export function createBatchPlan(album,files,config) {
  if(album.type!=='album'||album.status!=='draft') fail('请先选择已保存的草稿专辑；已发布专辑须先下架。');
  if(!files.length||files.length>BATCH_LIMIT) fail('每批请选择 1–50 个文件。');
  const seen=new Set();
  const rows=Array.from(files,(file)=>{
    if(isWav(file)){if(file.size<44||file.size>WAV_LIMITS.audio)fail('WAV 最大 256 MiB。');}else fileFormat('audio',file);
    const signature=JSON.stringify([file.name,file.size,file.lastModified]);
    if(seen.has(signature))fail('清单中有重复文件，请只选择一次。');seen.add(signature);
    return {id:crypto.randomUUID(),name:file.name,size:file.size,title:file.name.replace(/\.(mp3|wav)$/i,'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120)||'未命名歌曲',mode:'',stage:'waiting',error:''};
  });
  const b={id:crypto.randomUUID(),album:{id:album.id,title:Object.values(album.title).find(Boolean)||album.slug,version:album.editVersion,baseIds:album.tracks.map(t=>t.id),expectedIds:album.tracks.map(t=>t.id)},
    locale:config.locale,creator:config.creator.trim(),language:config.language.trim(),instrumental:config.instrumental,started:false,rows};
  validate({batch:b,pending:null});return b;
}

export function createAlbumBatch({journal,actor,api=request,hash=hashFile,converter,onChange=()=>{},onService=()=>{}}) {
  const files=new Map();let busy=false,stop=false,phase=null;
  const notify=()=>onChange({busy,phase,state:journal.get()});
  const save=patch=>{journal.update(patch);notify();};
  const rowUpdate=(id,patch)=>{const b=journal.get().batch;save({batch:{...b,rows:b.rows.map(r=>r.id===id?{...r,...patch}:r)}});};
  const row=id=>journal.get().batch.rows.find(r=>r.id===id);
  const setPhase=(id,text,percent=null)=>{phase={id,text,percent};notify();};
  async function checkActor(){const s=await api('/status');if(s.actorId!==actor)fail('管理员账号已变化。请使用原账号重新登录后核对。');onService(s);return s;}
  async function checkAlbum(){const b=journal.get().batch;const a=await api('/collections/'+b.album.id);
    if(a.type!=='album'||a.status!=='draft'||a.editVersion!==b.album.version||JSON.stringify(a.tracks.map(t=>t.id))!==JSON.stringify(b.album.expectedIds)) fail('专辑已变化。批次已保留；请在专辑工作区核对，不能覆盖其他人的曲序或发布状态。');
  }
  async function replay(){const {batch:b,pending:op}=journal.get();if(!op)return;
    await checkActor();let result;
    try {result=await api(op.request.path,{...op.request,key:op.key});}
    catch(e){if(!e.uncertain)save({pending:null});throw e;}
    // One durable update accepts the receipt and clears its key together.
    let next=copy(b),r=next.rows.find(r=>r.id===op.rowId);
    if(op.kind==='create'){if(!uuid(result.trackId)||!uuid(result.revisionId)||!version(result.editVersion))fail('曲目回执不完整，请核对原操作。');Object.assign(r,{trackId:result.trackId,revisionId:result.revisionId,editVersion:result.editVersion,stage:'created'});}
    if(op.kind==='reserve'){if(!uuid(result.uploadId)||!uuid(result.assetId))fail('预留回执不完整，请核对原操作。');Object.assign(r,{uploadId:result.uploadId,assetId:result.assetId,stage:'reserved'});}
    if(op.kind==='complete'){if(result.status!=='completed'||result.assetId!==r.assetId||result.uploadId!==r.uploadId)fail('验证回执不完整，请核对原操作。');r.stage='verified';}
    if(op.kind==='save'){if(result.trackId!==r.trackId||!uuid(result.revisionId)||!version(result.editVersion))fail('草稿回执不完整，请核对原操作。');Object.assign(r,{stage:'ready',revisionId:result.revisionId,editVersion:result.editVersion});}
    if(op.kind==='order'){if(result.collectionId!==b.album.id||!version(result.editVersion))fail('曲序回执不完整，请核对原操作。');next.album.version=result.editVersion;next.album.expectedIds=op.request.body.trackIds;}
    if(r)r.error='';save({batch:next,pending:null});
  }
  async function mutate(kind,id=null){const b=journal.get().batch;if(journal.get().pending)fail('请先核对原操作。');
    save({pending:{kind,rowId:id,key:crypto.randomUUID(),request:command(b,kind,id)}});await replay();
  }
  function stopped(){if(stop)fail('已停止后续处理。原文件、草稿与上传会话均保留。');}
  async function prepare(id){let r=row(id),file=files.get(id);if(!file)fail('请在此行重新选择原文件，再继续批次。');
    let conversion=null;
    if(isWav(file)){
      if(r.output&&r.output.conversion!==WAV_PROFILE)fail('此会话需要原 MP3，不能更换编码配置。');
      setPhase(id,'本机转换',0);const result=await converter.convert(file,'audio',p=>setPhase(id,'本机转换',p));file=result.file;conversion=result.profile;
    }
    fileFormat('audio',file);stopped();setPhase(id,'校验文件',0);const sha256=await hash(file,p=>setPhase(id,'校验文件',p));stopped();
    if(r.output){if(file.size!==r.output.size||sha256!==r.output.sha256)fail('所选文件与原会话不符。需要相同 MP3，或用原 WAV 按原配置转换。');}
    else rowUpdate(id,{output:{size:file.size,sha256,conversion},stage:'prepared'});
    return file;
  }
  async function process(id){let r=row(id),file;
    rowUpdate(id,{error:''});await checkActor();stopped();
    if(!r.output||!r.uploadId)file=await prepare(id);
    r=row(id);
    if(!r.trackId){stopped();setPhase(id,'创建曲目草稿');await mutate('create',id);}
    r=row(id);
    if(!r.uploadId){stopped();const s=await checkActor();if(!s.capabilities?.uploads)fail('上传未开放或配额未配置，请先处理配置。');
      rowUpdate(id,{writeKey:crypto.randomUUID()});setPhase(id,'预留上传额度');await mutate('reserve',id);}
    r=row(id);
    if(!['verified','ready'].includes(r.stage)){
      setPhase(id,'核对上传会话');await checkActor();const u=await api('/uploads/'+r.uploadId);
      if(u.trackId!==r.trackId||u.assetId!==r.assetId||u.declaredBytes!==r.output.size)fail('上传会话与原文件不匹配。');
      if(u.status==='completed')rowUpdate(id,{stage:'verified'});
      else if(u.expired||u.cleanupState||['expired','rejected'].includes(u.status)){rowUpdate(id,{stage:'retired'});fail('会话已过期、拒绝或停用；预留额度按原维护流程处理，不能新建替代预留。');}
      else if(u.status==='reserved'&&r.stage!=='writing'){
        file ||= await prepare(id);stopped();await checkActor();stopped();
        // Persist BEFORE PUT. Even a later reserved response cannot prove that
        // an earlier, unconfirmed request will never arrive: never send twice.
        rowUpdate(id,{stage:'writing'});setPhase(id,'上传中，请保持页面打开');
        await api('/uploads/'+r.uploadId+'/body',{method:'PUT',raw:true,type:'audio/mpeg',body:file,key:r.writeKey,timeout:130000});
      }else if(!['reserved','uploading'].includes(u.status))fail('未知上传状态，已停止。');
      file=null;
      if(row(id).stage!=='verified'){setPhase(id,'服务端验证');await mutate('complete',id);}
    }
    r=row(id);if(r.stage==='verified'){setPhase(id,'保存音频到草稿');await mutate('save',id);}
    files.delete(id);
  }
  async function run(fn){if(busy)fail('请等待当前操作完成。');busy=true;stop=false;notify();try{return await fn();}finally{busy=false;phase=null;notify();}}
  return {
    state:()=>({busy,phase,state:journal.get()}),
    select(b,selected){if(busy||journal.get().batch)fail('请先处理当前批次。');save({batch:b});b.rows.forEach((r,i)=>files.set(r.id,selected[i]));},
    edit(id,patch){const b=journal.get().batch;if(busy||b.started||journal.get().pending)fail('开始后不能改变清单。');if(!keysOnly(patch,['title','mode']))fail('无效编辑。');rowUpdate(id,patch);},
    move(id,delta){const b=journal.get().batch;if(busy||b.started)fail('开始后不能改变顺序。');const i=b.rows.findIndex(r=>r.id===id),j=i+delta;if(j<0||j>=b.rows.length)return;[b.rows[i],b.rows[j]]=[b.rows[j],b.rows[i]];save({batch:b});},
    replace(id,file){if(busy||!row(id))fail('请先停止批次。');if(!isWav(file))fileFormat('audio',file);else if(file.size>WAV_LIMITS.audio)fail('WAV 大小超限。');files.set(id,file);notify();},
    hasFile:id=>files.has(id),
    stop(){stop=true;converter.cancel();notify();},
    retry:()=>run(replay),
    continue:()=>run(async()=>{
      if(journal.get().pending)fail('先明确核对原操作，再继续批次。');
      const b=journal.get().batch;if(!b)fail('请先选择文件。');
      if(b.rows.some(r=>r.stage!=='cancelled'&&!r.title.trim()))fail('请为每首待处理曲目填写曲名。');
      if(b.rows.some(r=>r.stage!=='cancelled'&&!['free','vip'].includes(r.mode)))fail('请逐首确认免费或 VIP；专辑设置不会替你修改单曲权限。');
      const service=await checkActor();if(!service.capabilities?.uploads)fail('上传未开放或配额未配置。');await checkAlbum();save({batch:{...b,started:true}});
      for(const r of b.rows){if(stop)break;if(['ready','cancelled','retired'].includes(row(r.id).stage))continue;
        try{await process(r.id);}catch(e){rowUpdate(r.id,{error:String(e.message).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500)});throw e;}}
    }),
    cancelRow(id){if(busy||journal.get().pending)fail('请先核对当前操作。');const r=row(id);if(r.trackId)fail('已创建的草稿和会话须保留恢复。');rowUpdate(id,{stage:'cancelled',error:''});files.delete(id);},
    cancelRemaining(){const {batch:b,pending:p}=journal.get();if(busy||p)fail('请先核对当前操作。');save({batch:{...b,rows:b.rows.map(r=>r.trackId?r:{...r,stage:'cancelled',error:''})}});for(const r of b.rows)if(!r.trackId)files.delete(r.id);},
    addReady:()=>run(async()=>{const b=journal.get().batch;if(journal.get().pending)fail('请先核对原操作。');
      const expected=command(b,'order',null).body.trackIds;if(expected.length===b.album.baseIds.length)fail('尚无已验证且保存的曲目。');
      if(JSON.stringify(expected)===JSON.stringify(b.album.expectedIds))fail('成功曲目已全部加入。');await checkActor();await checkAlbum();await mutate('order');}),
    refreshAlbum:()=>run(async()=>{if(journal.get().pending)fail('请先核对原操作。');await checkActor();const b=journal.get().batch;const a=await api('/collections/'+b.album.id);if(a.type!=='album'||a.status!=='draft')fail('专辑必须为草稿。');const currentIds=a.tracks.map(t=>t.id);save({batch:{...b,album:{...b.album,version:a.editVersion,baseIds:currentIds,expectedIds:currentIds}}});}),
    clear(){const {batch:b,pending:p}=journal.get();if(busy||p)fail('结果不明时不能清除恢复记录。');
      if(b.started&&b.rows.some(r=>!['cancelled','retired','ready'].includes(r.stage)||r.stage==='ready'&&!b.album.expectedIds.includes(r.trackId)))fail('请先处理未完成的曲目，并将成功曲目加入专辑。');
      save({batch:null});files.clear();},
    destroy(){stop=true;converter.cancel();files.clear();}
  };
}
