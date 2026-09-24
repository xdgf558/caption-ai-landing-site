// Dedicated R2 entry. Never deploy the website Worker or local /fixture helpers here.
import {handleMobile, isMobilePath} from './http.js';
import {verifyMobileReaderIdentity} from '../worker.js';
import {handleMusicPublic} from '../music/publicHttp.js';
import {runMobileMaintenance} from './maintenance.js';

const isolatedOrigin = 'https://station-cat-music-r2.yehao1105.workers.dev';
const isolatedAppID = '2AM5S7BM2N.org.stationcat.music.staging';
const noStore = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex'};
const enabled = env => env.MOBILE_ENVIRONMENT === 'isolated' && env.MOBILE_AUTH_ORIGIN === isolatedOrigin &&
  env.MOBILE_REDIRECT_URI === isolatedOrigin + '/auth/mobile/callback' && env.MOBILE_AUTH_ENABLED === 'true';
const missing = () => new Response('Not found', {status:404,headers:noStore});
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== isolatedOrigin) return missing();
    if (!enabled(env)) return new Response('Isolated service unavailable', {status:503,headers:noStore});
    if (url.pathname === '/.well-known/apple-app-site-association' && ['GET','HEAD'].includes(request.method) && !url.search) {
      const body = JSON.stringify({applinks:{details:[{appIDs:[isolatedAppID],components:[{'/':'/music/'},{'/':'/auth/mobile/callback'}]}]},webcredentials:{apps:[isolatedAppID]}});
      return new Response(request.method === 'HEAD' ? null : body, {headers:{...noStore,'Content-Type':'application/json','Cache-Control':'public, max-age=300'}});
    }
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({environment:'isolated',purchases:false},{headers:noStore});
    // R2 accounts are provisioned offline. No public signup, reset, admin, payment or fixture routes.
    if (/^\/auth\/mobile\/(register|reset)$/.test(url.pathname)) return missing();
    if (isMobilePath(url.pathname)) {
      const result = await handleMobile(request,env,{verify:verifyMobileReaderIdentity});
      if (!result.headers.get('Content-Type')?.startsWith('text/html')) return result;
      return new HTMLRewriter()
        .on('h1', {element(e){e.after('<p role="note">隔离测试环境 · Test accounts only. 请勿输入正式网站账号密码。</p>',{html:true});}})
        .on('a[href^="/auth/mobile/register"], a[href^="/auth/mobile/reset"]',{element(e){e.remove();}})
        .transform(result);
    }
    if (/^\/api\/music\/(tracks|collections)\/[A-Za-z0-9_-]+\/cover$/.test(url.pathname) && ['GET','HEAD'].includes(request.method)) {
      const result = await handleMusicPublic(request,env);
      // The public handler has checked live publication, exact version, object
      // identity and the artwork limiter. Only small, public versioned images
      // may be reused locally for five minutes; auth/audio/errors stay no-store.
      if (result.status !== 200 || !result.headers.get('Content-Type')?.startsWith('image/') ||
          result.headers.has('Set-Cookie') || result.headers.has('Vary') ||
          !/^[1-9][0-9]*$/.test(url.searchParams.get('v') || '') ||
          !(Number(result.headers.get('Content-Length')) > 0 && Number(result.headers.get('Content-Length')) <= 2097152)) return result;
      const headers = new Headers(result.headers);
      headers.set('Cache-Control','public, max-age=300');
      headers.set('CDN-Cache-Control','no-store');
      headers.set('Cloudflare-CDN-Cache-Control','no-store');
      headers.set('Date',new Date().toUTCString());
      return new Response(result.body,{status:result.status,headers});
    }
    if (url.pathname === '/music/' && request.method === 'GET') return new Response('Station Cat Music — isolated test link. Open this link on the device with Station Cat Music Staging installed.',{headers:{...noStore,'Content-Type':'text/plain;charset=utf-8'}});
    return missing();
  },
  async scheduled(_event, env) { if (enabled(env)) await runMobileMaintenance(env); }
};
