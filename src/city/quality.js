/** Render quality, not source-data enhancement. Public Cesium properties only. */
export const QUALITY_PRESETS = Object.freeze({
  economy: {label:'가볍게', ratio:1, budget:2400000, sse:20, terrainSse:3, shadowSize:1024},
  balanced:{label:'균형', ratio:1.35, budget:4400000, sse:12, terrainSse:2, shadowSize:2048},
  high:    {label:'선명하게', ratio:1.8, budget:7600000, sse:6, terrainSse:1.3, shadowSize:2048}
});
export function qualityPlan(name='balanced',width=1280,height=720,dpr=1){
  const p=QUALITY_PRESETS[name]||QUALITY_PRESETS.balanced;
  width=Math.max(1,Number(width)||1);height=Math.max(1,Number(height)||1);dpr=Math.max(.5,Math.min(4,Number(dpr)||1));
  const ratio=Math.min(p.ratio,Math.sqrt(p.budget/(width*height)));
  return {...p,name:QUALITY_PRESETS[name]?name:'balanced',pixelRatio:ratio,resolutionScale:ratio/dpr,width:Math.round(width*ratio),height:Math.round(height*ratio)};
}
export function applyQuality(viewer,C,name='balanced'){
  const canvas=viewer.scene.canvas,p=qualityPlan(name,canvas.clientWidth,canvas.clientHeight,globalThis.devicePixelRatio||1),applied=[],unsupported=[];
  const set=(object,key,value)=>{try{if(object&&key in object){object[key]=value;applied.push(key);return true;}}catch{}unsupported.push(key);return false;};
  const native=set(viewer,'useBrowserRecommendedResolution',false);
  set(viewer,'resolutionScale',native?p.resolutionScale:p.pixelRatio);
  set(viewer.scene.postProcessStages?.fxaa,'enabled',true);
  set(viewer.scene.globe,'maximumScreenSpaceError',p.terrainSse);
  if(viewer.shadowMap){set(viewer.shadowMap,'softShadows',true);set(viewer.shadowMap,'size',p.shadowSize);}
  let tilesets=0,visited=0;const seen=new Set();
  function scan(collection,depth=0){
    if(!collection||seen.has(collection)||depth>3||visited>250)return;seen.add(collection);
    if(typeof collection.get!=='function'||!Number.isInteger(collection.length))return;
    for(let i=0;i<collection.length&&visited++<250;i++){
      let object;try{object=collection.get(i);}catch{continue;}
      if(C?.Cesium3DTileset&&object instanceof C.Cesium3DTileset){set(object,'maximumScreenSpaceError',p.sse);tilesets++;}
      else scan(object,depth+1);
    }
  }
  scan(viewer.scene.primitives);viewer.resize?.();viewer.scene.requestRender?.();
  return {plan:p,applied:[...new Set(applied)],unsupported:[...new Set(unsupported)],publicTilesets:tilesets,
    note:'화면 해상도·계단 현상·공개 LOD 설정만 조정합니다. 원본 사진·건물의 상세도를 새로 만들지 않습니다.'};
}
