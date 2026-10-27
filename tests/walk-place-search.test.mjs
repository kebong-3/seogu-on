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

// These named records are isolated unit fixtures; production output always uses stored records.
const namedPack={...pack,candidates:[
  {id:'toy',name:'광주시청 장난감도서관',address:'전남광주통합특별시 서구 내방로 111',coordinate:[126.85,35.15],routeEligible:true},
  {id:'library',name:'상록 어린이도서관',address:'광주광역시 서구 상무대로 1',coordinate:[126.86,35.16],routeEligible:true},
  {id:'nursing',name:'운천역 수유실',address:'광주광역시 서구 상무대로 883',coordinate:[126.87,35.17],routeEligible:true},
  {id:'latin',name:'ABC 돌봄센터',address:'광주광역시 서구 경열로 33',coordinate:[126.88,35.18],routeEligible:true},
]};

test('explicit place-name spelling equivalences match both address forms without rewriting the original result',async()=>{
  for(const query of ['광주광역시 서구 장난감도서관','광주광역시서구장난감대여소','전남광주통합특별시 서구 어린이도서관']){
    const result=await searchWalkPlaces(query,namedPack,{env:{}});
    assert.equal(result.items.length,1);
    const item=result.items[0],original=namedPack.candidates.find(c=>c.id===item.id);
    assert.equal(item.name,original.name);assert.equal(item.address,original.address);
    assert.equal(item.matchType,'alias');assert.equal(item.aliasMatch,true);assert.equal(item.approximate,false);
    assert.match(result.notice,/별칭·지역명/);assert.match(result.notice,/직접 선택/);
  }
});

test('NFKC, decomposed Hangul and missing or excess spaces normalize without fuzzy matching',async()=>{
  for(const query of ['ＡＢＣ　돌봄센터','ABC돌봄센터','ＡＢＣ 돌 봄 센 터']){
    const result=await searchWalkPlaces(query,namedPack,{env:{}});
    assert.deepEqual(result.items.map(i=>i.id),['latin']);
    assert.equal(result.items[0].matchType,'normalized');
    assert.equal(result.items[0].approximate,false);
  }
  const hangul=await searchWalkPlaces('운천역 수유실'.normalize('NFD'),namedPack,{env:{}});
  assert.deepEqual(hangul.items.map(i=>i.id),['nursing']);assert.equal(hangul.items[0].matchType,'normalized');
  const street=await searchWalkPlaces('경열로３３',namedPack,{env:{}});
  assert.deepEqual(street.items.map(i=>i.id),['latin']);
});

test('facility aliases work with spacing and word order, while retaining actual names and distinct facility types',async()=>{
  for(const [query,id]of [['장난감대여소','toy'],['서구 장난감 대여소','toy'],['유아 도서관 상록','library'],['어 린 이 도 서 관','library'],['수유방 운천역','nursing'],['수 유 방','nursing']]){
    const result=await searchWalkPlaces(query,namedPack,{env:{}});
    assert.deepEqual(result.items.map(i=>i.id),[id],query);
    assert.equal(result.items[0].name,namedPack.candidates.find(c=>c.id===id).name);
    assert.equal(result.items[0].approximate,false);
    if(!query.includes('어 린 이'))assert.equal(result.items[0].aliasMatch,true);
  }
  const reverse={...namedPack,candidates:[
    {...namedPack.candidates[0],name:'시청 장난감대여소'},
    {...namedPack.candidates[1],name:'상록 유아도서관'},
    {...namedPack.candidates[2],name:'운천역 수유방'},
  ]};
  for(const [query,id]of [['장난감도서관','toy'],['어린이도서관','library'],['수유실','nursing']]){
    const result=await searchWalkPlaces(query,reverse,{env:{}});
    assert.deepEqual(result.items.map(i=>i.id),[id]);assert.equal(result.items[0].aliasMatch,true);
  }
  for(const query of ['장난감도서간','유어도서관','수유빵'])assert.equal((await searchWalkPlaces(query,namedPack,{env:{}})).items.length,0);
});

test('no coordinates, invalid positions, out-of-region and non-public candidates never become route endpoints',async()=>{
  const originals=[
    {...namedPack.candidates[0],id:'unlocated',coordinate:null},
    {...namedPack.candidates[0],id:'bad',coordinate:['126.85','35.15']},
    {...namedPack.candidates[0],id:'outside',coordinate:[129,35]},
    {...namedPack.candidates[0],id:'private',routeEligible:false},
    {...namedPack.candidates[0],id:'unconfirmed',routeEligible:undefined},
  ];
  const before=structuredClone(originals);
  const result=await searchWalkPlaces('장난감대여소',{...namedPack,candidates:originals},{env:{}});
  assert.deepEqual(result.items,[]);assert.deepEqual(originals,before);
  assert.match(result.notice,/미수록 시설/);assert.match(result.notice,/직접 선택/);
});

test('reviewed facility types support child-library aliases without renaming a longer official facility name',async()=>{
  const source={...namedPack.candidates[1],id:'ecology',name:'어린이생태학습도서관',datasetId:'care-libraries'};
  const unrelated={...namedPack.candidates[1],id:'unknown-type',name:'생태자료실',datasetId:'unknown'};
  const result=await searchWalkPlaces('유아 도서관',{...namedPack,candidates:[source,unrelated]},{env:{}});
  assert.deepEqual(result.items.map(i=>i.id),['ecology']);
  assert.equal(result.items[0].name,'어린이생태학습도서관');assert.equal(result.items[0].matchType,'alias');
  assert.match(result.items[0].matchNote,/시설 분류/);
});

test('direct matches rank ahead of explicit alias matches without selecting a destination automatically',async()=>{
  const exact={...namedPack.candidates[0],id:'explicit-alias-name',name:'서구 장난감대여소'};
  const result=await searchWalkPlaces('장난감대여소',{...namedPack,candidates:[...namedPack.candidates,exact]},{env:{}});
  assert.deepEqual(result.items.map(i=>i.id),['explicit-alias-name','toy']);
  assert.equal(result.items[0].matchType,'direct');assert.equal(result.items[1].matchType,'alias');
  assert.equal(result.selected,undefined);assert.equal(result.destination,undefined);
});

test('provider-only suggestions are labeled approximate, bounded to the region and keep the fixed endpoint and server key private',async()=>{
  const calls=[],fetcher=async url=>{calls.push(new URL(url));return new Response(JSON.stringify({response:{status:'OK',result:{items:[
    {title:'실제 제공기관 명칭',address:{road:'광주광역시 서구 경열로 33'},point:{x:'126.86',y:'35.16'}},
    {title:'지역 밖 후보',address:{road:'다른 지역'},point:{x:'129',y:'35.16'}},
    {title:'좌표 없음',address:{road:'서구 경열로 33'}},
  ]}}}));};
  const result=await searchWalkPlaces('ＡＢＣ',pack,{env:{VWORLD_API_KEY:'test-server-key',VWORLD_DOMAIN:'https://example.org'},fetcher});
  assert.equal(result.items.length,1);assert.equal(result.items[0].name,'실제 제공기관 명칭');
  assert.equal(result.items[0].matchType,'provider');assert.equal(result.items[0].approximate,true);assert.equal(result.items[0].aliasMatch,false);
  assert.match(result.notice,/비슷한 후보/);assert.match(result.notice,/직접 선택/);
  assert.equal(calls.length,3);assert.ok(calls.every(url=>url.origin==='https://api.vworld.kr'&&url.pathname==='/req/search'&&url.searchParams.get('query')==='ABC'));
  assert.doesNotMatch(JSON.stringify(result),/test-server-key/);
});

test('normalization does not bypass length or control-character validation',async()=>{
  for(const query of ['  ','가'.repeat(101),'수유\n방','수유\u0000방','\u007f수유실',null,{}])await assert.rejects(searchWalkPlaces(query,namedPack,{env:{}}),{code:'WALK_SEARCH_QUERY'});
});
