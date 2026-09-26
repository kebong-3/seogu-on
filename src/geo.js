/** Deterministic geometry functions. WGS84 degree coordinates; radius uses a spherical model. */
const EARTH_M = 6371008.8;
const RAD = Math.PI / 180;
export function validCoordinate(c) {
  return Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
}
export function distanceMeters(a, b) {
  if (!validCoordinate(a) || !validCoordinate(b)) throw new TypeError('경도·위도 좌표가 올바르지 않습니다.');
  const dl = (b[1] - a[1]) * RAD, dn = (b[0] - a[0]) * RAD;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dn / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function circlePolygon(center, radius, steps = 64) {
  if (!validCoordinate(center) || !Number.isFinite(radius) || radius <= 0) throw new TypeError('원 반경이 올바르지 않습니다.');
  const lat = center[1] * RAD, lon = center[0] * RAD, d = radius / EARTH_M;
  const ring = Array.from({ length: steps }, (_, i) => {
    const theta = 2 * Math.PI * i / steps;
    const phi = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(theta));
    const lam = lon + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(phi));
    return [lam / RAD, phi / RAD];
  });
  ring.push([...ring[0]]);
  return { type: 'Polygon', coordinates: [ring] };
}
export function collection(features = []) { return { type: 'FeatureCollection', features }; }
export function pointFeature(coordinates, properties = {}) { return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties }; }
export function monthOverlaps(start, end, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  // Lexical ISO comparison is safe after import date validation.
  const first = `${month}-01`;
  const [year, m] = month.split('-').map(Number);
  const last = `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
  return (!start || start <= last) && (!end || end >= first);
}
export function metricAt(feature, month) {
  const value = feature.properties?.monthly?.[month];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function filterFacilities(features, state) {
  const q = String(state.search || '').trim().toLowerCase();
  return features.filter(f => {
    const p = f.properties;
    return state.categories.includes(p.category)
      && (!state.dongId || p.dongId === state.dongId)
      && (!state.realDistrictOnly || p.inDistrict === true)
      && (!q || `${p.name} ${p.address || ''}`.toLowerCase().includes(q))
      && monthOverlaps(p.validFrom, p.validTo, state.month)
      && (!state.radiusCenter || distanceMeters(state.radiusCenter, f.geometry.coordinates) <= state.radiusMeters);
  });
}
export function summarize(features, month) {
  const values = features.map(f => metricAt(f, month)).filter(v => v !== null);
  return { count: features.length, measured: values.length, missing: features.length - values.length,
    total: values.length ? values.reduce((sum, value) => sum + value, 0) : null };
}
export function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous) * 100;
}
export function compareSameCohort(features, currentMonth, previousMonth) {
  const both = features.filter(f => metricAt(f, currentMonth) !== null && metricAt(f, previousMonth) !== null);
  if (!both.length) return { n: 0, current: null, previous: null, percent: null };
  const current = both.reduce((s, f) => s + metricAt(f, currentMonth), 0);
  const previous = both.reduce((s, f) => s + metricAt(f, previousMonth), 0);
  return { n: both.length, current, previous, percent: percentChange(current, previous) };
}
export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
}
export function geometryCenter(geometry) {
  if (geometry.type === 'Point') return geometry.coordinates;
  const pts = geometry.type === 'LineString' ? geometry.coordinates : geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.type==='MultiPolygon'?geometry.coordinates.flatMap(p=>p[0]):[];
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}
export function projectProximityPairs(projects, month, threshold = 500) {
  // Not a polygon-overlap calculation: compares representative points + common dates.
  const active = projects.filter(p => monthOverlaps(p.properties.start, p.properties.end, month));
  const pairs = [];
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    if (a.properties.start > b.properties.end || b.properties.start > a.properties.end) continue;
    const meters = distanceMeters(geometryCenter(a.geometry), geometryCenter(b.geometry));
    if (meters <= threshold) pairs.push({ a, b, meters: Math.round(meters) });
  }
  return pairs;
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
