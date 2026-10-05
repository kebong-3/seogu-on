# 외부 소프트웨어·지도·자료 안내

## v0.8.1 공식 공개자료 추가

이번에 수집한 19종의 출처·기준일·수집시각·공식 원문 링크는 `public/data/city/official-collection.json` 및 각 GeoJSON에 보존합니다. 원응답의 시설 담당자 성명·등록 계정 등은 배포하지 않으며, 지도에 필요한 시설 속성만 수록합니다. 전체 위치기록 9,375개는 중복 없는 시설 총수가 아닙니다. AED는 장비, 상습결빙은 관리구간의 시작·종료 지점입니다.

- 상습결빙 공개본: 행정안전부 생활안전지도, <https://www.safemap.go.kr/opna/data/dataViewRenew.do?objtId=221>. 해당 상세화면의 **공공누리 제4유형(출처표시·상업적 이용금지·변경금지)** 조건을 유지합니다. 공식 공개 좌표·속성의 출처를 보존하며, 광주 서구 경계 안의 지점을 선별했습니다. 카탈로그 수정일은 개별 지점의 갱신일이 아닙니다. `DSSP-IF-00120` 인증 API의 이용조건은 재난안전데이터공유플랫폼의 해당 서비스 원문을 확인해야 합니다.
- 국민안전24 안전지도: <https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do>. 재난 대피·쉼터·급수 등 공개 등록자료의 개별 출처와 제공조건을 유지합니다.
- 국립중앙의료원 E-GEN: <https://e-gen.or.kr/egen/search_aed.do>. 공개 AED 등록자료이며 현재 현장 작동·사용 가능 상태를 보증하지 않습니다.
- 공공데이터포털 표준자료: 보안등, 보호구역 대상시설, 전통시장, 무료급식소 등은 파일별 제공기관·데이터 기준일·원문 링크를 확인합니다. 동일 시설의 중복 제공본을 별도 시설로 합산하지 않습니다.
- 약국: 행정안전부 생활안전지도 공식 WFS의 주소와 제공 좌표를 대조한 공개 등록 위치입니다. 영업 여부와 실시간 조제 가능 여부는 별도 확인 대상입니다.

앱 코드의 MIT 조건은 위 외부 자료·기관 표장에 추가 이용허락을 부여하지 않습니다. 재이용·배포 시 원자료별 조건과 출처 표시를 유지해야 합니다. 수신 경로와 정규화·제외 내역은 `docs/v081/` 문서를 참고하세요.

## 작성 코드

이 저장소에서 작성된 앱 코드·가상 도시 생성기·스타일은 루트 `LICENSE`의 MIT 조건으로 제공합니다. 이 라이선스가 외부 지도·자료의 권한까지 부여하지는 않습니다.

## MapLibre GL JS

실제 기본 지도에서 MapLibre GL JS **5.6.1**을 CDN으로 로딩합니다. 이 버전은 재현 가능한 시작점을 위한 고정값이며 최신 버전이라고 주장하지 않습니다. v0.1에서는 CDN이었으며 v0.3부터 고정 버전 파일을 src/vendor에 포함했습니다. MapLibre GL JS의 BSD 3-Clause 라이선스와 배포물 고지사항을 준수해야 합니다.

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

브이월드 모드와 REST 검색·경계는 발급받은 인증키·등록 도메인·서비스 승인에 따라 사용해야 합니다. 지도 출처와 SDK 크레디트는 유지합니다. v0.6의 하단 로고 UI는 공식 샘플의 logo:false 옵션을 사용합니다. 건물 모델 원자료를 추출·대량 저장하거나 다른 엔진에 임의로 재배포하는 기능은 만들지 않았습니다.

- https://www.data.go.kr/data/3073144/openapi.do
- https://github.com/V-world/V-world_API_sample

공식 샘플에 노출된 인증키는 이 프로젝트에 복사하거나 사용하지 않았습니다. 본인의 키를 발급받아야 합니다. 시설API는 연결한 개별 자료의 이용조건·표시사항을 추가로 따라야 합니다.

## 가상 도시와 UI

디자인 미리보기의 건물·강·도로와 합성 시설·사업·월별 수치는 자체 생성했습니다. 실제 지도자료, 국가 측량모형 또는 사용자가 제공한 영상의 데이터가 아닙니다. UI의 아이콘은 간단한 SVG 경로로 작성했고 시스템 폰트 스택을 사용했습니다. 외부 폰트 파일이나 사용자 원본 스크린샷을 저장소에 포함하지 않았습니다.

## v0.2 행정동 경계 및 실제 공개본

SGIS 행정동 원자료를 가공한 vuski/admdongkor ver20260701의 서구18개 동을 사용합니다. 가공부분 CC BY4.0 / SGIS 원자료 공공누리 제1유형 출처표시를 유지합니다. 세부 전문은 docs/BOUNDARY_LICENSE.txt. 원본좌표를 변경하지 않았으며 프로젝트용 안정ID·대표점·화면 범위 등 속성만 추가했습니다. 합집합 도형은 파생물입니다.

공원·주차장·공공시설·도서관의 공공데이터포털 제공조건과 출처를 각 public/data/layers 파일에 기록했습니다. 지진대피 학교는 서구청 공개 대피장소 표와 한국교육시설안전원 학교 위치 표준자료의 학교명·도로명주소를 대조한 대표위치입니다. 원본의 저작권·출처 조건을 앱 코드 MIT 라이선스로 바꾸지 않습니다.


## v0.3 추가 구성

- MapLibre GL JS5.6.1: src/vendor/maplibre-gl.js, maplibre-gl.css, maplibre.LICENSE
- polygon-clipping0.15.7: src/vendor/polygon-clipping.js, polygon-clipping.LICENSE
- hls.js1.6.13: src/vendor/hls.min.js, hls.LICENSE
- 각 라이선스 원문은 동일 폴더에 동봉했습니다. 별도 글꼴 파일은 배포하지 않습니다.
- © OpenStreetMap contributors. 공원 도형: https://www.openstreetmap.org/copyright / ODbL1.0 https://opendatacommons.org/licenses/odbl/1-0/ . 서구 경계 절단 가공본도 ODbL로 제공하며 public/data/city/park-areas.geojson에 출처와 개별OSM객체 링크가 있습니다. 공식 공원 지정 경계가 아닙니다.
- 행정동 경계: 통계청 SGIS 공공누리1유형 원자료 가공(vuski/admdongkor), 가공물CC BY4.0. 원자료/가공자 출처 표시를 유지합니다.
- VWorld3 SDK의 출처·크레디트를 지우거나 모델을 대량 다운로드하지 않습니다. SDK는 제공기관에서 브라우저로 불러옵니다. 하단 로고 UI 미표출 옵션의 v0.6 적용은 아래 고지를 참고하세요.
- 첨부 활용예제의 원본HTML·샘플인증키는 공개 배포하지 않습니다. 아이디어·API구조를 참조하고 관련 코드를 새로 작성했습니다.
- v0.3에서는 standalone Cesium1.121을 검증환경에서만 사용했습니다. v0.4는 아래 별도 도시모형 엔진을 추가했습니다.


## v0.4 추가 구성

독립 도시모형 전용 CesiumJS **1.121.0**의 UMD 파일/Assets/Workers/Widgets/ThirdParty를 `public/vendor/cesium/`에 포함합니다. Apache2 및 각 의존성의 고지 전문은 같은 폴더 `LICENSE.md`에 있습니다. 브이월드 SDK iframe과 독립 모형 iframe을 분리하여 전역 Cesium을 중복 주입하지 않습니다. 기본 외부 imagery/terrain/geocoder 서비스를 비활성화하여 라이브러리 기본 외부 서비스 키를 앱의 데이터 연결키로 사용하지 않습니다. 별도 글꼴 파일은 포함하지 않습니다.

OSM 인프라·건물·도로/수계 파생자료는 ODbL로 제공합니다. 각 객체ID·출처와 미상높이/층수추정/태그값을 보존합니다. 절단·중복 정리·일부 태그만 추출·층수×3m/표시6m 속성 추가를 수행했습니다. 원본 OSM 건물은 VWorld에서 추출한 것이 아닙니다. 재배포·파생DB 공개 시 ODbL 조건을 유지합니다. https://www.openstreetmap.org/copyright

기존 공원면94개와 별개로 인프라 구역도형을 추가했습니다. 같은 기관의 대표위치와 부지/건물은 중복일 수 있어 기관수로 단순 합산하지 않습니다. 공공 학교 대표위치는 전국초중등학교위치표준자료2026-03-20 공개본을 사용하며 해당 출처/제공조건을 유지합니다.

API응답의 원본수치·단위·시각·점검플래그를 보존합니다. 특히 에어코리아 등 서비스의 개별 이용조건은 포털 안내와 운영승인 조건을 별도로 확인합니다. 코드MIT가 API데이터의 추가 변형권한을 부여하지 않습니다.

## 0.4.1 로컬 SDK 배포 변경

기존 Cesium1.121.0 실행자료를 `vendor/cesium-1.121.0.tar.gz`로 묶었습니다. 해당 원본의 Apache-2.0 LICENSE.md 및 ThirdParty.json을 보존하고 별도 글꼴파일은 포함하지 않았습니다. 파일 해시는 `vendor/cesium-manifest.json`에 있으며 빌드가 이를 검사한 뒤 `public/vendor/cesium`에 복원합니다. 이는 SDK 배포 포장 변경이지 브이월드 지도타일을 추출·재배포하는 것이 아닙니다. 기존 OSM/SGIS/공공자료의 별도 출처조건은 계속 적용됩니다.


## v0.6 추가 원자료·기관 시각표시

18개 동 BI는 서구청 동행정복지센터 공식 소개 페이지의 원본 이미지입니다. `public/brand/dongs.json`의 원문·이미지 출처와 해시를 보존합니다. 사용자 제공 CI 2개도 원본 비율·디자인을 바꾸지 않았습니다. 코드 MIT 라이선스가 이러한 표장·원자료에 새 이용허락을 부여하지는 않습니다.

서구 그늘막(15140461), 쿨링포그(15140653), 과거 침수피해(15124509)는 공공데이터포털 공개 CSV를 수신해 서구 경계 검사 후 표시했습니다. 원자료·출처·기준일·변환 및 제외 사유는 docs/v06/DATA_STATUS.md와 LOCAL_DATA_AUDIT.json에 있습니다. 실제 운영 상태와 다른 공개 기록일 수 있습니다.

재난안전데이터공유플랫폼의 공공기관 제공자료는 플랫폼 안내상 공공누리 제3유형입니다. 서비스별 공개 범위와 이용조건을 확인하고, 원자료 필드·출처를 보존합니다. API 키가 있다는 사실이 이용조건을 무효화하지 않습니다. 실제 키와 미검수 개인 속성은 전달자료에 넣지 않았습니다. 브이월드 공식 코드샘플에 문서화된 `logo: false` 옵션으로 하단 로고의 미표출을 요청합니다. 자체 하단에는 첨부 서구 CI 2개를 사용하고, 지도 위 별도 텍스트에 ‘배경지도: 국토교통부·브이월드’ 출처를 유지합니다. SDK 크레디트·저작권 안내를 가리거나 삭제하는 CSS는 넣지 않았습니다. 실제 브이월드 SDK 화면에서의 옵션 반영은 배포 후 확인해야 합니다. 이 UI 옵션은 개별 데이터의 이용조건을 없애는 허가가 아닙니다.

공식 UI 옵션 근거: https://github.com/V-world/V-world_API_sample/blob/master/%5BWebGL%5D%20glb%20%EC%9B%80%EC%A7%81%EC%9D%B4%EA%B8%B0.html


## v0.6.1 자체 브랜드와 출처 UI

`public/brand/seogu-on-symbol.svg`는 자체 제작 도시 심벌이며, `seogu-on-wordmark.svg`는 ‘서구:온’ 전용 벡터 워드마크입니다. 기존 정당·지도제공기관의 로고를 복제하거나 해당 기관의 공식 후원을 표시한 것이 아닙니다. 글꼴 바이너리는 배포하지 않습니다. 기존 18개 동 BI 및 첨부 서구 CI 파일은 그대로 보존합니다. 긴 지도 출처 띠는 하단 출처 팝오버로 이동했고 OpenStreetMap 링크와 SDK 자체 출처는 유지합니다.
