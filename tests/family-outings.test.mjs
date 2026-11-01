import test from 'node:test';
import assert from 'node:assert/strict';
import {familyOutingRows,familyMapFeatures,familyOutingLinks,familyGuideHtml,installFamilyOutings,FAMILY_MAP_LAYER} from '../src/city/family-outings.js';
import {familyViewGeometry} from '../src/city/family-map-extent.js';
import {pointInGeometry} from '../src/admin.js';
import {PendingMessages} from '../src/city/layer-sync.js';
import {runRegisteredAction} from '../src/city/actions.js';

const place=(id,patch={},geometry={type:'Point',coordinates:[126.85,35.15]})=>({
 type:'Feature',geometry,properties:{id,name:'유적근린공원 유아숲체험원',district:'서구',category:'forest',environment:'outdoor',address:'서구 동천동 660',sourceAddress:'광주광역시 서구 동천동 660',summary:'숲속에서 자연을 관찰하는 장소',activities:['나뭇잎 모양 관찰하기'],activitySource:'provided',aliases:['유적공원'],sourceRefs:[{collection:'forest',number:32,page:93}],locationStatus:'address-matched',...patch},
});
const forest=place('forest');
const library=place('library',{name:'어린이생태학습도서관',category:'library',environment:'indoor',address:'서구 풍암공원로 8',sourceAddress:'서구 풍암동 옛주소',aliases:['생태도서관'],activities:['그림책 읽기']});
const science=place('science',{name:'국립광주과학관',district:'북구',category:'science',environment:'mixed',address:'북구 첨단과기로 235',sourceAddress:'',aliases:[],activities:['별자리 알아보기']},{type:'Point',coordinates:[126.849,35.228]});
const pending=place('pending',{name:'주소 확인 중인 공원',category:'park',address:'',sourceAddress:'서구 옛 공원길 1',activities:['천천히 산책하기'],aliases:[],locationStatus:'unverified'},null);
const pack={type:'FeatureCollection',metadata:{sourceDescription:'제공된 책자의 장소 목록',collectedAt:'2026-11-01'},features:[forest,library,science,pending]};
const ids=rows=>rows.map(feature=>feature.properties.id).sort();

test('district, activity group, environment and search work together without hiding unresolved addresses',()=>{
 assert.deepEqual(ids(familyOutingRows(pack)),['forest','library','pending']);
 assert.deepEqual(ids(familyOutingRows(pack,{district:'all'})),['forest','library','pending','science']);
 assert.deepEqual(ids(familyOutingRows(pack,{district:'서구',group:'nature',environment:'outdoor'})),['forest','pending']);
 assert.deepEqual(ids(familyOutingRows(pack,{district:'all',group:'science',environment:'mixed',query:'북구 별자리'})),['science']);
 assert.equal(familyOutingRows(pack,{district:'서구',group:'science'}).length,0);
 assert.equal(familyOutingRows(pack,{district:'all',environment:'indoor',query:'과학관'}).length,0);
});

test('book addresses, aliases and activities can all find a place despite punctuation and spacing',()=>{
 assert.deepEqual(ids(familyOutingRows(pack,{query:'풍암동 옛주소'})),['library']);
 assert.deepEqual(ids(familyOutingRows(pack,{query:'생태 도서관'})),['library']);
 assert.deepEqual(ids(familyOutingRows(pack,{query:'나뭇잎 모양'})),['forest']);
 const commemorative={...pack,features:[place('518',{name:'5·18 유아숲체험원'})]};
 assert.deepEqual(ids(familyOutingRows(commemorative,{query:'5.18 유아숲'})),['518']);
});

test('the map excludes invalid or unverified points but keeps those records in the searchable list',()=>{
 const invalid=[null,{type:'Point',coordinates:[NaN,35.15]},{type:'Point',coordinates:['126.85',35.15]},{type:'Point',coordinates:[0,0]},{type:'Point',coordinates:[126.85,35.15,10]},{type:'LineString',coordinates:[[126.85,35.15],[126.86,35.16]]}].map((geometry,i)=>place('bad-'+i,{},geometry));
 const unverified=place('not-reviewed',{locationStatus:'unverified'});
 const collection={...pack,features:[forest,science,...invalid,unverified]};
 const rows=familyOutingRows(collection,{district:'all'});
 assert.equal(rows.length,9);
 assert.deepEqual(ids(familyMapFeatures(rows)),['forest','science']);
 for(const feature of [...invalid,unverified])assert.equal(familyOutingLinks(feature).route,null,feature.properties.id);
 const html=familyGuideHtml({collection,district:'all'});
 assert.match(html,/지도 2곳 · 위치 확인 중 7곳/);
 assert.equal((html.match(/data-family-card=/g)||[]).length,9);
});

test('route URLs use reviewed coordinates and explicit confirm-first policies take priority',()=>{
 const normal=familyOutingLinks(forest);
 assert.equal(normal.route,'https://map.kakao.com/link/to/'+encodeURIComponent(forest.properties.name)+',35.15,126.85');
 for(const name of ['평두메습지','교육청']){
  const restricted=place('confirm',{name,directionPolicy:'confirm-first',noticeLabel:'출입 사전 확인',website:'https://example.go.kr/visit',visitNote:'방문 전에 기관에 문의해 주세요.'});
  assert.equal(familyOutingLinks(restricted).route,null);
  const html=familyGuideHtml({collection:{features:[restricted]}});
  assert.match(html,/출입 안내 확인/);
  assert.match(html,/공식 방문·출입 안내/);
  assert.doesNotMatch(html,/map\.kakao\.com\/link\/to\//);
  assert.match(html,/data-action="family-focus"/,'location can still be inspected without offering a route');
 }
});

test('a disputed book address never reappears as the visit address or external search destination',()=>{
 const disputed=place('disputed',{name:'광주천변공원',address:'',sourceAddress:'서구 칠성로35번길 19',directionPolicy:'search-only',noticeLabel:'주소 확인 중',mapQuery:'광주 서구 광주천변공원',locationStatus:'unverified'},null);
 const links=familyOutingLinks(disputed);
 assert.equal(links.route,null);
 assert.equal(decodeURIComponent(links.search),'https://map.kakao.com/link/search/광주 서구 광주천변공원');
 const html=familyGuideHtml({collection:{features:[disputed]}});
 assert.match(html,/서구 · 상세 주소 확인 중/);
 const addressBlock=html.match(/<p class="family-address">[\s\S]*?<\/p>/)?.[0]||'';
 assert.doesNotMatch(addressBlock,/칠성로/);
 const externalLinks=[...html.matchAll(/href="([^"]+)"/g)].map(match=>decodeURIComponent(match[1]));
 assert.ok(externalLinks.every(link=>!link.includes('칠성로')));
 assert.match(html,/책자 주소: 서구 칠성로35번길 19/,'original evidence remains available under sources');
 assert.equal(familyOutingLinks({...disputed,properties:{...disputed.properties,mapQuery:''}}).search,'https://map.kakao.com/link/search/'+encodeURIComponent('광주천변공원 서구'));
 assert.equal(familyOutingLinks(place('still-review',{directionPolicy:'search-only'})).route,null,'a point alone does not lift an address-review restriction');
});

test('position notes and source material are displayed safely without accepting executable links',()=>{
 const feature=place('safe-output',{name:'<img src=x onerror=alert(1)>',positionNote:'공원 대표점이며 유아숲 입구 위치는 현장에서 확인합니다.',website:'javascript:alert(1)',coordinateSource:{title:'공개 원문',url:'https://user:password@example.org/secret'},activities:['<script>alert(1)</script>']});
 const html=familyGuideHtml({collection:{features:[feature]},selectedId:'safe-output'});
 assert.match(html,/공원 대표점이며 유아숲 입구 위치는 현장에서 확인합니다/);
 assert.doesNotMatch(html,/<img|<script|href="javascript:|href="https:\/\/user:password/);
 assert.match(html,/&lt;img/);
 assert.match(html,/위치 대조일은 운영 확인일이 아니에요/);
});

test('a reviewed representative point with search-only policy offers entrance search even when an official website exists',()=>{
 const feature=place('entrance-search',{directionPolicy:'search-only',mapQuery:'광주 서구 유적근린공원 입구',website:'https://example.go.kr/park'});
 assert.equal(familyOutingLinks(feature).route,null);
 const html=familyGuideHtml({collection:{features:[feature]}});
 const actions=html.match(/<div class="family-card-actions">([\s\S]*?)<\/div>/)?.[1]||'';
 assert.match(actions,/data-action="family-focus"/);
 assert.match(actions,/지도에서 입구 찾기/);
 assert.equal((actions.match(/map\.kakao\.com\/link\/search\//g)||[]).length,1);
 assert.doesNotMatch(html,/map\.kakao\.com\/link\/to\//);
 const unlocated={...feature,geometry:null,properties:{...feature.properties,locationStatus:'unverified'}};
 const unlocatedHtml=familyGuideHtml({collection:{features:[unlocated]}});
 const unlocatedActions=unlocatedHtml.match(/<div class="family-card-actions">([\s\S]*?)<\/div>/)?.[1]||'';
 assert.equal((unlocatedActions.match(/map\.kakao\.com\/link\/search\//g)||[]).length,1);
 assert.doesNotMatch(unlocatedActions,/지도에서 입구 찾기|data-action="family-focus"/);
});

test('activity adaptation notes appear once inside visit details and are escaped',()=>{
 const note='떨어진 자연물만 활용해요. <script>bad</script>',feature=place('activity-note',{activityNote:note});
 const html=familyGuideHtml({collection:{features:[feature]}});
 assert.equal((html.match(/class="family-activity-note"/g)||[]).length,1);
 assert.ok(html.indexOf('class="family-activity-note"')>html.indexOf('<details class="family-visit"'));
 assert.ok(html.indexOf('class="family-activity-note"')<html.indexOf('<details class="family-sources"'));
 assert.match(html,/떨어진 자연물만 활용해요\. &lt;script&gt;bad&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script>/);
});

function controllerFixture(collection=pack,region='seogu'){
 const previous={document:globalThis.document,fetch:globalThis.fetch};
 const listeners=new Map(),messages=[],frames=[],requests=[],classes=new Set();
 const classList={add:value=>classes.add(value),remove:value=>classes.delete(value),toggle(){}};
 const host={scrollTop:0,innerHTML:'',querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const panel={hidden:true},strip={classList,hidden:true,setAttribute(){},remove(){this.removed=true;}},app={append(){}};
 globalThis.document={body:{classList},createElement:()=>strip,getElementById:id=>({'detail-body':host,'detail-panel':panel,app})[id]||null};
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>structuredClone(collection)};};
 const scope={type:'Polygon',coordinates:[[[126.8,35.1],[126.9,35.1],[126.9,35.18],[126.8,35.18],[126.8,35.1]]]};
 const state={regionProfile:{id:region},scope,district:scope,view:null};
 const api={state,send:message=>messages.push(message),pauseMotion(){},toast(){},frameGeometry:geometry=>frames.push(geometry),show(title,html,view){host.innerHTML=html;state.view=view;panel.hidden=false;},close(){state.view=null;panel.hidden=true;}};
 const ui=installFamilyOutings(api);
 return {ui,state,scope,requests,messages,frames,strip,host,classes,action:(action,data={})=>runRegisteredAction({dataset:{action,...data}},api),cleanup(){ui.destroy();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

test('the controller shows another district on the map without changing analysis scope, and restores its extent on leave',async()=>{
 const env=controllerFixture();try{
  await env.action('family-outings');
  await env.action('family-district',{district:'all'});
  const layer=env.messages.findLast(message=>message.type==='layer'&&message.id===FAMILY_MAP_LAYER);
  assert.deepEqual(ids(layer.features),['forest','library','science']);
  assert.equal(pointInGeometry(science.geometry.coordinates,env.scope),false,'test destination really is outside the selected administrative geometry');
  assert.equal(pointInGeometry(science.geometry.coordinates,familyViewGeometry()),true,'the family view can encompass the destination');
  assert.equal(env.state.scope,env.scope);
  assert.equal(env.state.district,env.scope);
  assert.ok(env.messages.some(message=>message.type==='family-extent'&&message.active===true));
  env.ui.suspend();
  assert.equal(env.messages.findLast(message=>message.type==='family-extent').active,false);
  assert.equal(env.messages.findLast(message=>message.type==='layer'&&message.id===FAMILY_MAP_LAYER).visible,false);
  assert.equal(env.frames.at(-1),env.scope);
  assert.equal(env.strip.hidden,true);
  assert.equal(env.classes.has('family-outings-active'),false);
 }finally{env.cleanup();}
});

test('selecting a marker opens its card and protects the selected label from a shared-location cluster',async()=>{
 const env=controllerFixture();try{
  await env.action('family-outings');
  assert.equal(env.ui.onEvent({type:'select',layer:FAMILY_MAP_LAYER,id:'library'}),true);
  assert.match(env.host.innerHTML,/class="family-card is-selected" data-family-card="library"/);
  const selected=env.messages.findLast(message=>message.type==='layer'&&message.id==='family-outings-selected');
  assert.deepEqual(ids(selected.features),['library']);
  assert.equal(selected.features[0].properties.mapLabel,'어린이생태학습도서관');
  const main=env.messages.findLast(message=>message.type==='layer'&&message.id===FAMILY_MAP_LAYER);
  assert.ok(main.features.every(feature=>feature.properties.id!=='library'),'selected destination is not drawn twice');
 }finally{env.cleanup();}
});

test('Suncheon does not request or expose the Gwangju family data pack',async()=>{
 const env=controllerFixture(pack,'suncheon');try{
  await env.action('family-outings');
  assert.equal(env.requests.length,0);
  assert.equal(env.messages.length,0);
  assert.equal(env.state.view,null);
 }finally{env.cleanup();}
});

test('the expanded display extent reaches an initializing map before its camera movement and latest reset wins',()=>{
 const pending=new PendingMessages();
 pending.add({type:'camera',pose:{center:science.geometry.coordinates}});
 pending.add({type:'family-extent',active:true});
 let messages=pending.drain();
 assert.ok(messages.findIndex(message=>message.type==='family-extent')<messages.findIndex(message=>message.type==='camera'));
 pending.add({type:'family-extent',active:true});
 pending.add({type:'family-extent',active:false});
 messages=pending.drain();
 assert.deepEqual(messages,[{type:'family-extent',active:false}]);
});
