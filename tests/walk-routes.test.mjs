import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWalkRoutes,runWalkRoutes,resetWalkRouteLimits} from '../server/walk-routes.js';
import {loadWalkCandidates} from '../server/walk-candidates.js';
import {rankWalkCandidates,walkDistance} from '../shared/walk-route-model.js';

const packs=Object.fromEntries(await Promise.all(['seogu','suncheon'].map(async regionId=>[regionId,await loadWalkCandidates({regionId,env:{}})])));
const loadCandidates=async({regionId})=>packs[regionId];
const TEST_KEY='SERVER_ONLY_TEST_CREDENTIAL';
const env={TMAP_API_KEY:TEST_KEY};
const pair=pack=>{const start=pack.candidates.find(p=>p.category==='public').coordinate;const end=pack.candidates.find(p=>p.routeEligible&&walkDistance(start,p.coordinate)>1000&&walkDistance(start,p.coordinate)<4000).coordinate;return {start:[...start],end:[...end]};};
const request=(regionId='seogu',extra={})=>({regionId,mode:'shade',...pair(packs[regionId]),avoidStairs:false,viaIds:[],...extra});
const response=()=>({headers:{},setHeader(key,value){this.headers[key.toLowerCase()]=value;},end(text){this.text=text;this.body=JSON.parse(text);}});
function mockResponse(body,{distanceMeters=3456,durationSeconds=789,coordinates,pointType='SP'}={}){
  const points=coordinates||[[Number(body.startX),Number(body.startY)],...(body.passList?body.passList.split('_').map(p=>p.split(',').map(Number)):[]),[Number(body.endX),Number(body.endY)]];
  return new Response(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:points[0]},properties:{totalDistance:distanceMeters,totalTime:durationSeconds,pointType,name:'공급자 출발점'}},{type:'Feature',geometry:{type:'LineString',coordinates:points},properties:{description:'공급자 보행경로'}}]}),{status:200,headers:{'content-type':'application/json'}});
}
const options=extra=>({env,loadCandidates,...extra});
const postReq=body=>({method:'POST',url:'/api/walk-routes',headers:{host:'local.test',origin:'https://local.test','content-type':'application/json','x-forwarded-for':'192.0.2.1'},body});
test.beforeEach(()=>resetWalkRouteLimits());

test('GET exposes only public source candidates and works without a TMAP key in both real regions',async()=>{
  for(const region of ['seogu','suncheon']){
    const res=response();await handleWalkRoutes({method:'GET',url:`/api/walk-routes?region=${region}`,headers:{host:'local.test'}},res,{env:{},fetcher:()=>{throw Error('catalog must not call TMAP');}});
    assert.equal(res.statusCode,200);assert.equal(res.body.configured,false);assert.equal(res.body.region.id,region);assert.ok(res.body.candidates.length>100);assert.ok(res.body.candidates.every(c=>Array.isArray(c.coordinate)&&c.coordinate.length===2));
    assert.equal(res.headers['cache-control'],'no-store');assert.ok(!res.text.includes(TEST_KEY));
  }
});
test('no key blocks POST before any provider call; TMAP_APP_KEY is an accepted server alias',async()=>{
  let calls=0;const fetcher=async(_url,init)=>{calls++;assert.equal(init.headers.appKey,TEST_KEY);return mockResponse(JSON.parse(init.body));};
  await assert.rejects(runWalkRoutes(request(),options({env:{},fetcher})),{code:'TMAP_NOT_CONFIGURED'});assert.equal(calls,0);
  const result=await runWalkRoutes(request(),options({env:{TMAP_APP_KEY:TEST_KEY},fetcher}));assert.equal(result.ok,true);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(TEST_KEY));
});
test('direct and two distinct waypoints use fixed HTTPS POST, server headers and TMAP totals',async()=>{
  const input=request();delete input.viaIds;const calls=[];
  const result=await runWalkRoutes(input,options({now:Date.parse('2026-10-26T00:00:00Z'),fetcher:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,init,body});return mockResponse(body,{distanceMeters:body.passList?4567:3456,durationSeconds:body.passList?987:789});}}));
  assert.equal(calls.length,3);assert.equal(result.routes.length,3);assert.deepEqual(result.routes.map(r=>r.role),['direct','via','via']);assert.equal(result.routes[0].distanceMeters,3456);assert.equal(result.routes[0].durationSeconds,789);
  assert.equal(new Set(result.routes.slice(1).map(r=>r.via[0].coordinate.join(','))).size,2);
  for(const {url,init,body}of calls){assert.equal(url,'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1');assert.equal(init.method,'POST');assert.equal(init.headers.appKey,TEST_KEY);assert.equal(init.redirect,'error');assert.equal(body.searchOption,'10');assert.equal(body.reqCoordType,'WGS84GEO');assert.equal(body.resCoordType,'WGS84GEO');assert.equal(body.startName,encodeURIComponent('출발지'));assert.ok(!url.includes(TEST_KEY));}
  assert.equal(Date.parse(result.expiresAt)-Date.parse(result.requestedAt),30*60000);assert.ok(!JSON.stringify(result).includes(TEST_KEY));
});
test('inspection sends at most three trusted waypoint IDs in the explicitly selected order',async()=>{
  const input=request();const selected=rankWalkCandidates(packs.seogu.candidates,{...input,mode:'inspection',limit:3}).reverse();
  const calls=[];const result=await runWalkRoutes({...input,mode:'inspection',avoidStairs:true,viaIds:selected.map(p=>p.id)},options({fetcher:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return mockResponse(body);}}));
  assert.equal(calls.length,2);assert.equal(calls[1].passList,selected.map(p=>p.coordinate.join(',')).join('_'));assert.ok(calls.every(b=>b.searchOption==='30'));assert.deepEqual(result.routes[1].via.map(p=>p.id),selected.map(p=>p.id));
});
test('safety routes accept police facilities and reject unverified bells or a different facility category',async()=>{
  const base=request('seogu',{mode:'safety'}),police=rankWalkCandidates(packs.seogu.candidates,{...base,limit:1})[0];
  let calls=0;const fetcher=async(_url,init)=>{calls++;return mockResponse(JSON.parse(init.body));};
  const bell=packs.seogu.candidates.find(p=>p.category==='bell'),shade=packs.seogu.candidates.find(p=>p.category==='shade');
  for(const candidate of [bell,shade])await assert.rejects(runWalkRoutes({...base,viaIds:[candidate.id]},options({fetcher})),{code:'WALK_INVALID_VIA'});
  assert.equal(calls,0);
  const result=await runWalkRoutes({...base,viaIds:[police.id]},options({fetcher}));assert.equal(result.routes[1].via[0].category,'police');assert.ok(result.routes.every(r=>r.via.every(p=>p.routeEligible)));
});
test('foreign regions, invalid coordinates, unknown IDs and request-supplied URLs never reach TMAP',async()=>{
  let calls=0;const opts=options({fetcher:async()=>{calls++;throw Error('must not call');}}),base=request();
  for(const body of [{...base,start:pair(packs.suncheon).start},{...base,start:[35.1,126.8]},{...base,end:base.start},{...base,viaIds:['invented']},{...base,avoidStairs:'yes'},{...base,url:'https://attacker.invalid'},{...base,apiKey:'client-key'},{...base,viaIds:['id','id']}])await assert.rejects(runWalkRoutes(body,opts));
  const far=packs.suncheon.candidates.find(p=>walkDistance(pair(packs.suncheon).start,p.coordinate)>10000);
  assert.ok(far);await assert.rejects(runWalkRoutes(request('suncheon',{end:far.coordinate}),opts),{code:'WALK_DISTANCE_LIMIT'});assert.equal(calls,0);
});
test('Suncheon routes are calculated from Suncheon positions and do not import Seo-gu safety waypoints',async()=>{
  const calls=[];const result=await runWalkRoutes(request('suncheon'),options({fetcher:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return mockResponse(body);}}));
  assert.equal(result.region.id,'suncheon');assert.equal(calls.length,1);assert.ok(Number(calls[0].startX)>127.1);
  const police=packs.seogu.candidates.find(c=>c.category==='police');await assert.rejects(runWalkRoutes(request('suncheon',{mode:'inspection',viaIds:[police.id]}),options()),{code:'WALK_INVALID_VIA'});
});
test('an alternative failure preserves real direct results and never substitutes a straight route',async()=>{
  const input=request();delete input.viaIds;
  const result=await runWalkRoutes(input,options({fetcher:async(_url,init)=>{const body=JSON.parse(init.body);if(body.passList)return new Response('PRIVATE_UPSTREAM_DETAIL',{status:403});return mockResponse(body);}}));
  assert.equal(result.routes.length,1);assert.equal(result.routes[0].role,'direct');assert.ok(result.warnings.some(w=>w.includes('직선 경로로 대체하지')));assert.ok(!JSON.stringify(result).includes('PRIVATE_UPSTREAM_DETAIL'));
});
test('authentication errors and network exceptions do not expose keys, raw bodies or request URLs',async()=>{
  const res=response();await handleWalkRoutes(postReq(request()),res,options({fetcher:async()=>new Response(`private ${TEST_KEY}`,{status:401})}));
  assert.equal(res.statusCode,502);assert.equal(res.body.code,'TMAP_AUTH_REJECTED');assert.ok(!res.text.includes(TEST_KEY));
  const input=request();delete input.viaIds;
  await assert.rejects(runWalkRoutes(input,options({fetcher:async()=>{throw Object.assign(Error(`private ${TEST_KEY}`),{code:'ECONNRESET'});}})),error=>error.code==='TMAP_UNAVAILABLE'&&!error.message.includes(TEST_KEY));
});
test('missing provider totals, malformed WGS84 geometry and overlong routes are rejected instead of estimated',async()=>{
  for(const fetcher of [async()=>new Response('{"type":"FeatureCollection","features":[]}'),async(_u,init)=>mockResponse(JSON.parse(init.body),{coordinates:[[0,0],[1,1]]}),async(_u,init)=>mockResponse(JSON.parse(init.body),{distanceMeters:10001})])await assert.rejects(runWalkRoutes(request(),options({fetcher})));
  await assert.rejects(runWalkRoutes(request(),options({fetcher:async(_u,init)=>{const r=await mockResponse(JSON.parse(init.body)).json();delete r.features[0].properties.totalTime;return new Response(JSON.stringify(r));}})),{code:'TMAP_BAD_RESPONSE'});
});
test('waypoint validation checks polyline segments and rejects a waypoint more than 100m away',async()=>{
  const input=request(),middle=[(input.start[0]+input.end[0])/2,(input.start[1]+input.end[1])/2];
  const candidate={id:'trusted-test-waypoint',name:'검증용 경유지',category:'shade',coordinate:middle,routeEligible:true,sourceName:'검증 원문',sourceDate:null};
  const load=async()=>({...packs.seogu,candidates:[candidate]});
  const good=await runWalkRoutes({...input,viaIds:[candidate.id]},options({loadCandidates:load,fetcher:async(_url,init)=>{const b=JSON.parse(init.body);return mockResponse(b,{coordinates:[input.start,input.end]});}}));assert.equal(good.routes.length,2);
  const off={...candidate,coordinate:[middle[0],middle[1]+.002]};
  const rejected=await runWalkRoutes({...input,viaIds:[candidate.id]},options({loadCandidates:async()=>({...packs.seogu,candidates:[off]}),fetcher:async(_url,init)=>mockResponse(JSON.parse(init.body),{coordinates:[input.start,input.end]})}));
  assert.equal(rejected.routes.length,1);assert.ok(rejected.warnings.some(w=>w.includes('100m 이내')));
});
test('provider response and time limits produce controlled failures with no implicit retry',async()=>{
  let calls=0;await assert.rejects(runWalkRoutes(request(),options({timeoutMs:5,fetcher:async()=>{calls++;return new Promise(()=>{});}})),{code:'TMAP_TIMEOUT'});assert.equal(calls,1);
  await assert.rejects(runWalkRoutes(request(),options({fetcher:async()=>new Response('{}',{headers:{'content-length':String(2*1024*1024)}})})),{code:'TMAP_RESPONSE_TOO_LARGE'});
});
test('same-origin, JSON body, method and bounded body gates run before provider access',async()=>{
  let calls=0;const opts=options({fetcher:async()=>{calls++;throw Error('must not call');}});
  const cases=[[{...postReq(request()),headers:{...postReq(request()).headers,origin:'https://other.test'}},403],[{...postReq(request()),headers:{...postReq(request()).headers,'sec-fetch-site':'cross-site'}},403],[{...postReq(request()),headers:{...postReq(request()).headers,'content-type':'text/plain'}},415],[{...postReq(request()),headers:{...postReq(request()).headers,'content-length':'999999'}},413],[{method:'DELETE',headers:{}},405]];
  for(const [req,status]of cases){resetWalkRouteLimits();const res=response();await handleWalkRoutes(req,res,opts);assert.equal(res.statusCode,status);assert.equal(res.headers['cache-control'],'no-store');}
  assert.equal(calls,0);
});
test('per-IP requests and per-day provider attempts are bounded; zero explicitly disables calls',async()=>{
  let calls=0;const fetcher=async(_url,init)=>{calls++;return mockResponse(JSON.parse(init.body));};
  for(let index=0;index<4;index++){const res=response();await handleWalkRoutes(postReq(request()),res,options({fetcher}));assert.equal(res.statusCode,index<3?200:429);}assert.equal(calls,3);
  resetWalkRouteLimits();calls=0;const automatic=request();delete automatic.viaIds;
  const capped=await runWalkRoutes(automatic,options({env:{...env,TMAP_DAILY_LIMIT:'1'},fetcher}));assert.equal(calls,1);assert.equal(capped.routes.length,1);assert.ok(capped.warnings.some(w=>w.includes('호출 한도')));
  resetWalkRouteLimits();await assert.rejects(runWalkRoutes(request(),options({env:{...env,TMAP_DAILY_LIMIT:'0'},fetcher})),{code:'TMAP_DAILY_LIMIT'});assert.equal(calls,1);
});

const seasonalRequest=extra=>{const base=request();const via=rankWalkCandidates(packs.seogu.candidates,{...base,limit:1})[0];return {...base,viaIds:[via.id],departureAt:'2027-07-15T14:00:00+09:00',shadowTiming:'walk-time',maxDetourMeters:500,maxDetourMinutes:5,...extra};};
const seasonalData=()=>({buildings:{type:'FeatureCollection',features:[]},coverageGeometry:packs.seogu.geometry,icing:null,metadata:{regionId:'seogu',sourceName:'TEST ONLY · 평가범위 검증용 합성자료'}});
const seasonalFetcher=async(_url,init)=>{const body=JSON.parse(init.body);return mockResponse(body,{distanceMeters:body.passList?3800:3456,durationSeconds:body.passList?850:789});};
const fakeSeasonal=input=>({status:'assessed',mode:input.mode,departureAt:input.departureAt,timing:input.shadowTiming,model:{name:'TEST ONLY'},assumptions:['합성 모델 연결검사'],routes:input.routes.map(route=>({id:route.id,status:'assessed',estimatedShadeMeters:route.role==='via'?150:50,evaluatedMeters:1000,unevaluatedMeters:0,sunlitMeters:route.role==='via'?850:950,coverageRatio:1})),comparison:{preferredRouteId:input.routes.find(route=>route.role==='via')?.id||'direct',rankedRouteIds:input.routes.map(route=>route.id).reverse(),basis:'TEST ONLY bounded improvement',reason:'model-bounded-improvement'}});

test('legacy shade requests keep TMAP results and explicitly defer seasonal metrics without a selected time',async()=>{
  const result=await runWalkRoutes(request(),options({fetcher:seasonalFetcher,loadSeasonalData:()=>{throw Error('no automatic seasonal input');}}));
  assert.equal(result.routes[0].distanceMeters,3456);assert.equal(result.seasonal.status,'not-evaluated');assert.equal(result.seasonal.departureAt,null);assert.equal(result.seasonal.comparison.preferredRouteId,null);assert.equal(result.routes[0].seasonal.estimatedShadeMeters,null);assert.equal(result.routes[0].seasonal.coverageRatio,null);
});
test('seasonal inputs reject ambiguous time, impossible dates and nonnumeric detour limits before a paid call',async()=>{
  let calls=0;const opts=options({fetcher:async()=>{calls++;throw Error('must not call');}});
  for(const departureAt of ['2027-07-15T14:00','2027-02-30T09:00:00+09:00','2027-07-15T25:00:00+09:00','2027-07-15T14:00:00+14:30','1999-12-31T09:00:00+09:00'])await assert.rejects(runWalkRoutes(seasonalRequest({departureAt}),opts),{code:'INVALID_DEPARTURE_TIME'});
  for(const extra of [{maxDetourMeters:-1},{maxDetourMeters:3001},{maxDetourMinutes:'5'},{maxDetourMinutes:61},{shadowTiming:'guess-time'},{includeLevels:'true'}])await assert.rejects(runWalkRoutes(seasonalRequest(extra),opts),{code:'INVALID_WALK_REQUEST'});
  assert.equal(calls,0);
});
test('only successful TMAP routes are assessed, bound to their own IDs and ordered by the seasonal preference',async()=>{
  let evaluated,internal;
  const result=await runWalkRoutes(seasonalRequest({departureAt:'2027-07-15T05:00:00Z'}),options({fetcher:seasonalFetcher,loadSeasonalData:seasonalData,evaluateSeasonal:(input,budget)=>{evaluated=input;internal=budget;return fakeSeasonal(input);}}));
  assert.equal(evaluated.routes.length,2);assert.equal(evaluated.departureAt,'2027-07-15T14:00:00.000+09:00');assert.equal(evaluated.includeLevels,false);assert.equal(evaluated.shadowTiming,'walk-time');assert.equal(evaluated.maxDetourMeters,500);assert.equal(internal.runtimeMs,2500);
  assert.equal(result.routes[0].id,'via-1');assert.equal(result.routes[0].distanceMeters,3800);assert.equal(result.routes[0].durationSeconds,850);assert.equal(result.routes[0].seasonal.id,'via-1');assert.equal(result.seasonal.criteria.conditions,'both');assert.equal(result.seasonal.timeZone,'Asia/Seoul');assert.equal(Date.parse(result.expiresAt)-Date.parse(result.requestedAt),30*60000);
});
test('unknown source coverage permits partial model evidence but never a route preference',async()=>{
  const result=await runWalkRoutes(seasonalRequest(),options({fetcher:seasonalFetcher,loadSeasonalData:()=>({...seasonalData(),coverageGeometry:null}),evaluateSeasonal:fakeSeasonal}));
  assert.equal(result.seasonal.comparison.preferredRouteId,null);assert.deepEqual(result.seasonal.comparison.rankedRouteIds,[]);assert.equal(result.routes[0].id,'direct');assert.equal(result.routes[1].seasonal.estimatedShadeMeters,150);assert.match(result.seasonal.comparison.reason,/전수 평가범위/);
});
test('both explicit detour conditions and a real direct baseline are necessary for a preference',async()=>{
  const base=seasonalRequest();delete base.maxDetourMinutes;
  const missing=await runWalkRoutes(base,options({fetcher:seasonalFetcher,loadSeasonalData:seasonalData,evaluateSeasonal:fakeSeasonal}));assert.equal(missing.seasonal.comparison.preferredRouteId,null);assert.match(missing.seasonal.comparison.reason,/모두 명시/);
  const excessive=await runWalkRoutes(seasonalRequest({maxDetourMeters:0,maxDetourMinutes:0}),options({fetcher:seasonalFetcher,loadSeasonalData:seasonalData,evaluateSeasonal:fakeSeasonal}));assert.equal(excessive.seasonal.comparison.preferredRouteId,null);assert.match(excessive.seasonal.comparison.reason,/조건을 모두/);
  const noDirect=await runWalkRoutes(seasonalRequest(),options({loadSeasonalData:seasonalData,evaluateSeasonal:fakeSeasonal,fetcher:async(url,init)=>JSON.parse(init.body).passList?seasonalFetcher(url,init):new Response('PROVIDER PRIVATE DETAIL',{status:403})}));assert.equal(noDirect.routes.length,1);assert.equal(noDirect.routes[0].id,'via-1');assert.equal(noDirect.seasonal.comparison.preferredRouteId,null);assert.match(noDirect.seasonal.comparison.reason,/직접 경로/);
});
test('a seasonal model cannot introduce a route or overwrite TMAP distance and duration',async()=>{
  const result=await runWalkRoutes(seasonalRequest(),options({fetcher:seasonalFetcher,loadSeasonalData:seasonalData,evaluateSeasonal:()=>({routes:[{id:'not-returned-by-tmap'}],comparison:{preferredRouteId:'not-returned-by-tmap',rankedRouteIds:[]}})}));
  assert.equal(result.seasonal.status,'not-evaluated');assert.equal(result.seasonal.comparison.preferredRouteId,null);assert.deepEqual(result.routes.map(route=>route.distanceMeters),[3456,3800]);assert.ok(result.routes.every(route=>route.seasonal.estimatedShadeMeters===null));
});
test('seasonal data failure or a foreign region keeps valid TMAP geometry with a deferred assessment',async()=>{
  for(const loader of [()=>{throw Error(`private ${TEST_KEY}`);},()=>({...seasonalData(),metadata:{regionId:'suncheon'}})]){
    const result=await runWalkRoutes(seasonalRequest(),options({fetcher:seasonalFetcher,loadSeasonalData:loader,evaluateSeasonal:fakeSeasonal}));assert.equal(result.routes.length,2);assert.equal(result.seasonal.status,'not-evaluated');assert.ok(!JSON.stringify(result).includes(TEST_KEY));assert.ok(result.routes.every(route=>route.geojson.features.some(feature=>feature.geometry.type==='LineString')));
  }
});
test('real solar assessment at night defers shade rather than labelling absent daylight as zero shade',async()=>{
  const input=seasonalRequest({departureAt:'2027-07-15T01:00:00+09:00',viaIds:[]}),routeMeters=Math.round(walkDistance(input.start,input.end));
  const result=await runWalkRoutes(input,options({fetcher:async(_url,init)=>mockResponse(JSON.parse(init.body),{distanceMeters:routeMeters,durationSeconds:Math.ceil(routeMeters/1.2)}),loadSeasonalData:seasonalData}));
  assert.equal(result.seasonal.comparison.preferredRouteId,null);assert.equal(result.routes[0].seasonal.estimatedShadeMeters,null);assert.ok(result.routes[0].seasonal.reasons.some(reason=>/night|sun/i.test(reason)));
});
test('estimated building heights reach the model only when explicitly enabled',async()=>{
  let assessed;
  const result=await runWalkRoutes(seasonalRequest({includeLevels:true}),options({fetcher:seasonalFetcher,loadSeasonalData:seasonalData,evaluateSeasonal:input=>{assessed=input;return fakeSeasonal(input);}}));
  assert.equal(assessed.includeLevels,true);assert.equal(result.seasonal.criteria.includeLevels,true);
});
test('official safety references are read-only metadata and reference failures do not disable the catalogue',async()=>{
  for(const loader of [()=>({sourceName:'공식 지도 참고자료',sourceDate:'2026-08',geometryAvailable:false,routes:[{id:'reference-1',name:'공식 안내',area:'주변 설명 · 선형 아님',sourceUrl:'https://www.gjpolice.go.kr/'}]}),()=>{throw Error('reference read unavailable');}]){
    const res=response();await handleWalkRoutes({method:'GET',url:'/api/walk-routes?region=seogu',headers:{host:'local.test'}},res,{env:{},loadCandidates,loadSafetyReferences:loader});
    assert.equal(res.statusCode,200);assert.ok(res.body.candidates.length>0);assert.equal(res.headers['cache-control'],'no-store');
    if(res.body.safetyReferences){assert.equal(res.body.safetyReferences.geometryAvailable,false);assert.equal(res.body.safetyReferences.routes.length,1);assert.ok(res.body.safetyReferences.routes.every(item=>!item.geometry&&!item.coordinate));}else assert.equal(res.body.safetyReferences,null);
  }
});
test('winter uses actual TMAP alternatives, source building heights and historical management points without inventing complete coverage',async()=>{
  const input=seasonalRequest({mode:'winter',departureAt:'2027-01-15T09:00:00+09:00'});delete input.viaIds;let calls=0;
  const result=await runWalkRoutes(input,options({fetcher:async(url,init)=>{
    calls++;assert.equal(url,'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1');const body=JSON.parse(init.body),points=[[+body.startX,+body.startY],...(body.passList?body.passList.split('_').map(p=>p.split(',').map(Number)):[]),[+body.endX,+body.endY]];
    const meters=Math.ceil(points.slice(1).reduce((sum,point,index)=>sum+walkDistance(points[index],point),0));return mockResponse(body,{distanceMeters:meters,durationSeconds:Math.ceil(meters/1.2)});
  }}));
  assert.ok(calls>=2&&calls<=3);assert.equal(result.mode,'winter');assert.equal(result.seasonal.mode,'winter');assert.equal(result.seasonal.model.includeLevels,false);assert.ok(result.seasonal.model.heightCounts.sourceHeight>0);assert.equal(result.seasonal.comparison.preferredRouteId,null);assert.equal(result.seasonal.dataStatus.state,'partial');
  for(const route of result.routes){assert.ok(route.geojson.features.some(feature=>feature.geometry.type==='LineString'));assert.equal(Object.hasOwn(route.seasonal,'iceProbability'),false);}
});
test('an unconnected city returns null seasonal metrics and keeps ordinary routes rather than a zero-shade claim',async()=>{
  const result=await runWalkRoutes(request('suncheon',{mode:'winter',departureAt:'2027-01-15T09:00:00+09:00',maxDetourMeters:500,maxDetourMinutes:5}),options({fetcher:seasonalFetcher}));
  assert.equal(result.region.id,'suncheon');assert.equal(result.seasonal.status,'not-evaluated');assert.equal(result.seasonal.dataStatus.state,'not-connected');assert.equal(result.seasonal.comparison.preferredRouteId,null);assert.equal(result.routes[0].seasonal.estimatedShadeMeters,null);assert.equal(result.routes[0].seasonal.sunlitMeters,null);
});
