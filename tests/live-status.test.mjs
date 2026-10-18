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
  try{await live.refresh();assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/api/weather?'));assert.equal(nodes.get('live-temperature').textContent,'0℃');assert.equal(nodes.get('live-rainfall').textContent,'0mm');assert.ok(!nodes.get('live-observed').textContent.includes('미세먼지'));}
  finally{live.destroy();globalThis.document=before;}
  assert.ok(!readFileSync(new URL('../index.html',import.meta.url),'utf8').includes('id="live-air"'));
});
