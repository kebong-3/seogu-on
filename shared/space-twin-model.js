/**
 * Public-space operating scenarios. Pure ES module shared by browser and server.
 * Source publication, user-recorded field checks and proposed changes stay distinct.
 * Counts describe mapped spaces, not buildings, visitors, demand or welfare effects.
 */
import {renderSpaceExplanation, validateSpaceExplanation, spaceRulesSummary} from './space-review-evidence.js';

export const TWIN_VERSION = 1;
export const TWIN_FORMAT = 'seoon-space-twin';
export const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
export const MAX_ASSETS = 5000;
export const MAX_SELECTED = 100;
export const MAX_OBSERVATIONS = 1000;
export const MAX_HISTORY = 1000;
export const MAX_SCENARIOS = 3;
export const MAX_CHANGES = 30;
export const MAX_SNAPSHOTS = 20;
export const FRESHNESS_DAYS = 90;
const DAY_MS = 86400000;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const STATUSES = new Set(['open', 'closed', 'unknown']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const utf8Bytes = value => new TextEncoder().encode(value).length;
const fail = message => { throw new Error(message); };
const isObject = value => !!value && !Array.isArray(value) && typeof value === 'object';

/** Never invokes accessors while validating imported/programmatic data. */
function jsonCopy(value, depth = 0, stack = new Set(), budget = {nodes: 0}) {
  if (++budget.nodes > 90000 || depth > 20) fail('자료 구조가 너무 크거나 깊습니다.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('유효하지 않은 숫자가 포함되어 있습니다.'); return value; }
  if (typeof value !== 'object') fail('JSON으로 보관할 수 없는 자료입니다.');
  if (stack.has(value)) fail('순환 참조 자료는 사용할 수 없습니다.');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) fail('일반 JSON 객체만 사용할 수 있습니다.');
  stack.add(value);
  const out = Array.isArray(value) ? [] : {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && Object.keys(descriptors).length - 1 !== value.length) fail('빈 배열 슬롯은 사용할 수 없습니다.');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (BAD_KEYS.has(key)) fail('허용하지 않는 자료 키가 포함되어 있습니다.');
    if (!own(descriptor, 'value')) fail('접근자 속성이 있는 자료는 사용할 수 없습니다.');
    if (!descriptor.enumerable) fail('숨겨진 자료 속성은 사용할 수 없습니다.');
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) fail('배열 자료 형식이 올바르지 않습니다.');
    out[key] = jsonCopy(descriptor.value, depth + 1, stack, budget);
  }
  if (Array.isArray(value) && out.length !== value.length) fail('빈 배열 슬롯은 사용할 수 없습니다.');
  stack.delete(value);
  return out;
}
function object(value, label) { if (!isObject(value)) fail(`${label} 형식이 올바르지 않습니다.`); return value; }
function keys(value, allowed, label) { object(value, label); for (const k of Object.keys(value)) if (!allowed.includes(k)) fail(`${label}에 알 수 없는 항목이 있습니다: ${k}`); }
function string(value, label, max, {optional = false, trim = true} = {}) {
  if ((value === undefined || value === null) && optional) return '';
  if (typeof value !== 'string') fail(`${label}은 문자열이어야 합니다.`);
  const s = trim ? value.trim() : value;
  if ((!optional && !s) || s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) fail(`${label}의 길이 또는 문자를 확인하세요.`);
  return s;
}
function integer(value, label, min, max) { if (!Number.isInteger(value) || value < min || value > max) fail(`${label}의 범위를 확인하세요.`); return value; }
function amount(value, label = '추가 연간 운영비', maximum = 1e10) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) fail(`${label}은 0 이상, 만원 단위 소수 둘째 자리까지 입력하세요.`);
  return value;
}
function regionId(value) { const id = string(value, '지역 ID', 80); if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) fail('지역 ID를 확인하세요.'); return id; }
function id(value, label = '식별자') { return string(value, label, 320); }
function date(value, label, optional = false) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  const s = string(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`${label}은 YYYY-MM-DD 형식이어야 합니다.`);
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== s || s < '2000-01-01' || s > '2100-12-31') fail(`${label}이 실제 날짜인지 확인하세요.`);
  return s;
}
function instant(value, label) { const s = string(value, label, 40); const d = new Date(s); if (!Number.isFinite(+d) || d.toISOString() !== s) fail(`${label} 형식을 확인하세요.`); return s; }
function nowIso(now) { const d = now === undefined ? new Date() : new Date(now); if (!Number.isFinite(+d)) fail('현재 시각을 확인하세요.'); return d.toISOString(); }
export function kstToday(now) { return new Date(+new Date(nowIso(now)) + 9 * 3600000).toISOString().slice(0, 10); }
function daysBetween(a, b) { return (+new Date(`${b}T00:00:00Z`) - +new Date(`${a}T00:00:00Z`)) / DAY_MS; }
function timeMinutes(value, label, end = false) {
  const s = string(value, label, 5);
  if (!/^\d{2}:\d{2}$/.test(s)) fail(`${label}은 HH:MM 형식이어야 합니다.`);
  const [h, m] = s.split(':').map(Number);
  if (h > 23 || m > 59) { if (end && s === '24:00') return 1440; fail(`${label}의 시간을 확인하세요.`); }
  return h * 60 + m;
}
function schedule(input) {
  const operatingStatus = string(input.operatingStatus, '운영 상태', 10);
  if (!STATUSES.has(operatingStatus)) fail('운영 상태를 확인하세요.');
  let daysOfWeek = [], opens = null, closes = null;
  if (input.daysOfWeek !== undefined && input.daysOfWeek !== null) {
    if (!Array.isArray(input.daysOfWeek) || input.daysOfWeek.length > 7) fail('운영 요일을 확인하세요.');
    daysOfWeek = input.daysOfWeek.map(d => integer(d, '운영 요일', 1, 7));
    if (new Set(daysOfWeek).size !== daysOfWeek.length) fail('운영 요일이 중복되었습니다.');
    daysOfWeek.sort((a, b) => a - b);
  }
  if (operatingStatus === 'open') {
    if (!daysOfWeek.length) fail('운영 중인 공간의 요일을 선택하세요.');
    const a = timeMinutes(input.opens, '개방 시작'), b = timeMinutes(input.closes, '개방 종료', true);
    if (b <= a) fail('같은 날의 개방 종료시각은 시작시각보다 늦어야 합니다. 밤을 넘기는 시간은 나누어 검토하세요.');
    opens = input.opens; closes = input.closes;
  } else if (input.opens !== undefined && input.opens !== null && input.opens !== '') timeMinutes(input.opens, '개방 시작');
  if (operatingStatus !== 'open' && input.closes !== undefined && input.closes !== null && input.closes !== '') timeMinutes(input.closes, '개방 종료', true);
  return {operatingStatus, daysOfWeek: operatingStatus === 'open' ? daysOfWeek : [], opens, closes};
}
function point(value, label = '좌표') {
  if (!Array.isArray(value) || value.length !== 2 || value.some(n => typeof n !== 'number' || !Number.isFinite(n)) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) fail(`${label}을 확인하세요.`);
  return [...value];
}
function url(value) {
  if (value === undefined || value === null || value === '') return '';
  const s = string(value, '출처 URL', 2000);
  let u; try { u = new URL(s); } catch { fail('출처 URL을 확인하세요.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) fail('HTTP(S) 출처 주소만 사용할 수 있습니다.');
  return s;
}
/** Deterministic change detector, not a security signature. */
export function dataFingerprint(value) {
  const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isObject(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
  const raw = new TextEncoder().encode(canonical(jsonCopy(value)));
  let h = 14695981039346656037n;
  for (const byte of raw) h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 1099511628211n);
  return `fnv1a64:${h.toString(16).padStart(16, '0')}`;
}
function fingerprint(value, label = '자료 지문') {
  const s = string(value, label, 80);
  if (!/^fnv1a64:[0-9a-f]{16}$/.test(s)) fail(`${label} 형식을 확인하세요.`);
  return s;
}
/** Bind a field check to identity, location, published hours and source metadata, not cosmetic notes. */
export function assetSourceFingerprint(value) {
  const a = jsonCopy(value);
  return dataFingerprint({id:a.id,regionId:a.regionId,datasetId:a.datasetId || '',name:a.name,coordinates:a.coordinates,
    address:a.address || '',dongId:a.dongId || '',dongName:a.dongName || '',rawHours:a.rawHours || '',source:a.source});
}

export function seedAssets(collection, options = {}) {
  const region = regionId(options.regionId), datasetId = id(options.datasetId || 'public-facilities', '자료 ID');
  const data = jsonCopy(collection);
  const features = Array.isArray(data) ? data : data?.features;
  const metadata = Array.isArray(data) ? {} : (data.metadata || {});
  if (!Array.isArray(features) || features.length > MAX_ASSETS) fail('공간자료의 개수와 형식을 확인하세요.');
  const seen = new Set();
  return features.map(feature => {
    if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point') fail('개방 공간의 실제 Point 자료만 사용할 수 있습니다.');
    const p = object(feature.properties, '공간 속성');
    const sourceId = typeof (p.id ?? feature.id) === 'number' ? String(p.id ?? feature.id) : id(p.id ?? feature.id, '원자료 ID');
    const assetId = `${datasetId}::${sourceId}`;
    if (assetId.length > 320 || seen.has(assetId)) fail('공간 ID가 중복되었거나 너무 깁니다.');
    seen.add(assetId);
    const asset = {
      id: assetId, sourceId, regionId: region, datasetId,
      name: string(p.name, '공간 이름', 240), coordinates: point(Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates.slice(0, 2) : null),
      dongId: string(p.dongId, '행정동 ID', 120, {optional: true}), dongName: string(p.dongName, '행정동 이름', 120, {optional: true}),
      address: string(p.address, '주소', 500, {optional: true}), rawHours: string(p.hours, '원자료 운영시간', 1000, {optional: true}),
      source: {name: string(p.sourceName || metadata.sourceName, '출처명', 500, {optional: true}), url: url(p.sourceUrl || metadata.sourceUrl), date: date(p.sourceDate || metadata.sourceDate, '원자료 기준일', true)},
      unit: 'space', note: string(p.note, '자료 설명', 1200, {optional: true}),
    };
    return {...asset, dataFingerprint: dataFingerprint(asset)};
  });
}

export function createWorkspace(value, {now} = {}) {
  return {format: TWIN_FORMAT, version: TWIN_VERSION, regionId: regionId(value), revision: 0, updatedAt: nowIso(now), observations: {}, history: [], scenarios: [], snapshots: []};
}

export function normalizeObservation(value, {now} = {}) {
  const input = jsonCopy(value);
  keys(input, ['operatingStatus', 'daysOfWeek', 'opens', 'closes', 'observedOn', 'validUntil', 'evidence', 'recordedAt', 'revision', 'assetFingerprint'], '현장 확인');
  const observedOn = date(input.observedOn, '확인일');
  if (observedOn > kstToday(now)) fail('현장 확인일은 오늘(한국시간) 이후로 입력할 수 없습니다.');
  const validUntil = date(input.validUntil, '재확인 기한', true);
  if (validUntil && validUntil < observedOn) fail('재확인 기한은 확인일보다 빠를 수 없습니다.');
  return {...schedule(input), observedOn, validUntil, evidence: string(input.evidence, '확인 근거', 1200),
    ...(input.assetFingerprint !== undefined ? {assetFingerprint:fingerprint(input.assetFingerprint, '확인 당시 원자료 지문')} : {}),
    ...(input.recordedAt !== undefined ? {recordedAt: instant(input.recordedAt, '기록시각')} : {}),
    ...(input.revision !== undefined ? {revision: integer(input.revision, '기록 버전', 1, 1000000)} : {}),
  };
}
export function observationState(observation, {now, asset} = {}) {
  if (!observation) return {state: 'unknown', reason: '현장 확인 없음'};
  const o = normalizeObservation(observation, {now});
  const today = kstToday(now), ageDays = daysBetween(o.observedOn, today);
  if (o.assetFingerprint && asset && o.assetFingerprint !== assetSourceFingerprint(asset)) return {state:'stale',reason:'원자료 변경 · 재확인 필요',ageDays,sourceBinding:'changed'};
  if (ageDays > FRESHNESS_DAYS || (o.validUntil && today > o.validUntil)) return {state: 'stale', reason: '재확인 필요', ageDays};
  if (o.operatingStatus === 'unknown') return {state: 'unknown', reason: '확인 기록에서도 운영 여부 미확인', ageDays};
  return {state: 'recorded', reason: o.assetFingerprint ? '사용자 현장확인 기록' : '사용자 현장확인 기록 · 이전 기록의 원자료 변경 추적 불가', ageDays,
    sourceBinding:o.assetFingerprint ? (asset ? 'matched' : 'unchecked') : 'missing'};
}

function normalizeChange(value) {
  keys(value, ['assetId', 'operatingStatus', 'daysOfWeek', 'opens', 'closes', 'additionalAnnualCost'], '변경안');
  return {assetId: id(value.assetId, '변경 공간 ID'), ...schedule(value), additionalAnnualCost: amount(value.additionalAnnualCost)};
}
export function normalizeScenario(value) {
  const input = jsonCopy(value);
  keys(input, ['id', 'name', 'changes', 'note'], '대안');
  if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > MAX_CHANGES) fail(`대안마다 1~${MAX_CHANGES}개의 공간 변경을 입력하세요.`);
  const changes = input.changes.map(normalizeChange);
  if (new Set(changes.map(c => c.assetId)).size !== changes.length) fail('한 대안에 같은 공간이 중복되었습니다.');
  return {id: input.id === undefined ? '' : id(input.id, '대안 ID'), name: string(input.name, '대안 이름', 120), changes, note: string(input.note, '대안 설명', 1200, {optional: true})};
}

function normalizeHistory(entry, now) {
  keys(entry, ['id', 'assetId', 'recordedAt', 'previous', 'next', 'revision'], '변경 이력');
  return {id: id(entry.id), assetId: id(entry.assetId), recordedAt: instant(entry.recordedAt, '변경 기록시각'), revision: integer(entry.revision, '변경 버전', 1, 1000000),
    previous: entry.previous === null ? null : normalizeObservation(entry.previous, {now}), next: normalizeObservation(entry.next, {now})};
}

function validateComparison(value) {
  const c = object(value, '저장한 비교 결과');
  keys(c, ['version', 'regionId', 'generatedAt', 'workspaceRevision', 'query', 'assetFingerprint', 'fingerprint', 'selectedCount', 'excludedByDistance', 'unlocatedCount', 'baseline', 'alternatives', 'sources', 'limitations'], '비교 결과');
  integer(c.version, '비교 버전', 1, 1); regionId(c.regionId); instant(c.generatedAt, '비교 생성시각'); integer(c.workspaceRevision, '비교 기록 버전', 0, 1000000);
  const query = normalizeQuery(c.query, {allowEmpty:true});
  for (const field of ['assetFingerprint', 'fingerprint']) if (!/^fnv1a64:[0-9a-f]{16}$/.test(string(c[field], '자료 지문', 80))) fail('자료 지문 형식을 확인하세요.');
  for (const k of ['selectedCount', 'excludedByDistance', 'unlocatedCount']) integer(c[k], k, 0, MAX_ASSETS);
  if (!query.assetIds || query.assetIds.length !== c.selectedCount) fail('저장한 검토 조건과 공간 수가 일치하지 않습니다.');
  if (!Array.isArray(c.alternatives) || c.alternatives.length > MAX_SCENARIOS) fail('저장한 대안 개수를 확인하세요.');
  if (c.baseline?.id !== 'baseline' || c.alternatives.some(a => a.id === 'baseline') || new Set(c.alternatives.map(a => a.id)).size !== c.alternatives.length) fail('저장한 대안 ID를 확인하세요.');
  for (const [n, metric] of [c.baseline, ...c.alternatives].entries()) {
    keys(metric, ['id', 'name', 'kind', 'eligibleCount', 'unavailableCount', 'unknownCount', 'overlapHours', 'additionalAnnualCost', 'costUnit', 'costComplete', 'changedCount', 'comparable', 'delta', 'rows', 'note'], '저장한 지표');
    id(metric.id); string(metric.name, '지표 이름', 120);
    if (metric.kind !== (n === 0 ? 'current-records' : 'user-scenario')) fail('비교 자료의 구분이 올바르지 않습니다.');
    for (const k of ['eligibleCount', 'unavailableCount', 'unknownCount', 'changedCount']) integer(metric[k], k, 0, MAX_ASSETS);
    if (typeof metric.overlapHours !== 'number' || metric.overlapHours < 0 || metric.overlapHours > MAX_ASSETS * 24) fail('개방시간 합계를 확인하세요.');
    amount(metric.additionalAnnualCost, '추가 연간 운영비 합계', 1e10 * MAX_CHANGES); if (metric.costUnit !== '만원/년' || typeof metric.costComplete !== 'boolean' || typeof metric.comparable !== 'boolean') fail('비교 지표의 단위를 확인하세요.');
    if (metric.delta !== null) {
      keys(metric.delta, ['eligibleCount', 'overlapHours'], '지표 차이');
      integer(metric.delta.eligibleCount, '공간 수 차이', -MAX_ASSETS, MAX_ASSETS);
      if (typeof metric.delta.overlapHours !== 'number' || Math.abs(metric.delta.overlapHours) > MAX_ASSETS * 24) fail('시간 차이를 확인하세요.');
    }
    if (!metric.comparable && metric.delta !== null) fail('비교 불가 결과에 차이 값이 있습니다.');
    string(metric.note, '비교 설명', 1600, {optional: true});
    if (!Array.isArray(metric.rows) || metric.rows.length > MAX_SELECTED || metric.rows.length !== c.selectedCount) fail('비교 공간 수가 일치하지 않습니다.');
    if (new Set(metric.rows.map(row => row.assetId)).size !== metric.rows.length || metric.rows.some(row => !query.assetIds.includes(row.assetId))) fail('저장한 공간 목록과 검토 조건이 일치하지 않습니다.');
    for (const row of metric.rows) {
      keys(row, ['assetId', 'name', 'availability', 'provenance', 'reason', 'observedOn', 'evidence', 'operatingStatus', 'daysOfWeek', 'opens', 'closes', 'overlapMinutes', 'distanceM', 'sourceDate'], '공간별 결과');
      id(row.assetId); string(row.name, '공간 이름', 240);
      if (!['eligible', 'unavailable', 'unknown'].includes(row.availability) || !['field-record', 'unverified-source', 'stale-record', 'user-assumption'].includes(row.provenance)) fail('공간 결과의 출처 구분을 확인하세요.');
      string(row.reason, '공간 결과 설명', 200); string(row.evidence, '확인 근거', 1200, {optional: true});
      date(row.observedOn, '확인일', true); date(row.sourceDate, '자료 기준일', true); schedule(row);
      integer(row.overlapMinutes, '겹치는 개방 분', 0, 1440);
      const expected = scheduleResult(row, query);
      if (row.availability !== expected.availability || row.overlapMinutes !== expected.overlapMinutes) fail('공간의 개방 조건과 저장된 계산 결과가 일치하지 않습니다.');
      if ((n === 0 && row.provenance === 'user-assumption') || (['stale-record', 'unverified-source'].includes(row.provenance) && row.operatingStatus !== 'unknown') || (row.provenance === 'field-record' && (row.operatingStatus === 'unknown' || !row.observedOn || !row.evidence))) fail('공간 결과의 출처와 확인 근거가 일치하지 않습니다.');
      if (row.distanceM !== null && (typeof row.distanceM !== 'number' || !Number.isFinite(row.distanceM) || row.distanceM < 0 || row.distanceM > 21000000)) fail('거리 결과를 확인하세요.');
    }
    if (metric.eligibleCount !== metric.rows.filter(r => r.availability === 'eligible').length || metric.unknownCount !== metric.rows.filter(r => r.availability === 'unknown').length || metric.unavailableCount !== metric.rows.filter(r => r.availability === 'unavailable').length) fail('저장된 개수와 공간 목록이 일치하지 않습니다.');
    if (Math.abs(metric.overlapHours - roundHours(metric.rows.reduce((sum, r) => sum + r.overlapMinutes, 0))) > 0.00001) fail('저장된 개방시간 합계가 일치하지 않습니다.');
    if (metric.changedCount !== metric.rows.filter(row => row.provenance === 'user-assumption').length || metric.costComplete !== (metric.additionalAnnualCost !== null)) fail('저장한 변경 공간 수 또는 비용의 미산정 구분이 일치하지 않습니다.');
    if (n === 0) {
      if (metric.additionalAnnualCost !== 0 || !metric.costComplete || metric.delta !== null || metric.comparable !== (metric.unknownCount === 0)) fail('현재안의 비교 기준을 확인하세요.');
    } else {
      const comparable = c.baseline.unknownCount === 0 && metric.unknownCount === 0;
      const delta = comparable ? {eligibleCount:metric.eligibleCount-c.baseline.eligibleCount,overlapHours:Math.round((metric.overlapHours-c.baseline.overlapHours)*10000)/10000} : null;
      if (metric.comparable !== comparable || (delta === null ? metric.delta !== null : (!metric.delta || metric.delta.eligibleCount !== delta.eligibleCount || metric.delta.overlapHours !== delta.overlapHours))) fail('미확인 여부와 저장된 차이 계산이 일치하지 않습니다.');
    }
  }
  if (!Array.isArray(c.sources) || c.sources.length > MAX_SELECTED || !Array.isArray(c.limitations) || c.limitations.length > 30) fail('저장한 출처·한계 형식을 확인하세요.');
  if (c.sources.length !== c.selectedCount || new Set(c.sources.map(s => s.assetId)).size !== c.sources.length || c.sources.some(s => !query.assetIds.includes(s.assetId))) fail('저장한 출처 목록과 검토 공간이 일치하지 않습니다.');
  for (const s of c.sources) { keys(s, ['assetId', 'name', 'url', 'date'], '출처'); id(s.assetId); string(s.name, '출처명', 500, {optional: true}); url(s.url); date(s.date, '출처 기준일', true); }
  for (const s of c.limitations) string(s, '자료 한계', 1600);
  return c;
}
/** Stable binding to calculation facts; server/browser bookkeeping timestamps and revisions can differ. */
export function spaceComparisonFingerprint(comparison) {
  const {generatedAt, workspaceRevision, fingerprint: inputFingerprint, ...facts} = validateComparison(jsonCopy(comparison));
  return dataFingerprint(facts);
}
function normalizeSnapshotAi(value, comparison, {saving = false} = {}) {
  const a = jsonCopy(value);
  const fields = ['mode','answer','model','modelRecovered','computedAt','evidenceId','comparisonFingerprint','structured','code','notice','analysisPath','contentFingerprint'];
  keys(a, saving ? [...fields, 'ok', 'comparison'] : fields, '저장할 AI 설명');
  if (!['llm','rules'].includes(a.mode)) fail('완료된 AI 설명 또는 계산 요약만 보관할 수 있습니다.');
  if (fingerprint(a.comparisonFingerprint, 'AI 계산 지문') !== spaceComparisonFingerprint(comparison)) fail('AI 설명의 근거가 저장할 계산 결과와 다릅니다. 다시 설명을 요청하세요.');
  if (saving && a.comparison && spaceComparisonFingerprint(a.comparison) !== a.comparisonFingerprint) fail('AI 응답 내부의 계산 지문이 일치하지 않습니다.');
  const result = {mode:a.mode,answer:string(a.answer,'AI 설명',15000),computedAt:instant(a.computedAt,'AI 계산시각'),
    evidenceId:string(a.evidenceId,'AI 근거 식별자',80),comparisonFingerprint:a.comparisonFingerprint};
  if (!/^space-[a-f0-9]{20}$/.test(result.evidenceId)) fail('AI 근거 식별자 형식을 확인하세요.');
  if (a.mode === 'llm') {
    result.model = string(a.model,'응답 모델',160);
    result.structured = validateSpaceExplanation(a.structured, comparison);
    if (result.answer !== renderSpaceExplanation(result.structured, comparison)) fail('AI 설명 문장이 저장된 계산 근거와 일치하지 않습니다.');
  } else {
    if (a.structured !== undefined) fail('계산 요약에는 AI가 선택한 근거를 넣을 수 없습니다.');
    if (result.answer !== spaceRulesSummary(comparison)) fail('계산 요약 문장이 저장된 근거와 일치하지 않습니다.');
  }
  if (a.modelRecovered !== undefined) { if (typeof a.modelRecovered !== 'boolean') fail('응답 모델 복구 표시를 확인하세요.'); result.modelRecovered = a.modelRecovered; }
  for (const field of ['notice','code','analysisPath']) if (a[field] !== undefined) result[field] = string(a[field],`AI ${field}`,field === 'notice' ? 1200 : 120);
  const contentFingerprint = dataFingerprint(result);
  if ((!saving || a.contentFingerprint !== undefined) && fingerprint(a.contentFingerprint,'AI 설명 내용 지문') !== contentFingerprint) fail('저장한 AI 설명의 내용 지문이 일치하지 않습니다.');
  // A reproducibility checksum, not an authenticated signature or proof of official approval.
  return {...result, contentFingerprint};
}
function normalizeSnapshot(s) {
  keys(s, ['id', 'name', 'createdAt', 'comparison', 'ai'], '검토 스냅샷');
  const comparison = validateComparison(s.comparison);
  return {id: id(s.id), name: string(s.name, '저장 이름', 120), createdAt: instant(s.createdAt, '저장시각'), comparison,
    ...(s.ai !== undefined ? {ai:normalizeSnapshotAi(s.ai, comparison)} : {})};
}

export function validateWorkspace(value, {regionId: expected, now} = {}) {
  const w = jsonCopy(value);
  keys(w, ['format', 'version', 'regionId', 'revision', 'updatedAt', 'observations', 'history', 'scenarios', 'snapshots'], '검토 작업공간');
  if (w.format !== TWIN_FORMAT || w.version !== TWIN_VERSION) fail('지원하지 않는 공공공간 검토 백업입니다.');
  regionId(w.regionId); if (expected !== undefined && w.regionId !== regionId(expected)) fail('다른 지역의 백업입니다. 현재 지역 자료와 합칠 수 없습니다.');
  integer(w.revision, '작업 버전', 0, 1000000); instant(w.updatedAt, '수정시각');
  object(w.observations, '현장 확인 목록');
  if (Object.keys(w.observations).length > MAX_OBSERVATIONS) fail('현장 확인 기록의 보관 한도를 넘었습니다.');
  w.observations = Object.fromEntries(Object.entries(w.observations).map(([k, v]) => [id(k, '공간 ID'), normalizeObservation(v, {now})]));
  if (!Array.isArray(w.history) || w.history.length > MAX_HISTORY) fail('변경 이력의 보관 한도를 넘었습니다.');
  w.history = w.history.map(h => normalizeHistory(h, now));
  if (new Set(w.history.map(h => h.id)).size !== w.history.length) fail('변경 이력이 중복되었습니다.');
  if (w.history.some(h => h.revision > w.revision) || Object.values(w.observations).some(o => (o.revision || 0) > w.revision)) fail('기록 버전이 작업공간 버전을 넘습니다.');
  if (!Array.isArray(w.scenarios) || w.scenarios.length > MAX_SCENARIOS) fail('비교 대안은 최대 3개입니다.');
  w.scenarios = w.scenarios.map(normalizeScenario);
  if (w.scenarios.some(s => !s.id) || new Set(w.scenarios.map(s => s.id)).size !== w.scenarios.length) fail('대안 ID가 없거나 중복되었습니다.');
  if (!Array.isArray(w.snapshots) || w.snapshots.length > MAX_SNAPSHOTS) fail('검토 결과의 보관 한도를 넘었습니다.');
  w.snapshots = w.snapshots.map(normalizeSnapshot);
  if (new Set(w.snapshots.map(s => s.id)).size !== w.snapshots.length || w.snapshots.some(s => s.comparison.regionId !== w.regionId || s.comparison.workspaceRevision > w.revision)) fail('저장한 결과의 ID·지역·버전이 일치하지 않습니다.');
  if (utf8Bytes(JSON.stringify(w)) > MAX_WORKSPACE_BYTES) fail('검토 작업공간이 2MiB를 넘습니다.');
  return w;
}
function touch(workspace, now) { workspace.revision++; workspace.updatedAt = nowIso(now); return workspace; }
export function recordObservation(workspace, assetId, input, {now} = {}) {
  const w = validateWorkspace(workspace, {now}), key = id(assetId, '공간 ID');
  const observation = normalizeObservation(input, {now});
  if (!own(w.observations, key) && Object.keys(w.observations).length >= MAX_OBSERVATIONS) fail('현장 확인 기록 한도입니다. 기존 자료를 백업해 주세요.');
  if (w.history.length >= MAX_HISTORY) fail('변경 이력 한도입니다. 기존 자료를 백업해 주세요.');
  const previous = w.observations[key] || null;
  const next = {...observation, recordedAt: nowIso(now), revision: w.revision + 1};
  w.observations[key] = next;
  w.history.push({id: `change-${w.revision + 1}-${dataFingerprint({key,next}).slice(-12)}`, assetId: key, recordedAt: next.recordedAt, previous, next, revision: w.revision + 1});
  return validateWorkspace(touch(w, now), {now});
}
export function upsertScenario(workspace, input, {now} = {}) {
  const w = validateWorkspace(workspace, {now}), s = normalizeScenario(input);
  if (!s.id) {
    let suffix = w.revision + 1;
    do { s.id = `scenario-${suffix++}`; } while (w.scenarios.some(existing => existing.id === s.id));
  }
  const found = w.scenarios.findIndex(item => item.id === s.id);
  if (found < 0) { if (w.scenarios.length >= MAX_SCENARIOS) fail('대안은 최대 3개입니다. 기존 대안을 수정하세요.'); w.scenarios.push(s); }
  else w.scenarios[found] = s;
  return validateWorkspace(touch(w, now), {now});
}

export function normalizeQuery(value, {allowEmpty = false} = {}) {
  const q = jsonCopy(value);
  keys(q, ['dayOfWeek', 'start', 'end', 'assetIds', 'referencePoint', 'radiusM'], '검토 조건');
  integer(q.dayOfWeek, '검토 요일', 1, 7);
  const start = timeMinutes(q.start, '검토 시작'), end = timeMinutes(q.end, '검토 종료', true);
  if (end <= start) fail('검토 종료시각은 시작시각보다 늦어야 합니다.');
  let assetIds = null;
  if (q.assetIds !== undefined && q.assetIds !== null) {
    if (!Array.isArray(q.assetIds) || q.assetIds.length < (allowEmpty ? 0 : 1) || q.assetIds.length > MAX_SELECTED) fail(`검토 공간은 1~${MAX_SELECTED}개를 선택하세요.`);
    assetIds = q.assetIds.map(k => id(k)); if (new Set(assetIds).size !== assetIds.length) fail('선택 공간이 중복되었습니다.');
  }
  const referencePoint = q.referencePoint === undefined || q.referencePoint === null ? null : point(q.referencePoint, '기준점');
  let radiusM = null;
  if (q.radiusM !== undefined && q.radiusM !== null && q.radiusM !== '') {
    if (!referencePoint || typeof q.radiusM !== 'number' || !Number.isFinite(q.radiusM) || q.radiusM < 1 || q.radiusM > 50000) fail('거리 조건은 기준점과 1~50,000m 범위를 함께 입력하세요.');
    radiusM = q.radiusM;
  }
  return {dayOfWeek: q.dayOfWeek, start: q.start, end: q.end, assetIds, referencePoint, radiusM};
}
export function straightDistance(a, b) {
  point(a); point(b); const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}
function roundHours(minutes) { return Math.round(minutes / 60 * 10000) / 10000; }
function scheduleResult(state, query) {
  if (state.operatingStatus === 'closed') return {availability:'unavailable',reason:'운영 중단 조건',overlapMinutes:0};
  if (state.operatingStatus === 'unknown') return {availability:'unknown',reason:'운영 조건 미확인',overlapMinutes:0};
  if (!state.daysOfWeek.includes(query.dayOfWeek)) return {availability:'unavailable',reason:'해당 요일 미개방',overlapMinutes:0};
  const a = timeMinutes(query.start, '검토 시작'), b = timeMinutes(query.end, '검토 종료', true);
  const overlapMinutes = Math.max(0, Math.min(b, timeMinutes(state.closes, '개방 종료', true)) - Math.max(a, timeMinutes(state.opens, '개방 시작')));
  const availability = overlapMinutes === b - a ? 'eligible' : 'unavailable';
  return {availability,overlapMinutes,reason:availability === 'eligible' ? '요청 시간 전체에 개방 조건 충족' : overlapMinutes ? '요청 시간 일부만 개방' : '요청 시간 미개방'};
}
function evaluateAsset(asset, observation, change, query, now) {
  const freshness = observationState(observation, {now, asset});
  const hasRecord = freshness.state === 'recorded', state = change || (hasRecord ? observation : {operatingStatus: 'unknown', daysOfWeek: [], opens: null, closes: null});
  const provenance = change ? 'user-assumption' : hasRecord ? 'field-record' : freshness.state === 'stale' ? 'stale-record' : 'unverified-source';
  const result = scheduleResult(state, query);
  const {availability, overlapMinutes} = result;
  const reason = availability === 'unknown' ? (change ? '변경안에서도 운영 조건 미입력' : freshness.reason) : result.reason + (!change && freshness.sourceBinding === 'missing' ? ' · 이전 기록의 원자료 변경 추적 불가' : '');
  return {assetId: asset.id, name: asset.name, availability, provenance, reason,
    observedOn: observation?.observedOn || null, evidence: change ? '' : (observation?.evidence || ''),
    operatingStatus: state.operatingStatus, daysOfWeek: state.daysOfWeek, opens: state.opens, closes: state.closes,
    overlapMinutes, distanceM: query.referencePoint ? Math.round(straightDistance(query.referencePoint, asset.coordinates) * 10) / 10 : null, sourceDate: asset.source.date};
}
function metric(assets, workspace, query, scenario, now) {
  const changes = new Map((scenario?.changes || []).map(c => [c.assetId, c]));
  const rows = assets.map(asset => evaluateAsset(asset, workspace.observations[asset.id], changes.get(asset.id), query, now));
  const applied = [...changes].filter(([key]) => assets.some(a => a.id === key)).map(([,v]) => v);
  const costComplete = scenario ? applied.every(c => c.additionalAnnualCost !== null) : true;
  return {id: scenario?.id || 'baseline', name: scenario?.name || '현재 확인기록', kind: scenario ? 'user-scenario' : 'current-records',
    eligibleCount: rows.filter(r => r.availability === 'eligible').length,
    unavailableCount: rows.filter(r => r.availability === 'unavailable').length,
    unknownCount: rows.filter(r => r.availability === 'unknown').length,
    overlapHours: roundHours(rows.reduce((sum, r) => sum + r.overlapMinutes, 0)),
    additionalAnnualCost: costComplete ? Math.round(applied.reduce((sum, c) => sum + Math.round((c.additionalAnnualCost || 0) * 100), 0)) / 100 : null,
    costUnit: '만원/년', costComplete, changedCount: applied.length, comparable: false, delta: null, rows,
    note: scenario?.note || (scenario ? '' : '유효한 사용자 현장확인 기록만 적용합니다. 공식 운영 승인이나 예약 가능 여부를 뜻하지 않습니다.')};
}
export const TWIN_LIMITATIONS = Object.freeze([
  '공개 원자료의 공간별 항목을 셉니다. 같은 건물의 여러 회의실이 포함될 수 있으며 시설 수·주민 수·실제 이용자 수와 다릅니다.',
  '원자료 운영시간 문장은 참고로 보존하고 자동 확정하지 않습니다. 유효한 현장확인 기록이 없는 공간은 미확인입니다.',
  '현재안은 사용자가 기록한 확인값, 변경안은 사용자가 입력한 가정입니다. 예약·공휴일·행사·정원·법적 사용 가능 여부는 별도 확인해야 합니다.',
  '개방시간 합계는 공간마다 요청 시간과 겹치는 시간을 더한 값입니다. 운영 인력의 근무시간이나 주민 이용시간이 아닙니다.',
  '기준점 거리는 좌표 간 직선거리입니다. 실제 보행거리·이동시간·접근성 인증이 아닙니다.',
  '추가 연간 운영비는 변경 공간별 사용자 가정을 만원 단위로 합한 값입니다. 미입력은 미산정이고 기존 전체 운영비·견적·사업 효과를 뜻하지 않습니다.',
  '미확인 공간이 있으면 전체 공간 수 변화량은 산정하지 않습니다. 현장확인 기록은 90일 또는 지정 재확인 기한이 지나면 재확인 대상으로 처리합니다.',
  '원자료 지문이 연결된 확인 기록은 공간 이름·주소·좌표·원자료 운영시간·출처 등이 달라지면 재확인 대상으로 처리합니다. 지문이 없는 이전 기록은 호환하여 읽지만 과거 원자료 변경 여부를 추적할 수 없습니다.',
]);
export function compareWorkspace({assets, workspace, query, now} = {}) {
  const w = validateWorkspace(workspace, {now}), q = normalizeQuery(query), data = jsonCopy(assets);
  if (!Array.isArray(data) || data.length > MAX_ASSETS) fail('공간자료 형식을 확인하세요.');
  const seen = new Set();
  for (const asset of data) {
    object(asset, '공간'); id(asset.id); regionId(asset.regionId); point(asset.coordinates);
    string(asset.name, '공간 이름', 240); object(asset.source, '공간 출처'); date(asset.source.date, '자료 기준일', true); url(asset.source.url); string(asset.source.name, '출처명', 500, {optional: true});
    if (asset.regionId !== w.regionId || seen.has(asset.id)) fail('공간자료의 지역 또는 ID가 작업공간과 일치하지 않습니다.'); seen.add(asset.id);
  }
  if (q.assetIds?.some(key => !seen.has(key))) fail('현재 자료에서 찾을 수 없는 공간이 선택되었습니다. 자료 갱신 후 다시 선택하세요.');
  let selected = q.assetIds ? q.assetIds.map(key => data.find(a => a.id === key)) : data;
  if (selected.length > MAX_SELECTED) fail(`한 번에 ${MAX_SELECTED}개 이하의 공간을 선택하세요.`);
  const beforeDistance = selected.length;
  if (q.radiusM !== null) selected = selected.filter(a => straightDistance(q.referencePoint, a.coordinates) <= q.radiusM);
  // Changes outside the selected analysis set may remain saved, but never vanish from a calculated alternative silently.
  const selectedIds = new Set(selected.map(a => a.id));
  for (const s of w.scenarios) if (s.changes.some(c => !selectedIds.has(c.assetId))) fail(`‘${s.name}’의 변경 공간이 현재 선택·거리 범위에 없습니다. 같은 공간을 선택하거나 대안을 수정하세요.`);
  const baseline = metric(selected, w, q, null, now);
  const alternatives = w.scenarios.map(s => {
    const m = metric(selected, w, q, s, now);
    m.comparable = baseline.unknownCount === 0 && m.unknownCount === 0;
    m.delta = m.comparable ? {eligibleCount: m.eligibleCount - baseline.eligibleCount, overlapHours: Math.round((m.overlapHours - baseline.overlapHours) * 10000) / 10000} : null;
    return m;
  });
  baseline.comparable = baseline.unknownCount === 0;
  const assetFingerprint = dataFingerprint(selected.slice().sort((a,b) => a.id.localeCompare(b.id)).map(a => ({id:a.id,sourceFingerprint:assetSourceFingerprint(a)})));
  const result = {version: 1, regionId: w.regionId, generatedAt: nowIso(now), workspaceRevision: w.revision, query: {...q, assetIds: selected.map(a => a.id)},
    assetFingerprint, fingerprint: dataFingerprint({assetFingerprint, query:q, observations:w.observations, scenarios:w.scenarios}),
    selectedCount: selected.length, excludedByDistance: beforeDistance - selected.length, unlocatedCount: 0,
    baseline, alternatives, sources: selected.map(a => ({assetId:a.id,...a.source})), limitations: [...TWIN_LIMITATIONS]};
  return validateComparison(result);
}

export function saveSnapshot(workspace, comparison, {name = '검토 결과', now, ai} = {}) {
  const w = validateWorkspace(workspace, {now}), c = validateComparison(jsonCopy(comparison));
  if (c.regionId !== w.regionId || c.workspaceRevision !== w.revision) fail('현재 기록과 다른 계산 결과입니다. 다시 계산한 뒤 저장하세요.');
  if (w.snapshots.length >= MAX_SNAPSHOTS) fail(`검토 결과는 최대 ${MAX_SNAPSHOTS}개입니다. 백업 후 새 작업공간을 사용하세요.`);
  const stamp = nowIso(now);
  w.snapshots.push({id:`snapshot-${w.revision+1}-${dataFingerprint({fingerprint:c.fingerprint,stamp}).slice(-12)}`,name:string(name,'저장 이름',120),createdAt:stamp,comparison:c,
    ...(ai !== undefined && ai !== null ? {ai:normalizeSnapshotAi(ai,c,{saving:true})} : {})});
  return validateWorkspace(touch(w, now), {now});
}
export function diffSnapshots(previous, next) {
  const a = validateComparison(jsonCopy(previous?.comparison || previous)), b = validateComparison(jsonCopy(next?.comparison || next));
  const scope = q => ({...q,assetIds:[...(q.assetIds || [])].sort()});
  const sameScope = a.regionId === b.regionId && dataFingerprint(scope(a.query)) === dataFingerprint(scope(b.query));
  if (!sameScope) return {comparable:false,reason:'지역·선택 공간·요일·시간·거리 조건이 달라 직접 비교할 수 없습니다.',dataChanged:a.assetFingerprint!==b.assetFingerprint,baseline:null,alternatives:[]};
  const difference = (x,y) => ({eligibleCount:y.eligibleCount-x.eligibleCount,unknownCount:y.unknownCount-x.unknownCount,overlapHours:Math.round((y.overlapHours-x.overlapHours)*10000)/10000});
  return {comparable:true,reason:'같은 조건의 기록상 변화입니다. 주민 편익·정책 효과의 실측값이 아닙니다.',dataChanged:a.assetFingerprint!==b.assetFingerprint,
    baseline:difference(a.baseline,b.baseline),alternatives:b.alternatives.filter(y=>a.alternatives.some(x=>x.id===y.id)).map(y=>({id:y.id,name:y.name,...difference(a.alternatives.find(x=>x.id===y.id),y)}))};
}
export function serializeWorkspace(workspace, options = {}) {
  const valid = validateWorkspace(workspace, options), readable = JSON.stringify(valid, null, 2);
  // Whitespace must not produce a backup that this same version cannot re-import.
  return utf8Bytes(readable) <= MAX_WORKSPACE_BYTES ? readable : JSON.stringify(valid);
}
export function parseWorkspace(text, options = {}) {
  if (typeof text !== 'string' || utf8Bytes(text) > MAX_WORKSPACE_BYTES) fail('JSON 백업은 UTF-8 2MiB 이하로 가져오세요.');
  let value; try { value = JSON.parse(text); } catch { fail('JSON 백업 파일을 읽을 수 없습니다.'); }
  return validateWorkspace(value, options);
}
/** Merge preserves all known records; conflicts in same revision need explicit review. */
export function mergeWorkspaces(current, imported, {now} = {}) {
  const a = validateWorkspace(current, {now}), b = validateWorkspace(imported, {regionId:a.regionId,now});
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  const empty = !Object.keys(a.observations).length && !a.history.length && !a.scenarios.length && !a.snapshots.length;
  if (empty) return b;
  const merged = {...a, observations:{...a.observations}, revision:Math.max(a.revision,b.revision)+1,updatedAt:nowIso(now)};
  const same = (x,y) => dataFingerprint(x) === dataFingerprint(y);
  for (const [key,incoming] of Object.entries(b.observations)) {
    const existing = merged.observations[key];
    if (!existing || same(existing,incoming)) {merged.observations[key] = incoming;continue;}
    // Dates must move forward. A late-entered older survey must not replace newer field knowledge.
    const earlier = [existing.observedOn,existing.recordedAt || ''].join('|');
    const later = [incoming.observedOn,incoming.recordedAt || ''].join('|');
    if (earlier === later) fail('같은 확인일·기록시각에 서로 다른 현황이 있습니다. 합치기 전에 원본을 확인하세요.');
    if (later > earlier) merged.observations[key] = incoming;
  }
  const mergeList = (left,right,label) => {
    const items = new Map(left.map(item=>[item.id,item]));
    for (const item of right) {
      if (items.has(item.id) && !same(items.get(item.id),item)) fail(`같은 ID의 ${label} 내용이 다릅니다. 기존 기록을 덮어쓰지 않았습니다.`);
      items.set(item.id,item);
    }
    return [...items.values()];
  };
  merged.history = mergeList(a.history,b.history,'변경 이력').sort((x,y)=>x.recordedAt.localeCompare(y.recordedAt)||x.id.localeCompare(y.id));
  merged.scenarios = mergeList(a.scenarios,b.scenarios,'대안');
  merged.snapshots = mergeList(a.snapshots,b.snapshots,'검토 결과').sort((x,y)=>x.createdAt.localeCompare(y.createdAt)||x.id.localeCompare(y.id));
  return validateWorkspace(merged,{regionId:a.regionId,now});
}
