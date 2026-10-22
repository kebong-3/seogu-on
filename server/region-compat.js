/** Existing Seo-gu-only adapters must not answer for another deployment region. */
import {respond} from './http.js';
export function allowLegacyRegion(req,res,env=process.env) {
  if (!env.REGION_PROFILE || env.REGION_PROFILE === 'seogu') return true;
  respond(res,503,{ok:false,code:'REGION_ADAPTER_NOT_CONFIGURED',error:'이 기존 서비스의 지역별 자료 연결을 아직 검증하지 않았습니다. 현재 지역의 공공공간 활용 기능을 사용하세요.'});
  return false;
}
