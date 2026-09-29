import {representative,distance} from './geometry.js';
import {RESILIENCE_PRESETS} from './resilience-tools.js';

const el=id=>document.getElementById(id);
const value=(v,unit)=>typeof v==='number'&&Number.isFinite(v)?`${v}${unit}`:'미관측';
const time=(date,clock)=>date&&clock?`${date.slice(4,6)}/${date.slice(6,8)} ${clock.slice(0,2)}:${clock.slice(2)} 관측`:'관측시각 미확인';

export function createLiveStatus({state,fetchJSON,label}){
 let sequence=0,weatherCache=new Map(),airCache=new Map();
 const place=()=>state.dong==='all'?representative(state.district):state.dongs.find(f=>f.properties.dongId===state.dong)?.properties.labelPoint||representative(state.scope);
 function render(key){
  const weather=weatherCache.get(key),air=airCache.get(key);
  el('live-place').textContent=label();
  el('live-temperature').textContent=weather?value(weather.data.values?.T1H,'℃'):'미수신';
  el('live-rainfall').textContent=weather?value(weather.data.values?.RN1,'mm'):'미수신';
  el('live-air').textContent=air?value(air.data.pm10,'㎍/㎥'):'미수신';
  const tracked=new Set(RESILIENCE_PRESETS.flatMap(p=>p.layers));
  const received=[...state.entries].filter(([id,e])=>tracked.has(id)&&e.state==='loaded'&&e.features?.length).length;
  el('live-safety').textContent=`관련 자료 ${received}종`;
  const notes=[];
  if(weather)notes.push(`기상청 격자 ${time(weather.data.base?.base_date,weather.data.base?.base_time)}${weather.stale?' · 갱신 실패':''}`);
  if(air)notes.push(`${air.data.station} 측정소 ${air.data.observedAt||'시각 미확인'}${air.stale?' · 갱신 실패':''}`);
  el('live-observed').textContent=notes.join(' / ')||'관측자료 미수신 · 연결 설정을 확인하세요.';
 }
 async function refresh(){
  const id=++sequence,key=state.dong,p=place();if(!p)return;
  render(key);
  const weather=fetchJSON(`/api/weather?lon=${p[0]}&lat=${p[1]}`);
  const stations=fetchJSON('/api/city-data?kind=air-stations&dong=all&page=1');
  const [w,a]=await Promise.allSettled([weather,stations]);if(id!==sequence)return;
  if(w.status==='fulfilled'&&w.value?.base&&w.value.values)weatherCache.set(key,{data:w.value,stale:false});
  else if(weatherCache.has(key))weatherCache.set(key,{...weatherCache.get(key),stale:true});
  render(key);
  if(a.status==='fulfilled'){
   const nearest=(a.value.geojson?.features||[]).filter(f=>f.geometry?.type==='Point'&&f.properties?.stationName).sort((x,y)=>distance(p,x.geometry.coordinates)-distance(p,y.geometry.coordinates))[0];
   if(nearest){try{const result=await fetchJSON(`/api/city-data?kind=air&station=${encodeURIComponent(nearest.properties.stationName)}`);if(id!==sequence)return;airCache.set(key,{data:result,stale:false});}
   catch{if(airCache.has(key))airCache.set(key,{...airCache.get(key),stale:true});}}
  }else if(airCache.has(key))airCache.set(key,{...airCache.get(key),stale:true});
  if(id===sequence)render(key);
 }
 const timer=setInterval(refresh,10*60*1000);
 return {refresh,scopeChanged:refresh,render:()=>render(state.dong),destroy(){sequence++;clearInterval(timer);}};
}
