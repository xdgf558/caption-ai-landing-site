// A storage-only codec: IDs, request digests, versions and API response values never change.
import {MobileError} from './security.js';
const keys=(value,names)=>value && !Array.isArray(value) && typeof value==='object' && Object.keys(value).sort().join(',')===[...names].sort().join(',');
const integer=x=>Number.isSafeInteger(x)&&x>=0;
function tuple(value){
 if(keys(value,['accepted'])&&value.accepted===true)return ['r1','listen'];
 if(keys(value,['historyEnabled','historyEpoch','version'])&&typeof value.historyEnabled==='boolean'&&integer(value.historyEpoch)&&integer(value.version))return ['r1','privacy',value.historyEnabled,value.historyEpoch,value.version];
 if(keys(value,['trackId','favorite','version','updatedAt'])&&typeof value.trackId==='string'&&value.trackId.length<=80&&typeof value.favorite==='boolean'&&integer(value.version)&&typeof value.updatedAt==='string'&&Number.isFinite(Date.parse(value.updatedAt)))return ['r1','favorite',value.trackId,value.favorite,value.version,value.updatedAt];
 throw new MobileError('SERVICE_UNAVAILABLE',503);
}
export function encodeLibraryReceipt(value){return JSON.stringify(tuple(value));}
export function decodeLibraryReceipt(stored){
 try {
  const data=JSON.parse(stored);if(!Array.isArray(data)){tuple(data);return data;}
  let value;
  if(data[0]==='r1'&&data[1]==='listen'&&data.length===2)value={accepted:true};
  if(data[0]==='r1'&&data[1]==='privacy'&&data.length===5)value={historyEnabled:data[2],historyEpoch:data[3],version:data[4]};
  if(data[0]==='r1'&&data[1]==='favorite'&&data.length===6)value={trackId:data[2],favorite:data[3],version:data[4],updatedAt:data[5]};
  tuple(value);return value;
 }catch{throw new MobileError('SERVICE_UNAVAILABLE',503);}
}
