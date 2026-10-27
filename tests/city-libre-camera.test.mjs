import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibreCameraDirector,bindLibreCameraInputs,LibreView,pointSelectionScope} from '../src/city/viewer.js';

function setup(reduced=false){
  let pose={center:[126.85,35.14],zoom:14,bearing:320,pitch:46},next=0;const tasks=new Map(),events=[];
  const map={getCenter:()=>({lng:pose.center[0],lat:pose.center[1]}),getZoom:()=>pose.zoom,getBearing:()=>pose.bearing,getPitch:()=>pose.pitch,jumpTo:value=>{pose={...pose,...value};},stop(){},remove(){},getCanvas:()=>({removeEventListener(){}})};
  const director=createLibreCameraDirector(map,event=>events.push(event),{request:cb=>{tasks.set(++next,cb);return next},cancel:id=>tasks.delete(id),reduced:()=>reduced});
  const view=Object.assign(Object.create(LibreView.prototype),{ready:true,destroyed:false,map,director,queue:[]});
  return {map,director,view,tasks,events,get pose(){return pose},tick(at){const entry=tasks.entries().next().value;assert.ok(entry,'animation frame exists');tasks.delete(entry[0]);entry[1](at);}};
}
test('Libre camera completes the selected flight before orbiting and the orbit button toggles it off',()=>{
  const env=setup();env.view.send({type:'camera',pose:{center:[126.88,35.15],range:1000,heading:40,pitch:-44},duration:100,orbitAfter:true});
  assert.equal(env.director.orbiting,false);env.tick(0);env.tick(100);assert.equal(env.director.orbiting,true);assert.deepEqual(env.pose.center,[126.88,35.15]);assert.equal(env.pose.zoom,15);assert.equal(env.pose.pitch,46);
  env.tick(200);env.tick(1200);assert.equal(env.pose.bearing%360,44);env.view.send({type:'orbit'});assert.equal(env.director.orbiting,false);assert.equal(env.tasks.size,0);
});
test('Libre stop and replacement flights cancel old motion; reduced motion never auto orbits',()=>{
  const env=setup();env.view.send({type:'orbit'});assert.equal(env.director.orbiting,true);env.view.send({type:'stop'});assert.equal(env.tasks.size,0);
  env.view.send({type:'camera',pose:{center:[126.88,35.15],range:500,heading:50,pitch:-40},duration:0,orbitAfter:true});assert.equal(env.director.orbiting,true);
  env.view.send({type:'camera',pose:{center:[126.89,35.16],range:500,heading:80,pitch:-40},duration:0});assert.equal(env.director.orbiting,false);assert.equal(env.tasks.size,0);assert.deepEqual(env.pose.center,[126.89,35.16]);
  const reduced=setup(true);reduced.view.send({type:'camera',pose:{center:[126.88,35.15],range:500,heading:50,pitch:-40},orbitAfter:true});assert.equal(reduced.tasks.size,0);assert.equal(reduced.director.orbiting,false);
});
test('Libre destroy cancels animation and future camera messages cannot restart it',()=>{
  const env=setup();env.view.send({type:'orbit'});env.view.destroy();assert.equal(env.tasks.size,0);env.view.send({type:'orbit'});assert.equal(env.tasks.size,0);
});
test('manual pointer, wheel, touch and keyboard input stop orbit and listeners can be released',()=>{
  const env=setup(),listeners=new Map();env.map.getCanvas=()=>({addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)});
  const release=bindLibreCameraInputs(env.map,env.director);
  for(const type of ['pointerdown','wheel','touchstart','keydown']){env.view.send({type:'orbit'});assert.equal(env.director.orbiting,true);listeners.get(type)();assert.equal(env.director.orbiting,false);assert.equal(env.tasks.size,0);}
  release();assert.equal(listeners.size,0);
});
test('only walking endpoints use the district boundary while administrative tools retain selected scope',()=>{
  const bounds={district:{type:'Polygon',id:'whole-district'},scope:{type:'Polygon',id:'selected-dong'}};
  for(const tool of ['walk-start','walk-end'])assert.equal(pointSelectionScope(tool,bounds),bounds.district);
  for(const tool of ['inspect','decision-site','operation-point','operation-route','flood-point'])assert.equal(pointSelectionScope(tool,bounds),bounds.scope);
  assert.equal(pointSelectionScope('walk-start',{scope:bounds.scope}),bounds.scope);
});
