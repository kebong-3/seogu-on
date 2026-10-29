/** Recorded-location proximity on actual walking geometry; never a crime or safety score. */
import {validCoordinate,pointInRegion} from './region-profile.js';
import {walkDistance} from './walk-route-model.js';

const text=value=>typeof value==='string'?value.trim():'';
const features=value=>value?.type==='FeatureCollection'&&Array.isArray(value.features)?value.features:[];
const korea=point=>validCoordinate(point)&&point[0]>=124&&point[0]<=132&&point[1]>=32&&point[1]<=40;
const project=([lon,lat])=>[lon*111320*Math.cos(35*Math.PI/180),lat*111320];
const uncertainty=properties=>Number.isFinite(properties?.uncertaintyMeters)&&properties.uncertaintyMeters>=0&&properties.uncertaintyMeters<=100?properties.uncertaintyMeters:null;
const lineParts=geometry=>geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
const safeLines=(geometry,maxVertices=1000)=>lineParts(geometry).filter(line=>Array.isArray(line)&&line.length>=2&&line.length<=maxVertices&&line.every(korea));
const source=value=>({sourceName:text(value?.sourceName)||null,sourceUrl:text(value?.sourceUrl)||null,sourceDate:text(value?.sourceDate)||null});
const active=value=>!['not-connected','unavailable','error','excluded'].includes(value?.metadata?.state);
const publicWaypoints=feature=>Array.isArray(feature?.properties?.routingWaypoints)?feature.properties.routingWaypoints:[];

/** Only map-matched public-road points can generate an alternative; the drawn line never is a route. */
export function chooseSafeReturnCorridor(data,{start,end,boundaries,safeReturnId,maxDetourMeters,maxDistanceMeters=10000}={}){
  if(!korea(start)||!korea(end))return null;
  const direct=walkDistance(start,end),choices=[];
  for(const feature of features(data?.corridors)){
    const p=feature.properties||{},id=text(p.id||feature.id);
    if(!id||(safeReturnId&&safeReturnId!==id)||!safeLines(feature.geometry).length||p.geometryStatus!=='image-interpreted')continue;
    const points=publicWaypoints(feature).map((item,waypointIndex)=>({...item,waypointIndex})).filter(item=>item?.accessVerification==='mapped-public-road'&&text(item.verificationNote)&&korea(item.coordinate)&&(!boundaries||pointInRegion(item.coordinate,boundaries)));
    if(points.length<2)continue;
    const endpoints=[points[0],points.at(-1)];
    if(walkDistance(endpoints[0].coordinate,endpoints[1].coordinate)<20)continue;
    for(const ordered of [endpoints,[...endpoints].reverse()]){
      const length=walkDistance(start,ordered[0].coordinate)+walkDistance(ordered[0].coordinate,ordered[1].coordinate)+walkDistance(ordered[1].coordinate,end),detour=Math.max(0,length-direct);
      if(length>maxDistanceMeters||(Number.isFinite(maxDetourMeters)&&detour>maxDetourMeters))continue;
      const via=ordered.filter(item=>walkDistance(start,item.coordinate)>=10&&walkDistance(end,item.coordinate)>=10).map(item=>({id:`safe-return-road:${id}:${item.waypointIndex}`,name:`${text(p.name)||id} 도로 경유점 ${item.waypointIndex+1}`,category:'safe-return-road',coordinate:[...item.coordinate],routeEligible:true,accessVerification:item.accessVerification,verificationNote:text(item.verificationNote),...source(p),note:'안내 이미지에서 해석한 참고 도로의 지도 대조 경유점입니다. 공식 경계·현재 통행조건을 보장하지 않습니다.'}));
      if(via.length)choices.push({id:`safe-return-${id}`,label:`${text(p.name)||id} 참고구간 경유`,role:'via',corridorId:id,straightDetourMeters:Math.round(detour),via});
    }
  }
  choices.sort((a,b)=>a.straightDetourMeters-b.straightDetourMeters||a.id.localeCompare(b.id));
  return choices[0]||null;
}

function pointIndex(collection,boundaries,kind){
  if(!collection||!active(collection))return null;
  const metadata=collection.metadata||{};
  // Traffic-enforcement CCTV and unclassified cameras must never stand in for crime-prevention support.
  if(kind==='cctv'&&metadata.purpose!=='crime-prevention'&&metadata.geometryStatus!=='image-interpreted')return null;
  if(kind==='cctv'&&/traffic|교통|단속/i.test(text(metadata.purpose)+' '+text(metadata.sourceName)))return null;
  const grid=new Map();let count=0,maxUncertainty=null;
  for(const feature of features(collection).slice(0,20000)){
    const point=feature.geometry?.type==='Point'?feature.geometry.coordinates:null;
    if(!korea(point)||(boundaries&&!pointInRegion(point,boundaries)))continue;
    const projected=project(point),key=projected.map(value=>Math.floor(value/100)).join(',');
    if(!grid.has(key))grid.set(key,[]);grid.get(key).push(projected);count++;
    const error=uncertainty(feature.properties);if(error!==null)maxUncertainty=Math.max(maxUncertainty||0,error);
  }
  if(!count)return null;
  return {grid,count,metadata,maxUncertainty};
}
function nearPoint(index,point,radius){
  const [x,y]=point,cx=Math.floor(x/100),cy=Math.floor(y/100),reach=Math.ceil(radius/100);
  for(let dx=-reach;dx<=reach;dx++)for(let dy=-reach;dy<=reach;dy++)for(const candidate of index.grid.get(`${cx+dx},${cy+dy}`)||[])if(Math.hypot(x-candidate[0],y-candidate[1])<=radius)return true;
  return false;
}
function segmentDistance(point,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0;
  return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);
}
function corridorIndex(collection,safeReturnId){
  if(!collection||!active(collection))return [];
  return features(collection).slice(0,30).flatMap(feature=>{
    const p=feature.properties||{},id=text(p.id||feature.id),error=uncertainty(p);
    if(!id||(safeReturnId&&safeReturnId!==id)||p.geometryStatus!=='image-interpreted'||error===null)return [];
    const segments=[];
    for(const line of safeLines(feature.geometry))for(let i=1;i<line.length;i++)segments.push([project(line[i-1]),project(line[i])]);
    return segments.length?[{id,name:text(p.name)||id,uncertaintyMeters:error,radiusMeters:Math.max(20,error),segments,nearMeters:0,...source(p)}]:[];
  });
}
const pointMetric=(index,nearMeters,length,radius)=>({status:index?(index.metadata.geometryStatus==='image-interpreted'?'image-reference-proximity':'partial-recorded-proximity'):'not-connected',nearMeters:index?Math.round(nearMeters):null,ratio:index&&length?Math.round(nearMeters/length*1000)/1000:null,radiusMeters:radius,geometryStatus:text(index?.metadata.geometryStatus)||null,uncertaintyMeters:index?.maxUncertainty??null,...source(index?.metadata)});

/** Independent measures, with missing data distinct from zero recorded proximity. */
export function assessSafeReturnRoutes({routes,data,boundaries,safeReturnId,maxDetourMeters,maxDetourMinutes}={}){
  const lighting=pointIndex(data?.lights,boundaries,'lighting'),cctv=pointIndex(data?.cctv,boundaries,'cctv'),references=corridorIndex(data?.corridors,safeReturnId);
  const direct=routes?.find(route=>route.role==='direct'),results=[];
  for(const route of (routes||[]).slice(0,3)){
    let length=0,evaluated=0,lightMeters=0,cctvMeters=0,corridorMeters=0,sampleCount=0;
    const measured=references.map(reference=>({...reference,nearMeters:0}));
    for(const feature of features(route.geojson))for(const line of safeLines(feature.geometry,20000))for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],segment=walkDistance(a,b),steps=Math.max(1,Math.ceil(segment/10)),weight=segment/steps;
      if(!Number.isFinite(segment))continue;
      length+=segment;if(sampleCount+steps>5000)continue;evaluated+=segment;
      for(let step=0;step<steps;step++){
        sampleCount++;const fraction=(step+.5)/steps,point=project([a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction]);
        if(lighting&&nearPoint(lighting,point,25))lightMeters+=weight;
        if(cctv&&nearPoint(cctv,point,30))cctvMeters+=weight;
        let near=false;
        for(const reference of measured)if(reference.segments.some(([from,to])=>segmentDistance(point,from,to)<=reference.radiusMeters)){reference.nearMeters+=weight;near=true;}
        if(near)corridorMeters+=weight;
      }
    }
    const detourMeters=direct?Math.max(0,route.distanceMeters-direct.distanceMeters):null,detourSeconds=direct?Math.max(0,route.durationSeconds-direct.durationSeconds):null;
    results.push({id:route.id,metrics:{geometryLengthMeters:Math.round(length),evaluatedMeters:Math.round(evaluated),unevaluatedMeters:Math.round(Math.max(0,length-evaluated)),sampleCount,lighting:pointMetric(lighting,lightMeters,length,25),cctv:pointMetric(cctv,cctvMeters,length,30),corridor:{status:references.length?'image-reference-proximity':'not-connected',nearMeters:references.length?Math.round(corridorMeters):null,ratio:references.length&&length?Math.round(corridorMeters/length*1000)/1000:null,references:measured.map(({segments,...reference})=>({...reference,nearMeters:Math.round(reference.nearMeters)}))},detourMeters,detourSeconds,withinDetour:direct&&Number.isFinite(maxDetourMeters)&&Number.isFinite(maxDetourMinutes)?detourMeters<=maxDetourMeters&&detourSeconds<=maxDetourMinutes*60:null}});
  }
  const orderBy=key=>results.filter(result=>result.metrics[key]?.nearMeters!==null&&result.metrics.unevaluatedMeters===0).sort((a,b)=>b.metrics[key].nearMeters-a.metrics[key].nearMeters||(a.metrics.detourMeters??0)-(b.metrics.detourMeters??0)).map(result=>result.id);
  return {status:lighting||cctv||references.length?'partial':'not-evaluated',criteria:{sampleSpacingMeters:10,lightingProximityMeters:25,cctvProximityMeters:30,corridorProximity:'이미지 위치 불확실성과20m중 큰값의 참고근접',maxDetourMeters:maxDetourMeters??null,maxDetourMinutes:maxDetourMinutes??null},dataStatus:data?.metadata||{state:'not-connected'},routes:results,
    comparison:{preferredRouteId:null,byDistance:[...(routes||[])].sort((a,b)=>a.distanceMeters-b.distanceMeters).map(route=>route.id),byLightingProximity:orderBy('lighting'),byCorridorProximity:orderBy('corridor'),reason:'거리·시간과 수록 설치위치·이미지 참고구간의 근접 길이를 각각 비교합니다. 범죄위험·현재 밝기·CCTV 시야·안전도를 계산하거나 가장 안전한 길을 고르지 않습니다.'},
    assumptions:['보안등25m·CCTV30m는 설치위치 주변 거리 기준이며 실제 밝기·감시 범위가 아닙니다.','안내 이미지의 귀갓길 선은 위치 불확실성이 있는 해석 참고자료이며 공식 좌표가 아닙니다.','미연결·미수록은 시설이 없다는 뜻이 아닙니다. 현재 작동·운영·통행 상태는 확인하지 않았습니다.']};
}
