# 서구온 0.4.1 적용 안내

## 기존 저장소와 프로젝트 유지

대상은 `kebong-3/seogu-on`, 기존 Vercel 프로젝트입니다. 이번 작업은 ZIP 제작과 로컬 검증이며, GitHub에 앱 전체를 push하거나 Vercel을 재배포하지 않았습니다. 이미 수정한 파일이 있다면 새 파일을 반영하기 전에 차이를 확인하고 백업하세요.

## 최상위에 반영할 항목

```text
package.json / package-lock.json / vercel.json
index.html / classic.html
src/ / server/ / api/ / public/ / scripts/
vendor/cesium-1.121.0.tar.gz
vendor/cesium-manifest.json
README.md / START_HERE.md / .env.example
```

**ZIP 파일 자체를 저장소에 올리거나 최상위 폴더를 중첩시키지 않습니다.** 이 전체본의 내용물을 올립니다. `vendor/`가 빠지면 빌드가 실패합니다. 실제 인증키가 있는 `.env.local`이나 내부 행정자료는 올리지 마세요.

기존0.4에서는 독립 Cesium의 많은 파일을 모두 업로드해야 했습니다. 이번에는 검증된 단일 로컬 SDK 압축파일로 전달하고 `scripts/ensure-runtime.mjs`가 빌드/로컬 개발 시작 시 `public/vendor/cesium`을 재생성합니다. SHA-256이 일치하지 않으면 중단하며 인터넷에서 대체 파일을 받지 않습니다. 압축파일을 임의로 바꾸지 마세요. GitHub의 브라우저 업로드가 파일 수 제한을 안내하면 폴더 단위로 나눠 반영하되 마지막 커밋까지 완료한 뒤 배포합니다.

## Vercel

| 항목 | 값 |
|---|---|
| Framework | Other |
| Root Directory | 저장소 최상위 |
| Build Command | npm run build |
| Output Directory | dist |
| Node.js | 22.x |

Vercel은 root `api/`를 서버 함수로 따로 처리합니다. `dist/`만 GitHub에 올리면 서버 코드가 빠집니다. 로컬 점검에서는 Node22를 설치하고 `npm run verify`를 실행합니다. 빌드 자체에 추가 npm 패키지는 필요 없습니다.

작동하던 `VWORLD_BROWSER_KEY`, `VWORLD_DOMAIN`, `VWORLD_API_KEY`는 유지합니다. 선택한 서비스의 인증키는 Vercel의 Production 환경변수에 넣습니다. 환경변수를 바꿨다면 새 배포에 반영해야 합니다. 상세 서비스는 `API_SETUP.md`를 참고하세요.

## 배포 완료 확인

1. 운영 주소의 `/api/city-config` → `version: "0.4.1"`.
2. `/data/release.json` → 같은 버전과 새 `builtAt`/`codeSha256`. 이는 빌드 식별자이며 원자료 갱신일이 아닙니다.
3. 그래픽 → 상세 모델 요청/기본 모델 요청. 지원하지 않으면 원래 표시가 유지되고 지원 여부를 안내합니다.
4. 분석 도구 → 적용·자료 연결 점검. 실제 엔진/렌더 프레임·캔버스·오류와 API 설정값 인식을 각각 확인합니다.
5. 학교만 선택 → 치평동 → 다른 동 → 서구 전체. 지도가 선택한 종류/범위를 유지하고 목록·점/선/면 건수가 일치하는지 확인합니다.
6. 제설구간을 실제 공개 확인자료로 작성 → 기록 반영 → 기록 보관함에서 명시적 저장 → 같은 브라우저/같은 주소에서 복원. 공동 서버에 게시되는 기능이 아닙니다.
7. 날씨·PM은 실제 응답 시각과 출처를 확인합니다. 연결 실패를 0건이나 정상 상태로 해석하지 않습니다.

## 되돌리기와 이력

기존 커밋으로 재배포하면 코드 기준으로 되돌릴 수 있습니다. 브라우저에 따로 저장한 관리기록은 별도 JSON으로 백업하세요. 이전 UI는 `/classic.html`에 남겨 두었습니다. `docs/v03`, `docs/v04`의 숫자/버전은 과거 시험 기록입니다.

이번 수정본의 실제 GPU 화질·브이월드 지형/건물·외부 인증은 제작환경에서 확인하지 못했습니다. `LIVE_CHECK.md`의 확인은 새 배포에서 수행합니다.
