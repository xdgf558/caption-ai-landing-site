import worker from '../../src/worker.js';
// Fixture-only controls. No production bypass or signing material in source.
export default {async fetch(request,env,ctx){
 const url=new URL(request.url),match=/^\/fixture-(off|admin-only|scheduler-only|empty|wrong|editor|run)(?=\/)/.exec(url.pathname);let local=env;
 if(match){url.pathname=url.pathname.slice(match[0].length);local={...env,
  ...(match[1]==='off'||match[1]==='scheduler-only'?{STATION_CONTENT_ADMIN_ENABLED:'false'}:{}),
  ...(match[1]==='off'||match[1]==='admin-only'?{STATION_CONTENT_SCHEDULES_ENABLED:'false'}:{}),
  ...(match[1]==='empty'?{MUSIC_DB:env.EMPTY_DB}:{}),...(match[1]==='wrong'?{MUSIC_DB:env.WAITLIST_DB}:{}),
  ...(match[1]==='editor'?{STATION_CONTENT_EDITOR_EMAILS:'content-admin-fixture@example.test'}:{})};request=new Request(url,request);}
 return worker.fetch(request,local,ctx);
},scheduled:worker.scheduled};
