const base='/admin/api/music/site-content';
const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const reportPath=new RegExp('^/reports(?:/(?:status|options|snapshots|external(?:/'+uuid+')?))?$','i');
const validPath=new RegExp('^/(?:reports(?:/(?:status|options|snapshots|external(?:/'+uuid+')?))?|status|assets|audit|jobs/run|campaigns/[a-z0-9][a-z0-9_-]{0,63}|platforms(?:/'+uuid+')?|assets/'+uuid+'/rights|(?:tracks|promotions|clips|games|home)(?:/'+uuid+'(?:/(?:publish|unpublish|rollback|schedule|cancel-schedule|preflight|publications|campaigns|revisions))?)?)$','i');
export async function contentRequest(path,{method='GET',body,key,etag}={}) {
  if(typeof path!=='string'||!validPath.test(path.split('?')[0])||!['GET','POST','PATCH','PUT'].includes(method))throw new Error('无效内容管理路径');
  const headers={};if(method!=='GET'){headers['X-Requested-With']='StationCatMusicAdmin';headers['Content-Type']='application/json';if(key)headers['Idempotency-Key']=key;if(etag)headers['If-Match']=etag;}
  let response,data;
  try { response=await fetch(base+path,{method,headers,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000),...(body===undefined?{}:{body:JSON.stringify(body)})}); }
  catch {throw Object.assign(new Error('操作结果尚未确认，请保留原操作并核对。'),{uncertain:true});}
  try{data=await response.json();}catch{throw Object.assign(new Error('没有收到有效回执，请核对原操作。'),{uncertain:true,status:response.status});}
  if(!response.ok||data.ok!==true)throw Object.assign(new Error(data.code??'STATION_CONTENT_UNAVAILABLE'),{code:data.code,status:response.status,field:data.field,uncertain:response.status>=500||[408,429].includes(response.status)});
  return data;
}
// Journal only the original command, version and key. No auth/media URLs or files.
// A lost acknowledgement always replays that exact command, including after reload.
export function createContentController({request=contentRequest,storage,makeId=()=>crypto.randomUUID(),scope='content',clock=Date.now}={}) {
  if(!['content','reports'].includes(scope))throw new Error('无效工作区');
  const statusPath=scope==='reports'?'/reports/status':'/status',journalPrefix=scope==='reports'?'station-reports-admin:v1:':'station-content-admin:v1:';
  const allowed=path=>validPath.test(path)&&(scope==='reports'?reportPath.test(path):!reportPath.test(path));
  let actor=null,journal=null,busy=false;
  const write=value=>{storage.setItem(journalPrefix+actor,JSON.stringify(value));journal=value;};
  async function sameActor(){const status=await request(statusPath);if(status.actorId!==actor)throw Object.assign(new Error('管理员已变化，请重新载入工作区。'),{code:'STATION_ACTOR_CHANGED'});return status;}
  async function sendPending(recovering=false){
    if(!journal?.pending)throw new Error('没有待核对的操作。');
    await sameActor();const op=journal.pending;
    let result;
    try {result=await request(op.path,{method:op.method,body:op.body,key:op.key,etag:op.etag});}
    catch(e){if(!recovering&&!e.uncertain&&e.code!=='STATION_ACTOR_CHANGED'&&e.code!=='REPORT_OPERATION_EXPIRED')write({pending:null});throw e;}
    // Success is already acknowledged by the write endpoint. A later 401/403,
    // actor change, network error or local clear failure cannot revoke it. Keep
    // the original command/key (also on disk) and never expose an old actor's
    // result. Reload/recovery must replay the original idempotent operation.
    try{await sameActor();write({pending:null});return result;}
    catch(e){throw Object.assign(new Error('操作已提交，后续身份或本机复核未完成，请核对原操作。'),{code:e.code,status:e.status,uncertain:true,postWrite:true});}
  }
  const serial=async task=>{if(busy)throw new Error('正在核对上一次操作。');busy=true;try{return await task();}finally{busy=false;}};
  return {
    async connect(){const status=await request(statusPath);if(typeof status.actorId!=='string'||!status.actorId||!['editor','publisher'].includes(status.role))throw new Error('无法确认管理员角色。');actor=status.actorId;
      try {const raw=storage.getItem(journalPrefix+actor);journal=raw?JSON.parse(raw):{pending:null};const p=journal.pending;
        if(!journal||typeof journal!=='object'||(p&&(!allowed(p.path)||!['POST','PATCH','PUT'].includes(p.method)||typeof p.key!=='string'||typeof p.body!=='object'||!p.body)))throw new Error('journal');write(journal);
      }catch{throw Object.assign(new Error('本机恢复记录不可用，已停止写入。'),{code:'STATION_JOURNAL_UNAVAILABLE'});}return status;},
    pending:()=>journal?.pending??null,
    async mutate(path,method,body,version=null){return serial(async()=>{
      if(!actor||!journal)throw new Error('请先核对管理员。');if(journal.pending)throw new Error('请先核对原操作。');if(!allowed(path)||!['POST','PATCH','PUT'].includes(method))throw new Error('无效内容管理路径');
      await sameActor();const nonce=makeId(),key=scope==='reports'?`r1_${clock()}_${nonce}`:nonce;write({pending:{path,method,body:JSON.parse(JSON.stringify(body)),etag:version===null?null:`"edit-${version}"`,key}});return sendPending();});},
    // A recovery request may now fail authorization even though its original
    // request committed. No recovery error is proof that the first write failed.
    async retry(){return serial(()=>sendPending(true));},
    async verifyActor(){return sameActor();}
  };
}
