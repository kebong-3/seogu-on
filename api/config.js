import { respond, allowRead, safeDomain } from '../server/http.js';
import { validateMappingConfig } from '../server/normalize.js';
export default function handler(req, res) {
  if (!allowRead(req, res)) return;
  const domain = safeDomain(process.env.VWORLD_DOMAIN || '');
  respond(res, 200, { version: '0.1.0', vworld3d: !!(process.env.VWORLD_BROWSER_KEY && domain),
    vworldRest: !!(process.env.VWORLD_API_KEY && domain), publicData: !validateMappingConfig(process.env).error,
    stateMeaning: '환경변수 설정 여부이며 인증 성공이나 자료 검수 완료가 아닙니다.' });
}
