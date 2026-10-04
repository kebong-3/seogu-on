// 공간 판정 도구: 행정동 경계(18개 동) 안에 점이 있는지, 어느 동인지 계산합니다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EDGE = 1e-12;

function ringBounds(rings) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < west) west = x;
      if (x > east) east = x;
      if (y < south) south = y;
      if (y > north) north = y;
    }
  }
  return [west, south, east, north];
}

/** 광선 교차법. 경계선 위의 점은 안쪽으로 봅니다. */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = (xj - xi) * (y - yi) - (yj - yi) * (x - xi);
    const between = Math.min(xi, xj) - EDGE <= x && x <= Math.max(xi, xj) + EDGE &&
      Math.min(yi, yj) - EDGE <= y && y <= Math.max(yi, yj) + EDGE;
    if (Math.abs(cross) < EDGE && between) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x, y, rings) {
  if (!inRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(x, y, rings[i])) return false;
  return true;
}

/** 행정동 경계 파일을 읽어 판정기를 만듭니다. */
export function loadDongIndex(root) {
  const path = resolve(root, 'public/data/admin-dongs.geojson');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const dongs = raw.features.map(feature => {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return {
      dongId: feature.properties.dongId,
      dongName: feature.properties.dongName,
      polygons: polygons.map(rings => ({ rings, bounds: ringBounds(rings) })),
    };
  });
  const all = ringBounds(dongs.flatMap(d => d.polygons.map(p => [[p.bounds[0], p.bounds[1]], [p.bounds[2], p.bounds[3]]])));
  return { dongs, bounds: all, boundaryDate: raw.metadata?.sourceDate || null };
}

/**
 * 점이 서구 안인지, 어느 동인지 판정합니다.
 * 두 동의 경계선에 정확히 걸치면 ambiguous=true이고 동 이름은 비워 둡니다(임의 배정하지 않음).
 */
export function locate(index, lon, lat) {
  const [west, south, east, north] = index.bounds;
  if (lon < west || lon > east || lat < south || lat > north) return { inDistrict: false, dongId: null, dongName: null, ambiguous: false };
  const hits = index.dongs.filter(dong => dong.polygons.some(({ rings, bounds }) =>
    lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3] && inPolygon(lon, lat, rings)));
  if (hits.length === 1) return { inDistrict: true, dongId: hits[0].dongId, dongName: hits[0].dongName, ambiguous: false };
  return { inDistrict: hits.length > 0, dongId: null, dongName: null, ambiguous: hits.length > 1 };
}

/** 두 경위도 점 사이 거리(m). 가까운 점 비교용 근사식. */
export function metersBetween(a, b) {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 6371008.8;
}

/** 도형의 모든 꼭짓점을 평평한 목록으로. */
export function vertices(geometry) {
  if (!geometry) return [];
  const depth = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }[geometry.type];
  if (depth === undefined) return [];
  return depth === 0 ? [geometry.coordinates] : geometry.coordinates.flat(depth - 1);
}
