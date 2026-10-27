/** Bounded, flat-ground building-shadow assessment of supplied walking routes.
 * This module neither searches roads nor estimates temperature, crime or ice probability.
 */
import {solarPosition} from '../src/city/solar.js';
import {walkDistance} from './walk-route-model.js';

const RAD=Math.PI/180,EPS=1e-8;
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
const list=v=>Array.isArray(v)?v:[];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const round=v=>Math.round(v*100)/100;
const fail=(message,code='INVALID_SEASONAL_INPUT')=>Object.assign(new Error(message),{code});
const unique=a=>[...new Set(a)];
function optionsFor(input,internal){
  const number=(value,fallback,min,max)=>value===undefined?fallback:finite(value)&&value>=min&&value<=max?value:(()=>{throw fail('계절 보행모형의 수치 범위를 확인하세요.');})();
  return {sampleMeters:number(input.sampleMeters,20,5,100),minAltitude:number(input.minSolarAltitude,10,5,30),heightCeiling:number(input.maxBuildingHeightMeters,300,20,500),cellMeters:100,
    includeLevels:input.includeLevels===true,icingRadius:number(input.icingRadiusMeters,50,5,200),lowSunMinutes:number(input.lowSunThresholdMinutes,120,30,360),minimumCoverage:number(input.minimumCoverageRatio,.9,.5,1),
    maxSamples:Math.floor(number(internal.maxSamples,1800,1,5000)),maxOperations:Math.floor(number(internal.maxOperations,2000000,100,20000000)),runtimeMs:number(internal.runtimeMs,2200,0,3000),
    sunAt:typeof internal.sunAt==='function'?internal.sunAt:solarPosition,now:typeof internal.now==='function'?internal.now:Date.now};
}
function budgetFor(options){const start=options.now();let operations=0;return {check(count=1){operations+=count;if(operations>options.maxOperations||options.now()-start>options.runtimeMs)throw fail('계절모형 계산 한도를 넘어 평가를 보류했습니다.','SEASONAL_BUDGET');},get operations(){return operations;}};}
function parseDeparture(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const date=new Date(value);if(!Number.isFinite(+date)||date.getUTCFullYear()<2000||date.getUTCFullYear()>2100)return null;
  // Date.parse normalizes impossible calendar dates; compare the local date in the supplied offset.
  const offset=value.endsWith('Z')?0:(value.at(-6)==='-'?-1:1)*(Number(value.slice(-5,-3))*60+Number(value.slice(-2)));
  if(Math.abs(offset)>14*60||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||new Date(+date+offset*60000).toISOString().slice(0,16)!==value.slice(0,16))return null;
  return date;
}
function projection(origin){const sx=111320*Math.cos(origin[1]*RAD),sy=111320;return {to:p=>[(p[0]-origin[0])*sx,(p[1]-origin[1])*sy],from:p=>[origin[0]+p[0]/sx,origin[1]+p[1]/sy]};}
function bbox(points){return points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);}
function geometryPolygons(geometry,project,budget){
  const raw=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:null;
  if(!Array.isArray(raw)||!raw.length)throw fail('건물 또는 평가범위 도형은 Polygon/MultiPolygon이어야 합니다.','SEASONAL_GEOMETRY');
  return raw.map(rings=>{
    if(!Array.isArray(rings)||!rings.length)throw fail('도형의 고리 형식을 확인하세요.','SEASONAL_GEOMETRY');
    return rings.map(ring=>{budget.check(ring?.length||1);if(!Array.isArray(ring)||ring.length<4||!ring.every(validPoint)||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw fail('건물 또는 평가범위의 닫힌 WGS84 고리를 확인하세요.','SEASONAL_GEOMETRY');return ring.map(project.to);});
  });
}
function onSegment(p,a,b){const cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);return Math.abs(cross)<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;}
function ringContains(p,ring,budget){let inside=false;budget.check(ring.length);for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(onSegment(p,a,b))return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function contains(p,polygons,budget){return polygons.some(rings=>ringContains(p,rings[0],budget)&&!rings.slice(1).some(r=>ringContains(p,r,budget)));}
function cuts(a,b,c,d){const x=b[0]-a[0],y=b[1]-a[1],u=d[0]-c[0],v=d[1]-c[1],den=x*v-y*u;if(Math.abs(den)<EPS)return null;const t=((c[0]-a[0])*v-(c[1]-a[1])*u)/den,s=((c[0]-a[0])*y-(c[1]-a[1])*x)/den;return t>=0&&t<=1&&s>=0&&s<=1?t:null;}
function intervalsInside(a,b,polygons,budget){
  const ts=[0,1];for(const rings of polygons)for(const ring of rings){budget.check(ring.length);for(let i=1;i<ring.length;i++){const t=cuts(a,b,ring[i-1],ring[i]);if(t!==null)ts.push(t);}}
  const sorted=unique(ts).sort((x,y)=>x-y),inside=[];
  for(let i=1;i<sorted.length;i++){const low=sorted[i-1],high=sorted[i];if(high-low<EPS)continue;const mid=(low+high)/2,p=[a[0]+(b[0]-a[0])*mid,a[1]+(b[1]-a[1])*mid];if(contains(p,polygons,budget))inside.push([low,high]);}
  return inside;
}
function spatialIndex(buildings,cell,budget){
  const map=new Map();for(let index=0;index<buildings.length;index++){const b=buildings[index].bounds;for(let x=Math.floor(b[0]/cell);x<=Math.floor(b[2]/cell);x++)for(let y=Math.floor(b[1]/cell);y<=Math.floor(b[3]/cell);y++){budget.check();const key=`${x}:${y}`;if(!map.has(key))map.set(key,[]);map.get(key).push(index);}}
  return {near(p){return map.get(`${Math.floor(p[0]/cell)}:${Math.floor(p[1]/cell)}`)||[];},ray(a,b){const ids=new Set(),length=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.ceil(length/(cell/2));for(let i=0;i<=steps;i++){budget.check();const p=[a[0]+(b[0]-a[0])*i/Math.max(1,steps),a[1]+(b[1]-a[1])*i/Math.max(1,steps)],x=Math.floor(p[0]/cell),y=Math.floor(p[1]/cell);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const id of map.get(`${x+dx}:${y+dy}`)||[])ids.add(id);}return [...ids];}};
}
function buildingModel(raw,project,options,budget){
  if(raw?.type!=='FeatureCollection'||!Array.isArray(raw.features))throw fail('건물자료가 연결되지 않았습니다.','SEASONAL_BUILDINGS_MISSING');
  if(raw.features.length>15000)throw fail('건물모형의 항목 수 한도를 넘었습니다.','SEASONAL_BUDGET');
  const counts={total:raw.features.length,sourceHeight:0,estimatedHeight:0,unknownHeight:0};
  const buildings=raw.features.map((feature,i)=>{
    const polygons=geometryPolygons(feature.geometry,project,budget),p=feature.properties||{},basis=p.heightBasis||p.heightStatus;
    const value=Object.hasOwn(p,'heightM')?p.heightM:p.height,known=['tagged','surveyed','source','verified'].includes(basis),estimated=['levels-estimate','estimated'].includes(basis),valid=finite(value)&&value>0&&value<=options.heightCeiling;
    const height=valid&&(known||estimated&&options.includeLevels)?value:null;
    if(height===null)counts.unknownHeight++;else if(estimated)counts.estimatedHeight++;else counts.sourceHeight++;
    return {id:String(p.id??feature.id??`building-${i}`),polygons,bounds:bbox(polygons.flat(2)),height,estimated:estimated&&height!==null};
  });
  return {buildings,counts,index:spatialIndex(buildings,options.cellMeters,budget)};
}
function routePath(route,project,budget){
  if(!route||typeof route.id!=='string'||!route.id||!finite(route.distanceMeters)||route.distanceMeters<=0||route.distanceMeters>15000||!finite(route.durationSeconds)||route.durationSeconds<=0||route.durationSeconds>18000)throw fail('경로의 식별자·제공기관 거리·시간을 확인하세요.','SEASONAL_ROUTE_INVALID');
  const rawLines=list(route.geojson?.features).flatMap(f=>f?.geometry?.type==='LineString'?[f.geometry.coordinates]:f?.geometry?.type==='MultiLineString'?f.geometry.coordinates:[]);
  if(!rawLines.length)throw fail('실제 제공기관 경로 선형이 없습니다.','SEASONAL_ROUTE_INVALID');
  const segments=[];let total=0,last=null,vertices=0;
  for(const line of rawLines){if(!Array.isArray(line)||line.length<2||!line.every(validPoint)||(vertices+=line.length)>20000)throw fail('도보경로의 좌표·꼭짓점 수를 확인하세요.','SEASONAL_ROUTE_INVALID');
    if(last&&walkDistance(last,line[0])>.5)throw fail('분리된 경로 선형의 사이를 임의로 연결하지 않았습니다.','SEASONAL_ROUTE_GAP');
    for(let i=1;i<line.length;i++){budget.check();const length=walkDistance(line[i-1],line[i]);if(length>0){segments.push({a:line[i-1],b:line[i],pa:project.to(line[i-1]),pb:project.to(line[i]),length,start:total,end:total+length});total+=length;}}
    last=line.at(-1);
  }
  if(total<=0||total>15000)throw fail('도보경로의 실제 선형 길이를 확인하세요.','SEASONAL_ROUTE_INVALID');
  // Large disagreement can indicate an incomplete or unrelated geometry.
  if(total<route.distanceMeters*.7||total>route.distanceMeters*1.3)throw fail('제공기관 합계 거리와 경로 선형의 길이가 크게 다릅니다.','SEASONAL_DISTANCE_MISMATCH');
  return {segments,total};
}
function pointAlong(path,along){let low=0,high=path.segments.length-1;while(low<high){const mid=(low+high)>>1;if(path.segments[mid].end<along)low=mid+1;else high=mid;}const segment=path.segments[low],t=Math.max(0,Math.min(1,(along-segment.start)/segment.length));return {coordinate:[segment.a[0]+(segment.b[0]-segment.a[0])*t,segment.a[1]+(segment.b[1]-segment.a[1])*t],metric:[segment.pa[0]+(segment.pb[0]-segment.pa[0])*t,segment.pa[1]+(segment.pb[1]-segment.pa[1])*t]};}
function classifyPoint(point,date,model,coverage,project,options,budget){
  budget.check();const sun=options.sunAt(date,...point.coordinate);
  if(!sun||!finite(sun.altitude)||!finite(sun.azimuth))return {state:'unknown',reason:'solar-unavailable',modelNoShade:false};
  if(sun.altitude<=0)return {state:'unknown',reason:'night',modelNoShade:false};
  if(sun.altitude<options.minAltitude)return {state:'unknown',reason:'low-sun',modelNoShade:false};
  const a=point.metric,length=options.heightCeiling/Math.tan(sun.altitude*RAD),b=[a[0]+Math.sin(sun.azimuth*RAD)*length,a[1]+Math.cos(sun.azimuth*RAD)*length];
  for(const index of model.index.near(a))if(contains(a,model.buildings[index].polygons,budget))return {state:'unknown',reason:'inside-building-footprint',modelNoShade:false};
  let unknown=false,estimated=false;
  for(const index of model.index.ray(a,b)){
    const building=model.buildings[index],interval=intervalsInside(a,b,building.polygons,budget)[0];if(!interval)continue;
    if(building.height===null){unknown=true;continue;}
    if(interval[0]*length*Math.tan(sun.altitude*RAD)<=building.height){estimated=building.estimated;return {state:'shade',estimated,buildingId:building.id,modelNoShade:false};}
  }
  if(unknown)return {state:'unknown',reason:'unknown-height-toward-sun',modelNoShade:true};
  if(!coverage)return {state:'unknown',reason:'coverage-not-declared',modelNoShade:true};
  const inside=intervalsInside(a,b,coverage,budget),covered=inside.reduce((sum,[from,to])=>sum+to-from,0);
  if(covered<1-1e-7)return {state:'unknown',reason:'shadow-search-outside-coverage',modelNoShade:true};
  return {state:'sun',modelNoShade:true};
}
function mergeIntervals(intervals){const sorted=intervals.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]),result=[];for(const current of sorted){const last=result.at(-1);if(last&&current[0]<=last[1]+EPS)last[1]=Math.max(last[1],current[1]);else result.push([...current]);}return result;}
function nearbyIcing(path,raw,project,radius,budget){
  if(raw===null||raw===undefined||['not-connected','unavailable','error'].includes(raw.metadata?.state))return null;
  if(raw.type!=='FeatureCollection'||!Array.isArray(raw.features)||raw.features.length>1000)throw fail('결빙 관리자료 형식·건수를 확인하세요.','SEASONAL_ICING_INVALID');
  if(!raw.features.length&&raw.metadata?.complete!==true)return null;
  const points=raw.features.map(f=>{if(f?.geometry?.type!=='Point'||!validPoint(f.geometry.coordinates))throw fail('결빙 관리점의 원문 대표좌표를 확인하세요.','SEASONAL_ICING_INVALID');return project.to(f.geometry.coordinates);}),intervals=[];
  for(const segment of path.segments)for(const p of points){budget.check();const [ax,ay]=segment.pa,[bx,by]=segment.pb,dx=bx-ax,dy=by-ay,x=ax-p[0],y=ay-p[1],a=dx*dx+dy*dy;if(!a)continue;const b=2*(x*dx+y*dy),c=x*x+y*y-radius*radius,disc=b*b-4*a*c;if(disc<=EPS)continue;const root=Math.sqrt(disc),low=Math.max(0,(-b-root)/(2*a)),high=Math.min(1,(-b+root)/(2*a));if(high>low)intervals.push([segment.start+segment.length*low,segment.start+segment.length*high]);}
  return mergeIntervals(intervals);
}
function overlap(start,end,intervals){let result=0;for(const [a,b]of intervals){if(a>=end)break;if(b>start)result+=Math.max(0,Math.min(end,b)-Math.max(start,a));}return result;}
export function classifyWinterSunMinutes(sunMinutes,unknownMinutes,thresholdMinutes=120){if(![sunMinutes,unknownMinutes,thresholdMinutes].every(finite)||sunMinutes<0||unknownMinutes<0||thresholdMinutes<=0)throw fail('겨울 일조시간 입력을 확인하세요.');return sunMinutes+unknownMinutes<thresholdMinutes?'low':sunMinutes>=thresholdMinutes?'sufficient':'unknown';}
function winterTimes(date){const day=new Date(+date+9*3600000).toISOString().slice(0,10);return {date:day,startHour:9,endHour:16,stepMinutes:60,times:Array.from({length:7},(_,i)=>new Date(`${day}T${String(9+i).padStart(2,'0')}:30:00+09:00`))};}
function deferredRoute(route,reason,length=route?.distanceMeters){const total=finite(length)&&length>0?length:null;return {id:route?.id||null,status:'deferred',solarState:'unavailable',routeLengthMeters:total,distanceBasis:'provider-distance-unassessed',evaluatedMeters:0,unevaluatedMeters:total,estimatedShadeMeters:null,sunlitMeters:null,modelNonShadeMeters:null,coverageRatio:0,lowSunMeters:null,icingNearbyMeters:null,cautionMeters:null,unknownCautionMeters:total,reasons:[reason],samples:[]};}
function assessRoute(route,path,input,model,coverage,project,departure,options,budget){
  const count=Math.ceil(path.total/options.sampleMeters);if(count>options.maxSamples)throw fail('도보경로의 평가 표본 수 한도를 넘었습니다.','SEASONAL_BUDGET');
  const output={id:route.id,status:'assessed',routeLengthMeters:path.total,distanceBasis:'route-geometry-geodesic',providerDistanceMeters:route.distanceMeters,evaluatedMeters:0,unevaluatedMeters:0,estimatedShadeMeters:0,estimatedHeightShadeMeters:0,sunlitMeters:0,modelNonShadeMeters:0,coverageRatio:0,reasons:[],samples:[]};
  const winter=input.mode==='winter'?winterTimes(departure):null,icing=winter?nearbyIcing(path,input.icing,project,options.icingRadius,budget):null;
  if(winter)Object.assign(output,{lowSunMeters:0,sunSufficientMeters:0,winterUnevaluatedMeters:0,icingNearbyMeters:icing===null?null:icing.reduce((sum,[a,b])=>sum+b-a,0),cautionMeters:0,unknownCautionMeters:0,winter:{window:{...winter,times:winter.times.map(d=>d.toISOString())},thresholdMinutes:options.lowSunMinutes,meanSunMinutesLower:0,meanSunMinutesUpper:0}});
  const reasons=new Set(),solarStates=new Set();
  for(let i=0;i<count;i++){
    budget.check();const start=i*options.sampleMeters,end=Math.min(path.total,start+options.sampleMeters),weight=end-start,mid=(start+end)/2,point=pointAlong(path,mid),at=input.shadowTiming==='walk-time'?new Date(+departure+route.durationSeconds*1000*mid/path.total):departure;
    const state=classifyPoint(point,at,model,coverage,project,options,budget);solarStates.add(state.reason==='night'?'night':state.reason==='low-sun'?'low-sun':state.reason==='solar-unavailable'?'unavailable':'day');
    if(state.state==='shade'){output.estimatedShadeMeters+=weight;if(state.estimated)output.estimatedHeightShadeMeters+=weight;}else if(state.state==='sun')output.sunlitMeters+=weight;else{output.unevaluatedMeters+=weight;reasons.add(state.reason);}
    if(state.modelNoShade)output.modelNonShadeMeters+=weight;
    const sample={coordinate:point.coordinate,fromMeters:start,toMeters:end,lengthMeters:weight,state:state.state,at:at.toISOString(),...(state.reason?{reason:state.reason}:{}),...(state.buildingId?{buildingId:state.buildingId,estimatedHeight:state.estimated}: {})};
    if(winter){let sun=0,unknown=0;for(const time of winter.times){const evaluation=classifyPoint(point,time,model,coverage,project,options,budget);if(evaluation.state==='sun')sun+=60;else if(evaluation.state==='unknown')unknown+=60;}
      const classification=classifyWinterSunMinutes(sun,unknown,options.lowSunMinutes);sample.winter={sunMinutesLower:sun,sunMinutesUpper:sun+unknown,unknownMinutes:unknown,classification};
      output.winter.meanSunMinutesLower+=weight*sun/path.total;output.winter.meanSunMinutesUpper+=weight*(sun+unknown)/path.total;
      const near=icing===null?null:overlap(start,end,icing);
      if(classification==='low'){output.lowSunMeters+=weight;output.cautionMeters+=weight;}
      else if(classification==='sufficient')output.sunSufficientMeters+=weight;
      else output.winterUnevaluatedMeters+=weight;
      if(classification!=='low'){output.cautionMeters+=near||0;if(classification==='unknown'||icing===null)output.unknownCautionMeters+=weight-(near||0);}
    }
    output.samples.push(sample);
  }
  output.solarState=solarStates.size===1?[...solarStates][0]:'mixed';
  output.evaluatedMeters=output.estimatedShadeMeters+output.sunlitMeters;output.coverageRatio=output.evaluatedMeters/path.total;output.reasons=[...reasons];
  if(output.unevaluatedMeters>EPS)output.status='partial';
  if(output.evaluatedMeters<=EPS)output.status='deferred';
  if(output.solarState==='night'||output.solarState==='low-sun'||output.solarState==='unavailable'){output.estimatedShadeMeters=null;output.sunlitMeters=null;output.modelNonShadeMeters=null;}
  if(winter&&icing===null)output.reasons.push('icing-data-unavailable');
  for(const key of ['routeLengthMeters','evaluatedMeters','unevaluatedMeters','estimatedShadeMeters','estimatedHeightShadeMeters','sunlitMeters','modelNonShadeMeters','lowSunMeters','sunSufficientMeters','winterUnevaluatedMeters','icingNearbyMeters','cautionMeters','unknownCautionMeters'])if(finite(output[key]))output[key]=round(output[key]);
  if(winter){output.winterCoverageRatio=Math.max(0,Math.min(1,(path.total-output.winterUnevaluatedMeters)/path.total));output.winter.meanSunMinutesLower=round(output.winter.meanSunMinutesLower);output.winter.meanSunMinutesUpper=round(output.winter.meanSunMinutesUpper);}
  return output;
}
function comparisonFor(routes,assessments,input,options,hasCoverage,blocked){
  const none=reason=>({preferredRouteId:null,rankedRouteIds:[],basis:input.mode==='winter'?'모델 시간창의 일조부족·관리점 근접 노출거리':'선택 시각의 모델 내 햇볕 노출거리',reason});
  if(blocked)return none(blocked);
  const baseline=routes.find(r=>r.role==='direct'),base=baseline&&assessments.find(r=>r.id===baseline.id);
  if(!base)return none('direct-route-unavailable');
  if(!hasCoverage)return none('coverage-not-declared');
  if(!finite(input.maxDetourMeters)||input.maxDetourMeters<0||!finite(input.maxDetourMinutes)||input.maxDetourMinutes<0)return none('detour-limits-required');
  const eligible=assessment=>assessment.status!=='deferred'&&assessment.coverageRatio>=options.minimumCoverage&&(input.mode!=='winter'||assessment.icingNearbyMeters!==null&&(assessment.routeLengthMeters-assessment.unknownCautionMeters)/assessment.routeLengthMeters>=options.minimumCoverage);
  if(!eligible(base))return none('baseline-coverage-insufficient');
  const lower=r=>input.mode==='winter'?r.cautionMeters:r.sunlitMeters,upper=r=>lower(r)+(input.mode==='winter'?r.unknownCautionMeters:r.unevaluatedMeters);
  const inBudget=r=>{const original=routes.find(x=>x.id===r.id);return original.distanceMeters-baseline.distanceMeters<=input.maxDetourMeters&&original.durationSeconds-baseline.durationSeconds<=input.maxDetourMinutes*60;};
  if(assessments.some(r=>r.id!==base.id&&inBudget(r)&&!eligible(r)))return none('candidate-coverage-insufficient');
  const choices=assessments.filter(r=>{const original=routes.find(x=>x.id===r.id);return eligible(r)&&original.distanceMeters-baseline.distanceMeters<=input.maxDetourMeters&&original.durationSeconds-baseline.durationSeconds<=input.maxDetourMinutes*60;});
  const ranked=[...choices].sort((a,b)=>upper(a)-upper(b)||lower(a)-lower(b)||routes.find(r=>r.id===a.id).durationSeconds-routes.find(r=>r.id===b.id).durationSeconds);
  const improved=ranked.find(r=>r.id!==base.id&&upper(r)+.01<lower(base));
  if(improved)return {preferredRouteId:improved.id,rankedRouteIds:ranked.map(r=>r.id),basis:input.mode==='winter'?'가정한 일조창·관리점 자료의 주의거리 상한이 직접 경로 하한보다 작음':'입력 건물·이산표본에서 햇볕 노출거리 상한이 직접 경로 하한보다 작음',reason:'model-bounded-improvement'};
  if(choices.filter(r=>r.id!==base.id).every(r=>upper(base)<=lower(r)+.01))return {preferredRouteId:base.id,rankedRouteIds:ranked.map(r=>r.id),basis:'허용 우회조건 안에서 직접 경로보다 확실히 개선된 모델 후보가 없음',reason:'direct-model-preferred'};
  return {...none('model-uncertainty-overlap'),rankedRouteIds:ranked.map(r=>r.id)};
}

export function evaluateSeasonalWalkRoutes(input={},internalOptions={}){
  const options=optionsFor(input,internalOptions),budget=budgetFor(options),routes=list(input.routes);
  if(!['summer','winter'].includes(input.mode)||routes.length<1||routes.length>3||new Set(routes.map(r=>r?.id)).size!==routes.length)throw fail('여름·겨울과 서로 다른 조회 경로 1~3개를 지정하세요.');
  const departure=parseDeparture(input.departureAt),timing=input.shadowTiming||'departure-static';
  if(!['departure-static','walk-time'].includes(timing))throw fail('출발시각 고정 또는 도보 도착시각 평가를 선택하세요.');
  const result={status:'assessed',mode:input.mode,departureAt:departure?.toISOString()||null,timing,model:{name:'flat-ground-vertical-building-ray-model',version:1,sampleMeters:options.sampleMeters,minSolarAltitude:options.minAltitude,maxBuildingHeightMeters:options.heightCeiling,includeLevels:options.includeLevels},coverage:{declared:!!input.coverageGeometry,minimumRatio:options.minimumCoverage,meaning:'입력모형에서 가림 또는 일사를 평가한 이산표본의 거리 비중이며 현실 정확도·확률 신뢰도가 아님'},assumptions:[
    '조회된 TMAP 후보만 평가합니다. 전체 도로망의 최적 경로를 탐색하지 않습니다.',
    '수직 건물·평탄 지면·직달 일사 방향 근사입니다. 지형경사·수목·캐노피·지붕형상·구름·확산광·실측 조도를 반영하지 않습니다.',
    `높이미상 건물의 영향 탐색은 모형 높이 상한 ${options.heightCeiling}m와 최소 태양고도 ${options.minAltitude}도 가정 안에서 수행합니다.`,
    options.includeLevels?'층수×3m 등 원자료의 levels-estimate 높이를 명시적 가정으로 포함했습니다. 실제 측량 높이가 아닙니다.':'높이 태그·측량 등 원자료 높이만 사용하며 층수 추정과 표시 전용 기본높이는 그늘값으로 사용하지 않습니다.',
    timing==='walk-time'?'도보 구간의 선형 거리 비중으로 도착시각을 나누어 태양방향을 재계산합니다. 시설 체류시간·신호대기 차이는 반영하지 않습니다.':'선택한 출발시각을 모든 경로 표본에 동일 적용한 정적 비교입니다.',
    '그늘·일사·미평가 길이는 실제 경로 선형의 표본 가중 길이입니다. 제공기관 합계 도보거리와 구분합니다. 미평가를 햇볕·0노출로 바꾸지 않습니다.',
    '모형 내 비그늘 길이는 알려진 건물그늘이 검출되지 않은 길이이며 현실의 햇볕 길이를 뜻하지 않습니다.',
    ...(input.mode==='winter'?['겨울 누적 일조는 선택한 한국 날짜의 09:00~16:00 창에서 매시 30분의 7개 중간표본으로 계산합니다. 선택 출발시각의 그늘 지표와 별개입니다.','일조부족 기준 120분 등은 이 검토의 설정값입니다. 노면 온도·수분·재질을 반영한 결빙 확률이나 현재 결빙 예측이 아닙니다.',`결빙관리점 ${options.icingRadius}m 근접은 원문 대표점 주변의 거리 합집합입니다. 관리구간 끝점을 도로 선형으로 이어 만들지 않습니다.`]:[]),
  ],routes:[],comparison:null};
  if(!departure){result.status='deferred';result.routes=routes.map(r=>deferredRoute(r,'departure-time-required'));result.comparison=comparisonFor(routes,result.routes,{...input,shadowTiming:timing},options,false,'departure-time-required');return result;}
  let blocked=null;
  try{
    budget.check();const all=routes.flatMap(r=>list(r.geojson?.features).flatMap(f=>f?.geometry?.type==='LineString'?f.geometry.coordinates:f?.geometry?.type==='MultiLineString'?f.geometry.coordinates.flat():[])).filter(validPoint);
    if(!all.length)throw fail('평가할 실제 도보경로 선형이 없습니다.','SEASONAL_ROUTE_INVALID');const b=bbox(all),project=projection([(b[0]+b[2])/2,(b[1]+b[3])/2]);
    const model=buildingModel(input.buildings,project,options,budget),coverage=input.coverageGeometry?geometryPolygons(input.coverageGeometry,project,budget):null;result.model.heightCounts=model.counts;
    for(const route of routes){let path;try{path=routePath(route,project,budget);result.routes.push(assessRoute(route,path,{...input,shadowTiming:timing},model,coverage,project,departure,options,budget));}catch(error){if(error.code==='SEASONAL_BUDGET')throw error;result.routes.push(deferredRoute(route,error.code||'seasonal-unavailable',path?.total));}}
  }catch(error){blocked=error.code||'seasonal-unavailable';result.status='deferred';result.routes=routes.map(route=>deferredRoute(route,blocked));}
  if(result.status!=='deferred'&&result.routes.some(r=>r.status!=='assessed'))result.status='partial';
  result.model.operations=budget.operations;
  result.comparison=comparisonFor(routes,result.routes,{...input,shadowTiming:timing},options,!!input.coverageGeometry,blocked);
  return result;
}
