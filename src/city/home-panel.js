/**
 * 홈(왼쪽) 패널: 주요 카드 3개 + "더 보기" 접이식 묶음, 그리고 좁은 화면에서의 서랍 동작.
 * 기능 자체는 각 모듈이 갖고 있고, 여기서는 배치와 접힘 상태만 다룬다.
 */
import {icon} from './catalog.js';

/** 이 폭 이하에서는 왼쪽 패널이 지도를 덮는 서랍이 된다. layout.css의 @media (max-width: 820px)와 같은 값. */
export const COMPACT_WIDTH = 820;
export const isCompact = () => innerWidth <= COMPACT_WIDTH;

const MORE_KEY = 'seoon:home-more:v1';

export function installHomePanel() {
  // 카드 아이콘 채우기
  for (const node of document.querySelectorAll('.home-card-icon[data-icon]')) node.innerHTML = icon(node.dataset.icon);

  // "더 보기" 접기/펼치기. 펼침 상태는 이 브라우저에 기억한다(저장이 막혀 있어도 동작은 같다).
  const more = document.getElementById('home-more'), moreToggle = document.getElementById('home-more-toggle');
  function setMore(open, save = true) {
    if (!more || !moreToggle) return;
    more.classList.toggle('open', open);
    moreToggle.setAttribute('aria-expanded', String(open));
    if (save) try { localStorage.setItem(MORE_KEY, open ? 'open' : 'closed'); } catch { /* 저장 불가 브라우저 */ }
  }
  let remembered = false;
  try { remembered = localStorage.getItem(MORE_KEY) === 'open'; } catch { /* 저장 불가 브라우저 */ }
  setMore(remembered, false);
  moreToggle?.addEventListener('click', () => setMore(!more.classList.contains('open')));

  const panel = document.getElementById('district-panel'), opener = document.getElementById('show-panels');

  /** 화면 폭이 바뀌면 서랍/고정 패널 상태를 맞춘다. */
  function sync() {
    if (!panel || !opener) return;
    if (isCompact()) {
      document.body.classList.remove('map-focus');
      opener.hidden = panel.classList.contains('mobile-open');
    } else {
      panel.classList.remove('mobile-open');
      opener.hidden = !document.body.classList.contains('map-focus');
    }
    document.body.classList.toggle('drawer-open', panel.classList.contains('mobile-open'));
  }

  /** '지도 집중' / '☰ 지역·정보 열기' 버튼 */
  function toggle() {
    if (isCompact()) panel.classList.toggle('mobile-open');
    else document.body.classList.toggle('map-focus');
    sync();
  }

  function closeDrawer() {
    panel?.classList.remove('mobile-open');
    sync();
  }

  function open(){if(isCompact())panel?.classList.add('mobile-open');else document.body.classList.remove('map-focus');sync();}
  window.addEventListener('resize', sync);
  sync();
  return {sync, toggle, open, closeDrawer};
}
