import {registerAction} from './actions.js';
import {inside} from './geometry.js';
import {walkDistance} from '../../shared/walk-route-model.js';

const VIEW='walk-routes',MAX_RESULT_AGE=30*60*1000;
const MODES=[
  {id:'shade',label:'여름 그늘길',help:'선택한 일시의 건물 그늘과 우회 거리를 함께 비교해요.'},
  {id:'winter',label:'겨울철 보행안전',help:'일조가 적은 구간과 공개 결빙관리지점 주변을 나눠 살펴봐요.'},
  {id:'safety',label:'안심시설 경유',help:'공개 안심시설을 들르는 길의 거리와 예상 보행시간을 비교해요.'},
  {id:'care',label:'돌봄 방문',help:'돌봄시설을 들르는 길을 비교하고 방문 계획을 준비해요.'},
  {id:'inspection',label:'현장점검',help:'점검지를 고른 순서대로 방문하는 길을 확인해요.'},
];
const SAMPLE_POINTS={seogu:[[126.8900126833,35.15202903],[126.8777206,35.156420477]],suncheon:[[127.4836658,34.95424629],[127.4852768,34.97076978]]};
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=value=>Array.isArray(value)?value:[];
const xy=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const distance=value=>!finite(value)?'거리 미수신':value>=1000?`${(value/1000).toFixed(1)}km`:`${Math.round(value).toLocaleString('ko-KR')}m`;
const duration=value=>!finite(value)?'시간 미수신':value<60?'1분 미만':`${Math.round(value/60).toLocaleString('ko-KR')}분`;
const time=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):'시각 미수신';};
const departureLabel=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):'출발 일시 미제공';};
const regionOf=body=>body?.region?.id||body?.regionId||(typeof body?.region==='string'&&/^[a-z0-9-]+$/.test(body.region)?body.region:null);
const lineGeometry=route=>{
  const lines=list(route?.geojson?.features).flatMap(f=>f.geometry?.type==='LineString'?[f.geometry.coordinates]:f.geometry?.type==='MultiLineString'?f.geometry.coordinates:[]).filter(line=>Array.isArray(line)&&line.length>1&&line.every(p=>xy(p)));
  return lines.length?{type:'MultiLineString',coordinates:lines}:null;
};
const difference=(value,base,format)=>{const gap=value-base;if(!Number.isFinite(gap))return '';return gap===0?'변화 없음':`${gap>0?'+':'−'}${format(Math.abs(gap))}`;};
const samePlace=(a,b)=>xy(a)&&xy(b)&&a.every((v,i)=>Math.abs(v-b[i])<.000001);
const candidateName=c=>[c.name,({shade:'그늘막',shelter:'쉼터',police:'경찰시설',bell:'비상벨',childcare:'어린이집',public:'공공공간'})[c.category]||'시설'].filter(Boolean).join(' · ');
async function responseBody(response){try{return await response.json();}catch{throw Error('서버 응답을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.');}}
const pointFrom=c=>c?{id:c.id,name:c.name,coordinate:[...c.coordinate],sourceName:c.sourceName,sourceDate:c.sourceDate}:null;

const safeUrl=value=>/^https?:\/\//i.test(String(value||''))?String(value):'';
const percent=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?`${Math.round(value*100)}%`:'미제공';
const daylightExample=mode=>{const kst=new Date(Date.now()+9*60*60*1000),year=kst.getUTCFullYear(),winterYear=year+(kst.getUTCMonth()>1?1:0);return mode==='winter'?`${winterYear}-01-15T09:00`:`${year}-07-15T14:00`;};
function departureISO(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
  if(Number(value.slice(0,4))<2000||Number(value.slice(0,4))>2100)return null;
  const date=new Date(value+':00+09:00');
  return Number.isFinite(date.getTime())&&new Date(date.getTime()+9*60*60*1000).toISOString().slice(0,16)===value?value+':00+09:00':null;
}
function readableReason(value){
  if(typeof value==='string'&&/[가-힣]/.test(value))return value;
  const code=String(value||'').toLowerCase();
  if(code==='model-bounded-improvement')return '입력한 자료와 우회 한도 안에서 미확인 구간까지 고려해 비교 지표가 개선되는 조회 후보예요.';
  if(code==='direct-model-preferred')return '허용한 우회 범위에서 바로 가는 경로보다 명확히 개선된 후보를 찾지 못했어요.';
  if(code==='direct-route-unavailable')return '바로 가는 경로를 받지 못해 우회 대안과 같은 기준으로 비교하지 않았어요.';
  if(code==='icing-data-unavailable')return '결빙관리지점 자료가 연결되지 않아 해당 주의거리는 미확인으로 남겼어요.';
  if(code==='inside-building-footprint')return '건물 안으로 표시된 구간은 보행 중 햇빛 평가에서 제외했어요.';
  if(/night|low.sun|sun.below|solar.altitude/.test(code))return '선택한 시각의 햇빛 조건으로는 그늘을 평가하지 않았어요.';
  if(/height|building|coverage|missing|unknown|unavailable|not.evaluated/.test(code))return '건물·높이·수록 범위가 확인되지 않은 구간은 미평가로 남겼어요.';
  if(/detour/.test(code))return '설정한 우회 거리·시간을 넘는 대안은 우선안에서 제외했어요.';
  if(/improvement|uncertain|robust|overlap/.test(code))return '미평가 구간까지 고려하면 대안의 개선 여부를 확정하기 어려워요.';
  return '';
}


/** Clip evaluated sample ranges along the provider's original polyline, preserving bends and gaps. */
export function buildWalkAssessmentFeatures(route,{mode='shade'}={}){
  const segments=[];let total=0,lineId=0;
  for(const feature of list(route?.geojson?.features)){
    const lines=feature.geometry?.type==='LineString'?[feature.geometry.coordinates]:feature.geometry?.type==='MultiLineString'?feature.geometry.coordinates:[];
    for(const line of lines){lineId++;if(!Array.isArray(line)||line.length<2||!line.every(xy))continue;for(let i=1;i<line.length;i++){const length=walkDistance(line[i-1],line[i]);if(length>0){segments.push({a:line[i-1],b:line[i],start:total,end:total+length,lineId});total+=length;}}}
  }
  if(!segments.length)return [];
  const names={shade:'추정 그늘',sun:'햇빛 평가 구간',unknown:mode==='winter'?'일조 미평가 구간':'그늘 미평가 구간',low:'일조 적은 구간',sufficient:'일조 기준 충족 구간'},features=[];
  const samples=list(route?.seasonal?.samples).slice(0,2000).filter(sample=>finite(sample.fromMeters)&&finite(sample.toMeters)&&sample.toMeters>sample.fromMeters).sort((a,b)=>a.fromMeters-b.fromMeters);
  let previousEnd=-Infinity;
  for(const [sampleIndex,sample]of samples.entries()){
    const from=Math.max(0,sample.fromMeters),to=Math.min(total,sample.toMeters);if(to<=from||from<previousEnd-.001)continue;previousEnd=to;
    const rawState=mode==='winter'?sample.winter?.classification:sample.state,state=(mode==='winter'?['low','sufficient','unknown']:['shade','sun','unknown']).includes(rawState)?rawState:'unknown';
    let low=0,high=segments.length;while(low<high){const mid=(low+high)>>1;if(segments[mid].end<=from)low=mid+1;else high=mid;}
    const pieces=[];let part=null;
    for(let i=low;i<segments.length&&segments[i].start<to;i++){
      const segment=segments[i],begin=Math.max(from,segment.start),end=Math.min(to,segment.end);if(end<=begin)continue;
      const at=value=>{const t=(value-segment.start)/(segment.end-segment.start);return [segment.a[0]+(segment.b[0]-segment.a[0])*t,segment.a[1]+(segment.b[1]-segment.a[1])*t];},a=at(begin),b=at(end);
      if(!part||part.lineId!==segment.lineId||!samePlace(part.coordinates.at(-1),a)){part={lineId:segment.lineId,coordinates:[a,b]};pieces.push(part);}else part.coordinates.push(b);
    }
    for(const [partIndex,piece]of pieces.entries())features.push({type:'Feature',geometry:{type:'LineString',coordinates:piece.coordinates},properties:{id:`walk-assessment:${route.id}:${sampleIndex}:${partIndex}`,routeId:route.id,name:names[state],assessmentState:state,fromMeters:from,toMeters:to,estimatedHeight:sample.estimatedHeight===true,sourceName:mode==='winter'?'선택일의 일조시간창 평가':'선택시각의 수록 건물 그늘 평가',ephemeral:true}});
  }
  return features;
}

/** TMAP results stay in memory and in private map layers until their short expiry. */
export function installWalkRoutes(api){
  let regionId='',mode='shade',candidates=[],catalogueLoaded=false,configured=null,start=null,end=null,avoidStairs=false,viaIds=[],sample=false,stayMinutes=10;
  let result=null,activeId='',expires=0,expiryTimer=null,pick='',error='',notice='',loading=false,busy=false,destroyed=false;
  let catalogueController=null,routeController=null,catalogueSequence=0,routeSequence=0;
  let departure=daylightExample('shade'),departureExample=true,shadowTiming='walk-time',maxDetourMeters=500,maxDetourMinutes=5,safetyReferences=null,includeLevels=false,assessmentFeatures=[];
  const host=()=>document.getElementById('detail-body');
  const openNow=()=>api.state.view===VIEW;
  const regionName=()=>api.state.regionProfile?.name||'선택 지역';
  const limit=()=>mode==='inspection'?3:2;
  const seasonalMode=()=>mode==='shade'||mode==='winter';
  const isMode=id=>MODES.some(m=>m.id===id);
  const disabled=()=>busy||loading?' disabled':'';
  const candidateById=id=>candidates.find(c=>c.id===id);
  const matchingVia=()=>candidates.filter(c=>{
    if(c.routeEligible===false)return false;
    if(mode==='inspection')return true;
    if(Array.isArray(c.modes))return c.modes.includes(mode);
    const kind=String(c.category||'');
    return (mode==='shade'||mode==='winter'?/그늘|쉼터|shade|heat|shelter/i:mode==='safety'?/경찰|안심|비상벨|보안등|police|security|bell/i:/어린이집|돌봄|공공공간|활동공간|childcare|care|public.?space|^public$/i).test(kind);
  });
  function clearResult(message=''){
    routeController?.abort();routeController=null;routeSequence++;busy=false;result=null;activeId='';assessmentFeatures=[];expires=0;clearTimeout(expiryTimer);expiryTimer=null;api.clearWalkRoutes?.();
    if(message)notice=message;
  }
  function cancelPick(){pick='';api.send?.({type:'stop'});}
  function reset(){
    catalogueController?.abort();catalogueController=null;catalogueSequence++;clearResult();cancelPick();regionId=api.state.regionProfile?.id||'seogu';candidates=[];catalogueLoaded=false;configured=null;start=null;end=null;viaIds=[];avoidStairs=false;stayMinutes=10;sample=false;error='';notice='';loading=false;departure=daylightExample(mode);departureExample=true;shadowTiming='walk-time';maxDetourMeters=500;maxDetourMinutes=5;safetyReferences=null;includeLevels=false;
  }
  function expireIfNeeded(){if(result&&Date.now()>=expires){clearResult('조회한 경로의 표시 시간이 끝났어요. 다시 비교해 주세요.');if(openNow())render();return true;}return false;}
  function armExpiry(){
    clearTimeout(expiryTimer);const remaining=expires-Date.now();
    if(remaining<=0){expireIfNeeded();return;}
    expiryTimer=setTimeout(()=>{if(!destroyed)expireIfNeeded();},remaining);expiryTimer?.unref?.();
  }
  function chooseSample(){
    const actual=candidates.filter(c=>xy(c.coordinate)&&c.routeEligible!==false),samplePoints=SAMPLE_POINTS[regionId];
    let pair=samplePoints?.map(point=>actual.find(c=>Math.abs(c.coordinate[0]-point[0])<.0001&&Math.abs(c.coordinate[1]-point[1])<.0001));
    if(!pair?.every(Boolean)){
      const first=actual[0],other=first&&actual.find(c=>c.id!==first.id&&Math.hypot(c.coordinate[0]-first.coordinate[0],c.coordinate[1]-first.coordinate[1])>.0006);
      pair=first&&other?[first,other]:[];
    }
    if(pair.length!==2){notice='예시로 사용할 서로 다른 시설 두 곳이 없어요. 지도에서 위치를 정해 주세요.';return;}
    clearResult();cancelPick();start=pointFrom(pair[0]);end=pointFrom(pair[1]);viaIds=[];sample=true;error='';notice='실제 수록시설을 출발·도착 예시로 골랐어요. 비교 버튼을 눌러야 경로를 조회합니다.';
  }
  function reconcileCatalogueSelection(previous){
    const refresh=point=>{
      if(!point)return null;
      const candidate=candidateById(point.id);
      if(candidate)return candidate.routeEligible===false?null:pointFrom(candidate);
      const region=api.state.district||api.state.scope;
      return /^map-(start|end)$/.test(point.id)&&xy(point.coordinate)&&region&&inside(point.coordinate,region)?point:null;
    };
    start=refresh(start);end=refresh(end);
    const allowed=new Map(matchingVia().map(c=>[c.id,c])),kept=[];
    for(const id of viaIds){
      const candidate=allowed.get(id);
      if(!candidate||kept.length>=limit()||samePlace(candidate.coordinate,start?.coordinate)||samePlace(candidate.coordinate,end?.coordinate)||kept.some(c=>samePlace(c.coordinate,candidate.coordinate)))continue;
      kept.push(candidate);
    }
    viaIds=kept.map(c=>c.id);
    const changed=previous!==JSON.stringify({start,end,visits:selectedVisits().map(pointFrom)});
    if(changed){clearResult('시설 목록이 바뀌어 선택 위치와 경유지를 갱신했어요. 확인한 뒤 다시 비교해 주세요.');sample=false;}
    return changed;
  }
  async function loadCatalogue(){
    const hadCatalogue=catalogueLoaded,previous=JSON.stringify({start,end,visits:selectedVisits().map(pointFrom)});
    catalogueController?.abort();catalogueController=new AbortController();const controller=catalogueController,seq=++catalogueSequence;loading=true;error='';render();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(`/api/walk-routes?region=${encodeURIComponent(regionId)}`,{signal:controller.signal}),body=await responseBody(response);
      if(!response.ok||body.ok===false)throw Error(typeof body.error==='string'?body.error:body.error?.message||'시설 목록을 가져오지 못했어요.');
      if(seq!==catalogueSequence||destroyed)return;
      if(regionOf(body)&&regionOf(body)!==regionId)throw Error('선택 지역과 시설 자료의 지역이 달라 표시하지 않았어요.');
      const seen=new Set();candidates=list(body.candidates).filter(c=>c&&typeof c.id==='string'&&typeof c.name==='string'&&xy(c.coordinate)&&!seen.has(c.id)&&seen.add(c.id)).map(c=>({...c,name:c.name.slice(0,180),coordinate:[...c.coordinate]}));
      configured=body.configured===true;safetyReferences=body.safetyReferences||body.safeReturn||null;catalogueLoaded=true;const changed=reconcileCatalogueSelection(previous);if(!hadCatalogue&&!start&&!end)chooseSample();
      if(!candidates.length)notice=(changed?notice+' ':'')+'이 지역의 수록시설 목록이 없어요. 지도에서 출발·도착을 선택할 수 있어요.';
    }catch(cause){if(seq!==catalogueSequence||destroyed)return;error=cause.name==='AbortError'?'시설 목록을 읽는 시간이 길어졌어요. 다시 열어 주세요.':cause.message||'시설 목록을 읽지 못했어요.';}
    finally{clearTimeout(timer);if(seq===catalogueSequence&&!destroyed){loading=false;if(openNow())render();}}
  }
  async function open(nextMode){
    if(destroyed)return;if(!regionId||regionId!==(api.state.regionProfile?.id||'seogu'))reset();
    if(nextMode&&isMode(nextMode)&&mode!==nextMode){clearResult();cancelPick();mode=nextMode;viaIds=[];if(departureExample&&seasonalMode())departure=daylightExample(mode);error='';notice='';}
    expireIfNeeded();render();if(!catalogueLoaded&&!loading)await loadCatalogue();else if(result)paint();
  }
  function pointOptions(field){
    const selected=field==='start'?start:end;
    return `<option value="">수록시설에서 선택</option>${selected&&!candidateById(selected.id)?`<option value="${e(selected.id)}" selected>${e(selected.name)}</option>`:''}${candidates.filter(c=>c.routeEligible!==false).map(c=>`<option value="${e(c.id)}"${selected?.id===c.id?' selected':''}>${e(candidateName(c))}</option>`).join('')}`;
  }
  function selectedVisits(){return viaIds.map(candidateById).filter(Boolean);}
  function visitsHtml(){
    const options=matchingVia().filter(c=>!viaIds.includes(c.id)&&!selectedVisits().some(chosen=>samePlace(chosen.coordinate,c.coordinate)));
    return `<section class="walk-visits"><h3>${mode==='inspection'?'방문할 점검지':'경유 시설'}</h3><p>${mode==='inspection'?'최대 3곳을 고른 순서대로 방문해요.':viaIds.length?'각 시설을 하나씩 들르는 대안으로 비교해요.':'자동 제안을 사용하거나, 직접 최대 2곳을 고를 수 있어요.'}</p><div class="walk-visit-add"><label class="walk-sr-only" for="walk-via-choice">${mode==='inspection'?'방문할 점검지 선택':'경유할 시설 선택'}</label><select id="walk-via-choice"${disabled()}${viaIds.length>=limit()?' disabled':''}><option value="">${options.length?'시설을 골라 추가':'경유용 수록자료 미연결'}</option>${options.map(c=>`<option value="${e(c.id)}">${e(candidateName(c))}</option>`).join('')}</select><button data-action="walk-add-via"${disabled()}${!options.length||viaIds.length>=limit()?' disabled':''}>추가</button></div>${viaIds.length?`<ol class="walk-visit-list">${selectedVisits().map((c,i)=>`<li><span class="walk-visit-name">${e(c.name)}</span><div>${mode==='inspection'?`<button data-action="walk-move-via" data-id="${e(c.id)}" data-direction="up" aria-label="${e(c.name)} 방문 순서 앞으로"${i===0?' disabled':''}${disabled()}>↑</button><button data-action="walk-move-via" data-id="${e(c.id)}" data-direction="down" aria-label="${e(c.name)} 방문 순서 뒤로"${i===viaIds.length-1?' disabled':''}${disabled()}>↓</button>`:''}<button data-action="walk-remove-via" data-id="${e(c.id)}" aria-label="${e(c.name)} 경유 제외"${disabled()}>×</button></div></li>`).join('')}</ol><button class="walk-text-button" data-action="walk-clear-via"${disabled()}>${mode==='inspection'?'방문지 비우기':'직접 선택 해제 · 자동 제안으로'}</button>`:''}${!matchingVia().length?'<p class="walk-help">이 목적의 경유자료가 아직 연결되지 않았어요. 시설이 없다는 뜻은 아니에요.</p>':''}${mode==='inspection'?`<details class="walk-notes walk-stay-options"><summary>현장 체류시간 가정</summary><label for="walk-stay-minutes">한 곳에서 머무는 시간<input id="walk-stay-minutes" type="number" min="0" max="120" step="1" value="${stayMinutes}"${disabled()}>분 / 곳</label><p>도보시간과 구분해서 예상 총시간에 더해요.</p></details>`:''}</section>`;
  }
  function seasonalControlsHtml(){
    if(!seasonalMode())return '';
    return `<section class="walk-season-options"><div class="walk-section-heading"><h3>언제 출발할까요?</h3><span class="walk-time-label">${departureExample?'예시 일시':'선택 일시'} · 한국시간</span></div><label class="walk-sr-only" for="walk-departure-at">출발 일시 · 한국시간</label><input id="walk-departure-at" type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59" value="${e(departure)}" step="60"${disabled()}><p class="walk-help">${departureExample?'실제 출발일이 아닌 낮 시간 예시예요. 원하는 일시로 바꿀 수 있어요.':'선택한 일시의 햇빛을 현재 조회한 보행경로에 적용해요.'}</p><label class="walk-checkbox walk-levels-option"><input id="walk-include-levels" type="checkbox"${includeLevels?' checked':''}${disabled()}>층수로 높이를 추정한 건물도 포함 (층당 3m 가정)</label><details class="walk-notes"><summary>우회·햇빛 비교 조건</summary><div class="walk-season-fields"><label for="walk-max-detour-meters">추가 거리 한도<input id="walk-max-detour-meters" type="number" min="0" max="3000" step="50" value="${e(maxDetourMeters)}"${disabled()}>m</label><label for="walk-max-detour-minutes">추가 시간 한도<input id="walk-max-detour-minutes" type="number" min="0" max="60" step="1" value="${e(maxDetourMinutes)}"${disabled()}>분</label><label for="walk-shadow-timing">햇빛을 비교할 시각<select id="walk-shadow-timing"${disabled()}><option value="walk-time"${shadowTiming==='walk-time'?' selected':''}>걷는 시간의 흐름 반영</option><option value="departure-static"${shadowTiming==='departure-static'?' selected':''}>출발 시각으로 고정</option></select></label></div><p class="walk-help">거리와 시간 한도를 모두 지키는 조회 후보끼리 비교해요.</p><button class="walk-text-button" data-action="walk-time-example"${disabled()}>낮 시간 예시로 되돌리기</button></details></section>`;
  }
  function seasonalMetricsHtml(route){
    if(!seasonalMode())return '';
    const data=route.seasonal;
    if(!data)return '<span class="walk-season-missing">햇빛·계절 평가 결과는 아직 수신하지 못했어요. 도보 거리·시간은 조회 결과예요.</span>';
    const coverage=data.coverage||{},total=data.routeLengthMeters??data.totalDistanceM,unknown=data.unevaluatedMeters??data.unknownDistanceM,evaluated=data.evaluatedMeters??(finite(total)&&finite(unknown)?Math.max(0,total-unknown):null),shade=data.estimatedShadeMeters??data.shadedDistanceM;
    const evaluatedRatio=Number.isFinite(data.coverageRatio)?data.coverageRatio:Number.isFinite(coverage.evaluatedRatio)?coverage.evaluatedRatio:finite(evaluated)&&total>0?evaluated/total:null;
    const cell=(title,value)=>`<span><span>${title}</span><b>${value}</b></span>`;
    const summer=cell('수록 건물로 계산한 추정 그늘',finite(shade)&&(shade>0||evaluated>0||evaluatedRatio>0||data.solarState==='day')?distance(shade):'미평가');
    const winter=data.winter||{},lowSun=data.lowSunMeters??data.winterlowSunMeters??data.winterLowSunMeters??winter.lowSunMeters??winter.lowSunDistanceM,icing=data.icingNearbyMeters??winter.icingNearbyMeters??winter.icingNearbyDistanceM;
    const winterHasEvaluation=Number.isFinite(data.winterCoverageRatio)&&data.winterCoverageRatio>0||finite(total)&&finite(data.winterUnevaluatedMeters)&&data.winterUnevaluatedMeters<total;
    const winterCells=cell('일조 적은 거리',finite(lowSun)&&(lowSun>0||winterHasEvaluation)?distance(lowSun):'미평가')+cell('결빙관리지점 인근',finite(icing)?distance(icing):'미평가');
    const assessed=mode==='winter'?(finite(data.winterUnevaluatedMeters)&&finite(total)?Math.max(0,total-data.winterUnevaluatedMeters):null):evaluated,missing=mode==='winter'?data.winterUnevaluatedMeters:unknown,ratio=mode==='winter'?data.winterCoverageRatio??(total>0&&finite(assessed)?assessed/total:null):evaluatedRatio;
    return `<span class="walk-season-metrics">${mode==='winter'?winterCells:summer}${cell(mode==='winter'?'일조 비교 가능한 거리':'평가 가능한 거리',finite(assessed)?`${distance(assessed)}${ratio!==null&&ratio!==undefined?` · ${percent(ratio)}`:''}`:'미평가')}${cell(mode==='winter'?'일조 미확인 거리':'그늘·일조 미확인 거리',finite(missing)?distance(missing):'미확인')}</span>`;
  }
  function seasonalSummaryHtml(){
    if(!seasonalMode()||!result)return '';
    const seasonal=result.seasonal||{},comparison=seasonal.comparison||{},preferred=result.routes.find(r=>r.id===comparison.preferredRouteId),conditions=result.uiConditions||{};
    const readable=[...list(seasonal.notes),...list(seasonal.reasons)].map(note=>readableReason(typeof note==='string'?note:note.message||note.reason)).filter(Boolean);
    const reason=readableReason(comparison.reason)||readableReason(comparison.basis)||readable[0]||'수록 자료로 계산한 구간과 미확인 구간을 함께 확인해 주세요.';
    const extra=preferred&&result.routes.find(r=>r.role==='direct');
    return `<section class="walk-season-summary"><p class="walk-season-date">${result.uiDepartureExample?'예시 일시':'선택 일시'} ${departureLabel(conditions.departureAt)} · 한국시간${conditions.includeLevels?' · 층당 3m 높이 가정 포함':''}</p><h3>${preferred?'조회한 후보 중 먼저 살펴볼 길':'이번 조회에서 우선안은 정하지 않았어요'}</h3>${preferred?`<p><strong>${e(preferred.role==='direct'?'바로 가는 경로':preferred.label||'시설 경유 경로')}</strong></p>${extra?`<p>바로 가는 길 대비 ${difference(preferred.durationSeconds,extra.durationSeconds,duration)} · ${difference(preferred.distanceMeters,extra.distanceMeters,distance)}</p>`:''}<button data-action="walk-select-route" data-id="${e(preferred.id)}">이 경로 지도 보기 ↗</button>`:''}<p>${e(reason)}</p><p class="walk-help">${mode==='winter'?'일조·공개 관리지점을 살피는 참고자료이며, 결빙 발생 여부나 확률을 계산한 값은 아니에요.':'현재 수록된 건물로 추정한 그늘이에요. 건물높이·자료 범위가 불명확한 구간은 미확인 거리로 남겨요.'}</p>${list(comparison.excluded).map(item=>({name:result.routes.find(r=>r.id===item.id)?.label||'비교 후보',reason:readableReason(item.reason)})).some(item=>item.reason)?`<details class="walk-notes"><summary>우선안을 정할 때 확인한 조건</summary><ul>${list(comparison.excluded).map(item=>({name:result.routes.find(r=>r.id===item.id)?.label||'비교 후보',reason:readableReason(item.reason)})).filter(item=>item.reason).map(item=>`<li>${e(item.name)}: ${e(item.reason)}</li>`).join('')}</ul></details>`:''}</section>`;
  }
  function seasonalBasisHtml(){
    if(!seasonalMode()||!result?.seasonal)return '';
    const seasonal=result.seasonal,model=seasonal.model||{},counts=model.heightCounts||{},declared=seasonal.coverage?.declared,active=result.routes.find(r=>r.id===activeId)?.seasonal;
    const reasons=[...new Set([...list(seasonal.reasons),...list(active?.reasons)].map(reason=>readableReason(typeof reason==='string'?reason:reason.message||reason.reason)).filter(Boolean))];
    return `<details class="walk-notes walk-season-basis"><summary>비교에 사용한 자료·범위</summary>${finite(counts.total)?`<p>입력 건물 ${Math.round(counts.total).toLocaleString('ko-KR')}개 중 원자료 높이 확인 ${finite(counts.sourceHeight)?Math.round(counts.sourceHeight).toLocaleString('ko-KR'):'미제공'}개${finite(counts.unknownHeight)?` · 높이 미확인 ${Math.round(counts.unknownHeight).toLocaleString('ko-KR')}개`:''}.</p>`:''}${model.includeLevels===true?`<p>층당 3m 높이 가정으로 계산한 건물 ${finite(counts.estimatedHeight)?Math.round(counts.estimatedHeight).toLocaleString('ko-KR')+'개':'수록분'}를 포함했어요. 실제 측량 높이가 아닌 가정값이에요.</p>`:model.includeLevels===false?'<p>층수로 추정하거나 화면 표시용으로 넣은 높이는 그늘 계산에 사용하지 않았어요.</p>':''}${declared===false?'<p>건물이 빠짐없이 수록된 범위는 아직 확인되지 않았어요. 그늘을 확인하지 못한 곳을 햇볕 구간으로 단정하지 않아요.</p>':''}<p>${result.uiConditions?.shadowTiming==='walk-time'?'걷는 시간에 따라 햇빛 방향을 다시 비교해요. 시설 체류·신호 대기는 반영하지 않아요.':'출발 시각의 햇빛 방향을 경로 전체에 적용한 비교예요.'}</p>${mode==='winter'?'<p>겨울 일조는 선택한 날짜의 09~16시를 기준으로 살펴봐요. 출발 순간의 그늘과 별개이며, 노면 온도·습기는 반영하지 않아요.</p><p>결빙관리지점 인근은 공개 대표점 50m 이내(앱 설정)를 뜻하며, 현재 보도의 빙판 여부를 판정한 값은 아니에요.</p>':''}<p>그늘·일조 거리는 경로선형을 나눠 추정한 값이라 제공기관 합계 거리와 차이 날 수 있어요.</p>${reasons.length?`<ul>${reasons.map(reason=>`<li>${e(reason)}</li>`).join('')}</ul>`:''}</details>`;
  }
  function safetyReferencesHtml(){
    if(mode!=='safety'||!safetyReferences)return '';
    const refs=Array.isArray(safetyReferences)?safetyReferences:list(safetyReferences.routes||safetyReferences.items||safetyReferences.references);
    if(!refs.length)return '<p class="walk-help">이 지역의 공식 귀갓길 안내 자료는 아직 연결되지 않았어요.</p>';
    return `<details class="walk-notes walk-safe-return"><summary>공식 여성안심 귀갓길 안내 · ${refs.length}곳</summary><p>아래 지정길은 공식 원문에서 확인해요. 이번에 비교한 도보경로와는 별개예요.</p>${refs.map(item=>{const url=safeUrl(item.sourceUrl||item.url||safetyReferences.sourceUrl);return `<article><h3>${e(item.name||item.title||'공식 지정길')}</h3>${item.area||item.summary||item.description?`<p>${e(item.area||item.summary||item.description)}</p>`:''}<p>${e(item.sourceName||safetyReferences.sourceName||'공식 공개 안내')} · 기준 ${e(item.sourceDate||safetyReferences.sourceDate||'미제공')}</p>${url?`<a href="${e(url)}" target="_blank" rel="noreferrer">공식 안내 보기 ↗</a>`:''}</article>`;}).join('')}</details>`;
  }
  function assessmentLegendHtml(){
    if(!assessmentFeatures.length)return '';
    const states=new Set(assessmentFeatures.map(feature=>feature.properties.assessmentState)),labels=mode==='winter'?[['low','일조 적음','#d57416'],['sufficient','일조 기준 충족','#e0b323'],['unknown','일조 미평가','#7d8792']]:[['shade','추정 그늘','#168c80'],['sun','햇빛 평가','#e0b323'],['unknown','미평가','#7d8792']];
    return `<div class="walk-assessment-legend" aria-label="선택 경로의 구간별 평가 범례">${labels.filter(([state])=>states.has(state)).map(([state,name,color])=>`<span><i style="--walk-assessment-color:${color}"></i>${name}</span>`).join('')}<p>선택한 경로의 평가 결과를 구간별로 표시해요.</p></div>`;
  }
  function resultHtml(){
    if(!result)return '';
    const direct=result.routes.find(r=>r.role==='direct');
    return `<section class="walk-results" aria-live="polite"><div class="walk-section-heading"><h3>도보경로 비교</h3><span>TMAP</span></div><p class="walk-help">예상 보행시간이며, 시설 이용·점검에 머무는 시간은 별도예요.</p>${seasonalSummaryHtml()}${assessmentLegendHtml()}<div class="walk-route-cards">${result.routes.map(route=>`<button class="walk-route-card${activeId===route.id?' is-active':''}" data-action="walk-select-route" data-id="${e(route.id)}" aria-pressed="${activeId===route.id}"><span class="walk-route-title">${e(route.role==='direct'?'바로 가는 경로':route.label||'시설 경유 경로')}</span><strong>${duration(route.durationSeconds)} <span>· ${distance(route.distanceMeters)}</span></strong>${route.role!=='direct'&&direct?`<small>바로 가는 길보다 ${difference(route.durationSeconds,direct.durationSeconds,duration)} · ${difference(route.distanceMeters,direct.distanceMeters,distance)}</small>`:''}${seasonalMetricsHtml(route)}${mode==='inspection'&&list(route.via).length?`<span class="walk-route-stay">체류 ${stayMinutes}분 × ${list(route.via).length}곳 가정 · 총 약 ${duration(route.durationSeconds+stayMinutes*list(route.via).length*60)}</span>`:''}${list(route.via).length?`<span class="walk-route-via">경유: ${e(route.via.map(c=>c.name).join(' → '))}</span>`:''}<span class="walk-map-link">${activeId===route.id?'지도에 표시 중':'이 경로 지도 보기'} ↗</span></button>`).join('')}</div><p class="walk-query-time">TMAP 도보경로 · 조회 ${time(result.requestedAt)}<br>${time(expires)}까지 이 화면에서 확인할 수 있어요.</p>${seasonalBasisHtml()}${list(result.warnings).length?`<details class="walk-notes"><summary>이번 경로의 확인사항</summary><ul>${list(result.warnings).map(w=>`<li>${e(typeof w==='string'?w:w.message||w.note||'추가 확인이 필요해요.')}</li>`).join('')}</ul></details>`:''}<details class="walk-notes"><summary>시설 자료와 이용 범위</summary><p>시설 개방·작동 상태는 방문 전에 확인하세요. ${seasonalMode()?'건물과 햇빛을 단순화한 거리 추정이며, 실제 체감온도나 현장 상태와는 다를 수 있어요.':mode==='safety'?'안심시설 경유는 실제 안전도나 안전한 통행을 보장하는 판정이 아니에요.':''}</p>${list(result.routes.find(r=>r.id===activeId)?.via).map(c=>`<p><strong>${e(c.name)}</strong><br>${e(c.sourceName||'공개 수록자료')} · 기준 ${e(c.sourceDate||'미제공')}${c.note?`<br>${e(c.note)}`:''}</p>`).join('')}</details></section>`;
  }
  function render(){
    if(destroyed)return;const scroll=host()?.scrollTop||0,current=MODES.find(m=>m.id===mode);
    api.show('생활도보길',`<div class="walk-routes" aria-busy="${busy||loading}"><nav class="walk-tabs" aria-label="도보길 목적">${MODES.map(m=>`<button data-action="walk-mode" data-mode="${m.id}" aria-pressed="${mode===m.id}">${e(m.label)}</button>`).join('')}</nav><p class="walk-intro">${e(current.help)}</p>${configured===false?'<div class="walk-connection"><strong>지금은 도보길을 조회할 수 없어요.</strong><p>출발·도착은 먼저 골라둘 수 있어요.</p><button data-action="walk-retry">다시 확인</button></div>':''}${loading?'<p class="walk-status" role="status">이 지역의 공개시설 목록을 읽고 있어요.</p>':''}${error?`<div class="walk-error" role="alert"><p>${e(error)}</p>${!catalogueLoaded?'<button data-action="walk-retry">다시 불러오기</button>':''}</div>`:''}${pick?`<div class="walk-pick" role="status"><strong>지도에서 ${pick==='start'?'출발':'도착'} 위치를 선택하세요.</strong><p>${e(api.label?.()||regionName())} 안에서 선택할 수 있어요.</p><button data-action="walk-cancel-pick">선택 취소</button></div>`:''}<section class="walk-points"><div class="walk-section-heading"><h3>어디서 어디까지 갈까요?</h3><button class="walk-text-button" data-action="walk-example"${disabled()}>예시 선택</button></div><p class="walk-help">${e(regionName())} 전체 수록시설 목록에서 고르거나 지도에서 선택해요.</p>${['start','end'].map((field,i)=>`<div class="walk-point-field"><label for="walk-${field}-choice"><span class="walk-point-dot ${field}">${i===0?'출발':'도착'}</span></label><select id="walk-${field}-choice"${disabled()}>${pointOptions(field)}</select><button data-action="walk-pick" data-field="${field}"${disabled()}>지도에서 선택</button></div>`).join('')}<button class="walk-text-button walk-swap" data-action="walk-swap"${disabled()}>출발·도착 바꾸기 ⇄</button>${sample?'<p class="walk-example-note">실제 수록시설을 예시로 골랐어요. 원하는 위치로 바꿀 수 있어요.</p>':''}</section>${seasonalControlsHtml()}${visitsHtml()}${safetyReferencesHtml()}<label class="walk-checkbox"><input id="walk-avoid-stairs" type="checkbox"${avoidStairs?' checked':''}${disabled()}>계단을 피하는 옵션 적용</label><p class="walk-send-note">선택한 위치는 경로 조회를 위해 TMAP에 전송돼요.</p><div class="walk-run-actions"><button class="walk-primary" data-action="walk-calculate"${disabled()}${configured!==true||!start||!end||mode==='inspection'&&!viaIds.length?' disabled':''}>${busy?'도보경로를 비교하고 있어요…':'도보경로 비교'}</button><button data-action="walk-reset"${loading?' disabled':''}>초기화</button></div>${notice?`<p class="walk-notice" role="status">${e(notice)}</p>`:''}${resultHtml()}</div>`,VIEW);
    if(host())host().scrollTop=scroll;
  }
  function paint(){
    if(!result||expireIfNeeded())return;
    const route=result.routes.find(r=>r.id===activeId)||result.routes[0];activeId=route.id;
    const points=[{...start,id:'walk-start',role:'start'},{...end,id:'walk-end',role:'end'},...list(route.via).map(c=>({...c,role:'via'}))];
    assessmentFeatures=seasonalMode()?buildWalkAssessmentFeatures(route,{mode}):[];api.paintWalkRoutes?.(result.routes,activeId,points,assessmentFeatures);
  }
  async function calculate(){
    if(busy||loading||destroyed)return;expireIfNeeded();
    if(configured!==true){error='지금은 도보길을 조회할 수 없어요. 잠시 뒤 다시 확인해 주세요.';render();return;}
    if(!xy(start?.coordinate)||!xy(end?.coordinate)){error='출발과 도착을 모두 선택해 주세요.';render();return;}
    if(samePlace(start.coordinate,end.coordinate)){error='출발과 도착을 서로 다른 위치로 골라 주세요.';render();return;}
    if(selectedVisits().some(c=>samePlace(c.coordinate,start.coordinate)||samePlace(c.coordinate,end.coordinate))){error='출발·도착과 다른 경유시설을 골라 주세요.';render();return;}
    if(mode==='inspection'&&!viaIds.length){error='방문할 점검지를 한 곳 이상 골라 주세요.';render();return;}
    const departureAt=seasonalMode()?departureISO(departure):null;
    if(seasonalMode()&&(!departureAt||!Number.isFinite(maxDetourMeters)||maxDetourMeters<0||maxDetourMeters>3000||!Number.isFinite(maxDetourMinutes)||maxDetourMinutes<0||maxDetourMinutes>60)){error='출발 일시와 우회 한도를 확인해 주세요. 거리 0~3,000m, 시간 0~60분으로 입력할 수 있어요.';render();return;}
    clearResult();cancelPick();error='';notice='';busy=true;routeController=new AbortController();const controller=routeController,seq=++routeSequence;
    const request={regionId,mode,start:[...start.coordinate],end:[...end.coordinate],avoidStairs};if(viaIds.length)request.viaIds=[...viaIds];if(seasonalMode())Object.assign(request,{departureAt,shadowTiming,maxDetourMeters,maxDetourMinutes,includeLevels});render();
    const timer=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await fetch('/api/walk-routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal}),body=await responseBody(response);
      if(seq!==routeSequence||destroyed)return;
      if(!response.ok||body.ok===false){const message=typeof body.error==='string'?body.error:body.error?.message||'도보경로를 가져오지 못했어요.';if(body.code==='TMAP_NOT_CONFIGURED'||/TMAP_API_KEY|Vercel|재배포/.test(message)){configured=false;throw Error('지금은 도보길을 조회할 수 없어요. 잠시 뒤 다시 확인해 주세요.');}throw Error(message);}
      if(regionOf(body)&&regionOf(body)!==regionId||body.mode&&body.mode!==mode)throw Error('선택한 조건과 응답이 달라 경로를 표시하지 않았어요.');
      const routes=list(body.routes).filter(r=>r&&typeof r.id==='string'&&finite(r.distanceMeters)&&finite(r.durationSeconds)&&lineGeometry(r));
      if(!routes.length)throw Error('이번 조건의 도보경로를 받지 못했어요. 출발·도착을 조금 옮겨 다시 비교해 주세요.');
      const requestedAt=Date.parse(body.requestedAt),serverExpiry=Date.parse(body.expiresAt),base=Number.isFinite(requestedAt)?requestedAt:Date.now();
      expires=Math.min(Number.isFinite(serverExpiry)?serverExpiry:base+MAX_RESULT_AGE,base+MAX_RESULT_AGE,Date.now()+MAX_RESULT_AGE);
      if(expires<=Date.now())throw Error('응답의 표시 시간이 끝났어요. 다시 비교해 주세요.');
      result={...body,requestedAt:Number.isFinite(requestedAt)?body.requestedAt:new Date().toISOString(),routes,uiConditions:{departureAt,shadowTiming,maxDetourMeters,maxDetourMinutes,includeLevels},uiDepartureExample:departureExample};activeId=routes.find(r=>r.id===body.seasonal?.comparison?.preferredRouteId)?.id||routes.find(r=>r.role==='direct')?.id||routes[0].id;paint();armExpiry();
      const geometry=lineGeometry(routes.find(r=>r.id===activeId));if(geometry)api.frameGeometry?.(geometry);
    }catch(cause){if(seq!==routeSequence||destroyed)return;error=cause.name==='AbortError'?'경로 조회 시간이 길어졌어요. 잠시 뒤 다시 비교해 주세요.':cause.message||'도보경로를 조회하지 못했어요.';}
    finally{clearTimeout(timer);if(seq===routeSequence&&!destroyed){busy=false;routeController=null;if(openNow()){render();host()?.querySelector?.(error?'.walk-error':'.walk-results')?.scrollIntoView?.({block:'start',behavior:'smooth'});}}}
  }
  function beginPick(field){
    if(busy||loading)return;if(!api.state.ready){api.toast?.('지도가 준비된 뒤 위치를 선택할 수 있어요.');return;}
    if(!['start','end'].includes(field))return;pick=field;api.send?.({type:'tool',tool:`walk-${field}`});render();if(typeof innerWidth==='number'&&innerWidth<=820)api.close?.();api.toast?.(`지도에서 ${field==='start'?'출발':'도착'} 위치를 선택하세요.`);
  }
  function changePoint(field,id){const chosen=candidateById(id);clearResult();cancelPick();if(field==='start')start=pointFrom(chosen);else end=pointFrom(chosen);sample=false;error='';notice='';render();}
  const change=event=>{
    if(event.target.id==='walk-start-choice')changePoint('start',event.target.value);
    if(event.target.id==='walk-end-choice')changePoint('end',event.target.value);
    if(['walk-departure-at','walk-shadow-timing','walk-max-detour-meters','walk-max-detour-minutes'].includes(event.target.id)){clearResult();if(event.target.id==='walk-departure-at'){departure=event.target.value;departureExample=false;}else if(event.target.id==='walk-shadow-timing')shadowTiming=['walk-time','departure-static'].includes(event.target.value)?event.target.value:'walk-time';else if(event.target.id==='walk-max-detour-meters')maxDetourMeters=Number(event.target.value);else maxDetourMinutes=Number(event.target.value);error='';notice='';render();}
    if(event.target.id==='walk-include-levels'){clearResult();includeLevels=event.target.checked===true;error='';notice='';render();}
    if(event.target.id==='walk-stay-minutes'){const next=Number(event.target.value);stayMinutes=Number.isInteger(next)&&next>=0&&next<=120?next:10;render();}
    if(event.target.id==='walk-avoid-stairs'){clearResult();avoidStairs=event.target.checked;error='';notice='';render();}
  };
  const offs=[
    registerAction('walk-routes',button=>open(button?.dataset?.mode)),
    registerAction('walk-mode',button=>open(button.dataset.mode)),
    registerAction('walk-retry',()=>loadCatalogue()),
    registerAction('walk-time-example',()=>{if(busy||loading)return;clearResult();departure=daylightExample(mode);departureExample=true;error='';notice='낮 시간 예시를 선택했어요. 실제 출발 일시로 바꿀 수 있어요.';render();}),
    registerAction('walk-example',()=>{if(busy||loading)return;chooseSample();render();}),
    registerAction('walk-pick',button=>beginPick(button.dataset.field)),
    registerAction('walk-cancel-pick',()=>{cancelPick();render();}),
    registerAction('walk-swap',()=>{if(busy||loading)return;clearResult();[start,end]=[end,start];sample=false;error='';notice='';render();}),
    registerAction('walk-add-via',()=>{if(busy||loading)return;const id=document.getElementById('walk-via-choice')?.value,c=matchingVia().find(c=>c.id===id);if(!c||viaIds.includes(id)||viaIds.length>=limit()||selectedVisits().some(chosen=>samePlace(chosen.coordinate,c.coordinate)))return;if(samePlace(c.coordinate,start?.coordinate)||samePlace(c.coordinate,end?.coordinate)){notice='출발·도착과 다른 경유시설을 골라 주세요.';render();return;}clearResult();viaIds.push(id);error='';notice='';render();}),
    registerAction('walk-remove-via',button=>{if(busy||loading)return;clearResult();viaIds=viaIds.filter(id=>id!==button.dataset.id);render();}),
    registerAction('walk-clear-via',()=>{if(busy||loading)return;clearResult();viaIds=[];render();}),
    registerAction('walk-move-via',button=>{if(busy||loading||mode!=='inspection')return;const index=viaIds.indexOf(button.dataset.id),next=index+(button.dataset.direction==='up'?-1:1);if(index<0||next<0||next>=viaIds.length)return;clearResult();[viaIds[index],viaIds[next]]=[viaIds[next],viaIds[index]];render();}),
    registerAction('walk-calculate',calculate),
    registerAction('walk-reset',()=>{clearResult();cancelPick();start=null;end=null;viaIds=[];avoidStairs=false;stayMinutes=10;sample=false;error='';notice='출발·도착을 새로 선택해 주세요.';departure=daylightExample(mode);departureExample=true;shadowTiming='walk-time';maxDetourMeters=500;maxDetourMinutes=5;includeLevels=false;render();}),
    registerAction('walk-select-route',button=>{if(!result||expireIfNeeded())return;const route=result.routes.find(r=>r.id===button.dataset.id);if(!route)return;activeId=route.id;paint();const geometry=lineGeometry(route);if(geometry)api.frameGeometry?.(geometry);render();}),
  ];
  host()?.addEventListener('change',change);
  const visibility=()=>{if(!document.hidden)expireIfNeeded();};document.addEventListener?.('visibilitychange',visibility);
  return {
    open,
    onEvent(message){
      if(message.type==='point'&&['walk-start','walk-end'].includes(message.tool)){
        const field=message.tool==='walk-start'?'start':'end';if(pick!==field)return true;const point=Array.isArray(message.point)?message.point.slice(0,2):null;
        if(!xy(point)||!api.state.scope||!inside(point,api.state.scope)){api.toast?.('현재 선택한 지역 안의 위치를 골라 주세요.');return true;}
        clearResult();cancelPick();const selected={id:`map-${field}`,name:`지도에서 고른 ${field==='start'?'출발지':'도착지'}`,coordinate:point};if(field==='start')start=selected;else end=selected;sample=false;error='';notice='지도에서 고른 위치를 반영했어요.';render();return true;
      }
      if(message.type==='ready'&&result){paint();return false;}return false;
    },
    scopeChanged(){if(regionId&&regionId!==(api.state.regionProfile?.id||'seogu')){reset();if(openNow())loadCatalogue();return;}if(pick){cancelPick();if(openNow())render();}},
    destroy(){destroyed=true;catalogueController?.abort();catalogueSequence++;clearResult();cancelPick();offs.forEach(off=>off());host()?.removeEventListener('change',change);document.removeEventListener?.('visibilitychange',visibility);},
  };
}
