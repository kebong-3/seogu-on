/** Public jurisdiction configuration. Pure browser/Node code; never follows URLs. */
export const REGION_PROFILE_VERSION = 1;
export const REGION_LIMITS = Object.freeze({districts: 3000, facilities: 5000, coordinates: 2000000});

export class RegionProfileError extends Error {
  constructor(message, code = 'INVALID_REGION_PROFILE') { super(message); this.name = 'RegionProfileError'; this.code = code; }
}
const fail = (message, code) => { throw new RegionProfileError(message, code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function object(value, label, allowed) {
  if (!plain(value)) fail(`${label} 형식을 확인하세요.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) fail(`${label}에 허용하지 않는 속성이 있습니다.`);
    if (allowed && !allowed.includes(key)) fail(`${label}의 지원하지 않는 항목: ${key}`);
  }
  return value;
}
function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label}을 확인하세요.`);
  return value.trim();
}
export function validSourceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
function dateOrNull(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (!validSourceDate(value)) fail(`${label}은 실제 날짜 YYYY-MM-DD여야 합니다.`);
  return value;
}
export function safePublicDataPath(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^\/data\/[A-Za-z0-9_./-]+\.(?:geojson|json)$/.test(value) || value.includes('//') || value.split('/').some(part => part === '.' || part === '..')) fail('자료 경로는 같은 사이트의 /data/ 아래 JSON 또는 GeoJSON이어야 합니다.');
  return value;
}
function sourceUrl(value, label = '출처 주소') {
  const url = text(value, label, 1200);
  let parsed;
  try { parsed = new URL(url); } catch { fail(`${label} 형식을 확인하세요.`); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(`${label}은 인증정보 없는 HTTP(S) 주소여야 합니다.`);
  return url;
}
export function validCoordinate(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}
export function pointInBounds(point, bounds) {
  return validCoordinate(point) && Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite) && point[0] >= bounds[0] - 1e-10 && point[0] <= bounds[2] + 1e-10 && point[1] >= bounds[1] - 1e-10 && point[1] <= bounds[3] + 1e-10;
}

/** adm_cd2 contains the MOIS administrative code; the geometry is sourced from SGIS. */
export const DEFAULT_REGION_PROFILE = Object.freeze({
  version: 1, id: 'seogu', name: '서구', fullName: '전남광주통합특별시 서구',
  jurisdictionCode: '12240', codeSystem: 'MOIS-ADM', timeZone: 'Asia/Seoul',
  bounds: Object.freeze([126.80041086178436, 35.090942584004495, 126.90997195600762, 35.17858538932668]),
  center: Object.freeze([126.855, 35.14]), boundaryUrl: '/data/admin-dongs.geojson',
  facilitiesUrl: '/data/layers/public-facilities.geojson', facilityLayerId: 'public-facilities', districtCount: 18,
  capabilities: Object.freeze({spaceTwin: true, legacySeoguServices: true}),
  serviceCodes: Object.freeze({taasSido: '29', taasGugun: '140'}),
  source: Object.freeze({name: 'SGIS 행정동 경계 가공: vuski/admdongkor', url: 'https://raw.githubusercontent.com/vuski/admdongkor/master/ver20260701/HangJeongDong_ver20260701.geojson', asOf: '2026-07-01', note: '수록 경계의 adm_cd2 앞 5자리(행정기관코드). 제공기관별 API 지역코드와 별도로 관리합니다.'}),
  sample: false,
});

/** Returns a fresh whitelist copy; credentials or arbitrary upstream routes cannot enter the profile. */
export function validateRegionProfile(input) {
  const p = object(input, '지역 설정', ['version','id','name','fullName','jurisdictionCode','codeSystem','timeZone','bounds','center','boundaryUrl','facilitiesUrl','facilityLayerId','districtCount','capabilities','serviceCodes','source','sample','layerMappings']);
  if (p.version !== REGION_PROFILE_VERSION) fail('지원하지 않는 지역 설정 버전입니다.');
  const id = text(p.id, '지역 식별자', 64);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) fail('지역 식별자는 영문 소문자·숫자·하이픈으로 입력하세요.');
  const code = text(p.jurisdictionCode, '지역 코드', 32);
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(code)) fail('지역 코드 형식을 확인하세요.');
  const codeSystem = text(p.codeSystem, '지역 코드 체계', 32);
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(codeSystem)) fail('지역 코드 체계를 함께 기록하세요.');
  if (p.timeZone !== undefined && p.timeZone !== 'Asia/Seoul') fail('현재 지역 검토는 한국시간(Asia/Seoul)을 사용합니다.');
  if (!Array.isArray(p.bounds) || p.bounds.length !== 4 || !p.bounds.every(Number.isFinite) || !validCoordinate(p.bounds.slice(0, 2)) || !validCoordinate(p.bounds.slice(2)) || p.bounds[0] >= p.bounds[2] || p.bounds[1] >= p.bounds[3]) fail('지역 경계상자 [서, 남, 동, 북]을 확인하세요.');
  if (!pointInBounds(p.center, p.bounds)) fail('지도 중심점은 지역 경계상자 안에 있어야 합니다.');
  if (!Number.isSafeInteger(p.districtCount) || p.districtCount < 1 || p.districtCount > REGION_LIMITS.districts) fail('행정구역 개수를 확인하세요.');
  const facilityLayerId = text(p.facilityLayerId, '공공공간 레이어 식별자', 64);
  if (!/^[a-z][a-z0-9-]*$/.test(facilityLayerId)) fail('레이어 식별자 형식을 확인하세요.');
  const capabilities = object(p.capabilities, '지원 기능', ['spaceTwin','legacySeoguServices']);
  if (typeof capabilities.spaceTwin !== 'boolean' || typeof capabilities.legacySeoguServices !== 'boolean') fail('지원 기능은 true 또는 false로 지정하세요.');
  if (id !== 'seogu' && capabilities.legacySeoguServices) fail('다른 지역에 서구 전용 기존 API를 활성화할 수 없습니다.');
  const source = object(p.source, '설정 출처', ['name','url','asOf','note']);
  const serviceCodes = {};
  if (p.serviceCodes !== undefined) for (const [key, value] of Object.entries(object(p.serviceCodes, '서비스별 지역 코드', ['taasSido','taasGugun']))) {
    if (typeof value !== 'string' || !/^\d{2,10}$/.test(value)) fail(`서비스별 지역 코드 ${key}를 확인하세요.`);
    serviceCodes[key] = value;
  }
  if (typeof p.sample !== 'boolean') fail('시연 설정 여부(sample)를 명시하세요.');
  const boundaryUrl = safePublicDataPath(p.boundaryUrl), facilitiesUrl = safePublicDataPath(p.facilitiesUrl);
  const layerMappings = {[facilityLayerId]: {url: facilitiesUrl, available: capabilities.spaceTwin}};
  if (p.layerMappings !== undefined) {
    const mappings = object(p.layerMappings, '자료 연결표');
    if (Object.keys(mappings).length !== 1 || !Object.hasOwn(mappings, facilityLayerId)) fail('현재 지역 프로필의 공공공간 연결표를 확인하세요.');
    const mapping = object(mappings[facilityLayerId], '공공공간 연결', ['url','available']);
    if (mapping.url !== facilitiesUrl || mapping.available !== capabilities.spaceTwin) fail('자료 연결표와 공공공간 설정이 일치하지 않습니다.');
  }
  return {
    version: REGION_PROFILE_VERSION, id, name: text(p.name, '지역 이름', 60), fullName: text(p.fullName, '전체 지역 이름', 140), jurisdictionCode: code, codeSystem, timeZone: 'Asia/Seoul',
    bounds: [...p.bounds], center: [...p.center], boundaryUrl, facilitiesUrl, facilityLayerId, districtCount: p.districtCount,
    capabilities: {...capabilities}, serviceCodes, source: {name: text(source.name, '출처 이름', 300), url: sourceUrl(source.url), asOf: dateOrNull(source.asOf, '출처 기준일'), ...(source.note ? {note: text(source.note, '출처 설명', 500)} : {})}, sample: p.sample, layerMappings,
  };
}

function onSegment(point, a, b) {
  const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
  return Math.abs(cross) <= 1e-12 && point[0] >= Math.min(a[0], b[0]) - 1e-10 && point[0] <= Math.max(a[0], b[0]) + 1e-10 && point[1] >= Math.min(a[1], b[1]) - 1e-10 && point[1] <= Math.max(a[1], b[1]) + 1e-10;
}
function inRing(point, ring) {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) within = !within;
  }
  return within;
}
function inGeometry(point, geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(rings => inRing(point, rings[0]) && !rings.slice(1).some(ring => inRing(point, ring)));
}
export function pointInRegion(point, boundaryCollection) {
  if (!validCoordinate(point) || !Array.isArray(boundaryCollection?.features)) return false;
  return boundaryCollection.features.some(feature => inGeometry(point, feature.geometry));
}
function checkCRS(collection, label) {
  if (collection.crs !== undefined) {
    const name = collection.crs?.properties?.name;
    if (collection.crs?.type !== 'name' || !['EPSG:4326','urn:ogc:def:crs:OGC:1.3:CRS84','urn:ogc:def:crs:EPSG::4326'].includes(name)) fail(`${label}는 WGS84 경도·위도 좌표여야 합니다.`, 'INVALID_REGION_DATA');
  }
}
function checkMetadata(collection, label, warnings) {
  const meta = object(collection.metadata, `${label} 출처 정보`);
  text(meta.sourceName, `${label} 출처 이름`, 600); sourceUrl(meta.sourceUrl, `${label} 출처 주소`);
  if (meta.sourceDate != null) dateOrNull(meta.sourceDate, `${label} 기준일`);
  if (meta.sourceDateRange != null) {
    if (!Array.isArray(meta.sourceDateRange) || meta.sourceDateRange.length !== 2 || !meta.sourceDateRange.every(validSourceDate) || meta.sourceDateRange[0] > meta.sourceDateRange[1]) fail(`${label} 기준일 범위를 확인하세요.`, 'INVALID_REGION_DATA');
  }
  if (!meta.sourceDate && !meta.sourceDateRange) warnings.push(`${label}: 자료 기준일이 없어 최신 여부를 확인해야 합니다.`);
  if (meta.retrievedAt != null && (typeof meta.retrievedAt !== 'string' || !Number.isFinite(Date.parse(meta.retrievedAt)))) fail(`${label} 수집시각을 확인하세요.`, 'INVALID_REGION_DATA');
}
function collection(value, label, max, warnings) {
  object(value, label);
  if (value.type !== 'FeatureCollection' || !Array.isArray(value.features) || value.features.length > max) fail(`${label}의 FeatureCollection과 항목 수를 확인하세요.`, 'INVALID_REGION_DATA');
  checkCRS(value, label); checkMetadata(value, label, warnings);
  return value.features;
}
function dataId(value, label) {
  const id = text(value, label, 160);
  if (['__proto__','constructor','prototype'].includes(id)) fail(`${label}을 사용할 수 없습니다.`, 'INVALID_REGION_DATA');
  return id;
}

/** Validates the complete package before adoption. No geometry repairs or guessed coordinates. */
export function validateRegionDataPack({profile: rawProfile, boundaries, facilities}) {
  const profile = validateRegionProfile(rawProfile), warnings = [];
  const districts = collection(boundaries, '행정경계', REGION_LIMITS.districts, warnings);
  const points = collection(facilities, '공공공간', REGION_LIMITS.facilities, warnings);
  if (districts.length !== profile.districtCount) fail(`행정경계 개수 ${districts.length}개가 설정 ${profile.districtCount}개와 다릅니다.`, 'INVALID_REGION_DATA');
  const districtIds = new Set(), districtGeometries = new Map(), facilityIds = new Set(); let coordinateCount = 0, missingDates = 0, missingDong = 0;
  for (const feature of districts) {
    object(feature, '행정경계 항목'); const properties = object(feature.properties, '행정경계 속성');
    const id = dataId(properties.dongId, '행정구역 식별자'); text(properties.dongName, '행정구역 이름', 140);
    if (feature.type !== 'Feature' || districtIds.has(id)) fail('행정경계 식별자가 중복되거나 Feature 형식이 아닙니다.', 'INVALID_REGION_DATA');
    districtIds.add(id);
    const geometry = object(feature.geometry, '행정경계 도형');
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!Array.isArray(polygons) || !polygons.length) fail('행정경계는 Polygon 또는 MultiPolygon이어야 합니다.', 'INVALID_REGION_DATA');
    for (const rings of polygons) {
      if (!Array.isArray(rings) || !rings.length) fail('행정경계 고리 형식을 확인하세요.', 'INVALID_REGION_DATA');
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point => pointInBounds(point, profile.bounds))) fail('행정경계 좌표가 올바르지 않거나 설정 범위를 벗어났습니다.', 'INVALID_REGION_DATA');
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) fail('행정경계 고리가 닫혀 있지 않습니다.', 'INVALID_REGION_DATA');
        const area = ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
        if (Math.abs(area) < 1e-12) fail('행정경계 고리의 면적이 없습니다.', 'INVALID_REGION_DATA');
        coordinateCount += ring.length;
        if (coordinateCount > REGION_LIMITS.coordinates) fail('행정경계 좌표 수 제한을 초과했습니다.', 'INVALID_REGION_DATA');
      }
    }
    if (properties.labelPoint !== undefined && (!validCoordinate(properties.labelPoint) || !inGeometry(properties.labelPoint, geometry))) fail('행정구역 표시점이 해당 경계 안에 있지 않습니다.', 'INVALID_REGION_DATA');
    districtGeometries.set(id, geometry);
  }
  for (const feature of points) {
    object(feature, '공공공간 항목'); const properties = object(feature.properties, '공공공간 속성');
    const id = dataId(properties.id ?? feature.id, '공공공간 식별자'); text(properties.name, '공공공간 이름', 300);
    if (feature.id !== undefined && properties.id !== undefined && String(feature.id) !== properties.id) fail('공공공간의 두 식별자 값이 서로 다릅니다.', 'INVALID_REGION_DATA');
    if (feature.type !== 'Feature' || facilityIds.has(id)) fail('공공공간 식별자가 중복되거나 Feature 형식이 아닙니다.', 'INVALID_REGION_DATA');
    facilityIds.add(id);
    if (feature.geometry?.type !== 'Point' || !pointInBounds(feature.geometry.coordinates, profile.bounds) || !pointInRegion(feature.geometry.coordinates, boundaries)) fail(`공공공간 ${id}의 좌표가 행정경계 밖이거나 Point 형식이 아닙니다.`, 'INVALID_REGION_DATA');
    text(properties.sourceName || facilities.metadata.sourceName, '시설 출처 이름', 600); sourceUrl(properties.sourceUrl || facilities.metadata.sourceUrl, '시설 출처 주소');
    if (properties.sourceDate != null) dateOrNull(properties.sourceDate, '시설 기준일');
    else missingDates++;
    if (properties.dongId != null && !districtIds.has(properties.dongId)) fail(`공공공간 ${id}의 행정구역 식별자를 확인하세요.`, 'INVALID_REGION_DATA');
    if (properties.dongId && !inGeometry(feature.geometry.coordinates, districtGeometries.get(properties.dongId))) fail(`공공공간 ${id}의 좌표와 행정구역 식별자가 일치하지 않습니다.`, 'INVALID_REGION_DATA');
    if (!properties.dongId) missingDong++;
  }
  if (missingDates) warnings.push(`공공공간 ${missingDates}개는 개별 기준일이 없습니다. 전체 자료의 기준일·수집시각과 구분하세요.`);
  if (missingDong) warnings.push(`공공공간 ${missingDong}개는 행정구역 식별자가 없습니다. 지도 경계 포함 여부로 범위를 판단합니다.`);
  if (!points.length) warnings.push('공공공간 자료가 비어 있습니다. 실제 시설이 없다는 뜻이 아닙니다.');
  if (profile.sample) warnings.unshift('SAMPLE: 합성 예시 자료입니다. 타 지자체 실증·공식 현황이 아닙니다.');
  return {ok: true, regionId: profile.id, sample: profile.sample, counts: {districts: districts.length, facilities: points.length, boundaryCoordinates: coordinateCount}, warnings, meaning: '자료 구조·식별자·좌표 범위 검사 결과입니다. 최신 운영상태·출처의 진위·현장 정확성을 인증하지 않습니다.'};
}
