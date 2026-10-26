import {readSafetyData,safetyStatus} from './safetydata.js';
import {readTheme} from './vworld-themes.js';
import {infrastructureFlags,readInfrastructure} from './infrastructure.js';
import {readForecast} from './forecast.js';
import {readAirStations,readAir,airKeys} from './air-quality.js';
import {HttpError,requireKey,origin,json,endpoint,records,totalOf,cleanPoint,text,n,safeFeatures,district,scopeFor} from './common.js';
import {inside,fc,boundsOf,clipFeature} from '../../src/city/geometry.js';
const STANDARD='https://apis.data.go.kr';
export function flags(env=process.env){return {...Object.fromEntries(safetyStatus(env).map(s=>[s.id,s.configured])),...infrastructureFlags(env),tmap:!!(env.TMAP_API_KEY||env.TMAP_APP_KEY),vworld3d:!!(env.VWORLD_BROWSER_KEY&&env.VWORLD_DOMAIN),vworldRest:!!(env.VWORLD_API_KEY&&env.VWORLD_DOMAIN),safety:!!env.SAFETYDATA_SERVICE_KEY,emergency:!!(env.EMERGENCY_SERVICE_KEY||env.DATA_GO_KR_SERVICE_KEY),its:!!env.ITS_API_KEY,taas:!!(env.TAAS_SERVICE_KEY||env.DATA_GO_KR_SERVICE_KEY),air:airKeys(env).length>0,weather:!!(env.KMA_SERVICE_KEY||env.DATA_GO_KR_SERVICE_KEY),safemap:!!env.SAFEMAP_SERVICE_KEY,floodmap:!!env.FLOODMAP_SERVICE_KEY,flow:env.ITS_FLOW_ENABLED==='true'};}
function featureMeta(source,extra={}){return {sourceName:source,sourceDate:null,collectedAt:new Date().toISOString(),...extra};}
export async function readProvider(kind,q,{env=process.env,fetcher=fetch}={}){
 if(kind?.startsWith('sd-'))return readSafetyData(kind,q,{env,fetcher});
 if(kind?.startsWith('vw-'))return readTheme(kind,q,{env,fetcher});
 if(kind?.startsWith('infra-'))return readInfrastructure(kind,q,{env,fetcher});
 /* 에어코리아: 키 정리·단계별 실패 코드·측정소 목록 보관은 air-quality.js에 있다. */
 if(kind==='air-stations')return readAirStations(q,{env,fetcher});
 if(kind==='air')return readAir(q,{env,fetcher});
 const scope=scopeFor(q.get('dong')),bounds=boundsOf(scope),page=Math.max(1,Number(q.get('page')||1));if(!Number.isInteger(page)||page>150)throw new HttpError(400,'페이지 범위 오류');const opts={fetcher};const limit=500;let body,items,features=[],total=null,complete=true,note='',sourceName='',sourceDate=null;
 const portal=()=>requireKey(env.DATA_GO_KR_SERVICE_KEY,'공공데이터');
 if(kind==='forecast'){const lon=n(q.get('lon')),lat=n(q.get('lat'));if(!inside([lon,lat],scope))throw new HttpError(400,'서구의 선택 구역 안에서 지점을 선택하세요.');return readForecast(lon,lat,{env,fetcher});}else if(kind==='heat'){
  sourceName='재난안전데이터공유플랫폼 무더위쉼터';
  const params={serviceKey:requireKey(env.SAFETYDATA_SERVICE_KEY,'재난안전데이터'),pageNo:page,numOfRows:limit,returnType:'json'};
  /* No undocumented region parameter: scan pages, report coverage, strictly filter returned geometry. */
  body=await json(endpoint('https://www.safetydata.go.kr/V2/api/DSSP-IF-10942',params),opts);items=records(body);total=totalOf(body);complete=total!==null?page*limit>=total:items.length<limit;
  features=items.map((a,i)=>cleanPoint(`heat-${a.RSTR_FCLTY_NO||`${page}-${i}`}`,a.RSTR_NM,a.LO,a.LA,{...featureMeta(sourceName),category:'shelter',address:text(a.RN_DTL_ADRES||a.DTL_ADRES),capacity:n(a.USE_PSBL_NMPR),area:n(a.AR),night:a.CHCK_MATTER_NIGHT_OPN_AT??null,weekend:a.CHCK_MATTER_WKEND_HDAY_OPN_AT??null,weekdayHours:[a.WKDAY_OPER_BEGIN_TIME,a.WKDAY_OPER_END_TIME].filter(Boolean).join('–'),weekendHours:[a.WKEND_HDAY_OPER_BEGIN_TIME,a.WKEND_HDAY_OPER_END_TIME].filter(Boolean).join('–'),note:'현재 실제 개방 여부·운영기간은 현장 확인 필요'},scope)).filter(Boolean);
  note='전체 응답을 페이지별로 검사합니다. 전체 페이지 완료 전에는 서구 전체 수집이 아닙니다.';
 }else if(kind==='emergency'){
  sourceName='국립중앙의료원 응급의료기관 기본정보';
  body=await json(endpoint(`${STANDARD}/B552657/ErmctInfoInqireService/getEgytBassInfoInqire`,{serviceKey:requireKey(env.EMERGENCY_SERVICE_KEY||env.DATA_GO_KR_SERVICE_KEY,'응급의료'),pageNo:page,numOfRows:100}),opts);items=records(body);total=totalOf(body);complete=total!==null?page*100>=total:items.length<100;
  features=items.map((a,i)=>cleanPoint(`er-${a.hpid||`${page}-${i}`}`,a.dutyName,a.wgs84Lon,a.wgs84Lat,{...featureMeta(sourceName),category:'medical',address:text(a.dutyAddr),phone:text(a.dutyTel1),emergencyPhone:text(a.dutyTel3),registeredBeds:n(a.dutyHano),note:'기관 기본정보입니다. 실시간 수용 가능 여부가 아닙니다. 응급상황은 119.'},scope)).filter(Boolean);
 }else if(kind==='events'||kind==='cctv'){
  sourceName='국토교통부 국가교통정보센터 ITS';const key=requireKey(env.ITS_API_KEY,'ITS');
  const params={apiKey:key,type:kind==='events'?'all':env.ITS_CCTV_TYPE||'its',getType:'json',minX:bounds[0],minY:bounds[1],maxX:bounds[2],maxY:bounds[3],...(kind==='events'?{eventType:'all'}:{cctvType:'1'})};
  body=await json(endpoint(`https://openapi.its.go.kr:9443/${kind==='events'?'eventInfo':'cctvInfo'}`,params),opts);items=records(body);
  features=items.map((a,i)=>{const name=kind==='events'?a.roadName||a.eventType||'돌발상황':a.cctvname||a.cctvName||'교통 CCTV';let stream=null;try{const u=new URL(a.cctvurl||a.cctvUrl||'');if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(u.hostname)&&u.hostname.includes('.'))stream=u.href;}catch{}
   return cleanPoint(`${kind}-${a.eventId||a.cctvid||a.cctvId||name+'-'+i}`,name,a.coordX??a.coordx??a.lon,a.coordY??a.coordy??a.lat,{...featureMeta(sourceName),category:kind==='cctv'?'cctv':'traffic',message:text(a.message||a.eventMessage),eventType:text(a.eventType),eventDetailType:text(a.eventDetailType),reportedAt:text(a.startDate||a.createdDate),endTime:text(a.endDate),streamUrl:stream,streamType:text(a.cctvformat||a.cctvFormat),note:kind==='cctv'?'ITS 공개 교통영상 · 링크 만료/제공 중단 가능':'제공기관 갱신 시각·통제기간 확인'},scope);
  }).filter(Boolean);note='ITS가 제공하는 노선·지점 범위이며 서구 전체 도로/방범CCTV를 의미하지 않습니다.';
 }else if(kind==='accidents'){
  sourceName='한국도로교통공단 지자체별 사고다발지역';const year=env.TAAS_YEAR||'2024',sido=env.TAAS_SIDO||'29',gugun=env.TAAS_GUGUN||'140';
  if(!/^20\d{2}$/.test(year)||!/^\d{2}$/.test(sido)||!/^\d{3}$/.test(gugun))throw new HttpError(503,'TAAS 기준연도·행정코드 설정을 확인하세요.');
  body=await json(endpoint(`${STANDARD}/B552061/frequentzoneLg/getRestFrequentzoneLg`,{serviceKey:requireKey(env.TAAS_SERVICE_KEY||env.DATA_GO_KR_SERVICE_KEY,'교통사고'),searchYearCd:year,siDo:sido,guGun:gugun,type:'json',numOfRows:limit,pageNo:page}),opts);items=records(body);total=totalOf(body);complete=total!==null?page*limit>=total:items.length<limit;
  for(let i=0;i<items.length;i++){const a=items[i];let g;try{g=typeof a.geom_json==='string'?JSON.parse(a.geom_json):a.geom_json;}catch{}if(g?.type==='Feature')g=g.geometry;
   const p={...featureMeta(sourceName),sourceYear:year,category:'traffic',name:text(a.spot_nm),id:`acc-${a.spot_cd||year+'-'+page+'-'+i}`,accidentCount:n(a.occrrnc_cnt),deaths:n(a.dth_dnv_cnt),seriousInjuries:n(a.se_dnv_cnt),note:'과거 사고다발구역 · 미래 사고 확률 아님'};
   if(g)features.push({type:'Feature',geometry:g,properties:p});else{const f=cleanPoint(p.id,p.name,a.lo_crd,a.la_crd,p,scope);if(f)features.push(f);}}
  features=safeFeatures(features,scope).features;note=`${year}년 자료. 코드 ${sido}/${gugun}는 해당 연도 제공기관 코드입니다.`;
 }else if(kind==='reverse'){
  const lon=n(q.get('lon')),lat=n(q.get('lat'));if(!inside([lon,lat],scope))throw new HttpError(400,'서구의 선택 구역 안에서 지점을 선택하세요.');
  body=await json(endpoint('https://api.vworld.kr/req/address',{service:'address',request:'getAddress',version:'2.0',crs:'EPSG:4326',point:`${lon},${lat}`,type:'BOTH',format:'json',key:requireKey(env.VWORLD_API_KEY,'브이월드 REST'),domain:origin(env)}),opts);
  if(body.response?.status==='NOT_FOUND')return {ok:true,kind,addresses:[],note:'주소 미조회'};
  if(body.response?.status!=='OK')throw new HttpError(502,'브이월드 주소 조회 오류');return {ok:true,kind,addresses:(Array.isArray(body.response.result)?body.response.result:[body.response.result]).map(r=>({type:text(r.type),address:text(r.text)})),sourceName:'브이월드 주소'};
 }else if(kind==='parcel-search'){
  const query=text(q.get('q'),120);if(query.length<2)throw new HttpError(400,'주소를 2자 이상 입력하세요.');
  body=await json(endpoint('https://api.vworld.kr/req/search',{service:'search',request:'search',version:'2.0',type:'address',category:'parcel',size:20,page:1,format:'json',query,bbox:bounds.join(','),key:requireKey(env.VWORLD_API_KEY,'브이월드 REST'),domain:origin(env)}),opts);
  if(body.response?.status==='NOT_FOUND')return {ok:true,kind,items:[],sourceName:'브이월드 검색'};if(body.response?.status!=='OK')throw new HttpError(502,'브이월드 검색 오류');
  return {ok:true,kind,items:(body.response.result?.items||[]).filter(a=>inside([n(a.point?.x),n(a.point?.y)],scope)&&/^\d{19}$/.test(a.id)).map(a=>({pnu:a.id,name:text(a.address?.parcel||a.title),coordinates:[n(a.point.x),n(a.point.y)]})),sourceName:'브이월드 검색'};
 }else if(kind==='parcel'){
  const pnu=q.get('pnu');if(!/^\d{19}$/.test(pnu||''))throw new HttpError(400,'PNU 형식 오류');const key=requireKey(env.VWORLD_API_KEY,'브이월드 REST'),domain=origin(env);
  body=await json(endpoint('https://api.vworld.kr/req/data',{service:'data',request:'GetFeature',version:'2.0',format:'json',crs:'EPSG:4326',size:10,page:1,geometry:true,attribute:true,data:'LP_PA_CBND_BUBUN',attrfilter:`pnu:=:${pnu}`,key,domain}),opts);
  if(body.response?.status!=='OK')throw new HttpError(502,'필지 경계를 확인하지 못했습니다.');const fs=body.response?.result?.featureCollection?.features||[];const clipped=safeFeatures(fs,scope).features;if(!clipped.length)throw new HttpError(400,'서구 경계 안의 필지를 확인하지 못했습니다.');
  const year=String(new Date().getFullYear());const services=[['land','getLandCharacteristics',{stdrYear:year}],['use','getLandUseAttr',{numOfRows:100}],['building','getBuildingUse',{numOfRows:100}]];
  const results=await Promise.all(services.map(async([id,method,extra])=>{try{const data=await json(endpoint(`https://api.vworld.kr/ned/data/${method}`,{pnu,key,domain,format:'json',...extra}),opts);const root=data.landCharacteristics||data.landUseAtt||data.landUseAttr||data.buildingUses;const field=root?.field;if(!field)throw Error();return [id,{state:'loaded',year:id==='land'?year:null,items:(Array.isArray(field)?field:[field]).map(safeLandRecord)}];}catch{return [id,{state:'unavailable',items:[],note:'권한·기준연도·제공범위 확인 필요'}];}}));
  return {ok:true,kind,pnu,geojson:fc(clipped.map((f,i)=>({...f,properties:{id:`parcel-${pnu}-${i}`,name:'선택 필지',sourceName:'브이월드 연속지적도',sourceDate:null}}))),data:Object.fromEntries(results),sourceName:'브이월드 연속지적도·토지/건물 속성',note:'공시 정보 참고조회입니다. 인허가 가능 여부·법정 용적률·입지 적합도 판정이 아닙니다.'};
 }else throw new HttpError(400,'지원하지 않는 자료 요청입니다.');
 return {ok:true,kind,page,totalScanned:items?.length??features.length,totalCount:total,complete,nextPage:complete?null:page+1,sourceName,sourceDate,collectedAt:new Date().toISOString(),note,geojson:fc(features)};
}
const LAND_FIELDS=['lndcgrCodeNm','lndpclAr','prposArea1Nm','tpgrphFrmCodeNm','roadSideCodeNm','pblntfPclnd','lastUpdtDt','cnflcAtNm','prposAreaDstrcCodeNm','regstrSeCodeNm','mainPrposCodeNm','buldHg','groundFloorCo','undgrndFloorCo','buldPlotAr','buldBildngAr','buldTotar','measrmtRt','btlRt','strctCodeNm','useConfmDe'];
function safeLandRecord(a){return Object.fromEntries(LAND_FIELDS.filter(k=>a[k]!==undefined).map(k=>[k,text(a[k],200)]));}
