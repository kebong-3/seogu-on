import {walkDistance} from './walk-route-model.js';

/**
 * Pure walking navigation model. Nothing here reads location, fetches, stores history,
 * speaks, renders HTML, or mutates its arguments. Distances are metres and times are
 * epoch milliseconds. Route progress uses the supplied geometry, never a straight
 * connection between missing pieces or the provider's rounded distance total.
 *
 * buildWalkNavigation(route, {destination?, maxGapMeters?, maxDestinationOffsetMeters?})
 *   accepts a route with .geojson or a GeoJSON FeatureCollection. Provider Point
 *   descriptions/turnType/pointIndex are retained as TEXT, not trusted markup.
 * createWalkNavigationState(index, {lastRerouteAt?}) starts a new navigation session.
 * updateWalkNavigation(index, previousState, position, {now?, ...thresholds}) returns
 *   {state, accepted, status, reason, message, progressMeters, remainingMeters,
 *    positionProgressMeters, nearestCoordinate, distanceToRouteMeters, bearing,
 *    nextStep, nextInstruction, nextTurnDistanceMeters, offRoute, wrongWay, arrived,
 *    justArrived, shouldReroute, locationReliable, destinationDistanceMeters}.
 *   Always keep the returned state, including rejected readings. A rejected GPS fix
 *   cannot advance progress, arrival/off-route counters, or request a reroute.
 *   position can be GeolocationPosition or {coordinate:[lon,lat],accuracy,timestamp}.
 * projectWalkPosition(index, coordinate, {progressMeters?, ambiguityMeters?}) projects
 *   a public waypoint onto actual segments. An ambiguous match must not be used to
 *   confidently mark a waypoint passed: inspect .ambiguous/.alternatives first.
 *
 * status: waiting-location | tracking | locating | off-route | wrong-way | arrived |
 *         location-unreliable | route-gap. reason is a stable English code; message is
 *         user-facing Korean. shouldReroute is an event, throttled by lastRerouteAt.
 * Route replacement resets progress but preserves lastRerouteAt when the old state is
 * passed to updateWalkNavigation. UI must separately gate permissions and route expiry.
 */
export const WALK_NAVIGATION_DEFAULTS=Object.freeze({
  maxAccuracyMeters:40,maxLocationAgeMs:15000,maxFutureMs:5000,
  maxWalkingSpeedMetersPerSecond:4.5,jumpSlackMeters:15,maxMatchIntervalMs:60000,
  ambiguityMeters:8,progressSlackMeters:15,turnPassedMeters:8,
  offRouteDistanceMeters:30,offRouteSamples:3,offRouteDurationMs:6000,
  sampleIntervalMs:2000,maxEvidenceGapMs:12000,rerouteCooldownMs:60000,
  backwardDistanceMeters:20,backwardSamples:3,backwardDurationMs:6000,
  arrivalAccuracyMeters:15,arrivalRadiusMeters:20,arrivalRemainingMeters:20,
  arrivalSamples:2,arrivalDurationMs:3000,
});
const R=6371008.8,RAD=Math.PI/180,EPS=.001;
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const longitudeDelta=(a,b)=>((b-a+540)%360)-180;
const safeText=value=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,1200):'';
const invalid=message=>Object.assign(new Error(message),{code:'INVALID_WALK_NAVIGATION_ROUTE'});
function bearing(a,b){const d=longitudeDelta(a[0],b[0])*RAD,la=a[1]*RAD,lb=b[1]*RAD;return (Math.atan2(Math.sin(d)*Math.cos(lb),Math.cos(la)*Math.sin(lb)-Math.sin(la)*Math.cos(lb)*Math.cos(d))/RAD+360)%360;}
function optionsFor(options){
  const result={...WALK_NAVIGATION_DEFAULTS};
  for(const name of Object.keys(result))if(Object.hasOwn(options,name)){
    if(!finite(options[name])||options[name]<0)throw new TypeError(`Invalid navigation option: ${name}`);
    result[name]=options[name];
  }
  if(!Number.isInteger(result.offRouteSamples)||result.offRouteSamples<2||!Number.isInteger(result.arrivalSamples)||result.arrivalSamples<2||!Number.isInteger(result.backwardSamples)||result.backwardSamples<2)throw new TypeError('Navigation evidence requires at least two integer samples.');
  return result;
}
function projectSegment(point,segment){
  const scale=Math.max(.000001,Math.cos((segment.a[1]+segment.b[1]+point[1])/3*RAD));
  const x=longitudeDelta(segment.a[0],segment.b[0])*RAD*R*scale,y=(segment.b[1]-segment.a[1])*RAD*R;
  const px=longitudeDelta(segment.a[0],point[0])*RAD*R*scale,py=(point[1]-segment.a[1])*RAD*R;
  const fraction=clamp((px*x+py*y)/(x*x+y*y),0,1);
  const coordinate=[((segment.a[0]+longitudeDelta(segment.a[0],segment.b[0])*fraction+540)%360)-180,segment.a[1]+(segment.b[1]-segment.a[1])*fraction];
  return {coordinate,distanceMeters:walkDistance(point,coordinate),progressMeters:segment.startMeters+segment.lengthMeters*fraction,bearing:segment.bearing,segmentIndex:segment.index,partIndex:segment.partIndex,featureOrder:segment.featureOrder,fraction};
}
function projections(index,point){return index.segments.map(segment=>projectSegment(point,segment)).sort((a,b)=>a.distanceMeters-b.distanceMeters||a.progressMeters-b.progressMeters);}
function chooseProjection(matches,{progressMeters,ambiguityMeters=3,minProgressMeters=-Infinity,maxProgressMeters=Infinity}={}){
  if(!matches.length)return null;
  const closest=matches[0],near=matches.filter(p=>p.distanceMeters<=closest.distanceMeters+ambiguityMeters&&p.progressMeters>=minProgressMeters-EPS&&p.progressMeters<=maxProgressMeters+EPS);
  if(!near.length)return null;
  near.sort((a,b)=>finite(progressMeters)?Math.abs(a.progressMeters-progressMeters)-Math.abs(b.progressMeters-progressMeters)||a.distanceMeters-b.distanceMeters:a.progressMeters-b.progressMeters||a.distanceMeters-b.distanceMeters);
  const chosen=near[0],alternatives=[];
  for(const match of matches)if(match.distanceMeters<=closest.distanceMeters+ambiguityMeters&&!alternatives.some(other=>Math.abs(other.progressMeters-match.progressMeters)<10))alternatives.push({progressMeters:match.progressMeters,distanceMeters:match.distanceMeters,segmentIndex:match.segmentIndex,partIndex:match.partIndex});
  return {...chosen,distanceToRouteMeters:chosen.distanceMeters,ambiguous:alternatives.length>1,alternatives};
}
/** Project only onto provider segments; never adds a bridge across a route gap. */
export function projectWalkPosition(index,coordinate,options={}){
  if(!index?.segments?.length||!validPoint(coordinate))return null;
  if(options.progressMeters!==undefined&&!finite(options.progressMeters))return null;
  const ambiguityMeters=options.ambiguityMeters??3;
  if(!finite(ambiguityMeters)||ambiguityMeters<0)return null;
  return chooseProjection(projections(index,coordinate),{...options,ambiguityMeters});
}
function routeKey(routeId,segments,destination){
  let hash=2166136261;const text=JSON.stringify([segments.map(s=>[s.a,s.b]),destination]);
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return `${routeId}:${(hash>>>0).toString(16)}`;
}
export function buildWalkNavigation(route,{destination,maxGapMeters=1,maxDestinationOffsetMeters=30,maxInstructionSnapMeters=50}={}){
  const geojson=route?.geojson||route;
  if(geojson?.type!=='FeatureCollection'||!Array.isArray(geojson.features)||geojson.features.length>20000)throw invalid('길안내에 사용할 경로 도형을 확인하세요.');
  for(const value of [maxGapMeters,maxDestinationOffsetMeters,maxInstructionSnapMeters])if(!finite(value)||value<0)throw invalid('길안내 거리 기준을 확인하세요.');
  if(destination!==undefined&&!validPoint(destination))throw invalid('도착지 좌표를 확인하세요.');
  let features=geojson.features.map((feature,originalIndex)=>({feature,originalIndex}));
  // Use the provider's complete, unique global index when present, otherwise array order.
  const indices=features.map(item=>item.feature?.properties?.index);
  if(indices.every(Number.isFinite)&&new Set(indices).size===indices.length)features.sort((a,b)=>a.feature.properties.index-b.feature.properties.index);
  const segments=[],points=[],gaps=[],warnings=[];let totalMeters=0,partIndex=0,previousEnd=null,vertexCount=0;
  for(const [featureOrder,{feature,originalIndex}]of features.entries()){
    const geometry=feature?.geometry,properties=feature?.properties||{};
    if(geometry?.type==='Point'){
      if(validPoint(geometry.coordinates))points.push({coordinate:[...geometry.coordinates],properties,featureOrder,originalIndex});
      continue;
    }
    if(!['LineString','MultiLineString'].includes(geometry?.type))continue;
    const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;
    if(!Array.isArray(lines))throw invalid('보행경로의 선형 좌표가 올바르지 않습니다.');
    for(const line of lines){
      if(!Array.isArray(line)||line.length<2||!line.every(validPoint)||(vertexCount+=line.length)>100000)throw invalid('보행경로의 선형 좌표가 올바르지 않습니다.');
      const gapMeters=previousEnd?walkDistance(previousEnd,line[0]):0;
      if(previousEnd&&gapMeters>maxGapMeters){partIndex++;gaps.push({afterMeters:totalMeters,from:[...previousEnd],to:[...line[0]],distanceMeters:gapMeters,partIndex});}
      for(let i=1;i<line.length;i++){
        const a=[...line[i-1]],b=[...line[i]],lengthMeters=walkDistance(a,b);
        if(lengthMeters<.01)continue;
        segments.push({index:segments.length,a,b,lengthMeters,startMeters:totalMeters,endMeters:totalMeters+lengthMeters,bearing:bearing(a,b),partIndex,featureOrder,originalIndex});totalMeters+=lengthMeters;
      }
      previousEnd=[...line.at(-1)];
    }
  }
  if(!segments.length||totalMeters>100000)throw invalid('유효한 보행경로가 없거나 길안내 범위를 넘었습니다.');
  const start=[...segments[0].a],end=[...segments.at(-1).b],target=destination?[...destination]:[...end],destinationOffsetMeters=walkDistance(end,target),destinationMatchesRoute=destinationOffsetMeters<=maxDestinationOffsetMeters;
  if(gaps.length)warnings.push('제공된 경로 선형의 일부가 이어지지 않아 길안내를 보류합니다. 경로를 다시 조회해 주세요.');
  if(!destinationMatchesRoute)warnings.push('선택한 도착지와 제공 경로 끝이 떨어져 있어 자동 도착 판정을 하지 않습니다.');
  const routeId=safeText(route?.id)||'route',index={version:1,routeId,key:routeKey(routeId,segments,target),segments,totalMeters,start,end,destination:target,destinationOffsetMeters,destinationMatchesRoute,continuous:gaps.length===0,gaps,steps:[],warnings,providerDistanceMeters:finite(route?.distanceMeters)&&route.distanceMeters>=0?route.distanceMeters:null,providerDurationSeconds:finite(route?.durationSeconds)&&route.durationSeconds>=0?route.durationSeconds:null};
  // Point order resolves identical coordinates on loops more reliably than spatial matching alone.
  const pointIndices=points.map(p=>p.properties.pointIndex);
  if(pointIndices.every(Number.isFinite)&&new Set(pointIndices).size===pointIndices.length)points.sort((a,b)=>a.properties.pointIndex-b.properties.pointIndex);
  let priorProgress=0;
  for(const point of points){
    const description=safeText(point.properties.description)||safeText(point.properties.name);if(!description)continue;
    const matches=projections(index,point.coordinate),near=matches.filter(p=>p.distanceMeters<=maxInstructionSnapMeters&&p.progressMeters>=priorProgress-EPS);
    if(!near.length){warnings.push('경로 선형에 맞지 않는 일부 제공기관 안내 지점은 길안내에서 제외했습니다.');continue;}
    const following=near.filter(p=>p.featureOrder>point.featureOrder).sort((a,b)=>a.featureOrder-b.featureOrder||a.distanceMeters-b.distanceMeters||a.progressMeters-b.progressMeters);
    let preferred=following[0]&&following[0].distanceMeters<=near[0].distanceMeters+3?following[0]:near[0];
    // A final provider Point after the final line identifies its endpoint even when
    // the route loops back to a coordinate that was visited at the start.
    if(point===points.at(-1)&&point.featureOrder>segments.at(-1).featureOrder){
      const terminal=near.find(p=>p.segmentIndex===segments.length-1&&Math.abs(p.progressMeters-totalMeters)<=1);
      if(terminal&&terminal.distanceMeters<=near[0].distanceMeters+3)preferred=terminal;
    }
    priorProgress=preferred.progressMeters;
    index.steps.push({id:`provider:${point.originalIndex}`,description,name:safeText(point.properties.name),turnType:finite(point.properties.turnType)?point.properties.turnType:null,pointIndex:finite(point.properties.pointIndex)?point.properties.pointIndex:null,coordinate:[...point.coordinate],progressMeters:preferred.progressMeters,distanceToRouteMeters:preferred.distanceMeters,source:'provider',isDestination:Math.abs(preferred.progressMeters-totalMeters)<=1});
  }
  index.steps.sort((a,b)=>a.progressMeters-b.progressMeters);
  index.instructionsAvailable=index.steps.length>0;
  if(!index.steps.some(step=>step.progressMeters<=1))index.steps.unshift({id:'route-start',description:'경로를 따라 이동을 시작하세요.',name:'',turnType:null,pointIndex:null,coordinate:[...start],progressMeters:0,distanceToRouteMeters:0,source:'fallback',isDestination:false});
  if(!index.steps.some(step=>step.isDestination))index.steps.push({id:'route-end',description:destinationMatchesRoute?'목적지까지 경로를 따라 이동하세요.':'제공 경로의 끝 지점까지 이동하세요.',name:'',turnType:null,pointIndex:null,coordinate:[...end],progressMeters:totalMeters,distanceToRouteMeters:0,source:'fallback',isDestination:true});
  for(const step of index.steps)step.instruction=step.description;
  return index;
}
export function createWalkNavigationState(index,{lastRerouteAt=null}={}){
  if(!index?.segments?.length||!finite(index.totalMeters))throw invalid('길안내 경로를 먼저 준비하세요.');
  return {routeKey:index.key,hasFix:false,hasProgress:false,progressMeters:0,positionProgressMeters:0,segmentIndex:null,lastTimestamp:null,lastCoordinate:null,lastAccuracy:null,nearestCoordinate:null,distanceToRouteMeters:null,bearing:null,destinationDistanceMeters:null,offRouteSamples:0,offRouteSince:null,lastOffRouteSampleAt:null,offRoute:false,lastRerouteAt:finite(lastRerouteAt)?lastRerouteAt:null,backwardSamples:0,backwardSince:null,lastBackwardSampleAt:null,wrongWay:false,arrivalSamples:0,arrivalSince:null,lastArrivalSampleAt:null,arrived:false,evidenceInterrupted:false};
}
function snapshot(index,state,options,extra={}){
  const positionProgressMeters=state.positionProgressMeters??state.progressMeters;
  const guidanceProgress=state.wrongWay?Math.min(state.progressMeters,positionProgressMeters):state.progressMeters;
  const remainingMeters=Math.max(0,index.totalMeters-guidanceProgress);
  const nextStep=index.steps.find(step=>step.progressMeters>=guidanceProgress-options.turnPassedMeters)||index.steps.at(-1)||null,nextStepIndex=nextStep?index.steps.indexOf(nextStep):-1;
  return {state,accepted:false,status:state.arrived?'arrived':state.hasFix?'tracking':'waiting-location',reason:null,message:'',locationReliable:false,progressMeters:state.progressMeters,positionProgressMeters,remainingMeters,remainingSeconds:index.providerDurationSeconds===null?null:index.providerDurationSeconds*remainingMeters/index.totalMeters,nearestCoordinate:state.nearestCoordinate?[...state.nearestCoordinate]:null,distanceToRouteMeters:state.distanceToRouteMeters,bearing:state.bearing,destinationDistanceMeters:state.destinationDistanceMeters,destinationMatchesRoute:index.destinationMatchesRoute,nextStep,nextStepIndex,nextInstruction:nextStep?.description||null,nextTurnDistanceMeters:nextStep?Math.max(0,nextStep.progressMeters-guidanceProgress):null,offRoute:state.offRoute,wrongWay:state.wrongWay,arrived:state.arrived,justArrived:false,shouldReroute:false,...extra};
}
function rejected(index,state,options,reason,message,{interrupt=true,status='location-unreliable'}={}){
  // Evidence is preserved, but the next reliable sample starts a new evidence run.
  const next=interrupt?{...state,evidenceInterrupted:true}:state;
  return snapshot(index,next,options,{status,reason,message});
}
function resetEvidence(state,prefix){state[`${prefix}Samples`]=0;state[`${prefix}Since`]=null;state[`last${prefix[0].toUpperCase()+prefix.slice(1)}SampleAt`]=null;}
function countEvidence(state,prefix,timestamp,options){
  const lastKey=`last${prefix[0].toUpperCase()+prefix.slice(1)}SampleAt`,sinceKey=`${prefix}Since`,samplesKey=`${prefix}Samples`;
  if(state[sinceKey]===null)state[sinceKey]=timestamp;
  if(state[lastKey]===null||timestamp-state[lastKey]>=options.sampleIntervalMs){state[samplesKey]++;state[lastKey]=timestamp;}
}
export function updateWalkNavigation(index,previous,position,options={}){
  const config=optionsFor(options),now=options.now??Date.now();
  if(!finite(now))throw new TypeError('Navigation now must be epoch milliseconds.');
  const state=previous?.routeKey===index.key?previous:createWalkNavigationState(index,{lastRerouteAt:previous?.lastRerouteAt});
  if(!index.continuous)return rejected(index,state,config,'route-gap','제공된 경로 선형의 일부가 이어지지 않아 길안내를 보류합니다. 경로를 다시 조회해 주세요.',{status:'route-gap'});
  const coordinate=position?.coordinate??(position?.coords?[position.coords.longitude,position.coords.latitude]:null),accuracy=position?.accuracy??position?.coords?.accuracy,timestamp=position?.timestamp;
  if(!validPoint(coordinate)||!finite(timestamp))return rejected(index,state,config,'invalid-location','현재 위치를 확인하지 못했어요. 위치 수신을 기다려 주세요.');
  if(!finite(accuracy)||accuracy<0)return rejected(index,state,config,'invalid-accuracy','현재 위치의 정확도를 확인하지 못했어요.');
  if(accuracy>config.maxAccuracyMeters)return rejected(index,state,config,'poor-accuracy','위치 오차가 커서 길안내를 잠시 보류해요. 정확한 위치를 기다려 주세요.');
  if(now-timestamp>config.maxLocationAgeMs)return rejected(index,state,config,'stale-location','오래된 위치여서 길안내에 반영하지 않았어요. 새 위치를 기다려 주세요.');
  if(timestamp-now>config.maxFutureMs)return rejected(index,state,config,'future-location','위치 수신 시각을 확인할 수 없어 길안내를 잠시 보류해요.');
  if(state.lastTimestamp!==null&&timestamp<=state.lastTimestamp)return rejected(index,state,config,timestamp===state.lastTimestamp?'duplicate-fix':'out-of-order','이미 처리했거나 이전 시각의 위치는 다시 반영하지 않아요.',{interrupt:false});
  const elapsedMs=state.lastTimestamp===null?0:timestamp-state.lastTimestamp,displacement=state.lastCoordinate?walkDistance(state.lastCoordinate,coordinate):0;
  const physicalAllowance=config.maxWalkingSpeedMetersPerSecond*elapsedMs/1000+accuracy+(state.lastAccuracy??0)+config.jumpSlackMeters;
  if(state.hasFix&&displacement>physicalAllowance)return rejected(index,state,config,'implausible-jump','위치가 갑자기 멀리 바뀌어 반영하지 않았어요. 다음 위치를 기다려 주세요.');
  const matches=projections(index,coordinate),raw=matches[0],ambiguity=Math.max(config.ambiguityMeters,Math.min(20,accuracy*.6));
  const allowance=config.maxWalkingSpeedMetersPerSecond*Math.min(elapsedMs,config.maxMatchIntervalMs)/1000+accuracy+(state.lastAccuracy??0)+config.progressSlackMeters;
  let matched=chooseProjection(matches,{ambiguityMeters:ambiguity,...(state.hasProgress?{progressMeters:state.positionProgressMeters,minProgressMeters:Math.max(0,state.positionProgressMeters-allowance),maxProgressMeters:state.positionProgressMeters+allowance}:{})});
  // At a reached vertex, prefer the next actual segment if it matches equally well.
  // This disambiguates an intended out-and-back visit on the same physical road.
  // A turn onto a different road is never inferred when its segment is farther away.
  const previousSegment=Number.isInteger(state.segmentIndex)?index.segments[state.segmentIndex]:null;
  if(previousSegment&&previousSegment.endMeters-state.positionProgressMeters<=Math.max(8,state.lastAccuracy??0)){
    const onward=matches.find(p=>p.segmentIndex===previousSegment.index+1&&p.distanceMeters<=raw.distanceMeters+ambiguity&&p.progressMeters>=state.positionProgressMeters-EPS&&p.progressMeters<=state.positionProgressMeters+allowance);
    if(onward)matched={...onward,distanceToRouteMeters:onward.distanceMeters};
  }
  const highConfidenceOffRoute=raw.distanceMeters-accuracy>config.offRouteDistanceMeters,onRoute=raw.distanceMeters<=config.offRouteDistanceMeters;
  if(onRoute&&!matched)return rejected(index,state,config,'implausible-progress','경로 위의 위치가 갑자기 바뀌어 다음 위치를 기다리고 있어요.');
  if(!onRoute&&!highConfidenceOffRoute)return rejected(index,state,config,'uncertain-route-position','위치 오차 범위가 경로와 겹쳐 있어 정확한 위치를 기다리고 있어요.',{status:'locating'});
  const next={...state,lastTimestamp:timestamp,lastCoordinate:[...coordinate],lastAccuracy:accuracy,hasFix:true,nearestCoordinate:[...(matched||raw).coordinate],distanceToRouteMeters:raw.distanceMeters,bearing:(matched||raw).bearing,destinationDistanceMeters:walkDistance(coordinate,index.destination),evidenceInterrupted:false};
  if(state.evidenceInterrupted||elapsedMs>config.maxEvidenceGapMs){for(const prefix of ['offRoute','backward','arrival'])resetEvidence(next,prefix);next.offRoute=false;next.wrongWay=false;}
  let status='tracking',reason=null,message='',shouldReroute=false;
  if(highConfidenceOffRoute){
    countEvidence(next,'offRoute',timestamp,config);next.offRoute=next.offRouteSamples>=config.offRouteSamples&&timestamp-next.offRouteSince>=config.offRouteDurationMs;
    resetEvidence(next,'backward');next.wrongWay=false;resetEvidence(next,'arrival');
    status=next.offRoute?'off-route':'locating';reason=next.offRoute?'off-route-confirmed':'off-route-pending';message=next.offRoute?'안내 경로에서 벗어났어요. 현재 위치에서 경로를 다시 확인하세요.':'경로와 떨어진 위치가 수신되어 다음 위치를 확인하고 있어요.';
    if(next.offRoute&&(next.lastRerouteAt===null||timestamp-next.lastRerouteAt>=config.rerouteCooldownMs)){shouldReroute=true;next.lastRerouteAt=timestamp;}
  }else if(!onRoute){
    for(const prefix of ['offRoute','backward','arrival'])resetEvidence(next,prefix);next.offRoute=false;next.wrongWay=false;status='locating';reason='uncertain-route-position';message='위치 오차 범위가 경로와 겹쳐 있어 정확한 위치를 기다리고 있어요.';
  }else{
    resetEvidence(next,'offRoute');next.offRoute=false;next.hasProgress=true;next.positionProgressMeters=matched.progressMeters;next.segmentIndex=matched.segmentIndex;next.progressMeters=Math.max(state.progressMeters,matched.progressMeters);
    const backwardMeters=next.progressMeters-matched.progressMeters;
    if(backwardMeters>config.backwardDistanceMeters){countEvidence(next,'backward',timestamp,config);next.wrongWay=next.backwardSamples>=config.backwardSamples&&timestamp-next.backwardSince>=config.backwardDurationMs;}
    else{resetEvidence(next,'backward');next.wrongWay=false;}
    if(next.wrongWay){status='wrong-way';reason='backtracking-confirmed';message='경로의 반대 방향으로 이동하고 있어요. 진행 방향을 확인하세요.';}
    const nearEnd=index.destinationMatchesRoute&&accuracy<=config.arrivalAccuracyMeters&&next.destinationDistanceMeters+accuracy<=config.arrivalRadiusMeters&&index.totalMeters-matched.progressMeters<=config.arrivalRemainingMeters&&!next.wrongWay;
    if(nearEnd){countEvidence(next,'arrival',timestamp,config);if(next.arrivalSamples>=config.arrivalSamples&&timestamp-next.arrivalSince>=config.arrivalDurationMs)next.arrived=true;}
    else resetEvidence(next,'arrival');
  }
  if(next.arrived){status='arrived';reason='destination-reached';message='목적지에 도착했어요.';shouldReroute=false;}
  return snapshot(index,next,config,{accepted:true,status,reason,message,locationReliable:true,shouldReroute,justArrived:next.arrived&&!state.arrived,duplicatePosition:state.hasFix&&displacement<.25});
}
