/** Public Cesium sunlight controller. Visual shadows use currently loaded geometry.
 * Does not extract provider meshes, invoke private ray APIs or certify daylight rights.
 */
import {parseKst} from './solar.js';
export const SEASON_DAYS=Object.freeze({spring:'03-20',summer:'06-21',autumn:'09-23',winter:'12-22'});
export function seasonTime(current,season){parseKst(current);if(!SEASON_DAYS[season])throw Error('계절 선택 오류');return current.slice(0,4)+'-'+SEASON_DAYS[season]+current.slice(10);}
export const shadowDistance=range=>Math.max(2500,Math.min(30000,(Number(range)||8000)*1.45));
export function solarFixed(C,time){
 const fn=C.Simon1994PlanetaryPositions?.computeSunPositionInEarthInertialFrame;if(!fn)throw Error('SDK의 Simon1994 태양 위치를 확인하지 못했습니다.');
 const inertial=fn(time,new C.Cartesian3());let matrix,method='ICRF → fixed';
 if(C.Transforms.computeIcrfToCentralBodyFixedMatrix){matrix=C.Transforms.computeIcrfToCentralBodyFixedMatrix(time,new C.Matrix3());method='Cesium central-body fixed';}
 else matrix=C.Transforms.computeIcrfToFixedMatrix?.(time,new C.Matrix3());
 if(!matrix&&C.Transforms.computeTemeToPseudoFixedMatrix){matrix=C.Transforms.computeTemeToPseudoFixedMatrix(time,new C.Matrix3());method='TEME pseudo-fixed fallback · 근사';}
 if(!matrix)throw Error('태양 좌표 변환이 준비되지 않았습니다.');return {position:C.Matrix3.multiplyByVector(matrix,inertial,new C.Cartesian3()),method};
}
export function sunAngles(C,time,point=[126.855,35.145,0]){
 const fixed=solarFixed(C,time),origin=C.Cartesian3.fromDegrees(point[0],point[1],point[2]||0),direction=C.Cartesian3.subtract(fixed.position,origin,new C.Cartesian3());
 const inv=C.Matrix4.inverseTransformation(C.Transforms.eastNorthUpToFixedFrame(origin),new C.Matrix4()),local=C.Matrix4.multiplyByPointAsVector(inv,direction,new C.Cartesian3());
 const altitude=C.Math.toDegrees(Math.atan2(local.z,Math.hypot(local.x,local.y)));
 return {altitude,azimuth:(C.Math.toDegrees(Math.atan2(local.x,local.y))+360)%360,aboveHorizon:altitude>0,method:'Simon1994 / '+fixed.method};
}
export function createSunController(viewer,C,{emit=()=>{},getPose=()=>({range:16000,center:[126.855,35.145]})}={}){
 const scene=viewer.scene,casters=new Map();let active=false,target=null,inputTime=null,requestId=null,sequence=0,saved=null,lastScan=0,removeRendered=null,destroyed=false;
 const request=()=>scene.requestRender?.();
 function scan(collection,depth=0){
  if(depth===0)for(const p of casters.keys())try{if(p.isDestroyed?.())casters.delete(p);}catch{casters.delete(p);}
  if(!collection||depth>3||typeof collection.get!=='function')return;
  for(let i=0;i<Math.min(collection.length||0,10000);i++){let p;try{p=collection.get(i);}catch{continue;}if(!p)continue;
   // Never turn a receiver-only ground surface into a caster (self-shadow artefacts).
   if('shadows' in p)try{if(![C.ShadowMode.RECEIVE_ONLY,C.ShadowMode.CAST_ONLY].includes(p.shadows)){if(!casters.has(p))casters.set(p,p.shadows);p.shadows=C.ShadowMode.ENABLED;}}catch{}
   if(typeof p.get==='function'&&Number.isFinite(p.length))scan(p,depth+1);
  }
 }
 function status(extra={}){let angles=null;try{if(target)angles=sunAngles(C,target,getPose().center);}catch{}return {enabled:active,time:inputTime,requestId,appliedTime:target?C.JulianDate.toIso8601(viewer.clock.currentTime):null,angles,shadowMapEnabled:viewer.shadowMap?.enabled===true,maximumDistance:viewer.shadowMap?.maximumDistance??null,castingObjects:casters.size,renderingOnly:true,note:'현재 수신한 3D 도형의 시각적 그림자입니다. 미수신 건물·나무·지형, 실제 구름·조도·일조권은 미검증입니다.',...extra};}
 function restore(){if(!saved)return;scene.light=saved.light;viewer.shadows=saved.shadows;if('terrainShadows' in viewer)viewer.terrainShadows=saved.terrainShadows;if(scene.globe)scene.globe.enableLighting=saved.globeLighting;
  for(const k of ['clockStep','clockRange','multiplier','shouldAnimate'])if(saved.clock[k]!==undefined)viewer.clock[k]=saved.clock[k];viewer.clock.currentTime=C.JulianDate.clone(saved.clock.currentTime);
  for(const[k,v]of Object.entries(saved.shadow))if(v!==undefined)viewer.shadowMap[k]=v;for(const[p,v]of casters)try{if(!p.isDestroyed?.())p.shadows=v;}catch{}casters.clear();saved=null;
 }
 function apply(message){
  if(destroyed)throw Error('그림자 제어기가 종료되었습니다.');
  const date=parseKst(message.time);inputTime=message.time;target=C.JulianDate.fromDate(date);requestId=message.requestId??null;const seq=++sequence;removeRendered?.();removeRendered=null;
  if(message.shadows===false){active=false;restore();const out=status({phase:'off'});request();emit('sun-state',out);return out;}
  if(!C.SunLight||!viewer.shadowMap){active=false;restore();const out=status({phase:'unsupported',error:'현재 SDK에서 SunLight·ShadowMap을 확인할 수 없습니다.'});emit('sun-state',out);return out;}
  if(!saved)saved={light:scene.light,shadows:viewer.shadows,terrainShadows:viewer.terrainShadows,globeLighting:scene.globe?.enableLighting,clock:{currentTime:C.JulianDate.clone(viewer.clock.currentTime),...Object.fromEntries(['shouldAnimate','multiplier','clockStep','clockRange'].map(k=>[k,viewer.clock[k]]))},shadow:Object.fromEntries(['enabled','maximumDistance','softShadows','darkness','normalOffset'].map(k=>[k,viewer.shadowMap[k]]))};
  active=true;if(C.ClockStep&&'clockStep' in viewer.clock)viewer.clock.clockStep=C.ClockStep.SYSTEM_CLOCK_MULTIPLIER;if(C.ClockRange&&'clockRange' in viewer.clock)viewer.clock.clockRange=C.ClockRange.UNBOUNDED;
  viewer.clock.shouldAnimate=false;viewer.clock.multiplier=0;viewer.clock.currentTime=C.JulianDate.clone(target);scene.light=new C.SunLight({intensity:2});viewer.shadows=true;
  if('terrainShadows' in viewer)viewer.terrainShadows=C.ShadowMode.ENABLED;if(scene.globe)scene.globe.enableLighting=true;
  const sm=viewer.shadowMap;sm.enabled=true;sm.maximumDistance=shadowDistance(getPose().range);sm.softShadows=true;sm.darkness=.3;if('normalOffset' in sm)sm.normalOffset=true;
  scan(scene.primitives);const out=status({phase:'applied'});emit('sun-state',out);
  removeRendered=scene.postRender?.addEventListener(()=>{removeRendered?.();removeRendered=null;if(active&&seq===sequence)emit('sun-state',status({phase:'rendered'}));});request();return out;
 }
 const removeUpdate=scene.preUpdate?.addEventListener(()=>{if(!active||!target)return;if(Math.abs(C.JulianDate.secondsDifference(viewer.clock.currentTime,target))>.05)viewer.clock.currentTime=C.JulianDate.clone(target);viewer.clock.shouldAnimate=false;viewer.shadowMap.maximumDistance=shadowDistance(getPose().range);if(Date.now()-lastScan>1500){scan(scene.primitives);lastScan=Date.now();}});
 return {apply,status,get active(){return active;},refresh(){if(active)apply({time:inputTime,shadows:true,requestId});},destroy(){if(destroyed)return;removeUpdate?.();removeRendered?.();active=false;restore();destroyed=true;}};
}
