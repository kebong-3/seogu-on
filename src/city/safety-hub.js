/** Bounded, user-initiated SafetyData collection. No credentials in browser storage or calls. */
import {SAFETY_SOURCES,SAFETY_BY_ID} from './safety-catalog.js';
import {esc,LAYER_BY_ID} from './catalog.js';
import {validGeometry,filterFeatures,fc} from './geometry.js';
const $=id=>document.getElementById(id);
export function createSafetyHub(api){
 const s=api.state,books=new Map(),messages=new Map();let busy=null,token=0;
 const current=id=>{const e=s.entries.get(id);return e?.metadata?.scopeDong===s.dong||e?.metadata?.scopeDong==='all'?e:null;};
 function stateText(id){const e=current(id),b=books.get(id+'|'+s.dong);if(busy===id)return '공식 서버 응답 대기';if(messages.has(id))return messages.get(id);if(b&&!b.complete)return `검수 대기 · ${b.scanned}행 확인 · ${b.features.size}도형 · 다음 ${b.page}페이지`;if(e?.state==='loaded')return `${api.scoped(id).length}도형 · 수신 ${e.loadedAt||'시각 없음'}`;if(s.entries.has(id))return '다른 구역 조회본 · 재조회 필요';return s.config?.configured?.[id]?'키 설정됨 · 인증/자료 수신 미확인':'키 미설정';}
 function cards(){return SAFETY_SOURCES.map(src=>`<article class="safety-card" id="card-${src.id}"><div class="section-heading"><h3>${esc(src.title)}</h3><span class="badge">${esc(({static:'등록시설',history:'과거 이력',designation:'지정구역',observation:'관측 원자료',forecast:'제공기관 예보'})[src.kind])}</span></div><p class="small"><b>정보제공기관: ${esc(src.sourceName.split(" / ")[0])}</b></p><p class="small">${esc(src.note)}</p><p class="note" aria-live="polite">${esc(stateText(src.id))}</p>${src.id==='sd-aws'?'<label class="field-label">검수된 AWS 관측소 코드<input id="sd-station" inputmode="numeric" maxlength="12" placeholder="공식 관측소 코드"></label>':''}<div class="detail-actions"><button class="primary" data-action="sd-fetch" data-id="${src.id}" ${busy?'disabled':''}>${books.get(src.id+'|'+s.dong)?.complete?'다시 조회':'조회·계속 수집'}</button><button class="secondary" data-action="sd-solo" data-id="${src.id}">이 자료만 보기</button><button class="secondary" data-action="sd-with" data-id="${src.id}">함께 보기</button><button class="secondary" data-action="sd-detail" data-id="${src.id}">수신 현황</button><button class="secondary" data-action="sd-restart" data-id="${src.id}" ${busy?'disabled':''}>수집 처음부터</button></div><a class="small" href="${esc(src.sourceUrl)}" target="_blank" rel="noopener noreferrer">공식 명세·이용조건</a></article>`).join('');}
 function refresh(){if(s.view==='safety-hub'&&$('safety-cards')){const st=$('sd-station')?.value;$('safety-cards').innerHTML=cards();if(st&&$('sd-station'))$('sd-station').value=st;}}
 function show(){api.show('재난안전 API · 9종 연결',`<p class="muted">${esc(api.label())} · 서비스별 키를 서버 환경변수 하나에 묶어 설정합니다.</p><p class="note">한 번 누를 때 최대 4페이지(외부 요청 4회)를 확인하고 멈춥니다. 끝나지 않으면 계속 수집합니다. 자동 재조회는 없으며 그림자 재생은 이 API를 호출하지 않습니다. 서버 캐시와 중복 요청 병합은 호출을 줄이지만 서버리스 전체의 일일 한도를 보증하는 계수기는 아닙니다.</p><div class="detail-actions"><button class="secondary" data-action="sd-settings">키·허용 IP 설정 안내</button><button class="secondary" data-action="sd-stop">진행 중지</button><button class="secondary" data-action="sd-export">수신 완료자료 내보내기</button></div><div id="safety-cards">${cards()}</div><p class="note warning">의료기관 자료는 실제 진료·수용을 보증하지 않습니다. 긴급상황은 119를 우선하세요. 민방위 대피소와 침수 대피장소는 다릅니다.</p>`,'safety-hub');}
 function settings(){api.show('재난안전 API 설정',`<h3>서버 환경변수 한 개</h3><code>SAFETYDATA_KEYS_JSON</code><p>프로젝트에 동봉한 ‘재난안전키_한번에설정.html’을 본인 컴퓨터에서 열어 발급 내역을 붙여넣으면 9개 키를 하나의 JSON으로 정리합니다. 그 값을 Vercel의 위 변수 하나에 저장하고 새로 배포합니다. 실제 키를 공개 GitHub·브라우저 코드에 넣지 마세요.</p><p class="note warning">서버에서 32번 오류가 반환되면 허용 IP 조건을 확인해야 합니다. 사용자 PC의 등록 IP와 Vercel 서버의 출발 IP는 별개입니다. 다른 프록시로 인증 제한을 우회하지 않습니다.</p><h3>좌표가 없는 API</h3><p>AWS 관측·병상정보에는 관측소/기관 식별번호가 있지만 좌표가 없습니다. <code>SAFETYDATA_LOCATION_INDEX_JSON</code>에 검수한 고유번호·이름·좌표·출처를 등록해야 지도에 붙일 수 있습니다. 지역 재해위험지구 주소도 검수가 필요합니다.</p><p class="small">목록에 키 설정됨은 인증 성공이 아닙니다. 이 화면에서는 키를 입력·표시·보관하지 않습니다. 키를 갱신하면 다시 배포하세요.</p><button class="primary" data-action="safety-hub">연결 화면으로</button>`,'sd-settings');}
 function detail(id){const src=SAFETY_BY_ID[id],e=current(id),b=books.get(id+'|'+s.dong);if(!src)return;const q=b?.quality||e?.metadata?.quality||{};const unlocated=b?.unlocated||e?.metadata?.unlocated||[];api.show(src.title+' · 수집 근거',`<p class="note">${esc(stateText(id))}</p><dl class="info-grid"><dt>수집 범위</dt><dd>${esc(api.label())}</dd><dt>검사한 원자료 행</dt><dd>${b?.scanned??e?.metadata?.scanned??'미수신'}</dd><dt>좌표·도형 연결 필요</dt><dd>${q.needsLocation??'미수신'}행</dd><dt>범위 밖/불명확 좌표</dt><dd>${q.outside??'미수신'}행</dd><dt>기준일</dt><dd>원자료에서 별도 제공하지 않으면 미확인</dd></dl><p class="small">검사한 행에는 전국 자료가 포함될 수 있습니다. 좌표가 없어 지역을 판정하지 못한 자료를 ‘서구 시설 없음’으로 세지 않습니다.</p>${unlocated.length?'<h3>서구 주소 검수 후보 · 동별 위치 미확인</h3>'+unlocated.map(x=>`<article class="query-card"><b>${esc(x.name)}</b><p>${esc(x.address)}</p><small>${esc(x.reason)}</small></article>`).join(''):''}<h3>현재 구역 수신 완료 도형</h3>${(e?.features?api.scoped(id):[]).slice(0,80).map(f=>`<button class="record" data-action="feature" data-layer="${id}" data-id="${esc(f.properties.id)}"><strong>${esc(f.properties.name)}</strong><small>${esc(f.properties.observedAt||f.properties.sourceDate||'원자료 시각 미제공')}</small></button>`).join('')||'<p>현재 지도에 반영된 검수 도형이 없습니다.</p>'}<p class="note">${esc(src.note)}</p><button class="secondary" data-action="safety-hub">9종 목록</button>`,'sd-detail');}
 async function collect(id){
  if(busy||!SAFETY_BY_ID[id])return;
  if(!s.config?.configured?.[id]){messages.set(id,'키 미설정 · 통합 환경변수를 확인하세요.');refresh();api.toast('서버 환경변수에 해당 데이터용 키를 등록해야 합니다.');return;}
  const source=SAFETY_BY_ID[id],dong=s.dong,bookKey=id+'|'+dong,station=$('sd-station')?.value.trim()||'';
  let b=books.get(bookKey);if(!b||b.complete)b={page:1,features:new Map(),scanned:0,total:null,seen:new Set(),complete:false,unlocated:[],quality:{needsLocation:0,outside:0,invalid:0,privateFieldsRemoved:0}};
  const mine=++token;busy=id;messages.delete(id);books.set(bookKey,b);refresh();
  try{
   for(let requests=0;requests<4;requests++){
    const url=`/api/city-data?kind=${id}&dong=${encodeURIComponent(dong)}&page=${b.page}${station?'&station='+encodeURIComponent(station):''}`;
    const r=await api.fetchJSON(url);if(mine!==token||dong!==s.dong)return;
    if(r.stale)throw Error(r.warning||'갱신 실패로 이전 수신본이 반환됐습니다.');
    if(r.scope!==dong||!Array.isArray(r.geojson?.features)||r.page!==b.page)throw Error('수집 범위·페이지 응답을 확인하지 못했습니다.');
    if(r.scanned>0&&b.seen.has(r.pageFingerprint))throw Error('같은 페이지가 반복됐습니다. 기존 자료를 유지합니다.');
    if(b.page>1&&r.total!==b.total)throw Error('수집 중 전체 건수가 변경됐습니다. 다시 조회해야 합니다.');
    b.seen.add(r.pageFingerprint);b.total=r.total;b.scanned+=r.scanned;
    for(const f of r.geojson.features){if(!validGeometry(f.geometry))throw Error('반환 도형의 좌표 검증에 실패했습니다.');for(const clipped of filterFeatures([f],s.scope))b.features.set(String(clipped.properties.id),clipped);}
    b.unlocated.push(...(r.unlocated||[]));b.unlocated=b.unlocated.slice(0,60);for(const k of Object.keys(b.quality))b.quality[k]+=r.quality?.[k]||0;
    b.last=r;b.complete=r.complete===true;
    if(b.complete)break;
    if(!Number.isInteger(r.nextPage)||r.nextPage<=b.page||r.nextPage>100)throw Error('수집 페이지 범위를 초과했습니다. 기존 자료를 유지합니다.');
    b.page=r.nextPage;refresh();await new Promise(resolve=>setTimeout(resolve,180));
   }
   if(b.complete){
    const old=s.entries.get(id);if(old?.features?.length&&!b.features.size)throw Error('새 응답이 0도형이어서 기존 정상 자료를 유지했습니다.');
    s.entries.set(id,{state:'loaded',title:source.title,features:[...b.features.values()],loadedAt:b.last.collectedAt,metadata:{scopeDong:dong,scopeLabel:api.label(),complete:true,scanned:b.scanned,total:b.total,quality:b.quality,unlocated:b.unlocated,sourceName:source.sourceName,sourceUrl:source.sourceUrl,sourceDate:null}});
    s.enabled.add(id);api.drawData();messages.set(id,`${b.features.size}도형 반영 · ${b.scanned}행 검사 · 위치 연결 필요 ${b.quality.needsLocation}행`);
   }
  }catch(e){if(mine===token)messages.set(id,e.message||'조회 실패');}
  finally{if(mine===token){busy=null;refresh();}}
 }
 function toggle(id,solo){if(!SAFETY_BY_ID[id])return;if(!current(id)){api.toast('현재 구역 또는 서구 전체의 수신 완료자료를 먼저 조회하세요.');return;}if(solo){for(const lid of s.enabled)if(LAYER_BY_ID[lid]?.kind==='raster')api.send({type:'raster',id:lid,visible:false});s.enabled=new Set([id]);}else s.enabled.has(id)?s.enabled.delete(id):s.enabled.add(id);s.isolate=false;s.selected=null;s.activePreset=null;api.drawData();}
 function cancel(){token++;busy=null;refresh();}
 function exportData(){const layers=SAFETY_SOURCES.map(src=>({src,e:current(src.id)})).filter(x=>x.e?.state==='loaded');if(!layers.length){api.toast('현재 구역에 수신 완료자료가 없습니다.');return;}const out={...fc(layers.flatMap(({src})=>api.scoped(src.id).map(f=>({...f,properties:{...f.properties,layerId:src.id}})))),metadata:{scope:api.label(),exportedAt:new Date().toISOString(),note:'원자료 시각·출처 보존, 일부 위치 미검수. 현장 안전 보증 아님'}};const u=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/geo+json'})),a=document.createElement('a');a.href=u;a.download='서구온_재난안전_검수도형.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
 return {async action(b){const a=b.dataset.action,id=b.dataset.id;switch(a){case'safety-hub':show();break;case'sd-settings':settings();break;case'sd-fetch':await collect(id);break;case'sd-detail':detail(id);break;case'sd-solo':toggle(id,true);break;case'sd-with':toggle(id,false);break;case'sd-stop':cancel();api.toast('추가 요청을 중지했습니다. 기존 지도자료는 유지합니다.');break;case'sd-export':exportData();break;case'sd-restart':books.delete(id+'|'+s.dong);messages.delete(id);refresh();break;default:return false;}return true;},scopeChanged(){cancel();messages.clear();queueMicrotask(()=>{if(s.view==='safety-hub')show();});},destroy(){cancel();}};
}
