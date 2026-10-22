import {readFile, stat, realpath} from 'node:fs/promises';
import {resolve, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRegionDataPack} from '../shared/region-profile.js';
import {loadRegionData} from '../server/region-profile.js';

/** Inspection only: no file changes, upstream requests, deployment, or source repairs. */
export async function validateRegionDirectory(directory) {
  const root = await realpath(resolve(directory));
  const read = async name => {
    const path = await realpath(resolve(root, name));
    if (path !== resolve(root, name)) throw Error('지역 패키지의 파일은 폴더 안의 실제 파일이어야 합니다.');
    if ((await stat(path)).size > 32 * 1024 * 1024) throw Error('지역 패키지 파일은 32MiB 이하로 준비하세요.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const [profile, boundaries, facilities] = await Promise.all([read('manifest.json'), read('admin-boundaries.geojson'), read('facilities.geojson')]);
  if (basename(profile.boundaryUrl || '') !== 'admin-boundaries.geojson' || basename(profile.facilitiesUrl || '') !== 'facilities.geojson') throw Error('지역 패키지의 자료 경로는 admin-boundaries.geojson 및 facilities.geojson 파일과 연결해야 합니다.');
  return validateRegionDataPack({profile, boundaries, facilities});
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 2 && args[0] === '--profile') return (await loadRegionData({env: {REGION_PROFILE: args[1]}})).report;
  if (args.length === 1 && !args[0].startsWith('-')) return validateRegionDirectory(args[0]);
  throw Error('사용법: node scripts/validate-region.mjs --profile seogu  또는  node scripts/validate-region.mjs /지역자료폴더');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ok: false, error: error.message, code: error.code || 'REGION_VALIDATION_FAILED'}, null, 2)); process.exitCode = 1; }
}
