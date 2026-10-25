import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectChildcare} from '../scripts/data/collect-childcare.mjs';

const headers = ['번호','시도','시군구','어린이집명','어린이집유형구분','운영현황','우편번호','주소','어린이집전화번호','어린이집팩스번호','보육실수','보육실면적','놀이터수','CCTV설치수','보육교직원수','정원수','현원수','위도','경도','통학차량운영여부','홈페이지주소','인가일자','휴지시작일자','휴지종료일자'];
const reviewed = {name:'광주서구청어린이집',address:'전남광주통합특별시 서구 경열로 33 서구청',coordinates:[126.86332875147805,35.147776108049314]};
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

async function collectOne(record) {
  const temp = await mkdtemp(join(tmpdir(),'childcare-coordinate-review-'));
  try {
    const row = ['99','전남광주통합특별시','서구',record.name,'직장','정상','',record.address,'','',1,1,1,1,1,70,50,record.coordinates[1],record.coordinates[0],'미운영','','2017-08-25','',''];
    const sourceHtml = join(temp,'source.html');
    await writeFile(sourceHtml,`총 건수 : 1<table><tr>${headers.map(value=>`<th>${escape(value)}</th>`).join('')}</tr><tr>${row.map(value=>`<td>${escape(value)}</td>`).join('')}</tr></table>`);
    await collectChildcare({sourceHtml,outputDirectory:temp,collectedAt:'2026-10-23T17:32:48.964Z'});
    return {data:JSON.parse(await readFile(join(temp,'seogu/childcare.geojson'),'utf8')),receipt:JSON.parse(await readFile(join(temp,'seogu/childcare-source.json'),'utf8'))};
  } finally {await rm(temp,{recursive:true,force:true});}
}

test('childcare collector quarantines the reviewed source location and retains reproducible evidence', async () => {
  const {data,receipt} = await collectOne(reviewed);
  assert.equal(data.features.length,0);
  assert.equal(receipt.mappedRows,0);
  assert.equal(receipt.coordinateReviewCount,1);
  const excluded = receipt.exclusions[0];
  assert.equal(excluded.id,'childcare-seogu-7d51687f20f80f452be8');
  assert.equal(excluded.code,'SOURCE_COORDINATE_CONFLICT');
  assert.deepEqual(excluded.sourceCoordinates,reviewed.coordinates.map(String));
  assert.equal(excluded.reviewEvidence.sourceUrl,'https://www.data.go.kr/data/15013117/standard.do');
  assert.equal(excluded.reviewEvidence.distanceM,2472);
  assert.match(excluded.reviewEvidence.meaning,/대체 좌표가 아니/);
});

test('childcare collector rechecks a changed source coordinate instead of permanently excluding the facility', async () => {
  // A hypothetical corrected source input; this is not a deployed coordinate replacement.
  const changed = {...reviewed,coordinates:[126.8904,35.1526]};
  const {data,receipt} = await collectOne(changed);
  assert.equal(receipt.exclusions.length,0);
  assert.equal(data.features.length,1);
  assert.deepEqual(data.features[0].geometry.coordinates,changed.coordinates);
});

test('childcare collector does not quarantine another facility sharing the reviewed coordinate', async () => {
  const {data,receipt} = await collectOne({...reviewed,name:'별도 검증용 어린이집'});
  assert.equal(receipt.exclusions.length,0);
  assert.equal(data.features.length,1);
  assert.deepEqual(data.features[0].geometry.coordinates,reviewed.coordinates);
});
