#!/usr/bin/env node
/**
 * Public decision-workflow data. No API key, guessed coordinates or private records.
 * node scripts/data/collect-decision-sources.mjs --fetch --source-dir /tmp/decision-sources
 * node scripts/data/collect-decision-sources.mjs --source-dir /tmp/decision-sources
 * Portal's public JSON download is capped at 50,000 rows. A provider's declared
 * row count is checked separately; incomplete regional downloads are rejected.
 */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pointInRegion} from '../../shared/region-profile.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').trim();
const json = value => JSON.stringify(value, null, 2) + '\n';
const assert = (condition, message) => {if (!condition) throw Error(message);};
const SOURCES = {
  schools: {pk: '15021148', title: '전국초중등학교위치표준데이터', providerCode: 'B554398', detail: 'uddi:9793c2f7-4dba-49ed-bf64-8c6cfd56102a', regions: ['seogu', 'suncheon']},
  shade: {pk: '15129447', title: '전국그늘막쉼터표준데이터', providerCode: '5790000', detail: 'uddi:fe008ea7-bc44-43e9-b6b7-d3de1a3f0920', regions: ['suncheon']},
  crosswalks: {pk: '15028201', title: '전국횡단보도표준데이터', providerCode: '5790000', detail: 'uddi:294d8637-d5f2-45e1-8efc-f91e600c240d', regions: ['suncheon']},
  'child-protection': {pk: '15012891', title: '전국어린이보호구역표준데이터', providerCode: '5790000', detail: 'uddi:6d18caf9-342e-4e7a-bf1d-ae86d85abd8f_202002241356', regions: ['suncheon']},
};
const REGIONS = {
  seogu: {boundary: '/data/admin-dongs.geojson', count: 18, name: '서구'},
  suncheon: {boundary: '/data/regions/suncheon/admin-boundaries.geojson', count: 24, name: '순천시'},
};
const sourceUrl = config => `https://www.data.go.kr/data/${config.pk}/standard.do`;
async function curl(url, path, extra = []) {
  // execFile argument array deliberately avoids shell interpolation.
  await run('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '50', ...extra, url, '--output', path]);
}
async function fetchSources(directory) {
  await mkdir(directory, {recursive: true});
  await Promise.all(Object.entries(REGIONS).map(async ([region, config]) => {
    await curl(`https://seogu-on.vercel.app${config.boundary}`, resolve(directory, `${region}-boundaries.geojson`));
  }));
  // Run sequentially to avoid burdening the public portal with large simultaneous downloads.
  for (const [id, config] of Object.entries(SOURCES)) {
    const headerPath = resolve(directory, `${id}-columns.json`);
    await curl(`https://www.data.go.kr/download/columList.json?pk=${config.pk}&ext=JSON`, headerPath);
    const header = JSON.parse(await readFile(headerPath, 'utf8'));
    assert(Number.isSafeInteger(header.totalCount) && header.totalCount > 0 && header.totalCount <= 50000, `${id}: 공개 다운로드 행 수 확인 필요`);
    const rows = [], requests = [];
    for (let page = 1; page <= Math.ceil(header.totalCount / 10000); page++) {
      const params = new URLSearchParams({publicDataPk: config.pk, totalCount: String(header.totalCount), svcTableNm: header.tableVO.svcTableNm, perPage: '10000', page: String(page)});
      for (const field of header.tableVO.colNmList) params.append('colNmList', field);
      const url = `https://www.data.go.kr/download/standard.json?${params}`;
      const path = resolve(directory, `${id}-page-${page}.json`);
      await curl(url, path);
      const bytes = await readFile(path), pageRows = JSON.parse(bytes);
      assert(Array.isArray(pageRows), `${id}: 공개 JSON 응답 배열 확인 필요`);
      rows.push(...pageRows); requests.push({url, sha256: sha(bytes), rows: pageRows.length});
    }
    assert(rows.length === header.totalCount, `${id}: 공개 다운로드가 불완전합니다.`);
    const bytes = json(rows);
    await writeFile(resolve(directory, `${id}-national.json`), bytes);
    await curl('https://www.data.go.kr/tcs/dss/selectDpkDetailInfo.do', resolve(directory, `${id}-license.html`), ['--data', new URLSearchParams({publicDataDetailPk: config.detail}).toString()]);
    await writeFile(resolve(directory, `${id}-receipt.json`), json({retrievedAt: new Date().toISOString(), sourceUrl: sourceUrl(config), receivedRows: rows.length, sha256: sha(bytes), requests}));
  }
}
function licenseEvidence(html, label) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert(text.includes('이용허락범위 제한 없음'), `${label}: 이용허락범위가 확인되지 않습니다.`);
  const match = text.match(/전체 행 수\s*([\d,]+)/);
  assert(match, `${label}: 제공기관 전체 행 수가 확인되지 않습니다.`);
  return {license: '이용허락범위 제한 없음', declaredRows: Number(match[1].replaceAll(',', ''))};
}
function point(row) {
  const raw = [row.LONGITUDE ?? row.LOT, row.LATITUDE ?? row.LAT];
  if (raw.some(value => !clean(value))) return null;
  const coordinate = raw.map(Number);
  return coordinate.every(Number.isFinite) && coordinate[0] >= 124 && coordinate[0] <= 132 && coordinate[1] >= 32 && coordinate[1] <= 39 ? coordinate : null;
}
const bool = value => clean(value) === 'Y' ? true : clean(value) === 'N' ? false : null;
const number = value => clean(value) !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
function identity(id, row) {
  if (id === 'schools') return {id: clean(row.SCHOOL_ID), originalId: clean(row.SCHOOL_ID), kind: 'official-school-id'};
  if (id === 'crosswalks') return {id: clean(row.CRSLK_MANAGE_NO), originalId: clean(row.CRSLK_MANAGE_NO), kind: 'official-crosswalk-management-number'};
  // No permanent source ID exists for these records. Hash excludes publication
  // date and contact fields, but remains a snapshot identity, not a facility ID.
  const stable = Object.fromEntries(Object.keys(row).sort().filter(key => !['DATA_CRTR_YMD', 'REFERENCE_DATE', 'INSTT_CODE', 'INSTT_NM', 'MNG_INST_TELNO', 'PHONE_NUMBER'].includes(key)).map(key => [key, row[key]]));
  return {id: sha(JSON.stringify(stable)).slice(0, 20), originalId: null, kind: 'snapshot-record-hash-no-permanent-source-id'};
}
function properties(id, row) {
  if (id === 'schools') return {name: clean(row.SCHOOL_NM), schoolType: clean(row.SCHOOL_SE), operationStatus: clean(row.OPER_STTUS), foundationType: clean(row.FOND_TYPE), campusType: clean(row.BNHH_SE), educationOffice: clean(row.EDC_SPORT_NM)};
  if (id === 'shade') return {name: clean(row.INSTL_PLC_NM), locationDescription: clean(row.ACTL_PSTN), shadeType: clean(row.SHADE_CANOPY_TYPE), installationYear: number(row.INSTL_YR), heightM: number(row.WHOL_HGT), widthM: number(row.WHOL_WDTH_LEN)};
  if (id === 'child-protection') return {name: clean(row.TRGET_FCLTY_NM), facilityType: clean(row.FCLTY_KND), cctv: bool(row.CCTV_YN), cctvCount: number(row.CCTV_NUMBER), roadWidthM: number(row.PRTCAREA_RW), policeStation: clean(row.CMPTNC_POLCSTTN_NM), designationFlag: clean(row.CHLD_PRTN_ZON_YN) || null};
  return {name: `${clean(row.ROAD_NM) || '도로'} · 횡단보도 ${clean(row.CRSLK_MANAGE_NO)}`, roadName: clean(row.ROAD_NM), crossingType: clean(row.CRSLK_KND), lanes: number(row.CARTRK_CO), widthM: number(row.BT), lengthM: number(row.ET), pedestrianSignal: bool(row.TFCLGHT_YN), pushButtonSignal: bool(row.FNCTNG_SGNGNR_YN), audibleSignal: bool(row.SOND_SGNGNR_YN), raisedCrossing: bool(row.HIGHLAND_YN), bicycleCrossing: bool(row.BCYCL_CRSLK_CMBNAT_YN), refugeIsland: bool(row.TFCILND_YN), loweredCurb: bool(row.FTPTH_LOWER_YN), tactilePaving: bool(row.BRLL_BLCK_YN), dedicatedLighting: bool(row.CNCTR_LGHT_FCLTY_YN), publishedGreenSeconds: number(row.GREEN_SGNGNR_TIME), publishedRedSeconds: number(row.RED_SGNGNR_TIME)};
}
export async function collectDecisionSources({sourceDirectory, outputDirectory = resolve(ROOT, 'public/data/decision')} = {}) {
  assert(sourceDirectory, '--source-dir 에 공개 원자료 폴더를 지정하세요.');
  const boundaries = {};
  for (const [region, config] of Object.entries(REGIONS)) {
    const bytes = await readFile(resolve(sourceDirectory, `${region}-boundaries.geojson`));
    const collection = JSON.parse(bytes);
    assert(collection.features?.length === config.count, `${region}: 행정구역 변경 검토 필요`);
    boundaries[region] = {collection, hash: sha(bytes)};
  }
  const written = [];
  for (const [datasetId, config] of Object.entries(SOURCES)) {
    const [rawBytes, headerBytes, receiptBytes, licenseBytes] = await Promise.all(['national.json', 'columns.json', 'receipt.json', 'license.html'].map(suffix => readFile(resolve(sourceDirectory, `${datasetId}-${suffix}`))));
    const rows = JSON.parse(rawBytes), header = JSON.parse(headerBytes), receipt = JSON.parse(receiptBytes);
    const license = licenseEvidence(licenseBytes.toString(), datasetId);
    assert(Array.isArray(rows) && rows.length === header.totalCount, `${datasetId}: 원본 전체 행 수 불일치`);
    assert(receipt.sha256 === sha(rawBytes), `${datasetId}: 원본 파일 해시 불일치`);
    assert(Number.isFinite(Date.parse(receipt.retrievedAt)), `${datasetId}: 수집시각 오류`);
    const providerRows = rows.filter(row => clean(row.INSTT_CODE) === config.providerCode);
    assert(providerRows.length === license.declaredRows, `${datasetId}: 제공기관 원문 ${license.declaredRows}행 중 ${providerRows.length}행만 수신했습니다. 다운로드 제한/시차를 확인하세요.`);
    for (const region of config.regions) {
      const boundary = boundaries[region], regionRows = providerRows.filter(row => point(row) && pointInRegion(point(row), boundary.collection));
      const rejected = providerRows.length - regionRows.length;
      const used = new Set(), features = [];
      for (const row of regionRows) {
        if (datasetId === 'schools' && clean(row.OPER_STTUS) !== '운영') continue;
        const coordinate = point(row), ident = identity(datasetId, row), id = `${region}-${datasetId}-${ident.id}`;
        assert(ident.id && !used.has(id), `${datasetId}: 중복 원본 식별자 ${ident.id}를 검토하세요.`); used.add(id);
        const dong = boundary.collection.features.find(feature => pointInRegion(coordinate, {features: [feature]}))?.properties;
        assert(dong?.dongId, `${datasetId}: 경계 내부 행정동 지정 실패`);
        const date = clean(row.REFERENCE_DATE ?? row.DATA_CRTR_YMD);
        assert(!date || /^\d{4}-\d\d-\d\d$/.test(date), `${datasetId}: 기준일 형식 확인 필요`);
        const originalFields = Object.fromEntries(Object.entries(row).filter(([key]) => !['PHONE_NUMBER', 'MNG_INST_TELNO'].includes(key)));
        features.push({type: 'Feature', id, geometry: {type: 'Point', coordinates: coordinate}, properties: {
          id, ...properties(datasetId, row), regionId: region, datasetId, dongId: dong.dongId, dongName: dong.dongName,
          sourceName: `공공데이터포털 · ${config.title} · ${clean(row.INSTT_NM)}`, sourceUrl: sourceUrl(config), sourceDate: date || null,
          collectedAt: receipt.retrievedAt, providerCode: clean(row.INSTT_CODE), providerName: clean(row.INSTT_NM), originalId: ident.originalId, idMeaning: ident.kind,
          address: clean(row.RDNMADR ?? row.LCTN_ROAD_NM) || clean(row.LNMADR ?? row.LCTN_LOTNO_ADDR),
          roadAddress: clean(row.RDNMADR ?? row.LCTN_ROAD_NM), lotAddress: clean(row.LNMADR ?? row.LCTN_LOTNO_ADDR),
          sourceAttributes: originalFields,
        }});
      }
      const oldCrosswalkRows = datasetId === 'crosswalks' ? rows.filter(row => clean(row.INSTT_CODE) === '4820000' && point(row) && pointInRegion(point(row), boundary.collection)) : [];
      const currentIds = new Map(regionRows.map(row => [clean(row.CRSLK_MANAGE_NO), row]));
      const oldMatchingRows = oldCrosswalkRows.filter(row => {
        const current = currentIds.get(clean(row.CRSLK_MANAGE_NO));
        return current && JSON.stringify(point(current)) === JSON.stringify(point(row));
      });
      assert(oldCrosswalkRows.length === oldMatchingRows.length, '순천 구 기관코드 횡단보도 중 현행본과 위치가 다른 자료가 있어 검토가 필요합니다.');
      const dates = [...new Set(features.map(feature => feature.properties.sourceDate).filter(Boolean))].sort();
      const coordinateCount = new Set(features.map(feature => JSON.stringify(feature.geometry.coordinates))).size;
      const metadata = {
        version: 1, datasetId, regionId: region, sourceName: `공공데이터포털 · ${config.title}`, sourceUrl: sourceUrl(config),
        sourceDate: dates.length === 1 ? dates[0] : null, sourceDateRange: dates.length ? [dates[0], dates.at(-1)] : null,
        missingSourceDateCount: features.filter(feature => !feature.properties.sourceDate).length, collectedAt: receipt.retrievedAt, retrievedAt: receipt.retrievedAt,
        providerCode: config.providerCode, providerDetailPk: config.detail, providerDeclaredRows: license.declaredRows, providerReceivedRows: providerRows.length,
        downloadRows: rows.length, downloadLimit: 50000, nationalDownloadComplete: rows.length < 50000,
        regionalSourceRows: regionRows.length, publishedRecords: features.length, uniqueCoordinates: coordinateCount,
        invalidOrOutsideBoundaryProviderRows: rejected, excludedNonOperatingSchools: regionRows.length - features.length,
        excludedLegacyProviderDuplicateRows: oldMatchingRows.length,
        sourceSha256: sha(rawBytes), regionalSourceSha256: sha(JSON.stringify(regionRows)), regionalHashEncoding: 'SHA-256 of JSON.stringify(regional source rows in received order)',
        boundarySha256: boundary.hash, boundaryUrl: REGIONS[region].boundary, boundarySourceDate: '2026-07-01',
        license: license.license, licenseEvidenceSha256: sha(licenseBytes), sourceFormat: '공공데이터포털 공개 JSON 다운로드', requestWasAuthenticated: false,
        coordinateSystem: 'EPSG:4326', coordinateEvidence: '원문 위도·경도(십진도). 수치 범위 및 실제 행정경계 교차검사; 임의 지오코딩·좌표보정 없음.',
        geometryMeaning: datasetId === 'child-protection' ? '보호구역 대상시설 대표점. 지정구역의 실제 경계가 아님.' : '공식 자료의 대표위치. 시설 출입구·면적 또는 실제 보행동선이 아님.',
        countMeaning: datasetId === 'shade' || datasetId === 'child-protection' ? '공개 원자료 행 수. 같은 좌표의 별도 시설 기록을 포함하며 중복 없는 물리적 시설 수로 해석하지 않음.' : '공식 식별자를 가진 자료 중 선택 행정경계 안의 수록 건수.',
        coverage: '공식 공개 수록자료 기준. 미수록은 시설 부재를 뜻하지 않으며 현장 운영·접근성·실시간 신호를 보장하지 않음.',
        notes: [datasetId === 'crosswalks' ? '구 순천 기관코드 4820000 자료는 현행 5790000의 관리번호·좌표와 일치하는 중복만 제외. 빈 신호·접근시설 값은 null(미상), N만 false.' : '제공기관 공개 원문과 총행 수 및 이용조건을 함께 검증.', datasetId === 'shade' ? '영구 시설ID 없음. 동일 좌표가 여러 번 수록되어도 위치 설명·형태·규격을 보존. 범위 비교 시 좌표 중복을 따로 고려할 것.' : '원본 고유번호가 없는 자료에는 스냅샷 행 해시를 사용하며 영구 시설ID로 주장하지 않음.'],
      };
      const out = resolve(outputDirectory, region); await mkdir(out, {recursive: true});
      const path = resolve(out, `${datasetId}.geojson`); await writeFile(path, json({type: 'FeatureCollection', metadata, features}));
      written.push({region, datasetId, records: features.length, uniqueCoordinates: coordinateCount, sourceDate: metadata.sourceDate, path});
    }
  }
  return written;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const sourceDirectory = value('--source-dir');
  assert(sourceDirectory, '--source-dir /tmp/decision-sources 를 지정하세요.');
  if (args.includes('--fetch')) await fetchSources(resolve(sourceDirectory));
  console.log(json(await collectDecisionSources({sourceDirectory: resolve(sourceDirectory), outputDirectory: value('--out') ? resolve(value('--out')) : undefined})));
}
