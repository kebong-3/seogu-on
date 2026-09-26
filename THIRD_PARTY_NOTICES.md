# 외부 소프트웨어·지도·자료 안내

## 작성 코드

이 저장소에서 작성된 앱 코드·가상 도시 생성기·스타일은 루트 `LICENSE`의 MIT 조건으로 제공합니다. 이 라이선스가 외부 지도·자료의 권한까지 부여하지는 않습니다.

## MapLibre GL JS

실제 기본 지도에서 MapLibre GL JS **5.6.1**을 CDN으로 로딩합니다. 이 버전은 재현 가능한 시작점을 위한 고정값이며 최신 버전이라고 주장하지 않습니다. 라이브러리 자체 파일은 저장소나 ZIP에 포함하지 않았습니다. MapLibre GL JS의 BSD 3-Clause 라이선스와 배포물 고지사항을 준수해야 합니다.

공식 저장소/라이선스: https://github.com/maplibre/maplibre-gl-js
공식 예제: https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/

## OpenFreeMap / OpenMapTiles / OpenStreetMap

배경과 건물은 OpenFreeMap의 공개 서비스에서 요청합니다. 해당 서비스는 OpenStreetMap 자료와 OpenMapTiles 생태계를 사용합니다. 앱에 제공되는 출처 표시를 유지합니다. OpenStreetMap 데이터에는 ODbL 등 해당 조건이 적용됩니다. 지도 캡처/내보내기에도 출처를 표시합니다.

- https://openfreemap.org/
- https://openfreemap.org/quick_start/
- https://www.openmaptiles.org/
- https://www.openstreetmap.org/copyright

OpenFreeMap 공개 인스턴스에는 SLA가 없으며 상시 가용성을 보증하지 않습니다. 자료 정확도와 서비스 이용조건은 제공기관 안내를 따릅니다. 기본 모드의 8m 등 대체 건물 높이는 앱의 시각화용 값이며 측량값이 아닙니다.

## 브이월드 / 국토교통부 / 공공데이터

브이월드 모드와 REST 검색·경계는 발급받은 인증키·등록 도메인·서비스 승인에 따라 사용해야 합니다. 제공기관 로고와 크레디트를 숨기지 않습니다. 건물 모델 원자료를 추출·대량 저장하거나 다른 엔진에 임의로 재배포하는 기능은 만들지 않았습니다.

- https://www.data.go.kr/data/3073144/openapi.do
- https://github.com/V-world/V-world_API_sample

공식 샘플에 노출된 인증키는 이 프로젝트에 복사하거나 사용하지 않았습니다. 본인의 키를 발급받아야 합니다. 시설API는 연결한 개별 자료의 이용조건·표시사항을 추가로 따라야 합니다.

## 가상 도시와 UI

디자인 미리보기의 건물·강·도로와 합성 시설·사업·월별 수치는 자체 생성했습니다. 실제 지도자료, 국가 측량모형 또는 사용자가 제공한 영상의 데이터가 아닙니다. UI의 아이콘은 간단한 SVG 경로로 작성했고 시스템 폰트 스택을 사용했습니다. 외부 폰트 파일이나 사용자 원본 스크린샷을 저장소에 포함하지 않았습니다.

## v0.2 행정동 경계 및 실제 공개본

SGIS 행정동 원자료를 가공한 vuski/admdongkor ver20260701의 서구18개 동을 사용합니다. 가공부분 CC BY4.0 / SGIS 원자료 공공누리 제1유형 출처표시를 유지합니다. 세부 전문은 docs/BOUNDARY_LICENSE.txt. 원본좌표를 변경하지 않았으며 프로젝트용 안정ID·대표점·화면 범위 등 속성만 추가했습니다. 합집합 도형은 파생물입니다.

공원·주차장·공공시설·도서관의 공공데이터포털 제공조건과 출처를 각 public/data/layers 파일에 기록했습니다. 지진대피 학교는 서구청 공개 대피장소 표와 한국교육시설안전원 학교 위치 표준자료의 학교명·도로명주소를 대조한 대표위치입니다. 원본의 저작권·출처 조건을 앱 코드 MIT 라이선스로 바꾸지 않습니다.
