/**
 * 공공데이터포털(apis.data.go.kr) 계열 API의 실패 원인을 운영자가 알아볼 수 있는 코드로 분류한다.
 * 이 파일은 다른 파일을 import하지 않는다(api/weather.js처럼 경계 파일을 싣지 않는 함수에서도 쓰기 위함).
 * 응답에는 코드와 한국어 안내만 담는다. 인증키·전체 주소는 절대 넣지 않는다.
 */

/** 화면·문서에서 함께 쓰는 코드 목록 */
export const DIAGNOSTIC_CODES = {
  NOT_CONFIGURED: {status: 503, message: '인증키 환경변수가 설정되지 않았습니다.'},
  KEY_REJECTED: {status: 503, message: '제공기관이 인증키를 거부했습니다. 키 값·만료·등록 반영 대기(1~2시간)를 확인하세요.'},
  ACCESS_DENIED: {status: 503, message: '인증키는 있으나 이 API의 활용신청(승인)이 확인되지 않았습니다.'},
  QUOTA_EXCEEDED: {status: 503, message: '제공기관의 일일 호출 한도를 넘었습니다. 한도가 초기화된 뒤 다시 조회됩니다.'},
  NO_STATION: {status: 404, message: '서구 경계 안에서 조회된 측정소가 없습니다.'},
  NO_DATA: {status: 404, message: '제공기관이 해당 시각의 자료를 반환하지 않았습니다.'},
  UPSTREAM_TIMEOUT: {status: 504, message: '제공기관 응답 시간이 초과되었습니다. 잠시 후 자동으로 다시 조회합니다.'},
  UPSTREAM_UNREACHABLE: {status: 502, message: '제공기관 서버에 연결하지 못했습니다.'},
  UPSTREAM_HTTP: {status: 502, message: '제공기관이 오류 상태(HTTP)를 반환했습니다.'},
  BAD_SHAPE: {status: 502, message: '제공기관 응답 형식이 예상과 다릅니다. API 명세 변경 여부를 확인하세요.'},
  UPSTREAM_ERROR: {status: 502, message: '제공기관이 요청 오류를 반환했습니다.'}
};

/** data.go.kr 공통 결과코드(resultCode / returnReasonCode) → 진단 코드 */
const RESULT_CODE = {
  '30': 'KEY_REJECTED', // SERVICE_KEY_IS_NOT_REGISTERED_ERROR
  '31': 'KEY_REJECTED', // DEADLINE_HAS_EXPIRED_ERROR
  '20': 'ACCESS_DENIED', // SERVICE_ACCESS_DENIED_ERROR
  '32': 'ACCESS_DENIED', // UNREGISTERED_IP_ERROR
  '33': 'ACCESS_DENIED', // UNSIGNED_CALL_ERROR
  '21': 'QUOTA_EXCEEDED', // TEMPORARILY_DISABLE_THE_SERVICEKEY_ERROR
  '22': 'QUOTA_EXCEEDED', // LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR
  '03': 'NO_DATA', '3': 'NO_DATA' // NODATA_ERROR
};

/** 게이트웨이가 본문 없이 HTTP 상태로만 거절하는 경우 */
const HTTP_STATUS = {401: 'KEY_REJECTED', 403: 'ACCESS_DENIED', 429: 'QUOTA_EXCEEDED', 504: 'UPSTREAM_TIMEOUT'};

/**
 * 오류 객체에서 진단 코드를 고른다. 분류할 수 없으면 null.
 * @returns {{code:string,detail:string}|null}
 */
export function diagnose(error) {
  const name = error?.name || '', code = String(error?.code || ''), message = String(error?.message || '');
  if (name === 'AbortError' || name === 'TimeoutError') return {code: 'UPSTREAM_TIMEOUT', detail: ''};
  if (code === 'NOT_CONFIGURED' || message === 'KEY_MISSING') return {code: 'NOT_CONFIGURED', detail: ''};
  const api = /^UPSTREAM_API_(.+)$/.exec(code) || /^KMA_RESULT_(.+)$/.exec(message);
  if (api) return {code: RESULT_CODE[api[1]] || 'UPSTREAM_ERROR', detail: `(제공기관 결과코드 ${api[1].slice(0, 12)})`};
  const http = code === 'UPSTREAM_HTTP' ? Number(error.upstreamStatus) : Number((/^UPSTREAM_HTTP_(\d{3})$/.exec(message) || [])[1]);
  if (http) return {code: HTTP_STATUS[http] || 'UPSTREAM_HTTP', detail: `(HTTP ${http})`};
  if (code === 'UPSTREAM_HTTP') return {code: 'UPSTREAM_HTTP', detail: ''};
  if (code === 'SCHEMA_CHANGED' || /JSON 응답 형식|XML 응답 구조|UPSTREAM_NOT_JSON|OBSERVATION_TIME_MISMATCH/.test(message)) return {code: 'BAD_SHAPE', detail: ''};
  if (code === 'NO_DATA' || message === 'NO_OBSERVATIONS') return {code: 'NO_DATA', detail: ''};
  return null;
}

/**
 * 환경변수에 붙여 넣은 키를 정리한다.
 * - 앞뒤 공백·줄바꿈·따옴표 제거(붙여넣기 실수)
 * - 포털의 'Encoding' 키(%2B, %3D 포함)는 한 번 풀어 'Decoding' 형태로 맞춘다.
 *   URL을 만들 때 다시 한 번만 인코딩되므로 이중 인코딩(%252B)으로 거부되는 일을 막는다.
 */
export function normalizeServiceKey(raw) {
  let key = String(raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(key); i++) {
    try { key = decodeURIComponent(key); } catch { break; }
  }
  return key;
}

/** 여러 환경변수 중 값이 있는 것만, 중복 없이, 정리된 형태로 */
export function keyCandidates(...values) {
  return [...new Set(values.map(normalizeServiceKey).filter(Boolean))];
}
