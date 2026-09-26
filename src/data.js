import { CATEGORIES, MONTHS } from './config.js';
import { collection, pointFeature, validCoordinate, validDate } from './geo.js';

export function seededRandom(seed = 417) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}
/** All features here are deliberately synthetic; no real facility locations or performance values. */
export function makeDemoData() {
  const rng = seededRandom(4199);
  const centers = [[126.846, 35.156], [126.861, 35.150], [126.884, 35.152], [126.878, 35.128], [126.866, 35.169], [126.852, 35.139]];
  const facilities = Array.from({ length: 48 }, (_, i) => {
    const category = ['park', 'recycle', 'shelter', 'care'][i % 4], c = centers[Math.floor(i / 8)];
    const monthly = Object.fromEntries(MONTHS.map((m, j) => [m, i % 13 === 0 && j % 4 === 0 ? null : Math.round(20 + rng() * 110 + Math.sin(j / 2 + i) * 12)]));
    return pointFeature([c[0] + (rng() - 0.5) * 0.014, c[1] + (rng() - 0.5) * 0.009], {
      id: `demo-${String(i + 1).padStart(3, '0')}`, name: `${CATEGORIES[category].name} 시연 ${String(i + 1).padStart(2, '0')}`,
      category, dataKind: 'demo', sourceName: '펀온워크 합성 시연 데이터', sourceDate: '2026-01-01',
      note: '임의 위치·수치입니다. 실제 서구 시설·이용실적이 아닙니다.', address: '실제 시설 주소 없음 · 시연용 위치',
      monthly, metricName: '운영량', metricUnit: '건', reviewStatus: 'synthetic',
    });
  });
  const projects = Array.from({ length: 6 }, (_, i) => {
    const c = centers[i % 3], start = i % 2 ? '2026-05-01' : '2026-03-01';
    const lon = c[0] + (i > 2 ? 0.002 : 0), lat = c[1] + (i > 2 ? 0.001 : 0);
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: [[lon - 0.002, lat - 0.001], [lon, lat], [lon + 0.003, lat + 0.001]] }, properties: {
      id: `demo-project-${i + 1}`, name: `생활시설 정비 시연 ${String.fromCharCode(65 + i)}`, dataKind: 'demo', start, end: i % 2 ? '2026-09-30' : '2026-11-30', sourceName: '펀온워크 합성 시연 데이터', sourceDate: '2026-01-01', department: '담당부서 시연', note: '실제 사업·위치·일정이 아닙니다.',
    } };
  });
  return { facilities: collection(facilities), projects: collection(projects) };
}

export function validateImport(raw) {
  if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) throw new Error('GeoJSON FeatureCollection 파일을 선택하세요.');
  if (raw.features.length > 5000) throw new Error('한 번에 5,000개 이하의 시설만 가져올 수 있습니다.');
  const accepted = [], errors = [], ids = new Set();
  raw.features.forEach((f, i) => {
    const p = f?.properties || {}, prefix = `${i + 1}행`;
    if (f?.geometry?.type !== 'Point' || !validCoordinate(f.geometry.coordinates)) { errors.push(`${prefix}: Point 형식의 유효한 [경도, 위도]가 필요합니다.`); return; }
    const [lon, lat] = f.geometry.coordinates;
    if (lon < 126.70 || lon > 127.05 || lat < 34.98 || lat > 35.35) { errors.push(`${prefix}: 광주 주변 범위를 벗어난 좌표입니다. EPSG:4326인지 확인하세요.`); return; }
    if (!CATEGORIES[p.category]) { errors.push(`${prefix}: 지원되는 시설 분류인지 확인하세요.`); return; }
    if (typeof p.name !== 'string' || !p.name.trim()) { errors.push(`${prefix}: 시설명이 없습니다.`); return; }
    if (!p.sourceName || (p.sourceDate !== null && !validDate(p.sourceDate))) { errors.push(`${prefix}: sourceName과 sourceDate(YYYY-MM-DD, 미상은 null)가 필요합니다.`); return; }
    if ((p.validFrom && !validDate(p.validFrom)) || (p.validTo && !validDate(p.validTo)) || (p.validFrom && p.validTo && p.validFrom > p.validTo)) { errors.push(`${prefix}: 유효기간을 확인하세요.`); return; }
    const id = String(p.id ?? `import-${i + 1}`).slice(0, 120);
    if (ids.has(id)) { errors.push(`${prefix}: 중복 id ${id}`); return; }
    ids.add(id);
    const monthly = {};
    for (const [month, v] of Object.entries(p.monthly || {})) {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && (v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0))) monthly[month] = v;
      else { errors.push(`${prefix}: 잘못된 월별 값(${month})을 제외했습니다.`); }
    }
    accepted.push(pointFeature([...f.geometry.coordinates].slice(0, 2), {
      id, name: p.name.trim().slice(0, 150), category: p.category, dataKind: 'provided', reviewStatus: 'unverified',
      sourceName: String(p.sourceName).slice(0, 200), sourceDate: p.sourceDate,
      sourceUrl: /^https:\/\//.test(p.sourceUrl || '') ? String(p.sourceUrl).slice(0, 500) : '',
      layerId: String(p.layerId || 'imported').slice(0, 60),
      phone: String(p.phone || '').slice(0, 50), department: String(p.department || '').slice(0, 100),
      hours: String(p.hours || '').slice(0, 250), capacity: typeof p.capacity === 'number' && p.capacity >= 0 ? p.capacity : null,
      positionSource: String(p.positionSource || 'source-coordinates').slice(0, 50),
      address: String(p.address || '').slice(0, 250), note: String(p.note || '').slice(0, 500),
      monthly, metricName: String(p.metricName || '운영량').slice(0, 40), metricUnit: String(p.metricUnit || '건').slice(0, 20),
      validFrom: p.validFrom || null, validTo: p.validTo || null,
    }));
  });
  return { accepted, errors, rejected: raw.features.length - accepted.length };
}

export async function loadPublishedData() {
  const response = await fetch('/data/facilities.geojson', { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('공개 시설자료를 불러오지 못했습니다.');
  const parsed = validateImport(await response.json());
  return { ...parsed, projects: [] };
}
