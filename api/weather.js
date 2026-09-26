import {allowRead,respond,queryValue,upstreamMessage} from '../server/http.js';
import {readWeather} from '../server/weather-service.js';
export default async function handler(req,res){
 if(!allowRead(req,res))return;
 const x=queryValue(req,'lon'),y=queryValue(req,'lat'),lon=Number(x),lat=Number(y);
 if(!x||!y||!Number.isFinite(lon)||!Number.isFinite(lat)||lon<126.7||lon>127.05||lat<34.98||lat>35.35){respond(res,400,{ok:false,error:'서구 주변의 유효한 경도·위도가 필요합니다.'});return;}
 try{respond(res,200,await readWeather(lon,lat),300);}catch(e){respond(res,e.message==='KEY_MISSING'?503:502,{ok:false,error:e.message==='KEY_MISSING'?'기상청 초단기실황 활용신청 후 KMA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY를 설정하세요.':upstreamMessage(e)});}
}
