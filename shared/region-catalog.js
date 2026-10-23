/** Publicly selectable, reviewed deployments. Requests never supply file paths. */
export const REGION_CATALOG = Object.freeze([
  Object.freeze({id:'seogu',name:'서구',fullName:'전남광주통합특별시 서구',label:'서구온',scope:'정류장 그늘막 배치 · 현장점검 · 사업 후보지 비교'}),
  Object.freeze({id:'suncheon',name:'순천',fullName:'전남광주통합특별시 순천시',label:'순천 적용해보기',scope:'횡단보도 그늘막 배치 · 학교 주변 · 사업 후보지 비교'}),
]);

export function registeredRegionId(value) {
  if (typeof value !== 'string' || !REGION_CATALOG.some(region=>region.id===value)) {
    const error=new Error('현재 선택할 수 있는 지역은 서구와 순천입니다.');
    error.code='REGION_NOT_REGISTERED';error.status=400;throw error;
  }
  return value;
}

export function regionLink(id, search='') {
  registeredRegionId(id);
  const params=new URLSearchParams();params.set('region',id);
  const map=new URLSearchParams(search).get('map');
  if (['boundary','libre'].includes(map)) params.set('map',map);
  return '/?'+params.toString();
}
