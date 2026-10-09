import worker from '../../src/worker.js';
// Loopback fixtures only; not exported from the deployed Worker.
export default {async fetch(request,env,ctx){const url=new URL(request.url),m=/^\/fixture-report-(off|content-off|policy-off|retention-off|aggregation-off|empty|wrong)(?=\/)/.exec(url.pathname);let local=env;
  if(m){url.pathname=url.pathname.slice(m[0].length);local={...env,
    ...(m[1]==='off'?{STATION_REPORTS_ENABLED:'false'}:{}),...(m[1]==='content-off'?{STATION_CONTENT_ADMIN_ENABLED:'false'}:{}),
    ...(m[1]==='policy-off'?{STATION_REPORT_POLICY_VERSION:''}:{}),...(m[1]==='retention-off'?{STATION_REPORT_RETENTION_ENABLED:'false'}:{}),
    ...(m[1]==='aggregation-off'?{STATION_REPORT_AGGREGATION_ENABLED:'false'}:{}),...(m[1]==='empty'?{MUSIC_DB:env.EMPTY_DB}:{}),...(m[1]==='wrong'?{MUSIC_DB:env.WAITLIST_DB}:{})};request=new Request(url,request);}
  return worker.fetch(request,local,ctx);
},scheduled:worker.scheduled};
