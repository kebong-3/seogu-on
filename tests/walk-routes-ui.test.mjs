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
function setup({configured=true,post}={}){
  const hostListeners=new Map(),nodes=new Map(),calls=[],paints=[],tools=[];let html='',clears=0,catalogueCandidates=structuredClone(fixtures),catalogueReferences=null;
  const host={scrollTop:0,addEventListener(type,handler){hostListeners.set(type,handler)},removeEventListener(type){hostListeners.delete(type)}};
  globalThis.document={hidden:false,getElementById(id){return id==='detail-body'?host:nodes.get(id)},addEventListener(){},removeEventListener(){}};
  globalThis.innerWidth=1366;
  globalThis.localStorage={getItem(){throw Error('Persistent storage must not be used')},setItem(){throw Error('Persistent storage must not be used')}};
  const state={view:null,regionProfile:{id:'seogu',name:'서구'},scope:polygon,ready:true};
  const routeBody=(request,{expiresAt=new Date(Date.now()+30*60000).toISOString()}={})=>({mode:request.mode,region:{id:'seogu'},requestedAt:new Date().toISOString(),expiresAt,routes:[
    {id:'direct',role:'direct',label:'직접',distanceMeters:1200,durationSeconds:900,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[request.start,request.end]},properties:{}}]},via:[]},
    {id:'via',role:'via',label:'시설 경유',distanceMeters:1500,durationSeconds:1080,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[request.start,...(request.viaIds||['shade']).map(id=>fixtures.find(c=>c.id===id).coordinate),request.end]},properties:{}}]},via:(request.viaIds||['shade']).map(id=>fixtures.find(c=>c.id===id))},
  ],warnings:[]});
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(!options.method)return {ok:true,json:async()=>({configured,region:{id:'seogu'},candidates:catalogueCandidates,safetyReferences:catalogueReferences})};const request=JSON.parse(options.body);return post?post(request,routeBody):{ok:true,json:async()=>routeBody(request)}};
  const api={state,show(title,body,view){html=body;state.view=view},label(){return '서구 전체'},send(message){tools.push(message)},toast(){},paintWalkRoutes(routes,active,points,assessmentFeatures){paints.push({routes,active,points,assessmentFeatures})},clearWalkRoutes(){clears++},frameGeometry(){}};
  const ui=installWalkRoutes(api);
  return {ui,api,calls,paints,tools,nodes,setCandidates(items){catalogueCandidates=items},setReferences(value){catalogueReferences=value},get html(){return html},get clears(){return clears},action:async(action,data={})=>runRegisteredAction({dataset:{action,...data}},api),change(id,value,checked){hostListeners.get('change')({target:{id,value,checked}})},cleanup(){ui.destroy();for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('opening chooses two real examples without a paid request, and explicit comparison sends only coordinates',async()=>{
  const env=setup();try{
    await env.action('walk-routes');
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
    await env.action('walk-routes');await env.action('walk-mode',{mode:'inspection'});
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
    await env.action('walk-routes');const pending=env.action('walk-calculate');
    await env.action('walk-mode',{mode:'care'});release({ok:true,json:async()=>routeResult});await pending;
    assert.equal(env.paints.length,0);assert.match(env.html,/돌봄시설을 들르는 길/);assert.doesNotMatch(env.html,/walk-route-card/);
  }finally{env.cleanup();}
});

test('unconfigured and map-selection flows do not silently query a route',async()=>{
  const env=setup({configured:false});try{
    await env.action('walk-routes');assert.match(env.html,/지금은 도보길을 조회할 수 없어요/);
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
    await env.action('walk-routes');await env.action('walk-calculate');assert.equal(env.paints.length,1);
    now+=31*60000;env.api.state.view=null;await env.action('walk-routes');
    assert.match(env.html,/조회한 경로의 표시 시간이 끝났어요/);assert.doesNotMatch(env.html,/walk-route-card/);assert.ok(env.clears>1);
  }finally{Date.now=realNow;env.cleanup();}
});


test('catalogue refresh updates endpoint coordinates, preserves map points and removes vanished or ineligible inspection visits',async()=>{
  const env=setup();try{
    await env.action('walk-routes');await env.action('walk-mode',{mode:'inspection'});
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
    env.setCandidates([...structuredClone(fixtures),meeting]);await env.action('walk-routes');await env.action('walk-mode',{mode:'care'});
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
    await env.action('walk-routes');assert.match(env.html,/예시 일시/);assert.match(env.html,/한국시간/);assert.match(env.html,/겨울철 보행안전/);
    env.change('walk-departure-at','2026-07-15T14:10');env.change('walk-max-detour-meters','0');env.change('walk-max-detour-minutes','0');env.change('walk-shadow-timing','departure-static');
    assert.equal(env.calls.filter(c=>c.options.method==='POST').length,0);
    await env.action('walk-calculate');const body=JSON.parse(env.calls.at(-1).options.body);
    assert.equal(body.departureAt,'2026-07-15T14:10:00+09:00');assert.equal(body.maxDetourMeters,0);assert.equal(body.maxDetourMinutes,0);assert.equal(body.shadowTiming,'departure-static');
    env.change('walk-departure-at','2026-02-31T14:10');const previous=env.calls.length;await env.action('walk-calculate');assert.equal(env.calls.length,previous);assert.match(env.html,/출발 일시와 우회 한도를 확인/);
  }finally{env.cleanup();}
});

test('seasonal recommendations show calculated shade and unevaluated distance and select only the server-provided preferred candidate',async()=>{
  const env=setup({post:async(request,body)=>{const answer=body(request);answer.seasonal={status:'partial',comparison:{preferredRouteId:'via',basis:'우회 한도 안에서 미평가 구간까지 함께 비교했어요.',reason:'model-bounded-improvement'}};for(const route of answer.routes)route.seasonal=route.id==='via'?{routeLengthMeters:1500,evaluatedMeters:1200,unevaluatedMeters:300,estimatedShadeMeters:500,sunlitMeters:700,coverageRatio:.8,reasons:['건물높이가 미상인 구간은 미평가로 남겼어요.']}:{routeLengthMeters:1200,evaluatedMeters:1000,unevaluatedMeters:200,estimatedShadeMeters:100,sunlitMeters:900,coverageRatio:1000/1200};return{ok:true,json:async()=>answer}}});
  try{
    await env.action('walk-routes');await env.action('walk-calculate');assert.equal(env.paints.at(-1).active,'via');
    assert.match(env.html,/조회한 후보 중 먼저 살펴볼 길/);assert.match(env.html,/수록 건물로 계산한 추정 그늘/);assert.match(env.html,/500m/);assert.match(env.html,/300m/);assert.match(env.html,/80%/);assert.match(env.html,/그늘·일조 미확인 거리/);assert.doesNotMatch(env.html,/최적|안전을 보장|개선 여부를 확정하기 어려워요/);
    env.change('walk-departure-at','2026-07-15T16:00');assert.doesNotMatch(env.html,/walk-route-card/,'changing the time clears the old route evaluation');
  }finally{env.cleanup();}
});

test('winter separates icing-record proximity from sunlight evaluation and night does not turn unknown shade into zero',async()=>{
  const env=setup({post:async(request,body)=>{const answer=body(request);answer.seasonal={status:'not-evaluated',comparison:{preferredRouteId:null,reason:'야간에는 건물그늘을 평가하지 않았어요.'}};for(const route of answer.routes)route.seasonal={status:'deferred',solarState:request.departureAt.includes('T14:')?'day':'night',routeLengthMeters:route.distanceMeters,evaluatedMeters:0,unevaluatedMeters:route.distanceMeters,estimatedShadeMeters:request.departureAt.includes('T14:')?0:null,sunlitMeters:request.departureAt.includes('T14:')?0:null,coverageRatio:0,lowSunMeters:null,icingNearbyMeters:120,reasons:[request.departureAt.includes('T14:')?'coverage-not-declared':'night']};return{ok:true,json:async()=>answer}}});
  try{
    await env.action('walk-routes');await env.action('walk-mode',{mode:'winter'});env.change('walk-departure-at','2027-01-15T22:00');await env.action('walk-calculate');
    assert.match(env.html,/일조 적은 거리/);assert.match(env.html,/결빙관리지점 인근/);assert.match(env.html,/120m/);assert.match(env.html,/우선안은 정하지 않았어요/);assert.match(env.html,/결빙 발생 여부나 확률을 계산한 값은 아니에요/);
    await env.action('walk-mode',{mode:'shade'});env.change('walk-departure-at','2026-07-15T22:00');await env.action('walk-calculate');assert.match(env.html,/수록 건물로 계산한 추정 그늘<\/span><b>미평가/);env.change('walk-departure-at','2026-07-15T14:00');await env.action('walk-calculate');assert.match(env.html,/수록 건물로 계산한 추정 그늘<\/span><b>0m/);assert.match(env.html,/그늘·일조 미확인 거리/);
  }finally{env.cleanup();}
});

test('official safe-return references expose their source without manufacturing a mapped route',async()=>{
  const env=setup();try{
    env.setReferences({sourceName:'공식 경찰 안내',sourceDate:'2026-08',sourceUrl:'https://example.gov/official',routes:[{id:'official-1',name:'금호1 <안내>',description:'공식 안내에서 구간 확인'}]});
    await env.action('walk-routes');await env.action('walk-mode',{mode:'safety'});
    assert.match(env.html,/공식 여성안심 귀갓길 안내/);assert.match(env.html,/금호1 &lt;안내&gt;/);assert.match(env.html,/https:\/\/example.gov\/official/);assert.match(env.html,/이번에 비교한 도보경로와는 별개/);assert.equal(env.paints.length,0);assert.equal(env.calls.filter(c=>c.options.method==='POST').length,0);
  }finally{env.cleanup();}
});


test('levels-based heights are opt-in, invalidate old results and disclose the number of assumed-height buildings',async()=>{
  const env=setup({post:async(request,body)=>{const answer=body(request);answer.seasonal={status:'partial',model:{includeLevels:request.includeLevels,heightCounts:{total:10,sourceHeight:2,estimatedHeight:request.includeLevels?3:0,unknownHeight:request.includeLevels?5:8}},coverage:{declared:false},comparison:{preferredRouteId:null}};return{ok:true,json:async()=>answer}}});
  try{
    await env.action('walk-routes');assert.match(env.html,/층수로 높이를 추정한 건물도 포함/);assert.doesNotMatch(env.html,/id="walk-include-levels"[^>]*checked/);
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
    await env.action('walk-routes');await env.action('walk-mode',{mode:'winter'});await env.action('walk-calculate');
    assert.match(env.html,/일조 적은 거리<\/span><b>미평가/);assert.doesNotMatch(env.html,/일조 적은 거리<\/span><b>0m/);
    assert.match(env.html,/공개 대표점 50m 이내\(앱 설정\)/);assert.match(env.html,/현재 보도의 빙판 여부를 판정한 값은 아니에요/);
    lowSun=20;env.change('walk-departure-at','2027-01-15T10:00');await env.action('walk-calculate');assert.match(env.html,/일조 적은 거리<\/span><b>20m/);
  }finally{env.cleanup();}
});
