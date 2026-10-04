/**
 * 에어코리아(한국환경공단) 대기질 조회.
 *  1) 측정소 목록  MsrstnInfoInqireSvc/getMsrstnList      (data.go.kr '에어코리아 측정소정보')
 *  2) 측정소 실시간 ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty ('에어코리아 대기오염정보')
 * 두 API는 공공데이터포털에서 각각 활용신청해야 한다. 어느 단계에서 실패했는지 stage로 알려 준다.
 *
 * 정직성 원칙: 서구 경계 안에서 실제로 조회된 측정소의 값만 쓴다. 결측·점검 플래그는 null(미관측)로 둔다.
 */
import {HttpError,json,endpoint,records,totalOf,cleanPoint,text,n,scopeFor} from './common.js';
import {fc} from '../../src/city/geometry.js';
import {classifyUpstream,diagnostic,isKeyFailure,keyCandidates} from './upstream-codes.js';

const BASE = 'https://apis.data.go.kr/B552584';
const TIMEOUT_MS = 7000;
const STATION_TTL_MS = 6 * 3600 * 1000; // 측정소 위치는 자주 바뀌지 않는다.
const LABEL = {'station-list': '에어코리아 측정소정보:', measurement: '에어코리아 대기오염정보:'};

/** 전송 수단(fetcher)별 측정소 목록 보관. 테스트의 가짜 fetcher끼리 섞이지 않는다. */
const stationCache = new WeakMap();

export function airKeys(env = process.env) {
  // 공공데이터포털 키는 계정당 하나이므로 기상청용으로 넣은 키도 마지막 후보로 시도한다.
  return keyCandidates(env.AIRKOREA_SERVICE_KEY, env.DATA_GO_KR_SERVICE_KEY, env.KMA_SERVICE_KEY);
}

async function airRequest(stage, path, params, {env, fetcher}) {
  const context = {stage, label: LABEL[stage]};
  const keys = airKeys(env);
  if (!keys.length) throw diagnostic('NOT_CONFIGURED', {...context, detail: 'AIRKOREA_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY를 확인하세요.'});
  let last;
  for (const [index, key] of keys.entries()) {
    try {
      const body = await json(endpoint(`${BASE}/${path}`, {...params, serviceKey: key}), {fetcher, timeout: TIMEOUT_MS});
      records(body); // 결과코드·항목 배열 확인
      return body;
    } catch (error) {
      last = classifyUpstream(error, context);
      console.warn('[air]', stage, index === 0 ? 'primary' : 'fallback', last.code);
      if (!isKeyFailure(last)) break; // 시간 초과·형식 오류는 다른 키로 바꿔도 같으므로 바로 끝낸다.
    }
  }
  throw last;
}

/** dmX=위도, dmY=경도. 혹시 뒤바뀐 응답이 와도 한국 범위에 맞는 쪽을 고른다. */
function stationLonLat(item) {
  const a = n(item.dmX), b = n(item.dmY);
  if (a === null || b === null) return [null, null];
  const koreaLon = v => v > 123 && v < 133, koreaLat = v => v > 32 && v < 39.5;
  if (koreaLon(b) && koreaLat(a)) return [b, a];
  if (koreaLon(a) && koreaLat(b)) return [a, b];
  return [null, null];
}

async function stationList({env, fetcher}) {
  const region = env.AIRKOREA_REGION_QUERY || '광주';
  const perFetcher = stationCache.get(fetcher) || new Map();
  stationCache.set(fetcher, perFetcher);
  const cached = perFetcher.get(region);
  if (cached && Date.now() - cached.at < STATION_TTL_MS) return {...cached, stale: false};
  try {
    const body = await airRequest('station-list', 'MsrstnInfoInqireSvc/getMsrstnList', {returnType: 'json', numOfRows: 100, pageNo: 1, addr: region}, {env, fetcher});
    const fresh = {at: Date.now(), items: records(body), total: totalOf(body)};
    perFetcher.set(region, fresh);
    return {...fresh, stale: false};
  } catch (error) {
    // 목록 갱신에 실패해도 이전에 실제로 받은 목록이 있으면 그 측정소 위치를 계속 쓴다(값이 아니라 위치 정보).
    if (cached) return {...cached, stale: true};
    throw error;
  }
}

/** kind=air-stations */
export async function readAirStations(q, {env = process.env, fetcher = fetch} = {}) {
  const scope = scopeFor(q.get('dong'));
  const sourceName = '한국환경공단 에어코리아 측정소정보';
  const list = await stationList({env, fetcher});
  const collectedAt = new Date(list.at).toISOString();
  const features = list.items.map((item, i) => {
    const [lon, lat] = stationLonLat(item);
    return cleanPoint(`air-${item.stationName || i}`, item.stationName, lon, lat, {
      sourceName, sourceDate: null, collectedAt, category: 'air',
      stationName: text(item.stationName), address: text(item.addr),
      note: 'dmX=위도, dmY=경도 · 명시된 측정소의 관측자료만 표시'
    }, scope);
  }).filter(Boolean);
  const complete = list.total === null ? list.items.length < 100 : list.total <= 100;
  const empty = features.length === 0;
  return {
    ok: true, kind: 'air-stations', page: 1, totalScanned: list.items.length, totalCount: list.total, complete, nextPage: null,
    sourceName, sourceDate: null, collectedAt,
    note: empty ? `목록 ${list.items.length}개 중 선택 구역 경계 안의 측정소가 없습니다. 다른 지역 측정소로 대체하지 않습니다.` : '',
    ...(empty ? {code: 'NO_STATION'} : {}),
    ...(list.stale ? {stationListStale: true} : {}),
    geojson: fc(features)
  };
}

/** kind=air&station=측정소명 */
export async function readAir(q, {env = process.env, fetcher = fetch} = {}) {
  const station = text(q.get('station'), 80);
  if (!station) throw new HttpError(400, '측정소를 선택하세요.');
  const check = await readAirStations(new URLSearchParams(), {env, fetcher});
  if (!check.geojson.features.some(f => f.properties.stationName === station)) throw new HttpError(400, '서구 경계 내 실제 조회된 측정소만 선택할 수 있습니다.');

  const body = await airRequest('measurement', 'ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty', {returnType: 'json', numOfRows: 24, pageNo: 1, stationName: station, dataTerm: 'DAILY', ver: '1.3'}, {env, fetcher});
  // dataTime은 한국시간 'YYYY-MM-DD HH:mm' 문자열이므로 문자열 정렬이 곧 시간순이다.
  const latest = records(body).filter(item => item?.dataTime).sort((a, b) => String(b.dataTime).localeCompare(String(a.dataTime)))[0];
  if (!latest) throw diagnostic('NO_DATA', {stage: 'measurement', label: LABEL.measurement});

  const value = name => {
    if (latest[`${name}Flag`]) return null; // 점검·통신장애 등 플래그가 있으면 미관측
    const number = n(latest[`${name}Value`]);
    return number !== null && number >= 0 ? number : null;
  };
  return {
    ok: true, kind: 'air', station,
    observedAt: text(latest.dataTime, 20), observedTimeZone: 'KST',
    pm10: value('pm10'), pm25: value('pm25'),
    pm10Flag: latest.pm10Flag || null, pm25Flag: latest.pm25Flag || null,
    sourceName: '한국환경공단 에어코리아',
    note: '선택한 측정소 자료입니다. 다른 위치/동 전체의 농도로 대체할 수 없습니다.',
    collectedAt: new Date().toISOString()
  };
}
