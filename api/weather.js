import {allowRead,respond,queryValue,upstreamMessage} from '../server/http.js';
import {readWeather} from '../server/weather-service.js';
import {DIAGNOSTIC_CODES,diagnose} from '../server/diagnostics.js';
import {loadRegionProfile} from '../server/region-profile.js';
import {pointInBounds,RegionProfileError} from '../shared/region-profile.js';

export default async function handler(req,res,options={}){
 if(!allowRead(req,res))return;
 const env=options.env||process.env;
 const params=new URL(req.url||'/','https://local.invalid').searchParams;
 const regionId=params.has('regionId')?params.get('regionId'):undefined;
 let profile;
 try{profile=await loadRegionProfile({env,publicRoot:options.publicRoot,regionId});}
 catch(e){
  const known=e instanceof RegionProfileError||e.status===400;
  respond(res,e.status||503,{ok:false,code:known?e.code:'REGION_PROFILE_UNAVAILABLE',error:known?e.message:'날씨를 조회할 지역 설정을 확인하지 못했습니다.',stage:'weather'});return;
 }
 const x=queryValue(req,'lon'),y=queryValue(req,'lat'),lon=Number(x),lat=Number(y);
 if(!x||!y||!pointInBounds([lon,lat],profile.bounds)){respond(res,400,{ok:false,code:'INVALID_WEATHER_COORDINATE',error:`${profile.name}의 지도 범위 안에 있는 유효한 경도·위도가 필요합니다.`,regionId:profile.id,stage:'weather'});return;}
 try{respond(res,200,{...await readWeather(lon,lat,{env,fetcher:options.fetcher,now:options.now}),regionId:profile.id},300);}
 catch(e){
  /* 실패 원인 코드(code)를 함께 돌려준다. 키 값과 요청 주소는 응답·로그에 남기지 않는다. */
  const found=diagnose(e),code=found?.code||'UPSTREAM_UNREACHABLE',known=DIAGNOSTIC_CODES[code];
  console.warn('[weather] upstream status',code,String(e.message||'UNKNOWN').replace(/[^A-Z0-9_-]/gi,'').slice(0,64));
  const error=code==='NOT_CONFIGURED'?'기상청 초단기실황 활용신청 후 KMA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY를 설정하세요.':found?`기상청 초단기실황: ${known.message} ${found.detail}`.trim():upstreamMessage(e);
  respond(res,known.status,{ok:false,error,code,stage:'weather'});
 }
}
