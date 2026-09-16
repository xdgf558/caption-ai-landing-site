import {configuration} from './security.js';
import {cleanup} from './sessions.js';
import {processDeletionOutbox} from './deletion.js';
export async function runMobileMaintenance(env) {
  if(env.MOBILE_AUTH_ENABLED!=='true')return;
  configuration(env);
  const db=env.WAITLIST_DB.withSession('first-primary'),now=Date.now();
  await cleanup(db,now);
  await processDeletionOutbox(db,now);
}
