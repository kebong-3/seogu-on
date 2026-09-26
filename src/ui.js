import { APP, CATEGORIES, WORKSPACES, DATA_KINDS } from './config.js';
import { icon } from './icons.js';
import { escapeHTML, summarize, metricAt, compareSameCohort, projectProximityPairs, distanceMeters } from './geo.js';

export function fmt(value, digits = 0) { return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: digits }); }
export function metricCompatibility(features) {
  const types = [...new Set(features.map(f => `${f.properties.metricName || '운영량'}|${f.properties.metricUnit || '건'}`))];
  return { compatible: types.length <= 1, name: types[0]?.split('|')[0] || '운영량', unit: types[0]?.split('|')[1] || '건' };
}
export function badge(text, cls = '') { return `<span class="badge ${cls}">${escapeHTML(text)}</span>`; }
export function baseLayout() {
  return `
  <header class="topbar">
    <a class="brand" href="/" aria-label="서구온 첫 화면"><span class="brand-mark">${icon('layers')}</span><div><strong>SEO<span>:</span>ON</strong><small>서구온 <b>SPACE × EVIDENCE</b></small></div></a>
    <nav class="workspace-tabs" aria-label="업무분야">${Object.entries(WORKSPACES).map(([id, w]) => `<button data-workspace="${id}">${icon(w.icon)}<span>${w.name}</span></button>`).join('')}</nav>
    <div class="header-actions"><button class="icon-button mobile-settings-button" data-act="mobile-settings" aria-label="지도와 자료 설정" title="지도와 자료 설정">${icon('layers')}</button><span class="beta">LAB / 0.1</span><button class="icon-button" data-act="theme" aria-label="테마 전환" title="밝은·어두운 테마 전환">${icon('sun')}</button><button class="btn secondary compact" data-act="report">${icon('download')}<span>검토표</span></button></div>
  </header>
  <main class="workspace">
    <div id="map-stage" aria-label="도시 지도"></div>
    <div class="map-vignette"></div>
    <nav class="icon-rail" aria-label="도구">
      <div><button data-act="home" class="rail-button active" aria-label="지도 처음으로" title="서구 화면으로">${icon('layers')}</button><button data-act="pick-radius" class="rail-button" aria-label="반경 조회" title="반경 조회">${icon('target')}</button><button data-act="scenario" class="rail-button" aria-label="가상 시설 배치" title="가상 시설 배치">${icon('pin')}</button><button data-act="compare" class="rail-button" aria-label="조건 비교" title="조건 비교">${icon('compare')}</button></div>
      <div><button data-act="data" class="rail-button" aria-label="자료 연결" title="자료 연결">${icon('data')}</button><button data-act="help" class="rail-button" aria-label="이용 안내" title="이용 안내">${icon('book')}</button><span class="rail-wordmark">F<span>W</span></span></div>
    </nav>
    <aside id="insights" class="panel analysis-panel" aria-label="행정분석" tabindex="-1"></aside>
    <div class="map-caption"><span class="eyebrow">GWANGJU SEO-GU · DIGITAL WORKSPACE</span><strong>도시의 정보를, 판단의 근거로.</strong><div class="viewpoints"><button data-camera="sangmu">상무권역</button><button data-camera="nongseong">농성권역</button><button data-camera="pungam">풍암권역</button></div></div>
    <div id="map-status" class="map-status" role="status"></div>
    <div id="map-error" class="map-error" hidden></div>
    <aside id="layers-panel" class="panel layer-panel" aria-label="표시 정보와 지도 설정"></aside>
    <div class="map-tools"><button class="tool" data-act="3d" title="2D·3D 전환" aria-label="2D·3D 전환" id="dimension-button">3D</button><span></span><button class="tool" data-act="zoom-in" title="확대" aria-label="확대">${icon('plus')}</button><button class="tool" data-act="zoom-out" title="축소" aria-label="축소">${icon('minus')}</button><span></span><button class="tool" data-act="rotate" title="지도 회전" aria-label="지도 회전">${icon('rotate')}</button><button class="tool" data-act="fullscreen" title="전체 화면" aria-label="전체 화면">${icon('expand')}</button></div>
    <div id="map-disclosure" class="map-disclosure"></div>
    <section id="timeline" class="panel timeline" aria-label="기간 선택"></section>
    <div class="bottom-brand"><span>FUNONWORK <b>LAB</b></span><span>공개 시험서비스 · 공식 행정판단 자료 아님</span></div>
    <button class="mobile-analysis" data-act="mobile-panel">${icon('chart')} 분석 패널</button>
  </main>
  <div id="toast" class="toast" role="status" hidden></div>
  <dialog id="dialog"><div class="dialog-header"><div id="dialog-title"></div><button class="icon-button" data-act="close-dialog" aria-label="창 닫기">${icon('close')}</button></div><div id="dialog-body"></div></dialog>
  <input id="file-input" type="file" accept=".json,.geojson,application/json,application/geo+json" hidden>
  `;
}

export function smallChart(features, state, months, compatibility) {
  if (!compatibility.compatible) return `<div class="empty-chart">단위가 다른 자료는 합산하지 않습니다.<br>같은 지표의 자료를 선택하세요.</div>`;
  const totals = months.map(m => summarize(features, m).total), max = Math.max(1, ...totals.filter(v => v !== null));
  return `<div class="mini-chart" role="group" aria-label="현재 조회 시설의 월별 ${escapeHTML(compatibility.name)}">
    ${totals.map((v, i) => `<button class="chart-column ${months[i] === state.month ? 'current' : ''}" data-month="${months[i]}" title="${months[i]} ${fmt(v)} ${escapeHTML(compatibility.unit)}" aria-label="${months[i]} ${v === null ? '자료 없음' : fmt(v) + compatibility.unit}"><span class="bar-track"><i style="height:${v === null ? 2 : Math.max(4, v / max * 100)}%;" class="${v === null ? 'no-value' : ''}"></i></span><span>${Number(months[i].slice(5))}</span></button>`).join('')}
  </div>`;
}
export function renderInsights(features, allCount, projects, state, months, sourceName) {
  const w = WORKSPACES[state.workspace], stats = summarize(features, state.month), comp = metricCompatibility(features);
  const previous = months[Math.max(0, months.indexOf(state.month) - 1)];
  const comparison = previous === state.month ? null : compareSameCohort(features, state.month, previous);
  const selected = features.find(f => f.properties.id === state.selectedId);
  const demo = state.dataset === 'demo';
  const label = demo ? '합성 시연자료' : state.dataset === 'imported' ? '사용자 자료 · 미검수' : '연결 자료 · 미검수';
  const sourceLabel = `${demo ? '시연 위치·수치 / 실제 시설 아님' : sourceName || '출처를 확인하세요'}`;
  const facts = stats.count ? `${fmt(stats.count)}개 시설을 조회했습니다. ${state.month} 값이 있는 시설은 ${fmt(stats.measured)}개입니다.` : '현재 조건에 맞는 등록자료가 없습니다. 시설이 없다는 의미는 아닙니다.';
  const actualFacts = !comp.compatible ? `${fmt(stats.count)}개 시설을 조회했습니다. 서로 다른 지표·단위가 포함되어 합계와 증감률을 표시하지 않습니다.` : facts;
  const pairs = projectProximityPairs(projects, state.month);
  return `
  <div class="panel-topline"><span class="section-index">01 / INTELLIGENCE</span>${badge(label, demo ? 'amber' : 'mint')}</div>
  <h1>${w.title.split('\n').map(escapeHTML).join('<br>')}</h1>
  <p class="panel-description">${escapeHTML(w.description)}</p>
  <form id="search-form" class="search-box"><span>${icon('search')}</span><input id="search-input" type="search" autocomplete="off" placeholder="등록된 시설 검색" value="${escapeHTML(state.search)}" aria-label="등록된 시설 검색"><button type="submit" class="search-go" aria-label="검색 실행">${icon('arrow')}</button></form>
  <div class="search-actions"><button class="text-button" data-act="remote-search">브이월드 장소검색 ${icon('external')}</button>${state.search ? '<button class="text-button" data-act="clear-search">검색 해제</button>' : ''}</div>
  <div class="metric-row"><div class="metric"><span>현재 조회 시설</span><strong>${fmt(stats.count)}<small>개</small></strong><em>등록 ${fmt(allCount)}개 중</em></div><div class="metric"><span>${escapeHTML(comp.name)}${demo ? ' · 시연' : ''}</span><strong>${comp.compatible ? fmt(stats.total) : '—'}<small>${escapeHTML(comp.unit)}</small></strong><em>${stats.missing ? `미입력 ${fmt(stats.missing)}개 제외` : '조회 시설 기준'}</em></div></div>
  ${state.workspace === 'access' ? `<div class="access-box"><div>${icon('target')}<strong>직선거리 반경 조회</strong></div><div class="radius-options">${[300, 500, 800, 1000].map(m => `<button data-radius="${m}" class="${state.radiusMeters === m ? 'active' : ''}">${m}m</button>`).join('')}</div><button class="btn primary full" data-act="pick-radius">${icon('pin')}${state.pickMode === 'radius' ? '지도에서 기준점을 클릭하세요' : '지도에서 기준점 선택'}</button>${state.radiusCenter ? `<p class="micro">${state.radiusCenter.map(c => c.toFixed(5)).join(', ')} · <button data-act="clear-radius">반경 해제</button></p>` : '<p class="micro">보행시간·법정 서비스 기준이 아닌 직선거리입니다.</p>'}</div>` : ''}
  <section class="insight-card"><div class="card-label">${icon('spark')}<strong>근거 브리핑</strong><span>규칙 기반</span></div><p>${escapeHTML(actualFacts)}</p><div class="evidence-line"><i></i><span>${escapeHTML(sourceLabel)}</span></div>${demo ? '<div class="caution-line">행정판단에 사용하지 않는 시연 결과입니다.</div>' : '<div class="caution-line">수집·입력 자료의 정확성은 별도로 검수해야 합니다.</div>'}</section>
  ${state.workspace === 'projects' ? `<section class="chart-section"><div class="section-heading"><h2>가까운 사업 · 겹치는 일정</h2><span>${fmt(pairs.length)}쌍</span></div><p class="micro">대표점 간 500m 이내 + 일정 중첩. 실제 사업구역 중첩 판정이 아닙니다.</p>${pairs.slice(0, 3).map(p => `<div class="pair-row"><span>${icon('route')}</span><div><strong>${escapeHTML(p.a.properties.name)}</strong><small>↔ ${escapeHTML(p.b.properties.name)} · 약 ${fmt(p.meters)}m</small></div></div>`).join('') || '<div class="empty-row">조건에 맞는 사업자료 없음</div>'}</section>` : `<section class="chart-section"><div class="section-heading"><h2>시간을 따라 살펴보기</h2><span>${escapeHTML(comp.unit)}${demo ? ' · 시연' : ''}</span></div>${smallChart(features, state, months, comp)}<div class="chart-footnote"><span>현재 조회 시설 기준 · 결측 제외</span><span>${comparison?.percent !== null && comparison?.percent !== undefined && comp.compatible ? `${comparison.percent >= 0 ? '+' : ''}${comparison.percent.toFixed(1)}%` : '비교값 없음'}</span></div>${comparison?.n ? `<p class="micro">${previous} 대비 · 두 달 모두 값이 있는 ${comparison.n}개 시설만 비교</p>` : ''}</section>`}
  ${selected ? `<section class="selection-card"><div class="section-heading"><h2>${icon(CATEGORIES[selected.properties.category].icon)} 선택한 시설</h2><button class="text-button" data-act="clear-selection">닫기</button></div><h3>${escapeHTML(selected.properties.name)}</h3><p>${escapeHTML(selected.properties.address || '주소 미입력')}</p><div class="selection-values"><span>${state.month} ${escapeHTML(selected.properties.metricName)}</span><b>${fmt(metricAt(selected, state.month))} ${escapeHTML(selected.properties.metricUnit)}</b></div><p class="micro">${escapeHTML(selected.properties.sourceName)} · ${escapeHTML(selected.properties.sourceDate)}</p>${selected.properties.note ? `<p class="micro">${escapeHTML(selected.properties.note)}</p>` : ''}</section>` : `<section class="facility-list"><div class="section-heading"><h2>조회 시설</h2><button class="text-button" data-act="list">전체 ${fmt(features.length)}개 ${icon('arrow')}</button></div>${features.slice(0, 3).map(f => `<button class="facility-row" data-feature="${escapeHTML(f.properties.id)}"><i style="--cat:${CATEGORIES[f.properties.category].color}">${icon(CATEGORIES[f.properties.category].icon)}</i><span><strong>${escapeHTML(f.properties.name)}</strong><small>${escapeHTML(DATA_KINDS[f.properties.dataKind] || '미검수 자료')} · ${escapeHTML(f.properties.sourceDate)}</small></span><b>${icon('arrow')}</b></button>`).join('') || '<div class="empty-row">자료를 연결하거나 조회조건을 변경하세요.</div>'}</section>`}
  <div class="panel-bottom-actions"><button class="btn secondary" data-act="compare">${icon('compare')} 조건 비교</button><button class="btn secondary" data-act="csv">${icon('download')} 조회자료</button></div>
  <div class="panel-footer-note">지도는 공간을 보여주고,<br><strong>최종 판단은 담당자가 합니다.</strong></div>
  `;
}
export function renderLayers(features, state, config) {
  return `<div class="panel-topline"><span class="section-index">02 / MAP LAYERS</span>${icon('layers')}</div>
  <h2 class="layer-title">어떤 정보를 볼까요?</h2>
  <div class="data-mode"><div><span class="status-dot ${state.dataset === 'demo' ? 'amber-dot' : ''}"></span><strong>${state.dataset === 'demo' ? '시연자료 표시 중' : '등록자료 표시 중'}</strong></div><button class="switch ${state.dataset === 'demo' ? 'on' : ''}" role="switch" aria-checked="${state.dataset === 'demo'}" aria-label="시연자료 표시" data-act="toggle-demo"><i></i></button></div>
  <p class="micro mode-note">${state.dataset === 'demo' ? '위치·실적 모두 합성입니다. 실제 시설 자료와 혼합하지 않습니다.' : '자료 없음은 시설 없음과 다릅니다. 출처·기준일을 확인하세요.'}</p>
  <div class="layer-options">${Object.entries(CATEGORIES).map(([key, c]) => `<label class="layer-option"><input type="checkbox" data-category="${key}" ${state.categories.includes(key) ? 'checked' : ''}><span class="checkbox" style="--cat:${c.color}">${icon('check')}</span><span class="layer-name">${escapeHTML(c.name)}</span><small>${features.filter(f => f.properties.category === key).length}</small></label>`).join('')}</div>
  <div class="divider"></div><div class="section-heading"><h3>표현 방식</h3><span class="micro">겹쳐보기</span></div>
  <div class="render-options">${[['buildings', 'cube', '입체 건물'], ['columns', 'chart', '통계기둥'], ['facilities', 'pin', '시설 위치'], ['projects', 'route', '사업구간']].map(([id, i, label]) => `<button data-layer="${id}" class="render-option ${state.layers[id] ? 'active' : ''}" aria-pressed="${state.layers[id]}" ${id === 'buildings' && state.engine === 'vworld' ? 'disabled title="브이월드 원본 건물은 이 버튼으로 제어하지 않습니다."' : ''}>${icon(i)}<span>${label}</span><i></i></button>`).join('')}</div>
  <p class="micro">통계기둥 높이는 값의 시각적 표현이며 건물 높이와 무관합니다. 단위 혼합 시 중지됩니다.</p>
  <div class="divider"></div><div class="section-heading"><h3>지도 엔진</h3><button class="text-button" data-act="help">${icon('info')}</button></div>
  <div class="engine-options"><button data-engine="maplibre" class="${state.engine === 'maplibre' ? 'active' : ''}">기본 웹지도 <span>OSM</span></button><button data-engine="vworld" class="${state.engine === 'vworld' ? 'active' : ''}">브이월드 3D <span>${config?.vworld3d ? '설정됨' : '키 필요'}</span></button><button data-engine="preview" class="${state.engine === 'preview' ? 'active' : ''}">디자인 미리보기 <span>가상</span></button></div>
  <button class="btn secondary full tour-button ${state.touring ? 'touring' : ''}" data-act="tour">${icon(state.touring ? 'pause' : 'play')}${state.touring ? '카메라 투어 중지' : '카메라 투어'}</button>
  <div class="connection-box"><div><span class="status-dot"></span><strong>데이터 연결 센터</strong></div><p>키·자료 연결 상태를 확인하세요.</p><button class="text-button" data-act="data">연결 설정 살펴보기 ${icon('arrow')}</button></div>`;
}
export function renderTimeline(features, state, months) {
  const comp = metricCompatibility(features), totals = months.map(m => comp.compatible ? summarize(features, m).total : null);
  const max = Math.max(1, ...totals.filter(v => v !== null));
  return `<div class="timeline-meta"><span class="eyebrow">TIME EXPLORER</span><strong>${state.month.replace('-', '.')} <small>${state.dataset === 'demo' ? '시연' : '조회'}</small></strong><span>기준월을 이동해 비교하세요</span></div><button class="play-button" data-act="play" aria-label="${state.playing ? '시간 재생 중지' : '월별 시간 재생'}">${icon(state.playing ? 'pause' : 'play')}</button><div class="timeline-bars">${months.map((m, i) => `<button data-month="${m}" class="time-tick ${state.month === m ? 'active' : ''}" aria-label="${m} 선택" aria-pressed="${state.month === m}"><span class="time-bar"><i style="height:${totals[i] === null ? 3 : Math.max(8, totals[i] / max * 100)}%"></i></span><span>${Number(m.slice(5))}월</span></button>`).join('')}<div class="time-baseline"></div></div><div class="timeline-info">${icon('calendar')}<span>${state.dataset === 'demo' ? '합성 시계열' : '입력된 시계열'}<small>관측값 없는 월은 — 처리</small></span></div>`;
}
