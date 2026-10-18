import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {modelConfig,DEFAULT_MODEL} from '../server/ai/model-config.js';
import {answerQuestion,resetAskLimits} from '../server/ai/ask.js';
const dataDir=fileURLToPath(new URL('./fixtures/spatial/data/',import.meta.url));
test.beforeEach(()=>resetAskLimits());
test('default migrates old Flash configuration to Gemma and respects explicit new model selection',()=>{
  assert.equal(DEFAULT_MODEL,'gemma-4-26b-a4b-it');assert.equal(modelConfig({GEMINI_MODEL:'gemini-2.5-flash'}).model,DEFAULT_MODEL);
  assert.equal(modelConfig({GEMINI_MODEL:'gemma-4-31b-it'}).model,'gemma-4-31b-it');assert.equal(modelConfig({AI_MODEL:'gemini-3.8-flash'}).model,'gemini-3.8-flash');
});
test('compatible endpoint is server-controlled: no URL credentials, redirects, remote cleartext or production loopback',()=>{
  for(const base of ['http://remote.invalid/v1','https://user:secret@model.invalid/v1','https://model.invalid/v1?key=secret','https://model.invalid/v1#x'])assert.ok(modelConfig({AI_PROVIDER:'openai-compatible',AI_API_BASE:base}).error);
  assert.equal(modelConfig({AI_PROVIDER:'openai-compatible',AI_API_BASE:'http://127.0.0.1:8000/v1'}).error,undefined);
  assert.ok(modelConfig({AI_PROVIDER:'openai-compatible',AI_API_BASE:'http://127.0.0.1:8000/v1',VERCEL:'1'}).error);
});
test('compatible server uses same spatial tools, preserves tool call IDs and reports actual model',async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,init,body});
    return {ok:true,json:async()=>({choices:[{message:calls.length===1?{tool_calls:[{id:'call-1',type:'function',function:{name:'find_facilities',arguments:JSON.stringify({category:'bus',dong:'가람동'})}}]}:{content:'가람동에는 버스정류장 수록 지점이 2곳 있습니다. 부분 자료 기준입니다.'},finish_reason:'stop'}]})};
  };
  const result=await answerQuestion({question:'가람동 버스정류장',previousQuestions:[]},{dataDir,fetcher,env:{AI_PROVIDER:'openai-compatible',AI_MODEL:'google/gemma-4-26B-A4B-it',AI_API_BASE:'https://model.example/v1',AI_API_KEY:'test-private'}});
  assert.equal(result.mode,'llm');assert.equal(result.model,'google/gemma-4-26B-A4B-it');assert.equal(result.provider,'openai-compatible');assert.equal(result.map.highlight.features.length,2);
  assert.equal(calls[0].url,'https://model.example/v1/chat/completions');assert.equal(calls[0].init.headers.Authorization,'Bearer test-private');assert.equal(calls[0].init.redirect,'error');
  assert.ok(calls[0].body.tools.some(t=>t.function.name==='find_facilities'));
  assert.equal(calls[1].body.messages.find(m=>m.role==='tool').tool_call_id,'call-1');assert.ok(!JSON.stringify(result).includes('test-private'));
});
test('compatible errors never leak raw upstream content or fall back to a different provider',async t=>{
  t.mock.method(console,'error',()=>{});let calls=0;
  const result=await answerQuestion({question:'가람동 버스정류장',previousQuestions:[]},{dataDir,env:{AI_PROVIDER:'openai-compatible',AI_API_BASE:'https://model.example/v1',AI_API_KEY:'private'},fetcher:async()=>{calls++;return {ok:false,status:401,json:async()=>({secret:'private'})};}});
  assert.equal(result.mode,'rules');assert.equal(result.code,'LLM_KEY_REJECTED');assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('private'));
});
