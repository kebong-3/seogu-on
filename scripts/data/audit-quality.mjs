#!/usr/bin/env node
// 자료 품질 점검: 중복·경계 밖·이름 없음·수상한 좌표를 찾아 docs/DATA_QUALITY_REPORT.json 의 audit 항목에 적습니다.
// 찾기만 하고 고치지 않습니다. 기존 보고서의 다른 항목(이전 수집 기록)은 그대로 둡니다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { facilityFiles } from './lib/files.mjs';
import { loadDongIndex, locate, metersBetween, vertices } from './lib/geo.mjs';

const REPORT_FILE = 'docs/DATA_QUALITY_REPORT.json';
const SAMPLE = 15;
const UNNAMED = /^$|이름 미등록|이름없음|^unnamed$/i;

function sample(list) {
  return list.slice(0, SAMPLE);
}

function label(feature) {
  return { id: feature.properties?.id ?? feature.id ?? null, name: feature.properties?.name ?? null };
}

/** 좌표가 수상한지: 뒤바뀜, 한국 밖, 소수점 2자리 이하(예: 126, 35)처럼 정밀도가 없는 값 */
function coordinateProblem([lon, lat]) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return '숫자가 아닌 좌표';
  if (lon >= 33 && lon <= 39 && lat >= 124 && lat <= 132) return '경도·위도가 뒤바뀐 것으로 보임';
  if (lon < 124 || lon > 132 || lat < 33 || lat > 39) return '한국 범위 밖';
  const decimals = value => (String(value).split('.')[1] || '').length;
  if (decimals(lon) <= 2 && decimals(lat) <= 2) return '소수점 2자리 이하의 거친 좌표';
  return null;
}

function duplicateIds(features) {
  const seen = new Map();
  for (const feature of features) {
    const id = String(feature.properties?.id ?? feature.id ?? '');
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  return [...seen].filter(([id, count]) => id && count > 1).map(([id, count]) => ({ id, count }));
}

/** 좌표가 완전히 같은 점 묶음과, 이름까지 같은 묶음을 나눠 셉니다. */
function coincidentPoints(points) {
  const groups = new Map();
  for (const feature of points) {
    const key = feature.geometry.coordinates.join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }
  const same = [...groups.values()].filter(group => group.length > 1);
  const sameName = same.filter(group => new Set(group.map(f => f.properties?.name)).size < group.length);
  return {
    groups: same.length,
    groupsWithSameName: sameName.length,
    examples: sample(same.map(group => ({ coordinates: group[0].geometry.coordinates, ids: group.map(f => f.properties?.id) }))),
  };
}

/** 같은 이름의 점이 30m 안에 또 있는 경우(같은 시설을 두 번 실었을 가능성). */
function nearSameName(points) {
  const byName = new Map();
  for (const feature of points) {
    const name = String(feature.properties?.name || '').replace(/\s+/g, '');
    if (!name || UNNAMED.test(name)) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(feature);
  }
  const pairs = [];
  for (const group of byName.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const meters = metersBetween(group[i].geometry.coordinates, group[j].geometry.coordinates);
        if (meters > 0 && meters <= 30) pairs.push({ name: group[i].properties.name, ids: [group[i].properties.id, group[j].properties.id], meters: Math.round(meters) });
      }
    }
  }
  return pairs;
}

function auditFile(root, file, index) {
  const collection = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  const features = collection.features || [];
  const meta = collection.metadata || {};
  const points = features.filter(feature => feature.geometry?.type === 'Point');
  const outside = [], partlyOutside = [], suspicious = [], unnamed = [], noSource = [], noDong = [];
  for (const feature of features) {
    const name = String(feature.properties?.name ?? '').trim();
    if (UNNAMED.test(name)) unnamed.push(label(feature));
    if (!feature.properties?.sourceName) noSource.push(label(feature));
    const all = vertices(feature.geometry);
    const problem = all.map(coordinateProblem).find(Boolean);
    if (problem) suspicious.push({ ...label(feature), problem, coordinates: all[0] });
    const inside = all.filter(([lon, lat]) => locate(index, lon, lat).inDistrict).length;
    if (feature.geometry?.type === 'Point') {
      if (!inside) outside.push({ ...label(feature), coordinates: all[0] });
      else if (!feature.properties?.dongId) noDong.push(label(feature));
    } else if (all.length && inside < all.length) {
      (inside ? partlyOutside : outside).push(label(feature));
    }
  }
  const ids = duplicateIds(features);
  const near = nearSameName(points);
  return {
    state: meta.state === 'not-connected' ? 'not-connected' : features.length ? 'has-data' : 'empty',
    features: features.length,
    points: points.length,
    sourceDate: meta.sourceDate ?? null,
    sourceDateRange: meta.sourceDateRange || null,
    collectedAt: meta.collectedAt || meta.retrievedAt || null,
    featuresWithoutSourceDate: features.filter(feature => !feature.properties?.sourceDate).length,
    duplicateIds: { count: ids.length, examples: sample(ids) },
    coincidentPoints: coincidentPoints(points),
    sameNameWithin30m: { count: near.length, examples: sample(near) },
    outsideDistrict: { count: outside.length, examples: sample(outside) },
    partlyOutsideDistrict: { count: partlyOutside.length, examples: sample(partlyOutside) },
    suspiciousCoordinates: { count: suspicious.length, examples: sample(suspicious) },
    missingNames: { count: unnamed.length, examples: sample(unnamed) },
    missingSourceName: { count: noSource.length, examples: sample(noSource) },
    pointsWithoutDong: { count: noDong.length, examples: sample(noDong) },
  };
}

function totals(files) {
  const keys = ['duplicateIds', 'sameNameWithin30m', 'outsideDistrict', 'partlyOutsideDistrict', 'suspiciousCoordinates', 'missingNames', 'missingSourceName', 'pointsWithoutDong'];
  const sum = Object.fromEntries(keys.map(key => [key, 0]));
  let features = 0, coincident = 0;
  for (const file of Object.values(files)) {
    features += file.features;
    coincident += file.coincidentPoints.groups;
    for (const key of keys) sum[key] += file[key].count;
  }
  return { files: Object.keys(files).length, features, coincidentPointGroups: coincident, ...sum };
}

export function buildAudit(root) {
  const index = loadDongIndex(root);
  const files = {};
  for (const file of facilityFiles(root)) files[file] = auditFile(root, file, index);
  return {
    generatedBy: 'scripts/data/audit-quality.mjs',
    boundary: `public/data/admin-dongs.geojson (기준일 ${index.boundaryDate || '미기재'}) 18개 행정동 합집합`,
    meaning: '자동 점검 결과입니다. 찾아낸 항목을 고치거나 지우지 않았고, 현장 확인을 뜻하지 않습니다. 면 도형이 경계에 걸치는 것(partlyOutsideDistrict)은 오류가 아닐 수 있습니다.',
    totals: totals(files),
    files,
  };
}

export function writeQualityReport(root) {
  const path = resolve(root, REPORT_FILE);
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const text = JSON.stringify({ ...existing, audit: buildAudit(root) }, null, 2) + '\n';
  const changed = !existsSync(path) || readFileSync(path, 'utf8') !== text;
  if (changed) writeFileSync(path, text);
  return { file: REPORT_FILE, changed };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const result = writeQualityReport(root);
  const audit = JSON.parse(readFileSync(resolve(root, REPORT_FILE), 'utf8')).audit;
  console.log(`자료 품질 점검표 ${result.changed ? '갱신' : '변경 없음'}: ${result.file}`);
  for (const [key, value] of Object.entries(audit.totals)) console.log(`  ${key}: ${value}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
