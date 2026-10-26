/** Reviewed public facility snapshots. Request parameters never choose dataset files. */
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {loadRegionData,publicDataRoot} from './region-profile.js';
import {safePublicDataPath,validCoordinate,validSourceDate,pointInRegion} from '../shared/region-profile.js';
import {WALK_MODE_CATEGORIES} from '../shared/walk-route-model.js';

const SOURCES = Object.freeze({
  seogu: Object.freeze([
    {id:'shade',category:'shade',path:'/data/city/local-shade.geojson'},
    {id:'heat-shelters',category:'shelter',path:'/data/city/official/heat-shelter.geojson'},
    {id:'police',category:'police',path:'/data/city/official/police-official.geojson'},
    {id:'emergency-bell',category:'bell',path:'/data/city/safety-emergency-bell.geojson'},
    {id:'childcare',category:'childcare',path:'/data/decision/seogu/childcare.geojson'},
    {id:'public-spaces',category:'public',path:'/data/layers/public-facilities.geojson'},
  ]),
  suncheon: Object.freeze([
    {id:'shade',category:'shade',path:'/data/decision/suncheon/shade.geojson'},
    {id:'childcare',category:'childcare',path:'/data/decision/suncheon/childcare.geojson'},
    {id:'public-spaces',category:'public',path:'/data/regions/suncheon/facilities.geojson'},
  ]),
});
const NOTES = Object.freeze({
  shade:'공개 그늘막 위치이며 실제 개방·그늘·일사 노출 감소를 확인하지 않았습니다.',
  shelter:'공개 무더위쉼터 위치이며 현재 개방시간·이용대상·운영 상태는 기관 확인이 필요합니다.',
  police:'공개 경찰관서 위치이며 현재 상주·운영 상태와 보행 안전성을 확인하지 않았습니다.',
  bell:'공개 비상벨 설치위치이며 현재 작동·신고 연결·접근성을 확인하지 않았습니다.',
  childcare:'공시 어린이집 대표위치이며 현재 운영·방문 가능 여부·입소 가능 자리는 기관 확인이 필요합니다.',
  public:'공개 개방공간 대표위치이며 현재 개방·예약·대관 가능 여부는 기관 확인이 필요합니다.',
});
const bad=(message,code='INVALID_WALK_DATA')=>Object.assign(new Error(message),{code,status:503});
const text=value=>typeof value === 'string' ? value.trim() : '';
const coordinateKey=point=>point.join(',');
const compareText=(a,b)=>a < b ? -1 : a > b ? 1 : 0;
const MAX_BYTES=8*1024*1024;
const LIMIT=5000;

function sourceUrl(value) {
  const raw=text(value);let parsed;
  try {parsed=new URL(raw);} catch {throw bad('공개시설 원자료의 출처 주소를 확인하세요.','WALK_SOURCE_MISMATCH');}
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw bad('공개시설 출처 주소에 인증정보 또는 지원하지 않는 형식이 있습니다.','WALK_SOURCE_MISMATCH');
  return raw;
}
async function readJSON(path,publicRoot,maxBytes=MAX_BYTES) {
  const root=await realpath(publicRoot);let actual;
  try {actual=await realpath(resolve(root,safePublicDataPath(path).slice(1)));} catch(error) {if(error.code==='ENOENT')throw bad('배포된 보행 검토용 공개시설 자료가 없습니다.','WALK_DATA_NOT_FOUND');throw error;}
  if (!actual.startsWith(root+sep)) throw bad('보행 검토 자료가 공개 자료 폴더 밖에 있습니다.','INVALID_WALK_PATH');
  if ((await stat(actual)).size > maxBytes) throw bad('보행 검토 자료의 파일 크기 제한을 초과했습니다.','WALK_DATA_TOO_LARGE');
  const bytes=await readFile(actual);
  if (bytes.length > maxBytes) throw bad('보행 검토 자료의 파일 크기 제한을 초과했습니다.','WALK_DATA_TOO_LARGE');
  let value;try {value=JSON.parse(bytes.toString('utf8'));} catch {throw bad('보행 검토용 공개시설 자료의 JSON 형식을 확인하세요.');}
  return {value,sha256:createHash('sha256').update(bytes).digest('hex')};
}
function boundaryGeometry(boundaries) {
  const coordinates=boundaries.features.flatMap(feature=>feature.geometry.type==='Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates);
  return {type:'MultiPolygon',coordinates};
}
function recordSource(properties,metadata,descriptor) {
  const name=text(properties.sourceName)||text(metadata.sourceName)||text(descriptor.sourceName);
  if (!name) throw bad('공개시설의 제공기관 이름이 없습니다.','WALK_SOURCE_MISMATCH');
  const date=Object.hasOwn(properties,'sourceDate') ? properties.sourceDate : Object.hasOwn(metadata,'sourceDate') ? metadata.sourceDate : descriptor.sourceDate;
  if (date != null && date !== '' && !validSourceDate(date)) throw bad('공개시설 원자료의 기준일 형식을 확인하세요.','WALK_SOURCE_MISMATCH');
  return {sourceName:name,sourceUrl:sourceUrl(properties.sourceUrl||metadata.sourceUrl||descriptor.sourceUrl),sourceDate:date || null,collectedAt:properties.collectedAt||metadata.collectedAt||metadata.retrievedAt||descriptor.collectedAt||null};
}

export async function loadWalkCandidates({regionId,env=process.env,publicRoot=publicDataRoot}={}) {
  const pack=await loadRegionData({regionId,env,publicRoot});
  if (!Object.hasOwn(SOURCES,pack.profile.id)) throw bad('보행 검토용 공개시설을 검증하지 않은 지역입니다.','WALK_REGION_NOT_SUPPORTED');
  const {profile,boundaries,facilities}=pack;
  for (const raw of [boundaries,facilities]) if (raw.metadata?.regionId && raw.metadata.regionId!==profile.id) throw bad('선택 지역과 경계·공공공간 자료의 지역이 일치하지 않습니다.','WALK_REGION_MISMATCH');
  for (const feature of boundaries.features) {
    const p=feature.properties||{};
    if (!String(p.dongId||'').startsWith(`${profile.id}-`) || (p.adm_cd2 && !String(p.adm_cd2).startsWith(profile.jurisdictionCode)) || (p.sgg && String(p.sgg)!==profile.jurisdictionCode)) throw bad('선택 지역과 실제 행정경계의 식별자가 일치하지 않습니다.','WALK_REGION_MISMATCH');
  }
  const {value:manifest}=await readJSON(`/data/decision/${profile.id}/manifest.json`,publicRoot,128*1024);
  if (manifest.regionId!==profile.id || !Array.isArray(manifest.datasets)) throw bad('선택 지역과 공개시설 자료 목록이 일치하지 않습니다.','WALK_REGION_MISMATCH');
  const descriptorIds=new Set();
  for (const descriptor of manifest.datasets) {
    if (!descriptor || typeof descriptor.id!=='string' || descriptorIds.has(descriptor.id)) throw bad('공개시설 자료 목록에 중복 또는 잘못된 식별자가 있습니다.');
    descriptorIds.add(descriptor.id);
  }
  const candidates=[],sourceStatus=[],identity=new Map();
  for (const spec of SOURCES[profile.id]) {
    const descriptor=manifest.datasets.find(item=>item.id===spec.id);
    if (!descriptor) {sourceStatus.push({datasetId:spec.id,category:spec.category,state:'not-connected',records:null,candidates:null});continue;}
    if (descriptor.path!==spec.path || descriptor.regionId && descriptor.regionId!==profile.id) throw bad('검증된 지역별 공개시설 경로와 자료 목록이 일치하지 않습니다.','WALK_REGION_MISMATCH');
    const {value:raw,sha256}=await readJSON(spec.path,publicRoot),meta=raw.metadata||{};
    if (raw.type!=='FeatureCollection' || !Array.isArray(raw.features) || raw.features.length>20000) throw bad('보행 검토용 시설자료의 형식·건수를 확인하세요.');
    if (meta.regionId && meta.regionId!==profile.id) throw bad('다른 지역의 공개시설이 보행 후보에 포함되어 있습니다.','WALK_REGION_MISMATCH');
    if (descriptor.sha256 && descriptor.sha256!==sha256) throw bad('검증된 공개시설 원자료의 해시가 일치하지 않습니다.','WALK_SOURCE_MISMATCH');
    for (const key of ['sourceName','sourceUrl','sourceDate']) if (descriptor[key] && meta[key] && descriptor[key]!==meta[key]) throw bad('공개시설 목록과 원자료의 출처·기준일이 일치하지 않습니다.','WALK_SOURCE_MISMATCH');
    if (['not-connected','unavailable','error'].includes(meta.state)) {sourceStatus.push({datasetId:spec.id,category:spec.category,state:'not-connected',records:null,candidates:null});continue;}
    const status={datasetId:spec.id,category:spec.category,state:'available',records:raw.features.length,candidates:0,duplicates:0,omittedNonPoint:0,sourceName:text(meta.sourceName)||descriptor.sourceName||null,sourceDate:meta.sourceDate??descriptor.sourceDate??null,sha256};
    const seenIds=new Map();
    for (const feature of raw.features) {
      if (feature?.geometry?.type!=='Point') {status.omittedNonPoint++;continue;}
      const coordinate=feature.geometry.coordinates;
      if (!validCoordinate(coordinate) || !pointInRegion(coordinate,boundaries)) throw bad('공개시설 좌표가 실제 지역경계 밖이거나 유효하지 않습니다.','WALK_REGION_MISMATCH');
      const p=feature.properties||{};
      if (p.regionId && p.regionId!==profile.id) throw bad('공개시설 항목의 지역과 선택 지역이 일치하지 않습니다.','WALK_REGION_MISMATCH');
      const sourceId=text(p.id)||text(String(feature.id??'')),name=text(p.name)||text(p.facilityName);
      if (!sourceId || sourceId.length>240 || !name || name.length>500) throw bad('공개시설의 원문 식별자·이름을 확인하세요.');
      const id=`walk:${profile.id}:${spec.category}:${sourceId}`,record=recordSource(p,meta,descriptor);
      const signature=JSON.stringify([name,coordinate,record.sourceName,record.sourceDate]);
      if (seenIds.has(sourceId)) {
        if (seenIds.get(sourceId)!==signature) throw bad('같은 공개시설 식별자에 서로 다른 이름·좌표·기준일이 있습니다.','WALK_SOURCE_MISMATCH');
        status.duplicates++;continue;
      }
      seenIds.set(sourceId,signature);
      const key=JSON.stringify([spec.category,name,coordinateKey(coordinate),text(p.address)]);
      if (identity.has(key)) {const previous=identity.get(key);previous.sourceIds.push(sourceId);previous.sourceRefs.push({datasetId:spec.id,sourceId,...record});status.duplicates++;continue;}
      const locationDescription=text(p.locationDescription)||text(p.sourceAttributes?.['설치위치']);
      const routeEligible=spec.category!=='bell';
      const note=[text(p.note),text(p.geometryMeaning)||text(meta.geometryMeaning),locationDescription?`원문 설치위치: ${locationDescription}.`:'',NOTES[spec.category],!routeEligible?'출입구·공공 통행 가능 여부가 검수되지 않아 경유지로 선택할 수 없는 참고 위치입니다.':'','공개 대표좌표이며 실제 출입구·보행 접근성은 검수하지 않았습니다.'].filter(Boolean).join(' ');
      const candidate={id,name,category:spec.category,coordinate:[...coordinate],...record,note,address:text(p.address)||text(p.roadAddress)||text(p.lotAddress)||null,datasetId:spec.id,sourceId,sourceIds:[sourceId],sourceRefs:[{datasetId:spec.id,sourceId,...record}],routeEligible,locationDescription:locationDescription||null,modes:routeEligible?Object.keys(WALK_MODE_CATEGORIES).filter(mode=>WALK_MODE_CATEGORIES[mode].includes(spec.category)):[]};
      identity.set(key,candidate);candidates.push(candidate);status.candidates++;
      if (candidates.length>LIMIT) throw bad('검토 가능한 공개시설 후보가 5,000개를 초과했습니다.','WALK_DATA_TOO_LARGE');
    }
    if (!raw.features.length && meta.complete!==true && descriptor.complete!==true) {status.state='not-connected';status.candidates=null;}
    sourceStatus.push(status);
  }
  candidates.sort((a,b)=>compareText(a.category,b.category)||compareText(a.name,b.name)||compareText(a.id,b.id));
  return {profile,geometry:boundaryGeometry(boundaries),boundaries,candidates,sourceStatus,limitations:[
    '공개 수록시설의 대표좌표이며 실제 출입구·보행 접근성·현재 개방·운영·작동 상태를 확인하지 않았습니다.',
    '그늘·안심 경유는 해당 종류의 시설을 지나는 비교안입니다. 연속 그늘길·범죄위험·안전한 경로를 산정하지 않습니다.',
    '어린이집 공시 정원·현원으로 현재 방문·입소 가능 여부를 판단하지 않습니다. 기관 확인이 필요합니다.',
    '수록되지 않은 시설이 실제로 없다는 뜻이 아닙니다. 교통단속 CCTV·보안등 개수는 안심 경유점 또는 안전 점수로 사용하지 않습니다.',
  ]};
}
