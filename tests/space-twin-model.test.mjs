import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  seedAssets, createWorkspace, recordObservation, upsertScenario, compareWorkspace,
  serializeWorkspace, parseWorkspace, validateWorkspace, saveSnapshot, diffSnapshots,
  normalizeObservation, normalizeQuery, mergeWorkspaces, straightDistance,
  assetSourceFingerprint, observationState, spaceComparisonFingerprint, dataFingerprint,
} from '../shared/space-twin-model.js';
import {renderSpaceExplanation,spaceRulesSummary} from '../shared/space-review-evidence.js';

const now = '2026-10-22T03:00:00.000Z';
const later = '2026-10-23T03:00:00.000Z';
const record = (patch = {}) => ({operatingStatus:'open', daysOfWeek:[1,2,3,4,5], opens:'09:00', closes:'18:00', observedOn:'2026-10-22', evidence:'자동시험용 현장확인 입력 — 실제 조사 아님', ...patch});
const feature = (n, patch = {}) => ({type:'Feature',geometry:{type:'Point',coordinates:[126.88+n*.001,35.14]},properties:{id:`space-${n}`,name:`시험 공간 ${n}`,hours:'평일 09:00~18:00',sourceName:'시험 자료',sourceDate:'2026-10-01',sourceUrl:'https://example.com/source',...patch}});
const assets = seedAssets({type:'FeatureCollection',features:[feature(1),feature(2),feature(3)]},{regionId:'seogu'});
const create = () => createWorkspace('seogu',{now});
const query = (patch = {}) => ({dayOfWeek:1,start:'18:00',end:'21:00',assetIds:[assets[0].id],...patch});
const calculate = (w, q = query(), time = now) => compareWorkspace({assets,workspace:w,query:q,now:time});
const change = (patch = {}) => ({assetId:assets[0].id,operatingStatus:'open',daysOfWeek:[1,2,3,4,5],opens:'09:00',closes:'21:00',additionalAnnualCost:120,...patch});
const scenario = (patch = {}) => ({name:'저녁 개방 가정',changes:[change()],...patch});
const explanation = comparison => {
  const structured={version:1,claims:[{scenarioId:'baseline',assetId:null,metricRef:'eligibleCount'}],causes:[],followups:[{scenarioId:'baseline',assetId:assets[0].id,kind:'reservation'}]};
  return {ok:true,mode:'llm',answer:renderSpaceExplanation(structured,comparison),model:'test-model',computedAt:now,evidenceId:'space-0123456789abcdef0123',comparisonFingerprint:spaceComparisonFingerprint(comparison),structured,comparison};
};

test('space twin: real public-source spaces retain stable IDs and raw hours without asserting operations', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/layers/public-facilities.geojson',import.meta.url),'utf8'));
  const real = seedAssets(data,{regionId:'seogu'});
  assert.equal(real.length,58);
  assert.equal(real[0].sourceId,data.features[0].properties.id);
  assert.ok(real[0].rawHours.includes('09:00'));
  const comparison = compareWorkspace({assets:real,workspace:create(),query:{...query(),assetIds:[real[0].id]},now});
  assert.equal(comparison.baseline.unknownCount,1);
  assert.equal(comparison.baseline.rows[0].provenance,'unverified-source');
});

test('space twin: a field-recorded current state and changed hours produce recomputable differences', () => {
  const original = create();
  let w = recordObservation(original,assets[0].id,record(),{now});
  w = upsertScenario(w,scenario(),{now});
  const c = calculate(w);
  assert.equal(c.baseline.eligibleCount,0);
  assert.equal(c.baseline.unknownCount,0);
  assert.equal(c.alternatives[0].eligibleCount,1);
  assert.equal(c.alternatives[0].overlapHours,3);
  assert.deepEqual(c.alternatives[0].delta,{eligibleCount:1,overlapHours:3});
  assert.equal(c.alternatives[0].rows[0].provenance,'user-assumption');
  assert.equal(c.alternatives[0].additionalAnnualCost,120);
  assert.deepEqual(original.observations,{});
});

test('space twin: unknown current operations never become a claimed improvement', () => {
  const w = upsertScenario(create(),scenario(),{now});
  const c = calculate(w);
  assert.equal(c.baseline.unknownCount,1);
  assert.equal(c.alternatives[0].eligibleCount,1);
  assert.equal(c.alternatives[0].comparable,false);
  assert.equal(c.alternatives[0].delta,null);
});

test('space twin: complete time containment is required, partial opening contributes hours only', () => {
  const w = recordObservation(create(),assets[0].id,record({closes:'19:30'}),{now});
  const c = calculate(w);
  assert.equal(c.baseline.eligibleCount,0);
  assert.equal(c.baseline.unavailableCount,1);
  assert.equal(c.baseline.overlapHours,1.5);
  assert.equal(c.baseline.rows[0].overlapMinutes,90);
});

test('space twin: closed and non-opening weekdays exclude a space rather than infer free capacity', () => {
  let w = recordObservation(create(),assets[0].id,record({operatingStatus:'closed'}),{now});
  assert.equal(calculate(w).baseline.unavailableCount,1);
  assert.equal(calculate(w).baseline.rows[0].opens,null);
  w = recordObservation(w,assets[0].id,record({daysOfWeek:[2],closes:'21:00'}),{now});
  assert.equal(calculate(w).baseline.unavailableCount,1);
  assert.equal(calculate(w).baseline.overlapHours,0);
});

test('space twin: an explicit unknown scenario remains unknown', () => {
  let w=recordObservation(create(),assets[0].id,record(),{now});
  w=upsertScenario(w,scenario({changes:[change({operatingStatus:'unknown'})]}),{now});
  const c=calculate(w);
  assert.equal(c.alternatives[0].unknownCount,1);
  assert.equal(c.alternatives[0].delta,null);
});

test('space twin: missing annual cost is null, zero remains an explicitly supplied assumption', () => {
  let w=upsertScenario(create(),scenario({id:'a',changes:[change({additionalAnnualCost:null})]}),{now});
  assert.equal(calculate(w).alternatives[0].additionalAnnualCost,null);
  w=upsertScenario(w,scenario({id:'a',changes:[change({additionalAnnualCost:0})]}),{now});
  assert.equal(calculate(w).alternatives[0].additionalAnnualCost,0);
  assert.equal(calculate(w).alternatives[0].costComplete,true);
});

test('space twin: costs sum in integer hundredths of ten-thousand won', () => {
  const w=upsertScenario(create(),scenario({changes:[change({additionalAnnualCost:0.1}),change({assetId:assets[1].id,additionalAnnualCost:0.2})]}),{now});
  const c=calculate(w,query({assetIds:assets.slice(0,2).map(a=>a.id)}));
  assert.equal(c.alternatives[0].additionalAnnualCost,0.3);
  assert.equal(c.alternatives[0].costUnit,'만원/년');
});

test('space twin: later field checks preserve the earlier state and update the next calculation', () => {
  let w=recordObservation(create(),assets[0].id,record(),{now});
  const before=calculate(w);
  w=saveSnapshot(w,before,{name:'확인 전 결과',now});
  w=recordObservation(w,assets[0].id,record({closes:'21:00',observedOn:'2026-10-23',evidence:'자동시험용 변경 확인'}),{now:later});
  const after=calculate(w,query(),later);
  w=saveSnapshot(w,after,{name:'확인 후 결과',now:later});
  assert.equal(w.history.length,2);
  assert.equal(w.history[1].previous.closes,'18:00');
  assert.equal(w.history[1].next.closes,'21:00');
  const diff=diffSnapshots(w.snapshots[0],w.snapshots[1]);
  assert.equal(diff.comparable,true);
  assert.equal(diff.baseline.eligibleCount,1);
  assert.equal(diff.baseline.overlapHours,3);
});

test('space twin: stale and overdue records are unknown instead of asserting current availability', () => {
  const w=recordObservation(create(),assets[0].id,record({closes:'21:00',validUntil:'2026-10-22'}),{now});
  assert.equal(calculate(w).baseline.eligibleCount,1);
  assert.equal(calculate(w,query(),later).baseline.unknownCount,1);
  assert.equal(calculate(w,query(),later).baseline.rows[0].provenance,'stale-record');
  const noExpiry=recordObservation(create(),assets[0].id,record({closes:'21:00'}),{now});
  assert.equal(calculate(noExpiry,query(),'2027-02-01T03:00:00Z').baseline.unknownCount,1);
});

test('space twin: source-bound field records become unknown after hours, location, identity or source changes',()=>{
 const current=assets[0],w=recordObservation(create(),current.id,record({closes:'21:00',assetFingerprint:assetSourceFingerprint(current)}),{now});
 assert.equal(calculate(w).baseline.eligibleCount,1);
 assert.equal(observationState(w.observations[current.id],{now,asset:current}).sourceBinding,'matched');
 for(const mutate of [a=>a.rawHours='원자료 시간 변경',a=>a.coordinates[0]+=.01,a=>a.address='변경된 주소',a=>a.name='공간명 변경',a=>a.source.date='2026-10-22']){
  const changed=structuredClone(assets);mutate(changed[0]);
  const c=compareWorkspace({assets:changed,workspace:w,query:query(),now});
  assert.equal(c.baseline.eligibleCount,0);assert.equal(c.baseline.unknownCount,1);assert.equal(c.baseline.rows[0].provenance,'stale-record');assert.match(c.baseline.rows[0].reason,/원자료 변경/);
 }
 const cosmetic=structuredClone(assets);cosmetic[0].note='표현만 수정';
 assert.equal(compareWorkspace({assets:cosmetic,workspace:w,query:query(),now}).baseline.eligibleCount,1);
});
test('space twin: legacy checks remain readable but do not claim detection of historical source changes',()=>{
 const w=recordObservation(create(),assets[0].id,record({closes:'21:00'}),{now});
 const changed=structuredClone(assets);changed[0].rawHours='원자료 변경';
 const c=compareWorkspace({assets:changed,workspace:w,query:query(),now});
 assert.equal(c.baseline.eligibleCount,1);assert.match(c.baseline.rows[0].reason,/이전 기록의 원자료 변경 추적 불가/);
 assert.equal(observationState(w.observations[assets[0].id],{now,asset:changed[0]}).sourceBinding,'missing');
 assert.equal(parseWorkspace(serializeWorkspace(w,{now}),{now}).observations[assets[0].id].assetFingerprint,undefined);
 assert.throws(()=>normalizeObservation(record({assetFingerprint:'unverifiable'}),{now}),/지문/);
});
test('space twin: rechecking against changed source preserves old fingerprint in history and restores current computation',()=>{
 let w=recordObservation(create(),assets[0].id,record({closes:'21:00',assetFingerprint:assetSourceFingerprint(assets[0])}),{now});
 const changed=structuredClone(assets);changed[0].rawHours='운영시간 변경';
 w=recordObservation(w,assets[0].id,record({closes:'21:00',observedOn:'2026-10-23',assetFingerprint:assetSourceFingerprint(changed[0])}),{now:later});
 assert.notEqual(w.history[1].previous.assetFingerprint,w.history[1].next.assetFingerprint);
 assert.equal(compareWorkspace({assets:changed,workspace:w,query:query(),now:later}).baseline.eligibleCount,1);
});

test('space twin: saved explanations roundtrip with original text, model, timestamp and exact calculation binding',()=>{
 const w=recordObservation(create(),assets[0].id,record(),{now}),c=calculate(w),ai=explanation(c);
 const saved=saveSnapshot(w,c,{now,ai});const restored=parseWorkspace(serializeWorkspace(saved,{now}),{now});
 assert.equal(restored.snapshots[0].ai.answer,ai.answer);assert.equal(restored.snapshots[0].ai.model,'test-model');assert.equal(restored.snapshots[0].ai.computedAt,now);
 assert.equal(restored.snapshots[0].ai.evidenceId,ai.evidenceId);assert.deepEqual(restored.snapshots[0].ai.structured,ai.structured);assert.ok(restored.snapshots[0].ai.contentFingerprint);
 assert.equal(restored.snapshots[0].ai.comparison,undefined,'API payload is not nested again in every snapshot');
 const bookkeeping={...c,generatedAt:later,workspaceRevision:c.workspaceRevision+1,fingerprint:'fnv1a64:0000000000000000'};
 assert.equal(spaceComparisonFingerprint(c),spaceComparisonFingerprint(bookkeeping));
 const changedFacts=calculate(w,query({dayOfWeek:2}));assert.notEqual(spaceComparisonFingerprint(c),spaceComparisonFingerprint(changedFacts));
 assert.throws(()=>saveSnapshot(w,changedFacts,{now,ai}),/근거.*계산 결과/);
});
test('space twin: old snapshots still import without AI, and deterministic fallback can be preserved accurately',()=>{
 const w=create(),c=calculate(w),old=saveSnapshot(w,c,{now});
 assert.equal(parseWorkspace(serializeWorkspace(old,{now}),{now}).snapshots[0].ai,undefined);
 const fallback={mode:'rules',answer:spaceRulesSummary(c),computedAt:now,evidenceId:'space-0123456789abcdef0123',comparisonFingerprint:spaceComparisonFingerprint(c),code:'LLM_NOT_CONFIGURED',notice:'AI 연결 없이 계산 요약을 보존합니다.'};
 const saved=saveSnapshot(w,c,{now,ai:fallback});assert.equal(parseWorkspace(serializeWorkspace(saved,{now}),{now}).snapshots[0].ai.answer,fallback.answer);
 assert.throws(()=>saveSnapshot(w,c,{now,ai:{...fallback,answer:'공식 예산은 300만원입니다.'}}),/요약 문장/);
});
test('space twin: imported AI reference, numeric-text, evidence and checksum tampering is rejected',()=>{
 const w=recordObservation(create(),assets[0].id,record(),{now}),c=calculate(w),saved=saveSnapshot(w,c,{now,ai:explanation(c)});
 for(const mutate of [a=>a.answer+=' 개선율 90%입니다.',a=>a.model='changed-model',a=>a.comparisonFingerprint='fnv1a64:0000000000000000',a=>a.evidenceId='unbound',a=>a.structured.claims[0].scenarioId='not-in-comparison']){
  const copy=structuredClone(saved);mutate(copy.snapshots[0].ai);assert.throws(()=>parseWorkspace(JSON.stringify(copy),{now}));
 }
 // Recomputing the non-secret checksum cannot make an altered numeric sentence match its references.
 const copy=structuredClone(saved),ai=copy.snapshots[0].ai;ai.answer=ai.answer.replace('충족 공간 0개','충족 공간 1개');delete ai.contentFingerprint;ai.contentFingerprint=dataFingerprint(ai);
 assert.throws(()=>parseWorkspace(JSON.stringify(copy),{now}),/문장.*계산 근거/);
});

test('space twin: the observation date uses Korea day boundaries and rejects future or impossible dates', () => {
  assert.doesNotThrow(()=>normalizeObservation(record({observedOn:'2026-10-23'}),{now:'2026-10-22T15:05:00Z'}));
  assert.throws(()=>normalizeObservation(record({observedOn:'2026-10-23'}),{now}),/오늘/);
  assert.throws(()=>normalizeObservation(record({observedOn:'2026-02-30'}),{now}),/실제 날짜/);
  assert.throws(()=>normalizeObservation(record({validUntil:'2026-10-21'}),{now}),/확인일보다/);
  assert.throws(()=>normalizeObservation(record({evidence:' '}),{now}),/확인 근거/);
});

test('space twin: midnight endpoint is valid but overnight/inverted assumptions are rejected', () => {
  assert.doesNotThrow(()=>normalizeQuery(query({start:'22:00',end:'24:00'})));
  assert.throws(()=>normalizeQuery(query({start:'22:00',end:'01:00'})),/종료시각/);
  assert.throws(()=>normalizeObservation(record({opens:'18:00',closes:'09:00'}),{now}),/같은 날/);
  assert.throws(()=>normalizeObservation(record({opens:'9:00'}),{now}),/형식/);
  assert.throws(()=>normalizeObservation(record({daysOfWeek:[1,1]}),{now}),/중복/);
});

test('space twin: straight-line distance filters actual coordinates and can yield zero mapped spaces', () => {
  const c=calculate(create(),query({referencePoint:assets[1].coordinates,radiusM:1}));
  assert.equal(c.selectedCount,0);
  assert.equal(c.excludedByDistance,1);
  assert.ok(straightDistance(assets[0].coordinates,assets[1].coordinates)>80);
  assert.equal(c.baseline.eligibleCount,0);
  assert.ok(c.limitations.some(t=>t.includes('직선거리')));
});

test('space twin: saved alternatives cannot silently drop a changed space after scope/radius selection', () => {
  const w=upsertScenario(create(),scenario(),{now});
  assert.throws(()=>calculate(w,query({assetIds:[assets[1].id]})),/현재 선택/);
  assert.throws(()=>calculate(w,query({referencePoint:assets[1].coordinates,radiusM:1})),/현재 선택/);
});

test('space twin: comparison rejects missing assets, duplicate IDs and mixed regions', () => {
  assert.throws(()=>calculate(create(),query({assetIds:['missing']})),/찾을 수 없는/);
  assert.throws(()=>compareWorkspace({assets:[assets[0],assets[0]],workspace:create(),query:query(),now}),/지역 또는 ID/);
  assert.throws(()=>compareWorkspace({assets:[{...assets[0],regionId:'other'}],workspace:create(),query:query(),now}),/지역 또는 ID/);
  assert.throws(()=>seedAssets([feature(1),feature(1)],{regionId:'seogu'}),/중복/);
});

test('space twin: fixed source identities survive order changes and include source publication changes', () => {
  const reversed=[...assets].reverse();
  const before=compareWorkspace({assets,workspace:create(),query:query(),now});
  const same=compareWorkspace({assets:reversed,workspace:create(),query:query(),now});
  assert.equal(before.assetFingerprint,same.assetFingerprint);
  const altered=structuredClone(assets);altered[0].source.date='2026-10-02';
  const next=compareWorkspace({assets:altered,workspace:create(),query:query(),now});
  assert.notEqual(before.assetFingerprint,next.assetFingerprint);
  assert.equal(diffSnapshots(before,next).dataChanged,true);
});

test('space twin: snapshots retain original calculation and reject stale workspace revisions', () => {
  const w=create(), c=calculate(w);
  const stored=saveSnapshot(w,c,{now});
  assert.equal(stored.snapshots.length,1);
  assert.equal(w.snapshots.length,0);
  assert.throws(()=>saveSnapshot(stored,c,{now}),/다시 계산/);
  const different=calculate(w,query({dayOfWeek:2}));
  assert.equal(diffSnapshots(c,different).comparable,false);
});

test('space twin: serialized backup roundtrips all evidence and requires the current region', () => {
  let w=recordObservation(create(),assets[0].id,record(),{now});
  w=upsertScenario(w,scenario(),{now});
  w=saveSnapshot(w,calculate(w),{now});
  const encoded=serializeWorkspace(w,{now});
  assert.deepEqual(parseWorkspace(encoded,{regionId:'seogu',now}),w);
  assert.throws(()=>parseWorkspace(encoded,{regionId:'other',now}),/다른 지역/);
  assert.throws(()=>parseWorkspace('{',{regionId:'seogu',now}),/읽을 수/);
});

test('space twin: hostile scalar types, poison keys, cycles, accessors and sparse arrays are rejected', () => {
  const w=create();
  assert.throws(()=>parseWorkspace(JSON.stringify({...w,observations:JSON.parse('{"__proto__":{"x":1}}')}),{now}),/허용하지/);
  const poison=JSON.parse(JSON.stringify(w));poison.observations=JSON.parse('{"constructor":{}}');
  assert.throws(()=>validateWorkspace(poison,{now}),/허용하지/);
  assert.throws(()=>normalizeObservation(record({evidence:{html:'bad'}}),{now}),/문자열/);
  const getter={};Object.defineProperty(getter,'operatingStatus',{get(){throw Error('must not run');},enumerable:true});
  assert.throws(()=>normalizeObservation(getter,{now}),/접근자/);
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>validateWorkspace(cyclic,{now}),/순환/);
  assert.throws(()=>normalizeObservation(record({daysOfWeek:[,1]}),{now}),/빈 배열/);
  assert.throws(()=>upsertScenario(w,scenario({changes:[change({additionalAnnualCost:NaN})]}),{now}),/숫자/);
});

test('space twin: imported snapshot counters cannot contradict its rows', () => {
  let w=saveSnapshot(create(),calculate(create()),{now});
  w.snapshots[0].comparison.baseline.eligibleCount=1;
  assert.throws(()=>parseWorkspace(JSON.stringify(w),{now}),/개수와 공간/);
});

test('space twin: imported snapshots reject inconsistent schedules, scope, provenance and unknown deltas', () => {
  const w=saveSnapshot(upsertScenario(create(),scenario(),{now}),calculate(upsertScenario(create(),scenario(),{now})),{now});
  const modify=fn=>{const copy=structuredClone(w);fn(copy.snapshots[0].comparison);return ()=>parseWorkspace(JSON.stringify(copy),{now});};
  assert.throws(modify(c=>{c.alternatives[0].rows[0].closes='19:00';}),/개방 조건/);
  assert.throws(modify(c=>{c.sources[0].assetId='different-space';}),/출처 목록/);
  assert.throws(modify(c=>{c.baseline.rows[0].provenance='field-record';}),/확인 근거/);
  assert.throws(modify(c=>{c.alternatives[0].comparable=true;c.alternatives[0].delta={eligibleCount:1,overlapHours:3};}),/미확인/);
});

test('space twin: near-limit UTF-8 exports remain importable without whitespace exceeding the backup limit', () => {
  const w=create();w.revision=1;
  const observation=normalizeObservation(record({evidence:'가'.repeat(1000),recordedAt:now,revision:1}),{now});
  for(let i=0;i<640;i++) w.observations[`space-${i}`]={...observation};
  assert.ok(Buffer.byteLength(JSON.stringify(w,null,2),'utf8')>2*1024*1024);
  const text=serializeWorkspace(w,{now});
  assert.ok(Buffer.byteLength(text,'utf8')<=2*1024*1024);
  assert.equal(Object.keys(parseWorkspace(text,{now}).observations).length,640);
});

test('space twin: source links cannot smuggle executable schemes or credentials', () => {
  assert.throws(()=>seedAssets([feature(1,{sourceUrl:'javascript:alert(1)'})],{regionId:'seogu'}),/HTTP/);
  assert.throws(()=>seedAssets([feature(1,{sourceUrl:'https://user:pass@example.com/'})],{regionId:'seogu'}),/HTTP/);
});

test('space twin: three alternatives maximum and duplicate changed assets are rejected atomically', () => {
  let w=create();for(let i=0;i<3;i++) w=upsertScenario(w,scenario({name:`대안 ${i}`}),{now});
  assert.throws(()=>upsertScenario(w,scenario(),{now}),/최대 3/);
  assert.equal(w.scenarios.length,3);
  assert.throws(()=>upsertScenario(create(),scenario({changes:[change(),change()]}),{now}),/중복/);
});

test('space twin: creating an unnamed-ID alternative never replaces an existing explicit ID', () => {
  const first=upsertScenario(create(),scenario({id:'scenario-2',name:'기존 검토안'}),{now});
  const next=upsertScenario(first,scenario({name:'새 검토안'}),{now});
  assert.equal(next.scenarios.length,2);
  assert.equal(next.scenarios[0].name,'기존 검토안');
  assert.notEqual(next.scenarios[1].id,'scenario-2');
});

test('space twin: merge is additive, deduplicates identical records and retains both field-history entries', () => {
  const a=recordObservation(create(),assets[0].id,record(),{now});
  const b=recordObservation(create(),assets[1].id,record(),{now});
  const merged=mergeWorkspaces(a,b,{now});
  assert.equal(Object.keys(merged.observations).length,2);assert.equal(merged.history.length,2);
  const again=mergeWorkspaces(merged,b,{now});assert.equal(again.history.length,2);
  const newer=recordObservation(create(),assets[0].id,record({observedOn:'2026-10-23',closes:'21:00'}),{now:later});
  const updated=mergeWorkspaces(a,newer,{now:later});
  assert.equal(updated.observations[assets[0].id].closes,'21:00');assert.equal(updated.history.length,2);
  assert.equal(a.observations[assets[0].id].closes,'18:00');
});

test('space twin: contradictory imports never erase existing observations or scenario definitions', () => {
  const a=recordObservation(create(),assets[0].id,record(),{now});
  const b=recordObservation(create(),assets[0].id,record({closes:'21:00'}),{now});
  assert.throws(()=>mergeWorkspaces(a,b,{now}),/互|서로 다른/);
  const c=upsertScenario(create(),scenario({id:'same'}),{now});
  const d=upsertScenario(create(),scenario({id:'same',name:'다른 안'}),{now});
  assert.throws(()=>mergeWorkspaces(c,d,{now}),/대안 내용이/);
  assert.equal(c.scenarios[0].name,'저녁 개방 가정');
});
