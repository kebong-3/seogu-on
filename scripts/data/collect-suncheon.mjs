/**
 * Suncheon public-data package. No API key; no inferred facility coordinates or
 * operating observations. Run with --source-dir for a saved public download, or
 * --fetch to obtain the same public files used by data.go.kr's download button.
 */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {pointInRegion, pointInBounds, validateRegionDataPack} from '../../shared/region-profile.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'public/data/regions/suncheon');
const BOUNDARY_URL = 'https://raw.githubusercontent.com/vuski/admdongkor/master/ver20260701/HangJeongDong_ver20260701.geojson';
const FACILITY_URL = 'https://www.data.go.kr/data/15013117/standard.do';
const COLUMN_URL = 'https://www.data.go.kr/download/columList.json?pk=15013117&ext=JSON';
const DETAIL_ID = 'uddi:dddbf61e-81b3-4044-a9a4-b5e961df2f4d';
const sha = value => createHash('sha256').update(value).digest('hex');
const check = (condition, message) => {if (!condition) throw Error(message);};
const json = value => JSON.stringify(value, null, 2) + '\n';
const text = value => String(value ?? '').trim();
const unique = values => [...new Set(values)];
const inside = (point, feature) => pointInRegion(point, {features: [feature]});

function geometryBounds(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(value) {
    if (value.length === 2 && value.every(Number.isFinite)) {
      b[0] = Math.min(b[0], value[0]); b[1] = Math.min(b[1], value[1]);
      b[2] = Math.max(b[2], value[0]); b[3] = Math.max(b[3], value[1]);
    } else value.forEach(visit);
  }
  visit(geometry.coordinates);
  return b;
}

/** A cartographic label, computed from the original polygon; never a facility location. */
function interiorLabel(feature) {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let best = null;
  for (const rings of polygons) {
    const bounds = geometryBounds({coordinates: rings});
    // Scan at several non-edge ordinates and choose an interior interval midpoint.
    for (const ratio of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const y = bounds[1] + (bounds[3] - bounds[1]) * ratio;
      const xs = [];
      for (const ring of rings) for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        const point = [(xs[i - 1] + xs[i]) / 2, y], width = xs[i] - xs[i - 1];
        if (width > 0 && (!best || width > best.width) && inside(point, feature)) best = {point, width};
      }
    }
  }
  check(best, `경계 내부 라벨점을 계산하지 못했습니다: ${feature.properties.adm_nm}`);
  return best.point;
}

// The source exposes no permanent room identifier. Keep a registry for explicit
// reconciliation when a room is renamed or moved; dates/prices/hours never form IDs.
function sourceKey(row) {
  const address = text(row.RDNMADR || row.LNMADR).replace(/^(?:전남광주통합특별시|전라남도)\s*/, '').replace(/\s/g, '');
  return [text(row.INSTT_CODE), text(row.OPEN_FCLTY_NM).replace(/\s/g, ''), address].join('|');
}
function publishedHours(row) {
  const pairs = [
    ['평일', row.WEEKDAY_OPER_OPEN_HHMM, row.WEEKDAY_OPER_COLSE_HHMM],
    ['주말', row.WKEND_OPER_OPEN_HHMM, row.WKEND_OPER_CLOSE_HHMM],
  ].filter(([, start, end]) => text(start) || text(end)).map(([label, start, end]) => `${label} ${text(start) || '미기재'}~${text(end) || '미기재'}`);
  if (text(row.RSTDE)) pairs.push(`휴관 ${text(row.RSTDE)}`);
  return pairs.join(' / ');
}
function point(row) {
  if (!text(row.LONGITUDE) || !text(row.LATITUDE)) return null;
  const p = [Number(row.LONGITUDE), Number(row.LATITUDE)];
  return p.every(Number.isFinite) ? p : null;
}

async function download(url, path, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(60000)});
  check(response.ok, `공개 다운로드 실패 ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  check(bytes.length <= 64 * 1024 * 1024, '수집 상한 64MiB를 초과했습니다.');
  await writeFile(path, bytes);
  return bytes;
}
async function fetchSources(directory) {
  await mkdir(directory, {recursive: true});
  await download(BOUNDARY_URL, resolve(directory, 'national-boundaries.geojson'));
  const header = JSON.parse(await download(COLUMN_URL, resolve(directory, 'facility-columns.json')));
  check(Number.isSafeInteger(header.totalCount) && header.totalCount > 0 && header.totalCount <= 50000, '공개 다운로드 전체 행 수를 확인하세요.');
  const records = [], pageHashes = [];
  for (let page = 1; page <= Math.ceil(header.totalCount / 10000); page++) {
    const q = new URLSearchParams({publicDataPk: '15013117', totalCount: String(header.totalCount), svcTableNm: header.tableVO.svcTableNm, perPage: '10000', page: String(page)});
    for (const key of header.tableVO.colNmList) q.append('colNmList', key);
    const raw = await download(`https://www.data.go.kr/download/standard.json?${q}`, resolve(directory, `national-facilities-page-${page}.json`));
    const rows = JSON.parse(raw); check(Array.isArray(rows), '전국 공공공간 응답이 배열이 아닙니다.');
    records.push(...rows); pageHashes.push(sha(raw));
  }
  check(records.length === header.totalCount, '전국 다운로드 행 수가 안내된 전체 행 수와 다릅니다.');
  await writeFile(resolve(directory, 'national-facilities.json'), json(records));
  await download('https://www.data.go.kr/tcs/dss/selectDpkDetailInfo.do', resolve(directory, 'facility-suncheon-detail.html'), {method: 'POST', body: new URLSearchParams({publicDataDetailPk: DETAIL_ID})});
  await writeFile(resolve(directory, 'download.json'), json({retrievedAt: new Date().toISOString(), sourceUrl: FACILITY_URL, records: records.length, pageHashes}));
}

export async function collectSuncheon({sourceDirectory, retrievedAt} = {}) {
  check(sourceDirectory, '공개 원본이 들어 있는 --source-dir 또는 --fetch 폴더를 지정하세요.');
  const downloadRecord = JSON.parse(await readFile(resolve(sourceDirectory, 'download.json'), 'utf8'));
  retrievedAt ||= downloadRecord.retrievedAt;
  check(Number.isFinite(Date.parse(retrievedAt)), '수집 시각을 ISO 8601 형식으로 입력하세요.');
  const [boundaryBytes, facilityBytes, headerBytes, licenseBytes] = await Promise.all([
    readFile(resolve(sourceDirectory, 'national-boundaries.geojson')),
    readFile(resolve(sourceDirectory, 'national-facilities.json')),
    readFile(resolve(sourceDirectory, 'facility-columns.json')),
    readFile(resolve(sourceDirectory, 'facility-suncheon-detail.html')),
  ]);
  check(licenseBytes.toString().includes('이용허락범위 제한 없음') && licenseBytes.toString().includes('순천'), '순천 제공기관의 공개 이용조건이 변경되었거나 확인되지 않았습니다. 원문을 검토하세요.');
  const originalBoundaries = JSON.parse(boundaryBytes), nationalRows = JSON.parse(facilityBytes), header = JSON.parse(headerBytes);
  check(Array.isArray(nationalRows) && nationalRows.length === header.totalCount, '전국 공공공간 원본과 전체 행 수가 일치하지 않습니다.');
  const features = originalBoundaries.features.filter(f => f.properties.sggnm === '순천시');
  check(features.length === 24, '순천 읍면동 수가 검토한 24개와 다릅니다. 행정구역 변경을 먼저 검토하세요.');
  const codes = unique(features.map(f => f.properties.adm_cd2.slice(0, 5)));
  const fullNames = unique(features.map(f => `${f.properties.sidonm} ${f.properties.sggnm}`));
  check(codes.length === 1 && fullNames.length === 1, '순천 행정코드 또는 행정명 혼합을 확인하세요.');
  const boundaries = {
    type: 'FeatureCollection',
    metadata: {
      sourceName: 'SGIS 행정동 경계 가공: vuski/admdongkor', sourceUrl: BOUNDARY_URL, sourceDate: '2026-07-01', retrievedAt,
      sourceSha256: sha(boundaryBytes), count: features.length, boundaryType: 'administrative-eup-myeon-dong',
      attribution: '통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr) 공공누리 제1유형 행정동 경계 가공: vuski/admdongkor(https://github.com/vuski/admdongkor) · CC BY 4.0',
      license: 'CC-BY-4.0; upstream KOGL Type 1', licenseUrl: 'https://github.com/vuski/admdongkor/blob/master/LICENSE-DATA',
      transformation: 'sggnm=순천시 24개 읍면동 추출. 원본 geometry·행정명·행정코드 변경 없음. 내부 식별자·경계상자·경계 내부 라벨점 추가.',
      reviewStatus: '공개 가공본 · 도형·내부점 검사 / 법적 경계 확정 아님',
    },
    features: features.map(f => ({...f, properties: {...f.properties, dongId: `suncheon-${f.properties.adm_cd2}`, dongName: f.properties.adm_nm.split(' ').at(-1), labelPoint: interiorLabel(f), bounds: geometryBounds(f.geometry)}})),
  };
  const bounds = boundaries.features.reduce((b, f) => [Math.min(b[0], f.properties.bounds[0]), Math.min(b[1], f.properties.bounds[1]), Math.max(b[2], f.properties.bounds[2]), Math.max(b[3], f.properties.bounds[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const textMatches = nationalRows.filter(row => ['RDNMADR', 'LNMADR', 'INSTITUTION_NM', 'INSTT_NM'].some(k => text(row[k]).includes('순천')));
  const acceptedRows = nationalRows.filter(row => {const p = point(row); return p && pointInBounds(p, bounds) && pointInRegion(p, boundaries);});
  const rejectedTextMatches = textMatches.filter(row => !acceptedRows.includes(row));
  const addedByGeometry = acceptedRows.filter(row => !textMatches.includes(row));
  check(acceptedRows.length > 0, '순천 경계 안 공공공간을 수집하지 못했습니다.');
  const groups = new Map();
  for (const row of acceptedRows) {
    const key = sourceKey(row); check(text(row.OPEN_FCLTY_NM), '개방시설명이 없습니다.');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let previousRegistry = {entries: []};
  try {previousRegistry = JSON.parse(await readFile(resolve(OUT, 'identity-registry.json'), 'utf8'));}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  const oldIdentities = new Map(previousRegistry.entries.map(entry => [entry.sourceKey, entry.id]));
  const registry = {version: 1, regionId: 'suncheon', policy: '제공기관코드·공간명·정규화 주소의 최초 해시. 기준일·운영시간·요금 변경은 ID에 미반영. 원자료에 영구 공간 ID가 없어 명칭·주소 변경은 담당자 대조 후 sourceKey를 기존 ID와 연결해야 함.', entries: []};
  const facilityFeatures = [...groups.entries()].map(([key, rows]) => {
    const allPoints = unique(rows.map(row => JSON.stringify(point(row))));
    check(allPoints.length === 1, `동일 명칭·주소에 서로 다른 좌표가 있습니다: ${rows[0].OPEN_FCLTY_NM}`);
    rows.sort((a, b) => text(b.REFERENCE_DATE).localeCompare(text(a.REFERENCE_DATE)));
    const row = rows[0], p = point(row), district = boundaries.features.find(f => inside(p, f));
    check(district, '공간의 읍면동 경계가 없습니다.');
    const id = oldIdentities.get(key) || `suncheon-public:${sha(key).slice(0, 20)}`;
    const hours = unique(rows.map(publishedHours));
    registry.entries.push({sourceKey: key, id, name: text(row.OPEN_FCLTY_NM), address: text(row.RDNMADR || row.LNMADR)});
    return {
      type: 'Feature', properties: {
        id, name: text(row.OPEN_FCLTY_NM), category: 'public', layerId: 'public-facilities',
        sourceName: `전국공공시설개방정보표준데이터 / ${text(row.INSTT_NM)}`, sourceUrl: FACILITY_URL, sourceDate: text(row.REFERENCE_DATE) || null,
        address: text(row.RDNMADR || row.LNMADR), phone: text(row.PHONE_NUMBER), department: text(row.CHRG_DEPT_NM),
        hours: hours.length > 1 ? `공개 원문 조건 ${hours.length}개(담당자 확인 필요): ${hours.join(' ; ')}` : hours[0],
        publishedCapacity: text(row.ACEPTNC_POSBL_CO), publishedArea: text(row.AR), publishedFacilityType: text(row.OPEN_FCLTY_TYPE),
        placeName: text(row.OPEN_LC_NM), homepageUrl: text(row.HOMEPAGE_URL), sourceInstitutionCode: text(row.INSTT_CODE),
        sourceIdentity: {kind: 'derived-registry', key, upstreamPermanentIdAvailable: false},
        sourceRecordCount: rows.length, sourceRecordHashes: rows.map(r => sha(JSON.stringify(r))),
        sourceConditionVariants: rows.map(r => ({hours: publishedHours(r), paidUse: text(r.PCHRG_USE_YN), referenceUseHours: text(r.USE_STDR_TIME), fee: text(r.RNTFEE), extraUseHours: text(r.EXCESS_USE_UNIT_TIME), extraFee: text(r.EXCESS_RNTFEE), sourceDate: text(r.REFERENCE_DATE)})),
        monthly: {}, metricName: '운영량', metricUnit: '건', dataKind: 'official-snapshot', reviewStatus: 'unverified', positionSource: 'source-coordinates',
        note: '공개 개방공간 단위. 같은 장소의 시간·요금별 행은 하나로 묶고 원문 조건을 보존했습니다. 게시 시간·수용인원은 현재 개방·예약 가능·현장 확인 상태가 아닙니다.',
        dongId: district.properties.dongId, dongName: district.properties.dongName,
      }, geometry: {type: 'Point', coordinates: p},
    };
  }).sort((a, b) => a.properties.id.localeCompare(b.properties.id));
  registry.entries.sort((a, b) => a.id.localeCompare(b.id));
  const sourceDates = unique(acceptedRows.map(r => text(r.REFERENCE_DATE)).filter(Boolean)).sort();
  const distinctCoordinates = unique(acceptedRows.map(r => JSON.stringify(point(r)))).length;
  const coveredDistricts = unique(facilityFeatures.map(f => f.properties.dongId)).length;
  const facilities = {type: 'FeatureCollection', metadata: {
    sourceName: '전국공공시설개방정보표준데이터 / 전남광주통합특별시 순천시', sourceUrl: FACILITY_URL,
    sourceDate: sourceDates.length === 1 ? sourceDates[0] : null, sourceDateRange: [sourceDates[0], sourceDates.at(-1)], retrievedAt,
    sourceSha256: sha(facilityBytes), boundaryDate: '2026-07-01', sourceProviderCode: '5790000', providerDetailId: DETAIL_ID,
    license: '공공데이터포털 순천시 제공기관 상세: 이용허락범위 제한 없음',
    licenseSourceUrl: `https://www.data.go.kr/tcs/dss/selectDpkDetailInfo.do?publicDataDetailPk=${DETAIL_ID}`, licenseCheckedOn: retrievedAt.slice(0, 10),
    coverage: `전국 공개 다운로드 ${nationalRows.length}행 전체 좌표 대조. 순천 내부 ${acceptedRows.length}행을 고유 공간 ${facilityFeatures.length}개로 통합. 원문 좌표 ${distinctCoordinates}곳·수록 읍면동 ${coveredDistricts}개. 순천 전체 공공시설 또는 건물 수·현장 운영상태를 뜻하지 않음.`,
    nationwideRowsScanned: nationalRows.length, selectedBeforeGrouping: acceptedRows.length, accepted: facilityFeatures.length,
    groupedExtraRows: acceptedRows.length - facilityFeatures.length, spacesWithMultipleSourceRows: facilityFeatures.filter(f => f.properties.sourceRecordCount > 1).length,
    distinctPublishedCoordinates: distinctCoordinates, coveredDistricts,
    excluded: {textMatchedOutsideOrMissingCoordinates: rejectedTextMatches.length}, addedByGeometryWithoutSuncheonText: addedByGeometry.length,
    transformation: 'WGS84 원좌표 유지. 제공기관코드+공간명+주소로 동일 공간의 시간·요금별 행 통합. 운영시간·수용인원은 원문 참고치로 보존하며 현장확인 기록을 생성하지 않음. 공공 전화번호 외 인명·개인정보 열 수집 안 함.',
  }, features: facilityFeatures};
  const profile = {
    version: 1, id: 'suncheon', name: '순천', fullName: fullNames[0], jurisdictionCode: codes[0], codeSystem: 'MOIS-ADM', timeZone: 'Asia/Seoul', bounds,
    center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2], boundaryUrl: '/data/regions/suncheon/admin-boundaries.geojson',
    facilitiesUrl: '/data/regions/suncheon/facilities.geojson', facilityLayerId: 'public-facilities', districtCount: boundaries.features.length,
    capabilities: {spaceTwin: true, legacySeoguServices: false},
    source: {name: 'SGIS 행정동 경계 가공: vuski/admdongkor + 공공데이터포털 순천시 공개자료', url: BOUNDARY_URL, asOf: '2026-07-01', note: 'adm_cd2 앞 5자리 행정기관코드. 공공데이터 제공기관코드 5790000과 구분. 공공공간 기준일·수록 범위는 시설 메타데이터에 별도 기록.'}, sample: false,
  };
  const report = validateRegionDataPack({profile, boundaries, facilities});
  const audit = {
    ...report, checkedAt: new Date().toISOString(), sourceEvidence: {retrievedAt, boundarySha256: sha(boundaryBytes), facilitiesSha256: sha(facilityBytes), columnsSha256: sha(headerBytes), licensePageSha256: sha(licenseBytes)},
    checks: {nationalRows: nationalRows.length, suncheonTextRows: textMatches.length, insideRows: acceptedRows.length, rejectedTextMatches: rejectedTextMatches.length, addedOnlyByGeometry: addedByGeometry.length, uniqueSpaces: facilityFeatures.length, distinctPublishedCoordinates: distinctCoordinates, coveredDistricts, allLabelPointsInsideOwnBoundary: true, allSpacePointsInsideAssignedBoundary: true, originalGeometriesUnchanged: true, originalFacilityCoordinatesUnchanged: true, initialFieldObservationsCreated: 0},
    sourceLimits: ['공개 다운로드 수록 범위이며 순천 전체 자산 목록의 완전성을 보증하지 않음', '같은 좌표를 가진 여러 공간은 건물 대표좌표일 수 있음', '시간·요금별 다중 원문을 임의의 단일 운영조건으로 확정하지 않음', '담당자 현장확인·업무 실증은 별도 필요'],
    rejectedRecords: rejectedTextMatches,
    identityChanges: {new: registry.entries.filter(e => !oldIdentities.has(e.sourceKey)).map(e => e.id), absentFromCurrentDownload: previousRegistry.entries.filter(e => !groups.has(e.sourceKey)).map(e => e.id)},
  };
  await mkdir(OUT, {recursive: true});
  await Promise.all([
    writeFile(resolve(ROOT, 'public/data/regions/suncheon.json'), json(profile)),
    writeFile(resolve(OUT, 'admin-boundaries.geojson'), JSON.stringify(boundaries) + '\n'),
    writeFile(resolve(OUT, 'facilities.geojson'), json(facilities)),
    writeFile(resolve(OUT, 'public-facilities-source.json'), json({sourceUrl: FACILITY_URL, sourceDateRange: facilities.metadata.sourceDateRange, retrievedAt, nationwideSourceSha256: sha(facilityBytes), records: acceptedRows})),
    writeFile(resolve(OUT, 'identity-registry.json'), json(registry)),
    writeFile(resolve(OUT, 'validation.json'), json(audit)),
  ]);
  return audit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 2 && ['--source-dir', '--fetch'].includes(args[0]), '사용법: node scripts/data/collect-suncheon.mjs --source-dir /원본폴더  또는  --fetch /임시다운로드폴더');
    const sourceDirectory = resolve(args[1]);
    if (args[0] === '--fetch') await fetchSources(sourceDirectory);
    console.log(json(await collectSuncheon({sourceDirectory})));
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
