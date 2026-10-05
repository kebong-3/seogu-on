// "지도에게 묻기" 규칙 기반 모드: 질문 해석(동·분류·반경·의도)과 실제 엔진 호출.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASK_EXAMPLES } from '../src/city/ask-examples.js';
import { answerQuestion, pickMap, resetAskLimits } from '../server/ai/ask.js';
import { answerByRules, findCategories, findDongs, parseDatetime, parseRadius } from '../server/ai/rules.js';
import { getStore } from '../server/spatial/store.js';

const dataDir = fileURLToPath(new URL('./fixtures/spatial/data/', import.meta.url));
const ctx = { dataDir, now: Date.UTC(2026, 6, 1, 3, 0) }; // 2026-07-01 12:00 KST
const store = getStore(dataDir);
const ask = (question, context = {}) => answerByRules(question, context, ctx);
const only = outcome => { assert.equal(outcome.steps.length, 1, JSON.stringify(outcome.steps)); return outcome.steps[0]; };

test.beforeEach(() => resetAskLimits());

test('rules: 동 이름 찾기 — 정확한 이름, 번호 없는 이름(나래동 → 나래1동), 없는 동', () => {
  assert.deepEqual(findDongs(store, '가람동버스').dongs.map(d => d.name), ['가람동']);
  assert.deepEqual(findDongs(store, '나래동그늘막').dongs.map(d => d.name), ['나래1동']);
  assert.deepEqual(findDongs(store, '나래1동과가람동').dongs.map(d => d.name), ['나래1동', '가람동']);
  assert.deepEqual(findDongs(store, '운동장').dongs, []);
});

test('rules: 분류 낱말은 엔진의 resolveCategory 로 바꾸고, 긴 낱말 안의 짧은 낱말은 다시 잡지 않는다', () => {
  const found = findCategories(store, '그늘막이없는버스정류장');
  assert.deepEqual(found.map(c => c.dataset.id), ['local-shade', 'bus']);
  assert.deepEqual(found.map(c => c.word), ['그늘막', '버스정류장']);
  assert.deepEqual(findCategories(store, '초등학교').map(c => c.dataset.id), ['school']);
  assert.deepEqual(findCategories(store, '오늘날씨').map(c => c.dataset.id), []);
});

test('rules: 반경·일시 표현', () => {
  assert.equal(parseRadius('150m 안에'), 150);
  assert.equal(parseRadius('반경 300미터'), 300);
  assert.equal(parseRadius('1.5km 이내'), 1500);
  assert.equal(parseRadius('가까운 곳'), null);
  assert.deepEqual(parseDatetime('8월 1일 오후 2시', ctx.now), { datetime: '2026-08-01T14:00', assumedDate: false });
  assert.deepEqual(parseDatetime('2027년 1월 5일 9시 30분', ctx.now), { datetime: '2027-01-05T09:30', assumedDate: false });
  assert.deepEqual(parseDatetime('14시 반', ctx.now), { datetime: '2026-07-01T14:30', assumedDate: true });
  assert.equal(parseDatetime('해가 어디 있어', ctx.now), null);
});

test('rules: 없는/사각지대 → coverage_gap (부정 표현 앞의 분류가 서비스)', async () => {
  const a = await ask('가람동에서 그늘막이 150m 안에 없는 버스정류장은?');
  assert.deepEqual(only(a), { tool: 'coverage_gap', args: { target: 'bus', service: 'local-shade', radiusM: 150, dong: '가람동' }, ok: true, summary: a.steps[0].summary });
  assert.match(a.answer, /'버스정류장' 수록 지점 2곳 중 반경 150m 안에 .*없는 곳은 1곳/);
  assert.match(a.answer, /현장 확인 전 후보/);
  assert.match(a.answer, /가람시장/);

  const b = await ask('버스정류장 중에 그늘막 없는 곳');
  assert.deepEqual(only(b).args, { target: 'bus', service: 'local-shade' });

  const c = await ask('그늘막 사각지대');
  assert.deepEqual(only(c).args, { target: 'bus', service: 'local-shade' });
  assert.match(c.answer, /대상을 따로 말하지 않아/);
});

test('rules: 가장 가까운 → nearest, 기준 장소가 없으면 되묻는다', async () => {
  const a = await ask('가람초등학교에서 가장 가까운 그늘막 2곳');
  assert.deepEqual(only(a).args, { category: 'local-shade', place: '가람초등학교', n: 2 });
  assert.match(a.answer, /가까운 순: /);

  const b = await ask('나래동에서 제일 가까운 버스정류장');
  assert.deepEqual(only(b), { tool: 'nearest', args: { category: 'bus', place: '나래1동' }, ok: true, summary: b.steps[0].summary });

  const c = await ask('가장 가까운 그늘막');
  assert.equal(c.steps.length, 0);
  assert.match(c.answer, /기준 장소가 필요합니다/);

  const d = await ask('가장 가까운 그늘막', { dongId: 'seogu-01' });
  assert.deepEqual(only(d).args, { category: 'local-shade', place: '가람동' });
});

test('rules: 근처·반경 → find_facilities(place, radiusM), 동 + 분류 → find_facilities(dong)', async () => {
  const a = await ask('가람초등학교 근처 500m 버스정류장');
  assert.deepEqual(only(a), { tool: 'find_facilities', args: { category: 'bus', place: '가람초등학교', radiusM: 500 }, ok: true, summary: a.steps[0].summary });

  const b = await ask('나래동 버스정류장 어디 있어?');
  assert.deepEqual(only(b).args, { category: 'bus', dong: '나래1동' });
  assert.match(b.answer, /수록된 지점은 2곳/);
  assert.match(b.answer, /나래역/);

  const c = await ask('학교 목록');
  assert.deepEqual(only(c).args, { category: 'school' });
});

test('rules: 화면에서 고른 동(dongId)을 문맥으로 쓰고 그렇게 했다고 밝힌다', async () => {
  const a = await ask('그늘막 어디 있어?', { dongId: 'seogu-02' });
  assert.deepEqual(only(a).args, { category: 'local-shade', dong: '나래1동' });
  assert.match(a.answer, /화면에서 고른 나래1동 기준/);
  const b = await ask('가람동 그늘막', { dongId: 'seogu-02' });
  assert.deepEqual(only(b).args, { category: 'local-shade', dong: '가람동' });
  assert.doesNotMatch(b.answer, /화면에서 고른/);
});

test('rules: 비교/많은 동 → compare_dongs', async () => {
  const a = await ask('동별 버스정류장 수 비교');
  assert.deepEqual(only(a), { tool: 'compare_dongs', args: { categories: ['bus'] }, ok: true, summary: a.steps[0].summary });
  const b = await ask('가람동과 나래1동의 그늘막, 버스정류장 밀도 비교해줘');
  assert.deepEqual(only(b).args, { categories: ['local-shade', 'bus'], perKm2: true, dongs: ['가람동', '나래1동'] });
  const c = await ask('그늘막이 가장 많은 동은?');
  assert.equal(only(c).tool, 'compare_dongs');
});

test('rules: 침수 → flood_history (동, 연도, 동별 집계) — 위험 예측이 아니라는 문구가 남는다', async () => {
  const a = await ask('가람동 침수 이력');
  assert.deepEqual(only(a).args, { dong: '가람동' });
  assert.match(a.answer, /과거 침수피해 기록은 3건/);
  assert.match(a.answer, /위험 예측이 아닙니다/);

  const b = await ask('2023년 침수 기록');
  assert.deepEqual(only(b).args, { yearFrom: 2023, yearTo: 2023, limit: 200 });
  assert.match(b.answer, /연도 조건/);

  const c = await ask('침수 기록이 많은 동은?', { dongId: 'seogu-02' });
  assert.deepEqual(only(c).args, { limit: 200 }, '동끼리 견주는 질문은 선택한 동으로 좁히지 않는다');
  assert.match(c.answer, /동별 수록 건수가 많은 순: 가람동 3건, 나래1동 1건/);
});

test('rules: 자료 목록, 태양 위치, 동 이름만, 위치 찾기', async () => {
  assert.equal(only(await ask('어떤 자료가 있어?')).tool, 'list_datasets');
  assert.equal(only(await ask('데이터 목록 보여줘')).tool, 'list_datasets');

  const sun = await ask('8월 1일 오후 2시 가람동 해는 어느 쪽이야?');
  assert.deepEqual(only(sun), { tool: 'sun_position', args: { datetime: '2026-08-01T14:00', dong: '가람동' }, ok: true, summary: sun.steps[0].summary });
  const shadow = await ask('15시에 3m 그늘막 그림자 길이');
  assert.deepEqual(only(shadow).args, { datetime: '2026-07-01T15:00', heightM: 3 });
  assert.match(shadow.answer, /오늘\(한국시간\) 날짜로 계산/);
  assert.notEqual(only(await ask('가람동 버스정류장 비교해 줘')).tool, 'sun_position', "'해 줘'는 태양이 아니다");

  const profile = await ask('나래1동');
  assert.deepEqual(only(profile), { tool: 'dong_profile', args: { dong: '나래1동' }, ok: true, summary: profile.steps[0].summary });

  const where = await ask('가람초등학교 어디야?');
  assert.deepEqual(only(where).args, { query: '가람초등학교' });
});

test('rules: 미연결 자료는 0곳이 아니라 자료 없음으로 답한다', async () => {
  const a = await ask('가람동 약국 어디 있어?');
  assert.equal(only(a).ok, false);
  assert.match(a.answer, /미연결/);
  assert.match(a.answer, /'0곳'이 아니라 '자료 없음'/);
});

test('rules: 해석하지 못한 질문은 오류가 아니라 예시가 든 안내문', async () => {
  const a = await ask('여권 발급은 어떻게 해?');
  assert.equal(a.matched, false);
  assert.deepEqual(a.steps, []);
  assert.match(a.answer, /예: "/);

  const response = await answerQuestion({ question: '여권 발급은 어떻게 해?', dong: null, previousQuestions: [] }, { ...ctx, env: {} });
  assert.equal(response.ok, true);
  assert.equal(response.mode, 'rules');
  assert.equal(response.code, 'LLM_NOT_CONFIGURED');
  assert.deepEqual(response.examples, ASK_EXAMPLES);
  assert.deepEqual([response.steps, response.sources, response.caveats, response.map], [[], [], [], null]);
});

test('rules: 응답은 규칙 기반임을 밝히고, 출처·한계·지도 지시는 실제로 쓴 도구 결과에서만 온다', async () => {
  const r = await answerQuestion({ question: '가람동에서 그늘막이 150m 안에 없는 버스정류장은?', dong: null, previousQuestions: [] }, { ...ctx, env: {} });
  assert.deepEqual(Object.keys(r).sort(), ['answer', 'caveats', 'code', 'map', 'mode', 'notice', 'ok', 'sources', 'steps'].sort());
  assert.equal(r.mode, 'rules');
  assert.match(r.notice, /규칙 기반/);
  assert.deepEqual(r.map.focus, { dongId: 'seogu-01' });
  assert.equal(r.map.highlight.features.length, 1);
  assert.ok(r.sources.length >= 2 && r.sources.every(s => typeof s.name === 'string' && 'date' in s));
  assert.ok(r.caveats.some(c => /현장 확인/.test(c)));
  // 답에 나온 숫자는 모두 도구 요약·자료에 있는 값이다.
  const evidence = JSON.stringify(r.steps);
  for (const n of r.answer.match(/\d+/g)) assert.ok(evidence.includes(n) || r.answer.includes(`${n}m)`), n);
});

test('pickMap: 강조 지점이 있는 마지막 결과를 고르고, 동마다 부른 같은 도구는 합친다', () => {
  const fcOf = n => ({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [126.85 + i / 1000, 35.13] }, properties: {} })) });
  assert.equal(pickMap([]), null);
  assert.deepEqual(pickMap([{ tool: 'dong_profile', args: {}, result: { map: { focus: { dongId: 'a' } } } }]), { focus: { dongId: 'a' } });
  const picked = pickMap([
    { tool: 'find_facilities', args: { category: 'bus' }, result: { map: { highlight: fcOf(2) } } },
    { tool: 'sun_position', args: {}, result: { map: { focus: { lon: 1, lat: 2 } } } },
  ]);
  assert.equal(picked.highlight.features.length, 2);
  const merged = pickMap([
    { tool: 'find_facilities', args: { dong: 'a' }, result: { map: { focus: { dongId: 'a' }, highlight: fcOf(2) } } },
    { tool: 'find_facilities', args: { dong: 'b' }, result: { map: { focus: { dongId: 'b' }, highlight: fcOf(3) } } },
  ]);
  assert.equal(merged.highlight.features.length, 5);
  assert.equal(merged.focus, undefined);
});

test('실제 자료: 화면의 예시 질문은 모두 규칙 기반 모드에서 도구 결과로 답이 나온다', async () => {
  assert.ok(ASK_EXAMPLES.length >= 4 && ASK_EXAMPLES.length <= 6);
  for (const question of ASK_EXAMPLES) {
    const r = await answerQuestion({ question, dong: null, previousQuestions: [] }, { env: {} });
    assert.equal(r.mode, 'rules', question);
    assert.ok(r.steps.length >= 1 && r.steps.every(s => s.ok), `${question} → ${JSON.stringify(r.steps)}`);
    assert.ok(r.answer.length > 20 && r.sources.length >= 1 && r.caveats.length >= 1, question);
    assert.equal(r.examples, undefined, question);
  }
});

test('실제 자료: 대표 질문의 도구 선택과 지도 지시(느슨한 확인)', async () => {
  const run = question => answerQuestion({ question, dong: null, previousQuestions: [] }, { env: {} });
  const gap = await run('풍암동에서 그늘막이 150m 안에 없는 버스정류장은?');
  assert.deepEqual(gap.steps.map(s => s.tool), ['coverage_gap']);
  assert.equal(gap.steps[0].args.dong, '풍암동');
  assert.ok(gap.map.highlight.features.length >= 1 && gap.map.focus.dongId);

  const libraries = await run('화정동 도서관 어디 있어?');
  assert.deepEqual(libraries.steps.map(s => s.args.dong), ['화정1동', '화정2동', '화정3동', '화정4동']);
  assert.ok(libraries.map.highlight.features.length >= 1);

  const flood = await run('침수 기록이 많은 동은?');
  assert.equal(flood.steps[0].tool, 'flood_history');
  assert.match(flood.answer, /위험 예측이 아닙니다/);
  assert.ok(flood.caveats.some(c => /미래 침수 위험 예측이 아닙니다/.test(c)));

  // 이 배포에는 실제 공식 쉼터 자료가 있다. 미연결이라는 과거 가정 대신
  // 답변의 전체 건수와 지도 지시가 각 공식 원본 파일에서 왔는지 확인한다.
  for (const [question, category, file] of [
    ['한파쉼터 어디 있어?', 'official-cold-shelter', 'cold-shelter'],
    ['무더위쉼터 어디 있어?', 'official-heat-shelter', 'heat-shelter'],
  ]) {
    const original = JSON.parse(readFileSync(new URL(`../public/data/city/official/${file}.geojson`, import.meta.url), 'utf8'));
    assert.ok(original.features.length > 0, `${file}: 공식 공개본이 실제로 수록되어야 한다`);
    const expected = new Map(original.features.map(feature => [String(feature.properties.id || feature.id), feature]));
    const shelter = await run(question);
    assert.deepEqual(shelter.steps.map(step => [step.tool, step.args.category, step.ok]), [['find_facilities', category, true]]);
    assert.match(shelter.answer, new RegExp(`수록된 지점은 ${original.features.length.toLocaleString('ko-KR')}곳`));
    assert.doesNotMatch(shelter.answer, /미연결|자료 없음|0곳입니다/);
    assert.ok(shelter.sources.some(source => source.url === original.metadata.sourceUrl));
    assert.equal(shelter.map.highlight.type, 'FeatureCollection');
    assert.ok(shelter.map.highlight.features.length > 0 && shelter.map.highlight.features.length <= original.features.length);
    for (const feature of shelter.map.highlight.features) {
      assert.equal(feature.properties.category, category);
      const found = expected.get(String(feature.properties.id));
      assert.ok(found, `공식 원본에 없는 지도 지점: ${feature.properties.id}`);
      assert.equal(feature.geometry.type, 'Point');
      const [lon, lat] = feature.geometry.coordinates, [sourceLon, sourceLat] = found.geometry.coordinates;
      const displayOffsetM = Math.hypot((lon - sourceLon) * Math.cos(sourceLat * Math.PI / 180), lat - sourceLat) * 111320;
      assert.ok(displayOffsetM < 0.1, '지도 지점은 공식 원본에서 10cm 미만이어야 한다(표시 좌표 반올림 허용)');
    }
  }
});
