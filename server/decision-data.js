/** Server-owned, region-bound allowlist for decision datasets. No request supplies a path. */
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {loadRegionData,publicDataRoot} from './region-profile.js';
import {safePublicDataPath} from '../shared/region-profile.js';

const bad=(message,code='INVALID_DECISION_DATA')=>Object.assign(new Error(message),{code,status:503});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const MAX_BYTES=16*1024*1024;

async function readJSON(path,publicRoot,maxBytes=MAX_BYTES) {
  const root=await realpath(publicRoot);
  let actual;
  try{actual=await realpath(resolve(root,safePublicDataPath(path).slice(1)));}
  catch(error){if(error.code==='ENOENT')throw bad('배포된 업무 검토 자료 파일이 없습니다.','DECISION_DATA_NOT_FOUND');throw error;}
  if(!actual.startsWith(root+sep))throw bad('업무 자료 경로가 공개 자료 폴더 밖에 있습니다.');
  if((await stat(actual)).size>maxBytes)throw bad('업무 자료는 파일별 16MB 이하여야 합니다.','DECISION_DATA_TOO_LARGE');
  const bytes=await readFile(actual);
  if(bytes.length>maxBytes)throw bad('업무 자료의 파일 크기 제한을 초과했습니다.','DECISION_DATA_TOO_LARGE');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw bad('업무 자료의 JSON 형식을 확인하세요.');}
  return {value,sha256:createHash('sha256').update(bytes).digest('hex')};
}

export async function loadDecisionData({regionId,publicRoot=publicDataRoot,env=process.env}={}) {
  const pack=await loadRegionData({regionId,publicRoot,env});
  const {value:manifest,sha256:manifestSha256}=await readJSON(`/data/decision/${pack.profile.id}/manifest.json`,publicRoot,128*1024);
  if(!plain(manifest)||manifest.regionId!==pack.profile.id||!manifest.version)throw bad('업무 자료 목록과 선택 지역이 일치하지 않습니다.','DECISION_REGION_MISMATCH');
  if(!Array.isArray(manifest.datasets)||!manifest.datasets.length||manifest.datasets.length>24||!Array.isArray(manifest.presets)||!manifest.presets.length||manifest.presets.length>20)throw bad('업무 자료 목록과 검토 조건을 확인하세요.');
  const ids=new Set(),paths=new Set();
  for(const source of manifest.datasets) {
    if(!plain(source)||typeof source.id!=='string'||!/^[a-z][a-z0-9_-]{0,79}$/.test(source.id)||ids.has(source.id)||typeof source.title!=='string'||!source.title.trim())throw bad('업무 자료 식별자와 제목을 확인하세요.');
    ids.add(source.id);
    const path=safePublicDataPath(source.path);
    if(!path.endsWith('.geojson')||paths.has(path))throw bad('업무 자료 경로나 중복 등록을 확인하세요.');paths.add(path);
    if(source.regionId&&source.regionId!==pack.profile.id)throw bad('다른 지역의 업무 자료를 사용할 수 없습니다.','DECISION_REGION_MISMATCH');
  }
  const presets=new Set();
  for(const preset of manifest.presets) {
    if(!plain(preset)||typeof preset.id!=='string'||!preset.id||presets.has(preset.id)||!ids.has(preset.target)||!ids.has(preset.service)||!Number.isFinite(preset.radiusM)||preset.radiusM<50||preset.radiusM>2000)throw bad('검토 조건의 자료 분류·반경을 확인하세요.');presets.add(preset.id);
  }
  if(!presets.has(manifest.defaultPreset)||!Array.isArray(manifest.contextDatasetIds)||manifest.contextDatasetIds.some(id=>!ids.has(id))||new Set(manifest.contextDatasetIds).size!==manifest.contextDatasetIds.length)throw bad('기본 검토 조건과 주변 자료 목록을 확인하세요.');
  const results=await Promise.all(manifest.datasets.map(async source=>{
    const {value,sha256}=await readJSON(source.path,publicRoot);
    if(value?.type!=='FeatureCollection'||!Array.isArray(value.features))throw bad(`${source.title}: GeoJSON 자료 형식이 올바르지 않습니다.`);
    const meta=value.metadata||{};
    if(meta.regionId&&meta.regionId!==pack.profile.id)throw bad(`${source.title}: 자료 지역이 현재 지역과 다릅니다.`,'DECISION_REGION_MISMATCH');
    for(const key of ['sourceName','sourceUrl','sourceDate']) {
      if(source[key]&&meta[key]&&source[key]!==meta[key])throw bad(`${source.title}: 목록과 원문 자료의 ${key}가 일치하지 않습니다.`,'DECISION_SOURCE_MISMATCH');
    }
    if(source.sha256&&source.sha256!==sha256)throw bad(`${source.title}: 검증된 원문 파일과 해시가 일치하지 않습니다.`,'DECISION_SOURCE_MISMATCH');
    return [source.id,{...value,sha256}];
  }));
  return {...pack,manifest:{...manifest,sha256:manifestSha256},datasets:Object.fromEntries(results)};
}
