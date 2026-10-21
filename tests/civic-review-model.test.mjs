import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTES_KEY, MAX_NOTES, makeNote, normalizeNote, updateNote, serializeNotes, parseNotes, mergeNotes, readNotes, writeNotes} from '../src/city/civic-review-model.js';
import {esc} from '../src/city/catalog.js';
import {reviewMemo} from '../src/city/ask-ai.js';
import {noteEditorHtml} from '../src/city/civic-review.js';

const savedAt = '2026-10-21T09:00:00.000Z';
const later = '2026-10-22T10:30:00.000Z';
const snapshot = () => ({
  question: '풍암동 생활시설과 주민 제안을 함께 검토해 줘', queryScope: '풍암동', dongId: 'seogu-18',
  completedAt: '2026. 10. 21. 오후 6:00:00 (한국시간)',
  reviewContext: {theme: 'agenda', text: '도서관 접근성 확인', alternatives: ['기존 도서관 이용시간 확대']},
  result: {
    ok: true, mode: 'rules', answer: '수록 시설 1곳을 확인했습니다.',
    steps: [{tool: 'find_facilities', args: {dong: '풍암동'}, ok: true, summary: '1곳 조회'}],
    sources: [{name: '공공자료', url: 'https://example.org/data', date: '2026-10-01'}],
    caveats: ['현장 확인이 필요합니다.'],
    map: {focus: {dongId: 'seogu-18'}, highlight: {type: 'FeatureCollection', features: [
      {type: 'Feature', geometry: {type: 'Point', coordinates: [126.87, 35.13]}, properties: {name: '도서관'}},
    ]}},
  },
});
const note = (id = 'review-1') => makeNote(snapshot(), {id, now: savedAt});
const memoryStorage = value => {
  const entries = new Map(value === undefined ? [] : [[NOTES_KEY, value]]);
  return {entries, getItem: key => entries.has(key) ? entries.get(key) : null, setItem: (key, data) => entries.set(key, data)};
};

test('검토노트: 스냅샷을 독립 복사하고 백업으로 원래 근거를 복원한다', () => {
  const source = snapshot();
  const result = makeNote(source, {id: 'review-1', now: savedAt});
  source.result.map.highlight.features[0].properties.name = '변경됨';
  assert.equal(result.result.map.highlight.features[0].properties.name, '도서관');
  assert.equal(result.status, '검토 중');
  assert.equal(result.createdAt, savedAt);
  assert.equal(result.completedAt, snapshot().completedAt);
  assert.deepEqual(parseNotes(serializeNotes([result])), [result]);
  const exported = JSON.parse(serializeNotes([result]));
  assert.equal(exported.format, 'seoon-civic-reviews');
  assert.equal(exported.version, 1);
});

test('검토노트: 기본 ID를 생성하며 제목은 질문 앞 80자로 만든다', () => {
  const source = snapshot(); source.question = '가'.repeat(120);
  const a = makeNote(source), b = makeNote(source);
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
  assert.equal(a.title, '가'.repeat(80));
  source.question = '🏠'.repeat(90); source.reviewContext = undefined;
  assert.equal(makeNote(source).title, '🏠'.repeat(80));
  assert.equal(makeNote(source).reviewContext, null);
});

test('검토노트: 상태와 담당자 메모만 수정하고 원본 질문·결과·시각은 보존한다', () => {
  const original = note();
  const updated = updateNote(original, {title: '현장 확인', status: '확인 필요', owner: '담당자', due: '2028-02-29', fieldNotes: '현장 확인\n시설 운영시간 재확인', result: {answer: '변조'}, question: '바꾼 질문', id: 'changed'}, later);
  assert.equal(updated.status, '확인 필요');
  assert.equal(updated.updatedAt, later);
  for (const key of ['id', 'question', 'queryScope', 'dongId', 'createdAt', 'completedAt', 'reviewContext', 'result']) assert.deepEqual(updated[key], original[key]);
  assert.equal(original.status, '검토 중');
  assert.equal(updated.fieldNotes, '현장 확인\n시설 운영시간 재확인');
  assert.throws(() => updateNote(original, {due: '2027-02-29'}));
  assert.throws(() => updateNote(original, {status: '승인 완료'}));
  assert.throws(() => updateNote(original, {owner: '가'.repeat(81)}));
  assert.throws(() => updateNote(original, {fieldNotes: '가'.repeat(4001)}));
  assert.throws(() => updateNote(original, {title: '가'.repeat(121)}));
});

test('검토노트: 시스템 시계가 뒤로 가도 수정 시각의 순서를 유지한다', () => {
  const updated = updateNote(note(), {status: '검토 완료'}, '2020-01-01T00:00:00.000Z');
  assert.ok(updated.updatedAt > savedAt);
});

test('검토노트: 프로토타입 키를 모든 깊이에서 제거하고 문자열은 렌더러가 이스케이프한다', () => {
  const raw = JSON.parse(JSON.stringify(note()));
  raw.fieldNotes = '<img src=x onerror="alert(1)"> & 확인';
  raw.result.extra = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"nested":{"prototype":{"bad":true},"text":"<script>alert(1)</script>"}}');
  const imported = parseNotes(JSON.stringify({format: 'seoon-civic-reviews', version: 1, exportedAt: savedAt, notes: [raw]}))[0];
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(imported.result.extra, {nested: {text: '<script>alert(1)</script>'}});
  assert.equal(imported.fieldNotes, raw.fieldNotes, '저장 모델은 텍스트를 HTML로 해석하지 않는다');
  assert.ok(!esc(imported.fieldNotes).includes('<img'));
  assert.ok(esc(imported.fieldNotes).includes('&lt;img'));
  assert.ok(!esc(imported.result.extra.nested.text).includes('<script'));
});

test('검토노트: 순환 참조·함수·비유한 수·getter는 저장하지 않는다', () => {
  for (const bad of [NaN, Infinity, () => 'x', undefined, 1n]) {
    const source = snapshot(); source.result.bad = bad;
    assert.throws(() => makeNote(source));
  }
  const circular = snapshot(); circular.result.self = circular.result;
  assert.throws(() => makeNote(circular));
  let called = false;
  const getter = snapshot();
  Object.defineProperty(getter.result, 'secret', {enumerable: true, get() {called = true; return 'unsafe';}});
  assert.throws(() => makeNote(getter));
  assert.equal(called, false);
});

test('검토노트: 손상된 결과 목록·좌표·도형·날짜는 복원하지 않는다', () => {
  const variants = [
    value => {value.result.steps = {length: 1};},
    value => {value.result.sources = [null];},
    value => {value.result.caveats = ['정상', {}];},
    value => {value.result.map.highlight.features[0].geometry.coordinates = [181, 35];},
    value => {value.result.map.highlight.features[0].geometry.type = 'Polygon';},
    value => {value.result.brief = {review: {alternatives: [null]}};},
    value => {value.createdAt = '2026-02-30T00:00:00.000Z';},
    value => {value.updatedAt = '2025-01-01T00:00:00.000Z';},
  ];
  for (const mutate of variants) {const value = note(); mutate(value); assert.throws(() => normalizeNote(value));}
});

test('검토노트: 가져온 검토맥락은 업무 유형·문자열·대안 배열 계약을 지켜야 한다', () => {
  const fromContext = reviewContext => {
    const value = {...note(), reviewContext};
    return parseNotes(JSON.stringify({format: 'seoon-civic-reviews', version: 1, exportedAt: savedAt, notes: [value]}))[0];
  };
  assert.equal(fromContext(null).reviewContext, null);
  for (const theme of ['agenda', 'space', 'reuse', 'coordination']) {
    const context = {theme, text: '가'.repeat(1200), alternatives: ['가'.repeat(140), '', '대안']};
    assert.deepEqual(fromContext(context).reviewContext, context);
  }
  const good = {theme: 'agenda', text: '주민 제안', alternatives: ['대안']};
  const malformed = [
    '검토 맥락', [], {},
    {...good, theme: 'living'}, {...good, theme: '__proto__'}, {...good, theme: {name: 'agenda'}},
    {...good, text: null}, {...good, text: 12}, {...good, text: {}}, {...good, text: '가'.repeat(1201)},
    {...good, text: '🏠'.repeat(601)},
    {...good, alternatives: '대안'}, {...good, alternatives: {0: '대안', length: 1}},
    {...good, alternatives: null}, {...good, alternatives: ['a', 'b', 'c', 'd']},
    {...good, alternatives: [null]}, {...good, alternatives: [{}]}, {...good, alternatives: [1]},
    {...good, alternatives: ['가'.repeat(141)]}, {...good, alternatives: ['🏠'.repeat(71)]},
  ];
  for (const context of malformed) assert.throws(() => fromContext(context), {code: 'INVALID_REVIEW_CONTEXT'});
});

test('검토노트: 표시할 scalar에 변환 불가능한 객체가 있으면 가져오기에서 거절한다', () => {
  const withBrief = () => {
    const value = note();
    value.result.brief = {evidence: [{}], review: {alternatives: [{checks: []}], departments: [{checks: []}]}};
    return value;
  };
  const fromBackup = value => parseNotes(JSON.stringify({format: 'seoon-civic-reviews', version: 1, exportedAt: savedAt, notes: [value]}))[0];
  const poison = {toString: 'invalid'};
  const mutations = [
    ...['inputText', 'inputKind', 'provenance', 'scopeNote', 'sourceScope', 'alternativeNotice', 'departmentNotice'].map(key => value => {value.result.brief.review[key] = poison;}),
    ...['title', 'focus', 'origin'].map(key => value => {value.result.brief.review.alternatives[0][key] = poison;}),
    value => {value.result.brief.review.alternatives[0].origin = 'unverified';},
    value => {value.result.brief.review.alternatives[0].checks = [poison];},
    value => {value.result.brief.review.departments[0].name = poison;},
    value => {value.result.brief.review.departments[0].checks = [poison];},
    ...['title', 'basis'].map(key => value => {value.result.brief[key] = poison;}),
    ...['title', 'summary'].map(key => value => {value.result.brief.evidence[0][key] = poison;}),
    ...['model', 'code', 'notice', 'analysisPath'].map(key => value => {value.result[key] = poison;}),
    ...['date', 'dateBasis'].map(key => value => {value.result.sources[0][key] = poison;}),
    value => {value.result.map.highlight.features[0].properties.name = poison;},
    value => {value.result.map.highlight.features[0].properties.distanceM = poison;},
    value => {value.result.map.highlight.features[0].properties.distanceM = '10';},
    value => {value.result.steps[0].args.dong = poison;},
    value => {value.result.steps[0].args.dongs = [poison];},
  ];
  for (const mutate of mutations) {
    const value = withBrief(); mutate(value);
    assert.throws(() => fromBackup(value), {code: 'INVALID_NOTE'});
  }
  const backward = withBrief();
  backward.result.sources[0].date = null;
  backward.result.sources[0].dateBasis = null;
  backward.result.brief.review.alternatives[0].origin = 'template';
  backward.result.metadata = {unrendered: {toString: 'retained JSON'}};
  const imported = fromBackup(backward);
  assert.deepEqual(imported.result.metadata, backward.result.metadata);
  assert.doesNotThrow(() => reviewMemo(imported));
  assert.doesNotThrow(() => noteEditorHtml(imported));
});

test('검토노트: 잘못된 백업은 일부도 반환하지 않고 기존 목록에 영향이 없다', () => {
  const existing = [note()];
  const invalid = {...note('review-2'), status: '잘못된 상태'};
  const payload = JSON.stringify({format: 'seoon-civic-reviews', version: 1, exportedAt: savedAt, notes: [note('review-3'), invalid]});
  assert.throws(() => parseNotes(payload));
  assert.deepEqual(existing, [note()]);
  for (const value of ['{', '{}', '[]', JSON.stringify({format: 'seoon-civic-reviews', version: 2, exportedAt: savedAt, notes: []})]) assert.throws(() => parseNotes(value));
  assert.throws(() => parseNotes(JSON.stringify({format: 'seoon-civic-reviews', version: 1, exportedAt: savedAt, notes: [note(), note()]})), {code: 'DUPLICATE_ID'});
  assert.throws(() => serializeNotes(new Array(1)), {code: 'INVALID_FORMAT'});
});

test('검토노트: 수량·파일 UTF-8 용량·개별 응답의 크기를 넘기면 손실 없이 거절한다', () => {
  const full = Array.from({length: MAX_NOTES}, (_, index) => note(`review-${index}`));
  assert.equal(parseNotes(serializeNotes(full)).length, MAX_NOTES);
  assert.throws(() => serializeNotes([...full, note('overflow')]), {code: 'NOTE_LIMIT'});
  assert.throws(() => parseNotes(JSON.stringify({format: 'seoon-civic-reviews', version: 1, exportedAt: savedAt, notes: [...full, note('overflow')]})), {code: 'NOTE_LIMIT'});
  assert.throws(() => parseNotes('가'.repeat(1024 * 1024 + 1)), {code: 'SIZE_LIMIT'});
  const source = snapshot(); source.result.large = Array.from({length: 8}, () => '가'.repeat(30000));
  assert.throws(() => makeNote(source), {code: 'SIZE_LIMIT'});
  const largeNotes = Array.from({length: 15}, (_, index) => {const source = snapshot(); source.result.answer = '가'.repeat(80000); return makeNote(source, {id: `large-${index}`, now: savedAt});});
  assert.throws(() => serializeNotes(largeNotes), {code: 'SIZE_LIMIT'});
});

test('검토노트: 병합은 같은 ID의 최신 수정본을 보존하고 상한 초과 시 전체를 거절한다', () => {
  const original = note(), updated = updateNote(original, {status: '검토 완료'}, later);
  assert.deepEqual(mergeNotes([original], [updated, note('second')]), [updated, note('second')]);
  assert.deepEqual(mergeNotes([updated], [original]), [updated]);
  const tied = {...original, title: '같은 시각의 다른 제목'};
  assert.deepEqual(mergeNotes([original], [tied]), [original]);
  const full = Array.from({length: MAX_NOTES}, (_, index) => note(`review-${index}`));
  assert.throws(() => mergeNotes(full, [note('extra')]), {code: 'NOTE_LIMIT'});
  assert.equal(full.length, MAX_NOTES);
  assert.equal(mergeNotes(full, [note('review-0')]).length, MAX_NOTES);
});

test('검토노트: 저장소가 비었을 때와 정상 저장·복원', () => {
  const storage = memoryStorage();
  assert.deepEqual(readNotes(storage), {notes: [], error: null});
  assert.deepEqual(writeNotes([note()], storage), [note()]);
  assert.deepEqual(readNotes(storage), {notes: [note()], error: null});
  assert.equal(JSON.parse(storage.entries.get(NOTES_KEY)).format, 'seoon-civic-reviews');
});

test('검토노트: 손상된 저장값은 삭제하지 않고 접근불가와 구별한다', () => {
  const storage = memoryStorage('손상된 원본');
  const corrupted = readNotes(storage);
  assert.equal(corrupted.error.code, 'STORAGE_CORRUPT');
  assert.deepEqual(corrupted.notes, []);
  assert.equal(storage.entries.get(NOTES_KEY), '손상된 원본');
  const inaccessible = {getItem() {throw new DOMException('blocked', 'SecurityError');}};
  assert.equal(readNotes(inaccessible).error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(readNotes(null).error.code, 'STORAGE_UNAVAILABLE');
  assert.throws(() => writeNotes([note()], null), {code: 'STORAGE_UNAVAILABLE'});
});

test('검토노트: 용량 초과·저장 실패 시 이전 저장값을 보존하며 잘못된 입력은 쓰지 않는다', () => {
  const original = serializeNotes([note()]);
  const storage = memoryStorage(original);
  storage.setItem = () => {throw new DOMException('full', 'QuotaExceededError');};
  assert.throws(() => writeNotes([note('new')], storage), {code: 'STORAGE_QUOTA'});
  assert.equal(storage.entries.get(NOTES_KEY), original);
  storage.setItem = () => {throw new DOMException('blocked', 'SecurityError');};
  assert.throws(() => writeNotes([note('new')], storage), {code: 'STORAGE_UNAVAILABLE'});
  let calls = 0; storage.setItem = () => {calls++;};
  assert.throws(() => writeNotes([{...note(), status: 'bad'}], storage));
  assert.equal(calls, 0);
});
