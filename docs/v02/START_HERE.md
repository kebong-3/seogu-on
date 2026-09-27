# 서구온 v0.2 — 바로 적용하기

## 기존 저장소와 주소를 그대로 사용

**이번 개선 코드의 전달본은 ZIP입니다. GitHub main과 기존 Production 사이트는 변경하지 않았습니다.** 생성된 `feature/admin18-real-data-v0.2` 브랜치에는 공개자료 수집·기존 사이트 검사 워크플로만 있으며, 이 ZIP의 개선 앱 소스가 자동으로 올라가 있는 것은 아닙니다.

기존 저장소 `kebong-3/seogu-on`에서 개선 브랜치를 선택한 다음 ZIP 안의 파일을 업로드하여 기존 파일을 교체합니다. Preview 빌드와 화면을 확인한 뒤 Pull request → main 병합으로 적용합니다. Vercel이 main과 연결되어 있다면 그 이후 Production 배포에서 새 코드가 반영됩니다. 새 저장소나 새 Vercel 프로젝트는 필요하지 않습니다.

ZIP으로 적용할 때는 ZIP 자체가 아니라 압축 안의 `package.json`, `vercel.json`, `src/`, `api/`, `server/`, `public/` 등의 파일을 저장소 최상위에 올립니다. 서버 폴더를 빼면 API 함수가 실패합니다.

## API 키 없이 먼저 확인할 화면

실제 자료 기본 표시 → 18개동 전체 보기 → 치평동 등 선택 → 지도와 시설 수 변경 → 동별 비교표 → 건물 가까이 보기. 합성 시연 스위치는 켜지 마세요. 첫 화면에 공공자료 325개가 표시되는 것이 이번 공개본 기준입니다.

## 브이월드 키는 Vercel에만 입력

Vercel → seogu-on 프로젝트 → Settings → Environment Variables → **Production 선택**.

| Name | Value |
|---|---|
| VWORLD_BROWSER_KEY | 본인이 발급받고 3D 서비스 사용이 승인된 키 |
| VWORLD_DOMAIN | https://seogu-on.vercel.app |
| VWORLD_API_KEY | 주소검색·주소→좌표 REST 서비스에 사용 가능한 본인 키 |

`VWORLD_API_KEY`는 우리 프로그램이 붙인 환경변수 이름입니다. ‘서버’는 Vercel의 API 함수이므로 개인 PC에 별도 서버를 설치하지 않습니다. SDK와 REST에 같은 발급 키를 쓸 수 있는지는 해당 키의 승인 서비스·도메인 조건을 확인해야 하며, 별도 키를 반드시 발급받아야 한다는 뜻은 아닙니다. 브라우저용 키는 SDK 실행 시 브라우저에 보이므로 브이월드의 도메인 제한을 설정합니다.

저장 후 **Deployments → 해당 Production 배포 → Redeploy**. 환경변수 변경은 이전 배포에 소급 적용되지 않습니다. Preview에만 입력하면 현재 Production 사이트에는 반영되지 않습니다. Preview 도메인은 Production 도메인과 달라 별도 등록 없이는 지도 인증에 실패할 수 있습니다.

사이트 데이터 연결 센터에서 ‘환경변수 설정됨’ 확인 → 브이월드 연결 시험 → 실제 건물과 지형 확인. `/api/config`는 키 값 없이 설정 여부만 보여줍니다.

## 실제 자료를 더 갱신하기

공공데이터포털에서 필요한 4개 API 각각 활용신청 → 승인 확인 → `DATA_GO_KR_SERVICE_KEY` 입력 → Production 재배포 → 자료별 연결 관리 → ‘이 자료 갱신’. 전체 원문 안내는 `docs/API_SETUP.md`.

기상청 ‘단기예보 조회서비스’ 활용신청 후 `KMA_SERVICE_KEY`에 승인된 키를 넣습니다. 같은 포털 키에 기상청 서비스도 승인되어 있으면 공통 키를 사용할 수 있습니다.

## 담당부서 자료 연결

시설은 `public/data/facilities-template.csv`, 동별 통계는 `dong-stats-template.csv`, 사업 도형은 `projects-template.geojson` 양식입니다. 공개 가능한 자료만 넣고 데이터 연결 센터에서 가져옵니다. 이름·주소만 있다고 임의의 지도 좌표를 생성하지 않습니다. 주소 검수 목록은 ‘주소→좌표 후보’ 버튼 → 위치 확인 → 등록 순서로 처리합니다. 사용자 확인을 눌러도 측량·현장 검수가 완료되었다는 뜻은 아닙니다.

## 이번에 아직 완료하지 않은 것

사용자의 Vercel 환경변수 편집, 브이월드 계정의 도메인·API 승인, 인증된 외부 API 실수신은 사용자 계정에서 완료해야 합니다. 최신 동별 인구·예산·월별 실적·비공개 행정자료, 정밀 침수·교통·일조 예측, 공동 DB·로그인·정기 자동수집은 기본 완성범위에 포함하지 않습니다.
