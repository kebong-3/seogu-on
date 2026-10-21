/**
 * "지도에게 묻기" 규칙 기반 모드.
 * AI 없이 한국어 질문에서 동·분류·반경·의도를 찾아 공간 도구를 부르고, 도구의 요약문으로 답을 만든다.
 * 답에 들어가는 숫자와 이름은 모두 도구 결과에서 온다(여기서 지어내지 않는다).
 */
import { ASK_EXAMPLES } from '../../src/city/ask-examples.js';
import { resolveCategory } from '../spatial/resolve.js';
import { getStore } from '../spatial/store.js';
import { SpatialError, callTool } from '../spatial/tools.js';
import {isCivicTheme} from '../spatial/civic-themes.js';

const MAX_TOOL_CALLS = 6;
const MAX_DONGS_PER_QUESTION = 4;

/**
 * 질문에서 찾을 분류 낱말 → 엔진의 resolveCategory 에 넘길 말.
 * 실제 자료 선택(어느 파일인지, 연결 여부)은 엔진이 정한다.
 */
const CATEGORY_WORDS = [
  ['그늘막쉼터', '그늘막'], ['그늘막', '그늘막'], ['그늘', '그늘막'],
  ['버스정류장', '버스정류장'], ['버스정류소', '버스정류장'], ['정류장', '버스정류장'], ['정류소', '버스정류장'], ['버스', '버스정류장'],
  ['쿨링포그', '쿨링포그'], ['작은도서관', '도서관'], ['도서관', '도서관'], ['주차장', '주차장'],
  ['초등학교', '학교'], ['중학교', '학교'], ['고등학교', '학교'], ['학교', '학교'],
  ['병원', '병원'], ['의원', '병원'], ['의료기관', '병원'],
  ['어린이집', '어린이집'], ['유치원', '유치원'], ['놀이터', '놀이터'],
  ['공중화장실', '화장실'], ['화장실', '화장실'],
  ['경찰서', '경찰서'], ['지구대', '경찰서'], ['파출소', '경찰서'], ['소방서', '소방서'], ['우체국', '우체국'],
  ['지하철역', '지하철'], ['지하철', '지하철'], ['도시철도', '지하철'],
  ['행정복지센터', '행정복지센터'], ['주민센터', '행정복지센터'], ['동사무소', '행정복지센터'],
  ['지진대피장소', '대피소'], ['대피장소', '대피소'], ['대피소', '대피소'],
  ['한파쉼터', '한파쉼터'], ['무더위쉼터', '무더위쉼터'], ['폭염쉼터', '무더위쉼터'],
  ['cctv', 'cctv'], ['비상벨', '비상벨'], ['보안등', '보안등'], ['전통시장', '전통시장'],
  ['어린이보호구역', '어린이보호구역'], ['스쿨존', '어린이보호구역'],
  ['무인민원발급기', '무인민원발급기'], ['민원발급기', '무인민원발급기'],
  ['제설함', '제설함'], ['전기차충전소', '전기차'], ['충전소', '전기차'],
  ['상습결빙구간', '결빙'], ['결빙관리지점', '결빙'], ['결빙구간', '결빙'], ['블랙아이스', '결빙'], ['결빙', '결빙'],
  ['체육시설', '체육시설'], ['약국', '약국'], ['복지관', '복지'], ['복지시설', '복지'],
  ['공원', '공원'], ['공공시설', '공공시설'],
  ['박물관', 'museum'], ['미술관', 'museum'], ['관공서', 'government'], ['공연장', 'culture'], ['문화공간', 'culture'],
].sort((a, b) => b[0].length - a[0].length);

const RE = {
  datasets: /(어떤|무슨|어느)(자료|데이터)|(자료|데이터)(목록|종류|현황)|수록자료|(자료|데이터)(가|는)?(뭐|무엇)/,
  sun: /(^|[^가-힣])해(가|는|의|$|[^가-힣])|태양|그림자|일조|햇빛|햇볕/,
  hour: /(오전|오후|낮|밤|저녁|아침|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?/,
  monthDay: /(\d{1,2})\s*월\s*(\d{1,2})\s*일/,
  year: /((?:19|20)\d{2})\s*년/,
  flood: /침수/,
  gap: /없는|없이|없어|사각|부족|공백|닿지않|미설치|빈곳/,
  compare: /비교|동별|(어느|어떤)동|(많|적)은(동|곳)|(가장|제일)(많|적)|순위|밀도/,
  density: /밀도|면적당|㎢|km2/,
  nearest: /가까운|가까이|가깝|최근접/,
  near: /근처|주변|인근|부근|반경|이내|안에/,
  where: /어디|위치|좌표|찾아/,
  radius: /(\d{1,4}(?:\.\d+)?)\s*(km|킬로미터|킬로|m|미터)/,
  count: /(\d{1,2})\s*(곳|개|군데)/,
  place: /([가-힣a-z0-9]{2,20}?)(?:의|은|는|이|가)?\s*(?:에서|근처|주변|인근|부근|반경)/g,
};

const squash = text => String(text).toLowerCase().replace(/\s+/g, '');
const fmt = value => Number(value).toLocaleString('ko-KR');

/* ───────────────────────── 낱말 찾기 ───────────────────────── */

/** 찾은 구간을 같은 길이의 빈칸으로 덮어, 긴 낱말 안의 짧은 낱말이 다시 잡히지 않게 한다. */
function mask(text, index, length) {
  return text.slice(0, index) + '□'.repeat(length) + text.slice(index + length);
}

/** "화정1동" → "화정" (번호 없는 "화정동"으로 물었을 때 1~4동을 함께 찾기 위함). */
const dongBase = name => name.replace(/\d*동$/, '');

/**
 * 질문에 나온 행정동. "화정동"처럼 번호 없이 쓰면 화정1~4동을 모두 돌려준다.
 * @returns {{dongs: object[], rest: string}} rest 는 동 이름을 가린 나머지 문장
 */
export function findDongs(store, compact) {
  let rest = compact;
  const found = [];
  const names = [...store.dongs].sort((a, b) => b.name.length - a.name.length);
  for (const dong of names) {
    const at = rest.indexOf(dong.name.toLowerCase());
    if (at < 0) continue;
    found.push({ at, dong });
    rest = mask(rest, at, dong.name.length);
  }
  const bases = [...new Set(store.dongs.map(d => dongBase(d.name)))].sort((a, b) => b.length - a.length);
  for (const base of bases) {
    const word = `${base}동`;
    const at = rest.indexOf(word);
    if (at < 0 || base.length < 2) continue;
    for (const dong of store.dongs.filter(d => dongBase(d.name) === base)) found.push({ at, dong });
    rest = mask(rest, at, word.length);
  }
  found.sort((a, b) => a.at - b.at);
  return { dongs: [...new Set(found.map(f => f.dong))], rest };
}

/**
 * 질문에 나온 분류 낱말을 엔진의 분류로 바꾼다.
 * @returns {{at: number, end: number, word: string, dataset: object}[]} 나온 순서대로
 */
export function findCategories(store, compact) {
  let rest = compact;
  const found = [];
  for (const [word, term] of CATEGORY_WORDS) {
    let at = rest.indexOf(word);
    while (at >= 0) {
      rest = mask(rest, at, word.length);
      try {
        found.push({ at, end: at + word.length, word, dataset: resolveCategory(store, term) });
      } catch {
        // 이 자료 폴더에 없는 분류는 건너뛴다.
      }
      at = rest.indexOf(word);
    }
  }
  found.sort((a, b) => a.at - b.at);
  // 같은 자료를 두 번 말한 경우 첫 번째만 남긴다.
  return found.filter((item, index) => found.findIndex(other => other.dataset.id === item.dataset.id) === index);
}

/** "150m", "반경 300미터", "1.5km" → 미터. 없으면 null. */
export function parseRadius(text) {
  const match = String(text).toLowerCase().match(RE.radius);
  if (!match) return null;
  const value = Number(match[1]) * (/^k|^킬/.test(match[2]) ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const pad = value => String(value).padStart(2, '0');

/** 지금 시각을 한국시간 달력 값으로. */
function kstParts(now) {
  const shifted = new Date(now + 9 * 3600 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** "8월 1일 오후 2시 30분" → {datetime:'YYYY-MM-DDTHH:mm', assumedDate}. 시각이 없으면 null. */
export function parseDatetime(text, now = Date.now()) {
  const hourMatch = text.match(RE.hour);
  if (!hourMatch) return null;
  let hour = Number(hourMatch[2]);
  const half = hourMatch[1] || '';
  if (/오후|저녁|밤/.test(half) && hour < 12) hour += 12;
  if (half === '낮' && hour < 6) hour += 12;
  if (/오전|새벽|아침/.test(half) && hour === 12) hour = 0;
  if (hour > 23) return null;
  const minute = hourMatch[4] ? 30 : Math.min(59, Number(hourMatch[3] || 0));

  const today = kstParts(now);
  const dayMatch = text.match(RE.monthDay);
  const yearMatch = text.match(RE.year);
  const year = yearMatch ? Number(yearMatch[1]) : today.year;
  const month = dayMatch ? Number(dayMatch[1]) : today.month;
  const day = dayMatch ? Number(dayMatch[2]) : today.day;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { datetime: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`, assumedDate: !dayMatch };
}

/* ───────────────────────── 도구 실행 ───────────────────────── */

/** 한 질문에서 부른 도구와 결과를 모은다. 입력 오류(SpatialError)는 결과로 남기고 계속한다. */
class Run {
  constructor(ctx) {
    this.ctx = ctx;
    this.steps = [];
    this.results = [];
    this.notes = [];
  }

  async call(tool, args) {
    if (this.steps.length >= MAX_TOOL_CALLS) return null;
    try {
      const result = await callTool(tool, args, this.ctx);
      this.steps.push({ tool, args, ok: result.ok, summary: result.summary });
      this.results.push({ tool, args, result });
      return result;
    } catch (error) {
      if (!(error instanceof SpatialError)) throw error;
      this.steps.push({ tool, args, ok: false, summary: error.message });
      this.results.push({ tool, args, result: null, error });
      return null;
    }
  }
}

const names = (rows, pick, limit = 5) => rows.slice(0, limit).map(pick).join(', ');

/** 요약문 뒤에 붙이는 한 줄. 모두 도구 결과(data)의 값이다. */
function detailLine(tool, data) {
  if (!data) return '';
  if (tool === 'coverage_gap' && data.rows?.length) {
    return `가장 가까운 '${data.service.title}' 수록 지점이 먼 순: ${names(data.rows, r => `${r.name}(${r.nearestServiceM === null ? '거리 미상' : `약 ${fmt(r.nearestServiceM)}m`})`)}.`;
  }
  if (tool === 'nearest' && data.rows?.length) {
    return `가까운 순: ${names(data.rows, r => `${r.name}(약 ${fmt(r.distanceM)}m)`)}.`;
  }
  if (tool === 'find_facilities' && data.rows?.length) {
    return `수록 지점${data.rows.length > 5 ? ' 일부' : ''}: ${names(data.rows, r => (r.distanceM === undefined ? r.name : `${r.name}(약 ${fmt(r.distanceM)}m)`))}.`;
  }
  if (tool === 'flood_history' && data.byDong?.length) {
    return `동별 수록 건수가 많은 순: ${names(data.byDong, r => `${r.dongName} ${fmt(r.count)}건`, 3)}. 건수 차이에는 집계·공개 범위의 차이가 섞여 있습니다.`;
  }
  if (tool === 'compare_dongs' && data.rows?.length > 2) {
    const key = data.sortedBy;
    const value = row => (data.perKm2 ? row.perKm2?.[key] : row.counts?.[key]);
    return `많은 순: ${names(data.rows.filter(r => value(r) !== null && value(r) !== undefined), r => `${r.dongName} ${fmt(value(r))}`, 3)}.`;
  }
  if (tool === 'list_datasets' && data.datasets?.length) {
    const connected = data.datasets.filter(d => d.connected && d.queryable);
    return `질문할 수 있는 분류 예: ${names(connected, d => d.title, 8)}.`;
  }
  if (tool === 'locate' && data.matches?.length) {
    return `후보: ${names(data.matches, m => (m.type === 'dong' ? `${m.name}(행정동)` : `${m.name}(${m.dongName || '동 경계 밖'})`))}.`;
  }
  return '';
}

/** 동이 여러 개(화정1~4동)면 동마다 한 번씩 부른다. */
async function perDong(run, tool, args, dongs) {
  if (!dongs.length) return run.call(tool, args);
  const list = dongs.slice(0, MAX_DONGS_PER_QUESTION);
  if (dongs.length > list.length) run.notes.push(`동이 많아 ${list.map(d => d.name).join(', ')}만 조회했습니다.`);
  for (const dong of list) await run.call(tool, { ...args, dong: dong.name });
  return null;
}

/* ───────────────────────── 의도별 처리 ───────────────────────── */

/** 사각지대: 부정 표현 바로 앞의 분류가 "있어야 하는 서비스", 나머지가 대상. */
function gapRoles(categories, compact) {
  const negative = compact.search(RE.gap);
  if (categories.length >= 2) {
    const before = categories.filter(c => c.end <= negative);
    const service = before.length ? before.at(-1) : categories[0];
    const target = categories.find(c => c !== service);
    return { target, service };
  }
  return null;
}

async function runGap(run, q) {
  let roles = gapRoles(q.categories, q.compact);
  if (!roles) {
    // 분류를 하나만 말했으면 버스정류장↔그늘막을 기본 짝으로 쓰고, 그렇게 가정했다고 알린다.
    const only = q.categories[0];
    const partnerWord = only.dataset.id === 'bus' ? '그늘막' : '버스정류장';
    let partner;
    try {
      partner = resolveCategory(q.store, partnerWord);
    } catch {
      return false;
    }
    roles = only.dataset.id === 'bus'
      ? { target: only, service: { dataset: partner } }
      : { target: { dataset: partner }, service: only };
    run.notes.push(`대상을 따로 말하지 않아 '${roles.target.dataset.title}' 기준으로 살폈습니다.`);
  }
  const args = { target: roles.target.dataset.id, service: roles.service.dataset.id };
  if (q.radiusM) args.radiusM = q.radiusM;
  await perDong(run, 'coverage_gap', args, q.dongs);
  return true;
}

async function runCompare(run, q) {
  const args = { categories: q.categories.slice(0, 8).map(c => c.dataset.id) };
  if (RE.density.test(q.compact)) args.perKm2 = true;
  if (q.namedDongs.length >= 2) args.dongs = q.namedDongs.map(d => d.name);
  await run.call('compare_dongs', args);
  return true;
}

async function runFlood(run, q) {
  const args = {};
  const year = q.text.match(RE.year);
  if (year) {
    const value = Number(year[1]);
    if (/이후|부터/.test(q.compact)) args.yearFrom = value;
    else if (/이전|까지/.test(q.compact)) args.yearTo = value;
    else Object.assign(args, { yearFrom: value, yearTo: value });
    run.notes.push(`연도 조건(${[args.yearFrom && `${args.yearFrom}년부터`, args.yearTo && `${args.yearTo}년까지`].filter(Boolean).join(' ')})에 맞는 기록만 살폈습니다.`);
  }
  if (q.place) {
    await run.call('flood_history', { ...args, place: q.place, ...(q.radiusM ? { radiusM: q.radiusM } : {}) });
    return true;
  }
  // "침수 기록이 많은 동"처럼 동끼리 견주는 질문은 서구 전체를 동별로 집계한다.
  const dongs = RE.compare.test(q.compact) ? q.namedDongs : q.dongs;
  // 서구 전체를 볼 때는 지도에 그릴 지점을 넉넉히 받는다(집계는 항상 전체 기준).
  await perDong(run, 'flood_history', dongs.length ? args : { ...args, limit: 200 }, dongs);
  return true;
}

async function runSun(run, q) {
  const when = parseDatetime(q.text, q.now);
  if (!when) return false;
  const args = { datetime: when.datetime };
  if (q.place) args.place = q.place;
  else if (q.dongs[0]) args.dong = q.dongs[0].name;
  const height = q.text.toLowerCase().match(/(\d{1,3}(?:\.\d+)?)\s*(?:m|미터)/);
  if (height && /그림자|높이/.test(q.compact)) args.heightM = Number(height[1]);
  if (when.assumedDate) run.notes.push('날짜를 말하지 않아 오늘(한국시간) 날짜로 계산했습니다.');
  await run.call('sun_position', args);
  return true;
}

async function runNearest(run, q) {
  const category = q.categories[0].dataset.id;
  const place = q.place || q.dongs[0]?.name;
  if (!place) {
    run.notes.push('기준 장소가 필요합니다. "서구청에서 가장 가까운 그늘막"처럼 동 이름이나 시설 이름을 함께 적어 주세요.');
    return true;
  }
  const count = q.text.match(RE.count);
  await run.call('nearest', { category, place, ...(count ? { n: Math.min(50, Math.max(1, Number(count[1]))) } : {}) });
  return true;
}

async function runFind(run, q) {
  const category = q.categories[0].dataset.id;
  if (q.place) {
    await run.call('find_facilities', { category, place: q.place, ...(q.radiusM ? { radiusM: q.radiusM } : {}) });
    return true;
  }
  await perDong(run, 'find_facilities', { category }, q.dongs);
  return true;
}

/** "서구청 어디야?", "가람초등학교 위치" → 어디/위치 앞의 낱말이 수록 시설 이름이면 이름 검색. */
async function runLocate(run, q) {
  const match = q.text.match(/([가-힣a-zA-Z0-9]{2,20}?)(?:은|는|이|가|의)?\s*(?:어디|위치|좌표|찾아)/);
  if (!match || !(await isPlaceName(q.store, match[1], run.ctx))) return false;
  await run.call('locate', { query: match[1] });
  return true;
}

/* ───────────────────────── 질문 해석 ───────────────────────── */

/** 동 이름·분류 낱말·지시어가 아니면서 수록 자료의 이름 검색에 걸리는 낱말인지. */
async function isPlaceName(store, token, ctx) {
  const compact = squash(token);
  if (findDongs(store, compact).dongs.length) return false;
  if (CATEGORY_WORDS.some(([word]) => word === compact)) return false;
  if (/^(여기|거기|이곳|우리|지금|현재|서구|광주)$/.test(compact)) return false;
  try {
    return (await callTool('locate', { query: token, limit: 1 }, ctx)).ok;
  } catch {
    return false; // 찾지 못한 낱말은 장소가 아닌 것으로 본다.
  }
}

/** 기준 장소("서구청에서", "풍암초 근처")를 찾는다. */
async function findPlace(q, ctx) {
  for (const match of q.text.matchAll(RE.place)) {
    if (await isPlaceName(q.store, match[1], ctx)) return match[1];
  }
  return null;
}

async function parseQuestion(question, context, ctx) {
  const store = getStore(ctx.dataDir);
  const text = String(question).trim();
  const q = { store, text, compact: squash(text), now: ctx.now ?? Date.now() };

  q.place = await findPlace(q, ctx);
  const withoutPlace = q.place ? q.compact.replace(squash(q.place), '□'.repeat(squash(q.place).length)) : q.compact;
  const { dongs, rest } = findDongs(store, withoutPlace);
  q.namedDongs = dongs;
  // 질문에 동이 없으면 화면에서 고른 동을 문맥으로 쓴다.
  const selected = context.dongId ? store.dongs.find(d => d.id === context.dongId) : null;
  // 질문·화면 선택이 모두 없을 때에만 검토 원문에 명시된 행정동을 참고한다.
  // 개별 장소의 주소·좌표나 사업 경계를 확인하는 기능은 아니다.
  const reviewDongs = isCivicTheme(context.reviewContext?.theme) ? findDongs(store, squash(context.reviewContext.text || '')).dongs : [];
  q.dongs = dongs.length ? dongs : (selected ? [selected] : reviewDongs);
  q.usedContextDong = !dongs.length && Boolean(selected);
  q.categories = findCategories(store, rest).filter(c => !c.dataset.id.includes('flood'));
  q.radiusM = parseRadius(text);
  q.reviewTheme = isCivicTheme(context.reviewContext?.theme) ? context.reviewContext.theme : null;
  q.reviewCategories = findCategories(store, squash([text, context.reviewContext?.text || '', ...(context.reviewContext?.alternatives || [])].join(' ')));
  return q;
}

/** 의도를 고르고 도구를 부른다. 처리한 의도 이름을 돌려준다(없으면 null). */
async function dispatch(run, q) {
  const has = re => re.test(q.compact);
  // 검토노트의 유형은 사용자가 선택한 문맥이다. 후속 질문도 같은 검토자료를 사용한다.
  // 자연어 질문에서도 업무 표현을 먼저 확인해 '공간 대안 비교'를 시설 수 비교로 오해하지 않는다.
  const civicThemes = [
    ['coordination', /사업연계|사업조정|사업간|부서간.*(?:사업|공사|연계|협업)|(?:사업|공사).*(?:중복|연계|협업|일정조정)/],
    ['reuse', /유휴|공간재활용|시설재활용|공간재사용|빈공간|빈건물|공간공유|공간활용|시설활용|복합활용|용도전환|기존공간|기존시설.*활용/],
    ['agenda', /마을의제|마을문제|마을계획|주민제안|주민자치.*(?:의제|논의|검토)|의제설정|의제발굴/],
    ['space', /도시설계|공공공간|공간대안|공간비교|공간설계|공간재구성|(?:공원|광장|놀이터|주차장|거리|보행).*(?:재설계|재구성|조성안|개선안|대안)/],
  ];
  const civicTheme = q.reviewTheme || civicThemes.find(([, pattern]) => pattern.test(q.compact))?.[0];
  if (civicTheme) {
    const categories = q.reviewCategories.slice(0, 4).map(c => c.dataset.id);
    await perDong(run, 'work_brief', {theme: civicTheme, ...(categories.length ? {categories} : {})}, q.dongs);
    return 'work_brief';
  }
  if (has(RE.datasets)) {
    await run.call('list_datasets', {});
    return 'list_datasets';
  }
  // 시설명 하나가 아니라 업무를 물으면 관련 자료와 실제 공간 계산을 묶는다.
  const work = /대응|점검|준비|계획|검토|정리|필요|확인사항|대책|우선순위|어디부터|해야/;
  const themes = [['heat', /폭염|무더위|더위/], ['cold', /한파|추위/], ['icing', /결빙|블랙아이스|제설/], ['flood', /침수|호우/], ['school', /통학|어린이안전/], ['living', /생활시설|생활인프라/]];
  const theme = themes.find(([, pattern]) => pattern.test(q.compact));
  if (theme && work.test(q.compact)) {
    const args = { theme: theme[0], ...(q.radiusM ? { radiusM: q.radiusM } : {}) };
    await perDong(run, 'work_brief', args, q.dongs);
    return 'work_brief';
  }
  // '해'는 낱말 경계를 봐야 하므로 띄어쓰기가 남은 원문에서 찾는다.
  if (RE.sun.test(q.text) && RE.hour.test(q.text) && await runSun(run, q)) return 'sun_position';
  if (has(RE.flood)) return (await runFlood(run, q)) && 'flood_history';
  // "가람초등학교 어디야?"처럼 시설 이름 자체를 묻는 경우(분류 낱말이 이름 안에 들어 있어도 이름 검색이 먼저).
  const plain = !has(RE.gap) && !has(RE.compare) && !has(RE.nearest) && !q.place;
  if (plain && has(RE.where) && await runLocate(run, q)) return 'locate';
  if (q.categories.length) {
    if (has(RE.gap) && await runGap(run, q)) return 'coverage_gap';
    if (has(RE.compare)) return (await runCompare(run, q)) && 'compare_dongs';
    if (has(RE.nearest)) return (await runNearest(run, q)) && 'nearest';
    return (await runFind(run, q)) && 'find_facilities';
  }
  if (q.namedDongs.length) {
    for (const dong of q.namedDongs.slice(0, MAX_DONGS_PER_QUESTION)) await run.call('dong_profile', { dong: dong.name });
    return 'dong_profile';
  }
  if (q.place) {
    await run.call('locate', { query: q.place });
    return 'locate';
  }
  return null;
}

/* ───────────────────────── 답 만들기 ───────────────────────── */

export const RULES_NOTICE = '규칙 기반 답변입니다(AI 미사용). 정해진 질문 유형에 따라 자료를 조회·공간 계산하고 확인사항을 정리했습니다.';

function helpAnswer() {
  return [
    '이 질문은 지도에 실린 자료로 답하는 방법을 찾지 못했습니다.',
    '동 이름과 시설 종류를 넣어 다시 물어 주세요.',
    `예: ${ASK_EXAMPLES.slice(0, 3).map(e => `"${e}"`).join(', ')}`,
  ].join(' ');
}

function compose(run, q) {
  const parts = [];
  for (const { tool, result, error } of run.results) {
    if (error) {
      parts.push(error.message);
      continue;
    }
    parts.push(result.summary);
    const detail = result.ok ? detailLine(tool, result.data) : '';
    if (detail) parts.push(detail);
  }
  if (q.usedContextDong && run.results.some(r => r.args.dong)) {
    parts.push(`동을 말하지 않아 화면에서 고른 ${q.dongs[0].name} 기준으로 답했습니다.`);
  }
  parts.push(...run.notes);
  return parts.join(' ');
}

/**
 * 규칙 기반으로 질문에 답한다.
 * @param {string} question
 * @param {{dongId?: string}} context 화면에서 고른 동
 * @param {{dataDir?: string, now?: number}} ctx
 * @returns {Promise<{matched: boolean, intent: string|null, answer: string, results: object[], steps: object[]}>}
 */
export async function answerByRules(question, context = {}, ctx = {}) {
  const run = new Run(ctx);
  const q = await parseQuestion(question, context, ctx);
  const intent = await dispatch(run, q);
  if (!intent || (!run.results.length && !run.notes.length)) {
    return { matched: false, intent: null, answer: helpAnswer(), results: [], steps: [] };
  }
  return { matched: true, intent, answer: compose(run, q), results: run.results, steps: run.steps };
}
