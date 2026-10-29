// Synthetic geometry verifies condition preservation independently of changing public counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {answerByRules} from '../server/ai/rules.js';
import {answerQuestion} from '../server/ai/ask.js';
import {callTool} from '../server/spatial/tools.js';
import {answerHtml, highlightFeatures, reviewMemo} from '../src/city/ask-ai.js';

const dirs = [];
const point = (id, name, lon, lat) => ({type: 'Feature', properties: {id, name}, geometry: {type: 'Point', coordinates: [lon, lat]}});
const polygon = (id, name, left, right) => ({type: 'Feature', properties: {dongId: id, dongName: name}, geometry: {type: 'Polygon', coordinates: [[[left, 35.12], [right, 35.12], [right, 35.14], [left, 35.14], [left, 35.12]]]}});
function fixture({missingShade = false} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'seogu-nearby-')); dirs.push(dir);
  const save = (file, title, features, extra = {}) => {
    const path = join(dir, file); mkdirSync(join(path, '..'), {recursive: true});
    writeFileSync(path, JSON.stringify({type: 'FeatureCollection', metadata: {title, sourceName: '합성 시험자료', sourceDate: '2026-10-29', ...extra}, features}));
  };
  save('admin-dongs.geojson', '합성 경계', [polygon('seogu-17', '풍암동', 126.84, 126.854), polygon('seogu-09', '상무2동', 126.854, 126.87), polygon('seogu-10', '화정1동', 126.87, 126.88)]);
  save('city/infra/school.geojson', '학교', [point('a', '가학교', 126.85, 35.13), point('b', '나학교', 126.851, 35.13), point('c', '다학교', 126.857, 35.13), point('d', '라학교', 126.85, 35.135)]);
  save('city/local-shade.geojson', '그늘막', missingShade ? [] : [point('s1', '그늘막 하나', 126.851, 35.13), point('s2', '그늘막 둘', 126.853, 35.13), point('s3', '이웃 동 그늘막', 126.855, 35.13)], missingShade ? {state: 'not-connected'} : {});
  return dir;
}
const dataDir = fixture();
const ask = question => answerByRules(question, {}, {dataDir});
const byName = data => Object.fromEntries(data.rows.map(row => [row.name, row]));
test.after(() => dirs.forEach(dir => rmSync(dir, {recursive: true, force: true})));

test('학교 주변 200m 비교는 대상·서비스·단일 동·반경을 실제 계산까지 유지한다', async () => {
  const r = await ask('풍암동 학교 주변 그늘막을 반경 200m로 비교해줘');
  assert.equal(r.intent, 'compare_nearby');
  assert.deepEqual(r.steps.map(step => [step.tool, step.args]), [['compare_nearby', {target: 'school', service: 'local-shade', radiusM: 200, dong: '풍암동'}]]);
  const data = r.results[0].result.data, rows = byName(data);
  assert.equal(data.targets, 3);
  assert.deepEqual(Object.keys(rows).sort(), ['가학교', '나학교', '라학교']);
  assert.deepEqual([rows['가학교'].nearbyCount, rows['나학교'].nearbyCount, rows['라학교'].nearbyCount], [1, 2, 0]);
  assert.ok(rows['가학교'].nearestServiceM >= 90 && rows['가학교'].nearestServiceM <= 92);
  assert.equal(rows['나학교'].nearestServiceM, 0, '서로 다른 분류의 같은 위치도 실제 수록 서비스다');
  assert.deepEqual([data.covered, data.uncovered], [2, 1]);
  assert.match(r.answer, /풍암동.*학교.*그늘막.*반경 200m/);
  assert.doesNotMatch(r.answer, /18개 동/);
});

test('반경을 500m로 바꾸면 같은 대상에서 이웃 동 서비스까지 계산한다', async () => {
  const r = await ask('풍암동 학교 주변 그늘막 반경 500m 비교');
  const data = r.results[0].result.data, rows = byName(data);
  assert.equal(r.steps[0].args.radiusM, 500);
  assert.deepEqual([rows['가학교'].nearbyCount, rows['나학교'].nearbyCount, rows['라학교'].nearbyCount], [3, 3, 0]);
  assert.equal(data.dongName, '풍암동');
  assert.ok(r.results[0].result.caveats.some(text => text.includes('이웃 동')));
  const withoutCompare = await ask('풍암동 학교 주변 그늘막 반경 500m 찾아줘');
  assert.equal(withoutCompare.intent, 'compare_nearby');
  assert.deepEqual(withoutCompare.steps[0].args, r.steps[0].args);
});

test('다른 동 질문은 대상만 그 동으로 바꾸고 두 동 수 비교는 별도 의도로 유지한다', async () => {
  const other = await ask('상무2동 학교 주변 그늘막 반경 200m 비교');
  assert.equal(other.steps[0].args.dong, '상무2동');
  assert.deepEqual(other.results[0].result.data.rows.map(row => [row.name, row.nearbyCount]), [['다학교', 1]]);
  const dongs = await ask('풍암동·상무2동 학교 수 비교');
  assert.equal(dongs.intent, 'compare_dongs');
  assert.deepEqual(dongs.steps[0].args, {categories: ['school'], dongs: ['풍암동', '상무2동']});
  assert.deepEqual(dongs.results[0].result.data.rows.map(row => [row.dongName, row.counts.school]), [['풍암동', 3], ['상무2동', 1]]);
  const single = await ask('풍암동 학교 수 비교');
  assert.deepEqual(single.steps[0].args.dongs, ['풍암동']);
  assert.equal(single.results[0].result.data.rows.length, 1);
});

test('미연결 서비스는 반경과 동을 밝히고 자료 없음으로 반환하며 0곳 비교표를 만들지 않는다', async () => {
  const r = await answerQuestion({question: '풍암동 학교 주변 그늘막 반경 200m 비교', dong: null, previousQuestions: []}, {dataDir: fixture({missingShade: true}), env: {}});
  assert.equal(r.steps[0].ok, false);
  assert.equal(r.steps[0].args.radiusM, 200);
  assert.equal(r.steps[0].args.dong, '풍암동');
  assert.match(r.answer, /풍암동.*반경 200m.*자료 없음/);
  assert.equal(r.map, null);
  assert.equal(r.nearbyComparisons, undefined);
  const html = answerHtml({status: 'done', result: r, question: '그늘막 비교', features: []});
  assert.match(html, /지도에 표시할 결과 지점이 없습니다/);
  assert.doesNotMatch(html, /결과 지점을 지도에서 확인하고/);
});

test('응답·화면·저장메모는 AI 문장과 별개인 같은 조건과 계산표를 전달한다', async () => {
  const r = await answerQuestion({question: '풍암동 학교 주변 그늘막 반경 200m 비교', dong: null, previousQuestions: []}, {dataDir, env: {}});
  assert.equal(r.nearbyComparisons.length, 1);
  assert.equal(r.nearbyComparisons[0].radiusM, 200);
  assert.equal(r.map.focus.dongId, 'seogu-17');
  assert.equal(r.map.highlight.features.length, 3);
  assert.equal(r.sources.length, 3);
  const view = {status: 'done', result: r, question: '풍암동 학교 주변 그늘막 반경 200m 비교', features: highlightFeatures(r.map)};
  const html = answerHtml(view), memo = reviewMemo(view);
  for (const text of ['시설별 주변 비교', '반경 안 수록', '최근접 직선거리', '가학교', '이웃 동']) assert.ok(html.includes(text), text);
  assert.match(html, /직선 반경 <strong>200m/);
  assert.match(memo, /가학교: 반경 안 수록 1곳/);
  assert.match(memo, /직선 반경 200m/);
});

test('대상 0건·집계 응답은 존재하지 않는 결과 지점으로 안내하지 않는다', async () => {
  const r = await answerQuestion({question: '화정1동 학교 주변 그늘막 반경 200m 비교', dong: null, previousQuestions: []}, {dataDir, env: {}});
  assert.equal(r.nearbyComparisons[0].targets, 0);
  const html = answerHtml({status: 'done', result: r, question: '그늘막 비교', features: []});
  assert.match(html, /해당하는 대상 지점이 자료에 수록되어 있지 않습니다/);
  assert.doesNotMatch(html, /결과 지점을 지도에서 확인하고/);
  const count = await answerQuestion({question: '풍암동·상무2동 학교 수 비교', dong: null, previousQuestions: []}, {dataDir, env: {}});
  assert.doesNotMatch(answerHtml({status: 'done', result: count, question: '학교 수 비교', features: []}), /결과 지점을 지도에서 확인하고/);
});

test('모호한 반경 비교는 조건을 버리지 않고 AI 도구 선택 이전에 멈춘다', async () => {
  for (const question of ['풍암동 그늘막 반경 200m 비교', '풍암동 학교 주변 그늘막 200m와 500m 비교', '풍암동 학교 주변 그늘막 0m 비교']) {
    let requests = 0;
    const r = await answerQuestion({question, dong: null, previousQuestions: []}, {dataDir, env: {GEMINI_API_KEY: 'test-key'}, fetcher: async () => {requests++; throw new Error('must not call');}});
    assert.equal(requests, 0);
    assert.equal(r.code, 'UNSUPPORTED_QUERY_CONDITIONS');
    assert.deepEqual(r.steps, []);
    assert.match(r.answer, /전체 동 집계로 바꾸지 않았습니다/);
  }
});

test('표 한도와 입력 범위를 지키고 동일 자료의 자기 자신은 주변 개수에서 제외한다', async () => {
  const r = await callTool('compare_nearby', {target: 'school', service: 'school', dong: '풍암동', radiusM: 200, limit: 1}, {dataDir});
  assert.equal(r.data.targets, 3);
  assert.equal(r.data.returned, 1);
  assert.equal(r.data.truncated, true);
  const full = await callTool('compare_nearby', {target: 'school', service: 'school', dong: '풍암동', radiusM: 200}, {dataDir});
  assert.deepEqual(Object.values(byName(full.data)).map(row => row.nearbyCount).sort(), [0, 1, 1]);
  await assert.rejects(callTool('compare_nearby', {target: 'school', service: 'local-shade', radiusM: 0}, {dataDir}), error => error.code === 'INVALID_ARGUMENT');
});
