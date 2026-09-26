import { loadBoundary as fetchAdminBoundary, assignDongs, geometryIntersects } from './admin.js';
import { SourceStore } from './source-store.js';
import { adminSelector, sourceCards, sourceSummary, dongTable, diagnosticsCard } from './admin-ui.js';
import { importFacilitiesCSV, importDongStats, importProjects } from './importers.js';
import { APP, CATEGORIES, WORKSPACES, CAMERAS, MONTHS, DATA_KINDS } from './config.js';
import { icon } from './icons.js';
import { filterFacilities, summarize, escapeHTML, safeCsvCell, metricAt, monthOverlaps, distanceMeters } from './geo.js';
import { makeDemoData, validateImport, loadPublishedData } from './data.js';
import { CityMap } from './map.js';
import { baseLayout, renderInsights, renderLayers, renderTimeline, metricCompatibility, fmt } from './ui.js';

const root = document.getElementById('app');
root.innerHTML = baseLayout();
const offlineDesign = document.documentElement.dataset.offlinePreview === 'true' || new URLSearchParams(location.search).get('preview') === '1';
let savedTheme = 'dark';
try { savedTheme = localStorage.getItem('seoon:theme') === 'light' ? 'light' : 'dark'; } catch { /* Storage may be disabled. */ }
const state = {
  workspace: 'overview', dataset: offlineDesign ? 'demo' : 'published', engine: offlineDesign ? 'preview' : 'maplibre', theme: savedTheme,
  categories: Object.keys(CATEGORIES), month: offlineDesign ? '2026-07' : new Date(Date.now()+9*3600000).toISOString().slice(0,7), search: '',
  radiusCenter: null, radiusMeters: 500, selectedId: null, pickMode: null,
  scenario: null, is3D: true, touring: false, playing: false,
  layers: { buildings: true, columns: false, facilities: true, projects: false, boundaries: true },
  dongId:null, realDistrictOnly:true, inspectBuildings:false,
};
const demoData = makeDemoData();
const sourceStore=new SourceStore();
let adminBoundary=null, boundaryError='', dongStats=[], diagnostics=null, sourcesInitialized=false, importKind='facilities', engineChosen=false, importSequence=0, pendingRecords=[];
let actualFacilities = [], actualProjects = [], config = null, months = [...MONTHS], sourceName = '',
  filtered = [], activeProjects = [], viewSnapshots = [], loadToken = 0, sourceMessages = [], previousActualMode = 'published';
let playTimer, tourTimer, toastTimer, lastMapStatus = { kind: 'loading', message: '지도 연결 준비 중' };
const map = new CityMap(document.getElementById('map-stage'), {
  select(feature) {
    if (state.pickMode) { mapClicked(feature.geometry.coordinates); return; }
    state.selectedId = feature.properties.id; render();
  }, click: mapClicked, status: mapStatus, dong:selectDong,
  building(info){showDialog(`${icon('cube')} 건물 렌더링 높이`, `<p class="dialog-lead">${escapeHTML(info.source)}</p><h3>${info.renderHeight==null?'원자료 높이 미제공':fmt(info.renderHeight,1)+'m · 타일 렌더링 값'}</h3><p>기단 높이 ${fmt(info.minHeight,1)}m</p><p class="notice">${escapeHTML(info.note)}</p>`);},
  diagnostics(info){diagnostics=info;const el=document.getElementById('diagnostics-content');if(el)el.innerHTML=diagnosticsCard(diagnostics,state);},
});
function activeFeatures() { return state.dataset === 'demo' ? demoData.facilities.features : actualFacilities; }
function currentProjectSource() { return state.dataset === 'demo' ? demoData.projects.features : actualProjects; }
function render() {
  const source = activeFeatures();
  filtered = filterFacilities(source, {...state,realDistrictOnly:state.dataset!=='demo'});
  if (state.selectedId && !filtered.some(f => f.properties.id === state.selectedId)) state.selectedId = null;
  activeProjects = currentProjectSource().filter(f => monthOverlaps(f.properties.start, f.properties.end, state.month) && (state.dataset==='demo'||!!adminBoundary?.features.some(d=>geometryIntersects(f.geometry,d.geometry))) && (!state.dongId||geometryIntersects(f.geometry,adminBoundary.features.find(d=>d.properties.dongId===state.dongId)?.geometry)));
  document.documentElement.dataset.theme = state.theme;
  document.getElementById('insights').innerHTML = adminSelector(adminBoundary,state,source)+(boundaryError?`<p class="quality-note">${escapeHTML(boundaryError)}</p>`:'')+renderInsights(filtered, source.filter(f=>state.dataset==='demo'||f.properties.inDistrict).length, activeProjects, state, months, sourceName);
  document.getElementById('layers-panel').innerHTML = renderLayers(source.filter(f=>state.dataset==='demo'||f.properties.inDistrict), state, config)+(state.dataset==='demo'?'':sourceSummary(sourceStore.list()))+`<div id="diagnostics-content">${diagnosticsCard(diagnostics,state)}</div>`;
  const sc=document.getElementById('source-cards-container');if(sc)sc.innerHTML=sourceCards(sourceStore.list());
  const mobileLayers = document.getElementById('mobile-layer-settings');
  if (mobileLayers) mobileLayers.innerHTML = renderLayers(source, state, config)+sourceSummary(sourceStore.list())+diagnosticsCard(diagnostics,state);
  document.getElementById('timeline').innerHTML = renderTimeline(filtered, state, months);
  document.querySelectorAll('[data-workspace]').forEach(button => { button.classList.toggle('active', button.dataset.workspace === state.workspace); button.setAttribute('aria-pressed', String(button.dataset.workspace === state.workspace)); });
  document.getElementById('dimension-button').textContent = state.is3D ? '3D' : '2D';
  document.getElementById('dimension-button').classList.toggle('active', state.is3D);
  document.querySelector('[data-act="theme"]').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
  const comp = metricCompatibility(filtered);
  map.update(filtered, activeProjects, { ...state, layers: { ...state.layers, columns: state.layers.columns && comp.compatible } });
  const limit = state.engine === 'vworld' ? 500 : 1000;
  const capNote = (filtered.length > limit ? ` · 시설 표시 ${limit}개 제한 / 표 ${filtered.length}개` : '') + (filtered.length > 500 && state.layers.columns ? ' · 통계기둥 최대 500개 표시' : '');
  document.getElementById('map-disclosure').innerHTML = `${icon('info')}<span>${state.engine === 'preview' ? '<b>가상 도시 · 실제 지도 아님</b>' : state.engine === 'vworld' ? '브이월드 3D · 지형/건물 기준일 별도 확인' : 'OpenStreetMap · 건물 누락·추정 높이 포함 가능'}<small>${state.dataset === 'demo' ? '시설 위치·수치·사업은 모두 합성 시연자료' : '등록자료는 제공·입력 범위만 표시 · 별도 검수 필요'}${capNote} · 행정동: SGIS 가공 / vuski · CC BY 4.0</small></span>`;
  document.querySelector('.workspace').classList.toggle('picking', !!state.pickMode);
  if (state.pickMode) toast(state.pickMode === 'radius' ? '지도에서 반경 조회의 기준점을 선택하세요.' : '지도에서 가상 시설을 놓을 위치를 선택하세요.', 6000);
}
function mapStatus(kind, message) {
  lastMapStatus = { kind, message };
  const status = document.getElementById('map-status');
  status.className = `map-status ${kind}`; status.innerHTML = `<span class="status-dot"></span>${escapeHTML(message)}`;
  const err = document.getElementById('map-error');
  err.hidden = kind !== 'error';
  if (kind === 'error') err.innerHTML = `<span class="error-map-icon">${icon('layers')}</span><h2>지도 연결을 확인해주세요</h2><p>${escapeHTML(message)}</p><p>실제 지도를 가상 지도와 자동으로 바꾸지 않습니다.<br>디자인만 확인하려면 미리보기를 선택하세요.</p><div><button class="btn primary" data-act="retry-map">다시 연결</button><button class="btn secondary" data-engine="preview">디자인 미리보기</button></div>`;
}
function toast(message, timeout = 3000) { const el = document.getElementById('toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, timeout); }
function showDialog(title, html) {
  document.getElementById('dialog-title').innerHTML = title;
  document.getElementById('dialog-body').innerHTML = html;
  const dialog = document.getElementById('dialog'); if (!dialog.open) dialog.showModal();
}
function closeDialog() { document.getElementById('dialog').close(); }
function mapClicked(coordinates) {
  if (state.pickMode === 'radius') { state.radiusCenter = coordinates; state.workspace = 'access'; state.pickMode = null; state.selectedId = null; render(); toast(`${state.radiusMeters}m 직선거리 반경으로 조회했습니다.`); }
  else if (state.pickMode === 'scenario') {
    state.scenario = coordinates; state.pickMode = null; render();
    const nearby = activeFeatures().filter(f => distanceMeters(coordinates, f.geometry.coordinates) <= state.radiusMeters).length;
    toast(`가상 시설 배치 · 주변 ${state.radiusMeters}m 내 등록자료 ${nearby}개. 수요 예측이 아닙니다.`, 6000);
  }
}
function stopTimers() { clearInterval(playTimer); clearInterval(tourTimer); state.playing = false; state.touring = false; }
function syncMonths() {
  const projectMonths=[]; if(state.dataset!=='demo')for(const f of actualProjects){let m=f.properties.start?.slice(0,7),end=f.properties.end?.slice(0,7);for(let n=0;m&&m<=end&&n<120;n++){projectMonths.push(m);const [y,mo]=m.split('-').map(Number);m=mo===12?`${y+1}-01`:`${y}-${String(mo+1).padStart(2,'0')}`;}}
  const all = [...new Set([...activeFeatures().flatMap(f => Object.keys(f.properties.monthly || {})),...projectMonths,...(state.dataset==='demo'?[]:dongStats.map(r=>r.month))])].sort();
  months = all.length ? all.slice(-24) : state.dataset==='demo'?[...MONTHS]:[new Date(Date.now()+9*3600000).toISOString().slice(0,7)];
  if (!months.includes(state.month)) state.month = months[months.length - 1];
}
function resetFilters() { state.search = ''; state.radiusCenter = null; state.selectedId = null; state.categories = Object.keys(CATEGORIES); state.pickMode = null; }
async function switchEngine(engine) {
  if (engine === 'vworld' && !config?.vworld3d) { openDataCenter(); toast('Vercel 환경변수에 VWORLD_BROWSER_KEY와 VWORLD_DOMAIN을 먼저 등록하세요.', 5000); return; }
  engineChosen=true;diagnostics=null;stopTimers(); state.engine = engine; state.is3D = true; render();
  await map.start(engine, state.theme); map.set3D(state.is3D);
}
function saveDownload(name, content, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function currentSnapshot() {
  const comp = metricCompatibility(filtered), stats = summarize(filtered, state.month);
  return { version: APP.version, savedAt: new Date().toISOString(), workspace: WORKSPACES[state.workspace].name,
    dataset: state.dataset, demo: state.dataset === 'demo', preview: state.engine === 'preview', month: state.month,
    categories: [...state.categories], query: state.search, radiusMeters: state.radiusCenter ? state.radiusMeters : null,
    radiusCenter: state.radiusCenter, count: stats.count, measured: stats.measured, missing: stats.missing,
    total: comp.compatible ? stats.total : null, metricName: comp.name, metricUnit: comp.unit,
    scenario: state.scenario, source: [...new Set(filtered.map(f => `${f.properties.sourceName} (${f.properties.sourceDate||'기준일 미제공'})`))],
    dongName:adminBoundary?.features.find(f=>f.properties.dongId===state.dongId)?.properties.dongName||'서구 전체',
    boundary:adminBoundary?.metadata||null,sourceStates:sourceStore.list().filter(s=>s.enabled).map(s=>({id:s.id,state:s.state,lastSuccessAt:s.lastSuccessAt,coverage:s.coverage,error:s.error})),
    includedIds: filtered.map(f => f.properties.id), notes: sourceMessages,
  };
}
function openCompare() {
  const snapshot = currentSnapshot(); viewSnapshots = [...viewSnapshots, snapshot].slice(-2);
  const cards = viewSnapshots.map((s, i) => `<section class="snapshot-card"><span class="section-index">VIEW ${i === 0 ? 'A' : 'B'}</span><h3>${escapeHTML(s.workspace)}</h3><p>${escapeHTML(s.dongName||'서구 전체')} · ${s.month} · ${s.demo ? '합성 시연' : '등록 자료'}</p><div class="big-value">${fmt(s.count)}<small>개</small></div><p>${s.radiusMeters ? s.radiusMeters + 'm 직선거리' : '반경 조건 없음'}</p><p>${escapeHTML(s.categories.map(c => CATEGORIES[c].name).join(' · '))}</p><small>${escapeHTML(s.query || '검색조건 없음')}</small></section>`).join('');
  showDialog(`${icon('compare')} 조회조건 비교`, `<p class="dialog-lead">현재 조건을 ${viewSnapshots.length === 1 ? 'A로' : 'B로'} 저장했습니다. 기간·지역·대상 조건이 다르면 단순 증감으로 해석하지 마세요.</p><div class="snapshot-grid">${cards}${viewSnapshots.length === 1 ? '<section class="snapshot-card empty"><strong>B 조건을 추가하세요</strong><p>창을 닫고 기간·반경·시설 종류를 바꾼 뒤<br>‘조건 비교’를 다시 누르세요.</p></section>' : ''}</div><p class="notice">비교 결과는 시설 부족·사업 우선순위·정책 효과를 자동 판정하지 않습니다. 이 비교는 현재 브라우저 메모리에만 있습니다.</p><div class="dialog-actions"><button class="btn secondary" data-act="clear-comparison">비교 지우기</button><button class="btn primary" data-act="save-comparison">조건 JSON 내보내기</button></div>`);
}
function openFacilityList() {
  showDialog(`${icon('data')} 조회시설 ${fmt(filtered.length)}개`, `<p class="dialog-lead">${state.month} · ${state.dataset === 'demo' ? '모든 위치·수치는 합성 시연입니다.' : '자료 최신성·위치 정확도를 별도로 검수하세요.'}</p><div class="data-table-wrap"><table class="data-table"><thead><tr><th>시설명</th><th>종류</th><th>값</th><th>출처·기준일</th></tr></thead><tbody>${filtered.slice(0, 300).map(f => `<tr><td><button class="text-button" data-feature="${escapeHTML(f.properties.id)}">${escapeHTML(f.properties.name)}</button></td><td>${CATEGORIES[f.properties.category].name}</td><td>${fmt(metricAt(f, state.month))} ${escapeHTML(f.properties.metricUnit)}</td><td>${escapeHTML(f.properties.sourceName)}<small>${escapeHTML(f.properties.sourceDate)}</small></td></tr>`).join('')}</tbody></table></div><p class="micro">화면 표는 최대 300개입니다. ‘조회자료 내보내기’에는 현재 조회한 전체 자료가 포함됩니다.</p><div class="dialog-actions"><button class="btn primary" data-act="csv">${icon('download')} 조회자료 내보내기</button></div>`);
}
function openDataCenter() {
  showDialog(`${icon('data')} 데이터 연결 센터`, `
  <p class="dialog-lead">지도 배경, 행정동 경계, 행정자료는 각각 별도 연결입니다. <strong>설정됨 ≠ 인증 성공 ≠ 자료 검수 완료</strong></p>
  <div class="connector-grid">
    <div class="connector"><h3>18개 행정동 경계</h3><p>${adminBoundary?'18개 도형·명칭 검증 후 연결':'연결 대기·오류'}. 키 없이 포함된 SGIS 가공 GeoJSON을 읽습니다. 법정동·지적경계가 아닙니다.</p><button class="btn secondary" data-act="load-boundary">행정동 다시 읽기</button></div>
    <div class="connector"><h3>브이월드 원본 3D</h3><p>${config?.vworld3d?'현재 배포에 환경변수 있음':'현재 배포에서 필수 환경변수가 확인되지 않습니다.'}</p><code>VWORLD_BROWSER_KEY<br>VWORLD_DOMAIN</code><p>3D SDK 실행 키는 브라우저에 전달됩니다. 등록 도메인과 배포 도메인을 일치시키세요.</p><button class="btn secondary" data-engine="vworld">원본 3D 연결 시험</button></div>
    <div class="connector"><h3>브이월드 서버 검색</h3><code>VWORLD_API_KEY<br>VWORLD_DOMAIN</code><p>${config?.vworldRest?'환경변수 있음':'환경변수 미확인'}. Vercel 서버가 검색 API를 호출할 때 쓰는 키입니다. 별도의 PC 서버가 필요하다는 뜻이 아닙니다. 현재 18개 동 표시에는 이 키가 없어도 됩니다.</p></div>
    <div class="connector"><h3>공공데이터 · 기상</h3><code>DATA_GO_KR_SERVICE_KEY<br>KMA_SERVICE_KEY (선택)</code><p>자료마다 활용신청이 필요합니다. 키 하나만 등록해서 모든 데이터가 승인되지는 않습니다.</p><button class="btn secondary" data-act="weather">선택 동 격자 실황 조회</button></div>
  </div>
  <h3>자료별 연결·갱신</h3><div id="source-cards-container">${sourceCards(sourceStore.list())}</div>
  <section class="upload-section"><h3>공개 가능한 부서 자료 가져오기</h3><p>파일은 브라우저에서 처리합니다. 업로드·AI 전송 없이 현재 화면에만 반영되며 새로고침하면 사용자 파일은 사라집니다. 비공개 민원·취약가구·시설 취약정보는 넣지 마세요.</p><div class="dialog-actions"><button class="btn primary" data-act="import">시설 CSV / GeoJSON</button><button class="btn secondary" data-act="import-projects">사업 GeoJSON</button><button class="btn secondary" data-act="import-stats">동별 통계 CSV</button><button class="btn secondary" data-act="pending">주소만 확보된 안전·복지 자료</button></div><div class="dialog-actions"><a class="text-button" href="/data/facilities-template.csv" download>시설 CSV 양식</a><a class="text-button" href="/data/dong-stats-template.csv" download>동별 통계 양식</a><a class="text-button" href="/data/projects-template.geojson" download>사업 도형 양식</a></div></section>
  <h3>최근 처리 기록</h3>${sourceMessages.slice(-10).map(t=>`<p class="micro">${escapeHTML(t)}</p>`).join('')}<p class="micro">지도 상태: ${escapeHTML(lastMapStatus.message)}</p>
  <p class="notice">갱신 실패·부분수집 시 기존 정상 자료를 유지합니다. 브라우저 캐시는 이 기기 전용이며 전 사용자 공동 DB가 아닙니다. 시연자료는 실제 자료와 섞지 않습니다. 0개 조회는 해당 시설의 부재를 뜻하지 않습니다.</p>`);
}

function openHelp() {
  showDialog(`${icon('book')} 서구온 사용 안내`, `
    <p class="dialog-lead">공간을 보는 화면과 근거를 읽는 패널이 연결되는 웹 시제품입니다.</p>
    <div class="help-steps"><div><b>01</b><h3>지도 확인</h3><p>기본 웹지도는 실제 OSM 지리정보를 사용합니다. 디자인 미리보기는 외형만 확인하는 가상 도시입니다.</p></div><div><b>02</b><h3>업무 선택</h3><p>생활권 살피기에서 반경을 지정하고, 운영 추이에서는 월별 값을 확인하세요.</p></div><div><b>03</b><h3>조건 비교</h3><p>첫 화면 조건을 A로 저장한 뒤 조건을 바꾸고 다시 비교하면 B가 추가됩니다.</p></div><div><b>04</b><h3>근거 남기기</h3><p>검토표·CSV·조건 JSON을 내보낼 수 있습니다. 자료 성격과 기준일도 함께 기록합니다.</p></div></div>
    <h3>이 버전이 하는 일</h3><p>지도 조회, 시설 필터, 직선거리 반경, 월별 값의 표시, 같은 시설의 전월 대비 증감, 대표점 간 근접 사업의 일정 중첩 조회입니다.</p>
    <h3>이 버전이 하지 않는 일</h3><p>보행시간 분석, 시설 부족 판정, 실제 침수·교통·일조 예측, 민원시스템 연계, 공사 영향 추정, AI 모델 학습은 포함하지 않습니다. ‘근거 브리핑’은 검증 가능한 규칙 기반 설명이며 LLM 호출이 아닙니다.</p>
    <p class="notice">기본 배경의 건물은 측량 모델이 아닙니다. OSM 누락과 높이 추정이 있을 수 있습니다. 브이월드 연결 후에도 서구 제공범위·기준일·정확도를 확인해야 합니다.</p>
    <div class="dialog-actions"><button class="btn primary" data-act="data">자료 연결하기</button><button class="btn secondary" data-act="tour">카메라 투어</button></div>`);
}
function exportCsv() {
  const headers = ['행정동','id', '시설명', '분류', '경도', '위도', '조회월', '지표', '값', '단위', '자료성격', '출처', '기준일'];
  const rows = filtered.map(f => [f.properties.dongName||'경계 겹침·미배정',f.properties.id, f.properties.name, CATEGORIES[f.properties.category].name, ...f.geometry.coordinates, state.month, f.properties.metricName, metricAt(f, state.month) ?? '', f.properties.metricUnit, DATA_KINDS[f.properties.dataKind], f.properties.sourceName, f.properties.sourceDate]);
  saveDownload(`서구온_${state.dataset === 'demo' ? '시연_' : ''}${state.month}_조회자료.csv`, '\uFEFF' + [headers, ...rows].map(r => r.map(safeCsvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportReport() {
  const s = currentSnapshot(), image = map.screenshot(), disclaimer = s.demo ? '합성 시연자료 — 실제 서구 시설·실적·사업이 아닙니다. 행정판단에 사용하지 마세요.' : '입력·수집 자료 — 위치·최신성·완전성 검수 전 참고용입니다.';
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>서구온 검토표 ${escapeHTML(s.month)}</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#19313b;max-width:1000px;margin:40px auto;padding:0 28px}header{border-bottom:3px solid #157762;padding-bottom:20px}h1{font-size:28px}small{color:#586c73}.notice{background:#fff3da;padding:14px;border:1px solid #e8c884}img{width:100%;max-height:480px;object-fit:cover}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #d9e2e4}h2{margin-top:28px}button{padding:10px 20px}footer{margin-top:30px;border-top:1px solid #d9e2e4;padding-top:16px}@media print{button{display:none}body{margin:0;font-size:12px}.notice{-webkit-print-color-adjust:exact}h2{break-after:avoid}tr{break-inside:avoid}}</style><header><small>FUNONWORK LAB / SEO:ON v${APP.version}</small><h1>서구 공간행정 검토표</h1><p>${escapeHTML(s.workspace)} · ${escapeHTML(s.month)}</p></header><p class="notice">${escapeHTML(disclaimer)}</p>${image ? `<img src="${image}" alt="조회 화면 지도"><p><small>${s.preview ? '가상 도시 디자인 미리보기 — 실제 지도 아님' : 'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors / ODbL. 건물 높이는 추정 포함.'}</small></p>` : '<p>이 지도 엔진에서는 캡처가 포함되지 않습니다. 현재 화면을 별도로 기록하세요.</p>'}<h2>1. 조회 조건</h2><table><tr><th>행정동</th><td>${escapeHTML(s.dongName)}</td></tr><tr><th>업무</th><td>${escapeHTML(s.workspace)}</td></tr><tr><th>분류</th><td>${escapeHTML(s.categories.map(k => CATEGORIES[k].name).join(', '))}</td></tr><tr><th>검색</th><td>${escapeHTML(s.query || '전체')}</td></tr><tr><th>반경</th><td>${s.radiusMeters ? `${s.radiusMeters}m · 직선거리 / 기준좌표 ${s.radiusCenter.map(c => c.toFixed(6)).join(', ')}` : '반경 조건 없음'}</td></tr></table><h2>2. 확인된 값</h2><table><tr><th>조회 시설</th><td>${fmt(s.count)}개</td></tr><tr><th>${escapeHTML(s.metricName)} 합계</th><td>${fmt(s.total)} ${escapeHTML(s.metricUnit)} (단위 혼합·결측만 있으면 —)</td></tr><tr><th>결측</th><td>${fmt(s.missing)}개 / 값 있는 시설 ${fmt(s.measured)}개</td></tr></table><h2>3. 출처와 한계</h2><p>행정동 경계: SGIS / vuski(admdongkor), 2026.07.01, CC BY 4.0·공공누리 제1유형. 가공 참고경계이며 지적경계가 아닙니다.</p>${s.sourceStates.map(v=>`<p>${escapeHTML(v.id)} · ${escapeHTML(v.state)} · ${escapeHTML(v.lastSuccessAt||'반영시각 없음')} · ${escapeHTML(v.error||v.coverage||'')}</p>`).join('')}${s.source.map(t => `<p>${escapeHTML(t)}</p>`).join('') || '<p>조회된 출처 없음</p>'}<p>행정구역 전체 시설 현황이 아닐 수 있습니다. 직선거리와 보행 접근성은 다르며, 표시 건수만으로 시설 부족·수요·사업효과를 판단하지 않습니다. 통계기둥은 건물 높이가 아닙니다.</p>${s.notes.map(t => `<p>${escapeHTML(t)}</p>`).join('')}<h2>4. 담당자 검토의견</h2><p>__________________________________________________________________</p><p>__________________________________________________________________</p><footer><small>생성 ${escapeHTML(s.savedAt)} / 펀온워크 공개 시험서비스 / 최종 판단은 담당자 수행<br>OSM: https://www.openstreetmap.org/copyright · OpenFreeMap: https://openfreemap.org</small></footer></html>`;
  saveDownload(`서구온_${s.demo ? '시연_' : ''}${s.month}_검토표.html`, html, 'text/html;charset=utf-8');
  toast('지도·출처·주의사항을 포함한 HTML 검토표를 저장했습니다. 브라우저에서 열어 인쇄할 수 있습니다.', 5500);
}
async function loadConfig() {
  try { const r = await fetch('/api/config', { signal: AbortSignal.timeout(6000) }); if (r.ok) config = await r.json(); }
  catch { /* Static preview remains usable without server functions. */ }
  render();
}
async function usePublished() {
  state.dataset='published';previousActualMode='published';stopTimers();
  await Promise.all(sourceStore.list().filter(s=>s.snapshot).map(s=>sourceStore.loadSnapshot(s.id)));
  reindexSources();closeDialog();toast('실제 공개자료층으로 전환했습니다. 기준일·검수상태를 확인하세요.',5000);
}

async function loadApiData(){openDataCenter();toast('자료별 갱신 버튼을 사용하세요. 서로 다른 API 자료를 개별 관리합니다.');}

async function loadBoundary(){
  try {adminBoundary=await fetchAdminBoundary();boundaryError='';map.setBoundary(adminBoundary);demoData.facilities.features=assignDongs(demoData.facilities.features,adminBoundary);reindexSources();sourceMessages.push('18개 행정동 경계 로드 · 2026.07.01 SGIS 가공 참고자료');render();}
  catch(error){boundaryError='18개 행정동 경계 연결 실패. 경계 없는 자료를 서구 전체 현황으로 표시하지 않습니다.';sourceMessages.push(boundaryError);render();toast(error.message,6000);}
}

async function remoteSearch() {
  const q = document.getElementById('search-input')?.value.trim();
  if (!q || q.length < 2) { toast('시설 검색창에 2자 이상의 장소명을 입력한 뒤 눌러주세요.'); return; }
  toast('브이월드에서 장소를 검색합니다.');
  try {
    const r = await fetch(`/api/vworld?kind=search&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(12000) }), data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || '검색 실패');
    showDialog(`${icon('search')} 브이월드 장소검색`, `<p class="dialog-lead">‘${escapeHTML(q)}’ 검색 결과입니다. 외부 검색 지점은 등록된 행정자료에 자동 추가하지 않습니다.</p><div class="remote-results">${data.items.map(item => `<button data-remote-lon="${item.longitude}" data-remote-lat="${item.latitude}"><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.address)}</span>${icon('arrow')}</button>`).join('') || '<p>요청한 주변 범위의 검색 결과가 없습니다.</p>'}</div>`);
  } catch (error) { toast(error.message, 6000); }
}

function reindexSources(){
  actualFacilities=adminBoundary?assignDongs(sourceStore.features(),adminBoundary):[];
  sourceName='공개자료 / API별 출처는 시설 상세·연결 센터 확인';syncMonths();render();
}
function selectDong(id){
  if(id&&!adminBoundary?.features.some(f=>f.properties.dongId===id))return;
  stopTimers();state.dongId=id||null;state.selectedId=null;state.pickMode=null;render();map.fitDong(id);
}
function openDongTable(){const fs=filterFacilities(activeFeatures(),{...state,dongId:null,realDistrictOnly:state.dataset!=='demo'});showDialog(`${icon('layers')} 18개 행정동 비교`,dongTable(adminBoundary,fs,state.dataset==='demo'?[]:dongStats,state.month));}
async function loadPending(){try{const r=await fetch('/data/address-records.json',{signal:AbortSignal.timeout(6000)});if(r.ok)pendingRecords=(await r.json()).records||[];}catch{}}
function openPending(){showDialog(`${icon('shield')} 주소만 확보된 안전·복지 자료`, `<p class="dialog-lead">서구청 공식 안내에서 확인한 공개시설입니다. <strong>좌표를 확인하지 않았으므로 지도와 동별 시설 수에는 넣지 않았습니다.</strong> 거주시설·공동생활가정·개인 이름은 수집대상에서 제외했습니다. 원자료 기준일 미제공 항목은 갱신일을 대신 넣지 않습니다.</p><div class="data-table-wrap"><table class="data-table pending-table"><thead><tr><th>자료</th><th>시설명</th><th>주소</th><th>연락처</th><th>좌표</th></tr></thead><tbody>${pendingRecords.map(r=>`<tr><td>${escapeHTML(r.categoryName)}</td><td>${escapeHTML(r.name)}</td><td>${escapeHTML(r.address)}</td><td>${escapeHTML(r.phone||'')}</td><td><button class="text-button" data-geocode="${escapeHTML(r.id)}">주소→좌표 후보</button></td></tr>`).join('')}</tbody></table></div><p class="notice">대피장소는 실제 재난 시 공식 안내를 우선 확인하세요. 시설 CSV 양식으로 검수한 좌표·출처를 입력한 뒤 가져오면 지도에 연결됩니다.</p><div class="dialog-actions"><a class="btn secondary" href="/data/address-records.csv" download>검수용 CSV 받기</a><button class="btn primary" data-act="import">검수한 시설 파일 가져오기</button></div>`);}
let geoCandidate=null;
async function prepareAddress(id){
 const record=pendingRecords.find(r=>r.id===id);if(!record)return;
 toast('공개시설 주소를 브이월드로 조회합니다. 자동 등록하지 않습니다.',5000);
 try{const r=await fetch(`/api/geocode?id=${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(12000)}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'주소 변환 실패');
  const assigned=assignDongs([{type:'Feature',geometry:{type:'Point',coordinates:d.coordinates},properties:{id}}],adminBoundary)[0];if(!assigned.properties.inDistrict)throw Error('18개 행정동 경계 밖의 후보입니다. 등록하지 않습니다.');
  geoCandidate={record,...d};showAddressCandidate();
 }catch(e){toast(e.message,7000);}
}
function showAddressCandidate(){if(!geoCandidate)return;const c=geoCandidate;showDialog(`${icon('pin')} 공개시설 좌표 후보 확인`, `<p class="dialog-lead"><strong>${escapeHTML(c.name)}</strong><br>${escapeHTML(c.address)}<br>경도·위도 ${c.coordinates.map(v=>v.toFixed(6)).join(', ')}</p><p class="notice">${escapeHTML(c.notice)} 등록은 현재 브라우저 메모리에만 적용되며, 다른 사용자에게 공개되지 않습니다. 원자료 기준일은 미제공으로 유지합니다.</p><div class="dialog-actions"><button class="btn secondary" data-act="candidate-view">지도에서 위치 보기</button><button class="btn primary" data-act="candidate-accept">위치를 확인했음 · 이 브라우저에 추가</button><button class="btn secondary" data-act="candidate-cancel">취소</button></div>`);}
function acceptAddressCandidate(){if(!geoCandidate)return;const {record,coordinates}=geoCandidate;const p=validateImport({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates},properties:{...record,sourceDate:null,monthly:{},positionSource:'VWorld geocoding / user-confirmed, not surveyed',note:'브이월드 주소 좌표를 사용자가 확인하여 추가. 현장 검증·출입구 검수 완료를 의미하지 않음.'}}]});if(!p.accepted.length){toast('자료 검증에 실패했습니다.');return;}sourceStore.importLayer('confirmed-'+record.id,record.name,p.accepted);state.dataset='published';state.candidate=null;geoCandidate=null;closeDialog();resetFilters();render();toast('현재 브라우저에 추가했습니다. 공유·영구 저장은 검수 후 GeoJSON/CSV로 반영하세요.',6000);}
let weatherLast=null,weatherToken=0;
async function openWeather(){
 const token=++weatherToken,d=adminBoundary?.features.find(f=>f.properties.dongId===state.dongId),c=d?.properties.labelPoint||APP.center,name=d?.properties.dongName||'서구 중심';
 showDialog(`${icon('sun')} ${escapeHTML(name)} 주변 기상`, '<p class="dialog-lead">기상청 격자 실황 조회 중…</p>');
 try{const r=await fetch(`/api/weather?lon=${c[0]}&lat=${c[1]}`,{signal:AbortSignal.timeout(13000)}),data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'기상 조회 실패');if(token!==weatherToken)return;weatherLast={name,...data};renderWeather(weatherLast);}
 catch(e){if(token!==weatherToken)return;showDialog(`${icon('sun')} 기상 연결 확인`, `<p class="notice">${escapeHTML(e.message)}</p>${weatherLast?`<p>이전 조회: ${escapeHTML(weatherLast.name)} / ${escapeHTML(weatherLast.base.base_date)} ${escapeHTML(weatherLast.base.base_time)}. 다른 지역일 수 있어 현재 값으로 재사용하지 않습니다.</p>`:''}<p class="micro">기상청 단기예보 조회서비스 활용신청 후 Vercel에 키를 등록·재배포하세요.</p>`);}
}
function renderWeather(w){const labels={T1H:['기온','℃'],RN1:['1시간 강수량','mm'],REH:['습도','%'],WSD:['풍속','m/s'],VEC:['풍향','°'],PTY:['강수형태 코드','']};showDialog(`${icon('sun')} ${escapeHTML(w.name)} 주변 격자 실황`, `<p class="dialog-lead">관측 기준 ${escapeHTML(w.base.base_date)} ${escapeHTML(w.base.base_time)} (한국시간) · 격자 ${w.grid.nx}, ${w.grid.ny}</p><table class="data-table"><tbody>${Object.entries(w.values).filter(([k])=>labels[k]).map(([k,v])=>`<tr><th>${labels[k][0]}</th><td>${escapeHTML(v)} ${labels[k][1]}</td></tr>`).join('')}</tbody></table><p class="notice">${escapeHTML(w.note)}</p><p class="micro">출처: 기상청 초단기실황 · 수신 ${escapeHTML(new Date(w.fetchedAt).toLocaleString('ko-KR'))}</p>`);}
function openDiagnostics(){showDialog(`${icon('cube')} 3D 연결 상태`, `<p class="dialog-lead">${escapeHTML(lastMapStatus.message)}</p><table class="data-table"><tr><th>현재 엔진</th><td>${escapeHTML(state.engine)}</td></tr><tr><th>브이월드 환경변수</th><td>${config?.vworld3d?'설정됨 · 인증은 별도':'현재 배포에서 미확인'}</td></tr><tr><th>OSM 현재 화면 도형</th><td>${diagnostics?.renderedBuildings??'측정 없음'}</td></tr><tr><th>행정동 경계</th><td>${adminBoundary?.features.length??'연결 실패'}개</td></tr></table><p class="notice">OSM 입체지도는 평면 건물 도형을 높이값으로 올린 표현입니다. 값은 공급 타일의 렌더링용 수치로 측량값을 보증하지 않습니다. 브이월드는 지형·원본 건물 모형을 연결하지만 SDK 준비만으로 건물 수신과 인증 성공을 단정하지 않습니다. 통계기둥은 별도의 행정값 표현이며 건물이 아닙니다.</p><div class="dialog-actions"><button class="btn secondary" data-act="closeup">가까이 보기</button><button class="btn secondary" data-engine="vworld">브이월드 연결 시험</button></div>`);}

const actions = {
 'candidate-review':showAddressCandidate,
 'candidate-view'(){if(!geoCandidate)return;state.candidate=geoCandidate.coordinates;closeDialog();map.flyTo({center:geoCandidate.coordinates,zoom:17,pitch:state.is3D?57:0});render();toast('노란 좌표 후보를 확인한 뒤 자료 설정의 ‘좌표 후보 확인’을 누르세요.',7000);},
 'candidate-accept':acceptAddressCandidate,
 'candidate-cancel'(){geoCandidate=null;state.candidate=null;closeDialog();render();},
  theme() { state.theme = state.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('seoon:theme', state.theme); } catch {} render(); if (state.engine === 'maplibre') map.start(state.engine, state.theme).then(() => map.set3D(state.is3D)); },
  home() { state.dongId=null; resetFilters(); state.scenario = null; state.workspace = 'overview'; render(); map.flyTo({ center: APP.center, zoom: 14.5, pitch: state.is3D ? 57 : 0, bearing: -28 }); },
  'pick-radius'() { state.workspace = 'access'; state.pickMode = 'radius'; closeDialog(); render(); },
  'clear-radius'() { state.radiusCenter = null; state.pickMode = null; render(); },
  scenario() { if (state.scenario && !state.pickMode) { state.scenario = null; render(); toast('가상 시설을 지웠습니다.'); return; } state.pickMode = state.pickMode === 'scenario' ? null : 'scenario'; if (!state.pickMode) state.scenario = null; render(); },
  'clear-search'() { state.search = ''; render(); },
  'clear-selection'() { state.selectedId = null; render(); },
  'zoom-in'() { map.zoomBy(.6); }, 'zoom-out'() { map.zoomBy(-.6); }, rotate() { map.rotate(25); },
  '3d'() { state.is3D = !state.is3D; map.set3D(state.is3D); render(); },
  fullscreen() { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); else document.documentElement.requestFullscreen?.().catch(() => toast('브라우저에서 전체화면 전환을 허용하지 않았습니다.')); },
  tour() {
    closeDialog(); if (state.touring) { clearInterval(tourTimer); state.touring = false; render(); return; }
    clearInterval(playTimer); state.playing = false; state.touring = true; let i = 0;
    const hop = () => { const camera = CAMERAS[i++ % CAMERAS.length]; map.flyTo({ ...camera, pitch: state.is3D ? camera.pitch : 0 }); toast(`${camera.name} 카메라 이동 · 지리정보의 행정경계 선택이 아닙니다.`, 2700); };
    hop(); tourTimer = setInterval(hop, 7000); render();
  },
  play() {
    if (state.playing) { clearInterval(playTimer); state.playing = false; render(); return; }
    clearInterval(tourTimer); state.touring = false; state.playing = true;
    playTimer = setInterval(() => { state.month = months[(months.indexOf(state.month) + 1) % months.length]; render(); }, 1700); render();
  },
  'toggle-demo'() {
    ++loadToken; stopTimers(); resetFilters();
    if (state.dataset === 'demo') { state.dataset = 'published'; }
    else { state.dataset = 'demo'; }
    syncMonths(); render();
  },
  data: openDataCenter, help: openHelp, compare: openCompare, list: openFacilityList,
  csv: exportCsv, report: exportReport, 'close-dialog': closeDialog,
  'retry-map'() { map.start(state.engine, state.theme).then(() => map.set3D(state.is3D)); },
  'clear-comparison'() { viewSnapshots = []; closeDialog(); toast('비교조건을 지웠습니다.'); },
  'save-comparison'() { saveDownload('서구온_조회조건비교.json', JSON.stringify(viewSnapshots, null, 2)); },
  import() { importKind='facilities';document.getElementById('file-input').click(); },
  'import-stats'(){importKind='stats';document.getElementById('file-input').click();},
  'import-projects'(){importKind='projects';document.getElementById('file-input').click();},
  sources:openDataCenter, 'dong-table':openDongTable, pending:openPending, weather:openWeather, diagnostics:openDiagnostics,
  'district-overview'(){state.is3D=false;state.dongId=null;render();map.set3D(false);map.fitDong(null);},
  closeup(){const d=adminBoundary?.features.find(f=>f.properties.dongId===state.dongId);state.is3D=true;render();map.flyTo({center:d?.properties.labelPoint||CAMERAS[0].center,zoom:16.6,pitch:62,bearing:-25});},
  'inspect-buildings'(){if(state.engine!=='maplibre'){toast('높이 클릭 조회는 OSM 입체지도에서 지원합니다. 브이월드는 원본 SDK의 제공범위에 따릅니다.',5500);return;}state.inspectBuildings=!state.inspectBuildings;render();toast(state.inspectBuildings?'지도 건물을 클릭하면 렌더링 높이와 한계를 표시합니다.':'행정동 선택 모드로 돌아왔습니다.');},
  published: usePublished, 'load-api-data': loadApiData, 'load-boundary': loadBoundary, 'remote-search': remoteSearch,
  'mobile-settings'() { showDialog(`${icon('layers')} 지도와 자료 설정`, `<div id="mobile-layer-settings">${renderLayers(activeFeatures(), state, config)}</div><div class="dialog-actions"><button class="btn secondary" data-act="compare">조건 비교</button><button class="btn secondary" data-act="help">이용 안내</button></div>`); },
  'mobile-panel'() { document.querySelector('.analysis-panel').classList.toggle('mobile-open'); },
};
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if(button.dataset.sourceRefresh){sourceStore.refresh(button.dataset.sourceRefresh).catch(e=>toast(e.message,5000));return;}
  if(button.dataset.dong){closeDialog();selectDong(button.dataset.dong);return;}
  if(button.dataset.geocode){prepareAddress(button.dataset.geocode);return;}
  if (button.dataset.act && actions[button.dataset.act]) { actions[button.dataset.act](); return; }
  if (button.dataset.workspace) { state.workspace = button.dataset.workspace; state.pickMode = null; state.layers.projects = state.workspace === 'projects'; render(); return; }
  if (button.dataset.camera) { const camera = CAMERAS.find(c => c.id === button.dataset.camera); if (camera) map.flyTo({ ...camera, pitch: state.is3D ? camera.pitch : 0 }); return; }
  if (button.dataset.engine) { closeDialog(); switchEngine(button.dataset.engine); return; }
  if (button.dataset.layer) { const key = button.dataset.layer; state.layers[key] = !state.layers[key]; render(); return; }
  if (button.dataset.month) { clearInterval(playTimer); state.playing = false; state.month = button.dataset.month; render(); return; }
  if (button.dataset.radius) { state.radiusMeters = Number(button.dataset.radius); render(); return; }
  if (button.dataset.feature) {
    const f = filtered.find(f => f.properties.id === button.dataset.feature); if (!f) return;
    state.selectedId = f.properties.id; closeDialog(); render(); map.flyTo({ center: f.geometry.coordinates, zoom: 15.7, pitch: state.is3D ? 57 : 0 }); return;
  }
  if (button.dataset.remoteLon) { closeDialog(); map.flyTo({ center: [Number(button.dataset.remoteLon), Number(button.dataset.remoteLat)], zoom: 16, pitch: state.is3D ? 55 : 0 }); }
});
document.addEventListener('change', event => {
  if(event.target.id==='dong-select'){selectDong(event.target.value);return;}
  if(event.target.dataset.sourceToggle){sourceStore.toggle(event.target.dataset.sourceToggle,event.target.checked);return;}
  if (event.target.matches('[data-category]')) {
    const key = event.target.dataset.category; state.categories = event.target.checked ? [...new Set([...state.categories, key])] : state.categories.filter(c => c !== key); render();
  }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'search-form') return; event.preventDefault(); state.search = document.getElementById('search-input').value.trim(); render();
});
document.getElementById('file-input').addEventListener('change', async event => {
 const file=event.target.files?.[0];if(!file)return;stopTimers();
 try{
  if(file.size>2*1024*1024)throw Error('2MB 이하 파일만 가져오세요.');const text=await file.text();
  if(importKind==='stats'){const parsed=importDongStats(file.name.toLowerCase().endsWith('.csv')?text:JSON.parse(text));dongStats=parsed;state.dataset='published';syncMonths();render();closeDialog();openDongTable();toast(`행정동 통계 ${parsed.length}행을 읽었습니다. 건물별로 배분하지 않습니다.`,6000);}
  else if(importKind==='projects'){const parsed=importProjects(JSON.parse(text));actualProjects=parsed;state.dataset='published';state.workspace='projects';state.layers.projects=true;resetFilters();if(parsed[0])state.month=parsed[0].properties.start.slice(0,7);syncMonths();render();closeDialog();toast(`실제 사업 도형 ${parsed.length}개를 읽었습니다. 입력값 미검수.`,6000);}
  else {const parsed=file.name.toLowerCase().endsWith('.csv')?importFacilitiesCSV(text):validateImport(JSON.parse(text));if(!parsed.accepted.length&&parsed.errors.length)throw Error(parsed.errors.slice(0,3).join(' / '));state.dataset='published';sourceStore.importLayer(`local-${++importSequence}`,file.name,parsed.accepted);sourceMessages.push(`사용자 파일 ${file.name} · 수락 ${parsed.accepted.length} / 제외 ${parsed.rejected}`,...parsed.errors.slice(0,5));resetFilters();syncMonths();render();closeDialog();toast(`시설 ${parsed.accepted.length}개를 읽었습니다. 경계 밖·좌표 오류 자료는 표시에서 제외합니다.`,6000);}
 }catch(error){toast(error.message||'파일 형식 확인 실패',7000);}finally{event.target.value='';}
});

document.addEventListener('keydown', event => { if (event.key === 'Escape') { state.pickMode = null; stopTimers(); render(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTimers(); render(); } });
window.addEventListener('beforeunload', () => { stopTimers(); map.destroy(); });
sourceStore.onChange=reindexSources;
render();
async function boot(){
 await Promise.all([loadConfig(),loadBoundary(),sourceStore.init().then(()=>{sourcesInitialized=true;reindexSources();}),loadPending()]);
 if(!engineChosen&&!offlineDesign&&config?.vworld3d)state.engine='vworld';
 render();if(!engineChosen){await map.start(state.engine,state.theme);if(adminBoundary)map.setBoundary(adminBoundary);}
}
boot().catch(()=>toast('초기 연결 일부가 실패했습니다. 데이터 연결 센터에서 확인하세요.',6000));
