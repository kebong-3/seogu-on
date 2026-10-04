/**
 * public/data 아래 GeoJSON 을 찾아 읽고, 질의하기 쉬운 "지점(site)" 목록으로 정규화한다.
 * - 자료 목록은 파일에서 발견한다(건수·파일명을 코드에 고정하지 않는다).
 * - 파일은 처음 필요할 때 한 번만 읽고 모듈 범위에 캐시한다.
 * - 네트워크 호출은 없다.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpatialError } from './errors.js';
import { areaM2, bounds, contains, inBounds, isPolygonal, representativePoint } from './geo.js';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url));

/** 자료를 찾는 폴더. 새 파일이 추가되면 자동으로 목록에 들어온다. */
const GROUPS = [
  { dir: 'city/infra', prefix: '', queryable: true },
  { dir: 'city', prefix: '', queryable: true },
  { dir: 'layers', prefix: 'layer-', queryable: true },
  // 건물·도로망은 시설 목록이 아니므로 목록에는 보이되 시설 질의 대상은 아니다.
  { dir: 'city/model', prefix: '', queryable: false },
];

/** 파일에 제목이 없을 때 쓰는 한글 이름. 없는 id 는 출처명 → id 순으로 대체한다. */
const FALLBACK_TITLES = {
  'local-shade': '그늘막(서구청 공개자료)',
  'local-cooling': '쿨링포그(서구청 공개자료)',
  'local-flood-history': '과거 침수피해 기록(서구청 공개자료)',
  'park-areas': '공원 구역(OSM 면 도형)',
  buildings: '건물(OSM 일부)',
  network: '도로·하천(OSM 일부)',
  cold: '한파쉼터',
  grit: '제설함',
  'snow-routes': '제설노선',
  'snow-priority': '제설 우선구간',
  'shade-structures': '그늘막(검수자료)',
  'childcare-official': '어린이집(공식자료)',
  'welfare-official': '복지시설(공식자료)',
};

const stores = new Map();

/** dataDir 별로 하나의 저장소를 재사용한다(테스트는 fixture 폴더를 넘긴다). */
export function getStore(dataDir = DEFAULT_DATA_DIR) {
  let store = stores.get(dataDir);
  if (!store) {
    store = new Store(dataDir);
    stores.set(dataDir, store);
  }
  return store;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

const dateOnly = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/** 자료의 기준일. 기준일이 없으면 수집일을 쓰고 어떤 날짜인지 함께 알려준다. */
function sourceDateOf(meta) {
  const stated = dateOnly(meta.sourceDate) || dateOnly(meta.sourceDateRange?.at?.(-1));
  if (stated) return { date: stated, dateBasis: '자료 기준일' };
  const collected = dateOnly(meta.snapshotAt) || dateOnly(meta.sourceTimestamp)
    || dateOnly(meta.retrievedAt) || dateOnly(meta.collectedAt);
  if (collected) return { date: collected, dateBasis: '수집일(기준일 미제공)' };
  return { date: null, dateBasis: '날짜 미제공' };
}

function sourceUrlOf(meta) {
  if (typeof meta.sourceUrl === 'string') return meta.sourceUrl;
  if (/OpenStreetMap|OSM/i.test(meta.sourceName || '')) return 'https://www.openstreetmap.org/copyright';
  return undefined;
}

/** 자료가 스스로 밝힌 수록 범위. 없으면 원자료 행 수나 일반 문구로 대신한다. */
function coverageNoteOf(meta) {
  if (typeof meta.coverage === 'string' && meta.coverage.trim()) return meta.coverage.trim();
  if (Number.isFinite(meta.sourceRows) && Number.isFinite(meta.accepted)) {
    return `공개 원자료 ${meta.sourceRows}행 중 좌표가 확인된 ${meta.accepted}행만 수록 · 기준일 이후 변동과 현장 상태 미확인`;
  }
  return '부분 자료 · 전수조사 아님';
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.datasets = new Map();
    this.loadDongs();
  }

  loadDongs() {
    const path = join(this.dataDir, 'admin-dongs.geojson');
    if (!existsSync(path)) {
      throw new SpatialError('DATA_UNAVAILABLE', '행정동 경계 자료를 읽지 못했습니다.');
    }
    const raw = readJson(path);
    this.dongMeta = raw.metadata || {};
    this.dongs = raw.features.map(feature => {
      const props = feature.properties || {};
      const label = Array.isArray(props.labelPoint) ? props.labelPoint.slice(0, 2) : representativePoint(feature.geometry);
      return {
        id: String(props.dongId),
        name: String(props.dongName),
        geometry: feature.geometry,
        bounds: bounds(feature.geometry),
        labelPoint: label,
        areaKm2: areaM2(feature.geometry) / 1e6,
      };
    });
    this.dongSource = {
      name: this.dongMeta.sourceName || '행정동 경계',
      date: dateOnly(this.dongMeta.sourceDate),
      url: this.dongMeta.sourceUrl,
    };
  }

  /** 점이 속한 행정동. 경계 밖이면 null (가까운 동으로 억지 배정하지 않는다). */
  dongAt(point) {
    for (const dong of this.dongs) {
      if (inBounds(point, dong.bounds) && contains(dong.geometry, point)) return dong;
    }
    return null;
  }

  /** 18개 동 전체를 감싸는 사각형의 중심. */
  districtCentre() {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const dong of this.dongs) {
      box[0] = Math.min(box[0], dong.bounds[0]);
      box[1] = Math.min(box[1], dong.bounds[1]);
      box[2] = Math.max(box[2], dong.bounds[2]);
      box[3] = Math.max(box[3], dong.bounds[3]);
    }
    return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  }

  /** 파일을 열지 않고 만드는 자료 목록: [{id, path, queryable, group}] */
  catalog() {
    if (this.catalogCache) return this.catalogCache;
    const seen = new Set();
    const entries = [];
    for (const group of [...GROUPS, ...this.extraGroups()]) {
      const dir = join(this.dataDir, group.dir);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.geojson') && !entry.name.includes('template'))
        .map(entry => entry.name)
        .sort();
      for (const file of files) {
        let id = group.prefix + file.replace(/\.geojson$/, '');
        if (seen.has(id)) id = `${group.dir.split('/').at(-1)}-${id}`;
        seen.add(id);
        entries.push({ id, path: join(dir, file), relPath: `${group.dir}/${file}`, queryable: group.queryable, group: group.dir });
      }
    }
    this.catalogCache = entries;
    return entries;
  }

  /** city/ 아래에 새로 생긴 폴더(예: city/official)도 '<폴더명>-' 접두어로 자동 수록한다. */
  extraGroups() {
    const cityDir = join(this.dataDir, 'city');
    if (!existsSync(cityDir)) return [];
    const known = new Set(['infra', 'model', 'templates']);
    return readdirSync(cityDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !known.has(entry.name) && !entry.name.includes('template'))
      .map(entry => entry.name)
      .sort()
      .map(name => ({ dir: `city/${name}`, prefix: `${name}-`, queryable: true }));
  }

  /** coverage.json·source-catalog.json 에 적힌 사람이 읽는 제목. */
  titles() {
    if (this.titleCache) return this.titleCache;
    const titles = new Map();
    const coverage = readJsonIfExists(join(this.dataDir, 'city/coverage.json'));
    for (const [id, row] of Object.entries(coverage?.infrastructure || {})) {
      if (row?.title) titles.set(id, String(row.title));
    }
    const sourceCatalog = readJsonIfExists(join(this.dataDir, 'source-catalog.json'));
    for (const source of sourceCatalog?.sources || []) {
      if (source?.id && source?.name) titles.set(`layer-${source.id}`, `${source.name}(표준데이터)`);
    }
    this.titleCache = titles;
    return titles;
  }

  has(id) {
    return this.catalog().some(entry => entry.id === id);
  }

  /** 정규화된 자료 한 건. 처음 호출할 때만 파일을 읽는다. */
  dataset(id) {
    if (this.datasets.has(id)) return this.datasets.get(id);
    const entry = this.catalog().find(item => item.id === id);
    if (!entry) throw new SpatialError('UNKNOWN_CATEGORY', `'${id}' 자료를 찾지 못했습니다.`);
    const dataset = this.normalise(entry, readJson(entry.path));
    this.datasets.set(id, dataset);
    return dataset;
  }

  allDatasets() {
    return this.catalog().map(entry => this.dataset(entry.id));
  }

  queryableDatasets() {
    return this.catalog().filter(entry => entry.queryable).map(entry => this.dataset(entry.id));
  }

  normalise(entry, raw) {
    const meta = raw.metadata || {};
    const features = Array.isArray(raw.features) ? raw.features : [];
    const title = this.titles().get(entry.id) || meta.title || FALLBACK_TITLES[entry.id]
      || meta.sourceName || meta.expectedSourceName || entry.id;

    // 0건은 "없음"이 아니라 "수집되지 않음"이다. 두 경우 모두 미연결로 취급한다.
    let state = 'partial';
    if (meta.state === 'not-connected') state = 'not-connected';
    else if (features.length === 0) state = 'no-features';

    const dataset = {
      id: entry.id,
      title,
      file: entry.relPath,
      queryable: entry.queryable,
      state,
      connected: state === 'partial',
      meta,
      rawFeatureCount: features.length,
      pointFeatures: features.filter(f => f.geometry?.type === 'Point').length,
      areaFeatures: features.filter(f => isPolygonal(f.geometry)).length,
      coverageNote: coverageNoteOf(meta),
      source: { name: meta.sourceName || title, ...sourceDateOf(meta), url: sourceUrlOf(meta) },
      sites: [],
      mergedAreas: 0,
    };
    if (entry.queryable && dataset.connected) this.buildSites(dataset, features);
    return dataset;
  }

  /**
   * 같은 시설이 "대표위치 점"과 "부지 면"으로 따로 실려 있는 자료가 있다.
   * 면 안에 같은 자료의 점이 있거나 면이 그 점의 id 를 짝으로 적어 둔 경우 면을 버리고 점만 센다.
   * 이름이 다른 중복까지는 잡지 못하므로 결과는 여전히 "수록 지점 수"이지 시설 수가 아니다.
   */
  buildSites(dataset, features) {
    const points = [];
    const others = [];
    for (const feature of features) {
      if (!feature?.geometry) continue;
      (feature.geometry.type === 'Point' ? points : others).push(feature);
    }
    const pointIds = new Set(points.map(f => String(f.properties?.id ?? f.id ?? '')));
    const pointCoords = points.map(f => f.geometry.coordinates);

    points.forEach((feature, index) => this.addSite(dataset, feature, feature.geometry.coordinates.slice(0, 2), index));
    others.forEach((feature, index) => {
      if (this.duplicatesPoint(feature, pointIds, pointCoords)) {
        dataset.mergedAreas++;
        return;
      }
      const labelPoint = feature.properties?.labelPoint;
      const point = Array.isArray(labelPoint) && contains(feature.geometry, labelPoint)
        ? labelPoint.slice(0, 2)
        : representativePoint(feature.geometry);
      if (point) this.addSite(dataset, feature, point, points.length + index);
    });
  }

  duplicatesPoint(feature, pointIds, pointCoords) {
    if (!isPolygonal(feature.geometry)) return false;
    const paired = feature.properties?.pairedOfficialIds;
    if (Array.isArray(paired) && paired.some(id => pointIds.has(String(id)))) return true;
    if (!pointCoords.length) return false;
    const box = bounds(feature.geometry);
    return pointCoords.some(p => inBounds(p, box) && contains(feature.geometry, p));
  }

  addSite(dataset, feature, point, index) {
    if (!point.every(Number.isFinite)) return;
    const props = feature.properties || {};
    const original = props.originalAttributes || {};
    const dong = this.dongAt(point);
    const year = Number(props.eventYear ?? original['발생연도']);
    dataset.sites.push({
      id: String(props.id ?? feature.id ?? `${dataset.id}-${index + 1}`),
      name: String(props.name || '명칭 없음').slice(0, 120),
      category: dataset.id,
      lon: point[0],
      lat: point[1],
      dongId: dong?.id ?? null,
      dongName: dong?.name ?? null,
      address: String(props.address || '').slice(0, 160),
      kind: String(props.facilityType || props.schoolType || props.categoryName || original['피해내용'] || '').slice(0, 60),
      year: Number.isInteger(year) && year > 1900 ? year : null,
      shape: feature.geometry.type === 'Point' ? 'point' : 'area',
    });
  }

  /** 동 명칭 대조표(행정복지센터 위치 등). 통계 지표가 아니다. */
  civicIndex() {
    if (this.civicCache === undefined) {
      this.civicCache = readJsonIfExists(join(this.dataDir, 'city/civic-index.json'));
    }
    return this.civicCache;
  }
}
