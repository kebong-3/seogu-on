import test from 'node:test';
import assert from 'node:assert/strict';
import {runWalkRoutes,resetWalkRouteLimits,handleWalkRoutes} from '../server/walk-routes.js';
import {loadWalkCandidates} from '../server/walk-candidates.js';
import {walkDistance} from '../shared/walk-route-model.js';
import {walkServiceReadiness,recordWalkService} from '../server/service-readiness.js';
const pack=await loadWalkCandidates({regionId:'seogu',env:{}}),start=pack.candidates.find(c=>c.category==='public').coordinate,end=pack.candidates.find(c=>c.routeEligible&&walkDistance(start,c.coordinate)>1000&&walkDistance(start,c.coordinate)<4000).coordinate;
const key='PRIVATE_TEST_VALUE_NEVER_RETURN',env={TMAP_API_KEY:key};
const loadCandidates=async()=>pack;
function provider(body){const points=[[+body.startX,+body.startY],...(body.passList?body.passList.split('_').map(p=>p.split(',').map(Number)):[]),[+body.endX,+body.endY]];return new Response(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:points[0]},properties:{totalDistance:4000,totalTime:3200,description:'시험 안내: 경로를 따라 이동',turnType:11,pointIndex:0}},{type:'Feature',geometry:{type:'LineString',coordinates:points},properties:{description:'시험 선형'}}]}));}
test('navigation replacement makes only one paid request and skips seasonal scoring',async()=>{
 resetWalkRouteLimits();let calls=0,evaluated=0;
 const result=await runWalkRoutes({regionId:'seogu',mode:'shade',start,end,navigation:true},{env,loadCandidates,fetcher:async(_url,init)=>{calls++;assert.equal(init.headers.appKey,key);const body=JSON.parse(init.body);assert.equal(body.passList,undefined);return provider(body);},evaluateSeasonal:()=>{evaluated++;throw Error('not needed');}});
 assert.equal(calls,1);assert.equal(evaluated,0);assert.equal(result.routes.length,1);assert.equal(result.routes[0].id,'navigation');assert.equal(result.routes[0].geojson.features[0].properties.description,'시험 안내: 경로를 따라 이동');assert.equal(result.routes[0].geojson.features[0].properties.turnType,11);assert.equal(result.seasonal.status,'not-requested');assert.doesNotMatch(JSON.stringify(result),new RegExp(key));
});
test('invalid navigation controls fail before provider calls',async()=>{
 let calls=0;await assert.rejects(runWalkRoutes({regionId:'seogu',mode:'shade',start,end,navigation:'yes'},{env,loadCandidates,fetcher:()=>{calls++;}}),{code:'INVALID_WALK_REQUEST'});assert.equal(calls,0);
});
test('readiness preserves missing dates and zero records without leaking configured secrets',()=>{
 const input={profile:{id:'seogu',name:'서구'},candidates:[],sourceStatus:[{datasetId:'empty',sourceName:'시험자료',state:'available',records:0,candidates:0,sourceDate:'2026-10-01'},{datasetId:'unknown',state:'available',records:2,candidates:2,sourceDate:null},{datasetId:'old',state:'available',sourceDate:'2020-01-01'},{datasetId:'missing',state:'not-connected'}]};
 const result=walkServiceReadiness(input,{...env,AI_PROVIDER:'upstage',UPSTAGE_API_KEY:key,VWORLD_API_KEY:key,VWORLD_DOMAIN:'https://example.org'},{now:Date.parse('2026-10-28T00:00:00Z')});
 assert.equal(result.connections.walking,true);assert.equal(result.connections.ai,true);assert.equal(result.connections.aiModel,'solar-pro4');assert.equal(result.candidateCount,0);assert.equal(result.sources[0].candidates,0);assert.deepEqual(result.sources.map(s=>s.freshness),['within-review-window','unknown','review-due','not-connected']);assert.equal(result.sources[1].ageDays,null);assert.doesNotMatch(JSON.stringify(result),new RegExp(key));
});
test('public status response distinguishes configured from authenticated and is not cached',async()=>{
 const headers={},res={setHeader:(k,v)=>headers[k.toLowerCase()]=v,end(raw){this.body=JSON.parse(raw);}};
 await handleWalkRoutes({method:'GET',url:'/api/walk-routes?region=seogu&status=1',headers:{host:'local.test'}},res,{env,loadCandidates,fetcher:()=>{throw Error('status must not call providers');}});
 assert.equal(res.body.ok,true);assert.equal(res.body.region.id,'seogu');assert.equal(res.body.connections.walking,true);assert.ok(res.body.sources.length>0);assert.equal(res.body.candidates,undefined);assert.equal(headers['cache-control'],'no-store');assert.match(res.body.meaning,/인증 성공/);assert.doesNotMatch(JSON.stringify(res.body),new RegExp(key));
});
test('instance counters record only bounded error codes and null latency before any calls',()=>{
 const before=walkServiceReadiness({profile:{id:'seogu'},candidates:[]},{}).runtime.requests;recordWalkService({ok:false,code:'unsafe detail https://secret.invalid',durationMs:30,at:Date.parse('2026-10-28T00:00:00Z')});const result=walkServiceReadiness({profile:{id:'seogu'},candidates:[]},{});assert.equal(result.runtime.requests,before+1);assert.equal(result.runtime.lastFailureCode,'WALK_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/secret.invalid/);
});
