# 서구온 v0.4 API 및 부서자료 연결

2026-09-27 작성. 아래는 앱이 읽는 환경변수와 설정 방법입니다. 사용자 키를 이용한 실제 인증·운영 승인·모든 외부 응답을 이번 제작환경에서 검증한 것은 아닙니다. 첨부 HTML의 예시 인증키는 복사하거나 사용하지 않았습니다.

## 1. 우선 등록할 값

| 환경변수 | 용도 | 등록/확인 |
|---|---|---|
| VWORLD_BROWSER_KEY | 브이월드 3D SDK | 이미 작동하면 유지. 브라우저에 전달되는 키이므로 제공기관의 도메인 제한 사용 |
| VWORLD_DOMAIN | 등록 서비스 도메인 | https://seogu-on.vercel.app |
| VWORLD_API_KEY | 서버 장소·주소·필지 조회 | 앱의 변수 이름. ‘별도 종류 키가 반드시 필요’라는 뜻이 아님 |
| KMA_SERVICE_KEY | 격자 실황·단기예보 | 공공데이터포털 기상청 단기예보 조회서비스 활용신청 |
| AIRKOREA_SERVICE_KEY | 측정소 위치 + 관측값 | 에어코리아 측정소정보와 대기오염정보 두 서비스 승인 확인 |
| DATA_GO_KR_SERVICE_KEY | 공통 대체키 | 개별 변수가 없을 때 사용. 서비스별 활용승인이 있어야 함 |
| SAFETYDATA_SERVICE_KEY | 무더위쉼터 | 재난안전데이터공유플랫폼 키. 공공데이터포털 키와 별개 |
| INFRA_SOURCES_JSON | 추가 인프라 원본 API와 열 매핑 | 관리자 설정. URL/필드/기준일을 실제 응답과 대조 |

기상청: https://www.data.go.kr/data/15084084/openapi.do
에어코리아 대기오염정보: https://www.data.go.kr/data/15073861/openapi.do
에어코리아 측정소정보는 포털에서 정확한 서비스명으로 검색하여 `MsrstnInfoInqireSvc/getMsrstnList` 사용권한을 확인합니다. 존재를 확인하지 않은 포털 ID를 임의로 만들지 않았습니다.

Vercel Settings → Environment Variables → Production에 저장한 뒤 새 배포에 적용합니다. 값은 GitHub·브라우저 코드·질문창에 넣지 않습니다. 공식 환경변수 안내: https://vercel.com/docs/environment-variables

## 2. 화면에서 사용하기

‘기후·그늘 → 날씨 실황 지도’는 선택 동 또는 18개 동 대표위치를 기상청 5km 격자로 변환하고 중복 격자를 묶어 조회합니다. 지도 표시점은 **조회 대표위치**이지 관측소 위치가 아닙니다. 기온·관측시각을 표시하고 클릭하면 습도·강수량·풍향·풍속을 확인합니다.

‘미세먼지 관측 지도’는 실제 측정소의 반환 좌표에 PM 수치와 시각을 표시합니다. PM10/PM2.5 결측·점검 플래그를 그대로 구분하고, 미확인 값을 ‘보통’ 등급으로 바꾸지 않습니다. 동별 농도나 건물별 농도로 보간하지 않습니다. 정상 수치 0은 보존합니다. 대기질 자료의 원본 제공조건과 변경금지 등 이용조건을 확인하세요.

‘시간별 예보’는 반환된 예보 시각을 선택하는 기능입니다. 그늘 시뮬레이션 시각과 예보 시각은 독립입니다. 미래 그림자 위에 현재 관측을 표시하더라도 미래 관측처럼 바꾸지 않습니다.

## 3. 기존 안전·교통·입지 API

v0.3의 `EMERGENCY_SERVICE_KEY`, `ITS_API_KEY`, `SAFEMAP_SERVICE_KEY`, `FLOODMAP_SERVICE_KEY`, `TAAS_SERVICE_KEY`, `TAAS_YEAR`, `TAAS_SIDO`, `TAAS_GUGUN`를 그대로 유지합니다. `docs/v03/API_SETUP.md`에는 서비스별 이전 연결 구조가 있습니다. v0.4에서 새로 실수신 검증한 상태라고 해석하지 않습니다.

## 4. 학교·복지·한파쉼터 등 추가 공개 JSON API

종류별 UI와 서버 어댑터는 준비했습니다. 모든 항목에 자동으로 인증키 하나만 넣으면 전수 자료가 생기는 것은 아닙니다. 실제 공개 API의 URL, 고유번호, 이름, 좌표 또는 GeoJSON 도형, 출처·기준일 열을 확인해야 합니다. 주소만 있는 자료를 자동으로 가짜 좌표로 바꾸지 않습니다.

다음은 **설정 구조의 예시**이며 실제로 호출 가능한 완성 URL이 아닙니다. 대문자 자리표시자를 실제 승인된 API 명세로 교체합니다.

```json
[
  {
    "id": "infra-cold",
    "url": "https://api.odcloud.kr/api/REPLACE_WITH_APPROVED_ENDPOINT",
    "sourceName": "제공기관 / 실제 한파쉼터 데이터명",
    "sourceUrl": "https://www.data.go.kr/",
    "sourceDate": null,
    "keyEnv": "DATA_GO_KR_SERVICE_KEY",
    "keyParam": "serviceKey",
    "pageParam": "page",
    "sizeParam": "perPage",
    "pageSize": 100,
    "itemsPath": "data",
    "totalPath": "totalCount",
    "params": {},
    "fields": {
      "id": "원본고유번호",
      "name": "시설명",
      "longitude": "경도",
      "latitude": "위도",
      "address": "소재지도로명주소",
      "sourceDate": "데이터기준일자"
    }
  }
]
```

이 JSON을 `INFRA_SOURCES_JSON`에 저장합니다. 키 자체를 JSON에 넣지 않고 `keyEnv`로 키가 있는 환경변수 이름을 지정합니다. 실제 endpoint의 필터가 있으면 `params`에 해당 지역 조건을 넣습니다. 어떤 API에 어떤 필터 이름이 있는지 추측하지 않습니다.

허용된 호스트는 `apis.data.go.kr`, `api.odcloud.kr`, `api.data.go.kr`, `www.safetydata.go.kr`입니다. HTTPS 기본 포트만 허용하며 URL 내 비밀키·리디렉션·브라우저 임의 프록시를 허용하지 않습니다. 해당 어댑터는 공개 JSON을 대상으로 하므로 XML/별도 OAuth/헤더 인증 API는 전용 어댑터를 추가해야 합니다.

원본이 면·선이면 `fields.geometry`에 GeoJSON 도형이 있는 열을 지정합니다. 점 자료를 원으로 넓혀 ‘시설 경계’라고 부르지 않습니다. 학교·도서관 등 하나의 기관이 여러 도형을 갖거나 동일 건물에 여러 기관이 있을 수 있습니다.

ID는 `src/city/infrastructure.js`의 `infra-school`, `infra-childcare`, `infra-civic`, `infra-welfare`, `infra-sports`, `infra-cold`, `infra-grit`, `infra-snow-routes` 등 기존 코드 중 하나입니다. 설정한 API는 해당 종류 자료층의 갱신 경로가 되며, 정상 수집 전까지 기존 공개본을 보존합니다.

## 5. 제설 현황·한파쉼터·그늘막 등 GeoJSON 반영

‘기후·그늘 → 제설·겨울 관리 → 종류 선택 → 검수자료 가져오기’를 사용합니다. 양식: `public/data/city/templates/operations-template.geojson`.

지원되는 종류는 한파쉼터, 적사함·제설함, 제설 작업구간, 제설 검토구간, 그늘막·그늘쉼터입니다. 점·선·면 중 원자료 형식을 그대로 사용하며 제설 작업구간은 선 도형이 필요합니다. 좌표는 경도, 위도 순서의 WGS84입니다. 광주 서구 밖은 제외/절단합니다.

공통 필수 속성: `id`, `name`, `sourceName`. `sourceDate`에 원자료 기준일을 추가합니다. 이 관리자료 가져오기는 정해진 공통 속성만 보존하며 기타 원본 속성은 제거합니다. 제설 상태는 `status`에 `planned`, `working`, `completed`, `unknown` 중 하나를 넣습니다. 상태가 유효하려면 `observedAt`, `expiresAt`을 시간대가 있는 ISO 날짜시간으로 입력합니다. 예컨대 날짜 뒤에 `T09:00:00+09:00` 형식을 사용합니다. 실제 확인한 날짜만 적으세요.

상태의 관측시각이 없거나 미래로 잘못 입력되면 ‘확인 안 됨’, 유효기한이 지났거나 24시간 이상 경과하면 ‘갱신 확인 필요’로 표시합니다. ‘완료’도 현장상태를 보증하지 않습니다. 이것은 행정 운영기록 관리 규칙이며 도로결빙 예측 모델이 아닙니다.

가져온 파일은 **현재 브라우저 메모리**에만 반영됩니다. 직원 간 공유·새로고침 후 유지가 필요하면 검수한 GeoJSON을 `public/data/city/infra/`의 같은 종류 파일에 반영하고 재배포하거나, 위 API 연결을 사용합니다. 서버 공통 DB·차량 위치추적·자동 작업보고는 포함하지 않았습니다.

## 6. 원자료가 아직 없는 항목

한파쉼터 현행 좌표, 제설 작업이력·차량노선, 적사함 개별 좌표, 그늘막 전수·운영 상태, 최신 어린이집·복지기관 공식 전수자료는 완비되지 않았습니다. 일부 OSM 영유아·복지 위치만 별도로 표시합니다. ‘자료 연결 필요’를 실제 시설 없음으로 해석하지 않습니다.
