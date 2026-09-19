// Test-only HTTP loopback -> workerd bridge; requires an ephemeral proof on every request.
// Never deploy. All credentials/audio/DB rows are synthetic and live only in this process.
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {setup,close,call,account,seed,db,music,seedFeaturedFixture,rotationAccount} from './mobile-music-fixture.mjs';
const directory=process.argv[2],key=randomBytes(32).toString('base64url');
await setup();const a=await account(),track=await seed();const requests=[];
// Prepare heavy R2/featured fixtures before announcing readiness, not inside a five-second product request.
const featured=await seedFeaturedFixture();let stabilityAccount=await account();
const longVip=await seed('vip',null,null,true),longFree=await seed('free',null,null,true);
const identity=(t,who=stabilityAccount)=>({accountId:String(who.id),sessionId:who.sid,token:who.token,trackId:t.id,durationSeconds:t.audio.duration_ms/1000});
let rotation=null;
let serial=0;const grantIDs=new Map();
const server=createServer(async(req,res)=>{
 try {
  if(req.headers['x-probe-key']!==key){res.writeHead(403).end();return;}
  if(req.url==='/fixture/rotation'){rotation=await rotationAccount();res.end(JSON.stringify({credential:rotation,trackId:longVip.id,durationSeconds:longVip.audio.duration_ms/1000}));return;}
  if(req.url==='/fixture/rotation-evidence'){
   if(!rotation){res.writeHead(404).end();return;}
   const session=await db.prepare('SELECT generation,revoked,absolute_until FROM mobile_sessions WHERE id=?').bind(rotation.sessionID).first();
   const operations=await db.prepare('SELECT old_generation FROM mobile_refresh_operations WHERE family_id=? ORDER BY old_generation').bind(rotation.familyID).all();
   res.end(JSON.stringify({generation:session.generation,revoked:session.revoked,absoluteUntil:session.absolute_until,operations:operations.results.map(x=>x.old_generation)}));return;
  }
  if(req.url==='/fixture/bootstrap'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({accountId:String(a.id),sessionId:a.sid,token:a.token,trackId:track.id}));return;}
  if(req.url==='/fixture/featured'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(featured));return;}
  if(req.url==='/fixture/featured-clear'){await music.prepare('DELETE FROM music_featured_items').run();res.end('{}');return;}
  if(req.url==='/fixture/stability'){stabilityAccount=await account();res.end(JSON.stringify({vip:identity(longVip),free:identity(longFree)}));return;}
  if(req.url==='/fixture/stability/limited'){const t=await seed('vip',Date.now()+12000,null,true);res.end(JSON.stringify(identity(t,await account(false))));return;}
  if(req.url==='/fixture/stability/expiry'){await db.prepare('UPDATE reader_memberships SET expires_at=? WHERE account_id=?').bind(new Date(Date.now()+10000).toISOString(),stabilityAccount.id).run();res.end('{}');return;}
  if(req.url==='/fixture/stability/revoke'){await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE id=?').bind(stabilityAccount.sid).run();res.end('{}');return;}
  if(req.url==='/fixture/revoke'){await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE id=?').bind(a.sid).run();res.end('{}');return;}
  if(req.url==='/fixture/evidence'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return;}
  let bytes=0,body='';for await(const b of req){bytes+=b.length;if(bytes>8192)throw Error('large body');body+=b;}
  const response=await call('https://native.local.test'+req.url,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>['authorization','range','if-range'].includes(k))),...(body?{body:JSON.parse(body)}:{})});
  // Opaque local serials identify renewals without logging URLs or bearer/grant secrets.
  const media=/\/music\/media\/([^/]+)\/audio/.exec(req.url), fingerprint=media?createHash('sha256').update(media[1]).digest('hex'):null;
  if(fingerprint&&!grantIDs.has(fingerprint))grantIDs.set(fingerprint,++serial);
  requests.push({method:req.method,range:req.headers.range||null,bearerMatched:[a.token,stabilityAccount.token].some(token=>req.headers.authorization==='Bearer '+token),status:response.status,r2Reads:Number(response.headers.get('x-fixture-r2-reads')),grantSerial:fingerprint?grantIDs.get(fingerprint):null,at:Date.now()});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
writeFileSync(directory+'/ready.json',JSON.stringify({port:server.address().port,key}));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{server.close();await close();process.exit(0);});
