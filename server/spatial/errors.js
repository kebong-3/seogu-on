/** 공간 질의 엔진의 입력·자료 오류. message 는 사용자에게 보여도 되는 한국어 문장이다. */
export class SpatialError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SpatialError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
