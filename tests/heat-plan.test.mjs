import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculatePlan,cleanPoints,reportHtml} from '../src/city/heat-plan-model.js';
const point=(id,x,name=id)=>({type:'Feature',geometry:{type:'Point',coordinates:[x,35]},properties:{id,name}});
const datasets={bus:{features:[point('b1',127),point('b2',127.002),point('b3',127.006),point('b4',127.012)]},shade:{features:[point('s1',127)]},shelter:{features:[point('h1',127.002)]}};
const settings={shadeRadius:100,shelterRadius:120,maxNew:3,years:3,operating:'',unit:'',maintenance:'',budget:''};
const run=(extra={})=>calculatePlan({datasets,settings,scopeName:'테스트',...extra});
test('heat comparison: existing first, additional candidates distinct, blanks are unknown costs',()=>{
  const p=run();assert.equal(p.total,4);assert.equal(p.baseline,1);assert.equal(p.candidates.length,3);assert.equal(p.existing,1);assert.equal(p.newCount,2);assert.equal(p.costs.annualA,null);assert.equal(p.costs.annualB,null);assert.equal(p.costs.totalB,null);
});
test('costs: first-year budget and multi-year maintenance are separate; no invented free operation',()=>{
  const p=run({settings:{...settings,operating:10,unit:100,maintenance:5,budget:115}});
  assert.equal(p.newCount,1);assert.equal(p.costs.annualB,115);assert.equal(p.costs.totalB,145);assert.equal(p.costs.totalA,30);
  assert.equal(run({settings:{...settings,maxNew:0,operating:10}}).costs.totalB,30);
  assert.equal(run({settings:{...settings,unit:100,maintenance:5,budget:115}}).costs.annualB,null);
  assert.equal(run({settings:{...settings,operating:10,unit:100,maintenance:5,budget:5}}).costs.budgetStatus,'over');
});
test('review exclusions remove candidates from both alternatives; same-named stops remain distinct',()=>{
  const p=run({reviews:{b2:{choice:'exclude',note:'개방협의 필요'},b4:{review:'hold'}}});
  assert.equal(p.existing,0);assert.equal(p.newCount,1);assert.equal(p.unassigned,2);
  assert.equal(cleanPoints([point('a',127,'동일명'),point('b',127.001,'동일명'),point('a',127)]).points.length,2);
});
test('cost decimals at exact budget boundary are calculated in integer hundredths',()=>{
  const p=run({settings:{...settings,operating:0.1,unit:0.1,maintenance:0.1,budget:0.3}});
  assert.equal(p.newCount,1);assert.equal(p.costs.annualB,0.3);assert.equal(p.costs.totalB,0.7);
});
test('missing data fails instead of zero; invalid coordinates and invalid numbers never enter totals',()=>{
  assert.throws(()=>run({datasets:{...datasets,shade:{}}}),/미수신/);
  assert.equal(cleanPoints([point('a',Infinity)]).omitted,1);
  for(const v of [-1,NaN,Infinity,'oops'])assert.throws(()=>run({settings:{...settings,unit:v}}));
  assert.throws(()=>run({settings:{...settings,maxNew:1.2}}));
});
test('boundary: nearby existing facility outside selected area is retained',()=>{
  const scope={type:'Polygon',coordinates:[[[127.0019,34.999],[127.0021,34.999],[127.0021,35.001],[127.0019,35.001],[127.0019,34.999]]]};
  const p=run({scope,datasets:{...datasets,shelter:{features:[point('outside',127.0022)]}}});assert.equal(p.total,1);assert.equal(p.existing,1);
});
test('explicit installation choice precedes automatic suggestions within the cap; check needs a note',()=>{
  const p=run({settings:{...settings,maxNew:1},reviews:{b2:{choice:'install',review:'checked'}}});
  assert.equal(p.candidates.find(r=>r.id==='b2').action,'install');assert.equal(p.checked,0);
  assert.equal(run({reviews:{b2:{review:'checked',note:'현장 검토 기록'}}}).checked,1);
});
test('report: exact comparison, assumptions, sources, and review notes; input escaped',()=>{
  const p=run({reviews:{b3:{note:'<script>alert(1)</script>'}}});const html=reportHtml(p,{preferred:'B',rationale:'<img src=x onerror=alert(1)>'});
  assert.ok(html.includes('2지점'));assert.ok(html.includes('미산정'));assert.ok(html.includes('원자료'));assert.ok(html.includes('실제 그늘'));
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
});
test('real bundled Pungam data reproduces baseline and conserves candidates',()=>{
  const data=Object.fromEntries(Object.entries({bus:'infra/bus',shade:'local-shade',shelter:'official/heat-shelter'}).map(([k,p])=>[k,JSON.parse(readFileSync(new URL('../public/data/city/'+p+'.geojson',import.meta.url)))]));
  const dongs=JSON.parse(readFileSync(new URL('../public/data/admin-dongs.geojson',import.meta.url))).features;
  const scope=dongs.find(f=>f.properties.dongName==='풍암동').geometry;
  const p=run({datasets:data,scope,settings:{...settings,shadeRadius:150,shelterRadius:300}});
  assert.equal(p.total,37);assert.equal(p.candidates.length,23);assert.equal(p.baseline,14);assert.equal(p.existing+p.newCount+p.unassigned,23);assert.equal(p.newCount,3);
});
