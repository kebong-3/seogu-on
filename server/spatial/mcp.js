/**
 * 상태 없는(stateless) Streamable-HTTP MCP 서버. 의존성 없이 JSON-RPC 2.0 을 직접 처리한다.
 * - POST: 단일 요청 또는 배치 → application/json 응답 (SSE 없음)
 * - 알림만 온 경우 202, GET/DELETE 는 405
 * - 읽기 전용 공개자료라 인증이 없고 CORS 를 연다. 다른 API 의 gate() 와는 무관하다.
 * - 요청 본문은 로그에 남기지 않는다.
 */
import { readFileSync } from 'node:fs';
import { SpatialError, TOOLS, callTool } from './tools.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 20;
const RATE_LIMIT_PER_MINUTE = 120;

const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

const INSTRUCTIONS = [
  '서구:온은 전남광주통합특별시(광주) 서구 18개 행정동의 공개 공간자료를 질의하는 읽기 전용 서버입니다.',
  '버스정류장·그늘막·쿨링포그·학교·공원·주차장·도서관 등의 위치, 서구청이 공개한 과거 침수피해 기록, 행정동 경계를 다룹니다.',
  '먼저 list_datasets 로 쓸 수 있는 분류(category)와 연결 상태를 확인하세요.',
  '중요한 한계: (1) 모든 자료는 부분 자료입니다(다수가 OpenStreetMap 기반). 건수를 서구 전체 시설 수처럼 말하지 마세요.',
  '(2) 미연결 자료는 "0곳"이 아니라 "자료 없음"입니다. (3) 과거 침수 기록은 이력이지 위험 예측이 아닙니다.',
  '(4) 거리는 대표위치 간 직선거리입니다. (5) 실시간 운영·개방 상태는 알 수 없습니다.',
  '답변할 때 각 결과의 caveats 와 sources(출처·기준일)를 함께 전달하세요.',
].join(' ');

/** package.json 을 읽지 못하는 배포 환경에서도 서버가 죽지 않게 한다. */
function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}
const SERVER_INFO = { name: 'seogu-on', title: '서구:온 공간자료', version: readVersion() };

/* ───────────────────────── JSON-RPC ───────────────────────── */

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const validId = id => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

function initialize(params) {
  const requested = params?.protocolVersion;
  return {
    protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  };
}

/** 도구 결과를 MCP content 로. 텍스트는 요약 한 줄 + 간결한 JSON(지도 지시는 제외). */
function toolContent(result) {
  const payload = { data: result.data, sources: result.sources, caveats: result.caveats };
  return {
    content: [{ type: 'text', text: `${result.summary}\n\n${JSON.stringify(payload)}` }],
    structuredContent: { ok: result.ok, summary: result.summary, ...payload },
    isError: false,
  };
}

function toolFailure(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function callToolRpc(id, params, ctx) {
  if (!params || typeof params.name !== 'string') {
    return rpcError(id, RPC.INVALID_PARAMS, 'tools/call 에는 params.name 이 필요합니다.');
  }
  if (!TOOLS.some(tool => tool.name === params.name)) {
    return rpcError(id, RPC.INVALID_PARAMS, `알 수 없는 도구입니다: ${params.name.slice(0, 80)}`);
  }
  const args = params.arguments ?? {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    return rpcError(id, RPC.INVALID_PARAMS, 'params.arguments 는 객체여야 합니다.');
  }
  try {
    return rpcResult(id, toolContent(await callTool(params.name, args, ctx)));
  } catch (error) {
    // 입력 오류는 모델이 고쳐서 다시 부를 수 있도록 도구 결과(isError)로 돌려준다.
    if (error instanceof SpatialError) return rpcResult(id, toolFailure(`입력 오류(${error.code}): ${error.message}`));
    console.error('[mcp] tool failure', params.name, error?.name || 'Error');
    return rpcResult(id, toolFailure('도구 실행 중 서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.'));
  }
}

/** 메시지 하나를 처리한다. 알림·응답 메시지는 null(회신 없음). */
async function handleMessage(message, ctx) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    return rpcError(null, RPC.INVALID_REQUEST, 'JSON-RPC 2.0 요청 형식이 아닙니다.');
  }
  const hasId = Object.hasOwn(message, 'id');
  if (typeof message.method !== 'string') {
    // 클라이언트가 보낸 응답(result/error)은 받기만 한다.
    if (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) return null;
    return rpcError(validId(message.id) ? message.id : null, RPC.INVALID_REQUEST, 'method 가 필요합니다.');
  }
  if (!hasId) return null; // 알림
  if (!validId(message.id)) return rpcError(null, RPC.INVALID_REQUEST, 'id 는 문자열 또는 숫자여야 합니다.');

  const { id, method, params } = message;
  switch (method) {
    case 'initialize': return rpcResult(id, initialize(params));
    case 'ping': return rpcResult(id, {});
    case 'tools/list': return rpcResult(id, { tools: TOOLS });
    case 'tools/call': return callToolRpc(id, params, ctx);
    default: return rpcError(id, RPC.METHOD_NOT_FOUND, `지원하지 않는 메서드입니다: ${method.slice(0, 80)}`);
  }
}

/* ───────────────────────── HTTP ───────────────────────── */

class BodyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const tooLarge = () => new BodyError(413, RPC.INVALID_REQUEST, `요청 본문은 ${MAX_BODY_BYTES / 1024}KB 이하여야 합니다.`);
const badJson = () => new BodyError(400, RPC.PARSE_ERROR, 'JSON 본문을 해석하지 못했습니다.');

function parseText(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw tooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw badJson();
  }
}

/** 로컬 서버는 스트림, Vercel 은 미리 파싱된 req.body 를 준다. 둘 다 지원한다. */
async function readBody(req) {
  if (Number(req.headers?.['content-length'] || 0) > MAX_BODY_BYTES) throw tooLarge();

  let parsed;
  try {
    parsed = req.body; // Vercel: 잘못된 JSON 이면 이 접근에서 예외가 난다.
  } catch {
    throw badJson();
  }
  if (Buffer.isBuffer(parsed)) return parseText(parsed.toString('utf8'));
  if (typeof parsed === 'string') return parseText(parsed);
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > MAX_BODY_BYTES) throw tooLarge();
    return parsed;
  }

  if (typeof req[Symbol.asyncIterator] !== 'function') throw badJson();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw tooLarge();
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return parseText(Buffer.concat(chunks).toString('utf8'));
}

const buckets = new Map();

/** 인스턴스 메모리 기반의 IP별 임시 제한. 전역 제한이 아니다. */
function allow(req, now = Date.now()) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || 'local';
  let bucket = buckets.get(ip);
  if (!bucket || now > bucket.end) bucket = { count: 0, end: now + 60000 };
  bucket.count++;
  buckets.set(ip, bucket);
  if (buckets.size > 4000) {
    for (const [key, value] of buckets) if (value.end < now) buckets.delete(key);
    while (buckets.size > 4000) buckets.delete(buckets.keys().next().value);
  }
  return bucket.count <= RATE_LIMIT_PER_MINUTE;
}

function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendEmpty(res, status) {
  res.statusCode = status;
  res.end();
}

/**
 * /api/mcp 요청 처리기.
 * @param ctx {{dataDir?: string}} 테스트에서 fixture 자료를 쓸 때만 넘긴다.
 */
export async function handleMcp(req, res, ctx = {}) {
  setCommonHeaders(res);
  const method = req.method || 'GET';

  if (method === 'OPTIONS') return sendEmpty(res, 204);
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, rpcError(null, RPC.INVALID_REQUEST, '이 MCP 서버는 POST 만 지원합니다(SSE 스트림 없음).'));
  }
  if (!allow(req)) {
    res.setHeader('Retry-After', '60');
    return sendJson(res, 429, rpcError(null, RPC.INVALID_REQUEST, '요청이 많습니다. 잠시 후 다시 시도하세요.'));
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error instanceof BodyError) return sendJson(res, error.status, rpcError(null, error.code, error.message));
    return sendJson(res, 400, rpcError(null, RPC.PARSE_ERROR, '요청 본문을 읽지 못했습니다.'));
  }

  if (Array.isArray(body)) {
    if (!body.length || body.length > MAX_BATCH) {
      return sendJson(res, 400, rpcError(null, RPC.INVALID_REQUEST, `배치는 1~${MAX_BATCH}개의 메시지여야 합니다.`));
    }
    const replies = [];
    for (const message of body) {
      const reply = await handleMessage(message, ctx);
      if (reply) replies.push(reply);
    }
    return replies.length ? sendJson(res, 200, replies) : sendEmpty(res, 202);
  }

  const reply = await handleMessage(body, ctx);
  return reply ? sendJson(res, 200, reply) : sendEmpty(res, 202);
}

/** 테스트용: 요청 제한 상태 초기화. */
export function resetRateLimit() {
  buckets.clear();
}
