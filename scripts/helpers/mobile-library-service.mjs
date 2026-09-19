// Isolated M5 test bridge only. Ephemeral proof, random loopback port, synthetic accounts.
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {setup,close,call,seed,rotationAccount,db} from './mobile-music-fixture.mjs';
const directory=process.argv[2],key=randomBytes(32).toString('base64url');
await setup({personalSync:true});
const first=await rotationAccount(),second=await rotationAccount(Number(first.scope.accountID)),other=await rotationAccount(),track=await seed('free',null,null,true),anotherTrack=await seed('free');
const server=createServer(async(req,res)=>{
 try {
  if(req.headers['x-probe-key']!==key){res.writeHead(403).end();return;}
  if(req.url==='/fixture/bootstrap'){res.end(JSON.stringify({first,second,other,trackId:track.id,anotherTrackId:anotherTrack.id,durationSeconds:track.audio.duration_ms/1000}));return;}
  if(req.url==='/fixture/evidence'){
   const counts={};for(const name of ['favorites','recent','operations'])counts[name]=(await db.prepare(`SELECT count(*) n FROM mobile_music_${name} WHERE account_id=?`).bind(Number(first.scope.accountID)).first()).n;
   res.end(JSON.stringify(counts));return;
  }
  let bytes=0,body='';for await(const part of req){bytes+=part.length;if(bytes>8192)throw Error('large body');body+=part;}
  const result=await call('https://native.local.test'+req.url,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>['authorization','range','if-range'].includes(k))),...(body?{body:JSON.parse(body)}:{})});
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
 }catch{res.writeHead(503).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
writeFileSync(directory+'/ready.json',JSON.stringify({port:server.address().port,key}));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{server.close();await close();process.exit(0);});
