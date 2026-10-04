// 값 정리 도구: 제목행 이름 맞추기, 좌표 검증(뒤바뀜 판별), 날짜·전화번호·문자 정리.

/** 제목행 비교용 정규화: 공백·괄호·구두점을 없애고 소문자로. "위도(WGS84)" → "위도wgs84" */
export function normalizeHeader(header) {
  return String(header ?? '').normalize('NFC').replace(/[\s_\-·.,()\[\]{}:\/\\'"]/g, '').toLowerCase();
}

/** 별칭 목록 중 파일에 실제로 있는 첫 열의 번호를 찾습니다. 없으면 -1. */
export function findColumn(normalizedHeaders, aliases = []) {
  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(normalizeHeader(alias));
    if (index >= 0) return index;
  }
  return -1;
}

/** 별칭에 없더라도 이름에 '위도'/'경도'가 들어간 열이 하나뿐이면 그 열을 씁니다. */
export function findCoordinateColumn(normalizedHeaders, aliases, word) {
  const exact = findColumn(normalizedHeaders, aliases);
  if (exact >= 0) return exact;
  const loose = normalizedHeaders.map((h, i) => (h.includes(word) ? i : -1)).filter(i => i >= 0);
  return loose.length === 1 ? loose[0] : -1;
}

export function cleanText(value, limit = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function toNumber(value) {
  const text = String(value ?? '').replace(/[°\s]/g, '');
  if (text === '') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

const isKoreaLon = v => v >= 124 && v <= 132;
const isKoreaLat = v => v >= 33 && v <= 39;

/**
 * 경도·위도 열 값을 검증합니다.
 * - 한국의 경도(124~132)와 위도(33~39)는 범위가 겹치지 않으므로,
 *   두 값이 정확히 서로의 범위에 들어 있을 때만 "뒤바뀜"으로 보고 바로잡습니다.
 * - 그 밖의 경우는 고치지 않고 사유와 함께 제외합니다. 좌표를 만들어 내지 않습니다.
 */
export function resolveCoordinates(lonText, latText) {
  const lon = toNumber(lonText);
  const lat = toNumber(latText);
  if (lon === null || lat === null || (lon === 0 && lat === 0)) return { ok: false, reason: 'noCoordinates' };
  if (Number.isNaN(lon) || Number.isNaN(lat)) return { ok: false, reason: 'invalidCoordinates' };
  if (isKoreaLon(lon) && isKoreaLat(lat)) return { ok: true, lon, lat, swapped: false };
  if (isKoreaLon(lat) && isKoreaLat(lon)) return { ok: true, lon: lat, lat: lon, swapped: true };
  if (Math.abs(lon) > 1000 || Math.abs(lat) > 1000) return { ok: false, reason: 'projectedCoordinates' };
  return { ok: false, reason: 'invalidCoordinates' };
}

/** 2026-01-06 / 20260106 / 2026.1.6. / 2026/01/06 → 2026-01-06. 달력에 없는 날짜는 null. */
export function normalizeDate(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})[-./\s]*(\d{1,2})[-./\s]*(\d{1,2})\.?(?:\s.*)?$/.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1990 || year > 2100 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 파일 이름 끝의 _YYYYMMDD 를 기준일로 읽습니다(공공데이터포털 파일데이터 관행). */
export function dateFromFileName(name) {
  const matches = [...String(name).matchAll(/(?<!\d)(20\d{2})[-._]?(\d{2})[-._]?(\d{2})(?!\d)/g)];
  for (const match of matches.reverse()) {
    const date = normalizeDate(`${match[1]}-${match[2]}-${match[3]}`);
    if (date) return date;
  }
  return null;
}

/**
 * 기관 대표전화만 남깁니다. 휴대전화(010 등)와 안심번호(050x)는 개인 연락처일 수 있어 버립니다.
 * 반환: { phone, dropped }  dropped=true 는 값이 있었지만 싣지 않았다는 뜻.
 */
export function publicPhone(value) {
  const text = cleanText(value, 40);
  if (!text) return { phone: '', dropped: false };
  const digits = text.replace(/\D/g, '');
  const mobile = /^01[016789]/.test(digits) || /^050/.test(digits);
  const landline = /^0(2|[3-6][1-5]|70)\d{7,8}$/.test(digits) || /^1[568]\d{6}$/.test(digits);
  if (mobile || !landline) return { phone: '', dropped: true };
  return { phone: text, dropped: false };
}

/** 주소 글자에 '광주 … 서구'가 들어 있는지(좌표 없는 행·경계 밖 행을 설명하기 위한 참고용). */
export function addressMentionsDistrict(address) {
  return /(전남광주통합특별시|광주광역시|광주시|광주)\s*서구(\s|$)/.test(String(address ?? ''));
}

/** 중복 판정용 주소 정규화: 광역 명칭·괄호·공백 제거. */
export function normalizeAddress(address) {
  return String(address ?? '').replace(/\(.*?\)/g, '').replace(/전남광주통합특별시|광주광역시|광주시/g, '').replace(/\s+/g, '');
}
