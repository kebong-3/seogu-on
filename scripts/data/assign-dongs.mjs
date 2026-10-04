#!/usr/bin/env node
// 점 시설마다 행정동(dongId, dongName)을 붙입니다. 좌표와 다른 속성은 바꾸지 않습니다.
//   node scripts/data/assign-dongs.mjs          → 빠진 곳만 채우기
//   node scripts/data/assign-dongs.mjs --check  → 채울 것이 남았는지 확인만
// 경계 밖 점·두 동의 경계선 위 점은 임의로 배정하지 않고 비워 둡니다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { facilityFiles } from './lib/files.mjs';
import { loadDongIndex, locate } from './lib/geo.mjs';
import { serializeCollection } from './lib/pipeline.mjs';

function assignFeature(feature, index) {
  if (feature.geometry?.type !== 'Point') return false;
  const properties = feature.properties || {};
  if (properties.dongId && properties.dongName) return false;
  const [lon, lat] = feature.geometry.coordinates;
  const place = locate(index, lon, lat);
  if (!place.dongId) return false;
  // 기존 dongName 이 있으면 덮어쓰지 않고, 계산 결과와 다르면 세어서 알려 줍니다.
  if (properties.dongName && properties.dongName !== place.dongName) return 'mismatch';
  feature.properties = { ...properties, dongName: place.dongName, dongId: place.dongId };
  return true;
}

export function assignDongs(root, { check = false } = {}) {
  const index = loadDongIndex(root);
  const report = [];
  for (const file of facilityFiles(root)) {
    const path = resolve(root, file);
    const collection = JSON.parse(readFileSync(path, 'utf8'));
    let assigned = 0, mismatched = 0;
    for (const feature of collection.features || []) {
      const outcome = assignFeature(feature, index);
      if (outcome === true) assigned++;
      else if (outcome === 'mismatch') mismatched++;
    }
    if (assigned && !check) writeFileSync(path, serializeCollection(collection));
    if (assigned || mismatched) report.push({ file, assigned, mismatched });
  }
  return report;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const check = process.argv.includes('--check');
  const report = assignDongs(root, { check });
  if (!report.length) return console.log('모든 점 시설에 행정동이 붙어 있습니다.');
  for (const row of report) {
    console.log(`${row.file}: ${check ? '채울 점' : '행정동을 붙인 점'} ${row.assigned}개` + (row.mismatched ? ` · 기존 동 이름과 계산이 다른 점 ${row.mismatched}개(그대로 둠)` : ''));
  }
  if (check && report.some(row => row.assigned)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
