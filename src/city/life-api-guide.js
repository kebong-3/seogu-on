import {registerAction} from './actions.js';
import {esc} from './catalog.js';

const sources=[
  {name:'TMAP 생활도보길',url:'https://tmap-skopenapi.readme.io/reference/보행자-경로안내',state:'서버 연동 · 실제 수신은 조회 결과에서 확인',use:'그늘·쉼터 경유, 경찰시설 경유, 돌봄 방문, 최대 3곳 현장점검의 도보거리·시간을 비교합니다.',setup:'Vercel 서버 환경변수 TMAP_API_KEY에 앱 키를 등록하고 재배포합니다. 경로 응답은 최대 30분 표시하며 장기 저장하지 않습니다.'},
  {name:'어린이집 기본정보',url:'https://www.data.go.kr/data/15101189/openapi.do',state:'어린이집정보공개포털 별도 신청',use:'운영 여부·시설 유형·정원 등 기본정보를 받아 돌봄시설 현황을 갱신합니다.',setup:'공공데이터포털의 LINK 서비스입니다. 어린이집정보공개포털에서 별도 API 이용 신청·승인 후 해당 응답 규격으로 연결합니다. 공통 서비스키만 넣으면 연결되는 서비스로 표시하지 않습니다.'},
  {name:'전국안심지킴이집',url:'https://www.data.go.kr/data/15034535/standard.do',state:'표준데이터 활용신청',use:'공개 지정된 안심지킴이집의 위치·운영 여부를 확인합니다.',setup:'해당 서비스 활용신청 승인 후 Vercel 서버 환경변수 DATA_GO_KR_SERVICE_KEY에 일반 인증키를 설정합니다. 같은 키라도 서비스별 승인이 필요합니다.'},
  {name:'안전비상벨 공개 수록정보',url:'https://file.localdata.go.kr/file/emergency_call_box_info/info',state:'공식 공개파일 62개 수록 · 2023-06-21 기준',use:'돌봄시설·정류장 주변의 수록 비상벨을 찾아 실제 작동·경찰 연계·접근 상태 점검을 준비합니다.',setup:'현재 공식 제공방식은 지역별 CSV 다운로드입니다. 추가 API 키 없이 공개파일을 수집했습니다. 2026년 시스템 갱신시점을 자료 기준일로 사용하지 않습니다. 최신 설치·철거·작동 현황은 담당부서 확인이 필요합니다.'},
  {name:'CCTV 공개 설치정보',url:'https://file.localdata.go.kr/file/cctv_info/info',state:'공식 공개파일 51개 수록 · 2023-06-21 기준',use:'공개 설치 위치와 원문 설치목적을 확인합니다. 이번 서구 수록본은 모두 교통단속용이며 여성 방범CCTV 목록이 아닙니다.',setup:'현재 공식 제공방식은 지역별 CSV 다운로드이며 추가 API 키가 필요하지 않습니다. 영상 스트리밍·촬영 범위·관제 상태는 제공하지 않습니다. 방범용 CCTV를 추가하려면 해당 목적이 확인된 최신 공개 설치자료가 필요합니다.'},
  {name:'생활안전지도',url:'https://www.safemap.go.kr/',state:'여성안전 주제도 추가 연동 필요',use:'여성밤길 관련 주제도를 확장할 때 검토할 공식 원천입니다. 현재 여성안전 주제도 수신·표시는 완료하지 않았습니다.',setup:'기존 SAFEMAP_SERVICE_KEY와 별도로 해당 서비스 승인·이용조건·좌표계를 확인한 뒤 지도 연동이 필요합니다. WMS 지도 그림만 제공되는 항목은 개별 시설 개수 계산에 사용하지 않습니다.'}
];

export function lifeApiGuideHtml(){
  return `<section class="life-api-guide"><h3>생활정보를 업무에 연결하려면</h3><p>현재 지도에 수록된 자료는 시설별 출처·기준일에서 확인할 수 있습니다. 아래 목록은 추가 갱신·확장을 위한 신청 안내입니다. 활용신청이나 키 설정만으로 자료 수신이 완료되지는 않습니다.</p><div class="detail-actions"><button class="primary" data-action="decision-living-map" data-topic="care">돌봄·육아시설 보기</button><button class="secondary" data-action="decision-living-map" data-topic="safety">안심시설 보기</button></div>${sources.map(s=>`<article><span class="life-api-state">${esc(s.state)}</span><h3>${esc(s.name)}</h3><p>${esc(s.use)}</p><p>${esc(s.setup)}</p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">공식 안내·활용신청 ↗</a></article>`).join('')}<p>보행거리·시간은 생활도보길에서 조회합니다. 실제 출입구·통행조건은 현장에서 확인하며, 돌봄 수요를 판단하려면 연령별 인구·정원·대기수요와 시설의 최신 운영정보가 추가로 필요합니다. 현재 위치 기반 비교를 수요·안전도 판정으로 표시하지 않습니다.</p><p>키는 배포 서비스의 서버 환경변수에 저장하고 다시 배포합니다. 키를 지도 입력창이나 공개 소스에 넣지 않습니다.</p><p><a href="https://public.rimikimi.com/" target="_blank" rel="noopener noreferrer">공공데이터 API 검색 사이트에서 더 찾아보기 ↗</a></p></section>`;
}
export function installLifeApiGuide(api){registerAction('decision-api-guide',()=>{api.show('추가 생활정보 API 연결',lifeApiGuideHtml(),'decision-api-guide');});}
