import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {answerQuestion,resetAskLimits} from '../server/ai/ask.js';
const dataDir=fileURLToPath(new URL('./fixtures/spatial/data/',import.meta.url));
const json=(status,payload)=>({status,ok:status===200,json:async()=>payload});
const model=(name,methods=['generateContent'])=>({name:'models/'+name,supportedGenerationMethods:methods});
test.beforeEach(()=>resetAskLimits());
test('404 recovery uses authenticated models list, stable Flash only, effective model in response',async()=>{
  const requests=[];
  const fetcher=async(url,init)=>{
    requests.push({url,init});
    if(requests.length===1)return json(404,{});
    if(init.method==='GET')return json(200,{models:[model('gemini-9.9-pro'),model('gemini-9.9-flash-preview'),model('gemini-4.0-flash'),model('gemini-3.8-flash'),model('gemini-8.0-flash',['embedContent'])]});
    return json(200,{candidates:[{content:{parts:[{text:'지도에 실린 자료로 동별 시설을 찾아볼 수 있습니다.'}]}}]});
  };
  const result=await answerQuestion({question:'어떤 일을 할 수 있어?',previousQuestions:[]},{dataDir,fetcher,env:{GEMINI_API_KEY:'private-key',AI_MODEL:'models/old-flash'}});
  assert.equal(result.mode,'llm');assert.equal(result.model,'gemini-4.0-flash');assert.equal(result.modelRecovered,true);assert.equal(requests.length,3);
  assert.ok(requests[1].url.endsWith('models?pageSize=1000'));assert.equal(requests[1].init.headers['x-goog-api-key'],'private-key');
  assert.ok(requests.every(r=>!r.url.includes('private-key')));assert.ok(!JSON.stringify(result).includes('private-key'));
});
test('429 is not retried; repeated 404 only attempts one alternate then falls back honestly',async t=>{
  t.mock.method(console,'error',()=>{});
  for(const status of [429,404]){
    const calls=[];
    const result=await answerQuestion({question:'가람동 버스정류장',previousQuestions:[]},{dataDir,env:{GEMINI_API_KEY:'private-key'},fetcher:async(url,init)=>{calls.push(url);return init.method==='GET'?json(200,{models:[model('gemma-4-31b-it')]}):json(status,{});}});
    assert.equal(result.mode,'rules');assert.equal(calls.length,status===429?1:3);assert.equal(result.code,status===429?'LLM_QUOTA':'LLM_MODEL_NOT_FOUND');
  }
});
test('discovery failure keeps original error without exposing upstream response',async t=>{
  t.mock.method(console,'error',()=>{});const result=await answerQuestion({question:'가람동 버스정류장',previousQuestions:[]},{dataDir,env:{GEMINI_API_KEY:'private-key'},fetcher:async(url,init)=>init.method==='GET'?json(403,{error:'private-key'}):json(404,{})});
  assert.equal(result.code,'LLM_MODEL_NOT_FOUND');assert.ok(!JSON.stringify(result).includes('private-key'));
});
