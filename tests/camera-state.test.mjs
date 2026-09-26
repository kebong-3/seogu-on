import test from 'node:test';
import assert from 'node:assert/strict';
import { CityMap } from '../src/map.js';

// Only adapter state is tested here. These tests do not claim WebGL rendering.
const adapter = () => Object.assign(Object.create(CityMap.prototype), {
  ready: false, pendingCamera: { center: [126.85, 35.15], zoom: 16, bearing: 10, pitch: 62 },
});
test('2D tilt stays queued before the map SDK is ready', () => {
  const m = adapter(); m.set3D(false);
  assert.equal(m.pendingCamera.pitch, 0);
  assert.deepEqual(m.pendingCamera.center, [126.85, 35.15]);
  assert.equal(m.pendingCamera.zoom, 16);
});
test('3D tilt stays queued before the map SDK is ready', () => {
  const m = adapter(); m.set3D(true);
  assert.equal(m.pendingCamera.pitch, 57);
});
test('district viewport follows the 3D state instead of forcing 2D', () => {
  const m = adapter(); m.last = [[], [], { is3D: true }]; m.fitDong(null);
  assert.equal(m.pendingCamera.pitch, 57);
});
test('district viewport follows the 2D state', () => {
  const m = adapter(); m.last = [[], [], { is3D: false }]; m.fitDong(null);
  assert.equal(m.pendingCamera.pitch, 0);
});
