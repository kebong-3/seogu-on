import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planLabels,dongNumber,estimateTextWidth,labelFontPx} from '../src/city/label-layout.js';

const dongs = JSON.parse(fs.readFileSync(new URL('../public/data/admin-dongs.geojson', import.meta.url), 'utf8')).features;

/** 경계도와 같은 방식의 단순 투영: 서구 전체가 주어진 폭 안에 들어오게 한다. */
function overviewItems(width, height, mapWidth) {
  const points = dongs.map(f => f.properties.labelPoint);
  const lons = points.map(p => p[0]), lats = points.map(p => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const scale = mapWidth / (maxLon - minLon);
  return dongs.map((f, i) => ({
    id: f.properties.dongId,
    name: f.properties.dongName,
    number: dongNumber(f.properties.dongId, i),
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

test('label layout: dong numbers follow the dong id suffix', () => {
  assert.equal(dongNumber('seogu-07'), 7);
  assert.equal(dongNumber('seogu-18'), 18);
  assert.equal(dongNumber('unknown', 4), 5);
  assert.deepEqual(dongs.map((f, i) => dongNumber(f.properties.dongId, i)), Array.from({length: 18}, (_, i) => i + 1));
});

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
    // 겹친다고 통째로 지우지 않는다: 이름 또는 번호표로 18개 동이 모두 지도에 남는다.
    assert.equal(plan.counts.hidden, 0, JSON.stringify(plan.counts));
    assert.equal(plan.counts.name + plan.counts.number, 18);
  });
}

test('label layout: piled-up anchors (the reported centre pile) degrade to numbers, not overlapping names', () => {
  const items = dongs.map((f, i) => ({id: f.properties.dongId, name: f.properties.dongName, number: i + 1, x: 300 + (i % 6) * 9, y: 300 + Math.floor(i / 6) * 9}));
  const plan = planLabels(items, {width: 670, height: 700});
  assertNoOverlap(plan.labels);
  assert.ok(plan.counts.name < 18);
  assert.ok(plan.counts.number > 0);
});

test('label layout: the selected dong keeps its full name first', () => {
  const items = dongs.map((f, i) => ({id: f.properties.dongId, name: f.properties.dongName, number: i + 1, x: 200, y: 200, priority: i === 9 ? 1 : 0}));
  const plan = planLabels(items, {width: 400, height: 400});
  assert.equal(plan.labels[9].mode, 'name');
  assert.deepEqual([plan.labels[9].dx, plan.labels[9].dy], [0, 0]);
});

test('label layout: anchors behind the camera or off screen are hidden instead of guessed', () => {
  const plan = planLabels([{id: 'a', name: '양동', number: 1, x: NaN, y: 10}, {id: 'b', name: '풍암동', number: 17, x: 5000, y: 5000}], {width: 400, height: 400});
  assert.deepEqual(plan.labels.map(l => l.mode), ['hidden', 'hidden']);
});

test('label layout: every engine uses the shared planner', () => {
  const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.match(read('src/city/viewer.js'), /planLabels\(items,\{width:w,height:h\}/);
  assert.match(read('src/city/viewer.js'), /createDomDongLabels/);
  assert.match(read('src/city/scene.js'), /createDongLabels3D/);
  assert.match(read('src/city/dong-labels-3d.js'), /planLabels\(/);
});

test('label layout: off-screen dongs do not push visible neighbours down to numbers (dong close-up)', () => {
  const items = [
    {id: 'in-1', name: '치평동', number: 7, x: 500, y: 400, priority: 1},
    {id: 'in-2', name: '유덕동', number: 6, x: 800, y: 250},
    {id: 'in-3', name: '상무1동', number: 8, x: 830, y: 540},
    {id: 'out-1', name: '양동', number: 1, x: 2400, y: 300},
    {id: 'out-2', name: '풍암동', number: 17, x: 700, y: 1900}
  ];
  const plan = planLabels(items, {width: 1076, height: 734});
  assert.deepEqual(plan.labels.map(l => l.mode), ['name', 'name', 'name', 'hidden', 'hidden']);
});
