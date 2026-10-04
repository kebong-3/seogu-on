/**
 * "지도에게 묻기" 패널.
 * 질문을 /api/ask 로 보내고, 답·근거(도구, 출처, 한계)를 보여 준 뒤 결과 지점을 지도에 그린다.
 *
 * 정직성 원칙
 *  - 답은 지도에 실린 수록 자료에서만 나온다. 수록 건수를 전체 시설 수처럼 쓰지 않는다.
 *  - AI 답변인지 규칙 기반 답변인지 항상 표시한다.
 *  - 지도 엔진이 결과를 그리지 못해도 답과 결과 목록은 패널에 남는다.
 *
 * 지도 표시는 새 렌더러를 만들지 않고 앱의 기존 방식(state.entries 에 지도층을 넣고 api.drawData)을 쓴다.
 * 그래서 브이월드 3D·도시모형·OSM 경량지도·경계도 모두 같은 'layer' 메시지로 그려진다.
 */
import {registerAction} from './actions.js';
import {ASK_EXAMPLES} from './ask-examples.js';
import {frameFor} from './camera.js';
import {esc} from './catalog.js';
import {inside} from './geometry.js';

export const ASK_LAYER = 'ask-result';
const VIEW = 'ask-ai';
const MAX_QUESTION = 300;
const LIST_LIMIT = 30;
const HIGHLIGHT_COLOR = '#ff6a3d';

const TOOL_TITLES = {
  list_datasets: '수록 자료 목록',
  locate: '동·시설 위치 찾기',
  dong_profile: '행정동 개요',
  find_facilities: '시설 찾기',
  nearest: '가장 가까운 시설',
  coverage_gap: '서비스 사각지대 분석',
  compare_dongs: '동별 비교표',
  flood_history: '과거 침수피해 기록',
  sun_position: '태양 고도·방위',
};

const ARG_LABELS = {
  category: '분류', target: '대상', service: '서비스', dong: '동', dongs: '동', place: '기준', radiusM: '반경(m)',
  n: '개수', categories: '분류', datetime: '일시', heightM: '높이(m)', query: '검색어', yearFrom: '시작 연도', yearTo: '끝 연도', perKm2: '㎢당',
};

/* ───────────────────────── 순수 함수(테스트 대상) ───────────────────────── */

/** 도구 인자를 "동 풍암동 · 반경(m) 150" 같은 한 줄로. */
export function describeArgs(args) {
  return Object.entries(args || {})
    .filter(([key]) => ARG_LABELS[key])
    .map(([key, value]) => `${ARG_LABELS[key]} ${Array.isArray(value) ? value.join(', ') : value}`)
    .join(' · ');
}

/** 서버가 준 강조 지점을 앱의 지도층 도형으로 바꾼다(좌표가 이상한 것은 버린다). */
export function highlightFeatures(map) {
  const features = Array.isArray(map?.highlight?.features) ? map.highlight.features : [];
  return features
    .filter(f => f?.geometry?.type === 'Point' && f.geometry.coordinates?.slice(0, 2).every(Number.isFinite))
    .map((f, index) => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: f.geometry.coordinates.slice(0, 2)},
      properties: {
        id: `ask-${index}`,
        name: String(f.properties?.name || '이름 없는 지점'),
        category: '지도에게 묻기 결과',
        displayColor: HIGHLIGHT_COLOR,
        ...(Number.isFinite(f.properties?.distanceM) ? {distanceM: f.properties.distanceM} : {}),
      },
    }));
}

/**
 * 결과를 보려면 어느 구역(동)으로 바꿔야 하는지 정한다.
 * 앱은 선택한 구역 밖의 도형을 그리지 않으므로, 결과가 현재 동 밖에 있으면 서구 전체로 넓힌다.
 * @returns {string|null} 바꿀 dongId('all' 포함). 그대로 두면 null
 */
export function scopeFor(map, features, state) {
  const dongId = map?.focus?.dongId;
  if (dongId && state.dongs.some(f => f.properties.dongId === dongId)) return dongId === state.dong ? null : dongId;
  if (state.dong === 'all' || !state.scope) return null;
  const points = features.map(f => f.geometry.coordinates);
  if (Number.isFinite(map?.focus?.lon)) points.push([map.focus.lon, map.focus.lat]);
  return points.every(point => inside(point, state.scope)) ? null : 'all';
}

/** 점 둘레의 작은 사각형(카메라 범위 계산용). */
function boxAround([lon, lat], radiusM) {
  const dLat = radiusM / 111320, dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  return {type: 'Polygon', coordinates: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]]};
}

/** 카메라가 비출 도형: 기준점(반경 포함)이 있으면 그 둘레, 없으면 null(동 이동에 맡긴다). */
export function cameraTarget(map) {
  const focus = map?.focus;
  if (!focus || !Number.isFinite(focus.lon) || !Number.isFinite(focus.lat)) return null;
  return boxAround([focus.lon, focus.lat], Math.min(3000, Math.max(150, Number(focus.radiusM) || 250)));
}

const dateText = source => (source.date ? `${source.date}${source.dateBasis && source.dateBasis !== '자료 기준일' ? ` · ${source.dateBasis}` : ' 기준'}` : '날짜 미제공');

/** 근거 상자: 사용한 도구, 출처와 기준일, 자료의 한계. */
export function evidenceHtml(result) {
  const steps = (result.steps || []).map(step => `<li class="${step.ok === false ? 'failed' : ''}"><b>${esc(TOOL_TITLES[step.tool] || step.tool)}</b>`
    + `${describeArgs(step.args) ? `<span>${esc(describeArgs(step.args))}</span>` : ''}<small>${esc(step.summary)}</small></li>`).join('');
  const sources = (result.sources || []).map(source => `<li>${esc(source.name)} <small>${esc(dateText(source))}</small></li>`).join('');
  const caveats = (result.caveats || []).map(caveat => `<li>${esc(caveat)}</li>`).join('');
  if (!steps && !sources && !caveats) return '';
  return '<section class="ask-evidence" aria-label="답의 근거"><h3>근거</h3>'
    + (steps ? `<h4>조회한 내용</h4><ol class="ask-steps">${steps}</ol>` : '')
    + (sources ? `<h4>출처와 기준일</h4><ul class="ask-sources">${sources}</ul>` : '')
    + (caveats ? `<h4>자료의 한계</h4><ul class="ask-caveats">${caveats}</ul>` : '')
    + '</section>';
}

function badgeHtml(result) {
  const llm = result.mode === 'llm';
  const title = llm ? 'AI가 지도 도구의 결과로 쓴 답' : `정해진 규칙으로 만든 답${result.code ? ` · ${result.code}` : ''}`;
  return `<span class="ask-badge ${llm ? 'llm' : 'rules'}" title="${esc(title)}">${llm ? 'AI 답변' : '규칙 기반'}</span>`;
}

function listHtml(features, drawn) {
  if (!features.length) return '';
  const rows = features.slice(0, LIST_LIMIT).map(f => `<li><button class="ask-point" data-action="ask-point" data-id="${esc(f.properties.id)}">`
    + `<i class="legend-dot" style="background:${HIGHLIGHT_COLOR}"></i><span>${esc(f.properties.name)}</span>`
    + `${f.properties.distanceM === undefined ? '' : `<small>약 ${esc(Number(f.properties.distanceM).toLocaleString('ko-KR'))}m</small>`}</button></li>`).join('');
  const more = features.length > LIST_LIMIT ? `<p class="small">목록은 ${LIST_LIMIT}곳까지만 보여 줍니다.</p>` : '';
  const note = drawn === features.length
    ? `지도에 ${drawn}곳을 표시했습니다.`
    : `결과 ${features.length}곳 중 지도에는 ${drawn}곳을 표시했습니다(행정동 경계 밖이거나 이 지도 모드가 그리지 못한 지점 제외).`;
  return `<section class="ask-results" aria-label="결과 지점"><h3>결과 지점 <small>수록 자료 기준 · 전체 목록 아님</small></h3><p class="small">${esc(note)}</p>`
    + `<ul>${rows}</ul>${more}<div class="detail-actions"><button class="secondary ask-show-map" data-action="ask-show-map">지도에서 보기</button><button class="secondary" data-action="ask-clear">지도 표시 지우기</button></div></section>`;
}

/** 답 영역 HTML. status: idle | loading | done | error */
export function answerHtml(view) {
  if (view.status === 'loading') {
    return '<div class="ask-status" role="status"><span class="ask-spinner" aria-hidden="true"></span>답변 중… 지도 자료를 조회하고 있습니다.</div>';
  }
  if (view.status === 'error') {
    return `<p class="note warning ask-error" role="alert">${esc(view.error)}</p>`;
  }
  if (view.status !== 'done') return '';
  const result = view.result;
  const notice = result.mode === 'rules' && result.notice
    ? `<p class="small ask-notice">${esc(result.notice)}${result.code && result.code !== 'LLM_NOT_CONFIGURED' ? ` <code>${esc(result.code)}</code>` : ''}</p>` : '';
  return `<article class="ask-answer"><header><span class="ask-question-echo">${esc(view.question)}</span>${badgeHtml(result)}</header>`
    + `<p class="ask-text">${esc(result.answer)}</p>${notice}</article>`
    + listHtml(view.features || [], view.drawn || 0)
    + evidenceHtml(result);
}

export function panelHtml(view, scopeLabel) {
  const chips = ASK_EXAMPLES.map((text, index) => `<button class="ask-chip" data-action="ask-example" data-id="${index}">${esc(text)}</button>`).join('');
  return '<div class="ask-panel">'
    + '<p class="ask-scope">지도에 실린 <b>수록 자료만</b>으로 답합니다. 수록 건수는 서구 전체 시설 수가 아니며, 결과는 현장 확인 전 참고용입니다.</p>'
    + '<div class="ask-form"><label class="ask-label" for="ask-question">질문</label>'
    + `<div class="ask-row"><input id="ask-question" type="text" maxlength="${MAX_QUESTION}" autocomplete="off" enterkeyhint="search" placeholder="예: 풍암동 그늘막 어디 있어?" value="${esc(view.draft || '')}">`
    + `<button class="primary" id="ask-submit" data-action="ask-submit"${view.status === 'loading' ? ' disabled' : ''}>묻기</button></div>`
    + `<p class="small ask-context">현재 선택 구역: <b id="ask-scope-name">${esc(scopeLabel)}</b> · 질문에 동 이름이 없으면 이 구역을 기준으로 합니다.</p></div>`
    + `<div class="ask-chips" role="group" aria-label="예시 질문">${chips}</div>`
    + `<div id="ask-output" class="ask-output" aria-live="polite">${answerHtml(view)}</div>`
    + '</div>';
}

/* ───────────────────────── 설치 ───────────────────────── */

export function installAskAi(api) {
  const state = api.state;
  const view = {status: 'idle', draft: '', question: '', result: null, error: '', features: [], drawn: 0};
  const asked = []; // 이번 방문에서 한 질문(다음 질문의 문맥으로 최근 3개만 보낸다)
  let sequence = 0;

  const open = () => state.view === VIEW;
  const input = () => document.getElementById('ask-question');

  function render() {
    if (!open()) return;
    const output = document.getElementById('ask-output');
    if (output) output.innerHTML = answerHtml(view);
    const button = document.getElementById('ask-submit');
    if (button) button.disabled = view.status === 'loading';
    // 답을 그리면서 구역이 바뀌었을 수 있다(예: 서구 전체 → 풍암동).
    const scope = document.getElementById('ask-scope-name');
    if (scope) scope.textContent = api.label();
    // 답이 나오면 예시 단추 아래로 가려지지 않게 답 위치로 스크롤한다.
    // (scrollIntoView 는 화면 전체를 밀 수 있어 패널 본문만 직접 움직인다.)
    const host = document.getElementById('detail-body');
    if (view.status !== 'idle' && output && host) host.scrollTop += output.getBoundingClientRect().top - host.getBoundingClientRect().top - 10;
  }

  function show() {
    api.show('지도에게 묻기', panelHtml(view, api.label()), VIEW);
    const eyebrow = document.getElementById('detail-eyebrow');
    if (eyebrow) eyebrow.textContent = '수록 자료로 답하기';
    if (innerWidth > 820) input()?.focus();
  }

  /** 이전 답의 지도 표시를 지운다. */
  function clearMap(redraw = true) {
    const had = state.entries.has(ASK_LAYER);
    state.entries.delete(ASK_LAYER);
    state.enabled.delete(ASK_LAYER);
    if (state.selected?.layer === ASK_LAYER) { state.selected = null; state.isolate = false; }
    if (had && redraw) api.drawData();
  }

  function fly(geometry) {
    try {
      const size = {width: Math.max(320, innerWidth - (innerWidth > 820 ? 760 : 40)), height: Math.max(350, innerHeight - 190)};
      api.send({type: 'camera', pose: frameFor(geometry, 'facility', size)});
    } catch { /* 카메라를 못 옮겨도 답은 그대로 보인다. */ }
  }

  /** 결과를 지도에 그리고 카메라를 옮긴다. 그린 지점 수를 돌려준다. */
  function applyMap(map) {
    clearMap(false);
    const features = highlightFeatures(map);
    view.features = features;
    try {
      const target = scopeFor(map, features, state);
      if (target) api.chooseDong(target);
      if (features.length) {
        state.entries.set(ASK_LAYER, {features, state: 'loaded', title: '지도에게 묻기 결과', metadata: {}, loadedAt: new Date().toISOString(), rejected: 0});
        state.enabled.add(ASK_LAYER);
        state.isolate = false;
        state.selected = null;
      }
      api.drawData();
      const camera = cameraTarget(map);
      if (camera) fly(camera);
      return api.scoped(ASK_LAYER).length;
    } catch {
      return 0; // 지도 엔진 문제로 그리지 못해도 목록은 패널에 남긴다.
    }
  }

  async function ask(question) {
    const text = String(question || '').replace(/\s+/g, ' ').trim();
    if (!text) { api.toast('질문을 입력하세요.'); input()?.focus(); return; }
    if (text.length > MAX_QUESTION) { api.toast(`질문은 ${MAX_QUESTION}자 이하로 적어 주세요.`); return; }
    if (view.status === 'loading') return;
    const token = ++sequence;
    Object.assign(view, {status: 'loading', question: text, draft: text, result: null, error: '', features: [], drawn: 0});
    clearMap();
    render();
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: text, dongId: state.dong === 'all' ? undefined : state.dong, history: asked.slice(-3).map(q => ({role: 'user', text: q}))}),
        signal: AbortSignal.timeout(20000),
      });
      let body = null;
      try { body = await response.json(); } catch { /* 아래에서 형식 오류로 처리 */ }
      if (token !== sequence) return;
      if (!response.ok || !body?.ok) throw Error(body?.error || (response.status === 429 ? '질문이 많습니다. 잠시 후 다시 시도하세요.' : '답을 받지 못했습니다. 잠시 후 다시 시도하세요.'));
      asked.push(text);
      view.result = body;
      view.status = 'done';
      view.drawn = open() ? applyMap(body.map) : 0;
    } catch (error) {
      if (token !== sequence) return;
      view.status = 'error';
      view.error = error?.name === 'TimeoutError' ? '응답이 늦어 중단했습니다. 잠시 후 다시 시도하세요.' : (error?.message || '답을 받지 못했습니다.');
    }
    render();
  }

  const offs = [
    registerAction('ask-ai', () => show()),
    registerAction('ask-submit', () => ask(input()?.value)),
    registerAction('ask-example', button => {
      const text = ASK_EXAMPLES[Number(button.dataset.id)];
      if (!text) return;
      if (input()) input().value = text;
      return ask(text);
    }),
    registerAction('ask-clear', () => { clearMap(); view.drawn = 0; view.features = []; render(); }),
    registerAction('ask-show-map', () => api.close()),
    registerAction('ask-point', button => {
      const feature = view.features.find(f => f.properties.id === button.dataset.id);
      if (feature) fly(boxAround(feature.geometry.coordinates, 120));
    }),
  ];

  // Enter 로 묻기(한글 조합 중의 Enter 는 글자 확정이므로 건너뛴다). 입력 중인 글은 패널을 다시 열어도 남긴다.
  const body = document.getElementById('detail-body');
  const onKey = event => {
    if (event.target?.id !== 'ask-question' || event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    ask(event.target.value);
  };
  const onInput = event => { if (event.target?.id === 'ask-question') view.draft = event.target.value; };
  body?.addEventListener('keydown', onKey);
  body?.addEventListener('input', onInput);

  return {ask, show, clearMap, destroy() { offs.forEach(off => off()); body?.removeEventListener('keydown', onKey); body?.removeEventListener('input', onInput); }};
}
