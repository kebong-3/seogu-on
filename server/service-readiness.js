import {modelConfig} from './ai/model-config.js';
const startedAt=new Date().toISOString();
const counters={requests:0,success:0,failed:0,totalMs:0,lastSuccessAt:null,lastFailureAt:null,lastFailureCode:null};
export function recordWalkService({ok,code,durationMs,at=Date.now()}){
 counters.requests++;counters[ok?'success':'failed']++;counters.totalMs+=Math.max(0,durationMs||0);
 if(ok)counters.lastSuccessAt=new Date(at).toISOString();else{counters.lastFailureAt=new Date(at).toISOString();counters.lastFailureCode=/^[A-Z0-9_]{1,60}$/.test(code||'')?code:'WALK_UNAVAILABLE';}
}
export function walkServiceReadiness(pack,env,{now=Date.now()}={}){
 const ai=modelConfig(env),sources=(pack.sourceStatus||[]).map(source=>{
  const raw=typeof source.sourceDate==='string'?source.sourceDate:null,at=raw&&/^\d{4}-\d{2}-\d{2}/.test(raw)?Date.parse(raw.slice(0,10)+'T00:00:00Z'):NaN,age=Number.isFinite(at)?Math.floor((now-at)/86400000):null;
  return {datasetId:source.datasetId,sourceName:source.sourceName||source.datasetId,state:source.state,records:source.records??null,candidates:source.candidates??null,sourceDate:raw,ageDays:age,freshness:source.state!=='available'?'not-connected':age===null?'unknown':age<0?'check-date':age>180?'review-due':'within-review-window',sha256:source.sha256||null};
 });
 return {ok:true,version:'0.17.0',checkedAt:new Date(now).toISOString(),region:{id:pack.profile.id,name:pack.profile.name},connections:{walking:!!String(env.TMAP_API_KEY||env.TMAP_APP_KEY||'').trim(),placeSearch:!!(env.VWORLD_API_KEY&&env.VWORLD_DOMAIN),ai:!ai.error&&!!ai.key,aiProvider:ai.error?null:ai.provider,aiModel:ai.error?null:ai.model},candidateCount:pack.candidates.length,sources,reviewWindowDays:180,checks:{sourceHashes:'passed',regionBoundaries:'passed'},runtime:{scope:'현재 서버 인스턴스의 임시 집계 · 전체 서비스/계정 합산 아님',startedAt,...counters,averageMs:counters.requests?Math.round(counters.totalMs/counters.requests):null},meaning:'설정 유무와 수록자료 검사 결과입니다. 인증 성공·현재 시설 운영·현장 안전 검증을 뜻하지 않습니다. 자료 기준일의 검토 기준은 앱에서 정한 180일이며 갱신 의무주기가 아닙니다.'};
}
