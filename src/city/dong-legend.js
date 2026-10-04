/**
 * 지도 번호표 안내.
 * 이름표가 겹쳐 번호(1~18)로 줄어든 동만 "번호 + 동 이름" 단추로 나열한다. 누르면 그 동으로 이동한다.
 * 모든 동이 이름으로 보이면 안내는 숨긴다.
 */
import {dongNumber} from './label-layout.js';
import {esc} from './catalog.js';

/** 지도 엔진이 알려 준 배치 결과에서 번호표가 된 동 목록을 만든다(순수 함수). */
export function legendEntries(dongs, numberedIds) {
  const wanted = new Set(numberedIds || []);
  return dongs
    .map((feature, index) => ({id: feature.properties.dongId, name: feature.properties.dongName, number: dongNumber(feature.properties.dongId, index)}))
    .filter(entry => wanted.has(entry.id));
}

export function renderDongLegend(element, dongs, numberedIds) {
  if (!element) return;
  const entries = legendEntries(dongs, numberedIds);
  element.hidden = entries.length === 0;
  element.innerHTML = entries.length
    ? `<span class="dong-legend-title">번호표</span>` + entries.map(entry => `<button data-action="dong" data-id="${esc(entry.id)}"><b>${entry.number}</b>${esc(entry.name)}</button>`).join('')
    : '';
}

/** 배치 결과가 바뀌었을 때만 알리기 위한 요약 문자열 */
export function labelSignature(labels) {
  return labels.filter(label => label.mode === 'number').map(label => label.id).join(',');
}
