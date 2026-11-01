import {registerAction} from './actions.js';
import {escapeDecisionHtml as e} from './decision-report.js';
import {icon} from './catalog.js';
import {frameFor} from './camera.js';

export const FAMILY_MAP_LAYER='family-outings';
const SELECTED_LAYER='family-outings-selected';
export const FAMILY_DISTRICTS=Object.freeze(['서구','북구','동구','남구','광산구']);
export const FAMILY_GROUPS=Object.freeze([
 {id:'nature',label:'숲·공원',icon:'tree',color:'#167b57',categories:['forest','park']},
 {id:'culture',label:'문화·예술',icon:'building',color:'#a35b26',categories:['culture']},
 {id:'science',label:'과학·배움',icon:'sun',color:'#275fc1',categories:['science']},
 {id:'library',label:'책·도서관',icon:'book',color:'#8054aa',categories:['library']},
 {id:'experience',label:'놀이·체험',icon:'home',color:'#bf456c',categories:['experience']},
 {id:'landscape',label:'산책·전망',icon:'pin',color:'#087d91',categories:['landscape']},
]);
const list=value=>Array.isArray(value)?value:[];
const compact=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s·ㆍ.\-]/g,'');
const number=value=>Number(value||0).toLocaleString('ko-KR');
const categoryOf=feature=>FAMILY_GROUPS.find(group=>group.categories.includes(feature.properties?.category))||FAMILY_GROUPS[4];
const environmentName=value=>({indoor:'실내',outdoor:'야외',mixed:'실내·야외'})[value]||'환경 확인';
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const validPoint=feature=>feature?.geometry?.type==='Point'&&Array.isArray(feature.geometry.coordinates)&&feature.geometry.coordinates.length===2&&feature.geometry.coordinates.every(Number.isFinite)&&feature.geometry.coordinates[0]>=126.6&&feature.geometry.coordinates[0]<=127.15&&feature.geometry.coordinates[1]>=35&&feature.geometry.coordinates[1]<=35.3&&['address-matched','poi-matched'].includes(feature.properties?.locationStatus);

/** Every filter applies to the list and the map, including records still awaiting a map point. */
export function familyOutingRows(collection,{district='서구',group='all',environment='all',query=''}={}){
 const tokens=String(query||'').trim().split(/\s+/).map(compact).filter(Boolean);
 return list(collection?.features).filter(feature=>{
  const p=feature?.properties;if(!p?.id||!p.name)return false;
  if(district!=='all'&&p.district!==district)return false;
  if(group!=='all'&&categoryOf(feature).id!==group)return false;
  if(environment!=='all'&&p.environment!==environment)return false;
  const haystack=compact([p.name,p.district,p.address,p.sourceAddress,p.summary,categoryOf(feature).label,...list(p.aliases),...list(p.activities)].join(' '));
  return tokens.every(token=>haystack.includes(token));
 }).sort((a,b)=>String(a.properties.name).localeCompare(String(b.properties.name),'ko-KR'));
}

export function familyMapFeatures(rows,selectedId=''){
 return list(rows).filter(validPoint).map(feature=>{
  const p=feature.properties,selected=p.id===selectedId;
  return {...feature,properties:{...p,displayColor:selected?'#064ab4':categoryOf(feature).color,familyOuting:true,familySelected:selected,mapLabel:selected||rows.length<=12?p.name:'',sourceName:'제공된 육아지도 · 위치 대조자료'}};
 });
}

/** Routes are opened by an explicit user click; never use a fabricated point for an unresolved address. */
export function familyOutingLinks(feature){
 const p=feature?.properties||{},query=p.mapQuery||(p.directionPolicy==='search-only'?[p.name,p.district]:[p.name,p.address||p.sourceAddress]).filter(Boolean).join(' '),search='https://map.kakao.com/link/search/'+encodeURIComponent(query);
 const coordinates=validPoint(feature)&&!['confirm-first','search-only'].includes(p.directionPolicy)?feature.geometry.coordinates:null;
 return {search,route:coordinates?'https://map.kakao.com/link/to/'+encodeURIComponent(p.name)+','+coordinates[1]+','+coordinates[0]:null,website:safeUrl(p.website)};
}

function sourceHtml(p,metadata){
 const refs=list(p.sourceRefs),source=p.coordinateSource||{},sourceUrl=safeUrl(source.url),phone=String(p.phone||'').replace(/[\s()-]/g,'');
 return `<details class="family-sources"><summary>자료 출처와 위치 확인</summary><p>${e(metadata?.sourceDescription||'사용자가 제공한 육아지도·안내책자 사진의 장소와 설명을 정리했습니다.')}</p>${refs.length?`<ul>${refs.map(ref=>`<li>${e(ref.label||ref.collection||'제공 자료')}${ref.number?' · '+e(ref.number)+'번':''}${ref.page?' · '+e(ref.page)+'쪽':''}</li>`).join('')}</ul>`:''}${p.sourceAddress&&p.sourceAddress!==p.address?`<p>책자 주소: ${e(p.sourceAddress)}</p>`:''}<p>${validPoint({geometry:p._geometry,properties:p})?'대조된 대표 위치':'지도 위치 확인 중'}${source.title?' · '+e(source.title):''}${source.checkedAt?' · 위치 대조 '+e(String(source.checkedAt).slice(0,10)):''}</p>${sourceUrl?`<a href="${e(sourceUrl)}" target="_blank" rel="noopener noreferrer">위치 대조자료 열기 ↗</a>`:''}${/^\+?\d{8,14}$/.test(phone)?`<a href="tel:${e(phone)}">기관 전화 ${e(p.phone)}</a>`:''}<p>${e(p.positionNote||'공원·시설 대표점과 실제 출입구는 다를 수 있어요.')}</p><p>위치 대조일은 운영 확인일이 아니에요.</p></details>`;
}

function outingCard(feature,{selectedId,metadata,allFeatures}){
 const p=feature.properties,category=categoryOf(feature),selected=p.id===selectedId,mapped=validPoint(feature),links=familyOutingLinks(feature),activities=list(p.activities),related=list(p.relatedIds).map(id=>allFeatures.find(f=>f.properties?.id===id)).filter(Boolean);
 return `<article class="family-card${selected?' is-selected':''}" data-family-card="${e(p.id)}" style="--family-color:${category.color}">
 <div class="family-card-heading"><span class="family-place-icon" aria-hidden="true">${icon(category.icon)}</span><div><div class="family-tags"><span>${e(p.district)}</span><span>${e(category.label)}</span><span>${e(environmentName(p.environment))}</span></div><h3>${e(p.name)}</h3></div>${selected?'<span class="family-selected-tag">선택</span>':''}</div>
 <p class="family-description">${e(p.summary||'장소 위치와 방문 안내를 확인하고 아이와 나들이를 준비해 보세요.')}</p>
 <p class="family-address">${icon('pin')}<span>${e(p.address||(p.directionPolicy==='search-only'?p.district+' · 상세 주소 확인 중':p.sourceAddress)||'주소 확인 중')}</span></p>
 ${p.noticeLabel?`<p class="family-pending">${e(p.noticeLabel)}${p.directionPolicy==='confirm-first'?' · 방문 전에 공식 안내를 확인해 주세요':p.directionPolicy==='search-only'?' · 장소 이름으로 찾아보세요':''}</p>`:!mapped?'<p class="family-pending">지도 위치 확인 중 · 장소 이름으로 찾아보세요</p>':''}
 <div class="family-card-actions">${mapped?`<button data-action="family-focus" data-id="${e(p.id)}" aria-label="${e(p.name)} 지도에서 보기">${selected?'선택 장소 다시 보기':'지도에서 보기'}</button>`:`<a href="${e(links.search)}" target="_blank" rel="noopener noreferrer" aria-label="${e(p.name)} 지도에서 검색">지도에서 검색 ↗</a>`}${links.route?`<a class="family-route" href="${e(links.route)}" target="_blank" rel="noopener noreferrer" aria-label="${e(p.name)} 카카오맵 길찾기">길찾기 ↗</a>`:p.directionPolicy==='confirm-first'?(links.website?`<a class="family-route" href="${e(links.website)}" target="_blank" rel="noopener noreferrer">출입 안내 확인 ↗</a>`:`<button data-action="family-confirm" data-id="${e(p.id)}">출입 안내 확인</button>`):mapped&&p.directionPolicy==='search-only'?`<a class="family-route" href="${e(links.search)}" target="_blank" rel="noopener noreferrer" aria-label="${e(p.name)} 지도에서 입구 찾기">지도에서 입구 찾기 ↗</a>`:''}</div>
 <details class="family-visit"${selected?' open':''}><summary>여기서 해볼 놀이·방문 안내</summary>
 ${activities.length?`<h4>${p.activitySource==='provided'?'책자에서 소개한 활동':'아이와 해볼 활동 제안'}</h4><ul class="family-activities">${activities.map(activity=>`<li>${e(activity)}</li>`).join('')}</ul>`:''}
 ${p.activityNote?`<p class="family-activity-note">${e(p.activityNote)}</p>`:''}
 <p class="family-visit-note">${e(p.visitNote||'방문 전에 개방 여부와 체험 일정·예약을 확인해 주세요.')}</p>
 ${links.website?`<a class="family-official" href="${e(links.website)}" target="_blank" rel="noopener noreferrer">${p.directionPolicy==='confirm-first'?'공식 방문·출입 안내':'공식 이용·예약 안내'} ↗</a>`:p.directionPolicy==='confirm-first'?'':`<a class="family-official" href="${e(links.search)}" target="_blank" rel="noopener noreferrer">지도에서 시설정보 확인 ↗</a>`}
 ${related.length?`<div class="family-related"><span>함께 살펴볼 장소</span>${related.map(other=>`<button data-action="family-related" data-id="${e(other.properties.id)}">${e(other.properties.name)} →</button>`).join('')}</div>`:''}
 ${sourceHtml({...p,_geometry:feature.geometry},metadata)}</details></article>`;
}

export function familyGuideHtml({collection=null,district='서구',group='all',environment='all',query='',selectedId='',limit=10,busy=false,error=''}={}){
 const all=list(collection?.features),rows=familyOutingRows(collection,{district,group,environment,query}),mapped=familyMapFeatures(rows),selected=rows.find(feature=>feature.properties.id===selectedId),shown=(selected?[selected,...rows.filter(feature=>feature!==selected)]:rows).slice(0,limit),filtered=group!=='all'||environment!=='all'||!!query;
 return `<div class="family-guide" aria-busy="${busy}">
 <nav class="family-tabs" aria-label="돌봄·육아 지도 분야"><button data-action="family-outings" aria-pressed="true">아이와 나들이</button><button data-action="decision-living-map" data-topic="care">돌봄시설</button><button data-action="decision-living-map" data-topic="safety">여성안심</button></nav>
 <section class="family-hero"><span class="family-eyebrow">육아지도 · 아이와 함께하는 하루</span><h3>오늘은 어디로 갈까요?</h3><p>숲·공원·문화체험, 오늘 갈 곳을 골라 보세요.</p><div class="family-hero-bottom"><span>${all.length?`5개 구 <b>${number(all.length)}곳</b>의 나들이 장소`:'나들이 장소를 모으고 있어요'}</span><span aria-hidden="true" class="family-hero-tree">${icon('tree')}</span></div></section>
 <section class="family-filters" aria-label="나들이 장소 찾기"><div class="family-filter-label">어디에서 놀까요?</div><div class="family-districts" role="group" aria-label="나들이 지역"><button data-action="family-district" data-district="all" aria-pressed="${district==='all'}">5개 구 전체</button>${FAMILY_DISTRICTS.map(value=>`<button data-action="family-district" data-district="${e(value)}" aria-pressed="${district===value}">${e(value)}</button>`).join('')}</div>

 <form id="family-search" class="family-search"><label for="family-query">장소 이름·동네·놀이로 찾기</label><div><input id="family-query" name="query" maxlength="100" value="${e(query)}" placeholder="예: 풍암, 유아숲, 국악" autocomplete="off"><button type="submit">찾기</button></div></form>
 <details class="family-refine"${group!=='all'||environment!=='all'?' open':''}><summary>종류·실내외로 좁히기${group!=='all'?' · '+e(FAMILY_GROUPS.find(item=>item.id===group)?.label||''):''}${environment!=='all'?' · '+e(environmentName(environment)):''}</summary><div class="family-filter-label">어떤 하루를 보낼까요?</div><div class="family-categories" role="group" aria-label="나들이 종류"><button data-action="family-category" data-group="all" aria-pressed="${group==='all'}">전체</button>${FAMILY_GROUPS.map(value=>`<button data-action="family-category" data-group="${value.id}" aria-pressed="${group===value.id}"><span style="--family-color:${value.color}" aria-hidden="true">${icon(value.icon)}</span>${e(value.label)}</button>`).join('')}</div><label class="family-environment" for="family-environment">활동 공간<select id="family-environment"><option value="all"${environment==='all'?' selected':''}>실내·야외 모두</option><option value="outdoor"${environment==='outdoor'?' selected':''}>야외</option><option value="indoor"${environment==='indoor'?' selected':''}>실내</option><option value="mixed"${environment==='mixed'?' selected':''}>실내·야외 함께</option></select></label></details></section>
 ${busy?'<p class="family-status" role="status">장소와 위치 정보를 불러오고 있어요.</p>':''}${error?`<div class="family-error" role="alert"><p>${e(error)}</p><button data-action="family-retry">다시 불러오기</button></div>`:''}
 <section class="family-results"><div class="family-results-heading" aria-live="polite"><div><span>${district==='all'?'5개 구 전체':e(district)}${query?' · '+e(query):''}</span><h3>${number(rows.length)}곳을 살펴보세요</h3></div>${filtered?'<button class="family-reset" data-action="family-reset">조건 초기화</button>':''}</div><p class="family-map-count">지도 ${number(mapped.length)}곳${rows.length!==mapped.length?' · 위치 확인 중 '+number(rows.length-mapped.length)+'곳':''} · 표시를 누르면 안내가 열려요</p>
 <div class="family-map-actions"><button data-action="family-frame"${mapped.length?'':' disabled'}>선택 조건의 지도 한눈에</button><button data-action="family-map-wide"${mapped.length?'':' disabled'}>지도 크게 보기</button></div>
 <div class="family-legend" aria-label="지도 색상 안내">${FAMILY_GROUPS.filter(category=>rows.some(feature=>categoryOf(feature).id===category.id)).map(category=>`<span><i style="background:${category.color}"></i>${e(category.label)}</span>`).join('')}</div>
 <div class="family-card-list">${shown.map(feature=>outingCard(feature,{selectedId,metadata:collection?.metadata,allFeatures:all})).join('')}${!rows.length&&!busy&&!error?`<div class="family-empty"><h4>조건에 맞는 장소가 없어요</h4><p>장소 이름을 짧게 입력하거나 다른 지역·종류를 골라 보세요.</p><button data-action="family-reset">검색 조건 초기화</button>${district!=='all'?'<button data-action="family-district" data-district="all">5개 구 전체에서 찾기</button>':''}</div>`:''}</div>${rows.length>shown.length?`<button class="family-more" data-action="family-more">장소 10곳 더 보기 <span>${number(shown.length)} / ${number(rows.length)}</span></button>`:''}</section>
 <details class="family-coverage"><summary>육아지도에 담은 장소와 안내 기준</summary><p>${e(collection?.metadata?.sourceDescription||'제공된 문화·체험 지도와 숲·공원 목록에서 중복 장소를 정리했습니다.')}</p><p>숲·공원 목록에는 공원과 산책로도 포함돼요. 모든 장소가 예약형 유아숲체험원인 것은 아니에요. 공원과 그 안의 체험 공간은 별도 목적지로 표시할 수 있어요.</p><p>나들이 지역 선택은 이 목록과 지도 표시에 적용돼요. 이용시간·요금·예약·주차·유모차 접근은 방문 전에 시설 안내를 확인해 주세요.</p>${collection?.metadata?.collectedAt?`<p>자료 정리 ${e(String(collection.metadata.collectedAt).slice(0,10))} · 책자 발행일과 현재 운영 확인일은 별도예요.</p>`:''}</details></div>`;
}

export function installFamilyOutings(api){
 let collection=null,district='서구',group='all',environment='all',query='',selectedId='',limit=10,active=false,busy=false,error='',controller,sequence=0,destroyed=false;
 const host=()=>document.getElementById('detail-body'),app=document.getElementById('app');
 const strip=document.createElement('div');strip.id='family-map-summary';strip.className='family-map-summary';strip.hidden=true;strip.setAttribute('role','group');strip.setAttribute('aria-label','육아 나들이지도 보기');app?.append(strip);
 const rows=()=>familyOutingRows(collection,{district,group,environment,query});
 function updateStrip(){
  const selected=rows().find(feature=>feature.properties.id===selectedId),count=familyMapFeatures(rows()).length;
  strip.hidden=!active;
  if(!active)return;
  strip.innerHTML=`<div><span>${e(district==='all'?'5개 구 육아지도':district+' 육아지도')}</span><strong>${e(selected?.properties.name||`지도에 나들이 장소 ${number(count)}곳`)}</strong></div><button data-action="family-outings">장소 목록</button>`;
  strip.classList.toggle('is-panel-open',api.state.view==='family-outings'&&!document.getElementById('detail-panel')?.hidden);
 }
 function paint(){
  if(!active||destroyed)return;
  const features=familyMapFeatures(rows(),selectedId);
  api.send?.({type:'family-extent',active:true});
  api.send?.({type:'layer',id:FAMILY_MAP_LAYER,color:'#167b57',features:features.filter(feature=>feature.properties.id!==selectedId),visible:true});
  // Keep the chosen name readable even when two destinations share one building or park.
  api.send?.({type:'layer',id:SELECTED_LAYER,color:'#064ab4',features:features.filter(feature=>feature.properties.id===selectedId),visible:true,selectedId});
  updateStrip();
 }
 function render({top=false}={}){
  if(!active||destroyed)return;
  const scroll=top?0:host()?.scrollTop||0;
  api.show('육아지도 · 아이와 나들이',familyGuideHtml({collection,district,group,environment,query,selectedId,limit,busy,error}),'family-outings');
  if(host())host().scrollTop=scroll;
  updateStrip();
 }
 function frame(){
  const features=familyMapFeatures(rows());if(!features.length)return;
  api.pauseMotion?.();
  const geometry=features.length===1?features[0].geometry:{type:'LineString',coordinates:features.map(feature=>feature.geometry.coordinates)};
  const width=typeof innerWidth==='number'?innerWidth:1000,height=typeof innerHeight==='number'?innerHeight:800;
  api.send?.({type:'camera',pose:frameFor(geometry,features.length===1?'facility':'overview',{width:Math.max(320,width-750),height:Math.max(350,height-180)},0),duration:650});
 }
 async function open(button={}){
  if(api.state.regionProfile?.id!=='seogu'){api.toast?.('이 육아지도는 서구와 인접 4개 구의 장소를 안내해요.');return;}
  active=true;document.body.classList.add('family-outings-active');api.pauseMotion?.();
  const nextDistrict=button.dataset?.district;if(nextDistrict==='all'||FAMILY_DISTRICTS.includes(nextDistrict))district=nextDistrict;
  if(collection){paint();render();return;}
  const request=++sequence;controller?.abort();const activeController=new AbortController();controller=activeController;busy=true;error='';render();
  const timeout=setTimeout(()=>activeController.abort(),20000);
  try{
   const response=await fetch('/data/family/gwangju-outings.geojson',{signal:activeController.signal});
   if(!response.ok)throw Error('장소 자료를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
   const body=await response.json();
   if(body.type!=='FeatureCollection'||!Array.isArray(body.features))throw Error('장소 자료 형식을 확인하고 있어요. 다시 불러와 주세요.');
   if(request!==sequence||destroyed||!active)return;
   collection=body;paint();frame();
  }catch(cause){if(request===sequence&&active&&!destroyed)error=cause.name==='AbortError'?'목록 연결이 지연되고 있어요. 다시 불러와 주세요.':cause.message;}
  finally{clearTimeout(timeout);if(request===sequence&&active&&!destroyed){busy=false;render();}}
 }
 function changed(){limit=10;selectedId='';paint();render();frame();}
 function focus(id,{related=false,move=true}={}){
  const feature=(related?list(collection?.features):rows()).find(item=>item.properties?.id===id);if(!feature)return;
  if(related){district=feature.properties.district;group='all';environment='all';query='';limit=10;}
  selectedId=id;paint();render();
  if(move&&validPoint(feature)){api.pauseMotion?.();api.frameGeometry?.(feature.geometry);}
  const node=[...host()?.querySelectorAll('[data-family-card]')||[]].find(item=>item.dataset.familyCard===id);node?.scrollIntoView?.({block:'nearest',behavior:'instant'});
 }
 function suspend(){
  if(!active)return;
  active=false;sequence++;controller?.abort();busy=false;strip.hidden=true;document.body.classList.remove('family-outings-active');
  api.send?.({type:'layer',id:FAMILY_MAP_LAYER,features:[],visible:false});api.send?.({type:'layer',id:SELECTED_LAYER,features:[],visible:false});api.send?.({type:'family-extent',active:false});
  if(!destroyed&&api.state.scope)api.frameGeometry?.(api.state.scope);
 }
 const offs=[
  registerAction('family-outings',open),
  registerAction('family-retry',()=>{collection=null;return open();}),
  registerAction('family-district',button=>{const value=button.dataset.district;if(value==='all'||FAMILY_DISTRICTS.includes(value)){district=value;changed();}}),
  registerAction('family-category',button=>{const value=button.dataset.group;if(value==='all'||FAMILY_GROUPS.some(item=>item.id===value)){group=value;changed();}}),
  registerAction('family-reset',()=>{query='';group='all';environment='all';changed();}),
  registerAction('family-focus',button=>focus(button.dataset.id)),
  registerAction('family-confirm',button=>focus(button.dataset.id,{move:false})),
  registerAction('family-related',button=>focus(button.dataset.id,{related:true})),
  registerAction('family-more',()=>{limit+=10;render();}),
  registerAction('family-frame',frame),
  registerAction('family-map-wide',()=>{api.close();updateStrip();api.send?.({type:'resize'});frame();}),
 ];
 const submit=event=>{if(event.target.id!=='family-search')return;event.preventDefault();query=String(new FormData(event.target).get('query')||'').trim().slice(0,100);changed();};
 const change=event=>{if(event.target.id==='family-environment'&&['all','indoor','outdoor','mixed'].includes(event.target.value)){environment=event.target.value;changed();}};
 host()?.addEventListener('submit',submit);host()?.addEventListener('change',change);
 return {open,suspend,replay:paint,panelClosed:updateStrip,panelReplaced:suspend,
  onEvent(message){if(!active)return false;if(message.type==='select'&&[FAMILY_MAP_LAYER,SELECTED_LAYER].includes(message.layer)){focus(String(message.id||''),{move:false});return true;}if(message.type==='ready'){paint();setTimeout(()=>{if(active)frame();},0);}return false;},
  scopeChanged(){if(!active)return;paint();},
  destroy(){suspend();destroyed=true;controller?.abort();offs.forEach(off=>off());host()?.removeEventListener('submit',submit);host()?.removeEventListener('change',change);strip.remove();},
 };
}
