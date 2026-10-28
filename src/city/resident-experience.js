import {registerAction} from './actions.js';

const KEY='seoon:experience:v1';
export function normalizeExperience(value){return {usage:value?.usage==='work'?'work':'resident',largeText:value?.largeText===true,reducedMotion:value?.reducedMotion===true};}
export function experienceService(action){
 if(action==='resident-home')return 'home';
 if(action==='decision-living-map'||action==='decision-living-review')return 'care';
 if(action==='walk-routes'||action==='walk-mode')return 'walk';
 if(action==='resilience'||action==='resilience-preset')return 'disaster';
 if(['field-operations','decision-twin','decision-site-review','space-twin','pilot-measure'].includes(action))return 'work';
 return null;
}
export function sidebarTabTarget(current,key){
 if(!['tab-regions','tab-layers'].includes(current))return null;
 if(key==='Home')return 'regions';if(key==='End')return 'layers';
 return ['ArrowLeft','ArrowRight'].includes(key)?(current==='tab-regions'?'layers':'regions'):null;
}
export function panelEvidenceLabel(service,kind){
 if(kind==='field-operations'||kind==='pilot-measure')return '개인 기록 · 기관 접수·공유와 구분';
 if(kind==='resident-help'||kind==='resident-twin')return '서구온 이용 안내';
 return {care:'공개자료 · 현재 운영은 별도 확인',walk:'도보경로 · 계절 결과는 계산 추정',disaster:'관측·과거자료를 구분해 확인',work:'검토용 계산 · 사용자 가정 포함'}[service]||'선택한 정보';
}
export function createResidentPanelFocus({active,title,inPanel,fallback,visible=()=>true}){
 let opener=null,opened=false;
 return {open(reset){if(!reset)return;const element=active();if(element?.isConnected&&!inPanel(element)&&element.matches?.('button,a,input,summary'))opener=element;opened=true;title()?.focus?.({preventScroll:true});},close(){if(!opened)return;opened=false;(opener?.isConnected&&visible(opener)?opener:fallback())?.focus?.({preventScroll:true});}};
}
export function captureControlFocus(root,element){
 if(!element||!root?.contains(element))return null;
 const snapshot={id:element.id||null,tag:element.tagName,dataset:{...element.dataset}};
 if(!snapshot.id&&(snapshot.tag!=='BUTTON'||!Object.keys(snapshot.dataset).length))return null;
 try{if(typeof element.selectionStart==='number'){snapshot.start=element.selectionStart;snapshot.end=element.selectionEnd;}}catch{}
 return snapshot;
}
export function restoreControlFocus(root,snapshot){
 if(!snapshot)return false;
 const candidates=[...root.querySelectorAll(snapshot.id?'[id]':'button[data-action]')].filter(node=>node.tagName===snapshot.tag&&(snapshot.id?node.id===snapshot.id:Object.entries(snapshot.dataset).every(([key,value])=>node.dataset[key]===value)));
 const node=candidates.length===1?candidates[0]:null;
 if(!node||node.disabled||!node.getClientRects().length)return false;
 node.focus({preventScroll:true});if(typeof snapshot.start==='number')try{node.setSelectionRange(Math.min(snapshot.start,node.value.length),Math.min(snapshot.end,node.value.length));}catch{}
 return true;
}

/** Only display preferences are persisted; no questions, routes or location history. */
export function installResidentExperience(api){
 const q=id=>document.getElementById(id);
 let prefs=normalizeExperience(),current='home';
 try{prefs=normalizeExperience(JSON.parse(localStorage.getItem(KEY)||'null'));}catch{}
 const disposers=[];
 const visible=element=>!!element?.getClientRects?.().length&&getComputedStyle(element).visibility!=='hidden';
 const focus=createResidentPanelFocus({active:()=>document.activeElement,title:()=>q('detail-title'),inPanel:element=>q('detail-panel')?.contains(element),visible,fallback:()=>[...document.querySelectorAll(`[data-resident-service="${current}"]`)].find(visible)||q('resident-home-heading')});
 function announce(text){const node=q('experience-announcement');if(node&&node.textContent!==text)node.textContent=text;}
 function apply(save=false){
  document.body.dataset.usage=prefs.usage;document.body.dataset.largeText=String(prefs.largeText);document.body.dataset.reduceMotion=String(prefs.reducedMotion);
  for(const button of document.querySelectorAll('[data-action="resident-usage"]'))button.setAttribute('aria-pressed',String(button.dataset.usage===prefs.usage));
  for(const button of document.querySelectorAll('[data-action="resident-large-text"]')){button.setAttribute('aria-pressed',String(prefs.largeText));button.textContent=prefs.largeText?'기본 글씨':'큰 글씨';}
  q('administrative-tools')?.classList.toggle('is-selected',prefs.usage==='work');
  if(save)try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch{}
 }
 function updateScope(){
  const label=api.label?.()||'서구 전체',profile=api.state.regionProfile;
  if(q('district-choice-label'))q('district-choice-label').textContent=api.state.dong==='all'?`동 선택 · ${profile?.districtCount||18}개`:`${label} · 동 변경`;
  if(q('resident-scope'))q('resident-scope').textContent=label;
  if(q('resident-current-service'))q('resident-current-service').textContent=({home:'생활지도',care:'돌봄·생활안전',walk:'도보 길찾기',disaster:'재난안전지도',work:'행정 검토'})[current];
 }
 function navigated(action){
  const next=experienceService(action);if(!next)return;
  const changed=next!==current;current=next;document.body.dataset.service=next;
  for(const button of document.querySelectorAll('[data-resident-service]')){if(button.dataset.residentService===next)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  updateScope();if(changed)announce(`${api.label?.()||'선택 지역'} · ${q('resident-current-service')?.textContent||'생활지도'} 화면을 열었어요.`);
 }
 function home(){api.close();api.openHome?.();api.run('sidebar-tab',{id:'regions'});navigated('resident-home');q('sidebar-scroll')?.scrollTo?.({top:0,behavior:'instant'});q('resident-home-heading')?.focus?.({preventScroll:true});}
 function help(){api.show('서구온, 이렇게 이용하세요',`<div class="resident-guide"><p class="resident-lead">우리 동네를 고르고, 필요한 일 하나부터 시작하세요.</p><ol class="resident-steps"><li><b>01</b><div><strong>어디를 볼까요?</strong><p>서구 전체 또는 동을 선택해요. 동을 바꾸면 자료의 조회 범위도 바뀌어요.</p></div></li><li><b>02</b><div><strong>필요한 서비스를 골라요</strong><p>돌봄시설 찾기, 도보 길찾기, 재난 자료 중 하나를 열어요.</p></div></li><li><b>03</b><div><strong>확인하고 움직여요</strong><p>시설의 운영정보와 출입구를 확인하고 길안내를 시작해요.</p></div></li></ol><div class="resident-guide-actions"><button class="primary" data-action="decision-living-map" data-topic="care">아이와 갈 곳 찾기</button><button class="secondary" data-action="walk-routes">도보 길찾기 시작</button></div><details><summary>지도 조작이 어려우신가요?</summary><p>시설 검색과 목록만으로도 시설을 고를 수 있어요. 길찾기는 장소 검색·수록시설 선택·지도 선택을 지원해요. 위치 사용은 직접 요청할 때만 시작해요.</p><button class="secondary" data-action="resident-large-text">${prefs.largeText?'기본 글씨':'큰 글씨'}</button></details><details><summary>AI에게 무엇을 물어볼까요?</summary><ul><li>선택한 동에 수록된 공원을 알려줘.</li><li>그늘막을 추가할 후보를 비교해줘.</li><li>운영조건을 확인할 때 무엇을 봐야 해?</li></ul><p>시설 방문계획은 길찾기의 ‘말로 방문계획 만들기’에서 시작하세요. AI 제안을 확인하고 적용한 뒤 실제 경로를 조회해요.</p><button class="secondary" data-action="ask-ai">지도에게 묻기</button></details><details open><summary>보기 편하게 조정하기</summary><div class="detail-actions"><button class="secondary" data-action="resident-large-text" aria-pressed="${prefs.largeText}">${prefs.largeText?'기본 글씨':'큰 글씨'}</button><button class="secondary" data-action="resident-motion" aria-pressed="${prefs.reducedMotion}">${prefs.reducedMotion?'자동회전 허용':'자동회전 줄이기'}</button><button class="secondary" data-action="appearance">화면 테마</button></div></details><p class="resident-note">위치·길찾기 기록은 저장하지 않아요. 현장조치·검토노트는 이 브라우저의 개인 기록이며 공식 접수·기관 공유와는 달라요.</p></div>`,'resident-help');}
 function twin(){api.show('자료와 가정을 구분해 보세요',`<div class="resident-guide"><p class="resident-lead">디지털트윈은 현재 자료를 살펴보고, 조건을 바꾼 결과를 비교하는 데 도움을 줘요.</p><div class="twin-state-grid"><article><span class="twin-state source">공개자료</span><h3>언제의 자료인가요?</h3><p>시설 위치와 과거 이력은 원문 기준일을 확인해요. 수집일은 현재 운영 확인일이 아니에요.</p></article><article><span class="twin-state observation">관측값</span><h3>어디서, 언제 관측했나요?</h3><p>기온·강수는 관측 위치와 시각을 확인해요. 동 전체나 모든 도로의 상태를 측정한 값은 아니에요.</p></article><article><span class="twin-state estimate">계산·추정</span><h3>어떤 조건으로 계산했나요?</h3><p>그늘과 시설 반경은 자료·시각·모형의 결과예요. 실제 그늘·통행 가능·안전 보장은 현장 확인이 필요해요.</p></article><article><span class="twin-state assumption">사용자 가정</span><h3>바꾸면 무엇이 달라질까요?</h3><p>시설을 추가하거나 개방 조건을 바꾸어 같은 조건의 전후 차이를 봐요. 가정을 공식 상태로 저장하지 않아요.</p></article></div><h3>행정 검토는 네 단계로</h3><ol class="resident-twin-flow"><li>원자료·기준일 확인</li><li>추가·개방 조건 설정</li><li>같은 조건에서 전후 비교</li><li>현장 확인과 조치 근거 기록</li></ol><div class="resident-guide-actions"><button class="primary" data-action="decision-site-review">시설 배치 전후 비교</button><button class="secondary" data-action="field-operations">현장조치·가정 비교</button><button class="secondary" data-action="service-readiness">자료 기준일 확인</button></div><p class="resident-note">현재는 공개자료와 일부 외부 관측을 연결한 의사결정 지원 시제품이에요. 모든 시설의 실시간 상태·현재 노면·기관 공동 승인과 자동 현장 반영은 연결되어 있지 않아요.</p></div>`,'resident-twin');}
 disposers.push(registerAction('resident-home',home),registerAction('resident-help',help),registerAction('resident-twin',twin),registerAction('resident-large-text',()=>{prefs.largeText=!prefs.largeText;apply(true);announce(prefs.largeText?'큰 글씨로 바꿨어요.':'기본 글씨로 바꿨어요.');if(api.state.view==='resident-help'){help();q('detail-body')?.querySelector('.resident-guide details[open] [data-action=resident-large-text]')?.focus?.({preventScroll:true});}}),registerAction('resident-motion',()=>{prefs.reducedMotion=!prefs.reducedMotion;apply(true);if(prefs.reducedMotion)api.pauseMotion?.();announce(prefs.reducedMotion?'동 선택 후 자동회전을 줄여요.':'동 선택 후 자동회전을 허용해요.');help();q('detail-body')?.querySelector('[data-action=resident-motion]')?.focus?.({preventScroll:true});}),registerAction('resident-stop-motion',()=>{api.pauseMotion?.();announce('지도의 자동 움직임을 멈췄어요.');}),registerAction('resident-usage',button=>{prefs.usage=button.dataset.usage==='work'?'work':'resident';apply(true);for(const selector of ['.decision-start-more','.advanced-services']){const node=document.querySelector(selector);if(node)node.open=prefs.usage==='work';}if(prefs.usage==='work')q('administrative-tools')?.scrollIntoView?.({block:'start',behavior:'instant'});announce(prefs.usage==='work'?'행정 검토 도구를 펼쳤어요.':'주민 생활서비스를 보여드려요.');}),registerAction('resident-layers',()=>{api.openHome?.();return api.run('sidebar-tab',{id:'layers'});}),registerAction('resident-reload',()=>location.reload()));
 apply();navigated('resident-home');
 return {navigated,scopeChanged:updateScope,get reducedMotion(){return prefs.reducedMotion;},
  ready(error=false){const loading=q('resident-loading');if(loading){loading.hidden=!error;loading.textContent=error?'지역 자료를 불러오지 못했어요. 이용안내 또는 다시 연결을 선택해 주세요.':'';}document.getElementById('app')?.setAttribute('aria-busy','false');for(const b of document.querySelectorAll('.service-menu button'))b.disabled=error;updateScope();},
  opened(kind,reset){q('detail-title')?.setAttribute('tabindex','-1');if(q('detail-eyebrow'))q('detail-eyebrow').textContent=panelEvidenceLabel(current,kind);focus.open(reset);q('detail-panel')?.setAttribute('data-service',current);},
  closed(){focus.close();},
  destroy(){for(const off of disposers)off?.();}
 };
}
