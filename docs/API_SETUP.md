# API 키 설정과 미수신 원인 찾기

키는 모두 **Vercel → 프로젝트(seogu-on) → Settings → Environment Variables**에 넣습니다.
넣거나 바꾼 뒤에는 **Deployments → 맨 위 배포의 ⋯ → Redeploy**를 눌러야 반영됩니다. Production에 체크했는지도 확인하세요.

키 값은 저장소·화면 캡처·채팅에 올리지 않습니다. 사이트 화면과 API 응답에도 키 값은 나오지 않습니다.

## 1. 환경변수 목록

전체 표는 저장소 최상위 `README.md`의 "환경변수" 절에 있습니다. 재난안전 API는 0.8.1에서 상습결빙구간을 추가해 10종입니다. 현재 목록과 상습결빙구간 설정은 아래 6절, 기존 9종의 당시 설정 기록은 [0.6.0 설정 문서](v06/API_SETUP.md)를 보세요.

공공데이터포털(data.go.kr) 키에 대해 알아 둘 점:

- 인증키는 **계정마다 하나**이고, API마다 **활용신청을 따로** 해야 합니다. 키가 같아도 신청하지 않은 API는 거부됩니다.
- 마이페이지에는 Encoding 키와 Decoding 키 두 가지가 보입니다. **어느 쪽을 넣어도 됩니다.** 서버가 한 번만 인코딩되도록 정리합니다(앞뒤 공백·줄바꿈·따옴표도 제거).
- 새로 신청하거나 재발급한 키는 반영까지 1~2시간 걸릴 수 있습니다.

상단 관측정보에 필요한 활용신청:

| 화면 값 | 공공데이터포털 API | 쓰는 변수(앞에서부터 차례로 시도) |
|---|---|---|
| 기온 · 1시간 강수 | 기상청_단기예보 조회서비스 (초단기실황) | `KMA_SERVICE_KEY` → `DATA_GO_KR_SERVICE_KEY` |
| 미세먼지 PM10 (1단계: 측정소 찾기) | 한국환경공단_에어코리아_측정소정보 | `AIRKOREA_SERVICE_KEY` → `DATA_GO_KR_SERVICE_KEY` → `KMA_SERVICE_KEY` |
| 미세먼지 PM10 (2단계: 측정값) | 한국환경공단_에어코리아_대기오염정보 | 위와 같음 |

미세먼지는 **두 API를 모두** 신청해야 합니다. 측정소정보로 서구 경계 안의 측정소를 찾고, 대기오염정보로 그 측정소의 값을 받습니다. 다른 구의 측정소 값으로 대신하지 않습니다.

## 2. 미수신일 때: 화면에서 원인 보기

상단의 기온·강수·PM10 값을 누르면 **"관측자료 수신 상태"** 패널이 열리고, 값이 없는 이유가 `코드`와 함께 나옵니다.
값 위에 마우스를 올려도 한 줄로 보입니다(예: `미수신 · 에어코리아 측정소정보 · 인증키 거부 (KEY_REJECTED)`).

같은 내용을 주소창에서 직접 볼 수도 있습니다.

- `https://seogu-on.vercel.app/api/weather?lon=126.85&lat=35.15`
- `https://seogu-on.vercel.app/api/city-data?kind=air-stations&dong=all&page=1`

응답의 `code`가 원인, `stage`가 실패한 단계(`weather`, `station-list`, `measurement`)입니다.

## 3. 코드별로 확인할 일

| code | HTTP | 뜻 | Vercel·포털에서 확인할 일 |
|---|---|---|---|
| `NOT_CONFIGURED` | 503 | 키 변수가 없음 | Environment Variables에 위 표의 변수가 있는지, **Production**에 체크됐는지, 저장 후 **Redeploy** 했는지 |
| `KEY_REJECTED` | 503 | 제공기관이 키를 거부(결과코드 30·31 또는 HTTP 401) | 포털 마이페이지의 키를 다시 복사해 붙여넣기(중간이 잘리지 않았는지). 발급·신청 직후면 1~2시간 뒤 재시도. 활용기간 만료 여부 |
| `ACCESS_DENIED` | 503 | 키는 맞지만 이 API를 쓸 권한이 없음(결과코드 20·32 또는 HTTP 403) | 포털 → 마이페이지 → 활용신청 현황에서 `stage`에 해당하는 API가 **승인** 상태인지. PM10은 측정소정보·대기오염정보 둘 다 |
| `QUOTA_EXCEEDED` | 503 | 일일 호출 한도 초과(결과코드 22) | 다음 날 자동 해소. 반복되면 포털에서 운영계정 전환(한도 상향) 신청 |
| `NO_STATION` | 200(목록) | 측정소 목록은 받았지만 서구 경계 안에 측정소가 없음 | `AIRKOREA_REGION_QUERY` 값이 `광주`인지(주소 검색어). 비워 두면 기본값 `광주` |
| `NO_DATA` | 404 | 제공기관이 그 시각 자료를 아직 올리지 않음 | 조치 불필요. 10분마다 다시 조회 |
| `UPSTREAM_TIMEOUT` | 504 | 제공기관 응답 지연 | 조치 불필요. 반복되면 포털 공지 확인 |
| `UPSTREAM_UNREACHABLE` | 502 | 제공기관 서버에 연결 실패 | Vercel → Logs에서 `[air]` 또는 `[weather]` 줄 확인. 제공기관 점검 여부 |
| `UPSTREAM_HTTP` | 502 | 제공기관이 오류 상태 반환 | 위와 같음 |
| `BAD_SHAPE` | 502 | 응답 형식이 예상과 다름 | 제공기관 API 명세가 바뀌었을 수 있음. 개발 담당 확인 필요 |
| `UPSTREAM_ERROR` | 502 | 그 밖의 제공기관 오류 | Vercel → Logs의 결과코드 확인 |

Vercel 로그에는 `[air] station-list primary KEY_REJECTED`처럼 **단계 · 몇 번째 키 · 코드**만 남습니다. 키 값과 요청 주소는 남기지 않습니다.

## 4. 이번에 고친 원인(0.7.0에서 PM10이 미수신이던 이유로 추정)

0.7.0은 기상청 요청에서는 키를 풀어서(디코딩) 보냈지만 에어코리아 요청에서는 그대로 보냈습니다.
그래서 포털의 **Encoding 키**를 넣은 경우 기상은 받아지고 미세먼지만 이중 인코딩으로 거부(HTTP 502)되었습니다.
지금은 두 요청 모두 같은 방식으로 키를 정리합니다.

**이 수정은 가짜 응답을 쓴 시험으로만 확인했습니다.** 실제 운영 키로 수신되는지는 배포 뒤 위 2번 방법으로 확인해야 합니다.
여전히 미수신이면 표의 코드가 다음 원인을 알려 줍니다.

## 5. 정직성 원칙

- 받지 못한 값은 "미수신", 응답에 값이 없거나 점검 플래그가 있으면 "미관측"으로 표시합니다. 0이나 다른 지역 값으로 채우지 않습니다.
- 갱신에 실패하면 같은 구역의 이전 정상값을 원래 관측시각과 "갱신 실패" 표시와 함께 보여 줍니다.
- "환경변수 설정됨"은 인증 성공이나 자료 수신 성공을 뜻하지 않습니다.

## 6. 재난안전 API 10종과 상습결빙구간

### 6-1. 서비스별 환경변수

Vercel의 서버 전용 환경변수에 서비스별로 저장합니다. 이 값에 `VITE_`, `NEXT_PUBLIC_` 같은 브라우저 공개 접두사를 붙이지 않습니다. 공식 데이터 설명·이용조건은 각 서비스의 링크에서 확인합니다.

| 서비스 | 공식 식별자 | 개별 서버 환경변수 | 공식 설명 |
|---|---|---|---|
| 한파쉼터 | `DSSP-IF-10804` | `SAFETYDATA_10804_KEY` | [dataSn=966](https://www.safetydata.go.kr/disaster-data/view?dataSn=966) |
| 무더위쉼터 | `DSSP-IF-10942` | `SAFETYDATA_10942_KEY` | [dataSn=1338](https://www.safetydata.go.kr/disaster-data/view?dataSn=1338) |
| 침수흔적도 | `DSSP-IF-00117` | `SAFETYDATA_00117_KEY` | [dataSn=108](https://www.safetydata.go.kr/disaster-data/view?dataSn=108) |
| 지역 재해위험지구 | `DSSP-IF-00058` | `SAFETYDATA_00058_KEY` | [dataSn=52](https://www.safetydata.go.kr/disaster-data/view?dataSn=52) |
| AWS 10분 관측 | `DSSP-IF-00026` | `SAFETYDATA_00026_KEY` | [dataSn=21](https://www.safetydata.go.kr/disaster-data/view?dataSn=21) |
| 의료기관 병상 원자료 | `DSSP-IF-00242` | `SAFETYDATA_00242_KEY` | [dataSn=227](https://www.safetydata.go.kr/disaster-data/view?dataSn=227) |
| 폭염저감시설 | `DSSP-IF-10926` | `SAFETYDATA_10926_KEY` | [dataSn=1326](https://www.safetydata.go.kr/disaster-data/view?dataSn=1326) |
| 민방위 대피소 | `DSSP-IF-00195` | `SAFETYDATA_00195_KEY` | [dataSn=184](https://www.safetydata.go.kr/disaster-data/view?dataSn=184) |
| 도로위험상황예보 | `DSSP-IF-10005` | `SAFETYDATA_10005_KEY` | [dataSn=732](https://www.safetydata.go.kr/disaster-data/view?dataSn=732) |
| **상습결빙구간** | **`DSSP-IF-00120`** | **`SAFETYDATA_00120_KEY`** | [dataSn=111](https://www.safetydata.go.kr/disaster-data/view?dataSn=111) |

기존 `SAFETYDATA_KEYS_JSON`에 서비스 식별자와 키를 묶어 사용하는 방식도 유지됩니다. 같은 서비스가 두 곳에 있으면 개별 환경변수의 값을 먼저 사용합니다. 새 키 하나만 추가하려면 기존 JSON을 바꾸지 않고 `SAFETYDATA_00120_KEY`를 저장하면 됩니다. 10종은 등록된 조회 대상 수이며 정상 수신한 서비스 수가 아닙니다.

### 6-2. 상습결빙구간 API 주소와 요청 항목

- 공식 API: `https://www.safetydata.go.kr/V2/api/DSSP-IF-00120`
- 공식 상세페이지: [상습결빙구간(dataSn=111)](https://www.safetydata.go.kr/disaster-data/view?dataSn=111)
- 공식 요청·출력 명세: [요청변수·출력결과](https://www.safetydata.go.kr/disaster-data/apiDataTable?dataSn=111)
- 확인한 명세 사본: [00120-schema-text.txt](v081/00120-schema-text.txt)
- 서구온 내부 조회: `/api/city-data?kind=sd-icing&dong=all&page=1`

공식 명세의 요청변수는 다음 4개입니다.

| 요청변수 | 공식 필수 여부 | 현재 서버가 보내는 값·의미 |
|---|---|---|
| `serviceKey` | 필수 | `SAFETYDATA_00120_KEY` 등 서버 환경변수에서 읽은 해당 서비스 키 |
| `numOfRows` | 선택 | 페이지당 `500`행 요청 |
| `pageNo` | 선택 | `1`부터 순서대로 조회 |
| `returnType` | 선택 | `json` |

이 API의 명세에 없는 `sido`, `gugun`, 위경도 범위 변수를 임의로 덧붙이지 않습니다. 전국 응답을 페이지별로 받은 뒤 대표지역명과 업로드된 서구 18개 행정동 경계를 함께 확인합니다. 내부 URL의 `dong=all`은 광주 서구 전체라는 뜻이며 외부 API의 요청변수가 아닙니다.

전용 **상습결빙구간** 메뉴에서는 광주 서구를 우선 대상으로 열고, 선택한 동이 있으면 표시 범위를 좁힙니다. 수신 현황에는 검사한 원자료 행, 서구에 해당하는 행, 지도 표시 지점, 좌표 검수 대상과 원래 구간번호를 구분합니다. 지점 여러 개를 이어 실제 도로 선형을 만들지 않습니다.

### 6-3. 실제 키 시험에서 확인한 오류

2026-10-05 로컬 실행환경에서 실제 키로 호출했을 때 **HTTP 200이 반환됐지만 응답 본문은 다음 오류**였습니다. 근거: [키를 제외한 수신 요약](v081/keyed-response-summary.json).

```json
{
  "httpStatus": 200,
  "header": {
    "resultCode": "32",
    "resultMsg": "UNREGISTERED IP ERROR"
  },
  "bodyCount": null
}
```

따라서 확인한 것은 **등록 IP 오류**이며, 인증 성공·자료 수신 성공·서구 0건은 확인하지 않았습니다. 서구온 서버는 이 응답을 `SAFETYDATA_32` 오류로 처리하며 정상 자료로 집계하지 않습니다. 위 결과는 로컬 출발 IP의 관찰입니다. Vercel의 실제 출발 IP 또는 Vercel 배포 후 결과를 대신하지 않습니다.

| 항목 | 문서 작성 시점의 확인 상태 |
|---|---|
| 공식 API 식별자·명세 연결 코드 | `DSSP-IF-00120`, 요청변수 4개 반영 |
| 로컬 환경의 실제 키 호출 | HTTP 200 안의 `32 / UNREGISTERED IP ERROR` 확인 |
| Vercel Production 환경변수 | `SAFETYDATA_00120_KEY` 저장 확인; 값은 비공개 |
| 환경변수와 코드를 반영한 새 Production 배포 | Ready · Production · Current 확인 |
| Vercel 환경의 인증·실자료 수신 | HTTP 403 / SAFETYDATA_32 등록 IP 오류 확인; 원자료 본문 미수신 |

이후 배포 상태는 [0.8.1 변경·확인 기록](v081/RELEASE.md)에 실제 관찰과 함께 갱신합니다.

### 6-4. 등록 IP 오류가 계속될 때

1. 플랫폼에서 해당 서비스의 활용승인·키·허용 IP 설정을 확인합니다. 사용자 PC의 공인 IP와 서버가 요청할 때의 출발 IP는 별개입니다.
2. 새 배포 후 다시 호출하여 HTTP 상태와 본문의 `resultCode`를 함께 확인합니다. 실패할 때 반복 호출로 성공을 가정하지 않습니다.
3. 허용 IP 범위 변경, 와일드카드 허용 여부, 다른 승인된 실행환경 사용은 **사용자의 선택사항**입니다. 이번 작업에서는 플랫폼의 IP 허용 설정이나 와일드카드를 변경하지 않았습니다.

유료 고정 IP 구매를 전제로 하지 않습니다. API 인증이 해결되기 전에도 별도로 수집한 **생활안전지도 공식 공개본 23개 관리지점**을 확인할 수 있도록 준비했습니다. 이 공개본 표시를 `DSSP-IF-00120` 인증 성공으로 표시하지 않습니다. 공개본의 원자료 날짜·제외 내역은 [수집·검증 기록](v081/RELEASE.md)에 있습니다.

### 6-5. 공개본의 출처와 이용조건

상습결빙구간의 API 명세 출처와 생활안전지도 공개본 출처는 구분해 보존합니다. 생활안전지도 [상습결빙구간 상세페이지](https://www.safemap.go.kr/opna/data/dataViewRenew.do?objtId=221)에 표시된 **공공누리 제4유형(출처표시·상업적 이용금지·변경금지)** 등 원문 이용조건을 함께 남깁니다. 상업적 재이용이나 추가 편집을 하려면 해당 원문 조건을 먼저 확인해야 합니다. 코드의 MIT 라이선스는 원자료의 이용조건을 바꾸지 않습니다. 자세한 구분은 [출처·이용조건](../THIRD_PARTY_NOTICES.md)을 참고하세요.

### 0.8.1 운영 서버 확인 결과 (2026-10-05)

`seogu-on.vercel.app`의 `/api/city-config`에서 `sd-icing.configured=true`를 확인했습니다. 운영 `/api/city-data?kind=sd-icing&dong=all&page=1`은 HTTP 403과 `SAFETYDATA_32`를 반환했습니다. 웹 수신 현황에도 동일한 등록 IP 오류가 표시됩니다. 키를 저장하고 배포한 것과 제공기관에서 실제 자료를 받은 것을 구분해야 합니다. 등록 IP 조건은 변경하지 않았으며, 직접 수집한 공식 공개본 23개 관리지점은 별도로 표시됩니다.
