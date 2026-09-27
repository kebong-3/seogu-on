/** Native visual shadows. Public Cesium properties only; no provider mesh extraction.
 * Visual shadows do not certify sunshine duration or disaster safety.
 */
import {parseKst} from './solar.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const SEASON_DAYS={spring:'03-20',summer:'06-21',autumn:'09-23',winter:'12-22'};
export function seasonTime(current,season){if(!SEASON_DAYS[season])throw Error('계절 선택 오류');parseKst(current);return current.slice(0,4)+'-'+SEASON_DAYS[season]+current.slice(10);}
export function solarFixed(C,julian){
 if(!C.Simon1994PlanetaryPositions?.computeSunPositionInEarthInertialFrame)throw Error('이 SDK는 Simon1994 태양 위치를 제공하지 않습니다.');
 const inertial=C.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julian,new C.Cartesian3());
 let matrix,method='ICRF→고정좌표';
 if(C.Transforms.computeIcrfToCentralBodyFixedMatrix){matrix=C.Transforms.computeIcrfToCentralBodyFixedMatrix(julian,new C.Matrix3());method='Cesium central-body fixed transform';}
 else matrix=C.Transforms.computeIcrfToFixedMatrix?.(julian,new C.Matrix3());
 if(!matrix&&C.Transforms.computeTemeToPseudoFixedMatrix){matrix=C.Transforms.computeTemeToPseudoFixedMatrix(julian,new C.Matrix3());method='TEME pseudo-fixed fallback · 근사';}
 if(!matrix)throw Error('태양의 관성좌표를 지구고정좌표로 변환하지 못했습니다.');
 return {position:C.Matrix3.multiplyByVector(matrix,inertial,new C.Cartesian3()),method};
}
export function sunAngles(C,julian,point=[126.855,35.145,0]){
 const fixed=solarFixed(C,julian),origin=C.Cartesian3.fromDegrees(point[0],point[1],point[2]||0);
 const difference=C.Cartesian3.subtract(fixed.position,origin,new C.Cartesian3());
 const enu=C.Transforms.eastNorthUpToFixedFrame(origin),inverse=C.Matrix4.inverseTransformation(enu,new C.Matrix4());
 const local=C.Matrix4.multiplyByPointAsVector(inverse,difference,new C.Cartesian3());
 const altitude=C.Math.toDegrees(Math.atan2(local.z,Math.hypot(local.x,local.y))),azimuth=(C.Math.toDegrees(Math.atan2(local.x,local.y))+360)%360;
 return {altitude,azimuth,aboveHorizon:altitude>0,method:'Simon1994 / '+fixed.method};
}
export function shadowDistance(range){return clamp(Number(range)*1.45||12000,2500,30000);}
export function createSunController(viewer,C,{emit=()=>{},getPose=()=>({range:16000,center:[126.855,35.145]})}={}){
 let active=false,target=null,inputTime=null,sequence=0,restore=null,lastSend=0;
 const casters=new Map(),scene=viewer.scene;
 const request=()=>scene.requestRender?.();
 function publicCasters(collection,depth=0){if(depth===0)for(const p of casters.keys())try{if(p.isDestroyed?.())casters.delete(p);}catch{casters.delete(p);}if(!collection||depth>3||typeof collection.get!=='function')return;for(let i=0;i<Math.min(collection.length||0,10000);i++){let p;try{p=collection.get(i);}catch{continue;}if(!p)continue;if('shadows' in p){try{if(!casters.has(p))casters.set(p,p.shadows);p.shadows=C.ShadowMode.ENABLED;}catch{}}if(typeof p.get==='function'&&Number.isFinite(p.length))publicCasters(p,depth+1);}}
 function status(extra={}){const sm=viewer.shadowMap||scene.shadowMap;let angles=null;try{if(target)angles=sunAngles(C,target,getPose().center);}catch{}return {enabled:active,time:inputTime,appliedTime:target?C.JulianDate.toIso8601(viewer.clock.currentTime):null,source:'loaded 3D geometry · native renderer',method:angles?.method||'Cesium SunLight',angles,shadowMapEnabled:sm?.enabled===true,maximumDistance:sm?.maximumDistance??null,castingObjects:casters.size,renderingOnly:true,note:'시각적 일영입니다. 미수신 건물·나무·지형과 해상도 오차가 있으며 정밀 일조권·채광량·실제 구름은 계산하지 않습니다.',...extra};}
 function apply(message){sequence++;const seq=sequence;const date=parseKst(message.time);inputTime=message.time;target=C.JulianDate.fromDate(date);const on=message.shadows!==false;
 if(on&&!restore)restore={light:scene.light,shadows:viewer.shadows,terrainShadows:viewer.terrainShadows,globeLighting:scene.globe?.enableLighting,currentTime:C.JulianDate.clone(viewer.clock.currentTime),animate:viewer.clock.shouldAnimate,multiplier:viewer.clock.multiplier,maximumDistance:viewer.shadowMap?.maximumDistance};
 if(!on){active=false;if(restore){scene.light=restore.light;viewer.shadows=restore.shadows;viewer.terrainShadows=restore.terrainShadows;if(scene.globe)scene.globe.enableLighting=restore.globeLighting;viewer.clock.shouldAnimate=restore.animate;viewer.clock.multiplier=restore.multiplier;if(viewer.shadowMap&&restore.maximumDistance!==undefined)viewer.shadowMap.maximumDistance=restore.maximumDistance;for(const[p,s]of casters)try{if(!p.isDestroyed?.())p.shadows=s;}catch{}casters.clear();restore=null;}request();emit('sun-state',status({phase:'off'}));return status();}
 if(!C.SunLight||!viewer.shadowMap){emit('sun-state',status({phase:'unsupported',error:'SDK의 SunLight 또는 ShadowMap을 확인할 수 없습니다.'}));return status();}
 active=true;viewer.clock.shouldAnimate=false;viewer.clock.multiplier=0;viewer.clock.currentTime=C.JulianDate.clone(target);scene.light=new C.SunLight({intensity:2});viewer.shadows=true;
 if('terrainShadows' in viewer)viewer.terrainShadows=C.ShadowMode.ENABLED;
 if(scene.globe)scene.globe.enableLighting=true;
 const sm=viewer.shadowMap;sm.enabled=true;sm.maximumDistance=shadowDistance(getPose().range);sm.softShadows=true;sm.darkness=.3;
 publicCasters(scene.primitives);request();emit('sun-state',status({phase:'applied'}));
 const remove=scene.postRender?.addEventListener(()=>{remove?.();if(seq===sequence&&active)emit('sun-state',status({phase:'rendered'}));});
 return status();
 }
 const detach=scene.preUpdate?.addEventListener(()=>{if(!active||!target)return;if(Math.abs(C.JulianDate.secondsDifference(viewer.clock.currentTime,target))>.05)viewer.clock.currentTime=C.JulianDate.clone(target);viewer.clock.shouldAnimate=false;if(viewer.shadowMap)viewer.shadowMap.maximumDistance=shadowDistance(getPose().range);if(Date.now()-lastSend>1500){publicCasters(scene.primitives);lastSend=Date.now();}});
 return {apply,status,refresh(){if(active&&inputTime)apply({time:inputTime,shadows:true});},get active(){return active;},destroy(){detach?.();if(active)apply({time:inputTime,shadows:false});}};
}
