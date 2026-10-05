import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {icingGeometry,icingRegionMatches} from '../server/city/icing.js';
import {normalizeSafetyRows,readSafetyData,safetyStatus} from '../server/city/safetydata.js';
import {SAFETY_BY_ID,SAFETY_SOURCES} from '../src/city/safety-catalog.js';
import {scopeFor,dongs} from '../server/city/common.js';
import {mercator,filterFeatures} from '../src/city/geometry.js';
import {createSafetyHub} from '../src/city/safety-hub.js';

const source=SAFETY_BY_ID['sd-icing'],scope=scopeFor('all');
const p=dongs.features[6].properties.labelPoint,[x,y]=mercator(p);
const row=(overrides={})=>({SN:'fixture-1',SE:'S',SCTN_NO:'fixture-section',MNG_INST_NM:'광주광역시 서구',RPRS_RGN:'광주광역시 서구',ROAD_RTE_NM:'TEST ONLY ROAD',FRGL_TYPE:'고갯길',TRNORTH_CRTR_ROAD_DRTN_DEG:'0',XMAP_CRTS:x,YMAP_CRTS:y,GEOM:`POINT(${x} ${y})`,...overrides});
const jsonResponse=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const env={SAFETYDATA_00120_KEY:'TEST_ONLY_NOT_A_REAL_KEY'};

test('icing: source is a tenth exact national endpoint with a dedicated server key',()=>{
 assert.equal(SAFETY_SOURCES.length,10);
 assert.equal(source.code,'DSSP-IF-00120');
 assert.equal(source.endpoint,'https://www.safetydata.go.kr/V2/api/DSSP-IF-00120');
 assert.equal(source.keyEnv,'SAFETYDATA_00120_KEY');
 assert.deepEqual(source.requestFields,['serviceKey','numOfRows','pageNo','returnType']);
 assert.equal(source.coordinateSystem,'EPSG:3857');
 const status=safetyStatus(env).find(s=>s.id===source.id);
 assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes(env.SAFETYDATA_00120_KEY));
});

test('icing: the same Seo-gu name in another city is excluded before mapping',()=>{
 assert.equal(icingRegionMatches('광주광역시 서구'),true);
 assert.equal(icingRegionMatches(' 광주 서구 '),true);
 for(const region of ['대구광역시 서구','대전광역시 서구','부산광역시 서구','서구','경기도 광주시','광주광역시 북구'])assert.equal(icingRegionMatches(region),false,region);
 const result=normalizeSafetyRows([row(),row({SN:'other-city',RPRS_RGN:'대구광역시 서구'}),row({SN:'missing-region',RPRS_RGN:''})],source,scope);
 assert.equal(result.features.length,1);assert.equal(result.quality.regionMatched,1);assert.equal(result.quality.regionExcluded,1);assert.equal(result.quality.regionUnknown,1);
});

test('icing: verified Mercator point conversion preserves geometry, original values, and raw section identity',()=>{
 const normalized=normalizeSafetyRows([row()],source,scope,{collectedAt:'2026-10-05T12:00:00Z'});
 const f=normalized.features[0];
 assert.ok(Math.abs(f.geometry.coordinates[0]-p[0])<1e-10);
 assert.ok(Math.abs(f.geometry.coordinates[1]-p[1])<1e-10);
 assert.equal(f.geometry.type,'Point');assert.equal(f.properties.sectionNo,'fixture-section');
 assert.equal(f.properties.originalAttributes.GEOM,row().GEOM);
 assert.equal(f.properties.originalAttributes.SE,'S');assert.equal(f.properties.originalCrs,'EPSG:3857');
 assert.equal(f.properties.sourceDate,null);assert.equal(f.properties.collectedAt,'2026-10-05T12:00:00Z');
 assert.match(f.properties.geometryMeaning,/지점/);
});

test('icing: source geometry disagreement, wrong CRS, missing coordinates, and fake joining do not create points',()=>{
 for(const raw of [row({GEOM:`POINT(${x+20} ${y})`}),row({GEOM:`SRID=5179;POINT(${x} ${y})`}),row({XMAP_CRTS:126.8,YMAP_CRTS:35.1,GEOM:'POINT(126.8 35.1)'}),row({XMAP_CRTS:'',YMAP_CRTS:null,GEOM:null})]){
  assert.equal(icingGeometry(raw).geometry,null);
  const r=normalizeSafetyRows([raw],source,scope,{locationIndex:{'sd-icing':{'fixture-1':{verified:true,name:'TEST JOIN',longitude:p[0],latitude:p[1],sourceName:'TEST FIXTURE'}}}});
  assert.equal(r.features.length,0);assert.equal(r.quality.needsLocation,1);assert.equal(r.unlocated.length,1);
 }
});

test('icing: a Seo-gu named point outside the actual boundary stays off the map',()=>{
 const [ox,oy]=mercator([127,35.3]);
 const result=normalizeSafetyRows([row({XMAP_CRTS:ox,YMAP_CRTS:oy,GEOM:`POINT(${ox} ${oy})`})],source,scope);
 assert.equal(result.features.length,0);assert.equal(result.quality.regionMatched,1);assert.equal(result.quality.regionBoundaryConflict,1);
});

test('icing: start/end points are not connected and section numbers are not counted as point count',async()=>{
 let url;
 const rows=[row(),row({SN:'fixture-2',SE:'E'})];
 const r=await readSafetyData('sd-icing',new URLSearchParams({dong:'all',serviceKey:'CLIENT_IGNORED'}),{env,fetcher:async u=>{url=u;return jsonResponse({header:{resultCode:'00'},body:rows,totalCount:2});}});
 assert.deepEqual([...url.searchParams.keys()].sort(),['numOfRows','pageNo','returnType','serviceKey'].sort());
 assert.equal(url.searchParams.get('serviceKey'),env.SAFETYDATA_00120_KEY);
 assert.equal(r.scanned,2);assert.equal(r.total,2);assert.equal(r.complete,true);assert.equal(r.sectionCount,1);
 assert.equal(r.geojson.features.length,2);assert.ok(r.geojson.features.every(f=>f.geometry.type==='Point'));
 assert.equal(r.regionalRows.length,2);assert.equal(r.rawSample.length,2);assert.equal(r.collectedAt,r.geojson.features[0].properties.collectedAt);
 assert.ok(!JSON.stringify(r).includes(env.SAFETYDATA_00120_KEY));
});

test('icing: HTTP 200 error 32 is a failed receipt, including flat XML replies',async()=>{
 for(const response of [()=>jsonResponse({header:{resultCode:'32',resultMsg:'UNREGISTERED IP ERROR'}}),()=>new Response('<response><header><resultCode>32</resultCode><resultMsg>UNREGISTERED IP ERROR</resultMsg></header></response>',{headers:{'content-type':'application/xml'}})]){
  await assert.rejects(readSafetyData('sd-icing',new URLSearchParams(),{env,fetcher:async()=>response()}),e=>e.code==='SAFETYDATA_32'&&e.status===403);
 }
});

test('icing: a short page cannot falsely claim completion when the provider reports more rows',async()=>{
 await assert.rejects(readSafetyData('sd-icing',new URLSearchParams(),{env,fetcher:async()=>jsonResponse({body:[row()],totalCount:200})}),e=>e.code==='PAGE_GAP');
 const rows=Array.from({length:500},(_,i)=>row({SN:String(i),RPRS_RGN:'대구광역시 서구'}));
 const r=await readSafetyData('sd-icing',new URLSearchParams(),{env,fetcher:async()=>jsonResponse({body:rows,totalCount:501})});
 assert.equal(r.complete,false);assert.equal(r.nextPage,2);assert.equal(r.scanned,500);assert.equal(r.geojson.features.length,0);assert.equal(r.quality.regionExcluded,500);
});

function harness(fetcher){
 const feature={type:'Feature',geometry:{type:'Point',coordinates:p},properties:{id:'local-test',name:'TEST ONLY',sectionNo:'test'}};
 const s={dong:dongs.features[0].properties.dongId,dongs:dongs.features,district:scope,scope:scopeFor(dongs.features[0].properties.dongId),entries:new Map([['local-icing',{state:'loaded',features:[feature],metadata:{collectedAt:'2026-10-05T12:00:00Z',countUnit:'관리지점'}}]]),enabled:new Set(['parks']),config:{configured:{'sd-icing':true}},view:null};
 const shown=[];const api={state:s,show(title,html,view){s.view=view;shown.push({title,html,view});},scoped(id){return filterFeatures(s.entries.get(id)?.features||[],s.scope);},chooseDong(id){s.dong=id;s.scope=scopeFor(id);},drawData(){},send(){},toast(){},label(){return s.dong==='all'?'서구 전체':'선택 동';},fetchJSON:fetcher};
 return {s,api,shown,hub:createSafetyHub(api)};
}
const act=(hub,action,id)=>hub.action({dataset:{action,id}});

test('icing UI: menu first opens all Seo-gu and a later dong selection changes display only',async()=>{
 const oldDocument=globalThis.document;globalThis.document={getElementById(){return null;}};
 try{
  const h=harness(async()=>{throw Error('No fetch expected');});
  await act(h.hub,'icing');assert.equal(h.s.dong,'all');assert.deepEqual([...h.s.enabled],['local-icing']);
  assert.match(h.shown.at(-1).html,/공식 공개지도에서 확보한 자료/);
  await act(h.hub,'icing-dong',dongs.features[6].properties.dongId);
  assert.equal(h.s.dong,dongs.features[6].properties.dongId);
  assert.equal(h.s.entries.get('local-icing').features.length,1);
 }finally{globalThis.document=oldDocument;}
});

test('icing UI: collection always requests all Seo-gu even when a dong is selected and keeps the full dataset',async()=>{
 const oldDocument=globalThis.document;globalThis.document={getElementById(){return null;}};
 try{
  let requested;
  const h=harness(async url=>{requested=url;return {scope:'all',page:1,scanned:1,total:1,complete:true,pageFingerprint:'test-page',collectedAt:'2026-10-05T12:00:00Z',geojson:{features:normalizeSafetyRows([row()],source,scope).features},quality:{regionMatched:1,mappedRows:1,needsLocation:0,outside:0},regionalRows:[row()]};});
  await act(h.hub,'sd-fetch','sd-icing');
  assert.match(requested,/dong=all/);assert.notEqual(h.s.dong,'all');
  assert.equal(h.s.entries.get('sd-icing').features.length,1);assert.equal(h.s.entries.get('sd-icing').metadata.scopeDong,'all');
  await act(h.hub,'sd-detail','sd-icing');assert.match(h.shown.at(-1).html,/TEST ONLY ROAD/);assert.match(h.shown.at(-1).html,/최근 요청 결과<\/dt><dd>수신 성공/);
 }finally{globalThis.document=oldDocument;}
});

test('icing UI: denied API preserves official snapshot and displays failure separately from configuration',async()=>{
 const oldDocument=globalThis.document;globalThis.document={getElementById(){return null;}};
 try{
  const h=harness(async()=>{throw Object.assign(Error('등록되지 않은 IP입니다.'),{code:'SAFETYDATA_32',status:403});});
  await act(h.hub,'icing');await act(h.hub,'sd-fetch','sd-icing');
  assert.equal(h.s.entries.has('sd-icing'),false);assert.equal(h.s.entries.get('local-icing').features.length,1);
  assert.ok(h.s.enabled.has('local-icing'));assert.match(h.shown.at(-1).html,/SAFETYDATA_32/);
  await act(h.hub,'sd-detail','sd-icing');const html=h.shown.at(-1).html;
  assert.match(html,/최근 요청 결과<\/dt><dd>수신 실패 · SAFETYDATA_32/);assert.match(html,/설정됨 \(수신 성공과 별도\)/);assert.match(html,/미수신/);
 }finally{globalThis.document=oldDocument;}
});

test('icing UI: partial API solo, hide, and restore actions report the actual visible source and count',async()=>{
 const oldDocument=globalThis.document;globalThis.document={getElementById(){return null;}};
 try{
  const h=harness(async()=>{throw Error('No fetch expected');});
  const local=h.s.entries.get('local-icing'),first=local.features[0];
  local.features.push({...first,properties:{...first.properties,id:'local-test-2',sectionNo:'test-2'}});
  await act(h.hub,'icing');
  assert.match(h.shown.at(-1).html,/<dt>선택 범위의 관리지점<\/dt><dd>2개<\/dd>/);
  h.s.entries.set('sd-icing',{state:'partial',features:[{...first,properties:{...first.properties,id:'api-test-1'}}],metadata:{scopeDong:'all',complete:false}});
  await act(h.hub,'sd-solo','sd-icing');
  assert.deepEqual([...h.s.enabled],['sd-icing']);
  assert.match(h.shown.at(-1).html,/<dt>지금 지도에 사용하는 자료<\/dt><dd>API 부분수신본<\/dd>/);
  assert.match(h.shown.at(-1).html,/<dt>선택 범위의 관리지점<\/dt><dd>1개<\/dd>/);
  assert.match(h.shown.at(-1).html,/data-layer="sd-icing" data-id="api-test-1"/);
  await act(h.hub,'sd-with','sd-icing');
  assert.equal(h.s.enabled.size,0);
  assert.match(h.shown.at(-1).html,/<dd>결빙자료 지도 표시 꺼짐<\/dd>/);
  assert.match(h.shown.at(-1).html,/<dt>선택 범위의 관리지점<\/dt><dd>미표시<\/dd>/);
  await act(h.hub,'icing-solo');
  assert.deepEqual([...h.s.enabled],['local-icing']);
  assert.match(h.shown.at(-1).html,/<dd>공식 공개지도에서 확보한 자료<\/dd>/);
  assert.match(h.shown.at(-1).html,/<dt>선택 범위의 관리지점<\/dt><dd>2개<\/dd>/);
 }finally{globalThis.document=oldDocument;}
});

test('icing UI: menu and per-service key helper are reachable',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/data-action="icing"/);assert.match(html,/data-action="official-data"/);
 const helper=fs.readFileSync(new URL('../tools/safety-key-import.html',import.meta.url),'utf8');
 assert.match(helper,/\['00120','상습결빙구간'\]/);
});
