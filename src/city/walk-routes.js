import {buildWalkNavigation} from '../../shared/walk-navigation-model.js';
import {installWalkingNavigation} from './walking-navigation.js';
import {registerAction} from './actions.js';
import {inside} from './geometry.js';
import {walkDistance} from '../../shared/walk-route-model.js';

const VIEW='walk-routes',MAX_RESULT_AGE=30*60*1000;
const MODES=[
  {id:'shade',label:'여름 그늘길',help:'선택한 일시의 건물 그늘과 우회 거리를 함께 비교해요.'},
  {id:'winter',label:'겨울 안전보행',help:'일조가 적은 구간과 공개 결빙관리지점 주변을 나눠 살펴봐요.'},
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
const candidateName=c=>[c.name,({shade:'그늘막',shelter:'쉼터',police:'경찰시설',bell:'비상벨',childcare:'어린이집',care:'돌봄·육아시설',public:'공공공간'})[c.category]||'시설'].filter(Boolean).join(' · ');
async function responseBody(response){try{return await response.json();}catch{throw Error('서버 응답을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.');}}
const pointFrom=c=>c?{id:c.id,name:c.name,address:c.address||'',coordinate:[...c.coordinate],sourceName:c.sourceName,sourceUrl:c.sourceUrl,sourceDate:c.sourceDate}:null;

const safeUrl=value=>{if(typeof value!=='string'||value.length>2048)return '';try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?value:'';}catch{return '';}};
const percent=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?`${Math.round(value*100)}%`:'미제공';
const currentDeparture=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,16);
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
  let regionId='',mode='shade',basic=true,candidates=[],catalogueLoaded=false,configured=null,start=null,end=null,avoidStairs=false,viaIds=[],sample=false,stayMinutes=10;
  const expanded=new Set();let entrySequence=0;
  let result=null,activeId='',expires=0,expiryTimer=null,pick='',error='',notice='',loading=false,busy=false,destroyed=false,suspended=false;
  let catalogueController=null,cataloguePromise=null,routeController=null,catalogueSequence=0,routeSequence=0;
  const searches={start:{query:'',items:[],busy:false,notice:'',providers:[],sequence:0},end:{query:'',items:[],busy:false,notice:'',providers:[],sequence:0}};
  let navigation=null,locateSequence=0,locating=false,tripPlan=null,planQuestion='',planning=false,planController=null,planSequence=0;
  let departure=currentDeparture(),departureExample=false,shadowTiming='walk-time',maxDetourMeters=500,maxDetourMinutes=5,safetyReferences=null,includeLevels=false,assessmentFeatures=[];
  const host=()=>document.getElementById('detail-body');
  const openNow=()=>api.state.view===VIEW;
  const regionName=()=>api.state.regionProfile?.name||'선택 지역';
  const limit=()=>mode==='inspection'?3:2;
  const seasonalMode=()=>!basic&&(mode==='shade'||mode==='winter');
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
    navigation?.stop();planController?.abort();planController=null;planSequence++;planning=false;tripPlan=null;locateSequence++;locating=false;routeController?.abort();routeController=null;routeSequence++;busy=false;result=null;activeId='';assessmentFeatures=[];expires=0;clearTimeout(expiryTimer);expiryTimer=null;api.clearWalkRoutes?.();
    if(message)notice=message;updateStep();host()?.querySelector?.('.walk-results')?.remove?.();
  }
  function cancelPick(){pick='';api.send?.({type:'stop'});}
  function clearSearch(field){const search=searches[field];search.controller?.abort();search.controller=null;search.sequence++;search.busy=false;search.items=[];search.notice='';search.providers=[];}
  function reset(){
    entrySequence++;expanded.clear();basic=true;mode='shade';
    for(const field of ['start','end']){clearSearch(field);searches[field].query='';}
    catalogueController?.abort();catalogueController=null;catalogueSequence++;clearResult();cancelPick();regionId=api.state.regionProfile?.id||'seogu';candidates=[];catalogueLoaded=false;configured=null;start=null;end=null;viaIds=[];avoidStairs=false;stayMinutes=10;sample=false;error='';notice='';loading=false;departure=currentDeparture();departureExample=false;shadowTiming='walk-time';maxDetourMeters=500;maxDetourMinutes=5;safetyReferences=null;includeLevels=false;
  }
  function expireIfNeeded(){if(result&&Date.now()>=expires){clearResult('조회한 경로의 표시 시간이 끝났어요. 다시 비교해 주세요.');if(openNow())render();return true;}return false;}
  function armExpiry(){
    clearTimeout(expiryTimer);const remaining=expires-Date.now();
    if(remaining<=0){expireIfNeeded();return;}
    expiryTimer=setTimeout(()=>{if(!destroyed)expireIfNeeded();},remaining);expiryTimer?.unref?.();
  }
  function chooseSample(){
    for(const field of ['start','end']){clearSearch(field);searches[field].query='';}
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
      return /^(map-(start|end)$|search:)/.test(point.id)&&xy(point.coordinate)&&region&&inside(point.coordinate,region)?point:null;
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
    const previous=JSON.stringify({start,end,visits:selectedVisits().map(pointFrom)});
    catalogueController?.abort();catalogueController=new AbortController();const controller=catalogueController,seq=++catalogueSequence;loading=true;error='';render();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(`/api/walk-routes?region=${encodeURIComponent(regionId)}`,{signal:controller.signal}),body=await responseBody(response);
      if(!response.ok||body.ok===false)throw Error(typeof body.error==='string'?body.error:body.error?.message||'시설 목록을 가져오지 못했어요.');
      if(seq!==catalogueSequence||destroyed)return;
      if(regionOf(body)&&regionOf(body)!==regionId)throw Error('선택 지역과 시설 자료의 지역이 달라 표시하지 않았어요.');
      const seen=new Set();candidates=list(body.candidates).filter(c=>c&&typeof c.id==='string'&&typeof c.name==='string'&&xy(c.coordinate)&&!seen.has(c.id)&&seen.add(c.id)).map(c=>({...c,name:c.name.slice(0,180),coordinate:[...c.coordinate]}));
      configured=body.configured===true;safetyReferences=body.safetyReferences||body.safeReturn||null;catalogueLoaded=true;const changed=reconcileCatalogueSelection(previous);
      if(!candidates.length)notice=(changed?notice+' ':'')+'이 지역의 수록시설 목록이 없어요. 지도에서 출발·도착을 선택할 수 있어요.';
    }catch(cause){if(seq!==catalogueSequence||destroyed)return;error=cause.name==='AbortError'?'시설 목록을 읽는 시간이 길어졌어요. 다시 열어 주세요.':cause.message||'시설 목록을 읽지 못했어요.';}
    finally{clearTimeout(timer);if(seq===catalogueSequence&&!destroyed){loading=false;if(openNow())render();}}
  }
  async function open(nextMode,destination){
    if(destroyed)return;suspended=false;if(!regionId||regionId!==(api.state.regionProfile?.id||'seogu'))reset();
    const entry=++entrySequence;
    if(nextMode==='basic'&&!basic||nextMode&&isMode(nextMode)&&(mode!==nextMode||basic)){clearResult();cancelPick();basic=nextMode==='basic';mode=basic?'shade':nextMode;viaIds=[];if(departureExample&&seasonalMode())departure=daylightExample(mode);error='';notice='';}
    expireIfNeeded();render();if(!catalogueLoaded){if(!loading)cataloguePromise=loadCatalogue();await cataloguePromise;}else if(result)paint();
    if(destination&&entry===entrySequence&&!destroyed&&!suspended){
      clearResult();cancelPick();clearSearch('end');searches.end.query='';if(sample){start=null;clearSearch('start');searches.start.query='';}sample=false;end=null;
      const boundary=api.state.district||api.state.scope,regionMatches=!destination.destinationRegion||destination.destinationRegion===regionId;
      const matching=regionMatches?candidates.filter(c=>c.routeEligible===true&&xy(c.coordinate)&&boundary&&inside(c.coordinate,boundary)&&(destination.destinationId?c.id===destination.destinationId:destination.destinationDataset&&destination.destinationSourceId&&[c,...list(c.sourceRefs)].some(ref=>ref.datasetId===destination.destinationDataset&&ref.sourceId!=null&&String(ref.sourceId)===destination.destinationSourceId))):[];
      if(matching.length===1){end=pointFrom(matching[0]);viaIds=viaIds.filter(id=>!samePlace(candidateById(id)?.coordinate,end.coordinate));notice='도착지를 골랐어요. 출발지를 정하면 길을 찾을 수 있어요.';error='';}
      else{error='이 시설의 위치를 현재 지역에서 확인하지 못했어요. 도착지를 검색하거나 지도에서 선택해 주세요.';notice='';}
      expanded.add('endpoints');render();
    }
  }
  function pointOptions(field){
    const selected=field==='start'?start:end;
    return `<option value="">수록시설에서 선택</option>${selected&&!candidateById(selected.id)?`<option value="${e(selected.id)}" selected>${e(selected.name)}</option>`:''}${candidates.filter(c=>c.routeEligible!==false).map(c=>`<option value="${e(c.id)}"${selected?.id===c.id?' selected':''}>${e(candidateName(c))}</option>`).join('')}`;
  }
  function pointSearchHtml(field){
    const search=searches[field],selected=field==='start'?start:end,label=field==='start'?'출발지':'도착지';
    const available=search.providers.filter(provider=>provider.status==='available').map(provider=>provider.name);
    const hasFailure=search.providers.some(provider=>provider.status==='unavailable');
    const resultSummary=search.items.length?`<p class="walk-search-summary" role="status"><strong>${e(available.join(' · ')||'수록시설 검색')}</strong><span>${e(regionName())} 안 · ${search.items.length}곳</span></p>`:'';
    const searchNotice=search.notice?(available.length&&search.items.length&&!hasFailure?`<details class="walk-search-details"><summary>검색 범위·자료 안내</summary><p class="walk-help walk-place-notice">${e(search.notice)}</p></details>`:`<p class="walk-help walk-place-notice" role="status">${e(search.notice)}</p>`):'';
    const results=search.items.length?`<ul class="walk-place-results" aria-label="${label} 검색 결과">${search.items.map((item,index)=>{
      const evidence=item.searchProvider==='tmap'?'TMAP 검색 결과 · 실제 출입구를 확인하세요.':`기준 ${e(item.sourceDate||'미제공')}${safeUrl(item.sourceUrl)?` · <a href="${e(safeUrl(item.sourceUrl))}" target="_blank" rel="noopener noreferrer">원자료 보기</a>`:' · 원자료 링크 미제공'}`;
      return `<li><button data-action="walk-choose-place" data-field="${field}" data-index="${index}"><strong>${e(item.name)}</strong><span>${e(item.address||'주소 미제공')}</span><small>${e(item.sourceName||'공개 수록시설')} · ${label}로 선택</small>${item.approximate?'<small class="walk-match-note">비슷한 검색 후보 · 명칭·주소 확인</small>':''}</button><small class="walk-search-source">${evidence}</small></li>`;
    }).join('')}</ul>`:'';
    return `<form class="walk-place-search" data-walk-search="${field}" aria-busy="${search.busy}"><label class="walk-sr-only" for="walk-${field}-query">${label} 장소명 또는 주소 검색</label><input id="walk-${field}-query" type="search" maxlength="100" autocomplete="off" enterkeyhint="search" placeholder="가게·건물·도로명주소 검색" aria-describedby="walk-search-scope" value="${e(search.query)}"${disabled()}><button type="submit"${disabled()}${search.busy?' disabled':''}>${search.busy?'검색 중':'검색'}</button></form>${resultSummary}${results}${searchNotice}${selected?`<p class="walk-point-selected" id="walk-${field}-selected"><strong>${label}: ${e(selected.name)}</strong>${selected.address?`<br>${e(selected.address)}`:''}${selected.sourceName?`<small class="walk-selected-source">${e(selected.sourceName)}</small>`:''}${safeUrl(selected.sourceUrl)?`<br><a href="${e(safeUrl(selected.sourceUrl))}" target="_blank" rel="noopener noreferrer">선택 시설 원자료</a> · 기준 ${e(selected.sourceDate||'미제공')}`:''}</p>`:''}`;
  }
  async function searchPoint(field){
    if(!['start','end'].includes(field)||busy||loading||destroyed)return;
    const search=searches[field];search.query=(document.getElementById(`walk-${field}-query`)?.value??search.query).trim();clearSearch(field);
    if(search.query.length<2||search.query.length>100){search.notice='장소명이나 주소를 2~100자로 입력해 주세요.';render();return;}
    clearResult();cancelPick();if(field==='start')start=null;else end=null;sample=false;error='';notice='';search.busy=true;const seq=search.sequence,controller=new AbortController();search.controller=controller;const timer=setTimeout(()=>controller.abort(),15000);render();
    try{
      const response=await fetch(`/api/walk-routes?region=${encodeURIComponent(regionId)}&q=${encodeURIComponent(search.query)}`,{signal:controller.signal}),body=await responseBody(response);
      if(seq!==search.sequence||destroyed)return;
      if(!response.ok||body.ok===false)throw Error(typeof body.error==='string'?body.error:'장소 검색을 완료하지 못했어요.');
      if(regionOf(body)&&regionOf(body)!==regionId)throw Error('선택 지역과 검색 결과의 지역이 달라 표시하지 않았어요.');
      const boundary=api.state.district||api.state.scope;
      search.items=list(body.items).filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&xy(item.coordinate)&&boundary&&inside(item.coordinate,boundary)).slice(0,30);
      search.providers=list(body.providers).filter(provider=>provider&&typeof provider.name==='string'&&['available','unavailable','not-configured','not-requested'].includes(provider.status));
      search.notice=(search.items.length?'':'검색된 장소가 없어요. ')+(typeof body.notice==='string'?body.notice:search.items.length?'위치를 확인하고 출발지·도착지로 선택하세요.':'동명·지점명 또는 도로명과 건물번호를 더 입력해 주세요.');
    }catch(cause){if(seq!==search.sequence||destroyed)return;const terms=search.query.toLowerCase().split(/\s+/);search.items=candidates.filter(c=>c.routeEligible!==false&&terms.every(term=>`${c.name} ${c.address||''}`.toLowerCase().includes(term))).slice(0,20);search.notice=search.items.length?'장소 검색 연결이 지연되어 수록시설 결과를 표시해요.':'장소 검색 연결이 지연되고 있어요. 수록시설 목록이나 지도에서 위치를 선택해 주세요.';}
    finally{clearTimeout(timer);if(seq===search.sequence&&!destroyed){search.busy=false;search.controller=null;if(openNow())render();}}
  }
  function selectedVisits(){return viaIds.map(candidateById).filter(Boolean);}
  function visitsHtml(){
    const options=matchingVia().filter(c=>!viaIds.includes(c.id)&&!selectedVisits().some(chosen=>samePlace(chosen.coordinate,c.coordinate)));
    return `<section class="walk-visits"><h3>${mode==='inspection'?'방문할 점검지':'경유 시설'}</h3><p>${mode==='inspection'?'최대 3곳을 고른 순서대로 방문해요.':viaIds.length?'각 시설을 하나씩 들르는 대안으로 비교해요.':'자동 제안을 사용하거나, 직접 최대 2곳을 고를 수 있어요.'}</p><div class="walk-visit-add"><label class="walk-sr-only" for="walk-via-choice">${mode==='inspection'?'방문할 점검지 선택':'경유할 시설 선택'}</label><select id="walk-via-choice"${disabled()}${viaIds.length>=limit()?' disabled':''}><option value="">${options.length?'시설을 골라 추가':'경유용 수록자료 미연결'}</option>${options.map(c=>`<option value="${e(c.id)}">${e(candidateName(c))}</option>`).join('')}</select><button data-action="walk-add-via"${disabled()}${!options.length||viaIds.length>=limit()?' disabled':''}>추가</button></div>${viaIds.length?`<ol class="walk-visit-list">${selectedVisits().map((c,i)=>`<li><span class="walk-visit-name">${e(c.name)}</span><div>${mode==='inspection'?`<button data-action="walk-move-via" data-id="${e(c.id)}" data-direction="up" aria-label="${e(c.name)} 방문 순서 앞으로"${i===0?' disabled':''}${disabled()}>↑</button><button data-action="walk-move-via" data-id="${e(c.id)}" data-direction="down" aria-label="${e(c.name)} 방문 순서 뒤로"${i===viaIds.length-1?' disabled':''}${disabled()}>↓</button>`:''}<button data-action="walk-remove-via" data-id="${e(c.id)}" aria-label="${e(c.name)} 경유 제외"${disabled()}>×</button></div></li>`).join('')}</ol><button class="walk-text-button" data-action="walk-clear-via"${disabled()}>${mode==='inspection'?'방문지 비우기':'직접 선택 해제 · 자동 제안으로'}</button>`:''}${!matchingVia().length?'<p class="walk-help">이 목적의 경유자료가 아직 연결되지 않았어요. 시설이 없다는 뜻은 아니에요.</p>':''}${mode==='inspection'?`<details class="walk-notes walk-stay-options"><summary>현장 체류시간 가정</summary><label for="walk-stay-minutes">한 곳에서 머무는 시간<input id="walk-stay-minutes" type="number" min="0" max="120" step="1" value="${stayMinutes}"${disabled()}>분 / 곳</label><p>도보시간과 구분해서 예상 총시간에 더해요.</p></details>`:''}</section>`;
  }
  function seasonalControlsHtml(){
    if(!seasonalMode())return '';
    return `<section class="walk-season-options"><div class="walk-section-heading"><h3>언제 출발할까요?</h3><span class="walk-time-label">${departureExample?'예시 일시':'선택 일시'} · 한국시간</span></div><label class="walk-sr-only" for="walk-departure-at">출발 일시 · 한국시간</label><input id="walk-departure-at" type="datetime-local" min="2000-01-01T00:00" max="2100-12-31T23:59" value="${e(departure)}" step="60"${disabled()}><button class="walk-text-button" data-action="walk-time-now"${disabled()}>지금 출발</button><p class="walk-help">${departureExample?'실제 출발일이 아닌 낮 시간 예시예요. 원하는 일시로 바꿀 수 있어요.':'선택한 일시의 햇빛을 현재 조회한 보행경로에 적용해요.'}</p><label class="walk-checkbox walk-levels-option"><input id="walk-include-levels" type="checkbox"${includeLevels?' checked':''}${disabled()}>층수로 높이를 추정한 건물도 포함 (층당 3m 가정)</label><details class="walk-notes"><summary>우회·햇빛 비교 조건</summary><div class="walk-season-fields"><label for="walk-max-detour-meters">추가 거리 한도<input id="walk-max-detour-meters" type="number" min="0" max="3000" step="50" value="${e(maxDetourMeters)}"${disabled()}>m</label><label for="walk-max-detour-minutes">추가 시간 한도<input id="walk-max-detour-minutes" type="number" min="0" max="60" step="1" value="${e(maxDetourMinutes)}"${disabled()}>분</label><label for="walk-shadow-timing">햇빛을 비교할 시각<select id="walk-shadow-timing"${disabled()}><option value="walk-time"${shadowTiming==='walk-time'?' selected':''}>걷는 시간의 흐름 반영</option><option value="departure-static"${shadowTiming==='departure-static'?' selected':''}>출발 시각으로 고정</option></select></label></div><p class="walk-help">거리와 시간 한도를 모두 지키는 조회 후보끼리 비교해요.</p><button class="walk-text-button" data-action="walk-time-example"${disabled()}>낮 시간 예시로 되돌리기</button></details></section>`;
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
  function tripPlanHtml(){return `<details class="walk-trip-plan"${planning||tripPlan?' open':''}><summary>말로 방문계획 만들기</summary><form data-walk-plan="true"><label for="walk-plan-question">공개시설 이름과 원하는 조건</label><textarea id="walk-plan-question" rows="3" maxlength="300" placeholder="예: 서구청 들불홀에서 상록도서관 유아도서관까지 계단을 피해 가고 싶어요"${disabled()}>${e(planQuestion)}</textarea><button type="submit"${disabled()}${planning?' disabled':''}>${planning?'공개자료로 계획 중…':'방문계획 정리'}</button></form><p class="walk-help">AI 연결 시 공개시설 후보와 질문으로 계획을 정리해요. 시설 선택과 실제 경로 조회는 확인 후 진행해요.</p>${tripPlan?`<article><strong>${tripPlan.mode==='llm'?'AI 방문계획':'공개목록 기반 계획 · AI 미사용'}</strong><p>출발: ${e(candidateById(tripPlan.plan.startId)?.name||'직접 선택 필요')}<br>도착: ${e(candidateById(tripPlan.plan.endId)?.name||'직접 선택 필요')}<br>계단 회피: ${tripPlan.plan.avoidStairs?'요청':'선택 안 함'}</p>${tripPlan.plan.viaIds.length?`<p>경유 후보: ${tripPlan.plan.viaIds.map(id=>e(candidateById(id)?.name||'확인 필요')).join(' · ')}</p>`:''}<ul>${list(tripPlan.checkDetails).map(item=>`<li>${e(item.text)}</li>`).join('')}</ul><p>${e(tripPlan.notice)}</p><button data-action="walk-apply-plan">시설·조건을 확인하고 반영</button>${tripPlan.model?`<small>사용 모델 ${e(tripPlan.model)}</small>`:''}</article>`:''}</details>`;}
  async function prepareTripPlan(){
    if(busy||loading||planning)return;planQuestion=(document.getElementById('walk-plan-question')?.value||planQuestion).trim();if(planQuestion.length<2||planQuestion.length>300){error='방문할 공개시설과 조건을 2~300자로 입력하세요.';render();return;}
    clearResult();const seq=++planSequence,controller=new AbortController();planController=controller;planning=true;error='';render();const timer=setTimeout(()=>controller.abort(),20000);
    try{const response=await fetch('/api/walk-routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'plan',regionId,question:planQuestion}),signal:controller.signal}),body=await responseBody(response);if(seq!==planSequence||destroyed)return;if(!response.ok||body.ok===false)throw Error(typeof body.error==='string'?body.error:'방문계획을 정리하지 못했어요.');const plan=body.plan,ids=[plan?.startId,plan?.endId,...list(plan?.viaIds)].filter(Boolean);if(regionOf(body)!==regionId||!isMode(plan?.mode)||typeof plan?.avoidStairs!=='boolean'||!Array.isArray(plan?.viaIds)||plan.viaIds.length>3||ids.some(id=>!candidateById(id)))throw Error('공개목록과 계획 결과가 달라 반영하지 않았어요.');tripPlan=body;}catch(cause){if(seq===planSequence)error=cause.name==='AbortError'?'계획을 정리하는 시간이 길어졌어요. 시설을 직접 골라 주세요.':cause.message;}finally{clearTimeout(timer);if(seq===planSequence){planning=false;planController=null;if(openNow())render();}}
  }
  function applyTripPlan(){if(!tripPlan||busy||loading)return;const planned=tripPlan,plan=planned.plan;clearResult();cancelPick();for(const field of ['start','end']){clearSearch(field);searches[field].query='';}basic=false;mode=plan.mode;expanded.add('conditions');start=pointFrom(candidateById(plan.startId));end=pointFrom(candidateById(plan.endId));avoidStairs=plan.avoidStairs;viaIds=plan.viaIds.filter(id=>matchingVia().some(c=>c.id===id)).slice(0,limit());sample=false;tripPlan=planned;error='';notice='계획의 시설과 조건을 반영했어요. 출발·도착을 확인하고 도보경로 찾기를 누르세요.';render();}
  const disclosure=(id,classes,summary,content)=>`<details class="${classes}" data-walk-disclosure="${id}"${expanded.has(id)?' open':''}><summary>${summary}</summary>${content}</details>`;
  function stepItems(){
    const state=navigation?.getState(),guiding=state&&['requesting','active','off-route','rerouting','reroute-error','preview','arrived'].includes(state.status),step=guiding?3:result?2:1;
    return ['출발·도착','경로 선택','안내 시작'].map((label,i)=>`<li data-walk-step="${i+1}"${step===i+1?' aria-current="step"':''} class="${step>i+1?'is-done':''}"><span aria-hidden="true">${step>i+1?'✓':i+1}</span>${label}</li>`).join('');
  }
  function updateStep(){const el=host()?.querySelector?.('.walk-steps');if(el)el.innerHTML=stepItems();}
  function pointFieldsHtml(){
    return `<section class="walk-points"><h3>어디로 걸어갈까요?</h3><p class="walk-search-intro" id="walk-search-scope"><strong>가게·건물도 TMAP에서 찾아요</strong><span>장소명·주소 검색 · ${e(regionName())} 안의 출발·도착 선택</span></p>${['start','end'].map((field,i)=>`<div class="walk-point-field"><label for="walk-${field}-query"><span class="walk-point-dot ${field}">${i===0?'출발':'도착'}</span></label><div class="walk-endpoint-input">${pointSearchHtml(field)}${field==='start'?`<button class="walking-locate" data-action="walk-current-start"${disabled()}${locating?' disabled':''}>${locating?'현재 위치 확인 중…':'현재 위치에서 출발'}</button><p class="walk-location-note">누르면 기기의 위치 사용을 요청해요.</p>`:''}${disclosure(`point-${field}`,'walk-point-alternatives','지도·시설목록에서 선택',`<button data-action="walk-pick" data-field="${field}"${disabled()}>지도에서 선택</button><label class="walk-sr-only" for="walk-${field}-choice">${field==='start'?'출발지':'도착지'} 수록시설 선택</label><select id="walk-${field}-choice"${disabled()}>${pointOptions(field)}</select>`)}</div></div>`).join('')}<div class="walk-point-tools"><button class="walk-text-button" data-action="walk-swap"${disabled()}>출발·도착 바꾸기 ⇄</button><button class="walk-text-button" data-action="walk-example"${disabled()}>예시로 해보기</button></div>${sample?'<p class="walk-example-note"><strong>예시 장소</strong> 내가 고른 출발·도착이 아니에요. 실제 이동할 장소로 바꿔 주세요.</p>':''}</section>`;
  }
  function conditionHtml(){
    const current=MODES.find(m=>m.id===mode),label=basic?'기본 길찾기':current.label;
    return disclosure('conditions','walk-conditions',`<span>계절·방문 조건 <small>선택사항</small></span><b>${e(label)}</b>`,`<p class="walk-help">원하는 경우 그늘·겨울 조건이나 방문할 시설을 더해요.</p><nav class="walk-tabs" aria-label="도보길 목적"><button data-action="walk-mode" data-mode="basic" aria-pressed="${basic}">기본 길찾기</button>${MODES.map(m=>`<button data-action="walk-mode" data-mode="${m.id}" aria-pressed="${!basic&&mode===m.id}">${e(m.label)}</button>`).join('')}</nav>${basic?'<p class="walk-help">경유시설 없이 도착지까지 가는 보행경로를 찾아요.</p>':`<p class="walk-intro">${e(current.help)}</p>${seasonalControlsHtml()}${visitsHtml()}${safetyReferencesHtml()}`}`);
  }
  function routeCardHtml(route,direct){
    return `<button class="walk-route-card${activeId===route.id?' is-active':''}" data-action="walk-select-route" data-id="${e(route.id)}" aria-pressed="${activeId===route.id}"><span class="walk-route-title">${e(route.role==='direct'?'바로 가는 경로':route.label||'시설 경유 경로')}${activeId===route.id?' · 선택됨':''}</span><strong>${duration(route.durationSeconds)} <span>· ${distance(route.distanceMeters)}</span></strong>${route.role!=='direct'&&direct?`<small>바로 가는 길보다 ${difference(route.durationSeconds,direct.durationSeconds,duration)} · ${difference(route.distanceMeters,direct.distanceMeters,distance)}</small>`:''}${mode==='inspection'&&list(route.via).length?`<span class="walk-route-stay">체류 ${stayMinutes}분 × ${list(route.via).length}곳 가정 · 총 약 ${duration(route.durationSeconds+stayMinutes*list(route.via).length*60)}</span>`:''}${list(route.via).length?`<span class="walk-route-via">경유: ${e(route.via.map(c=>c.name).join(' → '))}</span>`:''}<span class="walk-map-link">${activeId===route.id?'이 길로 아래에서 안내를 시작하세요':'이 경로 선택'} ↗</span></button>`;
  }
  function resultHtml(){
    if(!result)return '';
    const direct=result.routes.find(r=>r.role==='direct'),active=result.routes.find(r=>r.id===activeId),alternatives=result.routes.filter(r=>r!==active);
    return `<section class="walk-results"><div class="walk-result-heading"><h3>2. 경로를 확인하세요</h3><span>TMAP 보행경로</span></div>${seasonalMode()?`<p class="walk-result-condition"><strong>${result.uiDepartureExample?'예시 일시':'출발 일시'} ${e(departureLabel(result.uiConditions?.departureAt))} · 한국시간</strong><span>계절 조건을 계산한 참고 결과 · 현재 안전 판정이 아니에요.</span></p>`:''}${sample?'<p class="walk-example-note"><strong>예시 장소의 경로예요</strong> 실제 이동할 출발·도착을 먼저 확인하세요.</p>':''}${active?routeCardHtml(active,direct):''}${alternatives.length?disclosure('alternatives','walk-notes walk-alternatives',`다른 경로 비교 · ${alternatives.length}개`,alternatives.sort((a,b)=>Number(b.role==='direct')-Number(a.role==='direct')).map(route=>routeCardHtml(route,direct)).join('')):''}${navigation?.html()||''}<div class="walk-result-details">${seasonalMode()?disclosure('assessment','walk-notes walk-assessment-details','그늘·겨울 비교 결과 보기',seasonalSummaryHtml()+result.routes.map(route=>`<h3>${e(route.role==='direct'?'바로 가는 경로':route.label||'시설 경유 경로')}</h3>${seasonalMetricsHtml(route)}`).join('')+assessmentLegendHtml()+seasonalBasisHtml()):''}<p class="walk-route-key"><i style="--route-color:${activeId===direct?.id?'#00e5ff':'#ff49db'}"></i>굵은 선: 선택한 경로${assessmentFeatures.length?' · 가는 가운데 선: 계절 평가':''}</p><p class="walk-query-time">조회 ${time(result.requestedAt)} · ${time(expires)}까지 표시<br>예상 보행시간이며 시설에 머무는 시간은 별도예요.</p>${list(result.warnings).length?disclosure('warnings','walk-notes','이번 경로의 확인사항',`<ul>${list(result.warnings).map(w=>`<li>${e(typeof w==='string'?w:w.message||w.note||'추가 확인이 필요해요.')}</li>`).join('')}</ul>`):''}${disclosure('sources','walk-notes','시설 자료와 이용 범위',`<p>시설 개방·작동 상태는 방문 전에 확인하세요. ${seasonalMode()?'건물과 햇빛을 단순화한 거리 추정이며, 실제 체감온도나 현장 상태와는 다를 수 있어요.':mode==='safety'&&!basic?'안심시설 경유는 실제 안전도나 안전한 통행을 보장하는 판정이 아니에요.':''}</p>${list(active?.via).map(c=>`<p><strong>${e(c.name)}</strong><br>${e(c.sourceName||'공개 수록자료')} · 기준 ${e(c.sourceDate||'미제공')}${c.note?`<br>${e(c.note)}`:''}</p>`).join('')}`)}</div></section>`;
  }
  function render(){
    if(destroyed)return;const scroll=host()?.scrollTop||0;
    const endpoints=pointFieldsHtml()+conditionHtml()+`<label class="walk-checkbox"><input id="walk-avoid-stairs" type="checkbox"${avoidStairs?' checked':''}${disabled()}>계단을 피하는 옵션 적용</label>${tripPlanHtml()}<div class="walk-request-summary">${start&&end?`${e(start.name)} → ${e(end.name)}`:'출발·도착을 고르면 길을 찾을 수 있어요.'}${seasonalMode()?`<small>${departureExample?'예시 일시':'출발'} ${e(departure.replace('T',' '))} · 한국시간</small>`:''}${avoidStairs?'<small>계단 회피 요청</small>':''}</div><p class="walk-send-note">길찾기를 누르면 선택한 좌표를 TMAP에 전송해요.</p><div class="walk-run-actions"><button class="walk-primary" data-action="walk-calculate"${disabled()}${configured!==true||!start||!end||!basic&&mode==='inspection'&&!viaIds.length?' disabled':''}>${busy?'도보경로 찾는 중…':error&&start&&end?'경로 다시 찾기':'도보경로 찾기'}</button><button class="walk-text-button" data-action="${busy?'walk-cancel-route':'walk-reset'}"${loading?' disabled':''}>${busy?'조회 취소':'초기화'}</button></div>`;
    api.show('계절 안심 도보 내비게이션',`<div class="walk-routes${pick?' is-picking':''}" aria-busy="${busy||loading}"><p class="walk-subtitle">여름 그늘길 · 겨울 안전보행</p><ol class="walk-steps" aria-label="길찾기 순서">${stepItems()}</ol>${configured===false?'<div class="walk-connection"><strong>지금은 도보길을 조회할 수 없어요.</strong><p>출발·도착은 먼저 골라둘 수 있어요.</p><button data-action="walk-retry">연결 다시 확인</button></div>':''}${loading?'<p class="walk-status" role="status">장소 목록을 불러오고 있어요.</p>':''}${error?`<div class="walk-error" role="alert"><p>${e(error)}</p>${!catalogueLoaded?'<button data-action="walk-retry">다시 불러오기</button>':''}</div>`:''}${pick?`<div class="walk-pick" role="status"><strong>지도에서 ${pick==='start'?'출발':'도착'} 위치를 누르세요.</strong><p>${e(regionName())} 전체에서 선택할 수 있어요.</p><button data-action="walk-cancel-pick">지도 선택 취소</button></div>`:''}${result?disclosure('endpoints','walk-entry walk-notes',`<span>1. 출발·도착 변경</span><small>${e(start?.name||'출발')} → ${e(end?.name||'도착')}</small>`,endpoints):`<section class="walk-entry">${endpoints}</section>`}${notice?`<p class="walk-notice" role="status">${e(notice)}</p>`:''}${resultHtml()}</div>`,VIEW);
    if(host())host().scrollTop=scroll;
  }
  function paint(){
    if(suspended||!result||expireIfNeeded())return;
    const route=result.routes.find(r=>r.id===activeId)||result.routes[0];activeId=route.id;
    const points=[{...start,id:'walk-start',role:'start'},{...end,id:'walk-end',role:'end'},...list(route.via).map(c=>({...c,role:'via'}))];
    assessmentFeatures=seasonalMode()?buildWalkAssessmentFeatures(route,{mode}):[];api.paintWalkRoutes?.(result.routes,activeId,points,assessmentFeatures);
  }
  async function calculate(){
    if(busy||loading||destroyed)return;expireIfNeeded();
    if(configured!==true){error='지금은 도보길을 조회할 수 없어요. 잠시 뒤 다시 확인해 주세요.';render();return;}
    if(!xy(start?.coordinate)||!xy(end?.coordinate)){error='출발과 도착을 모두 선택해 주세요.';render();return;}
    if(walkDistance(start.coordinate,end.coordinate)<10){error='출발과 도착을 10m 이상 떨어진 위치로 골라 주세요.';render();return;}
    if(selectedVisits().some(c=>samePlace(c.coordinate,start.coordinate)||samePlace(c.coordinate,end.coordinate))){error='출발·도착과 다른 경유시설을 골라 주세요.';render();return;}
    if(!basic&&mode==='inspection'&&!viaIds.length){error='방문할 점검지를 한 곳 이상 골라 주세요.';render();return;}
    const departureAt=seasonalMode()?departureISO(departure):null;
    if(seasonalMode()&&(!departureAt||!Number.isFinite(maxDetourMeters)||maxDetourMeters<0||maxDetourMeters>3000||!Number.isFinite(maxDetourMinutes)||maxDetourMinutes<0||maxDetourMinutes>60)){error='출발 일시와 우회 한도를 확인해 주세요. 거리 0~3,000m, 시간 0~60분으로 입력할 수 있어요.';render();return;}
    clearResult();cancelPick();error='';notice='';busy=true;routeController=new AbortController();const controller=routeController,seq=++routeSequence;
    const request={regionId,mode,start:[...start.coordinate],end:[...end.coordinate],avoidStairs};if(basic)request.navigation=true;if(viaIds.length)request.viaIds=[...viaIds];if(seasonalMode())Object.assign(request,{departureAt,shadowTiming,maxDetourMeters,maxDetourMinutes,includeLevels});render();
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
      result={...body,requestedAt:Number.isFinite(requestedAt)?body.requestedAt:new Date().toISOString(),routes,uiConditions:{departureAt,shadowTiming,maxDetourMeters,maxDetourMinutes,includeLevels},uiDepartureExample:departureExample};activeId=routes.find(r=>r.role==='direct')?.id||routes[0].id;expanded.delete('endpoints');navigation?.prepare();paint();armExpiry();
      const geometry=lineGeometry(routes.find(r=>r.id===activeId));if(geometry)api.frameGeometry?.(geometry);
    }catch(cause){if(seq!==routeSequence||destroyed)return;error=cause.name==='AbortError'?'경로 조회 시간이 길어졌어요. 잠시 뒤 다시 비교해 주세요.':cause.message||'도보경로를 조회하지 못했어요.';}
    finally{clearTimeout(timer);if(seq===routeSequence&&!destroyed){busy=false;routeController=null;if(openNow()){render();host()?.querySelector?.(error?'.walk-error':'.walk-results')?.scrollIntoView?.({block:'start',behavior:'smooth'});}}}
  }
  async function useCurrentStart(){
    if(busy||loading||locating)return;
    const geo=api.geolocation||globalThis.navigator?.geolocation;if(!geo?.getCurrentPosition){error='이 브라우저에서 현재 위치를 사용할 수 없어요.';render();return;}
    clearResult();start=null;sample=false;const seq=++locateSequence;locating=true;error='';notice='현재 위치를 확인하고 있어요.';render();
    try{geo.getCurrentPosition(position=>{if(seq!==locateSequence||destroyed)return;locating=false;const coordinate=[position.coords.longitude,position.coords.latitude],boundary=api.state.district||api.state.scope;if(!xy(coordinate)||!boundary||!inside(coordinate,boundary)){error='현재 위치가 선택한 지역 밖이에요. 지역 안의 위치를 지도에서 선택하세요.';}else if(!Number.isFinite(position.coords.accuracy)||position.coords.accuracy<0||position.coords.accuracy>40||!Number.isFinite(position.timestamp)||Date.now()-position.timestamp>15000||position.timestamp>Date.now()+5000){error='위치가 부정확해 출발지로 반영하지 않았어요. 하늘이 보이는 곳에서 다시 확인하세요.';}else{start={id:'map-start',name:'현재 위치',coordinate,sourceName:'기기 위치'};sample=false;notice='현재 위치를 출발지에 반영했어요. 도착지를 확인하고 도보경로를 찾으세요.';api.followWalkPosition?.(coordinate,0);}render();},cause=>{if(seq!==locateSequence||destroyed)return;locating=false;error=cause.code===1?'위치 권한이 거부됐어요. 브라우저와 기기 위치 설정을 확인하세요.':'현재 위치를 찾지 못했어요. 위치 설정을 확인하고 다시 시도하세요.';render();},{enableHighAccuracy:true,maximumAge:0,timeout:20000});}catch{if(seq===locateSequence&&!destroyed){locating=false;error='현재 위치를 시작하지 못했어요. 다시 시도하거나 출발지를 검색해 주세요.';render();}}
  }
  async function rerouteFromPosition(fix,{signal,viaIds:remaining=[]}){
    const response=await fetch('/api/walk-routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({regionId,mode,start:fix.coordinate,end:end.coordinate,avoidStairs,viaIds:remaining,navigation:true}),signal}),body=await responseBody(response);
    if(!response.ok||body.ok===false)throw Error(typeof body.error==='string'?body.error:'새 도보경로를 찾지 못했어요.');
    if(regionOf(body)!==regionId||body.mode!==mode)throw Error('현재 지역과 다른 경로를 받았어요.');
    const route=body.routes?.find(r=>lineGeometry(r)&&finite(r.distanceMeters)&&finite(r.durationSeconds));if(!route)throw Error('새 경로의 도형과 안내를 확인하지 못했어요.');
    const expiry=Math.min(Date.parse(body.expiresAt)||0,Date.now()+MAX_RESULT_AGE);if(expiry<=Date.now())throw Error('새 경로의 표시 시간이 끝났어요. 다시 찾으세요.');
    if(signal.aborted)throw Error('길안내를 종료했어요.');
    const index=buildWalkNavigation(route,{destination:end.coordinate});if(!index.continuous)throw Error('새 경로에 이어지지 않은 구간이 있어 이전 경로를 유지했어요.');
    start={id:'map-start',name:'재탐색한 현재 위치',coordinate:[...fix.coordinate],sourceName:'기기 위치'};result={...body,routes:[route],uiConditions:null,uiDepartureExample:false};activeId=route.id;expires=expiry;assessmentFeatures=[];paint();armExpiry();return route;
  }
  function beginPick(field){
    if(busy||loading)return;if(!api.state.ready){api.toast?.('지도가 준비된 뒤 위치를 선택할 수 있어요.');return;}
    if(!['start','end'].includes(field))return;navigation?.stop('지도에서 위치를 고르는 동안 길안내를 멈췄어요.');locateSequence++;locating=false;clearSearch(field);pick=field;api.send?.({type:'tool',tool:`walk-${field}`});render();api.toast?.(`지도에서 ${field==='start'?'출발':'도착'} 위치를 선택하세요.`);
  }
  function changePoint(field,id){const current=field==='start'?start:end,chosen=candidateById(id)||(current?.id===id?current:null);clearSearch(field);clearResult();cancelPick();if(field==='start')start=pointFrom(chosen);else end=pointFrom(chosen);sample=false;error='';notice='';render();}
  const change=event=>{
    if(event.target.id==='walk-start-choice')changePoint('start',event.target.value);
    if(event.target.id==='walk-end-choice')changePoint('end',event.target.value);
    if(['walk-departure-at','walk-shadow-timing','walk-max-detour-meters','walk-max-detour-minutes'].includes(event.target.id)){clearResult();if(event.target.id==='walk-departure-at'){departure=event.target.value;departureExample=false;}else if(event.target.id==='walk-shadow-timing')shadowTiming=['walk-time','departure-static'].includes(event.target.value)?event.target.value:'walk-time';else if(event.target.id==='walk-max-detour-meters')maxDetourMeters=Number(event.target.value);else maxDetourMinutes=Number(event.target.value);error='';notice='';render();}
    if(event.target.id==='walk-include-levels'){clearResult();includeLevels=event.target.checked===true;error='';notice='';render();}
    if(event.target.id==='walk-stay-minutes'){const next=Number(event.target.value);stayMinutes=Number.isInteger(next)&&next>=0&&next<=120?next:10;render();}
    if(event.target.id==='walk-avoid-stairs'){clearResult();avoidStairs=event.target.checked;error='';notice='';render();}
  };
  navigation=installWalkingNavigation({api,getRoute:()=>result?.routes.find(r=>r.id===activeId),getDestination:()=>end,getStops:()=>result?.routes.find(r=>r.id===activeId)?.via||[],requestReroute:rerouteFromPosition,onRerouted:()=>render(),onUpdate:updateStep});
  const offs=[
    registerAction('walk-current-start',useCurrentStart),registerAction('walk-plan',prepareTripPlan),registerAction('walk-apply-plan',applyTripPlan),
    registerAction('walk-routes',button=>open(button?.dataset?.mode,button?.dataset?.destinationId||button?.dataset?.destinationSourceId?button.dataset:null)),
    registerAction('walk-mode',button=>{expanded.add('conditions');return open(button.dataset.mode);}),
    registerAction('walk-retry',()=>{cataloguePromise=loadCatalogue();return cataloguePromise;}),
    registerAction('walk-time-now',()=>{if(busy||loading)return;clearResult();departure=currentDeparture();departureExample=false;error='';notice='현재 한국시간으로 출발 일시를 바꿨어요.';render();}),
    registerAction('walk-time-example',()=>{if(busy||loading)return;clearResult();departure=daylightExample(mode);departureExample=true;error='';notice='낮 시간 예시를 선택했어요. 실제 출발 일시로 바꿀 수 있어요.';render();}),
    registerAction('walk-example',()=>{if(busy||loading)return;chooseSample();render();}),
    registerAction('walk-pick',button=>beginPick(button.dataset.field)),
    registerAction('walk-cancel-pick',()=>{cancelPick();if(result)navigation?.prepare();render();}),
    registerAction('walk-swap',()=>{if(busy||loading)return;clearResult();cancelPick();for(const field of ['start','end'])clearSearch(field);[searches.start.query,searches.end.query]=[searches.end.query,searches.start.query];[start,end]=[end,start];sample=false;error='';notice='';render();}),
    registerAction('walk-add-via',()=>{if(busy||loading)return;const id=document.getElementById('walk-via-choice')?.value,c=matchingVia().find(c=>c.id===id);if(!c||viaIds.includes(id)||viaIds.length>=limit()||selectedVisits().some(chosen=>samePlace(chosen.coordinate,c.coordinate)))return;if(samePlace(c.coordinate,start?.coordinate)||samePlace(c.coordinate,end?.coordinate)){notice='출발·도착과 다른 경유시설을 골라 주세요.';render();return;}clearResult();viaIds.push(id);error='';notice='';render();}),
    registerAction('walk-remove-via',button=>{if(busy||loading)return;clearResult();viaIds=viaIds.filter(id=>id!==button.dataset.id);render();}),
    registerAction('walk-clear-via',()=>{if(busy||loading)return;clearResult();viaIds=[];render();}),
    registerAction('walk-move-via',button=>{if(busy||loading||mode!=='inspection')return;const index=viaIds.indexOf(button.dataset.id),next=index+(button.dataset.direction==='up'?-1:1);if(index<0||next<0||next>=viaIds.length)return;clearResult();[viaIds[index],viaIds[next]]=[viaIds[next],viaIds[index]];render();}),
    registerAction('walk-calculate',calculate),
    registerAction('walk-cancel-route',()=>{if(!busy)return;clearResult('경로 조회를 취소했어요. 출발·도착은 유지했어요.');error='';render();}),
    registerAction('walk-choose-place',button=>{const field=button.dataset.field;if(!['start','end'].includes(field)||busy||loading)return;const selected=searches[field].items[Number(button.dataset.index)];if(!selected)return;clearResult();cancelPick();clearSearch(field);if(field==='start')start=pointFrom(selected);else end=pointFrom(selected);sample=false;error='';notice='검색한 위치를 반영했어요. 실제 출입구는 지도에서 확인해 주세요.';render();}),
    registerAction('walk-reset',()=>{basic=true;mode='shade';expanded.clear();clearResult();cancelPick();for(const field of ['start','end']){clearSearch(field);searches[field].query='';}start=null;end=null;viaIds=[];avoidStairs=false;stayMinutes=10;sample=false;error='';notice='출발·도착을 새로 선택해 주세요.';departure=currentDeparture();departureExample=false;shadowTiming='walk-time';maxDetourMeters=500;maxDetourMinutes=5;includeLevels=false;render();}),
    registerAction('walk-select-route',button=>{if(!result||expireIfNeeded())return;navigation.stop();const route=result.routes.find(r=>r.id===button.dataset.id);if(!route)return;activeId=route.id;navigation.prepare();paint();const geometry=lineGeometry(route);if(geometry)api.frameGeometry?.(geometry);render();}),
  ];
  const submit=event=>{if(event.target?.dataset?.walkPlan){event.preventDefault();return prepareTripPlan();}const field=event.target?.dataset?.walkSearch;if(['start','end'].includes(field)){event.preventDefault();return searchPoint(field);}};
  const input=event=>{for(const field of ['start','end'])if(event.target.id===`walk-${field}-query`){searches[field].query=event.target.value;clearSearch(field);clearResult();if(field==='start')start=null;else end=null;sample=false;const select=document.getElementById(`walk-${field}-choice`);if(select)select.value='';const selected=document.getElementById(`walk-${field}-selected`);if(selected)selected.hidden=true;const run=host()?.querySelector?.('[data-action=walk-calculate]');if(run)run.disabled=true;const endpoint=event.target.closest?.('.walk-endpoint-input');endpoint?.querySelector?.('.walk-place-results')?.remove?.();endpoint?.querySelector?.('.walk-place-notice')?.remove?.();const submitButton=event.target.closest?.('form')?.querySelector?.('button[type="submit"]');if(submitButton){submitButton.disabled=busy||loading;submitButton.textContent='검색';}}};
  const toggle=event=>{const id=event.target?.dataset?.walkDisclosure;if(!id)return;if(event.target.open)expanded.add(id);else expanded.delete(id);};
  host()?.addEventListener('toggle',toggle,true);host()?.addEventListener('change',change);host()?.addEventListener('submit',submit);host()?.addEventListener('input',input);
  const visibility=()=>{if(!document.hidden)expireIfNeeded();};document.addEventListener?.('visibilitychange',visibility);
  return {
    open,
    suspend(){entrySequence++;suspended=true;for(const field of ['start','end'])clearSearch(field);catalogueController?.abort();catalogueController=null;catalogueSequence++;loading=false;clearResult();cancelPick();},
    onEvent(message){
      if(suspended)return false;navigation?.onEvent(message);
      if(message.type==='point'&&['walk-start','walk-end'].includes(message.tool)){
        const field=message.tool==='walk-start'?'start':'end';if(pick!==field)return true;const point=Array.isArray(message.point)?message.point.slice(0,2):null;
        const boundary=api.state.district||api.state.scope;if(!xy(point)||!boundary||!inside(point,boundary)){api.toast?.(`${regionName()} 안의 위치를 골라 주세요.`);return true;}
        clearResult();cancelPick();clearSearch(field);const selected={id:`map-${field}`,name:`지도에서 고른 ${field==='start'?'출발지':'도착지'}`,coordinate:point};if(field==='start')start=selected;else end=selected;sample=false;error='';notice='지도에서 고른 위치를 반영했어요.';render();return true;
      }
      if(message.type==='ready'&&result){paint();return false;}return false;
    },
    scopeChanged(){if(suspended)return;if(regionId&&regionId!==(api.state.regionProfile?.id||'seogu')){reset();if(openNow())cataloguePromise=loadCatalogue();return;}if(pick){cancelPick();if(openNow())render();}},
    panelClosed(){locateSequence++;locating=false;navigation?.stop('길안내 화면을 닫아 위치 사용을 멈췄어요.');},
    destroy(){navigation?.destroy();destroyed=true;for(const field of ['start','end'])clearSearch(field);catalogueController?.abort();catalogueSequence++;clearResult();cancelPick();offs.forEach(off=>off());host()?.removeEventListener('toggle',toggle,true);host()?.removeEventListener('change',change);host()?.removeEventListener('submit',submit);host()?.removeEventListener('input',input);document.removeEventListener?.('visibilitychange',visibility);},
  };
}

