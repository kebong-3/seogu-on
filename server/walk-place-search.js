import {fetchJsonLimited,safeDomain} from './http.js';
import {pointInRegion,validCoordinate} from '../shared/region-profile.js';

const bad=(status,code,message)=>Object.assign(new Error(message),{status,code});
const clean=value=>typeof value==='string'?value.trim().slice(0,240):'';
const normalize=value=>clean(value).normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
const compact=value=>normalize(value).replace(/\s/gu,'');
// Explicit search equivalences only. They do not rename records or infer legal jurisdiction.
const ALIASES=Object.freeze([
  ['전남광주통합특별시','광주광역시'],
  ['장난감대여소','장난감도서관'],
  ['유아도서관','어린이도서관'],
  ['수유방','수유실'],
]);
// Reviewed dataset types also cover official names such as 어린이생태학습도서관.
const FACILITY_TYPES=Object.freeze({'care-toys':'장난감도서관','care-libraries':'어린이도서관','care-nursing':'수유실'});
const aliasText=value=>ALIASES.reduce((text,[from,to])=>text.replaceAll(from,to),compact(value));
const spacedAliasText=value=>ALIASES.reduce((text,[from,to])=>{
  for(const form of [from,to])text=text.replace(new RegExp([...form].join('\\s*'),'gu'),to);
  return text;
},normalize(value));

function normalizedMatch(query,candidate,regionId,aliases=false){
  const convert=aliases?aliasText:compact;
  const fields=[convert(candidate.name),convert(candidate.address)];
  if(aliases&&Object.hasOwn(FACILITY_TYPES,candidate.datasetId))fields.push(convert(FACILITY_TYPES[candidate.datasetId]));
  const joined=convert(query);
  if(fields.some(field=>field.includes(joined)))return true;
  const parts=(aliases?spacedAliasText(query):normalize(query)).split(' ').map(convert);
  // Single-character fragments must not become a broad character-presence search.
  if(parts.length>1&&parts.every(part=>part.length>=2&&fields.some(field=>field.includes(part))))return true;
  // A joined region + facility name need not be adjacent in the source address.
  const district=regionId==='seogu'?'서구':regionId==='suncheon'?'순천시':null;
  if(district)for(const region of [district,'광주광역시'+district,'전남광주통합특별시'+district]){
    const prefix=convert(region),rest=joined.startsWith(prefix)?joined.slice(prefix.length):'';
    if(rest.length>=2&&fields[1].includes(prefix)&&fields.some(field=>field.includes(rest)))return true;
  }
  return false;
}

function matchDetails(query,candidate,regionId,{provider=false}={}){
  const direct=[candidate.name,candidate.address].some(value=>typeof value==='string'&&value.toLowerCase().includes(query.toLowerCase()));
  if(direct)return {matchType:'direct',aliasMatch:false,approximate:false,matchNote:'수록 명칭·주소에 검색어가 포함됩니다.'};
  if(normalizedMatch(query,candidate,regionId))return {matchType:'normalized',aliasMatch:false,approximate:false,matchNote:'문자·띄어쓰기를 정리해 찾은 결과입니다. 실제 명칭·주소를 확인해 주세요.'};
  if(normalizedMatch(query,candidate,regionId,true))return {matchType:'alias',aliasMatch:true,approximate:false,matchNote:'등록된 시설 분류·별칭·지역명 표기로 찾은 결과입니다. 실제 명칭·주소를 확인해 주세요.'};
  return provider?{matchType:'provider',aliasMatch:false,approximate:true,matchNote:'외부 장소검색 후보입니다. 검색어와 실제 명칭·주소가 맞는지 확인해 주세요.'}:null;
}

function noticeFor(items,providerAvailable,configured){
  const base=providerAvailable?'선택 지역 안의 검색 결과입니다.':configured?'장소 검색 연결이 지연되어 수록시설 결과만 표시해요.':'공개 수록시설에서 찾았어요.';
  const matching=items.some(item=>item.aliasMatch)?' 등록된 별칭·지역명 표기로 찾은 결과가 있어요.':'';
  const approximate=items.some(item=>item.approximate)?' 외부 검색의 비슷한 후보가 포함되어 있어요.':'';
  return base+matching+approximate+' 실제 명칭·주소·출입구를 확인한 뒤 직접 선택해 주세요. 미수록 시설은 있을 수 있으며, 지도에서 직접 선택할 수도 있어요.';
}

/** Search only the selected region; no supplied URLs, keys, or persisted location history. */
export async function searchWalkPlaces(query,pack,{env=process.env,fetcher=fetch}={}){
  const raw=typeof query==='string'?query.trim():'',q=raw.normalize('NFKC').replace(/\s+/gu,' ');
  if(raw.length<2||raw.length>100||q.length<2||q.length>100||/[\u0000-\u001f\u007f]/.test(typeof query==='string'?query:''))throw bad(400,'WALK_SEARCH_QUERY','장소명이나 도로명주소를 2~100자로 입력해 주세요.');
  const items=pack.candidates.flatMap(candidate=>{
    if(candidate.routeEligible!==true||!clean(candidate.name)||!validCoordinate(candidate.coordinate)||!pointInRegion(candidate.coordinate,pack.boundaries))return [];
    const match=matchDetails(raw,candidate,pack.profile.id);
    return match?[{...candidate,...match}]:[];
  }).sort((a,b)=>['direct','normalized','alias'].indexOf(a.matchType)-['direct','normalized','alias'].indexOf(b.matchType)).slice(0,20);
  const key=env.VWORLD_API_KEY,domain=safeDomain(env.VWORLD_DOMAIN||'');
  if(!key||!domain)return {ok:true,region:{id:pack.profile.id},items,providerAvailable:false,notice:noticeFor(items,false,false)};
  const outcomes=await Promise.allSettled([{type:'place'},{type:'address',category:'road'},{type:'address',category:'parcel'}].map(async kind=>{
    const url=new URL('https://api.vworld.kr/req/search');
    for(const [name,value]of Object.entries({service:'search',request:'search',version:'2.0',format:'json',crs:'EPSG:4326',size:20,page:1,bbox:pack.profile.bounds.join(','),query:q,key,domain,...kind}))url.searchParams.set(name,value);
    const body=await fetchJsonLimited(url,7000,fetcher),response=body.response;
    if(!response||!['OK','NOT_FOUND'].includes(response.status))throw Error('Search provider unavailable');
    return (response.result?.items||[]).slice(0,20).map(item=>{
      const coordinate=[Number(item.point?.x),Number(item.point?.y)],address=clean(item.address?.road||item.address?.parcel);
      return {name:clean(item.title||address),address,coordinate,sourceName:'브이월드 장소·주소 검색',sourceDate:null};
    }).filter(item=>item.name&&validCoordinate(item.coordinate)&&pointInRegion(item.coordinate,pack.boundaries));
  }));
  const signature=item=>item.name+':'+item.coordinate.join(',');
  const seen=new Set(items.map(signature));
  for(const outcome of outcomes)if(outcome.status==='fulfilled')for(const item of outcome.value){
    const identity=signature(item);if(seen.has(identity))continue;seen.add(identity);
    items.push({...item,...matchDetails(raw,item,pack.profile.id,{provider:true}),id:'search:'+pack.profile.id+':'+items.length,routeEligible:true});
  }
  const providerAvailable=outcomes.some(outcome=>outcome.status==='fulfilled'),visible=items.slice(0,30);
  return {ok:true,region:{id:pack.profile.id},items:visible,providerAvailable,notice:noticeFor(visible,providerAvailable,true)};
}
