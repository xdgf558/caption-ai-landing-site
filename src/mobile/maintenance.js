import {configuration} from './security.js';
import {cleanup} from './sessions.js';
import {processDeletionOutbox} from './deletion.js';
export async function runMobileMaintenance(env) {
  if(env.MOBILE_AUTH_ENABLED!=='true')return;
  configuration(env);
  const db=env.WAITLIST_DB.withSession('first-primary'),now=Date.now();
  await cleanup(db,now);
  if(env.MOBILE_MUSIC_ENABLED==='true')await db.prepare('DELETE FROM mobile_playback_grants WHERE expires_at<=? OR revoked=1').bind(now).run();
  await processDeletionOutbox(db,now);
}
