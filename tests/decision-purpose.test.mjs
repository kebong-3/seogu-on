import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionPurpose, decisionPurposeHtml} from '../src/city/decision-purpose.js';
import {decisionReportHtml} from '../src/city/decision-report.js';

const result = (preset, values={}) => ({workflow:'coverage',status:'ready',preset,parameters:{radiusM:300},baseline:{total:8,totalLocations:6},...values});

test('care result gives an actionable facility check without implying admissions or demand', () => {
  const purpose=buildDecisionPurpose(result({id:'care',target:'childcare',service:'public-spaces'}));
  assert.equal(purpose.kind,'care');
  assert.ok(purpose.nextActions.some(value=>value.includes('정원')&&value.includes('현재 운영')));
  assert.ok(purpose.confirmed.some(value=>value.includes('6개 고유 좌표')&&value.includes('300m')));
  assert.ok(purpose.confirmed.some(value=>value.includes('입소 가능 여부')&&value.includes('판단하지 않습니다')));
  assert.ok(purpose.missingData.some(value=>value.includes('대기 인원')));
});

test('safety context takes priority when the inspected targets are childcare facilities', () => {
  const purpose=buildDecisionPurpose(result({id:'care-safety',target:'childcare',service:'security-light'}));
  assert.equal(purpose.kind,'safety');
  assert.ok(purpose.confirmed.some(value=>value.includes('범죄위험')&&value.includes('판정하지 않습니다')));
  assert.ok(purpose.nextActions.some(value=>value.includes('현장')&&value.includes('작동')));
});

test('missing datasets remain unknown rather than becoming a zero-facility claim', () => {
  const purpose=buildDecisionPurpose(result({id:'safety'},{status:'unavailable',baseline:{total:null},sourceStatus:[{id:'cctv',title:'공개 CCTV',state:'unavailable'}]}));
  assert.ok(purpose.confirmed[0].includes('산정하지 않았습니다'));
  assert.ok(purpose.missingData[0].includes('공개 CCTV'));
  assert.ok(purpose.missingData[0].includes('0개로 해석하지 않습니다'));
  assert.ok(!purpose.confirmed.some(value=>value.includes('0개 고유')));
});

test('site and inspection guidance starts with the actual next step for that workflow', () => {
  const preset={id:'childcare'};
  assert.match(buildDecisionPurpose(result(preset,{workflow:'site'})).nextActions[0],/실제 사업 후보 A·B/);
  assert.match(buildDecisionPurpose(result(preset,{workflow:'inspection'})).nextActions[0],/좌표 목록 CSV/);
});

test('exported report preserves purpose and missing-source context with safe HTML', () => {
  const data=result({id:'safety'},{sourceStatus:[{id:'cctv',title:'<script>bad()</script>',state:'unavailable'}],rows:[],scenario:{},limitations:[]});
  const html=decisionPurposeHtml(data);
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>bad()'));
  const report=decisionReportHtml({result:data,manifest:{datasets:[]}});
  assert.ok(report.includes('지금 할 다음 행동'));
  assert.ok(report.includes('여성안심·생활안전시설을 검토할 때'));
  assert.ok(report.includes('판단을 위해 더 필요한 자료'));
});

test('activity-space scenario describes public-space linkage rather than adding childcare supply', () => {
  const purpose=buildDecisionPurpose(result({id:'childcare',target:'childcare',service:'public-spaces'}));
  assert.match(purpose.title,/공공공간을 연계/);
  assert.ok(purpose.nextActions.some(value=>value.includes('대관조건')));
  assert.ok(purpose.missingData.some(value=>value.includes('프로그램별 참여 수요')));
});

test('specific safety scenarios identify the facility staff must actually inspect', () => {
  const bell=buildDecisionPurpose(result({id:'women-safety',target:'childcare',service:'emergency-bell'}));
  const light=buildDecisionPurpose(result({id:'night-safety',target:'bus',service:'security-light'}));
  assert.match(bell.title,/비상벨/);
  assert.match(bell.nextActions[1],/관제 연결/);
  assert.match(light.title,/보안등/);
  assert.match(light.nextActions[1],/빛 방향/);
  const compact=decisionPurposeHtml(result({id:'women-safety'}));
  assert.ok(!compact.includes('<details open>'));
  assert.ok(decisionPurposeHtml(result({id:'women-safety'}),undefined,{expanded:true}).includes('<details open>'));
});
