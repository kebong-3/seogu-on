#!/usr/bin/env node
// public/data/city/coverage.json 을 실제 파일에서 다시 계산합니다(손으로 고치지 않습니다).
//   node scripts/data/build-coverage.mjs          → 다시 만들기
//   node scripts/data/build-coverage.mjs --check  → 최신인지 확인만(다르면 종료코드 1)
//
// 기존에 화면·검증 스크립트가 읽는 항목(version, infrastructure, buildings, notConnected)은
// 이름과 모양을 그대로 두고, 새 항목만 덧붙입니다.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INFRA_CATEGORIES, INFRA_LAYERS } from '../../src/city/infrastructure.js';
import { LAYERS } from '../../src/city/catalog.js';
import { SOURCES } from './sources.mjs';

const COVERAGE_FILE = 'public/data/city/coverage.json';
const ROADMAP_FILE = 'public/data/city/source-roadmap.json';
// scripts/verify-release.mjs 가 배포본에서 이 값을 확인하므로 바꾸지 않습니다(자료 구조 버전).
const SCHEMA_VERSION = '0.4.0';

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function countGeometry(features) {
  let points = 0, areas = 0, lines = 0;
  for (const feature of features) {
    const type = feature.geometry?.type || '';
    if (type.includes('Point')) points++;
    else if (type.includes('Polygon')) areas++;
    else lines++;
  }
  return { points, areas, lines, features: features.length };
}

function sourceFamilies(features) {
  const counts = {};
  for (const feature of features) {
    const family = String(feature.properties?.sourceName || '출처 미기재').split(' / ')[0];
    counts[family] = (counts[family] || 0) + 1;
  }
  return counts;
}

/** 파일 전체 기준일이 없을 때, 시설마다 적힌 기준일의 범위(없으면 null). */
function featureDateRange(features) {
  const dates = features.map(feature => feature.properties?.sourceDate).filter(Boolean).sort();
  return dates.length ? [dates[0], dates.at(-1)] : null;
}

/** 파일 하나의 현황. 0개와 '미연결'을 구분합니다. */
function describeFile(root, url) {
  const collection = readJson(resolve(root, 'public' + url));
  if (!collection) return { file: url, state: 'missing', points: 0, areas: 0, lines: 0, features: 0 };
  const meta = collection.metadata || {};
  const official = meta.officialPoints || {};
  const state = meta.state === 'not-connected' ? 'not-connected' : collection.features.length ? 'partial' : 'empty';
  return {
    file: url,
    state,
    ...countGeometry(collection.features),
    sources: sourceFamilies(collection.features),
    sourceDate: meta.sourceDate ?? official.sourceDate ?? null,
    sourceDateRange: meta.sourceDateRange || official.sourceDateRange || featureDateRange(collection.features),
    collectedAt: meta.collectedAt || meta.retrievedAt || official.collectedAt || null,
  };
}

function describeLayers(root) {
  const layers = {};
  for (const layer of LAYERS.filter(item => item.url)) {
    layers[layer.id] = { title: layer.title, group: layer.group, ...describeFile(root, layer.url) };
  }
  return layers;
}

function describeCategories(layers) {
  return INFRA_CATEGORIES.map(category => {
    const known = category.layers.map(id => layers[id]).filter(Boolean);
    const sum = key => known.reduce((total, layer) => total + layer[key], 0);
    const total = sum('features');
    const state = total ? 'partial' : category.api ? 'api-on-demand' : known.some(layer => layer.state === 'not-connected') ? 'not-connected' : 'empty';
    return { id: category.id, title: category.title, group: category.group, layers: category.layers, points: sum('points'), areas: sum('areas'), lines: sum('lines'), state };
  });
}

/** 기존 형식의 infrastructure 표: 자료가 연결된 인프라 층만 싣습니다. */
function describeInfrastructure(layers, previous) {
  const table = {};
  for (const layer of INFRA_LAYERS) {
    const info = layers[layer.id];
    if (!info || info.state === 'not-connected' || info.state === 'missing') continue;
    table[layer.name] = {
      title: previous?.infrastructure?.[layer.name]?.title || layer.title,
      points: info.points,
      areas: info.areas,
      features: info.features,
      coverage: 'partial',
      lines: info.lines,
      sources: info.sources,
      sourceDate: info.sourceDate,
      sourceDateRange: info.sourceDateRange,
      collectedAt: info.collectedAt,
    };
  }
  return table;
}

function describeBuildings(root, previous) {
  const collection = readJson(resolve(root, 'public/data/city/model/buildings.geojson'));
  if (!collection) return previous?.buildings || { count: 0, heightCounts: {}, coverage: '건물자료 없음' };
  const heightCounts = { 'display-only': 0, 'levels-estimate': 0, tagged: 0 };
  for (const feature of collection.features) {
    const basis = feature.properties?.heightBasis;
    heightCounts[basis] = (heightCounts[basis] || 0) + 1;
  }
  return {
    count: collection.features.length,
    heightCounts,
    coverage: previous?.buildings?.coverage || collection.metadata?.coverage || '부분 건물자료',
  };
}

/** infra/ 폴더의 '미연결' 자리표시 중, 다른 층으로도 채워지지 않은 종류만 남깁니다. */
function listNotConnected(root, layers, categories) {
  const directory = resolve(root, 'public/data/city/infra');
  const names = readdirSync(directory).filter(name => name.endsWith('.geojson')).map(name => name.slice(0, -8)).sort();
  const pending = [];
  const connectedThroughOtherLayer = {};
  for (const name of names) {
    const collection = readJson(resolve(directory, name + '.geojson'));
    if (collection?.metadata?.state !== 'not-connected') continue;
    const category = categories.find(item => item.id === name);
    const others = (category?.layers || []).filter(id => id !== 'infra-' + name && layers[id]?.features > 0);
    if (others.length) connectedThroughOtherLayer[name] = others;
    else pending.push(name);
  }
  // 기존 목록의 순서를 유지해 불필요한 변경을 줄입니다.
  const legacyOrder = ['cold', 'grit', 'snow-routes', 'shade-structures', 'childcare-official', 'welfare-official', 'snow-priority'];
  pending.sort((a, b) => (legacyOrder.indexOf(a) + 100) % 100 - (legacyOrder.indexOf(b) + 100) % 100 || a.localeCompare(b));
  return { pending, connectedThroughOtherLayer };
}

/** 수집 연결표(sources.mjs)의 각 자료가 지금 파일로 들어와 있는지. */
function describeIngestTargets(root) {
  return SOURCES.map(source => {
    const info = describeFile(root, source.target.replace(/^public/, ''));
    const collection = readJson(resolve(root, source.target));
    const features = source.merge && collection ? collection.features.filter(source.merge.replaceWhere).length
      : source.merge ? 0 : info.features;
    return {
      key: source.key,
      title: source.title,
      roadmapId: source.roadmapId,
      portalId: source.portalId,
      target: source.target,
      layerId: source.layerId,
      state: features ? 'published' : info.state === 'missing' ? 'missing' : 'not-connected',
      features,
      sourceDate: info.sourceDate,
      sourceDateRange: info.sourceDateRange,
      collectedAt: info.collectedAt,
      mappingVerified: source.verified,
    };
  });
}

export function buildCoverage(root) {
  const previous = readJson(resolve(root, COVERAGE_FILE));
  const layers = describeLayers(root);
  const categories = describeCategories(layers);
  const { pending, connectedThroughOtherLayer } = listNotConnected(root, layers, categories);
  const ingest = describeIngestTargets(root);
  const roadmap = readJson(resolve(root, ROADMAP_FILE));
  return {
    version: SCHEMA_VERSION,
    infrastructure: describeInfrastructure(layers, previous),
    buildings: describeBuildings(root, previous),
    notConnected: pending,
    // ── 여기부터 덧붙인 항목 ──
    generatedBy: 'scripts/data/build-coverage.mjs',
    meaning: '개수는 확보한 공개자료의 객체 수이며 시설 전수가 아닙니다. not-connected 는 0개가 아니라 자료를 아직 연결하지 않았다는 뜻입니다. 현장 검증된 자료는 없습니다.',
    connectedThroughOtherLayer,
    layers,
    categories,
    ingestTargets: ingest,
    roadmap: {
      links: roadmap?.items?.length || 0,
      withPublishedSnapshot: ingest.filter(item => item.roadmapId && item.state === 'published').map(item => item.roadmapId).sort(),
      meaning: '로드맵 링크 수는 수집한 자료 수가 아닙니다. withPublishedSnapshot 만 저장소에 공개본이 들어 있습니다.',
    },
  };
}

/** 로드맵 항목마다 '공개본이 들어와 있는지'를 덧붙입니다(기존 항목은 건드리지 않음). */
function syncRoadmap(root, coverage) {
  const path = resolve(root, ROADMAP_FILE);
  const roadmap = readJson(path);
  if (!roadmap?.items) return false;
  const byId = new Map(coverage.ingestTargets.filter(item => item.roadmapId).map(item => [item.roadmapId, item]));
  for (const item of roadmap.items) {
    const target = byId.get(item.id);
    if (!target) continue;
    item.snapshot = target.state === 'published'
      ? { state: 'published', file: target.target.replace(/^public/, ''), features: target.features, sourceDate: target.sourceDate, sourceDateRange: target.sourceDateRange, collectedAt: target.collectedAt }
      : { state: 'not-collected', file: target.target.replace(/^public/, ''), howTo: 'docs/DATA_INBOX.md' };
  }
  roadmap.collectedItemIds = coverage.roadmap.withPublishedSnapshot;
  roadmap.rawDataCollectedMeaning = 'rawDataCollected=false 는 60개 링크 전체를 수집하지 않았다는 뜻입니다. 실제로 공개본이 들어온 항목은 collectedItemIds 와 각 항목의 snapshot 을 보세요.';
  const text = JSON.stringify(roadmap, null, 2) + '\n';
  if (readFileSync(path, 'utf8') === text) return false;
  writeFileSync(path, text);
  return true;
}

export function coverageText(root) {
  return JSON.stringify(buildCoverage(root)) + '\n';
}

export function writeCoverage(root) {
  const path = resolve(root, COVERAGE_FILE);
  const text = coverageText(root);
  const changed = !existsSync(path) || readFileSync(path, 'utf8') !== text;
  if (changed) writeFileSync(path, text);
  const roadmapChanged = syncRoadmap(root, JSON.parse(text));
  return { file: COVERAGE_FILE, changed: changed || roadmapChanged };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  if (process.argv.includes('--check')) {
    const current = existsSync(resolve(root, COVERAGE_FILE)) ? readFileSync(resolve(root, COVERAGE_FILE), 'utf8') : '';
    const fresh = current === coverageText(root);
    console.log(fresh ? '자료 현황표가 최신입니다.' : '자료 현황표가 실제 파일과 다릅니다. node scripts/data/build-coverage.mjs 를 실행하세요.');
    if (!fresh) process.exitCode = 1;
    return;
  }
  const result = writeCoverage(root);
  const coverage = JSON.parse(readFileSync(resolve(root, COVERAGE_FILE), 'utf8'));
  console.log(`자료 현황표 ${result.changed ? '갱신' : '변경 없음'}: ${result.file}`);
  console.log(`  연결된 인프라 층 ${Object.keys(coverage.infrastructure).length}종 · 미연결 ${coverage.notConnected.length}종 (${coverage.notConnected.join(', ')})`);
  console.log(`  수집 연결표 ${coverage.ingestTargets.length}종 중 공개본 있음 ${coverage.ingestTargets.filter(item => item.state === 'published').length}종`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
