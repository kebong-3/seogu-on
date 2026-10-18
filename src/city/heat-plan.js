import {registerAction} from './actions.js';
import {frameFor} from './camera.js';
import {inside} from './geometry.js';
import {calculatePlan,comparisonHtml,reportHtml,escapeHtml as e,ACTION_NAMES,REVIEW_NAMES,PLAN_VERSION} from './heat-plan-model.js';

const SOURCES={bus:'/data/city/infra/bus.geojson',shade:'/data/city/local-shade.geojson',shelter:'/data/city/official/heat-shelter.geojson'};
const KEY='seogu-heat-review-v1';
const defaults={shadeRadius:150,shelterRadius:300,maxNew:3,years:3,operating:'',unit:'',maintenance:'',budget:''};
const input=(name,label,value,extra='')=>`<label>${label}<input name="${name}" type="number" value="${e(value)}" ${extra}></label>`;
function download(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function installHeatPlan(api) {
  let settings={...defaults}, reviews={}, decision={preferred:'pending',rationale:''}, datasets=null, plan=null, scopeId=null, dirty=false, busy=false, fingerprint='',saved=null;
  try {saved=JSON.parse(localStorage.getItem(KEY));if(saved?.version!==PLAN_VERSION)saved=null;} catch {}
  const host=()=>document.getElementById('detail-body');
  function save() {
    try {localStorage.setItem(KEY,JSON.stringify({version:PLAN_VERSION,scopeId,settings,reviews,decision,fingerprint}));}
    catch {api.toast('이 브라우저에 저장하지 못했습니다. 보고서와 검토기록을 파일로 저장하세요.');}
  }
  function formHtml() {
    return `<form id="heat-plan-form"><div class="hp-fields"><label>검토 구역<select name="scopeId"><option value="all">서구 전체</option>${api.state.dongs.map(f=>`<option value="${e(f.properties.dongId)}" ${f.properties.dongId===scopeId?'selected':''}>${e(f.properties.dongName)}</option>`).join('')}</select></label>
      ${input('shadeRadius','그늘막 근접 검토거리 (m)',settings.shadeRadius,'min="10" max="1000" required')}
      ${input('shelterRadius','기존 쉼터 연결 검토거리 (m)',settings.shelterRadius,'min="10" max="2000" required')}
      ${input('maxNew','추가 설치 후보 상한 (지점)',settings.maxNew,'min="0" max="100" step="1" required')}
      ${input('years','비용 검토기간 (년)',settings.years,'min="1" max="10" step="1" required')}</div>
      <details><summary>비용과 예산 입력 · 선택사항 / 단위: 만원</summary><p>빈칸은 미산정입니다. 기존 시설 연계에 드는 추가 운영비를 안 전체 기준으로 입력하세요. 단가는 공사·부대비를 포함한 가정이며 물가·할인율은 적용하지 않습니다.</p><div class="hp-fields">
      ${input('operating','기존 활용 연간 추가 운영비 (전체)',settings.operating,'min="0" max="100000000" step="0.01"')}
      ${input('unit','신규 1지점 설치비',settings.unit,'min="0" max="100000000" step="0.01"')}
      ${input('maintenance','신규 1지점 연간 유지비',settings.maintenance,'min="0" max="100000000" step="0.01"')}
      ${input('budget','첫해 예산 한도',settings.budget,'min="0" max="100000000" step="0.01"')}</div></details>
      <button type="button" class="primary full" data-action="heat-plan-calculate" ${busy?'disabled':''}>${busy?'공개자료 확인 중…':'두 안 비교하기'}</button></form>`;
  }
  function resultsHtml() {
    if(!plan)return '<p class="hp-empty">검토조건을 정하고 두 안을 비교하세요. 확보된 정류장·그늘막·무더위쉼터 자료로 후보를 연결합니다.</p>';
    return `<section aria-labelledby="hp-results-title"><h3 id="hp-results-title">2. ${e(plan.scopeName)} · 대안 비교</h3><div class="hp-metrics"><div><b>${plan.total}</b><span>수록 정류장</span></div><div><b>${plan.baseline}</b><span>그늘막 근접 지점</span></div><div><b>${plan.candidates.length}</b><span>이번 검토 후보</span></div></div>
      <p>기존 쉼터 연결을 먼저 검토하고, 나머지는 가까운 그늘막까지의 거리가 긴 순서로 추가 설치 후보를 제안합니다. 위험도·사업 우선순위 판정은 아닙니다.</p><div class="hp-table">${comparisonHtml(plan)}</div><p class="hp-notice">${plan.costs.budgetStatus==='over'?'입력한 첫해 한도를 초과합니다. 비용 가정을 조정하세요.':plan.costs.budgetStatus==='within'?'입력한 비용 가정에서 첫해 한도 이내입니다.':'비용·예산 미입력 시 한도 내 설치 가능 여부는 판정하지 않습니다.'} 지점 수는 보호 인원이나 실제 그늘 효과가 아닙니다.</p>
      <h3>3. 후보 검토와 지도 확인</h3><p>청록색은 기존 쉼터 연결 후보, 주황색은 추가 설치 후보입니다. 보류·제외하면 나머지 후보로 다시 계산합니다. 쉼터는 서구 전체 공개본에서 검색합니다.</p>
      <div class="hp-candidates">${plan.candidates.map(r=>`<details class="hp-candidate"><summary><span>${e(r.name)}</span><small>${e(ACTION_NAMES[r.action])} · ${e(REVIEW_NAMES[r.review])}</small></summary><p>식별자 ${e(r.id)} · 최근접 그늘막 ${r.shade?Math.round(r.shade.m)+'m':'수록 없음'}<br>최근접 쉼터 ${e(r.shelter?.name || '수록 없음')} ${r.shelter?Math.round(r.shelter.m)+'m':''} ${r.existingAvailable?'(연결조건 이내)':'(연결조건 밖 또는 미수록)'}</p>
      <div class="hp-fields"><label>대응방안<select data-review-id="${e(r.id)}" data-field="choice">${[['auto','자동 제안'],['existing','기존 쉼터 연결'],['install','추가 설치 후보'],['exclude','보류·제외']].map(([v,t])=>`<option value="${v}" ${r.choice===v?'selected':''} ${v==='existing'&&!r.existingAvailable?'disabled':''}>${t}</option>`).join('')}</select></label><label>확인 상태<select data-review-id="${e(r.id)}" data-field="review">${Object.entries(REVIEW_NAMES).map(([v,t])=>`<option value="${v}" ${r.review===v?'selected':''}>${t}</option>`).join('')}</select></label></div>
      <label>현장 확인 내용·보류 사유<textarea maxlength="500" data-review-id="${e(r.id)}" data-field="note" placeholder="예: 개방시간 확인 필요, 보도 폭 조사 예정">${e(r.note)}</textarea></label><div class="hp-buttons"><button data-action="heat-plan-locate" data-id="${e(r.id)}">지점 지도 보기</button>${r.shelter?`<button data-action="heat-plan-locate" data-id="${e(r.id)}" data-target="shelter">연결 쉼터 보기</button>`:''}</div></details>`).join('') || '<p>현재 조건에서 추가 검토 후보가 없습니다. 실제 대응이 충분함을 뜻하지 않습니다.</p>'}</div>
      <h3>4. 검토의견과 보고서</h3><label>선호안<select data-decision="preferred">${[['pending','검토 중'],['A','A · 기존 시설 활용'],['B','B · 기존 활용 + 추가 설치']].map(([v,t])=>`<option value="${v}" ${decision.preferred===v?'selected':''}>${t}</option>`).join('')}</select></label><label>선정 근거와 후속 확인사항<textarea data-decision="rationale" maxlength="3000" placeholder="기존 시설 활용 협의, 추가 설치 현장조사, 견적 확인 등">${e(decision.rationale)}</textarea></label>
      <p>원자료는 변경하지 않습니다. 검토 입력은 이 브라우저에 저장됩니다. 개인정보를 입력하지 마세요.</p><div class="hp-buttons"><button class="primary" data-action="heat-plan-report" data-export>검토보고서 미리보기</button><button data-action="heat-plan-download" data-export>보고서 HTML 저장</button><button data-action="heat-plan-json" data-export>검토기록 JSON 저장</button></div></section>`;
  }
  function render() {
    api.show('폭염 대응계획',`<div class="heat-plan"><p class="hp-kicker">자산 활용 → 대안 비교 → 담당자 검토 → 보고서</p><p class="hp-intro">기존 시설을 더 잘 활용하고, 추가 설치를 검토할 근거를 한곳에 모읍니다.</p><div class="hp-notice">수록자료 기반 검토 도구입니다. 거리 조건은 실제 그늘·보행 접근성·안전 수준을 뜻하지 않습니다.</div><h3>1. 검토조건</h3>${formHtml()}<p id="hp-status" role="status" aria-live="polite"></p>${resultsHtml()}<details><summary>자료와 계산 범위</summary><p>버스정류장: OSM 부분 자료 / 그늘막: 서구 공개본 / 쉼터: 국민안전24 공식 공개본. 쉼터 API를 중복 합산하지 않습니다. 구역 밖 인접 쉼터도 연결 후보에 포함합니다. 현재 운영 및 설치 적합성은 확인하지 않았습니다.</p>${plan?`<ul>${plan.sources.map(s=>`<li>${e(s.sourceName || s.key)} · 기준 ${e(s.sourceDate || (s.sourceDateMin?`${s.sourceDateMin} ~ ${s.sourceDateMax}`:'미제공'))} · 수집 ${e(s.collectedAt || s.snapshotAt || '미제공')}</li>`).join('')}</ul>`:''}</details><div class="hp-buttons"><button data-action="heat-shade">3D 그림자로 현장 검토 보조</button></div></div>`,'heat-plan');
    markDirty(dirty);
  }
  function markDirty(value) {
    dirty=value;
    host()?.querySelectorAll('[data-export],[data-review-id]').forEach(b=>b.disabled=dirty);
    const status=document.getElementById('hp-status');
    if(status)status.textContent=dirty?'조건이 변경되었습니다. 다시 비교해야 보고서에 반영됩니다.':plan?'현재 조건으로 비교했습니다. 현장 확인 후 보고서를 활용하세요.':'';
  }
  function scope() {return api.state.dongs.find(f=>f.properties.dongId===scopeId);}
  function recompute(redraw=true) {
    plan=calculatePlan({datasets,scope:scopeId==='all'?null:scope()?.geometry,scopeName:scopeId==='all'?'서구 전체':scope()?.properties.dongName || '선택 구역',settings,reviews});
    save(); if(redraw)paintMap();
  }
  function paintMap() {
    api.state.isolate=false;api.state.selected=null;
    api.state.entries.set('heat-plan-results',{state:'loaded',title:'폭염 대응 검토후보',metadata:{},features:plan.candidates.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:r.xy},properties:{id:r.id,name:`${r.name} · ${ACTION_NAMES[r.action]}`,displayColor:r.action==='existing'?'#008b82':r.action==='install'?'#df861c':'#748297',category:'폭염 검토후보',note:'현장 확인 전 후보'}}))});
    api.state.enabled.add('heat-plan-results');
    for(const id of ['local-shade','official-heat-shelter'])api.state.enabled.add(id);
    api.drawData();
  }
  registerAction('heat-plan',()=>{
    if(scopeId===null){scopeId=api.state.dong;if(saved){scopeId=saved.scopeId;settings={...defaults,...saved.settings};reviews=saved.reviews || {};decision=saved.decision || decision;fingerprint=saved.fingerprint || '';}}
    if(scopeId!=='all'&&!scope())scopeId='all';
    render();
  });
  registerAction('heat-plan-calculate',async()=>{
    if(busy)return;const form=document.getElementById('heat-plan-form');if(!form?.reportValidity())return;
    const values=Object.fromEntries(new FormData(form));
    const nextScope=values.scopeId;if(nextScope!==scopeId){reviews={};decision={preferred:'pending',rationale:''};}
    scopeId=nextScope;settings=Object.fromEntries(Object.keys(defaults).map(k=>[k,values[k]]));busy=true;
    form.querySelectorAll('input,select').forEach(input=>input.disabled=true);
    const button=form.querySelector('button');button.disabled=true;button.textContent='공개자료 확인 중…';
    try {
      const fetched=await Promise.all(Object.entries(SOURCES).map(async([key,url])=>{
        const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`${key} 자료 미수신 (${response.status})`);
        const bytes=await response.arrayBuffer();const data=JSON.parse(new TextDecoder().decode(bytes));
        if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error(`${key} 자료 형식 오류`);
        const hash=await crypto.subtle.digest('SHA-256',bytes);data.sha256=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');return [key,data];
      }));
      datasets=Object.fromEntries(fetched);const next=fetched.map(([k,d])=>k+':'+d.sha256).join('|');
      if(fingerprint&&fingerprint!==next){reviews={};decision={preferred:'pending',rationale:''};api.toast('자료가 바뀌어 이전 확인상태를 초기화했습니다. 다시 검토하세요.');}
      fingerprint=next;dirty=false;recompute();
      if(api.state.view==='heat-plan'){api.chooseDong(scopeId);render();}
    }catch(error){dirty=true;if(api.state.view==='heat-plan'){render();document.getElementById('hp-status').textContent=`${error.message} 이전 결과로 보고서를 만들지 않습니다. 다시 조회하세요.`;}}
    finally{busy=false;if(api.state.view==='heat-plan'){document.querySelectorAll('#heat-plan-form input,#heat-plan-form select').forEach(input=>input.disabled=false);const b=document.querySelector('[data-action="heat-plan-calculate"]');if(b){b.disabled=false;b.textContent='두 안 비교하기';}}}
  });
  host()?.addEventListener('input',event=>{
    const t=event.target;
    if(t.closest('#heat-plan-form'))markDirty(true);
    if(t.dataset.decision){decision[t.dataset.decision]=t.value;save();}
    if(t.dataset.reviewId && t.dataset.field==='note' && !dirty && plan){
      const id=t.dataset.reviewId;
      reviews[id]={...reviews[id],note:t.value};
      if(!t.value.trim()&&reviews[id].review==='checked'){
        reviews[id].review='unreviewed';
        t.closest('.hp-candidate').querySelector('[data-field="review"]').value='unreviewed';
      }
      recompute(false);
    }
  });
  host()?.addEventListener('change',event=>{
    const t=event.target,id=t.dataset.reviewId;
    if(!id || dirty || !plan)return;
    const openIds=[...host().querySelectorAll('.hp-candidate[open]')].map(d=>d.querySelector('[data-review-id]').dataset.reviewId);
    const scroll=host().scrollTop;
    reviews[id]={...reviews[id],[t.dataset.field]:t.value};
    if(t.dataset.field==='review' && t.value==='checked' && !reviews[id].note?.trim()){
      reviews[id].review='unreviewed';t.value='unreviewed';api.toast('현장 확인 내용을 먼저 적은 뒤 확인 상태를 선택하세요.');return;
    }
    if(t.dataset.field==='note'){recompute(false);return;}
    recompute();render();
    host().querySelectorAll('.hp-candidate').forEach(d=>{if(openIds.includes(d.querySelector('[data-review-id]').dataset.reviewId))d.open=true;});host().scrollTop=scroll;
  });
  registerAction('heat-plan-locate',button=>{
    const r=plan?.candidates.find(x=>x.id===button.dataset.id);const xy=button.dataset.target==='shelter'?r?.shelter?.xy:r?.xy;if(!xy)return;
    if(api.state.scope&&!inside(xy,api.state.scope))api.chooseDong('all',false);
    api.send({type:'camera',pose:frameFor({type:'Point',coordinates:xy},'facility',{width:Math.max(320,innerWidth-760),height:Math.max(350,innerHeight-190)})});
    api.close();
    api.toast((button.dataset.target==='shelter'?'연결 쉼터':'검토지점')+' 대표위치로 이동했습니다. 폭염 대응계획을 누르면 검토를 이어갑니다.');
  });
  const current=()=>{if(!plan||dirty){api.toast('검토조건을 다시 비교한 뒤 보고서를 저장하세요.');return false;}return true;};
  registerAction('heat-plan-download',()=>{if(current())download(`서구온_폭염검토_${plan.scopeName}.html`,reportHtml(plan,decision),'text/html;charset=utf-8');});
  registerAction('heat-plan-json',()=>{if(current())download(`서구온_폭염검토기록_${plan.scopeName}.json`,JSON.stringify({plan,decision,reviews},null,2),'application/json');});
  registerAction('heat-plan-report',()=>{
    if(!current())return;
    api.show('폭염 대응 검토보고서',`<div class="heat-plan"><p>인쇄 창에서 PDF로 저장할 수 있습니다. 현장 확인 전 검토용 초안입니다.</p><div class="hp-buttons"><button data-action="heat-plan">검토로 돌아가기</button><button data-action="heat-plan-print">인쇄 / PDF 저장</button><button data-action="heat-plan-download">HTML 저장</button></div><iframe class="hp-report" title="폭염 대응 검토보고서 미리보기" sandbox srcdoc="${e(reportHtml(plan,decision))}"></iframe></div>`,'heat-plan-report');
  });
  registerAction('heat-plan-print',()=>{
    if(!current())return;const w=window.open('','_blank');if(!w){api.toast('팝업이 차단되었습니다. HTML 저장 후 브라우저에서 인쇄하세요.');return;}
    w.opener=null;w.document.write(reportHtml(plan,decision));w.document.close();w.focus();w.print();
  });
}
