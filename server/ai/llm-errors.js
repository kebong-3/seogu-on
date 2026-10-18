export class LlmError extends Error {
  constructor(code, message) { super(message); this.name='LlmError'; this.code=code; }
}
