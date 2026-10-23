import test from 'node:test';
import assert from 'node:assert/strict';
import {answerHtml, panelHtml, installAskAi} from '../src/city/ask-ai.js';
import {runRegisteredAction} from '../src/city/actions.js';

const result = {ok: true, mode: 'llm', answer: '원자료에 수록된 공간을 선택했습니다.', analysisPath: 'region-grounded-selection', model: 'test-model', sources: [{name: '지역 개방 공간', dateRange: {min: '2026-09-01', max: '2026-10-01'}, url: 'https://example.org/spaces'}], steps: [{tool: 'find_facilities', summary: '구역 내 수록 5개 · 검토 후보 2개', ok: true}], map: {highlight: {type: 'FeatureCollection', features: []}}};

test('first result presents retrieval facts, missing conditions, action and source dates before folded details', () => {
  const html = answerHtml({status: 'done', question: '토요일 모임 공간', regionId: 'suncheon', regionName: '순천시', queryScope: '왕조1동', result, features: []});
  for (const value of ['자료로 확인한 사실', '아직 확인할 핵심', '다음 행동', '이 조건으로 비교 준비', '2026-09-01–2026-10-01', 'AI가 현재 지역의 수록 공간']) assert.ok(html.includes(value), value);
  assert.ok(html.indexOf('이 조건으로 비교 준비') < html.indexOf('AI 설명 전체'));
  assert.match(html, /<details class="ask-evidence ask-details"/);
  assert.doesNotMatch(html, /data-action="civic-save-result"/);
  const panel = panelHtml({status: 'idle', regionId: 'suncheon'}, '순천시 전체');
  assert.match(panel, /장천동/);
  assert.doesNotMatch(panel, /data-action="civic-(?:review|notes)"|풍암동/);
});

test('a failed Suncheon question can be retried verbatim and forwarded to comparison with the current region', async () => {
  const originals = new Map(['document', 'fetch', 'innerWidth'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const nodes = new Map(), bodies = [], actions = [], toasts = [];
  nodes.set('app', {addEventListener() {}, removeEventListener() {}});
  nodes.set('ask-quick-question', {value: ''});
  nodes.set('ask-quick-submit', {});
  const state = {view: null, dong: 'all', dongs: [], scope: {type: 'Polygon', coordinates: []}, regionProfile: {id: 'suncheon', name: '순천시', capabilities: {legacySeoguServices: false}}, entries: new Map(), enabled: new Set(), ready: false};
  const api = {state, label: () => '순천시 전체', show: (title, html, view) => {state.view = view;}, toast: value => toasts.push(value), drawData() {}, scoped: () => [], run: (action, dataset) => actions.push({action, dataset})};
  let ui;
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {getElementById: id => nodes.get(id) || null, querySelector: () => null}});
  Object.defineProperty(globalThis, 'innerWidth', {configurable: true, value: 1366});
  Object.defineProperty(globalThis, 'fetch', {configurable: true, value: async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1 ? {ok: false, status: 429, json: async () => ({error: '요청 확인 필요'})} : {ok: true, json: async () => result};
  }});
  try {
    ui = installAskAi(api);
    const question = '왕조1동 토요일 10~12시 주민 모임 공간을 검토해줘';
    await ui.ask(question);
    assert.equal(bodies.length, 1, 'Suncheon quick asking must no longer be blocked as a legacy service');
    assert.equal(bodies[0].regionId, 'suncheon');
    await runRegisteredAction({dataset: {action: 'ask-retry'}}, api);
    assert.equal(bodies[1].question, question);
    assert.equal(bodies[1].regionId, 'suncheon');
    await runRegisteredAction({dataset: {action: 'ask-prepare-space'}}, api);
    assert.deepEqual(actions[0], {action: 'space-from-question', dataset: {question, regionId: 'suncheon', dongId: 'all'}});
    assert.equal(nodes.get('ask-quick-submit').disabled, false);
    assert.equal(toasts.length, 0);
  } finally {
    ui?.destroy();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});

test('loading reports only the observable pending request and error includes same-question recovery', () => {
  assert.match(answerHtml({status: 'loading'}), /자료 조회와 AI 응답을 기다리고/);
  assert.doesNotMatch(answerHtml({status: 'loading'}), /분석 → 근거 확인/);
  const html = answerHtml({status: 'error', question: '토요일 10~12시 모임 공간', error: '연결 확인 필요'});
  assert.match(html, /data-action="ask-retry"/);
  assert.match(html, /data-action="ask-prepare-space"/);
});

test('unsupported data or another region leads to scope guidance, not a misleading comparison draft', () => {
  for (const [status, action] of [['unsupported-domain', 'region-info'], ['different-region', 'region-chooser']]) {
    const view = {status: 'done', question: '다른 분야 자료를 알려줘', regionId: 'suncheon', result: {...result, structured: {queryStatus: status}}, features: []};
    const html = answerHtml(view);
    assert.ok(html.includes(`data-action="${action}"`));
    assert.doesNotMatch(html, /data-action="ask-prepare-space"|이 조건으로 비교 준비/);
    assert.doesNotMatch(panelHtml(view, '순천 전체'), /data-action="ask-prepare-space"/);
  }
});
