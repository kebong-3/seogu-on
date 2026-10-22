import {allowLegacyRegion} from '../server/region-compat.js';
import {gate,send,fail,HttpError} from '../server/city/common.js';
import {readProvider} from '../server/city/providers.js';
import {safetyTTL} from '../server/city/safetydata.js';
const cache=new Map(),inflight=new Map(),cooldowns=new Map();
export default async function handler(req,res){
 if(!allowLegacyRegion(req,res))return;
 if(!gate(req,res,150))return;
 const q=new URL(req.url,'https://local').searchParams,kind=q.get('kind'),safety=kind?.startsWith('sd-');
 const id=[kind,q.get('dong'),q.get('page'),q.get('station'),q.get('observed'),q.get('q'),q.get('pnu'),q.get('lon'),q.get('lat')].join('|');
 const ttl=safety?safetyTTL(kind):['cctv','events'].includes(kind)?60000:['air','forecast'].includes(kind)?300000:1800000;
 try{
  const old=cache.get(id);if(old&&Date.now()-old.at<ttl){send(res,200,{...old.body,cacheState:'cached'});return;}
  const cooling=cooldowns.get(kind);if(cooling&&Date.now()<cooling.until)throw new HttpError(cooling.status,cooling.message,cooling.code);
  let job=inflight.get(id);if(!job){job=readProvider(kind,q);inflight.set(id,job);}
  try{const body=await job;if(cache.size>300)cache.delete(cache.keys().next().value);cache.set(id,{at:Date.now(),body});send(res,200,{...body,cacheState:'fresh'});}
  catch(e){
   if(safety&&/SAFETYDATA_(22|30|31|32|33|34|20)$/.test(e.code||''))cooldowns.set(kind,{until:Date.now()+60000,status:e.status,message:e.message,code:e.code});
   const maxAge=safety?(['sd-aws','sd-road','sd-beds'].includes(kind)?30*60000:24*3600000):24*3600000;
   if(old&&Date.now()-old.at<maxAge&&(safety||['heat','emergency','accidents','air-stations'].includes(kind))){send(res,200,{...old.body,stale:true,cacheState:'last-good',warning:'갱신 실패 · 이전 수신시각의 자료입니다. 현재 상태로 해석하지 마세요.'});return;}throw e;
  }finally{inflight.delete(id);}
 }catch(e){if(['air-stations','air','forecast'].includes(kind))console.warn('[city-data] upstream status',kind,e.code||'UNKNOWN');fail(res,e);}
}
