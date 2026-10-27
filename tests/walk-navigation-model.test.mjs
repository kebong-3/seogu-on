import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWalkNavigation,createWalkNavigationState,updateWalkNavigation,projectWalkPosition,WALK_NAVIGATION_DEFAULTS} from '../shared/walk-navigation-model.js';
import {walkDistance} from '../shared/walk-route-model.js';

const BASE=Date.parse('2026-10-28T00:00:00Z'),origin=[126.85,35.15],R=6371008.8;
const point=(east=0,north=0)=>[origin[0]+east/(R*Math.cos(origin[1]*Math.PI/180))*180/Math.PI,origin[1]+north/R*180/Math.PI];
const line=(coordinates,properties={})=>({type:'Feature',geometry:{type:'LineString',coordinates},properties});
const instruction=(coordinate,description,pointIndex,turnType=12,index)=>({type:'Feature',geometry:{type:'Point',coordinates:coordinate},properties:{description,pointIndex,turnType,...(index===undefined?{}:{index})}});
const route=(features,extra={})=>({id:'direct',distanceMeters:999,durationSeconds:600,geojson:{type:'FeatureCollection',features},...extra});
const near=(actual,expected,tolerance=.1)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should be near ${expected} ± ${tolerance}`);
const straight=(length=200,options)=>buildWalkNavigation(route([line([point(),point(length)])]),options);
function session(index){let state=createWalkNavigationState(index);return {get state(){return state},fix(coordinate,seconds,accuracy=5,options={}){const result=updateWalkNavigation(index,state,{coordinate,accuracy,timestamp:BASE+seconds*1000},{now:BASE+seconds*1000,...options});state=result.state;return result;},read(fix,now){const result=updateWalkNavigation(index,state,fix,{now});state=result.state;return result;}};}

test('build preserves TMAP point instructions and metadata in provider order, without mutating the payload',()=>{
  const a=point(),b=point(100),c=point(100,100),description='<img src=x onerror=alert(1)> 횡단보도에서 좌회전하세요.';
  const input=route([instruction(c,'목적지에 도착합니다.',2,201,4),line([b,c],{index:3,lineIndex:1}),instruction(a,'출발하세요.',0,200,0),instruction(b,description,1,12,2),line([a,b],{index:1,lineIndex:0})]);
  const before=JSON.stringify(input),index=buildWalkNavigation(input);
  near(index.totalMeters,200);assert.equal(index.providerDistanceMeters,999);assert.equal(index.continuous,true);assert.equal(index.segments.length,2);
  assert.deepEqual(index.steps.map(s=>s.pointIndex),[0,1,2]);assert.equal(index.steps[1].description,description);assert.equal(index.steps[1].instruction,description);assert.equal(index.steps[1].turnType,12);near(index.steps[1].progressMeters,100);assert.equal(index.steps[1].source,'provider');assert.equal(index.steps[2].isDestination,true);assert.equal(JSON.stringify(input),before);
});

test('line-only routes get readable start/end fallback instructions, without invented turns',()=>{
  const index=straight();assert.equal(index.instructionsAvailable,false);assert.equal(index.steps.length,2);
  assert.deepEqual(index.steps.map(s=>s.coordinate),[index.start,index.end]);assert.ok(index.steps.every(s=>s.source==='fallback'&&s.turnType===null&&s.instruction));
  const tracking=session(index),reading=tracking.fix(point(50),0);near(reading.progressMeters,50);near(reading.remainingMeters,150);near(reading.bearing,90,.1);assert.equal(reading.nextStepIndex,1);assert.equal(reading.nextInstruction,index.steps[1].instruction);near(reading.nextTurnDistanceMeters,150);
});

test('projection gives actual nearest distance, progress and heading on bends',()=>{
  const index=buildWalkNavigation(route([line([point(),point(100),point(100,100)])]));
  const projection=projectWalkPosition(index,point(110,60));near(projection.distanceMeters,10,.1);near(projection.progressMeters,160,.1);near(projection.bearing,0,.1);near(walkDistance(projection.coordinate,point(100,60)),0,.1);
  assert.equal(projectWalkPosition(index,[NaN,35]),null);assert.equal(projectWalkPosition(index,[126,35],{progressMeters:NaN}),null);
});

test('disconnected lines never create an artificial bridge and navigation is held with an explicit reason',()=>{
  const index=buildWalkNavigation(route([line([point(),point(100)]),line([point(200),point(300)])]));
  assert.equal(index.continuous,false);assert.equal(index.segments.length,2);near(index.totalMeters,200);near(index.gaps[0].distanceMeters,100);
  const projection=projectWalkPosition(index,point(150));near(projection.distanceMeters,50);assert.ok([100,200].some(x=>walkDistance(projection.coordinate,point(x))<.1));
  const reading=session(index).fix(point(300),0);assert.equal(reading.accepted,false);assert.equal(reading.status,'route-gap');assert.equal(reading.arrived,false);assert.equal(reading.shouldReroute,false);assert.match(reading.message,/이어지지 않아/);
});

test('sub-metre rounding gaps are tolerated without adding their distance or a segment',()=>{
  const index=buildWalkNavigation(route([{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[point(),point(100)],[point(100.5),point(200.5)]]},properties:{}}]));
  assert.equal(index.continuous,true);near(index.totalMeters,200);assert.equal(index.segments.length,2);assert.equal(index.gaps.length,0);
});

test('invalid, empty and oversized geometry cannot be used as a navigation route',()=>{
  for(const input of [null,route([]),route([line([point(),[NaN,35]])]),route([line([point(),point()])]),route([line([[0,0],[10,0]])])])assert.throws(()=>buildWalkNavigation(input),{code:'INVALID_WALK_NAVIGATION_ROUTE'});
  assert.throws(()=>straight(200,{destination:[1,NaN]}),{code:'INVALID_WALK_NAVIGATION_ROUTE'});
});

test('normal motion is monotonic, small backward jitter does not rewind guidance, duplicate times cannot add evidence',()=>{
  const tracking=session(straight());tracking.fix(point(),0);const forward=tracking.fix(point(30),10),back=tracking.fix(point(28),13),repeat=tracking.fix(point(28),16);
  near(forward.progressMeters,30);near(back.progressMeters,30);near(repeat.progressMeters,30);assert.equal(back.wrongWay,false);assert.equal(repeat.duplicatePosition,true);
  const prior=tracking.state,copy=structuredClone(prior),duplicate=tracking.fix(point(28),16);assert.equal(duplicate.accepted,false);assert.equal(duplicate.reason,'duplicate-fix');assert.deepEqual(tracking.state,copy);assert.deepEqual(prior,copy);
});

test('poor, stale, future, malformed and out-of-order GPS readings cannot move progress or evidence counters',()=>{
  const index=straight(),tracking=session(index);tracking.fix(point(30),20);const before=tracking.state;
  const examples=[
    [{coordinate:point(190),accuracy:80,timestamp:BASE+21000},BASE+21000,'poor-accuracy'],
    [{coordinate:point(190),accuracy:5,timestamp:BASE+21000},BASE+40000,'stale-location'],
    [{coordinate:point(190),accuracy:5,timestamp:BASE+50000},BASE+21000,'future-location'],
    [{coordinate:[NaN,35],accuracy:5,timestamp:BASE+21000},BASE+21000,'invalid-location'],
    [{coordinate:point(190),accuracy:null,timestamp:BASE+21000},BASE+21000,'invalid-accuracy'],
    [{coordinate:point(190),accuracy:5,timestamp:BASE+19000},BASE+21000,'out-of-order'],
  ];
  for(const [fix,now,reason]of examples){const output=updateWalkNavigation(index,before,fix,{now});assert.equal(output.accepted,false);assert.equal(output.reason,reason);assert.equal(output.shouldReroute,false);assert.equal(output.arrived,false);for(const key of ['progressMeters','lastTimestamp','offRouteSamples','arrivalSamples','backwardSamples'])assert.equal(output.state[key],before[key]);}
});

test('a sudden physically implausible GPS jump is rejected before progress, turns or arrival can change',()=>{
  const tracking=session(straight());tracking.fix(point(),0);const before=tracking.state,reading=tracking.fix(point(199),1);
  assert.equal(reading.reason,'implausible-jump');assert.equal(reading.accepted,false);assert.equal(reading.state.lastTimestamp,before.lastTimestamp);assert.equal(reading.progressMeters,0);assert.equal(reading.arrived,false);
});

test('self-intersections and near-start destinations do not jump to a later route section or declare arrival',()=>{
  const index=buildWalkNavigation(route([line([point(),point(100),point(100,100),point(50,100),point(50)])]));
  const at=projectWalkPosition(index,point(50));assert.equal(at.ambiguous,true);assert.ok(at.alternatives.some(p=>p.progressMeters>300));near(at.progressMeters,50);
  const hinted=projectWalkPosition(index,point(50),{progressMeters:index.totalMeters});near(hinted.progressMeters,index.totalMeters);
  const tracking=session(index);tracking.fix(point(45),0);const middle=tracking.fix(point(50),5);near(middle.progressMeters,50);assert.ok(middle.remainingMeters>250);assert.equal(middle.arrived,false);assert.equal(tracking.fix(point(50),10).arrived,false);
});

test('provider point ordering disambiguates instructions when a route visits the same coordinate twice',()=>{
  const a=point(),b=point(100),c=point(100,100),d=point(0,100),input=route([
    instruction(a,'출발 안내',0,200,0),line([a,b,c,d,a],{index:1}),instruction(a,'한 바퀴 돌아 도착',1,201,2),
  ]),index=buildWalkNavigation(input);
  assert.equal(index.steps[0].progressMeters,0);const finish=index.steps.find(step=>step.description==='한 바퀴 돌아 도착');near(finish.progressMeters,index.totalMeters);
});

test('a complete loop advances through each leg and reaches its shared start/end only after the full walk',()=>{
  const a=point(),b=point(100),c=point(100,100),d=point(0,100),index=buildWalkNavigation(route([
    instruction(a,'동쪽으로 출발',0,200,0),line([a,b],{index:1}),instruction(b,'북쪽으로 좌회전',1,12,2),line([b,c],{index:3}),instruction(c,'서쪽으로 좌회전',2,12,4),line([c,d],{index:5}),instruction(d,'남쪽으로 좌회전',3,12,6),line([d,a],{index:7}),instruction(a,'목적지 도착',4,201,8),
  ])),tracking=session(index);
  let previous=0,reading=tracking.fix(a,0,3),seconds=0;
  for(const coordinates of [Array.from({length:10},(_,i)=>point((i+1)*10)),Array.from({length:10},(_,i)=>point(100,(i+1)*10)),Array.from({length:10},(_,i)=>point(100-(i+1)*10,100)),Array.from({length:10},(_,i)=>point(0,100-(i+1)*10))])for(const coordinate of coordinates){
    seconds+=8;reading=tracking.fix(coordinate,seconds,3);assert.equal(reading.accepted,true);assert.ok(reading.progressMeters>=previous);previous=reading.progressMeters;
    if(reading.progressMeters<index.totalMeters-15)assert.equal(reading.arrived,false);
  }
  near(reading.progressMeters,index.totalMeters,.1);assert.equal(reading.arrived,true);assert.equal(reading.nextInstruction,'목적지 도착');
});

test('a planned out-and-back visit on the same road proceeds onto the return segment without a wrong-way warning',()=>{
  const index=buildWalkNavigation(route([line([point(),point(100),point()])])),tracking=session(index);let reading;
  const path=[0,20,40,60,80,100,80,60,40,20,0];
  for(const [i,east]of path.entries()){
    reading=tracking.fix(point(east),i*8,3);assert.equal(reading.accepted,true);assert.equal(reading.wrongWay,false);near(reading.progressMeters,i*20,.1);
    if(i<10)assert.equal(reading.arrived,false);
  }
  const end=tracking.fix(point(),84,3);assert.equal(end.arrived,true);near(end.remainingMeters,0);
});

test('one off-route spike is insufficient; repeated well-spaced reliable fixes trigger only after duration and sample thresholds',()=>{
  const tracking=session(straight());tracking.fix(point(30),0);const one=tracking.fix(point(30,100),30);assert.equal(one.offRoute,false);assert.equal(one.state.offRouteSamples,1);
  const tooSoon=tracking.fix(point(30,100),30.5);assert.equal(tooSoon.state.offRouteSamples,1);assert.equal(tooSoon.shouldReroute,false);
  tracking.fix(point(30,100),33);const confirmed=tracking.fix(point(30,100),37);assert.equal(confirmed.offRoute,true);assert.equal(confirmed.shouldReroute,true);assert.equal(confirmed.status,'off-route');near(confirmed.progressMeters,30);assert.equal(confirmed.arrived,false);
});

test('off-route cooldown suppresses repeated reroutes while reliable evidence continues',()=>{
  const tracking=session(straight());tracking.fix(point(30,100),0);tracking.fix(point(30,100),3);assert.equal(tracking.fix(point(30,100),7).shouldReroute,true);
  for(const at of [15,23,31,39,47,55,63])assert.equal(tracking.fix(point(30,100),at).shouldReroute,false);
  assert.equal(tracking.fix(point(30,100),67).shouldReroute,true);assert.equal(tracking.fix(point(30,100),70).shouldReroute,false);
});

test('unreliable GPS does not increment evidence and interrupts the next off-route evidence run',()=>{
  const tracking=session(straight());tracking.fix(point(30,100),0);tracking.fix(point(30,100),3);const before=tracking.state;
  const poor=tracking.fix(point(30,100),5,100);assert.equal(poor.accepted,false);assert.equal(poor.state.offRouteSamples,before.offRouteSamples);
  const next=tracking.fix(point(30,100),8);assert.equal(next.state.offRouteSamples,1);assert.equal(next.offRoute,false);assert.equal(next.shouldReroute,false);
});

test('uncertain accuracy overlap cannot advance progress or classify the user as off-route',()=>{
  const tracking=session(straight());tracking.fix(point(30),0);const before=tracking.state,uncertain=tracking.fix(point(80,60),30,40);
  assert.equal(uncertain.accepted,false);assert.equal(uncertain.reason,'uncertain-route-position');assert.equal(uncertain.progressMeters,before.progressMeters);assert.equal(uncertain.state.offRouteSamples,before.offRouteSamples);assert.equal(uncertain.state.arrivalSamples,before.arrivalSamples);assert.equal(uncertain.shouldReroute,false);
});

test('sustained backtracking produces a direction warning and honest remaining distance while short jitter does not',()=>{
  const tracking=session(straight());tracking.fix(point(140),0);tracking.fix(point(110),10);tracking.fix(point(100),14);const back=tracking.fix(point(90),18);
  assert.equal(back.wrongWay,true);assert.equal(back.status,'wrong-way');near(back.progressMeters,140);near(back.positionProgressMeters,90);near(back.remainingMeters,110);assert.equal(back.shouldReroute,false);
  const resume=tracking.fix(point(135),30);assert.equal(resume.wrongWay,false);near(resume.progressMeters,140);
});

test('arrival requires endpoint proximity, little remaining route, precise GPS and multiple spaced fixes',()=>{
  const tracking=session(straight());tracking.fix(point(150),0);const first=tracking.fix(point(195),20);assert.equal(first.arrived,false);assert.equal(first.state.arrivalSamples,1);
  assert.equal(tracking.fix(point(195),21).arrived,false);const arrived=tracking.fix(point(198),24);assert.equal(arrived.arrived,true);assert.equal(arrived.justArrived,true);assert.equal(arrived.status,'arrived');assert.equal(arrived.shouldReroute,false);
  assert.equal(tracking.fix(point(198),28).justArrived,false);
});

test('near-end fixes with insufficient arrival accuracy cannot declare arrival',()=>{
  const tracking=session(straight());tracking.fix(point(195),0,20);tracking.fix(point(199),4,20);const reading=tracking.fix(point(200),8,20);
  assert.equal(reading.accepted,true);assert.equal(reading.arrived,false);assert.equal(reading.state.arrivalSamples,0);
});

test('an accuracy interruption restarts arrival confirmation instead of completing old evidence',()=>{
  const tracking=session(straight());const first=tracking.fix(point(198),0);assert.equal(first.state.arrivalSamples,1);
  const invalid=tracking.fix(point(198),3,100);assert.equal(invalid.state.arrivalSamples,1);assert.equal(invalid.arrived,false);
  const next=tracking.fix(point(198),5);assert.equal(next.state.arrivalSamples,1);assert.equal(next.arrived,false);assert.equal(tracking.fix(point(198),9).arrived,true);
});

test('actual destination far from the provider endpoint prevents automatic arrival even at the line end',()=>{
  const index=straight(200,{destination:point(250)}),tracking=session(index);assert.equal(index.destinationMatchesRoute,false);near(index.destinationOffsetMeters,50);assert.match(index.warnings.join(' '),/자동 도착 판정/);
  tracking.fix(point(200),0);tracking.fix(point(200),4);assert.equal(tracking.fix(point(200),8).arrived,false);
});

test('small endpoint snap offsets use the actual selected destination for arrival radius',()=>{
  const index=straight(200,{destination:point(220)}),tracking=session(index);assert.equal(index.destinationMatchesRoute,true);
  tracking.fix(point(200),0);assert.equal(tracking.fix(point(200),4).arrived,false,'20m offset + 5m accuracy exceeds arrival radius');
  tracking.fix(point(215),10);const arrived=tracking.fix(point(218),14);assert.equal(arrived.arrived,true);assert.ok(arrived.destinationDistanceMeters<3);
});

test('browser GeolocationPosition works and caller-owned objects remain unchanged',()=>{
  const index=straight(),state=createWalkNavigationState(index),position={coords:{longitude:point(30)[0],latitude:point(30)[1],accuracy:5,heading:90},timestamp:BASE};
  const before=JSON.stringify({index,state,position});const reading=updateWalkNavigation(index,state,position,{now:BASE});assert.equal(reading.accepted,true);near(reading.progressMeters,30);assert.equal(JSON.stringify({index,state,position}),before);
});

test('route replacement resets progress but keeps the cross-route reroute cooldown',()=>{
  const old=straight(),state={...createWalkNavigationState(old),progressMeters:190,lastRerouteAt:BASE},replacement=straight(300);
  const reading=updateWalkNavigation(replacement,state,{coordinate:point(),accuracy:5,timestamp:BASE+1000},{now:BASE+1000});assert.equal(reading.progressMeters,0);assert.equal(reading.state.lastRerouteAt,BASE);assert.equal(reading.state.routeKey,replacement.key);
});

test('invalid thresholds cannot silently disable evidence requirements',()=>{
  const index=straight(),state=createWalkNavigationState(index),fix={coordinate:point(),accuracy:5,timestamp:BASE};
  for(const options of [{maxAccuracyMeters:NaN},{offRouteSamples:1},{arrivalSamples:0},{backwardSamples:1.5},{now:Infinity}])assert.throws(()=>updateWalkNavigation(index,state,fix,{now:BASE,...options}),TypeError);
  assert.ok(Object.isFrozen(WALK_NAVIGATION_DEFAULTS));
});
