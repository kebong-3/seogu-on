import test from 'node:test';
import assert from 'node:assert/strict';
import {searchWalkPlaces} from '../server/walk-place-search.js';
import {handleWalkRoutes} from '../server/walk-routes.js';
import {loadWalkCandidates} from '../server/walk-candidates.js';

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

const response=()=>({statusCode:200,setHeader(){},end(text){this.body=JSON.parse(text);}});
test('actual GET search preserves the exact original links and unknown dates for the three deployed evaluation failures',async()=>{
  const original=await loadWalkCandidates({regionId:'seogu',env:{}});
  for(const [query,name]of [['광주시청 장난감도서관','광주시청 장난감도서관'],['소꿉놀이','소꿉놀이 장난감도서관'],['운천역','광주광역시도시철도공사 운천역 수유실']]){
    const res=response();
    await handleWalkRoutes({method:'GET',url:'/api/walk-routes?region=seogu&q='+encodeURIComponent(query),headers:{host:'test.local'}},res,
      {env:{},loadCandidates:async()=>original,fetcher:async()=>{throw Error('No external request is required');}});
    assert.equal(res.statusCode,200);assert.equal(res.body.providerAvailable,false);
    const expected=original.candidates.find(candidate=>candidate.name===name),item=res.body.items.find(candidate=>candidate.id===expected.id);
    assert.ok(item,name);assert.ok(expected.sourceUrl);
    assert.equal(item.sourceUrl,expected.sourceUrl);assert.equal(item.sourceDate,null);
    assert.equal(item.datasetId,expected.datasetId);assert.equal(item.sourceId,expected.sourceId);
  }
});

test('catalogue and search API projections retain long existing URLs, and missing links stay null',async()=>{
  const originalUrl='https://example.org/public-record?record='+('a'.repeat(300));
  const withSource={...pack.candidates[0],sourceName:'공식 공개시설 시험자료',sourceDate:null,sourceUrl:originalUrl,datasetId:'care-toys',sourceId:'source-facility'};
  const noSource={...withSource,id:'missing-url',name:'다른 장난감도서관',sourceUrl:undefined};
  const sourcePack={...pack,candidates:[withSource,noSource]};
  for(const url of ['/api/walk-routes?region=seogu','/api/walk-routes?region=seogu&q='+encodeURIComponent('장난감대여소')]){
    const res=response();await handleWalkRoutes({method:'GET',url,headers:{host:'test.local'}},res,
      {env:{},loadCandidates:async()=>sourcePack,loadSafetyReferences:async()=>null});
    assert.equal(res.statusCode,200);
    const items=res.body.items||res.body.candidates,first=items.find(item=>item.id===withSource.id),missing=items.find(item=>item.id===noSource.id);
    assert.equal(first.sourceUrl,originalUrl);assert.equal(first.sourceDate,null);
    assert.equal(missing.sourceUrl,null);assert.equal(missing.sourceDate,null);
  }
});

test('actual GET retains reviewed category metadata needed for child-library alias matching',async()=>{
  const ecology={...namedPack.candidates[1],id:'ecology',name:'어린이생태학습도서관',datasetId:'care-libraries',sourceId:'library-source',sourceName:'공식 도서관 자료',sourceDate:null,sourceUrl:'https://example.org/library'};
  const res=response();await handleWalkRoutes({method:'GET',url:'/api/walk-routes?region=seogu&q='+encodeURIComponent('유아도서관'),headers:{host:'test.local'}},res,
    {env:{},loadCandidates:async()=>({...pack,candidates:[ecology]})});
  assert.equal(res.statusCode,200);assert.equal(res.body.items.length,1);
  assert.equal(res.body.items[0].id,'ecology');assert.equal(res.body.items[0].aliasMatch,true);assert.equal(res.body.items[0].sourceUrl,ecology.sourceUrl);
});

test('catalogue and search preserve only validated source identity pairs for facility-to-walk handoff',async()=>{
 const selected={...pack.candidates[0],sourceDate:null,sourceUrl:'https://example.org/source',sourceRefs:[
  {datasetId:'care-toys',sourceId:'original-toy',sourceName:'Should not be copied',sourceUrl:'https://example.org/private-extra',coordinate:[126.85,35.15]},
  {datasetId:'care-parenting',sourceId:'original-parenting'},
  {datasetId:'care-toys',sourceId:'original-toy'},
  {datasetId:'../bad',sourceId:'not-an-id'},
  {datasetId:'care-toys',sourceId:'x\u0000secret'},
  {datasetId:'care-toys',sourceId:' '},
  {datasetId:'care-toys',sourceId:'x'.repeat(241)},
  {datasetId:42,sourceId:'number-dataset'},null,
 ]};
 for(const url of ['/api/walk-routes?region=seogu','/api/walk-routes?region=seogu&q='+encodeURIComponent('장난감')]){
  const res=response();await handleWalkRoutes({method:'GET',url,headers:{host:'test.local'}},res,
   {env:{},loadCandidates:async()=>({...pack,candidates:[selected]}),loadSafetyReferences:async()=>null});
  assert.equal(res.statusCode,200);const item=(res.body.items||res.body.candidates)[0];
  assert.deepEqual(item.sourceRefs,[{datasetId:'care-toys',sourceId:'original-toy'},{datasetId:'care-parenting',sourceId:'original-parenting'}]);
  assert.equal(item.sourceUrl,selected.sourceUrl);assert.equal(item.sourceDate,null);
  assert.doesNotMatch(JSON.stringify(item.sourceRefs),/private-extra|coordinate|sourceName|secret/);
 }
});
