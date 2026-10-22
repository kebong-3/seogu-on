// MCP(Streamable HTTP, stateless) 처리기와 api/ai.js 라우팅, 배포 설정 점검.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleMcp, resetRateLimit } from '../server/spatial/mcp.js';
import aiHandler from '../api/ai.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const ctx = { dataDir: fileURLToPath(new URL('./fixtures/spatial/data/', import.meta.url)) };
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

/** 스트림 본문을 가진 가짜 요청(로컬 dev 서버와 같은 형태). */
function request(body, { method = 'POST', url = '/api/ai?route=mcp', headers = {} } = {}) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(text ? [Buffer.from(text)] : []);
  req.method = method;
  req.url = url;
  req.headers = { host: 'seogu-on.test', 'content-type': 'application/json', ...headers };
  return req;
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = String(value); },
    end(value = '') { this.body = String(value); this.ended = true; },
    json() { return JSON.parse(this.body); },
  };
}

async function post(body, options) {
  const res = response();
  await handleMcp(request(body, options), res, ctx);
  return res;
}

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

test.beforeEach(() => resetRateLimit());

test('MCP 수명주기: initialize → initialized → tools/list → tools/call', async () => {
  const init = await post(rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } }));
  assert.equal(init.statusCode, 200);
  assert.match(init.headers['content-type'], /^application\/json/);
  const result = init.json().result;
  assert.equal(result.protocolVersion, '2025-03-26');
  assert.deepEqual(result.serverInfo.name, 'seogu-on');
  assert.equal(result.serverInfo.version, pkg.version);
  assert.ok(result.capabilities.tools);
  assert.match(result.instructions, /부분 자료/);
  assert.match(result.instructions, /위험 예측이 아닙니다/);

  const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notified.statusCode, 202);
  assert.equal(notified.body, '');

  const list = (await post(rpc(2, 'tools/list'))).json().result.tools;
  assert.ok(list.length >= 9);
  for (const tool of list) {
    assert.deepEqual(Object.keys(tool).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
    assert.equal(tool.annotations.readOnlyHint, true);
  }

  const call = (await post(rpc(3, 'tools/call', { name: 'coverage_gap', arguments: { target: 'bus', service: '그늘막' } }))).json();
  assert.equal(call.id, 3);
  assert.equal(call.result.isError, false);
  assert.equal(call.result.content.length, 1);
  const [summary, json] = call.result.content[0].text.split('\n\n');
  assert.match(summary, /5곳 중 반경 150m.*3곳/);
  assert.deepEqual(Object.keys(JSON.parse(json)), ['data', 'sources', 'caveats']);
  assert.equal(call.result.structuredContent.data.uncovered, 3);
  assert.equal(call.result.structuredContent.summary, summary);
  assert.equal(call.result.structuredContent.map, undefined, '지도 지시는 MCP 응답에 넣지 않는다');
});

test('프로토콜 버전 협상: 아는 버전은 그대로, 모르는 버전은 최신으로', async () => {
  for (const version of ['2025-06-18', '2025-03-26', '2024-11-05']) {
    assert.equal((await post(rpc(1, 'initialize', { protocolVersion: version }))).json().result.protocolVersion, version);
  }
  assert.equal((await post(rpc(1, 'initialize', { protocolVersion: '1999-01-01' }))).json().result.protocolVersion, '2025-06-18');
  assert.equal((await post(rpc('a', 'initialize'))).json().result.protocolVersion, '2025-06-18');
});

test('ping 과 문자열 id', async () => {
  assert.deepEqual((await post(rpc('p-1', 'ping'))).json(), { jsonrpc: '2.0', id: 'p-1', result: {} });
});

test('배치: 요청만 응답하고 알림은 건너뛴다. 알림만 있으면 202', async () => {
  const res = await post([
    rpc(1, 'ping'),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    rpc(2, 'tools/call', { name: 'list_datasets' }),
    rpc(3, 'nope'),
  ]);
  assert.equal(res.statusCode, 200);
  const replies = res.json();
  assert.deepEqual(replies.map(r => r.id), [1, 2, 3]);
  assert.equal(replies[1].result.isError, false);
  assert.equal(replies[2].error.code, -32601);

  const onlyNotes = await post([{ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }]);
  assert.equal(onlyNotes.statusCode, 202);
  assert.equal(onlyNotes.body, '');

  const empty = await post([]);
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error.code, -32600);
  const huge = await post(Array.from({ length: 21 }, (_, i) => rpc(i, 'ping')));
  assert.equal(huge.statusCode, 400);
});

test('잘못된 JSON 은 -32700, JSON-RPC 가 아니면 -32600', async () => {
  const bad = await post('{"jsonrpc": ');
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, -32700);
  assert.equal(bad.json().id, null);
  assert.equal((await post('')).json().error.code, -32700);

  assert.equal((await post({ hello: 'world' })).json().error.code, -32600);
  assert.equal((await post({ jsonrpc: '2.0', id: 1 })).json().error.code, -32600);
  assert.equal((await post({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' })).json().error.code, -32600);
  // 클라이언트가 보낸 응답 메시지는 받기만 한다.
  assert.equal((await post({ jsonrpc: '2.0', id: 9, result: {} })).statusCode, 202);
});

test('본문 크기 제한 64KB', async () => {
  const big = await post(rpc(1, 'tools/call', { name: 'locate', arguments: { query: '가'.repeat(30000) } }));
  assert.equal(big.statusCode, 413);
  assert.equal(big.json().error.code, -32600);
  const declared = await post(rpc(1, 'ping'), { headers: { 'content-length': '999999' } });
  assert.equal(declared.statusCode, 413);
});

test('Vercel 형태(req.body 사전 파싱)와 파싱 실패 getter 도 처리한다', async () => {
  const parsed = { method: 'POST', url: '/api/ai?route=mcp', headers: {}, body: rpc(5, 'ping') };
  const ok = response();
  await handleMcp(parsed, ok, ctx);
  assert.deepEqual(ok.json(), { jsonrpc: '2.0', id: 5, result: {} });

  const asText = response();
  await handleMcp({ ...parsed, body: JSON.stringify(rpc(6, 'ping')) }, asText, ctx);
  assert.equal(asText.json().id, 6);

  const throwing = { method: 'POST', url: '/api/ai?route=mcp', headers: {}, get body() { throw new Error('Invalid JSON'); } };
  const bad = response();
  await handleMcp(throwing, bad, ctx);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, -32700);
});

test('알 수 없는 메서드는 -32601, 알 수 없는 도구·잘못된 params 는 -32602', async () => {
  assert.equal((await post(rpc(1, 'resources/list'))).json().error.code, -32601);
  assert.equal((await post(rpc(2, 'tools/call', { name: 'rm_rf', arguments: {} }))).json().error.code, -32602);
  assert.equal((await post(rpc(3, 'tools/call', {}))).json().error.code, -32602);
  assert.equal((await post(rpc(4, 'tools/call', { name: 'locate', arguments: 'x' }))).json().error.code, -32602);
});

test('도구 입력 오류는 프로토콜 오류가 아니라 isError 결과', async () => {
  const body = (await post(rpc(1, 'tools/call', { name: 'dong_profile', arguments: { dong: '서울동' } }))).json();
  assert.equal(body.error, undefined);
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /DONG_NOT_FOUND/);
  assert.match(body.result.content[0].text, /가람동/);

  // 미연결 자료는 오류가 아니라 "자료 없음"이라는 정상 답변이다.
  const missing = (await post(rpc(2, 'tools/call', { name: 'find_facilities', arguments: { category: 'cold' } }))).json();
  assert.equal(missing.result.isError, false);
  assert.equal(missing.result.structuredContent.ok, false);
  assert.match(missing.result.content[0].text, /미연결/);
});

test('GET·DELETE 는 405 + Allow: POST, OPTIONS 는 CORS 사전요청 허용', async () => {
  for (const method of ['GET', 'DELETE', 'PUT', 'HEAD']) {
    const res = response();
    await handleMcp(request(undefined, { method }), res, ctx);
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.headers.allow, 'POST');
  }
  const pre = response();
  await handleMcp(request(undefined, { method: 'OPTIONS', headers: { origin: 'https://chat.example' } }), pre, ctx);
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['access-control-allow-origin'], '*');
  assert.match(pre.headers['access-control-allow-methods'], /POST/);
  assert.match(pre.headers['access-control-allow-headers'], /Mcp-Protocol-Version/);

  // 다른 출처의 POST 도 받는다(읽기 전용 공개자료).
  const cross = await post(rpc(1, 'ping'), { headers: { origin: 'https://chat.example' } });
  assert.equal(cross.statusCode, 200);
  assert.equal(cross.headers['access-control-allow-origin'], '*');
  assert.equal(cross.headers['cache-control'], 'no-store');
});

test('IP별 요청 제한(인스턴스 메모리)', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
  let last;
  for (let i = 0; i < 121; i++) last = await post(rpc(i, 'ping'), { headers });
  assert.equal(last.statusCode, 429);
  assert.equal(last.headers['retry-after'], '60');
  const other = await post(rpc(1, 'ping'), { headers: { 'x-forwarded-for': '203.0.113.10' } });
  assert.equal(other.statusCode, 200);
});

test('api/ai.js: route=mcp 와 /api/mcp 경로 모두 MCP 로, 그 밖은 404 JSON', async () => {
  for (const url of ['/api/ai?route=mcp', '/api/mcp']) {
    const res = response();
    await aiHandler(request(rpc(1, 'tools/list'), { url }), res);
    assert.equal(res.statusCode, 200, url);
    assert.ok(res.json().result.tools.length >= 9);
  }
  // 실제 자료로 끝까지 한 번 호출해 본다.
  const real = response();
  await aiHandler(request(rpc(2, 'tools/call', { name: 'list_datasets', arguments: {} })), real);
  assert.equal(real.json().result.structuredContent.data.dongs.length, 18);

  for (const url of ['/api/ai', '/api/ai?route=nope', '/api/ai?route=__proto__', '/api/ai?route=constructor']) {
    const res = response();
    await aiHandler(request(rpc(1, 'ping'), { url }), res);
    assert.equal(res.statusCode, 404, url);
    assert.equal(res.json().ok, false);
    assert.match(res.headers['content-type'], /^application\/json/);
  }
});

test('배포 설정: 함수 12개 이하, rewrites, includeFiles, dev 서버 경로', () => {
  const functions = readdirSync(`${root}api`).filter(name => name.endsWith('.js'));
  assert.ok(functions.length <= 12, `api/ 함수 ${functions.length}개 (Vercel Hobby 한도 12)`);
  assert.ok(functions.includes('ai.js'));

  const config = JSON.parse(readFileSync(`${root}vercel.json`, 'utf8'));
  assert.deepEqual(config.functions['api/ai.js'].includeFiles, 'public/data/**');
  const rewrites = Object.fromEntries(config.rewrites.map(r => [r.source, r.destination]));
  assert.equal(rewrites['/api/mcp'], '/api/ai?route=mcp');
  assert.equal(rewrites['/api/ask'], '/api/ai?route=ask');
  // vercel.json 에 적힌 함수는 모두 실제 파일이어야 한다.
  for (const path of Object.keys(config.functions)) assert.ok(functions.includes(path.replace('api/', '')), path);

  const dev = readFileSync(`${root}scripts/dev.mjs`, 'utf8');
  assert.match(dev, /\['mcp', 'ask', 'space-review', 'region-profile'\]\.includes\(name\)/);
  assert.match(dev, /'city-wms', 'ai'\]/);
});
