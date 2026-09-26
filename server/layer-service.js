import { createHash } from 'node:crypto';
import { permittedDataUrl } from './normalize.js';
import { fetchJsonLimited } from './http.js';
import { validDate } from '../src/geo.js';
const caches=new Map(), flights=new Map();
export const clearLayerCache=()=>{caches.clear();flights.clear();};
function first(row,field){
  for(const name of (Array.isArray(field)?field:field?[field]:[]).flatMap(k=>[k,String(k).replace(/[A-Z]/g,x=>'_'+x).toUpperCase()])){if(['__proto__','constructor','prototype'].includes(name))continue;const v=Object.hasOwn(row,name)?row[name]:undefined;if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}
  return null;
}
const text=(v,n=250)=>typeof v==='string'||typeof v==='number'?String(v).trim().slice(0,n):'';
const num=v=>v===null||v===undefined||String(v).trim()===''?null:Number(String(v).replaceAll(',',''));
export function unpack(payload){
  const head=payload?.response?.header;
  if(head?.resultCode!=null&&!['00','0','NORMAL_SERVICE'].includes(String(head.resultCode)))throw new Error('API_RESULT_ERROR');
  if(payload?.code!=null && Number(payload.code)>=400)throw new Error('API_RESULT_ERROR');
  let rows,total,page;
  if(Array.isArray(payload?.data)){rows=payload.data;total=payload.matchCount??payload.totalCount;page=payload.page;}
  else {const b=payload?.response?.body||payload?.body;const item=b?.items?.item??b?.items;if(Array.isArray(item))rows=item;else if(item&&typeof item==='object')rows=[item];else if((item===''||item==null)&&Number(b?.totalCount)===0)rows=[];total=b?.totalCount;page=b?.pageNo;}
  if(!Array.isArray(rows))throw new Error('API_SHAPE_UNSUPPORTED');
  total=num(total);if(!Number.isInteger(total)||total<0)total=null;
  return {rows,total,upstreamPage:page==null?null:Number(page)};
}
export function normalizeLayerRows(rows,source){
  const fs=[],ids=new Set();let rejected=0,missingCoordinates=0,outsideGwangju=0,missingDate=0;
  const m=source.fields;
  for(const row of rows){
    if(!row||typeof row!=='object'){rejected++;continue;}
    const name=text(first(row,m.name),150),lon=num(first(row,m.longitude)),lat=num(first(row,m.latitude));
    if(!name){rejected++;continue;}
    if(lon===null||lat===null||!Number.isFinite(lon)||!Number.isFinite(lat)){missingCoordinates++;continue;}
    if(lon<126.70||lon>127.05||lat<34.98||lat>35.35){outsideGwangju++;continue;}
    const address=text(first(row,m.address)),rawDate=text(first(row,m.sourceDate)||source.sourceDate,20),sourceDate=validDate(rawDate)?rawDate:null;
    if(!sourceDate)missingDate++;
    const upstreamId=text(first(row,m.id),100);
    const stable=upstreamId||createHash('sha256').update(`${name}\0${address}\0${lon}\0${lat}`).digest('hex').slice(0,20);
    const id=`${source.id}:${stable}`;if(ids.has(id)){rejected++;continue;}ids.add(id);
    const capacity=num(first(row,m.capacity));
    fs.push({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{id,name,category:source.category,layerId:source.id,dataKind:'external',reviewStatus:'unverified',sourceName:text(source.sourceName,200),sourceUrl:text(source.sourceUrl,500),sourceDate,address,phone:text(first(row,m.phone),50),department:text(first(row,m.department),100),hours:text(first(row,m.hours)),capacity:Number.isFinite(capacity)&&capacity>=0?capacity:null,positionSource:'source-coordinates',monthly:{},metricName:'운영량',metricUnit:'건',note:text(source.note||'공개 API 수집값입니다. 운영 여부·위치는 별도 검수가 필요합니다.',500)}});
  }
  return {features:fs,rejected,missingCoordinates,outsideGwangju,missingDate};
}
export function sourceRequest(source,page,env){
  const url=permittedDataUrl(source.url);if(!url)throw new Error('허용된 공공데이터 HTTPS API 주소가 필요합니다.');
  if(!Number.isInteger(page)||page<1||page>50)throw new Error('페이지는 1~50 범위입니다.');
  let key=env[source.keyEnv];if(!key)throw new Error('KEY_MISSING');
  try{key=decodeURIComponent(key);}catch{throw new Error('인증키 인코딩을 확인하세요.');}
  for(const [k,v]of Object.entries(source.query||{}))url.searchParams.set(k,String(v));
  // Never allow configured query values to override credentials or paging controls.
  for(const k of [...url.searchParams.keys()])if(/^(servicekey|authorization|apikey|access_token)$/i.test(k))url.searchParams.delete(k);
  url.searchParams.set('serviceKey',key);
  if(source.type==='odcloud'){url.searchParams.set('page',String(page));url.searchParams.set('perPage',String(source.pageSize));url.searchParams.set('returnType','JSON');}
  else {url.searchParams.set('pageNo',String(page-1+source.pageBase));url.searchParams.set('numOfRows',String(source.pageSize));url.searchParams.set('type','json');}
  return url;
}
export async function readLayerPage(source,page,env=process.env,fetcher=fetch,now=Date.now){
  const url=sourceRequest(source,page,env);
  // Hash includes the key so revocation/config changes cannot reuse another configuration's cache.
  const hash=createHash('sha256').update(url.toString()+JSON.stringify(source)).digest('hex');
  const old=caches.get(hash);if(old&&now()-old.time<15*60*1000)return {...old.data,cache:'warm'};
  if(flights.has(hash))return flights.get(hash);
  const work=(async()=>{
    try{
      const raw=await fetchJsonLimited(url,9500,fetcher),out=unpack(raw),norm=normalizeLayerRows(out.rows,source);
      const expectedPage=source.type==='odcloud'?page:page-1+source.pageBase;
      if(out.upstreamPage!==null&&out.upstreamPage!==expectedPage)throw new Error('API_PAGE_MISMATCH');
      const readBefore=(page-1)*source.pageSize;
      const knownComplete=out.total!==null&&readBefore+out.rows.length>=out.total;
      const nextPage=!knownComplete&&out.rows.length===source.pageSize&&page<50?page+1:null;
      const data={ok:true,layerId:source.id,page,nextPage,total:out.total,upstreamRows:out.rows.length,complete:knownComplete,partial:!knownComplete&&nextPage===null,sourceName:source.sourceName,sourceUrl:source.sourceUrl||'',queryDescription:source.queryDescription||'설정된 API 조회범위',lastSuccessAt:new Date(now()).toISOString(),state:'ready',...norm,geojson:{type:'FeatureCollection',features:norm.features}};
      delete data.features;
      if(caches.size>=120)caches.delete(caches.keys().next().value);
      caches.set(hash,{time:now(),data});return data;
    }catch(error){
      if(old)return {...old.data,state:'stale',cache:'last-good',error:'제공기관 갱신 실패. 마지막 정상 수신자료를 유지합니다.'};
      throw error;
    }finally{flights.delete(hash);}
  })();flights.set(hash,work);return work;
}
