import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateRegionDataPack, pointInRegion} from '../shared/region-profile.js';
import {seedAssets, createWorkspace, compareWorkspace} from '../shared/space-twin-model.js';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const profile = await read('../public/data/regions/suncheon.json');
const boundaries = await read('../public/data/regions/suncheon/admin-boundaries.geojson');
const facilities = await read('../public/data/regions/suncheon/facilities.geojson');
const source = await read('../public/data/regions/suncheon/public-facilities-source.json');
const registry = await read('../public/data/regions/suncheon/identity-registry.json');
const sha = value => createHash('sha256').update(value).digest('hex');

test('Suncheon is an actual second region with 24 districts, 67 spaces and distinct code systems', () => {
  const report = validateRegionDataPack({profile, boundaries, facilities});
  assert.equal(profile.sample, false);
  assert.equal(profile.id, 'suncheon');
  assert.equal(profile.fullName, '전남광주통합특별시 순천시');
  assert.deepEqual(report.counts, {districts: 24, facilities: 67, boundaryCoordinates: 5587});
  assert.deepEqual(report.warnings, []);
  assert.equal(profile.codeSystem, 'MOIS-ADM');
  assert.equal(profile.jurisdictionCode, '12150');
  assert.ok(boundaries.features.every(f => f.properties.adm_cd2.startsWith('12150')));
  assert.equal(facilities.metadata.sourceProviderCode, '5790000');
  assert.equal(profile.capabilities.legacySeoguServices, false);
  assert.equal(profile.capabilities.spaceTwin, true);
});

test('the 2026-07-01 original boundary geometry remains unchanged and labels are interior', () => {
  // Digest independently compared with the downloaded national boundary source.
  // A future official geometry revision requires deliberate source/date review.
  assert.equal(sha(JSON.stringify(boundaries.features.map(f => [f.properties.adm_cd2, f.geometry]))), '75e61a3ed7668127f94300899afc0d743d3143716428bf729b38c78536e92168');
  assert.equal(boundaries.metadata.sourceDate, '2026-07-01');
  const names = boundaries.features.map(f => f.properties.dongName);
  assert.equal(names.filter(n => n.endsWith('읍')).length, 1);
  assert.equal(names.filter(n => n.endsWith('면')).length, 10);
  assert.equal(names.filter(n => n.endsWith('동')).length, 13);
  for (const feature of boundaries.features) assert.equal(pointInRegion(feature.properties.labelPoint, {features: [feature]}), true);
});

test('every displayed Suncheon space retains its original name, coordinate and all contributing source rows', () => {
  assert.equal(source.records.length, 78);
  const byHash = new Map(source.records.map(row => [sha(JSON.stringify(row)), row]));
  const used = new Set();
  for (const feature of facilities.features) {
    const p = feature.properties;
    assert.equal(p.sourceRecordCount, p.sourceRecordHashes.length);
    assert.equal(p.sourceConditionVariants.length, p.sourceRecordCount);
    for (const hash of p.sourceRecordHashes) {
      assert.equal(used.has(hash), false, 'a source row must not count as multiple spaces');
      used.add(hash);
      const row = byHash.get(hash);
      assert.ok(row, 'each record hash must resolve to a preserved source row');
      assert.equal(p.name, row.OPEN_FCLTY_NM);
      assert.deepEqual(feature.geometry.coordinates, [Number(row.LONGITUDE), Number(row.LATITUDE)]);
      assert.equal(p.sourceDate, row.REFERENCE_DATE);
      assert.equal(p.publishedFacilityType, row.OPEN_FCLTY_TYPE);
    }
    const district = boundaries.features.find(f => f.properties.dongId === p.dongId);
    assert.equal(pointInRegion(feature.geometry.coordinates, {features: [district]}), true);
    assert.equal(p.reviewStatus, 'unverified');
    assert.equal(p.positionSource, 'source-coordinates');
    assert.equal(p.operatingStatus, undefined);
  }
  assert.equal(used.size, source.records.length);
});

test('time/price variants are retained without inflating space, coordinate or coverage counts', () => {
  const meta = facilities.metadata;
  assert.equal(meta.nationwideRowsScanned, 7342);
  assert.equal(meta.selectedBeforeGrouping, 78);
  assert.equal(meta.groupedExtraRows, 11);
  assert.equal(meta.spacesWithMultipleSourceRows, 8);
  assert.equal(meta.distinctPublishedCoordinates, 20);
  assert.equal(meta.coveredDistricts, 8);
  assert.equal(new Set(facilities.features.map(f => JSON.stringify(f.geometry.coordinates))).size, 20);
  assert.equal(new Set(facilities.features.map(f => f.properties.dongId)).size, 8);
  const room = facilities.features.find(f => f.properties.name === '순천만국가정원 습지센터 소회의실 5(1층)').properties;
  assert.equal(room.sourceRecordCount, 2);
  assert.deepEqual(room.sourceConditionVariants.map(v => v.fee).sort(), ['15000', '20000']);
  assert.match(room.hours, /원문 조건 2개/);
  assert.match(room.hours, /확인 필요/);
  const ids = new Set(facilities.features.map(f => f.properties.id));
  assert.equal(ids.size, 67);
  assert.deepEqual(new Set(registry.entries.map(e => e.id)), ids);
  assert.ok(facilities.features.every(f => f.properties.sourceIdentity.upstreamPermanentIdAvailable === false));
});

test('published hours seed no field observations and all 67 spaces stay unverified in a real comparison', () => {
  const now = '2026-10-23T03:00:00.000Z';
  const assets = seedAssets(facilities, {regionId: 'suncheon', datasetId: 'public-facilities'});
  const workspace = createWorkspace('suncheon', {now});
  assert.equal(assets.length, 67);
  assert.ok(assets.every(a => a.regionId === 'suncheon' && a.rawHours));
  assert.deepEqual(workspace.observations, {});
  const comparison = compareWorkspace({assets, workspace, query: {dayOfWeek: 6, start: '14:00', end: '17:00'}, now});
  assert.equal(comparison.selectedCount, 67);
  assert.equal(comparison.baseline.unknownCount, 67);
  assert.equal(comparison.baseline.eligibleCount, 0);
  assert.equal(comparison.baseline.unavailableCount, 0);
  assert.equal(comparison.baseline.comparable, false);
  assert.ok(comparison.baseline.rows.every(row => row.provenance === 'unverified-source'));
});
