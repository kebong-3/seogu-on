// 실제 public/data 에 대한 느슨한 점검. 자료가 갱신되어도 깨지지 않도록 건수를 고정하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, callTool } from '../server/spatial/tools.js';

function assertShape(result) {
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.summary, 'string');
  assert.match(result.summary, /[가-힣]/);
  assert.ok(result.data && typeof result.data === 'object');
  assert.ok(Array.isArray(result.sources));
  assert.ok(Array.isArray(result.caveats) && result.caveats.length > 0);
  for (const source of result.sources) assert.equal(typeof source.name, 'string');
  const features = result.map?.highlight?.features || [];
  assert.ok(features.length <= 200);
  for (const feature of features) {
    assert.equal(feature.geometry.type, 'Point');
    assert.ok(Object.keys(feature.properties).every(k => ['id', 'name', 'category', 'distanceM'].includes(k)));
  }
}

test('실자료: 첫 호출(모든 파일 읽기)도 1초 안에 끝난다', async () => {
  const started = performance.now();
  const result = await callTool('list_datasets', {});
  const elapsed = performance.now() - started;
  assertShape(result);
  assert.ok(elapsed < 1000, `첫 호출 ${Math.round(elapsed)}ms`);
  assert.equal(result.data.dongs.length, 18);
  assert.ok(result.data.datasets.some(d => d.connected));
  for (const d of result.data.datasets) {
    assert.ok(['partial', 'not-connected', 'no-features'].includes(d.state));
    // 어떤 자료도 완전한 목록으로 표시하지 않고, 미연결 자료는 건수를 내지 않는다.
    if (!d.connected) assert.equal(d.sites, null, d.category);
  }
});

test('실자료: 모든 도구가 약속한 모양으로 답한다', async () => {
  const { data } = await callTool('list_datasets', {});
  const usable = data.datasets.filter(d => d.queryable).sort((a, b) => b.sites - a.sites);
  assert.ok(usable.length >= 2, '질의 가능한 자료가 2종 이상');
  const [first, second] = usable.map(d => d.category);
  const dong = data.dongs[0].dongName;

  const calls = [
    ['locate', { query: dong }],
    ['dong_profile', { dong }],
    ['find_facilities', { category: first, dong, limit: 200 }],
    ['find_facilities', { category: first, place: dong, radiusM: 800 }],
    ['nearest', { category: second, place: dong, n: 5 }],
    ['coverage_gap', { target: first, service: second, radiusM: 150, limit: 200 }],
    ['compare_dongs', { categories: [first, second], perKm2: true }],
    ['flood_history', {}],
    ['flood_history', { dong }],
    ['sun_position', { datetime: '2026-08-01T14:00', dong, heightM: 3 }],
  ];
  assert.deepEqual([...new Set(calls.map(c => c[0])), 'list_datasets'].sort(), TOOLS.map(t => t.name).sort());
  for (const [name, args] of calls) {
    const result = await callTool(name, args);
    assertShape(result);
    // MCP 응답으로 보내기에 과하지 않은 크기인지.
    const { map, ...withoutMap } = result;
    assert.ok(JSON.stringify(withoutMap).length < 60000, `${name} 응답 크기`);
  }

  const table = await callTool('compare_dongs', { categories: [first] });
  assert.equal(table.data.rows.length, 18);
  const assigned = table.data.rows.reduce((sum, row) => sum + row.counts[first], 0);
  assert.equal(assigned + table.data.outsideDongBoundary[first], usable[0].sites, '동별 합 + 경계 밖 = 전체');
});

test('실자료: 미연결 자료를 물으면 0곳이 아니라 미연결로 답한다', async t => {
  const { data } = await callTool('list_datasets', {});
  const missing = data.datasets.find(d => !d.connected && !['buildings', 'network'].includes(d.category));
  if (!missing) return t.skip('미연결 자료가 없음');
  const result = await callTool('find_facilities', { category: missing.category });
  assert.equal(result.ok, false);
  assert.match(result.summary, /미연결/);
});
