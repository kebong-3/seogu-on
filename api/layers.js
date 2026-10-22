import {allowLegacyRegion} from '../server/region-compat.js';
import { allowRead, queryValue, respond, upstreamMessage } from '../server/http.js';
import { sourcesFromEnv, publicCatalog } from '../server/catalog.js';
import { readLayerPage } from '../server/layer-service.js';
export default async function handler(req,res){
 if(!allowLegacyRegion(req,res))return;
  if(!allowRead(req,res))return;
  const id=queryValue(req,'id');
  try {
    if(!id){respond(res,200,{ok:true,sources:publicCatalog()});return;}
    if(!/^[-a-z0-9]{1,40}$/.test(id)){respond(res,400,{ok:false,error:'자료 ID 형식 오류'});return;}
    const source=sourcesFromEnv().find(x=>x.id===id);
    if(!source){respond(res,404,{ok:false,error:'등록되지 않은 자료입니다.'});return;}
    const page=Number(queryValue(req,'page')||1);
    if(!Number.isInteger(page)||page<1||page>50){respond(res,400,{ok:false,error:'페이지는 1~50입니다.'});return;}
    const data=await readLayerPage(source,page);
    respond(res,200,data,data.state==='ready'?300:0);
  }catch(e){
    const missing=e.message==='KEY_MISSING';
    respond(res,missing?503:502,{ok:false,state:'error',error:missing?'이 자료의 공공데이터 활용신청 승인과 서버 인증키 설정이 필요합니다.':upstreamMessage(e)});
  }
}
