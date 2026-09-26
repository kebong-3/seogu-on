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
  workspace: 'overview', dataset: 'demo', engine: offlineDesign ? 'preview' : 'maplibre', theme: savedTheme,
  categories: Object.keys(CATEGORIES), month: '2026-07', search: '',
  radiusCenter: null, radiusMeters: 500, selectedId: null, pickMode: null,
  scenario: null, is3D: true, touring: false, playing: false,
  layers: { buildings: true, columns: true, facilities: true, projects: false },
};
const demoData = makeDemoData();
let actualFacilities = [], actualProjects = [], config = null, months = [...MONTHS], sourceName = '',
  filtered = [], activeProjects = [], viewSnapshots = [], loadToken = 0, sourceMessages = [], previousActualMode = 'published';
let playTimer, tourTimer, toastTimer, lastMapStatus = { kind: 'loading', message: '지도 연결 준비 중' };
const map = new CityMap(document.getElementById('map-stage'), {
  select(feature) {
    if (state.pickMode) { mapClicked(feature.geometry.coordinates); return; }
    state.selectedId = feature.properties.id; render();
  }, click: mapClicked, status: mapStatus,
});
function activeFeatures() { return state.dataset === 'demo' ? demoData.facilities.features : actualFacilities; }
function currentProjectSource() { return state.dataset === 'demo' ? demoData.projects.features : actualProjects; }
function render() {
  const source = activeFeatures();
  filtered = filterFacilities(source, state);
  if (state.selectedId && !filtered.some(f => f.properties.id === state.selectedId)) state.selectedId = null;
  activeProjects = currentProjectSource().filter(f => monthOverlaps(f.properties.start, f.properties.end, state.month));
  document.documentElement.dataset.theme = state.theme;
  document.getElementById('insights').innerHTML = renderInsights(filtered, source.length, activeProjects, state, months, sourceName);
  document.getElementById('layers-panel').innerHTML = renderLayers(source, state, config);
  const mobileLayers = document.getElementById('mobile-layer-settings');
  if (mobileLayers) mobileLayers.innerHTML = renderLayers(source, state, config);
  document.getElementById('timeline').innerHTML = renderTimeline(filtered, state, months);
  document.querySelectorAll('[data-workspace]').forEach(button => { button.classList.toggle('active', button.dataset.workspace === state.workspace); button.setAttribute('aria-pressed', String(button.dataset.workspace === state.workspace)); });
  document.getElementById('dimension-button').textContent = state.is3D ? '3D' : '2D';
  document.getElementById('dimension-button').classList.toggle('active', state.is3D);
  document.querySelector('[data-act="theme"]').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
  const comp = metricCompatibility(filtered);
  map.update(filtered, activeProjects, { ...state, layers: { ...state.layers, columns: state.layers.columns && comp.compatible } });
  const limit = state.engine === 'vworld' ? 500 : 1000;
  const capNote = (filtered.length > limit ? ` · 시설 표시 ${limit}개 제한 / 표 ${filtered.length}개` : '') + (filtered.length > 500 && state.layers.columns ? ' · 통계기둥 최대 500개 표시' : '');
  document.getElementById('map-disclosure').innerHTML = `${icon('info')}<span>${state.engine === 'preview' ? '<b>가상 도시 · 실제 지도 아님</b>' : state.engine === 'vworld' ? '브이월드 3D · 지형/건물 기준일 별도 확인' : 'OpenStreetMap · 건물 누락·추정 높이 포함 가능'}<small>${state.dataset === 'demo' ? '시설 위치·수치·사업은 모두 합성 시연자료' : '등록자료는 제공·입력 범위만 표시 · 별도 검수 필요'}${capNote}</small></span>`;
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
  const all = [...new Set(activeFeatures().flatMap(f => Object.keys(f.properties.monthly || {})))].sort();
  months = all.length ? all.slice(-24) : [...MONTHS];
  if (!months.includes(state.month)) state.month = months[months.length - 1];
}
function resetFilters() { state.search = ''; state.radiusCenter = null; state.selectedId = null; state.categories = Object.keys(CATEGORIES); state.pickMode = null; }
async function switchEngine(engine) {
  if (engine === 'vworld' && !config?.vworld3d) { openDataCenter(); toast('Vercel 환경변수에 VWORLD_BROWSER_KEY와 VWORLD_DOMAIN을 먼저 등록하세요.', 5000); return; }
  stopTimers(); state.engine = engine; state.is3D = true; render();
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
    scenario: state.scenario, source: [...new Set(filtered.map(f => `${f.properties.sourceName} (${f.properties.sourceDate})`))],
    includedIds: filtered.map(f => f.properties.id), notes: sourceMessages,
  };
}
function openCompare() {
  const snapshot = currentSnapshot(); viewSnapshots = [...viewSnapshots, snapshot].slice(-2);
  const cards = viewSnapshots.map((s, i) => `<section class="snapshot-card"><span class="section-index">VIEW ${i === 0 ? 'A' : 'B'}</span><h3>${escapeHTML(s.workspace)}</h3><p>${s.month} · ${s.demo ? '합성 시연' : '등록 자료'}</p><div class="big-value">${fmt(s.count)}<small>개</small></div><p>${s.radiusMeters ? s.radiusMeters + 'm 직선거리' : '반경 조건 없음'}</p><p>${escapeHTML(s.categories.map(c => CATEGORIES[c].name).join(' · '))}</p><small>${escapeHTML(s.query || '검색조건 없음')}</small></section>`).join('');
  showDialog(`${icon('compare')} 조회조건 비교`, `<p class="dialog-lead">현재 조건을 ${viewSnapshots.length === 1 ? 'A로' : 'B로'} 저장했습니다. 기간·지역·대상 조건이 다르면 단순 증감으로 해석하지 마세요.</p><div class="snapshot-grid">${cards}${viewSnapshots.length === 1 ? '<section class="snapshot-card empty"><strong>B 조건을 추가하세요</strong><p>창을 닫고 기간·반경·시설 종류를 바꾼 뒤<br>‘조건 비교’를 다시 누르세요.</p></section>' : ''}</div><p class="notice">비교 결과는 시설 부족·사업 우선순위·정책 효과를 자동 판정하지 않습니다. 이 비교는 현재 브라우저 메모리에만 있습니다.</p><div class="dialog-actions"><button class="btn secondary" data-act="clear-comparison">비교 지우기</button><button class="btn primary" data-act="save-comparison">조건 JSON 내보내기</button></div>`);
}
function openFacilityList() {
  showDialog(`${icon('data')} 조회시설 ${fmt(filtered.length)}개`, `<p class="dialog-lead">${state.month} · ${state.dataset === 'demo' ? '모든 위치·수치는 합성 시연입니다.' : '자료 최신성·위치 정확도를 별도로 검수하세요.'}</p><div class="data-table-wrap"><table class="data-table"><thead><tr><th>시설명</th><th>종류</th><th>값</th><th>출처·기준일</th></tr></thead><tbody>${filtered.slice(0, 300).map(f => `<tr><td><button class="text-button" data-feature="${escapeHTML(f.properties.id)}">${escapeHTML(f.properties.name)}</button></td><td>${CATEGORIES[f.properties.category].name}</td><td>${fmt(metricAt(f, state.month))} ${escapeHTML(f.properties.metricUnit)}</td><td>${escapeHTML(f.properties.sourceName)}<small>${escapeHTML(f.properties.sourceDate)}</small></td></tr>`).join('')}</tbody></table></div><p class="micro">화면 표는 최대 300개입니다. ‘조회자료 내보내기’에는 현재 조회한 전체 자료가 포함됩니다.</p><div class="dialog-actions"><button class="btn primary" data-act="csv">${icon('download')} 조회자료 내보내기</button></div>`);
}
function openDataCenter() {
  showDialog(`${icon('data')} 데이터 연결 센터`, `
  <p class="dialog-lead">지도 배경과 행정자료는 별도로 연결합니다. <strong>‘설정됨’은 인증 성공이나 데이터 검수 완료를 의미하지 않습니다.</strong></p>
  <div class="connector-grid">
    <div class="connector"><div class="section-heading"><h3>기본 지도 · OSM</h3><span class="badge mint">키 불필요</span></div><p>OpenFreeMap 타일과 OSM 건물. 외부 접속이 필요하고 자료 누락·추정 높이가 있을 수 있습니다.</p></div>
    <div class="connector"><div class="section-heading"><h3>브이월드 3D</h3><span class="badge ${config?.vworld3d ? 'mint' : 'amber'}">${config?.vworld3d ? '환경변수 설정됨' : '미설정'}</span></div><code>VWORLD_BROWSER_KEY<br>VWORLD_DOMAIN</code><p>SDK용 공개키는 브라우저에 전달됩니다. 도메인 등록·API 승인이 필요합니다.</p><button class="btn secondary" data-engine="vworld">3D 연결 시험</button></div>
    <div class="connector"><div class="section-heading"><h3>브이월드 검색·경계</h3><span class="badge ${config?.vworldRest ? 'mint' : 'amber'}">${config?.vworldRest ? '환경변수 설정됨' : '미설정'}</span></div><code>VWORLD_API_KEY<br>VWORLD_DOMAIN<br>VWORLD_SIG_CODE</code><p>서버에서 키를 사용합니다. 경계조회는 제공기관의 시군구 코드 확인이 필요합니다.</p><button class="btn secondary" data-act="load-boundary">경계 연결 시험</button></div>
    <div class="connector"><div class="section-heading"><h3>공공데이터 · 시설</h3><span class="badge ${config?.publicData ? 'mint' : 'amber'}">${config?.publicData ? '필수값 설정됨' : '미설정'}</span></div><code>DATA_GO_KR_SERVICE_KEY<br>DATA_PORTAL_URL<br>DATA_FIELD_MAP<br>DATA_SOURCE_NAME / DATE</code><p>선택한 API의 주소·열 이름을 지정해야 합니다. JSON 응답만 지원합니다.</p><button class="btn secondary" data-act="load-api-data">API 자료 불러오기</button></div>
  </div>
  <section class="upload-section"><h3>${icon('upload')} 파일로 먼저 연결하기</h3><p>GeoJSON Point 자료를 현재 브라우저에만 불러옵니다. 파일을 서버나 AI에 보내지 않습니다. 새로고침하면 가져온 자료는 사라집니다.</p><div class="dialog-actions"><button class="btn primary" data-act="import">GeoJSON 가져오기</button><a class="btn secondary" href="/data/facilities-template.geojson" download>입력 양식</a><button class="btn secondary" data-act="published">저장소 공개자료 읽기</button></div><p class="micro">좌표계 EPSG:4326 / 최대 2MB·5,000개 / 개인정보를 넣지 마세요. 공개 사이트용 자료는 검수 후 public/data/facilities.geojson에 반영하세요.</p></section>
  <section class="source-log"><h3>최근 처리 기록</h3>${sourceMessages.length ? sourceMessages.map(t => `<p>${escapeHTML(t)}</p>`).join('') : '<p>아직 실제 API 자료를 수집하지 않았습니다.</p>'}<p>지도 상태: ${escapeHTML(lastMapStatus.message)}</p></section>
  <p class="notice">원본 API마다 명세가 다릅니다. 인증키 하나로 모든 시설·민원·인구가 자동 수집되거나 학습되지 않습니다. 이 버전은 실제 행정경계·시설 최신성을 보증하지 않습니다.</p>`);
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
  const headers = ['id', '시설명', '분류', '경도', '위도', '조회월', '지표', '값', '단위', '자료성격', '출처', '기준일'];
  const rows = filtered.map(f => [f.properties.id, f.properties.name, CATEGORIES[f.properties.category].name, ...f.geometry.coordinates, state.month, f.properties.metricName, metricAt(f, state.month) ?? '', f.properties.metricUnit, DATA_KINDS[f.properties.dataKind], f.properties.sourceName, f.properties.sourceDate]);
  saveDownload(`서구온_${state.dataset === 'demo' ? '시연_' : ''}${state.month}_조회자료.csv`, '\uFEFF' + [headers, ...rows].map(r => r.map(safeCsvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
function exportReport() {
  const s = currentSnapshot(), image = map.screenshot(), disclaimer = s.demo ? '합성 시연자료 — 실제 서구 시설·실적·사업이 아닙니다. 행정판단에 사용하지 마세요.' : '입력·수집 자료 — 위치·최신성·완전성 검수 전 참고용입니다.';
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>서구온 검토표 ${escapeHTML(s.month)}</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#19313b;max-width:1000px;margin:40px auto;padding:0 28px}header{border-bottom:3px solid #157762;padding-bottom:20px}h1{font-size:28px}small{color:#586c73}.notice{background:#fff3da;padding:14px;border:1px solid #e8c884}img{width:100%;max-height:480px;object-fit:cover}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #d9e2e4}h2{margin-top:28px}button{padding:10px 20px}footer{margin-top:30px;border-top:1px solid #d9e2e4;padding-top:16px}@media print{button{display:none}body{margin:0;font-size:12px}.notice{-webkit-print-color-adjust:exact}h2{break-after:avoid}tr{break-inside:avoid}}</style><header><small>FUNONWORK LAB / SEO:ON v${APP.version}</small><h1>서구 공간행정 검토표</h1><p>${escapeHTML(s.workspace)} · ${escapeHTML(s.month)}</p></header><p class="notice">${escapeHTML(disclaimer)}</p>${image ? `<img src="${image}" alt="조회 화면 지도"><p><small>${s.preview ? '가상 도시 디자인 미리보기 — 실제 지도 아님' : 'OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors / ODbL. 건물 높이는 추정 포함.'}</small></p>` : '<p>이 지도 엔진에서는 캡처가 포함되지 않습니다. 현재 화면을 별도로 기록하세요.</p>'}<h2>1. 조회 조건</h2><table><tr><th>업무</th><td>${escapeHTML(s.workspace)}</td></tr><tr><th>분류</th><td>${escapeHTML(s.categories.map(k => CATEGORIES[k].name).join(', '))}</td></tr><tr><th>검색</th><td>${escapeHTML(s.query || '전체')}</td></tr><tr><th>반경</th><td>${s.radiusMeters ? `${s.radiusMeters}m · 직선거리 / 기준좌표 ${s.radiusCenter.map(c => c.toFixed(6)).join(', ')}` : '반경 조건 없음'}</td></tr></table><h2>2. 확인된 값</h2><table><tr><th>조회 시설</th><td>${fmt(s.count)}개</td></tr><tr><th>${escapeHTML(s.metricName)} 합계</th><td>${fmt(s.total)} ${escapeHTML(s.metricUnit)} (단위 혼합·결측만 있으면 —)</td></tr><tr><th>결측</th><td>${fmt(s.missing)}개 / 값 있는 시설 ${fmt(s.measured)}개</td></tr></table><h2>3. 출처와 한계</h2>${s.source.map(t => `<p>${escapeHTML(t)}</p>`).join('') || '<p>조회된 출처 없음</p>'}<p>행정구역 전체 시설 현황이 아닐 수 있습니다. 직선거리와 보행 접근성은 다르며, 표시 건수만으로 시설 부족·수요·사업효과를 판단하지 않습니다. 통계기둥은 건물 높이가 아닙니다.</p>${s.notes.map(t => `<p>${escapeHTML(t)}</p>`).join('')}<h2>4. 담당자 검토의견</h2><p>__________________________________________________________________</p><p>__________________________________________________________________</p><footer><small>생성 ${escapeHTML(s.savedAt)} / 펀온워크 공개 시험서비스 / 최종 판단은 담당자 수행<br>OSM: https://www.openstreetmap.org/copyright · OpenFreeMap: https://openfreemap.org</small></footer></html>`;
  saveDownload(`서구온_${s.demo ? '시연_' : ''}${s.month}_검토표.html`, html, 'text/html;charset=utf-8');
  toast('지도·출처·주의사항을 포함한 HTML 검토표를 저장했습니다. 브라우저에서 열어 인쇄할 수 있습니다.', 5500);
}
async function loadConfig() {
  try { const r = await fetch('/api/config', { signal: AbortSignal.timeout(6000) }); if (r.ok) config = await r.json(); }
  catch { /* Static preview remains usable without server functions. */ }
  render();
}
async function usePublished() {
  const token = ++loadToken; stopTimers(); toast('저장소의 공개자료를 읽고 있습니다.');
  try {
    const parsed = await loadPublishedData(); if (token !== loadToken) return;
    actualFacilities = parsed.accepted; actualProjects = parsed.projects; state.dataset = 'published'; previousActualMode = 'published'; sourceName = '저장소 공개 GeoJSON'; resetFilters();
    sourceMessages = [`저장소 자료 ${parsed.accepted.length}개 / 제외 ${parsed.rejected}개`, ...parsed.errors.slice(0, 8)]; syncMonths(); render(); closeDialog();
    toast(parsed.accepted.length ? `${parsed.accepted.length}개 자료를 읽었습니다. 미검수 자료입니다.` : '아직 공개 시설자료가 없습니다. GeoJSON을 가져오거나 API를 연결하세요.', 5000);
  } catch (error) { toast(error.message, 5000); }
}
async function loadApiData() {
  const token = ++loadToken; stopTimers(); toast('공공데이터 API를 조회하고 있습니다.');
  try {
    const r = await fetch('/api/public-data', { signal: AbortSignal.timeout(12000) }), data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || '자료 조회 실패');
    if (token !== loadToken) return;
    const parsed = validateImport(data.geojson);
    actualFacilities = parsed.accepted.map(f => ({ ...f, properties: { ...f.properties, dataKind: 'external' } })); actualProjects = [];
    state.dataset = 'external'; previousActualMode = 'external'; sourceName = data.sourceName; resetFilters();
    sourceMessages = [...(data.notices || []), ...parsed.errors.slice(0, 8), `수집 ${new Date().toLocaleString('ko-KR')} / 검수 전`]; syncMonths(); render(); closeDialog();
    toast(`${actualFacilities.length}개 수집. ${data.partial ? '일부 자료만 수집되었습니다.' : '위치·최신성 검수가 필요합니다.'}`, 5500);
  } catch (error) { sourceMessages = [`API 오류: ${error.message}`]; toast(error.message, 6000); openDataCenter(); }
}
async function loadBoundary() {
  toast('브이월드 행정경계를 조회하고 있습니다.');
  try {
    const r = await fetch('/api/vworld?kind=boundary', { signal: AbortSignal.timeout(12000) }), data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || '경계 조회 실패');
    map.setBoundary(data.geojson); sourceMessages.push(`브이월드 경계 조회 · 요청 시군구 코드 ${data.code} · 제공기관 현행자료 확인 필요`);
    closeDialog(); toast('제공된 경계를 연결했습니다. 요청 코드와 대상 구역이 일치하는지 확인하세요.', 6000);
  } catch (error) { sourceMessages.push(`경계 미수집: ${error.message}`); toast(error.message, 6000); }
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

const actions = {
  theme() { state.theme = state.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('seoon:theme', state.theme); } catch {} render(); if (state.engine === 'maplibre') map.start(state.engine, state.theme).then(() => map.set3D(state.is3D)); },
  home() { resetFilters(); state.scenario = null; state.workspace = 'overview'; render(); map.flyTo({ center: APP.center, zoom: 14.5, pitch: state.is3D ? 57 : 0, bearing: -28 }); },
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
    if (state.dataset === 'demo') { state.dataset = previousActualMode; if (!actualFacilities.length) { usePublished(); return; } }
    else { state.dataset = 'demo'; }
    syncMonths(); render();
  },
  data: openDataCenter, help: openHelp, compare: openCompare, list: openFacilityList,
  csv: exportCsv, report: exportReport, 'close-dialog': closeDialog,
  'retry-map'() { map.start(state.engine, state.theme).then(() => map.set3D(state.is3D)); },
  'clear-comparison'() { viewSnapshots = []; closeDialog(); toast('비교조건을 지웠습니다.'); },
  'save-comparison'() { saveDownload('서구온_조회조건비교.json', JSON.stringify(viewSnapshots, null, 2)); },
  import() { document.getElementById('file-input').click(); },
  published: usePublished, 'load-api-data': loadApiData, 'load-boundary': loadBoundary, 'remote-search': remoteSearch,
  'mobile-settings'() { showDialog(`${icon('layers')} 지도와 자료 설정`, `<div id="mobile-layer-settings">${renderLayers(activeFeatures(), state, config)}</div><div class="dialog-actions"><button class="btn secondary" data-act="compare">조건 비교</button><button class="btn secondary" data-act="help">이용 안내</button></div>`); },
  'mobile-panel'() { document.querySelector('.analysis-panel').classList.toggle('mobile-open'); },
};
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
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
  if (event.target.matches('[data-category]')) {
    const key = event.target.dataset.category; state.categories = event.target.checked ? [...new Set([...state.categories, key])] : state.categories.filter(c => c !== key); render();
  }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'search-form') return; event.preventDefault(); state.search = document.getElementById('search-input').value.trim(); render();
});
document.getElementById('file-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return; ++loadToken; stopTimers();
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('2MB 이하 파일만 가져올 수 있습니다.');
    const parsed = validateImport(JSON.parse(await file.text()));
    if (!parsed.accepted.length && parsed.errors.length) throw new Error(parsed.errors.slice(0, 3).join('\n'));
    actualFacilities = parsed.accepted; actualProjects = []; state.dataset = 'imported'; previousActualMode = 'imported'; sourceName = file.name;
    sourceMessages = [`브라우저에서 ${file.name} 가져옴 · 서버 전송 없음`, `수락 ${parsed.accepted.length} / 제외 ${parsed.rejected}`, ...parsed.errors.slice(0, 8)];
    resetFilters(); syncMonths(); render(); closeDialog(); toast(`${parsed.accepted.length}개 불러오기 완료 · 제외 ${parsed.rejected}개 · 사용자 자료 미검수`, 6000);
    if (actualFacilities[0]) map.flyTo({ center: actualFacilities[0].geometry.coordinates, zoom: 14.8 });
  } catch (error) { toast(error.message || '자료 형식 확인 실패', 7000); }
  event.target.value = '';
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { state.pickMode = null; stopTimers(); render(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTimers(); render(); } });
window.addEventListener('beforeunload', () => { stopTimers(); map.destroy(); });
render(); map.start(state.engine, state.theme); loadConfig();
