import {configuration} from './security.js';
import {PRODUCTION_MOBILE_PROFILE, verifyMobileBindings} from './environment.js';

export const productionAssociationPath = '/.well-known/apple-app-site-association';
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};

// The main website serves this only after the separately approved native
// production profile and resource identities are ready. R2 retains its own AASA.
export async function productionAssociation(request, env) {
  const url = new URL(request.url);
  if (url.origin !== PRODUCTION_MOBILE_PROFILE.origin || url.pathname !== productionAssociationPath || url.search) {
    return new Response('Not found', {status:404,headers});
  }
  if (!['GET','HEAD'].includes(request.method)) return new Response(null, {status:405,headers:{...headers,Allow:'GET, HEAD'}});
  try {
    const config = configuration(env);
    if (config.environment !== 'production') return new Response('Not found', {status:404,headers});
    await verifyMobileBindings(env,config);
    const appID = PRODUCTION_MOBILE_PROFILE.appID;
    const body = JSON.stringify({
      applinks:{details:[{appIDs:[appID],components:[{'/':'/music/'},{'/':'/auth/mobile/callback'}]}]},
      webcredentials:{apps:[appID]}
    });
    return new Response(request.method === 'HEAD' ? null : body, {headers:{...headers,'Content-Type':'application/json'}});
  } catch {
    // No public response contains binding identities, credentials or diagnostics.
    return new Response('Native service unavailable', {status:503,headers});
  }
}
