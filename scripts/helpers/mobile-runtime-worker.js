// LOCAL TEST ENTRY ONLY. Never deploy fixture routes or synthetic keys.
import {handleMobile} from '../../src/mobile/http.js';
import websiteWorker, {mobileReaderIdentity} from '../../src/worker.js';
import {cleanup} from '../../src/mobile/sessions.js';
import {processDeletionOutbox} from '../../src/mobile/deletion.js';
export default {async fetch(request,env) {
  const path=new URL(request.url).pathname;
  if(path==='/fixture/maintenance') {
    const {now}=await request.json();await cleanup(env.WAITLIST_DB,now);await processDeletionOutbox(env.WAITLIST_DB,now);
    return Response.json({ok:true});
  }
  if(path==='/fixture/disabled')return handleMobile(new Request('https://native.local.test/api/mobile/v1/config'),{...env,MOBILE_AUTH_ENABLED:'false'},mobileReaderIdentity);
  return websiteWorker.fetch(request,env,{});
}};
