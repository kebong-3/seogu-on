import {gate,send,fail} from '../server/city/common.js';
import {readProvider} from '../server/city/providers.js';
const cache=new Map(),inflight=new Map();
export default async function handler(req,res){if(!gate(req,res,150))return;const q=new URL(req.url,'https://local').searchParams;const kind=q.get('kind');const id=[kind,q.get('dong'),q.get('page'),q.get('station'),q.get('q'),q.get('pnu'),q.get('lon'),q.get('lat')].join('|');const ttl=['cctv','events'].includes(kind)?60000:['air','forecast'].includes(kind)?300000:1800000;
 try{const old=cache.get(id);if(old&&Date.now()-old.at<ttl){send(res,200,{...old.body,cacheState:'cached'});return;}let job=inflight.get(id);if(!job){job=readProvider(kind,q);inflight.set(id,job);}try{const body=await job;if(cache.size>300)cache.delete(cache.keys().next().value);cache.set(id,{at:Date.now(),body});send(res,200,{...body,cacheState:'fresh'});}catch(e){if(old&&Date.now()-old.at<24*3600000&&['heat','emergency','accidents','air-stations'].includes(kind)){send(res,200,{...old.body,stale:true,cacheState:'last-good',warning:'갱신 실패 · 마지막 정상 자료입니다.'});return;}throw e;}finally{inflight.delete(id);}}
 catch(e){fail(res,e);}}
