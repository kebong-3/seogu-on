/** 업무 질문의 공개 공간자료에 서버에서 조회한 기상청 관측을 덧붙인다. */
import {readWeather} from '../weather-service.js';
import {diagnose} from '../diagnostics.js';
import {getStore} from '../spatial/store.js';

const WEATHER_THEMES = new Set(['heat', 'cold', 'icing', 'flood']);
const SOURCE_URL = 'https://www.data.go.kr/data/15084084/openapi.do';
const SOURCE_NAME = '기상청 초단기실황';
const NOTE = '선택 지역 대표위치의 5km 격자 관측입니다. 동 전체 실측값·노면 온도·기상특보·현재 재난 상태나 미래 위험 예측이 아닙니다.';

function observationText(observation) {
  if (!observation.ok) return `${observation.scope} 기상청 격자 관측 미수신(${observation.code}). 관측값을 0으로 대신하지 않았습니다.`;
  const v = observation.values;
  const readings = [
    Number.isFinite(v.temperatureC) ? `기온 ${v.temperatureC}℃` : '기온 미관측',
    Number.isFinite(v.rainfall1hMm) ? `1시간 강수 ${v.rainfall1hMm}mm` : '강수 미관측',
    Number.isFinite(v.humidityPct) ? `습도 ${v.humidityPct}%` : '',
    Number.isFinite(v.windSpeedMs) ? `풍속 ${v.windSpeedMs}m/s` : '',
  ].filter(Boolean).join(' · ');
  return `${observation.scope} 대표위치 · ${observation.observedAt} 관측: ${readings}. 5km 격자값이며 재난 예측이 아닙니다.`;
}

/** 질문에 사용한 첫 업무구역의 관측만 조회한다. 복수 동 전체 값으로 확장하지 않는다. */
export async function attachWeatherEvidence(outcome, ctx = {}) {
  const work = outcome.results.find(r => r.tool === 'work_brief' && WEATHER_THEMES.has(r.args.theme));
  if (!work) return outcome;
  const store = getStore(ctx.dataDir);
  const dong = work.args.dong ? store.dongs.find(d => d.name === work.args.dong || d.id === work.args.dong) : null;
  const point = dong?.labelPoint || store.districtCentre();
  const scope = dong?.name || '서구 전체';
  const now = new Date(ctx.now ?? Date.now());
  const env = ctx.env || process.env;
  let observation;
  if (!env.KMA_SERVICE_KEY && !env.DATA_GO_KR_SERVICE_KEY) {
    observation = {ok: false, status: 'unavailable', scope, sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, code: 'NOT_CONFIGURED', reason: '기상청 연결 미설정', note: NOTE};
  } else {
    const controller = new AbortController();
    let timer;
    try {
      const limit = Math.min(5000, Math.max(50, ctx.weatherBudgetMs ?? 5000));
      const fetcher = (url, options = {}) => (ctx.weatherFetcher || ctx.fetcher || fetch)(url, {...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal});
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => {controller.abort(); reject(Object.assign(Error('WEATHER_TIMEOUT'), {name: 'TimeoutError'}));}, limit); });
      const data = await Promise.race([(ctx.weatherReader || readWeather)(point[0], point[1], {env, now, fetcher}), timeout]);
      if (!data?.base?.base_date || !data.base.base_time || !data.values) throw Error('NO_OBSERVATIONS');
      const date = data.base.base_date, clock = data.base.base_time;
      const values = {};
      for (const [from, to] of [['T1H', 'temperatureC'], ['RN1', 'rainfall1hMm'], ['REH', 'humidityPct'], ['WSD', 'windSpeedMs']]) {
        if (Number.isFinite(data.values[from])) values[to] = data.values[from];
      }
      observation = {
        ok: true, status: 'received', scope, sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL,
        observedAt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${clock.slice(0, 2)}:${clock.slice(2)} KST`,
        fetchedAt: data.fetchedAt || now.toISOString(), grid: data.grid, values, note: NOTE,
      };
    } catch (error) {
      const code = error?.name === 'TimeoutError' || controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : diagnose(error)?.code || 'UPSTREAM_UNREACHABLE';
      observation = {ok: false, status: 'unavailable', scope, sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, code, reason: '기상청 관측값을 받지 못했습니다.', note: NOTE};
    } finally { clearTimeout(timer); }
  }
  const result = {
    ok: observation.ok, summary: observationText(observation), data: {observation}, map: null,
    sources: observation.ok ? [{name: SOURCE_NAME, date: observation.observedAt, dateBasis: '관측시각(KST)', url: SOURCE_URL}] : [],
    caveats: [NOTE, ...(observation.ok ? [] : ['기상 관측 미수신은 강수가 없거나 현장이 안전하다는 뜻이 아닙니다.'])],
  };
  return {
    ...outcome,
    answer: `${outcome.answer} ${result.summary}`,
    steps: [...outcome.steps, {tool: 'weather_observation', args: {dong: scope}, ok: result.ok, summary: result.summary}],
    results: [...outcome.results, {tool: 'weather_observation', args: {dong: scope}, result}],
  };
}

/** UI와 복사·다운로드에 쓰는 구조화 검토자료. 생성문이 아니라 실행 결과에서만 만든다. */
export function briefFromResults(results) {
  const briefs = results.filter(r => r.tool === 'work_brief' && r.result?.data?.theme).map(r => r.result.data);
  if (!briefs.length) return undefined;
  const observationResult = results.find(r => r.tool === 'weather_observation')?.result;
  const observation = observationResult?.data?.observation;
  const many = briefs.length > 1;
  return {
    title: briefs[0].title,
    scope: [...new Set(briefs.map(b => b.scope))].join(' · '),
    theme: briefs[0].theme,
    basis: observation?.ok
      ? '시설·공간분석은 출처별 기준일이 있는 공개 수록자료에 근거합니다. 기상청 관측은 아래 관측시각과 대표위치의 5km 격자 기준으로 별도 표시합니다. 전수조사·위험 예측·최적 입지 결정은 아닙니다.'
      : briefs[0].basis,
    evidence: [...briefs.flatMap(b => b.evidence.map(e => ({title: many ? `${b.scope} · ${e.title}` : e.title, summary: e.summary, ok: e.ok}))),
      ...(observationResult ? [{title: '기상청 격자 관측', summary: observationResult.summary, ok: observationResult.ok}] : [])],
    nextActions: [...new Set(briefs.flatMap(b => b.nextActions))],
    missingData: [...new Set([...briefs.flatMap(b => b.missingData), ...(observation && !observation.ok ? ['기상청 관측 미수신: 현재 관측값을 별도로 확인하세요.'] : [])])],
    ...(observation ? {observation} : {}),
  };
}
