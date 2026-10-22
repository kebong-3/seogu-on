/** 사람이 쓰는 말(동 이름, 시설 이름, 분류 이름)을 자료의 식별자·좌표로 바꾼다. */
import { SpatialError } from './errors.js';

/** 띄어쓰기·대소문자 차이를 무시하고 비교하기 위한 정규화. */
export const norm = value => String(value ?? '').toLowerCase().replace(/[\s·.,()\-_/]+/g, '');

/**
 * 자주 쓰는 한국어 표현 → 자료 id 후보(앞쪽 우선).
 * 후보 중 실제로 파일이 있고 연결된 자료를 먼저 고른다.
 */
const ALIASES = [
  [['그늘막', '그늘', '그늘막쉼터', 'shade'], ['local-shade', 'official-shade-shelter', 'shade-structures']],
  [['버스', '버스정류장', '버스정류소', '정류장', '정류소', 'busstop'], ['bus']],
  [['침수', '침수이력', '침수기록', '침수피해', 'flood'], ['local-flood-history']],
  [['쿨링포그', 'cooling'], ['local-cooling']],
  [['공원', 'park', 'parks'], ['layer-parks', 'park-areas']],
  [['도서관', 'libraries'], ['layer-libraries', 'library']],
  [['주차장'], ['layer-parking', 'parking']],
  [['학교'], ['school']],
  [['병원', '의원', '의료', '의료기관'], ['medical']],
  [['어린이집'], ['childcare', 'childcare-official']],
  [['유치원'], ['kindergarten']],
  [['놀이터'], ['playground']],
  [['화장실', '공중화장실'], ['official-toilet', 'toilet']],
  [['경찰', '경찰서', '지구대', '파출소'], ['police']],
  [['소방', '소방서'], ['fire']],
  [['우체국'], ['post']],
  [['지하철', '지하철역', '역', '도시철도'], ['rail']],
  [['행정복지센터', '주민센터', '동사무소'], ['civic']],
  [['대피소', '대피장소', '지진대피', '지진대피장소'], ['official-earthquake-shelter', 'layer-shelter-schools']],
  [['한파쉼터'], ['official-cold-shelter', 'cold']],
  [['무더위쉼터', '폭염쉼터'], ['official-heat-shelter']],
  [['cctv', '씨씨티비', '방범카메라'], ['official-cctv']],
  [['비상벨', '안전비상벨'], ['official-emergency-bell']],
  [['보안등'], ['official-security-light']],
  [['전통시장', '시장'], ['official-traditional-market']],
  [['어린이보호구역', '스쿨존'], ['official-child-protection-zone']],
  [['노인보호구역', '장애인보호구역', '노인장애인보호구역'], ['official-senior-disabled-protection-zone']],
  [['무인민원발급기', '민원발급기'], ['official-civil-kiosk']],
  [['버스도착안내단말기', '버스정보단말기', 'bit'], ['official-bus-info-terminal']],
  [['제설함'], ['grit']],
  [['결빙', '상습결빙구간', '결빙구간', '결빙관리지점', '블랙아이스'], ['local-icing']],
  [['전기차', '충전소', '전기차충전소'], ['ev']],
  [['체육시설', '체육'], ['sports']],
  [['약국'], ['pharmacy']],
  [['복지', '복지시설', '복지관'], ['welfare', 'welfare-official']],
  [['공공시설', '공공공간', '개방시설', '개방공간', '회의실', '강당', '대관', '주민모임', '주민회의', 'public-facilities'], ['layer-public-facilities']],
];

function pickExisting(store, candidates) {
  const existing = candidates.filter(id => store.has(id) && store.dataset(id).queryable);
  return existing.find(id => store.dataset(id).connected) || existing[0] || null;
}

/** 분류 이름·id → 자료. 못 찾으면 쓸 수 있는 id 목록을 알려주며 실패한다. */
export function resolveCategory(store, input, label = 'category') {
  if (typeof input !== 'string' || !input.trim()) {
    throw new SpatialError('INVALID_ARGUMENT', `${label} 값이 필요합니다. list_datasets 로 쓸 수 있는 분류를 확인하세요.`);
  }
  const key = norm(input);
  const queryable = store.catalog().filter(entry => entry.queryable);

  const direct = queryable.find(entry => norm(entry.id) === key);
  if (direct) return store.dataset(direct.id);

  for (const [words, candidates] of ALIASES) {
    if (!words.includes(key)) continue;
    const id = pickExisting(store, candidates);
    if (id) return store.dataset(id);
  }

  // 마지막으로 제목 비교(파일을 열어야 하므로 가장 나중에 한다).
  const datasets = queryable.map(entry => store.dataset(entry.id));
  const byTitle = datasets.filter(d => norm(d.title) === key)
    .concat(datasets.filter(d => norm(d.title).includes(key) || key.includes(norm(d.title))));
  const match = byTitle.find(d => d.connected) || byTitle[0];
  if (match) return match;

  throw new SpatialError(
    'UNKNOWN_CATEGORY',
    `'${input}' 분류를 찾지 못했습니다. 사용할 수 있는 분류: ${queryable.map(e => e.id).join(', ')}`,
  );
}

/** 동 이름("풍암동", "풍암") 또는 dongId("seogu-17") → 동. */
export function findDong(store, input) {
  const key = norm(input);
  if (!key) return null;
  return store.dongs.find(d => norm(d.id) === key)
    || store.dongs.find(d => norm(d.name) === key)
    || store.dongs.find(d => norm(d.name) === `${key}동`)
    || null;
}

export function resolveDong(store, input) {
  const dong = typeof input === 'string' ? findDong(store, input) : null;
  if (!dong) {
    throw new SpatialError(
      'DONG_NOT_FOUND',
      `'${input}' 행정동을 찾지 못했습니다. 서구 행정동: ${store.dongs.map(d => d.name).join(', ')}`,
    );
  }
  return dong;
}

function score(text, key) {
  if (!text) return 0;
  if (text === key) return 3;
  if (text.startsWith(key)) return 2;
  if (text.includes(key)) return 1;
  return 0;
}

/**
 * 이름 조각으로 동·시설을 찾는다. 동 이름이 정확히 맞으면 맨 앞에 둔다.
 * 반환: [{type:'dong'|'facility', name, lon, lat, dongId, dongName, category?, id?, address?}]
 */
export function searchPlaces(store, query, { limit = 5, category = null } = {}) {
  const key = norm(query);
  if (!key) return [];
  const matches = [];

  if (!category) {
    const exact = findDong(store, query);
    for (const dong of store.dongs) {
      const hit = dong === exact ? 4 : score(norm(dong.name), key);
      if (!hit) continue;
      matches.push({
        rank: hit + 0.5,
        place: {
          type: 'dong', name: dong.name, lon: dong.labelPoint[0], lat: dong.labelPoint[1],
          dongId: dong.id, dongName: dong.name,
        },
      });
    }
  }

  const datasets = category ? [category] : store.queryableDatasets();
  for (const dataset of datasets) {
    for (const site of dataset.sites) {
      const hit = Math.max(score(norm(site.name), key), score(norm(site.address), key) ? 0.5 : 0);
      if (!hit) continue;
      matches.push({
        rank: hit,
        place: {
          type: 'facility', id: site.id, name: site.name, category: dataset.id, categoryTitle: dataset.title,
          lon: site.lon, lat: site.lat, dongId: site.dongId, dongName: site.dongName,
          ...(site.address ? { address: site.address } : {}),
        },
      });
    }
  }

  // 같은 점수면 이름이 짧은(질의에 더 가까운) 것을 앞에 둔다.
  matches.sort((a, b) => b.rank - a.rank || a.place.name.length - b.place.name.length);
  return matches.slice(0, limit).map(m => m.place);
}

/** 서구 주변 좌표인지(행정동 자료가 다루는 범위 근처) 확인한다. */
function checkLonLat(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new SpatialError('INVALID_ARGUMENT', 'lon(경도)과 lat(위도)는 숫자로 함께 입력해야 합니다.');
  }
  if (lon < 126.7 || lon > 127.05 || lat < 34.98 || lat > 35.35) {
    throw new SpatialError('OUT_OF_AREA', '광주 서구 주변 좌표만 지원합니다(경도 126.70~127.05, 위도 34.98~35.35). 경도·위도 순서를 확인하세요.');
  }
}

/**
 * 기준점 해석: lon/lat → place(이름) 순. 둘 다 없으면 null.
 * 반환: {lon, lat, label, dongId, dongName, via, alternatives?}
 */
export function resolveOrigin(store, args) {
  if (args.lon !== undefined || args.lat !== undefined) {
    const lon = Number(args.lon);
    const lat = Number(args.lat);
    checkLonLat(lon, lat);
    const dong = store.dongAt([lon, lat]);
    return {
      lon, lat, label: `좌표(${lon.toFixed(5)}, ${lat.toFixed(5)})`,
      dongId: dong?.id ?? null, dongName: dong?.name ?? null, via: 'coordinates',
    };
  }
  if (args.place === undefined || args.place === null || args.place === '') return null;
  if (typeof args.place !== 'string') {
    throw new SpatialError('INVALID_ARGUMENT', 'place 는 동 이름이나 시설 이름 문자열이어야 합니다.');
  }
  const found = searchPlaces(store, args.place, { limit: 4 });
  if (!found.length) {
    throw new SpatialError('PLACE_NOT_FOUND', `'${args.place}' 에 해당하는 동·시설을 수록 자료에서 찾지 못했습니다. lon/lat 좌표를 직접 주거나 locate 로 이름을 확인하세요.`);
  }
  const [best, ...rest] = found;
  return {
    lon: best.lon, lat: best.lat,
    label: best.type === 'dong' ? `${best.name} 대표점` : best.name,
    dongId: best.dongId, dongName: best.dongName,
    via: best.type,
    alternatives: rest.map(p => p.name),
  };
}
