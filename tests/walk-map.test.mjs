import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalkMap} from '../src/city/walk-map.js';
import {PendingMessages} from '../src/city/layer-sync.js';

const route=(id,role)=>({id,role,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[[126.89,35.15],[126.88,35.16]]},properties:{description:'provider route'}}]}});
function harness(){let time=0,next;const sent=[];const map=createWalkMap({send:m=>sent.push(m),now:()=>time,schedule:(fn,ms)=>{next={fn,ms};return 1;},cancel:()=>{next=null;}});return {map,sent,setTime:t=>time=t,timer:()=>next};}

test('selected facility detour is overlaid with the direct reference in distinct colors',()=>{
 const h=harness();h.map.paint([route('a','direct'),route('b','via')],'b',[{id:'start',name:'출발',role:'start',coordinate:[126.89,35.15]}]);
 const shown=h.sent.filter(m=>m.visible);assert.deepEqual(shown.map(m=>m.id),['walk-direct','walk-selected','walk-points']);
 assert.equal(shown[0].features[0].properties.displayColor,'#00e5ff');assert.equal(shown[1].features[0].properties.displayColor,'#ff49db');
 assert.equal(shown[2].features[0].properties.name,'출발');assert.equal(shown[0].features[0].properties.ephemeral,true);
 h.map.destroy();
});

test('clear wipes viewer and pending-message geometry rather than only hiding it',()=>{
 const h=harness(),pending=new PendingMessages();h.map.paint([route('a','direct')],'a');for(const m of h.sent)pending.add(m);h.sent.length=0;
 h.map.clear();for(const m of h.sent)pending.add(m);
 assert.equal(h.sent.length,4);assert.ok(h.sent.every(m=>m.visible===false&&m.features.length===0));
 assert.ok(pending.drain().every(m=>m.features.length===0));h.sent.length=0;h.map.replay();assert.equal(h.sent.length,0);
});

test('map replay independently expires geometry within thirty minutes',()=>{
 const h=harness();h.map.paint([route('a','direct')],'a');assert.equal(h.timer().ms,30*60*1000);
 h.sent.length=0;h.setTime(30*60*1000);h.map.replay();assert.ok(h.sent.every(m=>m.visible===false&&m.features.length===0));
});

test('choosing the direct route removes the previous alternative and does not mutate provider data',()=>{
 const h=harness(),a=route('a','direct'),b=route('b','via');const original=JSON.stringify([a,b]);h.map.paint([a,b],'b');h.sent.length=0;h.map.paint([a,b],'a');
 assert.ok(!h.sent.some(m=>m.id==='walk-selected'&&m.visible));assert.equal(JSON.stringify([a,b]),original);h.map.destroy();
});

test('provider turn points do not become facility markers along the whole route',()=>{
 const h=harness(),a=route('a','direct');a.geojson.features.unshift({type:'Feature',geometry:{type:'Point',coordinates:[126.89,35.15]},properties:{pointType:'SP',description:'길 안내'}});
 h.map.paint([a],'a',[{id:'start',name:'출발',coordinate:[126.89,35.15],role:'start'}]);
 assert.equal(h.sent.find(m=>m.id==='walk-direct'&&m.visible).features.length,1);
 assert.equal(h.sent.find(m=>m.id==='walk-points'&&m.visible).features.length,1);h.map.destroy();
});

test('seasonal sample segments have separate model colors and expire with provider routes',()=>{
 const h=harness(),a=route('a','direct'),original=JSON.stringify(a),segment=state=>({type:'Feature',geometry:a.geojson.features[0].geometry,properties:{assessmentState:state}});
 h.map.paint([a],'a',[],[segment('shade'),segment('unknown'),segment('low'),segment('bogus')]);
 const shown=h.sent.find(m=>m.id==='walk-assessment'&&m.visible);
 assert.deepEqual(shown.features.map(f=>f.properties.displayColor),['#007d75','#78838c','#d66a24']);
 assert.ok(shown.features.every(f=>f.properties.ephemeral));assert.equal(JSON.stringify(a),original);
 h.sent.length=0;h.setTime(30*60*1000);h.map.replay();
 assert.ok(h.sent.some(m=>m.id==='walk-assessment'&&!m.visible&&m.features.length===0));
});
