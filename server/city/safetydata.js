/** Provider-specific public-data adapters. Keys are read only in the server.
 * Official field references: src/city/safety-catalog.js (2026-09-28 snapshot).
 * No undocumented region filtering, fuzzy hospital joins, or fabricated geometry.
 */
import {createHash} from 'node:crypto';
import {SAFETY_SOURCES,SAFETY_BY_ID} from '../../src/city/safety-catalog.js';
import {HttpError,requireKey,json,endpoint,scopeFor,text,n} from './common.js';
import {inside,boundsOf,validGeometry,clipFeature,fc} from '../../src/city/geometry.js';
import {icingGeometry,icingRegionMatches} from './icing.js';
const BASE='https://www.safetydata.go.kr/V2/api/';
const PAGE_SIZE=500;
const ERROR_MESSAGES={
 '01':'제공기관 응용프로그램 오류입니다.','02':'제공기관 응답시간이 초과됐습니다.',
 '10':'요청 변수 형식을 제공기관 명세와 대조하세요.','11':'제공기관 필수 요청 변수를 확인하세요.',
 '12':'해당 API가 제공되지 않거나 폐기됐습니다.','13':'제공기관 요청 방식 오류입니다.',
 '20':'서비스 사용 승인을 확인하세요.','22':'제공기관 일일 호출 한도를 초과했습니다. 자동 재시도하지 않습니다.',
 '30':'해당 데이터용 서비스키 등록을 확인하세요.','31':'서비스키의 유효기간이 지났습니다.',
 '32':'등록되지 않은 IP입니다. 플랫폼에 등록한 허용 IP와 Vercel 서버의 실제 출발 IP 조건을 확인하세요.',
 '33':'해당 데이터용 서비스키가 없습니다.','34':'서비스키가 중복 지정됐습니다.','99':'제공기관에서 기타 오류를 반환했습니다.'
};
function parsedEnv(value,label){if(!value)return {};try{const a=JSON.parse(value);if(!a||typeof a!=='object'||Array.isArray(a))throw Error();return a;}catch{throw new HttpError(503,label+' JSON 형식 오류입니다.','CONFIG_INVALID');}}
export function getSafetyKey(source,env=process.env){
 const bag=parsedEnv(env.SAFETYDATA_KEYS_JSON,'통합 서비스키');
 // Both provider identifier and friendly local id are accepted; never accept client key parameters.
 const value=env[source.keyEnv]||bag[source.code]||bag[source.id]||(source.id==='sd-heat'?env.SAFETYDATA_SERVICE_KEY:null)||'';
 if(value==='')return '';
 if(typeof value!=='string'||!value.trim()||value.length>2048||/[\r\n\u0000]/.test(value))throw new HttpError(503,'서비스키 값의 형식을 확인하세요. 키는 문자열 한 개여야 합니다.','CONFIG_INVALID');
 return value.trim();
}
export function safetyStatus(env=process.env){return SAFETY_SOURCES.map(s=>{let configured=false,configurationError=false;try{configured=!!getSafetyKey(s,env);}catch{configurationError=true;}return {id:s.id,code:s.code,title:s.title,configured,configurationError,requestMode:s.requestMode,locationJoinRequired:['sd-aws','sd-beds','sd-risk'].includes(s.id),sourceUrl:s.sourceUrl};});}
export function safetyTTL(kind){return ['sd-aws','sd-road','sd-beds'].includes(kind)?15*60000:60*60000;}
function codeOf(body){const paths=[body?.response?.header,body?.header,body?.OpenAPI_ServiceResponse?.cmmMsgHeader,body?.cmmMsgHeader,body];for(const a of paths){const v=a?.resultCode??a?.returnReasonCode??a?.errorCode;if(v!==undefined&&v!==null)return String(v).trim();}return null;}
export function safetyEnvelope(body){
 const code=codeOf(body);
 if(code!==null&&!['0','00','000','NORMAL_SERVICE','INFO-000'].includes(code)){
  const c=/^\d+$/.test(code)?code.padStart(2,'0'):'';
  throw new HttpError(c==='22'?429:['20','30','31','32','33','34'].includes(c)?403:502,ERROR_MESSAGES[c]||'제공기관 오류 응답입니다.','SAFETYDATA_'+(c||'ERROR'));
 }
 const candidates=[body?.response?.body?.items?.item,body?.response?.body?.items,body?.response?.body?.data,body?.body?.items?.item,body?.body?.items,body?.body,body?.data,body?.items?.item,body?.items,Array.isArray(body)?body:null];
 let rows=candidates.find(Array.isArray);
 if(!rows){const single=candidates.find(a=>a&&typeof a==='object'&&!Array.isArray(a)&&SAFETY_SOURCES.some(s=>Object.hasOwn(a,s.idField)));if(single)rows=[single];}
 if(!rows)throw new HttpError(502,'공식 API 응답에서 자료 배열을 확인하지 못했습니다. 빈 자료로 처리하지 않습니다.','SCHEMA_MISMATCH');
 const tot=body?.response?.body?.totalCount??body?.body?.totalCount??body?.totalCount??body?.header?.totalCount;
 const total=tot===undefined?null:n(tot);if(total!==null&&(!Number.isInteger(total)||total<0))throw new HttpError(502,'원자료 전체 건수 형식 오류','TOTAL_INVALID');
 return {rows,total};
}
export function dms(deg,min,sec){const d=n(deg),m=n(min),s=n(sec);if(d===null||m===null||s===null||!Number.isInteger(d)||m<0||m>=60||s<0||s>=60)return null;return d+(m/60)+(s/3600);}
function publicAttributes(row,source){return Object.fromEntries(Object.keys(source.fields).filter(k=>Object.hasOwn(row,k)&&k!=='WHOL_PSTN_DTIN'&&(k!=='GEOM'||source.id==='sd-icing')).map(k=>[k,typeof row[k]==='number'?row[k]:row[k]===null?null:text(row[k],600)]));}
function sourceGeometry(row,source){
 if(Array.isArray(source.coordinates)){const lo=n(row[source.coordinates[0]]),la=n(row[source.coordinates[1]]);if(lo===null||la===null)return null;return {type:'Point',coordinates:[lo,la]};}
 if(source.coordinates==='dms'){const lo=dms(row.LOT_PROVIN,row.LOT_MIN,row.LOT_SEC),la=dms(row.LAT_PROVIN,row.LAT_MIN,row.LAT_SEC);return lo===null||la===null?null:{type:'Point',coordinates:[lo,la]};}
 if(source.id==='sd-flood'){
  // The public schema says 'geometry', not a CRS. Accept GeoJSON's WGS84 only.
  // WKT / unknown projected pairs are held for verification instead of guessing.
  let g=row.GEOM;try{if(typeof g==='string')g=JSON.parse(g);}catch{return null;}
  if(g?.type==='Feature')g=g.geometry;
  if(g?.crs){const crs=String(g.crs?.properties?.name||g.crs);if(!/4326|CRS84/i.test(crs))return null;}
  return g&&typeof g==='object'?g:null;
 }
 return null;
}
export function verifiedLocations(env=process.env){return parsedEnv(env.SAFETYDATA_LOCATION_INDEX_JSON,'시설 식별번호·좌표 대조표');}
function joinLocation(row,source,index,scope){const key=String(row[source.idField]??'');const found=index[source.id]?.[key]??index[source.code]?.[key];if(!found||found.verified!==true||!found.sourceName)return null;const p=[n(found.longitude),n(found.latitude)];if(!inside(p,scope))return null;return {geometry:{type:'Point',coordinates:p},name:text(found.name||key),sourceName:text(found.sourceName),sourceDate:found.sourceDate??null};}
function fullSeoguAddress(address){return /^(?:광주광역시|광주시|전남광주통합특별시)\s+서구(?:\s|$)/.test(String(address).trim());}
function datedValue(row,source){
 const v=source.id==='sd-aws'?row.OBSRVN_HR:source.id==='sd-beds'?row.MDFCN_DT:null;
 // Preserve source representation. No provider date or fetchedAt is substituted for observation time.
 return v===undefined||v===null?null:text(v,60);
}
export function normalizeSafetyRows(rows,source,scope,{locationIndex={},collectedAt=new Date().toISOString()}={}){
 const features=[],unlocated=[];let outside=0,invalid=0,needsLocation=0,privateFieldsRemoved=0,regionMatched=0,regionExcluded=0,regionUnknown=0,regionBoundaryConflict=0;
 for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row)){invalid++;continue;}
  if(source.id==='sd-icing'){
   if(!String(row.RPRS_RGN??'').trim()){regionUnknown++;continue;}
   if(!icingRegionMatches(row.RPRS_RGN)){regionExcluded++;continue;}
   regionMatched++;
  }
  for(const k of Object.keys(row))if(/ONDT_DR|^CLR$|WRTR_OGDP|IDFR_OGDP|MNG_RBPRSN|MNG_CTZN|COPL_RMRK/.test(k))privateFieldsRemoved++;
  const attrs=publicAttributes(row,source),originalId=text(row[source.idField],150)||createHash('sha256').update(JSON.stringify(attrs)).digest('hex').slice(0,20);
  const address=text(row[source.addressField]||row.DADDR||row.DTL_ADRES||row.FCLT_ADDR_LOTNO);
  const icing=source.id==='sd-icing'?icingGeometry(row):null;
  let geometry=icing?icing.geometry:sourceGeometry(row,source),joined=null;
  if(!geometry&&!icing)joined=joinLocation(row,source,locationIndex,scope);
  if(joined)geometry=joined.geometry;
  if(!geometry){needsLocation++;if((fullSeoguAddress(address)||source.id==='sd-icing')&&unlocated.length<40)unlocated.push({sourceId:originalId,name:text(row[source.nameField]||source.title),address,originalAttributes:attrs,reason:icing?.reason||(source.id==='sd-flood'?'원본 도형·좌표계 확인 필요':'원문 주소의 좌표 검수 필요')});continue;}
  if(!validGeometry(geometry)){outside++;if(icing)regionBoundaryConflict++;continue;}
  const observedAt=datedValue(row,source);
  const id=source.id+'-'+originalId+(source.id==='sd-aws'?'@'+(observedAt||'unknown'):'');
  const props={id,name:joined?.name||text(row[source.nameField]||source.title),sourceId:originalId,sourceName:source.sourceName,sourceUrl:source.sourceUrl,sourceDate:null,collectedAt,observedAt,address,category:source.kind,note:source.note,originalAttributes:attrs,originalFieldLabels:source.fields,
   locationBasis:joined?'검수한 원자료 식별번호 정확 일치':'원자료 좌표/도형',locationSource:joined?.sourceName||source.sourceName,locationSourceDate:joined?.sourceDate??null};
  if(source.id==='sd-cold')props.capacity=n(row.UTZTN_PSBLTY_TNOP);
  if(source.id==='sd-heat')props.capacity=n(row.USE_PSBL_NMPR);
  if(source.id==='sd-civil-shelter')props.capacity=n(row.SHNT_PSBLTY_NOPE);
  if(source.id==='sd-risk'){props.designatedAt=row.DSGN_YMD??null;props.releasedAt=row.RMV_YMD??null;}
  if(source.id==='sd-aws'){props.temperature=n(row.AIRTP);props.stationCode=originalId;props.observationStatus='원자료 품질 플래그 확인 필요';}
  if(source.id==='sd-flood')props.eventYear=row.FLDN_YR??null;
  if(source.id==='sd-road')props.providerGrade=row.RSK_ELMN_GRD??null;
  if(icing){props.sectionNo=text(row.SCTN_NO);props.region=text(row.RPRS_RGN);props.manager=text(row.MNG_INST_NM);props.vulnerabilityType=text(row.FRGL_TYPE);props.pointType=text(row.SE);props.originalCrs=icing.originalCrs;props.crsEvidence=source.crsEvidence;props.locationBasis=icing.locationBasis;props.geometryMeaning=icing.geometryMeaning;}
  try{const f=clipFeature({type:'Feature',geometry,properties:props},scope);if(f)features.push(f);else{outside++;if(icing)regionBoundaryConflict++;}}catch{invalid++;}
 }
 return {features,unlocated,quality:{outside,invalid,needsLocation,privateFieldsRemoved,...(source.id==='sd-icing'?{regionMatched,regionExcluded,regionUnknown,regionBoundaryConflict,mappedRows:features.length}:{})}};
}
export async function readSafetyData(id,q,{env=process.env,fetcher=fetch}={}){
 const source=SAFETY_BY_ID[id];if(!source)throw new HttpError(404,'등록하지 않은 재난안전 자료입니다.');
 const key=requireKey(getSafetyKey(source,env),source.title),scope=scopeFor(q.get('dong'));
 const page=Number(q.get('page')||1);if(!Number.isInteger(page)||page<1||page>100)throw new HttpError(400,'페이지는 1~100 범위입니다.');
 const params={serviceKey:key,numOfRows:PAGE_SIZE,pageNo:page,returnType:'json'};
 if(source.requestMode==='bbox'){const [w,s,e,no]=boundsOf(scope);Object.assign(params,{startLot:w,endLot:e,startLat:s,endLat:no});}
 const locationIndex=verifiedLocations(env);
 if(source.requestMode==='station'){
  const station=text(q.get('station')||env.SAFETYDATA_AWS_STATION_CODE,12);
  if(!station||!/^\d{1,12}$/.test(station))throw new HttpError(409,'AWS 원자료에는 관측소 좌표가 없습니다. 공식 관측소 코드와 검수 위치를 먼저 연결하세요.','LOCATION_MAPPING_REQUIRED');
  if(!joinLocation({AWS_OBSVTR_CD:station},source,locationIndex,scope))throw new HttpError(409,'선택 구역의 검수된 AWS 관측소 코드·좌표 대응표가 필요합니다.','LOCATION_MAPPING_REQUIRED');
  params.AWS_OBSVTR_CD=station;
  if(q.get('observed')){const val=q.get('observed');if(!/^\d{8,14}$/.test(val))throw new HttpError(400,'관측시각은 공식 명세의 숫자 시각 형식을 사용하세요.');params.OBSRVN_HR=val;}
 }
 const body=await json(endpoint(BASE+source.code,params),{fetcher,timeout:12000,max:4*1024*1024});
 const {rows,total}=safetyEnvelope(body);if(rows.length>PAGE_SIZE)throw new HttpError(502,'요청한 페이지 크기를 넘는 원자료 응답입니다.','PAGE_SIZE_MISMATCH');
 if(total!==null&&rows.length===0&&(page-1)*PAGE_SIZE<total)throw new HttpError(502,'전체 건수와 빈 페이지 응답이 충돌합니다.','PAGE_GAP');
 const collectedAt=new Date().toISOString();
 const data=normalizeSafetyRows(rows,source,scope,{locationIndex,collectedAt});
 const complete=total!==null?page*PAGE_SIZE>=total:rows.length<PAGE_SIZE;
 if(source.id==='sd-icing'&&total!==null&&rows.length<Math.min(PAGE_SIZE,Math.max(0,total-(page-1)*PAGE_SIZE)))throw new HttpError(502,'원자료 건수와 페이지 크기가 일치하지 않습니다. 일부 응답을 전체 수집으로 처리하지 않습니다.','PAGE_GAP');
 return {ok:true,id,title:source.title,sourceName:source.sourceName,sourceUrl:source.sourceUrl,sourceDate:null,collectedAt,page,pageSize:PAGE_SIZE,total,scanned:rows.length,complete,nextPage:complete?null:page+1,scope:q.get('dong')||'all',requestMode:source.requestMode,
  pageFingerprint:createHash('sha256').update(JSON.stringify(rows.map(r=>[r?.[source.idField],r?.OBSRVN_HR]))).digest('hex'),geojson:fc(data.features),unlocated:data.unlocated,quality:data.quality,note:source.note,
  ...(source.id==='sd-icing'?{endpoint:source.endpoint,coordinateSystem:source.coordinateSystem,crsEvidence:source.crsEvidence,rawSample:rows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).slice(0,5).map(row=>publicAttributes(row,source)),rawSampleScope:'전국 원자료 현재 페이지 앞 5행 · 서구 필터 전',regionalRows:rows.filter(row=>icingRegionMatches(row?.RPRS_RGN)).map(row=>publicAttributes(row,source)),sectionCount:new Set(data.features.map(f=>f.properties.sectionNo).filter(Boolean)).size}:{}),
  coverageNote:source.id==='sd-icing'?'전국 페이지를 받아 대표지역이 광주 서구인 행을 고르고, 변환한 원본 지점을 실제 행정동 경계와 대조했습니다. 구간번호와 지점 수를 구분하며 모든 페이지 수신 전에는 전수 수집이 아닙니다.':source.requestMode==='bbox'?'공식 경위도 범위 요청 후 실제 행정동 경계로 필터했습니다.':'공식 지역 요청변수가 없는 경우 전국 페이지를 검사한 뒤 서구 경계로 제한합니다. 모든 페이지 완료 전에는 전수 수집이 아닙니다.',
  licenseNote:'원 제공기관 출처·공공누리 이용조건 확인. 원자료 값과 표시용 도형을 구분합니다.'};
}
