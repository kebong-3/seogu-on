#!/usr/bin/env node
/** Replays a real second-region data pack offline; does not simulate employee results. */
import {readFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadRegionData} from '../server/region-profile.js';
import {answerRegionQuestion} from '../server/ai/region-ask.js';
import {seedAssets, createWorkspace, compareWorkspace} from '../shared/space-twin-model.js';
import {validateRegionDirectory} from './validate-region.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = text => createHash('sha256').update(text).digest('hex');

export async function replaySuncheon() {
  const startedAt = new Date().toISOString();
  const pack = await loadRegionData({env: {}, regionId: 'suncheon'});
  const paths = ['public/data/regions/suncheon.json', 'public/data/regions/suncheon/admin-boundaries.geojson', 'public/data/regions/suncheon/facilities.geojson'];
  const originalSha256 = Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(resolve(root, path)))])));
  const broadInput = {regionId: 'suncheon', question: '순천시 주민 회의 공간을 찾아줘'};
  const broad = await answerRegionQuestion(broadInput, {env: {}});
  const referenceIds = new Set(pack.facilities.features.map(f => f.properties.id));
  const selected = broad.map.highlight.features;
  const districtId = selected[0]?.properties.dongId;
  if (!districtId) throw new Error('순천 공개자료에서 회의 공간 검토 후보를 찾지 못했습니다.');
  const scopedInput = {regionId: 'suncheon', dongId: districtId, question: '주민 회의 공간을 찾아줘'};
  const scoped = await answerRegionQuestion(scopedInput, {env: {}});
  const foreignInput = {regionId: 'suncheon', question: '풍암동 주민 회의 공간을 찾아줘'};
  const foreign = await answerRegionQuestion(foreignInput, {env: {}});
  const assets = seedAssets(pack.facilities, {regionId: 'suncheon', datasetId: 'public-facilities'});
  const workspace = createWorkspace('suncheon', {now: startedAt});
  const query = {dayOfWeek: 6, start: '14:00', end: '17:00'};
  const comparison = compareWorkspace({assets, workspace, query, now: startedAt});
  const directory = await mkdtemp(join(tmpdir(), 'seoguon-region-adoption-'));
  let externalPack;
  try {
    for (const [name, value] of [['manifest.json', pack.profile], ['admin-boundaries.geojson', pack.boundaries], ['facilities.geojson', pack.facilities]]) {
      await writeFile(join(directory, name), JSON.stringify(value));
    }
    externalPack = await validateRegionDirectory(directory);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
  const afterSha256 = Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(resolve(root, path)))])));
  const checks = {
    realDataPack: pack.profile.id === 'suncheon' && pack.profile.sample === false,
    externalPackReproduced: JSON.stringify(externalPack.counts) === JSON.stringify(pack.report.counts),
    returnedOriginalCandidates: selected.length > 0 && selected.every(f => referenceIds.has(f.properties.id)),
    selectedDistrictPreserved: scoped.map.highlight.features.length > 0 && scoped.map.highlight.features.every(f => f.properties.dongId === districtId),
    otherRegionRejected: foreign.structured.queryStatus === 'different-region' && foreign.map.highlight.features.length === 0,
    unverifiedOpeningNotInvented: comparison.baseline.unknownCount === assets.length && comparison.baseline.eligibleCount === 0 && comparison.baseline.comparable === false,
    originalFilesUnchanged: JSON.stringify(afterSha256) === JSON.stringify(originalSha256),
  };
  const summarize = (input, output) => ({input, mode: output.mode, code: output.code || null, structured: output.structured, answer: output.answer,
    sources: output.sources, mapFeatureIds: output.map.highlight.features.map(f => f.properties.id)});
  return {schema: 'seoguon-region-replay-v1', executionKind: 'actual-data-offline-replay', startedAt, finishedAt: new Date().toISOString(),
    appVersion: JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version,
    regionId: 'suncheon', note: '현재 저장소의 실제 공개자료팩을 재현한 기록입니다. 직원 사용실험·현재 시설 개방 검증·새 기관 운영 도입 완료·실제 AI 호출의 증거는 아닙니다.',
    originalSha256, dataValidation: pack.report, externalPackValidation: externalPack,
    tasks: [summarize(broadInput, broad), summarize(scopedInput, scoped), summarize(foreignInput, foreign)],
    openingComparison: {query, selectedCount: comparison.selectedCount, eligibleCount: comparison.baseline.eligibleCount,
      unavailableCount: comparison.baseline.unavailableCount, unknownCount: comparison.baseline.unknownCount, comparable: comparison.baseline.comparable},
    checks, passed: Object.values(checks).every(Boolean)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--out')) throw new Error('사용법: node scripts/validate-region-replay.mjs [--out 결과.json]');
    const output = resolve(args[1] || join(root, 'outputs/region-replay.json'));
    const result = await replaySuncheon();
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({output, passed: result.passed, counts: result.dataValidation.counts, checks: result.checks}, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {console.error(error.message); process.exitCode = 2;}
}
