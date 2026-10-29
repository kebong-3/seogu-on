import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assignCollectionDongs} from '../scripts/data/assign-dongs.mjs';
import {loadDongIndex, locate} from '../scripts/data/lib/geo.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const polygon = (west, east) => ({rings: [[[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]]], bounds: [west, 0, east, 1]});
const index = {bounds: [0, 0, 2, 1], dongs: [
  {dongId: 'a', dongName: 'A동', polygons: [polygon(0, 1)]},
  {dongId: 'b', dongName: 'B동', polygons: [polygon(1, 2)]},
]};
const point = (coordinates, properties = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates}, properties});

test('generated collection dong assignment preserves uncertainty and leaves ambiguous/outside points unresolved', () => {
  const collection = {type: 'FeatureCollection', metadata: {regionId: 'seogu'}, features: [
    point([0.5, 0.5], {routeEligible: false, uncertaintyMeters: 45, coordinateAuthority: 'image-georeferenced-not-official'}),
    point([1, 0.5]), point([3, 0.5]), point([0.2, 0.2], {dongName: '다른동'}),
  ]};
  const before = structuredClone(collection);
  assert.deepEqual(assignCollectionDongs(collection, index), {assigned: 1, mismatched: 1});
  assert.deepEqual(collection.features[0].properties, {...before.features[0].properties, dongId: 'a', dongName: 'A동'});
  assert.deepEqual(collection.features.map(f => f.geometry), before.features.map(f => f.geometry));
  assert.deepEqual(collection.features.slice(1), before.features.slice(1));
  assert.deepEqual(assignCollectionDongs(collection, index), {assigned: 0, mismatched: 1});
  assert.throws(() => assignCollectionDongs({...collection, metadata: {regionId: 'suncheon'}}, index), /다른 지역/);
});

test('the documented image-route generator keeps all 68 symbols assigned without altering route geometry or reference-only status', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seogu-route-rebuild-'));
  try {
    const output = join(directory, 'routes.geojson');
    execFileSync('python3', ['scripts/data/build-safe-return-image-routes.py', 'scripts/data/safe-return-georeference-controls.json', output], {
      cwd: root, env: {...process.env, NODE_BINARY: process.execPath}, stdio: 'pipe', timeout: 30000,
    });
    const actual = JSON.parse(readFileSync(output, 'utf8'));
    const expected = read('public/data/walk/seogu/safe-return-image-routes.geojson');
    assert.deepEqual(actual, expected, 'regeneration must reproduce the committed reference collection');
    const symbols = actual.features.filter(f => f.geometry.type === 'Point');
    assert.equal(symbols.length, 68);
    const dongs = loadDongIndex(root);
    for (const feature of symbols) {
      const place = locate(dongs, ...feature.geometry.coordinates);
      assert.equal(feature.properties.dongId, place.dongId);
      assert.equal(feature.properties.dongName, place.dongName);
      assert.equal(feature.properties.routeEligible, false);
      assert.equal(feature.properties.coordinateAuthority, 'image-georeferenced-not-official');
      assert.equal(feature.properties.operatingStatus, 'not-verified');
      assert.ok(feature.properties.uncertaintyMeters > 0);
    }
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
