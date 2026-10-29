import test from 'node:test';
import assert from 'node:assert/strict';
import {runWalkRoutes,resetWalkRouteLimits,handleWalkRoutes} from '../server/walk-routes.js';
import {walkDistance} from '../shared/walk-route-model.js';

const start=[126.85,35.15],end=[126.86,35.15],id='seogu-safe-return-geumho-1',road=[[126.852,35.151],[126.858,35.151]];
const collection=(features,metadata={})=>({type:'FeatureCollection',features,metadata});
const point=(coordinate,properties={})=>({type:'Feature',geometry:{type:'Point',coordinates:coordinate},properties});
const boundaries=collection([{type:'Feature',geometry:{type:'Polygon',coordinates:[[[126.84,35.14],[126.87,35.14],[126.87,35.16],[126.84,35.16],[126.84,35.14]]]},properties:{}}]);
const pack={profile:{id:'seogu',name:'서구',bounds:[126.84,35.14,126.87,35.16]},boundaries,candidates:[
  {id:'police1',name:'시험 공개 경찰관서',category:'police',coordinate:[126.855,35.149],routeEligible:true,sourceName:'TEST ONLY 공식시설'},
  {id:'police2',name:'시험 공개 경찰관서2',category:'police',coordinate:[126.855,35.148],routeEligible:true,sourceName:'TEST ONLY 공식시설'},
  {id:'bell',name:'화장실 비상벨',category:'bell',coordinate:[126.855,35.1501],routeEligible:false,sourceName:'TEST ONLY 참고점'},
]};
const safetyData=()=>({regionId:'seogu',lights:collection([point([126.855,35.151])],{sourceName:'TEST ONLY 설치위치'}),cctv:null,corridors:collection([{type:'Feature',geometry:{type:'MultiLineString',coordinates:[road]},properties:{id,name:'금호1 참고구간',geometryStatus:'image-interpreted',uncertaintyMeters:35,routingWaypoints:road.map(coordinate=>({coordinate,accessVerification:'mapped-public-road',verificationNote:'TEST ONLY 도로 검증'}))}}]),metadata:{regionId:'seogu',state:'partial'}});
const request=extra=>({regionId:'seogu',mode:'safety',start,end,...extra});
function routeResponse(body,override){
  const points=override||[[Number(body.startX),Number(body.startY)],...(body.passList?body.passList.split('_').map(item=>item.split(',').map(Number)):[]),[Number(body.endX),Number(body.endY)]],length=points.slice(1).reduce((sum,p,index)=>sum+walkDistance(points[index],p),0);
  return new Response(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:points},properties:{totalDistance:Math.ceil(length),totalTime:Math.ceil(length/1.2),description:'TEST ONLY 실제 공급형식 응답'}}]}));
}
const options=extra=>({env:{TMAP_API_KEY:'PRIVATE_TEST_KEY'},loadCandidates:async()=>pack,loadSafeReturnData:async()=>safetyData(),fetcher:async(_url,init)=>routeResponse(JSON.parse(init.body)),...extra});
test.beforeEach(()=>resetWalkRouteLimits());

test('safety comparison preserves direct route, one mapped corridor and a police route within the existing three-call budget',async()=>{
  const calls=[],result=await runWalkRoutes(request({safeReturnId:id}),options({fetcher:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return routeResponse(calls.at(-1).body);}}));
  assert.equal(calls.length,3);assert.equal(result.routes[0].id,'direct');const selected=result.routes.find(route=>route.safeReturnId===id);assert.ok(selected);
  assert.equal(selected.via.length,2);assert.ok(result.routes.some(route=>route.via[0]?.category==='police'));
  assert.ok(result.routes.every(route=>route.safety?.metrics));assert.equal(result.safety.comparison.preferredRouteId,null);
  assert.ok(result.safety.routes.find(route=>route.id===selected.id).metrics.corridor.nearMeters>0);
  assert.equal(calls[1].body.passList,road.map(point=>point.join(',')).join('_'));assert.ok(calls.every(call=>call.url==='https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1'));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST_KEY|safetyScore|crimeScore/);
});

test('image-only waypoints remain reference geometry without inventing a special routed path',async()=>{
  const data=safetyData();data.corridors.features[0].properties.routingWaypoints.forEach(point=>point.accessVerification='image-only');
  const result=await runWalkRoutes(request({safeReturnId:id}),options({loadSafeReturnData:async()=>data}));
  assert.equal(result.routes.length,3);assert.ok(result.routes.every(route=>!route.safeReturnId));
  assert.ok(result.routes.slice(1).every(route=>route.via[0].category==='police'));assert.match(result.warnings.join(' '),/별도 귀갓길 경유안을 만들지/);
});

test('a valid TMAP route that misses mapped corridor waypoints is omitted while ordinary and police routes remain',async()=>{
  const data=safetyData();data.corridors.features[0].properties.routingWaypoints.forEach(point=>point.coordinate[1]=35.1506);data.corridors.features[0].geometry.coordinates=[data.corridors.features[0].properties.routingWaypoints.map(point=>point.coordinate)];
  const result=await runWalkRoutes(request({safeReturnId:id}),options({loadSafeReturnData:async()=>data,fetcher:async(_url,init)=>{const body=JSON.parse(init.body);return routeResponse(body,body.passList?.split('_').length===2?[start,end]:undefined);}}));
  assert.equal(result.routes[0].id,'direct');assert.equal(result.routes.length,2);assert.ok(result.routes.every(route=>!route.safeReturnId));assert.match(result.warnings.join(' '),/충분히 가깝지/);
});

test('manual via selection remains explicit, rejects bells and never adds a corridor without an instruction',async()=>{
  const manual=await runWalkRoutes(request({viaIds:['police1']}),options());assert.equal(manual.routes.length,2);assert.equal(manual.routes[1].via[0].id,'police1');assert.ok(manual.routes.every(route=>!route.safeReturnId));
  await assert.rejects(runWalkRoutes(request({viaIds:['bell']}),options()),{code:'WALK_INVALID_VIA'});
  for(const extra of [{safeReturnId:'invented'},{safeReturnId:'https://attacker.test'},{mode:'shade',safeReturnId:id}])await assert.rejects(runWalkRoutes(request(extra),options()),{code:'INVALID_SAFE_RETURN_REFERENCE'});
});

test('navigation preserves chosen corridor identity and the explicit mapped-road waypoint IDs instead of silently dropping to a direct route',async()=>{
  const compared=await runWalkRoutes(request({safeReturnId:id}),options()),selected=compared.routes.find(route=>route.safeReturnId===id),calls=[];
  const navigation=await runWalkRoutes(request({navigation:true,safeReturnId:id,viaIds:selected.via.map(via=>via.id)}),options({fetcher:async(_url,init)=>{calls.push(JSON.parse(init.body));return routeResponse(calls.at(-1));}}));
  assert.equal(calls.length,1);assert.equal(navigation.routes[0].id,'navigation');assert.equal(navigation.routes[0].safeReturnId,id);
  assert.deepEqual(navigation.routes[0].via.map(via=>via.id),selected.via.map(via=>via.id));assert.equal(calls[0].passList,road.map(point=>point.join(',')).join('_'));
});

test('missing or wrong-region data leaves actual TMAP paths usable with unevaluated support instead of fabricated zero evidence',async()=>{
  const result=await runWalkRoutes(request(),options({loadSafeReturnData:async()=>({regionId:'suncheon',lights:safetyData().lights})}));
  assert.equal(result.safety.status,'not-evaluated');assert.ok(result.routes.length>0);assert.equal(result.routes[0].safety.metrics.lighting.nearMeters,null);assert.equal(result.safety.comparison.preferredRouteId,null);
});

test('catalogue exposes image reference geometry and provenance without replacing the official map-only references',async()=>{
  const res={statusCode:0,setHeader(){},end(value){this.body=JSON.parse(value);}};
  await handleWalkRoutes({method:'GET',url:'/api/walk-routes?region=seogu',headers:{host:'local.test'}},res,options({loadSafetyReferences:async()=>({geometryAvailable:false,georeferencingStatus:'official-map-only'})}));
  assert.equal(res.statusCode,200);assert.equal(res.body.safeReturn.corridors.features[0].properties.id,id);assert.equal(res.body.safetyReferences.geometryAvailable,false);assert.equal(res.body.safeReturn.metadata.state,'partial');
});
