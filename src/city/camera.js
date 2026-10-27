import {boundsOf,distance} from './geometry.js';
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const smooth=t=>t*t*(3-2*t);
export function headingDelta(a,b){return ((b-a+540)%360)-180;}
export function frameFor(geometry,level='dong',viewport={width:1200,height:800},heading=320) {
  const b=geometry.type==='Point'?[...geometry.coordinates.slice(0,2),...geometry.coordinates.slice(0,2)]:boundsOf(geometry);
  if(!b)throw new Error('카메라 기준 도형 없음');
  const center=[(b[0]+b[2])/2,(b[1]+b[3])/2];
  const width=distance([b[0],center[1]],[b[2],center[1]]),height=distance([center[0],b[1]],[center[0],b[3]]);
  const aspect=clamp(viewport.width/Math.max(250,viewport.height),.45,2.5);
  const extent=Math.max(height*1.15,width/aspect,level==='facility'?120:400);
  const range=clamp(extent/Math.tan(Math.PI/6)*(level==='overview'?1.15:1.05),level==='facility'?230:850,level==='overview'?120000:36000);
  return {center,range,heading,pitch:level==='overview'?-52:level==='facility'?-38:-44,level};
}
export function outsideRegionView(center,geometry) {
  const bounds=boundsOf(geometry);
  if(!bounds||!Array.isArray(center)||center.length<2||!center.slice(0,2).every(Number.isFinite))return false;
  const marginX=Math.max(.08,(bounds[2]-bounds[0])*.15),marginY=Math.max(.08,(bounds[3]-bounds[1])*.15);
  return center[0]<bounds[0]-marginX||center[0]>bounds[2]+marginX||center[1]<bounds[1]-marginY||center[1]>bounds[3]+marginY;
}
export function poseAt(a,b,t,arch=true){const q=smooth(clamp(t,0,1)),travel=distance(a.center,b.center);return {
  center:[a.center[0]+(b.center[0]-a.center[0])*q,a.center[1]+(b.center[1]-a.center[1])*q],
  range:a.range+(b.range-a.range)*q+(arch?Math.sin(Math.PI*q)*Math.min(11000,travel*.8):0),
  heading:a.heading+headingDelta(a.heading,b.heading)*q,pitch:a.pitch+(b.pitch-a.pitch)*q,level:b.level
};}
export class CameraDirector{
  constructor({read,write,request=cb=>requestAnimationFrame(cb),cancel=id=>cancelAnimationFrame(id),reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches,onChange=()=>{}}){Object.assign(this,{read,write,request,cancel,reduced,onChange});this.token=0;this.handle=null;this.orbiting=false;}
  stop(){this.token++;if(this.handle!==null)this.cancel(this.handle);this.handle=null;this.orbiting=false;if(this.pendingResolve){this.pendingResolve(false);this.pendingResolve=null;}this.onChange('idle');}
  fly(target,{duration=1900,arch=true,orbitAfter=false}={}){this.stop();const token=this.token,a=this.read();const finish=()=>{this.onChange('idle');if(orbitAfter&&token===this.token&&!this.reduced())this.orbit();};if(!a||this.reduced()||duration===0){this.write(target);finish();return Promise.resolve(true);}
    this.onChange('flying');return new Promise(resolve=>{this.pendingResolve=resolve;let start;const tick=now=>{if(token!==this.token){resolve(false);return;}start??=now;const t=clamp((now-start)/duration,0,1);this.write(poseAt(a,target,t,arch));if(t<1)this.handle=this.request(tick);else{this.handle=null;this.pendingResolve=null;finish();resolve(true);}};this.handle=this.request(tick);});}
  orbit(){this.stop();this.orbiting=true;const token=this.token;const a=this.read();let start;this.onChange('orbiting');const tick=now=>{if(token!==this.token)return;start??=now;this.write({...a,heading:a.heading+(now-start)*.004});this.handle=this.request(tick);};this.handle=this.request(tick);}
}
