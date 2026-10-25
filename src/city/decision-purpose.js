/** Explain the administrative use of a spatial result without turning proximity into demand or safety. */
const list = value => Array.isArray(value) ? value : [];
const number = value => Number.isFinite(value) ? value.toLocaleString('ko-KR') : null;
const text = value => typeof value === 'string' ? value.trim() : '';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function purposeKind(preset) {
  const terms = [preset.id, preset.target, preset.service, preset.title, preset.purpose, ...list(preset.keywords)].filter(value => typeof value === 'string').join(' ');
  if (/safety|safe|women|cctv|emergency|security-light|police|안심|여성안전|비상벨|방범|보안등/i.test(terms)) return 'safety';
  if (/childcare|child-care|daycare|nursery|kindergarten|care|돌봄|육아|어린이집|유치원/i.test(terms)) return 'care';
  if (/shade|shelter|그늘막|쉼터|폭염|한파/i.test(terms)) return 'climate';
  return 'general';
}

const PURPOSES = Object.freeze({
  care: {
    title:'돌봄·육아시설을 검토할 때',
    useWhen:'시설 현황을 찾거나 돌봄거점 후보를 비교하고, 주변 교통·안전 여건을 확인할 부서협의 자료가 필요할 때 사용합니다.',
    nextActions:[
      '수록시설과 주변자료를 지도에서 함께 보고, 검토할 위치를 정합니다.',
      '실제 출입구·운영시간·이용대상·정원과 현재 운영 여부를 해당 시설에 확인합니다.',
      '후보별 차이와 추가로 확인할 내용을 검토서로 내려받아 돌봄·교통·시설 담당자와 협의합니다.',
    ],
    missingData:['연령별 아동인구·신청/대기 인원과 기존 돌봄 정원·실제 이용량', '시설별 운영시간·이용자격·요금·현재 운영 여부', '실제 출입구와 보행 동선·도로 횡단 여건'],
  },
  safety: {
    title:'여성안심·생활안전시설을 검토할 때',
    useWhen:'공개 안전시설을 한 지도에서 확인하고, 시설 보완 후보와 합동 현장점검 대상을 준비할 때 사용합니다.',
    nextActions:[
      '검토 위치 주변의 수록 안전시설과 자료 기준일을 확인합니다.',
      '후보지의 실제 조도·시야 가림·통행 동선과 비상벨·CCTV 등의 설치·작동 여부를 현장에서 확인합니다.',
      '시설 관리 담당자에게 누락·고장·이전 여부를 확인하고, 검토서의 위치와 근거로 보완안을 협의합니다.',
    ],
    missingData:['야간 현장 조도·시야 가림·실제 통행 동선과 주민 의견', '안전시설의 최신 설치·작동·관제 연결 상태', '자료에 없는 시설과 현장 변경사항'],
  },
  climate: {
    title:'폭염·한파 대응시설을 검토할 때',
    useWhen:'정류장·학교 등 공개 위치와 기존 대응시설을 함께 살펴, 보완 후보를 좁히고 현장점검 자료를 만들 때 사용합니다.',
    nextActions:[
      '현재와 변경안 지도를 번갈아 보고, 추가 후보의 위치를 옮기거나 제외해 차이를 확인합니다.',
      '실제 대기·보행 위치와 시설 개방·그늘·난방 상태를 현장에서 확인합니다.',
      '보도 폭·토지 사용·유지관리와 설치비를 담당자에게 확인한 뒤 검토서를 협의자료로 사용합니다.',
    ],
    missingData:['시간대별 실제 이용량·취약계층 수요', '현장 그늘·열환경 또는 난방·개방 상태', '보도 폭·토지 사용 가능 여부·설치비와 유지관리비'],
  },
  general: {
    title:'시설 배치·사업 후보를 검토할 때',
    useWhen:'여러 자료에서 위치와 출처를 모으는 일을 줄이고, 같은 조건으로 후보를 비교해 부서협의 자료를 만들 때 사용합니다.',
    nextActions:[
      '검토 구역과 거리 조건을 정하고, 지도에서 실제 검토 후보를 선택합니다.',
      '후보별 주변시설과 자료 기준일을 비교하고 현장 확인이 필요한 위치를 추립니다.',
      '이용수요·토지 사용·설치비와 운영 주체를 확인한 뒤 검토서를 협의자료로 사용합니다.',
    ],
    missingData:['실제 이용수요·시설 용량과 운영 상태', '토지 소유·설치 가능 여부·보행 동선', '설치비·운영비와 유지관리 주체'],
  },
});

function administrativePurpose(kind, preset) {
  const base = PURPOSES[kind];
  if (preset.id === 'childcare' && preset.service === 'public-spaces') return {...base,
    title:'어린이집 프로그램과 공공공간을 연계할 때',
    useWhen:'어린이집 주변의 개방 공공공간을 찾아 프로그램 장소와 이동 여건을 사전 검토하고, 시설 간 협의자료를 만들 때 사용합니다.',
    nextActions:[
      '어린이집 주변에 수록된 개방 공간을 지도에서 보고, 연계할 활동 장소 후보를 정합니다.',
      '어린이집과 공간 관리자에게 활동 적합성·개방시간·대관조건과 실제 이동 동선을 확인합니다.',
      '후보별 차이와 확인사항을 검토서로 내려받아 프로그램·공간 담당자와 협의합니다.',
    ],
    missingData:['프로그램별 참여 수요·연령과 활동에 필요한 공간 조건', '공간별 현재 개방시간·예약·대관조건과 수용 가능 규모', '어린이집 출입구에서 공간까지의 실제 이동 동선·횡단 여건'],
  };
  if (kind === 'safety' && /emergency-bell/.test(preset.service || '')) return {...base,
    title:'돌봄시설 주변 비상벨을 점검할 때',
    useWhen:'돌봄시설 주변의 공개 비상벨 위치를 대조해 현장 확인 대상을 추리고, 관리 담당자에게 최신 상태를 확인할 때 사용합니다.',
    nextActions:[
      '돌봄시설과 수록 비상벨의 위치·기준일을 보고, 실제 출입구 주변에서 확인할 대상을 정합니다.',
      '현장에서 비상벨 위치·접근성·안내표지와 작동·관제 연결 상태를 관리 담당자와 확인합니다.',
      '누락·고장·이전 여부와 보완 위치를 검토서로 정리해 시설 관리 담당자와 협의합니다.',
    ],
    missingData:['공개 기준일 이후 비상벨 신설·이전·철거 내역', '현장 작동·관제 연결 상태와 접근성·안내표지', '실제 출입구·야간 통행 동선과 주민 의견'],
  };
  if (kind === 'safety' && preset.target === 'bus' && /security-light/.test(preset.service || '')) return {...base,
    title:'야간 정류장 주변 보안등을 점검할 때',
    useWhen:'정류장과 보안등의 공개 위치를 대조해 야간 현장점검 대상을 추리고, 보완 후보의 거리 조건을 비교할 때 사용합니다.',
    nextActions:[
      '정류장 대기 위치와 수록 보안등을 지도에서 보고, 거리 조건 밖 대상을 먼저 확인합니다.',
      '야간 현장에서 실제 조도·빛 방향·가림과 보안등 고장 여부를 확인합니다.',
      '현장 결과와 후보별 차이를 검토서로 정리하고 도로·조명 관리 담당자와 보완안을 협의합니다.',
    ],
    missingData:['야간 실제 조도·빛 방향·가림과 보안등 작동 상태', '정류장의 실제 대기·승하차 위치와 이용시간대', '도로조명 등 다른 광원·설치 가능 위치·공사비'],
  };
  return base;
}

/** All numerical statements below come from the displayed result, never an estimated policy effect. */
export function buildDecisionPurpose(result = {}, preset = result?.preset || {}) {
  result = result && typeof result === 'object' ? result : {};
  preset = preset && typeof preset === 'object' ? preset : {};
  const kind = purposeKind(preset), purpose = administrativePurpose(kind, preset), confirmed = [];
  const radius = number(result.parameters?.radiusM), workflow = result.workflow;
  if (workflow === 'site') {
    confirmed.push(radius ? `정한 후보지의 직선 반경 ${radius}m 안에서 수록자료를 같은 기준으로 비교합니다.` : '정한 후보지 주변의 수록자료와 출처를 같은 기준으로 비교합니다.');
  } else if (result.status === 'unavailable' || !Number.isFinite(result.baseline?.total)) {
    confirmed.push('비교에 필요한 자료가 연결되지 않아 거리 조건 밖 위치와 변경량을 산정하지 않았습니다. 미연결은 시설이 없다는 뜻이 아닙니다.');
  } else {
    const total = number(result.baseline.totalLocations ?? result.baseline.total);
    confirmed.push(`수록된 ${total}개 ${Number.isFinite(result.baseline.totalLocations) ? '고유 좌표' : '대상'}${radius ? `를 직선거리 ${radius}m 조건으로` : '를 같은 위치 기준으로'} 비교했습니다.`);
    if (workflow === 'coverage') confirmed.push('시설 추가·이전·중단 가정에 따라 거리 조건에 포함되는 위치가 어떻게 달라지는지 확인합니다.');
    if (workflow === 'inspection') confirmed.push('대상별 위치·최근접 수록시설·원문 근거를 모아 현장점검 목록을 준비합니다.');
  }
  if (kind === 'safety') confirmed.push('안전시설과의 거리를 비교한 결과입니다. 범죄위험, 안전한 귀갓길 또는 시설의 현재 작동 상태를 판정하지 않습니다.');
  if (kind === 'care') confirmed.push('공개 시설 분포를 비교한 결과입니다. 가까운 시설 수만으로 돌봄 수요·공급 부족이나 입소 가능 여부를 판단하지 않습니다.');
  const unavailable = list(result.sourceStatus).filter(source => ['unavailable','not-connected','error'].includes(source.state));
  const missingData = [...purpose.missingData];
  if (unavailable.length) missingData.unshift(`이번 비교에서 미연결인 자료: ${unavailable.map(source => text(source.title) || text(source.id) || text(source.datasetId) || '이름 미제공').join(' · ')}. 해당 자료는 0개로 해석하지 않습니다.`);
  const nextActions = [...purpose.nextActions];
  if (workflow === 'inspection') nextActions[0] = '대상별 위치와 선정 근거를 확인하고 좌표 목록 CSV를 내려받아 현장점검 대상을 정합니다.';
  if (workflow === 'site') nextActions[0] = '실제 사업 후보 A·B의 위치를 지도에서 정하고, 같은 반경의 주변자료를 비교합니다.';
  if (result.status === 'unavailable') nextActions[0] = '자료 출처와 연결 상태를 확인하고, 비교에 필요한 시설자료를 연결한 뒤 다시 계산합니다.';
  return {kind, title:purpose.title, useWhen:purpose.useWhen, confirmed, nextActions, missingData};
}

export function decisionPurposeHtml(result, preset, {expanded = false} = {}) {
  const purpose = buildDecisionPurpose(result, preset);
  const items = values => values.map(value => `<li>${escape(value)}</li>`).join('');
  return `<section class="dt-purpose-guide"><h3>${escape(purpose.title)}</h3><p>${escape(purpose.useWhen)}</p><div class="dt-purpose-next"><h4>지금 할 다음 행동</h4><p>${escape(purpose.nextActions[0])}</p></div><details${expanded ? ' open' : ''}><summary>확인한 내용과 후속 협의 펼치기</summary><div class="dt-purpose-confirmed"><h4>현재 자료로 확인한 것</h4><ul>${items(purpose.confirmed)}</ul></div><h4>이어서 할 일</h4><ol>${items(purpose.nextActions.slice(1))}</ol><h4>판단을 위해 더 필요한 자료</h4><ul>${items(purpose.missingData)}</ul></details></section>`;
}
