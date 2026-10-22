import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace, seedAssets, recordObservation, upsertScenario, compareWorkspace, saveSnapshot} from '../shared/space-twin-model.js';
import {spaceComparisonHtml, spaceReportHtml, sameSpaceComparison, installSpaceTwin} from '../src/city/space-twin.js';
import {runRegisteredAction} from '../src/city/actions.js';

const now = '2026-10-22T00:00:00.000Z';
const collection = {type: 'FeatureCollection', features: [1, 2].map(id => ({type: 'Feature', geometry: {type: 'Point', coordinates: [126.86 + id / 1000, 35.15]}, properties: {id: `room-${id}`, name: `공공 회의실 ${id}`, address: '검증용 주소', dongId: 'fixture-dong', sourceName: '검증용 공개자료', sourceUrl: 'https://example.org/facilities', sourceDate: '2026-10-01', hours: '월요일 09:00~18:00'}}))};
const assets = seedAssets(collection, {regionId: 'fixture', datasetId: 'rooms'});
const query = {dayOfWeek: 1, start: '18:00', end: '21:00', assetIds: assets.map(asset => asset.id)};
const observation = {operatingStatus: 'open', daysOfWeek: [1], opens: '09:00', closes: '18:00', observedOn: '2026-10-01', evidence: '현장 기록 A'};
const compare = workspace => compareWorkspace({assets, workspace, query, now});

test('unknown observations and unpriced assumptions are not presented as measured improvements or zero cost', () => {
  let workspace = createWorkspace('fixture', {now});
  workspace = upsertScenario(workspace, {name: '월요일 저녁 개방', changes: [{assetId: assets[0].id, operatingStatus: 'open', daysOfWeek: [1], opens: '18:00', closes: '21:00', additionalAnnualCost: null}]}, {now});
  const comparison = compare(workspace);
  const html = spaceComparisonHtml(comparison);
  assert.equal(comparison.baseline.unknownCount, 2);
  assert.equal(comparison.alternatives[0].additionalAnnualCost, null);
  assert.match(html, /운영 조건 미확인/);
  assert.match(html, /미산정/);
  assert.match(html, /개선량 판정을 보류/);
  assert.match(html, /요청 시간 개방 조건 충족/);
  assert.doesNotMatch(html, /0만원|요청 시간 전체 이용 가능/);
});

test('historical report uses the saved comparison instead of current observations or scenario edits', () => {
  let workspace = createWorkspace('fixture', {now});
  workspace = recordObservation(workspace, assets[0].id, observation, {now});
  workspace = upsertScenario(workspace, {name: '저장 당시 대안', changes: [{assetId: assets[0].id, operatingStatus: 'open', daysOfWeek: [1], opens: '18:00', closes: '21:00', additionalAnnualCost: 12}]}, {now});
  const comparison = compare(workspace);
  workspace = saveSnapshot(workspace, comparison, {now});
  workspace = recordObservation(workspace, assets[0].id, {...observation, closes: '21:00', evidence: '나중에 바뀐 현장 기록'}, {now: '2026-10-22T01:00:00.000Z'});
  workspace = upsertScenario(workspace, {...workspace.scenarios[0], name: '나중에 바뀐 대안'}, {now});
  const html = spaceReportHtml({profile: {name: '검증 지역'}, assets: assets.map(asset => ({...asset, name: '현재 데이터 이름'})), workspace, comparison: workspace.snapshots[0].comparison});
  assert.match(html, /현장 기록 A/);
  assert.match(html, /저장 당시 대안/);
  assert.match(html, /12만원/);
  assert.match(html, /공공 회의실 1/);
  assert.match(html, new RegExp(`현황 기록 버전 ${comparison.workspaceRevision}`));
  assert.doesNotMatch(html, /나중에 바뀐 현장 기록|나중에 바뀐 대안|현재 데이터 이름/);
});

test('downloaded report escapes free text and refuses executable source URLs', () => {
  const comparison = structuredClone(compare(createWorkspace('fixture', {now})));
  comparison.baseline.rows[0].name = '<img src=x onerror=alert(1)>';
  comparison.baseline.rows[0].evidence = '</td><script>alert(1)</script>';
  comparison.sources[0].url = 'javascript:alert(1)';
  const html = spaceReportHtml({profile: {name: '<script>region</script>'}, comparison, ai: {mode: 'llm', answer: '<svg onload=alert(1)>'}});
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;svg/);
  assert.match(html, /원자료 링크 미제공/);
  assert.doesNotMatch(html, /<script>|<img|<svg|href="javascript:/);
  assert.match(html, /default-src 'none'/);
});

test('server comparison must match displayed facts even when bookkeeping differs', () => {
  const comparison = compare(createWorkspace('fixture', {now}));
  assert.equal(sameSpaceComparison(comparison, {...comparison, generatedAt: '2026-10-22T00:10:00.000Z', workspaceRevision: 99, fingerprint: 'different-bookkeeping'}), true);
  assert.equal(sameSpaceComparison(comparison, {...comparison, assetFingerprint: 'different-public-data'}), false);
  assert.equal(sameSpaceComparison(comparison, {...comparison, query: {...comparison.query, end: '22:00'}}), false);
  assert.equal(sameSpaceComparison(comparison, {...comparison, baseline: {...comparison.baseline, unknownCount: 0}}), false);
  assert.equal(sameSpaceComparison(comparison, null), false);
});

test('actual UI action preserves other map layers and saves a dated field observation through the model', async () => {
  const originals = new Map(['document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), nodes = new Map(), saved = new Map(), toasts = [];
  const root = {addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), querySelectorAll: selector => selector.includes('space-observation') ? [{value: '1'}] : []};
  nodes.set('app', root);
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {getElementById: id => nodes.get(id) || null}});
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value)}});
  const state = {view: null, dong: 'all', enabled: new Set(['parks']), entries: new Map([['parks', {features: []}]])};
  let html = '', ui;
  const api = {state, label: () => '검증 지역', show: (title, body, view) => {html = body; state.view = view;}, toast: message => toasts.push(message), drawData() {}};
  try {
    ui = installSpaceTwin(api, {getRegion: () => ({id: 'fixture', name: '검증 지역', facilityLayerId: 'rooms'}), loadAssets: async () => collection});
    await ui.open();
    assert.equal(state.enabled.has('parks'), true);
    assert.equal(state.entries.get('space-twin-candidates').features[0].properties.id, assets[0].id);
    await runRegisteredAction({dataset: {action: 'space-toggle', id: assets[0].id}}, api);
    await runRegisteredAction({dataset: {action: 'space-step', step: 'state'}}, api);
    for (const [id, value] of Object.entries({'space-observation-form': '', 'space-observation-status': 'open', 'space-observation-opens': '09:00', 'space-observation-closes': '18:00', 'space-observation-date': '2026-10-01', 'space-observation-valid': '', 'space-observation-evidence': '현장 기록 UI'})) nodes.set(id, {value});
    listeners.get('submit')({target: {id: 'space-observation-form'}, preventDefault() {}});
    const stored = JSON.parse(saved.get('seoon.space-twin.v1.fixture'));
    assert.equal(stored.observations[assets[0].id].evidence, '현장 기록 UI');
    assert.equal(stored.observations[assets[0].id].validUntil, null);
    assert.equal(stored.history.length, 1);
    assert.match(toasts.at(-1), /현황과 변경 이력/);
    assert.match(html, /현장 기록 UI/);
    ui.destroy(); ui = null;
    assert.equal(state.enabled.has('parks'), true);
    assert.equal(state.enabled.has('space-twin-candidates'), false);
  } finally {
    ui?.destroy();
    for (const [key, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
