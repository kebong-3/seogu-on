/** 실제 공공공간의 현황 확인 → 변경안 비교 → 결과 보관. */
import {registerAction} from './actions.js';
import {esc} from './catalog.js';
import {inside} from './geometry.js';
import {frameFor} from './camera.js';
import {seedAssets, createWorkspace, recordObservation, upsertScenario, compareWorkspace,
  serializeWorkspace, parseWorkspace, saveSnapshot, diffSnapshots, mergeWorkspaces, dataFingerprint} from '../../shared/space-twin-model.js';

const VIEW = 'space-twin';
const MAP_LAYER = 'space-twin-candidates';
const MAX_SELECTED = 10;
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const STATUS = {open: '운영', closed: '운영하지 않음', unknown: '미확인'};
const PROVENANCE = {'field-record': '사용자 현장 확인', 'unverified-source': '현황 미확인', 'stale-record': '재확인 기한 경과', 'user-assumption': '입력한 변경 가정'};
const AVAILABILITY = {eligible: '요청 시간 개방 조건 충족', unavailable: '요청 조건에 맞지 않음', unknown: '확인 필요'};
const dateNow = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'});
const timeText = value => value ? new Date(value).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) : '미기록';
const amount = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('ko-KR')}만원` : '미산정';
const number = value => typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '미산정';
const safeUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const sourceLink = asset => {
  const href = safeUrl(asset.source?.url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">원자료 확인 ↗</a>` : '<span>원자료 링크 미제공</span>';
};
const dayNames = days => (days || []).map(day => DAYS[day - 1]).filter(Boolean).join('·') || '요일 미확인';
const scheduleText = value => !value ? '현장 확인 전' : value.operatingStatus === 'closed' ? '운영하지 않음' : value.operatingStatus === 'unknown' ? '운영 상태 미확인' : `${dayNames(value.daysOfWeek)} ${value.opens || '?'}–${value.closes || '?'}`;
const button = (action, text, attrs = '', kind = 'secondary') => `<button type="button" class="${kind}" data-action="${action}" ${attrs}>${text}</button>`;
const localNote = '<p class="space-local-note">확인 기록·변경안·저장한 비교는 이 브라우저에 보관합니다. 공식 원자료를 바꾸지 않습니다. 다른 기기에서 이어가려면 JSON 백업을 사용하세요.</p>';

/** Ignore server bookkeeping dates/revisions, but require identical source data and calculation facts. */
export function sameSpaceComparison(left, right) {
  try {
    const facts = comparison => ({regionId: comparison.regionId, assetFingerprint: comparison.assetFingerprint, query: comparison.query, baseline: comparison.baseline, alternatives: comparison.alternatives});
    return dataFingerprint(facts(left)) === dataFingerprint(facts(right));
  } catch { return false; }
}

function dayChecks(prefix, value = []) {
  return `<fieldset class="space-days"><legend>운영 요일</legend><div>${DAYS.map((name, index) => `<label><input type="checkbox" name="${prefix}-days" value="${index + 1}"${value.includes(index + 1) ? ' checked' : ''}><span>${name}</span></label>`).join('')}</div></fieldset>`;
}

function scheduleFields(prefix, value = {}, proposed = false) {
  return `<label for="${prefix}-status">${proposed ? '변경할 운영 상태' : '확인한 운영 상태'}</label><select id="${prefix}-status">${Object.entries(STATUS).map(([id, name]) => `<option value="${id}"${(value.operatingStatus || 'unknown') === id ? ' selected' : ''}>${name}</option>`).join('')}</select>`
    + dayChecks(prefix, value.daysOfWeek)
    + `<div class="space-two-fields"><div><label for="${prefix}-opens">개방 시작</label><input id="${prefix}-opens" type="time" value="${esc(value.opens || '')}"></div><div><label for="${prefix}-closes">개방 종료</label><input id="${prefix}-closes" type="time" value="${esc(value.closes || '')}"></div></div><p class="space-hint">운영하는 경우 요일과 같은 날의 시작·종료 시간을 적어 주세요. 심야·휴일 예외는 별도 확인이 필요합니다.</p>`;
}

export function spaceComparisonHtml(comparison) {
  if (!comparison) return '<p class="space-empty">공간과 검토 시간을 정한 뒤 비교하세요.</p>';
  const baseline = comparison.baseline || {};
  const alternatives = comparison.alternatives || [];
  const columns = [{...baseline, name: '현재 확인한 현황', baseline: true}, ...alternatives];
  const metric = (label, fn) => `<tr><th scope="row">${label}</th>${columns.map(column => `<td>${fn(column)}</td>`).join('')}</tr>`;
  return `<div class="space-table-wrap" tabindex="0" role="region" aria-label="현재 현황과 변경안 비교표"><table class="space-comparison"><caption>같은 요일·시간·공간으로 비교</caption><thead><tr><th scope="col">검토 항목</th>${columns.map(column => `<th scope="col">${esc(column.name || '변경안')}<small>${column.baseline ? '담당자 확인 기준' : '입력한 변경 가정'}</small></th>`).join('')}</tr></thead><tbody>`
    + metric('요청 시간 개방 조건 충족', column => `${number(column.eligibleCount)}개`)
    + metric('운영 조건 미확인', column => `${number(column.unknownCount)}개`)
    + metric('요청 조건에 맞지 않음', column => `${number(column.unavailableCount)}개`)
    + metric('공간별 겹치는 개방시간 합계', column => `${number(column.overlapHours)}시간`)
    + metric('추가 연간 운영비', column => column.baseline ? '비교 기준' : amount(column.additionalAnnualCost))
    + '</tbody></table></div><p class="space-hint">시간 합계는 선택한 각 공간의 겹치는 운영시간을 더한 값입니다. 이용 인원·예약 가능 여부·실제 편익을 뜻하지 않습니다. 비용은 입력한 추가 연간 운영비 가정입니다.</p>'
    + alternatives.map(alternative => `<p class="space-result-note"><strong>${esc(alternative.name || '변경안')}</strong> · ${alternative.comparable && alternative.delta ? `같은 확인 범위의 개방 조건 충족 공간 변화: ${Number(alternative.delta.eligibleCount) > 0 ? '+' : ''}${number(alternative.delta.eligibleCount)}개.` : '미확인 상태 또는 비교 범위가 있어 개선량 판정을 보류합니다. 현재값과 변경 가정을 각각 확인하세요.'}</p>`).join('');
}

function rowsHtml(comparison) {
  if (!comparison?.baseline?.rows) return '';
  return `<details class="space-details"><summary>공간별 계산 근거·출처</summary>${[comparison.baseline, ...comparison.alternatives].map(metric => `<h3>${esc(metric.name)}</h3><ul class="space-evidence-list">${metric.rows.map(row => {
    const source = comparison.sources.find(item => item.assetId === row.assetId) || {};
    return `<li><strong>${esc(row.name)}</strong><span>${esc(AVAILABILITY[row.availability])} · ${esc(PROVENANCE[row.provenance])}</span><p>${esc(row.reason)}<br>${esc(scheduleText(row))}</p>${row.observedOn ? `<p>확인일 ${esc(row.observedOn)}${row.evidence ? ` · ${esc(row.evidence)}` : ''}</p>` : ''}${typeof row.distanceM === 'number' ? `<p>기준점에서 직선거리 ${Math.round(row.distanceM)}m</p>` : ''}<p>공개자료: ${esc(source.name || '출처 미제공')} · ${esc(source.date || '기준일 미제공')}<br>${sourceLink({source})}</p></li>`;
  }).join('')}</ul>`).join('')}</details>`;
}

/** Render only the immutable calculation, so a historical report never uses today's observations. */
export function spaceReportHtml({profile, comparison, ai = null}) {
  const query = comparison?.query || {};
  const rows = comparison?.baseline?.rows || [];
  const sourceRows = rows.map(row => {
    const source = comparison.sources.find(item => item.assetId === row.assetId) || {};
    return `<tr><td>${esc(row.name)}<br><small>${esc(row.assetId)}</small></td><td>${esc(PROVENANCE[row.provenance])}<br>${esc(scheduleText(row))}<br>${esc(row.observedOn || '확인일 미기록')}<br>${esc(row.reason)}</td><td>${esc(row.evidence || '현장 근거 미기록')}</td><td>${esc(source.name || '출처 미제공')}<br>${esc(source.date || '기준일 미제공')}<br>${sourceLink({source})}</td></tr>`;
  }).join('');
  const alternatives = (comparison?.alternatives || []).map(metric => `<h3>${esc(metric.name)}</h3><p>추가 연간 운영비 가정 합계: ${amount(metric.additionalAnnualCost)}${metric.costComplete ? '' : ' · 일부 또는 전체 공간의 비용 미입력'}</p><ul>${metric.rows.filter(row => row.provenance === 'user-assumption').map(row => `<li>${esc(row.name)} · ${esc(scheduleText(row))} · ${esc(row.reason)}</li>`).join('')}</ul><p>${esc(metric.note || '')}</p>`).join('') || '<p>비교에 포함한 변경안 없음</p>';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'"><title>공공공간 활용 검토보고서</title><style>body{max-width:1000px;margin:40px auto;padding:0 24px;color:#16324b;background:white;font:15px/1.7 system-ui,sans-serif}h1{font-size:26px}h2{font-size:19px;margin-top:30px}p,li,td,th{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #b9c9d7;padding:9px;text-align:left;vertical-align:top}th{background:#eef4fa}small{display:block;font-size:11px}caption{text-align:left;font-weight:bold;margin-bottom:8px}.space-hint,.note{color:#4a6175;font-size:13px}.space-result-note{border-left:3px solid #1768c5;padding:8px 12px}.print-help{padding:12px;background:#eef4fa}pre{white-space:pre-wrap;font:inherit}@media print{body{margin:0;padding:0;max-width:none}.print-help{display:none}tr{break-inside:avoid}h2{break-after:avoid}@page{size:A4;margin:16mm}}</style></head><body><p>${esc(profile?.name || comparison?.regionId || '선택 지역')} · 서구온 공공공간 활용</p><h1>공공공간 활용 검토보고서</h1><p class="print-help">브라우저 인쇄에서 종이 또는 PDF로 저장할 수 있습니다.</p><p>계산 시각: ${esc(timeText(comparison?.generatedAt))} (한국시간)<br>검토 조건: ${esc(DAYS[query.dayOfWeek - 1] || '선택 요일')}요일 ${esc(query.start || '')}–${esc(query.end || '')} · 선택 공간 ${rows.length}개</p><p class="note">계산 당시의 공개자료·담당자 확인 기록·변경 가정을 담은 행정 검토자료입니다. 공식 원자료를 변경하지 않으며 수요·수혜 인원·최적 입지·사업효과를 예측하지 않습니다.</p><h2>1. 현재 현황과 변경안</h2>${spaceComparisonHtml(comparison)}<h2>2. 선택 공간·현장 확인·원자료</h2><table><thead><tr><th>공간</th><th>계산 당시 확인 상태</th><th>확인 근거</th><th>공개 원자료</th></tr></thead><tbody>${sourceRows}</tbody></table><h2>3. 변경안의 가정</h2>${alternatives}${ai?.answer ? `<h2>4. ${ai.mode === 'llm' ? 'AI 설명' : '계산 근거 요약'}</h2><pre>${esc(ai.answer)}</pre><p class="note">${esc(ai.model || '')} ${esc(ai.notice || '')}</p>` : ''}<h2>확인할 사항</h2><ul><li>현장 확인의 유효기간·실제 이용 조건·휴관 및 예약 여부</li><li>개방에 필요한 인력·보안·관리 책임과 실제 소관 업무</li><li>입력 비용의 산정 근거와 주민 이용 수요</li><li>원자료 기준일과 누락 가능성, 대표좌표와 실제 출입구의 차이</li></ul><h2>계산의 범위</h2><ul>${(comparison?.limitations || []).map(value => `<li>${esc(value)}</li>`).join('')}</ul><p class="note">계산 자료 식별값: ${esc(comparison?.fingerprint || '미기록')} · 현황 기록 버전 ${esc(comparison?.workspaceRevision ?? '미기록')}</p></body></html>`;
}

export function installSpaceTwin(api, options = {}) {
  const root = document.getElementById('app');
  let profile = null, assets = [], workspace = null, loading = null, storageError = '', destroyed = false;
  let selected = [], step = 'select', search = '', activeAssetId = '', editingScenarioId = '', lastComparison = null, restoredSnapshot = null, aiResult = null, aiLoading = false, controller = null, requestSequence = 0, importPreview = null, observationChange = null;
  let query = {dayOfWeek: 1, start: '18:00', end: '21:00'};
  const observationDrafts = new Map(), scenarioDrafts = new Map();
  let includedScenarios = new Set();

  const storageKey = () => `seoon.space-twin.v1.${profile.id}`;
  const getProfile = () => options.getRegion?.() || api.state.regionProfile || {id: 'seogu', name: '서구', facilitiesUrl: '/data/layers/public-facilities.geojson'};
  const openNow = () => api.state.view === VIEW;
  const findAsset = id => assets.find(asset => asset.id === id);
  const scopedAssets = () => assets.filter(asset => api.state.dong === 'all' || asset.dongId === api.state.dong || !asset.dongId && api.state.scope && inside(asset.coordinates, api.state.scope));
  const shownAssets = () => scopedAssets().filter(asset => !search.trim() || `${asset.name} ${asset.address} ${asset.dongName}`.toLocaleLowerCase('ko-KR').includes(search.trim().toLocaleLowerCase('ko-KR')));
  const draftKey = () => `${editingScenarioId || 'new'}::${activeAssetId}`;
  const calculationWorkspace = () => ({...workspace, scenarios: workspace.scenarios.filter(item => includedScenarios.has(item.id))});
  const missingScenarioAssets = () => [...new Set(calculationWorkspace().scenarios.flatMap(item => item.changes.map(change => change.assetId)))].filter(id => !selected.includes(id));
  function invalidate() { lastComparison = null; restoredSnapshot = null; aiResult = null; observationChange = null; requestSequence++; controller?.abort(); controller = null; aiLoading = false; }
  function persist(next) {
    if (storageError) throw Error('기존 저장 기록을 읽지 못해 덮어쓰지 않았습니다. 먼저 원본 백업을 보관하세요.');
    const serialized = serializeWorkspace(next);
    try { localStorage.setItem(storageKey(), serialized); } catch { throw Error('이 브라우저에 저장하지 못했습니다. 저장공간·브라우저 설정을 확인하세요. 기존 기록은 유지합니다.'); }
    workspace = next;
  }
  async function ensureLoaded() {
    const current = getProfile();
    if (workspace && profile?.id === current.id) return;
    if (loading) return loading;
    profile = current;
    loading = (async () => {
      const collection = options.loadAssets ? await options.loadAssets(profile) : await api.fetchJSON(profile.facilitiesUrl);
      assets = seedAssets(collection, {regionId: profile.id, datasetId: profile.facilityLayerId || 'public-facilities'});
      workspace = createWorkspace(profile.id); storageError = '';
      try { const saved = localStorage.getItem(storageKey()); if (saved) workspace = parseWorkspace(saved, {regionId: profile.id}); } catch (error) { storageError = error.message || '저장한 기록을 읽지 못했습니다.'; }
      selected = []; activeAssetId = ''; observationDrafts.clear(); scenarioDrafts.clear(); editingScenarioId = ''; includedScenarios = new Set(workspace.scenarios.map(item => item.id)); invalidate();
    })();
    try { await loading; } finally { loading = null; }
  }
  function drawCandidates() {
    if (!profile || !assets.length) return;
    const candidates = scopedAssets();
    api.state.entries.set(MAP_LAYER, {title: '공공공간 활용 후보', state: 'loaded', features: candidates.map(asset => ({type: 'Feature', geometry: {type: 'Point', coordinates: asset.coordinates}, properties: {id: asset.id, name: asset.name, category: 'building', sourceName: asset.source?.name, sourceUrl: asset.source?.url, sourceDate: asset.source?.date, note: selected.includes(asset.id) ? '공간 활용 검토에 선택함' : '공간 활용 검토 후보', displayColor: selected.includes(asset.id) ? '#1768c5' : '#e3ac45'}}))});
    api.state.enabled.add(MAP_LAYER); api.drawData();
  }
  function focusAsset(id) {
    const asset = findAsset(id); if (!asset) return;
    api.state.selected = {layer: MAP_LAYER, id}; api.state.isolate = false; api.drawData();
    api.send({type: 'camera', pose: frameFor({type: 'Point', coordinates: asset.coordinates}, 'facility', {width: Math.max(320, innerWidth - 740), height: Math.max(300, innerHeight - 190)})});
  }
  function selectedChips() {
    const scopeIds = new Set(scopedAssets().map(asset => asset.id)), outside = selected.filter(id => !scopeIds.has(id)).length;
    return `<div class="space-selected" aria-label="선택한 검토 공간">${selected.map(id => { const asset = findAsset(id); return `<span>${esc(asset?.name || id)}${button('space-remove', '×', `data-id="${esc(id)}" aria-label="${esc(asset?.name || id)} 검토 선택 해제"`, 'space-chip-remove')}</span>`; }).join('')}</div>${outside ? `<p class="space-hint">선택 목록에 현재 지도 구역 밖의 공간 ${outside}개이 포함되어 있습니다. 비교는 이 선택 목록을 기준으로 합니다.</p>` : ''}`;
  }
  function candidatesHtml() {
    const candidates = shownAssets();
    return `<p class="space-scope">${esc(api.label())} · 수록 공간 ${scopedAssets().length}개 · 선택 ${selected.length}/${MAX_SELECTED}개</p><p class="space-hint">지도의 지점이나 목록에서 실제 검토할 공간을 고르세요. 공개자료는 회의실·강당 등 개방 공간 단위이며 현재 운영은 별도 확인합니다.</p><label for="space-search">공간 찾기</label><input id="space-search" type="search" maxlength="120" value="${esc(search)}" placeholder="공간명·주소 검색"><div id="space-candidate-list"><ul class="space-candidate-list">${candidates.map(asset => `<li><button type="button" class="space-candidate ${selected.includes(asset.id) ? 'is-selected' : ''}" data-action="space-toggle" data-id="${esc(asset.id)}" aria-pressed="${selected.includes(asset.id)}"><strong>${esc(asset.name)}</strong><span>${esc(asset.dongName || '')} ${esc(asset.address || '주소 미제공')}</span><small>${selected.includes(asset.id) ? '선택됨' : '검토할 공간으로 선택'}</small></button>${button('space-focus', '지도에서 보기', `data-id="${esc(asset.id)}"`, 'space-text-button')}</li>`).join('') || '<li class="space-empty">이 조건에서 수록 공간을 찾지 못했습니다. 실제 시설이 없다는 뜻은 아닙니다. 다른 동이나 검색어를 확인하세요.</li>'}</ul></div>${selectedChips()}${button('space-step', '선택한 공간의 현황·변경안 확인 →', `data-step="state"${selected.length ? '' : ' disabled'}`, 'primary full')}`;
  }
  function observationForm(asset) {
    const value = observationDrafts.get(asset.id) || workspace.observations?.[asset.id] || {};
    return `<div class="space-source"><span class="space-badge">공개 원자료</span><strong>${esc(asset.name)}</strong><p>${esc(asset.rawHours || '원자료 운영시간 미제공')}</p><p>${esc(asset.source?.name || '출처 미제공')} · ${esc(asset.source?.date || '기준일 미제공')}</p>${sourceLink(asset)}</div><form id="space-observation-form"><h3>현재 운영조건 확인</h3><p class="space-hint">실제로 확인한 정보만 기록하세요. 확인 전 값은 비워 두고 변경안만 먼저 검토할 수도 있습니다.</p>${scheduleFields('space-observation', value)}<div class="space-two-fields"><div><label for="space-observation-date">현장·운영 확인일</label><input id="space-observation-date" type="date" max="${dateNow()}" value="${esc(value.observedOn || dateNow())}" required></div><div><label for="space-observation-valid">다시 확인할 날짜 <small>선택</small></label><input id="space-observation-valid" type="date" value="${esc(value.validUntil || '')}"></div></div><label for="space-observation-evidence">확인 근거</label><textarea id="space-observation-evidence" rows="3" maxlength="1000" required placeholder="예: 시설 운영 안내문 확인, 시설 담당부서와 운영조건 확인. 개인정보는 제외해 주세요.">${esc(value.evidence || '')}</textarea><p class="space-hint">확인일로부터 90일 또는 적어 둔 재확인 날짜가 지나면 비교에서 미확인으로 구분합니다.</p><button class="primary full" type="submit"${storageError ? ' disabled' : ''}>확인한 현황으로 저장·다시 계산</button></form>`;
  }
  function scenarioForm(asset) {
    const existing = workspace.scenarios.find(item => item.id === editingScenarioId);
    const scenarioDraft = scenarioDrafts.get(draftKey());
    const change = scenarioDraft?.assetId === asset.id ? scenarioDraft : existing?.changes.find(item => item.assetId === asset.id) || {};
    const value = {...change, operatingStatus: change.operatingStatus ?? 'open', daysOfWeek: change.daysOfWeek ?? [query.dayOfWeek], opens: change.opens === undefined ? query.start : change.opens, closes: change.closes === undefined ? query.end : change.closes};
    return `<details class="space-details space-scenario-details" open><summary>변경안 작성 <span class="space-badge">사용자 가정</span></summary><p class="space-hint">선택한 공간의 운영조건을 바꾼다면 어떻게 달라질지 계산합니다. 실제 적용이나 운영 승인을 뜻하지 않습니다.</p><form id="space-scenario-form"><label for="space-scenario-name">변경안 이름</label><input id="space-scenario-name" maxlength="80" required value="${esc(scenarioDraft?.name ?? existing?.name ?? `대안 ${workspace.scenarios.length + 1}`)}"><p class="space-scope">변경할 공간 <strong>${esc(asset.name)}</strong></p>${scheduleFields('space-scenario', value, true)}<label for="space-scenario-cost">이 공간의 추가 연간 운영비 <small>만원 · 모르면 비워 두기</small></label><input id="space-scenario-cost" type="number" min="0" max="100000000" step="0.01" inputmode="decimal" value="${change.additionalAnnualCost === null || change.additionalAnnualCost === undefined ? '' : esc(change.additionalAnnualCost)}" placeholder="미입력은 미산정"><label for="space-scenario-note">변경 이유·확인할 조건 <small>선택</small></label><textarea id="space-scenario-note" rows="2" maxlength="1000" placeholder="운영 인력·보안·예약 등의 협의 조건">${esc(scenarioDraft?.note ?? existing?.note ?? '')}</textarea><button class="primary full" type="submit"${storageError || !existing && workspace.scenarios.length >= 3 ? ' disabled' : ''}>${existing ? '이 대안에 공간 변경 반영' : '변경안 저장'}</button></form>${existing ? button('space-new-scenario', '별도 대안 작성', workspace.scenarios.length >= 3 ? 'disabled' : '', 'space-text-button') : ''}</details>`;
  }
  function scenarioList() {
    return `<div class="space-scenario-list"><h3>저장한 변경안 · ${workspace.scenarios.length}/3</h3>${workspace.scenarios.map(scenario => `<article><strong>${esc(scenario.name)}</strong><p>${scenario.changes.length}개 공간 변경 · ${esc(scenario.note || '별도 설명 없음')}</p><ul>${scenario.changes.map(change => `<li>${esc(findAsset(change.assetId)?.name || change.assetId)}<br>${esc(scheduleText(change))} · ${amount(change.additionalAnnualCost)}</li>`).join('')}</ul>${button('space-edit-scenario', '이 대안 수정·공간 추가', `data-id="${esc(scenario.id)}"`)}</article>`).join('') || '<p class="space-hint">같은 대안을 다시 열면 다른 선택 공간의 변경조건도 함께 추가할 수 있습니다.</p>'}</div>`;
  }
  function stateHtml() {
    if (!selected.length) return `<p class="space-empty">검토할 공간을 먼저 선택하세요.</p>${button('space-step', '공간 선택으로', 'data-step="select"')}`;
    if (!selected.includes(activeAssetId)) activeAssetId = selected[0];
    const asset = findAsset(activeAssetId);
    return `${selectedChips()}<label for="space-active-asset">현황·변경안을 입력할 공간</label><select id="space-active-asset">${selected.map(id => `<option value="${esc(id)}"${id === activeAssetId ? ' selected' : ''}>${esc(findAsset(id)?.name || id)}</option>`).join('')}</select>${button('space-focus', '선택 공간을 지도에서 보기', `data-id="${esc(activeAssetId)}"`, 'space-text-button')}${observationForm(asset)}${scenarioList()}${scenarioForm(asset)}${button('space-step', '같은 조건으로 결과 비교 →', 'data-step="compare"', 'primary full')}`;
  }
  function queryForm() {
    const missing = missingScenarioAssets();
    const scenarios = workspace.scenarios.length ? `<fieldset class="space-scenario-choice"><legend>비교할 변경안</legend>${workspace.scenarios.map(item => `<label><input type="checkbox" name="space-included-scenario" value="${esc(item.id)}"${includedScenarios.has(item.id) ? ' checked' : ''}><span>${esc(item.name)}<small>${item.changes.length}개 공간 변경</small></span></label>`).join('')}<p class="space-hint">체크를 해제해도 저장한 변경안은 유지됩니다.</p></fieldset>` : '';
    const warning = missing.length ? `<div class="space-result-note"><p>비교할 변경안의 공간 ${missing.length}개이 선택 목록에 없습니다. 해당 공간을 함께 선택하거나 변경안의 체크를 해제하세요.</p>${button('space-include-scenario-assets', '변경안의 공간도 선택')}</div>` : '';
    return `<form id="space-query-form"><h3>언제 이용할 공간을 검토하나요?</h3><label for="space-query-day">검토 요일</label><select id="space-query-day">${DAYS.map((name, index) => `<option value="${index + 1}"${query.dayOfWeek === index + 1 ? ' selected' : ''}>${name}요일</option>`).join('')}</select><div class="space-two-fields"><div><label for="space-query-start">이용 시작</label><input id="space-query-start" type="time" required value="${esc(query.start)}"></div><div><label for="space-query-end">이용 종료</label><input id="space-query-end" type="time" required value="${esc(query.end)}"></div></div>${scenarios}${warning}<p class="space-hint">선택한 ${selected.length}개 공간에 같은 조건을 적용합니다. 법정공휴일·예약·접근 제약은 추가 확인사항입니다.</p><button type="submit" class="primary full"${selected.length && !missing.length ? '' : ' disabled'}>현재 현황과 변경안 계산</button></form>`;
  }
  function aiHtml() {
    return `<section class="space-ai"><h3>계산 결과를 행정 검토로 연결</h3><p class="space-hint">선택 공간·확인한 운영조건·변경안과 계산결과를 AI로 설명합니다. 계산표를 근거로 삼고 AI 설명은 검토 보조로 활용하세요. ${profile.capabilities?.legacySeoguServices === false ? '현재 지역의 자료만 사용합니다.' : ''}</p>${button('space-explain', aiLoading ? '근거를 설명하고 있습니다…' : 'AI로 차이·협의사항 설명', `${!lastComparison || restoredSnapshot || aiLoading ? 'disabled' : ''}`, 'primary full')}${aiResult ? `<article class="space-ai-result"><span class="space-badge">${aiResult.mode === 'llm' ? 'AI 설명' : aiResult.mode === 'error' ? '설명 요청 확인 필요' : '계산 근거 요약'}</span><p>${esc(aiResult.answer || aiResult.error || '')}</p>${aiResult.model ? `<small>응답 모델: ${esc(aiResult.model)}</small>` : ''}${aiResult.notice ? `<small>${esc(aiResult.notice)}</small>` : ''}</article>` : ''}</section>`;
  }
  function historyHtml() {
    const records = (workspace.history || []).slice(-15).reverse();
    return `<details class="space-details"><summary>현장 확인 변경 이력 · ${workspace.history.length}건</summary><p class="space-hint">최근 15건을 표시합니다. 전체 이력은 JSON 백업에 포함되며 기관의 공식 승인 이력을 뜻하지 않습니다.</p><ol class="space-history">${records.map(item => `<li><strong>${esc(findAsset(item.assetId)?.name || item.assetId || '공간 현황')}</strong><span>${esc(timeText(item.recordedAt))}</span><p>${esc(scheduleText(item.previous))} → ${esc(scheduleText(item.next))}<br>${esc(item.next.evidence)}</p></li>`).join('') || '<li>아직 현장 확인 변경이 없습니다.</li>'}</ol></details>`;
  }
  function snapshotsHtml() {
    const snapshots = workspace.snapshots || [];
    let difference = '';
    if (snapshots.length >= 2) {
      try {
        const diff = diffSnapshots(snapshots.at(-2), snapshots.at(-1));
        difference = `<p class="space-result-note">${diff.comparable && diff.baseline ? `최근 두 저장본의 같은 조건 비교: 개방 조건 충족 공간 ${Number(diff.baseline.eligibleCount) > 0 ? '+' : ''}${number(diff.baseline.eligibleCount)}개, 미확인 공간 ${Number(diff.baseline.unknownCount) > 0 ? '+' : ''}${number(diff.baseline.unknownCount)}개. 기록상 변화이며 사업효과 실측값은 아닙니다.` : esc(diff.reason || '두 저장본의 조건·확인 범위가 달라 변화량을 판정하지 않았습니다.')}${diff.dataChanged ? '<br>공개 원자료도 달라졌으므로 함께 확인하세요.' : ''}</p>`;
      } catch { difference = '<p class="space-hint">저장본의 비교 조건을 확인하세요.</p>'; }
    }
    return `<details class="space-details"><summary>저장한 비교 결과 · ${snapshots.length}/20</summary>${difference}<ul class="space-evidence-list">${snapshots.slice().reverse().map(snapshot => `<li><strong>${esc(snapshot.name || '검토 결과')}</strong><span>${esc(timeText(snapshot.createdAt))}</span>${button('space-restore-snapshot', '저장 당시 결과 보기', `data-id="${esc(snapshot.id)}"`, 'space-text-button')}</li>`).join('') || '<li>계산 후 ‘비교 결과 보관’을 누르면 당시 결과를 남길 수 있습니다.</li>'}</ul></details>`;
  }
  function compareHtml() {
    const changed = observationChange ? `<p class="space-result-note">현황 확인을 반영해 같은 조건으로 다시 계산했습니다.<br>개방 조건 충족 ${number(observationChange.before.eligibleCount)} → ${number(observationChange.after.eligibleCount)}개 / 미확인 ${number(observationChange.before.unknownCount)} → ${number(observationChange.after.unknownCount)}개. 정보 확인에 따른 변화이며 실제 사업효과로 해석하지 않습니다.</p>` : '';
    const historicalNote = restoredSnapshot ? `<p class="space-result-note">아래는 ‘${esc(restoredSnapshot.name)}’의 저장 당시 결과입니다. 계산 버튼을 누르면 위 조건과 최신 현황으로 새 결과를 만듭니다.</p>` : '';
    const result = lastComparison ? `<div class="space-result-heading"><h3>비교 결과</h3><span class="space-badge">${restoredSnapshot ? '저장 당시 결과' : '조건별 계산'}</span></div><p class="space-hint">${esc(DAYS[lastComparison.query?.dayOfWeek - 1] || '')}요일 ${esc(lastComparison.query?.start || '')}–${esc(lastComparison.query?.end || '')} · ${lastComparison.selectedCount}개 공간 · ${esc(timeText(lastComparison.generatedAt))}</p>${historicalNote}${changed}${spaceComparisonHtml(lastComparison)}${rowsHtml(lastComparison)}${restoredSnapshot ? '' : aiHtml()}<div class="space-actions">${button('space-save-snapshot', '비교 결과 보관', restoredSnapshot || workspace.snapshots.length >= 20 || storageError ? 'disabled' : '')}${button('space-report', '검토보고서 HTML')}</div>` : '<p class="space-empty">‘계산’을 누르면 현재 확인된 값과 변경 가정을 구분해 보여 줍니다. 현재 운영조건이 없어도 미확인으로 남기고 변경안부터 검토할 수 있습니다.</p>';
    return `${selectedChips()}${queryForm()}<div id="space-current-result">${result}</div>${snapshotsHtml()}${historyHtml()}`;
  }
  function toolsHtml() {
    let preview = '';
    if (importPreview) {
      try {
        const combined = mergeWorkspaces(workspace, importPreview);
        preview = `<div class="space-import-preview"><strong>가져올 기록 확인</strong><p>파일의 현장 확인 ${Object.keys(importPreview.observations).length}개 · 변경안 ${importPreview.scenarios.length}개 · 저장 비교 ${importPreview.snapshots.length}개</p><p>합친 뒤: 현장 확인 ${Object.keys(combined.observations).length}개 · 변경안 ${combined.scenarios.length}개 · 변경 이력 ${combined.history.length}건</p><p>더 최근에 확인한 현황을 적용하고 양쪽 변경 이력을 보존합니다. 내용이 충돌하는 대안은 자동으로 덮어쓰지 않습니다.</p>${button('space-confirm-import', '현재 기록과 합치기', storageError ? 'disabled' : '')}${button('space-cancel-import', '취소', '', 'space-text-button')}</div>`;
      } catch (error) { preview = `<div class="space-import-preview"><p class="space-error">${esc(error.message)} 기존 기록은 유지됩니다.</p>${button('space-cancel-import', '가져오기 닫기', '', 'space-text-button')}</div>`; }
    }
    return `<details class="space-details space-backup"${importPreview ? ' open' : ''}><summary>기록 보관·다른 기기로 옮기기</summary>${localNote}<div class="space-actions">${button('space-backup', 'JSON 백업', storageError ? 'disabled' : '')}${storageError ? button('space-raw-backup', '읽지 못한 원본 보관') : ''}</div><label for="space-import-file">JSON 백업 가져오기</label><input id="space-import-file" type="file" accept=".json,application/json"><p class="space-hint">같은 지역의 2MiB 이하 백업만 받습니다. 먼저 합쳐질 내용을 확인합니다.</p>${preview}</details>`;
  }
  function render() {
    if (destroyed || !workspace) return;
    const html = `<div class="space-twin"><div class="space-lead"><strong>같은 공간, 다른 운영안.</strong><p>현장에서 확인한 상태와 변경안을 비교하고, 다음 판단에 이어갑니다.</p><span class="space-badge">기록은 이 브라우저에 보관</span></div><nav class="space-steps" aria-label="공공공간 활용 단계">${[['select','1 공간 선택'],['state','2 현황·변경안'],['compare','3 비교·기록']].map(([id, name]) => button('space-step', name, `data-step="${id}" aria-current="${step === id ? 'step' : 'false'}"`, step === id ? 'is-current' : '')).join('')}</nav>${storageError ? `<p class="space-error" role="alert">저장 기록 확인 필요: ${esc(storageError)} 기존 기록을 덮어쓰지 않습니다.</p>` : ''}${step === 'select' ? candidatesHtml() : step === 'state' ? stateHtml() : compareHtml()}${toolsHtml()}</div>`;
    api.show('공공공간 활용', html, VIEW);
    const eyebrow = document.getElementById('detail-eyebrow'); if (eyebrow) eyebrow.textContent = `${profile.name} · 현황 → 변경안 → 다시 확인`;
  }
  async function open() {
    api.show('공공공간 활용', '<p>선택 지역의 공공공간 자료를 확인하고 있습니다.</p>', VIEW);
    try { await ensureLoaded(); if (destroyed || !openNow()) return; drawCandidates(); render(); } catch (error) { if (destroyed || !openNow()) return; api.show('공공공간 활용', `<div class="space-twin"><p class="space-error">${esc(error.message)}</p><p>자료가 연결되어야 실제 공간을 선택할 수 있습니다.</p>${button('space-twin', '다시 확인')}</div>`, VIEW); }
  }
  function collectQuery() {
    const day = document.getElementById('space-query-day');
    if (day) query = {...query, dayOfWeek: Number(day.value), start: document.getElementById('space-query-start').value, end: document.getElementById('space-query-end').value};
    return {...query, assetIds: [...selected]};
  }
  function readSchedule(prefix) {
    return {operatingStatus: document.getElementById(`${prefix}-status`).value, daysOfWeek: [...root.querySelectorAll(`input[name="${prefix}-days"]:checked`)].map(input => Number(input.value)), opens: document.getElementById(`${prefix}-opens`).value, closes: document.getElementById(`${prefix}-closes`).value};
  }
  function collectDrafts() {
    if (document.getElementById('space-observation-form')) observationDrafts.set(activeAssetId, {...readSchedule('space-observation'), observedOn: document.getElementById('space-observation-date').value, validUntil: document.getElementById('space-observation-valid').value || null, evidence: document.getElementById('space-observation-evidence').value});
    if (document.getElementById('space-scenario-form')) { const cost = document.getElementById('space-scenario-cost').value; scenarioDrafts.set(draftKey(), {...readSchedule('space-scenario'), assetId: activeAssetId, name: document.getElementById('space-scenario-name').value, note: document.getElementById('space-scenario-note').value, additionalAnnualCost: cost === '' ? null : Number(cost)}); }
  }
  function calculate() {
    if (!selected.length) throw Error('검토할 공간을 선택하세요.');
    const effectiveQuery = collectQuery();
    const comparison = compareWorkspace({assets, workspace: calculationWorkspace(), query: effectiveQuery});
    invalidate(); lastComparison = comparison; step = 'compare'; render();
    return lastComparison;
  }
  function saveObservation() {
    collectDrafts();
    const effectiveQuery = {...query, assetIds: [...selected]};
    let before = null;
    try { if (selected.length) before = compareWorkspace({assets, workspace: calculationWorkspace(), query: effectiveQuery}); } catch { /* Recording field evidence does not require a valid scenario scope. */ }
    persist(recordObservation(workspace, activeAssetId, observationDrafts.get(activeAssetId)));
    observationDrafts.delete(activeAssetId); invalidate();
    if (before) { lastComparison = compareWorkspace({assets, workspace: calculationWorkspace(), query: effectiveQuery}); observationChange = {before: before.baseline, after: lastComparison.baseline}; }
    api.toast('현황과 변경 이력을 저장했습니다. 다음 비교에 반영됩니다.'); render();
  }
  function saveScenario() {
    collectDrafts();
    const existing = workspace.scenarios.find(item => item.id === editingScenarioId);
    const {name, note, ...change} = scenarioDrafts.get(draftKey());
    const changes = [...(existing?.changes || []).filter(item => item.assetId !== activeAssetId), change];
    const beforeIds = new Set(workspace.scenarios.map(item => item.id));
    persist(upsertScenario(workspace, {...(existing ? {id: existing.id} : {}), name, note, changes}));
    scenarioDrafts.delete(draftKey());
    editingScenarioId = existing?.id || workspace.scenarios.find(item => !beforeIds.has(item.id))?.id || '';
    includedScenarios.add(editingScenarioId); invalidate(); api.toast('변경안을 저장했습니다. 같은 대안에 다른 공간을 추가할 수 있습니다.'); render();
  }
  async function explain() {
    if (aiLoading) return;
    calculate();
    const token = ++requestSequence;
    const comparison = lastComparison;
    aiLoading = true; aiResult = null; controller = new AbortController(); const requestController = controller; render();
    const timeout = setTimeout(() => requestController.abort(), 35000);
    try {
      const assetIds = [...selected];
      const response = await fetch('/api/space-review', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({regionId: profile.id, assetIds, observations: Object.fromEntries(assetIds.filter(id => workspace.observations[id]).map(id => [id, workspace.observations[id]])), query: comparison.query, scenarios: calculationWorkspace().scenarios}), signal: requestController.signal});
      let result; try { result = await response.json(); } catch { throw Error('AI 설명 응답 형식을 확인하지 못했습니다. 계산 결과는 유지합니다.'); }
      if (!response.ok || !result?.ok) throw Error(result?.error || 'AI 설명을 받지 못했습니다. 계산 결과는 유지합니다.');
      if (token !== requestSequence || destroyed) return;
      if (!sameSpaceComparison(comparison, result.comparison)) throw Error('서버의 원자료 또는 계산 결과가 현재 화면과 달라 설명을 보류했습니다. JSON 백업을 보관한 뒤 페이지를 새로고침하고 다시 계산하세요.');
      aiResult = result;
    } catch (error) { if (token === requestSequence) aiResult = {mode: 'error', error: error.name === 'AbortError' ? '응답이 늦어 설명을 중단했습니다. 계산표와 원자료를 먼저 확인하세요.' : error.message}; }
    finally { clearTimeout(timeout); if (token === requestSequence) { aiLoading = false; controller = null; if (openNow()) render(); } }
  }
  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], {type})); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function backup() { download(`서구온_공공공간_${profile.id}_${dateNow()}.json`, serializeWorkspace(workspace), 'application/json;charset=utf-8'); }
  function toggle(id, selectOnly = false) {
    if (!findAsset(id)) return;
    collectDrafts();
    if (selected.includes(id)) { if (!selectOnly) selected = selected.filter(value => value !== id); }
    else { if (selected.length >= MAX_SELECTED) throw Error(`검토 공간은 한 번에 ${MAX_SELECTED}개까지 선택하세요.`); selected.push(id); }
    activeAssetId = selected.includes(id) ? id : selected[0] || ''; invalidate(); drawCandidates(); render();
  }
  const off = [
    registerAction('space-twin', open),
    registerAction('space-step', button => { collectDrafts(); collectQuery(); step = ['select','state','compare'].includes(button.dataset.step) ? button.dataset.step : 'select'; render(); }),
    registerAction('space-toggle', button => toggle(button.dataset.id)),
    registerAction('space-remove', button => toggle(button.dataset.id)),
    registerAction('space-focus', button => focusAsset(button.dataset.id)),
    registerAction('space-edit-scenario', button => { collectDrafts(); editingScenarioId = button.dataset.id; step = 'state'; render(); }),
    registerAction('space-new-scenario', () => { collectDrafts(); editingScenarioId = ''; render(); }),
    registerAction('space-include-scenario-assets', () => {
      collectQuery(); const missing = missingScenarioAssets();
      if (missing.some(id => !findAsset(id))) throw Error('현재 원자료에서 찾지 못한 변경 공간이 있습니다. 해당 변경안의 체크를 해제하고 원자료를 확인하세요.');
      if (selected.length + missing.length > MAX_SELECTED) throw Error(`이 검토는 ${MAX_SELECTED}개 공간까지 비교합니다. 비교할 변경안을 줄이세요.`);
      selected.push(...missing); invalidate(); drawCandidates(); render();
    }),
    registerAction('space-explain', explain),
    registerAction('space-save-snapshot', () => { if (!lastComparison || restoredSnapshot) return; const comparison = calculate(); persist(saveSnapshot(workspace, comparison, {name: `${DAYS[comparison.query.dayOfWeek - 1]}요일 ${comparison.query.start}–${comparison.query.end} · ${comparison.selectedCount}개`})); api.toast('현재 비교 결과를 저장했습니다. 이후 현황이 바뀌어도 당시 결과는 보존됩니다.'); render(); }),
    registerAction('space-restore-snapshot', button => { const snapshot = workspace.snapshots.find(item => item.id === button.dataset.id); if (!snapshot) return; collectQuery(); invalidate(); lastComparison = snapshot.comparison; restoredSnapshot = snapshot; step = 'compare'; render(); }),
    registerAction('space-report', () => { if (!lastComparison) return; download(`서구온_공공공간_검토보고서_${dateNow()}.html`, spaceReportHtml({profile, comparison: lastComparison, ai: aiResult}), 'text/html;charset=utf-8'); }),
    registerAction('space-backup', backup),
    registerAction('space-raw-backup', () => { let raw; try { raw = localStorage.getItem(storageKey()); } catch { throw Error('브라우저 저장소를 읽을 수 없습니다.'); } if (raw) download(`서구온_공공공간_원본보관_${dateNow()}.txt`, raw, 'text/plain;charset=utf-8'); }),
    registerAction('space-cancel-import', () => { importPreview = null; render(); }),
    registerAction('space-confirm-import', () => {
      if (!importPreview) return;
      if (storageError) throw Error('현재 기록을 읽지 못해 합치지 않았습니다. 원본 백업을 보관하고 운영자에게 확인하세요.');
      persist(mergeWorkspaces(workspace, importPreview)); importPreview = null; editingScenarioId = ''; observationDrafts.clear(); scenarioDrafts.clear(); includedScenarios = new Set(workspace.scenarios.map(item => item.id)); invalidate(); api.toast('가져온 기록을 합쳤습니다. 현장 확인 변경 이력도 보존했습니다.'); render();
    }),
    registerAction('space-twin-from-feature', async button => { await open(); const asset = assets.find(item => item.sourceId === button.dataset.id || item.id === button.dataset.id); if (!asset) { api.toast('공공공간 자료에 연결된 시설을 선택하세요.'); return; } toggle(asset.id, true); step = 'state'; render(); }),
  ];
  const submit = event => {
    if (!['space-observation-form','space-scenario-form','space-query-form'].includes(event.target?.id)) return;
    event.preventDefault();
    try { if (event.target.id === 'space-observation-form') saveObservation(); else if (event.target.id === 'space-scenario-form') saveScenario(); else calculate(); }
    catch (error) { api.toast(error.message || '입력한 값을 확인하세요.'); }
  };
  const input = event => {
    if (event.target.id === 'space-search') { search = event.target.value; const list = document.getElementById('space-candidate-list'); if (list) { const temp = document.createElement('div'); temp.innerHTML = candidatesHtml(); list.replaceChildren(...temp.querySelector('#space-candidate-list').childNodes); } }
    if (event.target.closest?.('#space-observation-form, #space-scenario-form')) collectDrafts();
    if (['space-query-day','space-query-start','space-query-end'].includes(event.target.id)) {
      collectQuery(); invalidate(); const output = document.getElementById('space-current-result');
      if (output) output.innerHTML = '<p class="space-empty" role="status">검토 시간이 바뀌었습니다. 계산 버튼을 눌러 새 조건을 반영하세요.</p>';
    }
  };
  const change = async event => {
    if (event.target.id === 'space-active-asset') { collectDrafts(); activeAssetId = event.target.value; render(); }
    if (event.target.name === 'space-included-scenario') { collectQuery(); event.target.checked ? includedScenarios.add(event.target.value) : includedScenarios.delete(event.target.value); invalidate(); render(); }
    if (event.target.id === 'space-import-file') {
      const file = event.target.files?.[0]; if (!file) return;
      try { if (file.size > 2 * 1024 * 1024) throw Error('백업 파일은 2MiB 이하만 가져올 수 있습니다.'); importPreview = parseWorkspace(await file.text(), {regionId: profile.id}); render(); }
      catch (error) { api.toast(error.message || '백업 파일을 읽지 못했습니다.'); }
    }
  };
  root?.addEventListener('submit', submit); root?.addEventListener('input', input); root?.addEventListener('change', change);
  return {
    open,
    scopeChanged() { if (!workspace) return; if (openNow()) { collectDrafts(); drawCandidates(); render(); } else if (api.state.enabled.has(MAP_LAYER)) drawCandidates(); },
    onEvent(message) { if (message.type === 'select' && message.layer === MAP_LAYER && workspace) { try { toggle(message.id, true); } catch (error) { api.toast(error.message); } return true; } return false; },
    destroy() { destroyed = true; requestSequence++; controller?.abort(); off.forEach(fn => fn()); root?.removeEventListener('submit', submit); root?.removeEventListener('input', input); root?.removeEventListener('change', change); api.state.enabled.delete(MAP_LAYER); api.state.entries.delete(MAP_LAYER); },
  };
}
