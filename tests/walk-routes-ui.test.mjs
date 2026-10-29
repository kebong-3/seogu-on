import test from 'node:test';
import assert from 'node:assert/strict';
import {installWalkRoutes,buildWalkAssessmentFeatures} from '../src/city/walk-routes.js';
import {walkDistance} from '../shared/walk-route-model.js';
import {runRegisteredAction} from '../src/city/actions.js';

const polygon={type:'Polygon',coordinates:[[[126,34],[128,34],[128,37],[126,37],[126,34]]]};
const fixtures=[
  {id:'start',name:'서구청 들불홀',category:'public',coordinate:[126.8900126833,35.15202903],routeEligible:true},
  {id:'end',name:'화정1동행정복지센터 다목적실',category:'public',coordinate:[126.8777206,35.156420477],routeEligible:true},
  {id:'shade',name:'실제 그늘시설',category:'shade',coordinate:[126.883,35.155],routeEligible:true},
  {id:'police',name:'공개 경찰관서',category:'police',coordinate:[126.882,35.157],routeEligible:true},
  {id:'care',name:'실제 어린이집',category:'childcare',coordinate:[126.881,35.158],routeEligible:true},
  {id:'same-place',name:'같은 건물 다른 공간',category:'public',coordinate:[126.881,35.158],routeEligible:true},
  {id:'bell',name:'여자화장실 내 비상벨',category:'bell',coordinate:[126.88,35.16],routeEligible:false},
];
const saved={document:globalThis.document,fetch:globalThis.fetch,innerWidth:globalThis.innerWidth,localStorage:globalThis.localStorage};
function setup({configured=true,post,search}={}){
  const hostListeners=new Map(),nodes=new Map(),calls=[],paints=[],tools=[],frames=[];let html='',clears=0,catalogueCandidates=structuredClone(fixtures),catalogueReferences=null,catalogueSafeReturn=null;
  const host={scrollTop:0,addEventListener(type,handler){hostListeners.set(type,handler)},removeEventListener(type){hostListeners.delete(type)}};
  globalThis.document={hidden:false,getElementById(id){return id==='detail-body'?host:nodes.get(id)},addEventListener(){},removeEventListener(){}};
  globalThis.innerWidth=1366;
  globalThis.localStorage={getItem(){throw Error('Persistent storage must not be used')},setItem(){throw Error('Persistent storage must not be used')}};
  const state={view:null,regionProfile:{id:'seogu',name:'서구'},scope:polygon,ready:true};
  const routeBody=(request,{expiresAt=new Date(Date.now()+30*60000).toISOString()}={})=>({mode:request.mode,region:{id:'seogu'},requestedAt:new Date().toISOString(),expiresAt,routes:[
    {id:'direct',role:'direct',label:'직접',distanceMeters:1200,durationSeconds:900,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[request.start,request.end]},properties:{}}]},via:[]},
    {id:'via',role:'via',label:'시설 경유',distanceMeters:1500,durationSeconds:1080,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[request.start,...(request.viaIds||['shade']).map(id=>fixtures.find(c=>c.id===id).coordinate),request.end]},properties:{}}]},via:(request.viaIds||['shade']).map(id=>fixtures.find(c=>c.id===id))},
  ],warnings:[]});
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(new URL(url,'https://local.invalid').searchParams.has('q'))return search?search(url):{ok:true,json:async()=>({ok:true,region:{id:'seogu'},items:[]})};if(!options.method)return {ok:true,json:async()=>({configured,region:{id:'seogu'},candidates:catalogueCandidates,safetyReferences:catalogueReferences,safeReturn:catalogueSafeReturn})};const request=JSON.parse(options.body);return post?post(request,routeBody):{ok:true,json:async()=>routeBody(request)}};
  const api={state,show(title,body,view){html=body;state.view=view},label(){return '서구 전체'},send(message){tools.push(message)},toast(){},paintWalkRoutes(routes,active,points,assessmentFeatures,referenceFeatures){paints.push({routes,active,points,assessmentFeatures,referenceFeatures})},clearWalkRoutes(){clears++},frameGeometry(geometry){frames.push(geometry)}};
  const ui=installWalkRoutes(api);
  return {ui,api,calls,paints,tools,frames,nodes,setCandidates(items){catalogueCandidates=items},setReferences(value){catalogueReferences=value},setSafeReturn(value){catalogueSafeReturn=value},get html(){return html},get clears(){return clears},action:async(action,data={})=>runRegisteredAction({dataset:{action,...data}},api),submit(field){return hostListeners.get('submit')({target:{dataset:{walkSearch:field}},preventDefault(){}})},input(id,value,extra={}){hostListeners.get('input')({target:{id,value,...extra}})},change(id,value,checked){hostListeners.get('change')({target:{id,value,checked}})},cleanup(){ui.destroy();for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

// Existing comparison scenarios explicitly choose the seasonal mode and example endpoints.
async function openExample(env){await env.action('walk-routes',{mode:'shade'});await env.action('walk-example');}

const RETURN_A='seogu-safe-return-geumho-1',RETURN_B='seogu-safe-return-hwajeong-1';
function safeReturnCatalogue(){
  const line=(id,name,coordinates)=>({type:'Feature',properties:{id,routeId:id,name,geometryStatus:'image-interpreted',uncertaintyMeters:35},geometry:{type:'LineString',coordinates}});
  return {regionId:'seogu',metadata:{regionId:'seogu',geometryStatus:'image-interpreted'},corridors:{type:'FeatureCollection',metadata:{regionId:'seogu',sourceName:'공식 지도 이미지 판독',sourceDate:'2026-08'},features:[
    line(RETURN_A,'금호1',[[126.8900126833,35.15202903],[126.885,35.154],[126.8777206,35.156420477]]),
    {type:'Feature',properties:{id:'image-cctv-1',routeId:RETURN_A,routeName:'금호1',facilityType:'cctv-bell'},geometry:{type:'Point',coordinates:[126.885,35.154]}},
    line(RETURN_B,'화정1',[[126.87,35.15],[126.875,35.153]]),
  ]}};
}

test('safety entry explicitly selects a reviewed image corridor and paints it separately without querying TMAP',async()=>{
  const env=setup();env.setSafeReturn(safeReturnCatalogue());
  try{
    await env.action('walk-routes',{mode:'safety',safeReturnId:RETURN_A});
    assert.match(env.html,/안심귀가 길찾기/);assert.match(env.html,new RegExp(`<option value="${RETURN_A}" selected>`));
    assert.match(env.html,/주황: 경찰지도 판독선/);assert.match(env.html,/청록·분홍: TMAP 실제 경로/);
    assert.ok(env.calls.every(call=>!call.options.method),'opening or choosing an image corridor must not query a route');
    const paint=env.paints.at(-1);assert.deepEqual(paint.routes,[]);assert.deepEqual(paint.assessmentFeatures,[]);
    assert.equal(paint.referenceFeatures.length,2);assert.ok(paint.referenceFeatures.every(feature=>feature.properties.safeReturnId===RETURN_A&&feature.properties.referenceGeometry===true));
    await env.action('walk-show-safe-return');assert.equal(env.frames.at(-1).features.length,1,'map framing uses the corridor line, not a CCTV point');
    assert.ok(env.calls.every(call=>!call.options.method));
    await env.action('walk-example');await env.action('walk-calculate');
    const request=JSON.parse(env.calls.at(-1).options.body);
    assert.equal(request.mode,'safety');assert.equal(request.safeReturnId,RETURN_A);assert.equal(request.maxDetourMeters,500);assert.equal(request.maxDetourMinutes,5);
    assert.equal(request.departureAt,undefined);assert.equal(request.navigation,undefined);
    const resultPaint=env.paints.at(-1);assert.equal(resultPaint.routes.length,2);assert.equal(resultPaint.active,'direct');assert.equal(resultPaint.referenceFeatures.length,2);
  }finally{env.cleanup();}
});

test('safety entry refuses a foreign-region catalogue and malformed lines instead of selecting them',async()=>{
  for(const kind of ['foreign-region','invalid-line']){
    const data=safeReturnCatalogue();if(kind==='foreign-region')data.regionId='suncheon';else data.corridors.features[0].geometry.coordinates=[[126.89,35.15],[null,35.16]];
    const env=setup();env.setSafeReturn(data);
    try{
      await env.action('walk-routes',{mode:'safety',safeReturnId:RETURN_A});
      assert.match(env.html,/선택한 귀갓길 판독자료를 불러오지 못했어요/);
      assert.doesNotMatch(env.html,new RegExp(`<option value="${RETURN_A}" selected>`));
      assert.ok(env.calls.every(call=>!call.options.method));
      assert.ok(env.paints.every(paint=>paint.referenceFeatures.every(feature=>feature.geometry?.type!=='LineString'||feature.geometry.coordinates.every(point=>point.every(Number.isFinite)))));
    }finally{env.cleanup();}
  }
});

test('changing the safety corridor invalidates a result and sends the new reference only on explicit calculation',async()=>{
  const env=setup();env.setSafeReturn(safeReturnCatalogue());
  try{
    await env.action('walk-routes',{mode:'safety',safeReturnId:RETURN_A});await env.action('walk-example');await env.action('walk-calculate');
    const requests=env.calls.length;env.change('walk-safe-return-choice',RETURN_B);
    assert.equal(env.calls.length,requests);assert.doesNotMatch(env.html,/data-action="walk-select-route"/);
    assert.ok(env.paints.at(-1).referenceFeatures.every(feature=>feature.properties.safeReturnId===RETURN_B));
    env.change('walk-safe-return-choice','unknown-id');assert.equal(env.calls.length,requests);
    await env.action('walk-calculate');assert.equal(JSON.parse(env.calls.at(-1).options.body).safeReturnId,RETURN_B);
  }finally{env.cleanup();}
});

test('safety metrics distinguish unknown evidence and unknown detours from recorded zero without a safest claim',async()=>{
  const env=setup({post:async(request,body)=>{
    const response=body(request),unknown={status:'not-connected',nearMeters:null},zero={status:'partial-recorded-proximity',nearMeters:0};
    response.routes[0].safety={metrics:{lighting:unknown,cctv:zero,corridor:unknown,detourMeters:null,detourSeconds:null,withinDetour:null}};
    response.safety={routes:[{id:'via',metrics:{lighting:{nearMeters:120},cctv:{nearMeters:50},corridor:zero,detourMeters:300,detourSeconds:180,withinDetour:false}}],comparison:{preferredRouteId:'via'}};
    return {ok:true,json:async()=>response};
  }});env.setSafeReturn(safeReturnCatalogue());
  try{
    await env.action('walk-routes',{mode:'safety',safeReturnId:RETURN_A});await env.action('walk-example');await env.action('walk-calculate');
    const selected=env.html.slice(env.html.indexOf('<button class="walk-route-card is-active"'),env.html.indexOf('</button>',env.html.indexOf('<button class="walk-route-card is-active"')));
    assert.match(selected,/보안등 설치점 25m 주변<\/small><b>자료 미연결/);assert.match(selected,/CCTV 표시 30m 주변<\/small><b>0m/);
    assert.match(selected,/기본길 대비 추가<\/small><b>비교 불가/);assert.doesNotMatch(selected,/\+0|기본길 대비 추가<\/small><b>0m/);
    assert.match(env.html,/설정한 추가 거리·시간 한도 초과/);assert.doesNotMatch(env.html,/가장 안전|최고 안전|안전점수|추천 안전등급/);
    assert.equal(env.paints.at(-1).active,'direct','an evidence comparison must not auto-select a claimed safest alternative');
  }finally{env.cleanup();}
});

test('basic mode clears the safety overlay and selection, and leaving the service cannot repaint it',async()=>{
  const env=setup();env.setSafeReturn(safeReturnCatalogue());
  try{
    await env.action('walk-routes',{mode:'safety',safeReturnId:RETURN_A});const before=env.clears;
    await env.action('walk-mode',{mode:'basic'});assert.ok(env.clears>before);assert.doesNotMatch(env.html,/walk-safety-context/);
    await env.action('walk-example');await env.action('walk-calculate');const request=JSON.parse(env.calls.at(-1).options.body);
    assert.equal(request.navigation,true);assert.equal(request.safeReturnId,undefined);assert.deepEqual(env.paints.at(-1).referenceFeatures,[]);
    await env.action('walk-mode',{mode:'safety'});const cleared=env.clears,painted=env.paints.length;
    env.ui.suspend();env.api.state.view='resilience';env.ui.onEvent({type:'ready'});
    assert.ok(env.clears>cleared);assert.equal(env.paints.length,painted);
  }finally{env.cleanup();}
});

test('GPS rerouting preserves the corridor and upcoming road stop from the selected automatic alternative',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let receive,cleared=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{watchPosition(success){receive=success;return 17},clearWatch(){cleared++}}}});
  const stop={id:`safe-return-road:${RETURN_A}:0`,name:'판독 도로 경유점',category:'safe-return-road',coordinate:[126.885,35.154]};
  const env=setup({post:async(request,body)=>{
    const response=body({...request,viaIds:[]}),route={...response.routes[1],id:request.navigation?'navigation':'via',safeReturnId:RETURN_A,via:[stop],geojson:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[request.start,stop.coordinate,request.end]}}]}};
    response.routes=request.navigation?[route]:[response.routes[0],route];
    return {ok:true,json:async()=>response};
  }});env.setSafeReturn(safeReturnCatalogue());
  try{
    await env.action('walk-routes',{mode:'safety'});await env.action('walk-example');await env.action('walk-calculate');
    assert.equal(JSON.parse(env.calls.at(-1).options.body).safeReturnId,undefined,'the initial request leaves corridor choice automatic');
    await env.action('walk-select-route',{id:'via'});await env.action('walk-nav-start');assert.equal(typeof receive,'function');
    receive({coords:{longitude:fixtures[0].coordinate[0],latitude:fixtures[0].coordinate[1],accuracy:5},timestamp:Date.now()});
    await env.action('walk-nav-reroute');
    const requests=env.calls.filter(call=>call.options.method==='POST').map(call=>JSON.parse(call.options.body));
    assert.equal(requests.length,2);assert.equal(requests[1].safeReturnId,RETURN_A);assert.deepEqual(requests[1].viaIds,[stop.id]);assert.equal(requests[1].navigation,true);
    assert.equal(env.paints.at(-1).active,'navigation');
    await env.action('walk-nav-stop');assert.ok(cleared>0);
  }finally{
    env.cleanup();
    if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;
  }
});

test('place search requires choosing a result before routing, and preserves searched points on catalogue refresh',async()=>{
  const item={id:'search:seogu:0',name:'장난감도서관',address:'서구 경열로 33',coordinate:[126.852,35.151],sourceName:'브이월드 장소·주소 검색'};
  const env=setup({search:async()=>({ok:true,json:async()=>({ok:true,region:{id:'seogu'},items:[item,{...item,id:'outside',name:'구 밖',coordinate:[130,40]}]})})});try{
    await openExample(env);env.nodes.set('walk-start-query',{value:'경열로 33'});await env.submit('start');
    assert.match(env.html,/장난감도서관/);assert.doesNotMatch(env.html,/구 밖/);assert.ok(env.calls.every(call=>!call.options.method));
    await env.action('walk-calculate');assert.match(env.html,/출발과 도착을 모두 선택/);assert.ok(env.calls.every(call=>!call.options.method));
    await env.action('walk-choose-place',{field:'start',index:'0'});await env.action('walk-retry');await env.action('walk-calculate');
    assert.deepEqual(JSON.parse(env.calls.at(-1).options.body).start,item.coordinate);
    env.input('walk-start-query','다른 주소');await env.action('walk-calculate');assert.match(env.html,/출발과 도착을 모두 선택/);
  }finally{env.cleanup();}
});

test('search evidence stays accessible outside the selection button and after choosing the endpoint',async()=>{
  const item={id:'source-place',name:'근거 시설',coordinate:[126.852,35.151],sourceName:'공식 원문',sourceDate:null,sourceUrl:'https://example.gov/source?a=1&b=2'};
  const env=setup({search:async()=>({ok:true,json:async()=>({ok:true,region:{id:'seogu'},items:[item]})})});try{
    await openExample(env);env.nodes.set('walk-start-query',{value:'근거 시설'});await env.submit('start');
    assert.match(env.html,/<\/button><small class="walk-search-source">기준 미제공 · <a href="https:\/\/example\.gov\/source\?a=1&amp;b=2"/);
    await env.action('walk-choose-place',{field:'start',index:'0'});
    assert.match(env.html,/선택 시설 원자료<\/a> · 기준 미제공/);
    assert.match(env.html,/rel="noopener noreferrer"/);
  }finally{env.cleanup();}
});

test('TMAP general places outside the catalogue can be selected without inventing source dates',async()=>{
  const item={id:'search:seogu:tmap-cafe',name:'상무 카페',address:'광주 서구 상무대로 1',coordinate:[126.852,35.151],sourceName:'TMAP 장소검색',searchProvider:'tmap'};
  const env=setup({search:async()=>({ok:true,json:async()=>({ok:true,region:{id:'seogu'},items:[item],providers:[{name:'TMAP 장소검색',status:'available'}],notice:'TMAP에서 찾은 장소입니다.'})})});
  try{
    await env.action('walk-routes');env.nodes.set('walk-start-query',{value:'상무 카페'});await env.submit('start');
    assert.match(env.html,/TMAP 장소검색<\/strong>/);assert.match(env.html,/서구 안 · 1곳/);
    assert.match(env.html,/TMAP 검색 결과 · 실제 출입구/);assert.doesNotMatch(env.html,/원자료 링크 미제공/);
    await env.action('walk-choose-place',{field:'start',index:'0'});
    assert.match(env.html,/출발지: 상무 카페/);assert.match(env.html,/walk-selected-source">TMAP 장소검색/);
    await env.action('walk-example');
    assert.ok(env.calls.every(call=>!call.options.method),'search and selection must not automatically request a paid route');
  }finally{env.cleanup();}
});

test('empty search preserves the provider permission failure instead of claiming only no matching places',async()=>{
  const env=setup({search:async()=>({ok:true,json:async()=>({ok:true,region:{id:'seogu'},items:[],providers:[{name:'TMAP 장소검색',status:'unavailable'}],notice:'TMAP 장소검색: 키·서비스 이용 권한 확인 필요.'})})});
  try{
    await env.action('walk-routes');env.nodes.set('walk-end-query',{value:'상무 카페'});await env.submit('end');
    assert.match(env.html,/검색된 장소가 없어요/);assert.match(env.html,/키·서비스 이용 권한 확인 필요/);
    assert.match(env.html,/walk-place-notice" role="status"/);
  }finally{env.cleanup();}
});

test('missing or unsafe search evidence URLs are never made into clickable links',async()=>{
  const items=[{id:'unsafe',name:'잘못된 링크',coordinate:[126.852,35.151],sourceUrl:'javascript:alert(1)'},{id:'credential',name:'인증주소',coordinate:[126.853,35.151],sourceUrl:'https://private:secret@example.gov/source'},{id:'missing',name:'원문 미제공',coordinate:[126.854,35.151]}];
  const env=setup({search:async()=>({ok:true,json:async()=>({ok:true,region:{id:'seogu'},items})})});try{
    await openExample(env);env.nodes.set('walk-start-query',{value:'근거 시설'});await env.submit('start');
    assert.equal((env.html.match(/원자료 링크 미제공/g)||[]).length,3);
    assert.doesNotMatch(env.html,/href="(?:javascript:|https:\/\/private:secret)/);
  }finally{env.cleanup();}
});

test('editing an in-flight place search enables a new search and ignores the older reply',async()=>{
  let finishOld;
  const oldItem={id:'search:seogu:old',name:'이전 검색 시설',coordinate:[126.85,35.15]};
  const newItem={id:'search:seogu:new',name:'새 검색 시설',coordinate:[126.86,35.16]};
  const env=setup({search:async url=>new URL(url,'https://local.invalid').searchParams.get('q')==='첫 검색'?new Promise(resolve=>{finishOld=()=>resolve({ok:true,json:async()=>({ok:true,region:{id:'seogu'},items:[oldItem]})})}):{ok:true,json:async()=>({ok:true,region:{id:'seogu'},items:[newItem]})}});
  try{
    await openExample(env);env.nodes.set('walk-start-query',{value:'첫 검색'});
    const pending=env.submit('start');assert.match(env.html,/검색 중/);
    const button={disabled:true,textContent:'검색 중'};let removed=0;
    env.input('walk-start-query','새 검색',{closest:selector=>selector==='form'?{querySelector:()=>button}:{querySelector:()=>({remove(){removed++}})}});
    assert.equal(button.disabled,false);assert.equal(button.textContent,'검색');assert.equal(removed,2);
    env.nodes.set('walk-start-query',{value:'새 검색'});await env.submit('start');
    assert.match(env.html,/새 검색 시설/);finishOld();await pending;
    assert.match(env.html,/새 검색 시설/);assert.doesNotMatch(env.html,/이전 검색 시설/);
  }finally{env.cleanup();}
});

test('map endpoints can cross a selected dong within the region and swapping cancels a pending map pick',async()=>{
  const env=setup();try{
    env.api.state.district=polygon;env.api.state.scope={type:'Polygon',coordinates:[[[126.88,35.15],[126.90,35.15],[126.90,35.16],[126.88,35.16],[126.88,35.15]]]};
    await openExample(env);await env.action('walk-pick',{field:'start'});env.ui.onEvent({type:'point',tool:'walk-start',point:[126.8,35.1]});
    await env.action('walk-pick',{field:'end'});await env.action('walk-swap');
    assert.equal(env.tools.at(-1).type,'stop');env.ui.onEvent({type:'point',tool:'walk-end',point:[126.7,35.2]});await env.action('walk-calculate');
    const body=JSON.parse(env.calls.at(-1).options.body);assert.deepEqual(body.end,[126.8,35.1]);assert.deepEqual(body.start,fixtures[1].coordinate);
  }finally{env.cleanup();}
});

test('explicit route cancel keeps endpoints and ignores a response that finishes later',async()=>{
  let finish;
  const env=setup({post:async(request,body)=>new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>body(request)})})});try{
    await openExample(env);const pending=env.action('walk-calculate');assert.match(env.html,/조회 취소/);await env.action('walk-cancel-route');finish();await pending;
    assert.equal(env.paints.length,0);assert.match(env.html,/출발·도착은 유지/);assert.match(env.html,/서구청 들불홀/);
  }finally{env.cleanup();}
});

test('leaving the walking service cancels pending work and cannot repaint on map ready, while endpoints survive',async()=>{
  let finish,first=true;
  const env=setup({post:async(request,body)=>{if(first){first=false;return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>body(request)})})}return {ok:true,json:async()=>body(request)}}});
  try{
    await openExample(env);const pending=env.action('walk-calculate');
    env.ui.suspend();env.api.state.view='resilience';finish();await pending;
    env.ui.onEvent({type:'ready'});env.ui.scopeChanged();assert.equal(env.paints.length,0);assert.equal(env.api.state.view,'resilience');
    await env.action('walk-routes');assert.match(env.html,/서구청 들불홀/);assert.match(env.html,/화정1동행정복지센터 다목적실/);
    await env.action('walk-calculate');assert.equal(env.paints.length,1);
  }finally{env.cleanup();}
});

test('explicit example selection chooses two real places without a paid request, and explicit comparison sends only coordinates',async()=>{
  const env=setup();try{
    await openExample(env);
    assert.equal(env.calls.length,1);assert.ok(!env.calls[0].options.method);
    assert.match(env.html,/서구청 들불홀/);assert.match(env.html,/계단을 피하는 옵션/);
    assert.doesNotMatch(env.html,/<option[^>]*value="bell"/,'inaccessible indoor bell is not an endpoint choice');
    await env.action('walk-calculate');
    const body=JSON.parse(env.calls[1].options.body);
    assert.deepEqual(Object.keys(body).sort(),['avoidStairs','departureAt','end','includeLevels','maxDetourMeters','maxDetourMinutes','mode','regionId','shadowTiming','start']);
    assert.deepEqual(body.start,fixtures[0].coordinate);assert.deepEqual(body.end,fixtures[1].coordinate);
    assert.equal(env.paints.length,1);assert.equal(env.paints[0].points[0].role,'start');assert.match(env.html,/\+3분/);assert.match(env.html,/\+300m/);
    env.api.state.view=null;await env.action('walk-routes');assert.equal(env.calls.length,2,'reopening retains only the current in-memory result');
    await env.action('walk-select-route',{id:'via'});assert.equal(env.paints.at(-1).active,'via');
  }finally{env.cleanup();}
});

test('inspection preserves the chosen visit order, excludes duplicate coordinates and estimates local stay time separately',async()=>{
  const env=setup();try{
    await openExample(env);await env.action('walk-mode',{mode:'inspection'});
    for(const id of ['care','same-place','police','shade']){env.nodes.set('walk-via-choice',{value:id});await env.action('walk-add-via');}
    await env.action('walk-move-via',{id:'shade',direction:'up'});
    await env.action('walk-calculate');
    const body=JSON.parse(env.calls.at(-1).options.body);assert.deepEqual(body.viaIds,['care','shade','police']);assert.equal(body.mode,'inspection');
    assert.ok(!('stayMinutes'in body),'stay assumption never changes the provider request');
    assert.match(env.html,/체류 10분 × 3곳 가정 · 총 약 48분/);
    const before=env.calls.length;env.change('walk-stay-minutes','5');assert.equal(env.calls.length,before);assert.match(env.html,/체류 5분 × 3곳 가정 · 총 약 33분/);
  }finally{env.cleanup();}
});

test('changing mode invalidates a pending response and does not paint a stale route',async()=>{
  let release,routeResult;
  const env=setup({post:async(request,body)=>{routeResult=body(request);return new Promise(resolve=>{release=resolve})}});
  try{
    await openExample(env);const pending=env.action('walk-calculate');
    await env.action('walk-mode',{mode:'care'});release({ok:true,json:async()=>routeResult});await pending;
    assert.equal(env.paints.length,0);assert.match(env.html,/돌봄시설을 들르는 길/);assert.doesNotMatch(env.html,/walk-route-card/);
  }finally{env.cleanup();}
});

test('unconfigured and map-selection flows do not silently query a route',async()=>{
  const env=setup({configured:false});try{
    await openExample(env);assert.match(env.html,/지금은 도보길을 조회할 수 없어요/);
    await env.action('walk-calculate');assert.equal(env.calls.length,1);
    await env.action('walk-pick',{field:'start'});assert.equal(env.tools.at(-1).tool,'walk-start');
    assert.equal(env.ui.onEvent({type:'point',tool:'walk-start',point:[130,40]}),true);assert.doesNotMatch(env.html,/지도에서 고른 출발지/);
    assert.equal(env.ui.onEvent({type:'point',tool:'walk-start',point:[126.8,35.1]}),true);assert.match(env.html,/지도에서 고른 출발지/);assert.equal(env.calls.length,1);
    assert.doesNotMatch(env.html,/type="(?:text|number)"[^>]*(?:lon|lat)/,'coordinates are not presented as form fields');
  }finally{env.cleanup();}
});

test('results expire and clear their private map geometry when the panel reopens',async()=>{
  const env=setup(),realNow=Date.now;let now=realNow();Date.now=()=>now;
  try{
    await openExample(env);await env.action('walk-calculate');assert.equal(env.paints.length,1);
    now+=31*60000;env.api.state.view=null;await env.action('walk-routes');
    assert.match(env.html,/조회한 경로의 표시 시간이 끝났어요/);assert.doesNotMatch(env.html,/walk-route-card/);assert.ok(env.clears>1);
  }finally{Date.now=realNow;env.cleanup();}
});


test('catalogue refresh updates endpoint coordinates, preserves map points and removes vanished or ineligible inspection visits',async()=>{
  const env=setup();try{
    await openExample(env);await env.action('walk-mode',{mode:'inspection'});
    await env.action('walk-pick',{field:'start'});env.ui.onEvent({type:'point',tool:'walk-start',point:[126.85,35.2]});
    for(const id of ['care','police','shade']){env.nodes.set('walk-via-choice',{value:id});await env.action('walk-add-via');}
    await env.action('walk-calculate');assert.equal(env.paints.length,1);
    const refreshed=structuredClone(fixtures).filter(c=>c.id!=='care');
    refreshed.find(c=>c.id==='police').routeEligible=false;
    refreshed.find(c=>c.id==='end').coordinate=[126.87,35.17];
    env.setCandidates(refreshed);await env.action('walk-retry');
    assert.match(env.html,/시설 목록이 바뀌어/);assert.doesNotMatch(env.html,/walk-route-card/);
    assert.doesNotMatch(env.html,/data-id="(?:care|police)"[^>]*aria-label/);
    await env.action('walk-calculate');
    const request=JSON.parse(env.calls.at(-1).options.body);
    assert.deepEqual(request.start,[126.85,35.2]);assert.deepEqual(request.end,[126.87,35.17]);assert.deepEqual(request.viaIds,['shade']);
    env.setCandidates(refreshed.filter(c=>c.id!=='shade'));await env.action('walk-retry');
    assert.match(env.html,/data-action="walk-calculate"[^>]*disabled/);
    const before=env.calls.filter(c=>c.options.method==='POST').length;
    await env.action('walk-calculate');assert.equal(env.calls.filter(c=>c.options.method==='POST').length,before,'an emptied inspection visit list must not reach the provider');
  }finally{env.cleanup();}
});

test('catalogue refresh removes duplicate-coordinate and no-longer-supported waypoints',async()=>{
  const env=setup();try{
    const meeting={id:'meeting',name:'별도 활동공간',category:'public',coordinate:[126.884,35.159],routeEligible:true};
    env.setCandidates([...structuredClone(fixtures),meeting]);await openExample(env);await env.action('walk-mode',{mode:'care'});
    for(const id of ['care','meeting']){env.nodes.set('walk-via-choice',{value:id});await env.action('walk-add-via');}
    const updated=[...structuredClone(fixtures),{...meeting,coordinate:[...fixtures.find(c=>c.id==='care').coordinate]}];
    env.setCandidates(updated);await env.action('walk-retry');await env.action('walk-calculate');
    assert.deepEqual(JSON.parse(env.calls.at(-1).options.body).viaIds,['care']);
    updated.find(c=>c.id==='care').category='shade';env.setCandidates(updated);await env.action('walk-retry');
    assert.doesNotMatch(env.html,/class="walk-visit-list"/);assert.match(env.html,/시설 목록이 바뀌어/);
  }finally{env.cleanup();}
});


test('seasonal controls send an explicit Korean-time departure and preserve zero detour limits without an automatic request',async()=>{
  const env=setup();try{
    await openExample(env);assert.match(env.html,/선택 일시/);assert.match(env.html,/한국시간/);assert.match(env.html,/겨울 안전보행/);
    env.change('walk-departure-at','2026-07-15T14:10');env.change('walk-max-detour-meters','0');env.change('walk-max-detour-minutes','0');env.change('walk-shadow-timing','departure-static');
    assert.equal(env.calls.filter(c=>c.options.method==='POST').length,0);
    await env.action('walk-calculate');const body=JSON.parse(env.calls.at(-1).options.body);
    assert.equal(body.departureAt,'2026-07-15T14:10:00+09:00');assert.equal(body.maxDetourMeters,0);assert.equal(body.maxDetourMinutes,0);assert.equal(body.shadowTiming,'departure-static');
    env.change('walk-departure-at','2026-02-31T14:10');const previous=env.calls.length;await env.action('walk-calculate');assert.equal(env.calls.length,previous);assert.match(env.html,/출발 일시와 우회 한도를 확인/);
  }finally{env.cleanup();}
});

test('seasonal evidence remains available while direct is initially selected and an alternative requires an explicit selection',async()=>{
  const env=setup({post:async(request,body)=>{const answer=body(request);answer.seasonal={status:'partial',comparison:{preferredRouteId:'via',basis:'우회 한도 안에서 미평가 구간까지 함께 비교했어요.',reason:'model-bounded-improvement'}};for(const route of answer.routes)route.seasonal=route.id==='via'?{routeLengthMeters:1500,evaluatedMeters:1200,unevaluatedMeters:300,estimatedShadeMeters:500,sunlitMeters:700,coverageRatio:.8,reasons:['건물높이가 미상인 구간은 미평가로 남겼어요.']}:{routeLengthMeters:1200,evaluatedMeters:1000,unevaluatedMeters:200,estimatedShadeMeters:100,sunlitMeters:900,coverageRatio:1000/1200};return{ok:true,json:async()=>answer}}});
  try{
    await openExample(env);await env.action('walk-calculate');assert.equal(env.paints.at(-1).active,'direct');
    assert.match(env.html,/조회한 후보 중 먼저 살펴볼 길/);assert.match(env.html,/수록 건물로 계산한 추정 그늘/);assert.match(env.html,/500m/);assert.match(env.html,/300m/);assert.match(env.html,/80%/);assert.match(env.html,/그늘·일조 미확인 거리/);assert.doesNotMatch(env.html,/최적|안전을 보장|개선 여부를 확정하기 어려워요/);
    await env.action('walk-select-route',{id:'via'});assert.equal(env.paints.at(-1).active,'via');
    env.change('walk-departure-at','2026-07-15T16:00');assert.doesNotMatch(env.html,/walk-route-card/,'changing the time clears the old route evaluation');
  }finally{env.cleanup();}
});

test('winter separates icing-record proximity from sunlight evaluation and night does not turn unknown shade into zero',async()=>{
  const env=setup({post:async(request,body)=>{const answer=body(request);answer.seasonal={status:'not-evaluated',comparison:{preferredRouteId:null,reason:'야간에는 건물그늘을 평가하지 않았어요.'}};for(const route of answer.routes)route.seasonal={status:'deferred',solarState:request.departureAt.includes('T14:')?'day':'night',routeLengthMeters:route.distanceMeters,evaluatedMeters:0,unevaluatedMeters:route.distanceMeters,estimatedShadeMeters:request.departureAt.includes('T14:')?0:null,sunlitMeters:request.departureAt.includes('T14:')?0:null,coverageRatio:0,lowSunMeters:null,icingNearbyMeters:120,reasons:[request.departureAt.includes('T14:')?'coverage-not-declared':'night']};return{ok:true,json:async()=>answer}}});
  try{
    await openExample(env);await env.action('walk-mode',{mode:'winter'});env.change('walk-departure-at','2027-01-15T22:00');await env.action('walk-calculate');
    assert.match(env.html,/일조 적은 거리/);assert.match(env.html,/결빙관리지점 인근/);assert.match(env.html,/120m/);assert.match(env.html,/우선안은 정하지 않았어요/);assert.match(env.html,/결빙 발생 여부나 확률을 계산한 값은 아니에요/);
    await env.action('walk-mode',{mode:'shade'});env.change('walk-departure-at','2026-07-15T22:00');await env.action('walk-calculate');assert.match(env.html,/수록 건물로 계산한 추정 그늘<\/span><b>미평가/);env.change('walk-departure-at','2026-07-15T14:00');await env.action('walk-calculate');assert.match(env.html,/수록 건물로 계산한 추정 그늘<\/span><b>0m/);assert.match(env.html,/그늘·일조 미확인 거리/);
  }finally{env.cleanup();}
});

test('official safe-return references expose their source without manufacturing a mapped route',async()=>{
  const env=setup();try{
    env.setReferences({sourceName:'공식 경찰 안내',sourceDate:'2026-08',sourceUrl:'https://example.gov/official',routes:[{id:'official-1',name:'금호1 <안내>',description:'공식 안내에서 구간 확인'}]});
    await openExample(env);await env.action('walk-mode',{mode:'safety'});
    assert.match(env.html,/공식 여성안심 귀갓길 안내/);assert.match(env.html,/금호1 &lt;안내&gt;/);assert.match(env.html,/https:\/\/example.gov\/official/);assert.match(env.html,/이번에 비교한 도보경로와는 별개/);assert.equal(env.paints.length,0);assert.equal(env.calls.filter(c=>c.options.method==='POST').length,0);
  }finally{env.cleanup();}
});


test('levels-based heights are opt-in, invalidate old results and disclose the number of assumed-height buildings',async()=>{
  const env=setup({post:async(request,body)=>{const answer=body(request);answer.seasonal={status:'partial',model:{includeLevels:request.includeLevels,heightCounts:{total:10,sourceHeight:2,estimatedHeight:request.includeLevels?3:0,unknownHeight:request.includeLevels?5:8}},coverage:{declared:false},comparison:{preferredRouteId:null}};return{ok:true,json:async()=>answer}}});
  try{
    await openExample(env);assert.match(env.html,/층수로 높이를 추정한 건물도 포함/);assert.doesNotMatch(env.html,/id="walk-include-levels"[^>]*checked/);
    await env.action('walk-calculate');assert.equal(JSON.parse(env.calls.at(-1).options.body).includeLevels,false);
    env.change('walk-include-levels','',true);assert.doesNotMatch(env.html,/walk-route-card/);const before=env.calls.length;
    assert.match(env.html,/id="walk-include-levels"[^>]*checked/);assert.equal(env.calls.length,before);
    await env.action('walk-calculate');assert.equal(JSON.parse(env.calls.at(-1).options.body).includeLevels,true);assert.match(env.html,/층당 3m 높이 가정으로 계산한 건물 3개/);assert.match(env.html,/실제 측량 높이가 아닌 가정값/);
  }finally{env.cleanup();}
});

test('assessment ranges preserve the actual route bend and do not connect disconnected provider lines',()=>{
  const a=[126.8,35.1],bend=[126.801,35.1],b=[126.801,35.102],first=walkDistance(a,bend),second=walkDistance(bend,b);
  const route={id:'bent',geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[a,bend,b]},properties:{}}]},seasonal:{samples:[{fromMeters:first/2,toMeters:first+second/2,state:'shade',winter:{classification:'low'},estimatedHeight:true}]}};
  const features=buildWalkAssessmentFeatures(route);assert.equal(features.length,1);const points=features[0].geometry.coordinates;
  assert.equal(points.length,3,'the provider bend remains an intermediate vertex');assert.ok(Math.abs(points[1][0]-bend[0])<1e-10&&Math.abs(points[1][1]-bend[1])<1e-10);assert.equal(features[0].properties.assessmentState,'shade');assert.equal(features[0].properties.estimatedHeight,true);
  assert.ok(points[0][0]>a[0]&&points[0][0]<bend[0]);assert.ok(points[2][1]>bend[1]&&points[2][1]<b[1]);
  assert.equal(buildWalkAssessmentFeatures(route,{mode:'winter'})[0].properties.assessmentState,'low');
  const c=[126.9,35.2],d=[126.901,35.2],length=walkDistance(c,d);
  const disconnected={id:'parts',geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[a,bend],[c,d]]},properties:{}}]},seasonal:{samples:[{fromMeters:0,toMeters:first+length,state:'unknown'}]}};
  const parts=buildWalkAssessmentFeatures(disconnected);assert.equal(parts.length,2);assert.deepEqual(parts[0].geometry.coordinates.at(-1),bend);assert.deepEqual(parts[1].geometry.coordinates[0],c);assert.ok(parts.every(feature=>feature.properties.assessmentState==='unknown'));
});


test('a winter time window with fully unknown sunlight remains unevaluated while positive partial evidence remains visible',async()=>{
  let lowSun=0;
  const env=setup({post:async(request,body)=>{const answer=body(request);answer.seasonal={status:'partial',comparison:{preferredRouteId:null}};for(const route of answer.routes)route.seasonal={status:'partial',routeLengthMeters:route.distanceMeters,evaluatedMeters:0,unevaluatedMeters:route.distanceMeters,estimatedShadeMeters:0,coverageRatio:0,lowSunMeters:lowSun,winterUnevaluatedMeters:route.distanceMeters,winterCoverageRatio:0,icingNearbyMeters:120,winter:{window:{date:'2027-01-15',startHour:9,endHour:16}}};return{ok:true,json:async()=>answer}}});
  try{
    await openExample(env);await env.action('walk-mode',{mode:'winter'});await env.action('walk-calculate');
    assert.match(env.html,/일조 적은 거리<\/span><b>미평가/);assert.doesNotMatch(env.html,/일조 적은 거리<\/span><b>0m/);
    assert.match(env.html,/공개 대표점 50m 이내\(앱 설정\)/);assert.match(env.html,/현재 보도의 빙판 여부를 판정한 값은 아니에요/);
    lowSun=20;env.change('walk-departure-at','2027-01-15T10:00');await env.action('walk-calculate');assert.match(env.html,/일조 적은 거리<\/span><b>20m/);
  }finally{env.cleanup();}
});
test('current location is used only on an explicit action and uncertain fixes cannot retain the old sample start',async()=>{
 const env=setup();let reads=0;try{
  env.api.geolocation={getCurrentPosition(success){reads++;success({coords:{longitude:126.852,latitude:35.151,accuracy:8},timestamp:Date.now()});}};
  await openExample(env);assert.equal(reads,0);await env.action('walk-current-start');assert.equal(reads,1);assert.match(env.html,/출발지: 현재 위치/);await env.action('walk-calculate');assert.deepEqual(JSON.parse(env.calls.at(-1).options.body).start,[126.852,35.151]);
  env.api.geolocation={getCurrentPosition(success){success({coords:{longitude:126.85,latitude:35.15,accuracy:300},timestamp:Date.now()});}};await env.action('walk-current-start');const count=env.calls.length;await env.action('walk-calculate');assert.equal(env.calls.length,count);assert.match(env.html,/출발과 도착을 모두 선택/);
 }finally{env.cleanup();}
});

test('a public-facility plan is reviewed and applied without a route call, while foreign candidate IDs are rejected',async()=>{
 const answer={ok:true,region:{id:'seogu'},mode:'rules',plan:{mode:'care',startId:'start',endId:'end',viaIds:['care'],avoidStairs:true},checkDetails:[{code:'access',text:'기관에 이용조건을 확인하세요.'}],notice:'계획을 확인하세요.'};
 const env=setup({post:async request=>{assert.equal(request.kind,'plan');return {ok:true,json:async()=>structuredClone(answer)};}});try{
  await openExample(env);env.nodes.set('walk-plan-question',{value:'서구청에서 시설까지 계단 없이'});await env.action('walk-plan');assert.equal(env.calls.filter(c=>c.options.method==='POST').length,1);assert.match(env.html,/AI 미사용/);assert.match(env.html,/시설·조건을 확인하고 반영/);await env.action('walk-apply-plan');assert.equal(env.calls.filter(c=>c.options.method==='POST').length,1);assert.match(env.html,/checked>계단/);assert.match(env.html,/기관에 이용조건/);
  answer.plan.endId='foreign-id';await env.action('walk-plan');assert.match(env.html,/공개목록과 계획 결과가 달라/);assert.doesNotMatch(env.html,/data-action="walk-apply-plan"/);
 }finally{env.cleanup();}
});


test('first entry has empty endpoints and folded conditions, and only explicit examples populate them',async()=>{
  const env=setup();try{
    await env.action('walk-routes');
    assert.equal(env.calls.length,1);assert.match(env.html,/data-walk-step="1" aria-current="step"/);
    assert.match(env.html,/<details class="walk-conditions" data-walk-disclosure="conditions">/);
    assert.match(env.html,/data-mode="basic" aria-pressed="true"/);
    assert.doesNotMatch(env.html,/id="walk-(?:start|end)-selected"/);
    assert.doesNotMatch(env.html,/id="walk-departure-at"/);
    assert.match(env.html,/data-action="walk-calculate" disabled/);
    await env.action('walk-calculate');assert.equal(env.calls.length,1);
    await env.action('walk-example');assert.match(env.html,/<strong>예시 장소<\/strong>/);assert.equal(env.calls.length,1);
    await env.action('walk-calculate');const sent=JSON.parse(env.calls.at(-1).options.body);
    assert.equal(sent.navigation,true);assert.equal(sent.mode,'shade');assert.equal(Object.hasOwn(sent,'departureAt'),false);assert.equal(Object.hasOwn(sent,'viaIds'),false);
    assert.equal(env.paints.at(-1).active,'direct');assert.match(env.html,/data-walk-step="2" aria-current="step"/);
    assert.match(env.html,/<details class="walk-entry walk-notes" data-walk-disclosure="endpoints">/);
    assert.doesNotMatch(env.html,/<section class="walk-results"[^>]*aria-live/);
  }finally{env.cleanup();}
});

test('returning to basic routing removes seasonal and visit choices without silently querying',async()=>{
  const env=setup();try{
    await openExample(env);await env.action('walk-mode',{mode:'care'});env.nodes.set('walk-via-choice',{value:'care'});await env.action('walk-add-via');
    const calls=env.calls.length;await env.action('walk-mode',{mode:'basic'});assert.equal(env.calls.length,calls);
    await env.action('walk-calculate');const sent=JSON.parse(env.calls.at(-1).options.body);
    assert.equal(sent.navigation,true);assert.equal(Object.hasOwn(sent,'viaIds'),false);assert.equal(Object.hasOwn(sent,'departureAt'),false);
  }finally{env.cleanup();}
});
test('seasonal result dates stay visible outside folded assessment and distinguish an explicit example from chosen time',async()=>{
 const env=setup();try{await openExample(env);await env.action('walk-mode',{mode:'shade'});await env.action('walk-time-example');await env.action('walk-calculate');let result=env.html.slice(env.html.indexOf('<section class="walk-results"'));assert.match(result,/<p class="walk-result-condition"><strong>예시 일시/);assert.ok(result.indexOf('walk-result-condition')<result.indexOf('walk-result-details'));assert.match(result,/현재 안전 판정이 아니에요/);env.change('walk-departure-at','2026-08-01T13:00');await env.action('walk-calculate');result=env.html.slice(env.html.indexOf('<section class="walk-results"'));assert.match(result,/<p class="walk-result-condition"><strong>출발 일시/);}finally{env.cleanup();}
});

test('facility entry resolves only a unique source reference in the current region and keeps GPS opt-in',async()=>{
  const env=setup();let locationRequests=0;env.api.geolocation={getCurrentPosition(){locationRequests++}};
  env.setCandidates(fixtures.map(c=>({...c,sourceRefs:c.id==='care'?[{datasetId:'verified-care',sourceId:'public-42'}]:[]})));
  try{
    await env.action('walk-routes',{destinationRegion:'seogu',destinationDataset:'verified-care',destinationSourceId:'public-42'});
    assert.match(env.html,/도착지: 실제 어린이집/);assert.doesNotMatch(env.html,/id="walk-start-selected"/);assert.equal(locationRequests,0);assert.equal(env.calls.filter(c=>c.options.method).length,0);
    env.change('walk-start-choice','start');await env.action('walk-calculate');assert.deepEqual(JSON.parse(env.calls.at(-1).options.body).end,fixtures.find(c=>c.id==='care').coordinate);
    await env.action('walk-routes',{destinationRegion:'suncheon',destinationDataset:'verified-care',destinationSourceId:'public-42'});
    assert.match(env.html,/현재 지역에서 확인하지 못했어요/);assert.doesNotMatch(env.html,/id="walk-end-selected"/);const before=env.calls.length;await env.action('walk-calculate');assert.equal(env.calls.length,before);
  }finally{env.cleanup();}
});

test('facility entry rejects ambiguous, ineligible and missing IDs instead of routing to a stale endpoint',async()=>{
  const env=setup();env.setCandidates(fixtures.map(c=>({...c,sourceRefs:['care','same-place'].includes(c.id)?[{datasetId:'overlap',sourceId:'1'}]:[]})));
  try{
    await openExample(env);
    for(const data of [{destinationId:'bell'},{destinationId:'missing'},{destinationDataset:'overlap',destinationSourceId:'1'}]){
      await env.action('walk-routes',{destinationRegion:'seogu',...data});assert.doesNotMatch(env.html,/id="walk-end-selected"/);assert.match(env.html,/현재 지역에서 확인하지 못했어요/);
    }
    assert.equal(env.calls.filter(c=>c.options.method).length,0);
  }finally{env.cleanup();}
});

test('mobile map picking keeps the cancel control visible and cancel preserves existing endpoints',async()=>{
  const env=setup();let closed=0;env.api.close=()=>closed++;globalThis.innerWidth=375;
  try{
    await openExample(env);await env.action('walk-pick',{field:'end'});assert.equal(closed,0);assert.match(env.html,/class="walk-routes is-picking"/);assert.match(env.html,/data-action="walk-cancel-pick"/);
    await env.action('walk-cancel-pick');assert.doesNotMatch(env.html,/class="walk-routes is-picking"/);await env.action('walk-calculate');assert.deepEqual(JSON.parse(env.calls.at(-1).options.body).end,fixtures[1].coordinate);
  }finally{env.cleanup();}
});

test('one-shot location failures and invalid timestamps never enable routing with an unverified start',async()=>{
  const env=setup();let respond,fail=false;env.api.geolocation={getCurrentPosition(success){if(fail)throw Error('device unavailable');respond=success;}};
  try{
    await openExample(env);await env.action('walk-current-start');respond({coords:{longitude:126.852,latitude:35.151,accuracy:10}});
    assert.match(env.html,/위치가 부정확해/);const before=env.calls.length;await env.action('walk-calculate');assert.equal(env.calls.length,before);
    fail=true;await env.action('walk-current-start');assert.match(env.html,/현재 위치를 시작하지 못했어요/);assert.doesNotMatch(env.html,/data-action="walk-current-start" disabled/);
  }finally{env.cleanup();}
});


test('facility entry waits for an already pending catalogue and a later service switch prevents late selection',async()=>{
  for(const leave of [false,true]){
    const env=setup();const fetchCatalogue=globalThis.fetch;let release;
    globalThis.fetch=async(...args)=>{const response=await fetchCatalogue(...args);return new Promise(resolve=>{release=()=>resolve(response)});};
    try{
      const first=env.action('walk-routes');await Promise.resolve();await Promise.resolve();
      const handoff=env.action('walk-routes',{destinationRegion:'seogu',destinationId:'care'});
      if(leave){env.ui.suspend();env.api.state.view='resilience';}
      release();await Promise.all([first,handoff]);assert.equal(env.calls.length,1);
      if(leave){assert.equal(env.api.state.view,'resilience');assert.doesNotMatch(env.html,/도착지: 실제 어린이집/);}
      else{assert.match(env.html,/도착지: 실제 어린이집/);assert.doesNotMatch(env.html,/id="walk-start-selected"/);}
    }finally{env.cleanup();}
  }
});


test('closing the panel or choosing on the map invalidates a pending one-shot location callback',async()=>{
  for(const action of ['close','map']){
    const env=setup();let respond,follows=0;env.api.geolocation={getCurrentPosition(success){respond=success;}};env.api.followWalkPosition=()=>follows++;
    try{
      await env.action('walk-routes');await env.action('walk-current-start');
      if(action==='close'){env.ui.panelClosed();env.api.state.view=null;}else await env.action('walk-pick',{field:'start'});
      const html=env.html;respond({coords:{longitude:126.852,latitude:35.151,accuracy:10},timestamp:Date.now()});
      assert.equal(env.html,html);assert.equal(follows,0);assert.equal(env.api.state.view,action==='close'?null:'walk-routes');
    }finally{env.cleanup();}
  }
});

