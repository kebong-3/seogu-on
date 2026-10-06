import {createSunController} from './sun-engine.js';
import {applyQuality,displayOptions,setBuildingStyle,applyBaseBrightness} from './graphics.js';
import {parseKst} from './solar.js';
import {loadCleanModel} from './clean-model.js';
import {createDongLabels3D} from './dong-labels-3d.js';
import {fc,multi,inside,representative,distance,maskGeometry,boundsOf} from './geometry.js';
import {CameraDirector,frameFor,clamp} from './camera.js';
import {LAYERS,LAYER_BY_ID,iconData,clusterIconData} from './catalog.js';
import {maskedProvider} from './raster.js';
import {terrainGrid,slopeSummary,profilePoints,parseGlb} from './analysis.js';
const tell=(type,data={})=>parent.postMessage({seoguCity:true,type,...data},location.origin);
const notice=document.getElementById('notice');
const clean=window.SEO_ENGINE==='clean';
let sunController=null,dongLabels=null;
let buildingStyleResult=null,renderFrames=0,renderFailed=false;
let quality='balanced',visual=displayOptions(),lastBoundary,cleanStats=null;
let viewer,map,C,director,ready=false,queued=[],admin,scope,dong='all',currentPose,selectionMode=null,profileStart=null;
let registry=new Map(),sources=new Map(),imagery=new Map(),boundarySource,maskSource,analysisSource,modelSource,selectedEntity;
let model=null,modelUrl=null,modelLocation=null,modelSequence=0,hiddenFeatures=new Map(),sampleSequence=0,focusOn=true;
const now=()=>C.JulianDate.now();
const property=(e,key)=>e?.properties?.[key]?.getValue?.(now())??e?.properties?.[key];
function color(hex,alpha=1){return C.Color.fromCssColorString(hex).withAlpha(alpha);}
function requestRender(){viewer.scene.requestRender?.();}
function setNotice(s){if(notice)notice.textContent=s;}
function clearOwned(ds){ds.entities.removeAll();}
/* 지형이 없는 도시모형에서는 지면 고정(CLAMP)을 쓰면 먼 거리에서 아이콘·글자가 엉뚱한 곳에 그려진다. 높이 0에 그대로 둔다. */
function groundRef(){return clean?C.HeightReference.NONE:C.HeightReference.CLAMP_TO_GROUND;}
async function init(){if(ready||!window.Cesium||(!clean&&!window.ws3d?.viewer))return false;C=window.Cesium;viewer=clean?window.seoCleanViewer:window.ws3d.viewer;if(!viewer.entities||!viewer.scene?.globe)return false;ready=true;
 viewer.scene.globe.depthTestAgainstTerrain=false;
 if(viewer.scene.screenSpaceCameraController){viewer.scene.screenSpaceCameraController.minimumZoomDistance=65;viewer.scene.screenSpaceCameraController.maximumZoomDistance=60000;}
 boundarySource=new C.CustomDataSource('seo-city-dongs');maskSource=new C.CustomDataSource('seo-city-focus');analysisSource=new C.CustomDataSource('seo-city-analysis');modelSource=new C.CustomDataSource('seo-city-model-label');
 for(const s of [boundarySource,maskSource,analysisSource,modelSource])await viewer.dataSources.add(s);
 currentPose={center:[126.86,35.145],range:16000,heading:320,pitch:-48,level:'overview'};
 sunController=createSunController(viewer,C,{emit:tell,getPose:readPose});
 dongLabels=createDongLabels3D({C,viewer,source:boundarySource,requestRender,clampToGround:!clean});
 director=new CameraDirector({read:readPose,write:writePose,onChange:s=>tell('motion',{state:s}),reduced:()=>matchMedia('(prefers-reduced-motion: reduce)').matches});
 for(const event of ['pointerdown','wheel','touchstart'])viewer.scene.canvas.addEventListener(event,()=>director.stop(),{passive:true});
 const handler=new C.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(click,C.ScreenSpaceEventType.LEFT_CLICK);
 viewer.camera.moveEnd.addEventListener(()=>{const pose=readPose();currentPose=pose;tell('pose',{pose});if(admin&&pose.center&&(pose.center[0]<126.70||pose.center[0]>127.02||pose.center[1]<35.01||pose.center[1]>35.28))director.fly(frameFor(admin,'overview'),{duration:900,arch:false});});
 if(!clean){buildingStyleResult=setBuildingStyle(map,'detailed');tell('building-style-result',buildingStyleResult);}
 viewer.scene.postRender?.addEventListener(()=>{renderFrames++;});
 viewer.scene.renderError?.addEventListener(()=>{renderFailed=true;tell('error',{message:'3D 렌더링 중 오류가 발생했습니다. 선명도를 낮추거나 다른 지도 모드로 전환하세요.'});});
 // Never disable provider attribution or guess internal tileset names.
 setNotice(clean?'공개 도형 도시모형 · 지형 없음 · 미상 높이 6m 표시는 그늘 계산에서 제외':'브이월드 3D · 건물·지형 제공범위 및 최신성은 제공기관 자료에 따름');
 try{tell('quality-result',applyQuality(viewer,quality,devicePixelRatio||1));}catch{}
 if(clean){loadCleanModel(viewer,C,setNotice).then(result=>{cleanStats=result;sunController?.refresh();tell('model-ready',result);setNotice(result.note);}).catch(e=>tell('error',{message:e.message}));}
 tell('ready',{capabilities:{terrain:!clean&&!!(C.sampleTerrain||C.sampleTerrainMostDetailed),glb:!!(C.Model?.fromGltfAsync||C.Model?.fromGltf),raster:!!C.UrlTemplateImageryProvider,tileSelection:!!C.Cesium3DTileFeature},engine:clean?'clean':'vworld'});
 for(const m of queued)await handle(m);queued=[];return true;
}
function readPose(){if(!viewer)return currentPose;const canvas=viewer.scene.canvas;const ray=viewer.camera.getPickRay(new C.Cartesian2(canvas.clientWidth/2,canvas.clientHeight/2)),ground=ray&&viewer.scene.globe.pick(ray,viewer.scene);if(ground){const carto=C.Cartographic.fromCartesian(ground);return {center:[C.Math.toDegrees(carto.longitude),C.Math.toDegrees(carto.latitude)],range:C.Cartesian3.distance(viewer.camera.positionWC,ground),heading:C.Math.toDegrees(viewer.camera.heading),pitch:C.Math.toDegrees(viewer.camera.pitch),level:currentPose.level};}return {...currentPose,heading:C.Math.toDegrees(viewer.camera.heading),pitch:C.Math.toDegrees(viewer.camera.pitch)};}
function writePose(p){const cart=C.Cartographic.fromDegrees(...p.center),sample=viewer.scene.globe.getHeight(cart);const h=Number.isFinite(sample)?sample:0;
 const target=C.Cartesian3.fromDegrees(...p.center,h+8);viewer.camera.lookAt(target,new C.HeadingPitchRange(C.Math.toRadians(p.heading),C.Math.toRadians(p.pitch),Math.max(80,p.range)));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);currentPose=p;requestRender();}
function hierarchy(poly){return new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(poly[0].flatMap(p=>p.slice(0,2))),poly.slice(1).map(r=>new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(r.flatMap(p=>p.slice(0,2))))));}
function addGeometry(ds,f,style){const g=f.geometry,p=f.properties||{},base=`${style.layer}:${p.id||f.id||ds.entities.values.length}`;const attrs={facilityId:p.id||f.id,layerId:style.layer,dongId:p.dongId};
 if(g.type==='Point')return ds.entities.add({id:base,position:C.Cartesian3.fromDegrees(...g.coordinates.slice(0,2)),properties:attrs,billboard:{image:iconData(style.icon,style.color),width:34,height:39,verticalOrigin:C.VerticalOrigin.BOTTOM,heightReference:groundRef(),disableDepthTestDistance:Number.POSITIVE_INFINITY,scaleByDistance:new C.NearFarScalar(250,1.2,15000,.65)},label:{text:p.mapLabel||p.name||'',font:'12px sans-serif',fillColor:C.Color.WHITE,showBackground:true,backgroundColor:color('#102735',.84),pixelOffset:new C.Cartesian2(0,-45),heightReference:groundRef(),distanceDisplayCondition:new C.DistanceDisplayCondition(0,p.mapLabel?45000:2200),disableDepthTestDistance:Number.POSITIVE_INFINITY}});
 if(multi(g).length){for(const [i,poly]of multi(g).entries()){
  ds.entities.add({id:`${base}:p${i}`,properties:attrs,polygon:{hierarchy:hierarchy(poly),material:color(style.color,style.alpha??.25),classificationType:C.ClassificationType.TERRAIN}});
  if(style.width!==0)for(const [j,r]of poly.entries())ds.entities.add({id:`${base}:p${i}r${j}`,properties:attrs,polyline:{positions:C.Cartesian3.fromDegreesArray(r.flatMap(p=>p.slice(0,2))),width:style.width||2,clampToGround:true,material:color(style.color,.94)}});
 }}else {const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];lines.forEach((r,i)=>ds.entities.add({id:`${base}:l${i}`,properties:attrs,polyline:{positions:C.Cartesian3.fromDegreesArray(r.flatMap(p=>p.slice(0,2))),clampToGround:true,width:style.width||4,material:color(style.color,.92)}}));}
}
async function boundaries(m){lastBoundary=m;visual=displayOptions(m.visual||visual);sampleSequence++;selectionMode=null;profileStart=null;admin=m.district;scope=m.scope;dong=m.dong||'all';focusOn=m.focus!==false;clearOwned(boundarySource);clearOwned(maskSource);
 for(const f of m.features){const selected=f.properties.dongId===dong;const style={layer:'dong',color:f.properties.color,alpha: dong==='all'?visual.boundaryOpacity:selected?Math.min(.18,visual.boundaryOpacity+.04):.005,width:selected?4:1.5};addGeometry(boundarySource,f,style);}
 /* 동 이름표: 선택 동의 이름을 먼저 배치하고 자리가 부족한 이름은 확대 시 다시 표시한다(dong-labels-3d.js). */
 dongLabels?.set(m.features.map(f=>({...f,properties:{...f.properties,labelPoint:f.properties.labelPoint||representative(f.geometry)}})),{dong,visible:visual.labels});
 if(focusOn){const g=maskGeometry(scope);if(g)addGeometry(maskSource,{geometry:g,properties:{id:'outside'}},{layer:'mask',color:'#091c2a',alpha:visual.maskOpacity,width:0});}
 if(!m.visualOnly){for(const [id,item]of imagery){viewer.imageryLayers.remove(item,true);imagery.delete(id);}for(const l of (m.rasters||[]))toggleRaster(l,true);}
 requestRender();
}
function renderLayer(m){const style=LAYER_BY_ID[m.id]||{id:m.id,color:m.color||'#d5b791',icon:'pin'};let ds=sources.get(m.id);if(!ds){ds=new C.CustomDataSource(`seo-city-${m.id}`);sources.set(m.id,ds);viewer.dataSources.add(ds);ds.clustering.clusterEvent.addEventListener((entities,cluster)=>{const badge=clusterIconData(style.color);cluster.billboard.show=true;cluster.billboard.image=badge;cluster.billboard.width=45;cluster.billboard.height=45;cluster.label.show=true;cluster.label.text=String(entities.length);cluster.label.font='bold 13px sans-serif';cluster.label.fillColor=C.Color.WHITE;cluster.label.showBackground=false;cluster.label.pixelOffset=new C.Cartesian2(0,0);cluster.label.horizontalOrigin=C.HorizontalOrigin.CENTER;cluster.label.verticalOrigin=C.VerticalOrigin.CENTER;});}
 if(!Array.isArray(m.features)){ds.show=m.visible!==false;requestRender();return;}
 clearOwned(ds);registry.set(m.id,m.features||[]);for(const f of m.features||[]){const selected=String(f.properties?.id||f.id)===String(m.selectedId);addGeometry(ds,f,{...style,layer:m.id,color:selected?'#ffe0a1':(/^#[0-9a-f]{6}$/i.test(f.properties?.displayColor||'')?f.properties.displayColor:style.color),alpha:m.id==='shade-result'?.18:selected?.48:.28,width:m.id==='shade-result'?0:selected?4:2});}ds.show=m.visible!==false;
 if(ds.clustering){const points=m.features?.filter(f=>f.geometry.type==='Point').length||0;ds.clustering.enabled=points>25;ds.clustering.pixelRange=52;ds.clustering.minimumClusterSize=3;}
 requestRender();}
function toggleRaster(id,visible){const existing=imagery.get(id);if(!visible){if(existing){viewer.imageryLayers.remove(existing,true);imagery.delete(id);}return;}
 if(existing||!scope)return;try{const layer=LAYER_BY_ID[id];const p=maskedProvider(C,layer,scope,dong,(id,state)=>tell('raster-state',{id,state}));const imageryLayer=viewer.imageryLayers.addImageryProvider(p);imageryLayer.alpha=.65;imagery.set(id,imageryLayer);tell('raster-state',{id,state:'requesting'});}catch{tell('raster-state',{id,state:'unsupported'});}}
function groundPoint(position){const ray=viewer.camera.getPickRay(position),p=ray&&viewer.scene.globe.pick(ray,viewer.scene);if(!p)return null;const cart=C.Cartographic.fromCartesian(p);return [C.Math.toDegrees(cart.longitude),C.Math.toDegrees(cart.latitude)];}
async function click(event){const hits=viewer.scene.drillPick?.(event.position,12)||[viewer.scene.pick(event.position)];const point=groundPoint(event.position);
 const cleanHit=hits.find(h=>h?.id?.cleanBuilding);if(cleanHit&&!selectionMode){tell('model-building',{building:cleanHit.id.cleanBuilding});return;}
 if(selectionMode==='hide-building'){const feature=hits.find(f=>C.Cesium3DTileFeature&&f instanceof C.Cesium3DTileFeature);if(feature){if(!hiddenFeatures.has(feature))hiddenFeatures.set(feature,feature.show);feature.show=false;tell('tool-result',{kind:'hide-building',count:hiddenFeatures.size,note:'현재 로드된 건물 객체만 숨김. 실제 건물자료 삭제가 아닙니다.'});requestRender();}else tell('tool-result',{kind:'hide-building',error:'이 건물은 공개 개별 선택 기능을 제공하지 않습니다.'});return;}
 if(selectionMode==='operation-point'||selectionMode==='operation-route'){if(!point||!scope||!inside(point,scope)){tell('map-warning',{message:'선택 구역 안에서 클릭하세요.'});return;}const tool=selectionMode;if(tool==='operation-point')selectionMode=null;tell('point',{point,tool});return;}
 if(selectionMode){if(!point||!inside(point,scope)){tell('tool-result',{kind:selectionMode,error:'선택한 서구 구역 안에서 지점을 선택하세요.'});return;}
  const mode=selectionMode;if(mode==='profile'){if(!profileStart){profileStart=point;mark(point,'단면 시작');tell('tool-result',{kind:'profile-start',point});return;}const start=profileStart;profileStart=null;selectionMode=null;await terrainProfile(start,point);return;}
  selectionMode=null;mark(point,'선택 지점');tell('point',{point,tool:mode});if(mode==='slope')await terrainSlope(point);if(mode==='place-model')await placeModel(point);return;
 }
 for(const hit of hits){const e=hit?.id;if(!e)continue;const layer=property(e,'layerId'),id=property(e,'facilityId');if(layer&&layer!=='dong'&&layer!=='mask'&&id){tell('select',{id,layer});return;}}
 for(const hit of hits){const e=hit?.id;if(property(e,'layerId')==='dong'){const id=property(e,'dongId');if(id){tell('dong',{id});return;}}}
 if(point&&admin&&inside(point,admin))tell('point',{point,tool:null});
}
function mark(point,label){clearOwned(analysisSource);analysisSource.entities.add({position:C.Cartesian3.fromDegrees(...point),point:{pixelSize:12,color:color('#ffd28a'),outlineColor:C.Color.WHITE,outlineWidth:2,heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:label,font:'12px sans-serif',showBackground:true,backgroundColor:color('#183849'),pixelOffset:new C.Cartesian2(0,-22),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY}});}
async function sample(points){const provider=viewer.terrainProvider||viewer.scene.terrainProvider;if(!provider||provider instanceof C.EllipsoidTerrainProvider)throw Error('높이 지형 자료가 연결되지 않았습니다. 평평한 타원체를 지형 높이로 사용하지 않습니다.');const positions=points.map(p=>C.Cartographic.fromDegrees(...p));
 let method,result;if(C.sampleTerrainMostDetailed&&provider.availability){method='sampleTerrainMostDetailed';result=await C.sampleTerrainMostDetailed(provider,positions);}else if(C.sampleTerrain){method='sampleTerrain(level 12)';result=await C.sampleTerrain(provider,12,positions);}else throw Error('이 SDK는 지형 표본 조회를 지원하지 않습니다.');
 return {heights:result.map(p=>Number.isFinite(p.height)?p.height:null),method,source:'브이월드 지형 표본 / DEM 기준면·해상도 확인 필요'};}
async function terrainSlope(point){const seq=++sampleSequence;tell('tool-result',{kind:'slope',state:'loading'});try{const spacing=30,points=terrainGrid(point,spacing,7);if(points.some(p=>!inside(p,scope)))throw Error('7×7 지형 표본 영역이 선택 구역을 벗어납니다. 경계에서 더 안쪽 지점을 선택하세요.');const data=await sample(points);if(seq!==sampleSequence)return;const summary=slopeSummary(data.heights,spacing,7);if(!summary.validCells)throw Error('경사도를 계산할 유효 지형 표본이 없습니다.');for(const cell of summary.slopes){const p=points[cell.index];analysisSource.entities.add({position:C.Cartesian3.fromDegrees(...p),point:{pixelSize:5,color:color(cell.degrees>20?'#f7a17e':'#8bddb9'),heightReference:C.HeightReference.CLAMP_TO_GROUND}});}tell('tool-result',{kind:'slope',point,spacing,summary,...data,note:'지형 표본의 수치미분입니다. 지반 안정성·법정 경사도·건축 가능 판정이 아닙니다.'});}catch(e){if(seq===sampleSequence)tell('tool-result',{kind:'slope',error:e.message});}}
async function terrainProfile(a,b){const seq=++sampleSequence;tell('tool-result',{kind:'profile',state:'loading'});try{const length=distance(a,b);if(length>6000)throw Error('단면 길이는 6km 이하로 선택하세요.');const points=profilePoints(a,b,Math.min(200,Math.max(24,Math.ceil(length/15))));if(points.some(p=>!inside(p,scope)))throw Error('단면선이 선택한 구역 밖을 통과합니다. 구역 안의 선을 선택하세요.');const data=await sample(points);if(seq!==sampleSequence)return;if(!data.heights.some(Number.isFinite))throw Error('유효 지형 표본 없음');addGeometry(analysisSource,{geometry:{type:'LineString',coordinates:[a,b]},properties:{id:'profile'}},{layer:'analysis',color:'#ffd593',width:4});tell('tool-result',{kind:'profile',a,b,length,points,...data,note:'누락 표본은 연결하지 않습니다. 높이는 지형자료의 기준면을 따릅니다.'});}catch(e){if(seq===sampleSequence)tell('tool-result',{kind:'profile',error:e.message});}}
async function loadModel(buffer){parseGlb(buffer);await removeModel();modelUrl=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'}));tell('tool-result',{kind:'model-loaded',note:'브라우저 메모리에만 보관했습니다. 지도에 배치할 위치를 선택하세요.'});}
async function removeModel(){modelSequence++;if(model){try{viewer.scene.primitives.remove(model);}catch{}model=null;}clearOwned(modelSource);if(modelUrl)URL.revokeObjectURL(modelUrl);modelUrl=null;modelLocation=null;requestRender();}
function modelMatrix(p,heading=0,height=0){const c=C.Cartographic.fromDegrees(...p),terrain=clean?0:viewer.scene.globe.getHeight(c);if(!Number.isFinite(terrain))throw Error('배치 위치의 지형 높이가 아직 없습니다. 지도를 확대하고 다시 시도하세요.');return C.Transforms.headingPitchRollToFixedFrame(C.Cartesian3.fromDegrees(...p,terrain+height),new C.HeadingPitchRoll(C.Math.toRadians(heading),0,0));}
async function placeModel(point){const sequence=++modelSequence;try{if(!modelUrl)throw Error('먼저 GLB 파일을 선택하세요.');if(model)viewer.scene.primitives.remove(model);const opts={url:modelUrl,modelMatrix:modelMatrix(point),scale:1};const created=C.Model.fromGltfAsync?await C.Model.fromGltfAsync(opts):C.Model.fromGltf(opts);if(sequence!==modelSequence){created.destroy?.();return;}model=created;viewer.scene.primitives.add(model);if(model.readyPromise)await model.readyPromise;if(sequence!==modelSequence)return;modelLocation=point;clearOwned(modelSource);modelSource.entities.add({position:C.Cartesian3.fromDegrees(...point),label:{text:'가상 배치안 · 실제 건물 아님',font:'13px sans-serif',showBackground:true,pixelOffset:new C.Cartesian2(0,-35),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Number.POSITIVE_INFINITY}});tell('tool-result',{kind:'model-placed',point,note:'가상 배치안입니다. 회전·배율·높이 조절이 가능합니다.'});requestRender();}catch(e){tell('tool-result',{kind:'model-placed',error:e.message||'모델 표시 실패'});}}
async function handle(m){switch(m.type){
 case'boundaries':await boundaries(m);break;
 case'layer':renderLayer(m);break;
 case'raster':toggleRaster(m.id,m.visible);break;
 case'camera':director.fly(m.pose,{duration:m.duration??1900,arch:m.arch!==false});break;
 case'rotate':{const p=readPose();director.fly({...p,heading:p.heading+(m.angle||45)},{duration:700,arch:false});break;}
 case'zoom':{const p=readPose();director.fly({...p,range:clamp(p.range*(m.delta>0?.7:1.4),100,36000)},{duration:500,arch:false});break;}
 case'tilt':{const p=readPose();director.fly({...p,pitch:m.top?-89.5:-44},{duration:800,arch:false});break;}
 case'orbit':director.orbiting?director.stop():director.orbit();break;
 case'stop':director.stop();selectionMode=null;profileStart=null;break;
 case'tool':director.stop();sampleSequence++;selectionMode=m.tool;profileStart=null;clearOwned(analysisSource);tell('tool-result',{kind:m.tool,state:'armed'});break;
 case'cross-profile':{const a=m.a,b=m.b,len=clamp(Number(m.length)||50,10,1000);if(!Array.isArray(a)||!Array.isArray(b)||!inside(a,scope)||!inside(b,scope))break;const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],dx=(b[0]-a[0])*Math.cos(mid[1]*Math.PI/180),dy=b[1]-a[1],norm=Math.hypot(dx,dy);if(norm<1e-10)break;const ox=-dy/norm*len/2/(111320*Math.cos(mid[1]*Math.PI/180)),oy=dx/norm*len/2/111320;await terrainProfile([mid[0]-ox,mid[1]-oy],[mid[0]+ox,mid[1]+oy]);break;}
 case'clear-analysis':sampleSequence++;selectionMode=null;profileStart=null;clearOwned(analysisSource);break;
 case'glb':await loadModel(m.buffer);break;
 case'model-remove':await removeModel();break;
 case'model-edit':if(model&&modelLocation){model.modelMatrix=modelMatrix(modelLocation,clamp(Number(m.heading)||0,0,360),clamp(Number(m.height)||0,-30,250));model.scale=clamp(Number(m.scale)||1,.1,20);requestRender();}break;
 case'restore-buildings':for(const[f,value]of hiddenFeatures)try{f.show=value;}catch{}hiddenFeatures.clear();selectionMode=null;requestRender();tell('tool-result',{kind:'restore-buildings',note:'기록한 건물 객체 표시를 복구했습니다.'});break;
 case'sun':sunController?.apply(m);break;
 case'appearance':tell('appearance-result',applyBaseBrightness(viewer,m.options,new Set(imagery.values())));break;
 case'building-style':buildingStyleResult=clean?{applied:false,note:'밝은 도시모형은 브이월드 건물 원본과 별개입니다.'}:setBuildingStyle(map,m.mode);tell('building-style-result',buildingStyleResult);requestRender();break;
 case'diagnostics':{const cv=viewer.scene.canvas;tell('diagnostics',{engine:clean?'clean':'vworld',webgl:!cv.isContextLost?.(),rendered:renderFrames>0&&!renderFailed,renderFrames,renderFailed,css:[cv.clientWidth,cv.clientHeight],buffer:[cv.width,cv.height],resolutionScale:viewer.resolutionScale,buildingStyle:buildingStyleResult,model:cleanStats?{buildingCount:cleanStats.buildingCount,note:cleanStats.note}:null,visibleSources:[...sources].filter(([,ds])=>ds.show).map(([id,ds])=>({id,entities:ds.entities.values.length})),note:'렌더 루프·표시 객체 확인입니다. 건물의 정확성·외부 API 인증·실측 검증을 뜻하지 않습니다.'});break;}
 case'quality':quality=m.mode||'balanced';tell('quality-result',applyQuality(viewer,quality,devicePixelRatio||1));break;
 case'visual':visual=displayOptions(m.options);if(lastBoundary)await boundaries({...lastBoundary,visual,visualOnly:true});break;
 case'resize':viewer.resize?.();try{applyQuality(viewer,quality,devicePixelRatio||1);}catch{}requestRender();dongLabels?.layout(true);break;
 }}
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||!event.data?.seoguCity)return;const m=event.data;if(!ready){queued.push(m);if(queued.length>100)queued.shift();return;}Promise.resolve(handle(m)).catch(e=>tell('error',{message:e.message||'3D 처리 실패'}));});
window.addEventListener('beforeunload',()=>{sunController?.destroy();dongLabels?.destroy();director?.stop();if(modelUrl)URL.revokeObjectURL(modelUrl);});

if(clean){try{C=window.Cesium;window.seoCleanViewer=new C.Viewer('vmap',{animation:false,timeline:false,baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,skyBox:false,skyAtmosphere:false,terrainProvider:new C.EllipsoidTerrainProvider(),shadows:false,contextOptions:{webgl:{alpha:false,antialias:true}},scene3DOnly:true,requestRenderMode:true,maximumRenderTimeChange:Infinity});
 const sc=window.seoCleanViewer.scene;sc.backgroundColor=C.Color.fromCssColorString('#c5d2ca');sc.globe.baseColor=C.Color.fromCssColorString('#c5d2ca');sc.globe.enableLighting=false;
 (window.seoCleanViewer.creditDisplay||window.seoCleanViewer.cesiumWidget?.creditDisplay)?.addStaticCredit(new C.Credit('© OpenStreetMap contributors · ODbL · 도형 일부 수록 / 지형 없음',true));
 init().catch(e=>tell('error',{message:e.message}));
 }catch(e){setNotice('도시모형 WebGL 초기화 실패');tell('error',{message:'도시모형의 WebGL 초기화 실패: '+e.message});}
}else{try{if(!window.vw?.Map)throw Error('VWorld SDK를 받지 못했습니다. 키·등록 도메인·외부 접속을 확인하세요.');window.vw.ws3dInitCallBack=()=>init().catch(e=>tell('error',{message:e.message}));map=new window.vw.Map();map.setOption({mapId:'vmap',initPosition:new window.vw.CameraPosition(new window.vw.CoordZ(126.855,35.14,15500),new window.vw.Direction(320,-50,0)),logo:false,navigation:false});map.start();let tries=0;const timer=setInterval(()=>{if(ready){clearInterval(timer);return;}init().catch(()=>{});if(++tries>120){clearInterval(timer);tell('error',{message:'브이월드 초기화 30초 대기 초과. 키·도메인·서비스 승인을 확인하세요.'});}},250);}catch(e){setNotice(e.message);tell('error',{message:e.message});}}
