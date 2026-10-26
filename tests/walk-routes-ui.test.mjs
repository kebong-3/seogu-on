import test from 'node:test';
import assert from 'node:assert/strict';
import {installWalkRoutes} from '../src/city/walk-routes.js';
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
  const hostListeners=new Map(),nodes=new Map(),calls=[],paints=[],tools=[];let html='',clears=0,catalogueCandidates=structuredClone(fixtures);
  const host={scrollTop:0,addEventListener(type,handler){hostListeners.set(type,handler)},removeEventListener(type){hostListeners.delete(type)}};
  globalThis.document={hidden:false,getElementById(id){return id==='detail-body'?host:nodes.get(id)},addEventListener(){},removeEventListener(){}};
  globalThis.innerWidth=1366;
  globalThis.localStorage={getItem(){throw Error('Persistent storage must not be used')},setItem(){throw Error('Persistent storage must not be used')}};
  const state={view:null,regionProfile:{id:'seogu',name:'서구'},scope:polygon,ready:true};
  const routeBody=(request,{expiresAt=new Date(Date.now()+30*60000).toISOString()}={})=>({mode:request.mode,region:{id:'seogu'},requestedAt:new Date().toISOString(),expiresAt,routes:[
    {id:'direct',role:'direct',label:'직접',distanceMeters:1200,durationSeconds:900,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[request.start,request.end]},properties:{}}]},via:[]},
    {id:'via',role:'via',label:'시설 경유',distanceMeters:1500,durationSeconds:1080,geojson:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:[request.start,...(request.viaIds||['shade']).map(id=>fixtures.find(c=>c.id===id).coordinate),request.end]},properties:{}}]},via:(request.viaIds||['shade']).map(id=>fixtures.find(c=>c.id===id))},
  ],warnings:[]});
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(!options.method)return {ok:true,json:async()=>({configured,region:{id:'seogu'},candidates:catalogueCandidates})};const request=JSON.parse(options.body);return post?post(request,routeBody):{ok:true,json:async()=>routeBody(request)}};
  const api={state,show(title,body,view){html=body;state.view=view},label(){return '서구 전체'},send(message){tools.push(message)},toast(){},paintWalkRoutes(routes,active,points){paints.push({routes,active,points})},clearWalkRoutes(){clears++},frameGeometry(){}};
  const ui=installWalkRoutes(api);
  return {ui,api,calls,paints,tools,nodes,setCandidates(items){catalogueCandidates=items},get html(){return html},get clears(){return clears},action:async(action,data={})=>runRegisteredAction({dataset:{action,...data}},api),change(id,value,checked){hostListeners.get('change')({target:{id,value,checked}})},cleanup(){ui.destroy();for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('opening chooses two real examples without a paid request, and explicit comparison sends only coordinates',async()=>{
  const env=setup();try{
    await env.action('walk-routes');
    assert.equal(env.calls.length,1);assert.ok(!env.calls[0].options.method);
    assert.match(env.html,/서구청 들불홀/);assert.match(env.html,/계단을 피하는 옵션/);
    assert.doesNotMatch(env.html,/<option[^>]*value="bell"/,'inaccessible indoor bell is not an endpoint choice');
    await env.action('walk-calculate');
    const body=JSON.parse(env.calls[1].options.body);
    assert.deepEqual(Object.keys(body).sort(),['avoidStairs','end','mode','regionId','start']);
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
    await env.action('walk-routes');assert.match(env.html,/TMAP 연결이 필요/);
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
