import { contentRequest, createContentController } from './stationContentClient.js';
import { createReportLoader, reportNumber, rateText, sourceName, providerNames, reportTimestamp } from './stationReportsClient.js';

const $=id=>document.getElementById(id),set=(id,text)=>{$(id).textContent=text;};
let journalStorage;try{journalStorage=window.localStorage;}catch{journalStorage={getItem(){throw Error('storage');},setItem(){throw Error('storage');}};}
const controller=createContentController({storage:journalStorage,scope:'reports'});
let status=null,options=null,current=null,query=null,selected=null,writing=false,importDirty=false;
const utc=n=>new Date(n).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
const day=n=>new Date(n).toISOString().slice(0,10),local=n=>new Date(n).toISOString().slice(0,19);
function message(text,error=false){set('report-status',text);$('report-status').dataset.error=String(error);}
const messages={STATION_REPORTS_DISABLED:'推广报表尚未启用。',STATION_JOURNAL_UNAVAILABLE:'本机恢复记录不可用，写入已停止，请先核对原操作。',REPORT_SCHEMA_UNAVAILABLE:'报表数据库尚未准备好，请先核对迁移账本。',REPORT_RETENTION_UNREADY:'报表留存任务未就绪，已停止写入。',REPORT_WINDOW_INVALID:'请选择 12 个月内、最长 31 天的有效时间窗。',REPORT_EVENT_BUDGET:'此范围的记录超出安全查询预算，请缩短时间窗。',REPORT_DIMENSION_INVALID:'所选歌曲与资料不匹配，请调整筛选。',REPORT_EXTERNAL_BUDGET:'外部记录较多，请缩小歌曲或时间范围。',REPORT_OPTION_BUDGET:'筛选资料超出预算，请管理员核对。',REPORT_EDIT_CONFLICT:'记录版本已变化，请重新读取后修订。',REPORT_OPERATION_EXPIRED:'原操作的重试期限已过，请先人工核对登记结果。',REPORT_OPERATION_CLOCK_INVALID:'本机时间与服务器时间不一致，请校准后重新核对。',STATION_ACTOR_CHANGED:'管理员已变化，已清空当前报表，请重新载入。',STATION_PUBLISHER_REQUIRED:'当前角色只能查看报表。',INVALID_INPUT:'请核对日期、来源和数据格式。',ADMIN_AUTH_REQUIRED:'请先通过后台访问验证。'};
function failure(e){if(e.code==='STATION_ACTOR_CHANGED'){status=null;current=null;clear();$('report-filter-fields').disabled=true;}message(messages[e.code]??(e.uncertain?'操作结果尚未确认，保留原操作编号后核对。':'报表暂时无法读取，请重新核对。'),true);}
function canWrite(){return status?.role==='publisher'&&status.retentionEnabled&&status.health.retentionReady&&!writing&&!controller.pending();}
function controls(){
  $('report-recovery').hidden=!controller.pending();$('report-retry').disabled=writing;
  $('report-import').hidden=status?.role!=='publisher';$('report-import-fields').disabled=!canWrite();
  $('report-save-snapshot').disabled=!(canWrite()&&status.aggregationEnabled&&current?.available&&!current.partial&&current.basis==='live');
}
function clear(){
  $('report-result').hidden=true;$('report-external').hidden=true;
  for(const el of document.querySelectorAll('[data-metric]'))el.textContent='暂无数据';
  set('report-preview-rate','暂无数据');set('report-platform-rate','暂无数据');$('report-daily-rows').replaceChildren();$('report-external-records').replaceChildren();
}
function select(id,items,{empty=true,label=x=>x.label??x.id}={}){
  const element=$(id),old=element.value,first=empty?element.options[0]?.textContent:null;element.replaceChildren();
  if(empty)element.add(new Option(first??'不限定',''));for(const item of items)element.add(new Option(label(item),item.id));
  if([...element.options].some(o=>o.value===old))element.value=old;
}
function populate(){
  select('report-track',options.tracks);select('external-track',options.tracks);
  select('report-source',options.sources.map(id=>({id,label:sourceName(id)})));
  for(const id of ['report-campaign','external-campaign'])select(id,options.campaigns,{label:c=>c.id+' · '+c.source});
  for(const id of ['report-clip','external-clip'])select(id,options.clips,{label:c=>'短片 · '+c.id.slice(0,8)});
  platformChoices();
}
function platformChoices(){const play=$('external-metric').value==='platform_plays';select('external-provider',Object.entries(providerNames).filter(([id])=>!play||['netease','qishui','apple_music','spotify','youtube'].includes(id)).map(([id,label])=>({id,label})),{empty:false});}
function filters(){const q={from:$('report-from').value,to:$('report-to').value};for(const [key,id]of [['trackId','report-track'],['source','report-source'],['campaignId','report-campaign'],['clipId','report-clip'],['provider','report-provider']])if($(id).value)q[key]=$(id).value;return q;}
const rateReasons={NO_DATA:'没有完整报表数据',HISTORICAL_DISTINCT_UNAVAILABLE:'跨日历史会话未保留完整去重关联',NO_VISIT_SESSIONS:'没有所选范围内的访问会话',UNLINKED_EVENTS:'存在未关联访问的事件'};
function denominator(rate){const detail=`已关联会话 ${reportNumber(rate.numerator)} / 访问会话 ${reportNumber(rate.denominator)}；未关联次数 ${reportNumber(rate.unlinked)}`;return detail+(rate.reason?'。'+rateReasons[rate.reason]+'，不计算转化率。':'。重复操作只计一次会话转化。');}
function render(report){
  current=report;
  for(const el of document.querySelectorAll('[data-metric]'))el.textContent=reportNumber(el.dataset.metric==='game_ready'?report.gameReady:report.counts[el.dataset.metric]);
  set('report-preview-rate',rateText(report.previewRate));set('report-platform-rate',rateText(report.platformRate));
  set('report-preview-denominator',denominator(report.previewRate));set('report-platform-denominator',denominator(report.platformRate));
  set('report-window',day(report.from)+' → '+day(report.to)+'（结束日期不含） · '+(report.partial?'截至 '+utc(report.asOf):'UTC')+' · '+({live:'原始记录聚合',snapshot:'精确聚合快照',daily:'每日历史聚合',missing:'缺少完整聚合'}[report.basis]));
  set('report-quality',(report.available?'仅覆盖同意统计且成功采集的记录。':'所选历史时间窗缺少完整聚合，暂无数据。')+' 内存会话事件 '+reportNumber(report.memoryEvents)+'，时间异常事件 '+reportNumber(report.timeAnomalies)+'。'+(report.health.retentionReady?' 留存健康已核对。':' 留存健康待核对，写入停止。')+(report.gameReady===null?' 尚无运行端就绪确认。':''));
  $('report-daily').hidden=!report.daily.length;$('report-daily-rows').replaceChildren();
  for(const row of report.daily){const tr=document.createElement('tr');for(const value of [day(row.from),reportNumber(row.counts.track_view),reportNumber(row.counts.platform_click),rateText(row.previewRate),rateText(row.platformRate)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('report-daily-rows').append(tr);}
  $('report-result').hidden=false;renderExternal(report.external);$('report-external').hidden=false;controls();
}
function renderExternal(records){
  const list=$('report-external-records');list.replaceChildren();
  if(!records.length){const empty=document.createElement('div');empty.className='music-panel report-external-empty';empty.textContent='暂无数据 · 尚未登记此范围内的平台曝光或播放量。';list.append(empty);return;}
  for(const r of records){
    const card=document.createElement('article');card.className='music-panel report-external-record';const h=document.createElement('h3');h.textContent=(providerNames[r.provider]??r.provider)+' · '+(r.metric==='platform_plays'?'平台播放量':'平台曝光量')+(r.status==='withdrawn'?' · 已撤回':'');
    const value=document.createElement('p');value.className='report-value';value.textContent=reportNumber(r.value);const dl=document.createElement('dl');
    const track=options.tracks.find(t=>t.id===r.trackId)?.label??r.trackId;
    for(const [label,text]of [['所属歌曲',track],['数据来源',(r.sourceKind==='platform_export'?'平台导出':'平台后台')+' · '+r.sourceLabel],['统计时间',utc(r.from)+' → '+utc(r.to)],['数据截至',utc(r.observedAt)],['登记更新',utc(r.updatedAt)],['关联资料',r.campaignId??'未限定 Campaign']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text;dl.append(dt,dd);}
    const note=document.createElement('p');note.className='notice';note.textContent=r.status==='withdrawn'?'记录已撤回，保留修订状态供核对。':r.aligned?'登记时间窗与筛选维度相符。来源和平台数据仍需独立核对。':'时间窗或归因范围不一致，无法计算精确转化率。';card.append(h,value,dl,note);
    if(status.role==='publisher'){const edit=document.createElement('button');edit.type='button';edit.textContent='修订此记录';edit.disabled=!canWrite();edit.addEventListener('click',()=>editRecord(r));card.append(edit);}list.append(card);
  }
}
const loader=createReportLoader({verifyActor:async()=>{status=await controller.verifyActor();controls();},onState:state=>{
  if(state.loading){clear();current=null;controls();message('正在核对所选时间窗…');}
  else if(state.error)failure(state.error);
  else{render(state.report);message(state.report.available?'报表已核对。次数与会话转化分别展示。':'所选历史时间窗缺少完整聚合，暂无数据。');}
}});
async function load(){query=filters();return loader.load(query);}
function period(days){const end=Math.floor(Date.now()/86400000)*86400000;$('report-from').value=day(end-days*86400000);$('report-to').value=day(end);for(const b of document.querySelectorAll('[data-days]'))b.setAttribute('aria-pressed',String(Number(b.dataset.days)===days));}
function newRecord(){
  selected=null;importDirty=false;$('report-external-form').reset();platformChoices();const end=Math.floor(Date.now()/86400000)*86400000;$('external-from').value=local(Date.parse($('report-from').value+'T00:00:00Z')||end-14*86400000);$('external-to').value=local(Date.parse($('report-to').value+'T00:00:00Z')||end);$('external-observed').value=local(Date.now());
  if($('report-track').value)$('external-track').value=$('report-track').value;
  for(const id of ['track','clip','campaign','metric','provider','from','to'])$('external-'+id).disabled=false;
  set('report-edit-note','请使用平台认可的数据；没有来源的数据保持暂无数据。');set('external-submit','保存平台记录');
}
function editRecord(r){
  selected=r;$('external-metric').value=r.metric;platformChoices();for(const [id,value]of [['track',r.trackId],['clip',r.clipId??''],['campaign',r.campaignId??''],['metric',r.metric],['provider',r.provider],['value',r.value],['source-kind',r.sourceKind],['source-label',r.sourceLabel],['status',r.status]])$('external-'+id).value=value;
  for(const [id,value]of [['from',r.from],['to',r.to],['observed',r.observedAt]])$('external-'+id).value=local(value);
  for(const id of ['track','clip','campaign','metric','provider','from','to'])$('external-'+id).disabled=true;
  $('external-recognized').checked=false;set('report-edit-note','正在修订版本 '+r.editVersion+'。所属作品、指标和时间窗固定；修改归属时请新建记录并撤回原记录。');set('external-submit','保存修订');$('report-import').open=true;$('report-import').scrollIntoView({behavior:'auto',block:'start'});$('external-value').focus();
}
async function write(task){writing=true;controls();try{const result=await task();message(result.replayed?'原操作已确认，没有重复登记。':'操作已确认。');newRecord();await load();}catch(e){failure(e);}finally{writing=false;controls();if(current)renderExternal(current.external);}}
async function connect(){
  loader.dispose();clear();$('report-filter-fields').disabled=true;message('正在核对报表权限与资料…');
  try{status=await controller.connect();options=await contentRequest('/reports/options');await controller.verifyActor();populate();set('report-role',status.role==='publisher'?'发布者 · 可登记平台数据':'编辑者 · 只读');$('report-filter-fields').disabled=false;controls();newRecord();await load();}catch(e){status=null;set('report-role','暂不可用');controls();failure(e);}
}
$('report-filter').addEventListener('submit',e=>{e.preventDefault();for(const b of document.querySelectorAll('[data-days]'))b.setAttribute('aria-pressed','false');void load();});
for(const b of document.querySelectorAll('[data-days]'))b.addEventListener('click',()=>{period(Number(b.dataset.days));void load();});
$('report-reload').addEventListener('click',()=>{void connect();});$('report-retry').addEventListener('click',()=>{void write(()=>controller.retry());});
$('report-save-snapshot').addEventListener('click',()=>{if(canWrite()&&query)void write(()=>controller.mutate('/reports/snapshots','POST',query));});
$('external-new').addEventListener('click',newRecord);
$('external-metric').addEventListener('change',platformChoices);
$('report-import').addEventListener('toggle',()=>{if($('report-import').open&&!selected&&!importDirty)newRecord();});
$('report-external-form').addEventListener('input',()=>{importDirty=true;});
$('report-external-form').addEventListener('change',()=>{importDirty=true;});
$('report-external-form').addEventListener('submit',e=>{e.preventDefault();if(!canWrite())return;
  const input={trackId:selected?.trackId??$('external-track').value,clipId:selected?.clipId??($('external-clip').value||null),campaignId:selected?.campaignId??($('external-campaign').value||null),metric:selected?.metric??$('external-metric').value,provider:selected?.provider??$('external-provider').value,value:Number($('external-value').value),sourceKind:$('external-source-kind').value,sourceLabel:$('external-source-label').value,from:selected?new Date(selected.from).toISOString():reportTimestamp($('external-from').value),to:selected?new Date(selected.to).toISOString():reportTimestamp($('external-to').value),observedAt:reportTimestamp($('external-observed').value),recognized:$('external-recognized').checked,status:$('external-status').value};
  void write(()=>controller.mutate('/reports/external'+(selected?'/'+selected.id:''),selected?'PATCH':'POST',input,selected?.editVersion??null));
});
window.addEventListener('pagehide',()=>loader.dispose(),{once:true});period(14);void connect();
