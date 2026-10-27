import test from 'node:test';
import assert from 'node:assert/strict';
import {PILOT_MIN_PAIRS,PILOT_MAX_BYTES,createPilotBook,validatePilotBook,currentPilotRecords,recordPilotMeasurement,voidPilotMeasurement,summarizePilot,median,serializePilotBook,parsePilotBook,pilotRawCsv,pilotCsvCell} from '../shared/pilot-measure.js';
import {pilotSummaryHtml,parsePilotObservationInput,installPilotMeasure} from '../src/city/pilot-measure.js';
import {runRegisteredAction} from '../src/city/actions.js';

const NOW='2026-10-22T10:00:00.000Z';
const NEXT='2026-10-22T10:01:00.000Z';
const clone=value=>JSON.parse(JSON.stringify(value));
function measurement(participantId='P001',patch={}) {
  return {participantId,taskId:'space-comparison',conditionId:'round1',sequence:'AB',sessionDate:'2026-10-22',conditions:'동일 과제지 1, 공개자료 v1, 정답·출처 목록 1, 동일 기기와 안내',baseline:{seconds:100,errors:2,sourceOmissions:1,evidence:'익명 결과물 A, 채점표 1'},seoguOn:{seconds:80,errors:1,sourceOmissions:0,evidence:'익명 결과물 B, 채점표 1'},...patch};
}
function add(book,participant='P001',patch={},options={}) {return recordPilotMeasurement(book,measurement(participant,patch),{now:NOW,...options});}
function three() {return ['P001','P002','P003'].reduce((book,p,i)=>add(book,p,{sequence:i%2?'BA':'AB'}),createPilotBook('seogu'));}

test('initial state is empty; no seeded results or effect estimates',()=>{
  const book=createPilotBook('seogu');assert.deepEqual(book.events,[]);assert.deepEqual(summarizePilot(book),[]);
  assert.match(pilotSummaryHtml([]),/현재 요약에 포함할 측정이 없습니다/);
  assert.match(pilotSummaryHtml([]),/제외한 기록이 있다면 아래 수정·제외 목록에 보관/);
  assert.equal(pilotRawCsv(book).split('\r\n').filter(Boolean).length,1);
});
test('single-method rows stay pending and zero must be explicitly observed',()=>{
  let book=add(createPilotBook('seogu'),'P001',{seoguOn:null});
  let group=summarizePilot(book)[0];assert.equal(group.pairCount,0);assert.equal(group.pendingCount,1);assert.equal(group.medians,null);
  book=add(book,'P002',{baseline:{seconds:2,errors:0,sourceOmissions:0,evidence:'완료·오류 없음 확인'},seoguOn:{seconds:1,errors:0,sourceOmissions:0,evidence:'완료·오류 없음 확인'}});
  group=summarizePilot(book)[0];assert.equal(group.pairCount,1);assert.equal(group.medians,null);assert.equal(group.pairs[0].secondsSaved,1);assert.equal(group.pairs[0].errorsReduced,0);
});
test('three paired participants produce medians of individual differences and percentages',()=>{
  let book=createPilotBook('seogu');
  const values=[[100,50,2,0,1,0],[100,300,1,5,0,3],[1000,900,3,2,2,0]];
  values.forEach((v,i)=>{book=add(book,`P00${i+1}`,{sequence:i?'BA':'AB',baseline:{seconds:v[0],errors:v[2],sourceOmissions:v[4],evidence:'A 실제 채점'},seoguOn:{seconds:v[1],errors:v[3],sourceOmissions:v[5],evidence:'B 실제 채점'}});});
  const group=summarizePilot(book)[0];assert.equal(PILOT_MIN_PAIRS,3);assert.equal(group.status,'descriptive');
  assert.deepEqual(group.medians,{secondsSaved:50,timeReductionPct:10,errorsReduced:1,sourceOmissionsReduced:1});
  assert.deepEqual(group.orders,{AB:1,BA:2});assert.match(group.notices[0],/일반화하지/);
  assert.equal(median([3,1,4,2]),2.5);assert.equal(median([]),null);assert.equal(median([1,NaN]),null);
});
test('tasks and conditions never pool their participants into an effect estimate',()=>{
  let book=createPilotBook('seogu');
  for(const [taskId,conditionId] of [['space-comparison','r1'],['space-comparison','r2'],['field-recheck','r1']])for(const id of ['P001','P002'])book=add(book,id,{taskId,conditionId});
  const groups=summarizePilot(book);assert.equal(groups.length,3);assert.ok(groups.every(group=>group.pairCount===2&&group.medians===null));
});
test('same condition ID with inconsistent conditions suppresses all group estimates',()=>{
  let book=three(),row=currentPilotRecords(book)[0];book=add(book,row.participantId,{conditions:'자료 버전이 다름'},{recordId:row.recordId,now:NEXT});
  const group=summarizePilot(book)[0];assert.equal(group.status,'conditions-mismatch');assert.equal(group.conditionsMatch,false);assert.equal(group.medians,null);
});
test('one-sided order remains visibly qualified and slower or worse results keep their sign',()=>{
  let book=createPilotBook('seogu');for(const id of ['P001','P002','P003'])book=add(book,id,{seoguOn:{seconds:150,errors:4,sourceOmissions:2,evidence:'B 실제 채점'}});
  const group=summarizePilot(book)[0];assert.equal(group.medians.secondsSaved,-50);assert.equal(group.medians.errorsReduced,-2);assert.equal(group.medians.sourceOmissionsReduced,-1);assert.ok(group.notices.some(s=>s.includes('순서 효과')));
});
test('edits and exclusions append history; restoration preserves originals',()=>{
  const original=three(),before=serializePilotBook(original),row=currentPilotRecords(original)[0];
  const edited=add(original,row.participantId,{seoguOn:{seconds:20,errors:0,sourceOmissions:0,evidence:'입력 오류를 정정한 채점표'}},{recordId:row.recordId,now:NEXT});
  assert.equal(serializePilotBook(original),before);assert.equal(edited.events.length,4);assert.equal(edited.events[0].seoguOn.seconds,80);assert.equal(currentPilotRecords(edited)[0].seoguOn.seconds,20);assert.equal(edited.events.at(-1).revision,2);
  const excluded=voidPilotMeasurement(edited,row.recordId,{reason:'비교 자료 버전 불일치',now:'2026-10-22T10:02:00.000Z'});
  assert.equal(excluded.events.length,5);assert.equal(currentPilotRecords(excluded).length,2);assert.equal(currentPilotRecords(excluded,{includeVoided:true}).length,3);assert.equal(summarizePilot(excluded)[0].medians,null);
  const restored=add(excluded,row.participantId,{}, {recordId:row.recordId,now:'2026-10-22T10:03:00.000Z'});assert.equal(restored.events.length,6);assert.equal(summarizePilot(restored)[0].pairCount,3);
});
test('same participant/task/condition duplicates cannot inflate sample size',()=>{
  const book=add(createPilotBook('seogu'),'p001',{conditionId:'ROUND1'});assert.equal(currentPilotRecords(book)[0].participantId,'P001');
  assert.throws(()=>add(book,'P001'),/중복/);assert.equal(add(book,'P001',{taskId:'field-recheck'}).events.length,2);
  assert.throws(()=>recordPilotMeasurement(book,measurement('P002'),{recordId:'missing',now:NOW}),/없습니다/);
});
test('unknown metrics, malformed values, future dates and empty evidence cannot become facts',()=>{
  const cases=[{baseline:null,seoguOn:null},{baseline:{seconds:100,errors:null,sourceOmissions:0,evidence:'x'}},{baseline:{seconds:0,errors:0,sourceOmissions:0,evidence:'x'}},{baseline:{seconds:Infinity,errors:0,sourceOmissions:0,evidence:'x'}},{baseline:{seconds:100,errors:0.5,sourceOmissions:0,evidence:'x'}},{seoguOn:{seconds:1,errors:0,sourceOmissions:0,evidence:''}},{participantId:'실명 홍길동'},{sessionDate:'2026-02-30'},{sessionDate:'2026-10-23'},{sequence:'AA'},{taskId:'other'},{conditionId:'../unsafe'}];
  for(const patch of cases)assert.throws(()=>add(createPilotBook('seogu'),'P001',patch));
});
test('unknown keys, poisoned data and executable properties fail without invoking getters',()=>{
  const book=three();assert.throws(()=>validatePilotBook({...book,apiKey:'secret'}));
  const poisoned=JSON.parse('{"version":1,"regionId":"seogu","events":[],"__proto__":{"polluted":true}}');assert.throws(()=>validatePilotBook(poisoned));assert.equal({}.polluted,undefined);
  const value=measurement();Object.defineProperty(value,'conditions',{enumerable:true,get(){throw Error('getter invoked');}});assert.throws(()=>recordPilotMeasurement(book,value),/지원하지 않는 속성/);
  const raw=clone(book);raw.events[0].baseline.guessed=true;assert.throws(()=>validatePilotBook(raw));
});
test('out-of-order revisions, backward timestamps and exclusion without a record are rejected',()=>{
  const book=three(),id=book.events[0].recordId;
  assert.throws(()=>voidPilotMeasurement(book,id,{reason:'',now:NEXT}));
  assert.throws(()=>add(book,'P001',{}, {recordId:id,now:'2026-10-22T09:00:00.000Z'}));
  const raw=clone(book);raw.events[0].revision=2;assert.throws(()=>validatePilotBook(raw));
  const raw2=clone(book);raw2.events[0].action='void';raw2.events[0].voidReason='x';assert.throws(()=>validatePilotBook(raw2));
});
test('JSON preserves raw conditions and history while enforcing region and storage size',()=>{
  const book=add(createPilotBook('seogu'),'P001',{conditions:'조건 첫 줄\n두 번째 줄, "원문"'});
  const restored=parsePilotBook(serializePilotBook(book),{regionId:'seogu'});assert.deepEqual(restored,book);
  assert.throws(()=>parsePilotBook(serializePilotBook(book),{regionId:'another-city'}),/다른 지역/);
  assert.throws(()=>parsePilotBook('{broken'));
  assert.throws(()=>parsePilotBook(' '.repeat(PILOT_MAX_BYTES+1)));
});
test('CSV neutralizes formulas after whitespace and quotes multiline text safely',()=>{
  for(const value of ['=SUM(1,2)','+SUM(1,2)','-1+2','@SUM(A1)','   =HYPERLINK("x")','\t@SUM(A1)','\n=1','\uFEFF=1'])assert.equal(pilotCsvCell(value).startsWith('"\''),true);
  assert.equal(pilotCsvCell('a,"b"\nc'),'"a,""b""\nc"');assert.equal(pilotCsvCell(0),'"0"');assert.equal(pilotCsvCell(null),'""');
  const book=add(createPilotBook('seogu'),'P001',{conditions:'=HYPERLINK("https://example.org")'}),csv=pilotRawCsv(book);
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.org"")"'));assert.equal(parsePilotBook(serializePilotBook(book)).events[0].conditions,'=HYPERLINK("https://example.org")');
});
test('raw CSV exports both method rows for every original, edit and exclusion',()=>{
  let book=add(createPilotBook('seogu')),id=book.events[0].recordId;
  book=add(book,'P001',{seoguOn:null},{recordId:id,now:NEXT});book=voidPilotMeasurement(book,id,{reason:'시험 중단',now:'2026-10-22T10:02:00.000Z'});
  const rows=pilotRawCsv(book).split('\r\n').filter(Boolean);assert.equal(rows.length,7);assert.ok(rows[0].includes('"common_conditions"'));assert.ok(rows[1].includes('"false","excluded","record"'));assert.ok(rows[5].includes('"true","excluded","void"'));assert.ok(rows[4].includes('"seoguOn","false","","",""'));
});
test('summary HTML escapes conditions and participant input and shows insufficient samples honestly',()=>{
  const groups=summarizePilot(add(createPilotBook('seogu')));groups[0].conditionId='<script>x</script>';groups[0].pairs[0].participantId='<img src=x onerror=alert(1)>';
  const html=pilotSummaryHtml(groups);assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));assert.equal(html.includes('<script>'),false);assert.match(html,/요약효과 미산정/);
});

test('legacy version 1 observations migrate optional KPIs to null without inventing completion or zero counts',()=>{
  const legacy=clone(three());for(const row of legacy.events)for(const method of ['baseline','seoguOn'])for(const key of ['completed','wrongSelections','phoneCalls'])delete row[method][key];
  const before=JSON.stringify(legacy),book=parsePilotBook(before,{regionId:'seogu'});
  assert.equal(JSON.stringify(legacy),before);assert.equal(book.version,1);
  for(const row of book.events)for(const method of ['baseline','seoguOn']){assert.equal(row[method].completed,null);assert.equal(row[method].wrongSelections,null);assert.equal(row[method].phoneCalls,null);}
  assert.deepEqual(parsePilotBook(serializePilotBook(book)),book);
  const group=summarizePilot(book)[0];assert.equal(group.completion.pairCount,0);assert.equal(group.completion.baseline.ratePct,null);assert.equal(group.confirmedTime.medians,null);assert.equal(group.optionalKpis.phoneCallsReduced.median,null);
  assert.equal(group.medians.secondsSaved,20,'legacy raw observed-time API remains compatible');
  const html=pilotSummaryHtml([group]);assert.match(html,/완료 여부 미측정/);assert.doesNotMatch(html,/>\+20초</,'unconfirmed legacy time must not appear as completed-task savings');
});

test('optional KPI types are strict and zero, false and null remain different values',()=>{
  const m=measurement(),base=m.baseline;
  for(const completed of [0,1,'true','false','',undefined,{},[]])assert.throws(()=>add(createPilotBook('seogu'),'P001',{baseline:{...base,completed}}),/완료 여부/);
  for(const key of ['wrongSelections','phoneCalls'])for(const value of [-1,.5,NaN,Infinity,'0',undefined,10001])assert.throws(()=>add(createPilotBook('seogu'),'P001',{baseline:{...base,[key]:value}}),/시설 선택·확인 전화/);
  const book=add(createPilotBook('seogu'),'P001',{baseline:{...base,completed:false,wrongSelections:0,phoneCalls:null}}),o=book.events[0].baseline;
  assert.equal(o.completed,false);assert.equal(o.wrongSelections,0);assert.equal(o.phoneCalls,null);
});

test('completion rates use the same known paired participants and expose unknown or unmatched records',()=>{
  let book=createPilotBook('seogu');const statuses=[[true,true],[false,true],[true,false],[null,true],[false,null],[true,undefined]];
  statuses.forEach(([a,b],i)=>{const m=measurement();book=add(book,`P00${i+1}`,{baseline:{...m.baseline,completed:a},seoguOn:b===undefined?null:{...m.seoguOn,completed:b}});});
  const group=summarizePilot(book)[0];assert.equal(group.pairCount,5);assert.equal(group.completion.pairCount,3);assert.equal(group.completion.excludedCount,3);
  assert.equal(group.completion.baseline.known,3);assert.equal(group.completion.seoguOn.known,3);assert.equal(group.completion.baseline.completed,2);assert.equal(group.completion.seoguOn.completed,2);assert.equal(group.completion.baseline.ratePct,2/3*100);assert.equal(group.completion.differencePp,0);
  assert.equal(group.completion.baseline.unmeasured,1);assert.equal(group.completion.seoguOn.unmeasured,2);assert.equal(group.confirmedTime.pairCount,1);assert.equal(group.confirmedTime.medians,null);
});

test('an incomplete fast task cannot improve successful completion-time savings',()=>{
  let book=createPilotBook('seogu');for(const id of ['P001','P002','P003']){const m=measurement();book=add(book,id,{baseline:{...m.baseline,completed:true},seoguOn:{...m.seoguOn,completed:true}});}
  const m=measurement();book=add(book,'P004',{baseline:{...m.baseline,completed:true},seoguOn:{...m.seoguOn,seconds:1,completed:false}});
  const group=summarizePilot(book)[0],failed=group.pairs.find(row=>row.participantId==='P004');
  assert.equal(failed.secondsSaved,null);assert.equal(failed.timeReductionPct,null);assert.equal(failed.timeStatus,'incomplete');assert.equal(group.confirmedTime.pairCount,3);assert.deepEqual(group.confirmedTime.medians,{secondsSaved:20,timeReductionPct:20});assert.equal(group.completion.seoguOn.ratePct,75);
  const html=pilotSummaryHtml([group]);assert.match(html,/미완료 · 제외/);assert.doesNotMatch(html,/\+99초/);assert.match(html,/3명의 기록/);
});

test('optional count comparisons use their own paired denominators and preserve zero and adverse differences',()=>{
  let book=createPilotBook('seogu');const values=[[3,0,4,1],[2,1,1,3],[0,1,0,0],[4,null,null,2]];
  values.forEach(([a,b,c,d],i)=>{const m=measurement();book=add(book,`P00${i+1}`,{baseline:{...m.baseline,wrongSelections:a,phoneCalls:c},seoguOn:{...m.seoguOn,wrongSelections:b,phoneCalls:d}});});
  const group=summarizePilot(book)[0];assert.deepEqual(group.optionalKpis,{wrongSelectionsReduced:{pairCount:3,median:1},phoneCallsReduced:{pairCount:3,median:0}});
  assert.equal(group.pairs[2].wrongSelectionsReduced,-1);assert.equal(group.pairs[1].phoneCallsReduced,-2);assert.equal(group.pairs[2].phoneCallsReduced,0);assert.equal(group.pairs[3].wrongSelectionsReduced,null);
  const html=pilotSummaryHtml([group]);assert.match(html,/잘못된 시설 선택/);assert.match(html,/확인 전화/);assert.match(html,/>0건</);
});

test('condition mismatch suppresses all new rates and summaries and separate tasks never pool KPI samples',()=>{
  let book=createPilotBook('seogu');for(const id of ['P001','P002','P003']){const m=measurement();book=add(book,id,{baseline:{...m.baseline,completed:true,wrongSelections:2,phoneCalls:2},seoguOn:{...m.seoguOn,completed:true,wrongSelections:0,phoneCalls:0},conditions:id==='P003'?'다른 조건':m.conditions});}
  const group=summarizePilot(book)[0];assert.equal(group.conditionsMatch,false);assert.equal(group.completion.baseline.ratePct,null);assert.equal(group.completion.differencePp,null);assert.equal(group.confirmedTime.medians,null);assert.equal(group.optionalKpis.phoneCallsReduced.median,null);
  let separated=createPilotBook('seogu');for(const taskId of ['space-comparison','field-recheck'])for(const id of ['P001','P002']){const m=measurement();separated=add(separated,id,{taskId,baseline:{...m.baseline,completed:true,phoneCalls:1},seoguOn:{...m.seoguOn,completed:true,phoneCalls:0}});}
  assert.ok(summarizePilot(separated).every(g=>g.confirmedTime.pairCount===2&&g.confirmedTime.medians===null&&g.optionalKpis.phoneCallsReduced.median===null));
});

test('optional values survive edits, exclusion, restoration and CSV history with unknown cells left blank',()=>{
  const m=measurement();let book=add(createPilotBook('seogu'),'P001',{baseline:{...m.baseline,completed:false,wrongSelections:0,phoneCalls:null},seoguOn:{...m.seoguOn,completed:null,wrongSelections:null,phoneCalls:0}}),id=book.events[0].recordId;
  book=add(book,'P001',{baseline:{...m.baseline,completed:true,wrongSelections:1,phoneCalls:2}},{recordId:id,now:NEXT});
  book=voidPilotMeasurement(book,id,{reason:'추가 채점 대기',now:'2026-10-22T10:02:00.000Z'});
  book=add(book,'P001',{baseline:{...m.baseline,completed:true,wrongSelections:1,phoneCalls:2}},{recordId:id,now:'2026-10-22T10:03:00.000Z'});
  const restored=parsePilotBook(serializePilotBook(book));assert.equal(restored.events[0].baseline.completed,false);assert.equal(restored.events[0].baseline.wrongSelections,0);assert.equal(restored.events[0].baseline.phoneCalls,null);assert.equal(restored.events.at(-1).baseline.completed,true);assert.equal(restored.events.length,4);
  const csv=pilotRawCsv(restored).split('\r\n').filter(Boolean);assert.ok(csv[0].endsWith('"completed","wrong_selections","phone_calls"'));assert.ok(csv[1].endsWith('"false","0",""'));assert.ok(csv[2].endsWith('"","","0"'));assert.ok(csv[7].endsWith('"true","1","2"'));
});

test('form parsing preserves optional blank, measured zero and incomplete values without accepting KPI-only records',()=>{
  assert.equal(parsePilotObservationInput({seconds:'',errors:'',sourceOmissions:'',evidence:'',completed:'',wrongSelections:'',phoneCalls:''}),null);
  assert.throws(()=>parsePilotObservationInput({completed:'false'}),/투입시간/);
  const base={seconds:'10',errors:'0',sourceOmissions:'0',evidence:'중단 시점과 채점표',completed:'false',wrongSelections:'0',phoneCalls:''};
  assert.deepEqual(parsePilotObservationInput(base),{seconds:10,errors:0,sourceOmissions:0,evidence:base.evidence,completed:false,wrongSelections:0,phoneCalls:null});
  assert.equal(parsePilotObservationInput({...base,completed:''}).completed,null);assert.throws(()=>parsePilotObservationInput({...base,completed:'yes'}),/완료 여부/);
});

test('the panel shows optional fields and persists actual incomplete, zero and unknown inputs',async t=>{
  const originals={document:globalThis.document,localStorage:globalThis.localStorage},listeners={},nodes={},storage=new Map(),toasts=[];
  const root={addEventListener:(name,handler)=>listeners[name]=handler,removeEventListener:name=>delete listeners[name]};
  globalThis.document={getElementById:id=>id==='app'?root:nodes[id]||null,querySelector:()=>null};
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const api={state:{regionProfile:{id:'seogu',name:'서구'},view:null},show(title,html,view){this.html=html;this.state.view=view;},toast:text=>toasts.push(text)},ui=installPilotMeasure(api);
  t.after(()=>{ui.destroy();for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  ui.open();assert.match(api.html,/pilot-baseline-completed/);assert.match(api.html,/pilot-seoguOn-wrongSelections/);assert.match(api.html,/pilot-baseline-phoneCalls/);
  const m=measurement();nodes['pilot-form']={};for(const key of ['participantId','taskId','conditionId','sequence','sessionDate','conditions'])nodes['pilot-'+key]={value:m[key],focus(){}};
  for(const method of ['baseline','seoguOn'])for(const [key,value]of Object.entries({...m[method],completed:method==='baseline'?'true':'false',wrongSelections:'0',phoneCalls:''}))nodes[`pilot-${method}-${key}`]={value:String(value)};
  listeners.submit({target:{id:'pilot-form'},preventDefault(){}});
  const book=parsePilotBook(storage.get('seoon.pilot-measure.v1.seogu'));assert.equal(book.events[0].baseline.completed,true);assert.equal(book.events[0].seoguOn.completed,false);assert.equal(book.events[0].seoguOn.wrongSelections,0);assert.equal(book.events[0].seoguOn.phoneCalls,null);assert.match(api.html,/미완료 · 제외/);
  await runRegisteredAction({dataset:{action:'pilot-edit',id:book.events[0].recordId}},api);assert.match(api.html,/value="false" selected/);assert.match(api.html,/pilot-seoguOn-phoneCalls[^>]*value=""/);assert.ok(toasts.some(value=>value.includes('저장')));
});
