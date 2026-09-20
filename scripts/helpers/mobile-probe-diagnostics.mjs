// Test fixture only: fixed labels/categories; never serialize arbitrary errors or values.
import {openSync, writeSync, fsyncSync, closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
const phases=new Set(['startup','seed_account','seed_password','authorize_get','authorize_body','authorize_post','token_exchange','token_body','evidence_session','evidence_operations','refresh','refresh_body','request','response','held','shutdown']);
const codes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','SQLITE_BUSY','SQLITE_LOCKED']);
export function classify(error) {
 const chain=[error,error?.cause], code=chain.map(e=>e?.code).find(c=>codes.has(c))??'OTHER';
 const text=chain.map(e=>typeof e?.message==='string'?e.message:'').join('\n');
 const category=/database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(text)?'database_busy':/timed? ?out|timeout/i.test(text)?'timeout':/fetch failed|socket|connection/i.test(text)?'transport':/D1_ERROR/i.test(text)?'d1':error instanceof SyntaxError?'json':'unknown';
 return {category,code,errorHash:createHash('sha256').update(text).digest('hex')};
}
export function createDiagnostics(path) {
 const fd=openSync(path,'wx',0o600);let bytes=0,seq=0;
 function record(phase,event,error) {
  if(!phases.has(phase)||!['start','done','failed','marker'].includes(event))throw new Error('Invalid fixed diagnostic label');
  const entry={seq:++seq,at:Date.now(),phase,event,...(error?classify(error):{})};
  const line=JSON.stringify(entry)+'\n';
  if(bytes+Buffer.byteLength(line)>262144)return;
  writeSync(fd,line);fsyncSync(fd);bytes+=Buffer.byteLength(line);
 }
 return {record,async step(phase,work){record(phase,'start');try{const value=await work();record(phase,'done');return value;}catch(error){record(phase,'failed',error);throw error;}},close(){closeSync(fd);}};
}
