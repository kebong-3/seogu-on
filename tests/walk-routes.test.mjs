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
