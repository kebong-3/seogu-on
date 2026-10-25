/* Geometry shared by browser and API. Source polygons, never point buffers, define facility areas. */
import '../vendor/polygon-clipping.js';
import { pointInGeometry, locateDong, coordinatesOf as baseCoordinates } from '../admin.js';
export { pointInGeometry, locateDong };
export function coordinatesOf(g){return g?.type==='MultiLineString'?g.coordinates.flat():baseCoordinates(g);}
export function boundsOf(g){const points=coordinatesOf(g);return points.length?points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]):null;}
export const pc = globalThis.polygonClipping;
export const PALETTE = ['#6ed9ca','#82b0fc','#f4ca72','#db9cee','#8ed48b','#fc9e88','#69ccec','#f08db2','#b4b7fb','#c7d87c','#65cba9','#d6b494','#9cdcf3','#ffaeca','#adb6dc','#e6d193','#85c0bb','#caa5da'];
export const fc = (features=[]) => ({type:'FeatureCollection',features});
export function multi(geometry) { return geometry?.type==='MultiPolygon' ? geometry.coordinates : geometry?.type==='Polygon' ? [geometry.coordinates] : []; }
export function asGeometry(polygons) { return polygons?.length ? {type:'MultiPolygon',coordinates:polygons} : null; }
export function unionGeometry(features) {
  const parts=features.flatMap(f=>multi(f.geometry||f));
  return parts.length ? asGeometry(pc.union(...parts)) : null;
}
export function clipPolygon(geometry,scope) {
  const a=multi(geometry),b=multi(scope); if(!a.length||!b.length)return null;
  return asGeometry(pc.intersection(a,b));
}
export function maskGeometry(scope,outer=[126.0,34.5,127.6,35.8]) {
  const [w,s,e,n]=outer;
  return asGeometry(pc.difference([[[w,s],[e,s],[e,n],[w,n],[w,s]]],multi(scope)));
}
export function inside(point,scope) { return Array.isArray(point)&&point.slice(0,2).every(Number.isFinite)&&pointInGeometry(point,scope); }
function cuts(a,b,c,d) {
  const rx=b[0]-a[0],ry=b[1]-a[1],sx=d[0]-c[0],sy=d[1]-c[1];
  const den=rx*sy-ry*sx; if(Math.abs(den)<1e-14)return [];
  const t=((c[0]-a[0])*sy-(c[1]-a[1])*sx)/den, u=((c[0]-a[0])*ry-(c[1]-a[1])*rx)/den;
  return t>0&&t<1&&u>=0&&u<=1?[t]:[];
}
export function clipLine(line,scope) {
  const rings=multi(scope).flat(); const result=[];let current=[];
  const append=(a,b)=>{if(current.length&&Math.hypot(current.at(-1)[0]-a[0],current.at(-1)[1]-a[1])>1e-9){result.push(current);current=[];} if(!current.length)current.push(a);current.push(b);};
  for(let i=1;i<line.length;i++) {
    const a=line[i-1],b=line[i]; const ts=[0,1];
    for(const r of rings)for(let j=1;j<r.length;j++)ts.push(...cuts(a,b,r[j-1],r[j]));
    const unique=[...new Set(ts.map(t=>+t.toFixed(12)))].sort((x,y)=>x-y);
    const at=t=>[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
    for(let j=1;j<unique.length;j++) {
      if(inside(at((unique[j-1]+unique[j])/2),scope))append(at(unique[j-1]),at(unique[j]));
      else if(current.length){result.push(current);current=[];}
    }
  }
  if(current.length)result.push(current);return result.filter(a=>a.length>1);
}
export function clipFeature(feature,scope) {
  const g=feature?.geometry;if(!g)return null;let geometry;
  if(g.type==='Point')return inside(g.coordinates,scope)?feature:null;
  if(['Polygon','MultiPolygon'].includes(g.type))geometry=clipPolygon(g,scope);
  else if(['LineString','MultiLineString'].includes(g.type)){
    const lines=(g.type==='LineString'?[g.coordinates]:g.coordinates).flatMap(l=>clipLine(l,scope));
    geometry=lines.length?{type:'MultiLineString',coordinates:lines}:null;
  }
  return geometry?{...feature,geometry,properties:{...feature.properties,displayClipped:true}}:null;
}
export function representative(g) {
  if(g?.type==='Point')return g.coordinates.slice(0,2);
  const b=boundsOf(g); if(!b)return null;
  const center=[(b[0]+b[2])/2,(b[1]+b[3])/2];
  if(!multi(g).length||inside(center,g))return center;
  for(let i=1;i<20;i++)for(let j=1;j<20;j++){
    const p=[b[0]+(b[2]-b[0])*i/20,b[1]+(b[3]-b[1])*j/20];if(inside(p,g))return p;
  }
  return coordinatesOf(g)[0]?.slice(0,2)||null;
}
export function distance(a,b){const r=Math.PI/180;const x=(b[0]-a[0])*r*Math.cos((a[1]+b[1])/2*r),y=(b[1]-a[1])*r;return 6371008.8*Math.hypot(x,y);}
export function validGeometry(g,{maxVertices=25000,bounds=[126.6,34.9,127.1,35.4]}={}){
  if(!g||!['Point','LineString','MultiLineString','Polygon','MultiPolygon'].includes(g.type))return false;
  if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])return false;
  let points;try{points=coordinatesOf(g);}catch{return false;}
  if(!points.length||points.length>maxVertices||points.some(p=>p.length<2||!p.slice(0,2).every(Number.isFinite)||p[0]<bounds[0]||p[0]>bounds[2]||p[1]<bounds[1]||p[1]>bounds[3]))return false;
  if(multi(g).length)for(const poly of multi(g))for(const r of poly)if(r.length<4||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])return false;
  return true;
}
export function filterFeatures(features,scope){const out=[];for(const f of features){try{const clipped=clipFeature(f,scope);if(clipped)out.push(clipped);}catch{/* Invalid polygons are not silently drawn. */}}return out;}
export function mercator(p){return [p[0]*20037508.342789244/180,Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360))*6378137];}
export function unmercator(p){return [p[0]/20037508.342789244*180,(2*Math.atan(Math.exp(p[1]/6378137))-Math.PI/2)*180/Math.PI];}
export function boundsOverlap(a,b){return a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];}
export function csv(rows){return '\ufeff'+rows.map(r=>r.map(v=>{let t=String(v??'');if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
