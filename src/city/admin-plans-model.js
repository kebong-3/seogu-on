import {inside,distance} from './geometry.js';
import {cleanPoints,numeric,escapeHtml as e} from './heat-plan-model.js';
export const ADMIN_PLAN_VERSION='admin-review-1';
export const WORKFLOWS={
  cold:{id:'cold',title:'한파 대응계획',icon:'home',intro:'정류장 주변 한파쉼터 연결과 대기환경 보완을 함께 검토합니다.',
    source:'/data/city/infra/bus.geojson',asset:'/data/city/official/cold-shelter.geojson',layers:['infra-bus','official-cold-shelter'],unit:'정류장 지점',
    checks:['쉼터 실제 개방시간과 대상 이용조건','대표위치부터 출입구까지 이동 동선·횡단 가능 여부','난방·수용능력과 운영부서 협의','방풍·온열 대기공간의 보도 폭·전기·화재 및 관리조건'],
    caveat:'직선거리 내 한파쉼터는 연결 검토 후보입니다. 이동 중 노출·실제 난방·개방 또는 설치 적합성을 확인한 결과가 아닙니다.'},
  icing:{id:'icing',title:'결빙 관리지점 점검',icon:'warning',intro:'공개된 관리구간 원문 단위로 시작·종료 지점을 묶어 현장 점검계획을 만듭니다.',
    source:'/data/city/local-icing.geojson',layers:['local-icing'],unit:'구간 원문 묶음',
    checks:['시작·종료 위치와 실제 관리구간 대조','노면·배수·음영 상태 현장 확인','제설함·장비·작업 동선과 관리기관 협의','점검일·조치 필요사항·후속 재확인 기록'],
    caveat:'상습결빙 관리자료이며 현재 결빙 관측·위험예측 또는 제설 완료현황이 아닙니다. 반복되는 관리번호만으로 서로 다른 원문 구간을 합치지 않습니다.'},
  flood:{id:'flood',title:'침수 이력 현장점검',icon:'water',intro:'과거 피해 기록을 동일 대표좌표별로 묶고 확인사항과 후속조치를 정리합니다.',
    source:'/data/city/local-flood-history.geojson',layers:['local-flood-history'],unit:'대표좌표 묶음',
    checks:['기록의 발생연도·주소·대표위치 대조','배수구·유입 경로·최근 보수 이력 확인','시설 관리부서와 정비·점검 협의','현장 확인 결과와 재점검 필요사항 기록'],
    caveat:'과거 피해 이력의 점검계획입니다. 현재 침수나 미래 위험을 예측하지 않습니다. 같은 좌표 묶음은 동일 건물·세대나 독립 피해 건수를 뜻하지 않습니다.'},
  school:{id:'school',title:'통학환경 현장점검',icon:'shield',intro:'어린이보호구역 대상시설의 공개 대표위치를 기준으로 합동 점검표를 준비합니다.',
    source:'/data/city/official/child-protection-zone.geojson',layers:['official-child-protection-zone'],unit:'대상시설 대표위치',
    checks:['실제 출입구·등하교 동선·횡단 위치 확인','보도·차도 분리와 보행 시야 점검','속도 표지·안전시설·공개 CCTV 정보의 현재 상태 대조','도로·교육·경찰 등 관계기관 후속 협의'],
    caveat:'대상시설의 대표위치 자료이며 보호구역 경계·안전한 통학경로·사고 위험도 판정이 아닙니다. CCTV 기재 여부를 실제 작동 상태로 해석하지 않습니다.'},
};
export const PLAN_ACTIONS={existing:'기존 쉼터 연결 검토',supplement:'대기환경 보완 검토',inspect:'현장 확인·기존 자산 정비',coordinate:'관계부서 추가조치 협의',exclude:'보류·제외'};
export const PLAN_REVIEW={pending:'확인 전',checked:'확인 기록 있음',followup:'후속조치 필요'};
export function reviewRows(kind,features) {
  const valid=cleanPoints(features),groups=new Map();
  for(const p of valid.points){
    const props=p.properties;
    const group=kind==='icing'?`section:${props.sectionSourceId || p.id}`:kind==='flood'?`coordinate:${p.xy.join(',')}`:p.id;
    if(!groups.has(group))groups.set(group,{id:group,name:p.name,xy:p.xy,records:[],years:[],features:[],address:props.address||''});
    const g=groups.get(group);g.records.push(p.id);g.features.push({type:'Feature',geometry:{type:'Point',coordinates:p.xy},properties:{...props,id:p.id}});
    if(props.eventYear&&!g.years.includes(String(props.eventYear)))g.years.push(String(props.eventYear));
    if(kind==='icing')g.name=`${props.dongName||'서구'} 관리구간 ${props.sectionSourceId||p.id} · 관리번호 ${props.sectionNo||'미제공'}`;
    if(kind==='flood')g.name=props.address||p.name;
  }
  return {rows:[...groups.values()],valid:valid.points.length,omitted:valid.omitted};
}
export function calculateAdminPlan({kind,source,assets,scope,scopeName,settings={},reviews={},generatedAt=new Date().toISOString()}) {
  const config=WORKFLOWS[kind];if(!config)throw Error('지원하지 않는 검토 업무입니다.');
  if(!Array.isArray(source?.features))throw Error('점검대상 자료 미수신: 계획을 생성하지 않았습니다.');
  if(kind==='cold'&&!Array.isArray(assets?.features))throw Error('한파쉼터 자료 미수신: 연결 후보를 생성하지 않았습니다.');
  const selected=source.features.filter(f=>f.geometry?.type==='Point'&&(!scope||inside(f.geometry.coordinates,scope)));
  const grouped=reviewRows(kind,selected),facilities=kind==='cold'?cleanPoints(assets.features).points:[];
  const radius=numeric(settings.radius??300,{min:10,max:2000});
  const maxNew=numeric(settings.maxNew??3,{min:0,max:100,integer:true});
  const rows=grouped.rows.map(r=>{
    let nearest=null;
    for(const f of facilities){const m=distance(r.xy,f.xy);if(!nearest||m<nearest.m)nearest={id:f.id,name:f.name,xy:f.xy,m,openingHours:f.properties.openingHours||null,capacity:f.properties.capacity??null};}
    const review=reviews[r.id]||{};
    const note=String(review.note||'').slice(0,600);
    const possible=!!nearest&&nearest.m<=radius;
    const allowed=kind==='cold'?['auto','existing','supplement','exclude']:['inspect','coordinate','exclude'];
    const choice=allowed.includes(review.choice)?review.choice:kind==='cold'?'auto':'inspect';
    const status=PLAN_REVIEW[review.status]?review.status:'pending';
    return {...r,nearest,possible,choice,note,status:status==='checked'&&!note.trim()?'pending':status,department:String(review.department||'').slice(0,80),due:/^\d{4}-\d{2}-\d{2}$/.test(review.due||'')?review.due:'',action:choice};
  });
  if(kind==='cold'){
    rows.sort((a,b)=>Number(b.choice==='supplement')-Number(a.choice==='supplement')||(b.nearest?.m??Infinity)-(a.nearest?.m??Infinity)||a.id.localeCompare(b.id));
    let assigned=0;
    for(const r of rows){
      if(r.choice==='exclude')r.action='exclude';
      else if((r.choice==='auto'||r.choice==='existing')&&r.possible)r.action='existing';
      else if(r.choice!=='existing'&&assigned<maxNew){r.action='supplement';assigned++;}
      else r.action='inspect';
    }
  } else rows.sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id));
  const existing=rows.filter(r=>r.action==='existing').length,additional=rows.filter(r=>['supplement','coordinate'].includes(r.action)).length;
  const checked=rows.filter(r=>r.status==='checked').length;
  const sources=[{...(source.metadata||{}),sha256:source.sha256||null},...(assets?[{...(assets.metadata||{}),sha256:assets.sha256||null}]:[])];
  return {version:ADMIN_PLAN_VERSION,kind,title:config.title,scopeName,generatedAt,settings:{radius,maxNew},rows,existing,additional,checked,
    sourceRecords:grouped.valid,omitted:grouped.omitted,facilities:new Set(rows.filter(r=>r.action==='existing').map(r=>r.nearest.id)).size,
    excluded:rows.filter(r=>r.action==='exclude').length,sources,checks:config.checks,caveat:config.caveat,unit:config.unit};
}
export function adminReportHtml(plan,opinion='') {
  const p=plan,c=WORKFLOWS[p.kind];
  const rows=p.rows.map(r=>`<tr><td>${e(r.name)}<br><small>${e(r.id)} · ${r.xy.map(x=>x.toFixed(6)).join(', ')}<br>원자료 ${r.records.length}건${r.years.length?' · 발생연도 '+e(r.years.sort().join(', ')):''}</small></td><td>${e(PLAN_ACTIONS[r.action])}<br>${r.nearest?`${e(r.nearest.name)} · 직선 ${Math.round(r.nearest.m)}m`:''}</td><td>${e(PLAN_REVIEW[r.status])}<br>${e(r.department||'담당부서 미기재')}<br>${e(r.due||'후속기한 미기재')}</td><td>${e(r.note||'확인 내용 미작성')}</td></tr>`).join('');
  const stamp=new Date(p.generatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
  const comparison=p.kind==='cold'?`<h2>기존 활용안과 보완안</h2><table><tr><th>항목</th><th>A 기존 쉼터 활용</th><th>B 기존 활용 + 대기환경 보완</th></tr><tr><th>기존 쉼터 연결 검토</th><td>${p.existing}지점 / ${p.facilities}개 쉼터</td><td>${p.existing}지점 / ${p.facilities}개 쉼터</td></tr><tr><th>대기환경 보완 검토</th><td>0지점</td><td>${p.additional}지점</td></tr><tr><th>비용</th><td>미산정 · 운영 협의·견적 필요</td><td>미산정 · 설치·운영·유지관리 견적 필요</td></tr></table><p>한파쉼터 검색은 서구 공개본 전체, 정류장은 선택 구역을 기준으로 합니다. 연결 검토거리 ${p.settings.radius}m / 보완 후보 상한 ${p.settings.maxNew}지점. 담당자가 명시한 보완 후보를 우선하고 나머지는 최근접 쉼터 거리가 긴 순서로 제안합니다. 위험도·효과·보호인원 순위가 아닙니다.</p>`:'';
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(p.title)} 검토보고서</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#173047;max-width:1000px;margin:36px auto;padding:0 20px}h1{font-size:26px}h2{font-size:20px;margin-top:28px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #b9cad8;padding:10px;text-align:left;vertical-align:top}th{background:#edf5fa}small{font-size:11px;overflow-wrap:anywhere}.note{padding:14px;background:#eef7fa;border-left:4px solid #087e8b}pre{white-space:pre-wrap;font:inherit}li{overflow-wrap:anywhere}@media print{body{margin:0;padding:0;max-width:none}tr{break-inside:avoid}thead{display:table-header-group}h2{break-after:avoid}@page{size:A4;margin:15mm}}</style><h1>${e(p.title)} 검토보고서</h1><p>서구:온 · ${e(p.scopeName)} · ${e(stamp)} (한국시간)</p><p class="note">담당자 검토용 초안 · ${e(p.caveat)}</p>
    <h2>검토 목적과 자료 범위</h2><p>${e(c.intro)} 원자료 ${p.sourceRecords}건을 ${p.rows.length}개 ${e(p.unit)}으로 검토합니다. 확인 기록 ${p.checked}, 보류·제외 ${p.excluded}, 추가조치·보완 검토 ${p.additional}입니다. 자료 내 미수록을 실제 시설 부재나 점검 불필요로 판단하지 않습니다.</p>${comparison}
    <h2>현장 확인항목</h2><ul>${p.checks.map(x=>`<li>${e(x)}</li>`).join('')}</ul><h2>검토의견</h2><pre>${e(opinion||'검토의견 미작성')}</pre><h2>대상별 검토와 후속조치</h2><table><thead><tr><th>대상 / 원자료</th><th>검토안</th><th>확인 상태 / 담당부서 / 기한</th><th>현장 내용·사유</th></tr></thead><tbody>${rows||'<tr><td colspan="4">선택 구역의 수록자료 없음. 실제 대상 부재를 뜻하지 않습니다.</td></tr>'}</tbody></table>
    <h2>출처·기준일·한계</h2><ul>${p.sources.map(s=>`<li>${e(s.sourceName||'공개자료')} · 기준 ${e(s.sourceDate||(s.sourceDateMin?`${s.sourceDateMin} ~ ${s.sourceDateMax}`:'미제공'))} · 수집 ${e(s.collectedAt||s.snapshotAt||'미제공')}<br>${/^https?:\/\//.test(s.sourceUrl||'')?`<a href="${e(s.sourceUrl)}">원자료</a> · `:''}SHA-256 ${e(s.sha256||'미기록')}</li>`).join('')}</ul><p>유효 원자료 ${p.sourceRecords}건, 중복 식별자·형식 제외 ${p.omitted}건. 원자료는 수정하지 않습니다. 확인 상태는 담당자의 입력 기록이며 시스템이 현장을 확인한 것이 아닙니다. ${e(p.caveat)} 보고서 수치는 재현 가능한 계산 결과를 사용하며 생성형 AI가 사실·효과를 만들지 않습니다.</p></html>`;
}
