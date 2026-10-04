import test from 'node:test';
import assert from 'node:assert/strict';
import {HEAT_LAYERS,heatSummary} from '../src/city/heat-scenario.js';
import {LAYER_BY_ID} from '../src/city/catalog.js';

test('heat scenario: uses the shade, cooling-fog and heat-shelter layers that exist in the catalogue', () => {
  const ids = HEAT_LAYERS.map(l => l.id);
  for (const id of ['local-shade', 'local-cooling', 'sd-heat']) assert.ok(ids.includes(id), id);
  for (const id of ids) assert.ok(LAYER_BY_ID[id], `unknown layer ${id}`);
});

test('heat scenario: data that was not received is "미수신", never 0곳', () => {
  const entries = new Map([
    ['local-shade', {state: 'loaded', features: [1, 2, 3]}],
    ['local-cooling', {state: 'loaded', features: []}],
    ['heat', {state: 'unloaded', features: [], error: '갱신 실패'}]
  ]);
  const rows = heatSummary(HEAT_LAYERS, entries, id => entries.get(id)?.features?.length || 0);
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(by['local-shade'].text, '3곳');
  assert.equal(by['local-cooling'].text, '이 구역 확보자료 없음');
  assert.equal(by['sd-heat'].text, '미수신'); assert.equal(by['sd-heat'].received, false);
  assert.equal(by.heat.text, '미수신');
  assert.ok(rows.every(r => !/^0/.test(r.text)));
});
