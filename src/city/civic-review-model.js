/** Local review records. All text remains plain text: callers must escape it when rendering HTML. */
export const NOTES_KEY = 'seoon.civic-reviews.v1';
export const MAX_NOTES = 30;

const FORMAT = 'seoon-civic-reviews';
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const STATUSES = new Set(['검토 중', '확인 필요', '검토 완료']);
const REVIEW_THEMES = new Set(['agenda', 'space', 'reuse', 'coordination']);
const DISPLAYED_ARG_KEYS = new Set(['category', 'target', 'service', 'dong', 'dongs', 'place', 'radiusM', 'n', 'categories', 'datetime', 'heightM', 'query', 'yearFrom', 'yearTo', 'perKm2', 'theme']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EDITABLE_KEYS = ['title', 'status', 'owner', 'due', 'fieldNotes'];
let idSequence = 0;

function fail(message, code = 'INVALID_NOTE', cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  throw error;
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function text(value, limit, label, {empty = true, trim = false} = {}) {
  if (typeof value !== 'string') fail(`${label} 형식이 올바르지 않습니다.`);
  const result = trim ? value.trim() : value;
  if ((!empty && !result.trim()) || result.length > limit * 2 || Array.from(result).length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) {
    fail(`${label}은(는) ${limit}자 이내의 텍스트여야 합니다.`);
  }
  return result;
}

const bytes = value => new TextEncoder().encode(value).byteLength;

/** Clone JSON values without invoking getters, retaining prototypes, or silently losing non-JSON values. */
function safeJson(value, label, maxBytes = MAX_RESULT_BYTES) {
  let count = 0;
  const ancestors = new Set();
  function visit(item, depth) {
    if (++count > 50000 || depth > 24) fail(`${label}의 자료 구조가 너무 큽니다.`);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') return text(item, 100000, label);
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || (!Array.isArray(item) && !isRecord(item))) fail(`${label}에는 JSON 자료만 저장할 수 있습니다.`);
    if (ancestors.has(item)) fail(`${label}에 순환 참조가 있습니다.`);
    if (Object.getOwnPropertySymbols(item).length) fail(`${label}에는 JSON 자료만 저장할 수 있습니다.`);
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      if (item.length > 10000) fail(`${label}의 항목이 너무 많습니다.`);
      result = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !('value' in descriptor)) fail(`${label}의 배열 형식이 올바르지 않습니다.`);
        result.push(visit(descriptor.value, depth + 1));
      }
    } else {
      result = {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        if (key.length > 256 || !('value' in descriptor)) fail(`${label}의 필드 형식이 올바르지 않습니다.`);
        result[key] = visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
    return result;
  }
  const result = visit(value, 0);
  if (bytes(JSON.stringify(result)) > maxBytes) fail(`${label}의 용량이 너무 큽니다.`, 'SIZE_LIMIT');
  return result;
}

function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) fail(`${label} 형식이 올바르지 않습니다.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function timestamp(now = new Date()) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(date.getTime())) fail('저장 시각이 올바르지 않습니다.');
  return isoDate(date.toISOString(), '저장 시각');
}

function dueDate(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('확인 예정일은 YYYY-MM-DD 형식이어야 합니다.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('실제 달력에 있는 확인 예정일을 입력하세요.');
  return value;
}

function list(value, label, limit = 100) {
  if (!Array.isArray(value) || value.length > limit) fail(`${label}의 목록 형식이 올바르지 않습니다.`);
  return value;
}

function textList(value, label) {
  for (const item of list(value, label)) text(item, 8000, label);
}

function recordList(value, label, limit = 100) {
  for (const item of list(value, label, limit)) if (!isRecord(item)) fail(`${label}의 항목 형식이 올바르지 않습니다.`);
}

function optionalText(record, key, label, limit = 8000, nullable = false) {
  const value = record[key];
  if (value === undefined || (nullable && value === null)) return;
  text(value, limit, label);
}

function validateReview(review) {
  if (!isRecord(review)) fail('업무 검토사항 형식이 올바르지 않습니다.');
  for (const key of ['inputText', 'inputKind', 'provenance', 'scopeNote', 'sourceScope', 'alternativeNotice', 'departmentNotice']) optionalText(review, key, '업무 검토 설명');
  for (const key of ['commonCriteria', 'discussionQuestions', 'missingData']) if (review[key] !== undefined) textList(review[key], '업무 검토사항');
  for (const key of ['alternatives', 'departments']) {
    if (review[key] === undefined) continue;
    recordList(review[key], '업무 검토사항');
    for (const item of review[key]) {
      if (item.checks !== undefined) textList(item.checks, '확인사항');
      if (key === 'alternatives') {
        optionalText(item, 'title', '대안 제목');
        optionalText(item, 'focus', '대안 설명');
        if (item.origin !== undefined && !['user', 'template'].includes(item.origin)) fail('대안의 입력 출처 형식이 올바르지 않습니다.');
      } else optionalText(item, 'name', '협의 부서 이름');
    }
  }
}

function validateReviewContext(context) {
  if (context === null) return;
  if (!isRecord(context) || !REVIEW_THEMES.has(context.theme)) fail('검토 유형이 올바르지 않습니다.', 'INVALID_REVIEW_CONTEXT');
  if (typeof context.text !== 'string' || context.text.length > 1200) fail('검토내용은 1200자 이내의 텍스트여야 합니다.', 'INVALID_REVIEW_CONTEXT');
  if (!Array.isArray(context.alternatives) || context.alternatives.length > 3
    || context.alternatives.some(item => typeof item !== 'string' || item.length > 140)) {
    fail('검토 대안은 각각 140자 이내의 텍스트로 최대 3개까지 저장할 수 있습니다.', 'INVALID_REVIEW_CONTEXT');
  }
}

function validateMap(map) {
  if (map === undefined || map === null) return;
  if (!isRecord(map)) fail('지도 결과 형식이 올바르지 않습니다.');
  if (map.focus !== undefined && map.focus !== null) {
    if (!isRecord(map.focus)) fail('지도 중심 형식이 올바르지 않습니다.');
    const {lon, lat, radiusM, dongId} = map.focus;
    if (dongId !== undefined) text(dongId, 80, '행정동 식별자');
    if ((lon !== undefined || lat !== undefined) && (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)) fail('지도 중심 좌표가 올바르지 않습니다.');
    if (radiusM !== undefined && (!Number.isFinite(radiusM) || radiusM < 0 || radiusM > 1000000)) fail('지도 반경이 올바르지 않습니다.');
  }
  if (map.highlight === undefined || map.highlight === null) return;
  const highlight = map.highlight;
  if (!isRecord(highlight) || highlight.type !== 'FeatureCollection') fail('지도 지점 목록 형식이 올바르지 않습니다.');
  recordList(highlight.features, '지도 지점', 5000);
  for (const feature of highlight.features) {
    const geometry = feature.geometry;
    if (feature.type !== 'Feature' || !isRecord(geometry) || geometry.type !== 'Point'
      || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || geometry.coordinates.length > 3
      || !geometry.coordinates.every(Number.isFinite) || Math.abs(geometry.coordinates[0]) > 180 || Math.abs(geometry.coordinates[1]) > 90
      || (feature.properties !== undefined && feature.properties !== null && !isRecord(feature.properties))) fail('지도 결과에는 올바른 Point 지점만 저장할 수 있습니다.');
    if (feature.properties) {
      optionalText(feature.properties, 'name', '지도 지점 이름');
      if (feature.properties.distanceM !== undefined && (!Number.isFinite(feature.properties.distanceM) || feature.properties.distanceM < 0)) fail('지도 지점 거리는 0 이상의 유한한 숫자여야 합니다.');
    }
  }
}

function cleanResult(value) {
  const result = safeJson(value, '분석 결과');
  if (!isRecord(result) || !['llm', 'rules'].includes(result.mode)) fail('분석 결과의 응답 방식이 올바르지 않습니다.');
  text(result.answer, 100000, '분석 답변', {empty: false});
  for (const key of ['model', 'code', 'notice', 'analysisPath']) optionalText(result, key, '분석 응답 설명');
  if (result.steps !== undefined) {
    recordList(result.steps, '조회 내역');
    for (const step of result.steps) {
      text(step.tool, 100, '조회 도구');
      text(step.summary, 8000, '조회 요약');
      if (step.args !== undefined && !isRecord(step.args)) fail('조회 인자 형식이 올바르지 않습니다.');
      for (const [key, value] of Object.entries(step.args || {})) {
        if (!DISPLAYED_ARG_KEYS.has(key)) continue;
        const scalar = item => item === null || ['string', 'number', 'boolean'].includes(typeof item);
        if (!(Array.isArray(value) ? value.every(scalar) : scalar(value))) fail('표시할 조회 인자는 텍스트·숫자 또는 그 목록이어야 합니다.');
      }
      if (step.ok !== undefined && typeof step.ok !== 'boolean') fail('조회 상태 형식이 올바르지 않습니다.');
    }
  }
  if (result.sources !== undefined) {
    recordList(result.sources, '출처', 250);
    for (const source of result.sources) {
      text(source.name, 500, '출처 이름');
      for (const key of ['url', 'sourceUrl']) if (source[key] !== undefined && source[key] !== null) text(source[key], 4096, '출처 주소');
      for (const key of ['date', 'dateBasis']) optionalText(source, key, '출처 기준일', 500, true);
    }
  }
  if (result.caveats !== undefined) textList(result.caveats, '자료의 한계');
  if (result.brief !== undefined && result.brief !== null) {
    if (!isRecord(result.brief)) fail('업무 검토 메모 형식이 올바르지 않습니다.');
    for (const key of ['title', 'basis']) optionalText(result.brief, key, '검토 메모 설명');
    if (result.brief.evidence !== undefined) {
      recordList(result.brief.evidence, '검토 근거');
      for (const item of result.brief.evidence) for (const key of ['title', 'summary']) optionalText(item, key, '검토 근거 설명');
    }
    for (const key of ['nextActions', 'missingData']) if (result.brief[key] !== undefined) textList(result.brief[key], '검토사항');
    if (result.brief.review !== undefined && result.brief.review !== null) validateReview(result.brief.review);
  }
  validateMap(result.map);
  return result;
}

function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (globalThis.crypto?.getRandomValues) {
      const random = globalThis.crypto.getRandomValues(new Uint8Array(16));
      return `note-${Array.from(random, item => item.toString(16).padStart(2, '0')).join('')}`;
    }
  } catch { /* Local record IDs are identifiers, never authentication tokens. */ }
  return `note-${Date.now().toString(36)}-${(++idSequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Strictly validate a complete record; return a fresh, JSON-safe copy or throw. */
export function normalizeNote(raw) {
  if (!isRecord(raw)) fail('검토노트 형식이 올바르지 않습니다.');
  const value = safeJson(raw, '검토노트', MAX_RESULT_BYTES + 32768);
  const id = text(value.id, 128, '검토노트 식별자', {empty: false});
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/u.test(id)) fail('검토노트 식별자가 올바르지 않습니다.');
  const createdAt = isoDate(value.createdAt, '최초 저장 시각');
  const updatedAt = isoDate(value.updatedAt, '수정 시각');
  if (updatedAt < createdAt) fail('수정 시각은 최초 저장 시각보다 빠를 수 없습니다.');
  if (!STATUSES.has(value.status)) fail('검토 상태가 올바르지 않습니다.');
  const reviewContext = value.reviewContext === undefined || value.reviewContext === null ? null : safeJson(value.reviewContext, '검토 맥락', 16384);
  validateReviewContext(reviewContext);
  return {
    id,
    title: text(value.title, 120, '제목', {empty: false, trim: true}),
    question: text(value.question, 2000, '질문', {empty: false, trim: true}),
    queryScope: text(value.queryScope, 160, '질문 당시 구역', {empty: false, trim: true}),
    dongId: text(value.dongId, 80, '행정동 식별자', {empty: false, trim: true}),
    createdAt, updatedAt,
    completedAt: text(value.completedAt, 160, '분석 완료 시각', {empty: false}),
    reviewContext,
    result: cleanResult(value.result),
    status: value.status,
    owner: text(value.owner, 80, '담당자', {trim: true}),
    due: dueDate(value.due),
    fieldNotes: text(value.fieldNotes, 4000, '현장 확인 메모'),
  };
}

export function makeNote(snapshot, {id, now} = {}) {
  if (!isRecord(snapshot)) fail('저장할 분석 결과가 없습니다.');
  const fields = {};
  for (const key of ['question', 'queryScope', 'dongId', 'completedAt', 'reviewContext', 'result']) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
    if (!descriptor) continue;
    if (!('value' in descriptor)) fail('분석 기록의 필드 형식이 올바르지 않습니다.');
    if (descriptor.value !== undefined) fields[key] = descriptor.value;
  }
  const source = safeJson(fields, '분석 기록', MAX_RESULT_BYTES + 32768);
  const savedAt = timestamp(now);
  const question = text(source.question, 2000, '질문', {empty: false, trim: true});
  return normalizeNote({
    id: id ?? newId(), title: Array.from(question).slice(0, 80).join(''), question,
    queryScope: source.queryScope || '서구 전체', dongId: source.dongId || 'all',
    createdAt: savedAt, updatedAt: savedAt, completedAt: source.completedAt || savedAt,
    reviewContext: source.reviewContext ?? null, result: source.result,
    status: '검토 중', owner: '', due: '', fieldNotes: '',
  });
}

/** Only editable review fields change; source evidence and original query stay intact. */
export function updateNote(note, patch, now) {
  const original = normalizeNote(note);
  if (!isRecord(patch)) fail('수정 내용 형식이 올바르지 않습니다.');
  const changes = {};
  for (const key of EDITABLE_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(patch, key);
    if (!descriptor) continue;
    if (!('value' in descriptor)) fail('수정 내용에는 텍스트만 사용할 수 있습니다.');
    changes[key] = descriptor.value;
  }
  const requestedAt = timestamp(now);
  const updatedAt = timestamp(Math.max(Date.parse(requestedAt), Date.parse(original.updatedAt) + 1));
  return normalizeNote({...original, ...changes, updatedAt});
}

function normalizeList(notes, {duplicates = false} = {}) {
  if (!Array.isArray(notes)) fail('검토노트 목록 형식이 올바르지 않습니다.', 'INVALID_FORMAT');
  if (notes.length > MAX_NOTES) fail(`검토노트는 최대 ${MAX_NOTES}개까지 보관할 수 있습니다.`, 'NOTE_LIMIT');
  const normalized = [];
  for (let index = 0; index < notes.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(notes, String(index));
    if (!descriptor || !('value' in descriptor)) fail('검토노트 목록 형식이 올바르지 않습니다.', 'INVALID_FORMAT');
    normalized.push(normalizeNote(descriptor.value));
  }
  if (!duplicates && new Set(normalized.map(note => note.id)).size !== normalized.length) fail('중복된 검토노트 식별자가 있습니다.', 'DUPLICATE_ID');
  return normalized;
}

export function serializeNotes(notes) {
  const payload = JSON.stringify({format: FORMAT, version: 1, exportedAt: new Date().toISOString(), notes: normalizeList(notes)}, null, 2);
  if (bytes(payload) > MAX_FILE_BYTES) fail('검토노트 백업은 3MB 이하여야 합니다.', 'SIZE_LIMIT');
  return payload;
}

/** Import is all-or-none. Nothing is written to storage until the caller accepts this result. */
export function parseNotes(value) {
  if (typeof value !== 'string') fail('백업 파일을 텍스트로 읽을 수 없습니다.', 'INVALID_FORMAT');
  if (value.length > MAX_FILE_BYTES || bytes(value) > MAX_FILE_BYTES) fail('검토노트 백업은 3MB 이하여야 합니다.', 'SIZE_LIMIT');
  let payload;
  try { payload = JSON.parse(value); } catch (cause) { fail('올바른 JSON 백업 파일이 아닙니다.', 'INVALID_FORMAT', cause); }
  if (!isRecord(payload) || payload.format !== FORMAT || payload.version !== 1) fail('서구온 검토노트 버전 1 백업 파일이 아닙니다.', 'INVALID_FORMAT');
  isoDate(payload.exportedAt, '백업 시각');
  return normalizeList(payload.notes);
}

/** Stable order: existing records retain their position; new incoming records are appended. */
export function mergeNotes(existing, incoming) {
  const combined = new Map();
  for (const note of [...normalizeList(existing, {duplicates: true}), ...normalizeList(incoming, {duplicates: true})]) {
    const previous = combined.get(note.id);
    if (!previous || note.updatedAt > previous.updatedAt) combined.set(note.id, note);
  }
  if (combined.size > MAX_NOTES) fail(`합치면 ${combined.size}개입니다. 최대 ${MAX_NOTES}개를 넘으므로 기존 기록을 유지했습니다.`, 'NOTE_LIMIT');
  return [...combined.values()];
}

function storageFor(storage, method) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    if (!target || typeof target[method] !== 'function') fail('이 브라우저에서 검토노트 저장소를 사용할 수 없습니다.', 'STORAGE_UNAVAILABLE');
    return target;
  } catch (cause) {
    if (cause?.code === 'STORAGE_UNAVAILABLE') throw cause;
    fail('이 브라우저에서 검토노트 저장소에 접근할 수 없습니다.', 'STORAGE_UNAVAILABLE', cause);
  }
}

export function readNotes(storage) {
  let value;
  try { value = storageFor(storage, 'getItem').getItem(NOTES_KEY); }
  catch (cause) {
    const error = new Error('브라우저 저장소에 접근할 수 없어 검토노트를 읽지 못했습니다.');
    error.code = 'STORAGE_UNAVAILABLE'; error.cause = cause;
    return {notes: [], error};
  }
  if (value === null) return {notes: [], error: null};
  try { return {notes: parseNotes(value), error: null}; }
  catch (cause) {
    const error = new Error('저장된 검토노트를 읽을 수 없습니다. 원본은 그대로 보존했습니다. 백업 파일을 확인하세요.');
    error.code = 'STORAGE_CORRUPT'; error.cause = cause;
    return {notes: [], error};
  }
}

export function writeNotes(notes, storage) {
  const normalized = normalizeList(notes);
  const payload = serializeNotes(normalized);
  const target = storageFor(storage, 'setItem');
  try { target.setItem(NOTES_KEY, payload); }
  catch (cause) {
    const quota = cause?.name === 'QuotaExceededError' || cause?.code === 22 || cause?.code === 1014;
    fail(quota ? '브라우저 저장 공간이 부족합니다. 기존 검토노트를 백업한 뒤 공간을 확보하세요.' : '검토노트를 저장하지 못했습니다. 브라우저의 저장소 접근 설정을 확인하세요.', quota ? 'STORAGE_QUOTA' : 'STORAGE_UNAVAILABLE', cause);
  }
  return normalized;
}
