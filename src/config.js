export const APP = Object.freeze({
  name: 'SEO:ON', koreanName: '서구온', version: '0.2.0',
  maker: 'FUNONWORK LAB', center: [126.859, 35.151],
  // 화면 조작용 범위이며 행정경계가 아닙니다.
  bounds: [[126.77, 35.07], [126.95, 35.23]],
  mapVersion: '5.6.1',
});
export const CATEGORIES = Object.freeze({
  park: { name: '공원·녹지', color: '#58d6b2', icon: 'tree', unit: '건' },
  recycle: { name: '자원순환', color: '#f6bb61', icon: 'recycle', unit: '건' },
  shelter: { name: '생활안전', color: '#76b9ff', icon: 'shield', unit: '건' },
  admin: { name: '행정·공공', color: '#7fcbd6', icon: 'layers', unit: '개' },
  parking: { name: '교통·주차', color: '#c4b06e', icon: 'pin', unit: '개' },
  health: { name: '보건·의료', color: '#f29baa', icon: 'heart', unit: '개' },
  culture: { name: '문화·도서관', color: '#83bdeb', icon: 'book', unit: '개' },
  toilet: { name: '생활편의', color: '#9fc9b4', icon: 'pin', unit: '개' },
  care: { name: '돌봄·생활', color: '#b29afa', icon: 'heart', unit: '건' },
});
export const WORKSPACES = Object.freeze({
  overview: { name: '도시 한눈에', icon: 'layers', eyebrow: 'CITY OVERVIEW', title: '서구를 한눈에,\n판단은 근거 있게.', description: '공간·시간·시설을 하나의 화면에서 연결합니다.' },
  access: { name: '생활권 살피기', icon: 'target', eyebrow: 'SPATIAL ACCESS', title: '우리 주변에는\n무엇이 있을까요?', description: '지점을 고르고 직선거리 안의 시설을 확인하세요.' },
  trend: { name: '운영 추이', icon: 'chart', eyebrow: 'TIME & CHANGE', title: '숫자의 변화,\n지도에서 읽다.', description: '같은 대상을 같은 기간으로 비교합니다.' },
  projects: { name: '사업 함께보기', icon: 'route', eyebrow: 'PROJECT CONTEXT', title: '같은 공간,\n겹치는 일정.', description: '근접 사업의 일정 겹침을 검토합니다. 우선순위 판단은 하지 않습니다.' },
});
export const CAMERAS = Object.freeze([
  { id: 'sangmu', name: '상무권역', center: [126.850, 35.151], zoom: 15.0, pitch: 58, bearing: -25 },
  { id: 'nongseong', name: '농성권역', center: [126.886, 35.153], zoom: 15.1, pitch: 56, bearing: -38 },
  { id: 'pungam', name: '풍암권역', center: [126.878, 35.126], zoom: 15.0, pitch: 58, bearing: 18 },
]);
export const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
export const DATA_KINDS = { 'official-snapshot':'공식 공개본·위치 미검수', demo: '합성 시연', provided: '사용자 자료·미검수', external: 'API 수집·미검수' };
