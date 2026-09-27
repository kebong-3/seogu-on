# API 설정 · 서구온 v0.3

2026-09-27 작성. 엔드포인트는 제공된 활용모델과 확인 가능한 공식 안내를 기준으로 구현했습니다. 샘플 HTML 안의 인증키는 사용/복사하지 않았습니다. 라이브 인증·제공범위 확인은 사용자 계정으로 배포 후 수행해야 합니다.

## 환경변수

| 변수 | 용도 | 상태/비고 |
|---|---|---|
| VWORLD_BROWSER_KEY | 실제 WebGL 3D SDK | 브라우저에 전달됨. 도메인 제한 필수 |
| VWORLD_DOMAIN | SDK·REST 등록 도메인 | https://seogu-on.vercel.app, 경로/끝 슬래시 없이 |
| VWORLD_API_KEY | 주소, 필지, NED 토지·건물, 지적도 | 서버 요청에만 사용 |
| DATA_GO_KR_SERVICE_KEY | 기존 공공데이터 시설 API 및 아래 서비스의 공통 대체키 | 활용승인된 서비스에만 사용 가능 |
| KMA_SERVICE_KEY | 실황 + 단기예보 | 없으면 공통키. 위·경도는 KMA 격자로 변환 |
| SAFETYDATA_SERVICE_KEY | 무더위쉼터 | 재난안전데이터공유플랫폼 키. 공통키와 별개 |
| EMERGENCY_SERVICE_KEY | 응급의료기관 기본정보 | 없으면 공통키. 실시간 빈 병상 API 아님 |
| ITS_API_KEY | 공개 교통 CCTV·돌발상황 | ITS 키. 구청 내부 CCTV와 무관 |
| SAFEMAP_SERVICE_KEY | 국가/지방 하천범람, 침수흔적 WMS | 생활안전지도 키 |
| FLOODMAP_SERVICE_KEY | 도시침수 30년 빈도 WMS | 홍수위험지도 키 |
| TAAS_SERVICE_KEY | 과거 사고다발지역 | 없으면 공통키 |
| TAAS_YEAR | 사고자료 연도 | 기본 2024. 첨부 예제의 기준연도이며 현재 위험 예측 아님 |
| TAAS_SIDO / TAAS_GUGUN | 해당 사고자료 연도 행정코드 | 기본 29 / 140. 현재 경계 코드를 임의로 적용하지 않음 |
| AIRKOREA_SERVICE_KEY | 측정소 목록 + 측정소별 관측자료 | 두 서비스 승인 확인. 없으면 공통키 |
| AIRKOREA_REGION_QUERY | 측정소 주소 검색 조건 | 기본 광주, 결과는 실제 서구 경계로 다시 제한 |
| ITS_FLOW_ENABLED | ITS 교통소통 WMS | 기본 false. 이용조건·WMS 서비스 동작 확인 후 true |
| ITS_CCTV_TYPE | CCTV 제공 유형 | 기본 its. 제공기관에 확인한 유형만 지정 |

Vercel 환경변수는 변경 후 새 배포가 필요합니다. Preview/Production을 구분하세요. 서버 키 값을 응답·로그·브라우저 코드에 출력하지 않습니다. 공개 지도 SDK용 키는 의도적으로 브라우저에 전달되므로 ‘서버 비밀키’가 아닙니다.

## 공식 신청·확인 경로

브이월드: https://www.vworld.kr/ → 마이포털/오픈API 인증키와 도메인 등록.
공식 3D 안내: https://www.data.go.kr/data/3073144/openapi.do

기상청 단기예보(실황 포함): https://www.data.go.kr/data/15084084/openapi.do
에어코리아 대기오염정보: https://www.data.go.kr/data/15073861/openapi.do
에어코리아 측정소정보: https://www.data.go.kr/data/15073877/openapi.do

재난안전데이터공유플랫폼: https://www.safetydata.go.kr/ 에서 무더위쉼터(DSSP-IF-10942) 활용신청.
생활안전지도: https://www.safemap.go.kr/ 에서 해당 WMS 서비스 신청.
홍수위험지도: https://floodmap.go.kr/ / https://data.floodmap.go.kr/ 에서 도시침수지도 API 서비스 확인.
ITS: https://www.its.go.kr/ 오픈데이터 → CCTV·돌발상황·소통정보. 현재 상세 안내 페이지는 제작환경에서 수신하지 못했으므로 승인유형/제공범위를 반드시 확인하세요.
공공데이터포털: https://www.data.go.kr/ 에서 ‘국립중앙의료원 응급의료기관 기본정보’, ‘한국도로교통공단 지자체별 사고다발지역’을 검색해 정확한 서비스의 활용신청을 진행합니다.

## 서버가 호출하는 경로

- VWorld: `/req/address`, `/req/search`, `/req/data`, `/req/wms`, `/ned/data/getLandCharacteristics`, `/ned/data/getLandUseAttr`, `/ned/data/getBuildingUse`
- KMA: `/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst`, `getVilageFcst`
- AirKorea: `/B552584/MsrstnInfoInqireSvc/getMsrstnList`, `/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty`
- ITS: `https://openapi.its.go.kr:9443/eventInfo`, `cctvInfo`
- TAAS: `/B552061/frequentzoneLg/getRestFrequentzoneLg`
- Emergency: `/B552657/ErmctInfoInqireService/getEgytBassInfoInqire`
- Heat: `https://www.safetydata.go.kr/V2/api/DSSP-IF-10942`
- SafeMap WMS: `IF_0089_WMS`, `IF_0100_WMS`, `IF_0092_WMS`
- City flood: `https://data.floodmap.go.kr/api/wms-service/adm-cty-wms`, Freq=30
- Traffic WMS: `https://its.go.kr:9443/geoserver/ntic/wms`, ntic:N_LEVEL_{z} / ntic:REALTIME. 서버의 EPSG:3857 요청이 실제 제공되는지 배포에서 시험할 항목입니다.

## 좌표·기간·제공범위

행정자료는 실제 18개 동 경계로 검사합니다. 검색 결과가 ‘서구’라는 문자열만 포함한다고 넣지 않습니다. 지도 원본 건물의 제공 범위·누락·LOD·최신성은 별개입니다.

KMA는 실황과 예보를 다른 표제로 보여주고, 예보는 동일 발표시각·동일 유효시각별로 묶습니다. 시각이 다른 최저/최고·기온을 섞지 않습니다. 표시된 이후 최대 12개 예보시각 외 자료를 전체 예보라고 부르지 않습니다.

AirKorea는 실제 반환된 측정소 위치를 확인한 뒤 해당 측정소명을 요청합니다. 동 이름을 측정소 이름으로 추정하지 않습니다. 점검·결측 플래그가 있으면 값을 비웁니다.

무더위쉼터/응급의료 자료의 승인된 지역 필터 명세가 없으므로 페이지를 검사해 서구 자료만 반환합니다. 최대 150페이지, 반복페이지/총건수 변경을 검출합니다. 대규모 사용은 배치수집·공간 DB로 전환해야 합니다. 현재의 제한을 없애 무제한 API를 호출하지 않습니다.

CCTV는 ITS가 공개한 영상 주소만 재생합니다. HTTPS 페이지에서 HTTP만 제공되는 영상, CORS/코덱 제한, 만료된 링크는 재생되지 않을 수 있습니다. HTTP를 억지로 HTTPS로 바꾸거나 범용 영상 프록시를 만들지 않습니다.

## 키를 넣어도 안 보일 때

`/api/city-config`의 버전 → Production 최신 커밋 → 변수 적용 환경 → 브이월드 등록 도메인 → API별 활용승인 → 브라우저 네트워크/WebGL 순으로 확인합니다. 키 값이 담긴 요청URL/콘솔 캡처를 공유하지 마세요.

API 실패 시 이미 정상 수신한 자료를 비우지 않습니다. 단, 데이터베이스/영구 저장 기능은 없으므로 새 브라우저 세션이나 서버 재시작 뒤에도 API 마지막 정상본이 영구 보관되는 구조는 아닙니다. 기본 325항목 공개 스냅샷은 배포 파일에 포함됩니다.
