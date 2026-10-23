#!/usr/bin/env node
/**
 * Reproduce the childcare portal's public SHEET query without an API credential.
 * No guessed coordinates, inferred vacancies, or provider total assertions.
 * node scripts/data/collect-childcare.mjs --fetch --source-html /tmp/childcare.html
 * node scripts/data/collect-childcare.mjs --source-html /tmp/childcare.html
 */
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pointInRegion} from '../../shared/region-profile.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_NAME = '한국사회보장정보원 · 어린이집정보공개포털 어린이집 기본정보';
const SOURCE_URL = 'https://info.childcare.go.kr/info_html5/oais/openapi/OpenApiSlL.jsp';
const QUERY_URL = 'https://info.childcare.go.kr/info_html5/stat/sheet/StatCrInfoResult.jsp';
const QUERY_BODY = 'flag=crInfo&std_condi=N&sido=12&sigun=&exlChk=&offset=0&limit=2000';
const LICENSE_URL = 'https://www.data.go.kr/data/15013108/standard.do';
const REGIONS = {
  seogu: {district: '서구', boundary: 'public/data/admin-dongs.geojson'},
  suncheon: {district: '순천시', boundary: 'public/data/regions/suncheon/admin-boundaries.geojson'},
};
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => {if (!condition) throw Error(message);};
const decode = text => text.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|quot|apos|lt|gt|#39|#(\d+)|#x([0-9a-f]+));/gi, (match, decimal, hex) => decimal ? String.fromCodePoint(+decimal) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({'&nbsp;':' ', '&amp;':'&', '&quot;':'"', '&apos;':"'", '&#39;':"'", '&lt;':'<', '&gt;':'>'}[match.toLowerCase()] ?? match)).trim();
const numeric = value => value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

export function parseChildcareSheet(html) {
  const declared = html.match(/총 건수\s*:\s*([\d,]+)/)?.[1];
  assert(declared, '어린이집 공개 SHEET의 총 건수를 확인하지 못했습니다.');
  const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(match => decode(match[1]));
  assert(headers.length === 24 && headers[3] === '어린이집명' && headers[17] === '위도' && headers[18] === '경도', '원자료 열 구성이 달라졌습니다. 변환 전 열을 검수하세요.');
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(match => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => decode(cell[1])))
    .filter(row => row.length === 24);
  const declaredRows = Number(declared.replaceAll(',', ''));
  assert(declaredRows > 0 && rows.length === declaredRows, `공개 SHEET 수신 불완전: 총 ${declaredRows}행 중 ${rows.length}행. 전수 수신 전에는 반영하지 않습니다.`);
  return {headers, rows, declaredRows};
}

export async function collectChildcare({sourceHtml, outputDirectory = resolve(ROOT, 'public/data/decision'), collectedAt} = {}) {
  assert(sourceHtml, '--source-html에 수신한 공개 HTML 파일을 지정하세요.');
  const bytes = await readFile(sourceHtml), parsed = parseChildcareSheet(bytes.toString('utf8'));
  collectedAt ||= (await stat(sourceHtml)).mtime.toISOString();
  assert(Number.isFinite(Date.parse(collectedAt)), '수집시각을 확인하세요.');
  const summary = {collectedAt, receivedRows: parsed.declaredRows, rawSha256: sha(bytes), regions: {}};
  for (const [regionId, config] of Object.entries(REGIONS)) {
    const boundaries = JSON.parse(await readFile(resolve(ROOT, config.boundary), 'utf8'));
    const scopedRows = parsed.rows.filter(row => row[2] === config.district && row[7].includes(config.district));
    const features = [], exclusions = [], ids = new Set();
    for (const row of scopedRows) {
      const [longitude, latitude] = [numeric(row[18]), numeric(row[17])];
      let reason = null;
      if (!['정상', '재개'].includes(row[5])) reason = '원문 운영현황 휴지 등: 현재 운영 시설 참고목록에서 제외';
      else if (![longitude, latitude].every(Number.isFinite)) reason = '위경도 누락 또는 형식 오류';
      else if (!pointInRegion([longitude, latitude], boundaries)) reason = '원문 좌표가 해당 지역 행정경계 밖: 임의 보정하지 않음';
      if (reason) {exclusions.push({name: row[3], address: row[7], registeredStatus: row[5], sourceCoordinates: [row[18], row[17]], reason}); continue;}
      const id = `childcare-${regionId}-${sha(JSON.stringify([row[3], row[7]])).slice(0, 20)}`;
      if (ids.has(id)) {exclusions.push({name: row[3], address: row[7], reason: '동일 명칭·주소 중복'}); continue;}
      ids.add(id);
      const district = boundaries.features.find(feature => pointInRegion([longitude, latitude], {features: [feature]}));
      features.push({type: 'Feature', geometry: {type: 'Point', coordinates: [longitude, latitude]}, properties: {
        id, regionId, datasetId: 'childcare', name: row[3], category: 'care', facilityType: `어린이집 · ${row[4]}`, childcareType: row[4],
        address: row[7], phone: row[8] === '--' ? null : row[8], registeredStatus: row[5],
        capacity: numeric(row[15]), enrolled: numeric(row[16]), shuttle: row[19] || null,
        authorizationDate: row[21] || null, suspendedFrom: row[22] || null, suspendedUntil: row[23] || null,
        dongId: district.properties.dongId, dongName: district.properties.dongName,
        sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, sourceDate: null, collectedAt,
        coordinateSource: '공개 SHEET 원문 위도·경도', geometryMeaning: '원자료 시설 대표위치 · 출입구와 보행 접근성 미검수',
        identityKind: '명칭·주소 해시: 공식 영구 시설번호가 아님',
        operationalStatus: `공시 운영현황 ${row[5]} · 현재 운영·입소 가능 여부는 기관 확인`,
        coverage: '공식 공개 SHEET 수록자료 · 원문 기준일 미제공 · 누락은 시설 부재가 아님',
        note: '영유아 보육시설이며 초등 방과후 돌봄과 구분합니다. 정원·현원은 수집 당시 공시값으로, 차이를 현재 입소 가능 인원으로 해석하지 않습니다.',
        license: '공공누리 제1유형 · 출처표시', licenseSourceUrl: LICENSE_URL,
      }});
    }
    features.sort((a,b) => a.properties.name.localeCompare(b.properties.name, 'ko'));
    const coordinates = new Map();
    for (const feature of features) {
      const key = feature.geometry.coordinates.join(',');
      coordinates.set(key, (coordinates.get(key) || 0) + 1);
    }
    for (const feature of features) if (coordinates.get(feature.geometry.coordinates.join(',')) > 1)
      feature.properties.coordinateNote = '동일 대표좌표에 여러 시설이 등록됨. 같은 공동주택·건물일 수 있으며 시설별 실제 출입구 확인 필요.';
    const receipt = {
      regionId, sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, queryUrl: QUERY_URL, queryMethod: 'POST', queryBody: QUERY_BODY,
      queryMeaning: '비정기(수시), 포털 시도 선택값 12. 코드와 원문 시군구명·주소·해당 지역 경계를 함께 확인.',
      sourceDate: null, sourceDateMeaning: '수시조회 화면에 자료 기준일이 따로 제공되지 않음. 수집시각을 원자료 기준일로 대체하지 않음.',
      collectedAt, rawSha256: sha(bytes), receivedRows: parsed.declaredRows,
      regionRows: scopedRows.length, mappedRows: features.length, exclusions,
      license: '공공누리 제1유형 · 출처표시', licenseSourceUrl: LICENSE_URL,
    };
    const result = {type: 'FeatureCollection', metadata: {
      regionId, sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, sourceDate: null, collectedAt,
      coverage: `${config.district} 공개 SHEET ${scopedRows.length}행 중 운영현황 정상·재개 및 지역 경계 안 좌표 ${features.length}행. 원자료 기준일 미제공, 현재 운영과 입소 가능 여부 미검수.`,
      complete: false, license: receipt.license, licenseSourceUrl: LICENSE_URL,
      countMeaning: '수록 영유아 어린이집 대표위치 수 · 초등돌봄 시설·전체 공급·수요 또는 이용 가능한 자리 수가 아님',
      sourceReceipt: `/data/decision/${regionId}/childcare-source.json`,
    }, features};
    const directory = resolve(outputDirectory, regionId); await mkdir(directory, {recursive:true});
    await writeFile(resolve(directory, 'childcare.geojson'), json(result));
    await writeFile(resolve(directory, 'childcare-source.json'), json(receipt));
    summary.regions[regionId] = {sourceRows: scopedRows.length, mappedRows: features.length, excludedRows: exclusions.length};
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), inputIndex = args.indexOf('--source-html');
  assert(inputIndex >= 0 && args[inputIndex + 1], '--source-html을 지정하세요.');
  const sourceHtml = resolve(args[inputIndex + 1]);
  if (args.includes('--fetch')) {
    await mkdir(resolve(sourceHtml, '..'), {recursive:true});
    await promisify(execFile)('curl', ['--fail','--silent','--show-error','--location','--max-time','50','--data',QUERY_BODY,QUERY_URL,'--output',sourceHtml]);
  }
  const timeIndex = args.indexOf('--collected-at');
  const summary = await collectChildcare({sourceHtml, collectedAt: timeIndex >= 0 ? args[timeIndex+1] : undefined});
  process.stdout.write(json(summary));
}
