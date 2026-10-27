import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {modelConfig} from '../server/ai/model-config.js';
import {answerQuestion,resetAskLimits} from '../server/ai/ask.js';
import {generateCompatible} from '../server/ai/compatible.js';
import {runDecision} from '../server/ai/decision-twin.js';
import {reviewSpace} from '../server/ai/space-review.js';
import {answerRegionQuestion} from '../server/ai/region-ask.js';
import {loadRegionData} from '../server/region-profile.js';
import {seedAssets} from '../shared/space-twin-model.js';

const dataDir=fileURLToPath(new URL('./fixtures/spatial/data/',import.meta.url));
const env={AI_PROVIDER:'upstage',UPSTAGE_API_KEY:'test-only-solar-key',AI_MODEL:'solar-pro4',AI_REASONING_EFFORT:'medium'};
const reply=content=>({ok:true,json:async()=>({choices:[{message:{content,reasoning:'PRIVATE_REASONING_DO_NOT_RETURN'},finish_reason:'stop'}]})});
test.beforeEach(()=>resetAskLimits());

test('Solar aliases use a fixed endpoint, own key and model; old Google values cannot change defaults',()=>{
  for(const provider of ['upstage','solar']){
    const c=modelConfig({AI_PROVIDER:provider,UPSTAGE_API_KEY:'solar-test',AI_API_KEY:'other-test',AI_API_BASE:'https://unrelated.invalid/v1',GEMMA_MODEL:'gemma-legacy',GEMINI_MODEL:'gemini-legacy'});
    assert.deepEqual(c,{provider:'upstage',model:'solar-pro4',key:'solar-test',baseUrl:'https://api.upstage.ai/v1',reasoningEffort:'medium'});
  }
  assert.equal(modelConfig({...env,AI_MODEL:'solar-pro4-260806'}).model,'solar-pro4-260806');
  assert.equal(modelConfig({...env,AI_REASONING_EFFORT:'unexpected'}).error,'AI_REASONING_EFFORT');
  assert.equal(modelConfig({AI_PROVIDER:'upstage',AI_API_KEY:'common-test'}).key,'common-test');
});

test('Solar key is required before network access and quota consumption',async()=>{
  const result=await answerQuestion({question:'가람동 버스정류장',previousQuestions:[]},{dataDir,env:{AI_PROVIDER:'upstage'},fetcher:()=>{throw Error('No request allowed');}});
  assert.equal(result.mode,'rules');assert.equal(result.code,'LLM_NOT_CONFIGURED');
});

test('Solar chat keeps tool IDs and grounded answer while discarding reasoning and credentials',async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,init,body});
    if(calls.length===1)return {ok:true,json:async()=>({choices:[{message:{reasoning:'PRIVATE_REASONING_DO_NOT_RETURN',tool_calls:[{id:'solar-call-1',type:'function',function:{name:'find_facilities',arguments:JSON.stringify({category:'bus',dong:'가람동'})}}]},finish_reason:'tool_calls'}]})};
    return reply('가람동에는 버스정류장 수록 지점이 2곳 있습니다. 부분 자료 기준입니다.');
  };
  const result=await answerQuestion({question:'가람동 버스정류장',previousQuestions:[]},{dataDir,env,fetcher,precompute:false});
  assert.equal(result.mode,'llm');assert.equal(result.model,'solar-pro4');assert.equal(result.provider,'upstage');assert.equal(result.map.highlight.features.length,2);
  assert.equal(calls.length,2);assert.equal(calls[0].url,'https://api.upstage.ai/v1/chat/completions');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers.Authorization,'Bearer test-only-solar-key');
  assert.equal(calls[0].body.reasoning_effort,'medium');assert.equal(calls[0].body.max_tokens,8192);assert.equal(calls[1].body.messages.find(m=>m.role==='tool').tool_call_id,'solar-call-1');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REASONING|test-only-solar-key/);assert.doesNotMatch(JSON.stringify(calls[1].body),/PRIVATE_REASONING/);
});

test('Solar 404 never probes Google or another provider and does not expose upstream error',async t=>{
  t.mock.method(console,'error',()=>{});const urls=[];
  const result=await answerQuestion({question:'가람동 버스정류장',previousQuestions:[]},{dataDir,env,fetcher:async url=>{urls.push(url);return {ok:false,status:404,json:async()=>({error:'PRIVATE UPSTREAM'})};}});
  assert.deepEqual(urls,['https://api.upstage.ai/v1/chat/completions']);assert.equal(result.mode,'rules');assert.equal(result.code,'LLM_MODEL_NOT_FOUND');assert.doesNotMatch(JSON.stringify(result),/PRIVATE UPSTREAM/);
});

test('reasoning-only output stays empty, never substituted for the final answer',async()=>{
  const body={systemInstruction:{parts:[{text:'test'}]},contents:[{role:'user',parts:[{text:'test'}]}],generationConfig:{temperature:0,maxOutputTokens:1000},tools:[{functionDeclarations:[]}],toolConfig:{functionCallingConfig:{mode:'NONE'}}};
  let sent;
  const out=await generateCompatible({fetcher:async(_url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{content:null,reasoning:'PRIVATE_REASONING_DO_NOT_RETURN'},finish_reason:'length'}]})};},key:'test',model:'solar-pro4',baseUrl:'https://api.upstage.ai/v1',body,timeoutMs:1000,reasoningEffort:'none'});
  assert.equal(sent.reasoning_effort,'none');assert.equal(sent.max_tokens,1000);assert.equal(sent.tools,undefined);assert.deepEqual(out.candidates[0].content.parts,[]);assert.equal(out.candidates[0].finishReason,'MAX_TOKENS');
});

test('Solar decision planning uses the compatible path and reasoning option',async()=>{
  let sent;
  const result=await runDecision({regionId:'seogu',question:'정류장 주변 그늘막을 검토해줘'},{env,fetcher:async(url,init)=>{assert.equal(url,'https://api.upstage.ai/v1/chat/completions');sent=JSON.parse(init.body);return reply(JSON.stringify({workflow:'coverage',presetId:'shade',scopeId:'all',radiusM:150,maxNew:3}));}});
  assert.equal(result.planner.mode,'llm');assert.equal(result.planner.model,'solar-pro4');assert.equal(sent.reasoning_effort,'medium');assert.equal(sent.tools,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REASONING/);
});

test('Solar space review shares validated references and no provider reasoning',async()=>{
  const pack=await loadRegionData({env:{}}),assets=seedAssets(pack.facilities,{regionId:pack.profile.id,datasetId:pack.profile.facilityLayerId});let sent;
  const result=await reviewSpace({regionId:'seogu',assetIds:[assets[0].id],observations:{},query:{dayOfWeek:6,start:'10:00',end:'12:00'},scenarios:[]},{env,fetcher:async(url,init)=>{assert.equal(url,'https://api.upstage.ai/v1/chat/completions');sent=JSON.parse(init.body);return reply(JSON.stringify({version:1,claims:[{scenarioId:'baseline',assetId:null,metricRef:'unknownCount'}],causes:[],followups:[{scenarioId:'baseline',assetId:null,kind:'reservation'}]}));}});
  assert.equal(result.mode,'llm');assert.equal(result.model,'solar-pro4');assert.equal(sent.reasoning_effort,'medium');assert.equal(sent.tools,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REASONING/);
});

test('Solar region question validates selected source IDs using the same compatible transport',async()=>{
  let sent;
  const result=await answerRegionQuestion({regionId:'suncheon',question:'수영장 찾아줘'},{env,allowModel:()=>true,fetcher:async(url,init)=>{assert.equal(url,'https://api.upstage.ai/v1/chat/completions');sent=JSON.parse(init.body);const evidence=JSON.parse(sent.messages[1].content);return reply(JSON.stringify({assetIds:[evidence.candidates[0].id],checks:['hours','booking']}));}});
  assert.equal(result.mode,'llm');assert.equal(result.model,'solar-pro4');assert.equal(sent.reasoning_effort,'medium');assert.equal(sent.tools,undefined);assert.equal(result.map.highlight.features.length,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REASONING/);
});
