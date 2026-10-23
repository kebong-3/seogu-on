/**
 * Carry only conditions stated in a question into a review draft.
 * This parser never confirms facility operations or chooses a day for “주말”.
 */
const DAY_NAMES = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
const TIME_RANGE = /(오전|오후)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)?\s*(?:부터|에서|[~〜～–—-])\s*(오전|오후)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)?\s*(?:까지)?/g;
const clock = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
const text = value => typeof value === 'string' ? value.trim() : '';

function timeNumber(hour, minute, period, inherited = false, first = null) {
  let h = Number(hour), m = Number(minute || 0);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return null;
  if (period) {
    if (h < 1 || h > 12) return null;
    if (period === '오후') h = h % 12 + 12;
    else if (h === 12) h = inherited && first > 0 ? 12 : 0;
  }
  return {value: h * 60 + m, label: clock(h, m)};
}

/** Explicit day/time only; region identifiers come from the selected, validated profile. */
export function parseSpaceQueryIntent(question, context = {}) {
  const sourceQuestion = text(question).replace(/\s+/g, ' ').slice(0, 1200);
  const daysOfWeek = DAY_NAMES.flatMap((day, index) => sourceQuestion.includes(day) ? [index + 1] : []);
  const dayOfWeek = daysOfWeek.length === 1 ? daysOfWeek[0] : null;
  const notices = [];
  if (daysOfWeek.length > 1) notices.push('여러 요일을 적었습니다. 이번 비교에서 볼 요일 하나를 선택하세요.');
  else if (!dayOfWeek && /주말/.test(sourceQuestion)) notices.push('“주말”만으로 토요일과 일요일을 정하지 않았습니다. 비교할 요일을 선택하세요.');
  else if (!dayOfWeek && /평일/.test(sourceQuestion)) notices.push('“평일” 중 비교할 요일 하나를 선택하세요.');
  const ranges = [];
  const calendarDates = [...sourceQuestion.matchAll(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g)].map(match => [match.index, match.index + match[0].length]);
  for (const match of sourceQuestion.matchAll(TIME_RANGE)) {
    const matchEnd = match.index + match[0].length;
    if (calendarDates.some(([start, end]) => match.index < end && matchEnd > start)) continue;
    if (/\d/.test(sourceQuestion[match.index - 1] || '') || /^\d/.test(sourceQuestion.slice(matchEnd))) continue;
    // Bare ranges next to count/cost units are not operating times.
    const after = sourceQuestion.slice(matchEnd);
    if (/^\s*(?:명|개|원|만원|천원|년|월|일|분|간|미터|m\b)/.test(after)) continue;
    if (!match[1] && Number(match[2]) <= 12 && /(?:저녁|아침|새벽|낮|밤)\s*$/.test(sourceQuestion.slice(0, match.index))) {
      ranges.push(null); continue;
    }
    const first = timeNumber(match[2], match[3] || match[4], match[1]);
    const inheritedPeriod = !match[5] && Number(match[6]) <= 12 ? match[1] : undefined;
    const second = timeNumber(match[6], match[7] || match[8], match[5] || inheritedPeriod, !!inheritedPeriod, first?.value);
    ranges.push(first && second && second.value > first.value ? {start: first.label, end: second.label} : null);
  }
  const uniqueRanges = [...new Map(ranges.filter(Boolean).map(range => [`${range.start}/${range.end}`, range])).values()];
  const time = ranges.length && ranges.every(Boolean) && uniqueRanges.length === 1 ? uniqueRanges[0] : {start: '', end: ''};
  if (ranges.some(range => !range)) notices.push('시작·종료 시각을 확정하지 않았습니다. 오전·오후 또는 같은 날의 24시간제로 확인하세요. 심야에 날짜가 바뀌는 일정은 한 번에 계산하지 않습니다.');
  else if (uniqueRanges.length > 1) notices.push('질문에 여러 시간대가 있습니다. 이번에 비교할 이용시간 하나를 선택하세요.');
  const participantMatch = sourceQuestion.match(/(?<!\d)(\d{1,4})\s*명/);
  const participantCount = participantMatch ? Number(participantMatch[1]) : null;
  const missing = [!dayOfWeek && '검토 요일', !time.start && '이용 시작·종료 시각'].filter(Boolean);
  return {
    version: 1, sourceQuestion,
    regionId: text(context.regionId), regionName: text(context.regionName),
    dongId: text(context.dongId) || 'all', scopeLabel: text(context.scopeLabel),
    dayOfWeek, daysOfWeek, start: time.start, end: time.end,
    participantCount: participantCount > 0 ? participantCount : null,
    missing, notices, ready: missing.length === 0,
  };
}

/** Do not insert a default day or clock value when a draft is incomplete. */
export function queryFromIntent(intent) {
  return {dayOfWeek: Number.isInteger(intent?.dayOfWeek) && intent.dayOfWeek >= 1 && intent.dayOfWeek <= 7 ? intent.dayOfWeek : null,
    start: /^\d{2}:\d{2}$/.test(intent?.start || '') ? intent.start : '',
    end: /^\d{2}:\d{2}$/.test(intent?.end || '') ? intent.end : ''};
}
