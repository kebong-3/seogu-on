/**
 * 대표 시나리오 "폭염 그늘".
 * 한 번 누르면 (1) 그늘막·쿨링포그·무더위쉼터 지도층을 켜고 (2) 5분 단위 3D 그림자 패널을 여름 대표일로 연다.
 *
 * 정직성 원칙
 *  - 받지 못한 자료는 '미수신'으로 적는다. 0곳으로 표시하지 않는다.
 *  - 시설 수가 적다는 것만으로 위험·부족을 판정하지 않는다.
 *  - 3D 그림자는 건물 모형 기준이며 나무·그늘막 자체의 그늘은 포함하지 않는다.
 */
import {registerAction} from './actions.js';
import {LAYER_BY_ID,esc} from './catalog.js';

/** 시나리오에 쓰는 지도층. kind: static=배포본에 포함, manual=재난안전 API 패널에서 받은 것, api=키가 있으면 바로 조회 */
export const HEAT_LAYERS = [
  {id: 'local-shade', label: '그늘막', kind: 'static'},
  {id: 'local-cooling', label: '쿨링포그', kind: 'static'},
  {id: 'official-heat-shelter', label: '무더위쉼터(공식 공개본)', kind: 'static'},
  {id: 'sd-heat', label: '무더위쉼터', kind: 'manual'},
  {id: 'heat', label: '무더위쉼터(기존 API)', kind: 'api', key: 'safety'},
  {id: 'park-areas', label: '공원 면', kind: 'static'}
];

/** 지도층별 수신 상태를 화면 문구로 요약한다(순수 함수: 테스트 가능). */
export function heatSummary(layers, entries, scopedCount) {
  return layers.map(layer => {
    const entry = entries.get(layer.id), received = entry?.state === 'loaded' && Array.isArray(entry.features) && !entry.error;
    if (!received) return {...layer, received: false, text: '미수신'};
    const count = scopedCount(layer.id);
    return {...layer, received: true, count, text: count ? `${count}곳` : '이 구역 확보자료 없음'};
  });
}

function summaryHtml(rows, label) {
  const shelters = rows.filter(r => r.label.startsWith('무더위쉼터'));
  const shelterMissing = shelters.every(r => !r.received);
  const shown = rows.filter(r => r.kind !== 'api' || r.received); // 조회하지 않은 보조 API 줄은 숨긴다.
  return `<div class="scenario-summary" data-scenario="heat-shade"><strong>폭염 그늘 · ${esc(label)}</strong>`
    + `<ul>${shown.map(r => `<li><span>${esc(r.label)}</span><b class="${r.received ? '' : 'missing'}">${esc(r.text)}</b></li>`).join('')}</ul>`
    + (shelterMissing ? '<button class="secondary full" data-action="safety-hub">무더위쉼터 자료 조회하기 (재난안전 API)</button>' : '')
    + '<p class="small">아래에서 <b>3D 그림자 켜기</b> 또는 <b>5분 단위 재생</b>을 누르세요. 그림자는 건물 모형 기준이며 나무·그늘막 자체의 그늘은 포함하지 않습니다. 시설 수만으로 위험·부족을 판정하지 않습니다.</p></div>';
}

export function installHeatScenario(api) {
  const state = api.state;
  let active = false;
  const body = () => document.getElementById('detail-body');
  const scopedCount = id => api.scoped(id).length;

  function paint() {
    const host = body();
    if (!active || !host || state.view !== 'native-sun') return;
    const html = summaryHtml(heatSummary(HEAT_LAYERS, state.entries, scopedCount), api.label());
    const existing = host.querySelector('.scenario-summary');
    if (existing) { if (existing.outerHTML !== html) existing.outerHTML = html; }
    else host.insertAdjacentHTML('afterbegin', html);
  }

  // 그림자 패널은 재생·시간 변경 때 다시 그려진다. 그때도 요약이 남도록 지켜본다.
  const host = body();
  const observer = host && typeof MutationObserver === 'function' ? new MutationObserver(() => {
    if (state.view !== 'native-sun') { active = false; return; }
    if (active && !host.querySelector('.scenario-summary')) paint();
  }) : null;
  observer?.observe(host, {childList: true});

  const off = registerAction('heat-shade', async () => {
    // 1) 지도층: 이미 받은 자료만 켠다. 주제도(이미지) 층은 끈다.
    for (const id of state.enabled) if (LAYER_BY_ID[id]?.kind === 'raster') api.send({type: 'raster', id, visible: false});
    const on = HEAT_LAYERS.filter(layer => layer.kind === 'static' || state.entries.get(layer.id)?.features?.length).map(layer => layer.id);
    state.enabled = new Set(on);
    state.activePreset = null; state.isolate = false; state.selected = null;
    api.drawData();

    // 2) 5분 그림자 패널을 여름 대표일(6/21)로 연다.
    await api.run('native-sun');
    await api.run('sun-season', {id: 'summer'});
    active = true;
    paint();
    api.toast('폭염 그늘: 그늘막·쿨링포그를 켜고 그림자 시각을 여름 대표일(6/21)로 맞췄습니다.');

    // 3) 기존 무더위쉼터 API는 키가 설정된 경우에만 조회한다(미설정이면 미수신으로 둔다).
    const legacy = HEAT_LAYERS.find(layer => layer.kind === 'api');
    if (state.config?.configured?.[legacy.key] && state.entries.get(legacy.id)?.state !== 'loaded') {
      state.enabled.add(legacy.id);
      await api.loadAPI(legacy.id);
      paint();
    }
  });

  return {paint, destroy() { off(); observer?.disconnect(); }};
}
