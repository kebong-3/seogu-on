import {escapeDecisionHtml as e} from './decision-report.js';
import {pointInGeometry} from '../admin.js';

export const LIVING_CARE_GROUPS=Object.freeze([
 {id:'daycare',label:'어린이집',datasets:['childcare','childcare-official']},
 {id:'centres',label:'돌봄센터',datasets:['care-child-centers','care-alltogether','care-parenting','care-village','childcare-centres','care-centres']},
 {id:'libraries',label:'도서관',datasets:['care-libraries']},
 {id:'toys',label:'장난감',datasets:['care-toys']},
 {id:'nursing',label:'수유실',datasets:['care-nursing']},
 {id:'play',label:'놀이',datasets:['care-play']},
]);
const items=value=>Array.isArray(value)?value:[];
const num=value=>Number(value||0).toLocaleString('ko-KR');
const point=value=>Array.isArray(value)&&value.length>=2&&value.slice(0,2).every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
function url(value){
 if(typeof value!=='string'||value.length>2048)return '';
 try{const parsed=new URL(value);return ['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?value:'';}catch{return '';}
}
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/장난감\s*대여소/g,'장난감도서관').replace(/유아\s*도서관/g,'어린이도서관').replace(/수유방/g,'수유실').trim();
const compact=value=>normalize(value).replace(/\s+/g,'');
export function livingQueryMatches(values,query=''){
 const text=compact(items(values).join(' ')),needle=normalize(query);
 return !needle||text.includes(compact(needle))||needle.split(/\s+/).every(token=>text.includes(compact(token)));
}
export function livingDatasetMatches(id,filter='all'){
 if(filter==='all')return true;
 if(filter.startsWith('group:'))return LIVING_CARE_GROUPS.find(group=>`group:${group.id}`===filter)?.datasets.includes(id)||false;
 return id===filter;
}
function groupLabel(id,fallback){return LIVING_CARE_GROUPS.find(group=>group.datasets.includes(id))?.label||fallback||'시설';}

/** Dong names are supplied only after checking actual administrative geometry. */
export function livingFacilityRows(data,{query='',datasetId='all',scope=null}={}){
 return items(data).filter(d=>livingDatasetMatches(d.id,datasetId)).flatMap(descriptor=>items(descriptor.features).map(feature=>({descriptor,feature}))).filter(({descriptor:d,feature:f})=>{
  const p=f.properties||{},coordinate=f.geometry?.coordinates;
  return f.geometry?.type==='Point'&&point(coordinate)&&(!scope||pointInGeometry(coordinate,scope))&&livingQueryMatches([p.name,p.address,p.roadAddress,p.lotAddress,p.facilityName,p.livingDongName,p.facilityType,groupLabel(d.id,d.title)],query);
 }).sort((a,b)=>String(a.feature.properties?.name||'').localeCompare(String(b.feature.properties?.name||''),'ko-KR'));
}

function returnRouteFeatures(geometry,route){
 if(geometry?.type!=='FeatureCollection')return [];
 return items(geometry?.features).filter(feature=>{
  const p=feature?.properties||{};
  return typeof route.id==='string'&&route.id&&(p.routeId===route.id||p.id===route.id)||typeof route.name==='string'&&route.name&&p.name===route.name;
 });
}
function returnRouteLine(feature){
 const geometry=feature?.geometry,lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:null;
 return Array.isArray(lines)&&lines.length>0&&lines.every(line=>Array.isArray(line)&&line.length>1&&line.every(point)&&line.some(p=>p[0]!==line[0][0]||p[1]!==line[0][1]));
}
function returnArea(route){return String(route.area||'').split('공식 지도를 판독한 주변 설명이며')[0].trim();}

/** Image-interpreted lines remain visibly distinct from official surveyed coordinates. */
export function safeReturnGuide(reference,geometry,{selectedId='all',busy=false}={}){
 if(!reference?.routes?.length)return '';
 const routes=reference.routes,hasLines=routes.some(route=>returnRouteFeatures(geometry,route).some(returnRouteLine));
 return `<section class="living-safe-return" aria-labelledby="living-safe-return-heading">
 <div class="living-safe-return-heading"><span class="living-eyebrow">여성안심 · 귀가 준비</span><h3 id="living-safe-return-heading">안심귀갓길부터 살펴보세요</h3><p>지정길 주변을 지도에서 보고, 안심시설을 함께 살피는 도보경로를 비교해요.</p></div>
 <span class="living-route-state">공식지도 판독 · 위치오차 가능</span>
 <div class="living-safe-return-actions"><button class="living-safe-return-primary" data-action="walk-routes" data-mode="safety">안심귀가 길찾기 ↗</button><button data-action="decision-safe-return-map" data-id="all"${hasLines?'':' disabled'}>지정길 ${num(routes.length)}곳 지도 보기</button></div><div class="living-reference-key" aria-label="귀갓길 지도 범례"><span><i style="background:#f18720"></i>사진 판독 귀갓길</span><span><i style="background:#2358d5"></i>CCTV·비상벨 표시</span><span><i style="background:#9b3c74"></i>CCTV 표시</span><span><i style="background:#a56a14"></i>위치표지·로고젝터</span></div>
 <div class="living-safe-return-grid">${routes.map(route=>{
  const traced=returnRouteFeatures(geometry,route).some(returnRouteLine),focused=selectedId===route.id;
  return `<article class="living-safe-return-card${focused?' is-selected':''}"><div><h4>${e(route.name)}</h4><span class="living-route-state">${traced?'지도 판독 구간':busy?'구간 확인 중':'구간선 확인 중'}</span></div><p>${e(returnArea(route)||'주변 위치를 지도에서 확인하세요.')}</p><div class="living-safe-return-card-actions"><button data-action="decision-safe-return-map" data-id="${e(route.id)}" aria-label="${e(route.name)} 판독 구간 지도 보기"${traced?'':' disabled'}>구간 지도</button><button class="living-route-button" data-action="walk-routes" data-mode="safety" data-safe-return-id="${e(route.id)}" aria-label="${e(route.name)} 주변 안심귀가 길찾기"${traced?'':' disabled'}>이 주변 길찾기 ↗</button></div></article>`;
 }).join('')}</div>
 ${!hasLines?`<p class="dt-help">${busy?'귀갓길 구간을 불러오고 있어요.':'지정길 구간선 자료를 아직 불러오지 못했어요. 일반 안심시설 경유 길찾기는 이용할 수 있어요.'}</p>`:''}
 <section class="living-safety-tips" aria-labelledby="living-safety-tips-heading"><h4 id="living-safety-tips-heading">이 정보를 함께 보면 좋아요</h4><div><article><strong>CCTV 위치</strong><p>귀가 전에 경로 주변의 CCTV 설치 위치를 미리 살펴봐요.</p></article><article><strong>보안등 위치</strong><p>보안등이 수록된 구간을 비교하고, 현장에서 밝은 길을 선택하는 데 참고해요.</p></article><article><strong>도움 요청 지점</strong><p>도움이 필요할 때 찾을 경찰관서와 공개 비상벨 위치를 알아둬요.</p></article></div><p class="dt-help">설치 위치는 현재 촬영 범위·밝기·작동 여부와 다를 수 있어요. 시설 개수로 안전등급을 매기거나 현재 안전을 보장하지 않아요.</p></section>
 </section>`;
}

export function safeReturnSources(reference,geometry){
 if(!reference?.routes?.length)return '';
 const official=url(reference.sourceUrl),attachment=url(reference.attachmentUrl);
 const note=typeof geometry?.metadata?.note==='string'?geometry.metadata.note:'';
 return `<details class="living-route-guide living-safe-return-sources"><summary>여성안심귀갓길 출처·지도 판독 기준</summary><p>광주경찰청이 2026년 8월 공개한 서부경찰서 지정길 ${num(reference.routes.length)}곳을 참고했습니다. 구간선은 제공된 공식 지도 이미지의 도로·건물 위치를 대조해 옮긴 판독 자료이며, 제공기관의 측량좌표가 아닙니다.</p><p>위치오차가 있을 수 있고 실제 도로·출입구·통행조건은 현장에서 확인해야 해요. TMAP에서 조회한 보행경로는 이 판독 구간선과 구분해 표시합니다.</p>${note?`<p>${e(note)}</p>`:''}${geometry?.metadata?.symbolCoverage?`<p>${e(geometry.metadata.symbolCoverage)}</p>`:''}${url(geometry?.metadata?.alignmentSource?.url)?`<p>도로 대조: <a href="${e(url(geometry.metadata.alignmentSource.url))}" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors · ODbL 1.0</a></p>`:''}<div class="living-official-links">${official?`<a href="${e(official)}" target="_blank" rel="noopener noreferrer">경찰청 공식 안내·지도 열기 ↗</a>`:''}${attachment?`<a href="${e(attachment)}" target="_blank" rel="noopener noreferrer">공식 지도 내려받기 (.show) ↗</a>`:''}</div><ul>${reference.routes.map(route=>{const link=url(route.sourceUrl),trace=returnRouteFeatures(geometry,route).find(returnRouteLine),band=trace?.properties?.uncertaintyMeters,aux=trace?.properties?.sourceAuxiliaryNote;return `<li><strong>${e(route.name)}</strong> · ${e(returnArea(route)||'공식 지도를 확인하세요.')}${Number.isFinite(band)?`<small>사진 판독 비교폭 ${e(band)}m · 측량 정확도나 보장 오차범위가 아닙니다.</small>`:''}${aux?`<p>${e(aux)} 경로 비교에는 빨간 구간선만 사용합니다.</p>`:''}${link&&link!==official?` <a href="${e(link)}" target="_blank" rel="noopener noreferrer">구간 원문 ↗</a>`:''}</li>`;}).join('')}</ul><details><summary>최신 원좌표·운영 상태를 확인하려면</summary><p>서구청 양성아동복지과 또는 광주서부경찰서 담당자에게 최신 지정·변경일과 좌표계가 명시된 구간 자료를 확인하세요. CCTV·보안등·비상벨의 현재 작동·관리 상태는 각각의 관리기관 확인이 필요해요.</p></details></details>`;
}

export function careDirectoryRows(directory,{query='',datasetId='all'}={}){
 return items(directory?.entries||directory?.facilities).filter(r=>!point(r.coordinates)&&!(Number.isFinite(r.lat)&&Number.isFinite(r.lng)&&point([r.lng,r.lat]))).filter(r=>livingDatasetMatches(r.datasetId,datasetId)).filter(r=>livingQueryMatches([r.name,r.address,r.category,groupLabel(r.datasetId)],query));
}
function evidenceHtml(record={},descriptor={}){
 const meta=descriptor.meta||{},source=url(record.sourceUrl||meta.sourceUrl||descriptor.sourceUrl),date=Object.hasOwn(record,'sourceDate')?record.sourceDate:Object.hasOwn(meta,'sourceDate')?meta.sourceDate:descriptor.sourceDate;
 // verifiedAt records public-source review, not a visit or an operational inspection.
 const verified=record.verifiedAt||meta.verifiedAt||descriptor.verifiedAt;
 const collected=record.collectedAt||meta.collectedAt||descriptor.collectedAt;
 return `<p class="living-data-date">${e(record.sourceName||meta.sourceName||descriptor.sourceName||'출처 미제공')}<br>자료 기준 ${e(date||'미제공')} · 공개원문 확인 ${e(verified?String(verified).slice(0,10):'미제공')} · 수집 ${e(collected?String(collected).slice(0,10):'미제공')}<br>공개원문 확인은 현장 운영 확인이 아닙니다.</p>${source?`<a class="living-source-link" href="${e(source)}" target="_blank" rel="noopener noreferrer">공식 시설정보 확인 ↗</a>`:'<p class="living-data-date">원자료 링크 미제공</p>'}`;
}
function phoneHtml(phone){
 if(!phone)return '';
 const digits=String(phone).replace(/[\s()-]/g,'');
 return /^\+?\d{8,14}$/.test(digits)?`<a class="living-phone-link" href="tel:${e(digits)}" aria-label="기관에 전화 ${e(phone)}">전화 문의 ${e(phone)}</a>`:`<p>기관 연락처 ${e(phone)}</p>`;
}
export function careDirectoryHtml(directory,{query='',datasetId='all',scopeIsAll=true,limit=10,regionName='서구'}={}){
 const rows=careDirectoryRows(directory,{query,datasetId});
 if(!rows.length)return '';
 return `<section class="dt-section living-address-directory" id="living-address-results" aria-labelledby="living-address-heading"><div class="dt-section-heading"><h3 id="living-address-heading">주소로 확인하는 시설 <span>${num(rows.length)}곳</span></h3></div><p class="dt-help">주소를 먼저 확인해 주세요. 지도 위치가 미확정이라 길찾기는 준비 중이에요.${scopeIsAll?'':` 이 목록은 ${e(regionName)} 전체이며, 선택 동의 시설 수에 포함하지 않습니다.`}</p><div class="dt-result-list">${rows.slice(0,limit).map(r=>`<article class="dt-row living-card living-address-card"><div class="living-card-heading"><h4>${e(r.name)}</h4><span class="living-kind">${e(groupLabel(r.datasetId,r.category))}</span></div><p class="living-card-address">${e(r.address)}</p><span class="living-location-state">주소 안내 · 지도 위치 확인 중</span>${phoneHtml(r.phone)}<details class="living-card-details"><summary>이용 안내·출처</summary>${r.operationalStatus?`<p>${e(r.operationalStatus)}</p>`:'<p>방문 전 이용대상과 운영시간을 기관에 확인해 주세요.</p>'}${evidenceHtml({...r,verifiedAt:r.verifiedAt||directory?.verifiedAt})}</details></article>`).join('')}</div>${rows.length>limit?`<button class="dt-add-site" data-action="decision-living-more" aria-label="주소로 확인하는 시설 10곳 더 보기">주소 목록 10곳 더 보기 (${num(Math.min(limit,rows.length))} / ${num(rows.length)})</button>`:''}</section>`;
}

/** The walking service revalidates this exact source identity; no coordinates cross this action. */
export function livingRouteDestination({descriptor={},feature={}}={},regionId=''){
 const p=feature.properties||{},datasetId=descriptor.id||p.datasetId,sourceId=p.livingSourceId;
 const supported=['childcare','police',...LIVING_CARE_GROUPS.flatMap(group=>group.datasets).filter(id=>id.startsWith('care-'))];
 if(!/^[a-z0-9-]+$/.test(regionId)||!supported.includes(datasetId)||typeof sourceId!=='string'||!sourceId||sourceId.length>240||p.routeEligible===false||p.locationStatus==='unverified'||feature.geometry?.type!=='Point'||!point(feature.geometry.coordinates))return null;
 return {regionId,datasetId,sourceId};
}

export function livingFacilityCard({descriptor:d,feature:f},{selectedId='',regionId='',topic='care',hasPreset=false}={}){
 const p=f.properties||{},destination=livingRouteDestination({descriptor:d,feature:f},regionId);
 return `<article class="dt-row living-card${selectedId===p.id?' is-focused':''}" data-living-card="${e(p.id)}">
 <div class="living-card-heading"><h4>${e(p.name)}</h4><span class="living-kind">${e(groupLabel(d.id,d.title))}</span></div>
 <p class="living-card-address">${e(p.address||p.roadAddress||p.lotAddress||'주소 미제공 · 지도에서 위치 확인')}</p>${p.livingDongName?`<span class="living-dong">${e(p.livingDongName)}</span>`:''}
 <div class="living-card-actions"><button data-action="decision-living-focus" data-id="${e(p.id)}" aria-label="${e(p.name)} 지도 보기">지도 보기</button>${destination?`<button class="living-route-button" data-action="walk-routes" data-mode="basic" data-destination-region="${e(destination.regionId)}" data-destination-dataset="${e(destination.datasetId)}" data-destination-source-id="${e(destination.sourceId)}" aria-label="${e(p.name)} 여기로 길찾기">여기로 길찾기</button>`:''}</div>
 <details class="living-card-details"><summary>이용 안내·출처</summary>
 ${p.facilityType||p.registeredStatus?`<p>${e([p.facilityType,p.registeredStatus&&`원문 상태 ${p.registeredStatus}`].filter(Boolean).join(' · '))}</p>`:''}
 ${Number.isFinite(p.capacity)||Number.isFinite(p.enrolled)?`<p>공시 정원 ${Number.isFinite(p.capacity)?num(p.capacity)+'명':'미제공'} · 현원 ${Number.isFinite(p.enrolled)?num(p.enrolled)+'명':'미제공'}</p><p>입소 가능 인원이 아니에요. 실제 모집은 기관에 확인해 주세요.</p>`:''}
 ${phoneHtml(p.phone)}<p>${e(p.geometryMeaning||'공개자료의 대표 위치예요. 실제 출입구는 방문 전 확인해 주세요.')}</p>${p.operationalStatus?`<p>${e(p.operationalStatus)}</p>`:'<p>이용대상·운영시간은 기관에 확인해 주세요.</p>'}${evidenceHtml(p,d)}
 ${hasPreset?`<button class="living-review-button" data-action="decision-living-review" data-id="${e(p.id)}">담당자용 · 이 시설 주변 검토</button>`:''}</details></article>`;
}

export function livingGuideHtml({topic='care',topics={},data=[],rows=[],directory=null,reference=null,safeReturnGeometry=null,selectedSafeReturnId='all',query='',datasetId='all',scopeId='all',scopeName='',regionId='',regionName='서구',dongs=[],limit=10,selectedId='',busy=false,error='',hasPreset=false}={}){
 const care=topic==='care',addressRows=care?careDirectoryRows(directory,{query,datasetId}):[],selected=rows.find(row=>row.feature.properties.id===selectedId),shown=(selected?[selected,...rows.filter(row=>row!==selected)]:rows).slice(0,limit),missing=data.filter(d=>d.error),hasFilter=!!query||datasetId!=='all';
 const mappedExtra=items(directory?.entries).filter(r=>point(r.coordinates)).length,addressExtra=careDirectoryRows(directory).length;
 const hasCategoryData=data.some(d=>!d.error&&livingDatasetMatches(d.id,datasetId));
 const category=LIVING_CARE_GROUPS.find(group=>`group:${group.id}`===datasetId)?.label||data.find(d=>d.id===datasetId)?.title||'전체 종류';
 return `<div class="decision-twin living-map" data-living-topic="${e(topic)}" aria-busy="${busy}">
 <nav class="living-topic-tabs" aria-label="생활정보 분야">${Object.entries(topics).sort(([a],[b])=>Number(b==='safety')-Number(a==='safety')).map(([id,c])=>`<button data-action="decision-living-topic" data-topic="${e(id)}" aria-pressed="${topic===id}">${e(c.label)}</button>`).join('')}</nav>
 ${care?(regionId==='seogu'?'<button class="living-safe-return-shortcut" data-action="decision-living-topic" data-topic="safety">여성안심 귀갓길·귀가 길찾기 ↗</button>':''):safeReturnGuide(reference,safeReturnGeometry,{selectedId:selectedSafeReturnId,busy})}
 <section class="living-welcome"><span class="living-eyebrow">${e(scopeName||regionName+' 전체')}</span><h3>${care?'어떤 시설을 찾으세요?':'우리 동네 안심시설 찾기'}</h3><p>${care?'시설을 고르고, 지도와 길찾기로 이어가세요.':'비상벨·보안등·경찰관서의 공개 위치를 살펴보세요.'}</p></section>
 ${care?`<div class="living-category-grid" role="group" aria-label="찾을 시설 종류"><button data-action="decision-living-kind" data-dataset="all" aria-pressed="${datasetId==='all'}">전체</button>${LIVING_CARE_GROUPS.map(group=>`<button data-action="decision-living-kind" data-dataset="group:${group.id}" aria-pressed="${datasetId===`group:${group.id}`}">${e(group.label)}</button>`).join('')}</div>`:''}
 <form id="living-search" class="living-search"><label for="living-query">이름이나 동네로 찾기</label><div><input id="living-query" name="query" value="${e(query)}" maxlength="100" placeholder="예: 풍암동, 장난감도서관" autocomplete="off" aria-describedby="living-search-hint"><button type="submit">찾기</button></div><small id="living-search-hint">시설 이름·동 이름·도로명을 입력해 주세요.</small></form>
 <details class="living-refine"${scopeId!=='all'||datasetId!=='all'&&!datasetId.startsWith('group:')?' open':''}><summary>동네·세부 종류 고르기${scopeId!=='all'?` · ${e(scopeName)}`:''}</summary><div class="living-filters"><label for="living-scope">동네<select id="living-scope"><option value="all"${scopeId==='all'?' selected':''}>${e(regionName)} 전체</option>${items(dongs).map(f=>`<option value="${e(f.properties.dongId)}"${scopeId===f.properties.dongId?' selected':''}>${e(f.properties.dongName)}</option>`).join('')}</select></label><label for="living-dataset">세부 종류<select id="living-dataset"><option value="all"${datasetId==='all'?' selected':''}>전체 종류</option>${care?LIVING_CARE_GROUPS.map(group=>`<option value="group:${group.id}"${datasetId===`group:${group.id}`?' selected':''}>${e(group.label)} 전체</option>`).join(''):''}${data.map(d=>`<option value="${e(d.id)}"${datasetId===d.id?' selected':''}>${e(d.title)}${d.error?' · 자료 확인 필요':''}</option>`).join('')}</select></label></div><p class="dt-help">동네 선택은 실제 행정동 경계 안의 지도시설에 적용돼요. 주소 목록은 ${e(regionName)} 전체에서 검색해요.</p></details>
 ${busy?'<p class="dt-status" role="status">시설 목록을 가져오고 있어요.</p>':''}${error?`<div class="dt-error" role="alert"><p>${e(error)}</p><button data-action="decision-living-retry">다시 불러오기</button></div>`:''}
 <section class="living-results-summary" aria-live="polite" aria-atomic="true"><p>${e(category)}${query?` · “${e(query)}”`:''}</p><h3>${busy?'시설 목록을 준비하고 있어요':!hasCategoryData?'지도 위치 자료를 아직 확인하지 못했어요':`지도에서 볼 수 있는 시설 <strong>${num(rows.length)}곳</strong>`}</h3>${addressRows.length?`<a href="#living-address-results">주소로 확인하는 시설 ${num(addressRows.length)}곳도 있어요${scopeId==='all'?'':` · ${e(regionName)} 전체`} ↓</a>`:''}<div class="living-filter-actions">${hasFilter?'<button data-action="decision-living-reset">검색 조건 지우기</button>':''}${scopeId!=='all'?`<button data-action="decision-living-all">${e(regionName)} 전체 보기</button>`:''}</div></section>
 <p class="living-coverage-note">${care?`방문 전 이용대상과 운영시간을 확인해 주세요.${directory?` 어린이집 외 추가시설은 지도 ${num(mappedExtra)}곳·주소 ${num(addressExtra)}곳을 담았어요.`:''}`:'시설 위치가 현재 안전도나 안전한 경로를 뜻하지는 않아요.'}</p>
 ${!busy&&!data.length?'<p class="dt-empty">이 지역의 자료는 아직 연결되지 않았어요. 시설이 없다는 뜻은 아니에요.</p>':''}
 <section class="dt-section living-map-results" aria-labelledby="living-map-heading"><div class="dt-section-heading"><h3 id="living-map-heading">${care?'시설 목록':'안심시설 목록'}</h3><span class="living-order-note">${busy?'가져오는 중':hasCategoryData?`이름순 · ${num(Math.min(limit,rows.length))} / ${num(rows.length)}`:'자료 확인 필요'}</span></div><div class="dt-result-list">
 ${shown.map(row=>livingFacilityCard(row,{selectedId,regionId,topic,hasPreset})).join('')||(!busy?`<div class="living-empty"><h4>${addressRows.length?'주소 목록에서 먼저 확인해 주세요':'조건에 맞는 수록 시설을 찾지 못했어요'}</h4><p>${addressRows.length?'아래 시설은 주소는 있지만 지도 위치가 아직 확인되지 않았어요.':'시설이 없다는 뜻은 아니에요. 이름을 짧게 입력하거나 다른 종류를 골라 보세요.'}</p><div>${hasFilter?'<button data-action="decision-living-reset">검색 조건 지우기</button>':''}${scopeId!=='all'?`<button data-action="decision-living-all">${e(regionName)} 전체에서 찾기</button>`:'<button data-action="decision-living-retry">목록 다시 불러오기</button>'}</div></div>`:'')}
 </div>${rows.length>shown.length?`<button class="dt-add-site" data-action="decision-living-more" aria-label="지도시설 10곳 더 보기">시설 10곳 더 보기 (${num(shown.length)} / ${num(rows.length)})</button>`:''}</section>
 ${care?careDirectoryHtml(directory,{query,datasetId,scopeIsAll:scopeId==='all',limit,regionName}):''}
 <details class="dt-sources living-source-details"><summary>자료 출처·수록 범위 확인</summary><p>공식 공개자료에서 확인한 시설이에요. 모든 시설을 빠짐없이 담은 목록은 아니며, 현재 운영 여부는 기관에 확인해 주세요. 지도 위치는 건물 대표점일 수 있어요.</p>${directory&&care?`<p>어린이집 외 추가자료 ${num(mappedExtra+addressExtra)}곳: 지도 ${num(mappedExtra)}곳·주소 ${num(addressExtra)}곳. 주소 위치를 임의로 추정하지 않아요.</p>`:''}${missing.length?`<p>자료 확인이 필요한 종류 ${num(missing.length)}종</p><ul>${missing.map(d=>`<li>${e(d.title)} · ${e(d.error)}</li>`).join('')}</ul><p>연결되지 않은 자료는 시설 0곳을 뜻하지 않아요.</p>`:''}<ul>${data.map(d=>`<li><strong>${e(d.title)}</strong>${evidenceHtml({},d)}<p>${e(d.meta?.coverage||d.coverage||'공개 자료 중 위치를 검증한 기록입니다. 누락은 시설 부재를 뜻하지 않습니다.')}</p></li>`).join('')}</ul><button data-action="decision-living-csv"${rows.length?'':' disabled'}>현재 지도 목록 CSV 저장</button><p class="dt-help">가정폭력·성폭력 피해자 보호시설 등 비공개 시설 위치는 수록하지 않습니다.</p></details>
 <details class="living-next"><summary>담당자용 · 점검·보완안 검토</summary><p>${care?'시설 주변의 활동공간과 프로그램 연계 후보지를 비교하세요.':'공개 안전시설을 함께 보며 점검할 위치와 추가 설치안을 비교하세요.'}</p><div class="living-next-actions">${hasPreset?`<button data-action="decision-living-compare" data-workflow="coverage">${care?'주변 활동공간 연계안':'비상벨 추가안'} 비교</button><button data-action="decision-living-compare" data-workflow="inspection">현장 점검 후보 보기</button><button data-action="decision-living-compare" data-workflow="site">사업 후보지 A·B 비교</button>`:'<span class="dt-help">이 지역의 비교용 자료 연결 후 검토할 수 있어요.</span>'}<button data-action="decision-api-guide">생활정보 API 연결 안내 ↗</button></div></details>${care?'':safeReturnSources(reference,safeReturnGeometry)}</div>`;
}

