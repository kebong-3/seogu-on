import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pointInRegion,validCoordinate} from '../shared/region-profile.js';
import {loadSafeReturnData} from '../server/safe-return-data.js';
const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));

test('the six image-interpreted routes match the official reference identities and stay within the actual city boundary',async()=>{
 const [geometry,reference,boundaries]=await Promise.all([read('public/data/walk/seogu/safe-return-image-routes.geojson'),read('public/data/walk/seogu/safe-return-reference.json'),read('public/data/admin-dongs.geojson')]);
 const lines=geometry.features.filter(feature=>feature.geometry.type!=='Point');
 assert.equal(lines.length,6);assert.deepEqual(lines.map(feature=>feature.properties.id),reference.routes.map(route=>route.id));
 assert.equal(geometry.metadata.coordinateAuthority,'image-georeferenced-not-official');assert.equal(geometry.metadata.sourceDate,'2026-08');
 for(const feature of geometry.features){
  const coordinates=feature.geometry.type==='Point'?[feature.geometry.coordinates]:feature.geometry.coordinates.flat();
  assert.ok(coordinates.every(coordinate=>validCoordinate(coordinate)&&pointInRegion(coordinate,boundaries)),feature.properties.name);
  assert.equal(feature.properties.geometryStatus,'image-interpreted');
  if(feature.geometry.type==='Point')assert.equal(feature.properties.routeEligible,false,'a picture icon must not become a walking waypoint');
 }
 for(const feature of lines){
  assert.ok(feature.properties.controlPointCount>=4);assert.ok(feature.properties.uncertaintyMeters>=20&&feature.properties.uncertaintyMeters<=100);
  assert.equal(feature.properties.publicRoadConfirmed,false,'the whole picture line is not surveyed or field-confirmed');
  assert.equal(feature.properties.routingWaypoints.length,2);
  for(const waypoint of feature.properties.routingWaypoints){assert.equal(waypoint.accessVerification,'mapped-public-road');assert.match(waypoint.sourceUrl,/^https:\/\/www\.openstreetmap\.org\/node\/\d+$/);assert.ok(waypoint.verificationNote);assert.ok(pointInRegion(waypoint.coordinate,boundaries));}
 }
});

test('production loader keeps photo annotations, lighting and traffic cameras as distinct evidence',async()=>{
 const data=await loadSafeReturnData();assert.equal(data.corridors.features.filter(feature=>feature.geometry.type!=='Point').length,6);
 assert.ok(data.lights.features.length>0);assert.equal(data.lights.metadata.sourceDate,'2026-08-06');
 assert.equal(data.cctv.metadata.geometryStatus,'image-interpreted');assert.ok(data.cctv.features.every(feature=>['cctv','cctv-bell'].includes(feature.properties.facilityType)));
 assert.match(data.metadata.excludedCctv,/교통단속/);assert.deepEqual(data.metadata.errors,[]);
 const nongseong=data.corridors.features.find(feature=>feature.properties.id==='seogu-safe-return-nongseong-1');
 assert.ok(nongseong.properties.sourceAuxiliaryGeometry);assert.match(nongseong.properties.sourceAuxiliaryNote,/합치지 않고/);
});
