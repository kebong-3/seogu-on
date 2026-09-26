/** Map public JSON APIs into the intentionally narrow facility schema. */
export function permittedDataUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    if (!['api.odcloud.kr', 'apis.data.go.kr', 'api.data.go.kr'].includes(u.hostname.toLowerCase())) return null;
    u.hash = ''; return u;
  } catch { return null; }
}
export function extractRows(payload) {
  if (Array.isArray(payload.data)) return { rows: payload.data, total: payload.totalCount ?? payload.matchCount ?? null };
  const body = payload.response?.body || payload.body;
  const items = body?.items?.item ?? body?.items;
  if (Array.isArray(items)) return { rows: items, total: body.totalCount ?? null };
  if (items && typeof items === 'object') return { rows: [items], total: body.totalCount ?? null };
  if (payload.response?.header?.resultCode && !['00', '0', 'NORMAL_SERVICE'].includes(String(payload.response.header.resultCode))) throw new Error('API_RESULT_ERROR');
  throw new Error('API_SHAPE_UNSUPPORTED');
}
export function normalizeRows(rows, map, sourceName, sourceDate) {
  if (!map || !['park', 'recycle', 'shelter', 'care'].includes(map.category) || !map.name || !map.longitude || !map.latitude) throw new Error('FIELD_MAP_INVALID');
  const features = [], ids = new Set(); let excluded = 0;
  for (const [index, row] of rows.entries()) {
    const rawLon = row[map.longitude], rawLat = row[map.latitude];
    if (rawLon === '' || rawLat === '' || rawLon == null || rawLat == null) { excluded++; continue; }
    const lon = Number(rawLon), lat = Number(rawLat), name = String(row[map.name] || '').trim();
    if (!name || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < 126.70 || lon > 127.05 || lat < 34.98 || lat > 35.35) { excluded++; continue; }
    const id = String((map.id ? row[map.id] : null) ?? `api-row-${index + 1}`).slice(0, 120);
    if (ids.has(id)) { excluded++; continue; } ids.add(id);
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {
      id, name: name.slice(0, 150), category: map.category, dataKind: 'external', reviewStatus: 'unverified',
      sourceName, sourceDate, address: map.address ? String(row[map.address] || '').slice(0, 250) : '',
      monthly: {}, metricName: '운영량', metricUnit: '건', note: 'API에서 수집한 미검수 자료. 월별 실적은 제공되지 않았습니다.',
    } });
  }
  return { features, excluded };
}
export function validateMappingConfig(env) {
  const url = permittedDataUrl(env.DATA_PORTAL_URL || '');
  if (!url) return { error: 'DATA_PORTAL_URL에는 허용된 공공데이터 호스트의 HTTPS API 주소가 필요합니다.' };
  if (!env.DATA_GO_KR_SERVICE_KEY || !env.DATA_SOURCE_NAME || !/^\d{4}-\d{2}-\d{2}$/.test(env.DATA_SOURCE_DATE || '')) return { error: 'API 키·자료 출처·기준일 환경변수를 먼저 등록하세요.' };
  try {
    const date = new Date(`${env.DATA_SOURCE_DATE}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== env.DATA_SOURCE_DATE) return { error: 'DATA_SOURCE_DATE의 날짜가 올바르지 않습니다.' };
    const mapping = JSON.parse(env.DATA_FIELD_MAP || '{}'), extra = JSON.parse(env.DATA_QUERY_JSON || '{}');
    if (!mapping.name || !mapping.longitude || !mapping.latitude || !['park', 'recycle', 'shelter', 'care'].includes(mapping.category)) return { error: 'DATA_FIELD_MAP의 시설명·경도·위도·분류를 확인하세요.' };
    if (extra === null || Array.isArray(extra) || typeof extra !== 'object' || Object.keys(extra).length > 30) return { error: 'DATA_QUERY_JSON은 30개 이하 쿼리의 JSON 객체여야 합니다.' };
    return { url, mapping, extra };
  } catch { return { error: 'DATA_FIELD_MAP 또는 DATA_QUERY_JSON이 올바른 JSON이 아닙니다.' }; }
}
