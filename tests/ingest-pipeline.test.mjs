// 수집 흐름 시험: 가짜 자료(tests/fixtures/ingest)와 서구청 실제 원본 3종으로 확인합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runIngest } from '../scripts/data/lib/pipeline.mjs';
import { printSummary } from '../scripts/data/lib/report.mjs';
import { loadDongIndex, locate } from '../scripts/data/lib/geo.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = resolve(root, 'tests/fixtures/ingest');

/** 임시 받은파일 폴더와 임시 출력 폴더를 만들어 실제 public/ 을 건드리지 않습니다. */
function sandbox(t, files) {
  const base = mkdtempSync(join(tmpdir(), 'seogu-ingest-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const inboxDir = join(base, 'inbox');
  const outRoot = join(base, 'out');
  mkdirSync(inboxDir);
  mkdirSync(outRoot);
  for (const [from, to] of Object.entries(files)) cpSync(resolve(fixtures, from), join(inboxDir, to));
  return { inboxDir, outRoot, run: (extra = {}) => runIngest({ root, inboxDir, outRoot, ...extra }) };
}

const readOut = (box, file) => JSON.parse(readFileSync(join(box.outRoot, file), 'utf8'));

test('ingest: CP949 standard file is recognised by its header, filtered by boundary, validated and de-duplicated', t => {
  const box = sandbox(t, { 'standard-heat-cp949.csv': 'download (3).csv' });
  const summary = box.run();
  const [result] = summary.results;
  assert.equal(result.key, 'heat-shelter');
  assert.equal(result.detectedBy, '제목행');
  assert.equal(result.files[0].encoding, 'euc-kr');
  assert.equal(result.state, 'written');

  const out = readOut(box, 'public/data/city/official/heat-shelter.geojson');
  const meta = out.metadata;
  assert.equal(meta.sourceRows, 9);
  assert.equal(meta.accepted, 3);
  assert.equal(meta.rejected, 6);
  assert.deepEqual(meta.rejectedReasons, { duplicate: 1, invalidCoordinates: 1, noCoordinates: 1, otherRegion: 1, outsideDistrict: 1, projectedCoordinates: 1 });
  assert.equal(meta.swappedCoordinatesFixed, 1);
  assert.equal(meta.noCoordinatesButDistrictAddress, 1);
  assert.equal(meta.phonesDropped, 1);
  assert.equal(meta.sourceDate, '2026-06-30');
  assert.equal(meta.state, 'published');
  assert.equal(meta.mappingVerified, 'memory');
  assert.match(meta.sourceUrl, /15013199/);
  assert.match(meta.originalSha256, /^[0-9a-f]{64}$/);
  assert.match(meta.collectedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

  assert.equal(out.features.length, 3);
  const index = loadDongIndex(root);
  for (const feature of out.features) {
    const [lon, lat] = feature.geometry.coordinates;
    const place = locate(index, lon, lat);
    assert.equal(place.inDistrict, true);
    assert.equal(feature.properties.dongId, place.dongId);
    assert.equal(feature.properties.dongName, place.dongName);
    assert.match(feature.properties.note, /확인하지 않았습니다/);
    assert.equal(feature.properties.sourceDate, '2026-06-30', '중복 중 최근 기준일 행을 남김');
  }
  const quoted = out.features.find(feature => feature.properties.name.startsWith('시험용 쉼터, 2호'));
  assert.equal(quoted.properties.name, '시험용 쉼터, 2호 "별관" (줄바꿈 포함)');
  assert.equal(quoted.properties.address, '광주광역시 서구 시험로 2, 2층');
  assert.equal(quoted.properties.phone, '', '휴대전화는 싣지 않음');
  const swapped = out.features.find(feature => feature.properties.name.includes('좌표 뒤바뀜'));
  assert.deepEqual(swapped.geometry.coordinates, [126.8807251, 35.1617548]);
  assert.equal(JSON.stringify(out).includes('홍길동'), false, '인명 열은 어디에도 실리지 않음');
  assert.deepEqual(out.features[0].properties.details, { 이용가능인원: '30' });
});

test('ingest: a file whose longitude/latitude columns are swapped is corrected and counted, never guessed', t => {
  const box = sandbox(t, { 'swapped-columns_20260106.csv': 'swapped-columns_20260106.csv' });
  const [result] = box.run().results;
  assert.equal(result.key, 'seogu-shade');
  const out = readOut(box, 'public/data/city/local-shade.geojson');
  assert.equal(out.metadata.swappedCoordinatesFixed, 2);
  assert.equal(out.metadata.rejectedReasons.outsideDistrict, 1, '(126, 35)는 고치지 않고 제외');
  assert.deepEqual(out.features.map(feature => feature.geometry.coordinates), [[126.9003993, 35.1539839], [126.897642, 35.1526615]]);
  assert.equal(out.metadata.sourceDate, '2026-01-06');
  assert.match(out.metadata.sourceDateBasis, /파일 이름/);
});

test('ingest: real Seo-gu source files reproduce the published local layers exactly', t => {
  const box = sandbox(t, { 'real/shade.csv': '서구_그늘막설치현황_20260106.csv', 'real/cooling.csv': 'b_20260106.csv', 'real/flood.csv': 'c_20251124.csv' });
  const summary = box.run();
  assert.deepEqual(summary.results.map(result => [result.key, result.accepted]).sort(), [['seogu-cooling', 7], ['seogu-flood', 468], ['seogu-shade', 199]]);
  for (const result of summary.results) {
    const published = JSON.parse(readFileSync(resolve(root, result.target), 'utf8'));
    const fresh = readOut(box, result.target);
    assert.equal(fresh.features.length, published.features.length, result.key);
    assert.equal(fresh.metadata.sourceDate, published.metadata.sourceDate, result.key);
    assert.equal(fresh.metadata.swappedCoordinatesFixed, 0, result.key);
    fresh.features.forEach((feature, i) => {
      const { collectedAt, ...mine } = feature.properties;
      const { collectedAt: ignored, ...theirs } = published.features[i].properties;
      assert.deepEqual(feature.geometry, published.features[i].geometry);
      assert.deepEqual(mine, theirs);
    });
  }
  const shade = summary.results.find(result => result.key === 'seogu-shade');
  assert.deepEqual(shade.metadata.excludedExamples.map(example => example.sourceRow), [15, 134]);
  assert.equal(shade.metadata.coincidentGroupCount, 1);
});

test('ingest: --dry-run reports the same numbers but writes nothing', t => {
  const box = sandbox(t, { 'standard-heat-cp949.csv': 'a.csv' });
  const summary = box.run({ dryRun: true });
  assert.equal(summary.results[0].state, 'dry-run');
  assert.equal(summary.results[0].accepted, 3);
  assert.equal(summary.changed, false);
  assert.deepEqual(readdirSync(box.outRoot), []);
});

test('ingest: running twice is idempotent (byte-identical output, second run reports no change)', t => {
  const box = sandbox(t, { 'standard-heat-cp949.csv': 'a.csv', 'zone-a.csv': 'zone-a.csv' });
  const first = box.run();
  const target = join(box.outRoot, 'public/data/city/official/heat-shelter.geojson');
  const before = readFileSync(target);
  const second = box.run();
  assert.deepEqual(first.results.map(result => result.state), ['written', 'written']);
  assert.deepEqual(second.results.map(result => result.state), ['unchanged', 'unchanged']);
  assert.equal(second.changed, false);
  assert.deepEqual(readFileSync(target), before);
});

test('ingest: two datasets with the same header are told apart by their values', t => {
  const box = sandbox(t, { 'zone-a.csv': '1.csv', 'zone-b.csv': '2.csv' });
  const keys = box.run().results.map(result => result.key).sort();
  assert.deepEqual(keys, ['child-protection-zone', 'senior-disabled-protection-zone']);
});

test('ingest: unrecognised or coordinate-less files fail loudly with their headers, and write nothing', t => {
  const box = sandbox(t, { 'unknown-table.csv': 'unknown-table.csv', 'toilet-without-coordinates.csv': 'x.csv' });
  writeFileSync(join(box.inboxDir, 'sheet.xlsx'), 'not a csv');
  const summary = box.run();
  const unknown = summary.files.find(file => file.name === 'unknown-table.csv');
  assert.equal(unknown.status, 'unknown');
  assert.deepEqual(unknown.headers, ['품목', '수량', '단가']);
  assert.equal(summary.files.find(file => file.name === 'sheet.xlsx').status, 'skipped');
  const toilet = summary.results.find(result => result.key === 'toilet');
  assert.equal(toilet.state, 'failed');
  assert.match(toilet.message, /위도·경도 열/);

  const lines = [];
  printSummary(summary, line => lines.push(line));
  const text = lines.join('\n');
  assert.match(text, /품목 \| 수량 \| 단가/);
  assert.match(text, /화장실명 \| 소재지도로명주소/);
  assert.match(text, /엑셀 파일은 읽지 않습니다/);
  const toiletFile = readOut(box, 'public/data/city/official/toilet.geojson');
  assert.equal(toiletFile.metadata.state, 'not-connected', '자리표시 파일은 0개가 아니라 미연결로 남음');
  assert.equal(toiletFile.features.length, 0);
});

test('ingest: file name prefix [key] overrides detection', t => {
  const box = sandbox(t, { 'zone-a.csv': '[senior-disabled-protection-zone]zone.csv' });
  const [result] = box.run().results;
  assert.equal(result.key, 'senior-disabled-protection-zone');
  assert.equal(result.detectedBy, '파일 이름 앞의 키 지정');
});

test('ingest: school file replaces only official points and keeps OSM polygons; a big drop needs --force', t => {
  const box = sandbox(t, { 'school-sample.csv': 'school.csv' });
  const target = 'public/data/city/infra/school.geojson';
  mkdirSync(join(box.outRoot, 'public/data/city/infra'), { recursive: true });
  cpSync(resolve(root, target), join(box.outRoot, target));
  const original = readFileSync(join(box.outRoot, target), 'utf8');

  const guarded = box.run().results[0];
  assert.equal(guarded.state, 'needs-confirmation');
  assert.equal(readFileSync(join(box.outRoot, target), 'utf8'), original);

  const forced = box.run({ force: true }).results[0];
  assert.equal(forced.state, 'written');
  assert.equal(forced.before, 52);
  const out = readOut(box, target);
  const polygons = out.features.filter(feature => feature.geometry.type.includes('Polygon'));
  const points = out.features.filter(feature => feature.geometry.type === 'Point');
  assert.equal(polygons.length, 52);
  assert.ok(polygons.every(feature => feature.properties.sourceName === 'OpenStreetMap contributors'));
  assert.deepEqual(points.map(feature => feature.properties.id), ['school-T000000001']);
  assert.equal(points[0].properties.schoolType, '초등학교');
  assert.equal(out.metadata.sourceName, '공식 학교 위치 + OSM 부지', '기존 파일 설명은 유지');
  assert.equal(out.metadata.officialPoints.rejectedReasons.closedInSource, 1);
  assert.equal(out.metadata.officialPoints.preservedOtherSourceFeatures, 52);
});

test('ingest: command line prints a Korean summary and exits 0 on a clean dry run', t => {
  const box = sandbox(t, { 'zone-a.csv': 'zone-a.csv' });
  const output = execFileSync(process.execPath, [resolve(root, 'scripts/data/ingest.mjs'), '--dry-run', `--inbox=${box.inboxDir}`], { encoding: 'utf8' });
  assert.match(output, /전국어린이보호구역표준데이터/);
  assert.match(output, /원본 1행 → 서구 안 1개 채택/);
  assert.match(output, /미리보기\(저장하지 않음\)/);
  assert.match(output, /전체 목록이 아닙니다/);
  assert.equal(existsSync(join(box.outRoot, 'public')), false);
});
