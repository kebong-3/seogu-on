/** Reviewed installation snapshots and explicitly image-interpreted police reference maps. */
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {publicDataRoot,loadRegionData} from './region-profile.js';
import {registeredRegionId} from '../shared/region-catalog.js';
import {validCoordinate,pointInRegion} from '../shared/region-profile.js';

const cache=new Map();
const routeIds=new Set(['geumho-1','geumho-2','geumho-3','hwajeong-1','hwajeong-2','nongseong-1'].map(id=>'seogu-safe-return-'+id));
const list=value=>Array.isArray(value)?value:[];
const collection=(features,metadata)=>({type:'FeatureCollection',features,metadata});
async function snapshot(root,path,maxBytes=20*1024*1024){
 const base=await realpath(root),actual=await realpath(resolve(base,path));
 if(!actual.startsWith(base+sep)||(await stat(actual)).size>maxBytes)throw Error('Invalid reference file');
 const bytes=await readFile(actual);if(bytes.length>maxBytes)throw Error('Reference file too large');
 return {value:JSON.parse(bytes.toString('utf8')),sha256:createHash('sha256').update(bytes).digest('hex')};
}
function fc(value,regionId){
 if(value?.type!=='FeatureCollection'||!Array.isArray(value.features)||value.features.length>20000||value.metadata?.regionId&&value.metadata.regionId!==regionId)throw Error('Invalid regional collection');
 return value;
}
function sourceFields(p={},meta={}){
 return {sourceName:p.sourceName||meta.sourceName||null,sourceUrl:p.sourceUrl||meta.sourceUrl||null,sourceDate:p.sourceDate||meta.sourceDate||null};
}
function lineCoordinates(feature){
 const geometry=feature?.geometry;
 return geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
}
function validReferenceLine(feature,boundaries){
 const lines=lineCoordinates(feature),p=feature?.properties||{},id=p.routeId||p.id;
 return routeIds.has(id)&&lines.length>0&&lines.length<=100&&lines.every(line=>Array.isArray(line)&&line.length>=2&&line.length<=5000&&line.every(point=>validCoordinate(point)&&pointInRegion(point,boundaries))&&line.some(point=>point[0]!==line[0][0]||point[1]!==line[0][1]));
}
async function load({regionId,publicRoot,boundaries}){
 const metadata={regionId,geometryMeaning:'공개 설치위치 및 공식지도 판독 참고선. 현재 작동·밝기·촬영범위·안전 판정과 구분합니다.',sources:[],errors:[]};
 if(regionId!=='seogu')return {regionId,lights:null,cctv:null,corridors:null,metadata:{...metadata,state:'not-connected'}};
 if(!boundaries)try{boundaries=(await loadRegionData({regionId,publicRoot})).boundaries;}catch{return {regionId,lights:null,cctv:null,corridors:null,metadata:{...metadata,state:'not-connected',errors:['지역 경계 자료 미연결']}};}
 let lights=null,cctv=null,corridors=null;
 const [lightRead,geometryRead,manifestRead]=await Promise.allSettled([
  snapshot(publicRoot,'data/city/official/security-light.geojson'),
  snapshot(publicRoot,'data/walk/seogu/safe-return-image-routes.geojson',2*1024*1024),
  snapshot(publicRoot,'data/decision/seogu/manifest.json',128*1024),
 ]);
 if(lightRead.status==='fulfilled')try{
  const {value,sha256}=lightRead.value,raw=fc(value,regionId),meta=raw.metadata||{};
  const descriptor=manifestRead.status==='fulfilled'?list(manifestRead.value.value.datasets).find(item=>item.id==='security-light'):null;
  if(descriptor?.sha256&&descriptor.sha256!==sha256)throw Error('Snapshot hash mismatch');
  if(!meta.sourceName||!meta.sourceDate||['not-connected','unavailable','error'].includes(meta.state))throw Error('Missing installation evidence');
  const seen=new Set(),features=raw.features.filter(feature=>feature?.geometry?.type==='Point'&&validCoordinate(feature.geometry.coordinates)&&pointInRegion(feature.geometry.coordinates,boundaries)).flatMap((feature,index)=>{
   const key=feature.geometry.coordinates.map(value=>value.toFixed(7)).join(',');if(seen.has(key))return [];seen.add(key);
   const p=feature.properties||{};
   return [{type:'Feature',geometry:{type:'Point',coordinates:[...feature.geometry.coordinates]},properties:{id:String(p.id||'light-'+index),name:p.name||'보안등 수록 위치',...sourceFields(p,meta),facilityType:'security-light',geometryStatus:'published-installation-point'}}];
  });
  if(!features.length)throw Error('No accepted installation coordinates');
  lights=collection(features,{...sourceFields({},meta),regionId,purpose:'public-lighting',complete:meta.complete===true,sourceCount:raw.features.length,sha256,geometryMeaning:'보안등 설치위치와의 근접 참고거리. 실제 조도·점등 여부 또는 어두운 구간을 산정하지 않습니다.'});
  metadata.sources.push({kind:'lights',...lights.metadata,acceptedPoints:features.length});
 }catch{metadata.errors.push('보안등 설치위치 자료 검증 실패');}else metadata.errors.push('보안등 설치위치 자료 미연결');
 if(geometryRead.status==='fulfilled')try{
  const {value,sha256}=geometryRead.value,raw=fc(value,regionId),meta=raw.metadata||{};
  if(meta.geometryStatus!=='image-interpreted'&&meta.coordinateAuthority!=='image-georeferenced-not-official')throw Error('Missing image interpretation metadata');
  const features=raw.features.filter(feature=>validReferenceLine(feature,boundaries)||feature?.geometry?.type==='Point'&&routeIds.has(feature.properties?.routeId)&&validCoordinate(feature.geometry.coordinates)&&pointInRegion(feature.geometry.coordinates,boundaries)).map((feature,index)=>{
   const p=feature.properties||{},uncertainty=Number(p.uncertaintyMeters??meta.uncertaintyMeters);
   return {...feature,properties:{...p,id:p.id||p.routeId+'-point-'+index,routeId:p.routeId||p.id,geometryStatus:'image-interpreted',coordinateAuthority:'image-georeferenced-not-official',uncertaintyMeters:Number.isFinite(uncertainty)&&uncertainty>0?uncertainty:null,...sourceFields(p,meta)}};
  });
  if(!features.length)throw Error('No accepted image reference coordinates');
  corridors=collection(features,{...meta,regionId,sha256,geometryStatus:'image-interpreted',coordinateAuthority:'image-georeferenced-not-official'});
  const cameraPoints=features.filter(feature=>feature.geometry.type==='Point'&&['cctv','cctv-bell'].includes(feature.properties.facilityType));
  if(cameraPoints.length)cctv=collection(cameraPoints,{...sourceFields({},meta),regionId,purpose:'crime-prevention',geometryStatus:'image-interpreted',coordinateAuthority:'image-georeferenced-not-official',geometryMeaning:'경찰 공개지도에 표시된 CCTV 주변 참고위치. 현재 작동·촬영범위·경찰연계 상태를 확인한 자료가 아닙니다.'});
  metadata.sources.push({kind:'corridors',...sourceFields({},meta),sha256,geometryStatus:'image-interpreted',lineFeatures:features.filter(feature=>lineCoordinates(feature).length).length,photoFacilities:features.filter(feature=>feature.geometry.type==='Point').length});
 }catch{metadata.errors.push('귀갓길 지도 판독자료 검증 실패');}else metadata.errors.push('귀갓길 지도 판독자료 미연결');
 // The existing CCTV snapshot is traffic-enforcement data, never a crime-prevention proxy.
 metadata.excludedCctv='교통단속 CCTV 자료는 방범 CCTV·안전도 비교에서 제외합니다.';
 metadata.state=lights||corridors?'partial':'not-connected';
 return {regionId,lights,cctv,corridors,metadata};
}

export async function loadSafeReturnData({regionId='seogu',publicRoot=publicDataRoot,boundaries}={}){
 const id=registeredRegionId(regionId),root=resolve(publicRoot);
 if(root!==resolve(publicDataRoot))return load({regionId:id,publicRoot:root,boundaries});
 const key=root+':'+id;
 if(!cache.has(key))cache.set(key,load({regionId:id,publicRoot:root,boundaries}).catch(error=>{cache.delete(key);throw error;}));
 return cache.get(key);
}
