/** 사용자 검토내용을 공개자료와 섞지 않고 업무 검토 틀에 붙인다. */
import {CIVIC_THEMES, isCivicTheme} from '../spatial/civic-themes.js';

export const REVIEW_LIMITS = Object.freeze({textChars: 1200, alternativeItems: 3, alternativeChars: 140});
export const REVIEW_PROVENANCE = '사용자가 제공한 검토내용·대안입니다. 사실 확인이나 주민 의견의 대표성 검증을 거치지 않았으며 공식 자료 출처에 포함하지 않습니다.';

export class ReviewInputError extends Error {
  constructor(message) { super(message); this.status = 400; this.code = 'INVALID_REVIEW_CONTEXT'; }
}

/** HTML·명령문도 원문 자료로 보존하되 실행하지 않는다. 크기 초과는 조용히 자르지 않는다. */
export function normalizeReviewContext(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || !isCivicTheme(value.theme)) {
    throw new ReviewInputError('검토 유형은 마을의제·공간 비교·기존 공간 활용·사업 연계 중에서 선택하세요.');
  }
  if (value.text !== undefined && typeof value.text !== 'string') throw new ReviewInputError('검토내용은 글자로 입력하세요.');
  const text = (value.text || '').replace(/\r\n?/g, '\n').trim();
  if (text.length > REVIEW_LIMITS.textChars) throw new ReviewInputError(`검토내용은 ${REVIEW_LIMITS.textChars}자 이하로 입력하세요.`);
  const supplied = value.alternatives === undefined ? [] : value.alternatives;
  if (!Array.isArray(supplied) || supplied.length > REVIEW_LIMITS.alternativeItems || supplied.some(item => typeof item !== 'string')) {
    throw new ReviewInputError(`검토 대안은 글자로 최대 ${REVIEW_LIMITS.alternativeItems}개 입력하세요.`);
  }
  const alternatives = supplied.map(item => item.trim()).filter(Boolean);
  if (alternatives.some(item => item.length > REVIEW_LIMITS.alternativeChars)) throw new ReviewInputError(`대안은 각각 ${REVIEW_LIMITS.alternativeChars}자 이하로 입력하세요.`);
  return {theme: value.theme, text, alternatives};
}

function reviewFor(data, context, question) {
  const theme = CIVIC_THEMES[data.theme];
  const supplied = context?.theme === data.theme ? context : null;
  const inputText = supplied?.text || question;
  const alternatives = supplied?.alternatives.length
    ? supplied.alternatives.map(title => ({title, origin: 'user', focus: '사용자가 제시한 대안입니다. 아래 공통 기준으로 조건과 영향을 비교합니다.', checks: [...theme.commonCriteria]}))
    : theme.alternatives.map(item => ({...item, origin: 'template'}));
  return {
    inputText,
    inputKind: supplied?.text ? '사용자 제공 검토내용' : '사용자 질문',
    provenance: REVIEW_PROVENANCE,
    scopeNote: `${data.scope}의 수록 시설을 참고합니다. 입력한 개별 장소·사업의 위치나 경계를 자동 확인한 결과가 아니며, 시설 수를 주민 수요나 공간의 유휴 여부로 해석하지 않습니다.`,
    sourceScope: data.categorySelection === 'mentioned' ? '입력에서 확인한 시설 종류를 조회했습니다.' : '검토 유형에 따른 기본 시설자료입니다. 제안과의 관련성은 별도 확인이 필요합니다.',
    commonCriteria: [...theme.commonCriteria],
    alternatives,
    alternativeNotice: supplied?.alternatives.length ? '입력한 대안을 그대로 보존했습니다. 우열·실현 가능성은 아직 판단하지 않았습니다.' : '아래는 논의를 시작하기 위한 검토 틀의 예시이며 주민이 제시했거나 확정한 대안이 아닙니다.',
    departments: theme.departments.map(item => ({...item, checks: [...item.checks]})),
    departmentNotice: '업무 기능별 협의 후보입니다. 실제 부서명·소관·담당자는 조직과 사업자료로 확인하세요.',
    discussionQuestions: [...theme.discussionQuestions],
    missingData: [...data.missingData],
  };
}

/** 도구의 공적 출처·시설 수·좌표는 그대로 두고 사용자 입력과 검토 틀만 별도 필드에 담는다. */
export function attachCivicReview(outcome, context, question) {
  let attached = false;
  const results = outcome.results.map(entry => {
    if (entry.tool !== 'work_brief' || !isCivicTheme(entry.result?.data?.theme)) return entry;
    if (entry.result.data.review) return entry;
    attached = true;
    const review = reviewFor(entry.result.data, context, question);
    return {...entry, result: {...entry.result, data: {...entry.result.data, review}, caveats: [...entry.result.caveats, review.provenance, review.scopeNote]}};
  });
  if (!attached) return outcome;
  return {
    ...outcome,
    results,
    answer: `${outcome.answer} 사용자 입력과 공개 수록자료를 구분해 검토 틀로 정리했습니다. 제시된 대안의 우열·예산·수요·실행 가능성은 확정하지 않았으며 담당자 확인이 필요합니다.`,
  };
}
