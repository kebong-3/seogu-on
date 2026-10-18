import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORKFLOWS,reviewRows,calculateAdminPlan,adminReportHtml} from '../src/city/admin-plans-model.js';
const point=(id,xy,properties={})=>({type:'Feature',geometry:{type:'Point',coordinates:xy},properties:{id,name:id,...properties}});
test('icing groups by source section, not repeated management number; retains endpoints',()=>{
  const p=reviewRows('icing',[point('a',[127,35],{sectionSourceId:'1',sectionNo:'same'}),point('b',[127.01,35],{sectionSourceId:'1',sectionNo:'same'}),point('c',[127.02,35],{sectionSourceId:'2',sectionNo:'same'})]);
  assert.equal(p.rows.length,2);assert.equal(p.rows[0].records.length,2);assert.equal(p.valid,3);
});
test('flood groups only exact coordinates and preserves original records and years',()=>{
  const p=reviewRows('flood',[point('a',[127,35],{eventYear:'2021'}),point('b',[127,35],{eventYear:'2022'}),point('c',[127.00001,35],{eventYear:'2022'})]);
  assert.equal(p.rows.length,2);assert.deepEqual(p.rows[0].years,['2021','2022']);assert.equal(p.valid,3);
});
test('cold uses nearby shelters across boundary; supplementation is capped and reviews need notes',()=>{
  const source={features:[point('a',[127,35]),point('b',[127.03,35]),point('c',[127.04,35])]},assets={features:[point('h',[127.0001,35])]};
  const plan=calculateAdminPlan({kind:'cold',source,assets,scopeName:'시험',settings:{radius:100,maxNew:1},reviews:{b:{status:'checked'}}});
  assert.equal(plan.existing,1);assert.equal(plan.additional,1);assert.equal(plan.checked,0);assert.equal(plan.facilities,1);
  const changed=calculateAdminPlan({kind:'cold',source,assets,scopeName:'시험',settings:{radius:100,maxNew:1},reviews:{c:{choice:'exclude',note:'확인 대기'},b:{choice:'supplement',status:'checked',note:'시험 기록'}}});
  assert.equal(changed.excluded,1);assert.equal(changed.checked,1);assert.equal(changed.rows.find(r=>r.id==='b').action,'supplement');
});
test('missing source fails; report escapes notes and preserves follow-up fields',()=>{
  assert.throws(()=>calculateAdminPlan({kind:'cold',source:{features:[]}}),/미수신/);
  const p=calculateAdminPlan({kind:'school',source:{features:[point('a',[127,35])]},scopeName:'시험',reviews:{a:{note:'<script>x</script>',department:'교통부서',due:'2026-11-01',choice:'coordinate',status:'followup'}}});
  const html=adminReportHtml(p,'<img src=x onerror=x>');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('교통부서'));assert.ok(html.includes('2026-11-01'));assert.equal(p.additional,1);
});
test('all four workflows load their real bundled sources and report reproducibly',()=>{
  const load=url=>JSON.parse(readFileSync(new URL('../public'+url,import.meta.url)));
  for(const [kind,c]of Object.entries(WORKFLOWS)){
    const p=calculateAdminPlan({kind,source:load(c.source),assets:c.asset?load(c.asset):undefined,scopeName:'서구 전체'});
    assert.ok(p.rows.length>0);assert.ok(p.sourceRecords>=p.rows.length);assert.ok(adminReportHtml(p).includes(c.title));
    if(kind==='icing'){assert.equal(p.rows.length,12);assert.equal(p.sourceRecords,23);}
    if(kind==='school')assert.equal(p.sourceRecords,62);
    if(kind==='cold')assert.equal(p.sourceRecords,433);
  }
});
