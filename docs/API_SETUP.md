# API 설정과 자료 확장 — v0.2

## 1. 지도용 키와 행정자료용 키는 다릅니다

지도 SDK는 배경 지형·건물을 표시하고, 시설 API는 시설 속성·좌표를 제공합니다. 브이월드 키 하나로 인구·예산·복지·안전 정보 전체가 자동 생성되지 않습니다. AI 학습은 필요하지 않습니다.

| 변수 | 역할 | 브라우저 노출 |
|---|---|---|
| VWORLD_BROWSER_KEY | 웹지엘 3D SDK | SDK 실행에 필요한 공개 식별값으로 전달. 도메인 제한 필요 |
| VWORLD_DOMAIN | https://seogu-on.vercel.app | 서비스 주소 |
| VWORLD_API_KEY | Vercel 서버의 장소검색·주소→좌표·기존 구 경계 REST | 서버 요청에만 사용 |
| DATA_GO_KR_SERVICE_KEY | 활용신청한 공공데이터 API | 서버 전용 |
| KMA_SERVICE_KEY | 기상청 승인 키. 없으면 공통 키 사용 | 서버 전용 |
| DATA_SOURCES_JSON | 추가 공개 JSON API 연결 설정 배열 | 비밀키를 배열에 넣지 말고 keyEnv만 지정 |

브이월드 신청: https://www.vworld.kr/ → 오픈API/인증키 발급·관리. 3D 안내: https://www.data.go.kr/data/3073144/openapi.do . 키마다 허용 서비스·운영 도메인을 확인하세요. 같은 발급 키를 두 환경변수에 넣을 수 있는지는 승인범위에 따릅니다. `NEXT_PUBLIC_` 같은 프런트 공개 이름으로 서버 키를 바꾸지 마세요.

공식 기술 근거: https://github.com/V-world/V-world_API_sample/tree/master/브이월드_교육/2026년_브이월드_교육 . `facility_build`의 show/hide, 주소 API getcoord, 웹지엘 SDK 초기화를 참고했습니다. 샘플의 타인 키를 복사하지 않았습니다.

Vercel 환경변수는 https://vercel.com/docs/environment-variables . Production에 적용하고 새 배포를 만들어야 합니다.

## 2. 기본 연결한 시설 API 4개

| 자료 | 활용신청 | 서버 preset id |
|---|---|---|
| 전국도시공원정보표준데이터 | https://www.data.go.kr/data/15012890/standard.do | parks |
| 전국주차장정보표준데이터 | https://www.data.go.kr/data/15012896/standard.do | parking |
| 전국공공시설개방정보표준데이터 | https://www.data.go.kr/data/15013117/standard.do | public-facilities |
| 전국도서관표준데이터 | https://www.data.go.kr/data/15013109/standard.do | libraries |

각 포털 페이지의 API 활용신청과 승인 후 인증키를 등록합니다. 제공기관 검색 조건에 따라 일부 광역단체 제공자료가 빠질 수 있습니다. 서버의 `server/catalog.js`에 실제 요청주소와 열 매핑이 있습니다. 공원·도서관은 문서의 pageNo=0 예시, 주차장·공공시설은 pageNo=1 예시를 따릅니다. 실제 응답 페이지 번호가 다르면 오류로 처리하고 이전 자료를 유지합니다. 유효 키를 통한 이 제공기관의 동작 검증은 아직 별도입니다.

`GET /api/layers`: 비밀값 없는 자료 목록·설정 여부.
`GET /api/layers?id=parks&page=1`: 첫 내부 페이지. 공급자별 0/1 시작 번호는 서버가 바꿉니다.

한 페이지 최대 1,000행, 최대 50페이지, 브라우저 등록 상한 5,000개입니다. 확인 가능한 전체 건수가 없거나 중간 페이지가 빠지면 전량 갱신으로 표시하지 않습니다. 전국 데이터를 무작정 받지 말고 원자료 명세의 시군구·제공기관 조건을 설정하세요. 페이지 수신 후 실제 18개 행정동 도형으로 서구 범위를 걸러냅니다. 동 경계에 걸친 점은 억지로 한 동에 배정하지 않습니다.

## 3. 안전·복지 주소 → 좌표

`GET /api/geocode?id=address-숫자`는 서버에 등록된 공개시설 목록 중 선택한 항목만 변환합니다. 자유 입력 주소나 임의 URL을 프록시하지 않습니다. `/api/vworld`는 기존 장소검색입니다.

좌표를 받으면 18개동 경계 안인지 확인하고 ‘좌표 후보’로만 제시합니다. 사용자가 위치를 확인한 뒤 현재 브라우저에 추가합니다. sourceDate 미제공은 null로 유지합니다. 정식 공유자료에 넣으려면 시설 출입구·도로명주소·현재 운영을 검수하여 저장소 자료를 갱신하세요. 취약가구·거주시설 등 민감한 위치는 입력하지 마세요.

추가 후보: 전국사회복지시설표준데이터 https://www.data.go.kr/data/15096296/standard.do , 전국지진옥외대피장소표준데이터 https://www.data.go.kr/data/15072620/standard.do , 전국무더위쉼터표준데이터 https://www.data.go.kr/data/15013199/standard.do . 이 세 자료의 최신 인증 API 실수신까지 완료한 것은 아닙니다. 이번 확인에서는 복지 다운로드 오류, 지진 표준 다운로드 0행, 무더위쉼터의 오래된 운영기간 문제가 있어 최신 전체 현황으로 만들지 않았습니다. 검색·다운로드 0행은 실제 시설 부재를 뜻하지 않습니다.

## 4. 다른 공개 JSON API 추가

Vercel의 `DATA_SOURCES_JSON` 예시(아래 주소는 실 API로 바꾸고 원문 응답 열을 확인):

```json
[{"id":"care-centers","name":"공개 복지시설","category":"care","type":"odcloud","url":"https://api.odcloud.kr/api/활용신청한_실제_경로","keyEnv":"WELFARE_SERVICE_KEY","sourceName":"제공기관 / 자료명","sourceUrl":"https://www.data.go.kr/해당_소개페이지","publicOnly":true,"pageSize":1000,"pageBase":1,"query":{},"fields":{"id":"원본고유번호","name":"시설명","longitude":"경도","latitude":"위도","address":"도로명주소","sourceDate":"데이터기준일자","phone":"기관전화번호"}}]
```

`WELFARE_SERVICE_KEY`는 별도 환경변수에 저장합니다. 이 예시는 작동하는 URL이나 확보된 자료라는 뜻이 아닙니다. 지원 호스트: `api.odcloud.kr`, `apis.data.go.kr`, `api.data.go.kr`. 임의 사이트·리디렉션·XML·인증 헤더 전용 API는 지원하지 않습니다. 그런 API는 제공기관 명세에 맞는 별도 어댑터가 필요합니다.

원본의 개인 이름·계정·임의 속성은 지도 데이터에 복사하지 않습니다. 허용한 시설명·좌표·주소·기관 연락처·출처 등을 골라 처리하지만, 입력자료 자체에 개인정보가 섞이지 않았는지 관리자가 먼저 확인해야 합니다.

## 5. 기상청 격자 실황

활용신청: https://www.data.go.kr/data/15084084/openapi.do . 승인 후 `KMA_SERVICE_KEY` 등록.

`GET /api/weather?lon=126.859&lat=35.151` → DFS 격자 변환 → getUltraSrtNcst → 기준시각 대조 → 응답. 관측자료를 예측값으로 대체하지 않습니다. 표출은 선택한 동의 대표점이 속한 격자값이며 동 전체·개별 건물의 실측이 아닙니다. 기상·재난 경보를 대신하지 않습니다.

## 6. 보관·갱신의 정확한 범위

배포 파일은 모든 방문자에게 동일합니다. API 정상본은 해당 브라우저 localStorage에 보관하며, 함수 인스턴스 메모리 캐시는 재시작 시 사라질 수 있습니다. 새 사용자에게 최신 공통본을 보장하려면 별도 영구 저장소·운영 주기를 구성해야 합니다. 정기 크론 작업을 이미 실행 중인 것처럼 표시하지 않습니다.

중간 실패, 반복 페이지, 전체 건수 변화, 갑작스러운 0건에는 기존 정상본을 유지합니다. ‘반영시각’은 수신시각이고 ‘자료기준일’이 아닙니다. 모든 항목의 최신성과 현장 정확성은 별도 검수 대상입니다.
