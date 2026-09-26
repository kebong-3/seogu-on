import { respond, allowRead, queryValue, safeDomain, fetchJsonLimited, upstreamMessage } from '../server/http.js';
export default async function handler(req, res) {
  if (!allowRead(req, res)) return;
  const key = process.env.VWORLD_API_KEY, domain = safeDomain(process.env.VWORLD_DOMAIN || '');
  if (!key || !domain) { respond(res, 503, { ok: false, error: 'VWORLD_API_KEY와 VWORLD_DOMAIN 환경변수가 필요합니다.' }); return; }
  const kind = queryValue(req, 'kind');
  if (!['search', 'boundary'].includes(kind)) { respond(res, 400, { ok: false, error: '지원되는 요청은 search와 boundary입니다.' }); return; }
  const url = new URL(kind === 'search' ? 'https://api.vworld.kr/req/search' : 'https://api.vworld.kr/req/data');
  const params = { key, domain, service: kind === 'search' ? 'search' : 'data', request: kind === 'search' ? 'search' : 'GetFeature', version: '2.0', format: 'json', size: kind === 'search' ? '20' : '10', page: '1', crs: 'EPSG:4326' };
  let code;
  if (kind === 'search') {
    const q = queryValue(req, 'q').trim();
    if (q.length < 2 || q.length > 100) { respond(res, 400, { ok: false, error: '검색어는 2~100자여야 합니다.' }); return; }
    Object.assign(params, { query: q, type: 'place', bbox: '126.70,34.98,127.05,35.35' });
  } else {
    code = process.env.VWORLD_SIG_CODE || '';
    if (!/^\d{5}$/.test(code)) { respond(res, 500, { ok: false, error: '18개 행정동은 내장 경계를 사용하세요. 구 외곽 REST 조회에는 제공기관이 지원하는 현행 5자리 VWORLD_SIG_CODE를 명시해야 합니다.' }); return; }
    Object.assign(params, { data: 'LT_C_ADSIGG_INFO', attrfilter: `sig_cd:=:${code}`, geometry: 'true', attribute: 'true' });
  }
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  try {
    const body = await fetchJsonLimited(url), result = body.response;
    if (!result || !['OK', 'NOT_FOUND'].includes(result.status)) { respond(res, 502, { ok: false, error: '브이월드 인증·요청 오류입니다. 키·도메인·API 권한을 확인하세요.' }); return; }
    if (kind === 'boundary') {
      const geojson = result.result?.featureCollection;
      if (!geojson || !geojson.features?.length) { respond(res, 404, { ok: false, error: `코드 ${code}의 경계를 조회하지 못했습니다. 현행 시군구 코드를 확인하세요.` }); return; }
      const supported = geojson.features.every(f => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type));
      if (!supported) { respond(res, 502, { ok: false, error: '제공된 경계의 도형 형식을 확인해야 합니다.' }); return; }
      respond(res, 200, { ok: true, code, sourceName: '브이월드 행정구역', geojson }, 300);
    } else {
      const items = (result.result?.items || []).map(item => ({
        name: String(item.title || '').slice(0, 200), address: String(item.address?.road || item.address?.parcel || '').slice(0, 250), longitude: Number(item.point?.x), latitude: Number(item.point?.y),
      })).filter(item => Number.isFinite(item.longitude) && Number.isFinite(item.latitude) && item.longitude >= 126.70 && item.longitude <= 127.05 && item.latitude >= 34.98 && item.latitude <= 35.35);
      respond(res, 200, { ok: true, items, sourceName: '브이월드 장소검색' }, 60);
    }
  } catch (error) { respond(res, 502, { ok: false, error: upstreamMessage(error) }); }
}
