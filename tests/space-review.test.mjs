import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRegionData} from '../server/region-profile.js';
import {seedAssets,assetSourceFingerprint,spaceComparisonFingerprint} from '../shared/space-twin-model.js';
import {validateSpaceExplanation,renderSpaceExplanation} from '../shared/space-review-evidence.js';
import {computeSpaceReview,reviewSpace,handleSpaceReview,spaceEvidence,unsupportedSpaceNumbers} from '../server/ai/space-review.js';
import {resetAskLimits} from '../server/ai/ask.js';

const now=Date.parse('2026-10-22T09:00:00Z');
const pack=await loadRegionData({env:{}});
const assets=seedAssets(pack.facilities,{regionId:pack.profile.id,datasetId:pack.profile.facilityLayerId});
const [a,b]=assets;
const record={operatingStatus:'open',daysOfWeek:[1,2,3,4,5],opens:'09:00',closes:'18:00',observedOn:'2026-10-21',evidence:'테스트 전용 가상 확인값. 실제 운영 확인 아님.'};
const input=()=>({regionId:'seogu',assetIds:[a.id,b.id],observations:{[a.id]:record,[b.id]:record},query:{dayOfWeek:6,start:'10:00',end:'12:00'},scenarios:[{id:'weekend',name:'토요일 개방 가정',changes:[{assetId:a.id,operatingStatus:'open',daysOfWeek:[1,2,3,4,5,6],opens:'09:00',closes:'18:00',additionalAnnualCost:120}],note:'가상 시험'}]});
const compute=value=>computeSpaceReview(value,{...pack,now});
const plan=()=>({version:1,claims:[{scenarioId:'baseline',assetId:null,metricRef:'unknownCount'},{scenarioId:'weekend',assetId:null,metricRef:'delta.eligibleCount'}],causes:[{scenarioId:'weekend',assetId:a.id,kind:'schedule-change'}],followups:[{scenarioId:'weekend',assetId:a.id,kind:'staffing'},{scenarioId:'weekend',assetId:null,kind:'cost-basis'}]});
function res(){return {headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(text){this.body=JSON.parse(text);}};}
const request=body=>({method:'POST',headers:{host:'localhost',origin:'http://localhost'},body});

test('same server-owned spaces and hours produce a reproducible current/alternative difference',()=>{
 const c=compute(input());assert.equal(c.selectedCount,2);assert.equal(c.baseline.eligibleCount,0);assert.equal(c.baseline.unknownCount,0);
 assert.equal(c.alternatives[0].eligibleCount,1);assert.equal(c.alternatives[0].delta.eligibleCount,1);assert.equal(c.alternatives[0].overlapHours,2);assert.equal(c.alternatives[0].additionalAnnualCost,120);
 assert.equal(c.sources[0].assetId,a.id);assert.equal(c.baseline.rows[0].name,a.name);
});
test('reject supplied totals, wrong region, unknown IDs, inconsistent selections and nonselected observations',()=>{
 for(const mutate of [v=>v.total=999,v=>v.regionId='other',v=>v.assetIds[0]='invented',v=>v.query.assetIds=[b.id],v=>v.observations['unknown']=record]){const v=input();mutate(v);assert.throws(()=>compute(v));}
});
test('unknown and expired observations do not become zero or an improvement claim',()=>{
 const v=input();v.observations={};const c=compute(v);assert.equal(c.baseline.unknownCount,2);assert.equal(c.alternatives[0].delta,null);
 v.observations={[a.id]:{...record,observedOn:'2026-01-01'}};assert.equal(compute(v).baseline.unknownCount,2);
});
test('invalid times, evidence and duplicate alternative IDs fail before model calls',()=>{
 const bad=[v=>v.observations[a.id]={...record,evidence:''},v=>v.observations[a.id]={...record,observedOn:'2026-10-23'},v=>v.scenarios[0].changes[0].closes='08:00',v=>v.scenarios.push({...v.scenarios[0]})];
 for(const mutate of bad){const v=input();mutate(v);assert.throws(()=>compute(v));}
});
test('source names come from deployed data and field free text is excluded from model evidence',()=>{
 const v=input();v.observations[a.id]={...record,evidence:'내부 연락처 비공개 메모'};const e=spaceEvidence(pack.profile,compute(v));
 assert.equal(JSON.stringify(e).includes('내부 연락처'),false);assert.equal(e.current.spaces[0].name,a.name);assert.equal(e.alternatives[0].kind,'user-scenario');
});
test('all number claims are checked including a single digit',()=>{
 assert.deepEqual(unsupportedSpaceNumbers('9개가 개선됩니다.',{count:1}),[9]);assert.deepEqual(unsupportedSpaceNumbers('1개, 120만원',{count:1,cost:120}),[]);
});
test('missing provider uses a clearly identified deterministic response',async()=>{
 resetAskLimits();const r=await reviewSpace(input(),{env:{},now});assert.equal(r.mode,'rules');assert.equal(r.code,'LLM_NOT_CONFIGURED');assert.match(r.answer,/사용자 가정/);assert.match(r.evidenceId,/^space-/);assert.equal(r.comparison.alternatives[0].eligibleCount,1);
});
test('Google summary uses recomputed evidence and reports actual model identity',async()=>{
 resetAskLimits();let sent;
 const fetcher=async(url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(plan())}]},finishReason:'STOP'}]})};};
 const r=await reviewSpace(input(),{env:{AI_PROVIDER:'google',GEMINI_API_KEY:'test-key',AI_MODEL:'gemini-test'},fetcher,now});
 assert.equal(r.mode,'llm');assert.equal(r.model,'gemini-test');assert.equal(sent.tools,undefined);assert.match(sent.contents[0].parts[0].text,/user-scenario/);assert.equal(r.comparison.alternatives[0].eligibleCount,1);
 assert.equal(r.answer,renderSpaceExplanation(plan(),r.comparison));assert.deepEqual(r.structured,plan());assert.equal(r.comparisonFingerprint,spaceComparisonFingerprint(r.comparison));
});
test('compatible provider keeps the same evidence contract without empty tools',async()=>{
 resetAskLimits();let sent;
 const fetcher=async(url,init)=>{assert.equal(url,'https://model.example/v1/chat/completions');sent=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(plan())},finish_reason:'stop'}]})};};
 const r=await reviewSpace(input(),{env:{AI_PROVIDER:'openai-compatible',AI_API_KEY:'test-key',AI_MODEL:'test-local',AI_API_BASE:'https://model.example/v1'},fetcher,now});
 assert.equal(r.mode,'llm');assert.equal(r.model,'test-local');assert.equal(sent.tools,undefined);assert.match(sent.messages[1].content,/eligibleCount/);
});
test('invented model numbers are discarded but comparison remains usable',async()=>{
 resetAskLimits();const fetcher=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'9개가 개선됩니다.'}]}}]})});
 const r=await reviewSpace(input(),{env:{GEMINI_API_KEY:'test-key'},fetcher,now});assert.equal(r.mode,'rules');assert.equal(r.code,'LLM_UNGROUNDED');assert.equal(r.comparison.alternatives[0].eligibleCount,1);
});
test('facts are bound to the named scenario rather than whichever scenario contains the number',()=>{
 const c=compute(input());
 const refs={version:1,claims:[{scenarioId:'baseline',assetId:null,metricRef:'eligibleCount'},{scenarioId:'weekend',assetId:null,metricRef:'eligibleCount'}],causes:[],followups:[{scenarioId:'weekend',assetId:null,kind:'reservation'}]};
 const text=renderSpaceExplanation(refs,c);
 assert.match(text,/현재 사용자 확인기록: 요청 시간 전체의 개방 조건 충족 공간 0개/);
 assert.match(text,/입력 가정 ‘토요일 개방 가정’: 요청 시간 전체의 개방 조건 충족 공간 1개/);
 // Both 0 and 1 exist in the evidence; a model cannot attach the other value or certainty label.
 for(const mutate of [p=>p.claims[0].value=1,p=>p.claims[1].certainty='confirmed',p=>p.claims[1].scenarioId='unlisted']){const p=structuredClone(refs);mutate(p);assert.throws(()=>validateSpaceExplanation(p,c));}
});
test('existing-number prose and invented causal explanations are rejected at the API boundary',async()=>{
 for(const text of ['현재 조건 충족 공간은 1개이고 대안은 0개입니다.',JSON.stringify({...plan(),causes:[{scenarioId:'weekend',assetId:a.id,kind:'resident-demand-increased'}]}),JSON.stringify({...plan(),claims:[{scenarioId:'weekend',assetId:'not-selected',metricRef:'availability'}]})]){
  resetAskLimits();const fetcher=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]})});
  const r=await reviewSpace(input(),{env:{GEMINI_API_KEY:'test-key'},fetcher,now});
  assert.equal(r.mode,'rules');assert.equal(r.code,'LLM_UNGROUNDED');assert.equal(r.comparison.baseline.eligibleCount,0);assert.equal(r.comparison.alternatives[0].eligibleCount,1);
 }
});
test('unknown current conditions cannot support a delta, schedule-change cause or confirmed-cost claim',()=>{
 const v=input();v.observations={};const c=compute(v);
 assert.throws(()=>validateSpaceExplanation(plan(),c),/미확인/);
 const p={version:1,claims:[{scenarioId:'weekend',assetId:null,metricRef:'additionalAnnualCost'}],causes:[{scenarioId:'weekend',assetId:a.id,kind:'current-unverified'}],followups:[{scenarioId:'baseline',assetId:a.id,kind:'recheck-record'}]};
 assert.doesNotThrow(()=>validateSpaceExplanation(p,c));assert.match(renderSpaceExplanation(p,c),/120만원\/년의 사용자 입력 가정 합계/);assert.match(renderSpaceExplanation(p,c),/견적이나 확정 예산이 아닙니다/);
 const falseCause=structuredClone(p);falseCause.causes[0].kind='schedule-change';assert.throws(()=>validateSpaceExplanation(falseCause,c));
 const falseCheck=structuredClone(p);falseCheck.followups[0]={scenarioId:'weekend',assetId:a.id,kind:'recheck-record'};assert.throws(()=>validateSpaceExplanation(falseCheck,c));
});
test('source-bound observations are rechecked by the server after important source changes',()=>{
 const v=input();v.observations[a.id]={...record,assetFingerprint:assetSourceFingerprint(a)};
 assert.equal(compute(v).baseline.unknownCount,0);
 const changed=structuredClone(pack.facilities);changed.features.find(f=>String(f.properties.id)===a.sourceId).properties.hours='원자료 운영시간 변경';
 const c=computeSpaceReview(v,{profile:pack.profile,facilities:changed,now});
 assert.equal(c.baseline.unknownCount,1);assert.equal(c.alternatives[0].delta,null);assert.match(c.baseline.rows.find(r=>r.assetId===a.id).reason,/원자료 변경/);
});
test('HTTP boundary rejects cross-site, method, oversized body and invalid input',async()=>{
 resetAskLimits();for(const [req,status] of [[{...request(input()),method:'GET'},405],[{...request(input()),headers:{host:'localhost',origin:'https://other.example'}},403],[request('x'.repeat(128*1024+1)),413],[request({...input(),regionId:'wrong'}),400]]){const out=res();await handleSpaceReview(req,out,{env:{},now});assert.equal(out.statusCode,status);}
});
test('valid HTTP response is no-store and computed even when AI is unavailable',async()=>{
 resetAskLimits();const out=res();await handleSpaceReview(request(input()),out,{env:{},now});assert.equal(out.statusCode,200);assert.equal(out.headers['cache-control'],'no-store');assert.equal(out.body.mode,'rules');assert.equal(out.body.comparison.selectedCount,2);
});
