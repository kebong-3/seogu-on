import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredRegionId,regionLink} from '../shared/region-catalog.js';
import {loadRegionData,handleRegionProfile} from '../server/region-profile.js';
import {regionQuestionEvidence,answerRegionQuestion,validateRegionPlan} from '../server/ai/region-ask.js';
import {handleAsk,resetAskLimits} from '../server/ai/ask.js';
import {reviewSpace} from '../server/ai/space-review.js';

const pack=await loadRegionData({env:{},regionId:'suncheon'});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(raw){this.body=JSON.parse(raw);}});

test('only shipped regions are selectable and map preference is safely preserved',()=>{
  for(const value of ['../seogu','adoption-template','https://example.org','',null,{},'suncheon.json']) assert.throws(()=>registeredRegionId(value));
  assert.equal(regionLink('suncheon','?map=boundary&unknown=x'),'/?region=suncheon&map=boundary');
  assert.equal(regionLink('suncheon','?map=clean'),'/?region=suncheon');
});

test('region endpoint changes actual data paths and rejects an unregistered query',async()=>{
  const res=response();await handleRegionProfile({method:'GET',url:'/api/region-profile?region=suncheon',headers:{host:'localhost'}},res,{env:{}});
  assert.equal(res.statusCode,200);assert.equal(res.body.profile.id,'suncheon');assert.equal(res.body.profile.districtCount,24);
  assert.match(res.body.profile.facilitiesUrl,/regions\/suncheon\//);assert.deepEqual(res.body.regions.map(r=>r.id),['seogu','suncheon']);
  const bad=response();await handleRegionProfile({method:'GET',url:'/api/region-profile?region=adoption-template',headers:{host:'localhost'}},bad,{env:{}});
  assert.equal(bad.statusCode,400);assert.equal(bad.body.code,'REGION_NOT_REGISTERED');
});

test('Suncheon natural-language query uses local facilities, narrow sport terms and source coverage',async()=>{
  const result=await answerRegionQuestion({regionId:'suncheon',question:'순천 수영장 알려줘'},{env:{}});
  assert.equal(result.regionId,'suncheon');assert.equal(result.mode,'rules');assert.equal(result.structured.candidateCount,2);
  assert.ok(result.map.highlight.features.every(f=>f.properties.name.includes('수영')));
  assert.ok(result.structured.assetIds.every(id=>id.startsWith('suncheon-public:')));
  assert.match(result.answer,/현재 이용 가능 여부를 확인한 결과는 아닙니다/);
  assert.ok(result.caveats.some(note=>note.includes('수록 읍면동 8개')));
  assert.deepEqual(result.sources[0].dateRange,['2026-10-10','2026-10-10']);
});

test('district scope is local and an empty public dataset is not proof of no facilities',async()=>{
  const covered=new Set(pack.facilities.features.map(f=>f.properties.dongId));
  const empty=pack.boundaries.features.find(f=>!covered.has(f.properties.dongId)).properties;
  const result=await answerRegionQuestion({regionId:'suncheon',dongId:empty.dongId,question:'공공공간 찾아줘'},{env:{}});
  assert.equal(result.structured.scopeCount,0);assert.equal(result.map.highlight.features.length,0);
  assert.match(result.answer,/실제 공간의 부재를 뜻하지는 않습니다/);
  assert.throws(()=>regionQuestionEvidence({question:'회의실',dongId:'seogu-01'},pack),/현재 지역/);
  const mismatch=await answerRegionQuestion({regionId:'suncheon',question:'서구 풍암동 시설 찾아줘'},{env:{}});
  assert.match(mismatch.answer,/다른 지역이 포함/);assert.equal(mismatch.map.highlight.features.length,0);
});

test('AI chooses source references; invented IDs, metrics and wrong-region records are rejected',()=>{
  const evidence=regionQuestionEvidence({question:'회의실 찾아줘'},pack),id=evidence.candidates[0].properties.id;
  assert.deepEqual(validateRegionPlan({assetIds:[id],checks:['booking']},evidence),{assetIds:[id],checks:['booking']});
  for(const plan of [{assetIds:['seogu-room'],checks:['booking']},{assetIds:[id],checks:['invented']},{assetIds:[id],checks:[['hours']]},{assetIds:[id],checks:['booking'],eligibleCount:98},{assetIds:[id,id],checks:['booking']}])assert.throws(()=>validateRegionPlan(plan,evidence),{code:'LLM_UNGROUNDED'});
});

test('specific activities outrank audience words and malformed questions are rejected',()=>{
  const evidence=regionQuestionEvidence({question:'순천 주민이 수영할 수영장을 찾아줘'},pack);
  assert.equal(evidence.candidates.length,2);assert.ok(evidence.candidates.every(f=>f.properties.name.includes('수영')));
  const badminton=regionQuestionEvidence({question:'주민 배드민턴 공간'},pack);
  assert.ok(badminton.candidates.length>0);assert.ok(badminton.candidates.every(f=>/배드[민맨]턴/.test(`${f.properties.name} ${f.properties.publishedFacilityType}`)));
  for(const question of [123,{},['회의실'],true,null])assert.throws(()=>regionQuestionEvidence({question},pack),/문자열/);
  for(const dongId of [0,false,{},[]])assert.throws(()=>regionQuestionEvidence({question:'공간',dongId},pack),/현재 지역/);
});

test('unconnected fields and foreign city names do not turn into local space recommendations',async()=>{
  for(const [question,status] of [['순천 인구는 몇 명인가요?','unsupported-domain'],['여수시 회의실 찾아줘','different-region'],['여수 회의실 찾아줘','different-region']]) {
    let called=false;const result=await answerRegionQuestion({regionId:'suncheon',question},{env:{AI_API_KEY:'test-key'},fetcher:()=>{called=true;throw Error('must not call model');}});
    assert.equal(called,false);assert.equal(result.structured.queryStatus,status);assert.equal(result.map.highlight.features.length,0);
    assert.doesNotMatch(result.answer,/먼저 살펴볼 공간/);
  }
  const local=regionQuestionEvidence({question:'전남광주통합특별시 순천시 회의실'},pack);assert.equal(local.otherRegion,false);assert.ok(local.candidates.length>0);
});

test('actual provider transport validates selection and renders facts on the server',async()=>{
  const evidence=regionQuestionEvidence({question:'수영장 찾아줘'},pack),id=evidence.candidates[0].properties.id;
  let seen;
  const fetcher=async(url,options)=>{seen=JSON.parse(options.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({assetIds:[id],checks:['hours','booking']})}]},finishReason:'STOP'}]})};};
  const result=await answerRegionQuestion({regionId:'suncheon',question:'수영장 찾아줘'},{env:{AI_API_KEY:'test-key'},fetcher,allowModel:()=>true});
  assert.equal(result.mode,'llm');assert.equal(result.analysisPath,'region-grounded-selection');assert.equal(result.map.highlight.features.length,1);
  assert.ok(seen.contents[0].parts[0].text.includes('suncheon-public:'));assert.match(result.answer,/2개입니다/);
  const wrong=await answerRegionQuestion({regionId:'suncheon',question:'수영장 찾아줘'},{env:{AI_API_KEY:'test-key'},allowModel:()=>true,fetcher:async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"assetIds":["made-up"],"checks":["hours"]}'}]}}]})})});
  assert.equal(wrong.mode,'rules');assert.equal(wrong.code,'LLM_UNGROUNDED');assert.equal(wrong.structured.candidateCount,2);
});

test('HTTP ask selects the region and rejects unregistered region IDs before lookup',async()=>{
  resetAskLimits();const res=response();await handleAsk({method:'POST',headers:{host:'localhost'},body:{regionId:'suncheon',question:'수영장 찾아줘'}},res,{env:{}});
  assert.equal(res.statusCode,200);assert.equal(res.body.regionId,'suncheon');
  const bad=response();await handleAsk({method:'POST',headers:{host:'localhost'},body:{regionId:'../../secret',question:'시설'}},bad,{env:{}});
  assert.equal(bad.statusCode,400);assert.equal(bad.body.code,'REGION_NOT_REGISTERED');
});

test('Suncheon uses the same comparison service while Seo-gu asset IDs cannot cross into it',async()=>{
  const body={regionId:'suncheon',assetIds:[`public-facilities::${pack.facilities.features[0].properties.id}`],observations:{},query:{dayOfWeek:6,start:'10:00',end:'12:00'},scenarios:[]};
  const result=await reviewSpace(body,{env:{}});
  assert.equal(result.comparison.regionId,'suncheon');assert.equal(result.comparison.baseline.unknownCount,1);
  assert.equal(result.comparison.baseline.eligibleCount,0);assert.equal(result.comparison.sources[0].date,'2026-10-10');
  await assert.rejects(reviewSpace({...body,assetIds:['public-facilities::seogu-01']},{env:{}}));
});
