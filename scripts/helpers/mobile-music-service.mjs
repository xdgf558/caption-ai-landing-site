// Test-only HTTP loopback -> workerd bridge; requires an ephemeral proof on every request.
// Never deploy. All credentials/audio/DB rows are synthetic and live only in this process.
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {setup,close,call,account,seed,db,music,seedFeaturedFixture} from './mobile-music-fixture.mjs';
const directory=process.argv[2],key=randomBytes(32).toString('base64url');
await setup();const a=await account(),track=await seed();const requests=[];
const server=createServer(async(req,res)=>{
 try {
  if(req.headers['x-probe-key']!==key){res.writeHead(403).end();return;}
  if(req.url==='/fixture/bootstrap'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({accountId:String(a.id),sessionId:a.sid,token:a.token,trackId:track.id}));return;}
  if(req.url==='/fixture/featured'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await seedFeaturedFixture()));return;}
  if(req.url==='/fixture/featured-clear'){await music.prepare('DELETE FROM music_featured_items').run();res.end('{}');return;}
  if(req.url==='/fixture/revoke'){await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE id=?').bind(a.sid).run();res.end('{}');return;}
  if(req.url==='/fixture/evidence'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return;}
  let bytes=0,body='';for await(const b of req){bytes+=b.length;if(bytes>8192)throw Error('large body');body+=b;}
  const response=await call('https://native.local.test'+req.url,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([k])=>['authorization','range','if-range'].includes(k))),...(body?{body:JSON.parse(body)}:{})});
  requests.push({method:req.method,range:req.headers.range||null,bearerMatched:req.headers.authorization==='Bearer '+a.token,status:response.status,r2Reads:Number(response.headers.get('x-fixture-r2-reads'))});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(503).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
writeFileSync(directory+'/ready.json',JSON.stringify({port:server.address().port,key}));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{server.close();await close();process.exit(0);});
