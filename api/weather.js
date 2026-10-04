import {allowRead,respond,queryValue,upstreamMessage} from '../server/http.js';
import {readWeather} from '../server/weather-service.js';
import {DIAGNOSTIC_CODES,diagnose} from '../server/diagnostics.js';
export default async function handler(req,res){
 if(!allowRead(req,res))return;
 const x=queryValue(req,'lon'),y=queryValue(req,'lat'),lon=Number(x),lat=Number(y);
 if(!x||!y||!Number.isFinite(lon)||!Number.isFinite(lat)||lon<126.7||lon>127.05||lat<34.98||lat>35.35){respond(res,400,{ok:false,error:'서구 주변의 유효한 경도·위도가 필요합니다.'});return;}
 try{respond(res,200,await readWeather(lon,lat),300);}
 catch(e){
  /* 실패 원인 코드(code)를 함께 돌려준다. 키 값과 요청 주소는 응답·로그에 남기지 않는다. */
  const found=diagnose(e),code=found?.code||'UPSTREAM_UNREACHABLE',known=DIAGNOSTIC_CODES[code];
  console.warn('[weather] upstream status',code,String(e.message||'UNKNOWN').replace(/[^A-Z0-9_-]/gi,'').slice(0,64));
  const error=code==='NOT_CONFIGURED'?'기상청 초단기실황 활용신청 후 KMA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY를 설정하세요.':found?`기상청 초단기실황: ${known.message} ${found.detail}`.trim():upstreamMessage(e);
  respond(res,known.status,{ok:false,error,code,stage:'weather'});
 }
}
