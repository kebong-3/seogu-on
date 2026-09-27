import {json,endpoint,requireKey,HttpError,n} from './common.js';
import {kmaGrid} from '../weather-service.js';
export function forecastBase(now=new Date()){
 const t=new Date(now.getTime()+9*3600000-90*60000),slots=[2,5,8,11,14,17,20,23];let h=slots.filter(h=>h<=t.getUTCHours()).at(-1);
 if(h===undefined){t.setUTCDate(t.getUTCDate()-1);h=23;}
 return {base_date:t.toISOString().slice(0,10).replaceAll('-',''),base_time:String(h).padStart(2,'0')+'00'};
}
export function forecastRows(items,base,now=new Date()){
 const nowKst=new Date(now.getTime()+9*3600000),key=nowKst.toISOString().slice(0,13).replace(/[-T:]/g,'')+'00',groups=new Map();
 for(const a of items){if(a.baseDate!==base.base_date||a.baseTime!==base.base_time)continue;const t=String(a.fcstDate||'')+String(a.fcstTime||'').padStart(4,'0');if(!/^\d{12}$/.test(t)||t<key)continue;if(!groups.has(t))groups.set(t,{});if(['TMP','SKY','PTY','POP','REH','WSD','VEC','PCP','TMN','TMX'].includes(a.category))groups.get(t)[a.category]=a.fcstValue;}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).slice(0,12).map(([time,values])=>({time,temperature:n(values.TMP),sky:n(values.SKY),precipitationType:n(values.PTY),precipitationProbability:n(values.POP),humidity:n(values.REH),windSpeed:n(values.WSD),windDirection:n(values.VEC),precipitationAmount:values.PCP??null,minTemperature:n(values.TMN),maxTemperature:n(values.TMX)}));
}
export async function readForecast(lon,lat,{env=process.env,fetcher=fetch,now=new Date()}={}){
 const grid=kmaGrid(lon,lat),base=forecastBase(now);const body=await json(endpoint('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst',{serviceKey:requireKey(env.KMA_SERVICE_KEY||env.DATA_GO_KR_SERVICE_KEY,'기상청'),pageNo:1,numOfRows:1000,dataType:'JSON',...grid,...base}),{fetcher});
 if(body.response?.header?.resultCode!=='00')throw new HttpError(502,'기상청 예보의 인증·발표시각을 확인하세요.');const items=body.response?.body?.items?.item;if(!Array.isArray(items))throw new HttpError(502,'기상청 예보 항목을 확인하지 못했습니다.');const rows=forecastRows(items,base,now);if(!rows.length)throw new HttpError(404,'해당 발표시각의 이후 예보자료가 없습니다.','NO_DATA');
 return {ok:true,kind:'forecast',grid,base,rows,sourceName:'기상청 단기예보',sourceUrl:'https://www.data.go.kr/data/15084084/openapi.do',collectedAt:now.toISOString(),note:'수신된 예보 중 이후 최대 12개 시각입니다. 예보이며 실측·개별 건물 예측이 아닙니다. 다른 시각의 값을 섞지 않습니다.'};
}
