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
  work_brief: '업무별 공간검토',
  weather_observation: '기상청 관측 조회',
};

const ARG_LABELS = {
  category: '분류', target: '대상', service: '서비스', dong: '동', dongs: '동', place: '기준', radiusM: '반경(m)',
  n: '개수', categories: '분류', datetime: '일시', heightM: '높이(m)', query: '검색어', yearFrom: '시작 연도', yearTo: '끝 연도', perKm2: '㎢당', theme: '업무',
};
const THEME_TITLES = {heat: '폭염 대응', cold: '한파 대응', icing: '결빙 점검', flood: '침수 이력 점검', living: '생활시설', school: '통학환경 점검', agenda: '마을의제', space: '공간 비교', reuse: '기존 공간 활용', coordination: '사업 연계'};
const ANALYSIS_ROLES = {
  'grounded-summary': '자료 조회·공간계산 후 AI가 근거를 요약했습니다.',
  'tool-selection': 'AI가 필요한 조회 도구를 선택하고 결과를 요약했습니다.',
  'region-grounded-selection': 'AI가 현재 지역의 수록 공간에서 검토 후보와 후속 확인사항을 골랐습니다. 공간명·수치·출처 문장은 원자료로 구성했습니다.',
};
const REGION_EXAMPLES = [
  '장천동에서 토요일 10시부터 12시까지 주민 모임을 열 공간을 검토해줘',
  '생활문화센터 영동1번지 운영조건을 확인해줘',
  '상사면 체육공간 자료를 찾아줘',
  '순천 수영장의 출처와 확인할 사항을 알려줘',
];
const examplesFor = view => view.regionId === 'suncheon' ? REGION_EXAMPLES : !view.regionId || view.regionId === 'seogu' ? ASK_EXAMPLES : ['수록 공공공간 자료를 찾아줘', '토요일 10시부터 12시까지 주민 모임 공간을 검토해줘'];
const portableRegion = view => !!view.regionId && view.regionId !== 'seogu';
const unavailableQuestionScope = view => ['unsupported-domain', 'different-region'].includes(view.result?.structured?.queryStatus) ? view.result.structured.queryStatus : '';
const spaceQuestion = view => portableRegion(view) || /공간|회의실|강당|주민.{0,5}(?:모임|회의)|운영안|개방|운영시간/.test(view.question || '') || ['space', 'reuse'].includes(view.reviewContext?.theme);

/* ───────────────────────── 순수 함수(테스트 대상) ───────────────────────── */

/** 도구 인자를 "동 풍암동 · 반경(m) 150" 같은 한 줄로. */
export function describeArgs(args) {
  return Object.entries(args || {})
    .filter(([key]) => ARG_LABELS[key])
    .map(([key, value]) => `${ARG_LABELS[key]} ${key === 'theme' ? THEME_TITLES[value] || value : Array.isArray(value) ? value.join(', ') : value}`)
    .join(' · ');
}

/** 서버가 준 강조 지점을 앱의 지도층 도형으로 바꾼다(좌표가 이상한 것은 버린다). */
export function highlightFeatures(map) {
  const features = Array.isArray(map?.highlight?.features) ? map.highlight.features : [];
  return features
    .filter(f => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2
      && f.geometry.coordinates.slice(0, 2).every(Number.isFinite) && Math.abs(f.geometry.coordinates[0]) <= 180 && Math.abs(f.geometry.coordinates[1]) <= 90)
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

const dateText = source => {
  const range = source.dateRange || source.sourceDateRange;
  const rangeText = typeof range === 'string' ? range : Array.isArray(range) ? range.filter(value => typeof value === 'string').join('–') : range && typeof range === 'object' ? [range.min || range.start || range.from, range.max || range.end || range.to].filter(value => typeof value === 'string').join('–') : '';
  return source.date ? `${source.date}${source.dateBasis && source.dateBasis !== '자료 기준일' ? ` · ${source.dateBasis}` : ' 기준'}` : rangeText ? `자료 기준일 범위 ${rangeText}` : '자료 기준일 미제공';
};

function sourceUrl(source) {
  try {
    const url = new URL(source.url || source.sourceUrl || '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

const MODE_NOTICES = {
  LLM_NOT_CONFIGURED: 'AI 모델이 아직 연결되지 않아 수록 자료를 직접 계산한 결과입니다.',
  LLM_TIMEOUT: 'AI 응답이 늦어 수록 자료를 직접 계산한 결과를 먼저 보여드립니다.',
  LLM_QUOTA: 'AI 사용량 한도로 수록 자료를 직접 계산한 결과를 보여드립니다.',
  LLM_DAILY_LIMIT: '오늘의 AI 호출 한도에 도달해 수록 자료를 직접 계산했습니다.',
  LLM_UNGROUNDED: 'AI 설명의 근거를 확인하지 못해 검증 가능한 자료 계산 결과를 보여드립니다.',
};

/** 화면과 저장 메모 모두 같은 근거·확인사항을 사용한다. */
export function reviewMemo(view) {
  const result = view.result;
  if (!result) return '';
  const lines = [`${view.regionName || '서구:온'} 공간행정 검토메모`, '', `질문: ${view.question}`, `질문 당시 선택 구역: ${view.queryScope || '미기록'}`,
    `작성: ${view.completedAt || '미기록'}`, `응답 방식: ${result.mode === 'llm' ? `AI 근거 요약 (${result.model || '모델 미기록'})` : '수록 자료 직접 계산 (규칙 기반)'}`,
    '', '□ 검토 결과', result.answer || '답변 없음'];
  if (result.mode === 'llm' && ANALYSIS_ROLES[result.analysisPath]) lines.push('', `AI 역할: ${ANALYSIS_ROLES[result.analysisPath]}`);
  if (result.brief) {
    const brief = result.brief;
    if (brief.basis) lines.push('', `검토 범위: ${brief.basis}`);
    if (brief.evidence?.length) lines.push('', '□ 확인한 자료', ...brief.evidence.map(item => `- ${item.title}: ${item.summary}${item.ok === false ? ' (미확인)' : ''}`));
    if (brief.review) {
      const review = brief.review;
      if (review.inputText) lines.push('', '□ 사용자 제공 검토내용 (공식 자료와 구분)', review.inputText);
      if (review.scopeNote) lines.push('', review.scopeNote);
      if (review.commonCriteria?.length) lines.push('', '□ 대안을 함께 살펴볼 기준', ...review.commonCriteria.map(item => `- ${item}`));
      if (review.alternatives?.length) lines.push('', '□ 대안별 확인사항', ...review.alternatives.flatMap(item => [`- ${item.title} (${item.origin === 'user' ? '사용자 입력' : '검토 예시'})`, `  ${item.focus || ''}`, ...(item.checks || []).map(check => `  · ${check}`)]));
      if (review.departments?.length) lines.push('', '□ 부서 협의 준비', ...review.departments.flatMap(item => [`- ${item.name}`, ...(item.checks || []).map(check => `  · ${check}`)]));
      if (review.discussionQuestions?.length) lines.push('', '□ 회의에서 확인할 질문', ...review.discussionQuestions.map(item => `- ${item}`));
      if (review.missingData?.length) lines.push('', '□ 추가로 확보할 자료', ...review.missingData.map(item => `- ${item}`));
    }
    if (brief.nextActions?.length) lines.push('', '□ 담당자 확인사항 (확정 판단 아님)', ...brief.nextActions.map(item => `- ${item}`));
    if (brief.missingData?.length) lines.push('', '□ 아직 없는 판단 근거', ...brief.missingData.map(item => `- ${item}`));
  }
  if (view.features?.length) lines.push('', '□ 결과 지점 (수록 자료 기준)', ...view.features.map(f => `- ${f.properties.name}${f.properties.distanceM === undefined ? '' : ` · 직선거리 약 ${Number(f.properties.distanceM).toLocaleString('ko-KR')}m`}`));
  if (result.steps?.length) lines.push('', '□ 실제 조회 내역', ...result.steps.map(step => `- ${TOOL_TITLES[step.tool] || step.tool} · ${describeArgs(step.args)}: ${step.summary}${step.ok === false ? ' (조회 미완료)' : ''}`));
  if (result.sources?.length) lines.push('', '□ 출처와 기준일', ...result.sources.map(source => `- ${source.name} · ${dateText(source)}${sourceUrl(source) ? ` · ${sourceUrl(source)}` : ''}`));
  lines.push('', '□ 자료의 한계', ...(result.caveats || []).map(item => `- ${item}`), '- 수록 건수는 지역 전체 시설 수가 아닙니다. 현장·운영 여부와 최신 자료를 담당자가 확인해야 합니다.');
  if (result.mode !== 'llm') lines.push('', MODE_NOTICES[result.code] || result.notice || 'AI 설명 없이 수록 자료의 계산 결과를 정리했습니다.');
  return lines.join('\n');
}

/** 근거 상자: 사용한 도구, 출처와 기준일, 자료의 한계. */
export function evidenceHtml(result) {
  const steps = (result.steps || []).map(step => `<li class="${step.ok === false ? 'failed' : ''}"><b>${esc(TOOL_TITLES[step.tool] || step.tool)}</b>`
    + `${describeArgs(step.args) ? `<span>${esc(describeArgs(step.args))}</span>` : ''}<small>${esc(step.summary)}</small></li>`).join('');
  const sources = (result.sources || []).map(source => `<li>${sourceUrl(source) ? `<a href="${esc(sourceUrl(source))}" target="_blank" rel="noopener noreferrer">${esc(source.name)} ↗</a>` : esc(source.name)} <small>${esc(dateText(source))}</small></li>`).join('');
  const caveats = (result.caveats || []).map(caveat => `<li>${esc(caveat)}</li>`).join('');
  if (!steps && !sources && !caveats) return '';
  return '<details class="ask-evidence ask-details" aria-label="답의 근거"><summary>상세 조회 근거·자료의 한계</summary>'
    + (steps ? `<h4>조회한 내용</h4><ol class="ask-steps">${steps}</ol>` : '')
    + (sources ? `<h4>출처와 기준일</h4><ul class="ask-sources">${sources}</ul>` : '')
    + (caveats ? `<h4>자료의 한계</h4><ul class="ask-caveats">${caveats}</ul>` : '')
    + (result.code ? `<details class="ask-diagnostic"><summary>응답 상태 자세히</summary><code>${esc(result.code)}</code></details>` : '')
    + '</details>';
}

function badgeHtml(result) {
  const llm = result.mode === 'llm';
  const title = llm ? result.analysisPath === 'region-grounded-selection' ? 'AI가 실제 자료에서 후보·확인사항을 선택하고 근거 문장은 서버에서 구성한 답' : 'AI가 지도 도구의 결과로 쓴 답' : `정해진 규칙으로 만든 답${result.code ? ` · ${result.code}` : ''}`;
  return `<span class="ask-badge ${llm ? 'llm' : 'rules'}" title="${esc(title)}">${llm ? 'AI 답변' : '규칙 기반'}</span>`;
}

function listHtml(features, drawn, view = {}) {
  if (!features.length) return '';
  const rows = features.slice(0, LIST_LIMIT).map(f => `<li><button class="ask-point" data-action="ask-point" data-id="${esc(f.properties.id)}">`
    + `<i class="legend-dot" style="background:${HIGHLIGHT_COLOR}"></i><span>${esc(f.properties.name)}</span>`
    + `${f.properties.distanceM === undefined ? '' : `<small>약 ${esc(Number(f.properties.distanceM).toLocaleString('ko-KR'))}m</small>`}</button></li>`).join('');
  const more = features.length > LIST_LIMIT ? `<p class="small">목록은 ${LIST_LIMIT}곳까지만 보여 줍니다.</p>` : '';
  const note = view.mapCleared ? '지도 표시를 지웠습니다. 결과 목록과 근거는 그대로 남아 있습니다.'
    : view.mapDeferred ? '질문 뒤 선택 구역이 바뀌었습니다. 결과를 지도에서 보려면 아래 버튼을 눌러 주세요.'
    : !view.mapReady ? '지도 연결 전입니다. 아래 결과 목록과 근거는 바로 확인할 수 있습니다.'
    : `결과 ${features.length}곳 중 ${drawn}곳을 지도 표시 대상으로 연결했습니다. 지점명을 누르면 해당 위치로 이동합니다.`;
  return `<section class="ask-results" aria-label="결과 지점"><h3>결과 지점 <small>수록 자료 기준 · 전체 목록 아님</small></h3><p class="small">${esc(note)}</p>`
    + `<ul>${rows}</ul>${more}<div class="detail-actions"><button class="secondary" data-action="ask-restore-map">결과를 지도에서 보기</button>${view.mapCleared ? '' : '<button class="secondary" data-action="ask-clear">지도 표시 지우기</button>'}</div></section>`;
}

function briefHtml(brief) {
  if (!brief) return '';
  const section = (title, items, className) => Array.isArray(items) && items.length
    ? `<section class="ask-brief-section ${className}"><h3>${title}</h3><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>` : '';
  return `<details class="ask-work-brief ask-details" aria-label="업무 검토사항"><summary>${esc(brief.title || '업무 검토 메모')} · 협의사항 자세히</summary>${brief.basis ? `<p class="small">${esc(brief.basis)}</p>` : ''}`
    + (brief.evidence?.length ? `<dl class="ask-brief-evidence">${brief.evidence.map(item => `<div><dt>${esc(item.title)}${item.ok === false ? ' · 미확인' : ''}</dt><dd>${esc(item.summary)}</dd></div>`).join('')}</dl>` : '')
    + reviewDetailsHtml(brief.review)
    + section('담당자 확인사항', brief.nextActions, 'ask-next-actions')
    + section('아직 없는 판단 근거', brief.missingData, 'ask-missing-data')
    + '<p class="small">담당자 검토를 돕는 확인사항이며, 현장 점검이나 최종 결정을 대신하지 않습니다.</p></details>';
}

/** 사용자 제안과 공공자료의 출처를 섞지 않고, 회의에서 쓸 비교 항목을 보여 준다. */
export function reviewDetailsHtml(review) {
  if (!review) return '';
  const list = items => (Array.isArray(items) ? items : []).map(item => `<li>${esc(item)}</li>`).join('');
  return '<div class="civic-result">'
    + (review.inputText ? `<details class="civic-input-source"><summary>사용자 제공 검토내용</summary><p>${esc(review.inputText)}</p><small>입력한 의견·상황입니다. 공식 자료로 검증한 내용은 아닙니다.</small></details>` : '')
    + (review.scopeNote ? `<p class="small">${esc(review.scopeNote)}</p>` : '')
    + (review.sourceScope ? `<p class="small">${esc(review.sourceScope)}</p>` : '')
    + (review.commonCriteria?.length ? `<details class="ask-details"><summary>대안을 함께 살펴볼 기준</summary><ul>${list(review.commonCriteria)}</ul></details>` : '')
    + (review.alternatives?.length ? `<section><h3>대안별 확인사항</h3>${review.alternativeNotice ? `<p class="small">${esc(review.alternativeNotice)}</p>` : ''}<div class="civic-alternatives">${review.alternatives.map(item => `<article><header><strong>${esc(item.title)}</strong><small>${item.origin === 'user' ? '사용자 입력' : '검토 예시'}</small></header>${item.focus ? `<p>${esc(item.focus)}</p>` : ''}<ul>${list(item.checks)}</ul></article>`).join('')}</div></section>` : '')
    + (review.departments?.length ? `<details class="ask-details"><summary>부서 협의 준비</summary><p class="small">업무 분야별 확인안입니다. 실제 소관 부서는 조직·사무분장을 확인하세요.</p><dl class="civic-departments">${review.departments.map(item => `<div><dt>${esc(item.name)}</dt><dd><ul>${list(item.checks)}</ul></dd></div>`).join('')}</dl></details>` : '')
    + (review.discussionQuestions?.length ? `<details class="ask-details"><summary>회의에서 확인할 질문</summary><ul>${list(review.discussionQuestions)}</ul></details>` : '')
    + (review.missingData?.length ? `<details class="ask-details"><summary>추가로 확보할 자료</summary><ul>${list(review.missingData)}</ul></details>` : '')
    + '</div>';
}

/** Brief comes from actual retrieval; never recast a free-form AI statement as verified data. */
export function answerSummaryHtml(view) {
  const result = view.result || {};
  const unavailableScope = unavailableQuestionScope(view);
  const evidence = (result.brief?.evidence || []).filter(item => item.ok !== false && item.summary).slice(0, 2);
  const successfulSteps = (result.steps || []).filter(item => item.ok !== false && item.summary).slice(0, 2);
  const facts = evidence.length ? evidence.map(item => `${item.title}: ${item.summary}`) : successfulSteps.map(item => item.summary);
  if (!facts.length) facts.push(`수록 자료의 결과 지점 ${(view.features || []).length}곳 · 연결한 출처 ${(result.sources || []).length}개. 지역 전체 현황을 뜻하지 않습니다.`);
  const missing = unavailableScope ? [unavailableScope === 'different-region' ? '질문에 나온 다른 지역의 자료를 현재 지역 자료와 섞어 조회하지 않았습니다.' : '질문한 분야의 공식 자료와 기준일이 현재 지역에 연결되어 있지 않습니다.'] : [...new Set([...(result.brief?.missingData || []), ...(result.brief?.review?.missingData || [])])].slice(0, 2);
  if (!missing.length) missing.push(spaceQuestion(view) ? '실제 운영조건·예약·법정공휴일·정원은 담당자 확인이 필요합니다.' : '원자료 기준일 이후의 변동과 현장 상태는 별도 확인이 필요합니다.');
  const next = unavailableScope ? unavailableScope === 'different-region' ? '지역 메뉴에서 현재 적용할 수 있는 지역을 확인하고, 해당 지역으로 전환해 질문하세요.' : '현재 지역에 연결한 자료 범위를 확인한 뒤 질문을 수정하세요.' : result.brief?.nextActions?.[0] || (spaceQuestion(view) ? '질문의 요일·시간을 확인한 뒤 실제 공간을 선택해 현재 현황과 변경안을 비교하세요.' : '결과 지점을 지도에서 확인하고 필요한 현장 확인사항을 검토노트에 남기세요.');
  const action = unavailableScope ? `<button class="primary ask-prepare" data-action="${unavailableScope === 'different-region' ? 'region-chooser' : 'region-info'}">${unavailableScope === 'different-region' ? '적용할 지역 확인 →' : '현재 지역 자료 범위 확인 →'}</button>` : spaceQuestion(view) ? '<button class="primary ask-prepare" data-action="ask-prepare-space">이 조건으로 비교 준비 →</button>' : '<button class="primary ask-prepare" data-action="civic-save-result">검토노트에 저장</button>';
  const sources = (result.sources || []).map(source => `<span>${sourceUrl(source) ? `<a href="${esc(sourceUrl(source))}" target="_blank" rel="noopener noreferrer">${esc(source.name)} ↗</a>` : esc(source.name)} · ${esc(dateText(source))}</span>`).join('');
  return `<section class="ask-decision-summary" aria-label="검토 핵심"><div><h3>자료로 확인한 사실</h3><ul>${facts.map(value => `<li>${esc(value)}</li>`).join('')}</ul></div><div><h3>아직 확인할 핵심</h3><ul>${missing.map(value => `<li>${esc(value)}</li>`).join('')}</ul></div><div><h3>다음 행동</h3><p>${esc(next)}</p>${action}</div></section><div class="ask-source-strip" aria-label="출처와 기준일"><strong>출처·기준일</strong>${sources || '<span>제공되지 않음 · 원자료 확인 필요</span>'}</div>`;
}

/** 답 영역 HTML. status: idle | loading | done | error */
export function answerHtml(view) {
  if (view.status === 'loading') {
    return '<div class="ask-status" role="status"><span class="ask-spinner" aria-hidden="true"></span><div><strong>자료 조회와 AI 응답을 기다리고 있습니다.</strong><small>응답이 도착하면 실제 조회 결과와 AI 사용 여부를 보여 드립니다.</small></div></div>';
  }
  if (view.status === 'error') {
    return `<section class="ask-error"><p class="note warning" role="alert">${esc(view.error)}</p><p class="small">입력한 질문: ${esc(view.question)}</p><div class="ask-export-actions"><button class="primary" data-action="ask-retry">같은 질문 다시 시도</button>${spaceQuestion(view) ? '<button class="secondary" data-action="ask-prepare-space">조건으로 공간 검토 이어가기</button>' : '<button class="secondary" data-action="ask-ai">질문 수정</button>'}</div></section>`;
  }
  if (view.status !== 'done') return '';
  const result = view.result;
  const notice = result.mode === 'rules'
    ? `<p class="small ask-notice">${esc(MODE_NOTICES[result.code] || result.notice || 'AI 설명 없이 수록 자료를 직접 계산한 결과입니다.')}</p>` : '';
  const queried = (result.steps || []).filter(step => step.ok !== false).length;
  const failed = (result.steps || []).filter(step => step.ok === false).length;
  const summary = `<div class="ask-result-summary" aria-label="실제 조회 결과"><span>조회 완료 <b>${queried}건</b></span><span>출처 <b>${(result.sources || []).length}개</b></span><span>결과 지점 <b>${(view.features || []).length}곳</b></span></div>`;
  return `<article class="ask-answer"><header><span class="ask-question-echo">${esc(view.question)}</span>${badgeHtml(result)}</header>`
    + `<p class="small ask-query-scope">질문 당시 선택 구역: ${esc(view.queryScope || view.regionName || '선택 지역 전체')}</p>${view.restored ? `<p class="small ask-notice">저장한 결과를 열었습니다. 작성: ${esc(view.completedAt || '미기록')} · 현재 자료로 다시 조회한 결과가 아닙니다.</p>` : ''}${summary}${failed ? `<p class="small ask-notice">조회하지 못한 항목 ${failed}건은 아래 근거에서 확인하세요.</p>` : ''}`
    + `${answerSummaryHtml(view)}<details class="ask-details ask-full-answer"${String(result.answer || '').length <= 400 ? ' open' : ''}><summary>${result.mode === 'llm' ? 'AI 설명 전체' : '규칙 기반 조회 결과 전체'}</summary><p class="ask-text">${esc(result.answer)}</p>${notice}${result.mode === 'llm' ? `${ANALYSIS_ROLES[result.analysisPath] ? `<p class="small ask-ai-role">${esc(ANALYSIS_ROLES[result.analysisPath])}</p>` : ''}<p class="small">응답 모델: ${esc(result.model || '미기록')}${result.modelRecovered ? ' · 사용 가능한 모델로 자동 복구' : ''}</p>` : ''}</details>`
    + `<div class="ask-export-actions">${portableRegion(view) ? '' : '<button class="primary" data-action="civic-save-result">검토노트에 저장</button>'}<button class="secondary" data-action="ask-copy">검토메모 복사</button><button class="secondary" data-action="ask-download">검토메모 저장</button></div></article>`
    + briefHtml(result.brief)
    + listHtml(view.features || [], view.drawn || 0, view)
    + evidenceHtml(result);
}

export function panelHtml(view, scopeLabel) {
  const chips = examplesFor(view).map((text, index) => `<button class="ask-chip" data-action="ask-example" data-id="${index}">${esc(text)}</button>`).join('');
  return '<div class="ask-panel">'
    + '<div class="ask-intro"><strong>질문하면, 자료와 위치가 함께 나옵니다.</strong><p>마을의제부터 생활시설·현장 점검까지, 자료와 확인할 일을 함께 살펴보세요.</p></div>'
    + `<div class="civic-inline-links"><button class="text-button" data-action="${view.question && !unavailableQuestionScope(view) ? 'ask-prepare-space' : 'space-twin'}">공공공간 운영안 비교</button>${portableRegion(view) ? '<button class="text-button" data-action="region-info">현재 지역 자료 확인</button>' : '<button class="text-button" data-action="civic-review">마을·공간 검토</button><button class="text-button" data-action="civic-notes">저장한 검토노트</button>'}</div>`
    + `<p class="ask-scope">${portableRegion(view) ? '<b>선택 지역의 수록 공공공간 자료</b>를 근거로 답합니다. AI 사용 여부·출처·기준일을 결과에서 확인하세요.' : '<b>수록 공간자료</b>와 필요한 경우 조회한 <b>기상청 관측</b>을 근거로 답합니다. AI 사용 여부·출처·기준일과 관측시각을 결과에서 확인하세요.'}</p>`
    + (view.reviewContext ? `<div class="civic-context"><strong>${esc(THEME_TITLES[view.reviewContext.theme] || '마을·공간')} 검토를 이어갑니다.</strong><span>아래 질문에는 앞서 입력한 검토내용을 함께 사용합니다.</span><div class="civic-inline-links"><button class="text-button" data-action="civic-edit-context">입력 수정</button><button class="text-button" data-action="ask-new-question">새 질문으로 전환</button></div></div>` : '')
    + `<div class="ask-form"><label class="ask-label" for="ask-question">${view.reviewContext ? '이 검토에 이어서 질문' : '질문'}</label>`
    + `<div class="ask-row"><input id="ask-question" type="text" maxlength="${MAX_QUESTION}" autocomplete="off" enterkeyhint="search" placeholder="${esc(view.regionId === 'suncheon' ? '예: 장천동 토요일 10~12시 모임 공간 검토해줘' : '예: 토요일 10~12시 주민 모임 공간 검토해줘')}" value="${esc(view.draft || '')}">`
    + `<button class="primary" id="ask-submit" data-action="ask-submit"${view.status === 'loading' ? ' disabled' : ''}>묻기</button></div>`
    + `<p class="small ask-context">현재 선택 구역: <b id="ask-scope-name">${esc(scopeLabel)}</b> · 질문에 동 이름이 없으면 이 구역을 기준으로 합니다.</p></div>`
    + `<details class="ask-examples"${view.status === 'idle' ? ' open' : ''}><summary>이렇게 물어보세요</summary><div class="ask-chips" role="group" aria-label="예시 질문">${chips}</div></details>`
    + `<div id="ask-output" class="ask-output" aria-live="polite">${answerHtml(view)}</div>`
    + '</div>';
}

/* ───────────────────────── 설치 ───────────────────────── */

export function installAskAi(api) {
  const state = api.state;
  const view = {status: 'idle', draft: '', question: '', result: null, error: '', features: [], drawn: 0, mapReady: false, mapApplied: false, mapCleared: false, mapDeferred: false, queryScope: '', dongId: 'all', completedAt: '', reviewContext: null, restored: false, regionId: state.regionProfile?.id || '', regionName: state.regionProfile?.name || ''};
  const asked = []; // 이번 방문에서 한 질문(다음 질문의 문맥으로 최근 3개만 보낸다)
  let sequence = 0;
  let applyingMap = false;
  let lastScope = state.dong;
  let requestController = null;

  const open = () => state.view === VIEW;
  const input = () => document.getElementById('ask-question');
  const quickInput = document.getElementById('ask-quick-question');
  const quickForm = document.getElementById('ask-quick-form');
  const quickButton = document.getElementById('ask-quick-submit');

  function syncQuick() {
    view.regionId = state.regionProfile?.id || '';
    view.regionName = state.regionProfile?.name || '';
    const loading = view.status === 'loading';
    quickForm?.setAttribute('aria-busy', String(loading));
    if (quickButton) {
      quickButton.disabled = loading;
      quickButton.innerHTML = loading ? '<span class="ask-spinner" aria-hidden="true"></span><span>조회 중</span>' : '묻기 <span aria-hidden="true">↗</span>';
    }
    const scope = api.label();
    const hint = document.getElementById('ask-quick-hint');
    if (hint) hint.textContent = `${scope}의 수록 자료를 기준으로 답합니다. 질문에 동 이름을 쓰면 해당 동을 조회합니다.`;
    if (quickInput) quickInput.placeholder = state.dong === 'all' ? `${view.regionName || '선택 지역'}에서 토요일 10~12시 모임 공간 검토해줘` : `${scope}, 무엇을 살펴볼까요?`;
  }

  function render({scroll = true} = {}) {
    syncQuick();
    if (!open()) return;
    const output = document.getElementById('ask-output');
    if (output) output.innerHTML = answerHtml(view);
    const button = document.getElementById('ask-submit');
    if (button) button.disabled = view.status === 'loading';
    // 답을 그리면서 구역이 바뀌었을 수 있다(예: 서구 전체 → 풍암동).
    const scope = document.getElementById('ask-scope-name');
    if (scope) scope.textContent = api.label();
    if (view.status !== 'idle') document.querySelector('.ask-examples')?.removeAttribute('open');
    // 답이 나오면 예시 단추 아래로 가려지지 않게 답 위치로 스크롤한다.
    // (scrollIntoView 는 화면 전체를 밀 수 있어 패널 본문만 직접 움직인다.)
    const host = document.getElementById('detail-body');
    if (scroll && view.status !== 'idle' && output && host) host.scrollTop += output.getBoundingClientRect().top - host.getBoundingClientRect().top - 10;
  }

  function show({focus = true} = {}) {
    syncQuick();
    if (view.status === 'done' && !view.mapApplied && !view.mapDeferred && !view.mapCleared) view.drawn = applyMap(view.result.map);
    else if (view.mapApplied && !view.mapDeferred && !view.mapCleared) {
      view.mapReady = !!state.ready;
      view.drawn = state.ready ? api.scoped(ASK_LAYER).length : 0;
    }
    api.show('지도에게 묻기', panelHtml(view, api.label()), VIEW);
    const eyebrow = document.getElementById('detail-eyebrow');
    if (eyebrow) eyebrow.textContent = '질문 → 자료 분석 → 지도·검토메모';
    syncQuick();
    if (focus && innerWidth > 820) input()?.focus();
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
    applyingMap = true;
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
      if (camera && state.ready) fly(camera);
      view.mapReady = !!state.ready;
      view.mapApplied = true;
      view.mapCleared = false;
      view.mapDeferred = false;
      return state.ready ? api.scoped(ASK_LAYER).length : 0;
    } catch {
      view.mapReady = false;
      return 0; // 지도 엔진 문제로 그리지 못해도 목록은 패널에 남긴다.
    } finally {
      applyingMap = false;
    }
  }

  async function ask(question, reviewContext = null) {
    if(!state.regionProfile||!state.scope){api.toast('지역 자료 준비가 끝난 뒤 질문하세요.');return;}
    const text = String(question || '').replace(/\s+/g, ' ').trim();
    if (!text) { api.toast('질문을 입력하세요.'); input()?.focus(); return; }
    if (text.length > MAX_QUESTION) { api.toast(`질문은 ${MAX_QUESTION}자 이하로 적어 주세요.`); return; }
    if (view.status === 'loading') { if (!open()) show({focus: false}); return; }
    const token = ++sequence;
    const requestScope = state.dong;
    const context = reviewContext ? JSON.parse(JSON.stringify(reviewContext)) : null;
    if (JSON.stringify(context) !== JSON.stringify(view.reviewContext)) asked.length = 0;
    Object.assign(view, {status: 'loading', question: text, draft: text, result: null, error: '', features: [], drawn: 0, mapReady: false, mapApplied: false, mapCleared: false, mapDeferred: false, queryScope: api.label(), dongId: requestScope, completedAt: '', reviewContext: context, restored: false});
    if (quickInput) quickInput.value = text;
    if (input()) input().value = text;
    clearMap();
    show({focus: false});
    render();
    requestController = new AbortController();
    const timeout = setTimeout(() => requestController?.abort('timeout'), 35000);
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: text, regionId: state.regionProfile.id, dongId: requestScope === 'all' ? undefined : requestScope, history: asked.slice(-3).map(q => ({role: 'user', text: q})), ...(context ? {reviewContext: context} : {})}),
        signal: requestController.signal,
      });
      let body = null;
      try { body = await response.json(); } catch { /* 아래에서 형식 오류로 처리 */ }
      if (token !== sequence) return;
      if (!response.ok || !body?.ok) throw Error(body?.error || (response.status === 429 ? '질문이 많습니다. 잠시 후 다시 시도하세요.' : '답을 받지 못했습니다. 잠시 후 다시 시도하세요.'));
      if (!view.mapDeferred) asked.push(text);
      if (asked.length > 3) asked.shift();
      view.result = body;
      view.status = 'done';
      view.completedAt = new Date().toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) + ' (한국시간)';
      view.features = highlightFeatures(body.map);
      view.drawn = open() && !view.mapDeferred ? applyMap(body.map) : 0;
    } catch (error) {
      if (token !== sequence) return;
      view.status = 'error';
      view.error = requestController?.signal.aborted ? '응답이 늦어 중단했습니다. 잠시 후 다시 시도하세요.' : (error?.message || '답을 받지 못했습니다.');
    } finally {
      clearTimeout(timeout);
      if (token === sequence) requestController = null;
    }
    render();
  }

  function scopeChanged() {
    if (lastScope !== state.dong) {
      lastScope = state.dong;
      if (!applyingMap) {
        asked.length = 0;
        if (view.status === 'loading' || view.status === 'done') view.mapDeferred = true;
      }
    }
    if (!applyingMap) render({scroll: false});
  }

  function downloadMemo() {
    const memo = reviewMemo(view);
    if (!memo) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', memo], {type: 'text/plain;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `서구온_검토메모_${new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'})}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    api.toast('출처와 확인사항을 포함한 검토메모를 저장했습니다.');
  }

  function getReviewSnapshot() {
    if (view.status !== 'done' || !view.result) return null;
    return JSON.parse(JSON.stringify({question: view.question, queryScope: view.queryScope, dongId: view.dongId, completedAt: view.completedAt, reviewContext: view.reviewContext, result: view.result}));
  }

  function restoreReview(note) {
    if (!note?.result) return;
    sequence++; requestController?.abort('restore'); requestController = null; asked.length = 0;
    clearMap();
    const safe = JSON.parse(JSON.stringify(note));
    Object.assign(view, {status: 'done', draft: '', question: safe.question, queryScope: safe.queryScope, dongId: safe.dongId || 'all', completedAt: safe.completedAt,
      reviewContext: safe.reviewContext || null, result: safe.result, error: '', features: highlightFeatures(safe.result.map), drawn: 0, mapApplied: false, mapCleared: false, mapDeferred: false, restored: true});
    applyingMap = true;
    try {
      if (safe.dongId === 'all' || state.dongs.some(f => f.properties.dongId === safe.dongId)) api.chooseDong(safe.dongId);
    } finally { applyingMap = false; }
    show({focus: false});
    render();
  }

  const offs = [
    registerAction('ask-ai', () => show()),
    registerAction('ask-submit', () => ask(input()?.value, view.reviewContext)),
    registerAction('ask-retry', () => ask(view.question, view.reviewContext)),
    registerAction('ask-prepare-space', () => unavailableQuestionScope(view) ? api.run(unavailableQuestionScope(view) === 'different-region' ? 'region-chooser' : 'region-info') : api.run('space-from-question', {question: view.question || view.draft, regionId: view.regionId, dongId: state.dong})),
    registerAction('ask-new-question', () => {
      if (view.status === 'loading') { api.toast('현재 조회가 끝난 뒤 새 질문을 시작할 수 있습니다.'); return; }
      clearMap(); asked.length = 0;
      Object.assign(view, {status: 'idle', reviewContext: null, draft: '', question: '', result: null, features: [], restored: false});
      show();
    }),
    registerAction('ask-example', button => {
      const text = examplesFor(view)[Number(button.dataset.id)];
      if (!text) return;
      if (input()) input().value = text;
      return ask(text);
    }),
    registerAction('ask-clear', () => { clearMap(); view.drawn = 0; view.mapCleared = true; view.mapApplied = false; render({scroll: false}); }),
    registerAction('ask-show-map', () => api.close()),
    registerAction('ask-restore-map', () => {
      if (!view.result) return;
      view.drawn = applyMap(view.result.map);
      render({scroll: false});
      if (!state.ready) { api.toast('지도 연결 전입니다. 지도 모드를 연결하면 결과 위치를 볼 수 있습니다.'); return; }
      if (innerWidth <= 820) api.close();
    }),
    registerAction('ask-copy', async () => {
      const memo = reviewMemo(view);
      if (!memo) return;
      try { await navigator.clipboard.writeText(memo); api.toast('출처와 확인사항까지 검토메모를 복사했습니다.'); }
      catch { api.toast('복사 권한을 확인하거나 ‘검토메모 저장’을 이용하세요.'); }
    }),
    registerAction('ask-download', downloadMemo),
    registerAction('ask-point', button => {
      const feature = view.features.find(f => f.properties.id === button.dataset.id);
      if (!state.ready) { api.toast('지도가 연결되면 해당 위치로 이동할 수 있습니다.'); return; }
      if (feature) fly(boxAround(feature.geometry.coordinates, 120));
    }),
  ];

  // Enter 로 묻기(한글 조합 중의 Enter 는 글자 확정이므로 건너뛴다). 입력 중인 글은 패널을 다시 열어도 남긴다.
  const body = document.getElementById('app');
  const onKey = event => {
    if (!['ask-question', 'ask-quick-question'].includes(event.target?.id) || event.key !== 'Enter') return;
    event.preventDefault();
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
    ask(event.target.value, event.target.id === 'ask-question' ? view.reviewContext : null);
  };
  const onInput = event => {
    if (!['ask-question', 'ask-quick-question'].includes(event.target?.id)) return;
    view.draft = event.target.value;
    const other = event.target.id === 'ask-question' ? quickInput : input();
    if (other && other.value !== view.draft) other.value = view.draft;
  };
  const onSubmit = event => { event.preventDefault(); ask(quickInput?.value); };
  body?.addEventListener('keydown', onKey);
  body?.addEventListener('input', onInput);
  quickForm?.addEventListener('submit', onSubmit);
  syncQuick();

  return {ask, show, clearMap, scopeChanged, getReviewSnapshot, restoreReview, getReviewContext: () => view.reviewContext ? JSON.parse(JSON.stringify(view.reviewContext)) : null, destroy() { sequence++; requestController?.abort('destroy'); offs.forEach(off => off()); body?.removeEventListener('keydown', onKey); body?.removeEventListener('input', onInput); quickForm?.removeEventListener('submit', onSubmit); }};
}
