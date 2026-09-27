/* Geometric solar direction and a FLAT, vertical-prism shadow approximation.
   No terrain, trees, clouds, roof shape, diffuse light or legal sunshine certification. */
import {pc,multi,asGeometry,boundsOf,boundsOverlap,representative} from './geometry.js';
const R=Math.PI/180;
export function parseKst(value){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value||''))throw Error('한국시간 날짜·시각 형식을 확인하세요.');const d=new Date(value+':00+09:00');if(!Number.isFinite(+d)||new Date(+d+9*3600000).toISOString().slice(0,16)!==value||+value.slice(0,4)<2000||+value.slice(0,4)>2100)throw Error('2000~2100년의 실제 날짜·시각을 입력하세요.');return d;}
export function solarPosition(date,lon,lat){if(!(date instanceof Date)||!Number.isFinite(+date)||!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>89)throw Error('태양 위치 입력 오류');
 const day=(+date/86400000+2440587.5)-2451545,mean=R*(357.5291+.98560028*day),center=R*(1.9148*Math.sin(mean)+.02*Math.sin(2*mean)+.0003*Math.sin(3*mean)),lambda=mean+center+R*(102.9372+180),e=23.4397*R;
 const dec=Math.asin(Math.sin(lambda)*Math.sin(e)),ra=Math.atan2(Math.sin(lambda)*Math.cos(e),Math.cos(lambda)),hour=R*(280.16+360.9856235*day+lon)-ra,phi=lat*R;
 const altitude=Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(hour))/R;
 const azimuth=((Math.atan2(Math.sin(hour),Math.cos(hour)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi))/R+180)%360+360)%360;
 return {altitude,azimuth,night:altitude<=0};}
export function shadowOffset(height,sun,lat){if(!Number.isFinite(height)||height<=0||height>1000||sun.altitude<=3)return null;const length=height/Math.tan(sun.altitude*R);if(!Number.isFinite(length)||length>1500)return null;return {dx:-Math.sin(sun.azimuth*R)*length/(111320*Math.cos(lat*R)),dy:-Math.cos(sun.azimuth*R)*length/111320,length};}
export function prismShadow(geometry,offset){const polygons=multi(geometry);if(!polygons.length||!offset)return null;const shifted=polygons.map(poly=>poly.map(r=>r.map(([x,y])=>[x+offset.dx,y+offset.dy]))),walls=[];
 for(const poly of polygons)for(const ring of poly)for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i];const quad=[a,b,[b[0]+offset.dx,b[1]+offset.dy],[a[0]+offset.dx,a[1]+offset.dy],a];const area=(b[0]-a[0])*offset.dy-(b[1]-a[1])*offset.dx;if(Math.abs(area)>1e-15)walls.push([quad]);}
 return asGeometry(pc.difference(pc.union(polygons,shifted,...walls),polygons));}
export async function calculateShadows(buildings,scope,time,{includeLevels=false,cancelled=()=>false}={}){const date=parseKst(time),center=representative(scope);if(!center)throw Error('선택 구역이 없습니다.');const sun=solarPosition(date,...center),stats={inputs:buildings.length,eligible:0,projected:0,missingHeight:0,approximateHeight:0,lowSunSkipped:0,geometryRejected:0};
 if(sun.altitude<=3)return {features:[],sun,stats,state:sun.night?'night':'low-sun',time,note:sun.night?'태양이 지평선 아래입니다. 건물 그늘 면 계산을 표시하지 않습니다.':'태양 고도 3도 이하에서는 오차와 그림자 길이가 커 계산을 보류합니다.'};
 const sb=boundsOf(scope),features=[];
 for(let i=0;i<buildings.length;i++){if(cancelled())throw Error('그늘 계산이 중지되었습니다.');const f=buildings[i],p=f.properties||{},basis=p.heightBasis;if(!['tagged','surveyed','levels-estimate'].includes(basis)){stats.missingHeight++;continue;}if(basis==='levels-estimate'&&!includeLevels)continue;stats.eligible++;if(basis==='levels-estimate')stats.approximateHeight++;const off=shadowOffset(p.height,sun,center[1]);if(!off){stats.lowSunSkipped++;continue;}
  const b=boundsOf(f.geometry);if(!b)continue;const extended=[Math.min(b[0],b[0]+off.dx),Math.min(b[1],b[1]+off.dy),Math.max(b[2],b[2]+off.dx),Math.max(b[3],b[3]+off.dy)];if(!boundsOverlap(extended,sb))continue;
  try{const g=prismShadow(f.geometry,off);const clipped=g&&asGeometry(pc.intersection(multi(g),multi(scope)));if(clipped){features.push({type:'Feature',geometry:clipped,properties:{id:'shade-'+p.id,name:p.name||'건물 그늘 근사',sourceName:p.sourceName,sourceUrl:p.sourceUrl,sourceDate:null,calculatedAt:new Date().toISOString(),scenarioTime:time+'+09:00',height:p.height,heightBasis:basis,shadowLength:Math.round(off.length),note:'수직기둥·평탄면 가정. 관측 그늘·안전/열환경 판정이 아님.'}});stats.projected++;}}catch{stats.geometryRejected++;}
  if(i%60===0)await new Promise(r=>setTimeout(r,0));
 }
 return {features,sun,stats,state:'calculated',time,note:'포함된 건물만 사용하는 평탄면 그늘 근사입니다. 면별 중첩을 합산하지 않습니다. 나무·지형·구름·미수록 건물 미반영. 높이 미상 건물은 계산에서 제외.'};}
