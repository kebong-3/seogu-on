/**
 * 상단 관측정보 띠: 기온·1시간 강수(기상청 격자), 재난 관련 지도층 수신 종류 수.
 *
 * 정직성 원칙
 *  - 받지 못한 값은 '미수신', 받은 응답에 값이 없으면 '미관측'. 0이나 다른 지역 값으로 채우지 않는다.
 *  - 갱신에 실패하면 같은 구역의 이전 정상값을 원래 관측시각과 함께 '갱신 실패'로 표시한다.
 *  - 미수신일 때는 이유(code)를 말풍선과 상세 패널에 보여 준다. 인증키·주소는 표시하지 않는다.
 */
import {representative} from './geometry.js';
import {RESILIENCE_PRESETS} from './resilience-tools.js';
import {explainFailure,failureTooltip} from './live-diagnostics.js';
import {registerAction} from './actions.js';

const el = id => document.getElementById(id);
const value = (v, unit) => typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}` : '미관측';
const time = (date, clock) => date && clock ? `${date.slice(4, 6)}/${date.slice(6, 8)} ${clock.slice(0, 2)}:${clock.slice(2)} 관측` : '관측시각 미확인';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function createLiveStatus({state, fetchJSON, label, show}) {
  let sequence = 0;
  const weatherCache = new Map(); // 구역별 마지막 정상값
  const failures = new Map(); // 구역별 weather 실패 이유
  let lastCheckedAt = null;

  const place = () => state.dong === 'all'
    ? representative(state.district)
    : state.dongs.find(f => f.properties.dongId === state.dong)?.properties.labelPoint || representative(state.scope);
  const failureOf = key => failures.get(key) || {};
  const setFailure = (key, part, info) => failures.set(key, {...failureOf(key), [part]: info});

  function setReading(id, text, tooltip, failed) {
    const node = el(id);
    if (!node) return;
    node.textContent = text;
    node.title = tooltip || '';
    node.closest('.live-reading')?.classList.toggle('is-missing', !!failed);
  }

  function render(key) {
    const weather = weatherCache.get(key), failed = failureOf(key);
    el('live-place').textContent = label();
    const weatherTip = failed.weather ? failureTooltip(failed.weather) : weather ? '기상청 5km 격자 실황' : '';
    setReading('live-temperature', weather ? value(weather.data.values?.T1H, '℃') : '미수신', weatherTip, !weather && failed.weather);
    setReading('live-rainfall', weather ? value(weather.data.values?.RN1, 'mm') : '미수신', weatherTip, !weather && failed.weather);
    const tracked = new Set(RESILIENCE_PRESETS.flatMap(p => p.layers));
    const received = [...state.entries].filter(([id, e]) => tracked.has(id) && e.state === 'loaded' && e.features?.length).length;
    el('live-safety').textContent = `관련 자료 ${received}종`;

    const notes = [];
    if (weather) notes.push(`기상청 격자 ${time(weather.data.base?.base_date, weather.data.base?.base_time)}${weather.stale ? ' · 갱신 실패' : ''}`);
    else if (failed.weather) notes.push(`기상 미수신: ${failed.weather.reason}`);
    const observed = el('live-observed');
    observed.textContent = notes.join(' / ') || '관측자료 미수신 · 연결 설정을 확인하세요.';
    observed.title = failed.weather ? '값을 누르면 미수신 원인을 볼 수 있습니다.' : '';
    if (state.view === 'live-detail') detail();
  }

  async function refreshWeather(key, point) {
    try {
      const body = await fetchJSON(`/api/weather?lon=${point[0]}&lat=${point[1]}`);
      if (!body?.base || !body.values) throw Object.assign(Error('기상 응답 형식 오류'), {code: 'BAD_SHAPE', stage: 'weather'});
      weatherCache.set(key, {data: body, stale: false});
      setFailure(key, 'weather', null);
    } catch (error) {
      if (weatherCache.has(key)) weatherCache.set(key, {...weatherCache.get(key), stale: true});
      setFailure(key, 'weather', explainFailure(error, 'weather'));
    }
  }

  async function refresh() {
    const id = ++sequence, key = state.dong, point = place();
    if (!point) return;
    render(key);
    await Promise.all([
      refreshWeather(key, point).then(() => { if (id === sequence) render(key); })
    ]);
    lastCheckedAt = new Date();
    if (id === sequence) render(key);
  }

  /** 상세 패널: 자료별 수신 상태와 운영자 확인 사항 */
  function detail() {
    if (!show) return;
    const key = state.dong, failed = failureOf(key), weather = weatherCache.get(key);
    const row = (title, ok, okText, info) => `<div class="result-box live-diagnostic-row"><strong>${esc(title)}</strong>` + (ok
      ? `<p class="small">${esc(okText)}</p>${info ? `<p class="note warning">최근 갱신 실패: ${esc(info.reason)} <code>${esc(info.code)}</code><br>${esc(info.hint)}</p>` : ''}`
      : info
        ? `<p class="note warning"><b>미수신 · ${esc(info.reason)}</b> <code>${esc(info.code)}</code>${info.service ? `<br>단계: ${esc(info.service)}` : ''}${info.httpStatus ? ` · 응답 상태 ${esc(info.httpStatus)}` : ''}</p><p class="small"><b>확인할 일</b> ${esc(info.hint)}</p>`
        : '<p class="small">조회 중이거나 아직 조회하지 않았습니다.</p>') + '</div>';
    show('관측자료 수신 상태', `<p class="muted">${esc(label())} · 받지 못한 값은 ‘미수신’으로 두며 0이나 다른 지역 값으로 채우지 않습니다.</p>`
      + row('기온·1시간 강수 (기상청 격자)', !!weather, weather ? `${time(weather.data.base?.base_date, weather.data.base?.base_time)} · 5km 격자값` : '', failed.weather)
      + `<p class="small">마지막 확인: ${lastCheckedAt ? esc(lastCheckedAt.toLocaleTimeString('ko-KR')) : '확인 전'} · 10분마다 자동으로 다시 조회합니다.</p>`
      + '<div class="detail-actions"><button class="primary" data-action="live-refresh">지금 다시 조회</button><button class="secondary" data-action="settings">연결 설정 보기</button></div>'
      + '<p class="small">괄호 안 영문 코드는 원인 구분용입니다. 인증키 값은 이 화면과 응답에 표시되지 않습니다. 코드별 점검 방법은 저장소의 docs/API_SETUP.md에 있습니다.</p>', 'live-detail');
  }

  const unregister = [
    registerAction('live-detail', () => detail()),
    registerAction('live-refresh', async () => { await refresh(); })
  ];
  const timer = setInterval(refresh, 10 * 60 * 1000);
  return {
    refresh,
    scopeChanged: refresh,
    render: () => render(state.dong),
    failures: () => failureOf(state.dong),
    destroy() { sequence++; clearInterval(timer); unregister.forEach(off => off()); }
  };
}
