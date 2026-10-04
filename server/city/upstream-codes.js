/**
 * server/diagnostics.js의 분류 결과를 city API의 HttpError로 감싼다.
 */
import {HttpError} from './common.js';
import {DIAGNOSTIC_CODES,diagnose} from '../diagnostics.js';
export {DIAGNOSTIC_CODES,normalizeServiceKey,keyCandidates} from '../diagnostics.js';

export function diagnostic(code, {label = '', stage = '', detail = ''} = {}) {
  const known = DIAGNOSTIC_CODES[code] ? code : 'UPSTREAM_ERROR', base = DIAGNOSTIC_CODES[known];
  const message = [label, base.message, detail].filter(Boolean).join(' ');
  return Object.assign(new HttpError(base.status, message, known), {stage, diagnosed: true});
}

/**
 * 어떤 오류든 진단 코드가 붙은 HttpError로 바꾼다.
 * @param {unknown} error common.js의 json()/records()나 fetch가 던진 오류
 */
export function classifyUpstream(error, context = {}) {
  if (error?.diagnosed) return error;
  const found = diagnose(error);
  if (found) return diagnostic(found.code, {...context, detail: found.detail});
  if (error instanceof HttpError && error.status < 500) return error; // 400번대 입력 오류는 그대로 둔다.
  if (!(error instanceof HttpError)) return diagnostic('UPSTREAM_UNREACHABLE', context);
  return diagnostic('UPSTREAM_ERROR', context);
}

/** 인증키가 원인이라 다른 후보 키를 시도할 가치가 있는 실패인가 */
export function isKeyFailure(error) {
  return ['KEY_REJECTED', 'ACCESS_DENIED', 'QUOTA_EXCEEDED'].includes(error?.code);
}
