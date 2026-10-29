import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_TASKS, targetEnvironment, evaluateResponse} from '../scripts/validate-models.mjs';

const target = {provider: 'google', model: 'configured-model'};
const park = {ok: true, mode: 'llm', provider: 'google', model: 'configured-model',
  sources: [{name: '공개 공원자료'}], steps: [{tool: 'find_facilities', args: {dong: '풍암동', category: 'layer-parks'}}],
  map: {highlight: {features: [{id: 'park-1'}]}}};

test('real-model report never counts fallback, a recovered different model, or wrong geographic scope as requested-model success', () => {
  assert.equal(evaluateResponse(target, MODEL_TASKS[0], park).passed, true);
  for (const changes of [
    {mode: 'rules'}, {model: 'other-model', modelRecovered: true}, {sources: []},
    {steps: [{tool: 'find_facilities', args: {dong: '상무2동', category: 'layer-parks'}}]},
    {map: {highlight: {features: []}}},
  ]) assert.equal(evaluateResponse(target, MODEL_TASKS[0], {...park, ...changes}).passed, false);
});

test('model environment isolates provider keys and leaves the production configuration unchanged', () => {
  const env = {AI_PROVIDER: 'google', AI_API_KEY: 'google-only-example', UPSTAGE_API_KEY: 'solar-only-example', AI_API_BASE: 'https://example.invalid/v1'};
  const before = {...env};
  assert.equal(targetEnvironment(target, env).env.AI_API_KEY, 'google-only-example');
  assert.equal(targetEnvironment({provider: 'upstage', model: 'solar'}, env).env.AI_API_KEY, 'solar-only-example');
  assert.equal(targetEnvironment({provider: 'upstage', model: 'solar'}, {...env, UPSTAGE_API_KEY: ''}).configured, false);
  assert.equal(targetEnvironment({provider: 'openai-compatible', model: 'local'}, env).env.AI_API_KEY, '');
  assert.deepEqual(env, before);
});

test('model report checks the requested radius and two-dong scope in computed tool arguments', () => {
  const response = {...park, steps: [{tool: 'compare_nearby', args: {dong: '풍암동', target: 'school', service: 'local-shade', radiusM: 200}}],
    nearbyComparisons: [{dongName: '풍암동', radiusM: 200, targets: 2, rows: [{id: 'school-1'}]}]};
  assert.equal(evaluateResponse(target, MODEL_TASKS[1], response).passed, true);
  assert.equal(evaluateResponse(target, MODEL_TASKS[1], {...response, steps: [{tool: 'compare_dongs', args: {categories: ['school', 'local-shade']}}]}).passed, false);
  const comparison = {...park, steps: [{tool: 'compare_dongs', args: {categories: ['school'], dongs: ['풍암동', '상무2동']}}]};
  assert.equal(evaluateResponse(target, MODEL_TASKS[2], comparison).passed, true);
  assert.equal(evaluateResponse(target, MODEL_TASKS[2], {...comparison, steps: [{tool: 'compare_dongs', args: {categories: ['school']}}]}).passed, false);
});
