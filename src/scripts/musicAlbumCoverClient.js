import { request, fileFormat, hashFile, uuid } from './musicAdminClient.js';

// Persist metadata before every mutating request. Never persist image bytes.
export function createAlbumCoverUploader({ journal, checkActor, api=request }) {
  const jobs=()=>journal.get().coverJobs || [];
  const save=job=>journal.update({coverJobs:[...jobs().filter(j=>j.key!==job.key),job]});
  async function resume(job,file) {
    await checkActor();
    if(!job.uploadId){
      const r=await api('/collection-uploads',{method:'POST',key:job.key,body:job.body});
      job={...job,uploadId:r.uploadId,assetId:r.assetId,stage:'reserved'};save(job);
    }
    let r=await api('/collection-uploads/'+job.uploadId);
    if(r.collectionId!==job.body.collectionId || r.assetId!==job.assetId)throw new Error('封面上传记录不匹配。');
    if(r.status==='completed') {job={...job,stage:'completed'};save(job);return job;}
    if(r.expired || ['rejected','expired'].includes(r.status)) {save({...job,stage:'failed'});throw new Error('这次封面上传已失效，预留容量仍保留。可以重新选择文件上传。');}
    if(r.status==='reserved' && job.stage!=='writing'){
      if(!file || file.size!==job.body.byteSize || (await hashFile(file))!==job.body.sha256)throw new Error('请重新选择同一个封面文件，再点击“查询并恢复”。');
      await checkActor();
      job={...job,stage:'writing'};save(job);
      // Mark first. A timed-out PUT can still commit; recovery must never resend it.
      await api('/collection-uploads/'+job.uploadId+'/body',{method:'PUT',key:job.writeKey,body:file,raw:true,type:job.type,timeout:130000});
    }
    await checkActor();
    r=await api('/collection-uploads/'+job.uploadId+'/complete',{method:'POST',key:job.completeKey,body:{}});
    if(r.status!=='completed' || r.assetId!==job.assetId)throw new Error('封面上传结果尚未确认。');
    job={...job,stage:'completed'};save(job);return job;
  }
  return { pending:collectionId=>jobs().find(j=>j.body.collectionId===collectionId&&!['completed','failed'].includes(j.stage)),
    completed:collectionId=>jobs().filter(j=>j.body.collectionId===collectionId&&j.stage==='completed').at(-1),
    async upload(collectionId,file){
      if(!uuid(collectionId))throw new Error('请先保存专辑资料。');
      if(jobs().some(j=>j.body.collectionId===collectionId&&!['completed','failed'].includes(j.stage)))throw new Error('请先查询并恢复原封面上传。');
      const {format,type}=fileFormat('cover',file),sha256=await hashFile(file);
      const job={key:crypto.randomUUID(),writeKey:crypto.randomUUID(),completeKey:crypto.randomUUID(),type,stage:'new',body:{collectionId,format,byteSize:file.size,sha256}};
      // Bound completed history; unresolved requests are never removed.
      const retained=jobs().filter(j=>!['completed','failed'].includes(j.stage));
      if(retained.length>=10)throw new Error('请先处理未完成的封面上传。');
      journal.update({coverJobs:[...retained,...jobs().filter(j=>['completed','failed'].includes(j.stage)).slice(-20),job]});
      return resume(job,file);
    },resume };
}
