# API 연결: 키, 주소, 자료 형식을 구분하세요

API를 AI에 ‘학습’시켜 도시를 생성하는 구조가 아닙니다. 지도 SDK가 지리정보를 그리며, 별도 시설자료를 **조회 → 열 매핑 → 좌표/날짜 검증 → GeoJSON → 지도·표·차트** 순서로 처리합니다.

한 개의 키를 넣으면 모든 지도·시설·민원·인구가 모이는 것이 아닙니다. 발급기관의 **SDK용 키와 REST용 키, 서비스 승인, 원본 자료 명세**를 확인해야 합니다. 아래 엔드포인트는 공식 문서에 맞춰 작성한 연결 코드이며 유효 키를 통한 실수신 검증은 아직 하지 못했습니다.

## 1. 키 없이 쓰는 기본 웹지도

MapLibre GL JS 5.6.1을 고정 버전 CDN에서 읽고 OpenFreeMap 벡터 지도를 요청합니다. 이 지도에는 별도 인증키가 필요하지 않습니다. 라이브러리·스타일·타일은 인터넷에서 받으므로 외부 접속이 차단된 PC에서는 동작하지 않습니다.

- 라이브러리 1차: `https://unpkg.com/maplibre-gl@5.6.1/dist/`
- 라이브러리 예비: `https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.1/dist/`
- 밝은 스타일: `https://tiles.openfreemap.org/styles/positron`
- 어두운 스타일: `https://tiles.openfreemap.org/styles/dark`
- 건물 벡터 자료: `https://tiles.openfreemap.org/planet`

CDN을 받지 못하면 예비 CDN으로 재시도합니다. 실패 시 지도가 오류 상태가 되며 실제 지도를 가장한 합성 지도를 자동 표시하지 않습니다. 공개 인스턴스에는 SLA가 없으므로 공식 서비스 확장 시 자체 배포·대체공급 등을 별도 검토해야 합니다.

공식: https://openfreemap.org/ · https://openfreemap.org/quick_start/ · https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/

## 2. 브이월드 웹지엘 3D

| 환경변수 | 의미 | 필수 여부 |
|---|---|---|
| `VWORLD_BROWSER_KEY` | 웹지엘 3D SDK에서 쓰는 브라우저용 키 | 3D 모드에 필수 |
| `VWORLD_DOMAIN` | 브이월드에 등록한 실제 HTTPS 서비스 주소, 마지막 `/` 제외 | 3D·REST 공통 필수 |
| `VWORLD_API_KEY` | 서버에서 사용하는 검색·행정경계 REST 키 | 검색·경계 기능에 필수 |
| `VWORLD_SIG_CODE` | 요청할 시군구 코드. 기본 `29140` | 필요 시 현행 코드로 수정 |

예시:

```text
VWORLD_BROWSER_KEY=본인에게_발급된_3D키
VWORLD_DOMAIN=https://본인서비스.vercel.app
VWORLD_API_KEY=본인에게_발급된_REST키
VWORLD_SIG_CODE=29140
```

**위 값은 자리표시자입니다. 키가 포함된 완성값을 GitHub에 올리지 마세요.**

웹 SDK는 키를 브라우저에서 사용하므로 `VWORLD_BROWSER_KEY`는 `/api/vworld-scene`의 HTML에서 보입니다. Vercel 환경변수에 저장했다는 이유로 이 키가 비밀이 되지는 않습니다. SDK용 키에는 도메인 제한을 적용하고 서버용 키와 분리하는 것을 권장합니다. 코드가 서버용 키를 브라우저용으로 자동 대체하지는 않습니다.

실제 웹지엘 SDK를 `/api/vworld-scene`의 같은 출처 iframe에서 실행합니다. SDK의 parser-time script 로딩과 `vw.Map`, `vw.CameraPosition`, `vw.ws3dInitCallBack`, `ws3d.viewer` 구조는 V-world 공식 3.0 샘플을 참고했습니다. 부모/iframe 메시지는 같은 origin과 source를 확인합니다. 제공기관의 키 예제값은 복사하거나 사용하지 않았습니다.

**서구 제공범위·건물 최신성·색상 변경 가능 여부·인증은 실제 배포 주소에서 확인해야 합니다.** 원본 브이월드 건물을 추정된 내부 객체 이름으로 강제로 숨기지 않으므로, 브이월드 모드에서는 자체 ‘입체 건물’ 토글을 비활성화했습니다. 2D 버튼은 별도 2D 지도 SDK가 아니라 카메라 수직보기입니다.

공식 설명: https://www.data.go.kr/data/3073144/openapi.do
공식 코드: https://github.com/V-world/V-world_API_sample

### 서버 검색과 경계

- `/api/vworld?kind=search&q=장소명`: 이름검색, 주변 좌표범위 검사, 선택한 지점으로 카메라 이동. 검색결과가 등록 시설로 자동 추가되지는 않습니다.
- `/api/vworld?kind=boundary`: `LT_C_ADSIGG_INFO` 데이터와 `sig_cd` 조건으로 행정경계를 요청합니다.

기본 시군구 코드 29140은 초기 설정입니다. 행정체계·코드 변화가 있으면 제공기관의 현행 코드와 반환된 도형을 대조한 뒤 바꾸세요. 카메라 이동 제한 박스는 행정경계가 아니고, 경계를 그렸다고 전체 데이터가 해당 경계로 자동 잘리는 것도 아닙니다.

## 3. 공공데이터 시설 API

이번 어댑터는 **하나의 시설 JSON API**를 읽고 좌표·시설명 등을 정해진 형식으로 바꿉니다. ODCLOUD의 `data[]`, 공공데이터 응답의 `response.body.items.item[]` 또는 단일 item을 지원합니다. XML·인증 헤더 전용 API·페이지 병합·주소 지오코딩은 지원하지 않습니다.

| 환경변수 | 값 |
|---|---|
| `DATA_GO_KR_SERVICE_KEY` | 해당 API의 serviceKey |
| `DATA_PORTAL_URL` | 활용신청한 실제 데이터 API의 HTTPS 주소, 포털 소개페이지 주소가 아님 |
| `DATA_FIELD_MAP` | 시설명·경도·위도·ID 열을 지정하는 JSON |
| `DATA_SOURCE_NAME` | 실제 자료의 기관/자료명 |
| `DATA_SOURCE_DATE` | 원자료의 기준일 YYYY-MM-DD. 현재 날짜를 근거 없이 넣지 않음 |
| `DATA_QUERY_JSON` | JSON 응답 등 추가 쿼리. 실제 API 명세에 맞게 입력 |

예시 매핑(열 이름은 **본인의 실제 API 응답에 맞게 수정**):

```json
{"name":"공원명","longitude":"경도","latitude":"위도","id":"관리번호","address":"소재지도로명주소","category":"park"}
```

`category`는 원본 열 이름이 아니라 이 API를 분류할 고정 코드입니다. 허용 코드는 `park`, `recycle`, `shelter`, `care` 네 가지입니다. `name`, `longitude`, `latitude`는 필수이며 `id`, `address`는 선택입니다. `id`가 없으면 수집 페이지 내 임시 행 번호를 사용하므로 장기 이력 연결용으로 적합하지 않습니다. 운영 시 안정적인 원본 ID를 연결하세요.

추가 쿼리의 예시는 아래와 같지만 API에 따라 `_type`, `resultType` 등 이름이 다릅니다. 실제 명세를 따라야 합니다.

```json
{"returnType":"JSON"}
```

허용된 호스트는 `api.odcloud.kr`, `apis.data.go.kr`, `api.data.go.kr`뿐입니다. URL은 관리자가 환경변수로 설정합니다. 브라우저가 임의 URL을 프록시할 수 없습니다. 리디렉션은 따라가지 않습니다.

serviceKey는 URI 인코딩/디코딩 문자열을 한 번 정리하여 URLSearchParams로 넣습니다. 해당 제공기관의 이례적인 인증 방식은 별도 어댑터가 필요합니다.

### 수집 한계

**1페이지 최대 1,000건만 수집합니다.** 전체 건수보다 적거나 전체 건수를 알 수 없으면 ‘부분수집’으로 표시합니다. 페이지 전체·전국 전체·서구 전체를 수집했다고 표시하지 않습니다. 응답 제한은 2MB, 외부 요청 시간 제한은 약8.5초입니다.

좌표는 광주 주변의 넓은 사각 범위만 검사합니다. **서구의 정확한 행정경계 필터가 아니므로 다른 자치구 자료가 포함될 수 있습니다.** 특정 API에 서구 선택 쿼리가 있으면 `DATA_QUERY_JSON`에 그 조건을 지정하고 결과를 검수하세요.

현재 어댑터는 월별 실적이 없는 시설 API를 전제로 `monthly: {}`를 만듭니다. 시설을 받았다고 통계기둥이 자동 생기지 않습니다. 월별 값은 검수한 GeoJSON으로 연결하거나 별도 시계열 API 어댑터를 작성해야 합니다.

## 4. 가장 빠른 실제자료 시험: GeoJSON

`public/data/facilities-template.geojson`을 복사하고 실제 자료로 바꿉니다. 양식의 좌표와 명칭은 예시로, 실제시설로 등록하면 안 됩니다.

```json
{
  "type":"FeatureCollection",
  "features":[{
    "type":"Feature",
    "geometry":{"type":"Point","coordinates":[126.859,35.151]},
    "properties":{
      "id":"본인의_고유번호",
      "name":"실제 자료에서 확인한 시설명",
      "category":"park",
      "sourceName":"실제 기관 / 자료명",
      "sourceDate":"2026-01-01",
      "metricName":"이용건수",
      "metricUnit":"건",
      "monthly":{"2026-01":null,"2026-02":0},
      "address":"실제 주소",
      "note":"검수 메모"
    }
  }]
}
```

위 예시 날짜·좌표를 근거 없이 유지하지 마세요. `null`은 자료 없음, `0`은 실제 관측값0입니다. 실적이 없으면 `monthly: {}`를 사용합니다. `validFrom`, `validTo`를 선택 입력하면 월별 유효기간 필터가 작동합니다. 월별 지표가 인원인지 횟수인지 유니크 이용자인지 같은 정의까지 맞춰야 합계가 의미를 갖습니다.

시설 Point 파일만 가져옵니다. 실제 사업 LineString/Polygon의 업로드·예산·공정률 연결은 아직 없습니다. 공개자료 파일은 기본 상태가 빈 배열입니다.
