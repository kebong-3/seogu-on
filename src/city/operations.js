import {validGeometry,filterFeatures} from './geometry.js';

export const OP_LAYERS = ['infra-snow-routes','infra-snow-priority','infra-grit','infra-cold','infra-shade-structures'];
export const OP_STATES={planned:{label:'계획',color:'#b6b8e7'},working:{label:'작업 중 (등록)',color:'#e7b36d'},completed:{label:'완료 (등록)',color:'#74cba5'},unknown:{label:'상태 미확인',color:'#9faeb8'},stale:{label:'갱신 확인 필요',color:'#b4ac9f'}};
const reported = new Set(['planned','working','completed','unknown']);
const text = (v,n) => typeof v==='string'||typeof v==='number' ? String(v).trim().slice(0,n) : '';

/** Only timestamped records can describe an operational status. Browser timezone is never inferred. */
export function timestamp(value) {
  if (typeof value!=='string') return null;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!m) return null;
  const [y,mo,d,h,mi,se]=m.slice(1,7).map(x=>Number(x||0));
  const calendar=new Date(Date.UTC(y,mo-1,d));
  if(y<1900||y>2100||calendar.getUTCFullYear()!==y||calendar.getUTCMonth()!==mo-1||calendar.getUTCDate()!==d||h>23||mi>59||se>59) return null;
  const tz=m[7];if(tz!=='Z'&&(Number(tz.slice(1,3))>14||Number(tz.slice(4))>59||(Number(tz.slice(1,3))===14&&Number(tz.slice(4))!==0))) return null;
  const t=Date.parse(value);return Number.isFinite(t)?t:null;
}
export function reportedState(p) {
  // A previous computed state must not destroy the user's original report.
  if(reported.has(p?.reportedStatus)) return p.reportedStatus;
  return reported.has(p?.status)?p.status:'unknown';
}
export function operationalState(p,now=new Date()) {
  const status=reportedState(p);if(status==='unknown')return 'unknown';
  const t=timestamp(p.observedAt),expires=timestamp(p.expiresAt);
  if(t===null||!Number.isFinite(+now)||t>+now+5*60000)return 'unknown';
  if(expires===null||expires<=t||expires<=+now||+now-t>24*3600000)return 'stale';
  return status;
}
export function importOperational(body,layer,scope,now=new Date()) {
  if(!OP_LAYERS.includes(layer))throw Error('지원하지 않는 관리자료 종류');
  if(body?.type!=='FeatureCollection'||!Array.isArray(body.features)||!body.features.length||body.features.length>3000)throw Error('1~3,000개 GeoJSON 관리자료가 필요합니다. 빈 자료로 기존 자료를 지우지 않습니다.');
  const features=[],rejected=[],ids=new Set();
  for(const [i,f]of body.features.entries()) {
    const p=f?.properties||{},id=text(p.id,120),name=text(p.name,160),sourceName=text(p.sourceName,250);
    if(!validGeometry(f?.geometry)||!id||!name||!sourceName){rejected.push({row:i+1,reason:'좌표·id·name·sourceName 필수'});continue;}
    if(ids.has(id)){rejected.push({row:i+1,reason:'중복 id: '+id});continue;}
    if(['infra-snow-routes','infra-snow-priority'].includes(layer)&&!['LineString','MultiLineString'].includes(f.geometry.type)){rejected.push({row:i+1,reason:'제설 구간은 선 도형 필요'});continue;}
    const status=operationalState(p,now),date=text(p.sourceDate,10);
    const safe={id,name,sourceName,sourceDate:timestamp(date+'T00:00:00Z')!==null?date:null,reportedStatus:reportedState(p),status,statusLabel:OP_STATES[status].label,
      observedAt:timestamp(p.observedAt)!==null?p.observedAt:null,expiresAt:timestamp(p.expiresAt)!==null?p.expiresAt:null,
      displayColor:OP_STATES[status].color,phone:null,
      note:'사용자가 등록한 공개 관리자료입니다. 현장 실시간 확인·기관 공인 현황이 아니며 통행 안전·노면 결빙 판정에 사용하지 않습니다.'};
    const clipped=filterFeatures([{type:'Feature',geometry:f.geometry,properties:safe}],scope);
    if(!clipped.length){rejected.push({row:i+1,reason:'서구 경계 밖'});continue;}
    ids.add(id);features.push(...clipped);
  }
  if(!features.length)throw Error('선택 서구 범위의 유효한 관리자료가 없습니다. 기존 자료를 유지합니다.');
  return {features,rejected,state:'loaded',metadata:{userRegistered:true,coverage:'사용자 등록자료 · 전수 아님',reviewedAt:now.toISOString()},title:'등록 관리자료'};
}
export function refreshOperational(features,now=new Date()) {
  let changed=false;
  const result=features.map(f=>{const p=f.properties||{},status=operationalState(p,now),raw=reportedState(p);
    if(p.status===status&&p.reportedStatus===raw&&p.statusLabel===OP_STATES[status].label)return f;
    changed=true;return {...f,properties:{...p,reportedStatus:raw,status,statusLabel:OP_STATES[status].label,displayColor:OP_STATES[status].color}};});
  return changed?result:features;
}
