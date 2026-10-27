import {registerAction} from './actions.js';
import {inside} from './geometry.js';
import {FIELD_STATUSES,AVAILABILITY,FIELD_LIMITS,emptyFieldBook,parseFieldBackup,saveFieldIssue,transitionFieldIssue,restoreFieldBackup,fieldBookCsv,compareFieldAlternatives,fieldToday,fieldDate,validateFieldFacility} from '../../shared/field-operations-model.js';
const VIEW='field-operations';
export const escapeFieldHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeFieldHtml;
const localNotice='이 기기의 개인 검토기록입니다. 기관의 공식 접수·승인이나 다른 담당자와의 공유를 의미하지 않습니다. 이름·연락처·민원인 정보는 넣지 마세요.';
function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const checkedText=o=>o?`${o.checkedOn} · ${AVAILABILITY[o.availability]}`:'확인기록 없음 · 미확인';
export function fieldHistoryHtml(issue){return `<ol class="fo-history">${[...issue.history].reverse().map(h=>`<li><strong>${e(h.action==='create'?'접수':h.action==='reopen'?'재개':h.action==='edit'?'내용 수정':`${h.from} → ${h.to}`)}</strong><span>${e(new Date(h.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} · 수정 ${h.revision}${h.role?` · ${e(h.role)}`:''}</span><p>${e(h.note)}</p>${h.observation?`<p>${e(checkedText(h.observation))}<br>${e(h.observation.basis)}</p>`:''}</li>`).join('')}</ol>`;}
const availabilityOptions=current=>Object.entries(AVAILABILITY).map(([value,label])=>`<option value="${value}"${value===current?' selected':''}>${label}</option>`).join('');

export function installFieldOperations(api){
 let regionId='',book=null,selectedId='',catalogue=[],catalogueBusy=false,catalogueError='',query='',error='',notice='',storageToken=null,storageReady=true,controller=null,sequence=0,destroyed=false,comparison=null;
 const host=()=>document.getElementById('detail-body'),current=()=>book?.issues.find(i=>i.id===selectedId),openNow=()=>api.state.view===VIEW,key=()=>`seoon:field-operations:v1:${regionId}`;
 const scopeName=()=>api.label?.()||api.state.regionProfile?.name||'선택 지역';
 function readStorage(){
  storageReady=true;storageToken=null;book=emptyFieldBook(regionId);
  try{storageToken=localStorage.getItem(key());if(storageToken)book=parseFieldBackup(storageToken,regionId);}
  catch(cause){storageReady=false;error=`저장기록을 읽지 못했습니다. ${cause.message||''} 기존 저장값은 바꾸지 않았습니다.`;}
 }
 function persist(next){
  if(!storageReady)throw Error('기존 저장기록을 확인할 수 없어 덮어쓰지 않았습니다. JSON 백업을 보관하고 다른 브라우저에서 복원해 주세요.');
  let nowStored;try{nowStored=localStorage.getItem(key());}catch{throw Error('이 브라우저에서 저장소를 사용할 수 없습니다.');}
  if(nowStored!==storageToken)throw Error('다른 창에서 기록이 변경되었습니다. 현재 입력을 메모한 뒤 최신 기록을 다시 읽어 주세요.');
  const raw=JSON.stringify(next);if(new TextEncoder().encode(raw).length>FIELD_LIMITS.bytes)throw Error('개인 기록이 2MB 한도에 도달했습니다. 현재 기록을 백업해 보관하세요.');try{localStorage.setItem(key(),raw);}catch{throw Error('저장 공간이나 브라우저 설정 때문에 저장하지 못했습니다. 기존 기록은 유지됩니다.');}
  storageToken=raw;book=next;comparison=null;
 }
 const matches=facility=>catalogue.some(c=>c.id===facility.id&&c.name===facility.name&&c.address===facility.address&&JSON.stringify(c.coordinates)===JSON.stringify(facility.coordinates));
 function facilityOptions(issue){
  const search=query.toLocaleLowerCase('ko-KR'),scope=api.state.scope;
  const filtered=catalogue.filter(f=>(!search||`${f.name} ${f.address}`.toLocaleLowerCase('ko-KR').includes(search))&&(!scope||!f.coordinates||inside(f.coordinates,scope))).slice(0,100);
  const chosen=issue?.facility;
  return `<option value="manual"${!chosen||chosen.kind==='unverified'?' selected':''}>직접 장소 입력 · 위치 미검증</option>${chosen&&chosen.kind==='catalogue'&&!filtered.some(f=>f.id===chosen.id)?`<option value="saved" selected>${e(chosen.name)} · 저장 당시 공개목록</option>`:''}${filtered.map(f=>`<option value="${e(f.id)}"${chosen?.id===f.id?' selected':''}>${e(f.name)} · ${e(f.address||'주소 미제공')}${f.coordinates?'':' · 좌표 미확정'}</option>`).join('')}`;
 }
 function issueForm(issue){
  return `<form id="fo-edit" class="fo-form"><input type="hidden" name="revision" value="${issue?.revision||0}"><label>과제 이름<input name="title" maxlength="120" required value="${e(issue?.title||'')}" placeholder="예: 수유실 운영시간 현장 확인"></label>${issue?`<input type="hidden" name="facility" value="saved"><p class="fo-help">대상 시설은 ${e(issue.facility.name)}입니다. 다른 장소의 확인기록은 새 과제로 접수하세요.</p>`:`<label>공개시설 찾기<input id="fo-facility-query" value="${e(query)}" maxlength="100" placeholder="시설명·도로명을 적고 찾기"></label><button type="button" data-action="field-facility-search">시설 목록 찾기</button><label>대상 시설·장소<select name="facility" id="fo-facility">${facilityOptions(issue)}</select></label><p class="fo-help">현재 구역의 좌표 확인 시설과 선택 지역 전체의 주소 목록에서 최대 100개를 표시합니다. 검색으로 범위를 좁히세요. 출입구·현재 운영은 별도 확인합니다.</p><div class="fo-manual"${issue?.facility.kind==='catalogue'?' hidden':''}><label>직접 입력 장소명<input name="manualName" maxlength="180" value="${e(issue?.facility.kind==='unverified'?issue.facility.name:'')}" placeholder="목록에 없는 장소"></label><label>주소 또는 위치 설명<input name="manualAddress" maxlength="300" value="${e(issue?.facility.kind==='unverified'?issue.facility.address:'')}"></label></div>`}<label>담당 역할<input name="ownerRole" maxlength="80" value="${e(issue?.role||'')}" placeholder="예: 돌봄시설 운영 확인 담당 · 개인 이름 제외"></label><label>확인할 일<textarea name="description" rows="3" maxlength="2000" placeholder="공개 가능한 현장 확인사항만 적으세요.">${e(issue?.description||'')}</textarea></label><button class="fo-primary" type="submit">${issue?'과제 내용 저장':'개인 검토과제 접수'}</button></form>`;
 }
 function transitionForm(issue){
  const next=FIELD_STATUSES[FIELD_STATUSES.indexOf(issue.status)+1];
  return `<section class="fo-progress"><h3>다음 조치 기록</h3><ol class="fo-statuses">${FIELD_STATUSES.map(s=>`<li${s===issue.status?' aria-current="step"':''}>${s}</li>`).join('')}</ol><p>${e(checkedText(issue.observation))}</p>${issue.observation?`<blockquote>${e(issue.observation.basis)}</blockquote>`:''}<form id="fo-transition" class="fo-form"><input type="hidden" name="revision" value="${issue.revision}"><label>확인일<input name="checkedOn" type="date" required max="${fieldToday()}" value="${fieldToday()}"></label><label>이번 확인 근거<textarea name="basis" maxlength="1500" rows="3" required placeholder="예: 공개 운영공지의 날짜·주소, 현장에서 확인한 내용"></textarea></label><label>시설 이용 확인<select name="availability">${availabilityOptions('unknown')}</select></label><label>이 확인의 유효 종료일 · 선택<input name="validThrough" type="date" min="${fieldToday()}"></label><p class="fo-help">종료일을 비우면 확인일 당일만 비교에 사용합니다. 이용 여부를 확인하지 않았다면 ‘미확인’으로 두세요.</p>${['조치완료','현장확인'].includes(issue.status)?'<label>재개 사유 · 재개할 때 필수<input name="reopenReason" maxlength="1500" placeholder="완료 후 새롭게 확인한 문제"></label>':''}<div class="fo-actions">${next?`<button class="fo-primary" type="submit" name="toStatus" value="${next}">${next} 단계로 기록</button>`:''}${['조치완료','현장확인'].includes(issue.status)?'<button type="submit" name="toStatus" value="검토">검토 단계로 재개</button>':''}</div></form></section>`;
 }
 function comparisonHtml(){
  const facilities=[...new Map((book?.issues||[]).map(i=>[i.facility.id,i.facility])).values()];
  if(!facilities.length)return '';
  const options=p=>'<option value="">추가 가정 없음</option>'+facilities.map(f=>`<option value="${e(f.id)}"${comparison?.plans?.[p.toLowerCase()]?.[0]?.facilityId===f.id?' selected':''}>${e(f.name)}</option>`).join('');
  const day=fieldToday();
  return `<details class="fo-comparison"${comparison?' open':''}><summary>같은 조건으로 운영 대안 A·B 비교</summary><p>이 지역에 기록한 ${facilities.length}개 시설을 같은 일시로 비교합니다. 확인기록과 가정은 구분하며, 시설 수가 수요나 안전도를 뜻하지 않습니다.</p><form id="fo-compare" class="fo-form"><label>공통 비교 일시 · 한국시간<input type="datetime-local" name="at" required value="${comparison?.at||day+'T14:00'}"></label><label>가정을 적용할 시작 일시<input type="datetime-local" name="startsAt" required value="${e(comparison?.plans?.a?.[0]?.startsAt||comparison?.plans?.b?.[0]?.startsAt||day+'T09:00')}"></label><label>가정을 적용할 종료 일시<input type="datetime-local" name="endsAt" required value="${e(comparison?.plans?.a?.[0]?.endsAt||comparison?.plans?.b?.[0]?.endsAt||day+'T18:00')}"></label><div class="fo-plans">${['A','B'].map(p=>`<fieldset><legend>대안 ${p} · 사용자 가정</legend><label>가정을 적용할 시설<select name="facility${p}">${options(p)}</select></label><label>운영 가정<select name="kind${p}"><option value="closed">이 시간에 임시 폐쇄</option><option value="temporary-open"${comparison?.plans?.[p.toLowerCase()]?.[0]?.kind==='temporary-open'?' selected':''}>이 시간에 임시 개방</option></select></label><label>가정 이유<input name="reason${p}" maxlength="300" value="${e(comparison?.plans?.[p.toLowerCase()]?.[0]?.reason||'')}" placeholder="예: 운영 인력 확보를 가정"></label></fieldset>`).join('')}</div><button type="submit">같은 시설·일시로 비교</button></form>${comparison?`<table class="fo-table"><caption>확인기록과 가정을 적용한 분류 · 실제 운영 여부 아님</caption><thead><tr><th>분류</th><th>A</th><th>B</th></tr></thead><tbody>${[['available','이용 가능 분류'],['unavailable','이용 불가 분류'],['unknown','미확인'],['assumed','가정 적용 시설']].map(([k,l])=>`<tr><th>${l}</th><td>${comparison.a[k]}곳</td><td>${comparison.b[k]}곳</td></tr>`).join('')}</tbody></table><p class="fo-help">${e(comparison.at)} 기준 · 차이 ${comparison.availableDifference>0?'+':''}${comparison.availableDifference}곳. 가정은 확인기록에 저장되지 않습니다.</p><details><summary>시설별 분류 근거</summary>${['a','b'].map(p=>`<h4>대안 ${p.toUpperCase()}</h4><ul>${comparison[p].rows.map(r=>`<li>${e(r.name)} · ${e(AVAILABILITY[r.state])} · ${r.origin==='assumption'?'사용자 가정':r.origin==='observation'?'확인기록':'미확인'}<br>${e(r.basis)}</li>`).join('')}</ul>`).join('')}</details>`:''}</details>`;
 }
 function render(){
  if(destroyed||!book)return;const issue=current(),scroll=host()?.scrollTop||0;
  api.show('현장조치 기록 · 대안 비교',`<div class="field-operations"><p class="fo-local-note">${localNotice}</p><p class="fo-scope">${e(scopeName())} · 기록 ${book.issues.length}건</p><div class="fo-actions"><button data-action="field-new">새 과제</button><button data-action="field-reload">최신 기록 다시 읽기</button></div>${error?`<p class="fo-error" role="alert">${e(error)}</p>`:''}${notice?`<p class="fo-notice" role="status">${e(notice)}</p>`:''}<label class="fo-task-label">기록한 과제<select id="fo-issue"><option value="">새 과제 작성</option>${book.issues.map(i=>`<option value="${e(i.id)}"${i.id===selectedId?' selected':''}>${e(i.status)} · ${e(i.title)}</option>`).join('')}</select></label>${catalogueBusy?'<p role="status">공개시설 목록을 읽고 있습니다.</p>':''}${catalogueError?`<p class="fo-help">${e(catalogueError)} 직접 장소를 입력해 미검증 과제로 남길 수 있습니다.</p>`:''}${issue?`<section class="fo-selected"><span class="fo-status">${e(issue.status)}</span><h3>${e(issue.title)}</h3><p>${e(issue.facility.name)} · ${e(issue.facility.address||'주소 미기록')}</p>${issue.facility.sourceUrl?`<p class="fo-help"><a href="${e(issue.facility.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(issue.facility.sourceName)} · 공개 원문</a><br>자료 기준일: ${e(issue.facility.sourceDate||'미제공')}</p>`:''}<p class="fo-help">${issue.facility.kind==='unverified'?'직접 입력한 장소 · 위치 미검증':matches(issue.facility)?'현재 연결한 공개목록과 일치 · 운영·출입구는 별도 확인':'저장 당시 공개목록 · 현재 목록과 대조되지 않음'}</p>${matches(issue.facility)&&issue.facility.coordinates?'<button data-action="field-locate">대표위치 지도에서 보기</button>':''}</section><details class="fo-edit-details"><summary>과제 내용·담당 역할 수정</summary>${issueForm(issue)}</details>${transitionForm(issue)}<details><summary>수정·조치 이력 ${issue.history.length}건</summary>${fieldHistoryHtml(issue)}</details>`:issueForm(null)}${comparisonHtml()}<details class="fo-backup"><summary>기록 백업·복원</summary><p>이 기기의 기록을 파일로 보관합니다. 파일을 다른 담당자에게 전달하는 기능은 포함하지 않습니다. 같은 과제의 서로 다른 수정본은 덮어쓰지 않습니다.</p><div class="fo-actions"><button data-action="field-export">JSON 백업</button><button data-action="field-csv">목록 CSV</button></div><label>같은 지역의 백업 파일 복원<input id="fo-import" type="file" accept="application/json,.json"></label></details></div>`,VIEW);
  if(host())host().scrollTop=scroll;
 }
 async function loadCatalogue(){
  controller?.abort();controller=new AbortController();const active=controller,seq=++sequence;catalogueBusy=true;catalogueError='';if(openNow())render();
  const timer=setTimeout(()=>active.abort(),20000);
  const read=async path=>{const r=await fetch(path,{signal:active.signal});if(!r.ok)throw Error('공개시설 자료를 읽지 못했습니다.');const text=await r.text();if(text.length>8*1024*1024)throw Error('공개자료가 너무 큽니다.');return JSON.parse(text);};
  try{
   const manifest=await read(`/data/decision/${regionId}/manifest.json`);if(manifest.regionId!==regionId||!Array.isArray(manifest.datasets))throw Error('지역 자료가 일치하지 않습니다.');
   const relevant=manifest.datasets.filter(d=>d.topic==='care'||['public-spaces','schools','police','heat-shelters','childcare'].includes(d.id)).slice(0,25);
   const jobs=relevant.map(async d=>{
    if(typeof d.path!=='string'||d.path.includes('..')||!(/^\/data\/[a-zA-Z0-9_./-]+\.(geojson|json)$/.test(d.path))||!(d.path.startsWith(`/data/decision/${regionId}/`)||d.path.startsWith(`/data/regions/${regionId}/`)||regionId==='seogu'&&/^\/data\/(city|layers)\//.test(d.path)))throw Error('시설 자료 경로를 확인하세요.');
    const raw=await read(d.path);if(raw.type!=='FeatureCollection'||!Array.isArray(raw.features)||raw.metadata?.regionId&&raw.metadata.regionId!==regionId)throw Error('시설 목록 형식을 확인하세요.');
    return raw.features.slice(0,5000).flatMap((f,i)=>{
     const p=f.properties||{},point=f.geometry?.type==='Point'?f.geometry.coordinates?.slice(0,2):null;
     if(!point?.every(Number.isFinite)||point.length!==2||!inside(point,api.state.district))return [];
     const rawId=String(p.id??f.id??i),facilityId=`catalogue:${d.id}:${/^[a-zA-Z0-9_.:-]{1,90}$/.test(rawId)?rawId:i}`;
     try{return [validateFieldFacility({kind:'catalogue',id:facilityId,name:p.name||p.facilityName||d.title,address:p.address||p.roadAddress||p.lotAddress||'',coordinates:point,sourceName:p.sourceName||raw.metadata?.sourceName||d.sourceName||'',sourceUrl:p.sourceUrl||raw.metadata?.sourceUrl||d.sourceUrl||null,sourceDate:fieldDate(p.sourceDate||raw.metadata?.sourceDate||d.sourceDate)?p.sourceDate||raw.metadata?.sourceDate||d.sourceDate:null})];}catch{return [];}
    });
   });
   if(manifest.careDirectoryPath){jobs.push((async()=>{
    if(manifest.careDirectoryPath!==`/data/decision/${regionId}/care-directory.json`)throw Error('시설 주소목록 경로를 확인하세요.');
    const directory=await read(manifest.careDirectoryPath);if(directory.regionId!==regionId||!Array.isArray(directory.entries))throw Error('시설 주소목록의 지역을 확인하세요.');
    return directory.entries.slice(0,5000).flatMap(p=>{
     if(p.regionId!==regionId||p.coordinates!==null||!/^[a-zA-Z0-9_.:-]{1,90}$/.test(p.id||'')||!relevant.some(d=>d.id===p.datasetId))return [];
     try{return [validateFieldFacility({kind:'catalogue',id:`catalogue:${p.datasetId}:${p.id}`,name:p.name,address:p.address||'',coordinates:null,sourceName:p.sourceName||'',sourceUrl:p.sourceUrl||null,sourceDate:fieldDate(p.sourceDate)?p.sourceDate:null})];}catch{return [];}
    });
   })());}
   const results=await Promise.allSettled(jobs);
   if(seq!==sequence||destroyed)return;catalogue=[...new Map(results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value).map(f=>[f.id,f])).values()].slice(0,5000);
   catalogueError=results.some(r=>r.status==='rejected')?'일부 공개시설을 읽지 못했습니다. 연결된 목록만 표시합니다.':catalogue.length?'':'연결된 공개시설 목록이 없습니다.';
  }catch(cause){if(seq!==sequence||destroyed)return;catalogueError=cause.name==='AbortError'?'공개시설 조회 시간이 길어졌습니다.':cause.message;}
  finally{clearTimeout(timer);if(seq===sequence&&!destroyed){catalogueBusy=false;if(openNow())render();}}
 }
 async function open(){
  const next=api.state.regionProfile?.id;if(!/^[a-z0-9-]{1,60}$/.test(next||'')){api.toast?.('지역 자료가 준비된 뒤 열어 주세요.');return;}
  if(regionId!==next){regionId=next;selectedId='';catalogue=[];query='';comparison=null;error='';notice='';readStorage();render();await loadCatalogue();}else render();
 }
 function facilityFrom(form,issue){
  const choice=String(form.get('facility')||'manual');if(choice==='saved'&&issue)return issue.facility;if(choice!=='manual'){const found=catalogue.find(f=>f.id===choice);if(!found)throw Error('공개시설 목록에서 다시 선택하세요.');return found;}
  return {kind:'unverified',id:issue?.facility.kind==='unverified'?issue.facility.id:'manual-'+crypto.randomUUID(),name:String(form.get('manualName')||''),address:String(form.get('manualAddress')||''),coordinates:null,sourceName:'사용자 직접 입력 · 위치 미검증',sourceUrl:null,sourceDate:null};
 }
 const submit=event=>{
  if(!['fo-edit','fo-transition','fo-compare'].includes(event.target.id))return;event.preventDefault();error='';notice='';
  try{const form=new FormData(event.target),issue=current();
   if(event.target.id==='fo-edit'){
    const next=saveFieldIssue(book,{title:String(form.get('title')||''),description:String(form.get('description')||''),role:String(form.get('ownerRole')||''),facility:facilityFrom(form,issue),scopeId:issue?.scopeId||api.state.dong||'all',observation:null},{issueId:issue?.id,expectedRevision:Number(form.get('revision'))});persist(next);selectedId=next.issues[0].id;notice='이 기기에 개인 검토기록을 저장했습니다.';
   }else if(event.target.id==='fo-transition'){
    if(!issue)throw Error('과제를 먼저 선택하세요.');const next=transitionFieldIssue(book,issue.id,{toStatus:event.submitter?.value,role:issue.role,checkedOn:String(form.get('checkedOn')||''),basis:String(form.get('basis')||''),availability:String(form.get('availability')||'unknown'),validThrough:String(form.get('validThrough')||'')||null,reopenReason:String(form.get('reopenReason')||'')},Number(form.get('revision')));persist(next);notice='확인 근거와 상태 변경을 이력에 남겼습니다.';
   }else{
    const facilities=[...new Map(book.issues.map(i=>[i.facility.id,i.facility])).values()],plan=p=>form.get(`facility${p}`)?[{facilityId:String(form.get(`facility${p}`)),kind:String(form.get(`kind${p}`)),startsAt:String(form.get('startsAt')),endsAt:String(form.get('endsAt')),reason:String(form.get(`reason${p}`)||'')}]:[];
    comparison=compareFieldAlternatives({facilities,issues:book.issues,at:String(form.get('at')),planA:plan('A'),planB:plan('B')});
   }render();
  }catch(cause){error=cause.message;const node=host()?.querySelector('.fo-error');if(node)node.textContent=error;else{const n=document.createElement('p');n.className='fo-error';n.setAttribute('role','alert');n.textContent=error;host()?.querySelector('.field-operations')?.prepend(n);}}
 };
 const change=async event=>{
  if(event.target.id==='fo-issue'){selectedId=event.target.value;error='';notice='';render();}
  if(event.target.id==='fo-facility'){const block=host()?.querySelector('.fo-manual');if(block)block.hidden=event.target.value!=='manual';}
  if(event.target.id==='fo-import'&&event.target.files?.[0]){try{const file=event.target.files[0],importRegion=regionId,importSequence=sequence;if(file.size>FIELD_LIMITS.bytes)throw Error('백업 파일은 2MB 이하여야 합니다.');const text=await file.text();if(destroyed||regionId!==importRegion||sequence!==importSequence)throw Error('지역이 바뀌어 복원을 중단했습니다. 해당 지역에서 파일을 다시 선택하세요.');const parsed=parseFieldBackup(text,importRegion);persist(restoreFieldBackup(book,parsed));notice='백업을 검증해 복원했습니다. 현재 공개목록·현장 상태는 다시 확인하세요.';error='';if(openNow())render();else api.toast?.(notice);}catch(cause){error=cause.message;if(openNow())render();else api.toast?.(error);}finally{event.target.value='';}}
 };
 const offs=[registerAction('field-operations',open),registerAction('field-new',()=>{selectedId='';query='';error='';notice='';render();}),registerAction('field-facility-search',()=>{query=document.getElementById('fo-facility-query')?.value||'';const select=document.getElementById('fo-facility');if(select)select.innerHTML=facilityOptions(current());}),registerAction('field-reload',()=>{error='';notice='';readStorage();if(!current())selectedId='';render();if(catalogueError&&!catalogueBusy)loadCatalogue();}),registerAction('field-export',()=>{download(`${regionId}_현장검토_백업.json`,JSON.stringify(book),'application/json');}),registerAction('field-csv',()=>download(`${regionId}_현장검토_목록.csv`,fieldBookCsv(book),'text/csv;charset=utf-8')),registerAction('field-locate',()=>{const f=current()?.facility;if(!f||!matches(f)||!f.coordinates)return;if(!inside(f.coordinates,api.state.scope))api.chooseDong?.('all',false);api.frameGeometry?.({type:'Point',coordinates:f.coordinates});})];
 host()?.addEventListener('submit',submit);host()?.addEventListener('change',change);
 return {open,scopeChanged(){if(openNow()){if(regionId!==api.state.regionProfile?.id)open();else render();}},destroy(){destroyed=true;controller?.abort();sequence++;offs.forEach(off=>off());host()?.removeEventListener('submit',submit);host()?.removeEventListener('change',change);}};
}
