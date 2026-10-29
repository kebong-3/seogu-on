import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnMapFeatures} from '../src/city/safe-return-display.js';

const first='seogu-safe-return-geumho-1',second='seogu-safe-return-nongseong-1';
const line=(id,type='MultiLineString')=>({type:'Feature',geometry:{type,coordinates:type==='LineString'?[[126.85,35.15],[126.86,35.15]]:[[[126.85,35.15],[126.86,35.15]]]},properties:{id,routeId:id,name:'귀갓길 시험 참고선',geometryStatus:'image-interpreted',uncertaintyMeters:35}});
const point=(id,facilityType,coordinate=[126.855,35.15])=>({type:'Feature',geometry:{type:'Point',coordinates:coordinate},properties:{id:id+'-'+facilityType,routeId:id,routeName:'참고 귀갓길',facilityType}});
const snapshot=()=>({type:'FeatureCollection',features:[line(first),line(second,'LineString'),point(first,'cctv'),point(first,'cctv-bell'),point(first,'logo-projector'),point(first,'route-sign')],metadata:{sourceName:'TEST ONLY 경찰 공개지도',sourceDate:'2026-08-13'}});

test('reference lines and photo facilities have distinct colors and explicit source interpretation labels',()=>{
  const collection=snapshot(),before=structuredClone(collection),features=safeReturnMapFeatures(collection);
  assert.equal(features.length,6);assert.deepEqual(features.map(feature=>feature.properties.displayColor),['#f18720','#f18720','#9b3c74','#2358d5','#a56a14','#a56a14']);
  assert.ok(features.every(feature=>feature.properties.safeReturnReference===true&&feature.properties.referenceGeometry===true));
  assert.ok(features.every(feature=>feature.properties.sourceName==='TEST ONLY 경찰 공개지도'&&feature.properties.sourceDate==='2026-08-13'));
  assert.ok(features.every(feature=>/공식 측량좌표.*아닙니다/.test(feature.properties.note)));
  assert.match(features[0].properties.name,/지도 판독선/);assert.match(features[2].properties.name,/CCTV.*지도 판독 위치|CCTV.*참고 귀갓길/);
  assert.deepEqual(collection,before);assert.equal(new Set(features.map(feature=>feature.properties.id)).size,6);
});

test('choosing one corridor retains only its own line and attributed photo annotations',()=>{
  const features=safeReturnMapFeatures(snapshot(),first);
  assert.equal(features.length,5);assert.ok(features.every(feature=>feature.properties.safeReturnId===first));assert.equal(features.filter(feature=>feature.geometry.type!=='Point').length,1);
  const other=safeReturnMapFeatures(snapshot(),second);assert.equal(other.length,1);assert.equal(other[0].properties.safeReturnId,second);
  assert.deepEqual(safeReturnMapFeatures(snapshot(),'invented-route'),[]);
});

test('invalid coordinate systems, malformed geometries and unattached markers never become map evidence',()=>{
  const bad={type:'FeatureCollection',features:[
    line(first),point(first,'cctv',[12900000,3500000]),point(first,'cctv',['126.85','35.15']),
    {type:'Feature',geometry:{type:'LineString',coordinates:[[126.85,35.15],null]},properties:{id:first}},
    {type:'Feature',geometry:{type:'Polygon',coordinates:[]},properties:{id:first}},
    {type:'Feature',geometry:{type:'Point',coordinates:[126.855,35.15]},properties:{}},
  ]};
  const features=safeReturnMapFeatures(bad);assert.equal(features.length,1);assert.equal(features[0].geometry.type,'MultiLineString');
  assert.deepEqual(safeReturnMapFeatures(null),[]);assert.deepEqual(safeReturnMapFeatures({features:{bad:true}}),[]);
});

test('per-record source metadata is retained and output is bounded for a damaged oversized collection',()=>{
  const collection=snapshot();collection.features[0].properties.sourceName='금호1 원문';collection.features[0].properties.sourceDate='2026-08-12';
  const firstFeature=safeReturnMapFeatures(collection)[0];assert.equal(firstFeature.properties.sourceName,'금호1 원문');assert.equal(firstFeature.properties.sourceDate,'2026-08-12');assert.equal(firstFeature.properties.uncertaintyMeters,35);
  assert.equal(safeReturnMapFeatures({...collection,features:Array.from({length:550},()=>line(first))}).length,500);
});
