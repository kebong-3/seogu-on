/**
 * 서구:온 공간 질의 도구.
 *
 *   import { TOOLS, callTool } from './tools.js';
 *   const result = await callTool('coverage_gap', { target: 'bus', service: '그늘막', radiusM: 150 });
 *   // → { ok, summary, data, map, sources, caveats }
 *
 * 모든 도구는 저장소에 포함된 공개 GeoJSON 만 읽는다(네트워크·쓰기 없음).
 * 잘못된 입력은 SpatialError(.code, 한국어 message)를 던진다.
 * ctx.dataDir 로 자료 폴더를 바꿀 수 있다(테스트용 fixture).
 */
import { parseKst, solarPosition } from '../../src/city/solar.js';
import { SpatialError } from './errors.js';
import { compass, haversine, round } from './geo.js';
import { findDong, resolveCategory, resolveDong, resolveOrigin, searchPlaces } from './resolve.js';
import { getStore } from './store.js';
import {CIVIC_THEMES, isCivicTheme} from './civic-themes.js';

export { SpatialError };

const MAX_HIGHLIGHT = 200;
const fmt = value => Number(value).toLocaleString('ko-KR');

/* ───────────────────────── 입력 검사 ───────────────────────── */

function numberArg(args, key, { min, max, def, integer = false }) {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') return def;
  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    throw new SpatialError('INVALID_ARGUMENT', `${key} 는 ${min}~${max} 사이의 ${integer ? '정수' : '숫자'}여야 합니다.`);
  }
  return value;
}

function optionalDong(store, args) {
  if (args.dong === undefined || args.dong === null || args.dong === '') return null;
  return resolveDong(store, args.dong);
}

/* ───────────────────────── 결과 조립 ───────────────────────── */

function siteRow(site, distanceM) {
  const row = {
    id: site.id,
    name: site.name,
    category: site.category,
    dongName: site.dongName,
    lon: round(site.lon, 6),
    lat: round(site.lat, 6),
  };
  if (site.address) row.address = site.address;
  if (site.kind) row.kind = site.kind;
  if (site.year) row.year = site.year;
  if (distanceM !== undefined) row.distanceM = Math.round(distanceM);
  return row;
}

/** 지도 패널이 그릴 수 있는 작은 FeatureCollection(면 자료도 대표점으로 보낸다). */
function highlight(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.slice(0, MAX_HIGHLIGHT).map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
      properties: {
        id: row.id,
        name: row.name,
        category: row.category,
        ...(row.distanceM !== undefined ? { distanceM: row.distanceM } : {}),
      },
    })),
  };
}

function focusOf(origin, dong, radiusM) {
  if (origin) return { lon: round(origin.lon, 6), lat: round(origin.lat, 6), ...(radiusM ? { radiusM } : {}) };
  if (dong) return { dongId: dong.id };
  return undefined;
}

function mapOf(focus, rows) {
  const map = {};
  if (focus) map.focus = focus;
  if (rows) map.highlight = highlight(rows);
  return Object.keys(map).length ? map : undefined;
}

function sourcesOf(store, datasets, { withDongs = false } = {}) {
  const list = datasets.map(d => ({
    name: `${d.title} — ${d.source.name}`,
    date: d.source.date,
    dateBasis: d.source.dateBasis,
    ...(d.source.url ? { url: d.source.url } : {}),
  }));
  if (withDongs) {
    list.push({
      name: `행정동 경계 — ${store.dongSource.name}`,
      date: store.dongSource.date,
      dateBasis: '자료 기준일',
      ...(store.dongSource.url ? { url: store.dongSource.url } : {}),
    });
  }
  return list;
}

const CAVEAT_PARTIAL = '수록 건수는 전수조사 결과가 아닙니다. 자료에 없다고 해서 실제로 시설이 없다는 뜻이 아니며, 현재 운영·개방 여부도 확인되지 않았습니다.';
const CAVEAT_STRAIGHT = '거리는 대표위치 사이의 직선거리입니다. 보행 경로·출입구·횡단 가능 여부는 반영하지 않았습니다.';
const CAVEAT_DONG = '행정동은 대표점이 공개 가공 경계(법적 확정 경계 아님) 안에 있는지로 배정했습니다.';
const CAVEAT_FLOOD = '과거 침수피해 기록은 이미 일어난 피해의 신고·집계 이력입니다. 현재 침수 여부나 미래 침수 위험 예측이 아닙니다.';
const CAVEAT_PUBLIC_SPACE = '공공공간은 회의실·강당 등 공간별 수록 항목입니다. 같은 건물에 여러 공간이 포함될 수 있으며, 현재 이용 가능한 공간 수가 아닙니다. 운영시간·예약·휴관·사용 승인 여부는 관리 주체에게 확인해야 합니다.';

/** 자료가 많을 때: 같은 출처는 한 줄로 합친다(분류별 출처는 list_datasets 의 행에 있다). */
function uniqueSources(store, datasets) {
  const seen = new Map();
  for (const d of datasets) {
    const key = `${d.source.name}|${d.source.date}`;
    if (!seen.has(key)) {
      seen.set(key, {
        name: d.source.name,
        date: d.source.date,
        dateBasis: d.source.dateBasis,
        ...(d.source.url ? { url: d.source.url } : {}),
      });
    }
  }
  return [...seen.values(), sourcesOf(store, [], { withDongs: true })[0]];
}

function datasetCaveat(dataset) {
  const merged = dataset.mergedAreas
    ? ` 같은 시설의 위치 점과 부지 면이 겹친 ${fmt(dataset.mergedAreas)}건은 한 지점으로 셌습니다.`
    : '';
  return `[${dataset.title}] ${dataset.coverageNote}.${merged}${dataset.id === 'layer-public-facilities' ? ` ${CAVEAT_PUBLIC_SPACE}` : ''}`.replace('..', '.');
}

function notConnectedText(dataset) {
  return dataset.state === 'not-connected'
    ? `'${dataset.title}' 자료는 미연결 상태입니다(검수된 자료가 아직 들어오지 않음).`
    : `'${dataset.title}' 자료는 수집된 건이 없어 미연결로 취급합니다.`;
}

/** 미연결 자료를 물었을 때의 공통 응답. "0곳"이라고 답하지 않는다. */
function notConnectedResult(store, dataset, extra = {}) {
  return {
    ok: false,
    summary: `${notConnectedText(dataset)} '0곳'이 아니라 '자료 없음'이므로 이 질문에는 답할 수 없습니다.`,
    data: { category: dataset.id, title: dataset.title, state: dataset.state, connected: false, rows: [], ...extra },
    map: undefined,
    sources: [],
    caveats: [
      `${notConnectedText(dataset)} 시설이 없다는 뜻이 아닙니다.`,
      'list_datasets 로 연결된 자료를 확인하세요.',
    ],
  };
}

function originCaveats(origin) {
  if (!origin || origin.via === 'coordinates') return [];
  const notes = [];
  if (origin.via === 'dong') {
    notes.push(`기준점은 ${origin.label}(경계 안의 한 점)입니다. 동 전체를 뜻하지 않으니 동 단위 집계는 dong 인자를 쓰세요.`);
  }
  if (origin.alternatives?.length) {
    notes.push(`장소 이름을 '${origin.label}'(으)로 해석했습니다. 다른 후보: ${origin.alternatives.join(', ')}.`);
  }
  return notes;
}

function originData(origin) {
  if (!origin) return undefined;
  return { label: origin.label, lon: round(origin.lon, 6), lat: round(origin.lat, 6), dongName: origin.dongName };
}

/** 기준점에서 가까운 순으로 정렬한 [{site, distanceM}] */
function byDistance(sites, origin) {
  const from = [origin.lon, origin.lat];
  return sites
    .map(site => ({ site, distanceM: haversine(from, [site.lon, site.lat]) }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

/* ───────────────────────── 도구 구현 ───────────────────────── */

function listDatasets(store) {
  const datasets = store.allDatasets();
  const rows = datasets.map(d => ({
    category: d.id,
    title: d.title,
    state: d.state,
    connected: d.connected,
    queryable: d.queryable && d.connected,
    // 미연결 자료의 0 은 "0곳"이 아니므로 건수를 null 로 둔다.
    sites: d.connected && d.queryable ? d.sites.length : null,
    features: d.connected ? d.rawFeatureCount : null,
    points: d.connected ? d.pointFeatures : null,
    areas: d.connected ? d.areaFeatures : null,
    source: d.source.name,
    sourceDate: d.source.date,
    dateBasis: d.source.dateBasis,
    coverage: d.coverageNote,
    file: d.file,
  }));
  const connected = rows.filter(r => r.connected);
  const missing = rows.filter(r => !r.connected);
  return {
    ok: true,
    summary: `수록 자료 ${fmt(rows.length)}종 중 ${fmt(connected.length)}종이 연결(모두 부분 자료), ${fmt(missing.length)}종은 미연결입니다.`,
    data: { datasets: rows, dongs: store.dongs.map(d => ({ dongId: d.id, dongName: d.name })) },
    map: undefined,
    sources: uniqueSources(store, datasets.filter(d => d.connected)),
    caveats: [
      '연결된 자료도 모두 부분 자료(partial)입니다. 건수를 서구 전체 시설 수로 인용하지 마세요.',
      '미연결 자료의 건수는 0 이 아니라 "자료 없음"입니다.',
      'sites 는 같은 시설의 점·면 중복을 합친 수록 지점 수이고, features 는 파일의 원자료 도형 수입니다.',
    ],
  };
}

function locate(store, args) {
  if (typeof args.query !== 'string' || !args.query.trim()) {
    throw new SpatialError('INVALID_ARGUMENT', 'query(동 이름 또는 시설 이름 일부)가 필요합니다.');
  }
  const limit = numberArg(args, 'limit', { min: 1, max: 20, def: 5, integer: true });
  const category = args.category ? resolveCategory(store, args.category) : null;
  if (category && !category.connected) return notConnectedResult(store, category);

  const matches = searchPlaces(store, args.query, { limit, category });
  const rows = matches.map(m => ({ ...m, lon: round(m.lon, 6), lat: round(m.lat, 6) }));
  const used = [...new Set(rows.filter(r => r.category).map(r => r.category))].map(id => store.dataset(id));
  const best = rows[0];
  return {
    ok: rows.length > 0,
    summary: best
      ? `'${args.query}' → ${best.type === 'dong' ? `${best.name}(행정동)` : `${best.name}(${best.categoryTitle}, ${best.dongName || '동 경계 밖'})`} 등 ${fmt(rows.length)}건을 찾았습니다.`
      : `'${args.query}' 에 해당하는 동·시설을 수록 자료에서 찾지 못했습니다.`,
    data: { query: args.query, matches: rows },
    map: best ? mapOf(best.type === 'dong' ? { dongId: best.dongId } : { lon: best.lon, lat: best.lat }, rows.map(r => ({ ...r, id: r.id || r.dongId, category: r.category || 'dong' }))) : undefined,
    sources: sourcesOf(store, used, { withDongs: true }),
    caveats: [
      '수록 자료 안의 이름만 검색합니다(주소 지오코딩 아님). 찾지 못했다고 해서 실제로 없는 곳이라는 뜻이 아닙니다.',
      '동 좌표는 경계 안의 대표점, 시설 좌표는 공개 대표위치로 출입구가 아닙니다.',
    ],
  };
}

function dongProfile(store, args) {
  const dong = resolveDong(store, args.dong);
  const datasets = store.queryableDatasets();
  const connected = datasets.filter(d => d.connected);
  const counts = connected
    .map(d => ({ category: d.id, title: d.title, count: d.sites.filter(s => s.dongId === dong.id).length }))
    .sort((a, b) => b.count - a.count);
  const civic = store.civicIndex()?.rows?.find(row => row.dongId === dong.id) || null;

  const flood = connected.find(d => d.id.includes('flood'));
  const floodByYear = flood ? groupByYear(flood.sites.filter(s => s.dongId === dong.id)) : null;

  const top = counts.filter(c => c.count > 0).slice(0, 4).map(c => `${c.title} ${fmt(c.count)}`).join(', ');
  return {
    ok: true,
    summary: `${dong.name}(약 ${round(dong.areaKm2, 2)}㎢) 수록 지점: ${top || '해당 없음'} 등 ${fmt(connected.length)}종 자료 기준입니다.`,
    data: {
      dongId: dong.id,
      dongName: dong.name,
      areaKm2: round(dong.areaKm2, 3),
      counts,
      notConnected: datasets.filter(d => !d.connected).map(d => ({ category: d.id, title: d.title, state: d.state })),
      civicIndex: civic ? {
        matches: (civic.matches || []).map(m => ({ name: m.name, address: m.address || '' })),
        review: civic.review || '',
        checkedAt: store.civicIndex().checkedAt || null,
      } : null,
      floodHistoryByYear: floodByYear,
    },
    map: mapOf({ dongId: dong.id }),
    sources: uniqueSources(store, connected),
    caveats: [
      CAVEAT_PARTIAL,
      '수록 건수 0 은 "이 동에 없음"이 아니라 "자료에 실리지 않음"일 수 있습니다.',
      CAVEAT_DONG,
      '면적은 공개 경계 도형으로 계산한 근사값이며 공식 행정면적이 아닙니다.',
      'civicIndex 는 행정복지센터 명칭 대조 결과이며 통계 지표가 아닙니다(현장 위치 미검수).',
      ...(floodByYear ? [CAVEAT_FLOOD] : []),
    ],
  };
}

function findFacilities(store, args) {
  const dataset = resolveCategory(store, args.category);
  if (!dataset.connected) return notConnectedResult(store, dataset);

  const dong = optionalDong(store, args);
  const origin = resolveOrigin(store, args);
  const limit = numberArg(args, 'limit', { min: 1, max: 200, def: 30, integer: true });
  const radiusM = origin ? numberArg(args, 'radiusM', { min: 10, max: 5000, def: 500 }) : null;
  const nameKey = typeof args.nameContains === 'string' ? args.nameContains.replace(/\s+/g, '') : '';

  let sites = dataset.sites;
  if (dong) sites = sites.filter(s => s.dongId === dong.id);
  if (nameKey) sites = sites.filter(s => s.name.replace(/\s+/g, '').includes(nameKey));

  let rows;
  if (origin) {
    rows = byDistance(sites, origin)
      .filter(item => item.distanceM <= radiusM)
      .map(item => siteRow(item.site, item.distanceM));
  } else {
    rows = [...sites].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(site => siteRow(site));
  }
  const total = rows.length;
  const shown = rows.slice(0, limit);

  const where = [
    dong ? dong.name : (origin ? '' : '서구 전체'),
    origin ? `${origin.label} 반경 ${fmt(radiusM)}m` : '',
  ].filter(Boolean).join(', ');
  return {
    ok: true,
    summary: dataset.id === 'layer-public-facilities'
      ? `${where} 조건에서 '${dataset.title}' 자료에 수록된 공간은 ${fmt(total)}개입니다(부분 자료 기준${total > shown.length ? `, ${fmt(shown.length)}개만 표시` : ''}). ${CAVEAT_PUBLIC_SPACE}`
      : `${where} 조건에서 '${dataset.title}' 자료에 수록된 지점은 ${fmt(total)}곳입니다(부분 자료 기준${total > shown.length ? `, ${fmt(shown.length)}곳만 표시` : ''}).`,
    data: {
      category: dataset.id,
      title: dataset.title,
      total,
      returned: shown.length,
      truncated: total > shown.length,
      dongName: dong?.name ?? null,
      origin: originData(origin),
      radiusM,
      rows: shown,
    },
    map: mapOf(focusOf(origin, dong, radiusM), shown),
    sources: sourcesOf(store, [dataset], { withDongs: Boolean(dong) }),
    caveats: [
      datasetCaveat(dataset),
      CAVEAT_PARTIAL,
      ...(origin ? [CAVEAT_STRAIGHT] : []),
      ...(dong ? [CAVEAT_DONG] : []),
      ...(dataset.id.includes('flood') ? [CAVEAT_FLOOD] : []),
      ...originCaveats(origin),
    ],
  };
}

function nearest(store, args) {
  const dataset = resolveCategory(store, args.category);
  if (!dataset.connected) return notConnectedResult(store, dataset);
  const origin = resolveOrigin(store, args);
  if (!origin) {
    throw new SpatialError('INVALID_ARGUMENT', '기준점이 필요합니다. place(동·시설 이름) 또는 lon·lat 을 입력하세요.');
  }
  const n = numberArg(args, 'n', { min: 1, max: 50, def: 3, integer: true });
  const maxDistanceM = numberArg(args, 'maxDistanceM', { min: 10, max: 20000, def: null });

  let ranked = byDistance(dataset.sites, origin);
  // 기준점이 같은 분류의 시설 자신이면 결과에서 뺀다.
  if (origin.via === 'facility') ranked = ranked.filter(item => item.distanceM > 0.5 || item.site.name !== origin.label);
  if (maxDistanceM) ranked = ranked.filter(item => item.distanceM <= maxDistanceM);
  const rows = ranked.slice(0, n).map(item => siteRow(item.site, item.distanceM));

  const first = rows[0];
  return {
    ok: rows.length > 0,
    summary: first
      ? `${origin.label}에서 가장 가까운 '${dataset.title}' 수록 지점은 ${first.name}(직선 약 ${fmt(first.distanceM)}m)이며, 가까운 순 ${fmt(rows.length)}곳을 돌려드립니다.`
      : `${origin.label}에서 ${maxDistanceM ? `${fmt(maxDistanceM)}m 안에 ` : ''}'${dataset.title}' 자료에 수록된 지점이 없습니다(자료에 없다는 뜻이며 실제 부재를 뜻하지 않음).`,
    data: { category: dataset.id, title: dataset.title, origin: originData(origin), maxDistanceM, rows },
    map: mapOf(focusOf(origin, null, first ? Math.max(100, rows.at(-1).distanceM) : undefined), rows),
    sources: sourcesOf(store, [dataset]),
    caveats: [
      datasetCaveat(dataset),
      '자료에 실리지 않은 더 가까운 시설이 있을 수 있습니다.',
      CAVEAT_STRAIGHT,
      ...originCaveats(origin),
    ],
  };
}

function coverageGap(store, args) {
  const target = resolveCategory(store, args.target, 'target');
  const service = resolveCategory(store, args.service, 'service');
  if (!target.connected) return notConnectedResult(store, target, { role: 'target' });
  if (!service.connected) return notConnectedResult(store, service, { role: 'service' });

  const radiusM = numberArg(args, 'radiusM', { min: 10, max: 3000, def: 150 });
  const limit = numberArg(args, 'limit', { min: 1, max: 200, def: 50, integer: true });
  const dong = optionalDong(store, args);

  const targets = dong ? target.sites.filter(s => s.dongId === dong.id) : target.sites;
  // 서비스 시설은 동 경계 밖(이웃 동)에 있어도 반경 안이면 닿는 것으로 본다.
  const servicePoints = service.sites.map(s => [s.lon, s.lat]);

  const perDong = new Map(store.dongs.map(d => [d.id, { dongId: d.id, dongName: d.name, targets: 0, uncovered: 0 }]));
  const outside = { dongId: null, dongName: '행정동 경계 밖', targets: 0, uncovered: 0 };
  const uncovered = [];

  for (const site of targets) {
    const here = [site.lon, site.lat];
    let nearestM = Infinity;
    for (const point of servicePoints) {
      const d = haversine(here, point);
      if (d < nearestM) nearestM = d;
    }
    const bucket = perDong.get(site.dongId) || outside;
    bucket.targets++;
    if (nearestM > radiusM) {
      bucket.uncovered++;
      uncovered.push({ ...siteRow(site), nearestServiceM: Number.isFinite(nearestM) ? Math.round(nearestM) : null });
    }
  }
  // 가장 가까운 서비스 시설이 먼 순(공백이 큰 순)으로 보여준다.
  uncovered.sort((a, b) => (b.nearestServiceM ?? Infinity) - (a.nearestServiceM ?? Infinity));

  const byDong = [...perDong.values(), outside]
    .filter(row => row.targets > 0)
    .map(row => ({ ...row, uncoveredShare: round(row.uncovered / row.targets, 3) }))
    .sort((a, b) => b.uncovered - a.uncovered);
  const share = targets.length ? Math.round(uncovered.length / targets.length * 100) : 0;
  const shown = uncovered.slice(0, limit);
  const worst = byDong[0];

  return {
    ok: true,
    summary: `${dong ? dong.name : '서구 전체'}의 '${target.title}' 수록 지점 ${fmt(targets.length)}곳 중 반경 ${fmt(radiusM)}m 안에 '${service.title}' 수록 지점이 없는 곳은 ${fmt(uncovered.length)}곳(${share}%)입니다.`
      + (!dong && worst?.uncovered ? ` 가장 많은 동은 ${worst.dongName} ${fmt(worst.uncovered)}곳입니다.` : '')
      + ' 수록 자료끼리의 비교이며 현장 확인 전 후보 목록입니다.',
    data: {
      target: { category: target.id, title: target.title },
      service: { category: service.id, title: service.title, sites: service.sites.length },
      radiusM,
      dongName: dong?.name ?? null,
      targets: targets.length,
      uncovered: uncovered.length,
      uncoveredShare: targets.length ? round(uncovered.length / targets.length, 3) : null,
      byDong,
      returned: shown.length,
      truncated: uncovered.length > shown.length,
      rows: shown,
    },
    map: mapOf(dong ? { dongId: dong.id } : undefined, shown),
    sources: sourcesOf(store, [target, service], { withDongs: true }),
    caveats: [
      datasetCaveat(target),
      datasetCaveat(service),
      `두 자료 모두 부분 자료이므로 "사각지대"는 수록 자료 기준의 후보입니다. '${service.title}' 자료에 실리지 않은 시설이 실제로는 있을 수 있어 현장 확인이 필요합니다.`,
      '같은 이름의 지점(예: 양방향 정류장, 원자료의 중복 등록)은 각각 따로 셉니다.',
      CAVEAT_STRAIGHT,
      CAVEAT_DONG,
    ],
  };
}

/** 대상마다 같은 반경을 적용한다. 동 경계는 대상만 좁히며 이웃 동의 서비스도 포함한다. */
function compareNearby(store, args) {
  const target = resolveCategory(store, args.target, 'target');
  const service = resolveCategory(store, args.service, 'service');
  const radiusM = numberArg(args, 'radiusM', { min: 10, max: 3000, def: 150 });
  const limit = numberArg(args, 'limit', { min: 1, max: 200, def: 50, integer: true });
  const dong = optionalDong(store, args);
  const scope = `${dong?.name || '서구 전체'} · '${target.title}'별 '${service.title}' · 직선 반경 ${fmt(radiusM)}m`;
  const conditions = {
    target: { category: target.id, title: target.title },
    service: { category: service.id, title: service.title },
    radiusM, dongName: dong?.name ?? null,
  };
  if (!target.connected || !service.connected) {
    const missing = !target.connected ? target : service;
    const result = notConnectedResult(store, missing, { ...conditions, role: missing === target ? 'target' : 'service' });
    return { ...result, summary: `${scope}: ${result.summary}` };
  }
  const targets = dong ? target.sites.filter(site => site.dongId === dong.id) : target.sites;
  const rows = targets.map(site => {
    // 같은 자료를 비교할 경우 대상 자신을 주변 서비스로 세지 않는다.
    const distances = byDistance(service.sites.filter(other => target !== service || other.id !== site.id), site);
    const near = distances.filter(item => item.distanceM <= radiusM);
    return { ...siteRow(site), nearbyCount: near.length,
      nearestServiceM: distances.length ? Math.round(distances[0].distanceM) : null };
  }).sort((a, b) => a.nearbyCount - b.nearbyCount || a.name.localeCompare(b.name, 'ko'));
  const covered = rows.filter(row => row.nearbyCount > 0).length;
  const shown = rows.slice(0, limit);
  return {
    ok: true,
    summary: `${scope} 조건으로 수록 대상 ${fmt(rows.length)}곳을 비교했습니다. 반경 안에 서비스가 수록된 대상은 ${fmt(covered)}곳, 수록되지 않은 대상은 ${fmt(rows.length - covered)}곳입니다.`
      + (rows.length > shown.length ? ` 비교표는 ${fmt(shown.length)}곳만 표시합니다.` : '')
      + ' 서비스가 적게 수록된 대상부터 표시하며 실제 시설 부재나 설치 우선순위를 뜻하지 않습니다.',
    data: { ...conditions, targets: rows.length, covered, uncovered: rows.length - covered,
      returned: shown.length, truncated: rows.length > shown.length, rows: shown },
    map: mapOf(dong ? { dongId: dong.id } : undefined, shown),
    sources: sourcesOf(store, [target, service], { withDongs: true }),
    caveats: [datasetCaveat(target), datasetCaveat(service), CAVEAT_PARTIAL, CAVEAT_STRAIGHT, CAVEAT_DONG,
      '대상 시설만 선택 동으로 좁혔으며, 서비스 시설은 이웃 동에 있어도 반경 안이면 셉니다.',
      '최근접 거리는 반경 밖 서비스까지 포함한 수록 자료의 최소 직선거리입니다. 수록 지점이 없으면 미확인으로 표시합니다.',
      '비교 반경은 이번 질문의 가정이며 법정 설치기준이 아닙니다. 같은 서비스가 여러 대상 반경에 포함될 수 있으므로 행별 건수를 합해 전체 시설 수로 쓰지 마세요.'],
  };
}

function compareDongs(store, args) {
  if (!Array.isArray(args.categories) || !args.categories.length || args.categories.length > 8) {
    throw new SpatialError('INVALID_ARGUMENT', 'categories 는 1~8개의 분류 이름 배열이어야 합니다.');
  }
  const datasets = [];
  for (const name of args.categories) {
    const dataset = resolveCategory(store, name, 'categories');
    if (!datasets.includes(dataset)) datasets.push(dataset);
  }
  const perKm2 = args.perKm2 === true;
  const connected = datasets.filter(d => d.connected);
  const missing = datasets.filter(d => !d.connected);
  if (!connected.length) return notConnectedResult(store, missing[0]);

  let dongs = store.dongs;
  if (Array.isArray(args.dongs) && args.dongs.length) dongs = args.dongs.map(name => resolveDong(store, name));

  const rows = dongs.map(dong => {
    const counts = {};
    const density = {};
    for (const dataset of datasets) {
      // 미연결 자료는 0 이 아니라 null.
      const count = dataset.connected ? dataset.sites.filter(s => s.dongId === dong.id).length : null;
      counts[dataset.id] = count;
      if (perKm2) density[dataset.id] = count === null ? null : round(count / dong.areaKm2, 2);
    }
    return { dongId: dong.id, dongName: dong.name, areaKm2: round(dong.areaKm2, 3), counts, ...(perKm2 ? { perKm2: density } : {}) };
  });

  const sortBy = args.sortBy ? resolveCategory(store, args.sortBy, 'sortBy') : connected[0];
  const key = row => (perKm2 ? row.perKm2[sortBy.id] : row.counts[sortBy.id]) ?? -1;
  rows.sort((a, b) => key(b) - key(a));

  const unassigned = Object.fromEntries(connected.map(d => [d.id, d.sites.filter(s => !s.dongId).length]));
  const top = rows[0];
  const bottom = rows.at(-1);
  const unit = perKm2 ? '곳/㎢' : '곳';
  return {
    ok: true,
    summary: (rows.length === 1
      ? `${top.dongName}의 수록 지점 비교: ${connected.map(d => `'${d.title}' ${fmt(perKm2 ? top.perKm2[d.id] : top.counts[d.id])}${unit}`).join(', ')}입니다(부분 자료 기준).`
      : `${fmt(rows.length)}개 동의 ${connected.map(d => `'${d.title}'`).join(', ')} 수록 지점 비교: '${sortBy.title}' 기준 ${top.dongName} ${fmt(key(top))}${unit}${unit.endsWith('곳') ? '으로' : '로'} 가장 많고 ${bottom.dongName} ${fmt(key(bottom))}${unit}로 가장 적습니다(부분 자료 기준).`)
      + (missing.length ? ` ${missing.map(d => `'${d.title}'`).join(', ')}은(는) 미연결이라 값이 없습니다.` : ''),
    data: {
      categories: datasets.map(d => ({ category: d.id, title: d.title, connected: d.connected, state: d.state })),
      perKm2,
      sortedBy: sortBy.id,
      rows,
      outsideDongBoundary: unassigned,
    },
    map: undefined,
    sources: sourcesOf(store, connected, { withDongs: true }),
    caveats: [
      ...connected.map(datasetCaveat),
      ...missing.map(d => `${notConnectedText(d)} 표의 null 은 0곳이 아닙니다.`),
      '동별 차이에는 실제 시설 차이뿐 아니라 자료 수록 정도의 차이가 섞여 있습니다. 동 사이 순위를 시설 수준 평가로 쓰지 마세요.',
      CAVEAT_DONG,
      ...(perKm2 ? ['면적은 공개 경계 도형으로 계산한 근사값이며 공식 행정면적이 아닙니다.'] : []),
    ],
  };
}

function groupByYear(sites) {
  const years = new Map();
  for (const site of sites) {
    const key = site.year ?? '연도 미상';
    if (!years.has(key)) years.set(key, { year: key, count: 0, byKind: {} });
    const row = years.get(key);
    row.count++;
    const kind = site.kind || '내용 미상';
    row.byKind[kind] = (row.byKind[kind] || 0) + 1;
  }
  return [...years.values()].sort((a, b) => String(b.year).localeCompare(String(a.year)));
}

function floodHistory(store, args) {
  const entry = store.catalog().find(e => e.queryable && e.id.includes('flood'));
  if (!entry) {
    return {
      ok: false,
      summary: '과거 침수피해 기록 자료가 연결되어 있지 않습니다(자료 없음이며 침수 이력이 없다는 뜻이 아님).',
      data: { connected: false, byYear: [], rows: [] },
      map: undefined,
      sources: [],
      caveats: ['침수 기록 자료가 미연결 상태입니다. 침수 이력이 없다는 뜻이 아닙니다.'],
    };
  }
  const dataset = store.dataset(entry.id);
  if (!dataset.connected) return notConnectedResult(store, dataset);

  const dong = optionalDong(store, args);
  const origin = resolveOrigin(store, args);
  const radiusM = origin ? numberArg(args, 'radiusM', { min: 10, max: 5000, def: 300 }) : null;
  const yearFrom = numberArg(args, 'yearFrom', { min: 1900, max: 2100, def: null, integer: true });
  const yearTo = numberArg(args, 'yearTo', { min: 1900, max: 2100, def: null, integer: true });
  const limit = numberArg(args, 'limit', { min: 1, max: 200, def: 30, integer: true });

  let sites = dataset.sites;
  if (dong) sites = sites.filter(s => s.dongId === dong.id);
  if (yearFrom) sites = sites.filter(s => s.year !== null && s.year >= yearFrom);
  if (yearTo) sites = sites.filter(s => s.year !== null && s.year <= yearTo);

  let rows;
  if (origin) {
    const near = byDistance(sites, origin).filter(item => item.distanceM <= radiusM);
    sites = near.map(item => item.site);
    rows = near.map(item => siteRow(item.site, item.distanceM));
  } else {
    rows = [...sites].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).map(site => siteRow(site));
  }

  const byYear = groupByYear(sites);
  const byDong = dong || origin ? undefined : store.dongs
    .map(d => ({ dongId: d.id, dongName: d.name, count: sites.filter(s => s.dongId === d.id).length }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count);
  const shown = rows.slice(0, limit);
  const where = origin ? `${origin.label} 반경 ${fmt(radiusM)}m` : dong ? dong.name : '서구 전체';
  const years = byYear.map(y => `${y.year}년 ${fmt(y.count)}건`).join(', ').replace('연도 미상년', '연도 미상');

  return {
    ok: true,
    summary: sites.length
      ? `${where}의 과거 침수피해 기록은 ${fmt(sites.length)}건입니다(${years}). 과거 이력이며 위험 예측이 아닙니다.`
      : `${where}에는 수록된 과거 침수피해 기록이 없습니다. 기록이 없다는 것이 침수 위험이 없다는 뜻은 아닙니다.`,
    data: {
      scope: where,
      origin: originData(origin),
      radiusM,
      dongName: dong?.name ?? null,
      total: sites.length,
      byYear,
      ...(byDong ? { byDong } : {}),
      returned: shown.length,
      truncated: rows.length > shown.length,
      rows: shown,
    },
    map: mapOf(focusOf(origin, dong, radiusM), shown),
    sources: sourcesOf(store, [dataset], { withDongs: Boolean(dong || byDong) }),
    caveats: [
      CAVEAT_FLOOD,
      '연도별 건수 차이는 실제 피해 규모뿐 아니라 연도별 집계·공개 범위의 차이를 반영합니다. 같은 위치·연도에 여러 행이 있을 수 있어 건수는 피해 가구 수가 아닙니다.',
      datasetCaveat(dataset),
      ...(origin ? [CAVEAT_STRAIGHT] : []),
      ...originCaveats(origin),
    ],
  };
}

/** "2026-08-01 14:00", "2026-08-01T14:00:00+09:00" 같은 입력을 solar.js 형식으로 맞춘다. */
function normaliseKst(value) {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:\+09:?00)?$/);
  return match ? `${match[1]}T${match[2]}` : '';
}

function sunPosition(store, args) {
  const time = normaliseKst(args.datetime);
  let date;
  try {
    date = parseKst(time);
  } catch {
    throw new SpatialError('INVALID_ARGUMENT', "datetime 은 한국시간 'YYYY-MM-DDTHH:mm' 형식(2000~2100년)이어야 합니다. 예: 2026-08-01T14:00");
  }
  let origin = resolveOrigin(store, args);
  if (!origin && args.dong) {
    const dong = resolveDong(store, args.dong);
    origin = { lon: dong.labelPoint[0], lat: dong.labelPoint[1], label: `${dong.name} 대표점`, dongName: dong.name, via: 'dong' };
  }
  if (!origin) {
    const [lon, lat] = store.districtCentre();
    origin = { lon, lat, label: '서구 중심부', dongName: null, via: 'coordinates' };
  }
  const heightM = numberArg(args, 'heightM', { min: 0.5, max: 600, def: null });

  const sun = solarPosition(date, origin.lon, origin.lat);
  const altitude = round(sun.altitude, 1);
  const azimuth = round(sun.azimuth, 1);
  const data = {
    datetimeKst: `${time}+09:00`,
    location: originData(origin),
    altitudeDeg: altitude,
    azimuthDeg: azimuth,
    azimuthCompass: compass(sun.azimuth),
    night: sun.night,
  };

  let shadowText = '';
  if (heightM) {
    if (sun.altitude > 3) {
      // 평탄한 땅 위의 수직 기둥 가정: 길이 = 높이 / tan(고도)
      const lengthM = heightM / Math.tan(sun.altitude * Math.PI / 180);
      data.shadow = {
        heightM,
        lengthM: round(lengthM, 1),
        directionDeg: round((sun.azimuth + 180) % 360, 1),
        directionCompass: compass(sun.azimuth + 180),
      };
      shadowText = ` 높이 ${heightM}m 수직 물체의 평지 그림자는 ${data.shadow.directionCompass}쪽으로 약 ${fmt(data.shadow.lengthM)}m입니다.`;
    } else {
      data.shadow = null;
      shadowText = ' 태양 고도 3° 이하에서는 그림자 길이를 계산하지 않습니다.';
    }
  }

  return {
    ok: true,
    summary: sun.night
      ? `${time.replace('T', ' ')} (KST) ${origin.label}: 태양이 지평선 아래(고도 ${altitude}°)에 있습니다.${shadowText}`
      : `${time.replace('T', ' ')} (KST) ${origin.label}: 태양 고도 ${altitude}°, 방위 ${azimuth}°(${data.azimuthCompass}).${shadowText}`,
    data,
    map: mapOf({ lon: round(origin.lon, 6), lat: round(origin.lat, 6) }),
    sources: [{ name: '태양 위치 기하 계산(서구:온 src/city/solar.js)', date: null }],
    caveats: [
      '천문 기하식에 의한 근사 계산입니다. 대기 굴절·지형·구름은 반영하지 않았으며 일조권 등 법적 판단 자료가 아닙니다.',
      ...(heightM ? ['그림자 길이는 평탄한 지면 위 수직 물체를 가정한 값입니다. 실제 건물·나무·지형에 의한 그늘과 다릅니다. 건물 높이 자료가 대부분 추정값이어서 특정 지점이 그늘인지 여부는 판정하지 않습니다.'] : []),
      ...originCaveats(origin),
    ],
  };
}

/* ───────────────────────── 업무별 근거 묶음 ───────────────────────── */

const WORK_THEMES = {
  ...CIVIC_THEMES,
  heat: {
    title: '폭염 대응 점검자료',
    datasets: [['무더위쉼터', '무더위쉼터'], ['그늘막', '그늘막'], ['쿨링포그', '쿨링포그']],
    gap: {target: '버스정류장', service: '그늘막', radiusM: 150},
    nextActions: ['시설 목록과 실제 개방시간·수용인원·가동 상태를 대조합니다.', '그늘막 공백 후보의 보행 동선·대기환경·기존 수목을 현장에서 확인합니다.', '추가 설치를 검토할 때 이용자 수·부지 사용·관리 주체를 함께 확인합니다.'],
    missingData: ['현시점 폭염특보·체감온도·현장 온도', '시간대별 이용 수요와 시설의 실제 개방·가동 상태'],
  },
  cold: {
    title: '한파 대응 점검자료',
    datasets: [['한파쉼터', '한파쉼터'], ['버스정류장', '버스정류장']],
    gap: {target: '버스정류장', service: '한파쉼터', radiusM: 300},
    nextActions: ['한파쉼터의 실제 개방시간·난방·접근 가능 여부를 확인합니다.', '쉼터와 떨어진 정류장 후보의 대기시간·보행 경로를 현장에서 확인합니다.', '시설 관리부서와 안내·임시 대기공간 운영 가능 여부를 협의합니다.'],
    missingData: ['현시점 한파특보·체감온도', '정류장별 밀폐 대기공간·온열시설과 시간대별 이용 수요'],
  },
  icing: {
    title: '결빙 관리지점 점검자료',
    datasets: [['local-icing', '상습결빙 관리지점'], ['제설함', '제설함'], ['snow-routes', '제설노선']],
    nextActions: ['수록 관리지점을 현장·도로관리대장과 대조합니다.', '노면 상태·배수·일조·교량 여부와 제설자재 비축 상태를 확인합니다.', '관리 주체·점검 일정·현장 조치 결과를 기록합니다.'],
    missingData: ['현재 노면 온도·습도와 실제 결빙 관측', '구간별 최신 제설자재 수량·순찰·작업 기록'],
  },
  flood: {
    title: '침수 이력 현장점검 자료',
    datasets: [['대피소', '대피장소'], ['official-temporary-housing', '임시주거시설']],
    nextActions: ['과거 피해 지점의 현재 배수시설·정비 이력·현장 상태를 확인합니다.', '대피장소의 재난 유형별 사용 가능 여부와 실제 보행 경로를 확인합니다.', '최근 피해·공사·배수 변경사항을 담당부서 자료와 대조합니다.'],
    missingData: ['현재 침수·수위·배수시설 가동 상태', '홍수 예측모형과 실시간 위험도', '지진대피장소의 침수 재난 시 사용 적합성'],
  },
  school: {
    title: '통학환경 현장점검 자료',
    datasets: [['학교', '학교'], ['어린이보호구역', '어린이보호구역'], ['비상벨', '비상벨']],
    nextActions: ['학교 출입구와 실제 통학 동선·횡단시설을 현장에서 확인합니다.', '보호구역 지정도·시설물 관리대장을 수록 위치와 대조합니다.', '학교·도로관리·경찰 등과 합동 점검 및 후속조치를 협의합니다.'],
    missingData: ['학생별 통학 동선·시간대별 통행량', '현시점 시설 정상 작동 여부와 사고 위험도'],
  },
  living: {
    title: '생활시설 검토자료',
    datasets: [['학교', '학교'], ['도서관', '도서관'], ['공원', '공원'], ['복지시설', '복지시설']],
    nextActions: ['수록 시설의 실제 운영 여부·이용시간을 확인합니다.', '보행 접근성·출입구·이용 수요를 현장에서 대조합니다.', '시설 확충 판단 전 인구·수요·유사시설 운영자료를 확보합니다.'],
    missingData: ['시설별 실제 개방시간·수용능력', '인구·이용 수요·보행 경로를 반영한 적정성 분석'],
  },
};

/** 여러 공개 자료를 실제 조회·공간 계산하고 확인할 일과 함께 반환한다. */
function workBrief(store, args) {
  const theme = typeof args.theme === 'string' && Object.hasOwn(WORK_THEMES, args.theme) ? WORK_THEMES[args.theme] : null;
  if (!theme) throw new SpatialError('INVALID_ARGUMENT', 'theme은 heat, cold, icing, flood, school, living, agenda, space, reuse, coordination 중 하나여야 합니다.');
  const dong = optionalDong(store, args);
  const scopeArgs = dong ? {dong: dong.name} : {};
  let datasets = theme.datasets;
  if (args.categories !== undefined) {
    if (!isCivicTheme(args.theme) || !Array.isArray(args.categories) || !args.categories.length || args.categories.length > 4 || args.categories.some(c => typeof c !== 'string' || !c.trim() || c.length > 80)) {
      throw new SpatialError('INVALID_ARGUMENT', 'categories는 마을·공간 검토에서 조회할 시설 분류 1~4개여야 합니다.');
    }
    datasets = [...new Set(args.categories)].map(category => {
      let title = category;
      try { title = resolveCategory(store, category).title; } catch (error) { if (!(error instanceof SpatialError)) throw error; }
      return [category, title];
    });
  }
  // Category order also controls the primary result rows; rooms/halls lead when requested.
  const isPublicSpace = ([category]) => {
    try { return resolveCategory(store, category).id === 'layer-public-facilities'; }
    catch (error) { if (!(error instanceof SpatialError)) throw error; return false; }
  };
  if (isCivicTheme(args.theme)) datasets = [...datasets].sort((a, b) => Number(isPublicSpace(b)) - Number(isPublicSpace(a)));
  const checks = [];
  const add = (name, title, input, run) => {
    let result;
    try { result = run(store, input); }
    catch (error) {
      if (!(error instanceof SpatialError)) throw error;
      result = {ok: false, summary: `${title}: 조회 가능한 수록자료를 확인하지 못했습니다.`, data: {code: error.code}, sources: [], caveats: [`${title} 자료 미확인은 시설이 없다는 뜻이 아닙니다.`]};
    }
    checks.push({tool: name, title, args: input, result});
  };
  if (args.theme === 'flood') add('flood_history', '과거 침수피해 기록', {...scopeArgs, limit: 50}, floodHistory);
  for (const [category, title] of datasets) add('find_facilities', title, {category, ...scopeArgs, limit: 40}, findFacilities);
  if (theme.gap) {
    const radiusM = numberArg(args, 'radiusM', {min: 10, max: 3000, def: theme.gap.radiusM});
    add('coverage_gap', '시설 공백 후보 공간계산', {...theme.gap, ...scopeArgs, radiusM, limit: 50}, coverageGap);
  }
  const successful = checks.filter(c => c.result.ok);
  const gap = checks.find(c => c.tool === 'coverage_gap' && c.result.ok);
  const publicSpace = checks.find(c => c.result.data?.category === 'layer-public-facilities');
  const primary = gap?.result.map?.highlight?.features?.length ? gap : publicSpace || checks.find(c => c.result.map?.highlight?.features?.length);
  const allPoints = successful.flatMap(c => c.result.map?.highlight?.features || []);
  const seen = new Set();
  const features = (primary?.tool === 'coverage_gap' ? primary.result.map.highlight.features : allPoints)
    .filter(f => {const key = `${f.properties?.category}|${f.properties?.id}`; if (seen.has(key)) return false; seen.add(key); return true;}).slice(0, MAX_HIGHLIGHT);
  const sources = new Map();
  for (const c of checks) for (const s of c.result.sources || []) sources.set(`${s.name}|${s.date}`, s);
  const missingData = [...checks.filter(c => !c.result.ok).map(c => `${c.title}: 수록자료 미확인·미연결`), ...(publicSpace ? ['공간별 현재 운영시간·예약·휴관·사용 승인 여부'] : []), ...theme.missingData];
  const basis = `${publicSpace ? '회의실·강당 등 공공공간을 우선 조회하며, 함께 제시한 공원·교통 등은 주변 참고자료입니다. ' : ''}공개 수록자료의 조회·공간계산 결과입니다. 실시간 관측·전수조사·위험 예측이나 최적 입지 결정이 아닙니다.`;
  return {
    ok: successful.length > 0,
    summary: `${dong?.name || '서구 전체'} ${theme.title}. ${checks.map(c => c.result.summary).join(' ')}`,
    data: {
      title: theme.title, scope: dong?.name || '서구 전체', theme: args.theme, basis,
      ...(isCivicTheme(args.theme) ? {categorySelection: args.categories ? 'mentioned' : 'theme-default'} : {}),
      evidence: checks.map(c => ({title: c.title, tool: c.tool, args: c.args, summary: c.result.summary, ok: c.result.ok})),
      nextActions: publicSpace ? ['수록 공간의 운영·예약 조건을 관리 주체에게 확인하고, 공공공간 검토에서 확인 기록과 변경안을 같은 요일·시간으로 비교합니다.', ...theme.nextActions] : theme.nextActions, missingData,
      rows: primary?.result.data?.rows?.slice(0, 12) || [],
      ...(gap ? {comparison: {radiusM: gap.result.data.radiusM, targets: gap.result.data.targets, uncovered: gap.result.data.uncovered}} : {}),
    },
    map: { ...(dong ? {focus: {dongId: dong.id}} : {}), highlight: {type: 'FeatureCollection', features} },
    sources: [...sources.values()],
    caveats: [...new Set([basis, ...checks.flatMap(c => c.result.caveats || []), ...(theme.gap ? [`비교 반경 ${gap?.result.data?.radiusM || args.radiusM || theme.gap.radiusM}m는 이번 검토의 직선거리 가정이며 법정 설치기준이 아닙니다.`] : [])])],
  };
}

/* ───────────────────────── 도구 목록 ───────────────────────── */

const CATEGORY_HELP = "자료 분류. list_datasets 의 category 값(예: 'bus', 'local-shade', 'school') 또는 한국어 이름(예: '버스정류장', '그늘막', '도서관').";
const PLACE_HELP = "기준 장소 이름. 동 이름('풍암동') 또는 수록 시설 이름 일부('서구청', '풍암초'). lon·lat 을 주면 무시됩니다.";
const DONG_HELP = "행정동 이름('풍암동', '화정1동') 또는 dongId('seogu-17').";
const LON = { type: 'number', description: '기준점 경도(WGS84). 예: 126.8807', minimum: 126.7, maximum: 127.05 };
const LAT = { type: 'number', description: '기준점 위도(WGS84). 예: 35.1287', minimum: 34.98, maximum: 35.35 };

function tool(name, title, description, properties, required, run) {
  return {
    name,
    title,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run,
  };
}

const REGISTRY = [
  tool(
    'work_brief',
    '업무별 공간검토',
    '폭염·한파 대응, 결빙·침수·통학환경 점검, 생활시설·마을의제·공간 대안·기존 공간 활용·사업 연계 검토에 필요한 수록자료와 담당자 확인사항을 묶습니다. heat는 정류장-그늘막 공백, cold는 정류장-한파쉼터 거리 후보도 계산합니다. 마을·공간 검토는 입력에 등장한 시설 분류를 categories로 좁힐 수 있습니다. 주민 의견·사업대장·예산·유휴 여부가 연결되었다고 가정하지 않으며 위험·최적 입지·대안 우열을 확정하지 않습니다.',
    {
      theme: {type: 'string', enum: ['heat', 'cold', 'icing', 'flood', 'school', 'living', 'agenda', 'space', 'reuse', 'coordination'], description: 'heat 폭염, cold 한파, icing 결빙, flood 침수 이력, school 통학환경, living 생활시설, agenda 마을의제, space 공간 대안 비교, reuse 기존 공간 활용, coordination 사업 연계'},
      dong: {type: 'string', description: `검토할 동. 생략하면 서구 전체. ${DONG_HELP}`},
      categories: {type: 'array', items: {type: 'string'}, minItems: 1, maxItems: 4, description: 'agenda·space·reuse·coordination에서 입력에 실제로 등장한 시설 분류만 조회할 때 사용. 생략하면 유형별 기본 시설자료. 입력 내용의 사실 확인이나 위치 확인이 아님.'},
      radiusM: {type: 'number', description: '폭염·한파 시설 공백 후보 비교에 쓸 직선거리(m). 미지정 시 폭염 150, 한파 300. 법정 설치기준 아님.', minimum: 10, maximum: 3000},
    },
    ['theme'],
    workBrief,
  ),
  tool(
    'list_datasets',
    '수록 자료 목록',
    '서구:온에 실린 공간자료(버스정류장, 그늘막, 학교, 침수기록 등)의 분류 id·수록 지점 수·출처·기준일·연결 상태를 돌려줍니다. 어떤 category 를 쓸 수 있는지 모를 때 가장 먼저 호출하세요. 모든 자료는 부분 자료이며, 미연결 자료는 건수가 null 입니다.',
    {},
    [],
    store => listDatasets(store),
  ),
  tool(
    'locate',
    '동·시설 위치 찾기',
    '동 이름이나 시설 이름 일부를 좌표와 행정동으로 바꿉니다. "풍암동이 어디야", "서구청 좌표", "○○초등학교 위치"처럼 장소를 특정해야 할 때 사용합니다. 수록 자료 안의 이름만 찾으며 주소 지오코딩은 하지 않습니다.',
    {
      query: { type: 'string', description: "찾을 이름. 예: '풍암동', '서구청', '상무'" },
      category: { type: 'string', description: `검색을 한 분류로 좁힐 때. ${CATEGORY_HELP}` },
      limit: { type: 'integer', description: '최대 후보 수(기본 5)', minimum: 1, maximum: 20, default: 5 },
    },
    ['query'],
    locate,
  ),
  tool(
    'dong_profile',
    '행정동 개요',
    '한 행정동의 면적, 자료 분류별 수록 지점 수, 미연결 자료 목록, 행정복지센터 명칭 대조, 연도별 과거 침수기록 수를 한 번에 돌려줍니다. "풍암동에 뭐가 있어?", "금호1동 현황 요약" 같은 질문에 사용합니다.',
    { dong: { type: 'string', description: DONG_HELP } },
    ['dong'],
    dongProfile,
  ),
  tool(
    'find_facilities',
    '시설 찾기',
    '한 분류의 수록 지점을 조건으로 찾습니다. 동으로 좁히거나(dong), 기준점 반경 안(place 또는 lon·lat + radiusM)만 고를 수 있습니다. "풍암동 버스정류장 목록", "서구청 반경 300m 안 주차장" 같은 질문에 사용합니다. 기준점이 있으면 가까운 순, 없으면 이름순입니다.',
    {
      category: { type: 'string', description: CATEGORY_HELP },
      dong: { type: 'string', description: `이 동 안의 지점만. ${DONG_HELP}` },
      place: { type: 'string', description: PLACE_HELP },
      lon: LON,
      lat: LAT,
      radiusM: { type: 'number', description: '기준점 반경(m). 기준점이 있을 때만 적용, 기본 500', minimum: 10, maximum: 5000, default: 500 },
      nameContains: { type: 'string', description: '이름에 이 글자가 들어간 지점만' },
      limit: { type: 'integer', description: '돌려줄 최대 건수(기본 30)', minimum: 1, maximum: 200, default: 30 },
    },
    ['category'],
    findFacilities,
  ),
  tool(
    'nearest',
    '가장 가까운 시설',
    '기준점에서 가장 가까운 수록 지점 N곳을 직선거리와 함께 돌려줍니다. "여기서 제일 가까운 그늘막", "풍암동 행정복지센터에서 가까운 도서관 3곳" 같은 질문에 사용합니다. 기준점(place 또는 lon·lat)이 반드시 필요합니다.',
    {
      category: { type: 'string', description: CATEGORY_HELP },
      place: { type: 'string', description: PLACE_HELP },
      lon: LON,
      lat: LAT,
      n: { type: 'integer', description: '돌려줄 개수(기본 3)', minimum: 1, maximum: 50, default: 3 },
      maxDistanceM: { type: 'number', description: '이 거리(m)보다 먼 지점은 제외', minimum: 10, maximum: 20000 },
    },
    ['category'],
    nearest,
  ),
  tool(
    'coverage_gap',
    '서비스 사각지대 분석',
    '대상 시설(target) 가운데 반경 radiusM 안에 서비스 시설(service)이 하나도 없는 곳을 찾아 동별 건수와 목록을 돌려줍니다. "그늘막이 없는 버스정류장"(target=버스정류장, service=그늘막), "반경 300m 안에 공원이 없는 놀이터" 같은 공백·사각지대 질문에 사용합니다. 수록 자료끼리의 비교이므로 결과는 현장 확인 전 후보입니다.',
    {
      target: { type: 'string', description: `사각지대 여부를 따질 대상 분류. 예: '버스정류장'. ${CATEGORY_HELP}` },
      service: { type: 'string', description: "가까이에 있어야 하는 서비스 분류. 예: '그늘막'" },
      radiusM: { type: 'number', description: '서비스가 닿는다고 볼 직선 반경(m). 기본 150', minimum: 10, maximum: 3000, default: 150 },
      dong: { type: 'string', description: `대상을 이 동으로 좁힘(서비스 시설은 이웃 동 것도 인정). ${DONG_HELP}` },
      limit: { type: 'integer', description: '목록으로 돌려줄 최대 건수(기본 50). 동별 집계는 항상 전체', minimum: 1, maximum: 200, default: 50 },
    },
    ['target', 'service'],
    coverageGap,
  ),
  tool(
    'compare_nearby',
    '시설별 주변 서비스 비교',
    '선택 동의 대상 시설마다 같은 직선 반경 안의 서비스 수록 건수와 최근접 거리를 비교합니다. 학교 주변 그늘막 200m 비교는 target=학교, service=그늘막, radiusM=200입니다. 대상은 dong으로 좁히되 서비스는 이웃 동도 포함합니다. 시설 수준·안전·설치 우선순위 판정이 아닙니다.',
    {
      target: { type: 'string', description: `비교의 기준 대상 시설. ${CATEGORY_HELP}` },
      service: { type: 'string', description: `대상 주변에서 셀 서비스 시설. ${CATEGORY_HELP}` },
      dong: { type: 'string', description: `대상을 이 동으로 좁힘. ${DONG_HELP}` },
      radiusM: { type: 'number', description: '각 대상 주변의 직선 반경(m), 기본 150', minimum: 10, maximum: 3000, default: 150 },
      limit: { type: 'integer', description: '비교표의 최대 대상 수. 집계는 전체 대상 기준.', minimum: 1, maximum: 200, default: 50 },
    },
    ['target', 'service'],
    compareNearby,
  ),
  tool(
    'compare_dongs',
    '동별 비교표',
    '선택한 분류들의 수록 지점 수를 18개 행정동별 표로 돌려줍니다. perKm2 를 켜면 ㎢당 밀도도 계산합니다. "동별 그늘막 수 비교", "어느 동에 버스정류장이 많아?" 같은 질문에 사용합니다. 자료 수록 정도의 차이가 섞여 있으므로 순위를 시설 수준 평가로 쓰면 안 됩니다.',
    {
      categories: { type: 'array', description: `비교할 분류 1~8개. ${CATEGORY_HELP}`, items: { type: 'string' }, minItems: 1, maxItems: 8 },
      perKm2: { type: 'boolean', description: '㎢당 밀도도 계산(기본 false)', default: false },
      dongs: { type: 'array', description: '일부 동만 비교할 때의 동 이름 목록(생략하면 전체)', items: { type: 'string' } },
      sortBy: { type: 'string', description: '정렬 기준 분류(생략하면 첫 번째 분류). 많은 순으로 정렬' },
    },
    ['categories'],
    compareDongs,
  ),
  tool(
    'flood_history',
    '과거 침수피해 기록',
    '서구청이 공개한 과거 침수피해 기록을 동 또는 기준점 반경으로 찾아 연도별·피해내용별로 묶어 돌려줍니다. "풍암동 침수 이력", "이 주변 300m 침수 기록" 같은 질문에 사용합니다. 이미 일어난 피해의 이력이며 침수 위험 예측이 아닙니다. 조건을 주지 않으면 서구 전체를 동별로 집계합니다.',
    {
      dong: { type: 'string', description: DONG_HELP },
      place: { type: 'string', description: PLACE_HELP },
      lon: LON,
      lat: LAT,
      radiusM: { type: 'number', description: '기준점 반경(m). 기본 300', minimum: 10, maximum: 5000, default: 300 },
      yearFrom: { type: 'integer', description: '이 연도 이후 기록만', minimum: 1900, maximum: 2100 },
      yearTo: { type: 'integer', description: '이 연도 이전 기록만', minimum: 1900, maximum: 2100 },
      limit: { type: 'integer', description: '목록으로 돌려줄 최대 건수(기본 30). 연도별 집계는 항상 전체', minimum: 1, maximum: 200, default: 30 },
    },
    [],
    floodHistory,
  ),
  tool(
    'sun_position',
    '태양 고도·방위',
    '한국시간 일시와 위치에서 태양의 고도와 방위각을 계산합니다. heightM 을 주면 평지 위 수직 물체의 그림자 길이·방향도 계산합니다. "8월 1일 오후 2시 풍암동 해는 어느 쪽?", "3m 그늘막 그림자 길이" 같은 질문에 사용합니다. 실제 건물·나무 그늘 여부는 판정하지 않습니다.',
    {
      datetime: { type: 'string', description: "한국시간(KST) 일시 'YYYY-MM-DDTHH:mm'. 예: '2026-08-01T14:00'" },
      dong: { type: 'string', description: `이 동의 대표점에서 계산. ${DONG_HELP}` },
      place: { type: 'string', description: PLACE_HELP },
      lon: LON,
      lat: LAT,
      heightM: { type: 'number', description: '그림자 길이를 계산할 수직 물체 높이(m)', minimum: 0.5, maximum: 600 },
    },
    ['datetime'],
    sunPosition,
  ),
];

/** MCP·웹 패널에 그대로 노출하는 도구 정의(실행 함수는 빼고). */
export const TOOLS = REGISTRY.map(({ run, ...definition }) => definition);

/**
 * 도구 실행. 알 수 없는 도구·잘못된 입력은 SpatialError 를 던진다.
 * @param {string} name TOOLS 의 name
 * @param {object} args inputSchema 에 맞는 인자
 * @param {{dataDir?: string}} ctx 자료 폴더를 바꿀 때만 사용
 */
export async function callTool(name, args, ctx = {}) {
  const entry = REGISTRY.find(item => item.name === name);
  if (!entry) {
    throw new SpatialError('UNKNOWN_TOOL', `'${name}' 도구는 없습니다. 사용할 수 있는 도구: ${REGISTRY.map(t => t.name).join(', ')}`);
  }
  const input = args ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new SpatialError('INVALID_ARGUMENT', '도구 인자는 객체여야 합니다.');
  }
  for (const key of entry.inputSchema.required) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      throw new SpatialError('INVALID_ARGUMENT', `${key} 값이 필요합니다.`);
    }
  }
  const store = getStore(ctx.dataDir);
  const result = entry.run(store, input);
  // map 이 없는 결과도 같은 모양(키 6개)을 유지한다.
  return {
    ok: result.ok,
    summary: result.summary,
    data: result.data,
    map: result.map ?? null,
    sources: result.sources,
    caveats: result.caveats,
  };
}

// findDong 은 /api/ask 쪽에서 동 이름 판별에 쓸 수 있도록 다시 내보낸다.
export { findDong };
