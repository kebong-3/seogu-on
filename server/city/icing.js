/** DSSP-IF-00120 is a registered icing-section inventory, not live road icing.
 * The matching official Safemap A2SM_FREEZINGSECTION layer declares EPSG:3857.
 * Only provider points are converted; start/end points are never joined into
 * an invented road line. Both the named region and the actual boundary are
 * checked by the calling normalizer.
 */
import {unmercator} from '../../src/city/geometry.js';

const number = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
const ordinate = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)';
const pointPattern = new RegExp('^POINT\\s*\\(\\s*' + ordinate + '\\s+' + ordinate + '\\s*\\)$', 'i');

export function icingRegionMatches(value) {
  // "서구" alone must not admit Daegu, Busan, Daejeon, or Incheon Seo-gu.
  return /^(?:광주광역시|광주시|광주|전남광주통합특별시)\s*서구(?:\s|$)/.test(String(value ?? '').trim());
}

function geometryPoint(value) {
  if (!value) return null;
  let geometry = value;
  if (typeof geometry === 'string') {
    const raw = geometry.trim();
    if (raw.startsWith('{')) {
      try { geometry = JSON.parse(raw); } catch { return {invalid: true}; }
    } else {
      const srid = raw.match(/^SRID=(\d+);/i);
      if (srid && srid[1] !== '3857') return {invalid: true};
      const found = (srid ? raw.slice(srid[0].length) : raw).match(pointPattern);
      return found ? {point: [Number(found[1]), Number(found[2])]} : {invalid: true};
    }
  }
  if (geometry?.type === 'Feature') geometry = geometry.geometry;
  if (geometry?.crs && !/3857/.test(String(geometry.crs?.properties?.name || geometry.crs))) return {invalid: true};
  if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) return {invalid: true};
  const point = geometry.coordinates.slice(0, 2).map(number);
  return point.length === 2 && point.every(Number.isFinite) ? {point} : {invalid: true};
}

export function icingGeometry(row) {
  const pair = [number(row.XMAP_CRTS), number(row.YMAP_CRTS)];
  const geom = geometryPoint(row.GEOM);
  if (geom?.invalid) return {geometry: null, reason: '원본 도형 형식 또는 좌표계 확인 필요'};
  const point = pair.every(Number.isFinite) ? pair : geom?.point;
  if (!point) return {geometry: null, reason: '원본 지점 좌표 미제공'};
  // Reject degree-like values and coordinates outside the Korean EPSG:3857 range.
  if (point[0] < 13e6 || point[0] > 15e6 || point[1] < 3e6 || point[1] > 5e6) {
    return {geometry: null, reason: '명세 좌표계(EPSG:3857)와 좌표값 범위 불일치'};
  }
  if (geom?.point && pair.every(Number.isFinite) && Math.hypot(pair[0] - geom.point[0], pair[1] - geom.point[1]) > 1) {
    return {geometry: null, reason: 'X/Y 좌표와 GEOM 위치가 1m 이상 불일치'};
  }
  return {
    geometry: {type: 'Point', coordinates: unmercator(point)},
    locationBasis: '원자료 EPSG:3857 지점 좌표를 WGS84로 변환',
    originalCrs: 'EPSG:3857',
    geometryMeaning: '제공기관이 등록한 상습결빙구간의 지점입니다. 도로 선형이나 현재 노면 결빙 상태를 나타내지 않습니다.'
  };
}
