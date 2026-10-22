import {registerAction} from './actions.js';
import {esc} from './catalog.js';
import {PILOT_TASKS,PILOT_MIN_PAIRS,createPilotBook,currentPilotRecords,recordPilotMeasurement,voidPilotMeasurement,summarizePilot,serializePilotBook,parsePilotBook,pilotRawCsv} from '../../shared/pilot-measure.js';

const VIEW='pilot-measure';
const format=value=>Number.isFinite(value)?Number(value.toFixed(2)).toLocaleString('ko-KR'):'미산정';
const delta=value=>`${value>0?'+':''}${format(value)}`;
const empty=()=>({participantId:'',taskId:'space-comparison',conditionId:'',sequence:'AB',sessionDate:'',conditions:'',baseline:{seconds:'',errors:'',sourceOmissions:'',evidence:''},seoguOn:{seconds:'',errors:'',sourceOmissions:'',evidence:''}});
const TASK_HELP={
  'space-comparison':'같은 공간·요일·시간과 두 변경안을 제시하고, 현재값·변경값·출처가 담긴 비교표를 작성합니다.',
  'field-recheck':'같은 현장 변경 통보를 제시하고, 확인 상태를 갱신한 뒤 기존 비교와 달라진 항목·근거를 다시 작성합니다.',
};
const button=(action,label,attrs='',kind='secondary')=>`<button type="button" class="${kind}" data-action="${action}" ${attrs}>${label}</button>`;

export function pilotSummaryHtml(groups) {
  if (!groups.length) return '<div class="pilot-empty"><strong>아직 저장한 측정이 없습니다.</strong><p>실제로 수행한 완료시간·오류·출처누락을 기록하면 같은 참가자의 두 방식을 비교합니다. 시연 성과값은 넣지 않았습니다.</p></div>';
  return groups.map(group=>`<section class="pilot-summary"><h3>${esc(PILOT_TASKS[group.taskId])}</h3><p class="pilot-caption">조건 ${esc(group.conditionId)} · 완료 ${group.pairCount}명 / 한 방식만 기록 ${group.pendingCount}명 · AB ${group.orders.AB}명, BA ${group.orders.BA}명</p>${group.medians?`<dl class="pilot-metrics"><div><dt>완료시간 감소 중앙값</dt><dd>${delta(group.medians.secondsSaved)}초</dd></div><div><dt>개인별 시간 감소율 중앙값</dt><dd>${delta(group.medians.timeReductionPct)}%</dd></div><div><dt>오류 감소 중앙값</dt><dd>${delta(group.medians.errorsReduced)}건</dd></div><div><dt>출처누락 감소 중앙값</dt><dd>${delta(group.medians.sourceOmissionsReduced)}건</dd></div></dl><p class="pilot-caption">기존방식 − 서구온. +는 감소, −는 증가입니다. 빨라졌어도 오류가 늘었는지 함께 확인하세요.</p>`:'<p class="pilot-pending"><strong>요약효과 미산정</strong></p>'}${group.notices.map(note=>`<p class="pilot-caption">${esc(note)}</p>`).join('')}${group.pairs.length?`<details><summary>참가자별 차이 ${group.pairs.length}건</summary><div class="pilot-table-wrap" tabindex="0" role="region" aria-label="참가자별 두 방식의 차이"><table><thead><tr><th scope="col">참가자</th><th scope="col">시간 감소</th><th scope="col">오류 감소</th><th scope="col">출처누락 감소</th></tr></thead><tbody>${group.pairs.map(pair=>`<tr><th scope="row">${esc(pair.participantId)}</th><td>${delta(pair.secondsSaved)}초</td><td>${delta(pair.errorsReduced)}건</td><td>${delta(pair.sourceOmissionsReduced)}건</td></tr>`).join('')}</tbody></table></div></details>`:''}</section>`).join('');
}
function observationFields(method,label,value) {
  const v=value||{seconds:'',errors:'',sourceOmissions:'',evidence:''};
  return `<fieldset class="pilot-observation"><legend>${label}</legend><label for="pilot-${method}-seconds">완료시간 <span>초</span></label><input id="pilot-${method}-seconds" type="number" min="1" max="86400" step="0.1" inputmode="decimal" value="${esc(v.seconds)}" placeholder="실제 측정값"><div class="pilot-two"><div><label for="pilot-${method}-errors">오류 <span>건</span></label><input id="pilot-${method}-errors" type="number" min="0" max="10000" step="1" inputmode="numeric" value="${esc(v.errors)}" placeholder="미채점은 빈칸"></div><div><label for="pilot-${method}-sourceOmissions">출처누락 <span>건</span></label><input id="pilot-${method}-sourceOmissions" type="number" min="0" max="10000" step="1" inputmode="numeric" value="${esc(v.sourceOmissions)}" placeholder="미채점은 빈칸"></div></div><label for="pilot-${method}-evidence">결과물·채점 근거</label><textarea id="pilot-${method}-evidence" maxlength="1500" rows="2" placeholder="익명 결과물 번호, 채점표, 중단·도움 여부">${esc(v.evidence)}</textarea></fieldset>`;
}
function measurementForm(draft,editing) {
  return `<details class="pilot-form-section" open><summary>${editing?'선택한 측정 수정':'실제 측정 기록하기'}</summary><form id="pilot-form"><div class="pilot-two"><div><label for="pilot-participantId">익명 참가자 ID</label><input id="pilot-participantId" required maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" value="${esc(draft.participantId)}" placeholder="예: P001" autocomplete="off"></div><div><label for="pilot-sessionDate">실제 수행일</label><input id="pilot-sessionDate" required type="date" value="${esc(draft.sessionDate)}"></div></div><label for="pilot-taskId">대표과제</label><select id="pilot-taskId">${Object.entries(PILOT_TASKS).map(([id,label])=>`<option value="${id}"${id===draft.taskId?' selected':''}>${esc(label)}</option>`).join('')}</select><p class="pilot-caption" id="pilot-task-help">${esc(TASK_HELP[draft.taskId])}</p><div class="pilot-two"><div><label for="pilot-conditionId">공통 측정조건 ID</label><input id="pilot-conditionId" required maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,63}" value="${esc(draft.conditionId)}" placeholder="예: round1"></div><div><label for="pilot-sequence">실제 수행순서</label><select id="pilot-sequence"><option value="AB"${draft.sequence==='AB'?' selected':''}>AB · 기존방식 → 서구온</option><option value="BA"${draft.sequence==='BA'?' selected':''}>BA · 서구온 → 기존방식</option></select></div></div><label for="pilot-conditions">공통 조건·채점 기준</label><textarea id="pilot-conditions" required maxlength="2000" rows="3" placeholder="같은 과제지·자료 버전·시간 범위·정답표·채점 기준을 기록하세요. 같은 조건 ID에는 동일한 메모를 사용합니다.">${esc(draft.conditions)}</textarea><p class="pilot-caption">이름·연락처는 입력하지 마세요. 두 방식에 같은 완료 기준과 오류·출처누락 기준을 적용하고, 참가자별 특이사항은 아래 근거에 기록하세요.</p>${observationFields('baseline','A · 기존방식',draft.baseline)}${observationFields('seoguOn','B · 서구온',draft.seoguOn)}<p class="pilot-caption">한 방식만 끝났다면 다른 방식은 모두 비워 두세요. 채점하지 않은 값을 0으로 채우지 않습니다. 완료시간·오류·누락·근거 네 항목이 갖춰진 방식만 저장합니다.</p><div class="pilot-actions"><button type="submit" class="primary">${editing?'수정 이력 저장':'측정 저장'}</button>${button('pilot-cancel-edit',editing?'수정 취소':'입력 취소')}</div></form></details>`;
}
function recordsHtml(records,voiding) {
  if (!records.length) return '';
  return `<details class="pilot-records"><summary>저장한 측정 ${records.length}건 · 수정·제외</summary>${records.map(row=>`<article class="pilot-record ${row.action==='void'?'is-void':''}"><h4>${esc(row.participantId)} · ${esc(PILOT_TASKS[row.taskId])}</h4><p class="pilot-caption">${esc(row.sessionDate)} · 조건 ${esc(row.conditionId)} · ${row.sequence} · 이력 ${row.revision}</p><p>${row.action==='void'?`요약에서 제외 · ${esc(row.voidReason)}`:`기존 ${row.baseline?`${format(row.baseline.seconds)}초 / 오류 ${row.baseline.errors} / 누락 ${row.baseline.sourceOmissions}`:'미기록'}<br>서구온 ${row.seoguOn?`${format(row.seoguOn.seconds)}초 / 오류 ${row.seoguOn.errors} / 누락 ${row.seoguOn.sourceOmissions}`:'미기록'}`}</p><div class="pilot-actions">${button('pilot-edit',row.action==='void'?'수정하여 복원':'수정',`data-id="${esc(row.recordId)}"`)}${row.action==='void'?'':button('pilot-void','요약에서 제외',`data-id="${esc(row.recordId)}"`)}</div>${voiding===row.recordId?`<div class="pilot-void"><label for="pilot-void-reason">제외 사유</label><textarea id="pilot-void-reason" rows="2" maxlength="600" placeholder="예: 다른 자료 버전으로 수행하여 조건이 달랐음"></textarea><p class="pilot-caption">원기록은 남기고 요약에서 제외합니다.</p><div class="pilot-actions">${button('pilot-confirm-void','사유와 함께 제외',`data-id="${esc(row.recordId)}"`,'primary')}${button('pilot-cancel-void','돌아가기')}</div></div>`:''}</article>`).join('')}</details>`;
}

/** One panel, local-only actual measurements; returns lifecycle hooks for app.js. */
export function installPilotMeasure(api) {
  const root=document.getElementById('app');
  let book=null,region='',draft=empty(),editing='',voiding='',storageError='',rawSaved=null;
  const key=()=>`seoon.pilot-measure.v1.${region}`;
  const getRegion=()=>api.state.regionProfile?.id||'seogu';
  const openNow=()=>api.state.view===VIEW;
  function load() {
    const next=getRegion(); if(book&&next===region)return;
    region=next;book=createPilotBook(region);draft=empty();editing='';voiding='';storageError='';rawSaved=null;
    try {rawSaved=localStorage.getItem(key());if(rawSaved)book=parsePilotBook(rawSaved,{regionId:region});}
    catch(error){storageError=error.message||'브라우저 저장소를 읽지 못했습니다.';}
  }
  function capture() {
    if(!document.getElementById('pilot-form'))return;
    for(const field of ['participantId','taskId','conditionId','sequence','sessionDate','conditions'])draft[field]=document.getElementById(`pilot-${field}`)?.value??draft[field];
    for(const method of ['baseline','seoguOn'])for(const field of ['seconds','errors','sourceOmissions','evidence'])draft[method][field]=document.getElementById(`pilot-${method}-${field}`)?.value??draft[method][field];
  }
  function persist(next) {
    if(storageError)throw Error('기존 기록을 읽지 못해 덮어쓰지 않았습니다. 원본 보관 후 운영자에게 확인하세요.');
    const raw=serializePilotBook(next);
    try{localStorage.setItem(key(),raw);}catch{throw Error('측정을 저장하지 못했습니다. 브라우저 저장공간을 확인하세요. 기존 기록은 유지합니다.');}
    book=next;rawSaved=raw;
  }
  function render() {
    const records=currentPilotRecords(book,{includeVoided:true});
    api.show('업무효과 측정',`<div class="pilot-panel"><p>같은 참가자가 두 방식으로 수행한 실제 업무를 비교합니다. 결과를 입력한 뒤 참가자별 차이를 확인하세요.</p><p class="pilot-local">이 브라우저의 ${esc(api.state.regionProfile?.name||region)} 측정 기록입니다. 서버로 전송하지 않습니다. CSV는 원본 이력, JSON은 기록 전체를 보관합니다.</p>${storageError?`<div class="pilot-error" role="alert"><strong>기존 기록을 읽지 못했습니다.</strong><p>${esc(storageError)}</p><p>빈 기록으로 덮어쓰지 않습니다.</p>${rawSaved?button('pilot-export-raw','읽지 못한 원본 보관'):''}</div>`:`<section aria-label="입력한 측정 요약">${pilotSummaryHtml(summarizePilot(book))}</section><div class="pilot-actions">${button('pilot-export-csv','원본 이력 CSV',records.length?'':'disabled')}${button('pilot-export-json','전체 기록 JSON',records.length?'':'disabled')}</div>${measurementForm(draft,editing)}${recordsHtml(records,voiding)}`}<details class="pilot-protocol"><summary>측정 방법과 해석</summary><ol><li>두 방식에 같은 과제·자료·완료기준을 준비합니다.</li><li>참가자를 익명 ID로 구분하고 AB·BA 순서를 나누어 기록합니다.</li><li>완료한 결과물을 같은 정답·채점 기준으로 검토합니다.</li><li>조건이 달라지면 새 조건 ID를 사용합니다. 오류가 늘었다면 시간 단축만 성과로 보지 않습니다.</li></ol><p>${PILOT_MIN_PAIRS}명 이상의 완성된 비교부터 개인별 차이의 중앙값을 표시합니다. 이 기준은 화면의 요약 표시 기준이며 통계적 효과 입증에 필요한 표본수를 뜻하지 않습니다. 소규모 자율입력 결과를 전체 공무원의 업무효과로 일반화하지 않습니다.</p><p>과제지·정답표·익명 결과물을 함께 보관하고, 집계에서 제외한 기록의 사유를 남기세요.</p></details></div>`,VIEW);
    const eyebrow=document.getElementById('detail-eyebrow');if(eyebrow)eyebrow.textContent='실제 수행 기록 · 같은 참가자 비교';
    if(voiding)document.querySelector('.pilot-records')?.setAttribute('open','');
  }
  function open(){load();render();}
  function observe(value,label){
    const entries=['seconds','errors','sourceOmissions','evidence'].map(k=>String(value[k]??'').trim());
    if(entries.every(v=>!v))return null;
    if(entries.some(v=>!v))throw Error(`${label}의 완료시간·오류·출처누락·근거를 모두 입력하세요. 미채점 값은 0으로 처리하지 않습니다.`);
    return {seconds:Number(value.seconds),errors:Number(value.errors),sourceOmissions:Number(value.sourceOmissions),evidence:value.evidence};
  }
  function save(){
    capture();const value={...draft,baseline:observe(draft.baseline,'기존방식'),seoguOn:observe(draft.seoguOn,'서구온')};
    persist(recordPilotMeasurement(book,value,editing?{recordId:editing}:{}));
    draft=empty();editing='';voiding='';render();api.toast('실제 측정 기록을 저장했습니다. 원기록과 수정 이력을 함께 보관합니다.');
  }
  function download(filename,value,type){
    const url=URL.createObjectURL(new Blob([value],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const filename=extension=>`서구온_업무효과_${region}_${new Date().toISOString().slice(0,10)}.${extension}`;
  const off=[
    registerAction('pilot-measure',open),
    registerAction('pilot-cancel-edit',()=>{draft=empty();editing='';voiding='';render();}),
    registerAction('pilot-edit',button=>{const row=currentPilotRecords(book,{includeVoided:true}).find(item=>item.recordId===button.dataset.id);if(!row)return;editing=row.recordId;voiding='';draft={participantId:row.participantId,taskId:row.taskId,conditionId:row.conditionId,sequence:row.sequence,sessionDate:row.sessionDate,conditions:row.conditions,baseline:row.baseline?{...row.baseline}:empty().baseline,seoguOn:row.seoguOn?{...row.seoguOn}:empty().seoguOn};render();document.getElementById('pilot-participantId')?.focus();}),
    registerAction('pilot-void',button=>{capture();voiding=button.dataset.id;render();document.getElementById('pilot-void-reason')?.focus();}),
    registerAction('pilot-cancel-void',()=>{capture();voiding='';render();}),
    registerAction('pilot-confirm-void',button=>{capture();persist(voidPilotMeasurement(book,button.dataset.id,{reason:document.getElementById('pilot-void-reason')?.value||''}));voiding='';if(editing===button.dataset.id){editing='';draft=empty();}render();api.toast('원기록을 보존하고 요약에서 제외했습니다.');}),
    registerAction('pilot-export-csv',()=>download(filename('csv'),pilotRawCsv(book),'text/csv;charset=utf-8')),
    registerAction('pilot-export-json',()=>download(filename('json'),serializePilotBook(book),'application/json;charset=utf-8')),
    registerAction('pilot-export-raw',()=>{if(rawSaved)download(filename('txt'),rawSaved,'text/plain;charset=utf-8');}),
  ];
  const submit=event=>{if(event.target?.id!=='pilot-form')return;event.preventDefault();try{save();}catch(error){api.toast(error.message||'측정값을 확인하세요.');}};
  const input=event=>{if(!event.target?.closest?.('#pilot-form'))return;capture();if(event.target.id==='pilot-taskId'){const help=document.getElementById('pilot-task-help');if(help)help.textContent=TASK_HELP[draft.taskId];}};
  root?.addEventListener('submit',submit);root?.addEventListener('input',input);root?.addEventListener('change',input);
  return {open,destroy(){off.forEach(fn=>fn());root?.removeEventListener('submit',submit);root?.removeEventListener('input',input);root?.removeEventListener('change',input);},scopeChanged(){if(openNow()){capture();load();render();}}};
}
