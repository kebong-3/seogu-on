import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRegionProfile, validateRegionDataPack, safePublicDataPath, RegionProfileError} from '../shared/region-profile.js';
import {allowRead, respond} from './http.js';

const PUBLIC_ROOT = fileURLToPath(new URL('../public/', import.meta.url));
export const publicDataRoot = PUBLIC_ROOT;

async function jsonFile(path, root, maxBytes) {
  const actualRoot = await realpath(root);
  let actual;
  try { actual = await realpath(path); } catch { throw new RegionProfileError('배포에 지역 설정 또는 자료 파일이 없습니다.', 'REGION_FILE_NOT_FOUND'); }
  if (!actual.startsWith(actualRoot + sep)) throw new RegionProfileError('자료 파일이 공개 자료 폴더 밖에 있습니다.', 'INVALID_REGION_PATH');
  const size = (await stat(actual)).size;
  if (size > maxBytes) throw new RegionProfileError('지역 자료의 파일 크기 제한을 초과했습니다.', 'REGION_FILE_TOO_LARGE');
  try { return JSON.parse(await readFile(actual, 'utf8')); } catch { throw new RegionProfileError('지역 설정 또는 자료의 JSON 형식을 확인하세요.', 'INVALID_REGION_JSON'); }
}

/** Server environment chooses a deployment profile; HTTP requests cannot choose arbitrary files. */
export async function loadRegionProfile({env = process.env, publicRoot = PUBLIC_ROOT, allowSample = false} = {}) {
  const id = env.REGION_PROFILE || 'seogu';
  if (typeof id !== 'string' || id.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new RegionProfileError('REGION_PROFILE은 등록한 지역 설정의 영문 식별자여야 합니다.');
  const raw = await jsonFile(resolve(publicRoot, 'data', 'regions', `${id}.json`), publicRoot, 32 * 1024);
  const profile = validateRegionProfile(raw);
  if (profile.id !== id) throw new RegionProfileError('설정 파일 이름과 지역 식별자가 일치하지 않습니다.');
  if (profile.sample && !allowSample) throw new RegionProfileError('합성 예시 지역은 운영 프로필로 사용할 수 없습니다.', 'SAMPLE_REGION_NOT_ENABLED');
  return profile;
}

export async function loadRegionData({env = process.env, publicRoot = PUBLIC_ROOT, allowSample = false, profile: suppliedProfile} = {}) {
  const profile = suppliedProfile ? validateRegionProfile(suppliedProfile) : await loadRegionProfile({env, publicRoot, allowSample});
  if (profile.sample && !allowSample) throw new RegionProfileError('합성 예시 지역은 운영 자료로 사용할 수 없습니다.', 'SAMPLE_REGION_NOT_ENABLED');
  const read = path => jsonFile(resolve(publicRoot, safePublicDataPath(path).slice(1)), publicRoot, 32 * 1024 * 1024);
  const [boundaries, facilities] = await Promise.all([read(profile.boundaryUrl), read(profile.facilitiesUrl)]);
  const report = validateRegionDataPack({profile, boundaries, facilities});
  return {profile, boundaries, facilities, report};
}

/** Routed through api/ai.js to preserve the existing serverless function budget. */
export async function handleRegionProfile(req, res, options = {}) {
  if (!allowRead(req, res)) return;
  try {
    const profile = await loadRegionProfile(options);
    respond(res, 200, {ok: true, profile, loadedAt: new Date().toISOString()});
  } catch (error) {
    respond(res, 503, {ok: false, code: error instanceof RegionProfileError ? error.code : 'REGION_PROFILE_UNAVAILABLE', error: error instanceof RegionProfileError ? error.message : '지역 설정을 불러오지 못했습니다. 배포 설정과 자료를 확인하세요.'});
  }
}
