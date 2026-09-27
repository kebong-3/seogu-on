# 외부 사례와 이번 적용의 경계

공식 출처 확인일: 2026-09-27. 아래 사례 전체를 복제하거나 분석모형을 이식했다는 뜻이 아닙니다.

| 공식 자료 | 확인한 구성 | 서구온에 반영한 점 |
|---|---|---|
| Helsinki 3D | 시각적 메시모형과 의미/속성정보를 가진 도시정보모형을 구분 | 브이월드 현실모형과 별도 밝은 도시모형을 구분하고 원자료·높이 근거를 표시 |
| Singapore OGP Undercover 2026 | 건물 높이, 보행망, 가림시설과 시간별 그림자를 결합한 경로 탐색 사례 | 시간별 그늘의 근거/시각을 분리. 미확보 보행망을 대신해 최적 그늘길을 만든 것으로 표시하지 않음 |
| Cesium Viewer 공식 문서 | resolutionScale과 렌더링/캔버스/그림자 속성 제공 | 제한된 배율, 미지원 기능 검사, 렌더 진단. 배율 상승을 새 모형 상세도 확보로 오해하지 않음 |
| 사용자 제공 VWorld 활용모델 | public facility_build/facility_build_all show/hide 사용 예시 | 상세/기본 모델 요청과 지원 검사, 실패 시 기존 표시 유지 |

출처:
- https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d
- https://www.hack.gov.sg/2026/undercover/
- https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html
- https://www.data.go.kr/data/3073144/openapi.do

입지점수, 침수안전등급, 제설 우선순위를 근거 없이 산출하지 않습니다. 해당 분야 전문모형/실측자료가 연결되기 전에는 관측, 자료, 근사 계산, 사용자 등록기록을 구분합니다. 이 구분은 표시를 약하게 하려는 것이 아니라 사용자가 실제로 아는 범위를 넘어 판단하지 않도록 하기 위한 것입니다.
