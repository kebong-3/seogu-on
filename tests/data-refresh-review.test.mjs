import test from 'node:test';
import assert from 'node:assert/strict';
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
