import {configuration} from './security.js';
import {cleanup} from './sessions.js';
import {processDeletionOutbox} from './deletion.js';
import {verifyMobileBindings,mobileAccountDeletionEnabled} from './environment.js';
export async function runMobileMaintenance(env) {
  if(env.MOBILE_AUTH_ENABLED!=='true')return;
  const config=configuration(env);
  const {readerDb:db}=await verifyMobileBindings(env,config),now=Date.now();
  await cleanup(db,now);
  if(env.MOBILE_MUSIC_ENABLED==='true')await db.prepare('DELETE FROM mobile_playback_grants WHERE expires_at<=? OR revoked=1').bind(now).run();
  if(env.MOBILE_PERSONAL_SYNC_ENABLED==='true')await db.prepare('DELETE FROM mobile_music_recent WHERE played_at<=?').bind(now-90*86400000).run();
  if(mobileAccountDeletionEnabled(env,config))await processDeletionOutbox(db,now);
}
