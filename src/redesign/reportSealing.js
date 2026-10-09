import { rows } from '../music/adminStore.js';
import { fail } from '../music/adminValidation.js';

export const REPORT_SEAL_MIGRATION='0018_station_report_window_seals.sql';
export const EVENT_FLIGHT_MS=60000;
export async function pruneEventFlights(s,now){
  if(rows(await s.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='station_report_window_seal'").all()).length)
    rows(await s.prepare('DELETE FROM station_event_inflight WHERE expires_at<=? RETURNING token').bind(now).all());
}
// Register before any asynchronous dimension/media checks. The original receive
// time must still be open at the actual D1 transaction, not at a preceding read.
// T18-only databases keep collection working; reports require the new ledger.
export async function beginEventFlight(s,now){
  const present=rows(await s.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='station_report_window_seal'").all());
  if(!present.length)return null;
  const token=crypto.randomUUID(),result=await s.batch([
    s.prepare('DELETE FROM station_event_inflight WHERE expires_at<=?').bind(now),
    s.prepare('INSERT INTO station_event_inflight(token,received_at,expires_at) VALUES(?,?,?) RETURNING token').bind(token,now,now+EVENT_FLIGHT_MS)
  ]);result.forEach(rows);if(rows(result[1]).length!==1)fail('EVENT_WRITE_FENCED',503);return token;
}
// Both manual and scheduled capture seal *before* reading counts or the grain
// list. Pruning and the monotonic boundary update share one primary transaction.
// A pruned flight cannot later pass the writer's in-transaction token guard.
export async function sealReportWindow(s,end,now){
  if(!Number.isSafeInteger(end)||end%86400000!==0||end>now)fail('REPORT_SNAPSHOT_WINDOW_INVALID',422);
  const result=await s.batch([
    s.prepare('DELETE FROM station_event_inflight WHERE expires_at<=?').bind(now),
    s.prepare(`UPDATE station_report_window_seal SET sealed_before=MAX(sealed_before,?),updated_at=MAX(updated_at,?)
      WHERE singleton=1 AND (sealed_before>=? OR NOT EXISTS(SELECT 1 FROM station_event_inflight WHERE received_at<?)) RETURNING sealed_before`).bind(end,now,end,end)
  ]);result.forEach(rows);if(rows(result[1]).length!==1)fail('REPORT_WINDOW_DRAINING',409);
}
