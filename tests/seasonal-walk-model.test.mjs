import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSeasonalWalkRoutes,classifyWinterSunMinutes} from '../shared/seasonal-walk-model.js';
import {walkDistance,rankWalkCandidates,walkCandidateSupportsMode} from '../shared/walk-route-model.js';

const origin=[127,35],xy=(x,y)=>[origin[0]+x/(111320*Math.cos(origin[1]*Math.PI/180)),origin[1]+y/111320];
const fc=(features=[],metadata={})=>({type:'FeatureCollection',features,metadata});
const rectangle=(minX,minY,maxX,maxY)=>({type:'Polygon',coordinates:[[xy(minX,minY),xy(maxX,minY),xy(maxX,maxY),xy(minX,maxY),xy(minX,minY)]]});
const building=(id,geometry,height=10,basis='tagged')=>({type:'Feature',geometry,properties:{id,height,heightBasis:basis}});
const route=(id,meters,role='direct',durationSeconds)=>{const coordinates=meters.map(p=>xy(...p)),length=coordinates.slice(1).reduce((sum,p,i)=>sum+walkDistance(coordinates[i],p),0);return {id,role,distanceMeters:length,durationSeconds:durationSeconds||length/1.3,geojson:fc([{type:'Feature',geometry:{type:'LineString',coordinates},properties:{}}])};};
const day={altitude:45,azimuth:180};
const base=(routes,extra={})=>({routes,mode:'summer',departureAt:'2027-07-15T14:00:00+09:00',shadowTiming:'departure-static',buildings:fc(),coverageGeometry:rectangle(-1000,-1000,1000,1000),icing:fc([],{complete:true}),maxDetourMeters:500,maxDetourMinutes:5,...extra});
const evaluate=(input,extra={})=>evaluateSeasonalWalkRoutes(input,{sunAt:()=>day,...extra});
const close=(value,expected,tolerance=.15)=>assert.ok(Math.abs(value-expected)<tolerance,`${value} should be near ${expected}`);

test('vertical prism shade follows solar azimuth and preserves geometry-distance weighting, including a short final sample',()=>{
  const r=route('direct',[[0,15],[105,15]]);r.distanceMeters=120;
  const result=evaluate(base([r],{buildings:fc([building('south',rectangle(-10,0,115,10))])})),assessment=result.routes[0];
  close(assessment.estimatedShadeMeters,walkDistance(xy(0,15),xy(105,15)));
  close(assessment.estimatedShadeMeters+assessment.sunlitMeters+assessment.unevaluatedMeters,assessment.routeLengthMeters,.03);
  assert.equal(assessment.providerDistanceMeters,120);
  assert.ok(assessment.samples.at(-1).lengthMeters<5);
  const reverse=evaluate(base([r],{buildings:fc([building('south',rectangle(-10,0,115,10))])}),{sunAt:()=>({altitude:45,azimuth:0})});
  close(reverse.routes[0].sunlitMeters,assessment.routeLengthMeters);
});

test('unknown and display-only heights do not become sunshine; explicit levels option is separated from source heights',()=>{
  const r=route('direct',[[-5,15],[5,15]]),shape=rectangle(-10,0,10,10);
  for(const basis of ['display-only','unknown','levels-estimate']){
    const a=evaluate(base([r],{buildings:fc([building('unknown',shape,10,basis)])})).routes[0];
    assert.equal(a.sunlitMeters,0);assert.equal(a.estimatedShadeMeters,0);close(a.unevaluatedMeters,a.routeLengthMeters);
    assert.ok(a.reasons.includes('unknown-height-toward-sun'));
  }
  const yes=evaluate(base([r],{includeLevels:true,buildings:fc([building('estimate',shape,10,'levels-estimate')])})).routes[0];
  close(yes.estimatedHeightShadeMeters,yes.routeLengthMeters);
  close(yes.evaluatedMeters,yes.routeLengthMeters);
});

test('known occlusion remains modeled shade with incomplete coverage, while non-shade remains genuinely unknown',()=>{
  const shaded=route('direct',[[-5,15],[5,15]]),sunny=route('other',[[-5,30],[5,30]],'via');
  const result=evaluate(base([shaded,sunny],{coverageGeometry:null,buildings:fc([building('unknown',rectangle(-5,18,5,20),6,'display-only'),building('known',rectangle(-10,0,10,10),50)])}));
  close(result.routes[0].estimatedShadeMeters,result.routes[0].routeLengthMeters);
  assert.equal(result.comparison.preferredRouteId,null);assert.equal(result.comparison.reason,'coverage-not-declared');
  const noKnown=evaluate(base([sunny],{coverageGeometry:null})).routes[0];
  assert.equal(noKnown.sunlitMeters,0);close(noKnown.modelNonShadeMeters,noKnown.routeLengthMeters);close(noKnown.unevaluatedMeters,noKnown.routeLengthMeters);
});

test('coverage must include the solar screening ray and footprint interiors are not treated as walkable shaded road',()=>{
  const r=route('direct',[[-5,15],[5,15]]);
  const narrow=evaluate(base([r],{coverageGeometry:rectangle(-10,10,10,20)})).routes[0];
  assert.ok(narrow.reasons.includes('shadow-search-outside-coverage'));assert.equal(narrow.sunlitMeters,0);
  const inside=evaluate(base([route('inside',[[-5,5],[5,5]])],{buildings:fc([building('interior',rectangle(-10,0,10,10))])})).routes[0];
  assert.equal(inside.estimatedShadeMeters,0);assert.ok(inside.reasons.includes('inside-building-footprint'));
  const courtyard=rectangle(-10,0,10,20);courtyard.coordinates.push([xy(-5,5),xy(-5,15),xy(5,15),xy(5,5),xy(-5,5)]);
  const hole=evaluate(base([route('hole',[[-1,10],[1,10]])],{buildings:fc([building('courtyard',courtyard,10)])})).routes[0];
  close(hole.estimatedShadeMeters,hole.routeLengthMeters);assert.ok(!hole.reasons.includes('inside-building-footprint'));
});

test('walking-time evaluation recomputes solar direction along the same provider geometry',()=>{
  const r=route('direct',[[0,15],[100,15]],'direct',600),data=base([r],{buildings:fc([building('shade',rectangle(-10,0,110,10))])}),departure=+new Date(data.departureAt),sunAt=date=>({altitude:45,azimuth:+date<departure+300000?180:0});
  const fixed=evaluate(data,{sunAt}).routes[0],moving=evaluate({...data,shadowTiming:'walk-time'},{sunAt}).routes[0];
  close(fixed.estimatedShadeMeters,fixed.routeLengthMeters);assert.ok(moving.estimatedShadeMeters>0&&moving.sunlitMeters>0);
  assert.ok(moving.estimatedShadeMeters<fixed.estimatedShadeMeters);
  assert.notEqual(moving.samples[0].at,moving.samples.at(-1).at);
});

test('night, low solar altitude, missing departure and impossible dates are unassessed rather than zero exposure',()=>{
  const input=base([route('direct',[[0,0],[100,0]])]);
  for(const altitude of [-5,4]){
    const result=evaluate(input,{sunAt:()=>({altitude,azimuth:180})}),a=result.routes[0];
    assert.equal(a.status,'deferred');assert.equal(a.estimatedShadeMeters,null);assert.equal(a.sunlitMeters,null);close(a.unevaluatedMeters,a.routeLengthMeters);assert.equal(result.comparison.preferredRouteId,null);
    assert.equal(a.solarState,altitude<0?'night':'low-sun');
  }
  for(const departureAt of [null,'2027-07-15T14:00','2027-02-30T14:00+09:00']){
    const result=evaluate({...input,departureAt});assert.equal(result.status,'deferred');assert.equal(result.routes[0].estimatedShadeMeters,null);assert.equal(result.routes[0].unevaluatedMeters,input.routes[0].distanceMeters);
  }
});

test('winter sunlight interval handles threshold uncertainty and retains the Korean date and full seven-hour window',()=>{
  assert.equal(classifyWinterSunMinutes(60,60,120),'unknown');assert.equal(classifyWinterSunMinutes(60,59,120),'low');assert.equal(classifyWinterSunMinutes(120,300,120),'sufficient');
  const result=evaluate(base([route('direct',[[0,0],[100,0]])],{mode:'winter',departureAt:'2027-01-14T16:00:00Z'})),a=result.routes[0];
  assert.equal(a.winter.window.date,'2027-01-15');assert.equal(a.winter.window.times.length,7);assert.equal(a.winter.meanSunMinutesLower,420);assert.equal(a.winter.meanSunMinutesUpper,420);assert.equal(a.lowSunMeters,0);
  const unknown=evaluate(base([route('direct',[[0,0],[100,0]])],{mode:'winter',coverageGeometry:null})).routes[0];
  assert.equal(unknown.winter.meanSunMinutesUpper,420);assert.equal(unknown.winter.meanSunMinutesLower,0);close(unknown.winterUnevaluatedMeters,unknown.routeLengthMeters);
});

test('icing proximity uses the union of original point buffers, detects intermediate intersections and never invents a road segment',()=>{
  const managed=fc([50,60].map(x=>({type:'Feature',geometry:{type:'Point',coordinates:xy(x,0)},properties:{id:`record-${x}`}})));
  const a=evaluate(base([route('direct',[[0,0],[100,0]])],{mode:'winter',icing:managed,icingRadiusMeters:10})).routes[0];
  close(a.icingNearbyMeters,30);close(a.cautionMeters,30);assert.equal(a.lowSunMeters,0);assert.equal(a.unknownCautionMeters,0);
  const gap=fc([0,100].map(x=>({type:'Feature',geometry:{type:'Point',coordinates:xy(x,0)},properties:{id:`end-${x}`}})));
  const middle=evaluate(base([route('middle',[[45,0],[55,0]])],{mode:'winter',icing:gap,icingRadiusMeters:10})).routes[0];assert.equal(middle.icingNearbyMeters,0,'two management endpoints never become an invented connecting road');
  const missing=evaluate(base([route('direct',[[0,0],[100,0]])],{mode:'winter',icing:fc()})).routes[0];assert.equal(missing.icingNearbyMeters,null);close(missing.unknownCautionMeters,missing.routeLengthMeters);
});

test('route preference minimizes model sun exposure under both actual-provider detour limits',()=>{
  const direct=route('direct',[[-20,30],[120,30]]),via=route('via',[[-20,30],[0,15],[100,15],[120,30]],'via'),data=base([direct,via],{buildings:fc([building('shade',rectangle(-10,0,110,10))]),sampleMeters:5});
  const result=evaluate(data);assert.equal(result.comparison.preferredRouteId,'via');assert.ok(result.routes[1].sunlitMeters<result.routes[0].sunlitMeters);
  assert.notEqual(evaluate({...data,maxDetourMeters:0}).comparison.preferredRouteId,'via');
  assert.notEqual(evaluate({...data,maxDetourMinutes:0}).comparison.preferredRouteId,'via');
  assert.equal(evaluate({...data,maxDetourMeters:undefined}).comparison.preferredRouteId,null);
  assert.equal(evaluate({...data,routes:[via]}).comparison.preferredRouteId,null);
  assert.equal(evaluate({...data,coverageGeometry:null}).comparison.preferredRouteId,null);
});

test('resource limits and malformed source geometry defer all route assessments and preserve unknown lengths',()=>{
  const routes=[route('direct',[[0,0],[100,0]]),route('via',[[0,0],[110,0]],'via')],input=base(routes);
  for(const internal of [{maxSamples:1},{maxOperations:100},{runtimeMs:0,now:(()=>{let clock=0;return()=>++clock;})()}]){
    const result=evaluate(input,internal);assert.equal(result.status,'deferred');assert.equal(result.comparison.preferredRouteId,null);assert.ok(result.routes.every(r=>r.unevaluatedMeters>0&&r.estimatedShadeMeters===null));
  }
  const corrupt=evaluate({...input,buildings:fc([{type:'Feature',geometry:{type:'Point',coordinates:xy(0,0)},properties:{height:10,heightBasis:'tagged'}}])});assert.equal(corrupt.status,'deferred');assert.equal(corrupt.comparison.preferredRouteId,null);
});

test('disconnected provider line fragments are not bridged into fictional shade lengths',()=>{
  const r=route('direct',[[0,0],[100,0]]);r.geojson.features=[...route('a',[[0,0],[40,0]]).geojson.features,...route('b',[[60,0],[100,0]]).geojson.features];
  const result=evaluate(base([r]));assert.equal(result.routes[0].status,'deferred');assert.ok(result.routes[0].reasons.includes('SEASONAL_ROUTE_GAP'));assert.equal(result.comparison.preferredRouteId,null);
});

test('winter route candidates exclude childcare and indoor bells and prefer both sides within a declared straight detour budget',()=>{
  const start=xy(0,0),end=xy(100,0),candidate=(id,category,x,y)=>({id,name:id,category,coordinate:xy(x,y),routeEligible:true});
  const choices=[candidate('near-left','public',40,5.2),candidate('second-left','police',60,6),candidate('right','shelter',50,-12),candidate('private','childcare',50,-3),candidate('bell','bell',50,-4)];
  const ranked=rankWalkCandidates(choices,{start,end,mode:'winter',limit:2,maxDetourMeters:20});assert.deepEqual(new Set(ranked.map(r=>r.candidateSide)),new Set(['left','right']));assert.ok(ranked.every(r=>r.selectionBasis==='straight-line-side-diversity'));
  assert.equal(walkCandidateSupportsMode(choices[3],'winter'),false);assert.equal(walkCandidateSupportsMode(choices[4],'winter'),false);
  const limited=rankWalkCandidates(choices,{start,end,mode:'winter',limit:2,maxDetourMeters:1});assert.ok(limited.every(r=>r.straightDetourM<=1));
});
