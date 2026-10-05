/**
 * 18개 동 이름표 배치 계산 (화면 좌표 기준, 지도 엔진과 무관한 순수 함수).
 *
 * 원칙
 *  - 이름표끼리 겹치지 않게 한다.
 *  - 선택한 동의 전체 이름을 먼저 놓는다.
 *  - 자리가 부족한 이름은 숨기고, 확대하거나 카메라를 옮기면 다시 배치한다.
 *  - 이름표를 기준점에서 멀리 옮기지 않는다. 어느 동의 이름인지 헷갈리면 안 되기 때문이다.
 */

const GAP = 3; // 이름표 사이 최소 간격(px)

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

function defaultMeasure(text, fontPx) {
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

/**
 * @param {Array<{id:string,x:number,y:number,name:string,priority?:number}>} items 화면 좌표의 기준점
 * @param {{width:number,height:number}} viewport
 * @param {{fontPx?:number,measure?:Function,inset?:object,occupied?:Array}} options
 * @returns {{labels:Array,counts:{name:number,hidden:number},fontPx:number}}
 */
export function planLabels(items, viewport, options = {}) {
  const fontPx = options.fontPx || labelFontPx(viewport.width);
  const measure = options.measure || defaultMeasure;
  const inset = { top: 2, right: 2, bottom: 2, left: 2, ...(options.inset || {}) };
  const occupied = [...(options.occupied || [])];
  const usable = items.filter(item => Number.isFinite(item.x) && Number.isFinite(item.y)
    && item.x >= 0 && item.x <= viewport.width && item.y >= 0 && item.y <= viewport.height);
  const reach = fontPx * 6;
  const crowd = item => usable.filter(other => other !== item && Math.hypot(other.x - item.x, other.y - item.y) < reach).length;

  // 선택한 동을 먼저, 그다음 한적한 곳부터 놓는다. 같은 화면에서는 순서가 일정하다.
  const order = usable
    .map((item, index) => ({ item, index, crowd: crowd(item) }))
    .sort((a, b) => (b.item.priority || 0) - (a.item.priority || 0) || a.crowd - b.crowd || a.index - b.index);

  const placed = new Map();
  const tryPlace = (item, text) => {
    const size = measure(text, fontPx);
    for (const [dx, dy] of candidateOffsets(size)) {
      const box = boxAt(item.x + dx, item.y + dy, size);
      if (!insideViewport(box, viewport, inset)) continue;
      if (occupied.some(other => overlaps(box, other))) continue;
      occupied.push(box);
      placed.set(item.id, { id: item.id, mode: 'name', text, dx, dy, box, fontPx });
      return true;
    }
    return false;
  };

  for (const { item } of order) {
    if (tryPlace(item, String(item.name))) continue;
    placed.set(item.id, { id: item.id, mode: 'hidden', text: '', dx: 0, dy: 0, box: null, fontPx });
  }

  const labels = items.map(item => placed.get(item.id) || { id: item.id, mode: 'hidden', text: '', dx: 0, dy: 0, box: null, fontPx });
  const counts = { name: 0, hidden: 0 };
  for (const label of labels) counts[label.mode]++;
  return { labels, counts, fontPx };
}
