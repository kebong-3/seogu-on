import test from 'node:test';
import assert from 'node:assert/strict';
import {heatPlanIntent,isDecisionQuestion} from '../shared/decision-intent.js';

const boundaries={features:[{properties:{dongId:'seogu-17',dongName:'풍암동'}},{properties:{dongId:'seogu-07',dongName:'치평동'}}]};
const guide='풍암동 폭염 대응을 준비하고 있어. 수록된 그늘막과 무더위쉼터를 바탕으로 기존 시설을 먼저 활용하는 방법과 새로 설치할 곳을 검토하기 전에 확인할 사항을 근거와 함께 정리해줘.';

test('구동안내서의 폭염 질문은 폭염 대응계획(두 안 비교)으로 연결된다', () => {
  assert.equal(isDecisionQuestion(guide),true); // 종전에는 학교 주변 쉼터 단일 비교로 넘어갔다.
  assert.deepEqual(heatPlanIntent(guide,{boundaries}),{scopeId:'seogu-17'});
  assert.deepEqual(heatPlanIntent('서구 전체 폭염 쉼터 활용과 그늘막 추가 설치 비교',{boundaries}),{scopeId:'all'});
});

test('대상이 정해진 질문과 폭염 외 질문은 기존 흐름을 유지한다', () => {
  for (const q of ['그늘막 3곳을 추가하면?','학교 주변 무더위쉼터 활용과 추가 설치','풍암동 공원 위치 알려줘','정류장 그늘막 기존 활용과 추가 설치','한파 쉼터 추가 설치'])
    assert.equal(heatPlanIntent(q,{boundaries}),null,q);
});
