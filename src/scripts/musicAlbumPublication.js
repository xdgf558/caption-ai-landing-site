import { request, uuid } from './musicAdminClient.js';
import { effectivePolicy } from '../music/policy.js';

const reason='管理员确认整张专辑及成员歌曲发布';
const version=n=>Number.isSafeInteger(n)&&n>0;
const fail=message=>{throw new Error(message);};
const messages={MUSIC_REVIEW_STALE:'草稿已变化，请重新核对后发布。',MUSIC_RIGHTS_BLOCKED:'已明确标记为不通过，请先处理该结论。',PREVIEW_REQUIRED:'VIP 或抢先歌曲缺少独立试听。',MUSIC_INVALID_METADATA:'歌曲资料不完整。',MUSIC_INVALID_PUBLICATION:'歌曲资料或媒体校验未通过。',MUSIC_PUBLICATION_CONFLICT:'歌曲版本已变化，请重新载入后核对。',MUSIC_EDIT_CONFLICT:'歌曲已被其他操作更新，请重新载入。'};
const operation=p=>({path:p.kind==='review'?`/revisions/${p.revisionId}/technical-review`:`/tracks/${p.trackId}/publish`,
  method:p.kind==='review'?'PUT':'POST',etag:`"edit-${p.editVersion}"`,key:p.key,timeout:130000,
  body:p.kind==='review'?{audioListened:true,previewListened:p.preview,previewSourceConfirmed:p.preview,artworkChecked:p.artwork,reason}:{revisionId:p.revisionId,confirmedPolicyVersion:p.policyVersion,reason}});

// Only one in-flight command is durable. A reload never continues publication;
// the operator must recover its original key, then explicitly confirm a fresh plan.
export function createAlbumPublisher({storage,actor,api=request}) {
  const storageKey='station-music-album-publication:v1:'+actor;
  if(typeof actor!=='string'||!actor)fail('无法核对管理员身份。');
  let pending;
  try {pending=JSON.parse(storage.getItem(storageKey)||'null');}catch{fail('专辑发布恢复记录不可读，请保留此标签页。');}
  function validate(p){
    if(p===null)return;
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join()!==['albumId','artwork','editVersion','key','kind','label','policyVersion','preview','revisionId','trackId'].sort().join()||
      !['albumId','trackId','revisionId','key'].every(k=>uuid(p[k]))||!['review','publish'].includes(p.kind)||!version(p.editVersion)||!version(p.policyVersion)||typeof p.preview!=='boolean'||typeof p.artwork!=='boolean'||
      typeof p.label!=='string'||p.label.length>200||/[\u0000-\u001f\u007f]/.test(p.label))fail('专辑发布原操作不可读，请保留记录。');
  }
  const save=p=>{validate(p);storage.setItem(storageKey,JSON.stringify(p));pending=p;};validate(pending);
  async function identity(){const s=await api('/status');if(s.actorId!==actor)fail('管理员账号已变化，请使用原账号核对发布操作。');}
  async function replay(){
    if(!pending)return;
    const p=structuredClone(pending);await identity();let r;
    try {r=await api(operation(p).path,operation(p));}
    catch(e){if(!e.uncertain)save(null);throw Object.assign(new Error(`${p.label}：${messages[e.code]||e.message}`),{status:e.status,uncertain:e.uncertain});}
    if(r.trackId!==p.trackId||r.revisionId!==p.revisionId||r.editVersion!==p.editVersion+1||
      (p.kind==='review'?!version(r.technicalReviewedAt):r.action!=='publish'))fail(`${p.label}：回执不完整，请核对原操作。`);
    save(null);return r;
  }
  async function mutate(albumId,row,kind){save({albumId,trackId:row.id,revisionId:row.draft.id,editVersion:row.editVersion,policyVersion:row.draft.policy.policyVersion,
    kind,key:crypto.randomUUID(),label:row.label,preview:!!row.draft.assets.preview,artwork:!!row.draft.assets.cover});return replay();}
  async function sameAlbum(album){await identity();const a=await api('/collections/'+album.id);
    if(a.id!==album.id||a.type!=='album'||a.status==='archived'||a.editVersion!==album.editVersion||JSON.stringify(a.tracks.map(t=>t.id))!==JSON.stringify(album.tracks.map(t=>t.id)))fail('专辑资料或曲序已变化，请重新载入后核对；已经发布的歌曲会保留。');}
  return {
    pending:()=>pending?structuredClone(pending):null,
    recover:replay,
    async publish(album,{listeningConfirmed=false,onProgress=()=>{}}={}){
      if(pending)fail('有一首歌曲的发布操作待确认，请先核对原操作。');
      if(!uuid(album?.id)||album.type!=='album'||!['draft','published'].includes(album.status)||!version(album.editVersion)||!Array.isArray(album.tracks)||!album.tracks.length||album.tracks.length>500||
        album.tracks.some(t=>!uuid(t.id))||new Set(album.tracks.map(t=>t.id)).size!==album.tracks.length)fail('专辑资料或曲序无效。');
      await sameAlbum(album);const rows=[];
      // Read every selected member before the first write. Existing published
      // revisions stay live; their newer drafts are never implicitly published.
      for(const item of album.tracks){const row=await api('/tracks/'+item.id);
        if(row.id!==item.id)fail('歌曲读取结果不匹配。');
        const r=row.lifecycle==='published'?row.published:row.draft;
        const title=r?.metadata?.title;row.label=String(title?.[r?.metadata?.originalLocale]||Object.values(title||{}).find(Boolean)||item.slug||item.id).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,200);
        const issue=text=>fail(`${row.label}：${text}`);
        if(!r||row.lifecycle==='archived'||(row.lifecycle!=='published'&&r.state!=='draft'))issue('没有可发布草稿，请先在曲目工作区保存资料。');
        if(!version(row.editVersion)||!uuid(r.id)||!version(r.policy?.policyVersion))issue('版本无效，请重新载入。');
        const access=effectivePolicy(r.policy,Date.parse(row.serverNow)).effectiveAccess;
        if(album.listeningMode!=='mixed'&&access!==album.listeningMode)issue('收听范围与专辑不一致，请调整专辑范围或单曲设置。');
        if(row.lifecycle==='published')continue;
        if(row.rights?.status==='blocked')issue('已明确标记为不通过，请先处理该结论。');
        if(!row.assets?.some(a=>a.id===r.assets.audio&&a.kind==='audio'&&a.state==='validated'))issue('缺少已验证的完整音频。');
        if(r.policy.accessMode!=='free'&&!r.assets.preview)issue('VIP 或抢先歌曲缺少独立试听。');
        if(!r.technicalReviewedAt&&!listeningConfirmed)issue('请先确认已实际试听并核对本次待发布内容。');
        rows.push(row);
      }
      let completed=0;
      for(const row of rows){onProgress(`正在发布 ${completed+1}/${rows.length}：${row.label}`);await sameAlbum(album);
        if(!row.draft.technicalReviewedAt){const reviewed=await mutate(album.id,row,'review');row.editVersion=reviewed.editVersion;await sameAlbum(album);}
        await mutate(album.id,row,'publish');completed++;
      }
      await sameAlbum(album);return {published:completed};
    }
  };
}
