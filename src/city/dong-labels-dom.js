/**
 * OSM 경량 입체지도(MapLibre)용 동 이름표.
 * 지도 위에 HTML 이름표를 올리고, 지도가 움직일 때 label-layout.js로 다시 배치한다.
 * 외부 글꼴(glyph) 수신에 기대지 않으므로 한글 이름이 빠지지 않는다.
 */
import {planLabels,dongNumber,labelFontPx} from './label-layout.js';

export function createDomDongLabels({container, project, onSelect, onPlan}) {
  const layer = document.createElement('div');
  layer.className = 'dong-label-layer';
  layer.setAttribute('aria-hidden', 'true'); // 동 선택은 왼쪽 목록에서도 할 수 있다.
  container.append(layer);
  let entries = [], selectedDong = 'all', lastNumbered = '';

  function set(features, dong = 'all') {
    selectedDong = dong;
    layer.replaceChildren();
    if (!features.length && lastNumbered) { lastNumbered = ''; onPlan?.([]); }
    entries = features.filter(f => Array.isArray(f.properties?.labelPoint)).map((feature, index) => {
      const p = feature.properties, node = document.createElement('button');
      node.type = 'button';
      node.className = 'dong-label';
      node.tabIndex = -1;
      node.addEventListener('click', event => { event.stopPropagation(); onSelect?.(p.dongId); });
      layer.append(node);
      return {id: p.dongId, name: p.dongName, number: dongNumber(p.dongId, index), point: p.labelPoint, node};
    });
    layout();
  }

  function layout() {
    if (!entries.length) return;
    const viewport = {width: container.clientWidth, height: container.clientHeight};
    if (!viewport.width || !viewport.height) return;
    const fontPx = labelFontPx(viewport.width);
    const items = entries.map(entry => {
      let point = null;
      try { point = project(entry.point); } catch { /* 지도 준비 전 */ }
      return {id: entry.id, x: point ? point[0] : NaN, y: point ? point[1] : NaN, name: entry.name, number: entry.number, priority: entry.id === selectedDong ? 1 : 0};
    });
    const plan = planLabels(items, viewport, {fontPx});
    const numbered = plan.labels.filter(label => label.mode === 'number').map(label => label.id);
    if (numbered.join(',') !== lastNumbered) { lastNumbered = numbered.join(','); onPlan?.(numbered); }
    plan.labels.forEach((label, index) => {
      const node = entries[index].node;
      node.hidden = label.mode === 'hidden';
      if (node.hidden) return;
      node.textContent = label.text;
      node.title = entries[index].name;
      node.classList.toggle('number', label.mode === 'number');
      node.classList.toggle('selected', entries[index].id === selectedDong);
      node.style.cssText = `left:${label.box.x}px;top:${label.box.y}px;width:${label.box.width}px;height:${label.box.height}px;font-size:${fontPx}px`;
    });
  }

  return {set, layout, destroy() { layer.remove(); entries = []; }};
}
