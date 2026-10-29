import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {loadSafeReturnData} from '../server/safe-return-data.js';

const id='seogu-safe-return-geumho-1',inside=[126.855,35.15],outside=[129,35.15];
const collection=(features,metadata={})=>({type:'FeatureCollection',features,metadata});
const point=(coordinates,properties={})=>({type:'Feature',geometry:{type:'Point',coordinates},properties});
const boundaries=collection([{type:'Feature',geometry:{type:'Polygon',coordinates:[[[126.84,35.14],[126.87,35.14],[126.87,35.16],[126.84,35.16],[126.84,35.14]]]},properties:{}}]);
const lights=()=>collection([point(inside,{id:'light-1'}),point(inside,{id:'duplicate-light'}),point(outside),point(['126.85','35.15'])],{regionId:'seogu',sourceName:'TEST ONLY 공식 보안등',sourceUrl:'https://example.org/lights',sourceDate:'2026-08-06',complete:false});
const waypoints=[[126.851,35.151],[126.859,35.151]].map(coordinate=>({coordinate,accessVerification:'mapped-public-road',verificationNote:'TEST ONLY mapped street',sourceUrl:'https://www.openstreetmap.org/node/1',highway:'residential'}));
const image=()=>collection([
  {type:'Feature',geometry:{type:'MultiLineString',coordinates:[waypoints.map(item=>item.coordinate)]},properties:{id,routeId:id,name:'금호1 지도 판독선',uncertaintyMeters:35,routingWaypoints:waypoints}},
  point(inside,{id:id+'-camera',routeId:id,facilityType:'cctv-bell',uncertaintyMeters:40}),
  point([126.856,35.15],{id:id+'-sign',routeId:id,facilityType:'route-sign'}),
  point(outside,{id:id+'-outside',routeId:id,facilityType:'cctv'}),
],{regionId:'seogu',sourceName:'TEST ONLY 경찰지도',sourceUrl:'https://www.gjpolice.go.kr/test',sourceDate:'2026-08-13',geometryStatus:'image-interpreted',coordinateAuthority:'image-georeferenced-not-official',uncertaintyMeters:35});
const paths={lights:'data/city/official/security-light.geojson',image:'data/walk/seogu/safe-return-image-routes.geojson',manifest:'data/decision/seogu/manifest.json'};
async function fixture(t,{lightData=lights(),imageData=image(),manifest}={}){
  const root=await mkdtemp(join(tmpdir(),'seogu-safe-return-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const write=async(path,value)=>{const target=join(root,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,typeof value==='string'?value:JSON.stringify(value));return target;};
  if(lightData!==null)await write(paths.lights,lightData);
  if(imageData!==null)await write(paths.image,imageData);
  const hash=lightData===null?'not-present':createHash('sha256').update(JSON.stringify(lightData)).digest('hex');
  await write(paths.manifest,manifest||{regionId:'seogu',datasets:[{id:'security-light',path:'/data/city/official/security-light.geojson',sha256:hash}]});
  return {root,write,load:extra=>loadSafeReturnData({regionId:'seogu',publicRoot:root,boundaries,...extra})};
}

test('loader keeps distinct in-region installations, source date and verified waypoint evidence without rewriting photo geometry',async t=>{
  const f=await fixture(t),result=await f.load();
  assert.equal(result.regionId,'seogu');assert.equal(result.metadata.state,'partial');assert.equal(result.lights.features.length,1);
  assert.equal(result.lights.metadata.sourceCount,4);assert.equal(result.lights.metadata.sourceDate,'2026-08-06');assert.equal(result.lights.metadata.complete,false);
  assert.deepEqual(result.corridors.features[0].properties.routingWaypoints,waypoints);
  assert.equal(result.corridors.features[0].properties.uncertaintyMeters,35);assert.equal(result.corridors.features[0].properties.coordinateAuthority,'image-georeferenced-not-official');
  assert.equal(result.cctv.features.length,1);assert.equal(result.cctv.features[0].properties.facilityType,'cctv-bell');
  assert.equal(result.cctv.metadata.geometryStatus,'image-interpreted');assert.match(result.cctv.metadata.geometryMeaning,/現在|현재 작동/);
  assert.ok(result.corridors.features.every(feature=>feature.geometry.type!=='Point'||feature.geometry.coordinates[0]!==129));
});

test('missing or malformed snapshots stay unavailable instead of inventing zero support coverage',async t=>{
  const f=await fixture(t,{lightData:null,imageData:null}),missing=await f.load();
  assert.equal(missing.lights,null);assert.equal(missing.cctv,null);assert.equal(missing.corridors,null);assert.equal(missing.metadata.state,'not-connected');
  await f.write(paths.lights,'{not-json');await f.write(paths.image,{type:'FeatureCollection',features:'not-an-array'});
  const malformed=await f.load();assert.equal(malformed.lights,null);assert.equal(malformed.cctv,null);assert.equal(malformed.corridors,null);assert.equal(malformed.metadata.state,'not-connected');
});

test('wrong region snapshots and out-of-region image lines are rejected rather than imported under the selected city',async t=>{
  const wrongLights=lights();wrongLights.metadata.regionId='suncheon';
  const wrongImage=image();wrongImage.metadata.regionId='suncheon';
  const f=await fixture(t,{lightData:wrongLights,imageData:wrongImage}),result=await f.load();
  assert.equal(result.lights,null);assert.equal(result.corridors,null);assert.equal(result.metadata.state,'not-connected');
  const outsideImage=image();outsideImage.features=[{type:'Feature',geometry:{type:'LineString',coordinates:[outside,[129.001,35.15]]},properties:{id,routeId:id}}];
  await f.write(paths.image,outsideImage);const filtered=await f.load();
  assert.equal(filtered.corridors,null);assert.equal(filtered.cctv,null);
});

test('a manifest hash mismatch withholds the installation layer while independent image evidence remains separate',async t=>{
  const f=await fixture(t,{manifest:{regionId:'seogu',datasets:[{id:'security-light',sha256:'0'.repeat(64)}]}}),result=await f.load();
  assert.equal(result.lights,null);assert.ok(result.corridors.features.length>0);assert.match(result.metadata.errors.join(' '),/보안등 설치위치 자료 검증 실패/);
});

test('only fixed snapshot paths are read and a symlink outside the public root is rejected',async t=>{
  const f=await fixture(t,{lightData:null,imageData:null}),outsideDir=await mkdtemp(join(tmpdir(),'seogu-safe-return-outside-'));t.after(()=>rm(outsideDir,{recursive:true,force:true}));
  const outsideFile=join(outsideDir,'private-reference.json');await writeFile(outsideFile,JSON.stringify(lights()));
  await mkdir(dirname(join(f.root,paths.lights)),{recursive:true});await symlink(outsideFile,join(f.root,paths.lights));
  const result=await f.load({path:outsideFile,url:'https://attacker.invalid/data.json',lightPath:outsideFile});
  assert.equal(result.lights,null);assert.equal(result.corridors,null);assert.equal(result.metadata.state,'not-connected');
  assert.doesNotMatch(JSON.stringify(result),/private-reference|attacker/);
});

test('oversized snapshots fail before parsing and a different supported region never inherits Seo-gu photo facilities',async t=>{
  const f=await fixture(t,{imageData:null});await truncate(join(f.root,paths.lights),20*1024*1024+1);
  const oversized=await f.load();assert.equal(oversized.lights,null);assert.equal(oversized.metadata.state,'not-connected');
  const other=await f.load({regionId:'suncheon'});assert.equal(other.regionId,'suncheon');assert.equal(other.lights,null);assert.equal(other.cctv,null);assert.equal(other.corridors,null);
});

test('traffic-enforcement snapshot files never become crime-prevention camera support',async t=>{
  const f=await fixture(t,{imageData:null});await f.write('data/city/safety-cctv.geojson',collection([point(inside,{facilityType:'cctv'})],{sourceName:'교통단속 CCTV',purpose:'traffic-enforcement'}));
  const result=await f.load();assert.equal(result.cctv,null);assert.ok(result.lights.features.length>0);assert.match(result.metadata.excludedCctv,/교통단속 CCTV.*제외/);
});
