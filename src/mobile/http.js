import {MobileError,configuration,requireValue,validID,validSecret,randomSecret,hash,readBody,exactKeys,iso,assertChanged,clearAssert} from './security.js';
import {handleNativeMusic,nativeMusicEnabled} from './music.js';
import {principal,exchange,refresh} from './sessions.js';
import {prepareDeletion,confirmDeletion,deletionStatus} from './deletion.js';

const headers={'Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const response=(data,now,status=200)=>Response.json({data,requestId:crypto.randomUUID(),serverNow:iso(now)},{status,headers});
const cookieName='__Host-station-native-flow';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy={
 'zh-Hans':['登录音乐小站','使用现有 Station Cat 账号','用户名或邮箱','密码','二步验证码（已绑定时必填）','继续登录','注册账号','找回密码','返回登录','账号操作已处理，请返回登录。'],
 'zh-Hant':['登入音樂小站','使用現有 Station Cat 帳號','使用者名稱或電子郵件','密碼','兩步驗證碼（已綁定時必填）','繼續登入','註冊帳號','找回密碼','返回登入','帳號操作已處理，請返回登入。'],
 en:['Sign in to Station Cat Music','Use your existing Station Cat account','Username or email','Password','Two-step code (required if enabled)','Continue','Create account','Reset password','Back to sign in','Request processed. Return to sign in.'],
 ja:['Station Cat Music にログイン','既存の Station Cat アカウントを使用','ユーザー名またはメール','パスワード','2 段階認証コード（設定済みの場合必須）','続行','アカウント作成','パスワードをリセット','ログインに戻る','リクエストを処理しました。ログインに戻ってください。']};
function page(flow,locale='en',message='',support='') {
  locale=Object.hasOwn(copy,locale)?locale:'en';
  const c=copy[locale];
  const hidden=`<input type="hidden" name="flow" value="${escape(flow)}"><input type="hidden" name="locale" value="${escape(locale)}">`;
  const field=(name,label,type='text')=>`<label>${label}<input name="${name}" type="${type}" maxlength="254" ${name==='totpCode'?'inputmode="numeric" autocomplete="one-time-code"':`required autocomplete="${type==='password'?(support?'new-password':'current-password'):'username'}"`}></label>`;
  const form=support==='register'?field('username',c[2])+field('email','Email','email')+field('password',c[3],'password'):
    support==='reset'?field('identifier',c[2])+field('totpCode',c[4])+field('password',c[3],'password'):field('identifier',c[2])+field('password',c[3],'password')+field('totpCode',c[4]);
  return `<!doctype html><html lang="${escape(locale)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c[0]}</title>
  <style>html{color-scheme:dark;font-family:system-ui;background:#10191f;color:#f5efe5}body{max-width:28rem;margin:8vh auto;padding:24px}h1{font-size:1.8rem}label{display:block;margin:20px 0}input{display:block;box-sizing:border-box;width:100%;padding:14px;background:#1e2a32;color:inherit;border:1px solid #617079;border-radius:10px}button,a{min-height:44px}button{padding:14px 24px;border:0;border-radius:24px;background:#f5c979;color:#151719;font-weight:600}a{color:#f5c979;display:inline-block;margin:20px 20px 0 0}p{line-height:1.6}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #f5c979;outline-offset:3px}</style>
  <h1>${c[0]}</h1><p>${c[1]}</p>${message?`<p role="alert">${escape(message)}</p>`:''}
  <form method="post" action="/auth/mobile/${support||'authorize'}">${hidden}${form}<button>${support==='register'?c[6]:support==='reset'?c[7]:c[5]}</button></form>
  ${support?`<a href="/auth/mobile/sign-in?flow=${escape(flow)}&locale=${escape(locale)}">${c[8]}</a>`:
    `<a href="/auth/mobile/register?flow=${escape(flow)}&locale=${escape(locale)}">${c[6]}</a><a href="/auth/mobile/reset?flow=${escape(flow)}&locale=${escape(locale)}">${c[7]}</a>`}</html>`;
}
function html(body,status=200,extra={}) {return new Response(body,{status,headers:{...headers,'Content-Type':'text/html;charset=utf-8',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...extra}});}
async function limit(db,key,now,max=30) {
  const window=Math.floor(now/60_000);
  const r=await db.prepare(`INSERT INTO mobile_rate_limits(key,window,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN mobile_rate_limits.window=excluded.window THEN mobile_rate_limits.count+1 ELSE 1 END RETURNING count`).bind(await hash(key),window).first();
  requireValue(r.count<=max,'RATE_LIMITED',429);
}
async function browserFlow(db,request,id,now) {
  const cookie=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  requireValue(validID(id) && validSecret(cookie),'AUTH_REQUIRED',401);
  const row=await db.prepare('SELECT * FROM mobile_browser_flows WHERE id=? AND cookie_hash=? AND expires_at>? AND used=0').bind(id,await hash(cookie),now).first();
  requireValue(row,'AUTH_REQUIRED',401);return row;
}
export const isMobilePath=path=>path.startsWith('/api/mobile/')||path.startsWith('/auth/mobile/');
export async function handleMobile(request,env,identity) {
  const now=Date.now(),url=new URL(request.url);
  try {
    const config=configuration(env);requireValue(url.origin===config.origin,'ACCESS_DENIED',403);
    // Primary-first session for all related reads/batches; no stale replica can replay a revoked session.
    const db=env.WAITLIST_DB.withSession('first-primary');
    const path=url.pathname;
    const mediaRequest=/^\/api\/mobile\/v1\/music\/media\//.test(path);
    const grantRequest=path.endsWith('/playback-grants');
    await limit(db,(mediaRequest?'audio:':grantRequest?'grant:':'ip:')+String(request.headers.get('cf-connecting-ip')||'missing'),now,mediaRequest?600:grantRequest?30:120);
    if(path==='/api/mobile/v1/config' && request.method==='GET')return response({apiVersion:'1',minimumAppVersion:'0.1.0',storeUrl:null,
      capabilities:{musicCatalog:nativeMusicEnabled(env),nativeAuthentication:true,musicPlayback:nativeMusicEnabled(env),personalSync:false,accountDeletion:true,musicPurchases:false}},now);
    if(path.startsWith('/api/mobile/v1/music/') || path==='/api/mobile/v1/me/entitlements')return await handleNativeMusic(request,env,db,config);
    if(path==='/auth/mobile/callback' && request.method==='GET')return html('<!doctype html><meta charset="utf-8"><p>Return to Station Cat Music.</p>');
    if(path==='/auth/mobile/authorize' && request.method==='GET') {
      const p=Object.fromEntries(url.searchParams);requireValue([...url.searchParams].length===Object.keys(p).length);
      requireValue(p.client_id==='station-cat-ios' && p.redirect_uri===config.redirect && p.code_challenge_method==='S256' && validSecret(p.code_challenge) && validSecret(p.state));
      await limit(db,'browser:'+String(request.headers.get('cf-connecting-ip')||'missing'),now,20);
      const flow=crypto.randomUUID(),cookie=randomSecret();
      await db.prepare('INSERT INTO mobile_browser_flows(id,cookie_hash,challenge,state,redirect_uri,expires_at) VALUES(?,?,?,?,?,?)')
        .bind(flow,await hash(cookie),p.code_challenge,p.state,config.redirect,now+600_000).run();
      return html(page(flow,p.locale),200,{'Set-Cookie':`${cookieName}=${cookie}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`});
    }
    if(['/auth/mobile/register','/auth/mobile/reset','/auth/mobile/sign-in'].includes(path) && request.method==='GET') {
      const flow=await browserFlow(db,request,url.searchParams.get('flow'),now);
      return html(page(flow.id,url.searchParams.get('locale'),'',path.endsWith('/sign-in')?'':path.split('/').at(-1)));
    }
    if(path.startsWith('/auth/mobile/') && request.method==='POST') {
      requireValue(request.headers.get('origin')===config.origin,'ACCESS_DENIED',403);
      const body=await readBody(request,true), flow=await browserFlow(db,request,body.flow,now);
      await limit(db,'credential:'+String(body.identifier||body.email||'').toLowerCase(),now,5);
      if(path==='/auth/mobile/register' || path==='/auth/mobile/reset') {
        const handler=path.endsWith('/register')?identity.register:identity.reset;
        requireValue(handler,'SERVICE_UNAVAILABLE',503);
        const result=await handler(new Request(request.url,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':request.headers.get('cf-connecting-ip')||''},body:JSON.stringify(path.endsWith('/register')?{username:body.username,email:body.email,password:body.password}:{identifier:body.identifier,password:body.password,totpCode:body.totpCode})}),env);
        return html(page(flow.id,body.locale,result.ok?(copy[body.locale]||copy.en)[9]:'Unable to complete this request. Please check your details.',path.split('/').at(-1)),result.ok?200:400);
      }
      requireValue(path==='/auth/mobile/authorize');
      const account=await identity.verify(env,body);
      if(!account)return html(page(flow.id,body.locale,'Sign-in failed. Check your password and two-step code.'),401);
      const secret=randomSecret();
      await db.batch([
        db.prepare('UPDATE mobile_browser_flows SET used=1 WHERE id=? AND used=0 AND expires_at>?').bind(flow.id,now),assertChanged(db),
        db.prepare(`INSERT INTO mobile_codes(hash,account_id,challenge,redirect_uri,password_version,totp_version,authenticated_at,expires_at)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM reader_accounts a JOIN reader_password_credentials p ON p.account_id=a.id
            WHERE a.id=? AND a.status='active' AND p.password_hash=?)`)
          .bind(await hash(secret),account.id,flow.challenge,flow.redirect_uri,account.passwordVersion,account.totpVersion,now,now+90_000,account.id,account.passwordVersion),assertChanged(db),clearAssert(db)
      ]);
      const redirect=new URL(flow.redirect_uri);redirect.searchParams.set('code',secret);redirect.searchParams.set('state',flow.state);
      return new Response(null,{status:302,headers:{...headers,Location:redirect.href,'Set-Cookie':`${cookieName}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`}});
    }
    const prefix='/api/mobile/v1';
    if(path===prefix+'/auth/token' && request.method==='POST')return response(await exchange(db,await readBody(request),config,now),now);
    if(path===prefix+'/auth/refresh' && request.method==='POST')return response(await refresh(db,await readBody(request),config,now),now);
    if(path===prefix+'/auth/logout' && request.method==='POST' && !request.headers.has('authorization')) {
      // Revocation-only proof: never creates a principal or returns credentials. A spent
      // refresh token can revoke its own stable family after a concurrent rotation.
      const body=await readBody(request);exactKeys(body,['refreshToken']);requireValue(validSecret(body.refreshToken));
      await db.prepare(`UPDATE mobile_sessions SET revoked=1 WHERE family_id IN
        (SELECT family_id FROM mobile_refresh_tokens WHERE hash=?)`).bind(await hash(body.refreshToken)).run();
      return response({accepted:true},now); // Unknown/revoked tokens are indistinguishable.
    }
    const status=/^\/api\/mobile\/v1\/deletion-requests\/([^/]+)\/status$/.exec(path);
    if(status && request.method==='GET')return response(await deletionStatus(db,request,status[1],now),now);
    const s=await principal(db,request,now);
    if(path===prefix+'/me' && request.method==='GET')return response({accountId:String(s.account_id),displayName:s.display_name||'Station Cat',status:'active'},now);
    if(path===prefix+'/auth/logout' && request.method==='POST') {
      await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE id=?').bind(s.id).run();return response({accepted:true},now);
    }
    if(path===prefix+'/auth/reauth' && request.method==='POST') {
      const body=await readBody(request);exactKeys(body,['password','totpCode']);await limit(db,'reauth:'+s.account_id,now,5);
      const account=await identity.verify(env,body,s.account_id);requireValue(account,'AUTH_REQUIRED',401);
      const result=await db.prepare(`UPDATE mobile_sessions SET recent_auth_at=?,recent_auth_totp_version=? WHERE id=? AND revoked=0 AND access_until>?
        AND password_version=? AND EXISTS(SELECT 1 FROM reader_accounts WHERE id=mobile_sessions.account_id AND status='active')`)
        .bind(now,account.totpVersion,s.id,now,account.passwordVersion).run();requireValue(result.meta.changes===1,'SESSION_REVOKED',401);
      return response({validUntil:iso(now+300_000)},now);
    }
    if(path===prefix+'/me/deletion-requests/prepare' && request.method==='POST')return response(await prepareDeletion(db,s,await readBody(request),request.headers.get('idempotency-key'),now),now);
    const confirm=/^\/api\/mobile\/v1\/me\/deletion-requests\/([^/]+)\/confirm$/.exec(path);
    if(confirm && request.method==='POST')return response(await confirmDeletion(db,s,confirm[1],await readBody(request),request.headers.get('idempotency-key'),now),now,202);
    throw new MobileError('INVALID_REQUEST',404);
  } catch(error) {
    const expected=error instanceof MobileError, code=expected?error.code:'SERVICE_UNAVAILABLE',status=expected?error.status:503;
    return Response.json({error:{code,retryable:status===503||status===429,messageKey:'error.'+code.toLowerCase(),...(status===429?{retryAfterSeconds:60}:{})},requestId:crypto.randomUUID(),serverNow:iso(now)},
      {status,headers:{...headers,...(status===429?{'Retry-After':'60'}:{})}});
  }
}
