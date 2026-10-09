import { getAdminAccessConfig } from '../adminAccess.js';
import { primary, rows } from '../music/adminStore.js';
import { snapshot, contentRole, contentAdminReadiness, mutateContent, rowGuard, combineGuards } from './contentAdminStore.js';
import { contentPublication } from './contentAdmin.js';

const enabled=v=>v===true||v==='true';
const safeCode=e=>typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(e.code)?e.code:'STATION_SCHEDULE_SERVICE_UNAVAILABLE';
export async function runStationContentSchedule(env) {
  if(!enabled(env.STATION_CONTENT_ADMIN_ENABLED)||!enabled(env.STATION_CONTENT_SCHEDULES_ENABLED)) return {available:false,reason:'SCHEDULE_DISABLED'};
  const runtime=await contentAdminReadiness(env),now=Date.now();
  const jobs=rows(await primary(runtime.db).prepare("SELECT * FROM station_publish_jobs WHERE status='pending' AND due_at<=? ORDER BY due_at,id LIMIT 3").bind(now).all());
  const results=[];
  for(const job of jobs) {
    try {
      const config=getAdminAccessConfig(env);
      if(!config.isConfigured||!config.allowedEmails.has(job.actor_id.toLowerCase())||contentRole(env,job.actor_id)!=='publisher') throw {code:'STATION_SCHEDULE_ACTOR_REVOKED'};
      const result=await contentPublication(runtime,job.object_type,job.object_id,'publish',{revision:job.revision,reason:'已登记的定时发布'},
        {actorId:job.actor_id,key:'station-publish-job-'+job.id,ifMatch:`"edit-${job.edit_version}"`},{job});
      results.push({id:job.id,status:'succeeded',revision:result.revision});
    } catch(error) {
      const code=safeCode(error);
      try {
        const x=await snapshot(runtime.db,job.object_type,job.object_id);
        // A competing edit cancels its job in the same batch. Never clear the
        // newer draft, another scheduler's success or a later pending job.
        if(x.h.edit_version===job.edit_version) {
          await mutateContent(runtime.db,{actorId:job.actor_id,key:'station-failed-job-'+job.id,route:'/admin/api/music/site-content/jobs/'+job.id+'/failure',command:{jobId:job.id,code}},async(s,at)=>({
            ...combineGuards(rowGuard('station_publish_jobs',job),rowGuard(x.d.table,x.h)),
            writes:[s.prepare("UPDATE station_publish_jobs SET status='failed',error_code=?,finished_at=? WHERE id=? AND status='pending'").bind(code,at,job.id),
              s.prepare(`UPDATE ${x.d.table} SET status=CASE WHEN status='scheduled' THEN 'draft' ELSE status END,scheduled_at=NULL,edit_version=edit_version+1,updated_at=? WHERE ${x.d.key}=? AND edit_version=?`).bind(at,x.id,job.edit_version)],
            action:'station.content.schedule-failed',targetId:x.id,summary:{jobId:job.id,type:x.type,revision:job.revision,errorCode:code},result:{id:job.id,status:'failed',errorCode:code}}));
        }
      } catch { /* Unknown D1 outcome remains pending for the next bounded run. */ }
      results.push({id:job.id,status:'needs-check',errorCode:code});
    }
  }
  return {available:true,results};
}
