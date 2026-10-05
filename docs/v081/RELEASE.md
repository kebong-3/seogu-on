# 서구:온 0.8.1 변경·수집·확인 기록

수집·점검 기준일: **2026-10-05(한국시간)**. **Vercel Production 배포와 운영 메뉴·공개자료 표시를 확인했습니다.** 인증 API는 운영 서버에서도 등록 IP 오류를 반환하므로, 공개본 표시와 인증 API 수신 성공을 구분합니다.

## 1. 주요 변경

- **동 숫자·번호표 제거:** 지도 위 동 숫자, 왼쪽 동 카드 숫자 배지, 지도 상단 번호표 범례를 제거했습니다. 마을 BI와 동 이름, 동 선택 기능은 유지합니다.
- **이름 배치:** 경계도·OSM 경량지도·브이월드 3D·밝은 도시모형에서 선택 동 이름을 우선 배치합니다. 겹친 이름은 일부 숨기고 확대·이동 시 다시 표시합니다. 3D 화면 좌표를 구하지 못하면 선택 동 이름만 표시합니다.
- **상습결빙구간:** 전용 메뉴와 `DSSP-IF-00120` 조회 코드를 추가해 재난안전 API 목록이 9종에서 10종이 됐습니다. 광주 서구를 우선 대상으로 원자료를 검수하고 API 수신상태와 별도 공개본 표시를 구분합니다.
- **직접 수집한 공개자료:** 18종 9,352개 레코드와 상습결빙구간 공개본 23개 관리지점을 합쳐 **19종 9,375개 레코드**를 정리했습니다. 상세 수량과 출처는 아래 3절에 있습니다.

## 2. 무엇을 확인했고 무엇이 남았는가

| 항목 | 확인 상태 | 근거·한계 |
|---|---|---|
| 동 번호·번호표 제거 코드 | 변경 반영 | 지도 이름·카드 BI 유지, 번호 모듈과 관련 이벤트 제거 |
| 동 이름·홈 관련 시험 | 24개 통과 | 아래 7절의 Node 시험 범위; 실제 지도 공급자 연결 시험과 구분 |
| 공식자료 수집·좌표 검수 | 19종 9,375개 레코드 정리 | [일반 공개자료 검수표](OFFICIAL_COLLECTION_AUDIT.json), [상습결빙 검수표](icing-audit.json) |
| 실제 키를 사용한 로컬 상습결빙 API 호출 | HTTP 200 안의 오류 `32 / UNREGISTERED IP ERROR` 확인 | [키 제외 수신 요약](keyed-response-summary.json); 자료 본문 미수신 |
| Vercel Production의 `SAFETYDATA_00120_KEY` | 환경변수 저장 확인 | 키 값은 문서·응답·저장소에 기록하지 않음 |
| 새 코드·환경변수를 적용한 Production 배포 | **Ready / Production / Current 확인** | [운영 주소](https://seogu-on.vercel.app/), [검증한 최초 0.8.1 배포](https://vercel.com/kevin-jeong/seogu-on/Gxi25RaLpQ5tf36urLZR2KLchcA8), 구현 커밋 `0736a72` |
| 운영 웹페이지의 동 이름·메뉴·공개본 표시 | **확인 완료** | 번호표·숫자 배지 DOM 0개, 결빙 전체 23지점·치평동 4지점, 공식자료 19종의 수록 건수와 약국 158지점 표시 확인 |
| Vercel에서의 `DSSP-IF-00120` 인증·실자료 수신 | **수신 실패 확인: `SAFETYDATA_32`** | 운영 `/api/city-data?kind=sd-icing&dong=all&page=1`가 HTTP 403 및 등록 IP 오류 반환. 키 설정은 true, 본문 자료는 미수신 |

Vercel 환경변수를 저장한 것, HTTP 응답을 받은 것, 데이터를 정상 수신한 것은 서로 다른 상태입니다. 공개본 23개 지점이 표시되어도 인증 API의 수신 성공을 뜻하지 않습니다.

## 3. 직접 수집한 공개자료 19종

**합계는 자료 레코드의 합입니다. 고유 시설 9,375곳이라는 뜻이 아닙니다.** 같은 건물·시설이 무더위쉼터, 한파쉼터, 대피소 등 여러 계층에 중복될 수 있습니다. AED는 설치 장비 **412대**이며 장소 412곳으로 바꾸어 읽지 않습니다. 기존 수록 자료와 새 수집본 사이에도 같은 시설이 있을 수 있으므로 이번 수량을 기존 시설 수에 그대로 더하지 않습니다.

일반 자료 18종의 최종 수집명세는 `generatedAt: 2026-10-05T13:46:26Z`(한국시간 22:46:26) 기준 **9,352개 레코드**입니다. 상습결빙 공개본 **23개 관리지점**을 별도로 합산했습니다. [일반 자료 검수표](OFFICIAL_COLLECTION_AUDIT.json)와 [수록 목록](../../public/data/city/official-collection.json), 각 GeoJSON의 출처·날짜·제외 사유를 함께 확인합니다.

| 자료 | 수록 수량·단위 | 원자료 날짜 | 출처 |
|---|---:|---|---|
| 무더위쉼터 | 297곳 | 개별 날짜 2025-09-08 ~ 2026-06-25 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 한파쉼터 | 256곳 | 개별 날짜 2025-11-14 ~ 2026-06-25 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 자동심장충격기(AED) | 412대 | 개별 날짜 2015-10-17 ~ 2026-09-30 | [공식 출처](https://e-gen.or.kr/egen/search_aed.do?searchType=general&jusoType=addrroad&loca=26&emogdstr=1505&sidoCode=12&gugunCode=240) |
| 보안등 | 7,887개 | 2026-08-06 | [공식 출처](https://www.data.go.kr/data/15017320/standard.do) |
| 민방위대피소 | 98위치 | 미제공 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 지진옥외대피장소 | 43위치 | 개별 날짜 2024-05-07 ~ 2026-05-07 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 이재민임시주거시설 | 38위치 | 미제공 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 비상급수시설 | 26위치 | 미제공 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 화학사고대피소 | 9위치 | 개별 날짜 2021-10-30 ~ 2025-08-29 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 미세먼지쉼터 | 10위치 | 미제공 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 어린이보호구역 대상시설 | 62위치 | 2026-07-10 | [공식 출처](https://www.data.go.kr/data/15012891/standard.do) |
| 노인·장애인보호구역 대상시설 | 13위치 | 2026-07-31 | [공식 출처](https://www.data.go.kr/data/15034532/standard.do) |
| 급경사지 공개 등록위치 | 14위치 | 개별 날짜 2020-04-22 ~ 2025-04-09 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 응급의료시설 | 6위치 | 개별 날짜 2026-10-05 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 경찰서·지구대·파출소 | 8위치 | 미제공 | [공식 출처](https://www.safekorea.go.kr/safekorea-kor/flsm/flsm/facilitiesSafteyMap.do?baseMapNm=naver&menuSn=2) |
| 약국 | 158위치 | 미제공 | [공식 출처](https://www.safemap.go.kr/main/smap.do) |
| 전통시장 | 8위치 | 2025-11-10 | [공식 출처](https://www.data.go.kr/data/15012894/standard.do) |
| 무료급식소·복지관 | 7위치 | 2026-08-06 | [공식 출처](https://www.data.go.kr/data/15013107/standard.do) |
| 상습결빙구간 공개본 | 23관리지점 | 개별 기준일 미제공 | [생활안전지도](https://www.safemap.go.kr/opna/data/dataViewRenew.do?objtId=221) |

표의 날짜는 원자료의 기준일·수정일 등 보존된 날짜입니다. 자료마다 의미가 다르며 개별 항목의 속성에서 확인해야 합니다. **수집일을 자료 기준일로 바꾸지 않았습니다.** 날짜가 없는 항목은 기준일 미제공으로 남겼습니다. 특히 AED 등 날짜 범위가 넓은 자료는 현재 점검·가동 상태를 보증하지 않습니다.

공식 원응답의 좌표를 사용하고, 지역 조건과 업로드된 18개 행정동 경계를 대조했습니다. 주소에서 좌표를 추정하거나 경계 밖의 점을 임의로 안쪽으로 옮기지 않았습니다. 같은 자료의 중복 제공본을 정리하고 개인 성명·관리자 계정·개인 연락처 등은 공개 속성에서 제외했습니다. 원응답 원문과 공개용 정제본은 구분합니다.

## 4. 상습결빙구간: 23개 관리지점의 의미

### 공식 API와 별도 공개본

| 구분 | 내용 |
|---|---|
| 인증 API | `DSSP-IF-00120` / `https://www.safetydata.go.kr/V2/api/DSSP-IF-00120` |
| API 공식 상세 | [재난안전데이터공유플랫폼 dataSn=111](https://www.safetydata.go.kr/disaster-data/view?dataSn=111) |
| 서버 환경변수 | `SAFETYDATA_00120_KEY` |
| 앱의 API 자료 식별자 | `sd-icing` |
| 별도 공개본 출처 | [생활안전지도 상습결빙구간 objtId=221](https://www.safemap.go.kr/opna/data/dataViewRenew.do?objtId=221) |
| 공개본 자료 식별자·파일 | `local-icing` / [local-icing.geojson](../../public/data/city/local-icing.geojson) |
| 공개본 수집 경로 | 공식 공개 WFS에 게시된 계층 조회; 인증 API의 키를 사용한 수신본이 아님 |

API 요청변수는 공식 명세의 `serviceKey`, `numOfRows`, `pageNo`, `returnType` 4개입니다. 광주 서구 지역 조건을 임의의 외부 요청변수로 만들지 않고 받은 전국 자료를 검수합니다. 상세 설정은 [API 설정 안내](../API_SETUP.md)에 있습니다.

### 수량과 제외 내역

| 검사 단계 | 결과 |
|---|---:|
| 광주 서구 지역명이 붙은 시작·종료 원자료 | 26관리지점 |
| 현재 서구 18개 행정동 경계 안 | **23관리지점** |
| 현재 경계 밖으로 지도 표시에서 제외 | **3관리지점** |

제외한 점은 삭제 사실을 숨기지 않고 [제외 자료](icing-rejected.geojson)와 [검수 기록](icing-audit.json)에 보존합니다. 지역명에 서구가 적혀 있어도 실제 좌표가 현재 경계 밖이면 서구 지도에 강제로 넣지 않습니다.

23개는 **관리구간의 시작·종료 지점 수**입니다. 23개 도로 구간, 현재 결빙 23곳, 제설 대상 23곳으로 해석하지 않습니다. 별도 구간 원문에는 13개 구간 레코드가 있으며 같은 관리번호가 반복되므로 관리번호만 중복 제거한 수를 실제 구간 수라고 단정하지 않습니다. 이번 지도 공개본은 원래 지점 도형을 사용하고, 점을 임의로 이어 도로의 굴곡이나 구간 길이를 만들지 않습니다. 원수집 근거는 [수집 명세](icing-manifest.json)에 있습니다.

### 날짜를 읽는 방법

- **카탈로그 수정일:** `2025-12-18`. 생활안전지도 데이터 설명 화면의 메타데이터 수정일입니다.
- **개별 지점 기준일:** 공개되지 않았으므로 `sourceDate: null`로 유지합니다. `2025-12-18`을 각 구간의 갱신일로 넣지 않습니다.
- **수집 시각:** `2026-10-05T13:35:06.441Z`(한국시간 22:35). 수집 시각과 자료 기준일을 구분합니다.

API의 등록 지점과 공개본 모두 현재 노면 결빙, 도로 통제, 제설 완료를 실시간으로 관측하는 자료가 아닙니다.

## 5. 확보했어도 신규 지도자료에 넣지 않은 항목

| 자료 | 확인한 상태 | 반영하지 않은 이유 |
|---|---|---|
| 무인민원발급기 | 광주 서구 원자료 40행, 날짜 2019-04-30 ~ 2020-03-17 | 오래된 제공본으로 현행 설치·이전 여부 미확인 |
| 공중화장실 | 광주 서구 원자료 265행, 날짜 2019-08-20 ~ 2020-06-08 | 오래된 제공본으로 현행 위치·운영 여부 미확인 |
| 안전비상벨 | 광주 서구 원자료 59행, 날짜 2020-03-17 ~ 2020-07-16 | 오래된 제공본으로 현행 설치·운영 여부 미확인 |
| 제설함 | 공식 WFS 지역 조회와 단일행 조회 모두 HTTP 500 | 제공 서버가 `Schema A2SM_SNOWRMBOX does not exist` 오류 반환; 서구 제설함 0개라는 뜻이 아님 |

이 항목들은 19종·9,375개 합계에 포함하지 않습니다. 기존 연결 자리표시자 파일이 있더라도 실제 신규 위치를 확보·게시한 것으로 보지 않습니다. 근거와 공식 링크는 [일반 자료 검수표의 collectedNotPublished](OFFICIAL_COLLECTION_AUDIT.json)에 남깁니다.

## 6. 이용조건과 IP 설정

상습결빙 공개본은 생활안전지도 상세페이지의 **공공누리 제4유형: 출처표시·상업적 이용금지·변경금지** 등 원문 이용조건을 함께 보존합니다. API 명세 출처와 생활안전지도 공개본 출처는 구분합니다. 상업적 재이용이나 추가 편집을 하려는 경우에는 해당 원문 조건을 확인해야 하며, 코드의 MIT 라이선스가 원자료 조건을 대신하지 않습니다. 자세한 출처 표기는 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)를 참고하세요.

등록 IP 오류에 대한 플랫폼 허용 IP 범위 변경이나 와일드카드 설정은 **사용자의 선택사항**입니다. 이번 작업에서는 해당 설정을 변경하지 않았습니다. 유료 고정 IP 구매를 전제로 하지 않으며, 승인된 실행환경과 허용 조건을 확인한 뒤 사용자가 선택할 수 있습니다. 별도 공식 공개본을 이용하는 동안에도 인증 API의 오류·미수신 상태는 그대로 구분해 표시합니다.

## 7. 수행한 검사와 운영 확인

동 이름 배치·홈 관련 회귀시험을 실행해 **24개 모두 통과**했습니다.

```bash
node --test tests/ui-label-layout.test.mjs tests/ui-home.test.mjs
```

검사한 범위는 360·414·672·1024·1440px의 이름 겹침 방지, 선택 동 이름 우선 표시, 확대 시 숨긴 이름 복원, 3D 화면 좌표 계산 실패 시 처리, 동 카드 BI·이름 유지입니다. `app.js`, `viewer.js`, `scene.js` 문법 검사도 통과했습니다. 이 결과는 API 공급자의 인증이나 실제 브이월드·OSM 지도 렌더링 성공을 뜻하지 않습니다.

최초 0.8.1 Production 배포는 `0736a72a2a56083251f33f611b976d9ef5657355`에서 생성됐고, Vercel의 Ready·Production·Current 상태 및 운영 응답의 `version: 0.8.1`을 확인했습니다. 수신 현황 메뉴는 키 설정과 `SAFETYDATA_32` 수신 실패를 별도로 보여 줍니다. 공개본 23지점은 API 실패 뒤에도 유지되며 치평동을 선택하면 4지점으로 좁혀집니다.

운영 공식자료 화면의 19개 카드가 수록 목록과 일치했고, 약국을 선택하면 158개 위치가 표시됩니다. 새 상세 화면을 열 때 맨 위부터 표시하도록 보완하고, 결빙 수신시각은 한국시간(KST)으로 통일했습니다.

**3D 시각 검증 한계:** 이 클라우드 검증 브라우저에서는 VWorld SDK를 받지 못했고, 독립 도시모형도 WebGL 초기화 실패를 표시했습니다. 지점·동 필터·번호표 제거는 경계도 모드를 명시적으로 선택해 확인했습니다. 3D 렌더링 성공으로 기록하지 않았으며 기본 지도 모드를 임의로 바꾸지 않았습니다.

### 로컬 최종 검사

JavaScript 구문 검사와 빌드를 통과했습니다. Node 테스트 **551/551**, 배포 묶음 검사 **12/12**, 로컬 HTTP·경로 검사 **48/48**을 통과했습니다. [검증 요약](LOCAL_VALIDATION.json), [묶음 검사](LOCAL_RELEASE_AUDIT.json), [로컬 HTTP 검사](LOCAL_DEPLOYMENT_CHECK.json)에 기록했습니다. 이 결과는 Vercel 운영 API 인증이나 실제 시설 운영 상태의 검증을 대신하지 않습니다.

운영 배포의 공식 GeoJSON **19개 모두**를 다시 받아 파일 SHA-256과 수록 건수를 대조했습니다. **19/19 일치, 합계 9,375개**이며 [운영 응답·파일 검수 기록](PRODUCTION_CHECK.json)에 보존했습니다. 이는 최초 0.8.1 배포의 확인 기록이며, 수신시간 표기·상세 화면 스크롤 보완에서도 같은 데이터 파일을 사용합니다.
