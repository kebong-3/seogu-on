import {fetchJsonLimited} from './http.js';
import {keyCandidates,diagnose} from './diagnostics.js';
// KMA published Lambert conformal grid conversion; 5 km grid, not point observations.
export function kmaGrid(lon,lat){
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<126.7||lon>127.05||lat<34.98||lat>35.35)throw Error('지역 좌표 범위를 확인하세요.');
  const rad=Math.PI/180,re=6371.00877/5,slat1=30*rad,slat2=60*rad,olon=126*rad,olat=38*rad;
  let sn=Math.log(Math.cos(slat1)/Math.cos(slat2))/Math.log(Math.tan(Math.PI/4+slat2/2)/Math.tan(Math.PI/4+slat1/2));
  const sf=Math.pow(Math.tan(Math.PI/4+slat1/2),sn)*Math.cos(slat1)/sn,ro=re*sf/Math.pow(Math.tan(Math.PI/4+olat/2),sn);
  const ra=re*sf/Math.pow(Math.tan(Math.PI/4+lat*rad/2),sn),theta=(lon*rad-olon)*sn;
  return {nx:Math.floor(ra*Math.sin(theta)+43+.5),ny:Math.floor(ro-ra*Math.cos(theta)+136+.5)};
}
export function weatherBase(now=new Date()){
  // Use the hour at least 50 minutes old. Never pretend collection time is observation time.
  const t=new Date(now.getTime()+9*3600000-50*60000);
  return {base_date:t.toISOString().slice(0,10).replaceAll('-',''),base_time:String(t.getUTCHours()).padStart(2,'0')+'00'};
}
const cache=new Map();
export async function readWeather(lon,lat,{fetcher=fetch,now=new Date(),env=process.env}={}){
  const keys=keyCandidates(env.KMA_SERVICE_KEY,env.DATA_GO_KR_SERVICE_KEY);if(!keys.length)throw Error('KEY_MISSING');
  const grid=kmaGrid(lon,lat),base=weatherBase(now),id=JSON.stringify([grid,base]);
  if(cache.has(id))return cache.get(id);
  let raw,lastError;
  for(const [index,key] of keys.entries()){
   const url=new URL('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst');let decoded=key;try{decoded=decodeURIComponent(key);}catch{}
   for(const [k,v] of Object.entries({...grid,...base,serviceKey:decoded,pageNo:1,numOfRows:100,dataType:'JSON'}))url.searchParams.set(k,String(v));
   try{const candidate=await fetchJsonLimited(url,6000,fetcher);if(candidate.response?.header?.resultCode!=='00')throw Error('KMA_RESULT_'+String(candidate.response?.header?.resultCode||'MISSING').replace(/[^A-Z0-9_-]/gi,'').slice(0,24));raw=candidate;break;}
   catch(e){lastError=e;console.warn('[weather] key candidate',index===0?'primary':'fallback',String(e.message||'UNKNOWN').replace(/[^A-Z0-9_-]/gi,'').slice(0,64));if(!['KEY_REJECTED','ACCESS_DENIED','QUOTA_EXCEEDED'].includes(diagnose(e)?.code))break;}
  }
  if(!raw)throw lastError;
  const items=raw.response?.body?.items?.item;if(!Array.isArray(items)||!items.length)throw Error('NO_OBSERVATIONS');
  const accepted=['T1H','RN1','REH','WSD','VEC','PTY'];const values={};for(const r of items){if(r.baseDate!==base.base_date||r.baseTime!==base.base_time)throw Error('OBSERVATION_TIME_MISMATCH');if(accepted.includes(r.category)&&r.obsrValue!==null&&r.obsrValue!==undefined&&String(r.obsrValue).trim()!==''&&Number.isFinite(Number(r.obsrValue))&&Number(r.obsrValue)>-100&&Number(r.obsrValue)<1000)values[r.category]=Number(r.obsrValue);}
  if(!Object.keys(values).length)throw Error('NO_OBSERVATIONS');
  const result={ok:true,grid,base,values,sourceName:'기상청 초단기실황',sourceUrl:'https://www.data.go.kr/data/15084084/openapi.do',fetchedAt:now.toISOString(),note:'5km 격자 실황. 선택한 동 전체의 실측값이나 재난 예측이 아닙니다.'};
  if(cache.size>40)cache.clear();cache.set(id,result);return result;
}
