import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLiveStatus} from '../src/city/live-status.js';
test('top ribbon never fetches or renders air quality after removal',async()=>{
  const nodes=new Map();
  for(const id of ['live-place','live-temperature','live-rainfall','live-safety','live-observed'])nodes.set(id,{textContent:'',title:'',closest:()=>({classList:{toggle(){}}})});
  const before=globalThis.document;globalThis.document={getElementById:id=>nodes.get(id)||null};
  const calls=[];
  const live=createLiveStatus({state:{dong:'d1',dongs:[{properties:{dongId:'d1',labelPoint:[126.85,35.15]}}],entries:new Map(),view:null},label:()=> '검증동',fetchJSON:async path=>{calls.push(path);return {base:{base_date:'20261019',base_time:'0900'},values:{T1H:0,RN1:0}};}});
  try{await live.refresh();assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/api/weather?'));assert.equal(new URL(calls[0],'https://test.invalid').searchParams.get('regionId'),'seogu');assert.equal(nodes.get('live-temperature').textContent,'0℃');assert.equal(nodes.get('live-rainfall').textContent,'0mm');assert.ok(!nodes.get('live-observed').textContent.includes('미세먼지'));}
  finally{live.destroy();globalThis.document=before;}
  assert.ok(!readFileSync(new URL('../index.html',import.meta.url),'utf8').includes('id="live-air"'));
});

test('top ribbon sends Suncheon context and never reuses Seo-gu all-scope weather after region change',async()=>{
 const nodes=new Map();for(const id of ['live-place','live-temperature','live-rainfall','live-safety','live-observed'])nodes.set(id,{textContent:'',title:'',closest:()=>({classList:{toggle(){}}})});
 const before=globalThis.document;globalThis.document={getElementById:id=>nodes.get(id)||null};
 const state={regionProfile:{id:'seogu',capabilities:{legacySeoguServices:true}},dong:'all',district:{type:'Point',coordinates:[126.85,35.15]},entries:new Map(),view:null};
 const calls=[];let failSuncheon=true;
 const live=createLiveStatus({state,label:()=>state.regionProfile.id,fetchJSON:async path=>{
  const params=new URL(path,'https://test.invalid').searchParams;calls.push(params);
  if(params.get('regionId')==='suncheon'&&failSuncheon)throw Error('test connection failure');
  return {regionId:params.get('regionId'),base:{base_date:'20261023',base_time:'0900'},values:{T1H:params.get('regionId')==='suncheon'?18:11,RN1:0}};
 }});
 try{
  await live.refresh();assert.equal(nodes.get('live-temperature').textContent,'11℃');
  state.regionProfile={id:'suncheon',capabilities:{legacySeoguServices:false}};state.district={type:'Point',coordinates:[127.3844,35.01]};
  await live.scopeChanged();assert.equal(calls[1].get('regionId'),'suncheon');assert.equal(calls[1].get('lon'),'127.3844');assert.equal(nodes.get('live-temperature').textContent,'미수신');
  failSuncheon=false;await live.refresh();assert.equal(nodes.get('live-temperature').textContent,'18℃');assert.equal(nodes.get('live-safety').textContent,'지역 공간자료');
 }finally{live.destroy();globalThis.document=before;}
});

test('top ribbon rejects a weather response explicitly labelled as another region',async()=>{
 const nodes=new Map();for(const id of ['live-place','live-temperature','live-rainfall','live-safety','live-observed'])nodes.set(id,{textContent:'',title:'',closest:()=>({classList:{toggle(){}}})});
 const before=globalThis.document;globalThis.document={getElementById:id=>nodes.get(id)||null};
 const live=createLiveStatus({state:{regionProfile:{id:'suncheon',capabilities:{legacySeoguServices:false}},dong:'all',district:{type:'Point',coordinates:[127.38,35.01]},entries:new Map(),view:null},label:()=> '순천',fetchJSON:async()=>({regionId:'seogu',base:{base_date:'20261023',base_time:'0900'},values:{T1H:11,RN1:0}})});
 try{await live.refresh();assert.equal(nodes.get('live-temperature').textContent,'미수신');assert.equal(live.failures().weather.code,'BAD_SHAPE');}
 finally{live.destroy();globalThis.document=before;}
});
