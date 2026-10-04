/**
 * 18개 동 이름표 배치 계산 (화면 좌표 기준, 지도 엔진과 무관한 순수 함수).
 *
 * 원칙
 *  - 이름표끼리 겹치지 않게 한다.
 *  - 자리가 없으면 이름 대신 작은 번호표(1~18)로 줄인다. 번호는 왼쪽 동 목록의 번호와 같다.
 *  - 번호표도 놓을 수 없으면 숨긴다(겹쳐서 읽을 수 없는 글자를 그리지 않는다).
 *  - 이름표를 기준점에서 멀리 옮기지 않는다. 어느 동의 이름인지 헷갈리면 안 되기 때문이다.
 */

const GAP = 3; // 이름표 사이 최소 간격(px)

/** 'seogu-07' → 7. 번호를 알 수 없으면 목록 순서를 쓴다. */
export function dongNumber(dongId, fallbackIndex = 0) {
  const match = /(\d+)$/.exec(String(dongId || ''));
  return match ? Number(match[1]) : fallbackIndex + 1;
}

/** 글자 폭 추정: 한글·한자는 1em, 그 밖(숫자·영문)은 0.6em. 캔버스 측정이 없을 때 쓴다. */
export function estimateTextWidth(text, fontPx) {
  let em = 0;
  for (const ch of String(text)) em += /[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch) ? 1 : 0.6;
  return em * fontPx;
}

/** 화면 폭에 맞는 글자 크기. 좁은 화면에서는 이름표를 조금 줄인다. */
export function labelFontPx(viewportWidth) {
  if (viewportWidth < 420) return 12;
  if (viewportWidth < 760) return 13;
  return 14;
}

function defaultMeasure(text, mode, fontPx) {
  if (mode === 'number') {
    const side = Math.max(20, Math.round(fontPx * 1.7));
    return { width: Math.max(side, estimateTextWidth(text, fontPx) + 10), height: side };
  }
  return { width: estimateTextWidth(text, fontPx) + 18, height: Math.round(fontPx * 1.9) };
}

function overlaps(a, b) {
  return a.x < b.x + b.width + GAP && a.x + a.width + GAP > b.x && a.y < b.y + b.height + GAP && a.y + a.height + GAP > b.y;
}

function boxAt(x, y, size) {
  return { x: x - size.width / 2, y: y - size.height / 2, width: size.width, height: size.height };
}

function insideViewport(box, viewport, inset) {
  return box.x >= inset.left && box.y >= inset.top && box.x + box.width <= viewport.width - inset.right && box.y + box.height <= viewport.height - inset.bottom;
}

/** 기준점 주변 후보 위치. 가까운 순서이며 이름표 한 개 크기 이상은 벗어나지 않는다. */
function candidateOffsets(size) {
  const h = size.height + GAP, w = size.width / 2 + GAP;
  return [[0, 0], [0, -h * 0.6], [0, h * 0.6], [w * 0.6, 0], [-w * 0.6, 0], [0, -h], [0, h], [w, -h * 0.6], [-w, -h * 0.6], [w, h * 0.6], [-w, h * 0.6]];
}

/** 번호표 후보 위치. 작아서 조금 더 멀리(두 겹의 고리) 옮겨도 어느 동인지 알 수 있다. */
function numberOffsets(size) {
  const step = size.height + GAP, out = [[0, 0]];
  for (const radius of [step * 0.7, step * 1.3, step * 2]) {
    for (let k = 0; k < 8; k++) out.push([Math.cos(k * Math.PI / 4) * radius, Math.sin(k * Math.PI / 4) * radius]);
  }
  return out;
}

/**
 * @param {Array<{id:string,x:number,y:number,name:string,number:number|string,priority?:number}>} items 화면 좌표의 기준점
 * @param {{width:number,height:number}} viewport
 * @param {{fontPx?:number,measure?:Function,inset?:object,occupied?:Array}} options
 * @returns {{labels:Array,counts:{name:number,number:number,hidden:number},fontPx:number}}
 */
export function planLabels(items, viewport, options = {}) {
  // 숨겨진 동이 생기면 그 주변의 이름표를 번호표로 줄여 자리를 만든 뒤 다시 배치한다.
  const numberOnly = new Set();
  let plan = planOnce(items, viewport, options, numberOnly);
  for (let round = 0; round < 8 && plan.counts.hidden > 0; round++) {
    const before = numberOnly.size;
    for (const hidden of plan.labels.filter(label => label.mode === 'hidden')) {
      const anchor = items.find(item => item.id === hidden.id);
      // 화면 밖에 있어서 숨겨진 동은 자리를 양보받을 필요가 없다.
      if (!anchor || !(anchor.x >= 0 && anchor.x <= viewport.width && anchor.y >= 0 && anchor.y <= viewport.height)) continue;
      const neighbours = plan.labels
        .filter(label => label.mode === 'name' && !(items.find(item => item.id === label.id)?.priority > 0))
        .map(label => ({label, d: Math.hypot(label.box.x + label.box.width / 2 - anchor.x, label.box.y + label.box.height / 2 - anchor.y)}))
        .sort((a, b) => a.d - b.d);
      for (const {label} of neighbours.slice(0, 2)) numberOnly.add(label.id);
    }
    if (numberOnly.size === before) break;
    const next = planOnce(items, viewport, options, numberOnly);
    if (next.counts.hidden > plan.counts.hidden) break;
    plan = next;
  }
  return plan;
}

function planOnce(items, viewport, options, numberOnly) {
  const fontPx = options.fontPx || labelFontPx(viewport.width);
  const measure = options.measure || defaultMeasure;
  const inset = { top: 2, right: 2, bottom: 2, left: 2, ...(options.inset || {}) };
  const occupied = [...(options.occupied || [])];
  const usable = items.filter(item => Number.isFinite(item.x) && Number.isFinite(item.y));
  const reach = fontPx * 6;
  const crowd = item => usable.filter(other => other !== item && Math.hypot(other.x - item.x, other.y - item.y) < reach).length;

  // 선택한 동을 먼저, 그다음 한적한 곳부터 놓는다. 붐비는 곳이 번호표로 줄어든다.
  const order = usable
    .map((item, index) => ({ item, index, crowd: crowd(item) }))
    .sort((a, b) => (b.item.priority || 0) - (a.item.priority || 0) || a.crowd - b.crowd || a.index - b.index);

  const placed = new Map();
  const tryPlace = (item, mode, text) => {
    const size = measure(text, mode, fontPx);
    for (const [dx, dy] of mode === 'number' ? numberOffsets(size) : candidateOffsets(size)) {
      const box = boxAt(item.x + dx, item.y + dy, size);
      if (!insideViewport(box, viewport, inset)) continue;
      if (occupied.some(other => overlaps(box, other))) continue;
      occupied.push(box);
      placed.set(item.id, { id: item.id, mode, text, dx, dy, box, fontPx });
      return true;
    }
    return false;
  };

  for (const { item } of order) {
    if (!numberOnly.has(item.id) && tryPlace(item, 'name', String(item.name))) continue;
    if (tryPlace(item, 'number', String(item.number))) continue;
    placed.set(item.id, { id: item.id, mode: 'hidden', text: '', dx: 0, dy: 0, box: null, fontPx });
  }

  const labels = items.map(item => placed.get(item.id) || { id: item.id, mode: 'hidden', text: '', dx: 0, dy: 0, box: null, fontPx });
  const counts = { name: 0, number: 0, hidden: 0 };
  for (const label of labels) counts[label.mode]++;
  return { labels, counts, fontPx };
}
