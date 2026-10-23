#!/usr/bin/env node
/** Read-only release gate: validate each jurisdiction against its own real data. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDecisionData} from '../server/decision-data.js';
import {publicDataRoot} from '../server/region-profile.js';
import {pointInRegion} from '../shared/region-profile.js';
import {computeDecisionTwin, decisionDistance, DECISION_VERSION} from '../shared/decision-twin-model.js';

const REGIONS = ['seogu', 'suncheon'];
const FIXED_TIME = '2026-10-23T00:00:00Z';
const uniqueLocations = rows => new Set(rows.map(row => (row.coordinates ?? row.geometry.coordinates).join(','))).size;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idOf = feature => String(feature.properties?.id ?? feature.id ?? '');
function check(condition, message) {
  if (!condition) throw Object.assign(new Error(message), {code: 'DECISION_RELEASE_INVALID'});
}
function count(value, label) {check(Number.isSafeInteger(value) && value >= 0, `${label}: 유효한 비음수 정수가 아닙니다.`);}
const proposalsOnly = result => result.scenario.proposedSites.map(({id, name, coordinates}) => ({id, name, coordinates}));
const scenarioCounts = result => Object.fromEntries(Object.entries(result.scenario).filter(([key]) => !['proposedSites', 'excludedServiceIds'].includes(key)));
const tally = (rows, field) => rows.filter(row => row[field]).length;

function validateDataset(pack, descriptor) {
  const data = pack.datasets[descriptor.id], metadata = data.metadata || {}, label = `${pack.profile.id}/${descriptor.id}`;
  const ownDecisionPack = descriptor.path.startsWith('/data/decision/');
  check(!ownDecisionPack || metadata.regionId === pack.profile.id, `${label}: 업무 자료의 regionId가 없습니다.`);
  check(metadata.regionId === undefined || metadata.regionId === pack.profile.id, `${label}: 자료가 다른 지역을 가리킵니다.`);
  check(/^[a-f0-9]{64}$/.test(data.sha256 || ''), `${label}: 실제 파일 해시가 없습니다.`);
  const dongMap = new Map(pack.boundaries.features.map(feature => [String(feature.properties?.dongId), feature]));
  const ids = new Set(); let missingSourceDates = 0;
  for (const feature of data.features) {
    const p = feature.properties || {}, id = idOf(feature), where = `${label}/${id || '(ID 없음)'}`;
    check(feature.type === 'Feature' && feature.geometry?.type === 'Point', `${where}: 업무 자료는 수록 대표점이어야 합니다.`);
    const coordinates = feature.geometry.coordinates;
    check(Array.isArray(coordinates) && coordinates.length === 2 && coordinates.every(Number.isFinite), `${where}: 경도·위도 값 오류`);
    check(id && !ids.has(id), `${where}: 비어 있거나 중복된 시설 ID`); ids.add(id);
    check(feature.id === undefined || p.id === undefined || String(feature.id) === String(p.id), `${where}: 두 시설 ID가 일치하지 않습니다.`);
    check(!ownDecisionPack || p.regionId === pack.profile.id, `${where}: 시설 regionId가 없습니다.`);
    check(p.regionId === undefined || p.regionId === pack.profile.id, `${where}: 시설이 다른 지역을 가리킵니다.`);
    check(pointInRegion(coordinates, pack.boundaries), `${where}: 선택 지역 경계 밖 좌표`);
    const dong = dongMap.get(String(p.dongId));
    check(dong && pointInRegion(coordinates, {features: [dong]}), `${where}: 행정동 ID와 실제 위치가 일치하지 않습니다.`);
    if (p.dongName !== undefined) check(p.dongName === dong.properties.dongName, `${where}: 행정동 이름 불일치`);
    check(Boolean(p.sourceName || metadata.sourceName || descriptor.sourceName), `${where}: 출처 이름 누락`);
    const url = p.sourceUrl || metadata.sourceUrl || descriptor.sourceUrl;
    check(typeof url === 'string' && /^https?:\/\//.test(url), `${where}: 공개 원문 링크 누락`);
    if (!p.sourceDate) missingSourceDates++;
    for (const key of ['pedestrianSignal', 'pushButtonSignal', 'audibleSignal', 'loweredCurb', 'tactilePaving', 'dedicatedLighting']) {
      if (Object.hasOwn(p, key)) check(p[key] === null || typeof p[key] === 'boolean', `${where}/${key}: 미상은 null이어야 합니다.`);
    }
  }
  const locations = uniqueLocations(data.features);
  for (const [key, actual] of [['publishedRecords', data.features.length], ['uniqueCoordinates', locations], ['missingSourceDateCount', missingSourceDates]]) {
    if (metadata[key] !== undefined) check(metadata[key] === actual, `${label}: ${key} 메타데이터와 실제 자료가 다릅니다.`);
  }
  return {id: descriptor.id, path: descriptor.path, acceptedPoints: data.features.length, uniqueLocations: locations, sha256: data.sha256,
    sourceDate: metadata.sourceDate || descriptor.sourceDate || null, missingSourceDates};
}

/** Inspect observable arithmetic, without reproducing the distance/recommendation implementation. */
function validateComparison(result, label) {
  check(['ready', 'partial'].includes(result.status), `${label}: 실제 업무 비교 자료를 사용할 수 없습니다.`);
  const b = result.baseline, s = result.scenario, rows = result.rows;
  for (const [key, value] of Object.entries(b)) count(value, `${label}/baseline.${key}`);
  for (const key of ['covered', 'uncovered', 'newlyCovered', 'lostCovered', 'totalLocations', 'coveredLocations', 'uncoveredLocations', 'newlyCoveredLocations', 'lostCoveredLocations']) count(s[key], `${label}/scenario.${key}`);
  check(Number.isSafeInteger(s.netChange) && Number.isSafeInteger(s.netLocationChange), `${label}: 순변화는 유한 정수여야 합니다.`);
  check(b.total === rows.length && b.covered + b.uncovered === b.total && s.covered + s.uncovered === b.total, `${label}: 전후 대상 분모가 달라졌습니다.`);
  check(b.totalLocations === uniqueLocations(rows) && b.totalLocations === s.totalLocations, `${label}: 전후 고유 좌표 분모가 달라졌습니다.`);
  check(b.coveredLocations + b.uncoveredLocations === b.totalLocations && s.coveredLocations + s.uncoveredLocations === b.totalLocations, `${label}: 고유 좌표 합계 오류`);
  check(b.covered === tally(rows, 'baselineCovered') && s.covered === tally(rows, 'scenarioCovered'), `${label}: 화면 합계와 대상별 결과 불일치`);
  check(s.newlyCovered === tally(rows, 'newlyCovered') && s.lostCovered === tally(rows, 'lostCovered'), `${label}: 추가·손실 합계 불일치`);
  check(s.netChange === s.covered - b.covered && s.netChange === s.newlyCovered - s.lostCovered, `${label}: 추가·손실·순변화 관계 오류`);
  check(s.netLocationChange === s.coveredLocations - b.coveredLocations && s.netLocationChange === s.newlyCoveredLocations - s.lostCoveredLocations, `${label}: 좌표 단위 순변화 오류`);
  for (const row of rows) {
    check(row.newlyCovered === (row.scenarioCovered && !row.baselineCovered) && row.lostCovered === (row.baselineCovered && !row.scenarioCovered), `${label}/${row.id}: 대상별 전후 상태 모순`);
    for (const nearest of [row.nearest, row.scenarioNearest]) if (nearest) count(nearest.distanceM, `${label}/${row.id}/distanceM`);
  }
  for (const source of result.sourceStatus) {
    check(source.omitted === 0 && source.generatedIds === 0, `${label}/${source.id}: 계산 중 원문 누락 또는 임의 ID 생성`);
  }
  for (const proposal of s.proposedSites) {
    for (const key of ['marginalGain', 'marginalLocationGain', 'exclusiveGain', 'exclusiveLocationGain', 'baselineNewCount', 'baselineNewLocationCount']) count(proposal[key], `${label}/${proposal.id}/${key}`);
    check(proposal.exclusiveGain <= proposal.marginalGain && proposal.exclusiveLocationGain <= proposal.marginalLocationGain, `${label}/${proposal.id}: 단독 제외효과가 한계효과보다 큽니다.`);
  }
}
function validateContext(context, label, pack, coordinates, radiusM) {
  for (const source of context || []) {
    if (source.state === 'unavailable') {
      check(source.count === null && source.uniqueLocations === null, `${label}/${source.datasetId}: 미상 자료를 0으로 표시했습니다.`);
      continue;
    }
    count(source.count, `${label}/${source.datasetId}/count`); count(source.uniqueLocations, `${label}/${source.datasetId}/uniqueLocations`);
    const expected=source.rowsIncluded===false?pack.datasets[source.datasetId].features.filter(feature=>decisionDistance(coordinates,feature.geometry.coordinates)<=radiusM):source.rows;
    check(source.count === expected.length && source.uniqueLocations === uniqueLocations(expected), `${label}/${source.datasetId}: 주변 원문·좌표 합계 오류`);
    if(source.rowsIncluded===false)check(source.rows.length===0,`${label}/${source.datasetId}: 요약 전송에서 원문 점을 중복 전송했습니다.`);
  }
}

function validatePreset(pack, preset) {
  const label = `${pack.profile.id}/${preset.id}`;
  const run = request => computeDecisionTwin({...pack, request: {regionId: pack.profile.id, presetId: preset.id, ...request}, generatedAt: FIXED_TIME});
  const baseline = run({workflow: 'coverage', maxNew: 0, proposedSites: []});
  validateComparison(baseline, `${label}/baseline`);
  check(baseline.scenario.covered === baseline.baseline.covered && baseline.scenario.netChange === 0 && !baseline.scenario.proposedSites.length, `${label}: 무변경 대안이 기준상태와 다릅니다.`);

  const proposed = run({workflow: 'coverage', maxNew: 3});
  validateComparison(proposed, `${label}/recommended`);
  check(equal(proposed.baseline, baseline.baseline), `${label}: 추천 추가로 원래 baseline이 바뀌었습니다.`);
  check(proposed.scenario.lostCovered === 0 && proposed.scenario.netChange >= 0, `${label}: 시설 추가만 했는데 손실이 발생했습니다.`);
  check(uniqueLocations(proposed.scenario.proposedSites) === proposed.scenario.proposedSites.length, `${label}: 같은 위치에 추천을 중복 배치했습니다.`);
  const selected = proposalsOnly(proposed);
  const reversed = run({workflow: 'coverage', maxNew: 0, proposedSites: [...selected].reverse()});
  validateComparison(reversed, `${label}/reordered`);
  check(equal(scenarioCounts(reversed), scenarioCounts(proposed)), `${label}: 동일 후보의 입력 순서만 바꿨는데 전후 총효과가 달라졌습니다.`);
  for (const proposal of proposed.scenario.proposedSites) {
    const other = reversed.scenario.proposedSites.find(row => row.id === proposal.id);
    check(other?.exclusiveGain === proposal.exclusiveGain && other?.exclusiveLocationGain === proposal.exclusiveLocationGain, `${label}/${proposal.id}: 입력 순서에 따라 후보 단독 제외효과가 달라졌습니다.`);
    const removed = run({workflow: 'coverage', maxNew: 0, proposedSites: selected.filter(row => row.id !== proposal.id)});
    validateComparison(removed, `${label}/without-${proposal.id}`);
    check(equal(removed.baseline, baseline.baseline), `${label}: 후보 제거로 원래 baseline이 바뀌었습니다.`);
    check(removed.scenario.covered === proposed.scenario.covered - proposal.exclusiveGain && removed.scenario.coveredLocations === proposed.scenario.coveredLocations - proposal.exclusiveLocationGain, `${label}/${proposal.id}: 후보 제외시 계산과 표시 효과가 일치하지 않습니다.`);
    check(removed.scenario.proposedSites.length === selected.length - 1, `${label}: 제외한 후보를 자동으로 다시 채웠습니다.`);
  }

  const sourceServiceId = baseline.rows.find(row => row.baselineCovered)?.nearest?.id || baseline.context.services[0]?.id;
  let exclusionChecked = false;
  if (sourceServiceId) {
    const excludedService = baseline.context.services.find(row => row.id === sourceServiceId);
    const removed = run({workflow: 'coverage', maxNew: 0, proposedSites: [], excludedServiceIds: [sourceServiceId]});
    validateComparison(removed, `${label}/service-excluded`);
    check(equal(removed.baseline, baseline.baseline), `${label}: 기존 시설 제외로 원래 baseline이 바뀌었습니다.`);
    check(removed.scenario.newlyCovered === 0 && removed.scenario.covered <= baseline.baseline.covered, `${label}: 시설 제외만 했는데 새로운 포함이 발생했습니다.`);
    const restored = run({workflow: 'coverage', maxNew: 0, proposedSites: [{id: 'release-check-replacement', name: '동일 위치 검증', coordinates: excludedService.coordinates}], excludedServiceIds: [sourceServiceId]});
    validateComparison(restored, `${label}/service-restored`);
    check(equal(restored.baseline, baseline.baseline) && restored.scenario.covered === baseline.baseline.covered && restored.scenario.newlyCovered === 0 && restored.scenario.lostCovered === 0, `${label}: 제외 시설을 같은 위치에 되돌린 결과가 기준상태와 다릅니다.`);
    exclusionChecked = true;
  }

  const inspection = run({workflow: 'inspection', maxNew: 0, proposedSites: []});
  validateComparison(inspection, `${label}/inspection`);
  check(equal(inspection.baseline, baseline.baseline), `${label}: 점검 목록의 대상 분모가 달라졌습니다.`);
  for (const row of inspection.rows) {
    validateContext(row.context, `${label}/inspection/${row.id}`,pack,row.coordinates,inspection.parameters.radiusM);
    for (const flag of row.inspectionFlags || []) check(flag.state === (row.sourceFlags[flag.key] === false ? 'not-installed' : 'unknown'), `${label}/${row.id}: 원문 미상을 미설치로 변경했습니다.`);
  }
  const locations = new Set();
  const sites = baseline.rows.filter(row => {const key = row.coordinates.join(','); if (locations.has(key)) return false; locations.add(key); return true;}).slice(0, 2).map((row, i) => ({id: `release-site-${i + 1}`, name: row.name, coordinates: row.coordinates}));
  const siteResult = run({workflow: 'site', maxNew: 0, sites});
  check(siteResult.status !== 'unavailable' && siteResult.baseline.total === sites.length && siteResult.context.sites.length === sites.length, `${label}: 사업 후보지 비교가 실행되지 않습니다.`);
  for (const site of siteResult.context.sites) validateContext(site.datasets, `${label}/site/${site.id}`,pack,site.coordinates,siteResult.parameters.radiusM);

  return {id: preset.id, target: preset.target, service: preset.service, radiusM: preset.radiusM,
    total: baseline.baseline.total, totalLocations: baseline.baseline.totalLocations,
    baselineCovered: baseline.baseline.covered, baselineCoveredLocations: baseline.baseline.coveredLocations,
    scenarioCovered: proposed.scenario.covered, scenarioCoveredLocations: proposed.scenario.coveredLocations,
    newlyCovered: proposed.scenario.newlyCovered, newlyCoveredLocations: proposed.scenario.newlyCoveredLocations,
    proposals: proposed.scenario.proposedSites.length, proposalRemovalChecks: selected.length, existingServiceExclusionChecked: exclusionChecked,
    workflows: ['coverage', 'inspection', 'site'], checks: ['same-denominator', 'nonnegative-counts', 'unchanged-baseline', 'order-invariant-total', 'exclusive-removal-effect', 'unknown-preserved']};
}

/** Server loader checks manifest/file hashes; this gate adds actual-data spatial and model checks. */
export async function validateDecisionPacks({publicRoot = publicDataRoot} = {}) {
  const summaries = [];
  for (const regionId of REGIONS) {
    const pack = await loadDecisionData({regionId, publicRoot});
    const datasets = pack.manifest.datasets.map(descriptor => validateDataset(pack, descriptor));
    const presets = pack.manifest.presets.map(preset => validatePreset(pack, preset));
    summaries.push({regionId, modelVersion: DECISION_VERSION, manifestSha256: pack.manifest.sha256,
      boundaryDistricts: pack.boundaries.features.length, datasets, presets, ok: true});
  }
  return summaries;
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length) return validateDecisionPacks();
  if (args.length === 2 && args[0] === '--public-root') return validateDecisionPacks({publicRoot: resolve(args[1])});
  throw Error('사용법: node scripts/validate-decision-data.mjs [--public-root /배포/public]');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await main(), null, 2));}
  catch (error) {console.error(JSON.stringify({ok: false, code: error.code || 'DECISION_RELEASE_INVALID', error: error.message}, null, 2)); process.exitCode = 1;}
}
