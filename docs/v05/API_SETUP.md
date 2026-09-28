# 서구온 v0.5 API 연결

## 브이월드

| 변수 | 역할 |
|---|---|
| VWORLD_BROWSER_KEY | 기존 브이월드 WebGL 3D SDK용 키. 작동하던 값 유지 |
| VWORLD_DOMAIN | 등록한 도메인. 예: https://seogu-on.vercel.app |
| VWORLD_API_KEY | 서버에서 WMS/WFS·주소·필지 자료 요청 시 사용하는 승인된 키 |

VWORLD_API_KEY는 우리 코드의 환경변수 이름입니다. 반드시 별도 종류의 새 키가 필요하다는 뜻은 아닙니다. 동일 발급키의 사용 가능 여부는 그 키의 승인 서비스·도메인에 따릅니다. 첨부 HTML의 예제 키는 사용하지 않았습니다.

공식 명세: https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do

새 브이월드 주제도 66종은 필드 매핑 JSON을 일일이 입력하지 않습니다. 공식 식별자·스타일·서구 영역 검사를 코드에 연결했습니다. 지도영상은 WMS, 공간도형·속성은 WFS를 사용합니다. API 실패가 나오면 카드에 표시되며 이전 정상본을 유지합니다.

WFS: `/api/city-data?kind=vw-c_up201&dong=all&page=1`
WMS: `/api/city-wms?layer=vwm-c_up201&dong=all&bbox=...`

공개 프록시는 허용된 식별자만 받습니다. 임의 URL을 프록시하지 않으며 키 값을 반환하지 않습니다. 1페이지 1,000항목·주제도당 30페이지 한도입니다. 큰 자료는 동별로 나누어 조회합니다. API 반환 범위가 원본 시설 전수인지 별도 확인해야 합니다.

## 기상·대기·안전

기존 설정은 그대로 유지합니다.

| 변수 | 연결 |
|---|---|
| KMA_SERVICE_KEY | 기상청 실황·단기예보 |
| AIRKOREA_SERVICE_KEY | 에어코리아 측정소 위치와 측정소별 관측 |
| DATA_GO_KR_SERVICE_KEY | 승인된 서비스의 공통 대체키. 모든 API가 자동 승인되는 것은 아님 |
| SAFETYDATA_SERVICE_KEY | 재난안전데이터공유플랫폼 무더위쉼터 |
| SAFEMAP_SERVICE_KEY | 국가/지방하천 범람지도·침수흔적 |
| FLOODMAP_SERVICE_KEY | 도시침수 30년 빈도 지도 |
| ITS_API_KEY | 공개 교통CCTV·돌발상황 |
| EMERGENCY_SERVICE_KEY | 응급의료기관 기본정보 |

기상청: https://www.data.go.kr/data/15084084/openapi.do
에어코리아 대기오염정보: https://www.data.go.kr/data/15073861/openapi.do
측정소 위치 API의 사용승인도 함께 확인하세요. 이전 세부설정은 `docs/v041/API_SETUP.md`, `docs/v03/API_SETUP.md`에 있습니다.

기상 격자는 위경도를 올바른 격자로 변환합니다. 미세먼지 측정소는 실제 반환좌표를 사용하며 동별 농도로 임의 보간하지 않습니다. 관측·예보·그림자 시나리오 시간은 구분합니다.

## 선택적 로컬 일괄 수집

본인 컴퓨터에서 Node 22를 사용하고, `.env.local`에 승인된 VWORLD_API_KEY/VWORLD_DOMAIN을 넣습니다. 키를 GitHub에 커밋하지 마세요.

```sh
npm run collect:vworld -- --dong=all --group=재난·방재
npm run collect:vworld -- --dong=seogu-07 --theme=vw-c_bldginfo
# 전체 66종은 명시적으로 실행할 때만:
npm run collect:vworld -- --dong=all --all
```

수집 결과는 `data-staging/vworld/<동ID>/`에 저장합니다. 공통지도 public/에 자동 게시하지 않습니다. 성공한 전체 페이지 응답에만 원자적으로 파일을 쓰며 실패·급격한 0건 응답·취소는 기존 정상 파일을 보존합니다. manifest에는 조회상태·수량·시각·해시만 쓰고 키는 기록하지 않습니다. Ctrl+C는 현재 요청 뒤 중지합니다.

이 명령으로 실제 제공기관 수신을 완료했다고 주장하지 않습니다. 이번 제작에서는 승인키 없는 중단 처리와 코드 시험을 확인했습니다.

## 직접 3D 모형을 추출하나요?

아닙니다. SDK가 받은 건물·지형을 화면에서 표현하는 것과 원본 메시/LoD4 자료의 다운로드·재배포는 다른 기능/권한입니다. 이번 주제도 수집은 문서에 공개된 WFS 도형과 속성에 한정합니다. 메시 캐시를 긁어내거나 미공개 API를 추측하지 않았습니다.
