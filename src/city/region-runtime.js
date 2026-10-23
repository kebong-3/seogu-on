import {esc} from './catalog.js';
import {REGION_CATALOG,regionLink} from '../../shared/region-catalog.js';

export const legacyEnabled = profile => !profile || profile.capabilities.legacySeoguServices;
const PORTABLE_ACTIONS = new Set(['overview','dong','dong-frame','dong-tour','close-detail','panels','fullscreen','sidebar-tab','appearance','engine','list','feature','feature-frame','isolate','clear-layers','zoom-in','zoom-out','rotate','orbit','top','oblique','refresh-enabled','export-csv','settings','credits','live-detail','live-refresh','region-info','region-chooser','pilot-measure','ui-theme','ui-finish','ui-reset']);
export function supportsAction(profile, action, dataset = {}) {
  if (legacyEnabled(profile)) return true;
  if (action === 'engine') return ['boundary','libre'].includes(dataset.engine);
  return PORTABLE_ACTIONS.has(action) || /^(space-|appearance-|pilot-|ask-)/.test(action);
}
export function regionLayers(profile, layers) {
  if (legacyEnabled(profile)) return layers;
  return [{id:profile.facilityLayerId,title:'개방 공공공간',group:'지역 공개자료',url:profile.facilitiesUrl,color:'#167e6a',note:'연결한 지역 공간자료 · 현장 운영 여부는 별도 확인'}];
}
export function applyRegionChrome(profile) {
  const q = selector => document.querySelector(selector), text = (selector,value) => {const node=q(selector);if(node)node.textContent=value;};
  const districtLabel=legacyEnabled(profile)?'행정동':'읍·면·동';
  text('.sidebar-heading h1',`${profile.name} · 공간행정`);
  text('.overview-card strong',`${profile.name} 전체`);
  text('.overview-card small',`${profile.districtCount}개 ${districtLabel} 한눈에`);
  text('.breadcrumbs [data-action="overview"]',`${profile.name} 전체`);
  text('#dong-tour',`${profile.districtCount}개 ${districtLabel} 자동 둘러보기`);
  text('#region-menu-current',profile.name);
  text('#ask-quick-hint',`${profile.name} 전체의 수록 자료를 기준으로 답합니다. 질문에 ${districtLabel} 이름을 쓰면 해당 구역을 조회합니다.`);
  text('#tab-regions','업무·지역');
  document.body.dataset.region=profile.id;
  if (legacyEnabled(profile)) return;
  document.title=`${profile.name}:온 · 공공공간 행정 디지털트윈`;
  text('.brand-name',`${profile.name}:온`);
  text('.brand-tagline','공간자료 · 현장 확인 · 대안 비교');
  q('.brand')?.setAttribute('aria-label',`${profile.name} 전체로 이동`);
  for (const node of document.querySelectorAll('.brand-emblem,.local-brand-strip,#selected-bi,.dong-context [data-action="bi-gallery"],.home-workflows,.sidebar-tools')) node.hidden=true;
  for (const node of document.querySelectorAll('[data-action]')) if (!supportsAction(profile,node.dataset.action,node.dataset)) node.hidden=true;
  const quick=q('#ask-quick-question');if(quick){quick.disabled=false;quick.placeholder=`${profile.name}에서 토요일에 주민모임을 할 공간을 찾아줘`;}
  const submit=q('#ask-quick-submit');if(submit)submit.disabled=false;
  const safety=q('.live-safety');if(safety){safety.hidden=false;safety.dataset.action='region-info';safety.title='현재 지역 자료와 기준일 확인';const label=safety.querySelector('span');if(label)label.textContent='공간 자료';}
  text('.dong-context','선택한 읍·면·동의 경계와 수록 공간을 지도에서 확인합니다.');
  text('#live-safety','지역 공간자료');
}

export function regionChooserHtml(profile,report,search='') {
  return `<div class="region-intro"><span class="badge">실제 두 지역 적용</span><p>지역을 선택하면 해당 지역의 경계·공공공간으로 바뀝니다. 질문, 현장 확인, 운영 대안 비교와 보고서를 같은 방식으로 사용할 수 있습니다.</p></div><div class="region-choices">${REGION_CATALOG.map(region=>`<article class="region-choice ${region.id===profile.id?'is-current':''}"><span class="region-choice-state">${region.id===profile.id?'현재 지역':region.id==='seogu'?'기본 지역':'두 번째 지역 적용'}</span><h3>${esc(region.fullName)}</h3><p>${esc(region.scope)}</p>${region.id===profile.id?`<p class="region-counts">${report?.counts?.districts ?? profile.districtCount}개 ${profile.id==='seogu'?'행정동':'읍·면·동'} · 수록 공공공간 ${report?.counts?.facilities ?? '확인 중'}개</p>${report?.coverage?`<p class="region-coverage">${esc(report.coverage)}</p>`:''}<button class="primary" data-action="space-twin">현재 지역에서 검토 시작</button>`:`<a class="primary region-open" href="${esc(regionLink(region.id,search))}">${esc(region.name)} 적용해보기 <span aria-hidden="true">↗</span></a>`}</article>`).join('')}</div><section class="region-method"><h3>같은 업무 흐름으로 사용하세요</h3><ol><li>읍·면·동을 고르거나 상단 질문창에 목적·요일·시간을 입력합니다.</li><li>공개 원자료와 현장 확인값을 구분하고 운영 대안을 비교합니다.</li><li>AI 검토와 확인할 사항을 읽은 뒤 비교 시점의 보고서를 저장합니다.</li></ol><p class="note">기록과 작성 중인 비교 조건은 지역별로 나뉩니다. 저장·백업은 이 브라우저 기준입니다. 순천은 공공공간 업무부터 적용했으며, 각 지역에 추가 연결한 자료 범위는 서로 다릅니다.</p></section><details class="region-method"><summary>우리 지자체에도 적용하려면</summary><p>행정경계, 공공공간 자료, 지역 코드·범위·출처 설정을 준비하고 데이터팩 검증을 실행합니다. 전국 공통 API라도 제공 범위와 좌표·지역 코드를 확인한 뒤 해당 기능을 켭니다.</p><button class="secondary" data-action="region-info">현재 지역 자료 확인</button></details>`;
}

export function regionInfoHtml(profile,report={}) {
  return `<p>${esc(profile.fullName)}에 연결한 지역 구성입니다. 같은 계산 기능이 현재 지역의 경계와 공간자료를 사용합니다.</p><dl class="info-grid"><dt>${profile.id==='seogu'?'행정동':'읍·면·동'}</dt><dd>${profile.districtCount}개</dd><dt>지역 코드</dt><dd>${esc(profile.codeSystem)} · ${esc(profile.jurisdictionCode)}</dd><dt>경계 자료</dt><dd>${esc(profile.boundaryUrl)}</dd><dt>공간 자료</dt><dd>${esc(profile.facilitiesUrl)}</dd><dt>경계 기준일</dt><dd>${esc(profile.source.asOf || '미제공')}</dd><dt>공간 자료 기준일</dt><dd>${esc(report.facilitySourceDate||'미제공')}</dd></dl>${report.coverage?`<p class="region-coverage">${esc(report.coverage)}</p>`:''}<p class="note">타 지자체는 경계·공간자료와 지역 설정을 구성한 뒤 검증하여 배포합니다. API별 지역 코드·좌표·출처·제공범위를 함께 확인해야 합니다.</p><div class="detail-actions"><button class="primary" data-action="space-twin">공공공간 활용</button><button class="secondary" data-action="region-chooser">다른 지역도 적용해보기</button><button class="secondary" data-action="pilot-measure">업무효과 측정</button></div>`;
}
