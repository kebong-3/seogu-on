/**
 * A model selects references and follow-up checks; it never supplies the facts or numbers.
 * All factual sentences are rendered from a separately validated calculation. This constrains
 * this explanation path, not the truth of field records or every possible AI answer in the app.
 */
const metricRefs = new Set(['eligibleCount', 'unknownCount', 'overlapHours', 'additionalAnnualCost', 'delta.eligibleCount', 'delta.overlapHours']);
const rowRefs = new Set(['availability', 'overlapMinutes']);
const followupKinds = new Set(['recheck-record', 'reservation', 'holiday', 'staffing', 'approval', 'capacity', 'demand', 'cost-basis']);
const dayName = day => ['월','화','수','목','금','토','일'][day - 1];
const bad = message => { throw new Error(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, required, label) {
  if (!isObject(value) || Object.keys(value).length !== required.length || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key))) bad(`${label}의 참조 형식을 확인하세요.`);
}
function list(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max) bad(`${label} 개수를 확인하세요.`);
  if (new Set(value.map(item => JSON.stringify(item))).size !== value.length) bad(`${label}가 중복되었습니다.`);
}
const metrics = c => [c.baseline, ...c.alternatives];
function resolve(c, reference) {
  const metric = metrics(c).find(m => m.id === reference.scenarioId);
  if (!metric) bad('계산 결과에 없는 대안을 참조했습니다.');
  if (reference.assetId !== null && typeof reference.assetId !== 'string') bad('공간 참조 형식을 확인하세요.');
  const row = reference.assetId === null ? null : metric.rows.find(r => r.assetId === reference.assetId);
  if (reference.assetId !== null && !row) bad('해당 대안에 없는 공간을 참조했습니다.');
  return {metric, row};
}
const scheduleKey = row => JSON.stringify([row.operatingStatus, row.daysOfWeek, row.opens, row.closes]);
const prefix = metric => metric.kind === 'current-records' ? '현재 사용자 확인기록' : `입력 가정 ‘${metric.name}’`;
const signed = value => `${value > 0 ? '+' : ''}${value}`;

/** The only allowed model output. No prose, numeric values, authority labels or arbitrary causes. */
export function validateSpaceExplanation(value, comparison) {
  fields(value, ['version', 'claims', 'causes', 'followups'], 'AI 근거 선택');
  if (value.version !== 1) bad('지원하지 않는 AI 근거 형식입니다.');
  list(value.claims, 1, 4, '검토 초점'); list(value.causes, 0, 3, '조건 차이'); list(value.followups, 1, 4, '후속 확인');
  const claims = value.claims.map(ref => {
    fields(ref, ['scenarioId', 'assetId', 'metricRef'], '지표');
    const {metric, row} = resolve(comparison, ref);
    if (!(row ? rowRefs : metricRefs).has(ref.metricRef)) bad('허용하지 않는 계산 지표를 참조했습니다.');
    if (ref.metricRef.startsWith('delta.') && (metric.kind !== 'user-scenario' || !metric.comparable || !metric.delta)) bad('미확인 자료가 있거나 기준안이므로 변화량을 주장할 수 없습니다.');
    return {scenarioId:metric.id, assetId:row?.assetId || null, metricRef:ref.metricRef};
  });
  const causes = value.causes.map(ref => {
    fields(ref, ['scenarioId', 'assetId', 'kind'], '조건 차이');
    const {metric, row} = resolve(comparison, ref), current = comparison.baseline.rows.find(r => r.assetId === ref.assetId);
    if (metric.kind !== 'user-scenario' || !row || row.provenance !== 'user-assumption') bad('조건 차이는 해당 변경 가정의 공간에 연결해야 합니다.');
    if (ref.kind === 'schedule-change') {
      if (current.availability === 'unknown' || row.availability === 'unknown' || scheduleKey(current) === scheduleKey(row)) bad('확인된 운영조건과 달라진 가정이 있어야 조건 차이를 설명할 수 있습니다.');
    } else if (ref.kind === 'current-unverified') {
      if (current.availability !== 'unknown') bad('현재 미확인인 공간에만 미확인 원인을 연결할 수 있습니다.');
    } else bad('운영조건으로 확인할 수 없는 원인을 주장했습니다.');
    return {scenarioId:metric.id, assetId:row.assetId, kind:ref.kind};
  });
  const followups = value.followups.map(ref => {
    fields(ref, ['scenarioId', 'assetId', 'kind'], '후속 확인');
    const {metric, row} = resolve(comparison, ref);
    if (!followupKinds.has(ref.kind)) bad('허용하지 않는 후속 확인 항목입니다.');
    if (ref.kind === 'recheck-record' && !(row ? row.availability === 'unknown' : metric.unknownCount > 0)) bad('미확인 근거가 있는 공간에 재확인을 연결하세요.');
    if (ref.kind === 'cost-basis' && (metric.kind !== 'user-scenario' || row)) bad('비용 검토는 변경안의 입력 가정 합계에 연결하세요.');
    return {scenarioId:metric.id, assetId:row?.assetId || null, kind:ref.kind};
  });
  return {version:1, claims, causes, followups};
}

export function spaceRulesSummary(comparison) {
  const c = comparison, b = c.baseline;
  const lines = [`${dayName(c.query.dayOfWeek)}요일 ${c.query.start}~${c.query.end}, 선택한 ${c.selectedCount}개 공간 중 현재 사용자 확인기록으로 요청 시간 전체에 개방 조건을 충족하는 공간은 ${b.eligibleCount}개이며 미확인은 ${b.unknownCount}개입니다.`];
  for (const a of c.alternatives) lines.push(`입력 가정 ‘${a.name}’에서는 조건 충족 ${a.eligibleCount}개, 미확인 ${a.unknownCount}개, 요청 시간과 겹치는 공간별 개방시간 합계 ${a.overlapHours}시간입니다. ${a.comparable ? `현재 확인기록 대비 조건 충족 공간 변화는 ${signed(a.delta.eligibleCount)}개입니다.` : '미확인 기록이 있어 전체 변화량은 산정하지 않았습니다.'} 추가 연간 운영비는 ${a.additionalAnnualCost === null ? '미산정입니다' : `입력 가정 합계 ${a.additionalAnnualCost}만원입니다`}.`);
  lines.push('대안은 사용자 가정입니다. 예약·공휴일·운영 인력·이용 수요·사용 승인 여부를 담당 부서와 확인한 뒤 현장 확인기록을 갱신하세요.');
  return lines.join('\n\n');
}

function claimText(ref, c) {
  const {metric:m, row:r} = resolve(c, ref), label = prefix(m);
  switch (ref.metricRef) {
    case 'eligibleCount': return `${label}: 요청 시간 전체의 개방 조건 충족 공간 ${m.eligibleCount}개. 실제 예약·사용 가능 여부는 별도 확인사항입니다.`;
    case 'unknownCount': return `${label}: 운영조건 미확인 ${m.unknownCount}개. 미확인은 개방 불가나 이용 수요가 없다는 뜻이 아닙니다.`;
    case 'overlapHours': return `${label}: 공간별로 요청 시간과 겹치는 개방시간 합계 ${m.overlapHours}시간. 주민 이용시간이나 인력 근무시간이 아닙니다.`;
    case 'additionalAnnualCost': return m.kind === 'current-records' ? '현재안의 추가 연간 운영비 0만원은 추가분 비교 기준이며 기존 총운영비가 아닙니다.' : `${label}: 추가 연간 운영비는 ${m.additionalAnnualCost === null ? '미산정' : `${m.additionalAnnualCost}만원/년의 사용자 입력 가정 합계`}입니다. 견적이나 확정 예산이 아닙니다.`;
    case 'delta.eligibleCount': return `${label}: 현재 확인기록 대비 요청 시간 전체의 개방 조건 충족 공간 변화 ${signed(m.delta.eligibleCount)}개. 가정에 따른 계산 차이이며 실측 사업 효과가 아닙니다.`;
    case 'delta.overlapHours': return `${label}: 현재 확인기록 대비 공간별 개방시간 합계 변화 ${signed(m.delta.overlapHours)}시간. 가정에 따른 계산 차이입니다.`;
    case 'availability': return `${label}의 ‘${r.name}’: ${availabilityText(r)}.`;
    case 'overlapMinutes': return `${label}의 ‘${r.name}’: ${r.availability === 'unknown' ? '운영조건 미확인으로 개방시간을 확정할 수 없습니다.' : `요청 시간과 겹치는 개방시간 ${r.overlapMinutes}분입니다.`}`;
    default: bad('허용하지 않는 지표입니다.');
  }
}
function availabilityText(row) {
  return row.availability === 'eligible' ? '요청 시간 전체의 개방 조건 충족' : row.availability === 'unknown' ? `운영조건 미확인 (${row.reason})` : `요청 시간 전체의 개방 조건 미충족 (${row.reason})`;
}
function condition(row) {
  if (row.operatingStatus === 'closed') return '운영 중단';
  if (row.operatingStatus === 'unknown') return '운영조건 미확인';
  return `${row.daysOfWeek.map(dayName).join('·')}요일 ${row.opens}~${row.closes}`;
}
function causeText(ref, c) {
  const {metric, row} = resolve(c, ref), current = c.baseline.rows.find(r => r.assetId === ref.assetId);
  if (ref.kind === 'current-unverified') return `${prefix(metric)}의 ‘${row.name}’은 ${condition(row)} 조건을 입력했으나 현재 사용자 확인기록은 미확인입니다. 이 공간의 개방 증가나 전체 대안의 우열을 확정할 수 없으므로 현재 운영조건부터 확인해야 합니다.`;
  return `${prefix(metric)}의 ‘${row.name}’은 현재 사용자 확인기록(${condition(current)})을 ${condition(row)} 조건으로 바꾼 가정입니다. 요청 조건 ${dayName(c.query.dayOfWeek)}요일 ${c.query.start}~${c.query.end}에 대한 결과는 ‘${availabilityText(current)}’에서 ‘${availabilityText(row)}’로 계산됩니다.`;
}
const followupText = {
  'recheck-record': '운영 요일·시간과 확인일을 담당자에게 재확인하고 현장 확인기록을 갱신하세요. 미확인 상태에서는 변화량을 확정하지 마세요.',
  reservation: '같은 시간의 기존 예약·행사 중복과 실제 대관 가능 여부를 확인하세요.',
  holiday: '공휴일·임시 휴관·특별행사 예외가 입력한 운영조건에 반영되는지 확인하세요.',
  staffing: '개방·안전관리·청소를 맡을 인력의 실제 배치 가능 여부를 담당 부서와 협의하세요.',
  approval: '관리 주체의 사용 승인과 적용되는 대관 조건을 확인하세요. 이 계산은 사용 승인이 아닙니다.',
  capacity: '정원·시설 설비·이동 접근 조건이 예정 활동에 맞는지 현장에서 확인하세요.',
  demand: '주민 의견과 실제 이용 수요를 별도로 확인하세요. 개방시간 차이로 이용자 수나 만족도를 추정할 수 없습니다.',
  'cost-basis': '입력한 추가 연간 운영비의 기간·인력·관리 항목을 담당 부서 및 견적 자료와 대조하세요. 미산정은 비용이 없다는 뜻이 아닙니다.',
};

/** Exact reproducible prose: all labels, metric values and causal conditions come from the comparison. */
export function renderSpaceExplanation(value, comparison) {
  const plan = validateSpaceExplanation(value, comparison);
  return [spaceRulesSummary(comparison), `AI가 고른 검토 초점\n${plan.claims.map(ref => claimText(ref, comparison)).join('\n')}`,
    ...(plan.causes.length ? [`조건 차이의 근거\n${plan.causes.map(ref => causeText(ref, comparison)).join('\n')}`] : []),
    `AI가 제안한 확인 순서\n${plan.followups.map((ref, i) => {const {metric, row} = resolve(comparison, ref);return `${i + 1}. ${prefix(metric)}${row ? ` · ‘${row.name}’` : ''}: ${followupText[ref.kind]}`;}).join('\n')}`,
  ].join('\n\n');
}

/** Compact vocabulary plus precomputed causal references, without repeating every row for every check. */
export function spaceExplanationOptions(comparison) {
  const causes = [];
  for (const m of metrics(comparison)) {
    for (const r of m.rows) {
      if (m.kind === 'user-scenario' && r.provenance === 'user-assumption') {
        const current = comparison.baseline.rows.find(row => row.assetId === r.assetId);
        if (current.availability === 'unknown') causes.push({scenarioId:m.id, assetId:r.assetId, kind:'current-unverified'});
        else if (r.availability !== 'unknown' && scheduleKey(current) !== scheduleKey(r)) causes.push({scenarioId:m.id, assetId:r.assetId, kind:'schedule-change'});
      }
    }
  }
  return {metricRefs:[...metricRefs], rowRefs:[...rowRefs], followupKinds:[...followupKinds], causes};
}
