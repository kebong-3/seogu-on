// 연결표·지도 목록·현황표가 서로 어긋나지 않는지 확인합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../scripts/data/sources.mjs';
import { buildCoverage, coverageText } from '../scripts/data/build-coverage.mjs';
import { assignDongs } from '../scripts/data/assign-dongs.mjs';
import { buildAudit } from '../scripts/data/audit-quality.mjs';
import { LAYERS, LAYER_BY_ID } from '../src/city/catalog.js';
import { INFRA_CATEGORIES, OFFICIAL_LAYERS } from '../src/city/infrastructure.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));

test('ingest catalog: every source has a unique key, an official URL, a target under public/data and honest notes', () => {
  assert.equal(new Set(SOURCES.map(source => source.key)).size, SOURCES.length);
  assert.equal(new Set(SOURCES.map(source => source.target)).size, SOURCES.length, '한 파일에 두 자료를 섞지 않음');
  for (const source of SOURCES) {
    assert.match(source.sourceUrl, /^https:\/\/www\.data\.go\.kr\//, source.key);
    assert.match(source.target, /^public\/data\/.+\.geojson$/, source.key);
    assert.ok(['real-file', 'memory', 'memory-uncertain'].includes(source.verified), source.key);
    assert.ok(source.fields.lat?.length && source.fields.lon?.length, source.key);
    assert.match(source.note, /아닙니다|않았습니다|확인|대조/, source.key);
    assert.ok(!/OpenStreetMap/.test(source.sourceName), source.key);
  }
  assert.deepEqual(SOURCES.filter(source => source.verified === 'real-file').map(source => source.key), ['seogu-shade', 'seogu-cooling', 'seogu-flood']);
});

test('ingest catalog: source URLs agree with the roadmap document', () => {
  const roadmap = new Map(read('public/data/city/source-roadmap.json').items.map(item => [item.id, item]));
  for (const source of SOURCES.filter(item => item.roadmapId)) {
    const item = roadmap.get(source.roadmapId);
    assert.ok(item, source.key);
    assert.ok(item.url.includes(`/data/${source.portalId}/`), source.key);
  }
});

test('ingest catalog: targets shown on the map point at the same file as the layer catalogue, and every file exists', () => {
  const snapshots = read('public/data/city/official-collection.json').datasets;
  for (const source of SOURCES) {
    assert.ok(existsSync(resolve(root, source.target)), source.target);
    if (!source.layerId) continue;
    assert.equal('public' + LAYER_BY_ID[source.layerId]?.url, source.target, source.key);
  }
  for (const layer of OFFICIAL_LAYERS) {
    const snapshot = snapshots.find(source => source.layerId === layer.id);
    assert.ok(SOURCES.some(source => source.layerId === layer.id) || snapshot, layer.id);
    const collection = read('public' + layer.url);
    if (snapshot) {
      assert.equal(snapshot.file, layer.url, layer.id);
      assert.equal(snapshot.accepted, collection.features.length, layer.id);
      assert.equal(collection.metadata.state, 'published', layer.id);
    }
    assert.ok(collection.features.length > 0 || collection.metadata.state === 'not-connected', `${layer.id}: 0개와 미연결을 구분`);
  }
});

test('ingest catalog: official shade points are reachable from the shade category without copying them', () => {
  const shade = INFRA_CATEGORIES.find(category => category.id === 'shade-structures');
  assert.deepEqual(shade.layers, ['local-shade', 'infra-shade-structures']);
  assert.equal(read('public/data/city/infra/shade-structures.geojson').features.length, 0, '사용자 등록용 층에는 공식자료를 복사하지 않음');
  const usedBy = INFRA_CATEGORIES.filter(category => category.layers.includes('local-shade'));
  assert.equal(usedBy.length, 1, '같은 층이 두 종류에 중복 표시되지 않음');
  assert.equal(INFRA_CATEGORIES.filter(category => category.title.includes('학교') || category.group.includes('학교')).length, 2);
  assert.equal(new Set(INFRA_CATEGORIES.map(category => category.id)).size, INFRA_CATEGORIES.length);
  for (const category of INFRA_CATEGORIES) for (const id of category.layers) assert.ok(LAYER_BY_ID[id], id);
  assert.equal(new Set(LAYERS.map(layer => layer.id)).size, LAYERS.length);
});

test('ingest catalog: coverage.json is generated from the files and is up to date', () => {
  assert.equal(readFileSync(resolve(root, 'public/data/city/coverage.json'), 'utf8'), coverageText(root),
    'node scripts/data/build-coverage.mjs 를 다시 실행하세요');
  const coverage = buildCoverage(root);
  assert.equal(coverage.version, '0.4.0');
  assert.equal(typeof coverage.buildings.count, 'number');
  assert.ok(['tagged', 'levels-estimate', 'display-only'].every(key => typeof coverage.buildings.heightCounts[key] === 'number'));
  assert.ok(typeof coverage.buildings.coverage === 'string');
  for (const entry of Object.values(coverage.infrastructure)) {
    assert.equal(entry.coverage, 'partial', '전수라고 표시하는 층이 없어야 함');
    assert.equal(entry.features, entry.points + entry.areas + entry.lines);
  }
  assert.ok(!coverage.notConnected.includes('shade-structures'));
  assert.deepEqual(coverage.connectedThroughOtherLayer['shade-structures'], ['local-shade']);
  assert.equal(coverage.categories.find(category => category.id === 'shade-structures').points, 199);
  for (const name of coverage.notConnected) assert.equal(read(`public/data/city/infra/${name}.geojson`).metadata.state, 'not-connected');
});

test('ingest catalog: every in-district point already carries its dong, and the audit finds nothing outside the boundary', () => {
  assert.deepEqual(assignDongs(root, { check: true }).filter(row => row.assigned), []);
  const audit = buildAudit(root);
  assert.equal(audit.totals.outsideDistrict, 0);
  assert.equal(audit.totals.suspiciousCoordinates, 0);
  assert.equal(audit.totals.duplicateIds, 0);
  assert.equal(audit.totals.missingSourceName, 0);
  assert.deepEqual(read('docs/DATA_QUALITY_REPORT.json').audit, audit, 'node scripts/data/audit-quality.mjs 를 다시 실행하세요');
});
