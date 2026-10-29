import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseSafeReturnCorridor,assessSafeReturnRoutes} from '../shared/safe-return-model.js';

const start=[126.85,35.15],end=[126.86,35.15];
const collection=(features,metadata={})=>({type:'FeatureCollection',features,metadata});
const point=(coordinate,properties={})=>({type:'Feature',geometry:{type:'Point',coordinates:coordinate},properties});
const route=(id,coordinates,distanceMeters=1000,durationSeconds=800)=>({id,role:id==='direct'?'direct':'via',distanceMeters,durationSeconds,geojson:collection([{type:'Feature',geometry:{type:'LineString',coordinates},properties:{}}])});
const bounds=collection([{type:'Feature',geometry:{type:'Polygon',coordinates:[[[126.84,35.14],[126.87,35.14],[126.87,35.16],[126.84,35.16],[126.84,35.14]]]},properties:{}}]);
const waypoints=[[126.852,35.151],[126.858,35.151]];
const corridor=(extra={})=>({type:'Feature',geometry:{type:'MultiLineString',coordinates:[waypoints]},properties:{id:'seogu-safe-return-geumho-1',name:'금호1',geometryStatus:'image-interpreted',uncertaintyMeters:35,sourceName:'TEST ONLY 이미지 참고선',sourceUrl:'https://example.org/source',routingWaypoints:waypoints.map(coordinate=>({coordinate,accessVerification:'mapped-public-road',verificationNote:'TEST ONLY 도로 대조 검증좌표'})),...extra}});
const data=()=>({regionId:'seogu',lights:collection(Array.from({length:21},(_,i)=>point([126.852+i*.0003,35.151])),{sourceName:'TEST ONLY 보안등 설치목록',purpose:'public-lighting'}),cctv:null,corridors:collection([corridor()]),metadata:{regionId:'seogu',state:'partial'}});

test('actual route proximity is measured independently from extra distance and never becomes a safety score or automatic safest choice',()=>{
  const routes=[route('direct',[start,end]),route('via',[start,...waypoints,end],1200,950)];
  const result=assessSafeReturnRoutes({routes,data:data(),boundaries:bounds,maxDetourMeters:300,maxDetourMinutes:3});
  assert.equal(result.status,'partial');assert.equal(result.comparison.preferredRouteId,null);assert.deepEqual(result.comparison.byDistance,['direct','via']);
  const via=result.routes[1].metrics,direct=result.routes[0].metrics;
  assert.ok(via.lighting.nearMeters>direct.lighting.nearMeters);assert.ok(via.corridor.nearMeters>direct.corridor.nearMeters);
  assert.equal(via.detourMeters,200);assert.equal(via.detourSeconds,150);assert.equal(via.withinDetour,true);
  assert.equal(via.corridor.references[0].radiusMeters,35);assert.equal(via.corridor.references[0].uncertaintyMeters,35);
  assert.equal(via.unevaluatedMeters,0);assert.doesNotMatch(JSON.stringify(result),/safetyScore|crimeScore|riskScore/);
});

test('duplicate installation points do not inflate measured proximity length',()=>{
  const routes=[route('direct',[start,end])],snapshot=data();snapshot.lights=collection([point([126.855,35.15])]);
  const once=assessSafeReturnRoutes({routes,data:snapshot}).routes[0].metrics.lighting.nearMeters;
  snapshot.lights.features=Array.from({length:200},()=>point([126.855,35.15]));
  assert.equal(assessSafeReturnRoutes({routes,data:snapshot}).routes[0].metrics.lighting.nearMeters,once);
});

test('traffic enforcement CCTV and missing or empty partial records are not treated as current crime-prevention coverage or zero facilities',()=>{
  const snapshot=data();snapshot.lights=collection([]);snapshot.cctv=collection([point([126.855,35.15])],{purpose:'traffic-enforcement',sourceName:'교통단속 CCTV'});snapshot.corridors=null;
  const result=assessSafeReturnRoutes({routes:[route('direct',[start,end])],data:snapshot});
  assert.equal(result.status,'not-evaluated');assert.equal(result.routes[0].metrics.cctv.nearMeters,null);assert.equal(result.routes[0].metrics.lighting.nearMeters,null);
  assert.deepEqual(result.comparison.byLightingProximity,[]);
});

test('image-derived CCTV retains interpretation and uncertainty labels instead of presenting physical camera coverage',()=>{
  const snapshot=data();snapshot.cctv=collection([point([126.855,35.15],{uncertaintyMeters:40})],{geometryStatus:'image-interpreted',sourceName:'경찰지도 CCTV 표시 주변'});
  const metric=assessSafeReturnRoutes({routes:[route('direct',[start,end])],data:snapshot}).routes[0].metrics.cctv;
  assert.equal(metric.status,'image-reference-proximity');assert.equal(metric.uncertaintyMeters,40);assert.equal(metric.radiusMeters,30);assert.ok(metric.nearMeters>0);
});

test('unknown image uncertainty withholds corridor proximity ordering rather than claiming exact designated-road overlap',()=>{
  const snapshot=data();snapshot.corridors=collection([corridor({uncertaintyMeters:undefined})]);
  const result=assessSafeReturnRoutes({routes:[route('direct',[start,end])],data:snapshot});
  assert.equal(result.routes[0].metrics.corridor.nearMeters,null);assert.deepEqual(result.comparison.byCorridorProximity,[]);
});

test('only explicitly mapped road endpoints generate corridor alternatives; nearest orientation and waypoint identities remain stable',()=>{
  const snapshot=data(),normal=chooseSafeReturnCorridor(snapshot,{start,end,boundaries:bounds});
  assert.ok(normal);assert.deepEqual(normal.via.map(via=>via.coordinate),waypoints);
  const reverse=chooseSafeReturnCorridor(snapshot,{start:end,end:start,boundaries:bounds});
  assert.deepEqual(reverse.via.map(via=>via.coordinate),[...waypoints].reverse());assert.deepEqual(reverse.via.map(via=>via.id),normal.via.map(via=>via.id).reverse());
  assert.equal(chooseSafeReturnCorridor(snapshot,{start,end,boundaries:bounds,maxDetourMeters:0}),null);
  assert.equal(chooseSafeReturnCorridor(snapshot,{start,end,boundaries:bounds,safeReturnId:'invented'}),null);
  snapshot.corridors.features[0].properties.routingWaypoints[0].accessVerification='image-only';
  assert.equal(chooseSafeReturnCorridor(snapshot,{start,end,boundaries:bounds}),null);
});

test('a waypoint identical to the start is omitted and unverified bells or interior points are never substituted',()=>{
  const snapshot=data(),selected=chooseSafeReturnCorridor(snapshot,{start:waypoints[0],end,boundaries:bounds});
  assert.equal(selected.via.length,1);assert.deepEqual(selected.via[0].coordinate,waypoints[1]);
  snapshot.corridors.features[0].properties.routingWaypoints=[{coordinate:waypoints[0],accessVerification:'private-interior',verificationNote:'화장실 비상벨'},{coordinate:waypoints[1],accessVerification:'private-interior',verificationNote:'화장실 비상벨'}];
  assert.equal(chooseSafeReturnCorridor(snapshot,{start,end,boundaries:bounds}),null);
});

test('sample budget reports the unmeasured route geometry instead of treating it as measured negative evidence',()=>{
  const line=Array.from({length:6002},(_,i)=>i%2?start:[start[0]+.00001,start[1]]);
  const segments=Array.from({length:7},(_,i)=>({type:'Feature',geometry:{type:'LineString',coordinates:line.slice(i*900,Math.min(line.length,i*900+901))},properties:{}}));
  const long={id:'direct',role:'direct',distanceMeters:6000,durationSeconds:5000,geojson:collection(segments)};
  const result=assessSafeReturnRoutes({routes:[long],data:data()}).routes[0].metrics;
  assert.equal(result.sampleCount,5000);assert.ok(result.unevaluatedMeters>0);assert.ok(result.evaluatedMeters<result.geometryLengthMeters);
});
