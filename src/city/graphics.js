/* Supported public properties only. No SDK-private tilesets / scene internals. */
export const QUALITY={economy:{ratio:1,pixels:3500000,sse:3,shadowSize:1024},balanced:{ratio:1.25,pixels:6500000,sse:2,shadowSize:2048},crisp:{ratio:1.75,pixels:8500000,sse:1,shadowSize:2048}};
export function qualityScale(mode,width,height,dpr=1){const p=QUALITY[mode]||QUALITY.balanced;const area=Math.max(1,(Number(width)||1)*(Number(height)||1)),desired=p.ratio;return Math.max(.5,Math.min(desired,Math.sqrt(p.pixels/area)));}
export function applyQuality(viewer,mode='balanced',dpr=1){const p=QUALITY[mode]||QUALITY.balanced,scene=viewer?.scene,canvas=scene?.canvas;const applied=[],unsupported=[];if(!scene||!canvas)throw Error('지도 렌더러가 아직 준비되지 않았습니다.');
 const assign=(o,k,v)=>{if(!o||!(k in o)){unsupported.push(k);return;}try{o[k]=v;applied.push(k);}catch{unsupported.push(k);}};
 const scale=qualityScale(mode,canvas.clientWidth||1,canvas.clientHeight||1,dpr);
 // CSS-based resolution with explicit capped scale avoids DPR × supersampling multiplication.
 assign(viewer,'useBrowserRecommendedResolution',true);assign(viewer,'resolutionScale',scale);
 assign(scene.postProcessStages?.fxaa,'enabled',true);assign(scene.globe,'maximumScreenSpaceError',p.sse);
 assign(viewer.shadowMap||scene.shadowMap,'size',p.shadowSize);assign(viewer.shadowMap||scene.shadowMap,'softShadows',true);
 viewer.resize?.();scene.requestRender?.();return {mode,scale:+scale.toFixed(3),applied,unsupported,css:[canvas.clientWidth,canvas.clientHeight],buffer:[canvas.width,canvas.height],note:'렌더링 선명도 설정입니다. 원본 영상의 해상도·건물 상세도를 새로 생성하지 않습니다.'};
}
export function displayOptions(input={}){return {maskOpacity:Math.max(0,Math.min(.8,Number.isFinite(+input.maskOpacity)?+input.maskOpacity:.25)),boundaryOpacity:Math.max(0,Math.min(.25,Number.isFinite(+input.boundaryOpacity)?+input.boundaryOpacity:.055)),labels:input.labels!==false};}

// These two public IDs come from the supplied VWorld examples, not internal tileset guesses.
export function setBuildingStyle(map,requested='detailed') {
 const mode=requested==='standard'?'standard':'detailed',id=mode==='detailed'?'facility_build_all':'facility_build',other=mode==='detailed'?'facility_build':'facility_build_all';
 function find(name){try{return map?.getLayerElement?.(name)||map?.getElementById?.(name);}catch{return null;}}
 const layer=find(id),old=find(other);
 if(typeof layer?.show!=='function')return {requested:mode,applied:false,sourceId:null,note:'현재 SDK에서 해당 공개 건물 레이어를 확인하지 못했습니다. 기존 표시를 유지합니다.'};
 try {layer.show();}catch{return {requested:mode,applied:false,sourceId:null,note:'건물 레이어 전환 요청이 실패했습니다. 기존 표시를 유지합니다.'};}
 let retainedOther=false;
 try{if(old&&old!==layer&&typeof old.hide==='function')old.hide();}catch{retainedOther=true;}
 return {requested:mode,applied:true,sourceId:id,retainedOther,note:'공급자 건물 레이어 표시 요청을 적용했습니다. 실제 타일 수신·원본 상세도는 별도 확인해야 합니다.'};
}

/** Apply brightness only to base imagery, never thematic imagery or classified pixel values. */
export function applyBaseBrightness(viewer,options={},excluded=new Set()){
 const brightness=Math.max(.7,Math.min(1.5,Number.isFinite(+options.brightness)?+options.brightness:1.12));let applied=0;
 const layers=viewer?.imageryLayers;
 if(layers?.get)for(let i=0;i<layers.length;i++){const layer=layers.get(i);if(!excluded.has(layer)&&'brightness' in layer){layer.brightness=brightness;applied++;}}
 viewer?.scene?.requestRender?.();return {brightness,applied,note:applied?`기본 영상 ${applied}개 층에 밝기 ${Math.round(brightness*100)}% 적용 · 주제도 색은 유지`:'변경 가능한 기본 영상이 없습니다. UI 테마만 적용했습니다.'};
}
