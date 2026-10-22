import {allowLegacyRegion} from '../server/region-compat.js';
import {readFile} from 'node:fs/promises';
import {allowRead,queryValue,respond,upstreamMessage} from '../server/http.js';
import {geocodePublicRecord} from '../server/geocode-service.js';
let records;
export default async function handler(req,res){
 if(!allowLegacyRegion(req,res))return;
 if(!allowRead(req,res))return;
 const id=queryValue(req,'id');if(!/^address-\d{1,4}$/.test(id)){respond(res,400,{ok:false,error:'공개시설 목록의 항목 번호가 필요합니다.'});return;}
 try{
  records??=JSON.parse(await readFile(new URL('../public/data/address-records.json',import.meta.url),'utf8')).records;
  const row=records.find(r=>r.id===id);if(!row){respond(res,404,{ok:false,error:'등록된 공개시설이 아닙니다.'});return;}
  if(!process.env.VWORLD_API_KEY){respond(res,503,{ok:false,error:'Vercel에 VWORLD_API_KEY와 VWORLD_DOMAIN을 등록하고 재배포하세요.'});return;}
  const result=await geocodePublicRecord(row);respond(res,200,result,3600);
 }catch(e){respond(res,502,{ok:false,error:e.message?.startsWith('브이월드')||e.message?.startsWith('서구')?e.message:upstreamMessage(e)});}
}
