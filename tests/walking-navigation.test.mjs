import test from 'node:test';
import assert from 'node:assert/strict';
import {installWalkingNavigation} from '../src/city/walking-navigation.js';
import {installWalkRoutes} from '../src/city/walk-routes.js';
import {runRegisteredAction} from '../src/city/actions.js';
import {walkDistance} from '../shared/walk-route-model.js';

const BASE=Date.parse('2026-10-28T00:00:00Z'),R=6371008.8,origin=[126.85,35.15];
const point=(east=0,north=0)=>[origin[0]+east/(R*Math.cos(origin[1]*Math.PI/180))*180/Math.PI,origin[1]+north/R*180/Math.PI];
const region={type:'Polygon',coordinates:[[[126,34],[128,34],[128,37],[126,37],[126,34]]]};
const line=coordinates=>({type:'Feature',geometry:{type:'LineString',coordinates},properties:{}});
const p=(coordinate,description,pointIndex)=>({type:'Feature',geometry:{type:'Point',coordinates:coordinate},properties:{description,pointIndex,turnType:pointIndex===0?200:201}});
const makeRoute=(coordinates=[point(),point(200)],description='목적지 도착')=>({id:'direct',distanceMeters:200,durationSeconds:160,via:[],geojson:{type:'FeatureCollection',features:[p(coordinates[0],'출발 안내',0),line(coordinates),p(coordinates.at(-1),description,1)]}});
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function setup({route=makeRoute(),destination=point(200),reroute,stops=[],watchHook}={}){
  const descriptors=Object.fromEntries(['document','navigator','localStorage'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let time=BASE,nextId=0,rerouted=0,released=0,cancelled=0;const watches=new Map(),cleared=[],sends=[],follows=[],modes=[],spoken=[],reroutes=[],listeners=new Map(),host={innerHTML:''};
  const document={hidden:false,getElementById:id=>id==='walk-navigation'?host:null,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  Object.defineProperty(globalThis,'document',{value:document,writable:true,configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:{wakeLock:{request:async()=>({release:async()=>{released++;}})}},writable:true,configurable:true});
  Object.defineProperty(globalThis,'localStorage',{value:{getItem(){throw Error('GPS history must not be persisted')},setItem(){throw Error('GPS history must not be persisted')}},configurable:true});
  const geolocation={watchPosition(success,error,options){const id=++nextId;watches.set(id,{success,error,options});watchHook?.({success,error,id});return id;},clearWatch:id=>cleared.push(id)};
  const api={state:{district:region,scope:region},send:message=>sends.push(message),followWalkPosition:(coordinate,bearing)=>follows.push({coordinate,bearing}),setWalkingMode:value=>modes.push(value)};
  const controller=installWalkingNavigation({api,getRoute:()=>route,getDestination:()=>({coordinate:destination}),getStops:()=>stops,geolocation,now:()=>time,Utterance:class{constructor(text){this.text=text;}},speech:{cancel(){cancelled++;},speak:utterance=>spoken.push(utterance),getVoices:()=>[{lang:'ko-KR',name:'test voice'}]},requestReroute:async(fix,options)=>{reroutes.push({fix,options});return reroute?reroute(fix,options):makeRoute([fix.coordinate,destination]);},onRerouted:()=>{rerouted++;}});
  return {controller,api,document,geolocation,watches,cleared,sends,follows,modes,spoken,reroutes,host,get now(){return time},get rerouted(){return rerouted},get released(){return released},get cancelled(){return cancelled},get watchId(){return nextId},setTime:seconds=>{time=BASE+seconds*1000;},get state(){return controller.getState()},get html(){return controller.html()},action:(name,data={})=>runRegisteredAction({dataset:{action:name,...data}},api),fix(coordinate,seconds,accuracy=5,id=nextId){time=BASE+seconds*1000;watches.get(id).success({coords:{longitude:coordinate[0],latitude:coordinate[1],accuracy,heading:null,speed:null},timestamp:time});},error(code,id=nextId){watches.get(id).error({code});},hide(){document.hidden=true;listeners.get('visibilitychange')?.();},cleanup(){controller.destroy();for(const [name,descriptor]of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}};
}

function setupRoutes(){
  const env=setup(),realFetch=globalThis.fetch,realNow=Date.now,realInnerWidth=globalThis.innerWidth,events=new Map();let html='',clearCount=0;
  globalThis.navigator.geolocation=env.geolocation;Date.now=()=>env.now;globalThis.innerWidth=1366;
  const detail={scrollTop:0,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)},getElement=env.document.getElementById;
  env.document.getElementById=id=>id==='detail-body'?detail:getElement(id);
  Object.assign(env.api.state,{regionProfile:{id:'seogu',name:'서구'},view:null,ready:true});Object.assign(env.api,{show(title,body,view){html=body;env.api.state.view=view},label:()=> '서구',clearWalkRoutes:()=>{clearCount++},paintWalkRoutes(){},frameGeometry(){},toast(){}});
  globalThis.fetch=async(url,options={})=>{
    if(!options.method)return {ok:true,json:async()=>({ok:true,configured:true,region:{id:'seogu'},candidates:[{id:'a',name:'출발시설',category:'public',routeEligible:true,coordinate:point()},{id:'b',name:'도착시설',category:'public',routeEligible:true,coordinate:point(200)}]})};
    const request=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,region:{id:'seogu'},mode:request.mode,requestedAt:new Date(env.now).toISOString(),expiresAt:new Date(env.now+30*60000).toISOString(),routes:[{...makeRoute([request.start,request.end]),role:'direct'},{...makeRoute([request.start,point(100,20),request.end],'대안 경로 도착'),id:'alternative',role:'via'}],warnings:[]})};
  };
  const ui=installWalkRoutes(env.api);
  return {env,ui,get html(){return html},get clears(){return clearCount},change:(id,value)=>events.get('change')({target:{id,value}}),cleanup(){ui.destroy();globalThis.fetch=realFetch;Date.now=realNow;if(realInnerWidth===undefined)delete globalThis.innerWidth;else globalThis.innerWidth=realInnerWidth;env.cleanup();}};
}

test('prepare and preview show escaped provider instructions without GPS, speech or reroute calls',async()=>{
  const env=setup({route:makeRoute([point(),point(1000)],'<img src=x onerror=alert(1)> 도착'),destination:point(1000)});try{
    env.controller.prepare();assert.match(env.html,/전체 회전 안내/);assert.match(env.html,/&lt;img/);assert.doesNotMatch(env.html,/<img/);assert.equal(env.watches.size,0);
    await env.action('walk-nav-voice');await env.action('walk-nav-preview');assert.equal(env.state.preview,true);assert.equal(env.state.progress.accepted,true);assert.equal(env.watches.size,0);assert.equal(env.spoken.length,0);assert.match(env.html,/위치 사용 안 함/);
    await env.action('walk-nav-next');assert.equal(env.state.progress.accepted,true);assert.ok(env.state.progress.progressMeters>990);assert.equal(env.reroutes.length,0);assert.equal(env.spoken.length,0);assert.equal(env.watches.size,0);assert.match(env.html,/실제 보행이나 GPS 실측 결과가 아니에요/);
  }finally{env.cleanup();}
});

test('start requests fresh accurate GPS, emits accepted positions, then stop ignores late location callbacks',async()=>{
  const env=setup();try{
    await env.action('walk-nav-start');assert.equal(env.state.status,'requesting');assert.equal(env.state.watching,true);assert.deepEqual(env.watches.get(1).options,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    env.fix(point(30),0);assert.equal(env.state.status,'active');assert.equal(env.state.progress.accepted,true);assert.equal(typeof env.state.progress.nextStepIndex,'number');assert.ok(env.sends.at(-1).visible);assert.ok(env.follows.length);
    await env.action('walk-nav-stop');const count=env.sends.length;env.fix(point(80),10,5,1);assert.equal(env.state.status,'idle');assert.equal(env.sends.length,count);assert.deepEqual(env.cleared,[1]);assert.equal(env.sends.at(-1).visible,false);assert.equal(env.modes.at(-1),false);await flush();assert.ok(env.released>=1);
  }finally{env.cleanup();}
});

test('permission denial cleans up the watch and a synchronous denial cannot leave an orphaned watch',async()=>{
  for(const synchronous of [false,true]){
    const env=setup({watchHook:synchronous?({error})=>error({code:1}):undefined});try{
      await env.action('walk-nav-start');if(!synchronous)env.error(1);assert.equal(env.state.status,'error');assert.equal(env.state.watching,false);assert.ok(env.cleared.includes(1));assert.match(env.html,/위치 사용이 허용되지 않았어요/);assert.equal(env.sends.at(-1).visible,false);
    }finally{env.cleanup();}
  }
});

test('unreliable GPS clears the marker and cannot send an older accepted position for rerouting',async()=>{
  const env=setup();try{
    await env.action('walk-nav-start');env.fix(point(30),0);env.fix(point(190),2,100);
    assert.equal(env.state.progress.accepted,false);assert.match(env.html,/위치 오차가 커서/);assert.match(env.html,/data-action="walk-nav-reroute" disabled/);assert.equal(env.sends.at(-1).visible,false);
    await env.action('walk-nav-reroute');assert.equal(env.reroutes.length,0);assert.equal(env.state.progress.progressMeters<40,true);
  }finally{env.cleanup();}
});

test('manual reroute rechecks fix age even when no new GPS callback has arrived',async()=>{
  const env=setup();try{
    await env.action('walk-nav-start');env.fix(point(30),0);env.setTime(20);await env.action('walk-nav-reroute');assert.equal(env.reroutes.length,0);assert.match(env.html,/최신 위치/);assert.match(env.html,/data-action="walk-nav-reroute" disabled/);
  }finally{env.cleanup();}
});

test('outside-region location removes the prior marker and blocks rerouting',async()=>{
  const env=setup();try{
    await env.action('walk-nav-start');env.fix(point(30),0);env.fix([130,40],10);assert.equal(env.state.progress,null);assert.match(env.html,/선택 지역 밖/);assert.equal(env.sends.at(-1).visible,false);await env.action('walk-nav-reroute');assert.equal(env.reroutes.length,0);
  }finally{env.cleanup();}
});

test('stopping a pending reroute aborts it and a late response cannot restart guidance',async()=>{
  let finish;const env=setup({reroute:async fix=>new Promise(resolve=>{finish=()=>resolve(makeRoute([fix.coordinate,point(200)]));})});try{
    await env.action('walk-nav-start');env.fix(point(30),0);const pending=env.action('walk-nav-reroute');assert.equal(env.state.status,'rerouting');assert.equal(env.reroutes.length,1);
    await env.action('walk-nav-stop');assert.equal(env.reroutes[0].options.signal.aborted,true);finish();await pending;
    assert.equal(env.state.status,'idle');assert.equal(env.state.watching,false);assert.equal(env.rerouted,0);assert.equal(env.sends.at(-1).visible,false);
  }finally{env.cleanup();}
});

test('arrival cancels an outstanding reroute and late completion cannot revert arrival to active',async()=>{
  let finish;const env=setup({reroute:async fix=>new Promise(resolve=>{finish=()=>resolve(makeRoute([fix.coordinate,point(200)]));})});try{
    await env.action('walk-nav-start');env.fix(point(150),0);const pending=env.action('walk-nav-reroute');env.fix(point(195),20);env.fix(point(198),24);
    assert.equal(env.state.status,'arrived');assert.equal(env.state.watching,false);assert.equal(env.reroutes[0].options.signal.aborted,true);finish();await pending;assert.equal(env.state.status,'arrived');assert.equal(env.rerouted,0);assert.ok(env.cleared.includes(1));
  }finally{env.cleanup();}
});

test('successful reroute applies the most recent accepted fix instead of rewinding to the request-time fix',async()=>{
  let finish;const env=setup({reroute:async fix=>new Promise(resolve=>{finish=()=>resolve(makeRoute([fix.coordinate,point(200)]));})});try{
    await env.action('walk-nav-start');env.fix(point(20),0);const pending=env.action('walk-nav-reroute');env.fix(point(40),10);finish();await pending;
    assert.equal(env.state.status,'active');assert.equal(env.rerouted,1);assert.equal(env.state.progress.accepted,true);assert.ok(env.state.progress.progressMeters>19);const marker=env.sends.at(-1).features.find(f=>f.geometry.type==='Point');assert.ok(walkDistance(marker.geometry.coordinates,point(40))<.1);
  }finally{env.cleanup();}
});

test('a disconnected reroute is rejected without corrupting the previous usable route',async()=>{
  const invalid={...makeRoute(),geojson:{type:'FeatureCollection',features:[line([point(),point(50)]),line([point(150),point(200)])]}},env=setup({reroute:async()=>invalid});try{
    await env.action('walk-nav-start');env.fix(point(30),0);await env.action('walk-nav-reroute');assert.equal(env.state.status,'reroute-error');assert.match(env.html,/연결이 확인되지 않은 구간/);
    env.fix(point(40),10);assert.equal(env.state.progress.accepted,true);assert.equal(env.state.progress.status,'tracking');assert.ok(env.state.progress.progressMeters>39);assert.equal(env.rerouted,0);
  }finally{env.cleanup();}
});

test('hiding the page after a reroute failure stops GPS and releases the navigation layout',async()=>{
  const env=setup({reroute:async()=>{throw Error('제공기관 연결 실패');}});try{
    await env.action('walk-nav-start');env.fix(point(30),0);await env.action('walk-nav-reroute');assert.equal(env.state.status,'reroute-error');assert.equal(env.state.watching,true);
    env.hide();assert.equal(env.state.status,'paused');assert.equal(env.state.watching,false);assert.ok(env.cleared.includes(1));assert.equal(env.modes.at(-1),false);assert.equal(env.sends.at(-1).visible,false);
  }finally{env.cleanup();}
});

test('sustained off-route evidence starts one automatic reroute and the pending request is never duplicated',async()=>{
  let finish;const env=setup({reroute:async fix=>new Promise(resolve=>{finish=()=>resolve(makeRoute([fix.coordinate,point(200)]));})});try{
    await env.action('walk-nav-start');env.fix(point(30,100),0);env.fix(point(30,100),3);assert.equal(env.reroutes.length,0);env.fix(point(30,100),7);assert.equal(env.reroutes.length,1);assert.equal(env.state.status,'rerouting');env.fix(point(30,100),10);assert.equal(env.reroutes.length,1);
    await env.action('walk-nav-stop');finish();await flush();assert.equal(env.state.status,'idle');
  }finally{env.cleanup();}
});

test('manual reroute drops only confidently passed stops and preserves upcoming ones',async()=>{
  const stops=[{id:'passed',coordinate:point(20)},{id:'upcoming',coordinate:point(150)}],env=setup({stops});try{
    await env.action('walk-nav-start');env.fix(point(80),0);await env.action('walk-nav-reroute');assert.deepEqual(env.reroutes[0].options.viaIds,['upcoming']);
  }finally{env.cleanup();}
});

test('manual map interaction turns off camera following, while restoring follow uses the accepted current location',async()=>{
  const env=setup();try{
    await env.action('walk-nav-start');env.fix(point(20),0);const before=env.follows.length;env.controller.onEvent({type:'interaction'});env.fix(point(30),10);assert.equal(env.follows.length,before);assert.match(env.html,/현재 위치로 보기/);
    await env.action('walk-nav-follow');assert.equal(env.follows.length,before+1);assert.deepEqual(env.follows.at(-1).coordinate,point(30));
  }finally{env.cleanup();}
});

test('voice is opt-in and stop cancels speech; destroy unregisters actions and rejects late callbacks',async()=>{
  const env=setup();try{
    await env.action('walk-nav-start');env.fix(point(150),0);assert.equal(env.spoken.length,0);await env.action('walk-nav-voice');assert.equal(env.spoken.length,1);assert.equal(env.spoken[0].lang,'ko-KR');
    const cancelled=env.cancelled;env.controller.destroy();assert.ok(env.cancelled>cancelled);const count=env.sends.length;env.fix(point(170),10,5,1);assert.equal(env.sends.length,count);assert.equal(await env.action('walk-nav-start'),false);assert.equal(env.state.watching,false);
  }finally{env.cleanup();}
});

test('a missing first location times out and cleans up the watch',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const env=setup();try{
    await env.action('walk-nav-start');assert.equal(env.state.status,'requesting');t.mock.timers.tick(30000);assert.equal(env.state.status,'error');assert.equal(env.state.watching,false);assert.ok(env.cleared.includes(1));assert.match(env.html,/위치를 확인하지 못해/);
  }finally{env.cleanup();t.mock.timers.reset();}
});

test('the complete route panel resets GPS when endpoints change and suspends it on a service switch',async()=>{
  const setup=setupRoutes(),{env,ui}=setup;try{
    await env.action('walk-routes');await env.action('walk-calculate');assert.match(setup.html,/전체 회전 안내/);await env.action('walk-nav-start');env.fix(point(30),0);assert.equal(env.watches.size,1);
    setup.change('walk-end-choice','b');assert.ok(env.cleared.includes(1));assert.equal(env.sends.filter(m=>m.id==='walk-position').at(-1).visible,false);
    await env.action('walk-calculate');await env.action('walk-nav-start');env.fix(point(40),10);assert.equal(env.watches.size,2);ui.suspend();assert.ok(env.cleared.includes(2));assert.equal(env.sends.filter(m=>m.id==='walk-position').at(-1).visible,false);const before=env.sends.length;env.fix(point(60),20,5,2);assert.equal(env.sends.length,before);
  }finally{setup.cleanup();}
});

test('closing the complete route panel stops GPS without discarding the comparison result',async()=>{
  const setup=setupRoutes(),{env,ui}=setup;try{
    await env.action('walk-routes');await env.action('walk-calculate');await env.action('walk-nav-start');env.fix(point(30),0);const clearCount=setup.clears;
    ui.panelClosed();assert.ok(env.cleared.includes(1));assert.equal(setup.clears,clearCount);await env.action('walk-routes');assert.match(setup.html,/도보경로 비교/);assert.match(setup.html,/길안내 시작/);
  }finally{setup.cleanup();}
});

test('expired route results stop the full panel GPS watch before another navigation can continue',async()=>{
  const setup=setupRoutes(),{env}=setup;try{
    await env.action('walk-routes');await env.action('walk-calculate');await env.action('walk-nav-start');env.fix(point(30),0);
    env.setTime(31*60);await env.action('walk-routes');assert.ok(env.cleared.includes(1));assert.equal(env.sends.filter(m=>m.id==='walk-position').at(-1).visible,false);assert.match(setup.html,/표시 시간이 끝났어요/);assert.doesNotMatch(setup.html,/walking-navigation/);
  }finally{setup.cleanup();}
});

test('choosing another route stops GPS and prepares the new provider instruction list before restarting',async()=>{
  const setup=setupRoutes(),{env}=setup;try{
    await env.action('walk-routes');await env.action('walk-calculate');await env.action('walk-nav-start');env.fix(point(30),0);
    await env.action('walk-select-route',{id:'alternative'});assert.ok(env.cleared.includes(1));assert.match(setup.html,/전체 회전 안내/);assert.match(setup.html,/대안 경로 도착/);
  }finally{setup.cleanup();}
});
