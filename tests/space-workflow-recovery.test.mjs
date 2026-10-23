import test from 'node:test';
import assert from 'node:assert/strict';
import {installSpaceTwin, spaceReportHtml} from '../src/city/space-twin.js';
import {runRegisteredAction} from '../src/city/actions.js';
import {seedAssets, createWorkspace, compareWorkspace, spaceComparisonFingerprint} from '../shared/space-twin-model.js';
import {spaceRulesSummary} from '../shared/space-review-evidence.js';

const collection = {type: 'FeatureCollection', features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [127.5, 34.95]}, properties: {id: 'room-a', name: '검증 회의실', dongId: 'fixture-dong', hours: '운영조건 확인 필요', sourceName: '검증자료', sourceDate: '2026-10-01', sourceUrl: 'https://example.org/source'}}]};
const profile = {id: 'fixture', name: '검증 지역', facilityLayerId: 'rooms'};
const assets = seedAssets(collection, {regionId: profile.id, datasetId: profile.facilityLayerId});

async function withUi(fn) {
  const originals = new Map(['document', 'localStorage', 'sessionStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), nodes = new Map(), saved = new Map(), drafts = new Map(), toasts = [];
  let html = '', ui, failSave = false, currentProfile = profile;
  const root = {addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name), querySelectorAll: selector => selector.includes('space-observation') ? [{value: '6'}] : []};
  nodes.set('app', root);
  const state = {view: null, dong: 'all', enabled: new Set(), entries: new Map()};
  const api = {state, label: () => currentProfile.name, toast: message => toasts.push(message), drawData() {}, show(title, body, view) {html = body; state.view = view; for (const key of nodes.keys()) if (key !== 'app') nodes.delete(key);}};
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {getElementById: id => nodes.get(id) || null}});
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: key => saved.get(key) || null, setItem: (key, value) => {if (failSave) throw Error('quota'); saved.set(key, value);}}});
  Object.defineProperty(globalThis, 'sessionStorage', {configurable: true, value: {getItem: key => drafts.get(key) || null, setItem: (key, value) => drafts.set(key, value)}});
  const mount = async () => {ui = installSpaceTwin(api, {getRegion: () => currentProfile, loadAssets: async () => collection}); await ui.open();};
  const act = (action, dataset = {}) => runRegisteredAction({dataset: {action, ...dataset}}, api);
  const fillObservation = evidence => {
    for (const [id, value] of Object.entries({'space-observation-form': '', 'space-observation-status': 'open', 'space-observation-opens': '10:00', 'space-observation-closes': '12:00', 'space-observation-date': '2026-10-01', 'space-observation-valid': '', 'space-observation-evidence': evidence})) nodes.set(id, {value});
  };
  try {
    await mount();
    await fn({act, nodes, saved, drafts, toasts, listeners, api, fillObservation, html: () => html, setSaveFailure: value => {failSave = value;}, restart: async region => {ui.destroy(); currentProfile = region || profile; await mount();}});
  } finally {
    ui?.destroy();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
}

test('the question handoff is a draft until confirmed and the actual calculation retains Saturday 10–12', async () => withUi(async ({act, drafts, html, nodes, listeners}) => {
  await act('space-from-question', {question: '토요일 10시부터 12시까지 주민 모임 공간을 검토해줘', regionId: 'fixture'});
  assert.match(html(), /확인 전 초안/);
  assert.equal(JSON.parse(drafts.get('seoon.space-twin.draft.v1.fixture')).query.dayOfWeek, null);
  await act('space-apply-query-draft');
  await act('space-toggle', {id: assets[0].id});
  await act('space-step', {step: 'compare'});
  assert.match(html(), /<option value="6" selected>토요일/);
  assert.match(html(), /id="space-query-start"[^>]*value="10:00"/);
  assert.match(html(), /id="space-query-end"[^>]*value="12:00"/);
  listeners.get('submit')({target: {id: 'space-query-form'}, preventDefault() {}});
  assert.match(html(), /토요일 10:00–12:00/);
  assert.doesNotMatch(html(), /월요일 18:00–21:00/);
  await act('space-from-question', {question: '주말 10~12시 모임 공간', regionId: 'fixture'});
  await assert.rejects(act('space-apply-query-draft'), /요일/);
  await assert.rejects(act('space-from-question', {question: '토요일 10~12', regionId: 'another-region'}), /지역/);
}));

test('unsaved observations survive refresh as regional drafts and failed confirmation preserves their text', async () => withUi(async ({act, saved, drafts, html, listeners, fillObservation, restart, toasts, setSaveFailure}) => {
  await act('space-toggle', {id: assets[0].id});
  await act('space-step', {step: 'state'});
  fillObservation('저장하지 않은 현장 확인 초안');
  listeners.get('input')({target: {id: 'space-observation-evidence', closest: () => true}});
  assert.equal(saved.size, 0);
  assert.match(drafts.get('seoon.space-twin.draft.v1.fixture'), /저장하지 않은 현장 확인 초안/);
  await restart();
  assert.match(html(), /입력 초안을 복구/);
  assert.match(html(), /저장하지 않은 현장 확인 초안/);
  assert.equal(saved.size, 0, 'restoring a draft must not confirm the observation');
  fillObservation('저장하지 않은 현장 확인 초안');
  setSaveFailure(true);
  listeners.get('submit')({target: {id: 'space-observation-form'}, preventDefault() {}});
  assert.match(toasts.at(-1), /저장 완료를 확인하지 못했습니다/);
  assert.match(drafts.get('seoon.space-twin.draft.v1.fixture'), /저장하지 않은 현장 확인 초안/);
  assert.equal(saved.size, 0);
  await restart({...profile, id: 'other-region', name: '다른 검증 지역'});
  assert.doesNotMatch(html(), /저장하지 않은 현장 확인 초안/);
}));

test('saved comparison restores its original explanation without another model request and reissues it in the report', async () => withUi(async ({act, saved, html}) => {
  let calls = 0;
  Object.defineProperty(globalThis, 'fetch', {configurable: true, value: async (url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    const comparison = compareWorkspace({assets, workspace: createWorkspace('fixture'), query: body.query});
    return {ok: true, json: async () => ({ok: true, mode: 'rules', answer: spaceRulesSummary(comparison), comparison, comparisonFingerprint: spaceComparisonFingerprint(comparison), computedAt: comparison.generatedAt, evidenceId: 'space-0123456789abcdef0123', code: 'LLM_NOT_CONFIGURED'})};
  }});
  await act('space-from-question', {question: '토요일 10~12시 모임 공간', regionId: 'fixture'});
  await act('space-apply-query-draft');
  await act('space-toggle', {id: assets[0].id});
  await act('space-explain');
  await act('space-save-snapshot');
  const snapshot = JSON.parse(saved.get('seoon.space-twin.v1.fixture')).snapshots[0];
  assert.ok(snapshot.ai?.answer);
  await act('space-from-question', {question: '월요일 14~16시 모임 공간', regionId: 'fixture'});
  await act('space-restore-snapshot', {id: snapshot.id});
  assert.equal(calls, 1);
  assert.match(html(), /저장 당시 설명/);
  assert.match(html(), /최신 AI를 다시 호출하지 않습니다/);
  assert.match(html(), /토요일 10:00–12:00/);
  const report = spaceReportHtml({profile, comparison: snapshot.comparison, ai: snapshot.ai});
  assert.match(report, /space-0123456789abcdef0123/);
  assert.match(report, /설명 생성/);
  assert.ok(report.includes(snapshot.ai.answer));
}));
