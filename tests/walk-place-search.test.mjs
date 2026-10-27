import test from 'node:test';
import assert from 'node:assert/strict';
import {searchWalkPlaces} from '../server/walk-place-search.js';

const pack={profile:{id:'seogu',bounds:[126,34,128,37]},boundaries:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[126,34],[128,34],[128,37],[126,37],[126,34]]]},properties:{}}]},candidates:[{id:'facility',name:'서구 장난감도서관',address:'광주 서구 경열로 33',coordinate:[126.85,35.15],routeEligible:true},{id:'private-bell',name:'비상벨',address:'광주 서구 경열로 33',coordinate:[126.85,35.15],routeEligible:false}]};
test('without a search key, searches name and address across public endpoint candidates',async()=>{
  const result=await searchWalkPlaces('경열로 33',pack,{env:{}});
  assert.equal(result.providerAvailable,false);assert.deepEqual(result.items.map(item=>item.id),['facility']);
  await assert.rejects(()=>searchWalkPlaces('a',pack,{env:{}}),{code:'WALK_SEARCH_QUERY'});
});
test('upstream search uses fixed regional URLs, rejects out-of-region points and deduplicates provider results',async()=>{
  const calls=[],fetcher=async url=>{calls.push(new URL(url));return new Response(JSON.stringify({response:{status:'OK',result:{items:[{title:'검색 시설',address:{road:'서구 경열로 33'},point:{x:'126.86',y:'35.16'}},{title:'구 밖',point:{x:'129',y:'35'}},{title:'잘못된 좌표',point:{x:'oops',y:'35'}}]}}}));};
  const result=await searchWalkPlaces('검색',pack,{env:{VWORLD_API_KEY:'test-server-key',VWORLD_DOMAIN:'https://example.org'},fetcher});
  assert.equal(calls.length,3);assert.ok(calls.every(url=>url.origin==='https://api.vworld.kr'&&url.searchParams.get('bbox')==='126,34,128,37'));
  assert.deepEqual(calls.map(url=>url.searchParams.get('category')),[null,'road','parcel']);assert.equal(result.items.length,1);assert.deepEqual(result.items[0].coordinate,[126.86,35.16]);assert.equal(result.providerAvailable,true);assert.doesNotMatch(JSON.stringify(result),/test-server-key/);
});
test('provider failure preserves matching local results and never exposes upstream error details',async()=>{
  const result=await searchWalkPlaces('장난감',pack,{env:{VWORLD_API_KEY:'test-server-key',VWORLD_DOMAIN:'https://example.org'},fetcher:async()=>{throw Error('secret provider failure')}});
  assert.equal(result.providerAvailable,false);assert.equal(result.items[0].id,'facility');assert.doesNotMatch(JSON.stringify(result),/secret provider/);
});
