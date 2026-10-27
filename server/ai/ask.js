/**
 * /api/ask — "지도에게 묻기".
 * 질문을 받아 공간 도구(server/spatial/tools.js)의 결과만으로 짧은 답을 만든다.
 *   - AI 모드(llm): 명확한 질문은 서버가 먼저 조회하고 AI가 요약한다. 그 밖의 질문은 AI가 도구를 고른다.
 *   - 규칙 기반(rules): 키가 없거나 AI 호출이 실패하면 정해진 규칙으로 답한다. 이때 code 로 이유를 알린다.
 * 이 사이트의 화면만 부르는 경로라 같은 출처의 POST 만 받는다. 질문 내용은 로그에 남기지 않는다.
 */
import { ASK_EXAMPLES } from '../../src/city/ask-examples.js';
import { getStore } from '../spatial/store.js';
import { LlmError, answerByLlm } from './gemini.js';
import {modelConfig} from './model-config.js';
import { RULES_NOTICE, answerByRules } from './rules.js';
import {attachWeatherEvidence, briefFromResults} from './work-evidence.js';
import {attachCivicReview, normalizeReviewContext, ReviewInputError} from './civic-review.js';
import {registeredRegionId} from '../../shared/region-catalog.js';
import {answerRegionQuestion} from './region-ask.js';

export const ASK_LIMITS = {
  bodyBytes: 16 * 1024,
  questionChars: 300,
  historyItems: 3,
  perMinute: 10,
  dailyDefault: 300,
};

/** 응답의 code 값과 뜻. docs/AI_PANEL.md 의 표와 같아야 한다. */
export const ASK_CODES = {
  LLM_NOT_CONFIGURED: '선택한 AI의 서버 키(UPSTAGE_API_KEY / AI_API_KEY / GEMINI_API_KEY)가 설정되지 않음',
  LLM_MODEL_NOT_FOUND: '모델 이름을 찾지 못함(AI_MODEL 확인)',
  LLM_QUOTA: '연결된 AI 제공기관의 사용량 한도 초과(429)',
  LLM_KEY_REJECTED: '키가 거부됨(오타·만료·제한 설정)',
  LLM_TIMEOUT: '시간 안에 응답이 오지 않음',
  LLM_BAD_REQUEST: '연결된 AI 제공기관이 요청 형식을 거부함(400)',
  LLM_BAD_RESPONSE: '응답이 비었거나 차단·형식 오류',
  LLM_UNGROUNDED: 'AI 답에 도구 결과에 없는 숫자가 있어 버림',
  LLM_DAILY_LIMIT: '하루 AI 호출 한도(ASK_DAILY_LIMIT) 도달',
};

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ───────────────────────── 요청 읽기 ───────────────────────── */

function parseText(text, maxBytes = ASK_LIMITS.bodyBytes) {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw tooLarge(maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError(400, 'BAD_JSON', 'JSON 본문을 해석하지 못했습니다.');
  }
}

const tooLarge = (maxBytes = ASK_LIMITS.bodyBytes) => new RequestError(413, 'BODY_TOO_LARGE', `요청 본문은 ${maxBytes / 1024}KB 이하여야 합니다.`);

/** 로컬 서버는 스트림, Vercel 은 미리 파싱된 req.body 를 준다. */
export async function readBody(req, {maxBytes = ASK_LIMITS.bodyBytes} = {}) {
  if (Number(req.headers?.['content-length'] || 0) > maxBytes) throw tooLarge(maxBytes);
  let parsed;
  try {
    parsed = req.body;
  } catch {
    throw new RequestError(400, 'BAD_JSON', 'JSON 본문을 해석하지 못했습니다.');
  }
  if (Buffer.isBuffer(parsed)) return parseText(parsed.toString('utf8'), maxBytes);
  if (typeof parsed === 'string') return parseText(parsed, maxBytes);
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > maxBytes) throw tooLarge(maxBytes);
    return parsed;
  }
  if (typeof req[Symbol.asyncIterator] !== 'function') throw new RequestError(400, 'BAD_JSON', '요청 본문이 없습니다.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.length;
    if (size > maxBytes) throw tooLarge(maxBytes);
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return parseText(Buffer.concat(chunks).toString('utf8'), maxBytes);
}

/** 본문 검사. 이전 질문은 사용자가 쓴 것만, 짧게 몇 개만 받는다. */
function readInput(body, store) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
  }
  const question = typeof body.question === 'string' ? body.question.replace(/\s+/g, ' ').trim() : '';
  if (!question) throw new RequestError(400, 'QUESTION_REQUIRED', '질문을 입력하세요.');
  if (question.length > ASK_LIMITS.questionChars) {
    throw new RequestError(400, 'QUESTION_TOO_LONG', `질문은 ${ASK_LIMITS.questionChars}자 이하로 적어 주세요.`);
  }
  const dong = typeof body.dongId === 'string' ? store.dongs.find(d => d.id === body.dongId) : null;
  const previousQuestions = (Array.isArray(body.history) ? body.history : [])
    .filter(item => item && item.role === 'user' && typeof item.text === 'string' && item.text.trim())
    .slice(-ASK_LIMITS.historyItems)
    .map(item => item.text.replace(/\s+/g, ' ').trim().slice(0, ASK_LIMITS.questionChars));
  const reviewContext = normalizeReviewContext(body.reviewContext);
  return { question, dong: dong || null, previousQuestions, ...(reviewContext ? {reviewContext} : {}) };
}

/* ───────────────────────── 출처·횟수 제한 ───────────────────────── */

/** 다른 사이트에서 온 요청인지(gate() 와 같은 생각: Origin 이 있으면 Host 와 같아야 한다). */
export function crossOrigin(req) {
  if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return true;
  const origin = req.headers?.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers?.host;
  } catch {
    return true;
  }
}

const buckets = new Map();
const daily = { day: '', count: 0 };

/** 인스턴스 메모리 기반의 IP별 임시 제한. 전역 제한이 아니다. */
export function allowIp(req, now) {
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
  return bucket.count <= ASK_LIMITS.perMinute;
}

function dailyLimit(env) {
  const value = Number(env.ASK_DAILY_LIMIT);
  return Number.isInteger(value) && value >= 0 ? value : ASK_LIMITS.dailyDefault;
}

/** 하루(한국시간) AI 호출 수를 센다. 한도를 넘으면 false. 인스턴스마다 따로 센다. */
export function takeDaily(env, now) {
  const day = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (daily.day !== day) Object.assign(daily, { day, count: 0 });
  if (daily.count >= dailyLimit(env)) return false;
  daily.count++;
  return true;
}

/** 테스트용: 횟수 제한 상태 초기화. */
export function resetAskLimits() {
  buckets.clear();
  Object.assign(daily, { day: '', count: 0 });
}

/* ───────────────────────── 답 조립 ───────────────────────── */

/** 실제로 쓴 도구 결과에서만 출처·한계를 모은다. */
function mergeEvidence(results) {
  const sources = new Map();
  const caveats = new Set();
  for (const { result } of results) {
    if (!result) continue;
    for (const source of result.sources || []) {
      const key = `${source.name}|${source.date}`;
      if (!sources.has(key)) sources.set(key, source);
    }
    for (const caveat of result.caveats || []) caveats.add(caveat);
  }
  return { sources: [...sources.values()].slice(0, 12), caveats: [...caveats].slice(0, 12) };
}

const featureCount = map => map?.highlight?.features?.length || 0;

/**
 * 지도에 그릴 지시 하나를 고른다: 강조할 지점이 있는 마지막 결과 → 없으면 위치만 있는 마지막 결과.
 * 같은 도구를 동마다 부른 경우(화정1~4동)는 지점을 합친다.
 */
export function pickMap(results) {
  const withMap = results.filter(r => r.result?.map);
  const highlighted = withMap.filter(r => featureCount(r.result.map));
  const last = highlighted.at(-1);
  if (!last) return withMap.at(-1)?.result.map ?? null;
  const siblings = highlighted.filter(r => r.tool === last.tool && r.args.dong && last.args.dong && r !== last);
  if (!siblings.length) return last.result.map;
  const features = [...siblings, last].flatMap(r => r.result.map.highlight.features).slice(0, 200);
  return { highlight: { type: 'FeatureCollection', features } };
}

function buildResponse(mode, outcome, extra = {}) {
  const brief = briefFromResults(outcome.results);
  return {
    ok: true,
    mode,
    answer: outcome.answer,
    steps: outcome.steps.map(step => ({ tool: step.tool, args: step.args, summary: step.summary, ok: step.ok })),
    map: pickMap(outcome.results),
    ...mergeEvidence(outcome.results),
    ...(brief ? {brief} : {}),
    ...extra,
  };
}

async function prepareOutcome(input, ctx) {
  const rules = await answerByRules(input.question, {dongId: input.dong?.id, reviewContext: input.reviewContext}, {dataDir: ctx.dataDir, now: ctx.now});
  return attachWeatherEvidence(attachCivicReview(rules, input.reviewContext, input.question), ctx);
}

async function rulesResponse(input, ctx, code) {
  const outcome = ctx.preparedOutcome || await prepareOutcome(input, ctx);
  return buildResponse('rules', outcome, {
    notice: RULES_NOTICE,
    ...(outcome.matched ? {} : { examples: ASK_EXAMPLES }),
    ...(code ? { code } : {}),
  });
}

/**
 * 질문 하나에 답한다(HTTP 와 분리된 핵심 함수).
 * @param {{question: string, dong: object|null, previousQuestions: string[], reviewContext?: object}} input
 * @param {{env?: object, fetcher?: Function, dataDir?: string, now?: number, budgetMs?: number}} ctx
 */
export async function answerQuestion(input, ctx = {}) {
  const startedAt = Date.now();
  input = {...input, reviewContext: normalizeReviewContext(input.reviewContext)};
  const env = ctx.env || process.env;
  const now = ctx.now ?? Date.now();
  // 명확한 공간질문은 서버가 실제 조회를 먼저 해, 모델의 도구선택 왕복을 줄인다.
  // precompute=false는 내부 테스트에서 기존 자유질문 도구선택 경로를 따로 검증할 때만 사용한다.
  const preparedOutcome = ctx.precompute === false ? null : await prepareOutcome(input, {...ctx, env, now});
  const preparedCtx = {...ctx, env, preparedOutcome};
  const config=modelConfig(env);
  if(config.error)return rulesResponse(input,preparedCtx,'LLM_BAD_REQUEST');
  const {key,model,provider,baseUrl,reasoningEffort}=config;
  if (!key && provider!=='openai-compatible') return rulesResponse(input, preparedCtx, 'LLM_NOT_CONFIGURED');
  if (!takeDaily(env, now)) return rulesResponse(input, preparedCtx, 'LLM_DAILY_LIMIT');

  const store = getStore(ctx.dataDir);
  try {
    const outcome = await answerByLlm(
      input.question,
      { dongName: input.dong?.name, previousQuestions: input.previousQuestions, dongNames: store.dongs.map(d => d.name), reviewContext: input.reviewContext },
      { key, model, provider,baseUrl, reasoningEffort, fetcher: ctx.fetcher || fetch, dataDir: ctx.dataDir,
        budgetMs: Math.max(1, (ctx.budgetMs ?? 25000) - (Date.now() - startedAt)), now: ctx.clock,
        preparedOutcome: preparedOutcome?.matched && preparedOutcome.results.length ? preparedOutcome : null },
    );
    const withReview = attachCivicReview(outcome, input.reviewContext, input.question);
    return buildResponse('llm', {...withReview, answer: outcome.answer}, { provider,model: outcome.model || model, modelRecovered: !!outcome.modelRecovered, analysisPath: outcome.analysisPath });
  } catch (error) {
    const code = error instanceof LlmError ? error.code : 'LLM_BAD_RESPONSE';
    // 질문·키·요청 주소는 남기지 않고 코드만 기록한다.
    console.error('[ask] llm fallback', code);
    return rulesResponse(input, preparedCtx, code);
  }
}

/* ───────────────────────── HTTP ───────────────────────── */

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

const fail = (res, status, code, error) => send(res, status, { ok: false, error, code });

/**
 * /api/ask 요청 처리기.
 * @param ctx {{env?, fetcher?, dataDir?, now?, budgetMs?}} 테스트에서만 넘긴다.
 */
export async function handleAsk(req, res, ctx = {}) {
  if ((req.method || 'GET') !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.');
  }
  if (crossOrigin(req)) return fail(res, 403, 'CROSS_ORIGIN', '다른 출처의 요청입니다.');
  if (!allowIp(req, ctx.now ?? Date.now())) {
    res.setHeader('Retry-After', '60');
    return fail(res, 429, 'RATE_LIMITED', '질문이 많습니다. 1분 뒤에 다시 시도하세요.');
  }
  try {
    const body=await readBody(req);
    const regionId=body?.regionId === undefined ? ((ctx.env||process.env).REGION_PROFILE||'seogu') : registeredRegionId(body.regionId);
    if (regionId!=='seogu') return send(res,200,await answerRegionQuestion(body,{...ctx,allowModel:()=>takeDaily(ctx.env||process.env,ctx.now??Date.now())}));
    const input = readInput(body, getStore(ctx.dataDir));
    return send(res, 200, await answerQuestion(input, ctx));
  } catch (error) {
    if (error instanceof RequestError || error instanceof ReviewInputError || error.status===400) return fail(res, error.status, error.code, error.message);
    console.error('[ask] failure', error?.name || 'Error');
    return fail(res, 500, 'ASK_FAILED', '답을 만드는 중 오류가 났습니다. 잠시 후 다시 시도하세요.');
  }
}
