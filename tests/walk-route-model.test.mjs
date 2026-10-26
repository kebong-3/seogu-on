import test from 'node:test';
import assert from 'node:assert/strict';
import {rankWalkCandidates,walkDistance,walkStraightDistance,walkCandidateSupportsMode,WALK_MODE_CATEGORIES} from '../shared/walk-route-model.js';
const start=[126.85,35.14],end=[126.86,35.14];
const point=(id,category,coordinate,other={})=>({id,name:id,category,coordinate,routeEligible:true,sourceDate:null,note:'합성 구조시험 후보 · 실제 시설 아님',...other});

test('mode filters public facility types and safety never turns lights, CCTV or indoor bells into waypoints',()=>{
  const choices=['shade','shelter','police','bell','childcare','public','cctv','security-light'].map((category,i)=>point(category,category,[126.852+i*.0001,35.1401]));
  assert.deepEqual(rankWalkCandidates(choices,{start,end,mode:'safety'}).map(c=>c.category),['police']);
  assert.deepEqual(new Set(rankWalkCandidates(choices,{start,end,mode:'shade',limit:10}).map(c=>c.category)),new Set(['shade','shelter']));
  assert.deepEqual(new Set(rankWalkCandidates(choices,{start,end,mode:'care',limit:10}).map(c=>c.category)),new Set(['childcare','public']));
  assert.equal(walkCandidateSupportsMode(choices[3],'safety'),false);
  assert.equal(walkCandidateSupportsMode(point('private','public',start,{routeEligible:false}),'care'),false);
  assert.deepEqual(WALK_MODE_CATEGORIES.safety,['police']);
});

test('prefilter orders by straight-line detour rather than closeness to the starting point',()=>{
  const nearStart=point('near-start','shade',[126.8501,35.142]),onCorridor=point('corridor','shade',[126.855,35.14]);
  const ranked=rankWalkCandidates([nearStart,onCorridor],{start,end,mode:'shade'});
  assert.equal(ranked[0].id,'corridor');
  assert.ok(ranked[1].straightDetourM>ranked[0].straightDetourM);
  assert.equal(ranked[0].selectionBasis,'straight-line-prefilter');
  assert.ok(!Object.hasOwn(ranked[0],'walkingDistanceM'));
  assert.ok(ranked.every(row=>Number.isInteger(row.straightViaDistanceM)&&row.straightDetourM>=0));
});

test('endpoints, noneligible and malformed candidates are excluded without inventing coordinates',()=>{
  const choices=[point('start','public',start),point('end','public',end),point('closed','public',[126.853,35.14],{routeEligible:false}),point('missingflag','public',[126.854,35.14],{routeEligible:undefined}),point('invalid','public',[NaN,35.14]),point('three-d','public',[126.85,35.14,100]),point('valid','public',[126.855,35.14])];
  assert.deepEqual(rankWalkCandidates(choices,{start,end,mode:'care'}).map(c=>c.id),['valid']);
});

test('same waypoint coordinate is compared once and ties are deterministic without mutating source records',()=>{
  const choices=[point('b','police',[126.855,35.141]),point('a','police',[126.855,35.141]),point('c','police',[126.856,35.141])],before=structuredClone(choices);
  const a=rankWalkCandidates(choices,{start,end,mode:'safety',limit:2}),b=rankWalkCandidates([...choices].reverse(),{start,end,mode:'safety',limit:2});
  assert.deepEqual(a,b);
  assert.equal(a[0].id,'a');
  assert.equal(new Set(a.map(c=>c.coordinate.join(','))).size,a.length);
  assert.deepEqual(choices,before);
  a[0].coordinate[0]=0;
  assert.deepEqual(choices,before);
});

test('distance helper uses meters and accepts a round trip without claiming a road route',()=>{
  assert.equal(walkDistance,walkStraightDistance);
  assert.equal(walkDistance(start,start),0);
  assert.ok(Math.abs(walkDistance([127,35],[127,36])-111195)<5);
  const [ranked]=rankWalkCandidates([point('visit','childcare',[126.855,35.14])],{start,end:start,mode:'inspection'});
  assert.equal(ranked.straightViaDistanceM,ranked.straightDetourM);
});

test('invalid selection arguments are rejected rather than silently selecting another mode or limit',()=>{
  for(const options of [{start:[0,91],end,mode:'care'},{start,end:[0,'0'],mode:'care'},{start,end,mode:'safest'},{start,end,mode:'care',limit:0},{start,end,mode:'care',limit:11},{start,end,mode:'care',limit:1.5}]) assert.throws(()=>rankWalkCandidates([],options),error=>error.code==='INVALID_WALK_SELECTION'&&error.status===400);
  assert.throws(()=>rankWalkCandidates(null,{start,end,mode:'care'}));
});
