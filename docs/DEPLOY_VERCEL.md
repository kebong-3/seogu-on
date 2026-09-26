# GitHub → Vercel 배포 안내

## A. 소스 올리기

다운로드한 ZIP을 풉니다. GitHub에서 새 저장소를 만들고 안의 파일을 모두 올립니다. 파일 목록 첫 화면에 `package.json`, `vercel.json`, `index.html`, `src/`, `api/`, `server/`, `public/`, `scripts/`가 보여야 합니다.

환경변수 실제 값과 `.env.local`은 올리지 않습니다. `.env.example`은 비어 있는 입력 안내이므로 포함해도 됩니다. `.github/workflows/check.yml`은 검사 자동화용이며 빠져도 사이트 배포에는 필수가 아닙니다. 숨김파일을 누락하지 않았는지 확인하세요.

Git을 사용하는 경우:

```bash
git init
git add .
git commit -m "Initial SEO-ON web prototype"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

위 주소는 본인 저장소 주소로 바꿉니다. 파일은 저장소 최상위에 올리는 구성을 기준으로 했습니다.

## B. Vercel 프로젝트 설정

Vercel에서 **Add New → Project → 해당 GitHub 저장소 Import** 후 아래를 확인합니다.

| 설정 | 값 |
|---|---|
| Framework Preset | Other |
| Root Directory | 저장소 최상위 `.` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 22.x |
| Install Command | 기본값 사용. npm 설치 의존성이 없음 |
| Environment Variables | 최초에는 없어도 됨. 외부 지도 접속은 필요 |

`vercel.json`에 buildCommand/outputDirectory/functions/기본 보안헤더가 들어 있습니다. 대시보드에서 상충하는 예전 설정을 지웁니다. `dist`는 로컬 생성물이며 GitHub에 별도로 올리지 않아도 됩니다.

사이트 기능은 정적 파일과 루트 `api/`의 Node.js 함수로 나뉩니다. 이 프로젝트는 Express 상시 서버를 Vercel에 올리는 방식이 아닙니다. 전체 경로를 `index.html`로 바꾸는 rewrite를 추가하면 `/api`가 HTML로 응답할 수 있으므로 사용하지 마세요.

공식 설명: https://vercel.com/docs/functions/runtimes/node-js

## C. 최초 배포 점검

배포된 주소를 PC의 Chrome/Edge로 엽니다. 키가 없어도 기본 웹지도 연결을 시도합니다. 첫 화면의 시설 위치·수치는 합성 시연입니다. 실제시설은 기본 파일이 비어 있으므로 시연 스위치를 끄면 자료가 없다고 표시되는 것이 정상입니다.

지도를 받지 못하면 네트워크·WebGL·타일 서버 상태를 설명하는 오류가 표시됩니다. 버튼으로 **디자인 미리보기**를 선택하면 외형만 확인하는 가상 도시로 전환합니다. 자동으로 대체하여 실제 지도처럼 보이게 하지 않습니다.

최초 배포에서 확인할 항목:

- `/` 화면과 CSS/JS가 열리는가?
- `/api/config`가 JSON으로 응답하고 실제 키가 포함되지 않는가?
- 기본 웹지도와 배경 출처가 보이는가?
- 키 없이 `/api/vworld?kind=boundary` 호출 시 503 및 설정 안내가 나오는가?
- 스마트폰에서 분석 패널과 우측 상단 지도 설정을 열 수 있는가?

`/api/config`의 true는 환경변수가 채워졌다는 뜻일 뿐, 외부 인증 성공을 검증하지 않습니다.

## D. API 환경변수 추가

**Project → Settings → Environment Variables**에서 키와 값을 각각 한 항목씩 입력합니다. Vercel 입력창에는 값 바깥을 감싸는 따옴표를 추가하지 않습니다. JSON 값은 JSON 자체의 따옴표만 넣습니다.

우선 Production에 등록합니다. Preview에서도 쓰려면 해당 환경에 별도로 등록하고, 실제 접근할 Preview 도메인이 발급기관의 허용 도메인에 맞는지도 확인해야 합니다. 동적으로 바뀌는 Preview 주소를 모두 허용한다고 전제하면 안 됩니다.

환경변수를 추가·변경한 뒤 **Deployments → 최근 배포 → Redeploy** 또는 새 커밋으로 다시 배포합니다. 기존 배포에 자동 소급되지 않습니다.

공식 설명: https://vercel.com/docs/environment-variables

브이월드 3D 필수값은 `VWORLD_BROWSER_KEY`, `VWORLD_DOMAIN`입니다. 서버 검색·경계용 `VWORLD_API_KEY`와 혼동하지 마세요. 지도 발급기관에서 운영 주소를 승인·등록한 상태여야 합니다. 세부표는 `API_SETUP.md`를 봅니다.

## E. 실제 시설자료 공개

`public/data/facilities.geojson`을 검수된 Point FeatureCollection으로 바꾸고 GitHub에 커밋하면 연결된 Vercel 프로젝트가 새 배포를 만듭니다. 실제자료는 ‘저장소 공개자료 읽기’로 읽습니다. 파일 업로드 버튼으로 개인 브라우저에 불러온 자료는 다른 방문자에게 보이지 않습니다.

기관 내부용 원본은 공개 저장소와 `public/`에 넣지 마세요. 숨김 메뉴로 감추어도 내려받을 수 있는 공개 파일은 비공개 자료가 아닙니다.

## F. 문제 해결

| 증상 | 확인할 부분 |
|---|---|
| package.json을 찾지 못함 | ZIP만 업로드했는지, Root Directory가 한 단계 어긋났는지 |
| 빌드는 성공했는데 404 | Output `dist`, `npm run build`, `dist/index.html` 생성 여부 |
| API에서 HTML이 돌아옴 | 과도한 catch-all rewrite, `/api` 누락, Framework 잘못 선택 |
| Node 버전 오류 | Vercel Node22.x, package.json engines22.x 유지 |
| 지도 배경 연결 실패 | `unpkg.com`, `cdn.jsdelivr.net`, `tiles.openfreemap.org` 접속·WebGL 확인 |
| 브이월드 iframe 연결 실패 | 브라우저 키/SDK 서비스, 실제 접속 도메인·VWORLD_DOMAIN·승인 상태, SDK 콘솔 |
| 환경변수를 넣었는데 미설정 | Production/Preview 적용 대상, 오타, 재배포 여부 |
| 공공데이터 미설정 오류 | 키만 넣었는지, API 주소·필드 매핑·출처·기준일이 모두 있는지 |
| 시설이 0개 | 실제 파일이 비었는지, 좌표·필터·기간·반경·검수 제외 기록 확인 |
| API 429 | 발급기관 한도 또는 시제품 내 일시적인 요청 제한 확인 |
| 배경 건물이 적거나 평평함 | OSM 자료 범위·높이 속성 한계. 브이월드 대체 경로 별도 시험 |

## G. 운영 전 추가 사항

이 파일은 공개 시험배포를 위한 구성입니다. 광범위 공개 전에는 서비스 용도에 맞는 Vercel 플랜, 지도 이용조건, 호출량·대역폭, API 요금·한도와 인증 정책을 확인하세요. 무료 운영이나 가용성을 보증하지 않습니다. 관리자 인증·영구 데이터베이스·자동 수집 스케줄·운영 모니터링은 포함하지 않았습니다.
