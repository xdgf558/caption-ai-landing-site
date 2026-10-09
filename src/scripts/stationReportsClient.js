import { contentRequest } from './stationContentClient.js';

// A slow earlier query or a changed Access actor can never repaint new results.
export function createReportLoader({request=contentRequest,verifyActor,onState}={}){
  let generation=0;
  return {async load(input){const id=++generation;onState({loading:true});try{
    const query=new URLSearchParams(input),report=await request('/reports?'+query);if(id!==generation)return false;await verifyActor();
    if(id!==generation)return false;onState({loading:false,report});return true;
  }catch(error){if(id!==generation)return false;onState({loading:false,error});return false;}},dispose(){generation++;}};
}
export const reportNumber=value=>value===null||value===undefined?'暂无数据':new Intl.NumberFormat('zh-Hans').format(value);
export function rateText(rate){return rate?.value===null||rate?.value===undefined?'暂无数据':new Intl.NumberFormat('zh-Hans',{style:'percent',maximumFractionDigits:1}).format(rate.value);}
export const sourceName=value=>value==='direct_or_unknown'?'直接 / 未提供渠道':value==='unknown'?'无法核验的归因':value.startsWith('campaign:')?value.slice(9):value;
export const providerNames={netease:'网易云音乐',qishui:'汽水音乐',apple_music:'Apple Music',spotify:'Spotify',youtube:'YouTube',douyin:'抖音',xiaohongshu:'小红书',bilibili:'哔哩哔哩',instagram:'Instagram'};
// Native datetime-local controls omit ':00' seconds. Always send canonical UTC.
export const reportTimestamp=value=>new Date(value+'Z').toISOString();
