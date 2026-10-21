import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerAction,runRegisteredAction,hasAction} from '../src/city/actions.js';
import {explainFailure,failureTooltip,DIAGNOSTIC_REASONS} from '../src/city/live-diagnostics.js';
import {DIAGNOSTIC_CODES} from '../server/diagnostics.js';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const actionsIn = fragment => [...fragment.matchAll(/<button[^>]*data-action="([^"]+)"[^>]*>/g)].map(m => ({action: m[1], hidden: /\shidden(\s|>)/.test(m[0]), tag: m[0]}));
const regions = html.slice(html.indexOf('<section id="sidebar-regions"'), html.indexOf('<section id="sidebar-layers"'));
const primary = regions.slice(regions.indexOf('<div class="home-primary"'), regions.indexOf('<div class="home-workflows"'));
const more = regions.slice(regions.indexOf('<div class="home-more-list"'), regions.indexOf('id="dong-tour"'));

test('dong navigation: all 18 dong are before scenario actions, with compact brand tiles', () => {
  assert.ok(html.indexOf('id="dong-grid"') < html.indexOf('class="home-primary"'));
  const css = read('src/city/layout.css');
  assert.ok(css.includes('#sidebar-regions .dong-grid { grid-template-columns: repeat(4,'));
  assert.ok(css.includes('#sidebar-regions .dong-button img { display: block; width: 29px'));
  assert.ok(!html.includes('상습결빙구간 · 서구 관리지점 보기'));
});

test('home panel: civic review and quick questions follow the dong choice; seasonal plans remain reachable', () => {
  assert.deepEqual(actionsIn(primary).map(b => b.action), ['civic-review', 'ask-ai', 'infra', 'resilience']);
  assert.ok(primary.includes('마을·공간 검토'));
  assert.ok(primary.includes('지도에게 묻기'));
  const workflows = regions.slice(regions.indexOf('<div class="home-workflows"'), regions.indexOf('<div class="home-more"'));
  const available = new Set(actionsIn(workflows).map(button => button.action));
  for (const action of ['heat-plan', 'cold-plan', 'icing-plan', 'flood-plan', 'school-plan']) assert.ok(available.has(action), action);
});

test('home panel: secondary tools remain reachable in the folded group', () => {
  const reachable = new Set([...actionsIn(primary), ...actionsIn(more)].map(b => b.action));
  for (const action of ['infra', 'safety-hub', 'native-sun', 'resilience', 'themes', 'city-questions', 'list', 'tools', 'report']) assert.ok(reachable.has(action), action);
  assert.ok(reachable.has('settings'));
  assert.ok(reachable.has('civic-notes'));
  assert.ok(html.includes('id="home-more-toggle" aria-expanded="false"'));
  assert.ok(read('src/city/layout.css').includes('.home-more:not(.open) .home-more-list { display: none; }'));
});

test('home panel: all data-action names used in index.html keep a handler somewhere in src/city', () => {
  const sources = fs.readdirSync(new URL('../src/city/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => read('src/city/' + f)).join('\n');
  const names = new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(new RegExp(`case\\s*['"]${escaped}['"]\\s*:`).test(sources) || new RegExp(`registerAction\\(\\s*['"]${escaped}['"]`).test(sources), `no handler for ${name}`);
  }
});

test('action registry: registered handlers run first and can decline', async () => {
  const seen = [];
  const off = registerAction('test-only-action', (button, api) => { seen.push([button.dataset.id, api.tag]); });
  assert.equal(hasAction('test-only-action'), true);
  assert.equal(await runRegisteredAction({dataset: {action: 'test-only-action', id: '7'}}, {tag: 'api'}), true);
  assert.deepEqual(seen, [['7', 'api']]);
  assert.equal(await runRegisteredAction({dataset: {action: 'unknown-action'}}, {}), false);
  const decline = registerAction('test-only-decline', () => false);
  assert.equal(await runRegisteredAction({dataset: {action: 'test-only-decline'}}, {}), false);
  off(); decline();
  assert.equal(hasAction('test-only-action'), false);
  assert.throws(() => registerAction('', () => {}));
});

test('app wiring: registry runs before the built-in switch and modules receive the shared api', () => {
  const app = read('src/city/app.js');
  assert.match(app, /async function action\(button\)\{if\(await runRegisteredAction\(button,api\)\)return;/);
  assert.match(app, /const api=\{state,show,close,/);
  assert.match(app, /installHeatScenario\(api\)/);
  assert.match(app, /확장 모듈 등록 위치/);
});

test('live diagnostics: every server code has a Korean reason and an owner hint', () => {
  for (const code of Object.keys(DIAGNOSTIC_CODES)) {
    const info = explainFailure({code, stage: 'measurement', status: DIAGNOSTIC_CODES[code].status});
    assert.equal(info.code, code); assert.match(info.reason, /[가-힣]/); assert.ok(info.hint.length > 10);
  }
  assert.ok(DIAGNOSTIC_REASONS.UNKNOWN);
});

test('live diagnostics: tooltip names the stage and code, and hints name the variable or portal API', () => {
  const missing = explainFailure({code: 'NOT_CONFIGURED', stage: 'station-list', status: 503});
  assert.equal(failureTooltip(missing), '미수신 · 에어코리아 측정소정보 · 인증키 미설정 (NOT_CONFIGURED)');
  assert.match(missing.hint, /AIRKOREA_SERVICE_KEY/);
  assert.match(explainFailure({code: 'ACCESS_DENIED', stage: 'measurement'}).hint, /에어코리아_대기오염정보/);
  assert.equal(explainFailure({name: 'TimeoutError'}, 'weather').code, 'CLIENT_TIMEOUT');
  assert.equal(explainFailure({message: 'anything'}, 'weather').code, 'UNKNOWN');
  assert.equal(explainFailure(null), null);
});

test('live diagnostics: UI text never contains a key value or an upstream URL', () => {
  const text = JSON.stringify(DIAGNOSTIC_REASONS) + read('src/city/live-status.js');
  assert.doesNotMatch(text, /serviceKey=|apis\.data\.go\.kr/);
  assert.match(read('src/city/live-status.js'), /'미수신'/);
  assert.match(read('src/city/live-status.js'), /'미관측'/);
});

test('live ribbon: readings open the diagnostics panel', () => {
  const ribbon = html.match(/<section class="live-ribbon"[\s\S]*?<\/section>/)[0];
  assert.equal((ribbon.match(/data-action="live-detail"/g) || []).length, 2);
  for (const id of ['live-temperature', 'live-rainfall', 'live-safety', 'live-observed']) assert.match(ribbon, new RegExp(`id="${id}"`));
});

test('dong navigation: village BI and names remain without map numbers or a number legend', () => {
  const app = read('src/city/app.js');
  assert.match(app, /<img src="\/brand\/dongs\/\$\{f.properties.dongId\}.png"/);
  assert.match(app, /<span>\$\{esc\(f.properties.dongName\)\}<\/span>/);
  assert.doesNotMatch(html + app, /dong-legend|dong-no|dongNumber|번호표/);
});

test('responsive: compact breakpoint is the same in CSS and JS', () => {
  const js = read('src/city/home-panel.js'), css = read('src/city/layout.css');
  const width = Number(js.match(/COMPACT_WIDTH = (\d+)/)[1]);
  assert.equal(width, 820);
  assert.ok(css.includes(`@media (max-width: ${width}px)`));
  assert.ok(css.includes(`@media (min-width: ${width + 1}px)`));
  assert.match(html, /href="\/src\/city\/layout\.css"/);
});
