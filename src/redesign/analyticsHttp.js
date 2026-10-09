import { requestDeadline } from './publicStore.js';
import { eventConfiguration, validateStationEvents } from './analyticsModel.js';
import { collectStationEvents, stationEventReadiness } from './analyticsStore.js';

export const isStationEventPath = path => ['/api/station/events','/api/station/events/config'].includes(path);
const fail=(code,status)=>{throw Object.assign(new Error(code),{code,status});};
async function body(request) {
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||request.headers.has('content-encoding'))fail('UNSUPPORTED_MEDIA_TYPE',415);
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>32768))fail('REQUEST_TOO_LARGE',413);
  if(!request.body)fail('INVALID_EVENT',400);
  const reader=request.body.getReader();let size=0,text='',timer;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try {
    const read=async()=>{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)fail('REQUEST_TOO_LARGE',413);text+=decoder.decode(value,{stream:true});}text+=decoder.decode();};
    await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('timeout'),{code:'REQUEST_TIMEOUT',status:408})),3000);})]);
    if(declared!==null&&Number(declared)!==size)fail('INVALID_EVENT',400);
    try{return JSON.parse(text);}catch{fail('INVALID_EVENT',400);}
  }catch(error){if(error.status)throw error;fail('INVALID_EVENT',400);}
  finally {clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
export async function handleStationEvents(request,env,{clock=Date.now,deadlineMs=10000}={}) {
  const requestId=crypto.randomUUID();
  const json=(data,status=200,extra={})=>new Response(request.method==='HEAD'?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','X-Request-ID':requestId,...extra}});
  try {
    const url=new URL(request.url),config=url.pathname==='/api/station/events/config';
    if(!isStationEventPath(url.pathname))return null;
    // Disabled collection performs no method/body/schema/binding reads.
    const readiness=eventConfiguration(env);
    if(!readiness.available)return json(config?readiness:{code:readiness.reason,message:'Statistics are unavailable.',request_id:requestId},config?200:503);
    if(url.search)fail('INVALID_INPUT',400);
    if(config?!['GET','HEAD'].includes(request.method):request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
    const now=clock();if(!Number.isSafeInteger(now)||now<0)throw new Error('clock');
    const run=requestDeadline(deadlineMs);
    if(config)return json(await run(()=>stationEventReadiness(env,now,request)));
    if(request.headers.get('origin')!==url.origin||request.headers.get('x-requested-with')!=='StationCatEvents'||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site'))||request.headers.get('Sec-GPC')==='1')fail('PRIVACY_ORIGIN_MISMATCH',403);
    const events=validateStationEvents(await body(request));
    return json({ok:true,...await run(()=>collectStationEvents(request,env,events,now))});
  }catch(error){
    const known=Number.isInteger(error?.status)&&/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code||'');
    return json({code:known?error.code:'EVENTS_UNAVAILABLE',message:'Statistics were not confirmed.',request_id:requestId},known?error.status:503,error?.retryAfter?{'Retry-After':String(error.retryAfter)}:{});
  }
}
