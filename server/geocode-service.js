import {fetchJsonLimited,safeDomain} from './http.js';
/** Public registered facility addresses only. The caller never supplies an upstream URL. */
export function geocodeRequest(record,env){
 const domain=safeDomain(env.VWORLD_DOMAIN||''),key=env.VWORLD_API_KEY;
 if(!key||!domain)throw Error('VWORLD_API_KEY와 VWORLD_DOMAIN을 등록하고 재배포하세요.');
 if(!record||!String(record.address||'').includes('서구'))throw Error('등록된 서구 공개시설만 변환합니다.');
 let address=String(record.address).replace(/\([^)]*\)/g,'').trim();
 if(address.startsWith('서구'))address='광주광역시 '+address;
 const u=new URL('https://api.vworld.kr/req/address');
 for(const[k,v]of Object.entries({service:'address',request:'getcoord',crs:'EPSG:4326',format:'json',type:'ROAD',address,key,domain}))u.searchParams.set(k,v);
 return u;
}
export async function geocodePublicRecord(record,env=process.env,fetcher=fetch){
 const raw=await fetchJsonLimited(geocodeRequest(record,env),8500,fetcher),r=raw.response;
 if(r?.status!=='OK')throw Error('브이월드에서 해당 주소의 좌표를 확인하지 못했습니다. 서비스 승인·주소를 확인하세요.');
 const p=r.result?.point,lon=Number(p?.x),lat=Number(p?.y);
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<126.7||lon>127.05||lat<34.98||lat>35.35)throw Error('서구 주변 범위를 벗어난 좌표 후보는 사용하지 않습니다.');
 return {ok:true,recordId:record.id,name:record.name,address:record.address,coordinates:[lon,lat],source:'브이월드 주소→좌표 API',reviewStatus:'candidate-only',notice:'주소에 대응한 좌표 후보입니다. 실제 시설·출입구·대피 장소의 위치를 확인한 뒤 등록하세요. 자동 등록하지 않습니다.'};
}
