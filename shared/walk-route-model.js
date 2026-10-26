/** Public-facility preselection only. Actual walking routes are calculated by the route provider. */
const CATEGORIES = ['shade','shelter','police','bell','childcare','public'];
export const WALK_MODE_CATEGORIES = Object.freeze({
  shade: Object.freeze(['shade','shelter']),
  safety: Object.freeze(['police']),
  care: Object.freeze(['childcare','public']),
  inspection: Object.freeze([...CATEGORIES]),
});
const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const invalid = message => Object.assign(new Error(message), {code:'INVALID_WALK_SELECTION',status:400});
const samePoint = (a,b) => a[0] === b[0] && a[1] === b[1];
const compareText = (a,b) => a < b ? -1 : a > b ? 1 : 0;

export function walkStraightDistance(a,b) {
  if (!validPoint(a) || !validPoint(b)) throw invalid('보행 검토 위치는 유효한 경도·위도 한 쌍이어야 합니다.');
  const rad=Math.PI/180,dLat=(b[1]-a[1])*rad,dLon=(b[0]-a[0])*rad;
  const value=Math.sin(dLat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLon/2)**2;
  return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(value)));
}
export const walkDistance = walkStraightDistance;

export function walkCandidateSupportsMode(candidate,mode) {
  return candidate?.routeEligible === true && Object.hasOwn(WALK_MODE_CATEGORIES,mode) && WALK_MODE_CATEGORIES[mode].includes(candidate?.category);
}

/** Returns at most `limit` distinct waypoint coordinates, ordered by straight-line detour. */
export function rankWalkCandidates(candidates,{start,end,mode,limit=2}={}) {
  if (!Array.isArray(candidates)) throw invalid('공개시설 후보 목록을 확인하세요.');
  if (!validPoint(start) || !validPoint(end)) throw invalid('출발지와 도착지의 경도·위도를 확인하세요.');
  if (!Object.hasOwn(WALK_MODE_CATEGORIES,mode)) throw invalid('그늘시설·안심시설·돌봄방문·현장점검 중 검토 목적을 선택하세요.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw invalid('사전 검토 후보 수는 1~10개여야 합니다.');
  const direct=walkStraightDistance(start,end),ids=new Set(),ranked=[];
  for (const candidate of candidates) {
    if (!walkCandidateSupportsMode(candidate,mode) || !validPoint(candidate.coordinate) || typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) continue;
    if (samePoint(candidate.coordinate,start) || samePoint(candidate.coordinate,end)) continue;
    ids.add(candidate.id);
    const fromStart=walkStraightDistance(start,candidate.coordinate),toEnd=walkStraightDistance(candidate.coordinate,end),via=fromStart+toEnd;
    ranked.push({candidate,fromStart,toEnd,via,detour:Math.max(0,via-direct)});
  }
  ranked.sort((a,b)=>a.detour-b.detour || a.fromStart-b.fromStart || compareText(a.candidate.id,b.candidate.id));
  const coordinates=new Set(),result=[];
  for (const item of ranked) {
    const key=item.candidate.coordinate.join(',');
    if (coordinates.has(key)) continue;
    coordinates.add(key);
    result.push({...item.candidate,coordinate:[...item.candidate.coordinate],straightFromStartM:Math.round(item.fromStart),straightToEndM:Math.round(item.toEnd),straightViaDistanceM:Math.round(item.via),straightDetourM:Math.round(item.detour),selectionBasis:'straight-line-prefilter'});
    if (result.length === limit) break;
  }
  return result;
}
