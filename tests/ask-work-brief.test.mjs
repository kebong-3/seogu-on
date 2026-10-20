// 실제 fixture 공간계산 + 모의 AI/KMA 전송. 실제 제공기관의 성공 증거와 구분한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {callTool} from '../server/spatial/tools.js';
import {answerQuestion, resetAskLimits} from '../server/ai/ask.js';
import {modelConfig} from '../server/ai/model-config.js';

const dataDir = fileURLToPath(new URL('./fixtures/spatial/data/', import.meta.url));
const input = question => ({question, dong: null, previousQuestions: []});
const weather = async () => ({ok: true, grid: {nx: 58, ny: 74}, base: {base_date: '20261020', base_time: '1400'}, values: {T1H: 16, RN1: 0.5, REH: 70}, fetchedAt: '2026-10-20T06:00:00.000Z'});
const says = text => ({ok: true, status: 200, json: async () => ({candidates: [{content: {parts: [{text}]}, finishReason: 'STOP'}]})});
test.beforeEach(() => resetAskLimits());

test('업무근거: 실제 공간공백 계산을 묶고 미수록 자료는 0곳으로 만들지 않는다', async () => {
  const r = await callTool('work_brief', {theme: 'heat', dong: '가람동'}, {dataDir});
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.comparison, {radiusM: 150, targets: 2, uncovered: 1});
  assert.equal(r.map.highlight.features.length, 1);
  assert.equal(r.data.evidence.find(e => e.title === '무더위쉼터').ok, false);
  assert.ok(r.data.missingData.some(s => s.includes('무더위쉼터')));
  assert.ok(r.data.nextActions.some(s => s.includes('현장')));
  assert.ok(r.caveats.some(s => s.includes('법정 설치기준이 아닙니다')));
  assert.ok(r.sources.some(s => s.name.includes('버스정류장')));
});

test('업무근거: 한파 서비스가 미연결이면 공백 숫자를 내지 않고 수신된 정류장만 유지한다', async () => {
  const r = await callTool('work_brief', {theme: 'cold', dong: '가람동'}, {dataDir});
  assert.equal(r.data.comparison, undefined);
  assert.equal(r.map.highlight.features.length, 2);
  assert.equal(r.data.evidence.find(e => e.tool === 'coverage_gap').ok, false);
  assert.ok(r.data.missingData.some(s => s.includes('한파쉼터')));
});

test('업무근거: 잘못된 주제·동·반경은 거절한다', async () => {
  for (const theme of ['__proto__', 'constructor', 'unknown']) await assert.rejects(callTool('work_brief', {theme}, {dataDir}), e => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(callTool('work_brief', {theme: 'heat', dong: '없는동'}, {dataDir}), e => e.code === 'DONG_NOT_FOUND');
  await assert.rejects(callTool('work_brief', {theme: 'heat', radiusM: -1}, {dataDir}), e => e.code === 'INVALID_ARGUMENT');
});

test('기본 AI 경로: 서버가 공간자료를 먼저 계산하고 1회 근거 요약으로 완결한다', async () => {
  const requests = [];
  const r = await answerQuestion(input('가람동에서 그늘막이 150m 안에 없는 버스정류장은?'), {
    dataDir, env: {GEMINI_API_KEY: 'mock-key'},
    fetcher: async (url, init) => {requests.push(JSON.parse(init.body)); return says('가람동 수록 정류장 2곳 중 그늘막 반경 150m 밖 후보는 1곳입니다. 현장 확인이 필요합니다.');},
  });
  assert.equal(r.mode, 'llm');
  assert.equal(r.analysisPath, 'grounded-summary');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].toolConfig.functionCallingConfig.mode, 'NONE');
  assert.equal(requests[0].generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(requests[0].contents.length, 1, '모델이 호출한 척하는 가짜 함수호출 이력을 만들지 않는다');
  assert.match(requests[0].contents[0].parts[0].text, /서버가 이번 요청에서 실제 실행한/);
  assert.deepEqual(r.steps.map(s => s.tool), ['coverage_gap']);
  assert.equal(r.map.highlight.features.length, 1);
});

test('업무질문: KMA 관측시각·범위·실제값을 근거로 넣고 모델에도 전달한다', async () => {
  const requests = [];
  const r = await answerQuestion(input('가람동 폭염 대응 점검자료 정리해줘'), {
    dataDir, env: {GEMINI_API_KEY: 'mock-key', KMA_SERVICE_KEY: 'private-weather-key'}, weatherReader: weather,
    fetcher: async (url, init) => {requests.push(JSON.parse(init.body)); return says('가람동은 그늘막 공백 후보를 현장에서 확인할 수 있습니다. 기상청 격자 관측 기온은 16℃이며 실시간 위험 예측은 아닙니다.');},
  });
  assert.equal(r.mode, 'llm');
  assert.equal(requests.length, 1);
  assert.equal(r.brief.observation.status, 'received');
  assert.equal(r.brief.observation.observedAt, '2026-10-20 14:00 KST');
  assert.equal(r.brief.observation.values.rainfall1hMm, 0.5);
  assert.equal(r.brief.observation.values.windSpeedMs, undefined, '미관측값은 0으로 채우지 않는다');
  assert.ok(r.sources.some(s => s.name === '기상청 초단기실황' && s.date.includes('14:00 KST')));
  assert.match(requests[0].contents[0].parts[0].text, /temperatureC.*16/);
  assert.match(requests[0].contents[0].parts[0].text, /5km/);
  assert.ok(!JSON.stringify(r).includes('private-weather-key'));
});

test('KMA 제한시간: 관측 실패를 보존하고 기존 공간근거를 잃지 않는다', async () => {
  const start = Date.now();
  const r = await answerQuestion(input('가람동 한파 대응 점검자료 정리해줘'), {
    dataDir, env: {KMA_SERVICE_KEY: 'private-key'}, weatherBudgetMs: 60, weatherReader: () => new Promise(() => {}),
  });
  assert.ok(Date.now() - start < 700);
  assert.equal(r.mode, 'rules');
  assert.equal(r.brief.observation.ok, false);
  assert.equal(r.brief.observation.code, 'UPSTREAM_TIMEOUT');
  assert.equal(r.brief.observation.values, undefined);
  assert.equal(r.steps.find(s => s.tool === 'weather_observation').ok, false);
  assert.equal(r.map.highlight.features.length, 2);
  assert.ok(r.sources.some(s => s.name.includes('버스정류장')));
});

test('AI 실패: 기상근거를 재조회하지 않고 확보된 자료와 원인코드로 fallback한다', async t => {
  t.mock.method(console, 'error', () => {});
  let weatherCalls = 0;
  const r = await answerQuestion(input('가람동 침수 이력 현장점검 준비해줘'), {
    dataDir, env: {GEMINI_API_KEY: 'private-ai-key', KMA_SERVICE_KEY: 'private-weather-key'},
    weatherReader: async () => {weatherCalls++; return weather();},
    fetcher: async () => ({ok: false, status: 429, json: async () => ({error: 'private-ai-key'})}),
  });
  assert.equal(weatherCalls, 1);
  assert.equal(r.mode, 'rules');
  assert.equal(r.code, 'LLM_QUOTA');
  assert.equal(r.brief.observation.ok, true);
  assert.match(r.answer, /16℃/);
  assert.ok(r.caveats.some(s => s.includes('위험 예측')));
  assert.ok(!JSON.stringify(r).includes('private-'));
});

test('호환모델도 한 번의 근거요약을 지원하고 Google 전용 thinking 설정을 보내지 않는다', async () => {
  let sent;
  const r = await answerQuestion(input('가람동 버스정류장 알려줘'), {
    dataDir, env: {AI_PROVIDER: 'openai-compatible', AI_MODEL: 'self-hosted-model', AI_API_BASE: 'https://model.example/v1'},
    fetcher: async (url, init) => {sent = JSON.parse(init.body); return {ok: true, json: async () => ({choices: [{message: {content: '가람동 버스정류장 수록 지점은 2곳입니다.'}, finish_reason: 'stop'}]})};},
  });
  assert.equal(r.mode, 'llm');
  assert.equal(r.analysisPath, 'grounded-summary');
  assert.equal(sent.tool_choice, 'none');
  assert.equal(sent.thinkingConfig, undefined);
  assert.equal(modelConfig({GEMINI_MODEL: 'gemini-2.5-flash'}).model, 'gemini-2.5-flash');
  assert.equal(modelConfig({AI_MODEL: 'explicit', GEMMA_MODEL: 'other', GEMINI_MODEL: 'legacy'}).model, 'explicit');
});
