/** 순수 기하 함수. 좌표는 모두 EPSG:4326 [경도, 위도]. */
import { pointInGeometry } from '../../src/admin.js';

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** 두 점 사이 대권거리(m). */
export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 도형의 모든 꼭짓점을 평탄한 배열로 돌려준다. */
export function vertices(geometry) {
  if (!geometry) return [];
  switch (geometry.type) {
    case 'Point': return [geometry.coordinates];
    case 'MultiPoint':
    case 'LineString': return geometry.coordinates;
    case 'MultiLineString':
    case 'Polygon': return geometry.coordinates.flat();
    case 'MultiPolygon': return geometry.coordinates.flat(2);
    default: return [];
  }
}

export function bounds(geometry) {
  const points = vertices(geometry);
  if (!points.length) return null;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    if (p[0] < box[0]) box[0] = p[0];
    if (p[1] < box[1]) box[1] = p[1];
    if (p[0] > box[2]) box[2] = p[0];
    if (p[1] > box[3]) box[3] = p[1];
  }
  return box;
}

export function isPolygonal(geometry) {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

export function contains(geometry, point) {
  return isPolygonal(geometry) && pointInGeometry(point, geometry);
}

/**
 * 면·선 도형의 대표점. 면은 반드시 도형 안의 점을 고른다
 * (외곽 사각형 중심 → 격자 탐색 → 첫 꼭짓점 순).
 */
export function representativePoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates.slice(0, 2);
  const box = bounds(geometry);
  if (!box) return null;
  const centre = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  if (!isPolygonal(geometry)) {
    // 선형 자료는 실제 선 위의 가운데 꼭짓점을 쓴다.
    const points = vertices(geometry);
    return points[Math.floor(points.length / 2)].slice(0, 2);
  }
  if (pointInGeometry(centre, geometry)) return centre;
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const p = [
        box[0] + (box[2] - box[0]) * i / steps,
        box[1] + (box[3] - box[1]) * j / steps,
      ];
      if (pointInGeometry(p, geometry)) return p;
    }
  }
  return vertices(geometry)[0].slice(0, 2);
}

function ringAreaM2(ring, lat0) {
  const kx = EARTH_RADIUS_M * RAD * Math.cos(lat0 * RAD);
  const ky = EARTH_RADIUS_M * RAD;
  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    sum += ring[i - 1][0] * kx * ring[i][1] * ky - ring[i][0] * kx * ring[i - 1][1] * ky;
  }
  return Math.abs(sum) / 2;
}

/** 면적(㎡). 구(區) 규모에서 충분한 국지 평면 근사이며 측량 면적이 아니다. */
export function areaM2(geometry) {
  if (!isPolygonal(geometry)) return 0;
  const box = bounds(geometry);
  const lat0 = (box[1] + box[3]) / 2;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const rings of polygons) {
    total += ringAreaM2(rings[0], lat0);
    for (const hole of rings.slice(1)) total -= ringAreaM2(hole, lat0);
  }
  return total;
}

export function inBounds(point, box) {
  return point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];
}

const COMPASS = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동',
  '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];

/** 방위각(북=0°, 시계방향)을 16방위 한글 이름으로. */
export function compass(azimuth) {
  return COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16];
}

export const round = (value, digits = 0) => {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
};
