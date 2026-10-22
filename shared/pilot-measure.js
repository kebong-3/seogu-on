/** Small, descriptive paired pilot measurements. No generated performance data. */
export const PILOT_VERSION = 1;
export const PILOT_MIN_PAIRS = 3;
export const PILOT_MAX_EVENTS = 2000;
export const PILOT_MAX_BYTES = 2 * 1024 * 1024;
export const PILOT_TASKS = Object.freeze({
  'space-comparison': '공간 운영대안 비교',
  'field-recheck': '현장변경 재검토',
});
const methods = ['baseline', 'seoguOn'];
const own = (value, key) => Object.hasOwn(value, key);
const invalid = message => { throw Error(message); };
function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} 형식을 확인하세요.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__','constructor','prototype'].includes(key) || !own(Object.getOwnPropertyDescriptor(value,key),'value') || !keys.includes(key)) invalid(`${label}에 지원하지 않는 속성이 있습니다.`);
  }
  return value;
}
function text(value, label, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || (!empty && !value.trim())) invalid(`${label}을 확인하세요.`);
  return value.trim();
}
function id(value, label, pattern, max = 64) {
  const result = text(value, label, max);
  if (!pattern.test(result) || ['__proto__','constructor','prototype'].includes(result)) invalid(`${label} 형식을 확인하세요.`);
  return result;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${label}을 YYYY-MM-DD로 기록하세요.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== value) invalid(`${label}이 실제 달력 날짜가 아닙니다.`);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid('측정 입력시각을 확인하세요.');
  return value;
}
function observation(value, label) {
  if (value === null) return null;
  object(value, label, ['seconds','errors','sourceOmissions','evidence']);
  if (typeof value.seconds !== 'number' || !Number.isFinite(value.seconds) || value.seconds < 1 || value.seconds > 86400) invalid(`${label} 완료시간은 1~86,400초의 실제 측정값을 입력하세요.`);
  for (const key of ['errors','sourceOmissions']) if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 10000) invalid(`${label} 오류·출처누락은 0~10,000의 정수로 기록하세요. 확인하지 않은 값은 0으로 입력하지 마세요.`);
  return {seconds:value.seconds, errors:value.errors, sourceOmissions:value.sourceOmissions, evidence:text(value.evidence, `${label} 결과물·채점 근거`, 1500)};
}
function payload(value) {
  object(value, '측정', ['participantId','taskId','conditionId','sequence','sessionDate','conditions','baseline','seoguOn']);
  const participantId = id(value.participantId,'익명 참가자 ID',/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/,32).toUpperCase();
  const conditionId = id(value.conditionId,'측정조건 ID',/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/).toLowerCase();
  if (typeof value.taskId !== 'string' || !own(PILOT_TASKS,value.taskId)) invalid('측정할 대표과제를 선택하세요.');
  if (!['AB','BA'].includes(value.sequence)) invalid('수행순서를 선택하세요.');
  const baseline = observation(value.baseline,'기존방식'), seoguOn = observation(value.seoguOn,'서구온');
  if (!baseline && !seoguOn) invalid('한 가지 방식 이상의 실제 완료시간과 채점 결과를 기록하세요.');
  return {participantId,taskId:value.taskId,conditionId,sequence:value.sequence,sessionDate:date(value.sessionDate,'수행일'),conditions:text(value.conditions,'공통 측정조건',2000),baseline,seoguOn};
}
const regionId = value => id(value,'지역 식별자',/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const eventKeys = ['recordId','revision','action','recordedAt','voidReason','participantId','taskId','conditionId','sequence','sessionDate','conditions','baseline','seoguOn'];
function event(value) {
  object(value,'측정 이력',eventKeys);
  const recordId = id(value.recordId,'기록 식별자',/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/,80);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > PILOT_MAX_EVENTS) invalid('측정 이력 버전을 확인하세요.');
  if (!['record','void'].includes(value.action)) invalid('측정 이력 동작을 확인하세요.');
  const base = Object.fromEntries(['participantId','taskId','conditionId','sequence','sessionDate','conditions','baseline','seoguOn'].map(key => [key,value[key]]));
  const recordedAt=timestamp(value.recordedAt), data=payload(base);
  if (data.sessionDate>new Date(Date.parse(recordedAt)+9*3600000).toISOString().slice(0,10)) invalid('미래 수행일을 실제 완료 기록으로 저장할 수 없습니다.');
  return {recordId,revision:value.revision,action:value.action,recordedAt,voidReason:text(value.voidReason,'제외 사유',600,value.action !== 'void'),...data};
}
const pairKey = record => JSON.stringify([record.participantId,record.taskId,record.conditionId]);
function current(events) { const map = new Map(); for (const item of events) map.set(item.recordId,item); return [...map.values()]; }

export function createPilotBook(region) { return {version:PILOT_VERSION,regionId:regionId(region),events:[]}; }
export function validatePilotBook(input, {regionId:expectedRegion} = {}) {
  object(input,'업무효과 기록',['version','regionId','events']);
  if (input.version !== PILOT_VERSION) invalid('지원하지 않는 업무효과 기록 버전입니다.');
  const region = regionId(input.regionId);
  if (expectedRegion && region !== expectedRegion) invalid('다른 지역의 업무효과 기록입니다.');
  if (!Array.isArray(input.events) || input.events.length > PILOT_MAX_EVENTS) invalid('업무효과 기록은 이력 2,000개까지 보관할 수 있습니다.');
  const events = input.events.map(event), revisions = new Map();
  for (const item of events) {
    const previous = revisions.get(item.recordId);
    if (item.revision !== (previous?.revision || 0) + 1 || (!previous && item.action === 'void')) invalid('측정 이력 순서가 올바르지 않습니다.');
    if (previous && item.recordedAt < previous.recordedAt) invalid('측정 입력시각이 이전 이력보다 이릅니다.');
    revisions.set(item.recordId,item);
  }
  const seen = new Set();
  for (const item of current(events).filter(item => item.action !== 'void')) {
    const key = pairKey(item);
    if (seen.has(key)) invalid('같은 참가자·과제·측정조건의 기록이 중복되었습니다. 기존 기록을 수정하세요.');
    seen.add(key);
  }
  return {version:PILOT_VERSION,regionId:region,events};
}
export function currentPilotRecords(book, {includeVoided = false} = {}) {
  const result = current(validatePilotBook(book).events);
  return includeVoided ? result : result.filter(item=>item.action !== 'void');
}
export function recordPilotMeasurement(book, value, {recordId, now = new Date().toISOString()} = {}) {
  const next = validatePilotBook(book), data = payload(value);
  const previous = recordId ? current(next.events).find(item => item.recordId === recordId) : null;
  if (recordId && !previous) invalid('수정할 측정 기록이 없습니다.');
  const row = {recordId:recordId || `pm-${globalThis.crypto.randomUUID()}`,revision:(previous?.revision || 0)+1,action:'record',recordedAt:timestamp(now),voidReason:'',...data};
  return validatePilotBook({...next,events:[...next.events,row]});
}
export function voidPilotMeasurement(book, recordId, {reason, now = new Date().toISOString()} = {}) {
  const next = validatePilotBook(book), previous = current(next.events).find(item => item.recordId === recordId);
  if (!previous || previous.action === 'void') invalid('제외할 현재 측정 기록이 없습니다.');
  return validatePilotBook({...next,events:[...next.events,{...previous,revision:previous.revision+1,action:'void',recordedAt:timestamp(now),voidReason:text(reason,'제외 사유',600)}]});
}
export function median(values) {
  if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite)) return null;
  const sorted = [...values].sort((a,b)=>a-b), mid=Math.floor(sorted.length/2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
}
/** Positive deltas mean fewer seconds/errors/omissions with SEO:ON. */
export function summarizePilot(book) {
  const records = currentPilotRecords(book), groups = new Map();
  for (const row of records) {
    const key=JSON.stringify([row.taskId,row.conditionId]);
    if (!groups.has(key)) groups.set(key,{taskId:row.taskId,conditionId:row.conditionId,records:[]});
    groups.get(key).records.push(row);
  }
  return [...groups.values()].map(group => {
    const pairs=group.records.filter(row=>row.baseline && row.seoguOn).map(row=>({recordId:row.recordId,participantId:row.participantId,sequence:row.sequence,secondsSaved:row.baseline.seconds-row.seoguOn.seconds,timeReductionPct:(row.baseline.seconds-row.seoguOn.seconds)/row.baseline.seconds*100,errorsReduced:row.baseline.errors-row.seoguOn.errors,sourceOmissionsReduced:row.baseline.sourceOmissions-row.seoguOn.sourceOmissions}));
    const conditionsMatch = new Set(group.records.map(row=>row.conditions)).size <= 1;
    const sufficient = pairs.length >= PILOT_MIN_PAIRS && conditionsMatch;
    const orders = {AB:pairs.filter(row=>row.sequence==='AB').length,BA:pairs.filter(row=>row.sequence==='BA').length};
    return {taskId:group.taskId,conditionId:group.conditionId,conditions:group.records[0].conditions,recordCount:group.records.length,pairCount:pairs.length,pendingCount:group.records.length-pairs.length,conditionsMatch,orders,pairs,
      status:sufficient?'descriptive':!conditionsMatch?'conditions-mismatch':'insufficient-pairs',
      medians:sufficient?Object.fromEntries(['secondsSaved','timeReductionPct','errorsReduced','sourceOmissionsReduced'].map(key=>[key,median(pairs.map(row=>row[key]))])):null,
      notices:[!conditionsMatch?'같은 조건 ID의 공통 조건 메모가 달라 요약을 보류합니다.':pairs.length<PILOT_MIN_PAIRS?`같은 과제·조건의 완성된 ${PILOT_MIN_PAIRS}인 비교부터 요약을 계산합니다.`:'개인별 차이의 중앙값입니다. 적은 표본의 관찰 결과이며 전체 공무원이나 다른 업무에 일반화하지 않습니다.',...(pairs.length && (!orders.AB || !orders.BA)?['수행순서가 한쪽에만 있습니다. 연습·순서 효과가 포함될 수 있습니다.']:[])]};
  });
}
export function serializePilotBook(book) {
  const result=JSON.stringify(validatePilotBook(book),null,2);
  if (new TextEncoder().encode(result).byteLength>PILOT_MAX_BYTES) invalid('업무효과 기록의 보관 용량 2MiB를 초과했습니다. 기존 기록을 내보내 보관하세요.');
  return result;
}
export function parsePilotBook(raw, options={}) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength>PILOT_MAX_BYTES) invalid('업무효과 기록의 크기를 확인하세요.');
  let data; try { data=JSON.parse(raw); } catch { invalid('업무효과 기록의 JSON을 읽지 못했습니다.'); }
  return validatePilotBook(data,options);
}
/** Quote every cell and neutralize spreadsheet formula prefixes, including hidden whitespace. */
export function pilotCsvCell(value) {
  let raw = value === null || value === undefined ? '' : String(value);
  if (/^[\s\uFEFF]*[=+@-]/u.test(raw) || /^[\t\r\n]/u.test(raw)) raw=`'${raw}`;
  return `"${raw.replaceAll('"','""')}"`;
}
export function pilotRawCsv(book) {
  const normalized = validatePilotBook(book), latest = new Map(current(normalized.events).map(row=>[row.recordId,row]));
  const rows=[['region_id','record_id','revision','is_latest','latest_state','event_action','participant_id','task_id','condition_id','sequence','session_date','common_conditions','method','observed','seconds','errors','source_omissions','evidence','entered_at','void_reason']];
  for (const row of normalized.events) for (const method of methods) {
    const value=row[method], last=latest.get(row.recordId);
    rows.push([normalized.regionId,row.recordId,row.revision,row.revision===last.revision,last.action==='void'?'excluded':'active',row.action,row.participantId,row.taskId,row.conditionId,row.sequence,row.sessionDate,row.conditions,method,!!value,value?.seconds,value?.errors,value?.sourceOmissions,value?.evidence,row.recordedAt,row.voidReason]);
  }
  return '\uFEFF'+rows.map(row=>row.map(pilotCsvCell).join(',')).join('\r\n')+'\r\n';
}
