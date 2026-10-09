import { fields, fail, mutationKey, musicId } from '../music/adminValidation.js';
import { contentRole, requirePublisher } from './contentAdminStore.js';
import { reportReadiness, reportOptions, reportHealth, readReport, saveReportSnapshot, saveExternalMetric } from './reportsStore.js';
import { enabled } from './reportsModel.js';

// Only reached after the existing verified Access identity and write-origin gate.
export async function handleReportAdmin(request,env,actor,query,readBody){
  const runtime=await reportReadiness(env),path=new URL(request.url).pathname.slice('/admin/api/music/site-content/reports'.length);
  const read=['GET','HEAD'].includes(request.method),context={actorId:actor,key:request.headers.get('idempotency-key'),ifMatch:request.headers.get('if-match')};
  if(read){
    if(path===''){return readReport(runtime,query);}
    fields(query,[]);
    if(path==='/status')return {actorId:actor,role:contentRole(env,actor),enabled:true,aggregationEnabled:enabled(env.STATION_REPORT_AGGREGATION_ENABLED),retentionEnabled:enabled(env.STATION_REPORT_RETENTION_ENABLED),health:await reportHealth(runtime.s,Date.now())};
    if(path==='/options')return reportOptions(runtime.s);
    fail('NOT_FOUND',404);
  }
  fields(query,[]);requirePublisher(env,actor);mutationKey(context.key);
  if(path==='/snapshots'&&request.method==='POST')return saveReportSnapshot(runtime,env,await readBody(request),context);
  const external=/^\/external(?:\/([^/]+))?$/.exec(path);
  if(external){if(request.method!==(external[1]?'PATCH':'POST'))fail('METHOD_NOT_ALLOWED',405);return saveExternalMetric(runtime,env,external[1]?musicId(external[1]):null,await readBody(request),context);}
  fail('NOT_FOUND',404);
}
