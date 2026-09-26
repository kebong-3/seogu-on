/** WGS84 administrative geometry. No Voronoi/fabricated boundaries or nearest-dong assignment. */
export const DONG_NAMES = Object.freeze('양동 양3동 농성1동 농성2동 광천동 유덕동 치평동 상무1동 상무2동 화정1동 화정2동 화정3동 화정4동 서창동 금호1동 금호2동 풍암동 동천동'.split(' '));
export const pointOK = c => Array.isArray(c) && c.length >= 2 && c.slice(0,2).every(Number.isFinite) && c[0]>=126.70 && c[0]<=127.05 && c[1]>=34.98 && c[1]<=35.35;
const EPS = 1e-10;
function onSegment(p,a,b) {
  const cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);
  return Math.abs(cross)<=EPS && p[0]>=Math.min(a[0],b[0])-EPS && p[0]<=Math.max(a[0],b[0])+EPS && p[1]>=Math.min(a[1],b[1])-EPS && p[1]<=Math.max(a[1],b[1])+EPS;
}
/** 0 outside, 1 inside, 2 on an edge. */
export function ringLocation(p, ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];
    if(onSegment(p,a,b)) return 2;
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside?1:0;
}
export function pointInGeometry(p,g){
  if(!g) return false;
  const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  return polygons.some(rings=>{const outer=ringLocation(p,rings[0]);if(!outer)return false;if(outer===2)return true;return !rings.slice(1).some(r=>ringLocation(p,r)===1);});
}
export function coordinatesOf(g){
  if(!g)return [];
  if(g.type==='Point')return [g.coordinates];
  if(g.type==='LineString')return g.coordinates;
  if(g.type==='Polygon')return g.coordinates.flat();
  if(g.type==='MultiPolygon')return g.coordinates.flat(2);
  return [];
}
export function boundsOf(g){
  const pts=coordinatesOf(g);if(!pts.length)return null;
  return pts.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
}
function intersectsSegments(a,b,c,d){
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b))return true;
  return (cross(a,b,c)>0)!==(cross(a,b,d)>0)&&(cross(c,d,a)>0)!==(cross(c,d,b)>0);
}
function segments(g){
  const rings=g.type==='LineString'?[g.coordinates]:g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():[];
  return rings.flatMap(r=>r.slice(1).map((p,i)=>[r[i],p]));
}
export function geometryIntersects(a,b){
  const x=boundsOf(a),y=boundsOf(b);if(!x||!y||x[2]<y[0]||y[2]<x[0]||x[3]<y[1]||y[3]<x[1])return false;
  if(coordinatesOf(a).some(p=>pointInGeometry(p,b))||coordinatesOf(b).some(p=>pointInGeometry(p,a)))return true;
  const bs=segments(b);return segments(a).some(([p,q])=>bs.some(([r,s])=>intersectsSegments(p,q,r,s)));
}
export function validateBoundary(raw){
  if(raw?.type!=='FeatureCollection'||!Array.isArray(raw.features)||raw.features.length!==18)throw new Error('행정동 경계는 18개 도형을 모두 포함해야 합니다. 법정동·일부 동은 대신 사용하지 않습니다.');
  if(raw.metadata?.boundaryType!=='administrative-dong'||!raw.metadata?.sourceName||!/^\d{4}-\d{2}-\d{2}$/.test(raw.metadata?.sourceDate||''))throw new Error('행정동 자료 구분·출처·기준일이 필요합니다.');
  let vertices=0;const seen=new Set();
  const features=raw.features.map(f=>{
    const p=f?.properties||{},name=String(p.dongName||p.adm_nm?.split(' ').at(-1)||'').replace('제','');
    if(!DONG_NAMES.includes(name)||seen.has(name))throw new Error('서구 18개 행정동 명칭·중복을 확인하세요.');seen.add(name);
    const g=f.geometry;if(!['Polygon','MultiPolygon'].includes(g?.type))throw new Error('행정동은 Polygon 또는 MultiPolygon 도형이어야 합니다.');
    const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
    if(!Array.isArray(polys)||!polys.length)throw new Error('빈 경계 도형입니다.');
    for(const rings of polys){if(!rings.length)throw new Error('경계 고리가 없습니다.');for(const r of rings){vertices+=r.length;if(r.length<4||!r.every(pointOK)||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])throw new Error('경계 좌표·고리 닫힘·EPSG:4326을 확인하세요.');}}
    if(vertices>150000)throw new Error('경계 도형은 150,000개 이하의 꼭짓점이어야 합니다.');
    const id='seogu-'+String(DONG_NAMES.indexOf(name)+1).padStart(2,'0');
    const label=pointOK(p.labelPoint)&&pointInGeometry(p.labelPoint,g)?p.labelPoint:g.coordinates.flat(g.type==='MultiPolygon'?2:1)[0];
    return {type:'Feature',id,geometry:g,properties:{dongId:id,dongName:name,adm_cd:String(p.adm_cd||''),adm_cd2:String(p.adm_cd2||''),labelPoint:label,bounds:boundsOf(g)}};
  });
  return {type:'FeatureCollection',features:features.sort((a,b)=>a.properties.dongId.localeCompare(b.properties.dongId)),metadata:{...raw.metadata}};
}
export function locateDong(point,boundaries){
  const matches=boundaries?.features.filter(f=>{const b=f.properties.bounds||boundsOf(f.geometry);return point[0]>=b[0]-EPS&&point[0]<=b[2]+EPS&&point[1]>=b[1]-EPS&&point[1]<=b[3]+EPS&&pointInGeometry(point,f.geometry);})||[];
  return {inDistrict:matches.length>0,dongId:matches.length===1?matches[0].properties.dongId:null,dongName:matches.length===1?matches[0].properties.dongName:null,ambiguous:matches.length>1};
}
export function assignDongs(features,boundaries){
  return features.map(f=>({...f,properties:{...f.properties,...locateDong(f.geometry.coordinates,boundaries)}}));
}
export function dongCounts(features,boundaries){
  const counts=Object.fromEntries((boundaries?.features||[]).map(f=>[f.properties.dongId,0]));
  for(const f of features)if(f.properties.dongId in counts)counts[f.properties.dongId]++;
  return counts;
}
export async function loadBoundary(fetcher=fetch){
  const r=await fetcher('/data/admin-dongs.geojson',{signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('행정동 경계 파일을 읽지 못했습니다.');return validateBoundary(await r.json());
}
