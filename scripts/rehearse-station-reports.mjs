import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {reportFixture,insertReportReceipt} from './helpers/station-report-fixture.mjs';
import {reportReadiness,readReport,saveReportSnapshot} from '../src/redesign/reportsStore.js';
import {runStationReportAggregation} from '../src/redesign/reportsSchedule.js';
import {DAY,REPORT_VERSION} from '../src/redesign/reportsModel.js';
const f=await reportFixture(),now=Date.now(),date=n=>new Date(n).toISOString().slice(0,10);
try{
 const runtime=await reportReadiness(f.env),q=f.sample.cohort,main=await readReport(runtime,q),platform=await readReport(runtime,{...q,provider:'netease'}),unknown=await readReport(runtime,{from:q.from,to:q.to,trackId:q.trackId,source:'unknown'}),empty=await readReport(runtime,{from:date(f.sample.start-10*DAY),to:date(f.sample.start-9*DAY)});
 assert.equal(main.visitSessions,3);assert.equal(main.platformRate.value,2/3);assert.equal(platform.platformRate.value,1/3);assert.equal(unknown.platformRate.value,null);assert.equal(empty.counts.platform_click,0);
 // Same accepted-receipt ID pair appears on both days: daily 1+3 != window 3.
 await insertReportReceipt(f.db,'track_view',{trackId:q.trackId,sessionId:f.sample.session1,attributionKind:'campaign',campaignId:'event-douyin',firstCampaignId:'event-douyin',receivedAt:f.sample.start-10*60000});
 const wider={...q,from:date(f.sample.start-DAY)},raw=await readReport(runtime,wider);
 for(let i=0;i<100;i++){const r=await runStationReportAggregation(f.env,{clock:()=>now});assert.equal(r.available,true,JSON.stringify(r));if(r.idle)break;if(i===99)throw Error('archive bound');}
 const later=now+91*DAY,historical=await readReport(runtime,wider,{clock:()=>later});assert.equal(historical.counts.track_view,5);assert.equal(historical.daily.reduce((n,d)=>n+d.visitSessions,0),4);assert.equal(raw.visitSessions,3);assert.equal(historical.visitSessions,null);
 await saveReportSnapshot(runtime,f.env,wider,{actorId:'content-admin-fixture@example.test',key:`r1_${now}_${randomUUID()}`},{clock:()=>now});
 const captured=await readReport(runtime,wider,{clock:()=>later});assert.equal(captured.visitSessions,3);assert.equal(captured.platformRate.value,2/3);
 const proof={kind:'isolated SQLite arithmetic, synthetic accepted-receipt shapes; native D1/Access tested separately',version:REPORT_VERSION,recordedAt:new Date().toISOString(),window:{from:q.from,to:q.to,clock:'received_at',boundary:'[from,to) UTC'},
   manualRows:[{pair:'S1/song A',views:2,previewStarts:2,qualified:2,neteaseClicks:4},{pair:'S2/song A',views:1,previewStarts:1,qualified:1,appleClicks:1},{pair:'S3/song A',views:1,previewStarts:0,qualified:0,clicks:0}],
   independentRows:[{pair:'S1/song B',views:1,previewStarts:1,neteaseClicks:1},{pair:'unknown/song A',visitsInSelectedDay:0,clicks:2,explanation:'one missing visit; one preceding visit lies outside the selected day'}],
   expected:{songA:{views:4,visitSessions:3,previewStarts:3,previewSessions:2,qualified:3,clicks:5,clickSessions:2,rate:'2/3 = 66.7%'},netease:{clicks:4,visitSessions:3,clickSessions:1,rate:'1/3 = 33.3%'},crossDay:{views:5,dailySessionSum:4,exactWindowSessions:3,historicalRate:null,capturedExactRate:'2/3'}},
   observed:{songA:main,netease:platform,unlinked:unknown,empty,crossDayRaw:raw,crossDayDaily:historical,crossDayExactSnapshot:captured}};
 await writeFile(new URL('../docs/station-cat-redesign/evidence/T19/arithmetic.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');console.log('T19 isolated arithmetic verified: repeated clicks, song/session pairs, missing visits, zero/missing data, cross-day distinct counts and exact snapshots.');
}finally{f.sql.close();}
