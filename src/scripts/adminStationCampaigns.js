import { contentRequest as request } from './stationContentClient.js';
import { campaignQr } from '../redesign/campaignQr.js';
const el=(tag,value,css)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(css)n.className=css;return n;};
const field=(label,node)=>{const n=el('label',label);n.append(node);return n;};
function textInput(id,placeholder){const n=el('input');n.id=id;n.maxLength=64;n.placeholder=placeholder;return n;}
function select(id,options){const n=el('select');n.id=id;for(const [value,title]of options){const o=el('option',title);o.value=value;n.append(o);}return n;}
const rowFor=r=>({id:r.id,source:r.source,medium:r.medium,track_id:r.trackId,clip_id:r.clipId,landing_path:r.landingPath,content_value:r.content});

export async function renderStationCampaigns(panel,trackId,{controller,identity,work,status}={}) {
  panel.replaceChildren();panel.dataset.campaignUi='';
  panel.className='campaign-manager';panel.append(el('h3','推广链接与二维码'),el('p','每个渠道单独登记。链接和二维码使用同一落地地址；停用后保留记录。','muted'));
  if(!trackId){panel.append(el('p','先保存并公开有效推广配置，再创建推广链接。','notice'));return;}
  let page=await request('/promotions/'+trackId+'/campaigns'),items=page.items;
  if(!page.enabled){panel.append(el('p','推广链接服务尚未启用。','notice'));return;}
  const publisher=identity.role==='publisher',notice=el('p',page.creationAvailable?'当前公开推广可创建链接。':'当前推广未公开、已停止或关联素材不可用。既有链接暂不提供二维码。','notice');panel.append(notice);
  const create=el('details');create.open=page.creationAvailable;create.append(el('summary','登记新 Campaign'));
  const controls=el('fieldset');controls.disabled=!page.creationAvailable;controls.className='campaign-create';
  const id=textInput('campaign-key','例如 local-douyin-01'),source=textInput('campaign-source','例如 douyin'),medium=textInput('campaign-medium','例如 short_video');
  const clip=select('campaign-clip',[['','作品资料（无视频）'],...(page.clipIds??[]).map(id=>[id,'推广关联视频 · '+id.slice(0,8)])]);
  const locale=select('campaign-locale',[['zh-Hant','繁體中文'],['zh-Hans','简体中文'],['en','English'],['ja','日本語']]);
  const state=select('campaign-state',publisher?[['active','启用并生成链接'],['draft','只登记草稿']]:[['draft','只登记草稿']]);
  const legacy=el('input');legacy.id='campaign-legacy';legacy.maxLength=324;legacy.placeholder='仅填写已使用的旧 src，多个值用逗号分隔';
  const reason=el('textarea');reason.id='campaign-reason';reason.rows=2;reason.maxLength=1000;
  const grid=el('div',undefined,'field-grid');grid.append(field('Campaign 编号（登记后固定）',id),field('来源渠道',source),field('传播方式',medium),field('关联素材',clip),field('落地语言',locale),field('登记状态',state));
  const button=el('button',publisher?'登记 Campaign':'登记 Campaign 草稿','primary');button.type='button';
  controls.append(grid,field('旧 src 明确映射（选填，最多 5 个）',legacy),el('p','编号、渠道、素材与落地地址登记后固定。更换渠道时另建 Campaign。','muted'),button);create.append(controls);panel.append(create,field('Campaign 操作说明',reason));
  const records=el('div',undefined,'campaign-records'),more=el('button','读取更多 Campaign');more.type='button';panel.append(records,more);
  const opReason=()=>{if(!reason.value.trim()){reason.focus();throw new Error('请填写 Campaign 操作说明。');}return reason.value.trim();};
  async function refresh(){page=await request('/promotions/'+trackId+'/campaigns');items=page.items;controls.disabled=!page.creationAvailable;notice.textContent=page.creationAvailable?'当前公开推广可创建链接。':'当前推广未公开、已停止或关联素材不可用。既有链接暂不提供二维码。';paint();}
  button.addEventListener('click',()=>{void work(async()=>{
    // These controls live inside the promotion editor. Validate only this action,
    // so an empty or unfinished Campaign cannot block saving the website draft.
    for(const input of [id,source,medium])if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.value)){
      input.setCustomValidity('请填写 1–64 位小写字母、数字、下划线或短横线。');input.reportValidity();input.setCustomValidity('');return;
    }
    await controller.mutate('/promotions/'+trackId+'/campaigns','POST',{id:id.value,source:source.value,medium:medium.value,clipId:clip.value||null,locale:locale.value,status:state.value,legacySources:legacy.value?legacy.value.split(',').map(v=>v.trim()):[],reason:opReason()});
    await refresh();status(state.value==='active'?'Campaign 已启用，链接与二维码已生成。':'Campaign 草稿已登记。');
  });});
  more.addEventListener('click',()=>{void work(async()=>{page=await request('/promotions/'+trackId+'/campaigns?before='+page.nextBefore);items.push(...page.items);paint();});});
  function paint(){
    records.replaceChildren();more.hidden=!page.nextBefore;
    if(!items.length)records.append(el('p','尚无 Campaign。不同渠道可以使用同一份推广素材。','notice'));
    for(const record of items){
      const block=el('article',undefined,'campaign-record');block.append(el('h4',record.id),el('p',record.source+' / '+record.medium+' · '+({active:record.effective?'已启用':'已登记，当前不可用',draft:'草稿',archived:'已停用'}[record.status]??'待核对'),'muted'));
      if(record.legacySources?.length)block.append(el('p','旧 src：'+record.legacySources.join('、'),'muted'));
      if(record.url&&record.effective){
        const qr=campaignQr(rowFor(record));if(qr.url!==record.url)throw new Error('链接与二维码的地址不一致，请重新核对。');
        const content=el('div',undefined,'campaign-output'),image=el('img');image.src=qr.image;image.width=240;image.height=240;image.alt='推广二维码 · '+record.id;
        const link=el('textarea');link.value=qr.url;link.readOnly=true;link.rows=3;link.setAttribute('aria-label','推广地址 · '+record.id);
        const actions=el('div',undefined,'music-actions'),copy=el('button','复制推广链接'),download=el('button','下载二维码');copy.type=download.type='button';
        copy.addEventListener('click',()=>{void work(async()=>{try{await navigator.clipboard.writeText(qr.url);status('推广链接已复制。');}catch{link.focus();link.select();status('无法自动复制，已选中推广地址，可手动复制。');}});});
        download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([qr.svg],{type:'image/svg+xml'})),a=el('a');a.href=url;a.download='station-cat-'+record.id+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
        actions.append(copy,download);const output=el('div');output.append(field('单曲推广地址',link),actions,el('p','二维码直接编码上面的地址，无中转网址。','muted'));content.append(image,output);block.append(content);
      }
      const actions=el('div',undefined,'music-actions');
      for(const [next,label]of record.status==='active'?[['archived','停用 Campaign']]:[['active','重新核对并启用']]){
        const change=el('button',label);change.type='button';change.disabled=!publisher;change.dataset.publisherOnly='true';
        change.addEventListener('click',()=>{void work(async()=>{await controller.mutate('/campaigns/'+record.id,'PATCH',{status:next,reason:opReason()},record.editVersion);await refresh();status(next==='active'?'已重新核对并启用 Campaign。':'Campaign 已停用，历史记录保留。');});});actions.append(change);
      }
      block.append(actions);records.append(block);
    }
  }
  paint();
}
