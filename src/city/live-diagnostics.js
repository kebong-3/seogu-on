/**
 * 상단 관측정보가 '미수신'일 때 그 이유를 운영자가 읽을 수 있는 말로 바꾼다.
 * 서버가 돌려준 code/stage만 사용하며, 인증키나 요청 주소는 화면에 나오지 않는다.
 */

/** code → [짧은 이유, 운영자가 확인할 일] */
const REASONS = {
  NOT_CONFIGURED: ['인증키 미설정', 'Vercel → Settings → Environment Variables에 키를 넣고(Production 체크) 다시 배포하세요.'],
  KEY_REJECTED: ['인증키 거부', '공공데이터포털 마이페이지의 인증키를 다시 복사해 넣으세요. 새로 발급·신청한 키는 반영까지 1~2시간 걸릴 수 있습니다. 활용기간 만료 여부도 확인하세요.'],
  ACCESS_DENIED: ['활용신청 필요', '공공데이터포털에서 해당 API의 활용신청이 승인 상태인지 확인하세요. 키가 같아도 API마다 따로 신청해야 합니다.'],
  QUOTA_EXCEEDED: ['호출 한도 초과', '일일 트래픽 한도를 넘었습니다. 다음 날 초기화되며, 계속되면 포털에서 운영계정 전환(한도 상향)을 신청하세요.'],
  NO_STATION: ['서구 안 측정소 없음', '측정소 목록은 받았지만 서구 경계 안에 측정소가 없습니다. AIRKOREA_REGION_QUERY 값(기본 “광주”)을 확인하세요. 다른 구의 측정소로 대신하지 않습니다.'],
  NO_DATA: ['해당 시각 자료 없음', '제공기관이 아직 이 시각의 자료를 올리지 않았습니다. 다음 갱신 때 다시 조회합니다.'],
  UPSTREAM_TIMEOUT: ['제공기관 응답 지연', '제공기관 서버가 느립니다. 10분 뒤 자동으로 다시 조회합니다. 반복되면 공공데이터포털 공지를 확인하세요.'],
  UPSTREAM_UNREACHABLE: ['제공기관 연결 실패', '제공기관 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하고, 반복되면 Vercel 함수 로그를 확인하세요.'],
  UPSTREAM_HTTP: ['제공기관 오류 응답', '제공기관이 오류 상태를 돌려주었습니다. 점검 공지와 Vercel 함수 로그의 [air]/[weather] 줄을 확인하세요.'],
  BAD_SHAPE: ['응답 형식 변경', '제공기관 응답 형식이 예상과 다릅니다. API 명세가 바뀌었는지 확인이 필요합니다(개발자 확인).'],
  UPSTREAM_ERROR: ['제공기관 요청 오류', '제공기관이 요청을 처리하지 못했습니다. Vercel 함수 로그의 결과코드를 확인하세요.'],
  CLIENT_TIMEOUT: ['응답 지연', '서버 응답이 30초 안에 오지 않았습니다. 잠시 뒤 다시 조회합니다.'],
  UNKNOWN: ['원인 미확인', 'Vercel 함수 로그에서 /api/weather, /api/city-data 요청의 상태를 확인하세요.']
};

/** 단계 → 서비스 이름, 관련 환경변수, 공공데이터포털에서 활용신청할 API 이름 */
const STAGES = {
  weather: {name: '기상청 초단기실황', env: 'KMA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY', portal: '기상청_단기예보 조회서비스'},
  forecast: {name: '기상청 단기예보', env: 'KMA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY', portal: '기상청_단기예보 조회서비스'},
  'station-list': {name: '에어코리아 측정소정보', env: 'AIRKOREA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY', portal: '한국환경공단_에어코리아_측정소정보'},
  measurement: {name: '에어코리아 대기오염정보', env: 'AIRKOREA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY', portal: '한국환경공단_에어코리아_대기오염정보'}
};

/** fetchJSON이 던진 오류(또는 본문의 code)를 화면용 설명으로 바꾼다. */
export function explainFailure(failure, fallbackStage = '') {
  if (!failure) return null;
  let code = String(failure.code || '');
  if (!code && (failure.name === 'TimeoutError' || failure.name === 'AbortError')) code = 'CLIENT_TIMEOUT';
  if (!REASONS[code]) code = 'UNKNOWN';
  const stage = STAGES[failure.stage] ? failure.stage : fallbackStage, known = STAGES[stage];
  let hint = REASONS[code][1];
  if (known && code === 'NOT_CONFIGURED') hint += ` 필요한 변수: ${known.env}.`;
  if (known && ['ACCESS_DENIED', 'KEY_REJECTED'].includes(code)) hint += ` 대상 API: 「${known.portal}」.`;
  return {code, stage, service: known?.name || '', reason: REASONS[code][0], hint, httpStatus: Number.isFinite(failure.status) ? failure.status : null};
}

/** 말풍선(title)용 한 줄 */
export function failureTooltip(info) {
  if (!info) return '';
  return `미수신 · ${info.service ? info.service + ' · ' : ''}${info.reason} (${info.code})`;
}

export const DIAGNOSTIC_REASONS = REASONS;
