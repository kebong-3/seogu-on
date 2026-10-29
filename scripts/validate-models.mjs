#!/usr/bin/env node
/** Opt-in real-model verification. No mock fetcher and no production configuration changes. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {answerQuestion} from '../server/ai/ask.js';

export const MODEL_TASKS = Object.freeze([
  {id: 'park-location', question: '풍암동 공원 위치를 찾아줘'},
  {id: 'school-shade-200m', question: '풍암동 학교 주변 그늘막을 반경 200m로 비교해줘'},
  {id: 'two-dong-schools', question: '풍암동과 상무2동의 학교 수를 비교해줘'},
]);
const root = fileURLToPath(new URL('..', import.meta.url));
const sha = text => createHash('sha256').update(text).digest('hex');
const normalizedProvider = value => value === 'solar' ? 'upstage' : value || 'google';

export function targetEnvironment(target, env) {
  const selected = normalizedProvider(env.AI_PROVIDER);
  let key = '';
  if (target.provider === 'google') key = env.GEMINI_API_KEY || (selected === 'google' ? env.AI_API_KEY : '') || '';
  if (target.provider === 'upstage') key = env.UPSTAGE_API_KEY || (selected === 'upstage' ? env.AI_API_KEY : '') || '';
  if (target.provider === 'openai-compatible') key = selected === 'openai-compatible' ? env.AI_API_KEY || '' : '';
  return {
    configured: target.provider === 'openai-compatible' ? !!env.AI_API_BASE : !!key.trim(),
    // Only the requested provider gets its own key; never copy Google's key to Solar or a custom endpoint.
    env: {AI_PROVIDER: target.provider, AI_MODEL: target.model, AI_API_KEY: key,
      ...(target.provider === 'openai-compatible' ? {AI_API_BASE: env.AI_API_BASE} : {}),
      ...(env.AI_REASONING_EFFORT ? {AI_REASONING_EFFORT: env.AI_REASONING_EFFORT} : {}),
      ASK_DAILY_LIMIT: env.ASK_DAILY_LIMIT || '300'},
  };
}

export function checkTaskConditions(taskId, response) {
  const steps = response.steps || [];
  const features = response.map?.highlight?.features || [];
  const checks = {hasEvidence: Array.isArray(response.sources) && response.sources.length > 0};
  if (taskId === 'park-location') {
    checks.scopeAndCategory = steps.some(s => s.tool === 'find_facilities' && s.args?.dong === '풍암동' && s.args?.category === 'layer-parks');
    checks.hasMapResults = features.length > 0;
  } else if (taskId === 'school-shade-200m') {
    checks.scopeAndRadius = steps.some(s => s.tool === 'compare_nearby' && s.args?.dong === '풍암동' && s.args?.target === 'school' && s.args?.service === 'local-shade' && s.args?.radiusM === 200);
    checks.structuredResult = response.nearbyComparisons?.some(c => c.dongName === '풍암동' && c.radiusM === 200 && c.targets > 0 && Array.isArray(c.rows)) === true;
    checks.hasMapResults = features.length > 0;
  } else if (taskId === 'two-dong-schools') {
    checks.twoExplicitDongs = steps.some(s => s.tool === 'compare_dongs' && JSON.stringify([...(s.args?.dongs || [])].sort()) === JSON.stringify(['풍암동', '상무2동'].sort()) && s.args?.categories?.length === 1 && s.args.categories[0] === 'school');
  } else {
    checks.knownTask = false;
  }
  return checks;
}

export function evaluateResponse(target, task, response) {
  const conditionChecks = checkTaskConditions(task.id, response);
  const requestedModelMatched = response.provider === target.provider && response.model === target.model;
  return {
    passed: response.ok === true && response.mode === 'llm' && requestedModelMatched && Object.values(conditionChecks).every(Boolean),
    actualProvider: response.provider || null, actualModel: response.model || null,
    requestedModelMatched, modelRecovered: !!response.modelRecovered,
    mode: response.mode || null, code: response.code || null, conditionChecks,
  };
}

function parseArgs(args) {
  const targets = [];
  let out = resolve(root, 'outputs/model-validation.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {out = resolve(args[++i]); continue;}
    if (args[i] !== '--target' || !args[i + 1]) throw new Error('사용법: node scripts/validate-models.mjs --target google:실제모델ID --target upstage:실제모델ID [--out 결과.json]');
    const match = /^(google|upstage|solar|openai-compatible):([A-Za-z0-9][A-Za-z0-9._/-]{0,119})$/.exec(args[++i]);
    if (!match || match[2].includes('..')) throw new Error('모델 공급자와 실제 모델 ID를 확인하세요.');
    const target = {provider: normalizedProvider(match[1]), model: match[2]};
    if (targets.some(t => t.provider === target.provider && t.model === target.model)) throw new Error('같은 모델은 두 번 검증 대상으로 세지 않습니다.');
    targets.push(target);
  }
  if (targets.length < 2 || targets.length > 4) throw new Error('비교할 실제 모델 2~4개를 --target으로 명시하세요.');
  return {targets, out};
}

export async function runModelValidation({targets, env = process.env}) {
  const records = [];
  const startedAt = new Date().toISOString();
  for (const target of targets) {
    const configured = targetEnvironment(target, env);
    for (const task of MODEL_TASKS) {
      if (!configured.configured) {
        records.push({...target, taskId: task.id, question: task.question, status: 'not-configured', passed: false, mode: null, elapsedMs: null});
        continue;
      }
      const began = performance.now();
      try {
        const response = await answerQuestion({question: task.question, dong: null, previousQuestions: []}, {env: configured.env});
        records.push({...target, taskId: task.id, question: task.question, status: 'executed', elapsedMs: Math.round(performance.now() - began),
          ...evaluateResponse(target, task, response), answer: response.answer, sources: response.sources,
          steps: response.steps, nearbyComparisons: response.nearbyComparisons || [],
          mapFeatureIds: (response.map?.highlight?.features || []).map(f => f.id || f.properties?.id)});
      } catch {
        // Never serialize a provider's raw error, URL, request headers, or credentials.
        records.push({...target, taskId: task.id, question: task.question, status: 'execution-error', passed: false, code: 'VALIDATION_EXECUTION_ERROR', elapsedMs: Math.round(performance.now() - began)});
      }
    }
  }
  const successfulTargets = targets.filter(t => {
    const group = records.filter(r => r.provider === t.provider && r.model === t.model);
    return group.length === MODEL_TASKS.length && group.every(r => r.passed);
  });
  const codeFiles = ['server/ai/ask.js', 'server/ai/rules.js', 'server/spatial/tools.js', 'server/ai/model-config.js', 'scripts/validate-models.mjs'];
  const executedTasks = records.filter(r => r.status !== 'not-configured').length;
  const report = {schema: 'seoguon-real-model-validation-v1', executionKind: 'real-model-validation',
    executionStatus: executedTasks ? 'completed' : 'not-executed',
    executedTasks, notConfiguredTasks: records.length - executedTasks, startedAt,
    finishedAt: new Date().toISOString(), appVersion: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
    codeSha256: Object.fromEntries(codeFiles.map(path => [path, sha(readFileSync(resolve(root, path)))])),
    note: '고정 공개자료 질문의 실모델 검증 기록입니다. not-configured는 미실행이며 외부 호출 결과가 아닙니다. 미설정·규칙대체·다른 모델 자동복구는 요청 모델 성공으로 세지 않습니다. 지연은 이 실행의 관찰값이며 직원 업무효과 실측이 아닙니다.',
    targets, records, successfulTargets, twoModelVerificationPassed: successfulTargets.length >= 2};
  const secrets = [...new Set(['GEMINI_API_KEY', 'UPSTAGE_API_KEY', 'AI_API_KEY'].map(k => env[k]).filter(v => typeof v === 'string' && v.length >= 8))];
  return JSON.parse(JSON.stringify(report, (_key, value) => typeof value === 'string' ? secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value) : value));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {targets, out} = parseArgs(process.argv.slice(2));
    const report = await runModelValidation({targets});
    mkdirSync(dirname(out), {recursive: true});
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({output: out, successfulTargets: report.successfulTargets, twoModelVerificationPassed: report.twoModelVerificationPassed,
      records: report.records.map(r => ({provider: r.provider, model: r.model, taskId: r.taskId, status: r.status, passed: r.passed, mode: r.mode, code: r.code}))}, null, 2));
    if (!report.twoModelVerificationPassed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
