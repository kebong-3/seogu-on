import {registerAction} from './actions.js';
import {frameFor} from './camera.js';
import {inside} from './geometry.js';
import {escapeHtml as e} from './heat-plan-model.js';
import {WORKFLOWS,PLAN_ACTIONS,PLAN_REVIEW,ADMIN_PLAN_VERSION,calculateAdminPlan,adminReportHtml} from './admin-plans-model.js';
const PAGE_SIZE=30;
const saveFile=(name,content,type)=>{const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
export function installAdminPlans(api) {
  const drafts=new Map();let active=null,loadSequence=0;
  const host=()=>document.getElementById('detail-body');
  function draft(kind) {
    if(!drafts.has(kind)){
      let saved=null;try{saved=JSON.parse(localStorage.getItem('seogu-admin-'+kind));if(saved?.version!==ADMIN_PLAN_VERSION)saved=null;}catch{}
      drafts.set(kind,{kind,scopeId:saved?.scopeId||api.state.dong,settings:{radius:300,maxNew:3,...saved?.settings},reviews:saved?.reviews||{},opinion:saved?.opinion||'',fingerprint:saved?.fingerprint||'',plan:null,source:null,assets:null,dirty:false,busy:false,page:0,error:''});
    }
    return drafts.get(kind);
  }
  function save(d) {try{localStorage.setItem('seogu-admin-'+d.kind,JSON.stringify({version:ADMIN_PLAN_VERSION,scopeId:d.scopeId,settings:d.settings,reviews:d.reviews,opinion:d.opinion,fingerprint:d.fingerprint}));}catch{api.toast('브라우저 저장이 제한되어 있습니다. 검토기록을 파일로 저장하세요.');}}
  function recompute(d,redraw=false) {
    const scope=api.state.dongs.find(f=>f.properties.dongId===d.scopeId);
    if(d.scopeId!=='all'&&!scope)throw Error('선택 구역의 경계 자료를 확인하지 못했습니다.');
    d.plan=calculateAdminPlan({kind:d.kind,source:d.source,assets:d.assets,scope:scope?.geometry,scopeName:scope?.properties.dongName||'서구 전체',settings:d.settings,reviews:d.reviews});save(d);if(redraw)paintMap(d);
  }
  function paintMap(d) {
    const features=d.plan.rows.flatMap(r=>r.features.map(f=>({...f,properties:{...f.properties,id:d.kind+':'+f.properties.id,displayColor:r.action==='exclude'?'#788999':r.status==='checked'?'#008b82':r.action==='supplement'||r.action==='coordinate'?'#dd861c':'#2374bd'}})));
    for(const kind of Object.keys(WORKFLOWS))api.state.enabled.delete('admin-plan-'+kind);
    api.state.entries.set('admin-plan-'+d.kind,{features,state:'loaded',title:WORKFLOWS[d.kind].title+' 검토대상',metadata:{},loadedAt:new Date().toISOString()});
    api.state.enabled.add('admin-plan-'+d.kind);if(d.kind==='cold')api.state.enabled.add('official-cold-shelter');
    api.state.isolate=false;api.state.selected=null;api.drawData();
  }
  const options=(items,value)=>Object.entries(items).map(([v,label])=>`<option value="${e(v)}" ${v===value?'selected':''}>${e(label)}</option>`).join('');
  function results(d) {
    const p=d.plan;if(!p)return '<p class="hp-empty">선택한 구역의 공개자료를 불러오면 점검대상과 확인표를 만듭니다.</p>';
    const c=WORKFLOWS[d.kind],rows=p.rows.slice(d.page*PAGE_SIZE,(d.page+1)*PAGE_SIZE);
    const comparison=d.kind==='cold'?`<div class="hp-table"><table><caption>한파 대응 대안 비교</caption><thead><tr><th>비교 항목</th><th>A 기존 쉼터 활용</th><th>B 기존 활용 + 대기환경 보완</th></tr></thead><tbody><tr><th>기존 쉼터 연결 후보</th><td>${p.existing}지점 / ${p.facilities}개 쉼터</td><td>${p.existing}지점 / ${p.facilities}개 쉼터</td></tr><tr><th>대기환경 보완 후보</th><td>0지점</td><td>${p.additional}지점</td></tr><tr><th>비용</th><td>미산정 · 운영 협의·견적 필요</td><td>미산정 · 설치·운영·유지비 견적 필요</td></tr></tbody></table></div><p>연결 후보 수는 보호 인원이 아닙니다. 보완 후보는 담당자가 지정한 대상을 우선하고, 자동 후보는 가까운 쉼터 거리가 긴 순서로 제안합니다. 위험도·최적 입지 판정은 아닙니다.</p>`:'';
    return `<section><h3>2. ${e(p.scopeName)} · 검토대상</h3><div class="hp-metrics"><div><b>${p.rows.length}</b><span>${e(p.unit)}</span></div><div><b>${p.checked}</b><span>확인 기록 있음</span></div><div><b>${p.excluded}</b><span>보류·제외</span></div></div><p>원자료 ${p.sourceRecords}건을 묶어 표시합니다. 기록 수와 독립 시설·피해 건수는 다를 수 있습니다.</p>${comparison}
      <h3>3. 현장 확인과 후속조치</h3><ul>${c.checks.map(x=>`<li>${e(x)}</li>`).join('')}</ul><p>확인 내용을 적은 뒤 ‘확인 기록 있음’으로 바꿀 수 있습니다. 담당부서는 조직명만 적고 개인 이름·연락처는 입력하지 마세요.</p>
      <div class="hp-candidates">${rows.map(r=>`<details class="hp-candidate"><summary><span>${e(r.name)}</span><small>${e(PLAN_ACTIONS[r.action])} · ${e(PLAN_REVIEW[r.status])}</small></summary><p>원자료 ${r.records.length}건 · ${e(r.records.join(', '))}${r.years.length?'<br>발생연도 '+e(r.years.sort().join(', ')):''}${r.address?'<br>'+e(r.address):''}</p>${r.nearest?`<p>최근접 한파쉼터: ${e(r.nearest.name)} · 직선 ${Math.round(r.nearest.m)}m (${r.possible?'연결조건 이내':'연결조건 밖'})<br>등록 수용인원 ${r.nearest.capacity===null?'미제공':e(r.nearest.capacity)} · 현재 개방·난방 상태 확인 필요</p>`:''}
        <div class="hp-fields"><label>검토안<select data-ap-id="${e(r.id)}" data-ap-field="choice">${options(d.kind==='cold'?{auto:'자동 제안',existing:'기존 쉼터 연결',supplement:'대기환경 보완 검토',exclude:'보류·제외'}:{inspect:PLAN_ACTIONS.inspect,coordinate:PLAN_ACTIONS.coordinate,exclude:PLAN_ACTIONS.exclude},r.choice)}</select></label><label>확인 상태<select data-ap-id="${e(r.id)}" data-ap-field="status">${options(PLAN_REVIEW,r.status)}</select></label><label>담당부서<input data-ap-id="${e(r.id)}" data-ap-field="department" maxlength="80" value="${e(r.department)}" placeholder="조직명만 입력"></label><label>후속 확인기한<input data-ap-id="${e(r.id)}" data-ap-field="due" type="date" value="${e(r.due)}"></label></div><label>현장 확인 내용·보류 사유<textarea data-ap-id="${e(r.id)}" data-ap-field="note" maxlength="600">${e(r.note)}</textarea></label><div class="hp-buttons"><button data-action="admin-plan-locate" data-id="${e(r.id)}">대상 지도 보기</button>${r.nearest?`<button data-action="admin-plan-locate" data-id="${e(r.id)}" data-target="asset">연결 쉼터 보기</button>`:''}</div></details>`).join('')||'<p>선택 구역의 수록자료가 없습니다. 실제 대상이 없다는 뜻은 아닙니다.</p>'}</div>
      <div class="hp-buttons"><button data-action="admin-plan-page" data-step="-1" ${d.page===0?'disabled':''}>이전</button><span>${d.page+1} / ${Math.max(1,Math.ceil(p.rows.length/PAGE_SIZE))}쪽 · 한 화면 ${PAGE_SIZE}개</span><button data-action="admin-plan-page" data-step="1" ${(d.page+1)*PAGE_SIZE>=p.rows.length?'disabled':''}>다음</button></div>
      <h3>4. 검토의견과 보고서</h3><label>검토의견·협의사항<textarea data-ap-opinion maxlength="3000" placeholder="확인한 사실과 앞으로 확인할 사항을 구분해 작성하세요.">${e(d.opinion)}</textarea></label><p>보고서는 선택 구역 전체 ${p.rows.length}개 검토대상을 포함합니다. 검토 입력은 이 브라우저에 보관됩니다.</p><div class="hp-buttons"><button class="primary" data-action="admin-plan-report" data-ap-export>검토보고서 미리보기</button><button data-action="admin-plan-download" data-ap-export>보고서 HTML 저장</button><button data-action="admin-plan-json" data-ap-export>검토기록 JSON 저장</button></div></section>`;
  }
  function status(d) {
    host()?.querySelectorAll('[data-ap-export],[data-ap-id]').forEach(x=>x.disabled=d.dirty);
    const el=document.getElementById('ap-status');if(el)el.textContent=d.error||(d.dirty?'조건이 변경되었습니다. 다시 불러온 뒤 보고서를 저장하세요.':d.plan?'현재 조건으로 계산했습니다. 현장 확인 결과를 기록하세요.':'');
  }
  function render(d) {
    active=d.kind;const c=WORKFLOWS[d.kind];
    api.show(c.title,`<div class="heat-plan admin-plan"><p class="hp-kicker">공개자료 → 현장 확인 → 후속조치 → 검토보고서</p><p class="hp-intro">${e(c.intro)}</p><p class="hp-notice">${e(c.caveat)}</p><h3>1. 검토조건</h3><form id="admin-plan-form"><div class="hp-fields"><label>검토 구역<select name="scopeId"><option value="all" ${d.scopeId==='all'?'selected':''}>서구 전체</option>${api.state.dongs.map(f=>`<option value="${e(f.properties.dongId)}" ${d.scopeId===f.properties.dongId?'selected':''}>${e(f.properties.dongName)}</option>`).join('')}</select></label>${d.kind==='cold'?`<label>쉼터 연결 검토거리 (m)<input name="radius" type="number" min="10" max="2000" value="${e(d.settings.radius)}" required></label><label>대기환경 보완 후보 상한 (지점)<input name="maxNew" type="number" min="0" max="100" step="1" value="${e(d.settings.maxNew)}" required></label>`:''}</div><button type="button" class="primary full" data-action="admin-plan-load" ${d.busy?'disabled':''}>${d.busy?'공개자료 확인 중…':'검토대상 불러오기'}</button></form><p id="ap-status" role="status" aria-live="polite"></p>${results(d)}<details><summary>출처와 계산 범위</summary><p>${e(c.caveat)} 원자료는 수정하지 않으며 보고서에 기준일·수집일·해시를 기록합니다.</p>${d.plan?d.plan.sources.map(s=>`<p>${e(s.sourceName||'공개자료')} · 기준 ${e(s.sourceDate||(s.sourceDateMin?`${s.sourceDateMin} ~ ${s.sourceDateMax}`:'미제공'))} · 수집 ${e(s.collectedAt||s.snapshotAt||'미제공')}</p>`).join(''):''}</details></div>`,'admin-plan');
    const eyebrow=document.getElementById('detail-eyebrow');if(eyebrow)eyebrow.textContent='행정 업무 검토';status(d);
  }
  registerAction('cold-plan',()=>render(draft('cold')));
  registerAction('icing-plan',()=>render(draft('icing')));
  registerAction('flood-plan',()=>render(draft('flood')));
  registerAction('school-plan',()=>render(draft('school')));
  registerAction('admin-plan-load',async()=>{
    const d=draft(active),form=document.getElementById('admin-plan-form');if(d.busy||!form?.reportValidity())return;
    const values=Object.fromEntries(new FormData(form));if(values.scopeId!==d.scopeId){d.reviews={};d.opinion='';d.page=0;}d.scopeId=values.scopeId;d.settings={...d.settings,...values};d.busy=true;d.error='';
    form.querySelectorAll('input,select,button').forEach(x=>x.disabled=true);const sequence=++loadSequence;
    const load=async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('공개자료 미수신 ('+response.status+')');const bytes=await response.arrayBuffer(),body=JSON.parse(new TextDecoder().decode(bytes));if(body.type!=='FeatureCollection'||!Array.isArray(body.features))throw Error('공개자료 형식 오류');body.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');return body;};
    try{
      const c=WORKFLOWS[d.kind],[source,assets]=await Promise.all([load(c.source),c.asset?load(c.asset):null]);
      const fingerprint=source.sha256+':'+(assets?.sha256||'');
      if(d.fingerprint&&d.fingerprint!==fingerprint){d.reviews={};d.opinion='';api.toast('원자료가 바뀌어 이전 확인상태를 초기화했습니다.');}
      Object.assign(d,{source,assets,fingerprint,dirty:false});recompute(d);
      if(sequence===loadSequence&&active===d.kind&&api.state.view==='admin-plan'){api.chooseDong(d.scopeId);paintMap(d);}
    }catch(error){d.dirty=true;d.error=error.message+' 이전 결과로 보고서를 만들지 않습니다.';}
    finally{d.busy=false;if(sequence===loadSequence&&active===d.kind&&api.state.view==='admin-plan')render(d);}
  });
  host()?.addEventListener('input',event=>{
    if(!active)return;const d=draft(active),t=event.target;
    if(t.closest('#admin-plan-form')){d.dirty=true;status(d);}
    if(t.hasAttribute('data-ap-opinion')){d.opinion=t.value;save(d);}
    if(t.dataset.apId&&['note','department','due'].includes(t.dataset.apField)&&!d.dirty&&d.plan){
      const review=d.reviews[t.dataset.apId]={...d.reviews[t.dataset.apId],[t.dataset.apField]:t.value};
      if(t.dataset.apField==='note'&&!t.value.trim()&&review.status==='checked'){
        review.status='pending';const candidate=t.closest('.hp-candidate');
        candidate.querySelector('[data-ap-field="status"]').value='pending';
        recompute(d,true);
        const row=d.plan.rows.find(r=>r.id===t.dataset.apId);candidate.querySelector('summary small').textContent=PLAN_ACTIONS[row.action]+' · '+PLAN_REVIEW[row.status];
        const metric=host().querySelectorAll('.hp-metrics b')[1];if(metric)metric.textContent=d.plan.checked;
      }else recompute(d);
    }
  });
  host()?.addEventListener('change',event=>{
    if(!active)return;const d=draft(active),t=event.target,id=t.dataset.apId;if(!id||d.dirty||!d.plan||!['choice','status'].includes(t.dataset.apField))return;
    const scroll=host().scrollTop,openIds=[...host().querySelectorAll('.hp-candidate[open]')].map(el=>el.querySelector('[data-ap-id]').dataset.apId);
    if(t.dataset.apField==='status'&&t.value==='checked'&&!d.reviews[id]?.note?.trim()){t.value='pending';api.toast('현장 확인 내용을 먼저 기록하세요.');return;}
    d.reviews[id]={...d.reviews[id],[t.dataset.apField]:t.value};recompute(d,true);render(d);
    host().querySelectorAll('.hp-candidate').forEach(el=>{if(openIds.includes(el.querySelector('[data-ap-id]').dataset.apId))el.open=true;});host().scrollTop=scroll;
  });
  registerAction('admin-plan-page',button=>{const d=draft(active);d.page=Math.max(0,Math.min(Math.ceil(d.plan.rows.length/PAGE_SIZE)-1,d.page+Number(button.dataset.step)));render(d);});
  registerAction('admin-plan-locate',button=>{const d=draft(active),r=d.plan?.rows.find(r=>r.id===button.dataset.id),xy=button.dataset.target==='asset'?r?.nearest?.xy:r?.xy;if(!xy)return;if(!inside(xy,api.state.scope))api.chooseDong('all',false);api.send({type:'camera',pose:frameFor({type:'Point',coordinates:xy},'facility')});api.close();api.toast('대표위치로 이동했습니다. 같은 업무 버튼을 누르면 검토를 이어갑니다.');});
  const current=()=>{const d=draft(active);if(!d.plan||d.dirty||d.busy){api.toast('현재 조건으로 검토대상을 다시 불러오세요.');return null;}return d;};
  registerAction('admin-plan-download',()=>{const d=current();if(d)saveFile(`서구온_${d.plan.title}_${d.plan.scopeName}.html`,adminReportHtml(d.plan,d.opinion),'text/html;charset=utf-8');});
  registerAction('admin-plan-json',()=>{const d=current();if(d)saveFile(`서구온_${d.plan.title}_검토기록.json`,JSON.stringify({plan:d.plan,reviews:d.reviews,opinion:d.opinion},null,2),'application/json');});
  registerAction('admin-plan-report',()=>{const d=current();if(!d)return;api.show(d.plan.title+' 검토보고서',`<div class="heat-plan"><div class="hp-buttons"><button data-action="${d.kind}-plan">검토로 돌아가기</button><button data-action="admin-plan-print">인쇄 / PDF 저장</button><button data-action="admin-plan-download">HTML 저장</button></div><iframe class="hp-report" title="행정 업무 검토보고서 미리보기" sandbox srcdoc="${e(adminReportHtml(d.plan,d.opinion))}"></iframe></div>`,'admin-plan-report');});
  registerAction('admin-plan-print',()=>{const d=current();if(!d)return;const w=window.open('','_blank');if(!w){api.toast('HTML 저장 후 브라우저에서 인쇄하세요.');return;}w.opener=null;w.document.write(adminReportHtml(d.plan,d.opinion));w.document.close();w.focus();w.print();});
}
