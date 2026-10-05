import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planLabels,estimateTextWidth,labelFontPx} from '../src/city/label-layout.js';
import {createDongLabels3D} from '../src/city/dong-labels-3d.js';

const dongs = JSON.parse(fs.readFileSync(new URL('../public/data/admin-dongs.geojson', import.meta.url), 'utf8')).features;

/** 경계도와 같은 방식의 단순 투영: 서구 전체가 주어진 폭 안에 들어오게 한다. */
function overviewItems(width, height, mapWidth) {
  const points = dongs.map(f => f.properties.labelPoint);
  const lons = points.map(p => p[0]), lats = points.map(p => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const scale = mapWidth / (maxLon - minLon);
  return dongs.map(f => ({
    id: f.properties.dongId,
    name: f.properties.dongName,
    x: width / 2 - mapWidth / 2 + (f.properties.labelPoint[0] - minLon) * scale,
    y: height / 2 + ((maxLat + minLat) / 2 - f.properties.labelPoint[1]) * scale * 1.2
  }));
}

function assertNoOverlap(labels) {
  const boxes = labels.filter(l => l.box).map(l => l.box);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    assert.ok(apart, `labels ${i} and ${j} overlap`);
  }
}

test('label layout: Korean glyphs are estimated wider than digits', () => {
  assert.ok(estimateTextWidth('상무1동', 14) > estimateTextWidth('1234', 14));
  assert.ok(labelFontPx(360) < labelFontPx(1440));
});

for (const [width, height, mapWidth] of [[360, 740, 250], [414, 896, 300], [672, 900, 320], [1024, 768, 520], [1440, 900, 760]]) {
  test(`label layout: 18 dong labels never overlap at ${width}px overview`, () => {
    const plan = planLabels(overviewItems(width, height, mapWidth), {width, height});
    assert.equal(plan.labels.length, 18);
    assertNoOverlap(plan.labels);
    for (const label of plan.labels.filter(l => l.box)) {
      assert.ok(label.box.x >= 0 && label.box.y >= 0 && label.box.x + label.box.width <= width && label.box.y + label.box.height <= height);
    }
    // 혼잡한 이름은 확대할 때 다시 나타나며, 보이는 이름은 축약하거나 번호로 바꾸지 않는다.
    assert.ok(plan.counts.name > 0, JSON.stringify(plan.counts));
    assert.equal(plan.counts.name + plan.counts.hidden, 18);
    for (const [index, label] of plan.labels.entries()) {
      assert.ok(['name', 'hidden'].includes(label.mode));
      assert.equal(label.text, label.mode === 'name' ? dongs[index].properties.dongName : '');
    }
  });
}

test('label layout: piled-up anchors keep readable names and hide collisions', () => {
  const items = dongs.map((f, i) => ({id: f.properties.dongId, name: f.properties.dongName, x: 300 + (i % 6) * 9, y: 300 + Math.floor(i / 6) * 9}));
  const plan = planLabels(items, {width: 670, height: 700});
  assertNoOverlap(plan.labels);
  assert.ok(plan.counts.name < 18);
  assert.ok(plan.counts.hidden > 0);
  const zoomed = items.map((item, i) => ({...item, x: 80 + (i % 6) * 95, y: 240 + Math.floor(i / 6) * 95}));
  const zoomedPlan = planLabels(zoomed, {width: 670, height: 700});
  assertNoOverlap(zoomedPlan.labels);
  assert.equal(zoomedPlan.counts.name, 18, 'zooming into separated anchors restores all names');
});

test('label layout: the selected dong keeps its full name first', () => {
  const items = dongs.map((f, i) => ({id: f.properties.dongId, name: f.properties.dongName, x: 200, y: 200, priority: i === 9 ? 1 : 0}));
  const plan = planLabels(items, {width: 400, height: 400});
  assert.equal(plan.labels[9].mode, 'name');
  assert.equal(plan.labels[9].text, dongs[9].properties.dongName);
  assertNoOverlap(plan.labels);
  assert.deepEqual([plan.labels[9].dx, plan.labels[9].dy], [0, 0]);
});

test('label layout: anchors behind the camera or off screen are hidden instead of guessed', () => {
  const plan = planLabels([{id: 'a', name: '양동', x: NaN, y: 10}, {id: 'b', name: '풍암동', x: 5000, y: 5000}], {width: 400, height: 400});
  assert.deepEqual(plan.labels.map(l => l.mode), ['hidden', 'hidden']);
});

test('label layout: every engine uses the shared planner', () => {
  const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.match(read('src/city/viewer.js'), /planLabels\(items,\{width:w,height:h\}/);
  assert.match(read('src/city/viewer.js'), /createDomDongLabels/);
  assert.match(read('src/city/scene.js'), /createDongLabels3D/);
  assert.match(read('src/city/dong-labels-3d.js'), /planLabels\(/);
});

test('label layout: off-screen dongs do not displace visible names (dong close-up)', () => {
  const items = [
    {id: 'in-1', name: '치평동', x: 500, y: 400, priority: 1},
    {id: 'in-2', name: '유덕동', x: 800, y: 250},
    {id: 'in-3', name: '상무1동', x: 830, y: 540},
    {id: 'out-1', name: '양동', x: 2400, y: 300},
    {id: 'out-2', name: '풍암동', x: 700, y: 1900}
  ];
  const plan = planLabels(items, {width: 1076, height: 734});
  assert.deepEqual(plan.labels.map(l => l.mode), ['name', 'name', 'name', 'hidden', 'hidden']);
});

test('3D label fallback: unavailable screen coordinates show only the selected full name', () => {
  const entities = [];
  const C = {
    SceneTransforms: {},
    Color: {fromCssColorString: value => ({withAlpha: () => value})},
    Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
    Cartesian3: {fromDegrees: (lon, lat) => ({x: lon, y: lat, z: 0})},
    Cartographic: {fromDegrees: (lon, lat) => ({longitude: lon, latitude: lat})},
    HorizontalOrigin: {CENTER: 0}, VerticalOrigin: {CENTER: 0}, HeightReference: {CLAMP_TO_GROUND: 1, NONE: 0}
  };
  const viewer = {camera: {positionWC: {x: 1, y: 2, z: 3}, heading: 0, pitch: 0}, scene: {
    canvas: {clientWidth: 360, clientHeight: 740}, globe: {getHeight: () => 0},
    postRender: {addEventListener() {}, removeEventListener() {}}
  }};
  const source = {entities: {add(entity) { entities.push(entity); return entity; }, remove(entity) { entities.splice(entities.indexOf(entity), 1); }}};
  const labels = createDongLabels3D({C, viewer, source, requestRender() {}});
  try {
    labels.set(dongs, {dong: 'all'});
    assert.equal(entities.filter(entity => entity.label.show).length, 0);
    labels.set(dongs, {dong: 'seogu-08'});
    const shown = entities.filter(entity => entity.label.show);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].label.text, '상무1동');
    assert.deepEqual(labels.counts(), {name: 1, hidden: 17});
    labels.set(dongs, {visible: false});
    assert.equal(entities.length, 0);
    assert.deepEqual(labels.counts(), {name: 0, hidden: 0});
  } finally { labels.destroy(); }
});
