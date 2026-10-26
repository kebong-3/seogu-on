/** TMAP pedestrian results are transient. Requests never select a URL or supply credentials. */
import {respond,allowRead} from './http.js';
import {readBody,crossOrigin} from './ai/ask.js';
import {registeredRegionId} from '../shared/region-catalog.js';
import {pointInRegion} from '../shared/region-profile.js';
import {loadWalkCandidates} from './walk-candidates.js';
import {rankWalkCandidates,walkDistance as distance,walkCandidateSupportsMode} from '../shared/walk-route-model.js';

const ENDPOINT='https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1';
const MAX_BODY=50*1024,MAX_UPSTREAM=1024*1024,MAX_DISTANCE=10000,TTL=30*60000;
const MODES=new Set(['shade','safety','care','inspection']);
const minuteBuckets=new Map();let dayBucket={day:'',calls:0};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const xy=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
const clean=(value,max=240)=>typeof value==='string'?value.trim().slice(0,max):'';
class WalkRouteError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const bad=(status,code,message)=>new WalkRouteError(status,code,message);
const limits={perMinute:3,maxCallsPerRequest:3,maxDistanceMeters:MAX_DISTANCE,resultTtlSeconds:TTL/1000,
  rateLimitScope:'서버 인스턴스 메모리 기준의 보조 한도입니다. 제공기관 계정 전체·다른 인스턴스의 호출량을 합산하지 않습니다.'};
const baseWarnings=[
  '거리·시간은 TMAP 보행경로 응답값입니다. 현재 통행 가능·안전·그늘·유모차·휠체어 접근성을 보장하지 않습니다.',
  '경유 후보는 공개자료 대표위치입니다. 출입구·운영시간·이용자격·현장 통행조건을 확인하세요.',
  '결과는 최대 30분만 화면에서 사용합니다. 경로 원문을 다운로드하거나 장기 보관하지 않습니다.',
];

export function resetWalkRouteLimits(){minuteBuckets.clear();dayBucket={day:'',calls:0};}
function keyFor(env){const key=(typeof env.TMAP_API_KEY==='string'?env.TMAP_API_KEY.trim():'')||(typeof env.TMAP_APP_KEY==='string'?env.TMAP_APP_KEY.trim():'');if(key&&(/\r|\n|\u0000/.test(key)||key.length>2048))throw bad(503,'TMAP_CONFIG_INVALID','TMAP 인증 설정 형식을 확인하세요.');return key;}
function dailyLimit(env){const raw=env.TMAP_DAILY_LIMIT;if(raw===undefined||raw==='')return 300;if(!/^\d+$/.test(String(raw)))throw bad(503,'TMAP_CONFIG_INVALID','TMAP_DAILY_LIMIT은 0~1000 정수로 설정하세요.');const n=Number(raw);if(!Number.isSafeInteger(n)||n<0||n>1000)throw bad(503,'TMAP_CONFIG_INVALID','TMAP_DAILY_LIMIT은 0~1000 정수로 설정하세요.');return n;}
function takeCall(env,now){const cap=dailyLimit(env),day=new Date(now+9*3600000).toISOString().slice(0,10);if(dayBucket.day!==day)dayBucket={day,calls:0};if(dayBucket.calls>=cap)throw bad(429,'TMAP_DAILY_LIMIT','오늘의 도보경로 호출 한도에 도달했습니다.');dayBucket.calls++;}
function takeRequest(req,now){
  const ip=String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'anonymous').split(',')[0].trim().slice(0,160);
  let bucket=minuteBuckets.get(ip);if(!bucket||now-bucket.at>=60000){bucket={at:now,count:0};minuteBuckets.set(ip,bucket);}
  if(++bucket.count>3)return false;
  if(minuteBuckets.size>5000){for(const [key,value]of minuteBuckets)if(now-value.at>=60000)minuteBuckets.delete(key);while(minuteBuckets.size>5000)minuteBuckets.delete(minuteBuckets.keys().next().value);}
  return true;
}
function input(body){
  const keys=new Set(['regionId','mode','start','end','avoidStairs','viaIds']);
  if(!plain(body)||Object.keys(body).some(key=>!keys.has(key)))throw bad(400,'INVALID_WALK_REQUEST','도보 요청에는 지역·출발·도착·검토유형·계단옵션·공개 후보 ID만 사용할 수 있습니다.');
  const regionId=registeredRegionId(body.regionId??'seogu'),mode=body.mode??'shade';
  if(!MODES.has(mode)||!xy(body.start)||!xy(body.end))throw bad(400,'INVALID_WALK_REQUEST','검토유형과 출발·도착의 경도·위도를 확인하세요.');
  if(body.avoidStairs!==undefined&&typeof body.avoidStairs!=='boolean')throw bad(400,'INVALID_WALK_REQUEST','계단 제외 옵션은 참·거짓 값이어야 합니다.');
  const viaIds=body.viaIds;
  if(viaIds!==undefined&&(!Array.isArray(viaIds)||viaIds.length>(mode==='inspection'?3:2)||viaIds.some(id=>typeof id!=='string'||!id||id.length>240)||new Set(viaIds).size!==viaIds.length))throw bad(400,'INVALID_WALK_REQUEST',mode==='inspection'?'점검 경유지는 중복 없이 3곳까지 순서대로 선택하세요.':'비교할 경유 후보는 중복 없이 2곳까지 선택하세요.');
  return {regionId,mode,start:[...body.start],end:[...body.end],avoidStairs:body.avoidStairs===true,...(viaIds===undefined?{}:{viaIds:[...viaIds]})};
}
function publicCandidate(candidate){return {id:clean(candidate.id),name:clean(candidate.name,180),category:clean(candidate.category,80),coordinate:[...candidate.coordinate],sourceName:clean(candidate.sourceName),sourceDate:clean(candidate.sourceDate,40)||null,note:clean(candidate.note,700),routeEligible:candidate.routeEligible===true,modes:[...MODES].filter(mode=>walkCandidateSupportsMode(candidate,mode))};}
async function candidatesFor(regionId,options){
  const pack=await (options.loadCandidates||loadWalkCandidates)({regionId,env:options.env,publicRoot:options.publicRoot});
  if(pack.profile?.id!==regionId||!Array.isArray(pack.boundaries?.features)||!pack.boundaries.features.length||!Array.isArray(pack.candidates))throw bad(503,'WALK_DATA_UNAVAILABLE','선택 지역의 공개 경유 자료를 준비하지 못했습니다.');
  const ids=new Set(),candidates=[];
  for(const candidate of pack.candidates){if(!plain(candidate)||!clean(candidate.id)||ids.has(candidate.id)||!xy(candidate.coordinate)||!pointInRegion(candidate.coordinate,pack.boundaries))continue;ids.add(candidate.id);candidates.push(publicCandidate(candidate));}
  return {...pack,candidates};
}
async function responseJson(response){
  if(Number(response.headers?.get?.('content-length')||0)>MAX_UPSTREAM)throw bad(502,'TMAP_RESPONSE_TOO_LARGE','도보경로 응답 크기 제한을 초과했습니다.');
  const reader=response.body?.getReader?.();let text;
  if(reader){const chunks=[];let size=0;try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>MAX_UPSTREAM){await reader.cancel();throw bad(502,'TMAP_RESPONSE_TOO_LARGE','도보경로 응답 크기 제한을 초과했습니다.');}chunks.push(Buffer.from(item.value));}text=Buffer.concat(chunks).toString('utf8');}finally{reader.releaseLock();}}
  else if(typeof response.text==='function')text=await response.text();
  else if(typeof response.json==='function')text=JSON.stringify(await response.json());
  else throw bad(502,'TMAP_BAD_RESPONSE','도보경로 응답 형식을 확인하지 못했습니다.');
  if(Buffer.byteLength(text)>MAX_UPSTREAM)throw bad(502,'TMAP_RESPONSE_TOO_LARGE','도보경로 응답 크기 제한을 초과했습니다.');
  try{return JSON.parse(text);}catch{throw bad(502,'TMAP_BAD_RESPONSE','도보경로 제공기관이 JSON이 아닌 응답을 반환했습니다.');}
}
const numeric=value=>typeof value==='number'?value:typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;
function lineDistance(point,line){
  let closest=Infinity;const xScale=Math.cos(point[1]*Math.PI/180);
  for(let index=1;index<line.length;index++){
    const a=line[index-1],b=line[index],dx=(b[0]-a[0])*xScale,dy=b[1]-a[1],length=dx*dx+dy*dy;
    const fraction=length?Math.max(0,Math.min(1,((point[0]-a[0])*xScale*dx+(point[1]-a[1])*dy)/length)):0;
    closest=Math.min(closest,distance(point,[a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction]));
  }
  return closest;
}
function validatedRoute(body,spec,request){
  if(body?.type!=='FeatureCollection'||!Array.isArray(body.features)||!body.features.length||body.features.length>5000)throw bad(502,'TMAP_BAD_RESPONSE','도보경로 도형과 합계 응답을 확인하지 못했습니다.');
  const totals=[body.properties,...body.features.map(feature=>feature?.properties)].filter(plain);
  const readTotal=key=>{const values=totals.filter(p=>Object.hasOwn(p,key)).map(p=>numeric(p[key]));if(!values.length||values.some(n=>!Number.isFinite(n)||n<=0)||new Set(values).size!==1)throw bad(502,'TMAP_BAD_RESPONSE','제공기관 도보거리·시간의 합계가 없거나 일치하지 않습니다.');return values[0];};
  const distanceMeters=readTotal('totalDistance'),durationSeconds=readTotal('totalTime');
  if(distanceMeters>MAX_DISTANCE||durationSeconds>18000)throw bad(422,'WALK_ROUTE_TOO_LONG','이번 조회는 실제 도보거리 10km 이내의 경로만 지원합니다.');
  let vertices=0;const features=[],lines=[];
  for(const raw of body.features){
    const geometry=raw?.geometry;if(!plain(geometry)||!['Point','LineString'].includes(geometry.type))throw bad(502,'TMAP_BAD_RESPONSE','지원하지 않는 보행경로 도형입니다.');
    const points=geometry.type==='Point'?[geometry.coordinates]:geometry.coordinates;
    if(!Array.isArray(points)||(geometry.type==='LineString'&&points.length<2)||points.some(p=>!xy(p)||p[0]<124||p[0]>132||p[1]<32||p[1]>40)||(vertices+=points.length)>20000)throw bad(502,'TMAP_BAD_RESPONSE','보행경로의 WGS84 좌표·도형 범위를 확인하지 못했습니다.');
    if(geometry.type==='LineString')lines.push(points);
    const properties={};for(const key of ['name','description'])if(typeof raw.properties?.[key]==='string')properties[key]=raw.properties[key].slice(0,600);
    if(typeof raw.properties?.pointType==='string'&&/^[A-Z0-9_-]{1,20}$/.test(raw.properties.pointType))properties.pointType=raw.properties.pointType;
    for(const key of ['index','pointIndex','lineIndex','turnType'])if(Number.isFinite(raw.properties?.[key]))properties[key]=raw.properties[key];
    features.push({type:'Feature',geometry:{type:geometry.type,coordinates:geometry.type==='Point'?[...points[0]]:points.map(p=>[...p])},properties});
  }
  if(!lines.length||distance(lines[0][0],request.start)>200||distance(lines.at(-1).at(-1),request.end)>200)throw bad(502,'TMAP_LOCATION_MISMATCH','출발·도착과 제공기관 경로 위치가 일치하는지 확인하지 못했습니다.');
  for(let index=1;index<lines.length;index++)if(distance(lines[index-1].at(-1),lines[index][0])>100)throw bad(502,'TMAP_LOCATION_MISMATCH','제공기관 도보경로의 선분이 연속되는지 확인하지 못했습니다.');
  for(const via of spec.via)if(!lines.some(line=>lineDistance(via.coordinate,line)<=100))throw bad(502,'TMAP_LOCATION_MISMATCH','선택한 공개 경유지 100m 이내에 제공기관 경로가 연결되는지 확인하지 못했습니다.');
  return {id:spec.id,label:spec.label,role:spec.role,distanceMeters,durationSeconds,geojson:{type:'FeatureCollection',features},via:spec.via};
}
async function fetchRoute(spec,request,context){
  takeCall(context.env,context.now);
  const controller=new AbortController(),timeout=Math.max(1,Math.min(context.timeoutMs,context.deadline-Date.now()));let timer;
  const body={startX:String(request.start[0]),startY:String(request.start[1]),endX:String(request.end[0]),endY:String(request.end[1]),reqCoordType:'WGS84GEO',resCoordType:'WGS84GEO',startName:encodeURIComponent('출발지'),endName:encodeURIComponent('도착지'),searchOption:request.avoidStairs?'30':'10'};
  if(spec.via.length)body.passList=spec.via.map(p=>p.coordinate.join(',')).join('_');
  const operation=(async()=>{
    const response=await context.fetcher(ENDPOINT,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',appKey:context.key},body:JSON.stringify(body),redirect:'error',signal:controller.signal});
    if(!response.ok)throw bad(response.status===429?429:502,response.status===401||response.status===403?'TMAP_AUTH_REJECTED':response.status===429?'TMAP_UPSTREAM_LIMIT':'TMAP_UPSTREAM_ERROR',response.status===401||response.status===403?'TMAP 키와 보행자 경로 서비스 승인을 확인하세요.':response.status===429?'TMAP 제공기관 호출 한도에 도달했습니다.':'TMAP 보행경로 요청이 처리되지 않았습니다.');
    return validatedRoute(await responseJson(response),spec,request);
  })();
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(bad(504,'TMAP_TIMEOUT','도보경로 응답 시간이 초과되었습니다.'));},timeout);})]);}
  catch(error){if(error instanceof WalkRouteError)throw error;throw bad(502,'TMAP_UNAVAILABLE','도보경로 제공기관에 연결하지 못했습니다.');}
  finally{clearTimeout(timer);}
}

export async function runWalkRoutes(body,options={}){
  const request=input(body),env=options.env||process.env,now=options.now??Date.now(),key=keyFor(env);
  if(!key)throw bad(503,'TMAP_NOT_CONFIGURED','Vercel에 TMAP_API_KEY를 등록하고 재배포하세요.');
  const pack=await candidatesFor(request.regionId,{...options,env});
  if(!pointInRegion(request.start,pack.boundaries)||!pointInRegion(request.end,pack.boundaries))throw bad(400,'WALK_OUTSIDE_REGION','출발·도착은 선택한 지역의 실제 행정경계 안에서 지정하세요.');
  const directDistance=distance(request.start,request.end);
  if(directDistance<10||directDistance>MAX_DISTANCE)throw bad(400,'WALK_DISTANCE_LIMIT','출발·도착은 서로 10m 이상, 직선거리 10km 이내로 지정하세요.');
  const eligible=pack.candidates.filter(candidate=>walkCandidateSupportsMode(candidate,request.mode)&&distance(request.start,candidate.coordinate)>=10&&distance(request.end,candidate.coordinate)>=10);
  let via=[];
  if(request.viaIds!==undefined){via=request.viaIds.map(id=>{const candidate=eligible.find(p=>p.id===id);if(!candidate)throw bad(400,'WALK_INVALID_VIA','이 지역의 공개 접근을 확인할 수 있는 경유 후보를 선택하세요. 비상벨 등 참고 위치는 경유할 수 없습니다.');return candidate;});}
  else if(request.mode!=='inspection')via=rankWalkCandidates(eligible,{start:request.start,end:request.end,mode:request.mode,limit:2}).map(candidate=>eligible.find(p=>p.id===candidate.id)).filter(Boolean).slice(0,2);
  if(new Set(via.map(candidate=>candidate.coordinate.join(','))).size!==via.length)throw bad(400,'WALK_INVALID_VIA','같은 위치의 공개 경유 후보를 중복 선택할 수 없습니다.');
  const specs=[{id:'direct',label:'직접 도보경로',role:'direct',via:[]}],warnings=[...baseWarnings,...(pack.limitations||[])];
  if(request.mode==='inspection'&&via.length)specs.push({id:'inspection',label:'선택 순서대로 점검 경유',role:'via',via});
  else for(const [index,candidate]of via.entries())specs.push({id:`via-${index+1}`,label:`${candidate.name} 경유`,role:'via',via:[candidate]});
  const validSpecs=specs.filter(spec=>{let last=request.start,length=0;for(const p of spec.via){length+=distance(last,p.coordinate);last=p.coordinate;}length+=distance(last,request.end);if(length>MAX_DISTANCE){if(request.viaIds!==undefined)throw bad(400,'WALK_DISTANCE_LIMIT','선택한 경유지를 포함한 직선 이동거리 합계가 10km를 넘습니다.');warnings.push(`${spec.label}: 조회 거리 범위를 넘어 경유안에서 제외했습니다.`);return false;}return true;});
  const context={env,key,now,fetcher:options.fetcher||fetch,timeoutMs:Math.max(1,Math.min(7000,options.timeoutMs??7000)),deadline:Date.now()+18000};
  const outcomes=await Promise.allSettled(validSpecs.slice(0,3).map(spec=>fetchRoute(spec,request,context))),routes=[];
  for(const [index,outcome]of outcomes.entries()){if(outcome.status==='fulfilled')routes.push(outcome.value);else warnings.push(`${validSpecs[index].label}: ${outcome.reason?.message&&outcome.reason?.code?outcome.reason.message:'제공기관 경로를 받지 못했습니다.'} 직선 경로로 대체하지 않았습니다.`);}
  if(!routes.length){const failure=outcomes.find(outcome=>outcome.status==='rejected')?.reason;if(failure?.code)throw failure;throw bad(502,'TMAP_UNAVAILABLE','도보경로를 받지 못했습니다. 잠시 후 다시 조회하세요.');}
  if(request.avoidStairs)warnings.push('계단 제외 옵션을 제공기관에 요청했습니다. 실제 계단·공사·횡단시설과 이동약자 이용 가능 여부는 현장에서 확인하세요.');
  if(!via.length)warnings.push(request.mode==='inspection'?'점검 경유지를 선택하지 않아 직접 도보경로만 조회했습니다.':'이번 조건에 맞는 경유 후보가 없어 직접 도보경로만 조회했습니다.');
  routes.sort((a,b)=>a.role==='direct'?-1:b.role==='direct'?1:a.distanceMeters-b.distanceMeters||a.durationSeconds-b.durationSeconds);
  const result={ok:true,requestedAt:new Date(now).toISOString(),expiresAt:new Date(now+TTL).toISOString(),mode:request.mode,region:{id:pack.profile.id,name:pack.profile.name},routes,candidates:via,warnings,limits:{...limits,dailyCallsPerInstance:dailyLimit(env)}};
  if(Buffer.byteLength(JSON.stringify(result))>3*1024*1024)throw bad(502,'TMAP_RESPONSE_TOO_LARGE','경로 비교 결과가 응답 크기 제한을 초과했습니다. 조회 거리를 줄여 주세요.');
  return result;
}

export async function handleWalkRoutes(req,res,options={}){
  res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');respond(res,405,{ok:false,code:'METHOD_NOT_ALLOWED',error:'GET 또는 POST 요청을 사용하세요.'});return;}
  if(crossOrigin(req)){respond(res,403,{ok:false,code:'CROSS_ORIGIN',error:'다른 웹사이트의 요청은 허용하지 않습니다.'});return;}
  if(req.method==='GET'&&!allowRead(req,res))return;
  if(req.method==='POST'&&!takeRequest(req,options.now??Date.now())){res.setHeader('Retry-After','60');respond(res,429,{ok:false,code:'WALK_RATE_LIMIT',error:'도보경로 비교는 1분에 3번까지 요청할 수 있습니다.'});return;}
  try{
    const env=options.env||process.env;
    if(req.method==='GET'){
      const url=new URL(req.url||'/api/walk-routes','https://local.invalid'),regionId=registeredRegionId(url.searchParams.get('region')||'seogu'),pack=await candidatesFor(regionId,{...options,env});
      let configured=false;try{configured=!!keyFor(env);}catch{}
      respond(res,200,{ok:true,configured,region:{id:pack.profile.id,name:pack.profile.name},candidates:pack.candidates.slice(0,5000),candidateCount:pack.candidates.length,truncated:pack.candidates.length>5000,warnings:[...baseWarnings,...(pack.limitations||[])],limits:{...limits,dailyCallsPerInstance:dailyLimit(env)}});return;
    }
    if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type']||'')))throw bad(415,'JSON_REQUIRED','도보경로 요청은 application/json으로 보내세요.');
    respond(res,200,await runWalkRoutes(await readBody(req,{maxBytes:MAX_BODY}),{...options,env}));
  }catch(error){respond(res,error.status||503,{ok:false,code:error.code||'WALK_UNAVAILABLE',error:error.code&&error.status?error.message:'도보경로 자료를 준비하지 못했습니다. 잠시 후 다시 조회하세요.'});}
}
