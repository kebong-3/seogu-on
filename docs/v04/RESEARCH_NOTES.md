# 실제 사례에서 참고한 설계

조사: 2026-09-27. 기관이 공개한 설명과 이번 앱 구현을 구분합니다. 다른 도시의 효과 수치를 서구의 예상 효과로 옮겨 쓰지 않습니다.

| 사례 | 공개 자료에서 확인되는 내용 | 이번 서구온에 반영 | 아직 구현하지 않은 것 |
|---|---|---|---|
| 헬싱키 Helsinki 3D | 항공사진 기반 시각 메쉬와 건물 속성 중심 도시정보모형을 구분하여 제공 | 브이월드 현실영상 / 독립 밝은 도시모형 모드 구분, 높이 근거·출처 표시 | 헬싱키 수준의 정밀 공간정보·에너지/태양광 산정 |
| 싱가포르 SLA OneMap | 공식 기본지도에서 학교·주변 생활시설 등 조회 | 학교 등 종류별 탐색, 선택 지점 주변 500m 직선거리 목록 | 검증된 보행망·출입구·보행시간 계산 |
| 싱가포르 OGP Undercover 2026 | 2026-02-03 소개, 제한 공개 단계. 보행망·가림시설·건물과 시간별 그늘을 결합하는 구조 | 독립 시간별 그늘 모듈, 위치·관측·추정의 분리, 향후 보행망을 붙일 수 있는 자료 구조 | 최단/그늘 보행경로 계산, 현장 그늘 검증, 열스트레스 감소 효과 검증 |

원문:
- https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d
- https://www.sla.gov.sg/geospatial/onemap/
- https://www.hack.gov.sg/2026/undercover/

위 사례에서 얻은 구현 판단: 현실사진이 언제나 행정정보를 읽기 좋은 것은 아니므로 모드를 분리한다. 시설 점·부지·건물·접근경로는 별도 자료다. 날짜와 기상·작업상태를 함께 표시하되 측정값과 계산값을 혼합하지 않는다.

## 국내 연결자료

- 기상청 단기예보 조회서비스: https://www.data.go.kr/data/15084084/openapi.do
- 한국환경공단 에어코리아 대기오염정보: https://www.data.go.kr/data/15073861/openapi.do
- 전국초중등학교위치 표준자료: https://www.data.go.kr/data/15021148/standard.do
- 서구 적사함(제설함) 2025-01-08 자료: https://www.data.go.kr/data/15140572/fileData.do

적사함 자료는 포털 메타데이터의 32행과 행정동·설치장소·적사함수 등 항목을 확인했습니다. 개별 원문 좌표·현행 상태를 확보한 것으로 처리하지 않았습니다. 32행을 적사함 32개로 단정하지 않습니다. 이 자료는 겨울 관리자료 확보의 후보이며 현재 지도 위치를 생성하는 근거로 사용하지 않았습니다.

## 기술 출처

Cesium Viewer 해상도·그림자·시계: https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html
Cesium ShadowMap: https://cesium.com/learn/cesiumjs/ref-doc/ShadowMap.html
VWorld 3D 플랫폼: https://www.data.go.kr/data/3073144/openapi.do
OSM 데이터 이용조건: https://www.openstreetmap.org/copyright

원본 텍스처 한계와 렌더링 해상도는 별개입니다. 추가 정밀 메쉬·고해상도 사진·측량자료를 쓰려면 해당 지역의 제공범위, 권리, 좌표계·높이기준을 확인해야 하므로 어느 외부 서비스가 서구 전역을 보장한다고 가정하지 않았습니다.
