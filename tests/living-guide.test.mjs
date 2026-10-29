import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {careDirectoryHtml,careDirectoryRows,safeReturnGuide,safeReturnSources,livingFacilityRows,livingFacilityCard,livingRouteDestination,livingGuideHtml,LIVING_CARE_GROUPS} from '../src/city/living-guide.js';
import {installDecisionTwin} from '../src/city/decision-twin.js';
import {runRegisteredAction} from '../src/city/actions.js';
import {loadWalkCandidates} from '../server/walk-candidates.js';
const read=async path=>JSON.parse(await readFile(new URL('../public'+path,import.meta.url),'utf8'));
test('care directory keeps every verified address and separates unlocated records from mapped points',async()=>{
 const data=await read('/data/decision/seogu/care-directory.json'),manifest=await read('/data/decision/seogu/manifest.json');
 assert.equal(data.entries.length,78);assert.equal(new Set(data.entries.map(r=>r.id)).size,78);
 assert.equal(careDirectoryRows(data).length,47);
 const points=[];for(const d of manifest.datasets.filter(d=>d.id.startsWith('care-'))){const bytes=await readFile(new URL('../public'+d.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),d.sha256);points.push(...JSON.parse(bytes).features);}
 assert.equal(points.length,31);assert.ok(points.every(f=>f.properties.geometryMeaning&&f.properties.sourceUrl));
 assert.deepEqual(new Set(points.map(f=>f.properties.id)),new Set(data.entries.filter(r=>r.coordinates).map(r=>r.id)));
 assert.ok(data.entries.every(r=>r.address&&r.sourceName&&/^https:\/\//.test(r.sourceUrl)));
});
test('unlocated directory follows name/address and dataset filters without assigning a district or navigation point',()=>{
 const data={entries:[{id:'a',name:'센터A',address:'서구 길 1',category:'육아지원',datasetId:'parenting',coordinates:null},{id:'b',name:'센터B',address:'서구 길 2',category:'공동육아',datasetId:'parenting',coordinates:null},{id:'c',name:'지도시설',coordinates:[126.8,35.1]}]};
 assert.equal(careDirectoryRows(data,{datasetId:'parenting'}).length,2);
 const html=careDirectoryHtml(data,{query:'길 2',datasetId:'parenting',scopeIsAll:false});assert.match(html,/센터B/);assert.doesNotMatch(html,/센터A|지도에서 보기/);assert.match(html,/서구 전체/);
 assert.equal(careDirectoryRows(data,{datasetId:'childcare'}).length,0);
});
test('return-home guide prioritizes route actions and keeps official source and image-interpretation scope at the bottom',async()=>{
 const ref=await read('/data/walk/seogu/safe-return-reference.json'),html=safeReturnGuide(ref),sources=safeReturnSources(ref);
 assert.equal(ref.routes.length,6);assert.equal(ref.geometryAvailable,false);
 assert.match(html,/안심귀가 길찾기/);assert.match(html,/공식지도 판독 · 위치오차 가능/);
 assert.doesNotMatch(html,/href=|GeoJSON|좌표를 확보하지 못해/);
 assert.match(sources,/\.show/);assert.match(sources,/측량좌표가 아닙니다/);assert.match(sources,/광주서부경찰서/);
 assert.match(sources,new RegExp(ref.sourceUrl.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('&','&amp;')));
 for(const route of ref.routes)assert.match(html,new RegExp(`data-action="decision-safe-return-map" data-id="${route.id}"[^>]* disabled`));
 assert.doesNotMatch(safeReturnGuide({routes:[{name:'<script>alert(1)</script>'}]}),/<script>/);
});

test('only a matched finite nondegenerate line enables a return-home map and route action',()=>{
 const ref={routes:[{id:'route-a',name:'구간 A'},{id:'route-b',name:'구간 B'}]},feature=(routeId,geometry)=>({type:'Feature',properties:{routeId},geometry});
 const geo={type:'FeatureCollection',features:[feature('route-a',{type:'LineString',coordinates:[[126.85,35.15],[126.851,35.151]]}),feature('different-id',{type:'LineString',coordinates:[[126.85,35.15],[126.86,35.16]]})]};
 const html=safeReturnGuide(ref,geo,{selectedId:'route-a'});
 assert.match(html,/class="living-safe-return-card is-selected"/);
 assert.match(html,/data-action="decision-safe-return-map" data-id="route-a" aria-label="구간 A 판독 구간 지도 보기">/);
 assert.match(html,/data-safe-return-id="route-a" aria-label="구간 A 주변 안심귀가 길찾기">/);
 assert.match(html,/data-safe-return-id="route-b"[^>]* disabled/);
 for(const geometry of [null,{type:'Point',coordinates:[126.85,35.15]},{type:'LineString',coordinates:[[126.85,35.15]]},{type:'LineString',coordinates:[[126.85,35.15],[126.85,35.15]]},{type:'LineString',coordinates:[[126.85,35.15],[NaN,35.16]]},{type:'MultiLineString',coordinates:[]}]){
  const invalid=safeReturnGuide(ref,{type:'FeatureCollection',features:[feature('route-a',geometry)]});
  assert.match(invalid,/data-safe-return-id="route-a"[^>]* disabled/);
 }
});

test('safety content begins with return-home planning while detailed sources follow all other tools',()=>{
 const reference={sourceUrl:'https://example.gov/source',routes:[{id:'route-a',name:'구간 A',area:'공공도로 주변'}]};
 const html=livingGuideHtml({topic:'safety',topics:{care:{label:'돌봄·육아'},safety:{label:'여성안심·생활안전'}},reference});
 assert.ok(html.indexOf('data-topic="safety"')<html.indexOf('data-topic="care"'));
 assert.ok(html.indexOf('living-safe-return"')<html.indexOf('id="living-search"'));
 assert.ok(html.indexOf('living-safe-return"')<html.indexOf('living-map-results'));
 assert.ok(html.indexOf('living-safe-return-sources')>html.indexOf('담당자용 · 점검·보완안 검토'));
 assert.match(html,/CCTV 위치/);assert.match(html,/보안등 위치/);assert.match(html,/도움 요청 지점/);assert.match(html,/안전등급을 매기거나 현재 안전을 보장하지 않아요/);
 const care=livingGuideHtml({topic:'care',regionId:'seogu',topics:{care:{label:'돌봄·육아'},safety:{label:'여성안심·생활안전'}},reference});
 assert.match(care,/living-safe-return-shortcut/);assert.match(care,/어떤 시설을 찾으세요/);
 assert.doesNotMatch(care,/living-safe-return-grid/);
 assert.doesNotMatch(livingGuideHtml({topic:'care',regionId:'suncheon'}),/living-safe-return-shortcut/);
});

const rectangle=(west,east)=>({type:'Polygon',coordinates:[[[west,35],[east,35],[east,36],[west,36],[west,35]]]});
const facility=(id,name,coordinate=[126.85,35.15],extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:coordinate},properties:{id,name,address:'서구 공공로 1',sourceName:'공식 자료',sourceUrl:'https://example.org/facility',sourceDate:null,livingSourceId:id,...extra}});

test('resident categories cover every added care dataset and keep name, alias, and verified dong searches usable',()=>{
 const datasets=LIVING_CARE_GROUPS.flatMap(group=>group.datasets);
 for(const id of ['care-child-centers','care-alltogether','care-parenting','care-village','care-libraries','care-toys','care-nursing','care-play','childcare'])assert.ok(datasets.includes(id),id);
 const data=[{id:'care-toys',features:[facility('toy','광주시청 장난감도서관',[126.85,35.15],{livingDongName:'치평동'})]},
  {id:'care-libraries',features:[facility('library','상록도서관 유아도서관',[126.95,35.15],{livingDongName:'농성1동'})]}];
 assert.equal(livingFacilityRows(data,{query:'치평동 장난감 대여소'}).length,1);
 assert.equal(livingFacilityRows(data,{query:'광 주 시 청'}).length,1);
 assert.equal(livingFacilityRows(data,{query:'유아 도서관'}).length,1);
 assert.equal(livingFacilityRows(data,{datasetId:'group:libraries',scope:rectangle(126.8,126.9)}).length,0);
 assert.equal(livingFacilityRows(data,{datasetId:'group:libraries',scope:rectangle(126.8,127)}).length,1);
 assert.equal(livingFacilityRows([{id:'care-toys',features:[facility('bad-dong','센터',[126.85,35.15],{dongName:'임의동'})]}],{query:'임의동'}).length,0);
});

test('address-only results remain separate, show ten at first, and never fabricate navigation',async()=>{
 const directory=await read('/data/decision/seogu/care-directory.json'),html=careDirectoryHtml(directory,{scopeIsAll:false});
 assert.equal((html.match(/class="dt-row living-card living-address-card"/g)||[]).length,10);
 assert.match(html,/47곳/);assert.match(html,/10곳 더 보기/);assert.match(html,/서구 전체/);
 assert.doesNotMatch(html,/data-action="(?:walk-routes|decision-living-focus)"/);
 const centres=careDirectoryRows(directory,{datasetId:'group:centres'});assert.ok(centres.length>0);
 assert.ok(centres.every(r=>LIVING_CARE_GROUPS.find(g=>g.id==='centres').datasets.includes(r.datasetId)));
 const malformed={entries:[{id:'bad',name:'잘못된 좌표 시설',coordinates:['126.85','35.15'],address:'서구 공공로 1'}]};
 assert.equal(careDirectoryRows(malformed).length,1);assert.doesNotMatch(careDirectoryHtml(malformed),/data-destination/);
});

test('facility cards offer explicit map and basic-route actions with an original source identity, not coordinates',()=>{
 const row={descriptor:{id:'care-toys',title:'장난감도서관',sourceDate:'2020-01-01'},feature:facility('living:care-toys:actual','실제 장난감도서관',[126.85,35.15],{livingSourceId:'actual',capacity:20,enrolled:10,phone:'062-123-4567'})};
 const html=livingFacilityCard(row,{regionId:'seogu',hasPreset:true});
 assert.match(html,/aria-label="실제 장난감도서관 지도 보기"/);assert.match(html,/여기로 길찾기/);assert.match(html,/data-mode="basic"/);
 assert.match(html,/data-destination-region="seogu"/);assert.match(html,/data-destination-dataset="care-toys"/);assert.match(html,/data-destination-source-id="actual"/);
 assert.doesNotMatch(html,/data-(?:lng|lat|coordinate)|126\.85|35\.15/);
 assert.match(html,/<details class="living-card-details"><summary>이용 안내·출처/);assert.doesNotMatch(html,/living-card-details" open/);
 assert.match(html,/자료 기준 미제공/);assert.doesNotMatch(html,/자료 기준 2020-01-01/);assert.match(html,/입소 가능 인원이 아니에요/);
 assert.match(html,/href="tel:0621234567"/);assert.match(html,/decision-living-review/);
 for(const patch of [{livingSourceId:''},{routeEligible:false},{locationStatus:'unverified'}])assert.equal(livingRouteDestination({...row,feature:{...row.feature,properties:{...row.feature.properties,...patch}}},'seogu'),null);
 assert.equal(livingRouteDestination({...row,feature:{...row.feature,geometry:{type:'Point',coordinates:null}}},'seogu'),null);
 assert.equal(livingRouteDestination({...row,descriptor:{id:'invented-dataset'}},'seogu'),null);
});

test('actual mapped care handoff pairs resolve to a reviewed walking candidate without changing any source',async()=>{
 const manifest=await read('/data/decision/seogu/manifest.json'),pack=await loadWalkCandidates({regionId:'seogu',env:{}});
 let count=0;
 for(const descriptor of manifest.datasets.filter(d=>d.id.startsWith('care-'))){
  const data=await read(descriptor.path);
  for(const feature of data.features){
   const row={descriptor,feature:{...feature,properties:{...feature.properties,livingSourceId:feature.properties.id}}};
   const destination=livingRouteDestination(row,'seogu');assert.ok(destination);
   const matches=pack.candidates.filter(c=>c.datasetId===destination.datasetId&&c.sourceId===destination.sourceId||c.sourceRefs?.some(ref=>ref.datasetId===destination.datasetId&&ref.sourceId===destination.sourceId));
   assert.equal(matches.length,1,feature.properties.name);assert.equal(matches[0].routeEligible,true);count++;
  }
 }
 assert.equal(count,31);
});

test('empty and unconnected states distinguish missing records from absent facilities and offer a next action',async()=>{
 const html=livingGuideHtml({query:'없는 이름',scopeId:'seogu-01',scopeName:'양동',regionId:'seogu',data:[{id:'care-toys',title:'장난감',features:[],error:'자료 연결 필요'}]});
 assert.match(html,/시설이 없다는 뜻은 아니에요/);assert.match(html,/decision-living-reset/);assert.match(html,/decision-living-all/);
 assert.match(html,/연결되지 않은 자료는 시설 0곳을 뜻하지 않아요/);assert.match(html,/aria-live="polite"/);
 assert.match(html,/<details class="dt-sources living-source-details"><summary>/);
 const directory=await read('/data/decision/seogu/care-directory.json'),defaultHtml=livingGuideHtml({directory,regionId:'seogu'});
 assert.match(defaultHtml,/어린이집 외 추가시설은 지도 31곳·주소 47곳/);
 assert.ok(defaultHtml.indexOf('어떤 시설을 찾으세요')<defaultHtml.indexOf('자료 출처·수록 범위 확인'));
});

test('resident output escapes source material, refuses credential and script URLs, and keeps no fake verification date',()=>{
 const record={id:'unsafe',name:'<img src=x onerror=alert(1)>',address:'<script>bad</script>',category:'돌봄',sourceName:'공식',sourceUrl:'https://user:password@example.org',coordinates:null};
 const html=careDirectoryHtml({entries:[record]});assert.doesNotMatch(html,/<img|<script|href="https:\/\/user:password|2026-10-27/);assert.match(html,/자료 기준 미제공/);
 const guide=safeReturnGuide({routes:[{name:'길'}],sourceUrl:'javascript:alert(1)',attachmentUrl:'https://secret:password@example.org/map.show'})+safeReturnSources({routes:[{name:'길',sourceUrl:'javascript:bad'}],sourceUrl:'javascript:alert(1)',attachmentUrl:'https://secret:password@example.org/map.show'});
 assert.doesNotMatch(guide,/href="(?:javascript:|https:\/\/secret:password)/);
});

test('source date, public-source review, and collection dates stay separate without inventing a field inspection',()=>{
 const record={id:'dates',name:'공개시설',address:'서구 공공로 1',coordinates:null,sourceName:'공식 원문',sourceDate:null,verifiedAt:'2026-10-27',collectedAt:'2026-10-28T01:02:03Z'};
 const html=careDirectoryHtml({entries:[record]});
 assert.match(html,/자료 기준 미제공 · 공개원문 확인 2026-10-27 · 수집 2026-10-28/);
 assert.match(html,/공개원문 확인은 현장 운영 확인이 아닙니다/);
 assert.doesNotMatch(html,/확인·수집/);
 const unknown=careDirectoryHtml({entries:[{...record,verifiedAt:null,collectedAt:null}]});
 assert.match(unknown,/자료 기준 미제공 · 공개원문 확인 미제공 · 수집 미제공/);
 assert.equal(record.sourceDate,null);assert.equal(record.verifiedAt,'2026-10-27');assert.equal(record.collectedAt,'2026-10-28T01:02:03Z');
});

function livingSetup(){
 const saved={document:globalThis.document,fetch:globalThis.fetch,FormData:globalThis.FormData,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};
 const listeners=new Map(),calls=[],messages=[],host={scrollTop:0,addEventListener(type,handler){listeners.set(type,handler)},removeEventListener(type){listeners.delete(type)},querySelectorAll(){return []}};let html='';
 globalThis.document={body:{classList:{remove(){}}},getElementById:id=>id==='detail-body'?host:null};globalThis.innerWidth=1400;globalThis.innerHeight=900;
 globalThis.FormData=class{constructor(form){this.values=form.values}get(name){return this.values[name]}};
 const dongs=[{type:'Feature',geometry:rectangle(126.8,126.9),properties:{dongId:'seogu-01',dongName:'첫동'}},{type:'Feature',geometry:rectangle(126.9,127),properties:{dongId:'seogu-02',dongName:'다음동'}}];
 const data={
  '/data/decision/seogu/manifest.json':{regionId:'seogu',datasets:[{id:'care-toys',title:'장난감도서관',topic:'care',path:'/data/decision/seogu/care-toys.geojson'},{id:'care-libraries',title:'어린이도서관',topic:'care',path:'/data/decision/seogu/care-libraries.geojson'}],presets:[{id:'childcare'}]},
  '/data/decision/seogu/care-directory.json':{entries:[{id:'address',name:'주소만 있는 센터',datasetId:'care-child-centers',address:'서구 공공로 1',coordinates:null,sourceDate:null}]},
  '/data/decision/seogu/care-toys.geojson':{type:'FeatureCollection',features:Array.from({length:12},(_,i)=>facility('toy-'+i,'장난감시설 '+i,[126.85,35.15],{livingSourceId:undefined}))},
  '/data/decision/seogu/care-libraries.geojson':{type:'FeatureCollection',features:[facility('library','공공 어린이도서관',[126.95,35.15],{livingSourceId:undefined,dongName:'가짜동'})]},
 };
 globalThis.fetch=async path=>{calls.push(path);if(!data[path])throw Error('Unexpected request '+path);return {ok:true,json:async()=>structuredClone(data[path])}};
 const state={regionProfile:{id:'seogu',name:'서구'},dong:'all',dongs,district:rectangle(126.8,127),scope:rectangle(126.8,127),entries:new Map(),enabled:new Set()};
 const api={state,show(title,body,view){html=body;state.view=view},drawData(){},send(message){messages.push(message)},chooseDong(id){state.dong=id;state.scope=id==='all'?state.district:dongs.find(f=>f.properties.dongId===id).geometry},toast(){}};
 const ui=installDecisionTwin(api);
 return {api,ui,calls,messages,get html(){return html},action:(action,data={})=>runRegisteredAction({dataset:{action,...data}},api),change(id,value){listeners.get('change')({target:{id,value}})},search(query){return listeners.get('submit')({target:{matches:selector=>selector==='#living-search',values:{query}},preventDefault(){}})},cleanup(){ui.destroy();for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('living controller connects category, verified dong search, scope reset, pagination, and explicit map actions',async()=>{
 const env=livingSetup();try{
  await env.action('decision-living-map');assert.equal((env.html.match(/data-living-card=/g)||[]).length,10);
  assert.match(env.html,/data-destination-source-id="toy-/);assert.match(env.html,/data-destination-dataset="care-toys"/);
  await env.action('decision-living-more');assert.equal((env.html.match(/data-living-card=/g)||[]).length,13);
  await env.search('다음동');assert.equal(env.api.state.entries.get('decision-twin-results').features.length,1);assert.match(env.html,/공공 어린이도서관/);
  await env.search('가짜동');assert.equal(env.api.state.entries.get('decision-twin-results').features.length,0);
  await env.action('decision-living-reset');await env.action('decision-living-kind',{dataset:'group:libraries'});
  assert.equal(env.api.state.entries.get('decision-twin-results').features.length,1);
  env.change('living-scope','seogu-01');assert.equal(env.api.state.entries.get('decision-twin-results').features.length,0);assert.match(env.html,/서구 전체에서 찾기/);
  await env.action('decision-living-all');assert.equal(env.api.state.entries.get('decision-twin-results').features.length,1);
  await env.action('decision-living-focus',{id:'living:care-libraries:library'});assert.equal(env.messages.at(-1).type,'camera');
  assert.ok(env.calls.every(path=>path.startsWith('/data/decision/seogu/')));
 }finally{env.cleanup();}
});

