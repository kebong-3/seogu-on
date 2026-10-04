import test from 'node:test';
import assert from 'node:assert/strict';
import {readProvider,flags} from '../server/city/providers.js';
import {normalizeServiceKey,keyCandidates,diagnose,DIAGNOSTIC_CODES} from '../server/diagnostics.js';
import {classifyUpstream} from '../server/city/upstream-codes.js';
import {readWeather} from '../server/weather-service.js';
import cityData from '../api/city-data.js';
import weatherApi from '../api/weather.js';

const q = values => new URLSearchParams(values);
const jsonResponse = body => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
const STATION = {stationName: 'TEST측정소', addr: 'TEST ONLY', dmX: '35.15', dmY: '126.85'};
const stationBody = (items = [STATION]) => ({response: {header: {resultCode: '00'}, body: {items, totalCount: items.length}}});
const measureBody = items => ({response: {header: {resultCode: '00'}, body: {items, totalCount: items.length}}});
const failure = async promise => { try { await promise; } catch (error) { return error; } assert.fail('expected a rejection'); };

/** 호출된 주소를 기록하면서 경로별로 응답을 돌려주는 가짜 fetcher */
function fakeFetcher(routes) {
  const calls = [];
  const fetcher = async url => {
    const u = new URL(url); calls.push(u);
    const key = Object.keys(routes).find(part => u.pathname.includes(part));
    const reply = routes[key];
    return typeof reply === 'function' ? reply(u, calls.length) : reply;
  };
  return {fetcher, calls};
}

test('air key: an Encoding key from data.go.kr is sent encoded exactly once', async () => {
  const decoded = 'TESTONLY+abc/def==', encoded = encodeURIComponent(decoded);
  const {fetcher, calls} = fakeFetcher({getMsrstnList: () => jsonResponse(stationBody())});
  await readProvider('air-stations', q({}), {env: {DATA_GO_KR_SERVICE_KEY: encoded}, fetcher});
  assert.equal(calls[0].searchParams.get('serviceKey'), decoded);
  assert.ok(calls[0].href.includes('serviceKey=' + encoded), 'wire form is the single-encoded key');
  assert.ok(!calls[0].href.includes('%25'), 'never double-encoded');
});

test('air key: pasted whitespace, newlines and quotes are removed; double encoding is undone', () => {
  assert.equal(normalizeServiceKey('  "abc+/=="\n'), 'abc+/==');
  assert.equal(normalizeServiceKey(encodeURIComponent(encodeURIComponent('abc+/=='))), 'abc+/==');
  assert.equal(normalizeServiceKey('plain-key'), 'plain-key');
  assert.deepEqual(keyCandidates('a%2B', 'a+', '', undefined, ' b '), ['a+', 'b']);
});

test('air key: the single data.go.kr account key stored under KMA_SERVICE_KEY is tried as the last candidate', async () => {
  assert.equal(flags({KMA_SERVICE_KEY: 'TEST_ONLY'}).air, true);
  assert.equal(flags({}).air, false);
  const {fetcher, calls} = fakeFetcher({getMsrstnList: () => jsonResponse(stationBody())});
  await readProvider('air-stations', q({}), {env: {KMA_SERVICE_KEY: 'TEST_ONLY'}, fetcher});
  assert.equal(calls[0].searchParams.get('serviceKey'), 'TEST_ONLY');
});

test('air code NOT_CONFIGURED: no key gives 503 and makes no upstream call', async () => {
  const {fetcher, calls} = fakeFetcher({});
  const error = await failure(readProvider('air-stations', q({}), {env: {}, fetcher}));
  assert.equal(error.status, 503); assert.equal(error.code, 'NOT_CONFIGURED'); assert.equal(error.stage, 'station-list'); assert.equal(calls.length, 0);
});

test('air code KEY_REJECTED: JSON resultCode 30 and the XML gateway error are both recognised', async () => {
  const json30 = fakeFetcher({getMsrstnList: () => jsonResponse({response: {header: {resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}})});
  let error = await failure(readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher: json30.fetcher}));
  assert.equal(error.code, 'KEY_REJECTED'); assert.equal(error.status, 503);
  const xml = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
  const xml30 = fakeFetcher({getMsrstnList: () => new Response(xml, {headers: {'content-type': 'text/xml'}})});
  error = await failure(readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher: xml30.fetcher}));
  assert.equal(error.code, 'KEY_REJECTED');
  const http401 = fakeFetcher({getMsrstnList: () => new Response('Unauthorized', {status: 401})});
  error = await failure(readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher: http401.fetcher}));
  assert.equal(error.code, 'KEY_REJECTED');
});

test('air code ACCESS_DENIED: says which of the two AirKorea services lacks approval', async () => {
  const list = fakeFetcher({getMsrstnList: () => jsonResponse({response: {header: {resultCode: '20'}}})});
  let error = await failure(readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher: list.fetcher}));
  assert.equal(error.code, 'ACCESS_DENIED'); assert.equal(error.stage, 'station-list'); assert.match(error.message, /측정소정보/);
  const measure = fakeFetcher({getMsrstnList: () => jsonResponse(stationBody()), getMsrstnAcctoRltmMesureDnsty: () => new Response('Forbidden', {status: 403})});
  error = await failure(readProvider('air', q({station: 'TEST측정소'}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher: measure.fetcher}));
  assert.equal(error.code, 'ACCESS_DENIED'); assert.equal(error.stage, 'measurement'); assert.match(error.message, /대기오염정보/);
});

test('air key fallback: a rejected first key falls through to the next; a timeout does not', async () => {
  const ok = fakeFetcher({getMsrstnList: u => u.searchParams.get('serviceKey') === 'BAD_TEST' ? jsonResponse({response: {header: {resultCode: '30'}}}) : jsonResponse(stationBody())});
  const body = await readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'BAD_TEST', DATA_GO_KR_SERVICE_KEY: 'GOOD_TEST'}, fetcher: ok.fetcher});
  assert.equal(body.geojson.features.length, 1); assert.equal(ok.calls.length, 2);
  const slow = fakeFetcher({getMsrstnList: () => { throw Object.assign(new Error('aborted'), {name: 'AbortError'}); }});
  const error = await failure(readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'A_TEST', DATA_GO_KR_SERVICE_KEY: 'B_TEST'}, fetcher: slow.fetcher}));
  assert.equal(error.code, 'UPSTREAM_TIMEOUT'); assert.equal(error.status, 504); assert.equal(slow.calls.length, 1);
});

test('air codes: quota, unreachable network, non-JSON body and changed schema are distinct', async () => {
  const run = reply => failure(readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher: fakeFetcher({getMsrstnList: reply}).fetcher}));
  assert.equal((await run(() => jsonResponse({response: {header: {resultCode: '22'}}}))).code, 'QUOTA_EXCEEDED');
  assert.equal((await run(() => { throw new TypeError('fetch failed'); })).code, 'UPSTREAM_UNREACHABLE');
  assert.equal((await run(() => new Response('SERVICE ERROR'))).code, 'BAD_SHAPE');
  assert.equal((await run(() => jsonResponse({response: {header: {resultCode: '00'}, body: {unexpected: true}}}))).code, 'BAD_SHAPE');
  assert.equal((await run(() => new Response('x', {status: 500}))).code, 'UPSTREAM_HTTP');
});

test('air code NO_STATION: stations outside Seo-gu are never substituted', async () => {
  const outside = [{stationName: 'TEST경기광주', addr: 'TEST ONLY', dmX: '37.41', dmY: '127.25'}];
  const {fetcher} = fakeFetcher({getMsrstnList: () => jsonResponse(stationBody(outside))});
  const body = await readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher});
  assert.equal(body.ok, true); assert.equal(body.code, 'NO_STATION'); assert.equal(body.geojson.features.length, 0); assert.equal(body.totalScanned, 1);
  const error = await failure(readProvider('air', q({station: 'TEST경기광주'}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher}));
  assert.equal(error.status, 400);
});

test('air stations: swapped dmX/dmY still resolve to a Korean lon/lat, unusable pairs are dropped', async () => {
  const items = [{stationName: 'TEST뒤바뀜', dmX: '126.85', dmY: '35.15'}, {stationName: 'TEST빈값', dmX: '', dmY: ''}];
  const {fetcher} = fakeFetcher({getMsrstnList: () => jsonResponse(stationBody(items))});
  const body = await readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher});
  assert.deepEqual(body.geojson.features.map(f => f.geometry.coordinates), [[126.85, 35.15]]);
});

test('air measurement: newest KST row wins; "-" and flagged values stay null, zero stays zero', async () => {
  const rows = [
    {dataTime: '2026-01-01 23:00', pm10Value: '41', pm25Value: '20'},
    {dataTime: '2026-01-01 24:00', pm10Value: '0', pm25Value: '-', pm10Flag: null, pm25Flag: null},
    {dataTime: '2026-01-01 09:00', pm10Value: '99', pm25Value: '99'}
  ];
  const {fetcher, calls} = fakeFetcher({getMsrstnList: () => jsonResponse(stationBody()), getMsrstnAcctoRltmMesureDnsty: () => jsonResponse(measureBody(rows))});
  const body = await readProvider('air', q({station: 'TEST측정소'}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher});
  assert.equal(body.observedAt, '2026-01-01 24:00'); assert.equal(body.observedTimeZone, 'KST');
  assert.equal(body.pm10, 0); assert.equal(body.pm25, null);
  const sent = calls.at(-1).searchParams;
  assert.equal(sent.get('stationName'), 'TEST측정소'); assert.equal(sent.get('dataTerm'), 'DAILY'); assert.equal(sent.get('returnType'), 'json');
  // 같은 전송 수단에서는 측정소 목록을 다시 받지 않는다.
  await readProvider('air', q({station: 'TEST측정소'}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher});
  assert.equal(calls.filter(u => u.pathname.includes('getMsrstnList')).length, 1);
});

test('air code NO_DATA: an empty measurement list is reported, never shown as 0', async () => {
  const {fetcher} = fakeFetcher({getMsrstnList: () => jsonResponse(stationBody()), getMsrstnAcctoRltmMesureDnsty: () => jsonResponse(measureBody([]))});
  const error = await failure(readProvider('air', q({station: 'TEST측정소'}), {env: {AIRKOREA_SERVICE_KEY: 'TEST_ONLY'}, fetcher}));
  assert.equal(error.code, 'NO_DATA'); assert.equal(error.status, 404); assert.equal(error.stage, 'measurement');
});

test('air diagnostics never leak the key or the upstream URL', async () => {
  const secret = 'TESTONLYSECRET+KEY/VALUE==';
  for (const reply of [() => jsonResponse({response: {header: {resultCode: '30'}}}), () => new Response('x', {status: 401}), () => { throw new TypeError('fetch failed https://apis.data.go.kr/?serviceKey=' + secret); }]) {
    const error = await failure(readProvider('air-stations', q({}), {env: {AIRKOREA_SERVICE_KEY: secret}, fetcher: fakeFetcher({getMsrstnList: reply}).fetcher}));
    for (const value of [error.message, error.code, error.stage]) { assert.ok(!String(value).includes('TESTONLYSECRET')); assert.ok(!String(value).includes('apis.data.go.kr')); assert.ok(!String(value).includes('serviceKey')); }
  }
});

test('diagnostic table: every code has a status and a Korean owner message', () => {
  for (const [code, entry] of Object.entries(DIAGNOSTIC_CODES)) { assert.match(code, /^[A-Z_]+$/); assert.ok(entry.status >= 400); assert.match(entry.message, /[가-힣]/); }
  assert.equal(diagnose(new Error('KMA_RESULT_30')).code, 'KEY_REJECTED');
  assert.equal(diagnose(new Error('UPSTREAM_HTTP_403')).code, 'ACCESS_DENIED');
  assert.equal(diagnose(new Error('something else')), null);
  assert.equal(classifyUpstream(new Error('something else')).code, 'UPSTREAM_UNREACHABLE');
});

/* ---- HTTP 핸들러 수준: 화면이 받는 상태·본문 ---- */
function fakeRes() { return {headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); }}; }
const fakeReq = url => ({method: 'GET', url, headers: {host: 'test.invalid'}});

test('city-data handler: missing AirKorea key answers 503 with code and stage, not a bare 502', async () => {
  const saved = {}; for (const k of ['AIRKOREA_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY', 'KMA_SERVICE_KEY']) { saved[k] = process.env[k]; delete process.env[k]; }
  const res = fakeRes(), warn = console.warn; console.warn = () => {};
  try { await cityData(fakeReq('/api/city-data?kind=air-stations&dong=all&page=1'), res); }
  finally { console.warn = warn; for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v; }
  assert.equal(res.statusCode, 503); assert.deepEqual([res.body.ok, res.body.code, res.body.stage], [false, 'NOT_CONFIGURED', 'station-list']);
});

test('weather: encoded key is normalised and failures carry a code', async () => {
  const seen = [];
  const error = await failure(readWeather(126.85, 35.15, {env: {KMA_SERVICE_KEY: encodeURIComponent('TEST+ONLY=='), DATA_GO_KR_SERVICE_KEY: 'SECOND_TEST'}, now: new Date('2026-03-03T00:20:00Z'), fetcher: async url => { seen.push(new URL(url).searchParams.get('serviceKey')); return jsonResponse({response: {header: {resultCode: '30'}}}); }}));
  assert.deepEqual(seen, ['TEST+ONLY==', 'SECOND_TEST']);
  assert.equal(diagnose(error).code, 'KEY_REJECTED');
});

test('weather handler: no key keeps 503 and adds code NOT_CONFIGURED', async () => {
  const saved = {}; for (const k of ['DATA_GO_KR_SERVICE_KEY', 'KMA_SERVICE_KEY']) { saved[k] = process.env[k]; delete process.env[k]; }
  const res = fakeRes(), warn = console.warn; console.warn = () => {};
  try { await weatherApi(fakeReq('/api/weather?lon=126.85&lat=35.15'), res); }
  finally { console.warn = warn; for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v; }
  assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'NOT_CONFIGURED'); assert.match(res.body.error, /KMA_SERVICE_KEY/);
});
