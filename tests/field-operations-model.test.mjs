import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFieldBook,saveFieldIssue,transitionFieldIssue,validateFieldBook,parseFieldBackup,restoreFieldBackup,compareFieldAlternatives,fieldBookCsv,validateFieldFacility,fieldDate} from '../shared/field-operations-model.js';
import {escapeFieldHtml,fieldHistoryHtml} from '../src/city/field-operations.js';
const T='2026-10-28T01:00:00.000Z',T2='2026-10-28T02:00:00.000Z';
const facility={kind:'catalogue',id:'catalogue:care:one',name:'공개 돌봄시설',address:'광주광역시 서구 공개로 1',coordinates:[126.88,35.15],sourceName:'공식자료',sourceUrl:'https://www.seogu.gwangju.kr/',sourceDate:'2026-10-01'};
const input={title:'운영시간 현장 확인',description:'확인사항',role:'시설 운영 담당',facility,scopeId:'all',observation:null};
const create=()=>saveFieldIssue(emptyFieldBook('seogu',T),input,{now:T});
const observation={checkedOn:'2026-10-28',basis:'공개 운영공지를 현장에서 대조함',availability:'unknown',validThrough:null};
const transition=(book,toStatus,extra={})=>transitionFieldIssue(book,book.issues[0].id,{...observation,toStatus,...extra},book.issues[0].revision,T2);

test('new personal records preserve public provenance and begin with unknown availability',()=>{
 const book=create();assert.equal(book.issues[0].status,'접수');assert.equal(book.issues[0].observation,null);assert.equal(book.issues[0].history.length,1);assert.equal(book.issues[0].facility.sourceUrl,facility.sourceUrl);assert.deepEqual(validateFieldBook(book,'seogu'),book);
});
test('every status transition requires real confirmation date and evidence; skipping states fails',()=>{
 const book=create();assert.throws(()=>transition(book,'검토',{basis:''}),/근거/);assert.throws(()=>transition(book,'검토',{checkedOn:''}),/확인일/);assert.throws(()=>transition(book,'검토',{checkedOn:'2026-10-29'}),/확인일/);assert.throws(()=>transition(book,'검토',{checkedOn:'2026-02-30'}),/확인일/);assert.throws(()=>transition(book,'조치완료'),/다음 상태/);
});
test('the full state cycle and reopening keep a bounded revision history',()=>{
 let book=create();for(const status of ['검토','조치중','조치완료','현장확인'])book=transition(book,status);
 assert.equal(book.issues[0].history.length,5);assert.throws(()=>transition(book,'검토'),/재개 사유/);
 book=transition(book,'검토',{reopenReason:'재점검에서 운영공지 변경을 발견'});assert.equal(book.issues[0].history.at(-1).action,'reopen');assert.equal(book.issues[0].history.at(-1).from,'현장확인');assert.equal(book.issues[0].revision,6);
});
test('editing keeps the observation and requires the current revision',()=>{
 const book=transition(create(),'검토',{availability:'available'}),issue=book.issues[0];
 const edited=saveFieldIssue(book,{...input,title:'공개 운영시간 재확인'},{issueId:issue.id,expectedRevision:issue.revision,now:T2});
 assert.deepEqual(edited.issues[0].observation,issue.observation);assert.equal(edited.issues[0].history.at(-1).action,'edit');
 assert.throws(()=>saveFieldIssue(edited,input,{issueId:issue.id,expectedRevision:issue.revision,now:T2}),/충돌/);
 assert.match(edited.issues[0].history.at(-1).note,/운영시간 현장 확인 → 공개 운영시간 재확인/);
 assert.throws(()=>saveFieldIssue(book,{...input,facility:{...facility,id:'catalogue:care:another'}},{issueId:issue.id,expectedRevision:issue.revision,now:T2}),/대상 시설/);
});
test('a role is required for progressing and imported transitions without one are rejected',()=>{
 const book=saveFieldIssue(emptyFieldBook('seogu',T),{...input,role:''},{now:T});
 assert.throws(()=>transition(book,'검토'),/담당 역할/);
 const valid=transition(create(),'검토');valid.issues[0].role='';valid.issues[0].history.at(-1).role='';
 assert.throws(()=>parseFieldBackup(JSON.stringify(valid),'seogu'),/담당 역할/);
});
test('unverified locations cannot carry map coordinates or claim a catalogue without a source',()=>{
 assert.throws(()=>validateFieldFacility({...facility,kind:'unverified'}),/미검증 좌표/);
 assert.throws(()=>validateFieldFacility({...facility,sourceUrl:null}),/출처/);
 assert.throws(()=>validateFieldFacility({...facility,sourceUrl:'javascript:alert(1)'}),/출처 링크/);
 assert.throws(()=>validateFieldFacility({...facility,sourceUrl:'https://user:secret@example.com/'}),/출처 링크/);
 assert.throws(()=>saveFieldIssue(emptyFieldBook('seogu',T),{...input,role:'담당 010-1234-5678'},{now:T}),/개인 연락처/);
});
test('backup parsing isolates regions and rejects unknown schemas, extra properties, duplicate IDs and forged history',()=>{
 const book=create();assert.throws(()=>parseFieldBackup(JSON.stringify(book),'suncheon'),/지역/);
 for(const mutate of [b=>b.schemaVersion=2,b=>b.token='secret',b=>b.issues.push(b.issues[0]),b=>b.issues[0].status='현장확인',b=>b.issues[0].revision=2,b=>b.issues[0].history[0].observation=observation]){
  const changed=structuredClone(book);mutate(changed);assert.throws(()=>parseFieldBackup(JSON.stringify(changed),'seogu'));
 }
 assert.throws(()=>parseFieldBackup('{"__proto__":{},"schemaVersion":1}','seogu'),/허용하지 않은/);
 assert.throws(()=>parseFieldBackup('x'.repeat(2*1024*1024+1),'seogu'),/2MB/);
});
test('restore merges new records, accepts identical records and rejects conflicting edits without mutation',()=>{
 const book=create(),snapshot=JSON.stringify(book),same=restoreFieldBackup(book,book,T2);assert.equal(same.issues.length,1);
 const additional=saveFieldIssue(emptyFieldBook('seogu',T),{...input,title:'새 과제'},{now:T});
 assert.equal(restoreFieldBackup(book,additional,T2).issues.length,2);
 const updated=transition(book,'검토');assert.throws(()=>restoreFieldBackup(book,updated,T2),/다른 수정본/);assert.equal(JSON.stringify(book),snapshot);
});
test('CSV neutralizes formulas and HTML is escaped in histories',()=>{
 const book=saveFieldIssue(emptyFieldBook('seogu',T),{...input,title:'=HYPERLINK("evil")',description:'<img src=x onerror=alert(1)>'},{now:T});
 assert.match(fieldBookCsv(book),/"'=HYPERLINK/);assert.match(escapeFieldHtml('<script>"&'),/&lt;script&gt;&quot;&amp;/);
 const issue=structuredClone(book.issues[0]);issue.history[0].note='<img src=x onerror=alert(1)>';const html=fieldHistoryHtml(issue);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
test('comparison preserves unknown observations separately from zero available facilities',()=>{
 const book=create(),out=compareFieldAlternatives({facilities:[facility],issues:book.issues,at:'2026-10-28T14:00'});
 assert.equal(out.a.available,0);assert.equal(out.a.unknown,1);assert.equal(out.a.unavailable,0);assert.equal(out.b.unknown,1);assert.equal(out.availableDifference,0);
});
test('same-time A/B closure and temporary opening are labelled assumptions and never change the current record',()=>{
 const book=transition(create(),'검토',{availability:'available'}),before=JSON.stringify(book);
 const common={facilityId:facility.id,startsAt:'2026-10-28T09:00',endsAt:'2026-10-28T18:00',reason:'운영 인력 확보를 가정'};
 const out=compareFieldAlternatives({facilities:[facility],issues:book.issues,at:'2026-10-28T14:00',planA:[{...common,kind:'closed'}],planB:[{...common,kind:'temporary-open'}]});
 assert.equal(out.a.unavailable,1);assert.equal(out.b.available,1);assert.equal(out.availableDifference,1);assert.equal(out.a.assumed,1);assert.equal(out.b.rows[0].origin,'assumption');assert.equal(JSON.stringify(book),before);
});
test('expired observations and out-of-window assumptions return to unknown instead of claiming current opening',()=>{
 const book=transition(create(),'검토',{availability:'available'});
 const out=compareFieldAlternatives({facilities:[facility],issues:book.issues,at:'2026-10-29T14:00',planB:[{facilityId:facility.id,kind:'temporary-open',startsAt:'2026-10-28T09:00',endsAt:'2026-10-28T18:00',reason:'일시 개방 검토'}]});
 assert.equal(out.a.unknown,1);assert.equal(out.b.unknown,1);assert.equal(out.b.assumed,0);
});
test('editing an older task does not make its older field observation replace a newer confirmation',()=>{
 let book=transition(create(),'검토',{checkedOn:'2026-10-27',validThrough:'2026-10-30',availability:'unavailable'});
 const old=book.issues[0];book=saveFieldIssue(book,{...input,title:'새 현장확인'},{now:T2});
 book=transition(book,'검토',{availability:'available'});
 book=saveFieldIssue(book,{...input,title:'예전 과제 이름만 수정'},{issueId:old.id,expectedRevision:old.revision,now:'2026-10-28T03:00:00.000Z'});
 const out=compareFieldAlternatives({facilities:[facility],issues:book.issues,at:'2026-10-28T14:00'});
 assert.equal(out.a.available,1);assert.equal(out.a.unavailable,0);
});
test('alternative validation rejects foreign facility IDs, duplicates, reversed windows and missing reasons',()=>{
 const base={facilities:[facility],issues:create().issues,at:'2026-10-28T14:00'},valid={facilityId:facility.id,kind:'closed',startsAt:'2026-10-28T09:00',endsAt:'2026-10-28T18:00',reason:'보수 가정'};
 for(const planA of [[{...valid,facilityId:'foreign'}],[valid,valid],[{...valid,endsAt:'2026-10-28T08:00'}],[{...valid,reason:''}]])assert.throws(()=>compareFieldAlternatives({...base,planA}));
 assert.throws(()=>compareFieldAlternatives({...base,at:'2026-10-28T25:00'}));assert.equal(fieldDate('2026-02-30'),false);
});
