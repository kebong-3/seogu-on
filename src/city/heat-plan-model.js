/** 재현 가능한 폭염 검토 계산. LLM은 거리·건수·금액을 계산하지 않는다. */
import {inside, distance} from './geometry.js';
export const PLAN_VERSION = 'heat-review-1';
export const LIMITATIONS = [
  '버스정류장은 OSM 부분 자료입니다. 누락은 시설 부재가 아니며 같은 이름의 반대편 정류장은 별도 지점입니다.',
  '직선거리 조건은 검토를 위한 사용자 설정입니다. 법정 기준·보행거리·실제 그림자·폭염 위험도를 뜻하지 않습니다.',
  '기존 시설 활용은 개방시간, 이동 동선, 횡단보도, 수용능력, 현장 운영 확인이 필요한 연결 후보입니다.',
  '추가 설치 위치는 정류장 대표좌표를 이용한 가상 후보입니다. 보도 폭·점용·지장물·설치 가능성 및 실제 그늘은 현장 확인이 필요합니다.',
  '안별 연결 지점 수는 대응방안을 지정한 검토지점 수이며 보호 인원·온도 저감·사업 효과가 아닙니다. 시설 간 연계의 효과가 동등하다고 가정하지 않습니다.',
  '비용은 입력한 가정만 계산합니다. 미입력은 0원이 아니며 견적·실측·예산 확정을 대신하지 않습니다.',
];
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = value => value === null ? '미산정' : `${value.toLocaleString('ko-KR')}만원`;
export function numeric(value, {min=0, max=100000000, integer=false, optional=false}={}) {
  if (value === '' || value === null || value === undefined) {
    if (optional) return null;
    throw new Error('필수 검토조건을 입력하세요.');
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error('검토조건의 숫자 범위를 확인하세요.');
  return n;
}
export function cleanPoints(features) {
  const seen = new Set(); let omitted=0;
  const points = [];
  for (const f of features) {
    const xy=f.geometry?.coordinates, id=String(f.properties?.id ?? f.id ?? '');
    if (!id || f.geometry?.type !== 'Point' || !Array.isArray(xy) || !xy.slice(0,2).every(Number.isFinite) || Math.abs(xy[0])>180 || Math.abs(xy[1])>90 || seen.has(id)) {omitted++;continue;}
    seen.add(id); points.push({id, name:String(f.properties?.name || id), xy:xy.slice(0,2), properties:f.properties || {}});
  }
  return {points, omitted};
}
function nearest(point, others) {
  let result=null;
  for (const f of others) {const m=distance(point.xy, f.xy); if (!result || m<result.m || (m===result.m && f.id<result.id)) result={id:f.id,name:f.name,m,xy:f.xy,sourceDate:f.properties.sourceDate || null};}
  return result;
}
function costInput(value) {
  const n=numeric(value,{optional:true});
  if(n!==null && Math.abs(n*100-Math.round(n*100))>0.00001)throw new Error('비용은 만원 단위 소수 둘째 자리까지 입력하세요.');
  return n;
}
export function calculatePlan({datasets, scope, scopeName, settings, reviews={}, generatedAt=new Date().toISOString()}) {
  for (const key of ['bus','shade','shelter']) if (!Array.isArray(datasets[key]?.features)) throw new Error(`${key} 자료 미수신: 비교 결과를 만들 수 없습니다.`);
  const s={
    shadeRadius:numeric(settings.shadeRadius,{min:10,max:1000}), shelterRadius:numeric(settings.shelterRadius,{min:10,max:2000}),
    maxNew:numeric(settings.maxNew,{max:100,integer:true}), years:numeric(settings.years,{min:1,max:10,integer:true}),
    operating:costInput(settings.operating), unit:costInput(settings.unit), maintenance:costInput(settings.maintenance), budget:costInput(settings.budget),
  };
  const clean=Object.fromEntries(Object.entries(datasets).map(([k,v])=>[k,cleanPoints(v.features)]));
  // 대상 정류장만 행정동으로 제한. 동 경계 건너 가까운 시설은 검색에서 제외하지 않는다.
  const stops=clean.bus.points.filter(p=>!scope || inside(p.xy,scope));
  const rows=stops.map(p=>({...p,shade:nearest(p,clean.shade.points),shelter:nearest(p,clean.shelter.points)}));
  const baseline=rows.filter(r=>r.shade && r.shade.m<=s.shadeRadius);
  const candidates=rows.filter(r=>!r.shade || r.shade.m>s.shadeRadius)
    .sort((a,b)=>Number(reviews[b.id]?.choice==='install')-Number(reviews[a.id]?.choice==='install') || (b.shade?.m ?? Infinity)-(a.shade?.m ?? Infinity) || a.id.localeCompare(b.id));
  let newCount=0;
  const cents=value=>Math.round(value*100);
  const firstUnit=s.unit!==null&&s.maintenance!==null?cents(s.unit)+cents(s.maintenance):null;
  for (const r of candidates) {
    const review=reviews[r.id] || {};
    r.existingAvailable=!!r.shelter && r.shelter.m<=s.shelterRadius;
    r.choice=['auto','existing','install','exclude'].includes(review.choice)?review.choice:'auto';
    r.note=String(review.note || '').slice(0,500);
    r.review=['unreviewed','checked','hold'].includes(review.review)?review.review:'unreviewed';
    if(r.review==='checked'&&!r.note.trim())r.review='unreviewed';
    r.action='pending';
    if (r.choice==='exclude' || r.review==='hold') r.action='exclude';
    else if (r.choice==='existing' || (r.choice==='auto' && r.existingAvailable)) r.action=r.existingAvailable?'existing':'pending';
    else if (newCount<s.maxNew) {
      // 운영비·단가가 모두 입력된 경우에만 첫해 예산으로 후보 수를 제한한다.
      const fits=s.budget===null || firstUnit===null || s.operating===null || cents(s.operating)+(newCount+1)*firstUnit<=cents(s.budget);
      if(fits){r.action='install';newCount++;}
    }
  }
  const existing=candidates.filter(r=>r.action==='existing').length;
  const annualA=s.operating, annualB=annualA!==null && (newCount===0 || firstUnit!==null)?(cents(annualA)+newCount*(firstUnit || 0))/100:null;
  const totalA=annualA===null?null:cents(annualA)*s.years/100;
  const totalB=totalA!==null&&(newCount===0 || s.unit!==null&&s.maintenance!==null)?(cents(totalA)+newCount*(cents(s.unit || 0)+cents(s.maintenance || 0)*s.years))/100:null;
  const distinctFacilities=new Set(candidates.filter(r=>r.action==='existing').map(r=>r.shelter.id)).size;
  return {version:PLAN_VERSION,generatedAt,scopeName,settings:s,total:stops.length,baseline:baseline.length,candidates,
    existing,newCount,distinctFacilities,unassigned:candidates.length-existing-newCount,
    checked:candidates.filter(r=>r.review==='checked').length,
    costs:{annualA,annualB,totalA,totalB,budgetStatus:s.budget===null?'unset-budget':annualB===null?'incomplete':annualB>s.budget?'over':'within'},
    quality:Object.fromEntries(Object.entries(clean).map(([k,v])=>[k,{valid:v.points.length,omitted:v.omitted}])),
    sources:Object.entries(datasets).map(([key,d])=>({key,...d.metadata,sha256:d.sha256 || null})), limitations:LIMITATIONS};
}
export const ACTION_NAMES={existing:'기존 쉼터 연계 검토',install:'추가 설치 검토',exclude:'보류·제외',pending:'추가 검토'};
export const REVIEW_NAMES={unreviewed:'미검토',checked:'현장 확인 기록',hold:'보류'};
export function comparisonHtml(p) {
  const e=escapeHtml;
  return `<table><caption>동일 대상에 대한 두 가지 검토안</caption><thead><tr><th>비교 항목</th><th>A · 기존 시설 활용</th><th>B · 기존 활용 + 추가 설치</th></tr></thead><tbody>
    <tr><th>기존 쉼터 연결 후보</th><td>${p.existing}지점 / ${p.distinctFacilities}개 쉼터</td><td>${p.existing}지점 / ${p.distinctFacilities}개 쉼터</td></tr>
    <tr><th>추가 설치 후보</th><td>0지점</td><td>${p.newCount}지점</td></tr>
    <tr><th>대응방안 지정 지점</th><td>${p.existing} / ${p.candidates.length}</td><td>${p.existing+p.newCount} / ${p.candidates.length}</td></tr>
    <tr><th>첫해 비용</th><td>${e(money(p.costs.annualA))}</td><td>${e(money(p.costs.annualB))}</td></tr>
    <tr><th>${p.settings.years}년 비용</th><td>${e(money(p.costs.totalA))}</td><td>${e(money(p.costs.totalB))}</td></tr>
    <tr><th>담당자 확인</th><td>개방 협의·이동 경로·수용능력</td><td>기존 활용 확인 + 설치 위치·보도 폭·지장물</td></tr>
    </tbody></table>`;
}
export function reportHtml(p, decision={}) {
  const e=escapeHtml;
  const safeUrl=value=>/^https?:\/\//i.test(String(value))?String(value):'';
  const sourceRows=p.sources.map(s=>`<li>${e(s.sourceName || s.key)} · 기준일 ${e(s.sourceDate || (s.sourceDateMin?`${s.sourceDateMin} ~ ${s.sourceDateMax}`:'미제공'))} · 수집 ${e(s.collectedAt || s.snapshotAt || '미제공')}<br>${safeUrl(s.sourceUrl)?`<a href="${e(s.sourceUrl)}" rel="noreferrer">원자료</a> · `:''}SHA-256 ${e(s.sha256 || '미기록')}</li>`).join('');
  const rows=p.candidates.map(r=>`<tr><td>${e(r.name)}<br><small>${e(r.id)}<br>${r.xy.map(x=>x.toFixed(6)).join(', ')}</small></td><td>${r.shade?Math.round(r.shade.m)+'m':'수록 없음'}</td><td>${e(r.shelter?.name || '수록 없음')}<br>${r.shelter?Math.round(r.shelter.m)+'m':''}</td><td>${e(ACTION_NAMES[r.action])}<br>${e(REVIEW_NAMES[r.review])}</td><td>${e(r.note || '확인 기록 없음')}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>서구온 폭염 대응 검토보고서</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#172b42;max-width:1000px;margin:40px auto;padding:0 24px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c5d2df;padding:10px;text-align:left;vertical-align:top}th{background:#eef4f9}caption{text-align:left;font-weight:bold;margin:12px 0}small{font-size:11px;overflow-wrap:anywhere}li{overflow-wrap:anywhere}.note{background:#eef6fa;padding:16px;border-left:4px solid #007c88}pre{white-space:pre-wrap;font:inherit}@media print{body{margin:0;max-width:none;padding:0}tr{break-inside:avoid}thead{display:table-header-group}h2{break-after:avoid}a{color:inherit}@page{size:A4;margin:16mm}}</style>
  <h1>폭염 대응 대안 검토보고서</h1><p>서구:온 · ${e(p.scopeName)} · ${e(p.generatedAt)} · ${e(p.version)}</p><p class="note"><b>담당자 검토용 초안</b> — 수록자료에 기반한 후보 비교이며 사업 확정·안전 판정이 아닙니다. 거리·금액·본문은 동일한 계산 결과에서 생성했습니다. 생성형 AI가 수치를 만들지 않았습니다.</p>
  <h2>1. 검토 목적과 현재 자산</h2><p>기존 폭염 대응자산의 활용 가능성을 먼저 확인하고, 추가 설치가 필요한지 현장 검토할 대안을 비교합니다. 수록 정류장 ${p.total}지점 중 ${p.baseline}지점은 그늘막 대표위치가 ${p.settings.shadeRadius}m 안에 있습니다. 나머지 ${p.candidates.length}지점이 이번 검토 대상입니다. 실제 그늘 유무를 판정한 결과는 아닙니다.</p>
  <h2>2. 검토조건 및 비용 가정</h2><p>그늘막 근접조건 ${p.settings.shadeRadius}m / 기존 쉼터 연결조건 ${p.settings.shelterRadius}m / 추가 설치 최대 ${p.settings.maxNew}지점 / 기간 ${p.settings.years}년. 정류장은 선택 구역 내부, 연결시설은 구역 경계를 넘어 서구 공개본 전체에서 검색합니다. 담당자가 지정한 설치 후보를 우선 반영하고, 자동 후보는 가까운 그늘막까지의 거리가 긴 순서이며 위험도 순위가 아닙니다.</p><p>기존 시설 연계 연간 추가 운영비(안 전체): ${e(money(p.settings.operating))}; 신규 1지점 설치비: ${e(money(p.settings.unit))}; 신규 1지점 연간 유지비: ${e(money(p.settings.maintenance))}; 첫해 한도: ${e(money(p.settings.budget))}. B 첫해 = A 연간 운영비 + 신규 수 × (설치비 + 연간 유지비). B 기간비용 = A 연간 운영비 × 기간 + 신규 수 × (설치비 + 유지비 × 기간). 동일 가격 가정이며 물가·할인율은 적용하지 않습니다. 기타 비용은 입력 단가에 포함해야 합니다.</p>
  <h2>3. 대안 비교</h2>${comparisonHtml(p)}<p>두 안의 지점 수는 행정적 검토 연결 수이며 효과 비교 지표가 아닙니다. B안에서도 ${p.unassigned}지점은 보류·제외 또는 추가 검토 상태입니다. ${p.costs.budgetStatus==='over'?'입력한 첫해 한도를 초과합니다.':p.costs.budgetStatus==='within'?'입력한 비용 가정 안에서 첫해 한도 이내입니다.':'비용 또는 예산 미입력으로 예산 적합성을 판정하지 않았습니다.'}</p>
  <h2>4. 담당자 검토의견</h2><p>선호안: ${e(({pending:'검토 중',A:'A · 기존 시설 활용',B:'B · 기존 활용 + 추가 설치'})[decision.preferred] || '검토 중')}</p><pre>${e(decision.rationale || '검토의견 미작성')}</pre><p>현장 확인 기록: ${p.checked}/${p.candidates.length}지점. 이 기록은 사용자가 입력한 상태이며 시스템이 현장을 검증한 것이 아닙니다. 운영 협의 → 현장 조사 → 견적 확인 → 사업 결정 순으로 후속 검토합니다.</p>
  <h2>5. 후보별 확인 기록</h2><table><thead><tr><th>검토지점 / 식별자 / 좌표</th><th>최근접 그늘막</th><th>최근접 쉼터</th><th>검토안 / 확인상태</th><th>근거·보류 사유</th></tr></thead><tbody>${rows || '<tr><td colspan="5">해당 조건에서 검토 후보 없음</td></tr>'}</tbody></table>
  <h2>6. 자료와 한계</h2><ul>${sourceRows}</ul><p>수신 자료별 유효/제외 건수: ${Object.entries(p.quality).map(([k,v])=>`${({bus:'정류장',shade:'그늘막',shelter:'쉼터'})[k]} ${v.valid}/${v.omitted}`).join(', ')}. 쉼터는 공식 공개본 한 종류만 사용하며 보조 API 자료를 중복 합산하지 않았습니다. 원자료는 수정하지 않습니다.</p><ul>${p.limitations.map(x=>`<li>${e(x)}</li>`).join('')}</ul></html>`;
}
