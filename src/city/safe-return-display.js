/** Keep the image reference layer visually separate from the live TMAP route. */
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=124&&p[0]<=132&&p[1]>=32&&p[1]<=40;
export function isSafeReturnLine(feature){
 const geometry=feature?.geometry,lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
 return lines.length>0&&lines.length<=100&&lines.every(coordinates=>Array.isArray(coordinates)&&coordinates.length>=2&&coordinates.length<=5000&&coordinates.every(point)&&coordinates.some(p=>p[0]!==coordinates[0][0]||p[1]!==coordinates[0][1]));
}
export function safeReturnMapFeatures(collection,routeId='all'){
 const features=Array.isArray(collection?.features)?collection.features:[];
 return features.slice(0,500).flatMap((feature,index)=>{
  const p=feature?.properties||{},id=p.routeId||p.id,geometry=feature?.geometry;
  if(typeof id!=='string'||routeId!=='all'&&id!==routeId)return [];
  const lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
  const line=isSafeReturnLine(feature);
  const marker=geometry?.type==='Point'&&point(geometry.coordinates);
  if(!line&&!marker)return [];
  const kind=({'cctv-bell':'CCTV·비상벨','cctv':'CCTV','logo-projector':'로고젝터','route-sign':'위치표지'})[p.facilityType]||'경찰지도 시설';
  return [{type:'Feature',geometry,properties:{...p,id:`safe-return-reference:${p.id||id}:${index}`,safeReturnId:id,name:line?`${p.name||'귀갓길'} · 지도 판독선`:`${kind} · ${p.routeName||p.name||'지도 판독 위치'}`,category:line?'귀갓길 지도 판독선':kind,displayColor:line?'#f18720':p.facilityType==='cctv-bell'?'#2358d5':p.facilityType==='cctv'?'#9b3c74':'#a56a14',sourceName:p.sourceName||collection.metadata?.sourceName||'경찰 공개지도 판독',sourceDate:p.sourceDate||collection.metadata?.sourceDate||null,note:'공식 지도 이미지를 실제 지도와 맞춘 참고 위치입니다. 공식 측량좌표·현재 시설 작동·안전 판정이 아닙니다.',safeReturnReference:true,referenceGeometry:true}}];
 });
}
