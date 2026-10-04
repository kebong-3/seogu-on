// 공간 질의 엔진: 작은 fixture 로 정확한 값을 검증한다(실자료 건수에 의존하지 않음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { TOOLS, callTool, SpatialError } from '../server/spatial/tools.js';
import { haversine, representativePoint, areaM2, compass } from '../server/spatial/geo.js';

const dataDir = fileURLToPath(new URL('./fixtures/spatial/data/', import.meta.url));
const run = (name, args) => callTool(name, args, { dataDir });
const rejectsWith = (promise, code) => assert.rejects(promise, error => {
  assert.ok(error instanceof SpatialError);
  assert.equal(error.code, code);
  assert.match(error.message, /[가-힣]/, '오류 메시지는 한국어');
  return true;
});

test('geo: haversine, representative point, area, compass', () => {
  assert.ok(Math.abs(haversine([126.85, 35.13], [126.85, 35.14]) - 1111.95) < 1);
  // ㄷ자 도형: 사각형 중심이 도형 밖이어도 대표점은 안에 있어야 한다.
  const cShape = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10], [0, 0]]] };
  const p = representativePoint(cShape);
  assert.ok(p[0] < 2 || p[1] < 2 || p[1] > 8, `대표점이 도형 밖: ${p}`);
  const square = { type: 'Polygon', coordinates: [[[126.85, 35.13], [126.86, 35.13], [126.86, 35.14], [126.85, 35.14], [126.85, 35.13]]] };
  const km2 = areaM2(square) / 1e6;
  assert.ok(km2 > 0.95 && km2 < 1.07, `면적 ${km2}`);
  assert.equal(compass(0), '북');
  assert.equal(compass(181), '남');
  assert.equal(compass(359), '북');
});

test('TOOLS: 계약된 도구가 모두 있고 스키마가 유효하다', () => {
  const names = TOOLS.map(t => t.name);
  for (const name of ['list_datasets', 'locate', 'dong_profile', 'find_facilities', 'nearest', 'coverage_gap', 'compare_dongs', 'flood_history', 'sun_position']) {
    assert.ok(names.includes(name), name);
  }
  for (const tool of TOOLS) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
    assert.match(tool.title, /[가-힣]/);
    assert.match(tool.description, /[가-힣]/);
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(Array.isArray(tool.inputSchema.required));
    for (const key of tool.inputSchema.required) assert.ok(tool.inputSchema.properties[key], `${tool.name}.${key}`);
    assert.equal(typeof tool.run, 'undefined', '실행 함수는 노출하지 않는다');
  }
});

test('모든 결과는 같은 여섯 키를 가진다', async () => {
  const result = await run('list_datasets', {});
  assert.deepEqual(Object.keys(result), ['ok', 'summary', 'data', 'map', 'sources', 'caveats']);
});

test('list_datasets: 파일에서 자료를 찾고 미연결·0건은 건수를 주지 않는다', async () => {
  const { data, summary, caveats } = await run('list_datasets', {});
  const byId = Object.fromEntries(data.datasets.map(d => [d.category, d]));
  assert.deepEqual(Object.keys(byId).sort(), ['bus', 'cold', 'local-flood-history', 'local-shade', 'official-heat-shelter', 'pharmacy', 'school']);
  // city/ 아래 새 폴더는 '<폴더명>-' 접두어로 자동 수록된다.
  assert.equal(byId['official-heat-shelter'].title, '전국무더위쉼터표준데이터');
  assert.equal(byId['official-heat-shelter'].connected, false);
  assert.equal(byId.bus.sites, 5);
  assert.equal(byId.bus.title, '버스정류장');
  assert.equal(byId.bus.sourceDate, '2026-02-03');
  assert.match(byId.bus.dateBasis, /수집일/);
  assert.equal(byId.cold.state, 'not-connected');
  assert.equal(byId.cold.sites, null);
  assert.equal(byId.pharmacy.state, 'no-features');
  assert.equal(byId.pharmacy.connected, false);
  assert.equal(byId.pharmacy.features, null);
  // 점과 부지 면이 짝인 학교는 한 지점으로 센다.
  assert.equal(byId.school.features, 3);
  assert.equal(byId.school.sites, 2);
  assert.match(byId['local-shade'].coverage, /3행 중.*2행/);
  assert.match(summary, /7종 중 4종이 연결.*3종은 미연결/);
  assert.ok(caveats.some(c => /부분 자료/.test(c)));
  assert.equal(data.dongs.length, 2);
});

test('locate: 동 이름과 시설 이름 조각', async () => {
  const dong = await run('locate', { query: '가람' });
  assert.equal(dong.data.matches[0].type, 'dong');
  assert.equal(dong.data.matches[0].dongId, 'seogu-01');
  assert.deepEqual(dong.map.focus, { dongId: 'seogu-01' });

  const school = await run('locate', { query: '나래중' });
  assert.equal(school.data.matches[0].name, '나래중학교');
  assert.equal(school.data.matches[0].dongName, '나래1동');
  assert.equal(school.data.matches[0].category, 'school');

  const none = await run('locate', { query: '없는이름' });
  assert.equal(none.ok, false);
  assert.equal(none.data.matches.length, 0);
  await rejectsWith(run('locate', {}), 'INVALID_ARGUMENT');
});

test('dong_profile: 분류별 수, 미연결 목록, 행정복지센터 대조, 침수 연도', async () => {
  const { data, map, caveats } = await run('dong_profile', { dong: '가람동' });
  const counts = Object.fromEntries(data.counts.map(c => [c.category, c.count]));
  assert.deepEqual(counts, { bus: 2, school: 1, 'local-shade': 1, 'local-flood-history': 3 });
  assert.deepEqual(data.notConnected.map(d => d.category).sort(), ['cold', 'official-heat-shelter', 'pharmacy']);
  assert.equal(data.civicIndex.matches[0].name, '가람동 행정복지센터');
  assert.deepEqual(data.floodHistoryByYear.map(y => [y.year, y.count]), [[2025, 2], [2023, 1]]);
  assert.ok(data.areaKm2 > 0.95 && data.areaKm2 < 1.07);
  assert.deepEqual(map.focus, { dongId: 'seogu-01' });
  assert.ok(caveats.some(c => /위험 예측이 아닙니다/.test(c)));

  const short = await run('dong_profile', { dong: '나래1' });
  assert.equal(short.data.dongId, 'seogu-02');
  assert.equal(short.data.civicIndex, null);
  await rejectsWith(run('dong_profile', { dong: '서울동' }), 'DONG_NOT_FOUND');
  await rejectsWith(run('dong_profile', {}), 'INVALID_ARGUMENT');
});

test('find_facilities: 동 필터, 반경, 한국어 분류 이름, limit', async () => {
  const inDong = await run('find_facilities', { category: '버스정류장', dong: '가람동' });
  assert.deepEqual(inDong.data.rows.map(r => r.name), ['가람시장', '가람초교']);
  assert.equal(inDong.map.highlight.features.length, 2);
  assert.deepEqual(Object.keys(inDong.map.highlight.features[0].properties), ['id', 'name', 'category']);

  const near = await run('find_facilities', { category: 'bus', place: '나래역', radiusM: 500 });
  assert.deepEqual(near.data.rows.map(r => r.id), ['b3', 'b4']);
  assert.equal(near.data.rows[0].distanceM, 0);
  assert.ok(Math.abs(near.data.rows[1].distanceM - 431) < 5);
  assert.equal(near.map.focus.radiusM, 500);

  const tight = await run('find_facilities', { category: 'bus', lon: 126.865, lat: 35.135, radiusM: 400 });
  assert.equal(tight.data.total, 1);

  const limited = await run('find_facilities', { category: 'bus', limit: 2 });
  assert.equal(limited.data.total, 5);
  assert.equal(limited.data.returned, 2);
  assert.equal(limited.data.truncated, true);
  assert.match(limited.summary, /5곳/);

  await rejectsWith(run('find_facilities', { category: '우주정거장' }), 'UNKNOWN_CATEGORY');
  await rejectsWith(run('find_facilities', { category: 'bus', lon: 35.1, lat: 126.8 }), 'OUT_OF_AREA');
  await rejectsWith(run('find_facilities', { category: 'bus', limit: 0 }), 'INVALID_ARGUMENT');
  await rejectsWith(run('find_facilities', { category: 'bus', place: '없는곳' }), 'PLACE_NOT_FOUND');
});

test('미연결·0건 자료는 "0곳"이 아니라 미연결로 답한다', async () => {
  for (const category of ['cold', '약국', '무더위쉼터']) {
    const result = await run('find_facilities', { category });
    assert.equal(result.ok, false);
    assert.equal(result.data.connected, false);
    assert.match(result.summary, /미연결/);
    assert.doesNotMatch(result.summary, /(^|[^'‘])0곳입니다/);
    assert.ok(result.caveats.some(c => /없다는 뜻이 아닙니다/.test(c)));
  }
  const gap = await run('coverage_gap', { target: 'bus', service: 'cold' });
  assert.equal(gap.ok, false);
  assert.equal(gap.data.role, 'service');
});

test('nearest: 가까운 순과 최대 거리', async () => {
  const result = await run('nearest', { category: '그늘막', lon: 126.852, lat: 35.132, n: 2 });
  assert.deepEqual(result.data.rows.map(r => r.id), ['s1', 's2']);
  assert.ok(Math.abs(result.data.rows[0].distanceM - 56) <= 1);
  assert.match(result.summary, /그늘막 1.*56m/);

  const capped = await run('nearest', { category: 'local-shade', lon: 126.852, lat: 35.132, maxDistanceM: 100 });
  assert.equal(capped.data.rows.length, 1);
  const far = await run('nearest', { category: 'local-shade', lon: 126.859, lat: 35.139, maxDistanceM: 50 });
  assert.equal(far.ok, false);
  assert.match(far.summary, /실제 부재를 뜻하지 않음/);
  await rejectsWith(run('nearest', { category: 'bus' }), 'INVALID_ARGUMENT');
});

test('coverage_gap: 그늘막 없는 정류장과 동별 집계', async () => {
  const { data, summary, map, caveats, sources } = await run('coverage_gap', { target: '버스정류장', service: '그늘막', radiusM: 150 });
  assert.equal(data.targets, 5);
  assert.equal(data.uncovered, 3);
  assert.deepEqual(data.rows.map(r => r.id).sort(), ['b2', 'b4', 'b5']);
  const byDong = Object.fromEntries(data.byDong.map(r => [r.dongName, [r.targets, r.uncovered]]));
  assert.deepEqual(byDong, { 가람동: [2, 1], 나래1동: [2, 1], '행정동 경계 밖': [1, 1] });
  assert.match(summary, /5곳 중 반경 150m.*3곳\(60%\)/);
  assert.equal(map.highlight.features.length, 3);
  assert.ok(data.rows[0].nearestServiceM >= data.rows[1].nearestServiceM);
  assert.ok(caveats.some(c => /현장 확인/.test(c)));
  assert.equal(sources.length, 3);
  assert.ok(sources.every(s => s.name && 'date' in s));

  const narrow = await run('coverage_gap', { target: 'bus', service: 'local-shade', radiusM: 50 });
  assert.equal(narrow.data.uncovered, 4);
  const oneDong = await run('coverage_gap', { target: 'bus', service: 'local-shade', dong: '가람동' });
  assert.equal(oneDong.data.targets, 2);
  assert.deepEqual(oneDong.data.rows.map(r => r.id), ['b2']);
  await rejectsWith(run('coverage_gap', { target: 'bus' }), 'INVALID_ARGUMENT');
  await rejectsWith(run('coverage_gap', { target: 'bus', service: 'local-shade', radiusM: 1 }), 'INVALID_ARGUMENT');
});

test('compare_dongs: 표, 밀도, 미연결은 null', async () => {
  const { data, summary, caveats } = await run('compare_dongs', { categories: ['bus', '한파쉼터', 'school'], perKm2: true });
  assert.equal(data.rows.length, 2);
  for (const row of data.rows) {
    assert.equal(row.counts.bus, 2);
    assert.equal(row.counts.cold, null);
    assert.equal(row.perKm2.cold, null);
    assert.ok(Math.abs(row.perKm2.bus - 2 / row.areaKm2) < 0.01);
  }
  assert.equal(data.outsideDongBoundary.bus, 1);
  assert.match(summary, /미연결/);
  assert.ok(caveats.some(c => /null 은 0곳이 아닙니다/.test(c)));

  const subset = await run('compare_dongs', { categories: ['school'], dongs: ['나래1동'] });
  assert.deepEqual(subset.data.rows.map(r => [r.dongName, r.counts.school]), [['나래1동', 1]]);
  assert.equal(subset.data.rows[0].perKm2, undefined);

  const allMissing = await run('compare_dongs', { categories: ['cold'] });
  assert.equal(allMissing.ok, false);
  await rejectsWith(run('compare_dongs', { categories: [] }), 'INVALID_ARGUMENT');
  await rejectsWith(run('compare_dongs', { categories: 'bus' }), 'INVALID_ARGUMENT');
});

test('flood_history: 동·반경·연도 조건과 연도별 묶음', async () => {
  const dong = await run('flood_history', { dong: '가람동' });
  assert.equal(dong.data.total, 3);
  assert.deepEqual(dong.data.byYear.map(y => [y.year, y.count]), [[2025, 2], [2023, 1]]);
  assert.deepEqual(dong.data.byYear[0].byKind, { 상가침수: 1, 주택침수: 1 });
  assert.match(dong.caveats[0], /위험 예측이 아닙니다/);
  assert.match(dong.summary, /위험 예측이 아닙니다/);

  const near = await run('flood_history', { lon: 126.853, lat: 35.133, radiusM: 50 });
  assert.deepEqual(near.data.rows.map(r => r.id), ['f1', 'f2']);
  assert.ok(near.data.rows[1].distanceM > 5 && near.data.rows[1].distanceM < 20);

  const all = await run('flood_history', { yearFrom: 2025 });
  assert.equal(all.data.total, 3);
  assert.deepEqual(all.data.byDong.map(r => [r.dongName, r.count]), [['가람동', 2], ['나래1동', 1]]);

  const empty = await run('flood_history', { lon: 126.869, lat: 35.131, radiusM: 50 });
  assert.equal(empty.data.total, 0);
  assert.match(empty.summary, /위험이 없다는 뜻은 아닙니다/);
});

test('sun_position: 낮·밤, 그림자 길이, 입력 형식', async () => {
  const noon = await run('sun_position', { datetime: '2026-06-21T12:30', dong: '가람동', heightM: 10 });
  assert.ok(noon.data.altitudeDeg > 70 && noon.data.altitudeDeg < 80, `고도 ${noon.data.altitudeDeg}`);
  assert.ok(noon.data.azimuthDeg > 150 && noon.data.azimuthDeg < 210, `방위 ${noon.data.azimuthDeg}`);
  assert.equal(noon.data.night, false);
  const expected = 10 / Math.tan(noon.data.altitudeDeg * Math.PI / 180);
  assert.ok(Math.abs(noon.data.shadow.lengthM - expected) < 0.2);
  assert.ok(noon.caveats.some(c => /수직 물체를 가정/.test(c)));

  const morning = await run('sun_position', { datetime: '2026-06-21 08:00:00', lon: 126.855, lat: 35.135 });
  assert.ok(morning.data.azimuthDeg > 60 && morning.data.azimuthDeg < 120, '아침 해는 동쪽');
  assert.equal(morning.data.shadow, undefined);

  const night = await run('sun_position', { datetime: '2026-06-21T00:00', heightM: 10 });
  assert.equal(night.data.night, true);
  assert.equal(night.data.shadow, null);
  assert.equal(night.data.location.label, '서구 중심부');

  await rejectsWith(run('sun_position', { datetime: '내일 오후' }), 'INVALID_ARGUMENT');
  await rejectsWith(run('sun_position', { datetime: '2026-02-30T10:00' }), 'INVALID_ARGUMENT');
});

test('callTool: 알 수 없는 도구와 잘못된 인자', async () => {
  await rejectsWith(run('drop_tables', {}), 'UNKNOWN_TOOL');
  await rejectsWith(run('locate', 'text'), 'INVALID_ARGUMENT');
  await rejectsWith(run('locate', ['a']), 'INVALID_ARGUMENT');
});
