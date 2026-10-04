/**
 * 버튼 동작 등록소.
 *
 * 화면의 모든 버튼은 data-action="이름" 속성으로 동작을 찾는다(app.js의 클릭 위임).
 * 새 기능은 app.js의 긴 switch를 고치지 않고 여기에 등록하면 된다.
 *
 *   (같은 폴더의 actions.js 에서 registerAction 을 가져온 뒤)
 *   registerAction('ask-ai', (button, api) => api.show('지도에게 묻기', '<p>…</p>', 'ask-ai'));
 *
 * handler(button, api)
 *   - button: 눌린 요소(button.dataset.id 등 사용 가능)
 *   - api: {state, show, close, toast, fetchJSON, label, scoped, drawData, loadAPI, chooseDong, selectFeature, send}
 *   - false를 돌려주면 "처리하지 않음"으로 보고 기존 동작으로 넘어간다.
 */
const handlers = new Map();

export function registerAction(name, handler) {
  if (typeof name !== 'string' || !name || typeof handler !== 'function') throw new Error('동작 이름과 함수를 확인하세요.');
  handlers.set(name, handler);
  return () => { if (handlers.get(name) === handler) handlers.delete(name); };
}

export function hasAction(name) {
  return handlers.has(name);
}

/** @returns {Promise<boolean>} 등록된 동작이 처리했으면 true */
export async function runRegisteredAction(button, api) {
  const handler = handlers.get(button?.dataset?.action);
  if (!handler) return false;
  return (await handler(button, api)) !== false;
}
