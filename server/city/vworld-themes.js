import {createHash} from 'node:crypto';
/** Public WFS only. Fixed allow-list, fixed Seo-gu scope, bounded pages, no key disclosure. */
import {VW_BY_ID} from '../../src/city/vworld-catalog.js';
import {boundsOf,mercator,unmercator,clipFeature,validGeometry,fc} from '../../src/city/geometry.js';
import {HttpError,requireKey,origin,bytes,endpoint,scopeFor,n} from './common.js';
export const PAGE_SIZE=1000,MAX_PAGES=30;
const ALLOWED=new Set(['name','uname','nm','fac_nm','fclty_nm','fclty_nam','buld_nm','bldg_nm','lib_nm','muse_nm','market_nm','sigg_name','sido_name','sigungu_cd','ucode','dyear','grade','risk','grd','adres','address','addr','road_nm','full_nm','height','buld_hg','buldhg','grnd_flr','groundfloor','source_date','data_dt','reference_date','base_date','obsr_dt','geom_name','schul_nm','school_nm']);
export function themeRequest(id,q,env=process.env){
 const t=VW_BY_ID[id];if(!t)throw new HttpError(400,'허용된 주제도만 조회할 수 있습니다.','UNKNOWN_THEME');
 const page=Number(q.get('page')||1);if(!Number.isInteger(page)||page<1||page>MAX_PAGES)throw new HttpError(400,'주제도는 30페이지까지 조회합니다. 큰 자료는 동을 선택하여 다시 조회하세요.','PAGE_LIMIT');
 const scope=scopeFor(q.get('dong')),b=boundsOf(scope),bbox=[...mercator(b.slice(0,2)),...mercator(b.slice(2))];
 const url=endpoint('https://api.vworld.kr/req/wfs',{service:'WFS',request:'GetFeature',version:'2.0.0',typename:t.wfs,output:'application/json',srsname:'EPSG:3857',bbox:bbox.join(','),count:PAGE_SIZE,startindex:(page-1)*PAGE_SIZE,key:requireKey(env.VWORLD_API_KEY,'브이월드 REST'),domain:origin(env)});
 return {t,page,scope,url};
}
function transformGeometry(g,crs){
 if(!g||!['Point','LineString','MultiLineString','Polygon','MultiPolygon'].includes(g.type))return null;
 let vertices=0;
 function visit(c){if(!Array.isArray(c))throw Error('coordinate structure');if(typeof c[0]==='number'){if(++vertices>60000||c.length<2||!c.slice(0,2).every(Number.isFinite))throw Error('coordinates');if(crs==='3857'){if(c.some(v=>Math.abs(v)>21000000)||Math.abs(c[0])<1000)throw Error('CRS units');return unmercator(c);}if(Math.abs(c[0])>180||Math.abs(c[1])>90)throw Error('CRS units');return c.slice(0,2);}return c.map(visit);}
 return {type:g.type,coordinates:visit(g.coordinates)};
}
export function normalizeThemeResponse(body,{t,page,scope},collectedAt=new Date().toISOString()){
 if(body?.response?.status==='ERROR'||body?.status==='ERROR')throw new HttpError(502,'브이월드가 인증·요청 오류를 반환했습니다. 키의 승인 서비스와 도메인을 확인하세요.','VWORLD_API_ERROR');
 if(!Array.isArray(body?.features))throw new HttpError(502,'WFS GeoJSON 배열을 받지 못했습니다.','WFS_SCHEMA');
 const raw=body.features;if(raw.length>PAGE_SIZE)throw new HttpError(502,'예상한 페이지 크기를 초과했습니다.','WFS_PAGE_SIZE');
 const crsText=String(body.crs?.properties?.name||body.crs?.name||'EPSG:3857');
 const crs=/3857|900913/.test(crsText)?'3857':/4326|CRS84/i.test(crsText)?'4326':null;
 if(!crs)throw new HttpError(502,'지원하지 않는 원본 좌표계입니다.','WFS_CRS');
 const matched=n(body.numberMatched??body.totalFeatures),returned=n(body.numberReturned);if(returned!==null&&returned!==raw.length)throw new HttpError(502,'반환 건수와 실제 항목 수가 다릅니다.','WFS_COUNT');
 if(matched!==null&&(matched<0||matched<(page-1)*PAGE_SIZE+raw.length&&raw.length))throw new HttpError(502,'원본 전체 건수와 페이지 범위가 일치하지 않습니다.','WFS_COUNT');
 const out=[],rejected={geometry:0,outside:0,withoutId:0};
 for(const f of raw){try{
  const g=transformGeometry(f.geometry,crs);if(!g){rejected.geometry++;continue;}
  const properties=Object.create(null);for(const[k,v]of Object.entries(f.properties||{})){const key=k.toLowerCase();if(ALLOWED.has(key)&&(typeof v==='string'||typeof v==='number'))properties[key]=typeof v==='string'?v.slice(0,300):v;}
  const originalId=f.id??f.properties?.gid??f.properties?.fid;if(originalId===undefined||originalId===null){rejected.withoutId++;continue;}
  const id=t.id+':'+String(originalId).slice(0,180),name=['name','uname','nm','fac_nm','fclty_nm','fclty_nam','buld_nm','lib_nm','muse_nm','school_nm'].map(k=>properties[k]).find(Boolean)||t.title+' · '+String(originalId).slice(0,70);
  const date=[properties.source_date,properties.data_dt,properties.reference_date,properties.base_date].find(v=>/^\d{4}[-/]?\d{2}[-/]?\d{2}$/.test(String(v||'')))||null;
  const clipped=clipFeature({type:'Feature',geometry:g,properties:{id,name,sourceName:'브이월드 WFS · '+t.title,sourceUrl:t.sourceUrl,sourceDate:date,sourceYear:properties.dyear??null,collectedAt,originalId:String(originalId),originalCrs:crsText,sourceAttributes:properties,geometryMeaning:'제공 도형을 서구 선택경계로 절단한 자료',note:t.note}},scope);
  if(!clipped){rejected.outside++;continue;}if(!validGeometry(clipped.geometry)){rejected.geometry++;continue;}out.push(clipped);
 }catch{rejected.geometry++;}}
 const complete=matched!==null?(page-1)*PAGE_SIZE+raw.length>=matched:raw.length<PAGE_SIZE;
 if(!complete&&raw.length===0)throw new HttpError(502,'남은 자료가 있는데 빈 페이지가 반환되었습니다.','WFS_INCOMPLETE');
 return {ok:true,geojson:fc(out),sourceName:'브이월드 WFS · '+t.title,sourceDate:null,collectedAt,pageFingerprint:createHash('sha256').update(JSON.stringify(raw.map(f=>[f.id,f.geometry]))).digest('hex'),totalScanned:raw.length,totalCount:matched,complete,nextPage:complete?null:page+1,rejected,queriedCrs:'EPSG:3857',responseCrs:crsText,crsEvidence:body.crs?'response':'requested',queryScope:'Seo-gu boundary / selected administrative dong',snapshotComplete:complete&&page===1,coverage:'API 응답 범위이며 실제 시설 전수·현장 상태를 보증하지 않음',note:t.note};
}
export async function readTheme(id,q,{env=process.env,fetcher=fetch}={}){
 const request=themeRequest(id,q,env),out=await bytes(request.url,{fetcher,max:6*1024*1024,timeout:20000});let b;try{b=JSON.parse(out.data.toString('utf8'));}catch{throw new HttpError(502,'WFS가 JSON 대신 오류 문서 등을 반환했습니다.','WFS_NON_JSON');}return normalizeThemeResponse(b,request);
}
