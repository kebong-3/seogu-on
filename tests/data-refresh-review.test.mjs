import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compareSnapshots,prepareRefresh} from '../scripts/data/prepare-refresh.mjs';
const point=(id,x=126.8,name=id)=>({type:'Feature',geometry:{type:'Point',coordinates:[x,35.15]},properties:{id,name}}),fc=features=>({type:'FeatureCollection',features});
test('review distinguishes additions/removals/moves without interpreting them as closures or verification',()=>{
 const before=fc([point('keep'),point('move'),point('remove')]),after=fc([point('keep'),point('move',126.9),point('add')]),saved=JSON.stringify([before,after]),result=compareSnapshots(before,after);
 assert.deepEqual(result.added,['add']);assert.deepEqual(result.removed,['remove']);assert.equal(result.changed[0].coordinateChanged,true);assert.equal(result.changed[0].requiresReview,true);assert.equal(result.requiresReview,true);assert.equal(JSON.stringify([before,after]),saved);assert.match(result.meaning,/폐업/);
});
test('ambiguous source identities are rejected before a diff can be accepted',()=>{
 assert.throws(()=>compareSnapshots(fc([]),fc([point('a'),point('a',126.9)])),/중복/);assert.throws(()=>compareSnapshots({},fc([])),/GeoJSON/);
});
test('refresh cannot write to live public data and cannot invent a collection time for a reused raw file',async()=>{
 await assert.rejects(prepareRefresh({sourceHtml:'unused',collectedAt:'2026-10-28T00:00:00Z',outputDirectory:'public/data/decision'}),/data-staging/);await assert.rejects(prepareRefresh({sourceHtml:'unused'}),/실제/);
});

test('a new collection timestamp is kept in the audit but does not make identical facility content changed',()=>{
 const before=fc([{...point('same'),properties:{...point('same').properties,collectedAt:'2026-10-23T17:32:48.964Z',enrolled:35,capacity:36}}]);
 const after=structuredClone(before);after.metadata={collectedAt:'2026-10-27T17:39:57.031Z'};after.features[0].properties.collectedAt=after.metadata.collectedAt;
 const raw=JSON.stringify([before,after]),result=compareSnapshots(before,after);
 assert.deepEqual(result.changed,[]);assert.deepEqual(result.collectionTimeOnly,['same']);assert.deepEqual(result.added,[]);assert.deepEqual(result.removed,[]);assert.equal(result.requiresReview,true);assert.equal(JSON.stringify([before,after]),raw);
});

test('actual operating conditions, addresses, capacity and enrolment still change even when collection time changes too',()=>{
 const original={...point('same'),properties:{...point('same').properties,collectedAt:'2026-10-23T00:00:00Z',address:'공개로 1',registeredStatus:'정상',capacity:30,enrolled:20,shuttle:'운영',hours:'09:00~18:00',reservation:'사전 문의',eligibility:'초등학생',suspendedFrom:null,suspendedUntil:null}};
 for(const [key,value]of Object.entries({name:'공식 명칭 변경',address:'공개로 2',registeredStatus:'휴지',capacity:31,enrolled:21,shuttle:'미운영',hours:'10:00~17:00',reservation:'예약필수',eligibility:'미취학아동',suspendedFrom:'2026-10-28',suspendedUntil:'2026-11-01'})){
  const after=structuredClone(original);after.properties[key]=value;after.properties.collectedAt='2026-10-28T00:00:00Z';
  const result=compareSnapshots(fc([original]),fc([after]));assert.equal(result.changed.length,1,key);assert.deepEqual(result.changed[0].changedProperties,[key]);assert.equal(result.changed[0].coordinateChanged,false);assert.equal(result.changed[0].nameChanged,key==='name');assert.deepEqual(result.collectionTimeOnly,[]);
 }
});

test('source and verification dates are substantive, and missing values never compare equal to zero',()=>{
 for(const key of ['sourceDate','sourceModifiedAt','verifiedAt','updatedAt']){
  const old=point('same'),next=point('same');old.properties[key]='2026-10-01';next.properties[key]='2026-10-28';assert.deepEqual(compareSnapshots(fc([old]),fc([next])).changed[0].changedProperties,[key]);
 }
 const old=point('same'),next=point('same');old.properties.enrolled=null;next.properties.enrolled=0;assert.deepEqual(compareSnapshots(fc([old]),fc([next])).changed[0].changedProperties,['enrolled']);
 delete old.properties.enrolled;assert.equal(compareSnapshots(fc([old]),fc([next])).changed.length,1);
 old.properties.operatingHours={collectedAt:'source-field-before'};next.properties.operatingHours={collectedAt:'source-field-after'};delete next.properties.enrolled;
 assert.deepEqual(compareSnapshots(fc([old]),fc([next])).changed[0].changedProperties,['operatingHours'],'only the known direct collector timestamp is ignored');
});

test('serialization order is ignored but coordinate and ordered operating-value changes remain meaningful',()=>{
 const before=fc([point('same')]),after=fc([{properties:{name:'same',id:'same'},geometry:{coordinates:[126.8,35.15],type:'Point'},type:'Feature'}]);
 assert.deepEqual(compareSnapshots(before,after).changed,[]);
 after.features[0].geometry.coordinates=[126.9,35.15];assert.equal(compareSnapshots(before,after).changed[0].coordinateChanged,true);
 before.features[0].properties.operatingTimes=['09:00','18:00'];after.features[0].properties.operatingTimes=['18:00','09:00'];assert.deepEqual(compareSnapshots(before,after).changed[0].changedProperties,['operatingTimes']);
});

test('checked-in Seo-gu and Suncheon snapshots can be recollected without flagging every facility',async()=>{
 for(const region of ['seogu','suncheon']){
  const before=JSON.parse(await readFile(new URL(`../public/data/decision/${region}/childcare.geojson`,import.meta.url),'utf8')),after=structuredClone(before);
  for(const f of after.features)f.properties.collectedAt='2026-10-28T00:00:00Z';after.metadata.collectedAt='2026-10-28T00:00:00Z';
  const unchanged=compareSnapshots(before,after);assert.equal(unchanged.changed.length,0);assert.equal(unchanged.collectionTimeOnly.length,before.features.length);
  after.features[0].properties.enrolled=after.features[0].properties.enrolled===0?1:0;
  const updated=compareSnapshots(before,after);assert.equal(updated.changed.length,1);assert.deepEqual(updated.changed[0].changedProperties,['enrolled']);assert.equal(updated.collectionTimeOnly.length,before.features.length-1);
 }
});
