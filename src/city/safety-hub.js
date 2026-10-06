/** Bounded, user-initiated SafetyData collection. Credentials never enter the browser. */
import {SAFETY_SOURCES,SAFETY_BY_ID} from './safety-catalog.js';
import {esc,LAYER_BY_ID} from './catalog.js';
import {validGeometry,filterFeatures,fc} from './geometry.js';
const $=id=>document.getElementById(id);
const ICING='sd-icing', LOCAL_ICING='local-icing';
const kindLabels={static:'등록시설',history:'과거 이력',designation:'지정구역',observation:'관측 원자료',forecast:'제공기관 예보'};
const dateText=value=>{if(!value)return '미수신';const date=new Date(value);return Number.isFinite(+date)?date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':String(value);};
const countText=value=>Number.isFinite(value)?value.toLocaleString():'미확인';
const qualityKeys=['needsLocation','outside','invalid','privateFieldsRemoved','regionMatched','regionExcluded','regionUnknown','regionBoundaryConflict','mappedRows'];
export function createSafetyHub(api){
 const s=api.state,books=new Map(),messages=new Map(),attempts=new Map();let busy=null,token=0,localError='';
 const queryDong=id=>id===ICING?'all':s.dong;
 const bookFor=id=>books.get(id+'|'+queryDong(id));
 const current=id=>{const e=s.entries.get(id);return e?.metadata?.scopeDong===s.dong||e?.metadata?.scopeDong==='all'?e:null;};
 const localIcing=()=>s.entries.get(LOCAL_ICING);
 const info=pairs=>`<dl class="info-grid">${pairs.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
 function stateText(id){
  const e=current(id),b=bookFor(id);
  if(busy===id)return '공식 서버 응답 대기';
  if(messages.has(id))return messages.get(id);
  const lastAttempt=attempts.get(id);
  if(lastAttempt?.ok===false&&lastAttempt.code!=='CANCELLED')return `${lastAttempt.code?lastAttempt.code+' · ':''}${lastAttempt.message}`;
  if(b&&!b.complete)return `검수 대기 · ${b.scanned}행 확인 · ${b.features.size}도형 · 다음 ${b.page}페이지`;
  if(e?.state==='loaded')return `${api.scoped(id).length}도형 · 수신 ${dateText(e.loadedAt)}`;
  if(e?.state==='partial')return `${api.scoped(id).length}지점 부분수신 · 전국 수집 미완료`;
  if(s.entries.has(id))return '다른 구역 조회본 · 재조회 필요';
  return s.config?.configured?.[id]?'키 설정됨 · 인증/자료 수신 미확인':'키 미설정';
 }
 function card(src){
  return `<article class="safety-card" id="card-${src.id}"><div class="section-heading"><h3>${esc(src.title)}</h3><span class="badge">${esc(kindLabels[src.kind])}</span></div><p class="small"><b>정보제공기관: ${esc(src.sourceName.split(' / ')[0])}</b></p><p class="small">${esc(src.note)}</p><p class="note" aria-live="polite">${esc(stateText(src.id))}</p>${src.id===ICING?'<p class="small">API는 광주 서구 전체를 수집합니다. 지도 표시만 선택 동으로 좁힐 수 있습니다.</p>':''}${src.id==='sd-aws'?'<p class="note">기상청 격자 날씨와 별개입니다. AWS는 관측소 코드와 검증된 위치가 모두 있어야 지도에 표시됩니다. “광주 서구”만으로는 관측소를 특정할 수 없습니다.</p><label class="field-label">공식 AWS 관측소 코드<input id="sd-station" inputmode="numeric" maxlength="12" placeholder="기상청 관측지점 번호"></label>':''}<div class="detail-actions"><button class="primary" data-action="sd-fetch" data-id="${src.id}" ${busy?'disabled':''}>${bookFor(src.id)?.complete?'다시 조회':'조회·계속 수집'}</button><button class="secondary" data-action="sd-solo" data-id="${src.id}">이 자료만 보기</button><button class="secondary" data-action="sd-with" data-id="${src.id}">함께 보기</button><button class="secondary" data-action="sd-detail" data-id="${src.id}">수신 현황</button><button class="secondary" data-action="sd-restart" data-id="${src.id}" ${busy?'disabled':''}>수집 처음부터</button>${src.id===ICING?'<button class="secondary" data-action="icing">서구 결빙구간 열기</button>':''}</div><a class="small" href="${esc(src.sourceUrl)}" target="_blank" rel="noopener noreferrer">공식 명세·이용조건</a></article>`;
 }
 const cards=()=>SAFETY_SOURCES.map(card).join('');
 function refresh(){
  if(s.view==='safety-hub'&&$('safety-cards')){const station=$('sd-station')?.value;$('safety-cards').innerHTML=cards();if(station&&$('sd-station'))$('sd-station').value=station;}
  if(s.view==='icing')showIcing();
  const detailId=$('sd-receipt')?.dataset.id;
  if(s.view==='sd-detail'&&SAFETY_BY_ID[detailId])detail(detailId);
 }
 function show(){
  api.show(`재난안전 API · ${SAFETY_SOURCES.length}종 연결`,`<p class="muted">${esc(api.label())} · 공식 자료별 수신 상태를 확인합니다.</p><button class="primary full" data-action="icing">상습결빙구간 · 광주 서구 먼저 보기</button><p class="note">한 번 누를 때 최대 4페이지를 확인하고 멈춥니다. 끝나지 않으면 계속 수집합니다. 자동 재조회는 없으며 그림자 재생은 이 API를 호출하지 않습니다.</p><div class="detail-actions"><button class="secondary" data-action="sd-settings">키·허용 IP 설정 안내</button><button class="secondary" data-action="sd-stop">진행 중지</button><button class="secondary" data-action="sd-export">수신 완료자료 내보내기</button></div><div id="safety-cards">${cards()}</div><p class="note warning">의료기관 자료는 실제 진료·수용을 보증하지 않습니다. 긴급상황은 119를 우선하세요. 민방위 대피소와 침수 대피장소는 다릅니다.</p>`,'safety-hub');
 }
 function settings(){
  api.show('재난안전 API 설정',`<h3>서버 환경변수</h3><code>SAFETYDATA_KEYS_JSON</code><p>프로젝트의 ‘재난안전키_한번에설정.html’에서 ${SAFETY_SOURCES.length}개 서비스키를 하나의 JSON으로 정리할 수 있습니다. Vercel 환경변수에 저장한 뒤 새로 배포합니다.</p><h3>상습결빙구간</h3><code>SAFETYDATA_00120_KEY</code><p>상습결빙구간 전용 키를 위 이름으로 개별 설정할 수도 있습니다. 개별 설정값이 통합 JSON보다 우선합니다.</p><p class="note warning">32번 오류는 등록되지 않은 IP라는 제공기관 응답입니다. 사용자 PC의 등록 IP와 Vercel 서버의 출발 IP는 별개이므로 플랫폼의 허용 조건을 확인해야 합니다.</p><h3>좌표가 없는 API</h3><p>AWS 관측·병상정보에는 관측소/기관 식별번호가 있지만 좌표가 없습니다. <code>SAFETYDATA_LOCATION_INDEX_JSON</code>에 검수한 고유번호·이름·좌표·출처를 등록해야 지도에 붙일 수 있습니다.</p><p class="small">‘키 설정됨’은 인증 성공이 아닙니다. 실제 키는 서버에서만 사용하며 이 화면에는 표시하거나 저장하지 않습니다.</p><button class="primary" data-action="safety-hub">연결 화면으로</button>`,'sd-settings');
 }
 function recordList(id){
  return api.scoped(id).slice(0,80).map(f=>`<button class="record" data-action="feature" data-layer="${esc(id)}" data-id="${esc(f.properties.id)}"><strong>${esc(f.properties.name||'명칭 미제공')}</strong><small>${esc(f.properties.sectionNo||f.properties.originalAttributes?.SCTN_NO||'')} ${esc(f.properties.vulnerabilityType||f.properties.originalAttributes?.FRGL_TYPE||'')} · ${esc(f.properties.observedAt||f.properties.sourceDate||'원자료 기준일 미제공')}</small></button>`).join('');
 }
 function receipt(id){
  const b=bookFor(id),e=current(id),a=attempts.get(id),metadata=b||e?.metadata||{},q=metadata.quality||{},last=b?.last;
  const rows=[['서버 키',s.config?.configured?.[id]?'설정됨 (수신 성공과 별도)':'미설정'],['최근 요청 결과',a?(a.ok?'수신 성공':a.ok===false?`수신 실패${a.code?' · '+a.code:''}`:'요청 중'):'요청하지 않음'],['요청 확인시각',dateText(a?.finishedAt||a?.startedAt)],['수집 범위',id===ICING?'광주 서구 전체':api.label()],['제공기관 전체 행수',countText(metadata.total)],['현재까지 받은 원자료',`${countText(metadata.scanned)}행`],['마지막 성공 수신시각',dateText(last?.collectedAt||e?.loadedAt)],['수신한 페이지',(b?.pages||e?.metadata?.pages||[]).map(p=>p.page).join(', ')||'미수신'],['전체 페이지 수집',metadata.complete===true?'완료':metadata.scanned>0?'진행 중 · 부분자료':'미확인']];
  if(id===ICING)rows.push(['광주 서구 명칭 일치',`${countText(q.regionMatched)}행`],['서구 명칭·경계 일치 지점',`${countText(b?.features?.size??e?.features?.length)}개`],['서구 명칭·위치 불일치',`${countText(q.regionBoundaryConflict)}행`],['다른 지역 제외',`${countText(q.regionExcluded)}행`],['대표지역 미기재',`${countText(q.regionUnknown)}행`]);
  rows.push(['좌표·도형 연결 필요',`${countText(q.needsLocation)}행`],['범위 밖/불명확 좌표',`${countText(q.outside)}행`],['원자료 기준일','원자료에서 별도 제공하지 않으면 미확인']);
  return `<div id="sd-receipt" data-id="${id}">${info(rows)}${a?.ok===false?`<p class="note warning">${esc(a.message)}${e?.features?.length?' · 기존 검수자료는 수신시각을 유지합니다.':''}</p>`:''}</div>`;
 }
 function detail(id){
  const src=SAFETY_BY_ID[id],e=current(id),b=bookFor(id);if(!src)return;
  const unlocated=b?.unlocated||e?.metadata?.unlocated||[],samples=b?.rawSamples||e?.metadata?.rawSamples||[];
  const raw=(b?.regionalRows||e?.metadata?.regionalRows||[]).slice(0,20);
  api.show(src.title+' · 수집 근거',`<p class="note">${esc(stateText(id))}</p>${receipt(id)}<p class="small">검사한 행에는 전국 자료가 포함될 수 있습니다. 위치를 확인하지 못한 자료를 ‘서구 시설 없음’으로 세지 않습니다.</p>${unlocated.length?'<h3>서구 명칭·주소 검수 후보 · 지도 미표시</h3>'+unlocated.map(x=>`<article class="query-card"><b>${esc(x.name)}</b><p>${esc(x.address)}</p><small>${esc(x.reason)}</small></article>`).join(''):''}${id===ICING?`<h3>실제 수신값</h3><p class="small">광주 서구 지역명 일치 행을 우선 표시합니다. 구간번호는 중복될 수 있으며 지점 수와 같지 않습니다.</p>${raw.length?`<details open><summary>서구 원자료 값 ${raw.length}행 보기</summary><pre class="small" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(raw,null,2))}</pre></details>`:'<p>이 수집 범위에서 광주 서구 명칭이 일치하는 행은 아직 확인되지 않았습니다.</p>'}${samples.length?`<details><summary>전국 응답 표본 · 페이지별 앞 5행</summary><pre class="small" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(samples,null,2))}</pre></details>`:''}<p class="small">API 주소: <a href="${esc(src.endpoint)}" target="_blank" rel="noopener noreferrer">${esc(src.endpoint)}</a></p><p class="small">원자료 좌표계: ${esc(src.coordinateSystem)} · 생활안전지도 동일 계층 명세와 대조 후 변환합니다.</p><button class="secondary" data-action="sd-download" data-id="${id}">수신값·검수기록 내려받기</button>`:''}<h3>현재 지도 범위의 수신 지점</h3>${e?.features?.length?recordList(id):'<p>지도에 반영된 수신 도형이 없습니다.</p>'}<p class="note">${esc(src.note)}</p><div class="detail-actions">${id===ICING?'<button class="primary" data-action="icing-panel">상습결빙구간 화면</button>':''}<button class="secondary" data-action="safety-hub">${SAFETY_SOURCES.length}종 목록</button></div>`,'sd-detail');
 }
 function chooseIcingLayer(){
  const live=current(ICING),local=localIcing();
  if(live?.state==='loaded'&&live?.metadata?.complete===true)return ICING;
  if(local?.state==='loaded'&&local.features?.length)return LOCAL_ICING;
  if(live?.features?.length)return ICING;
  return local?.state==='loaded'?LOCAL_ICING:null;
 }
 function displayIcing({solo=false}={}){
  const id=chooseIcingLayer();if(!id)return;
  if(solo){for(const lid of s.enabled)if(LAYER_BY_ID[lid]?.kind==='raster')api.send({type:'raster',id:lid,visible:false});s.enabled=new Set();}
  s.enabled.delete(id===ICING?LOCAL_ICING:ICING);s.enabled.add(id);s.activePreset=null;s.isolate=false;s.selected=null;api.drawData();
 }
 function showIcing(){
  // This is the actual map state. Source preference is used only when turning
  // a layer on; it must not overwrite what the user explicitly chose to show.
  const visibleIds=[ICING,LOCAL_ICING].filter(id=>s.enabled.has(id)&&Array.isArray(s.entries.get(id)?.features));
  const id=visibleIds.length===1?visibleIds[0]:null,entry=id?s.entries.get(id):null,features=visibleIds.flatMap(id=>api.scoped(id)),metadata=localIcing()?.metadata||{};
  const sectionNumbers=new Set(features.map(f=>f.properties.sectionNo||f.properties.originalAttributes?.SCTN_NO||f.properties.originalAttributes?.mng_no).filter(Boolean));
  const snapshot=localIcing()?.state==='loaded';
  const sourceText=visibleIds.length>1?'API 수신본·공식 공개본 함께 표시':id===ICING?(entry?.metadata?.complete?'API 전체 페이지 수신본':'API 부분수신본'):id===LOCAL_ICING?'공식 공개지도에서 확보한 자료':'결빙자료 지도 표시 꺼짐';
  const counts=visibleIds.length>1?visibleIds.map(id=>`${id===ICING?'API':'공식 공개본'} ${api.scoped(id).length}개`).join(' / '):entry?`${features.length}개`:'미표시';
  const records=visibleIds.map(layerId=>(visibleIds.length>1?`<h4>${layerId===ICING?'API 수신 지점':'공식 공개본 지점'}</h4>`:'')+recordList(layerId)).join('');
  api.show('상습결빙구간 · 광주 서구',`<p class="muted">${esc(api.label())} · 등록된 구간의 위치와 수신 근거를 확인합니다.</p><div class="detail-actions"><button class="primary" data-action="icing-all">서구 전체 표시</button><button class="secondary" data-action="icing-solo">결빙자료만 보기</button><button class="secondary" data-action="sd-detail" data-id="${ICING}">API 수신 현황·원본값</button></div>${info([['지금 지도에 사용하는 자료',sourceText],['선택 범위의 관리지점',counts],['원자료 구간번호',visibleIds.length>1?'자료별 중복 가능 · 합산하지 않음':entry?`${sectionNumbers.size}종 · 중복 가능`:'미표시']])}<p class="note">등록 지점은 현재 결빙 여부를 나타내지 않습니다. 시작·종료 지점 수와 실제 관리구간 수가 다를 수 있습니다.</p><details><summary>동별로 표시 범위 좁히기 · ${esc(api.label())}</summary><div class="detail-actions">${s.dongs.map(f=>`<button class="secondary" data-action="icing-dong" data-id="${esc(f.properties.dongId)}" aria-pressed="${s.dong===f.properties.dongId}">${esc(f.properties.dongName)}</button>`).join('')}</div></details><h3>확보한 공식 자료</h3><p class="small">${snapshot?`공식 공개자료 ${localIcing().features.length}개 관리지점 · 확보시각 ${esc(dateText(metadata.collectedAt||metadata.fetchedAt||metadata.retrievedAt||metadata.downloadedAt))}`:esc(localError||'공식 공개자료를 확인하고 있습니다.')}</p>${metadata.sourceUrl?`<a class="small" href="${esc(metadata.sourceUrl)}" target="_blank" rel="noopener noreferrer">공식 공개자료 출처</a>`:''}${snapshot?`<p class="small">원자료의 서구 분류 ${countText(metadata.regionalSourceRows??metadata.sourceRows)}지점 중 경계 안 ${localIcing().features.length}지점을 수록했습니다. 경계 밖 ${countText(metadata.rejectedOutside)}지점은 제외했습니다. 개별 관리지점의 갱신일은 공개되지 않았습니다.</p>`:''}<p class="small">공개지도에서 확보한 자료와 아래 API 요청 결과는 각각 표시합니다.</p><h3>API 직접 조회</h3>${card(SAFETY_BY_ID[ICING])}<h3>${esc(api.label())}의 등록 지점</h3>${features.length?records:`<p class="note">${visibleIds.length?'선택 범위에서 확보한 지점이 없습니다. 서구 전체 표시로 범위를 넓혀 확인할 수 있습니다.':'결빙자료만 보기를 누르면 확보한 자료를 지도에 표시합니다.'}</p>`}<div class="detail-actions"><button class="secondary" data-action="snow">제설 관리자료</button><button class="secondary" data-action="safety-hub">재난안전 API 전체</button></div>`,'icing');
 }
 async function ensureLocalIcing(){
  if(localIcing()?.state==='loaded')return;
  try{
   const body=await api.fetchJSON('/data/city/local-icing.geojson');
   if(body.type!=='FeatureCollection'||!Array.isArray(body.features))throw Error('공식 공개자료 형식 확인 필요');
   const accepted=body.features.filter(f=>validGeometry(f.geometry));
   const features=filterFeatures(accepted,s.district);
   s.entries.set(LOCAL_ICING,{title:'상습결빙구간 · 공식 공개자료',state:'loaded',features,metadata:body.metadata||{},loadedAt:new Date().toISOString()});localError='';
  }catch(e){localError=e.message||'공식 공개자료를 받지 못했습니다.';}
 }
 function newBook(){return {page:1,features:new Map(),scanned:0,total:null,seen:new Set(),complete:false,unlocated:[],pages:[],regionalRows:[],rawSamples:[],quality:Object.fromEntries(qualityKeys.map(k=>[k,0]))};}
 function publishedMetadata(b,source,dong){return {scopeDong:dong,scopeLabel:dong==='all'?'서구 전체':api.label(),complete:b.complete,scanned:b.scanned,total:b.total,quality:{...b.quality},unlocated:[...b.unlocated],pages:[...b.pages],regionalRows:[...b.regionalRows],rawSamples:[...b.rawSamples],sourceName:source.sourceName,sourceUrl:source.sourceUrl,sourceDate:null,collectedAt:b.last?.collectedAt};}
 async function collect(id){
  if(busy||!SAFETY_BY_ID[id])return;
  const startedAt=new Date().toISOString();
  if(!s.config?.configured?.[id]){const message='키 미설정 · 서버 환경변수를 확인하세요.';messages.set(id,message);attempts.set(id,{startedAt,finishedAt:startedAt,ok:false,code:'NOT_CONFIGURED',message});refresh();api.toast(message);return;}
  const source=SAFETY_BY_ID[id],dong=queryDong(id),startedDong=s.dong,bookKey=id+'|'+dong,station=$('sd-station')?.value.trim()||'';
  let b=books.get(bookKey);if(!b||b.complete)b=newBook();
  const mine=++token;busy=id;messages.delete(id);books.set(bookKey,b);attempts.set(id,{startedAt,ok:null});refresh();
  try{
   for(let requests=0;requests<4;requests++){
    const url=`/api/city-data?kind=${id}&dong=${encodeURIComponent(dong)}&page=${b.page}${station?'&station='+encodeURIComponent(station):''}`;
    const r=await api.fetchJSON(url);if(mine!==token||startedDong!==s.dong)return;
    if(r.stale)throw Object.assign(Error(r.warning||'갱신 실패로 이전 수신본이 반환됐습니다.'),{code:'STALE_RESPONSE'});
    if(r.scope!==dong||!Array.isArray(r.geojson?.features)||r.page!==b.page)throw Error('수집 범위·페이지 응답을 확인하지 못했습니다.');
    if(r.scanned>0&&b.seen.has(r.pageFingerprint))throw Error('같은 페이지가 반복됐습니다. 기존 자료를 유지합니다.');
    if(b.page>1&&r.total!==b.total)throw Error('수집 중 전체 건수가 변경됐습니다. 다시 조회해야 합니다.');
    const accepted=[];
    for(const f of r.geojson.features){if(!validGeometry(f.geometry))throw Error('반환 도형의 좌표 검증에 실패했습니다.');accepted.push(...filterFeatures([f],id===ICING?s.district:s.scope));}
    b.seen.add(r.pageFingerprint);b.total=r.total;b.scanned+=r.scanned;
    for(const f of accepted)b.features.set(String(f.properties.id),f);
    b.unlocated.push(...(r.unlocated||[]));b.unlocated=b.unlocated.slice(0,60);for(const k of qualityKeys)b.quality[k]+=r.quality?.[k]||0;
    b.pages.push({page:r.page,scanned:r.scanned,mappedRows:r.geojson.features.length,collectedAt:r.collectedAt,cacheState:r.cacheState||'unknown',regionMatched:r.quality?.regionMatched??null});
    if(r.rawSample)b.rawSamples.push({page:r.page,collectedAt:r.collectedAt,scope:r.rawSampleScope,rows:r.rawSample});b.rawSamples=b.rawSamples.slice(0,20);
    b.regionalRows.push(...(r.regionalRows||[]));b.last=r;b.complete=r.complete===true;
    if(b.complete)break;
    if(!Number.isInteger(r.nextPage)||r.nextPage<=b.page||r.nextPage>100)throw Error('수집 페이지 범위를 초과했습니다. 기존 자료를 유지합니다.');
    b.page=r.nextPage;refresh();await new Promise(resolve=>setTimeout(resolve,180));
   }
   const old=s.entries.get(id);
   if(b.complete){
    if(old?.features?.length&&!b.features.size)throw Error('새 응답이 0도형이어서 기존 정상 자료를 유지했습니다.');
    s.entries.set(id,{state:'loaded',title:source.title,features:[...b.features.values()],loadedAt:b.last.collectedAt,metadata:publishedMetadata(b,source,dong)});
    s.enabled.add(id);if(id===ICING)s.enabled.delete(LOCAL_ICING);api.drawData();messages.set(id,`${b.features.size}도형 반영 · ${b.scanned}행 검사 · 위치 연결 필요 ${b.quality.needsLocation}행`);
   }else if(id===ICING&&b.features.size&&old?.state!=='loaded'){
    s.entries.set(id,{state:'partial',title:source.title,features:[...b.features.values()],loadedAt:b.last.collectedAt,metadata:publishedMetadata(b,source,dong)});displayIcing();
   }
   attempts.set(id,{startedAt,finishedAt:new Date().toISOString(),ok:true});
  }catch(e){if(mine===token){messages.set(id,`${e.code?e.code+' · ':''}${e.message||'조회 실패'}`);attempts.set(id,{startedAt,finishedAt:new Date().toISOString(),ok:false,code:e.code||'',message:e.message||'조회 실패',status:e.status||null});}}
  finally{if(mine===token){busy=null;refresh();}}
 }
 function toggle(id,solo){
  if(!SAFETY_BY_ID[id])return;
  if(!current(id)){api.toast('현재 구역 또는 서구 전체의 수신자료를 먼저 조회하세요.');return;}
  if(solo){for(const lid of s.enabled)if(LAYER_BY_ID[lid]?.kind==='raster')api.send({type:'raster',id:lid,visible:false});s.enabled=new Set([id]);}else s.enabled.has(id)?s.enabled.delete(id):s.enabled.add(id);
  if(id===ICING&&s.enabled.has(id))s.enabled.delete(LOCAL_ICING);
  s.isolate=false;s.selected=null;s.activePreset=null;api.drawData();refresh();
 }
 function cancel(){
  if(busy){const old=attempts.get(busy)||{};attempts.set(busy,{...old,ok:false,finishedAt:new Date().toISOString(),code:'CANCELLED',message:'추가 수집 중지 · 이미 받은 페이지는 보존했습니다.'});}
  token++;busy=null;refresh();
 }
 function download(name,out){const u=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
 function exportReceipt(id){
  const source=SAFETY_BY_ID[id],b=bookFor(id),e=current(id);if(!source)return;
  download('서구온_상습결빙_수신검수기록.json',{source:{id,endpoint:source.endpoint,sourceUrl:source.sourceUrl,coordinateSystem:source.coordinateSystem,crsEvidence:source.crsEvidence},attempt:attempts.get(id)||null,...(b?publishedMetadata(b,source,queryDong(id)):e?.metadata||{}),geojson:fc(b?[...b.features.values()]:e?.features||[]),exportedAt:new Date().toISOString(),note:'실제 수신한 공개 원자료 값과 위치 검수기록입니다. 현재 결빙 관측이나 제설 완료정보가 아닙니다.'});
 }
 function exportData(){
  const layers=SAFETY_SOURCES.map(src=>({src,e:current(src.id)})).filter(x=>x.e?.state==='loaded');if(!layers.length){api.toast('현재 구역에 수신 완료자료가 없습니다.');return;}
  const out={...fc(layers.flatMap(({src})=>api.scoped(src.id).map(f=>({...f,properties:{...f.properties,layerId:src.id}})))),metadata:{scope:api.label(),exportedAt:new Date().toISOString(),note:'원자료 시각·출처 보존, 일부 위치 미검수. 현장 안전 보증 아님'}};download('서구온_재난안전_검수도형.geojson',out);
 }
 return {
  async action(button){
   const a=button.dataset.action,id=button.dataset.id;
   switch(a){
    case'safety-hub':show();break;
    case'sd-settings':settings();break;
    case'sd-fetch':await collect(id);break;
    case'sd-detail':detail(id);break;
    case'sd-download':exportReceipt(id);break;
    case'sd-solo':toggle(id,true);break;
    case'sd-with':toggle(id,false);break;
    case'sd-stop':cancel();api.toast('추가 요청을 중지했습니다. 기존 지도자료는 유지합니다.');break;
    case'sd-export':exportData();break;
    case'sd-restart':if(!busy){books.delete(id+'|'+queryDong(id));messages.delete(id);refresh();}break;
    case'icing':api.chooseDong('all');showIcing();await ensureLocalIcing();if(s.view==='icing'){displayIcing({solo:true});showIcing();}break;
    case'icing-panel':showIcing();break;
    case'icing-all':api.chooseDong('all');displayIcing();showIcing();break;
    case'icing-dong':if(s.dongs.some(f=>f.properties.dongId===id)){api.chooseDong(id);displayIcing();showIcing();}break;
    case'icing-solo':displayIcing({solo:true});showIcing();break;
    default:return false;
   }
   return true;
  },
  scopeChanged(){cancel();messages.clear();queueMicrotask(()=>{if(s.view==='safety-hub')show();if(s.view==='icing')showIcing();});},
  destroy(){cancel();}
 };
}
