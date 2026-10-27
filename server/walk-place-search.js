import {fetchJsonLimited,safeDomain} from './http.js';
import {pointInRegion} from '../shared/region-profile.js';

const bad=(status,code,message)=>Object.assign(new Error(message),{status,code});
const clean=value=>String(value??'').trim().slice(0,240);
/** Search only the selected region; no supplied URLs, keys, or persisted location history. */
export async function searchWalkPlaces(query,pack,{env=process.env,fetcher=fetch}={}){
  const q=typeof query==='string'?query.trim():'';
  if(q.length<2||q.length>100||/[\u0000-\u001f]/.test(q))throw bad(400,'WALK_SEARCH_QUERY','장소명이나 도로명주소를 2~100자로 입력해 주세요.');
  const terms=q.toLocaleLowerCase().split(/\s+/),items=pack.candidates.filter(c=>c.routeEligible!==false&&terms.every(term=>`${c.name} ${c.address||''}`.toLocaleLowerCase().includes(term))).slice(0,20).map(c=>({...c}));
  const key=env.VWORLD_API_KEY,domain=safeDomain(env.VWORLD_DOMAIN||'');
  if(!key||!domain)return {ok:true,region:{id:pack.profile.id},items,providerAvailable:false,notice:'수록시설에서 찾았어요. 주소·장소 검색 연결 전에는 지도에서 위치를 선택할 수 있어요.'};
  const outcomes=await Promise.allSettled([{type:'place'},{type:'address',category:'road'},{type:'address',category:'parcel'}].map(async kind=>{
    const url=new URL('https://api.vworld.kr/req/search');
    for(const [name,value]of Object.entries({service:'search',request:'search',version:'2.0',format:'json',crs:'EPSG:4326',size:20,page:1,bbox:pack.profile.bounds.join(','),query:q,key,domain,...kind}))url.searchParams.set(name,value);
    const body=await fetchJsonLimited(url,7000,fetcher),response=body.response;
    if(!response||!['OK','NOT_FOUND'].includes(response.status))throw Error('Search provider unavailable');
    return (response.result?.items||[]).slice(0,20).map(item=>{
      const coordinate=[Number(item.point?.x),Number(item.point?.y)],address=clean(item.address?.road||item.address?.parcel);
      return {name:clean(item.title||address),address,coordinate,sourceName:'브이월드 장소·주소 검색',sourceDate:null};
    }).filter(item=>item.name&&item.coordinate.every(Number.isFinite)&&pointInRegion(item.coordinate,pack.boundaries));
  }));
  const seen=new Set(items.map(item=>`${item.name}:${item.coordinate.join(',')}`));
  for(const outcome of outcomes)if(outcome.status==='fulfilled')for(const item of outcome.value){const signature=`${item.name}:${item.coordinate.join(',')}`;if(seen.has(signature))continue;seen.add(signature);items.push({...item,id:`search:${pack.profile.id}:${items.length}`,routeEligible:true});}
  const providerAvailable=outcomes.some(outcome=>outcome.status==='fulfilled');
  return {ok:true,region:{id:pack.profile.id},items:items.slice(0,30),providerAvailable,notice:providerAvailable?'선택 지역 안의 검색 결과입니다. 실제 출입구는 지도에서 확인해 주세요.':'장소 검색 연결이 지연되어 수록시설 결과만 표시해요. 지도에서 직접 선택할 수도 있어요.'};
}
