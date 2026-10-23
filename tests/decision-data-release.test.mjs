import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateDecisionPacks} from '../scripts/validate-decision-data.mjs';
import {facilityFiles} from '../scripts/data/lib/files.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC = join(ROOT, 'public');

test('regional decision packs bypass Seo-gu-only ingest and pass their own actual-data release gate', async () => {
  const legacy = facilityFiles(ROOT);
  assert.ok(legacy.includes('public/data/city/local-shade.geojson'));
  assert.ok(legacy.every(path => !path.includes('/decision/')));
  const reports = await validateDecisionPacks();
  assert.deepEqual(reports.map(report => report.regionId), ['seogu', 'suncheon']);
  for (const report of reports) {
    assert.equal(report.ok, true);
    assert.match(report.manifestSha256, /^[a-f0-9]{64}$/);
    assert.ok(report.datasets.length > 0 && report.presets.length > 0);
    for (const data of report.datasets) {
      assert.ok(data.acceptedPoints >= data.uniqueLocations);
      assert.match(data.sha256, /^[a-f0-9]{64}$/);
    }
    for (const preset of report.presets) {
      assert.deepEqual(preset.workflows, ['coverage', 'inspection', 'site']);
      assert.equal(preset.existingServiceExclusionChecked, true);
      assert.equal(preset.proposalRemovalChecks, preset.proposals);
    }
  }
});

test('release gate catches a foreign feature region and falsified coordinate count even with updated manifest hashes', async () => {
  const publicRoot = await mkdtemp(join(tmpdir(), 'decision-release-gate-'));
  try {
    const profile = JSON.parse(await readFile(join(PUBLIC, 'data/regions/seogu.json'), 'utf8'));
    const manifestPath = 'data/decision/seogu/manifest.json';
    const manifest = JSON.parse(await readFile(join(PUBLIC, manifestPath), 'utf8'));
    const paths = new Set(['data/regions/seogu.json', profile.boundaryUrl.slice(1), profile.facilitiesUrl.slice(1), manifestPath, ...manifest.datasets.map(source => source.path.slice(1))]);
    for (const path of paths) {await mkdir(dirname(join(publicRoot, path)), {recursive: true}); await copyFile(join(PUBLIC, path), join(publicRoot, path));}
    const source = manifest.datasets.find(item => item.id === 'schools');
    const schoolPath = join(publicRoot, source.path.slice(1));
    const original = JSON.parse(await readFile(schoolPath, 'utf8'));
    const save = async data => {
      const text = JSON.stringify(data);
      source.sha256 = createHash('sha256').update(text).digest('hex');
      await writeFile(schoolPath, text);
      await writeFile(join(publicRoot, manifestPath), JSON.stringify(manifest));
    };
    const foreign = structuredClone(original); foreign.features[0].properties.regionId = 'suncheon';
    await save(foreign);
    await assert.rejects(() => validateDecisionPacks({publicRoot}), error => error.code === 'DECISION_RELEASE_INVALID' && /regionId|다른 지역/.test(error.message));
    const misleadingCount = structuredClone(original); misleadingCount.metadata.uniqueCoordinates++;
    await save(misleadingCount);
    await assert.rejects(() => validateDecisionPacks({publicRoot}), error => error.code === 'DECISION_RELEASE_INVALID' && /uniqueCoordinates/.test(error.message));
  } finally {await rm(publicRoot, {recursive: true, force: true});}
});
