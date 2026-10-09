import {contentRequest as request,createContentController} from './stationContentClient.js';

const $=id=>document.getElementById(id),text=(id,value)=>{$(id).textContent=value;},show=(id,value)=>{$(id).hidden=!value;};
const locales=['zh-Hans','zh-Hant','en','ja'],homeId='ca710000-0000-4000-8000-000000000001';
const names={tracks:'歌曲资料',promotions:'推广歌曲',platforms:'发行平台',clips:'视频与 MV',games:'游戏介绍',home:'首页配置',assets:'素材权利',audit:'发布记录'};
const states={draft:'草稿',scheduled:'已安排定时',published:'已公开',archived:'已下架',unregistered:'待登记',pending:'待审核',approved:'已确认',blocked:'已阻止'};
const providers={netease:'网易云音乐',qishui:'汽水音乐',apple_music:'Apple Music',youtube:'YouTube',spotify:'Spotify'};
const errors={MUSIC_INVALID_METADATA:'新歌曲的标题最多 120 字、艺名最多 80 字。',STATION_CONTENT_ADMIN_DISABLED:'内容服务尚未启用。',STATION_CONTENT_SCHEMA_UNAVAILABLE:'内容服务尚未准备就绪。',STATION_EDIT_CONFLICT:'版本已变化。请重新读取，再核对你的修改。',STATION_ASSET_RIGHTS_REQUIRED:'关联素材缺少使用权利登记。',STATION_ASSET_NOT_READY:'素材尚未就绪，或使用权利已失效。',STATION_PREVIEW_NOT_INDEPENDENT:'试听必须使用同一歌曲的独立剪辑。',STATION_ASSET_OBJECT_CHANGED:'存储中的素材已变化，请重新核对。',STATION_REFERENCE_NOT_PUBLIC:'关联作品尚未公开。',STATION_PLATFORM_NOT_VERIFIED:'所选平台尚未上线或未完成网址核对。',STATION_METADATA_REQUIRED:'请补齐作品资料。',STATION_ASSET_REQUIRED:'请选择必需的素材。',STATION_PUBLISHER_REQUIRED:'此操作需要可发布管理员。',STATION_FULL_REFERENCE_NOT_CURRENT:'完整资源必须引用现有的公开封存版本。',STATION_FULL_POLICY_MISMATCH:'原版本当前的免费规则与所选模式不一致。',STATION_GAME_DETAILS_REQUIRED:'请补齐设备与就绪截图。',STATION_HOME_CLIP_PARENT_REQUIRED:'首页短视频须属于主推歌曲，并同时在推广模块选中。',STATION_PROMOTION_NOT_ENABLED:'所选歌曲的推广尚未启用。',STATION_SCHEDULE_ACTOR_REVOKED:'安排定时的管理员已不具备发布权限。',STATION_PLATFORM_URL_INVALID:'网址不属于所选平台的有效作品地址。',STATION_PLATFORM_VERIFICATION_REQUIRED:'上线入口需要真实网址与人工核对时间。',INVALID_INPUT:'请核对填写的格式和必填项。'};
const fieldNames={metadata:'作品资料',coverAssetId:'歌曲封面',lyricsAssetId:'歌词素材',legacyRevisionId:'完整播放版本',siteAudioMode:'站内音频模式',previewAssetId:'独立试听素材',trackId:'所属歌曲',mediaAssetId:'视频资源',posterAssetId:'视频海报',durationMs:'媒体时长',launchUrl:'游戏运行地址',screenshotIds:'游戏截图',selectedPlatformIds:'平台入口',selectedClipIds:'关联视频',tracks:'首页歌曲',promotion:'推广配置',references:'关联数量'};
const message=e=>(errors[e.code]??(e.code?'操作未完成，请核对资料或重新读取当前版本。':e.message)??'服务暂时不可用。')+(e.field?' · '+(fieldNames[e.field.split('.').at(-1)]??'关联资料'):'');
const status=(value,error=false)=>{text('content-status',value);$('content-status').dataset.error=String(error);if(error)$('content-status').scrollIntoView({block:'nearest',behavior:'auto'});};
const date=value=>value==null?'—':new Intl.DateTimeFormat('zh-Hans',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value)+' UTC+8';
const sgTime=value=>value?Date.parse(value+'+08:00'):null;
const localTime=value=>value==null?'':new Date(value+8*3600000).toISOString().slice(0,16);
const el=(tag,copy,className)=>{const n=document.createElement(tag);if(copy!==undefined)n.textContent=copy;if(className)n.className=className;return n;};
const selected=id=>[...$(id).selectedOptions].map(o=>o.value).filter(Boolean);
function options(node,items,values=[],empty=true){node.replaceChildren();if(empty){const o=el('option','暂不选择');o.value='';node.append(o);}for(const i of items){const o=el('option',i.title??i.label??i.id);o.value=i.id;node.append(o);}for(const v of values.filter(Boolean))if(![...node.options].some(o=>o.value===v)){const o=el('option','已选记录 · '+v.slice(0,8));o.value=v;node.append(o);}for(const o of node.options)o.selected=values.includes(o.value);}
const field=(name,input)=>{const label=el('label',name);label.append(input);return label;};
const input=(type,value='')=>{const n=document.createElement('input');n.type=type;n.value=value;return n;};
const select=(pairs,value)=>{const n=document.createElement('select');for(const [v,name]of pairs){const o=el('option',name);o.value=v;n.append(o);}n.value=value;return n;};
let historyBefore=null;
let controller,identity=null,module='tracks',current=null,newObject=false,existingTrackId=null,dirty=false,busy=false,epoch=0,listItems=[],nextBefore=null,choices={},ownerAssets=[],subtitleEdits={};
try{controller=createContentController({storage:window.sessionStorage});}catch(e){status(message(e),true);}
function controls(){
  const locked=!identity||busy||Boolean(controller?.pending());$('content-fields').disabled=locked;
  for(const b of document.querySelectorAll('.content-tabs button,#content-new,#content-search-submit,#content-more'))b.disabled=locked;
  const publisher=identity?.role==='publisher',r=current?.draft??current?.published;
  $('content-publish').disabled=locked||!publisher||dirty||!current?.draft;
  $('content-preflight').disabled=locked||dirty||!r;
  $('content-unpublish').disabled=locked||!publisher||!current||dirty||current.status==='archived';
  $('content-schedule').disabled=locked||!publisher||!identity?.schedulesEnabled||dirty||!current?.draft;
  $('content-cancel-schedule').disabled=locked||!publisher||dirty||!current?.jobs.some(j=>j.status==='pending');
  $('content-rollback').disabled=locked||!publisher||dirty||!current?.revisions.some(r=>r.state==='sealed');
  $('content-add-publication').disabled=locked||!publisher||!current;
  $('content-retry').disabled=busy||!controller?.pending();show('content-recovery',Boolean(controller?.pending()));
  for(const n of document.querySelectorAll('#content-platform-editor input,#content-platform-editor select,#content-platform-editor button,#content-rights-editor input,#content-rights-editor select,#content-rights-editor textarea,#content-rights-editor button'))n.disabled=locked||n.dataset.identityLocked==='true'||(n.dataset.publisherOnly==='true'&&!publisher);
}
async function work(task){if(busy)return;busy=true;controls();try{await task();}catch(e){status(message(e),true);}finally{busy=false;controls();}}
async function loadChoices(type){
 if(!choices[type])choices[type]=await request('/'+type);
 return choices[type].items;
}
function moreChoices(node,type,values,empty,path='/'+type){
 const old=node.parentElement.querySelector('[data-choice-more]');old?.remove();
 if(!choices[type].nextBefore)return;
 const button=el('button','读取更多可选作品');button.type='button';button.dataset.choiceMore=type;
 button.addEventListener('click',()=>{void work(async()=>{const page=await request(path+(path.includes('?')?'&':'?')+'before='+choices[type].nextBefore),selectedValues=[...node.selectedOptions].map(o=>o.value);choices[type]={items:[...choices[type].items,...page.items],nextBefore:page.nextBefore};options(node,choices[type].items.map(i=>({...i,title:i.title+' · '+(states[i.status]??i.status)})),selectedValues,empty);moreChoices(node,type,selectedValues,empty,path);});});node.parentElement.append(button);
}
async function ownerChoices(id){
 if(!id)return [];let result=await request('/assets?ownerId='+encodeURIComponent(id)),items=result.items;
 // Owner inventories are bounded per HTTP request and fully followed for this editor.
 // Above 1,000 assets use the kind filter in the API instead of growing a form indefinitely.
 for(let page=1;result.nextBefore&&page<20;page++){result=await request('/assets?ownerId='+encodeURIComponent(id)+'&before='+encodeURIComponent(result.nextBefore));items.push(...result.items);}
 if(result.nextBefore)throw new Error('此作品超过 1,000 份素材，请先通过素材类型筛选读取。');return items;
}
async function allChoices(type,node,values=[],empty=true){const data=await loadChoices(type);options(node,data.map(i=>({...i,title:i.title+' · '+(states[i.status]??i.status)})),values,empty);moreChoices(node,type,values,empty);}
function assetOptions(id,kind,value,multiple=false){const records=ownerAssets.filter(a=>a.kind===kind).map(a=>({id:a.id,title:(states[a.rightsStatus]??a.rightsStatus)+' · '+(a.state==='validated'?'就绪':a.state)+' · '+a.id.slice(0,8)+(a.durationMs?' · '+a.durationMs/1000+' 秒':'')}));options($(id),records,multiple?value:[value],!multiple);}
async function listPage(append=false){const token=++epoch;let result;
 if(['platforms','assets'].includes(module)){result=await request('/tracks?q='+encodeURIComponent($('content-search').value)+(append&&nextBefore?'&before='+nextBefore:''));}
 else if(module==='audit'){result=await request('/audit'+(append&&nextBefore?'?before='+nextBefore:''));}
 else result=await request('/'+module+'?q='+encodeURIComponent($('content-search').value)+(append&&nextBefore?'&before='+nextBefore:''));
 if(token!==epoch)return;listItems=append?[...listItems,...result.items]:result.items;nextBefore=result.nextBefore;renderList();
 if(module==='audit'){renderAudit(listItems);status('已读取发布与操作记录。');}
}
function renderList(){const list=$('content-list');list.replaceChildren();text('content-list-heading',names[module]);show('content-more',Boolean(nextBefore));show('content-new',!['home','assets','platforms','audit'].includes(module));show('content-search-label',module!=='audit');show('content-search-submit',module!=='audit');
 for(const i of listItems){const li=el('li'),button=el('button');button.type='button';button.setAttribute('aria-current',String(current?.id===i.id));button.append(el('span',i.title??i.action),el('small',states[i.status]??(i.createdAt?date(i.createdAt):i.status)));button.addEventListener('click',()=>{if(dirty){status('有未保存的修改，请先保存草稿。');return;}void work(()=>openObject(i));});li.append(button);list.append(li);}
 if(!listItems.length)list.append(el('li','还没有记录，可从新建开始。','muted'));
}
function hideEditors(){for(const id of ['content-form','content-empty','content-platform-editor','content-rights-editor','content-audit','content-preview'])show(id,false);}
async function openObject(item){if(module==='audit'){renderAudit([item]);status('已读取所选操作记录。');return;}const token=++epoch;hideEditors();dirty=false;newObject=false;existingTrackId=null;
 if(module==='platforms'){current={id:item.id};await renderPlatforms(item);renderList();status('已读取发行平台状态。');return;}
 if(module==='assets'){current={id:item.id};await renderRights(item);renderList();status('已读取当前素材权利。');return;}
 if(module==='audit')return;
 if(item.status==='unregistered'&&module==='tracks'){
   current=null;newObject=true;existingTrackId=item.id;await renderForm({metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':item.title??''},creatorName:'Station Cat'},siteAudioMode:'none'});text('content-editor-heading','登记网站资料');status('这首歌尚未登记网站资料。保存后仍是草稿。');return;
 }
 const result=await request('/'+module+'/'+item.id);if(token!==epoch)return;current=result;await renderForm((current.draft??current.published)?.data??{});renderList();status('已读取当前版本。');
}
async function renderForm(data){
 hideEditors();show('content-form',true);$('content-form').reset();
 const r=current?.draft??current?.published;const title=data.metadata?.title?.[data.metadata.originalLocale]??(module==='promotions'&&current?((listItems.find(i=>i.id===current.id)?.title??'歌曲')+' · 推广配置'):names[module]);text('content-editor-heading',newObject?'新建'+names[module]:title);text('content-state',states[current?.status??'draft']??'草稿');text('content-version',current?'草稿 '+(current.draft?.revision??'—')+' / '+(current.status==='archived'?'历史公开 ':'公开 ')+(current.published?.revision??'—')+' · 编辑版本 '+current.editVersion:'尚未保存 · 不会自动公开');
 show('content-metadata',['tracks','clips','games'].includes(module));show('content-artist-wrap',module==='tracks');show('content-related-wrap',module==='tracks');show('content-slug-wrap',newObject&&!existingTrackId&&['tracks','games'].includes(module));show('content-parent-wrap',newObject&&['promotions','clips'].includes(module));show('content-type-wrap',newObject&&module==='clips');
 for(const [id,type]of [['content-track-fields','tracks'],['content-promotion-fields','promotions'],['content-clip-fields','clips'],['content-game-fields','games'],['content-home-fields','home']])show(id,module===type);
 show('content-schedule-wrap',Boolean(current));
 const m=data.metadata??{};for(const n of document.querySelectorAll('[data-title]'))n.maxLength=module==='tracks'&&newObject&&!existingTrackId?120:200;$('content-artist').maxLength=newObject&&!existingTrackId?80:120;$('content-locale').value=m.originalLocale??'zh-Hans';$('content-artist').value=m.creatorName??'';$('content-story').value=m.story??'';
 for(const locale of locales){document.querySelector('[data-title="'+locale+'"]').value=m.title?.[locale]??'';document.querySelector('[data-summary="'+locale+'"]').value=m.summary?.[locale]??'';}
 if(newObject&&['promotions','clips'].includes(module))await allChoices('tracks',$('content-parent'));
 if(module==='tracks'){
   ownerAssets=await ownerChoices(current?.id??existingTrackId);assetOptions('content-cover','cover',data.coverAssetId);assetOptions('content-lyrics','lyrics',data.lyricsAssetId);
   $('content-audio-mode').value=data.siteAudioMode??'none';$('content-duration').value=data.durationMs?data.durationMs/1000:'';$('content-legacy').value=data.legacyRevisionId??'';await allChoices('tracks',$('content-related'),m.relatedTrackIds??[],false);
 }else if(module==='promotions'){
   $('content-promote').checked=data.enabled??false;$('content-preview-enable').checked=data.previewEnabled??false;$('content-sort').value=data.sortOrder??0;await promotionChoices(current?.id,data);
   if(current){const campaigns=await request('/promotions/'+current.id+'/campaigns');text('content-campaigns',campaigns.items.length?'已登记 Campaign：'+campaigns.items.map(c=>c.source+' / '+c.medium+' · '+c.status).join('；'):'尚无 Campaign。推广链接与二维码在后续任务接入。');}
 }else if(module==='clips'){
   ownerAssets=await ownerChoices(current?.id);assetOptions('content-video',current?.clipType??$('content-clip-type').value,data.mediaAssetId);assetOptions('content-poster','poster',data.posterAssetId);$('content-clip-duration').value=data.durationMs?data.durationMs/1000:'';$('content-subtitles').value=data.subtitles?.[$('content-locale').value]??'';
   subtitleEdits={...(data.subtitles??{})};const p=current?await request('/clips/'+current.id+'/publications'):{items:[]};$('content-publications').replaceChildren(...p.items.map(r=>el('p',r.channel+' · '+r.post_id+' · '+date(r.external_published_at))));
 }else if(module==='games'){
   $('content-launch').value=data.launchUrl??'';for(const n of document.querySelectorAll('[data-device]'))n.checked=(data.supportedDevices??[]).includes(n.dataset.device);ownerAssets=await ownerChoices(current?.id);assetOptions('content-screenshots','game_screenshot',data.screenshotIds??[],true);
 }else{
   await allChoices('promotions',$('content-featured-track'),[data.featuredTrackId]);await allChoices('games',$('content-featured-game'),[data.featuredGameId]);await allChoices('promotions',$('content-selected-tracks'),data.selectedTrackIds??[],false);await allChoices('clips',$('content-selected-clips'),data.selectedClipIds??[],false);
 }
 historyBefore=current?.hasOlderRevisions?current.revisions.at(-1).revision:null;show('content-history-more',Boolean(historyBefore));
 const sealed=current?.revisions.filter(r=>r.state==='sealed')??[];options($('content-rollback-version'),sealed.map(r=>({id:String(r.revision),title:'版本 '+r.revision+' · '+date(r.createdAt)})),[],false);
 text('content-jobs',current?.jobs.length?current.jobs.slice(0,5).map(j=>date(j.dueAt)+' · '+({pending:'等待公开',succeeded:'已公开',failed:'失败，可继续编辑',cancelled:'已取消'}[j.status])+(j.errorCode?' · '+(errors[j.errorCode]??j.errorCode):'')).join('\n'):'尚未安排定时公开。');
 controls();
}
async function promotionChoices(id,data={}){ownerAssets=await ownerChoices(id);assetOptions('content-preview-asset','preview',data.previewAssetId);
 const platforms=id?(await request('/platforms?trackId='+id)).items:[];options($('content-platform-ids'),platforms.map(p=>({id:p.id,title:providers[p.provider]+' · '+p.status})),data.selectedPlatformIds??[],false);
 if(id){const key='track-clips-'+id,path='/clips?trackId='+id;if(!choices[key])choices[key]=await request(path);options($('content-clip-ids'),choices[key].items.map(c=>({...c,title:c.title+' · '+(states[c.status]??c.status)})),data.selectedClipIds??[],false);moreChoices($('content-clip-ids'),key,data.selectedClipIds??[],false,path);}else options($('content-clip-ids'),[],[],false);
}
function metadata(){const locale=$('content-locale').value,title={},summary={};for(const l of locales){const t=document.querySelector('[data-title="'+l+'"]').value,s=document.querySelector('[data-summary="'+l+'"]').value;if(t||l===locale)title[l]=t;if(s||l===locale)summary[l]=s;}return {originalLocale:locale,title,summary,story:$('content-story').value,...(module==='tracks'?{creatorName:$('content-artist').value,relatedTrackIds:selected('content-related')}: {})};}
const nullable=id=>$(id).value||null;
const duration=id=>$(id).value?Math.round(Number($(id).value)*1000):null;
function dataFromForm(){if(module==='tracks')return {metadata:metadata(),siteAudioMode:$('content-audio-mode').value,durationMs:duration('content-duration'),legacyRevisionId:nullable('content-legacy'),coverAssetId:nullable('content-cover'),lyricsAssetId:nullable('content-lyrics')};
 if(module==='promotions')return {enabled:$('content-promote').checked,previewEnabled:$('content-preview-enable').checked,previewAssetId:nullable('content-preview-asset'),sortOrder:Number($('content-sort').value),selectedPlatformIds:selected('content-platform-ids'),selectedClipIds:selected('content-clip-ids')};
 if(module==='clips')return {metadata:metadata(),mediaAssetId:nullable('content-video'),posterAssetId:nullable('content-poster'),durationMs:duration('content-clip-duration'),subtitles:{...subtitleEdits,[$('content-locale').value]:$('content-subtitles').value}};
 if(module==='games')return {metadata:metadata(),launchUrl:nullable('content-launch'),supportedDevices:[...document.querySelectorAll('[data-device]:checked')].map(n=>n.dataset.device),screenshotIds:selected('content-screenshots')};
 return {featuredTrackId:nullable('content-featured-track'),featuredGameId:nullable('content-featured-game'),selectedTrackIds:selected('content-selected-tracks'),selectedClipIds:selected('content-selected-clips'),selectedUpdateIds:[]};
}
function operationReason(){const r=$('content-reason').value.trim();if(!r){$('content-reason').focus();throw new Error('请填写本次操作说明。');}return r;}
async function reloadObject(id=current?.id){choices={};dirty=false;await listPage();if(id)await openObject({id});}
async function save(){const reason=operationReason(),data=dataFromForm();let result;
 if(newObject)result=await controller.mutate('/'+module,'POST',{data,reason,...(existingTrackId?{trackId:existingTrackId}:{}),...(['tracks','games'].includes(module)&&!existingTrackId?{slug:$('content-slug').value}:{}),...(['promotions','clips'].includes(module)?{trackId:$('content-parent').value}:{}),...(module==='clips'?{clipType:$('content-clip-type').value}: {})});
 else result=await controller.mutate('/'+module+'/'+current.id,'PATCH',{revision:(current.draft??current.published).revision,data,reason},current.editVersion);
 await reloadObject(result.id);status('草稿已保存。公开版本仍由发布操作更新。');
}
async function action(name){if(!current||dirty)throw new Error('请先保存当前修改。');const reason=operationReason(),revision=name==='rollback'?Number($('content-rollback-version').value):(current.draft??current.published).revision;
 const body={revision,reason,...(name==='schedule'?{dueAt:sgTime($('content-due').value)}:{})};await controller.mutate('/'+module+'/'+current.id+'/'+name,'POST',body,current.editVersion);await reloadObject();status({publish:'这一版已公开。',unpublish:'已下架或停止推广。',rollback:'已恢复为新版本并公开。',schedule:'定时公开已安排。','cancel-schedule':'定时公开已取消。'}[name]);
}
function renderPreview(result){show('content-preview',true);const card=$('content-preview-card');card.replaceChildren();const d=result.data,m=d.metadata;
 if(m){card.append(el('p',m.title?.[m.originalLocale]??names[module],'content-preview-card-title'));if(m.creatorName)card.append(el('p',m.creatorName));if(m.summary?.[m.originalLocale])card.append(el('p',m.summary[m.originalLocale]));if(m.story)card.append(el('p',m.story));}
 else if(module==='promotions'){card.append(el('p',d.enabled?'推广已启用':'推广已停止','content-preview-card-title'),el('p',d.previewEnabled?'独立试听已核对':'不提供站内试听'),el('p','已选平台 '+d.selectedPlatformIds.length+' 个 · 视频 '+d.selectedClipIds.length+' 条'));}
 else card.append(el('p','首页引用已核对','content-preview-card-title'),el('p','主推歌曲 '+(d.featuredTrackId?'已选择':'留空')+' · 游戏 '+(d.featuredGameId?'已选择':'留空')));
 card.append(el('p','版本 '+result.revision+' · 当前资源与关联校验通过','content-version-note'));$('content-preview').scrollIntoView({block:'nearest',behavior:'auto'});
}
async function renderPlatforms(item){hideEditors();show('content-platform-editor',true);const panel=$('content-platform-editor');panel.replaceChildren();text('content-editor-heading',item.title??'发行平台');text('content-version','外部发行状态独立于网站作品公开。');text('content-state','平台入口');const records=(await request('/platforms?trackId='+item.id)).items;
 for(const record of [...records,{id:null,trackId:item.id,provider:'netease',territories:['*'],status:'planned',url:null,verifiedAt:null,releasedAt:null,sortOrder:0}]){
  const block=el('form',undefined,'content-platform-record'),provider=select(Object.entries(providers),record.provider),state=select([['planned','待发行'],['live','已上线'],['unavailable','暂不可用'],['removed','已下架']],record.status),url=input('url',record.url??''),territories=input('text',record.territories.join(',')),verified=input('datetime-local',localTime(record.verifiedAt)),released=input('datetime-local',localTime(record.releasedAt)),sort=input('number',record.sortOrder),button=el('button',record.id?'保存平台状态':'添加平台入口');
  provider.dataset.identityLocked=String(Boolean(record.id));provider.disabled=Boolean(record.id);url.maxLength=2048;territories.maxLength=1000;sort.min='0';button.type='submit';if(record.status==='live')button.dataset.publisherOnly='true';if(identity.role==='editor'&&record.status==='live')button.disabled=true;
  block.append(el('h3',record.id?providers[record.provider]:'添加发行入口'),field('平台',provider),field('发行状态',state),field('真实作品网址',url),field('地区（* 为全球，多个地区用逗号分隔）',territories),field('人工核对时间（新加坡 UTC+8）',verified),field('外部发行时间（新加坡 UTC+8）',released),field('排序',sort),el('p','只登记人工核对的真实状态。未发行或下架状态不会输出可点击网址。','muted'),button);
  block.addEventListener('submit',e=>{e.preventDefault();void work(async()=>{await controller.mutate('/platforms'+(record.id?'/'+record.id:''),record.id?'PATCH':'POST',{trackId:item.id,provider:provider.value,status:state.value,url:url.value||null,territories:territories.value.split(',').map(v=>v.trim()).filter(Boolean),verifiedAt:sgTime(verified.value),releasedAt:sgTime(released.value),sortOrder:Number(sort.value)},record.id?record.editVersion:null);await renderPlatforms(item);status('平台状态已保存。');});});panel.append(block);
 }
}
async function renderRights(item){hideEditors();show('content-rights-editor',true);const panel=$('content-rights-editor');panel.replaceChildren();text('content-editor-heading',item.title??'素材权利');text('content-version','技术就绪与使用权利分别确认。');text('content-state','权利登记');
 const owners=[{id:item.id,title:'歌曲素材'},...(await loadChoices('clips')).map(c=>({id:c.id,title:c.title})),...(await loadChoices('games')).map(g=>({id:g.id,title:g.title}))],owner=select(owners.map(o=>[o.id,o.title]),item.id);panel.append(field('所属作品',owner));
 for(const [type,label]of [['clips','读取更早视频'],['games','读取更早游戏']]){
  if(!choices[type].nextBefore)continue;const button=el('button',label);button.type='button';
  button.addEventListener('click',()=>{void work(async()=>{const page=await request('/'+type+'?before='+choices[type].nextBefore);choices[type]={items:[...choices[type].items,...page.items],nextBefore:page.nextBefore};const selectedOwner=owner.value;options(owner,[{id:item.id,title:'歌曲素材'},...choices.clips.items,...choices.games.items],[selectedOwner],false);if(!page.nextBefore)button.remove();});});panel.append(button);
 }
 const records=el('div');panel.append(records);async function load(){records.replaceChildren();const data=await ownerChoices(owner.value);for(const a of data.filter(a=>a.kind!=='audio')){const block=el('form',undefined,'content-rights-record'),basis=document.createElement('textarea'),state=select([['pending','待审核'],['approved','确认允许使用'],['blocked','阻止公开']],a.rightsStatus),note=document.createElement('textarea'),button=el('button','保存权利登记');basis.value=a.basis;basis.maxLength=8000;basis.rows=4;note.maxLength=1000;note.required=true;button.type='submit';button.disabled=identity.role!=='publisher';
   button.dataset.publisherOnly='true';block.append(el('h3',a.kind+' · '+a.id.slice(0,8)),el('p',(a.state==='validated'?'技术校验就绪':a.state)+' · '+(states[a.rightsStatus]??a.rightsStatus),'muted'),field('使用状态',state),field('授权依据与允许的使用范围（单行）',basis),field('本次操作说明',note),button);
   block.addEventListener('submit',e=>{e.preventDefault();void work(async()=>{await controller.mutate('/assets/'+a.id+'/rights','PUT',{scope:a.kind,status:state.value,basis:basis.value,reason:note.value},a.rightsVersion||1);await load();status('权利登记已保存。');});});records.append(block);
  }if(!records.children.length)records.append(el('p','这份作品还没有可登记的素材。请先在素材工作区准备文件。','notice'));}
 owner.addEventListener('change',()=>{void work(load);});await load();
}
function renderAudit(items){hideEditors();show('content-audit',true);text('content-editor-heading','发布与操作记录');text('content-version','新加坡时间 UTC+8 · 记录原操作人和版本');text('content-state','审计');$('content-audit').replaceChildren(...items.map(r=>{const n=el('article',undefined,'content-audit-record');n.append(el('strong',r.action),el('p',r.actorId+' · '+date(r.createdAt)),el('p','对象 '+r.targetId+' · 版本 '+(r.summary.revision??'—')),el('p',r.summary.reason??r.summary.errorCode??'', 'muted'));return n;}));}
async function connect(){if(!controller)return;identity=await controller.connect();text('content-role',identity.role==='publisher'?'可发布管理员':'内容编辑');choices={};await listPage();if(module==='home')await openObject({id:homeId});else if(listItems.length&&module!=='audit')await openObject(listItems.find(i=>i.status!=='unregistered')??listItems[0]);else{hideEditors();show('content-empty',true);}status(controller.pending()?'请先核对原操作的结果。':'内容服务已就绪。选择作品开始编辑。');}
for(const button of document.querySelectorAll('[data-module]'))button.addEventListener('click',()=>{if(dirty){status('有未保存的修改，请先保存草稿。');return;}module=button.dataset.module;current=null;newObject=false;existingTrackId=null;$('content-search').value='';for(const n of document.querySelectorAll('[data-module]')){if(n===button)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');}void work(async()=>{await listPage();if(module==='home')await openObject({id:homeId});else if(listItems.length&&module!=='audit')await openObject(listItems.find(i=>i.status!=='unregistered')??listItems[0]);else if(module!=='audit'){hideEditors();show('content-empty',true);}});});
$('content-history-more').addEventListener('click',()=>{void work(async()=>{const page=await request('/'+module+'/'+current.id+'/revisions?before='+historyBefore);current.revisions.push(...page.items);historyBefore=page.nextBefore;show('content-history-more',Boolean(historyBefore));options($('content-rollback-version'),current.revisions.filter(r=>r.state==='sealed').map(r=>({id:String(r.revision),title:'版本 '+r.revision+' · '+date(r.createdAt)})),[$('content-rollback-version').value],false);});});
$('content-form').addEventListener('submit',e=>{e.preventDefault();void work(save);});
$('content-form').addEventListener('input',e=>{if(['content-reason','content-due','content-rollback-version','content-publication-channel','content-post-id','content-post-url','content-post-time'].includes(e.target.id))return;dirty=true;show('content-preview',false);text('content-version','有未保存的修改 · 请先保存草稿');controls();});
$('content-parent').addEventListener('change',()=>{if(module==='promotions')void work(()=>promotionChoices($('content-parent').value));});
$('content-video').addEventListener('change',()=>{const a=ownerAssets.find(a=>a.id===$('content-video').value);if(a?.durationMs)$('content-clip-duration').value=a.durationMs/1000;});
$('content-subtitles').addEventListener('input',()=>{subtitleEdits[$('content-locale').value]=$('content-subtitles').value;});$('content-locale').addEventListener('change',()=>{if(module==='clips')$('content-subtitles').value=subtitleEdits[$('content-locale').value]??'';});
$('content-new').addEventListener('click',()=>{if(dirty){status('请先保存当前草稿。');return;}current=null;newObject=true;existingTrackId=null;void work(()=>renderForm(['promotions','home'].includes(module)?{enabled:false,previewEnabled:false}:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':''},creatorName:module==='tracks'?'Station Cat':undefined}}));});
$('content-search-submit').addEventListener('click',()=>{void work(()=>listPage());});$('content-more').addEventListener('click',()=>{void work(()=>listPage(true));});
for(const [id,actionName]of [['content-publish','publish'],['content-unpublish','unpublish'],['content-rollback','rollback'],['content-schedule','schedule'],['content-cancel-schedule','cancel-schedule']])$(id).addEventListener('click',()=>{void work(()=>action(actionName));});
$('content-preflight').addEventListener('click',()=>{void work(async()=>{const revision=(current.draft??current.published).revision;const result=await request('/'+module+'/'+current.id+'/preflight?revision='+revision);renderPreview(result);status('当前关联与资源已核对。正式公开时仍会重新校验。');});});
$('content-preview-width').addEventListener('change',()=>{$('content-preview').dataset.width=$('content-preview-width').value;});
$('content-add-publication').addEventListener('click',()=>{void work(async()=>{await controller.mutate('/clips/'+current.id+'/publications','POST',{channel:$('content-publication-channel').value,postId:$('content-post-id').value,url:$('content-post-url').value,publishedAt:sgTime($('content-post-time').value),reason:operationReason()},current.editVersion);await reloadObject();status('外部发布记录已登记。');});});
$('content-reload').addEventListener('click',()=>{dirty=false;void work(connect);});$('content-retry').addEventListener('click',()=>{void work(async()=>{await controller.retry();await connect();status('原操作已核对，请检查当前版本。');});});
void work(connect);
