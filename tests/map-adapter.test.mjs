// Tests the adapter against a minimal MapLibre 5-style interface. Not a WebGL or network test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityMap } from '../src/map.js';
import { makeDemoData } from '../src/data.js';

class FakeMap {
  constructor(options) { this.options = options; this.sources = new Map(); this.layers = []; this.handlers = {}; this.layout = {}; }
  addControl() {}
  once(type, callback) { if (type === 'load') this.onload = callback; }
  on() {}
  addSource(id, options) { this.sources.set(id, { ...options, setData(data) { this.data = data; } }); }
  addLayer(layer) { this.layers.push(layer); }
  getSource(id) { return this.sources.get(id); }
  setLayoutProperty(id, name, value) { this.layout[`${id}:${name}`] = value; }
  remove() { this.removed = true; }
}
function setup(t) {
  const original = { window: globalThis.window, fetch: globalThis.fetch };
  // Deliberately no `supported` member: MapLibre 5.6.1's actual public exports do not include it.
  globalThis.window = { maplibregl: { Map: FakeMap, AttributionControl: class {}, ScaleControl: class {} },
    addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async () => new Response(JSON.stringify({ version: 8, sources: {}, layers: [] }));
  const statuses = [];
  const adapter = new CityMap({ replaceChildren() {} }, { status: (...args) => statuses.push(args), select() {}, click() {} });
  t.after(() => { adapter.destroy(); globalThis.window = original.window; globalThis.fetch = original.fetch; });
  return { adapter, statuses };
}
test('map adapter starts against a MapLibre interface without obsolete supported()', async t => {
  const { adapter, statuses } = setup(t);
  await adapter.start('maplibre', 'dark');
  assert.ok(adapter.map instanceof FakeMap);
  adapter.map.onload();
  assert.equal(adapter.ready, true);
  assert.equal(statuses.at(-1)[0], 'connected');
  assert.deepEqual(adapter.map.options.center, [126.859, 35.151]);
  assert.equal(adapter.map.getSource('seo-buildings').url, 'https://tiles.openfreemap.org/planet');
});
test('map adapter links filtered facilities and layer visibility to its sources', async t => {
  const { adapter } = setup(t);
  await adapter.start('maplibre', 'light'); adapter.map.onload();
  const facilities = makeDemoData().facilities.features.slice(0, 3);
  adapter.update(facilities, [], { month: '2026-07', selectedId: facilities[0].properties.id,
    is3D: true, radiusCenter: [126.859, 35.151], radiusMeters: 500,
    layers: { buildings: true, facilities: true, columns: true, projects: false } });
  assert.equal(adapter.map.getSource('facilities').data.features.length, 3);
  assert.equal(adapter.map.getSource('radius').data.features.length, 1);
  assert.equal(adapter.map.layout['project-lines:visibility'], 'none');
  assert.equal(adapter.map.layout['metric-columns:visibility'], 'visible');
});
