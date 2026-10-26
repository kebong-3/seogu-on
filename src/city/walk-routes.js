import {registerAction} from './actions.js';
import {inside} from './geometry.js';

const VIEW='walk-routes',MAX_RESULT_AGE=30*60*1000;
const MODES=[
  {id:'shade',label:'그늘·쉼터 경유',help:'그늘시설이나 쉼터를 들르는 길과 바로 가는 길을 비교해요.'},
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
const regionOf=body=>body?.region?.id||body?.regionId||(typeof body?.region==='string'&&/^[a-z0-9-]+$/.test(body.region)?body.region:null);
const lineGeometry=route=>{
  const lines=list(route?.geojson?.features).flatMap(f=>f.geometry?.type==='LineString'?[f.geometry.coordinates]:f.geometry?.type==='MultiLineString'?f.geometry.coordinates:[]).filter(line=>Array.isArray(line)&&line.length>1&&line.every(p=>xy(p)));
  return lines.length?{type:'MultiLineString',coordinates:lines}:null;
};
const difference=(value,base,format)=>{const gap=value-base;if(!Number.isFinite(gap))return '';return gap===0?'변화 없음':`${gap>0?'+':'−'}${format(Math.abs(gap))}`;};
const samePlace=(a,b)=>xy(a)&&xy(b)&&a.every((v,i)=>Math.abs(v-b[i])<.000001);
const candidateName=c=>[c.name,c.category].filter(Boolean).join(' · ');
async function responseBody(response){try{return await response.json();}catch{throw Error('서버 응답을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.');}}
const pointFrom=c=>c?{id:c.id,name:c.name,coordinate:[...c.coordinate],sourceName:c.sourceName,sourceDate:c.sourceDate}:null;

/** TMAP results stay in memory and in private map layers until their short expiry. */
export function installWalkRoutes(api){
  let regionId='',mode='shade',candidates=[],catalogueLoaded=false,configured=null,start=null,end=null,avoidStairs=false,viaIds=[],sample=false,stayMinutes=10;
  let result=null,activeId='',expires=0,expiryTimer=null,pick='',error='',notice='',loading=false,busy=false,destroyed=false;
  let catalogueController=null,routeController=null,catalogueSequence=0,routeSequence=0;
  const host=()=>document.getElementById('detail-body');
  const openNow=()=>api.state.view===VIEW;
  const regionName=()=>api.state.regionProfile?.name||'선택 지역';
  const limit=()=>mode==='inspection'?3:2;
  const isMode=id=>MODES.some(m=>m.id===id);
  const disabled=()=>busy||loading?' disabled':'';
  const candidateById=id=>candidates.find(c=>c.id===id);
  const matchingVia=()=>candidates.filter(c=>{
    if(c.routeEligible===false)return false;
    if(mode==='inspection')return true;
    if(Array.isArray(c.modes))return c.modes.includes(mode);
    const kind=String(c.category||'');
    return (mode==='shade'?/그늘|쉼터|shade|heat|shelter/i:mode==='safety'?/경찰|안심|비상벨|보안등|police|security|bell/i:/어린이집|돌봄|공공공간|활동공간|childcare|care|public.?space|^public$/i).test(kind);
  });
  function clearResult(message=''){
    routeController?.abort();routeController=null;routeSequence++;busy=false;result=null;activeId='';expires=0;clearTimeout(expiryTimer);expiryTimer=null;api.clearWalkRoutes?.();
    if(message)notice=message;
  }
  function cancelPick(){pick='';api.send?.({type:'stop'});}
  function reset(){
    catalogueController?.abort();catalogueController=null;catalogueSequence++;clearResult();cancelPick();regionId=api.state.regionProfile?.id||'seogu';candidates=[];catalogueLoaded=false;configured=null;start=null;end=null;viaIds=[];avoidStairs=false;stayMinutes=10;sample=false;error='';notice='';loading=false;
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
      configured=body.configured===true;catalogueLoaded=true;const changed=reconcileCatalogueSelection(previous);if(!hadCatalogue&&!start&&!end)chooseSample();
      if(!candidates.length)notice=(changed?notice+' ':'')+'이 지역의 수록시설 목록이 없어요. 지도에서 출발·도착을 선택할 수 있어요.';
    }catch(cause){if(seq!==catalogueSequence||destroyed)return;error=cause.name==='AbortError'?'시설 목록을 읽는 시간이 길어졌어요. 다시 열어 주세요.':cause.message||'시설 목록을 읽지 못했어요.';}
    finally{clearTimeout(timer);if(seq===catalogueSequence&&!destroyed){loading=false;if(openNow())render();}}
  }
  async function open(nextMode){
    if(destroyed)return;if(!regionId||regionId!==(api.state.regionProfile?.id||'seogu'))reset();
    if(nextMode&&isMode(nextMode)&&mode!==nextMode){clearResult();cancelPick();mode=nextMode;viaIds=[];error='';notice='';}
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
  function resultHtml(){
    if(!result)return '';
    const direct=result.routes.find(r=>r.role==='direct');
    return `<section class="walk-results" aria-live="polite"><div class="walk-section-heading"><h3>도보경로 비교</h3><span>TMAP</span></div><p class="walk-help">예상 보행시간이며, 시설 이용·점검에 머무는 시간은 별도예요.</p><div class="walk-route-cards">${result.routes.map(route=>`<button class="walk-route-card${activeId===route.id?' is-active':''}" data-action="walk-select-route" data-id="${e(route.id)}" aria-pressed="${activeId===route.id}"><span class="walk-route-title">${e(route.role==='direct'?'바로 가는 경로':route.label||'시설 경유 경로')}</span><strong>${duration(route.durationSeconds)} <span>· ${distance(route.distanceMeters)}</span></strong>${route.role!=='direct'&&direct?`<small>바로 가는 길보다 ${difference(route.durationSeconds,direct.durationSeconds,duration)} · ${difference(route.distanceMeters,direct.distanceMeters,distance)}</small>`:''}${mode==='inspection'&&list(route.via).length?`<span class="walk-route-stay">체류 ${stayMinutes}분 × ${list(route.via).length}곳 가정 · 총 약 ${duration(route.durationSeconds+stayMinutes*list(route.via).length*60)}</span>`:''}${list(route.via).length?`<span class="walk-route-via">경유: ${e(route.via.map(c=>c.name).join(' → '))}</span>`:''}<span class="walk-map-link">${activeId===route.id?'지도에 표시 중':'이 경로 지도 보기'} ↗</span></button>`).join('')}</div><p class="walk-query-time">TMAP 도보경로 · 조회 ${time(result.requestedAt)}<br>${time(expires)}까지 이 화면에서 확인할 수 있어요.</p>${list(result.warnings).length?`<details class="walk-notes"><summary>이번 경로의 확인사항</summary><ul>${list(result.warnings).map(w=>`<li>${e(typeof w==='string'?w:w.message||w.note||'추가 확인이 필요해요.')}</li>`).join('')}</ul></details>`:''}<details class="walk-notes"><summary>시설 자료와 이용 범위</summary><p>시설 개방·작동 상태는 방문 전에 확인하세요. ${mode==='shade'?'그늘시설을 경유하는 길이며, 시간대별 실제 그늘을 계산한 결과는 아니에요.':mode==='safety'?'안심시설 경유는 실제 안전도나 안전한 통행을 보장하는 판정이 아니에요.':''}</p>${list(result.routes.find(r=>r.id===activeId)?.via).map(c=>`<p><strong>${e(c.name)}</strong><br>${e(c.sourceName||'공개 수록자료')} · 기준 ${e(c.sourceDate||'미제공')}${c.note?`<br>${e(c.note)}`:''}</p>`).join('')}</details></section>`;
  }
  function render(){
    if(destroyed)return;const scroll=host()?.scrollTop||0,current=MODES.find(m=>m.id===mode);
    api.show('생활도보길',`<div class="walk-routes" aria-busy="${busy||loading}"><nav class="walk-tabs" aria-label="도보길 목적">${MODES.map(m=>`<button data-action="walk-mode" data-mode="${m.id}" aria-pressed="${mode===m.id}">${e(m.label)}</button>`).join('')}</nav><p class="walk-intro">${e(current.help)}</p>${configured===false?'<div class="walk-connection"><strong>TMAP 연결이 필요해요.</strong><p>출발·도착은 먼저 골라둘 수 있어요.</p><button data-action="settings">연결 설정</button><button data-action="walk-retry">연결 다시 확인</button></div>':''}${loading?'<p class="walk-status" role="status">이 지역의 공개시설 목록을 읽고 있어요.</p>':''}${error?`<div class="walk-error" role="alert"><p>${e(error)}</p>${!catalogueLoaded?'<button data-action="walk-retry">다시 불러오기</button>':''}</div>`:''}${pick?`<div class="walk-pick" role="status"><strong>지도에서 ${pick==='start'?'출발':'도착'} 위치를 선택하세요.</strong><p>${e(api.label?.()||regionName())} 안에서 선택할 수 있어요.</p><button data-action="walk-cancel-pick">선택 취소</button></div>`:''}<section class="walk-points"><div class="walk-section-heading"><h3>어디서 어디까지 갈까요?</h3><button class="walk-text-button" data-action="walk-example"${disabled()}>예시 선택</button></div><p class="walk-help">${e(regionName())} 전체 수록시설 목록에서 고르거나 지도에서 선택해요.</p>${['start','end'].map((field,i)=>`<div class="walk-point-field"><label for="walk-${field}-choice"><span class="walk-point-dot ${field}">${i===0?'출발':'도착'}</span></label><select id="walk-${field}-choice"${disabled()}>${pointOptions(field)}</select><button data-action="walk-pick" data-field="${field}"${disabled()}>지도에서 선택</button></div>`).join('')}<button class="walk-text-button walk-swap" data-action="walk-swap"${disabled()}>출발·도착 바꾸기 ⇄</button>${sample?'<p class="walk-example-note">실제 수록시설을 예시로 골랐어요. 원하는 위치로 바꿀 수 있어요.</p>':''}</section>${visitsHtml()}<label class="walk-checkbox"><input id="walk-avoid-stairs" type="checkbox"${avoidStairs?' checked':''}${disabled()}>계단을 피하는 옵션 적용</label><p class="walk-send-note">선택한 출발·도착·경유 위치를 경로 조회를 위해 서버와 TMAP에 전송해요.</p><div class="walk-run-actions"><button class="walk-primary" data-action="walk-calculate"${disabled()}${configured!==true||!start||!end||mode==='inspection'&&!viaIds.length?' disabled':''}>${busy?'도보경로를 비교하고 있어요…':'도보경로 비교'}</button><button data-action="walk-reset"${loading?' disabled':''}>초기화</button></div>${notice?`<p class="walk-notice" role="status">${e(notice)}</p>`:''}${resultHtml()}</div>`,VIEW);
    if(host())host().scrollTop=scroll;
  }
  function paint(){
    if(!result||expireIfNeeded())return;
    const route=result.routes.find(r=>r.id===activeId)||result.routes[0];activeId=route.id;
    const points=[{...start,id:'walk-start',role:'start'},{...end,id:'walk-end',role:'end'},...list(route.via).map(c=>({...c,role:'via'}))];
    api.paintWalkRoutes?.(result.routes,activeId,points);
  }
  async function calculate(){
    if(busy||loading||destroyed)return;expireIfNeeded();
    if(configured!==true){error='TMAP 연결을 확인한 뒤 경로를 비교해 주세요.';render();return;}
    if(!xy(start?.coordinate)||!xy(end?.coordinate)){error='출발과 도착을 모두 선택해 주세요.';render();return;}
    if(samePlace(start.coordinate,end.coordinate)){error='출발과 도착을 서로 다른 위치로 골라 주세요.';render();return;}
    if(selectedVisits().some(c=>samePlace(c.coordinate,start.coordinate)||samePlace(c.coordinate,end.coordinate))){error='출발·도착과 다른 경유시설을 골라 주세요.';render();return;}
    if(mode==='inspection'&&!viaIds.length){error='방문할 점검지를 한 곳 이상 골라 주세요.';render();return;}
    clearResult();cancelPick();error='';notice='';busy=true;routeController=new AbortController();const controller=routeController,seq=++routeSequence;
    const request={regionId,mode,start:[...start.coordinate],end:[...end.coordinate],avoidStairs};if(viaIds.length)request.viaIds=[...viaIds];render();
    const timer=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await fetch('/api/walk-routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal}),body=await responseBody(response);
      if(seq!==routeSequence||destroyed)return;
      if(!response.ok||body.ok===false)throw Error(typeof body.error==='string'?body.error:body.error?.message||'도보경로를 가져오지 못했어요.');
      if(regionOf(body)&&regionOf(body)!==regionId||body.mode&&body.mode!==mode)throw Error('선택한 조건과 응답이 달라 경로를 표시하지 않았어요.');
      const routes=list(body.routes).filter(r=>r&&typeof r.id==='string'&&finite(r.distanceMeters)&&finite(r.durationSeconds)&&lineGeometry(r));
      if(!routes.length)throw Error('이번 조건의 도보경로를 받지 못했어요. 출발·도착을 조금 옮겨 다시 비교해 주세요.');
      const requestedAt=Date.parse(body.requestedAt),serverExpiry=Date.parse(body.expiresAt),base=Number.isFinite(requestedAt)?requestedAt:Date.now();
      expires=Math.min(Number.isFinite(serverExpiry)?serverExpiry:base+MAX_RESULT_AGE,base+MAX_RESULT_AGE,Date.now()+MAX_RESULT_AGE);
      if(expires<=Date.now())throw Error('응답의 표시 시간이 끝났어요. 다시 비교해 주세요.');
      result={...body,requestedAt:Number.isFinite(requestedAt)?body.requestedAt:new Date().toISOString(),routes};activeId=routes.find(r=>r.role==='direct')?.id||routes[0].id;paint();armExpiry();
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
    if(event.target.id==='walk-stay-minutes'){const next=Number(event.target.value);stayMinutes=Number.isInteger(next)&&next>=0&&next<=120?next:10;render();}
    if(event.target.id==='walk-avoid-stairs'){clearResult();avoidStairs=event.target.checked;error='';notice='';render();}
  };
  const offs=[
    registerAction('walk-routes',button=>open(button?.dataset?.mode)),
    registerAction('walk-mode',button=>open(button.dataset.mode)),
    registerAction('walk-retry',()=>loadCatalogue()),
    registerAction('walk-example',()=>{if(busy||loading)return;chooseSample();render();}),
    registerAction('walk-pick',button=>beginPick(button.dataset.field)),
    registerAction('walk-cancel-pick',()=>{cancelPick();render();}),
    registerAction('walk-swap',()=>{if(busy||loading)return;clearResult();[start,end]=[end,start];sample=false;error='';notice='';render();}),
    registerAction('walk-add-via',()=>{if(busy||loading)return;const id=document.getElementById('walk-via-choice')?.value,c=matchingVia().find(c=>c.id===id);if(!c||viaIds.includes(id)||viaIds.length>=limit()||selectedVisits().some(chosen=>samePlace(chosen.coordinate,c.coordinate)))return;if(samePlace(c.coordinate,start?.coordinate)||samePlace(c.coordinate,end?.coordinate)){notice='출발·도착과 다른 경유시설을 골라 주세요.';render();return;}clearResult();viaIds.push(id);error='';notice='';render();}),
    registerAction('walk-remove-via',button=>{if(busy||loading)return;clearResult();viaIds=viaIds.filter(id=>id!==button.dataset.id);render();}),
    registerAction('walk-clear-via',()=>{if(busy||loading)return;clearResult();viaIds=[];render();}),
    registerAction('walk-move-via',button=>{if(busy||loading||mode!=='inspection')return;const index=viaIds.indexOf(button.dataset.id),next=index+(button.dataset.direction==='up'?-1:1);if(index<0||next<0||next>=viaIds.length)return;clearResult();[viaIds[index],viaIds[next]]=[viaIds[next],viaIds[index]];render();}),
    registerAction('walk-calculate',calculate),
    registerAction('walk-reset',()=>{clearResult();cancelPick();start=null;end=null;viaIds=[];avoidStairs=false;stayMinutes=10;sample=false;error='';notice='출발·도착을 새로 선택해 주세요.';render();}),
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
