// Local-only visual fixture. No production account or payment calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('dist'), port=Number(process.env.PREVIEW_PORT||4397);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const packs=[{id:'preview-pack',key:'preview-pack',label:'Station Points',credits:100,priceAmount:10,priceCurrency:'USD'}];
createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname==='/__preview'){const state=['member','empty','expired','closed'].includes(url.searchParams.get('state'))?url.searchParams.get('state'):'guest';res.writeHead(302,{'set-cookie':`preview_state=${state}; Path=/; SameSite=Lax`,location:`/${['zh-hant','zh-hans','en','ja'].includes(url.searchParams.get('lang'))?url.searchParams.get('lang'):'zh-hant'}/library/`});res.end();return;}
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET'){res.writeHead(405,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'Local preview is read-only'}));return;}
  if(['/api/content/entries','/api/content/media'].includes(url.pathname)){
   const response=await fetch('https://wwwstationcat.org'+url.pathname+url.search);res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const state=req.headers.cookie?.match(/preview_state=(\w+)/)?.[1]||'guest';const authenticated=state!=='guest';
  const payload={ok:true,authenticated,account:{id:900001,username:'Night Reader',email:'reader@example.test',balanceCredits:90,createdAt:'2026-06-19T09:42:00Z'},membership:{active:state!=='expired',expiresAt:'2027-01-10T00:00:00Z',level:'member'},membershipSettings:{enabled:true,membershipCreditCost:10,membershipDurationMonths:1,membershipCoversPaidContent:true},chapterCostCredits:1,packs,checkoutEnabled:state!=='closed',publicCheckoutEnabled:state!=='closed',readerCredits:{enabled:true,packs},totp:{enabled:state!=='empty'},entitlements:state==='empty'?[]:[{scope:'series',seriesSlug:'离线未来',accessLevel:'all',source:'manual',grantedAt:'2026-09-15'}],bookmarks:state==='empty'?[]:[{id:1,seriesSlug:'cmqjfju1300008z3wyh66ynvw',seriesTitle:'离线未来',chapterSlug:'chap-offline-future-001',chapterTitle:'1999年的风扇声',progressPercent:42,updatedAt:'2026-09-15T08:00:00Z'}],ledger:state==='empty'?[]:[{creditsDelta:100,note:'Local preview · Station Points',createdAt:'2026-09-15T08:00:00Z',entryType:'purchase'},{creditsDelta:-10,note:'Local preview · VIP',createdAt:'2026-09-15T09:00:00Z',entryType:'redemption'}]};
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(payload));return;
 }
 const file=resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));if(!file.startsWith(root+sep))throw Error('path');
 const bytes=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'});res.end(bytes);
}catch(error){res.writeHead(404);res.end('Local preview unavailable');}}).listen(port,'127.0.0.1',()=>console.log(`Local preview: http://127.0.0.1:${port}/novel/ | /__preview?state=member`));
