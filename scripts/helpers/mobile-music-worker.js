// Local workerd tests only. No fixture path or injected clock is deployed.
import {handleMobile} from '../../src/mobile/http.js';
import {seedMusicRuntimeFixture} from './music-runtime-fixture.js';
export default {async fetch(request,env) {
 if(new URL(request.url).pathname==='/fixture/seed')return Response.json(await seedMusicRuntimeFixture(env.MUSIC_DB,await request.json()));
 let reads=0;
 const bucket={get:async(...args)=>{reads++;return env.MUSIC_BUCKET.get(...args);}};
 const disabled=request.headers.get('x-fixture-disabled');
 const runtime={...env,MUSIC_BUCKET:bucket,...(disabled?{[disabled]:'false'}:{})};
 const response=await handleMobile(request,runtime,{});
 response.headers.set('x-fixture-r2-reads',String(reads));return response;
}};
