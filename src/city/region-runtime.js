import {esc} from './catalog.js';

export const legacyEnabled = profile => !profile || profile.capabilities.legacySeoguServices;
const PORTABLE_ACTIONS = new Set(['overview','dong','dong-frame','dong-tour','close-detail','panels','fullscreen','sidebar-tab','appearance','engine','list','feature','feature-frame','isolate','clear-layers','zoom-in','zoom-out','rotate','orbit','top','oblique','refresh-enabled','export-csv','settings','credits','live-detail','live-refresh','region-info','pilot-measure','ui-theme','ui-finish','ui-reset']);
export function supportsAction(profile, action, dataset = {}) {
  if (legacyEnabled(profile)) return true;
  if (action === 'engine') return ['boundary','libre'].includes(dataset.engine);
  return PORTABLE_ACTIONS.has(action) || /^(space-|appearance-|pilot-)/.test(action);
}
export function regionLayers(profile, layers) {
  if (legacyEnabled(profile)) return layers;
  return [{id:profile.facilityLayerId,title:'개방 공공공간',group:'지역 공개자료',url:profile.facilitiesUrl,color:'#167e6a',note:'연결한 지역 공간자료 · 현장 운영 여부는 별도 확인'}];
}
export function applyRegionChrome(profile) {
  const q = selector => document.querySelector(selector), text = (selector,value) => {const node=q(selector);if(node)node.textContent=value;};
  text('.sidebar-heading h1',`${profile.name} · 동 선택`);
  text('.overview-card strong',`${profile.name} 전체`);
  text('.overview-card small',`${profile.districtCount}개 행정동 한눈에`);
  text('.breadcrumbs [data-action="overview"]',`${profile.name} 전체`);
  text('#dong-tour',`${profile.districtCount}개 동 자동 둘러보기`);
  if (legacyEnabled(profile)) return;
  document.body.dataset.region=profile.id;
  document.title=`${profile.name}:온 · 공공공간 행정 디지털트윈`;
  text('.brand-name',`${profile.name}:온`);
  text('.brand-tagline','공간자료 · 현장 확인 · 대안 비교');
  q('.brand')?.setAttribute('aria-label',`${profile.name} 전체로 이동`);
  for (const node of document.querySelectorAll('.brand-emblem,.local-brand-strip,#selected-bi,.dong-context [data-action="bi-gallery"],.home-workflows,.sidebar-tools')) node.hidden=true;
  for (const node of document.querySelectorAll('[data-action]')) if (!supportsAction(profile,node.dataset.action,node.dataset)) node.hidden=true;
  const quick=q('#ask-quick-question');if(quick){quick.disabled=true;quick.placeholder='공공공간 활용에서 조건을 선택하고 AI로 검토하세요';}
  const submit=q('#ask-quick-submit');if(submit)submit.disabled=true;
  text('#live-safety','지역 공간자료');
}

export function regionInfoHtml(profile) {
  return `<p>${esc(profile.fullName)}에 연결한 지역 구성입니다. 같은 계산 기능이 현재 지역의 경계와 공간자료를 사용합니다.</p><dl class="info-grid"><dt>행정동</dt><dd>${profile.districtCount}개</dd><dt>지역 코드</dt><dd>${esc(profile.codeSystem)} · ${esc(profile.jurisdictionCode)}</dd><dt>경계 자료</dt><dd>${esc(profile.boundaryUrl)}</dd><dt>공간 자료</dt><dd>${esc(profile.facilitiesUrl)}</dd><dt>경계 기준일</dt><dd>${esc(profile.source.asOf || '미제공')}</dd></dl><p class="note">타 지자체는 경계·공간자료와 지역 설정을 구성한 뒤 검증하여 배포합니다. API별 지역 코드·좌표·출처·제공범위를 함께 확인해야 합니다. 서구 전용 기존 서비스는 별도로 검증되기 전까지 다른 지역에서 실행되지 않습니다.</p><div class="detail-actions"><button class="primary" data-action="space-twin">공공공간 활용</button><button class="secondary" data-action="pilot-measure">업무효과 측정</button></div>`;
}
