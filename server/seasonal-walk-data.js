/** Fixed, reviewed snapshots only. Requests cannot choose paths or external URLs. */
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {publicDataRoot} from './region-profile.js';
import {registeredRegionId} from '../shared/region-catalog.js';

const bad=message=>Object.assign(new Error(message),{code:'SEASONAL_DATA_INVALID',status:503});
async function readSnapshot(root,path,maxBytes){
  const base=await realpath(root),actual=await realpath(resolve(base,path));
  if(!actual.startsWith(base+sep)||(await stat(actual)).size>maxBytes)throw bad('계절 보행자료의 경로·크기 제한을 확인하세요.');
  const bytes=await readFile(actual);if(bytes.length>maxBytes)throw bad('계절 보행자료가 크기 제한을 초과했습니다.');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw bad('계절 보행자료의 JSON 형식을 확인하세요.');}
  return {value,sha256:createHash('sha256').update(bytes).digest('hex')};
}
function collection(value,kind,limit){
  if(value?.type!=='FeatureCollection'||!Array.isArray(value.features)||value.features.length>limit)throw bad('계절 보행자료의 항목 수·형식을 확인하세요.');
  if(value.features.some(f=>f?.type!=='Feature'||!(kind==='buildings'?['Polygon','MultiPolygon']:['Point']).includes(f.geometry?.type)))throw bad('계절 보행자료의 도형 종류를 확인하세요.');
  return value;
}

export async function loadSeasonalWalkData({regionId='seogu',publicRoot=publicDataRoot}={}){
  const id=registeredRegionId(regionId);
  // Other deployments do not inherit Seo-gu geometry or an invented empty hazard layer.
  if(id!=='seogu')return {buildings:{type:'FeatureCollection',features:[]},coverageGeometry:null,icing:null,
    metadata:{regionId:id,state:'not-connected',coverage:'선택 지역의 건물 높이·결빙관리점 자료 미연결'}};
  const [buildingSnapshot,icingSnapshot]=await Promise.all([
    readSnapshot(publicRoot,'data/city/model/buildings.geojson',8*1024*1024),
    readSnapshot(publicRoot,'data/city/local-icing.geojson',2*1024*1024),
  ]);
  const buildings=collection(buildingSnapshot.value,'buildings',15000),icing=collection(icingSnapshot.value,'icing',1000);
  for(const data of [buildings,icing])if(data.metadata?.regionId&&data.metadata.regionId!==id)throw bad('계절 보행자료와 선택 지역이 일치하지 않습니다.');
  if(buildings.metadata?.sourceName!=='OpenStreetMap contributors'||!buildings.metadata?.heightRule)throw bad('건물 원자료의 높이 근거를 확인하지 못했습니다.');
  if(icing.features.some(f=>!Array.isArray(f.geometry.coordinates)||f.geometry.coordinates.length!==2||!f.geometry.coordinates.every(Number.isFinite)||f.properties?.inDistrict!==true))throw bad('결빙관리점의 검수 좌표를 확인하지 못했습니다.');
  return {buildings,coverageGeometry:null,icing,
    metadata:{regionId:id,state:'partial',buildingSource:buildings.metadata,icingSource:icing.metadata,
      buildingSha256:buildingSnapshot.sha256,icingSha256:icingSnapshot.sha256,
      coverage:'수록 건물·높이의 전수 범위가 확인되지 않아 부분 그늘만 계산합니다. 행정경계를 완전한 건물모형 범위로 대체하지 않습니다.',
      icingMeaning:'공식 관리구간의 시작·종료 대표지점 주변 거리입니다. 두 점을 임의 연결하지 않으며 현재 보도 결빙 여부·확률을 뜻하지 않습니다.'}};
}

export async function loadSafeReturnReferences({regionId='seogu',publicRoot=publicDataRoot}={}){
  if(registeredRegionId(regionId)!=='seogu')return null;
  const {value}=await readSnapshot(publicRoot,'data/walk/seogu/safe-return-reference.json',64*1024);
  const allowed=url=>{try{return new URL(url).origin==='https://www.gjpolice.go.kr';}catch{return false;}};
  if(value?.geometryAvailable!==false||value.georeferencingStatus!=='official-map-only'||!allowed(value.sourceUrl)||!Array.isArray(value.routes)||value.routes.length!==6||value.routes.some(r=>!r.id||!r.name||!allowed(r.sourceUrl)||r.geometry||r.coordinates))throw bad('공식 여성안심귀갓길 참고자료를 확인하세요.');
  return value;
}
