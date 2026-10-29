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
  // A street/building number must match contiguously, never a unit number on another street.
  if(looksLikeAddress(query.normalize('NFKC'))){
    const term=aliasText(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(!new RegExp(term+'(?![\\d-])','u').test(aliasText(candidate.address)))return provider?{matchType:'provider',aliasMatch:false,approximate:true,matchNote:'외부 주소검색의 비슷한 후보입니다. 도로명·건물번호가 맞는지 확인해 주세요.'}:null;
  }
  const direct=[candidate.name,candidate.address].some(value=>typeof value==='string'&&value.toLowerCase().includes(query.toLowerCase()));
  if(direct)return {matchType:'direct',aliasMatch:false,approximate:false,matchNote:'수록 명칭·주소에 검색어가 포함됩니다.'};
  if(normalizedMatch(query,candidate,regionId))return {matchType:'normalized',aliasMatch:false,approximate:false,matchNote:'문자·띄어쓰기를 정리해 찾은 결과입니다. 실제 명칭·주소를 확인해 주세요.'};
  if(normalizedMatch(query,candidate,regionId,true))return {matchType:'alias',aliasMatch:true,approximate:false,matchNote:'등록된 시설 분류·별칭·지역명 표기로 찾은 결과입니다. 실제 명칭·주소를 확인해 주세요.'};
  return provider?{matchType:'provider',aliasMatch:false,approximate:true,matchNote:'외부 장소검색 후보입니다. 검색어와 실제 명칭·주소가 맞는지 확인해 주세요.'}:null;
}

const SEARCH_LIMIT=30,TIMEOUT_MS=5000;
const providerNames={'tmap-poi':'TMAP 장소검색','tmap-address':'TMAP 주소검색',vworld:'브이월드 장소·주소 검색'};
function noticeFor(items,providers,truncated){
  const available=providers.filter(provider=>provider.status==='available'),failed=providers.filter(provider=>provider.status==='unavailable');
  const base=available.length?`${available.map(provider=>provider.name).join(' · ')}과 공개 수록시설에서 선택 지역 안의 결과를 찾았어요.`:failed.length?'장소 검색 연결이 지연되어 수록시설 결과만 표시해요.':'공개 수록시설에서 찾았어요. 일반 장소검색은 TMAP 검색 서비스 연결이 필요해요.';
  const failure=failed.map(provider=>`${provider.name}: ${provider.code==='AUTH_REJECTED'?'키·서비스 이용 권한 확인 필요':provider.code==='UPSTREAM_LIMIT'?'제공기관 호출 한도 도달':provider.code==='CONFIG_INVALID'?'인증 설정 형식 확인 필요':'응답을 받지 못함'}.`).join(' ');
  const matching=items.some(item=>item.aliasMatch)?' 등록된 별칭·지역명 표기로 찾은 결과가 있어요.':'';
  const approximate=items.some(item=>item.approximate)?' 외부 검색의 비슷한 후보가 포함되어 있어요.':'';
  return base+(failure?' '+failure:'')+matching+approximate+(truncated?' 상위 30개까지 표시해요. 동명·지점명·주소를 더 입력하면 범위를 좁힐 수 있어요.':'')+' 실제 명칭·주소·출입구를 확인한 뒤 직접 선택해 주세요. 미수록 시설은 있을 수 있으며, 지도에서 직접 선택할 수도 있어요.';
}

const list=value=>Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];
const number=value=>typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
const coordinate=(...pairs)=>pairs.map(([lon,lat])=>[number(lon),number(lat)]).find(point=>validCoordinate(point)&&point[0]>=124&&point[0]<=132&&point[1]>=32&&point[1]<=40);
const joined=parts=>parts.map(clean).filter(Boolean).join(' ');
const buildingNumber=(first,second)=>clean(first)+(clean(second)&&Number(second)!==0?'-'+clean(second):'');
function tmapAddress(item){
  const road=list(item.newAddressList?.newAddress).find(address=>clean(address.fullAddress));
  if(road)return clean(road.fullAddress);
  const area=[item.upperAddrName,item.middleAddrName];
  return clean(item.roadName?joined([...area,item.roadName,buildingNumber(item.firstBuildNo,item.secondBuildNo)]):joined([...area,item.lowerAddrName,item.detailAddrName||item.detailAddrname,buildingNumber(item.firstNo,item.secondNo)]));
}
function tmapKey(env){
  const key=(typeof env.TMAP_API_KEY==='string'?env.TMAP_API_KEY.trim():'')||(typeof env.TMAP_APP_KEY==='string'?env.TMAP_APP_KEY.trim():'');
  if(key&&(key.length>2048||/[\r\n\u0000]/u.test(key)))throw Object.assign(new Error('Invalid search configuration'),{providerCode:'CONFIG_INVALID'});
  return key;
}
async function tmapJson(url,key,fetcher){
  const body=await fetchJsonLimited(url,TIMEOUT_MS,async(target,options)=>{
    const response=await fetcher(target,{...options,headers:{...options.headers,appKey:key}});
    if(!response.ok)throw Object.assign(new Error('Search provider unavailable'),{providerCode:[401,403].includes(response.status)?'AUTH_REJECTED':response.status===429?'UPSTREAM_LIMIT':'UNAVAILABLE'});
    return response;
  });
  if(body?.error)throw Error('Search provider unavailable');
  return body;
}
function aroundRegion(profile){
  const [west,south,east,north]=profile.bounds,lon=(west+east)/2,lat=(south+north)/2;
  // The provider circle collects candidates; the actual administrative polygon remains decisive.
  const radius=Math.min(33,Math.max(1,Math.ceil(Math.hypot((east-west)*111.32*Math.cos(lat*Math.PI/180),(north-south)*111.32)/2)+1));
  return {centerLon:lon,centerLat:lat,radius};
}
const looksLikeAddress=query=>/(?:로|길)\s*\d|(?:동|읍|면|리)\s*\d/u.test(query);
function addressQuery(query,regionId){
  const prefix=regionId==='seogu'?'광주광역시 서구':regionId==='suncheon'?'전라남도 순천시':'';
  // Expand a local street query only; an explicitly supplied other city must not be rewritten.
  if(!prefix||/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주|순천)/u.test(query))return query;
  return prefix+' '+query.replace(regionId==='seogu'?/^서구\s*/u:/^순천시\s*/u,'');
}
async function searchTmapPoi(query,pack,key,fetcher){
  const url=new URL('https://apis.openapi.sk.com/tmap/pois');
  for(const [name,value]of Object.entries({version:1,searchKeyword:query,searchType:'all',searchtypCd:'A',reqCoordType:'WGS84GEO',resCoordType:'WGS84GEO',page:1,count:100,multiPoint:'Y',poiGroupYn:'N',...aroundRegion(pack.profile)}))url.searchParams.set(name,value);
  const body=await tmapJson(url,key,fetcher),info=body.searchPoiInfo;
  if(!info||!Number.isFinite(number(info.totalCount))||number(info.totalCount)<0||(number(info.totalCount)>0&&!info.pois?.poi))throw Error('Invalid place response');
  const items=list(info.pois?.poi).slice(0,100).map(item=>({
    name:clean(item.name),address:tmapAddress(item),coordinate:coordinate([item.frontLon,item.frontLat],[item.noorLon,item.noorLat]),
    category:clean(item.detailBizName||item.lowerBizName||item.middleBizName),sourceName:'TMAP 장소검색',sourceDate:null,searchProvider:'tmap',
  })).filter(item=>item.name&&item.coordinate&&pointInRegion(item.coordinate,pack.boundaries));
  return {items,truncated:number(info.totalCount)>100};
}
async function searchTmapAddress(query,pack,key,fetcher){
  const url=new URL('https://apis.openapi.sk.com/tmap/geo/fullAddrGeo');
  for(const [name,value]of Object.entries({version:1,format:'json',fullAddr:addressQuery(query,pack.profile.id),addressFlag:'F00',coordType:'WGS84GEO',page:1,count:20}))url.searchParams.set(name,value);
  const body=await tmapJson(url,key,fetcher),info=body.coordinateInfo;
  if(!info||!Number.isFinite(number(info.totalCount))||number(info.totalCount)<0||(number(info.totalCount)>0&&!info.coordinate))throw Error('Invalid address response');
  const items=list(info.coordinate).slice(0,20).flatMap(item=>{
    const road=item.newMatchFlag==='N51'&&!!clean(item.newRoadName)&&!!clean(item.newBuildingIndex),parcel=['M11','M21'].includes(item.matchFlag)&&!!clean(item.bunji);
    // Never substitute a nearby house number or an 읍/면/동 centroid for the requested address.
    if(!road&&!parcel)return [];
    const point=road?coordinate([item.newLonEntr,item.newLatEntr],[item.newLon,item.newLat]):coordinate([item.lonEntr,item.latEntr],[item.lon,item.lat]);
    if(!point||!pointInRegion(point,pack.boundaries))return [];
    const address=clean(road?joined([item.city_do,item.gu_gun,item.eup_myun,item.newRoadName,item.newBuildingIndex]):joined([item.city_do,item.gu_gun,item.eup_myun,item.legalDong,item.ri,item.bunji]));
    if(!address)return [];
    return [{name:clean((road?item.newBuildingName:item.buildingName)||address),address,coordinate:point,sourceName:'TMAP 주소검색',sourceDate:null,searchProvider:'tmap',matchType:'address',aliasMatch:false,approximate:false,matchNote:'제공기관이 주소를 정매칭한 위치입니다. 실제 출입구를 확인해 주세요.'}];
  });
  return {items,truncated:number(info.totalCount)>20};
}

/** Search only the selected region; no supplied URLs, keys, or persisted location history. */
export async function searchWalkPlaces(query,pack,{env=process.env,fetcher=fetch}={}){
  const raw=typeof query==='string'?query.trim():'',q=raw.normalize('NFKC').replace(/\s+/gu,' ');
  if(raw.length<2||raw.length>100||q.length<2||q.length>100||/[\u0000-\u001f\u007f]/.test(typeof query==='string'?query:''))throw bad(400,'WALK_SEARCH_QUERY','장소명이나 도로명주소를 2~100자로 입력해 주세요.');
  const items=pack.candidates.flatMap(candidate=>{
    if(candidate.routeEligible!==true||!clean(candidate.name)||!validCoordinate(candidate.coordinate)||!pointInRegion(candidate.coordinate,pack.boundaries))return [];
    const match=matchDetails(raw,candidate,pack.profile.id);
    return match?[{...candidate,...match,searchProvider:'catalogue'}]:[];
  }).sort((a,b)=>['direct','normalized','alias'].indexOf(a.matchType)-['direct','normalized','alias'].indexOf(b.matchType)).slice(0,20);
  const providers=Object.entries(providerNames).map(([id,name])=>({id,name,status:'not-configured',code:null,resultCount:0})),external=[];
  let key='',keyError=null,truncated=false;
  try{key=tmapKey(env);}catch(error){keyError=error.providerCode;}
  const tmapQuery=q.replace(/전남\s*광주\s*통합\s*특별시/gu,'광주광역시');
  const searches=[['tmap-poi',()=>searchTmapPoi(tmapQuery,pack,key,fetcher)],...(looksLikeAddress(q)?[['tmap-address',()=>searchTmapAddress(tmapQuery,pack,key,fetcher)]]:[])];
  if(key||keyError){
    const outcomes=await Promise.allSettled(searches.map(([,run])=>keyError?Promise.reject({providerCode:keyError}):run()));
    for(const [index,outcome]of outcomes.entries()){
      const provider=providers.find(item=>item.id===searches[index][0]);
      if(outcome.status==='fulfilled'){provider.status='available';provider.resultCount=outcome.value.items.length;external.push(...outcome.value.items);truncated||=outcome.value.truncated;}
      else{provider.status='unavailable';provider.code=outcome.reason?.providerCode||'UNAVAILABLE';}
    }
    if(!looksLikeAddress(q))providers.find(item=>item.id==='tmap-address').status='not-requested';
  }
  // A configured secondary provider is explicit in the response, including primary failures.
  const vworld=providers.find(item=>item.id==='vworld'),vworldKey=env.VWORLD_API_KEY,domain=safeDomain(env.VWORLD_DOMAIN||'');
  if(vworldKey&&domain){
    if(!external.length){
      const outcomes=await Promise.allSettled([{type:'place'},{type:'address',category:'road'},{type:'address',category:'parcel'}].map(async kind=>{
        const url=new URL('https://api.vworld.kr/req/search');
        for(const [name,value]of Object.entries({service:'search',request:'search',version:'2.0',format:'json',crs:'EPSG:4326',size:20,page:1,bbox:pack.profile.bounds.join(','),query:q,key:vworldKey,domain,...kind}))url.searchParams.set(name,value);
        const body=await fetchJsonLimited(url,TIMEOUT_MS,fetcher),response=body.response;
        if(!response||!['OK','NOT_FOUND'].includes(response.status))throw Error('Search provider unavailable');
        return (response.result?.items||[]).slice(0,20).map(item=>{
          const point=coordinate([item.point?.x,item.point?.y]),address=clean(item.address?.road||item.address?.parcel);
          return {name:clean(item.title||address),address,coordinate:point,sourceName:'브이월드 장소·주소 검색',sourceDate:null,searchProvider:'vworld'};
        }).filter(item=>item.name&&item.coordinate&&pointInRegion(item.coordinate,pack.boundaries));
      }));
      vworld.status=outcomes.some(outcome=>outcome.status==='fulfilled')?'available':'unavailable';
      if(vworld.status==='unavailable')vworld.code='UNAVAILABLE';
      for(const outcome of outcomes)if(outcome.status==='fulfilled'){vworld.resultCount+=outcome.value.length;external.push(...outcome.value);}
    }else vworld.status='not-requested';
  }
  const signature=item=>compact(item.name)+':'+item.coordinate.map(value=>value.toFixed(5)).join(','),localBySignature=new Map(items.map(item=>[signature(item),item]));
  const merged=[],seen=new Set();
  // General POIs must remain visible even when many catalogue records match the query.
  for(const item of external){
    const identity=signature(item);if(seen.has(identity))continue;seen.add(identity);
    merged.push(localBySignature.get(identity)||{...item,...(item.matchType?{}:matchDetails(raw,item,pack.profile.id,{provider:true})),id:'search:'+pack.profile.id+':'+merged.length,routeEligible:true});
  }
  for(const item of items){const identity=signature(item);if(!seen.has(identity)){seen.add(identity);merged.push(item);}}
  truncated||=merged.length>SEARCH_LIMIT;
  const visible=merged.slice(0,SEARCH_LIMIT),providerAvailable=providers.some(provider=>provider.status==='available');
  return {ok:true,region:{id:pack.profile.id},scope:{regionId:pack.profile.id,regionName:pack.profile.name||pack.profile.id,withinRegion:true},items:visible,providerAvailable,providers,truncated,resultLimit:SEARCH_LIMIT,notice:noticeFor(visible,providers,truncated)};
}

