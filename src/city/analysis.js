import {distance,inside,representative} from './geometry.js';
export function numeric(v){if(v===null||v===undefined||String(v).trim()===''||String(v)==='-')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
export function terrainGrid(center,spacing=30,size=7){const out=[],cx=(size-1)/2;for(let y=0;y<size;y++)for(let x=0;x<size;x++)out.push([center[0]+(x-cx)*spacing/(111320*Math.cos(center[1]*Math.PI/180)),center[1]+(y-cx)*spacing/111320]);return out;}
export function slopeSummary(heights,spacing=30,size=7){const slopes=[];for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
 const i=y*size+x;const h=[heights[i-1],heights[i+1],heights[i-size],heights[i+size]];
 if(h.every(Number.isFinite)){const gradient=Math.hypot((h[1]-h[0])/(2*spacing),(h[3]-h[2])/(2*spacing));slopes.push({index:i,percent:gradient*100,degrees:Math.atan(gradient)*180/Math.PI});}}
 return {sampleCount:heights.length,validHeights:heights.filter(Number.isFinite).length,validCells:slopes.length,totalCells:(size-2)**2,meanDegrees:slopes.length?slopes.reduce((s,a)=>s+a.degrees,0)/slopes.length:null,maxDegrees:slopes.length?Math.max(...slopes.map(a=>a.degrees)):null,slopes};}
export function profilePoints(a,b,count=64){return Array.from({length:count},(_,i)=>[a[0]+(b[0]-a[0])*i/(count-1),a[1]+(b[1]-a[1])*i/(count-1)]);}
export function nearby(point,features,meters=3000){return features.map(f=>({feature:f,distance:distance(point,representative(f.geometry))})).filter(r=>r.distance<=meters).sort((a,b)=>a.distance-b.distance);}
export function parseGlb(buffer){if(buffer.byteLength>25*1024*1024)throw new Error('GLB는 25MB 이하여야 합니다.');if(buffer.byteLength<20)throw new Error('GLB 헤더가 없습니다.');const view=new DataView(buffer);if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==buffer.byteLength)throw new Error('GLB 2.0 파일이 아닙니다.');
 let offset=12,doc=null;while(offset+8<=buffer.byteLength){const n=view.getUint32(offset,true),type=view.getUint32(offset+4,true);offset+=8;if(n%4||offset+n>buffer.byteLength)throw new Error('GLB 청크 길이 오류');if(type===0x4e4f534a){if(doc)throw new Error('중복 JSON 청크');doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,n)));}offset+=n;}
 if(!doc||offset!==buffer.byteLength)throw new Error('GLB 본문 오류');
 for(const item of [...(doc.buffers||[]),...(doc.images||[])])if(item.uri&&!/^data:(application\/octet-stream|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(item.uri))throw new Error('외부 파일을 참조하지 않는 내장형 GLB만 사용할 수 있습니다.');
 if(doc.extensionsRequired?.length)throw new Error('압축·외부 확장 의존성이 없는 GLB를 사용하세요.');return {meshes:doc.meshes?.length||0};}
export function modelResultValid(raw){const m=raw?.metadata;if(!m||!m.sourceName||!m.modelName||!m.scenario||!m.generatedAt||!m.variable||!m.unit||!m.validationStatus)throw new Error('분석모형·시나리오·출처·생성시각·변수·단위·검증상태가 필요합니다.');if(!['unverified','provider-validated'].includes(m.validationStatus))throw new Error('검증상태 형식 오류');return m;}
