import { respond, allowRead, fetchJsonLimited, upstreamMessage } from '../server/http.js';
import { extractRows, normalizeRows, validateMappingConfig } from '../server/normalize.js';
export default async function handler(req, res) {
  if (!allowRead(req, res)) return;
  const settings = validateMappingConfig(process.env);
  if (settings.error) { respond(res, 503, { ok: false, error: settings.error }); return; }
  const { url, mapping, extra } = settings;
  for (const [k, v] of Object.entries(extra)) if (!['serviceKey', 'page', 'pageNo', 'perPage', 'numOfRows'].includes(k)) url.searchParams.set(k, String(v));
  let key = process.env.DATA_GO_KR_SERVICE_KEY;
  // URLSearchParams performs encoding once. Accept either decoding or encoding service key.
  try { key = decodeURIComponent(key); } catch { /* Already decoded non-URI token. */ }
  url.searchParams.set('serviceKey', key);
  if (url.hostname === 'api.odcloud.kr') { url.searchParams.set('page', '1'); url.searchParams.set('perPage', '1000'); url.searchParams.set('returnType', 'JSON'); }
  else { url.searchParams.set('pageNo', '1'); url.searchParams.set('numOfRows', '1000'); }
  try {
    const payload = await fetchJsonLimited(url), extracted = extractRows(payload);
    const rows = extracted.rows.slice(0, 1000), normalized = normalizeRows(rows, mapping, process.env.DATA_SOURCE_NAME, process.env.DATA_SOURCE_DATE);
    const total = extracted.total === null ? null : Number(extracted.total);
    const knownTotal = Number.isFinite(total) && total >= 0 ? total : null;
    const partial = knownTotal === null || knownTotal > rows.length || extracted.rows.length > 1000;
    const notices = [
      `1페이지만 수집: 응답 ${rows.length}행 / 원 API 전체 ${knownTotal === null ? '미확인' : knownTotal}행`,
      `광주 주변 좌표·필드 검증 후 ${normalized.features.length}개 / 제외 ${normalized.excluded}개`,
      '좌표 범위 필터는 서구 행정경계 판정이 아닙니다. 담당자가 관할과 시설 위치를 검수해야 합니다.',
      '이 연결은 시설 기본정보만 수집합니다. 월별 실적은 연결하지 않아 빈 값으로 유지합니다.',
    ];
    if (partial) notices.unshift('전체수집 아님: 총건수 미확인 또는 나머지 페이지 미수집. 전체 현황으로 사용하지 마세요.');
    respond(res, 200, { ok: true, geojson: { type: 'FeatureCollection', features: normalized.features }, sourceName: process.env.DATA_SOURCE_NAME,
      partial, collectedAt: new Date().toISOString(), notices }, 300);
  } catch (error) {
    const own = { API_SHAPE_UNSUPPORTED: '지원하지 않는 JSON 구조입니다. 해당 API 명세에 맞는 어댑터 수정이 필요합니다.', API_RESULT_ERROR: '공공데이터 API가 오류 상태를 반환했습니다. 인증과 서비스 승인을 확인하세요.', FIELD_MAP_INVALID: 'DATA_FIELD_MAP 설정을 확인하세요.' };
    respond(res, 502, { ok: false, error: own[error.message] || upstreamMessage(error) });
  }
}
