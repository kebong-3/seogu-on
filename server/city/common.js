import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fc,unionGeometry,boundsOf,clipFeature,inside,validGeometry} from '../../src/city/geometry.js';
export const dongs=JSON.parse(readFileSync(fileURLToPath(new URL('../../public/data/admin-dongs.geojson',import.meta.url)),'utf8'));
export const district=unionGeometry(dongs.features);
export const districtBounds=boundsOf(district);
export function scopeFor(id){if(!id||id==='all')return district;const f=dongs.features.find(f=>f.properties.dongId===id);if(!f)throw new HttpError(400,'알 수 없는 행정동입니다.');return f.geometry;}
export class HttpError extends Error{constructor(status,message,code=''){super(message);this.status=status;this.code=code;}}
export const text=(v,max=350)=>String(v??'').slice(0,max);
export function n(v){if(v==null||String(v).trim()===''||String(v)==='-')return null;const x=Number(v);return Number.isFinite(x)?x:null;}
export function keyValue(key){try{return decodeURIComponent(key||'');}catch{return key||'';}}
export function requireKey(key,label){if(!key)throw new HttpError(503,`${label} 인증키가 설정되지 않았습니다.`,'NOT_CONFIGURED');return keyValue(key);}
export function origin(env=process.env){try{const u=new URL(env.VWORLD_DOMAIN||'');if(u.protocol!=='https:'&&u.hostname!=='localhost')throw Error();if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error();return u.origin;}catch{throw new HttpError(503,'VWORLD_DOMAIN에 등록된 HTTPS 서비스 주소를 설정하세요.','NOT_CONFIGURED');}}
const buckets=new Map();
export function gate(req,res,limit=100){if(!['GET','HEAD'].includes(req.method||'GET')){send(res,405,{ok:false,error:'GET 요청만 지원합니다.'});return false;}
 const host=req.headers?.host;const ori=req.headers?.origin;if(ori){try{if(new URL(ori).host!==host){send(res,403,{ok:false,error:'다른 출처의 요청입니다.'});return false;}}catch{send(res,403,{ok:false,error:'출처 오류'});return false;}}
 const ip=String(req.headers?.['x-forwarded-for']||'local').split(',')[0],now=Date.now(),id=`${limit}:${ip}`;let b=buckets.get(id);if(!b||now>b.end)b={count:0,end:now+60000};if(++b.count>limit){send(res,429,{ok:false,error:'잠시 후 다시 요청하세요.'});return false;}buckets.set(id,b);if(buckets.size>4000){for(const [k,v]of buckets)if(v.end<now)buckets.delete(k);while(buckets.size>4000)buckets.delete(buckets.keys().next().value);}return true;}
export function send(res,status,body,cache=0){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control',cache?`public, max-age=${cache}`:'no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));}
export function fail(res,e){send(res,e instanceof HttpError?e.status:502,{ok:false,error:e instanceof HttpError?e.message:'제공기관 응답을 확인하지 못했습니다. 이전 자료는 유지합니다.',code:e instanceof HttpError?e.code:'UPSTREAM_UNAVAILABLE'});}
const ALLOWED=new Set(['api.vworld.kr','www.safemap.go.kr','data.floodmap.go.kr','www.safetydata.go.kr','apis.data.go.kr','api.odcloud.kr','api.data.go.kr','openapi.its.go.kr','its.go.kr']);
export async function bytes(url,{fetcher=fetch,max=2*1024*1024,timeout=8500}={}){
 const u=new URL(url);if(u.protocol!=='https:'||!ALLOWED.has(u.hostname)||u.username||u.password)throw new HttpError(400,'허용되지 않은 외부 주소입니다.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const r=await fetcher(u,{signal:controller.signal,redirect:'error',headers:{Accept:'application/json,application/xml,image/png'}});if(!r.ok)throw new HttpError(502,`제공기관 HTTP ${r.status} 응답입니다.`,'UPSTREAM_HTTP');if(n(r.headers.get('content-length'))>max)throw new HttpError(502,'제공기관 응답 크기 제한을 초과했습니다.');
 let data;if(r.body?.getReader){const reader=r.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(502,'제공기관 응답 크기 제한을 초과했습니다.');}chunks.push(value);}data=Buffer.concat(chunks.map(v=>Buffer.from(v)));}finally{reader.releaseLock();}}else data=Buffer.from(await r.arrayBuffer());if(data.length>max)throw new HttpError(502,'응답 크기 제한');return {data,type:r.headers.get('content-type')||''};
 }finally{clearTimeout(timer);}}
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>String.fromCodePoint(v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):+v)).replace(/&(lt|gt|amp|quot|apos);/g,(_,v)=>({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[v]));
/* A deliberately limited parser for flat <item><field>text</field></item> government responses, not arbitrary XML. */
export function flatXml(s){if(/<!DOCTYPE|<!ENTITY/i.test(s))throw new HttpError(502,'외부 엔티티 XML은 허용하지 않습니다.');if(!/^\s*(<\?xml[^>]*>\s*)?<\w+[\s>]/.test(s)||!/<\/(response|OpenAPI_ServiceResponse|body)>\s*$/i.test(s))throw new HttpError(502,'XML 응답 구조 오류');
 const value=tag=>decode(s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'))?.[1]||'');
 const items=[...s.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>Object.fromEntries([...m[1].matchAll(/<([A-Za-z_][\w:]*)[^>]*>([\s\S]*?)<\/\1>/g)].map(a=>[a[1],decode(a[2]).trim()])));
 if(items.length>1500)throw new HttpError(502,'페이지 항목 수 제한');return {items,totalCount:n(value('totalCount')),resultCode:value('resultCode')||value('returnReasonCode'),resultMsg:value('resultMsg')};}
export async function json(url,opts={}){const {data}=await bytes(url,opts);const t=data.toString('utf8').trim();if(t.startsWith('<'))return flatXml(t);try{return JSON.parse(t);}catch{throw new HttpError(502,'제공기관의 JSON 응답 형식을 확인하세요.');}}
export function records(body){const code=body?.response?.header?.resultCode??body?.header?.resultCode??body?.resultCode;if(code!=null&&code!==''&&!['00','0','INFO-000'].includes(String(code)))throw new HttpError(502,'제공기관이 인증 또는 요청 오류를 반환했습니다.','UPSTREAM_API');
 const candidates=[body?.response?.body?.items?.item,body?.response?.body?.items,body?.body?.items,body?.body?.item,body?.response?.data,body?.result?.data,body?.data,body?.items?.item,body?.items,body?.body];
 for(const candidate of candidates)if(Array.isArray(candidate))return candidate;else if(candidate&&typeof candidate==='object'&&(candidate.RSTR_FCLTY_NO||candidate.hpid||candidate.spot_nm||candidate.stationName))return [candidate];
 throw new HttpError(502,'자료 항목 배열을 확인하지 못했습니다.','SCHEMA_CHANGED');}
export function totalOf(body){return n(body?.response?.body?.totalCount??body?.body?.totalCount??body?.totalCount??body?.header?.totalCount);}
export function endpoint(base,params){const u=new URL(base);for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));return u;}
export function cleanPoint(id,name,lon,lat,props,scope){const p=[n(lon),n(lat)];if(!p.every(Number.isFinite)||!inside(p,scope))return null;return {type:'Feature',id:String(id),geometry:{type:'Point',coordinates:p},properties:{id:String(id),name:text(name)||'명칭 없음',...props}};}
export function safeFeatures(fs,scope){const out=[];let invalid=0;for(const f of fs){if(!validGeometry(f.geometry)){invalid++;continue;}try{const c=clipFeature(f,scope);if(c)out.push(c);}catch{invalid++;}}return {features:out,invalid};}
