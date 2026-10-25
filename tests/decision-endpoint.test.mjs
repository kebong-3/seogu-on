import test from 'node:test';
import assert from 'node:assert/strict';
import {runDecision,handleDecisionTwin,validateDecisionPlan,validateDecisionMemo} from '../server/ai/decision-twin.js';
import {loadDecisionData} from '../server/decision-data.js';
import {isDecisionQuestion,livingMapIntent,decisionIntent} from '../shared/decision-intent.js';

const options={env:{}};
test('decision: natural question changes count and explicit radius using source-grounded fallback',async()=>{
 const value=await runDecision({regionId:'seogu',question:'그늘막 두 곳만 200m 반경으로 비교해줘'},options);
 assert.equal(value.result.parameters.maxNew,2);assert.equal(value.result.parameters.radiusM,200);assert.equal(value.result.scenario.proposedSites.length,2);
 assert.equal(value.planner,null);assert.equal(value.planNotice.code,'LLM_NOT_CONFIGURED');
 assert.equal(value.result.baseline.total,433);assert.ok(value.result.scenario.covered>=value.result.baseline.covered);
});
test('decision: explaining a modified proposal never reinterprets the earlier question',async()=>{
 const first=await runDecision({regionId:'suncheon',maxNew:1},options);
 const input={regionId:'suncheon',maxNew:1,presetId:first.result.preset.id,radiusM:150,proposedSites:first.result.scenario.proposedSites.map(({id,name,coordinates})=>({id,name,coordinates})),question:'그늘막 3곳을 추가하면?',explain:true};
 const explained=await runDecision(input,options);
 assert.equal(explained.result.parameters.maxNew,1);assert.equal(explained.result.scenario.proposedSites.length,1);assert.equal(explained.planner,null);
 assert.deepEqual(explained.result.baseline,first.result.baseline);assert.equal(explained.result.scenario.covered,first.result.scenario.covered);assert.equal(explained.ai.mode,'rules');
});
test('decision: no client-computed counts, foreign region or out-of-range quantity is accepted',async()=>{
 await assert.rejects(runDecision({regionId:'seogu',covered:9999},options),/계산값/);
 await assert.rejects(runDecision({regionId:'seogu',question:'순천에 그늘막을 3곳 추가해줘'},options),/질문 지역/);
 await assert.rejects(runDecision({regionId:'suncheon',maxNew:6},options));
 await assert.rejects(runDecision({regionId:'suncheon',scopeId:'seogu-fake'},options));
 await assert.rejects(runDecision({regionId:'suncheon',question:'화정1동에 그늘막 2곳 추가해줘'},options),/다른 지역/);
 await assert.rejects(runDecision({regionId:'seogu',question:'금호1동과 금호2동의 그늘막 공백을 비교해줘'},options),/한 구역씩/);
 await assert.rejects(runDecision({regionId:'suncheon',question:'무더위쉼터 2곳 추가해줘'},options),/연결되지/);
 await assert.rejects(runDecision({regionId:'suncheon',question:'비상벨 2곳 추가해줘'},options),/연결되지/);
 await assert.rejects(runDecision({regionId:'suncheon',question:'보안등 점검 대상을 찾아줘'},options),/연결되지/);
 await assert.rejects(runDecision({regionId:'seogu',question:'어린이집 2곳 추가해줘'},options),/신규 공급/);
});
test('decision: grounded AI plans and memo directions cannot invent a region or a loss',async()=>{
 const pack=await loadDecisionData({regionId:'seogu'}),first=await runDecision({regionId:'seogu'},options);
 assert.throws(()=>validateDecisionPlan({workflow:'coverage',presetId:'shade',scopeId:'other-region',radiusM:150,maxNew:3},pack));
 const safe={direction:'compare',evidenceIds:['coverage:baseline'],followups:['route']};
 assert.deepEqual(validateDecisionMemo(safe,first.result),safe);
 assert.throws(()=>validateDecisionMemo({...safe,direction:'loss'},first.result));
 assert.throws(()=>validateDecisionMemo({...safe,direction:'site'},first.result));
 assert.throws(()=>validateDecisionMemo({...safe,evidenceIds:['made-up']},first.result));
 assert.throws(()=>validateDecisionMemo({...safe,direction:'missing'},first.result));
});
test('decision: site comparisons and inspection have no invented added-facility counts',async()=>{
 const site=await runDecision({regionId:'suncheon',workflow:'site',radiusM:500},options);
 assert.equal(site.result.context.sites.length,2);assert.equal(site.result.scenario.newlyCovered,null);assert.ok(site.result.context.sites.every(s=>s.datasets.some(d=>d.datasetId==='schools')));
 const inspection=await runDecision({regionId:'suncheon',workflow:'inspection'},options);
 assert.equal(inspection.result.scenario.proposedSites.length,0);assert.deepEqual(inspection.result.rows[0].sourceFlags.loweredCurb,false);
 assert.ok(inspection.result.rows.some(r=>r.sourceFlags.dedicatedLighting===null));
});
test('decision: endpoint enforces same origin and method before calculation',async()=>{
 const res=()=>({headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(s){this.body=JSON.parse(s);}});
 let response=res();await handleDecisionTwin({method:'DELETE',headers:{}},response,options);assert.equal(response.statusCode,405);
 response=res();await handleDecisionTwin({method:'POST',headers:{origin:'https://other.example',host:'seogu-on.vercel.app'}},response,options);assert.equal(response.statusCode,403);
});
test('decision: only actionable spatial questions reroute the always-visible question input',()=>{
 for(const q of ['그늘막 3곳을 추가하면?','어디부터 점검할까요?','사업 후보지 주변을 비교해줘'])assert.equal(isDecisionQuestion(q),true,q);
 for(const q of ['서구의 학교는 몇 개인가요?','토요일 10시 주민모임 공간을 찾아줘','오늘 기온은?'])assert.equal(isDecisionQuestion(q),false,q);
});
test('living facility lookup opens a present-day map instead of adding hypothetical facilities',()=>{
 const boundaries={features:[{properties:{dongId:'seogu-01',dongName:'풍암동'}}]};
 assert.deepEqual(livingMapIntent('풍암동 어린이집 위치 보여줘',{boundaries}),{topic:'care',scopeId:'seogu-01'});
 assert.deepEqual(livingMapIntent('여성안심시설 지도를 보여줘'),{topic:'safety'});
 assert.deepEqual(livingMapIntent('전체 보안등 위치 알려줘'),{topic:'safety',scopeId:'all'});
 for(const question of ['어린이집 2곳 추가해줘','비상벨 점검 대상을 찾아줘','육아휴직 기준 알려줘','어린이집 보육료 지원금 알려줘','어린이집 설치기준 알려줘','오늘 기온은?'])assert.equal(livingMapIntent(question),null,question);
 for(const question of ['어린이집 2곳 추가해줘','비상벨 2개 설치해줘','야간 정류장 보안등 점검'])assert.equal(isDecisionQuestion(question),true,question);
 assert.equal(isDecisionQuestion('어린이집 설치기준 알려줘'),false);
});
test('living care lookup does not substitute childcare centres for distinct requested facility types',()=>{
 const boundaries={features:[{properties:{dongId:'seogu-01',dongName:'풍암동'}}]};
 for(const question of ['유치원 위치 보여줘','지역아동센터 목록 알려줘','공동육아나눔터 어디 있어?','다함께돌봄센터 위치 보여줘','아이돌봄센터 찾아줘','지역 아동 센터 지도 보여줘','어린이집과 유치원 위치 보여줘','돌봄시설 중 공동 육아 나눔터 찾아줘'])assert.equal(livingMapIntent(question,{boundaries}),null,question);
 for(const question of ['어린이집 위치 보여줘','돌봄시설 지도 보여줘','육아시설 현황 알려줘'])assert.deepEqual(livingMapIntent(question,{boundaries}),{topic:'care'},question);
 assert.deepEqual(livingMapIntent('풍암동 돌봄시설 위치 보여줘',{boundaries}),{topic:'care',scopeId:'seogu-01'});
});
test('care and safety comparisons choose their own source files and domain followups',async()=>{
 const care=await runDecision({regionId:'seogu',question:'어린이집 주변 활동공간 점검 목록을 보여줘'},options);
 assert.equal(care.result.preset.id,'childcare');assert.equal(care.result.preset.target,'childcare');assert.equal(care.result.preset.service,'public-spaces');
 assert.ok(care.ai.structured.followups.includes('careEligibility'));assert.equal(care.result.rows.length,122);
 const bells=await runDecision({regionId:'seogu',workflow:'inspection',presetId:'women-safety',proposedSites:[]},options);
 assert.equal(bells.result.preset.service,'emergency-bell');assert.ok(bells.ai.structured.followups.includes('safetyOperation'));
 assert.equal(bells.result.sourceStatus.find(s=>s.id==='emergency-bell').sourceDate,'2023-06-21');
 const lights=await runDecision({regionId:'seogu',workflow:'inspection',presetId:'night-safety',proposedSites:[]},options);
 assert.equal(lights.result.preset.service,'security-light');assert.ok(lights.ai.structured.followups.includes('nightField'));
 assert.ok(Buffer.byteLength(JSON.stringify(lights))<4_200_000,'real night inspection must fit the serverless response budget');
});
