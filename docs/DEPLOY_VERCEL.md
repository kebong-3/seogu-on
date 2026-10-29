# Vercel 배포

## 기존 서비스와 새 배포

- **기존 서구온:** https://seogu-on.vercel.app/ 에서 체험합니다. GitHub 저장소와 Vercel 프로젝트가 연결되어 있고 Production Branch가 `main`이며 자동 배포가 활성화된 경우, `main` 변경 시 배포가 시작됩니다. Deployments에서 성공 여부를 확인합니다.
- **다른 기관의 새 배포:** 전체 소스를 기관의 저장소에 올리고 Vercel에서 해당 저장소를 가져와 새 프로젝트를 만듭니다. 아래 설정과 기관의 API 키·등록 도메인을 적용합니다. 저장소를 복사하는 것만으로 기존 서구온의 배포 설정이나 키가 이전되지는 않습니다.

## 프로젝트 설정

| 항목 | 값 |
|---|---|
| Framework Preset | Other |
| Root Directory | 저장소 최상위 |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

`vendor/cesium-1.121.0.tar.gz`는 빌드에 필요한 3D 엔진 파일입니다. `api/`, `server/`, `public/`, `vercel.json` 등을 포함한 **전체 소스**로 배포합니다. `dist`만 정적 호스팅하면 서버 API가 포함되지 않아 AI·외부자료 조회를 동일하게 실행할 수 없습니다.

## 환경변수 설정

[.env.example](../.env.example)과 [API 설정 안내](API_SETUP.md)를 참고해 Vercel의 **Settings → Environment Variables**에 값을 등록합니다. 로컬 실행용 `.env.local`을 저장소에 올리는 방식으로 설정하지 않습니다. Production과 Preview의 적용 범위를 구분하고, 변경 후 해당 환경을 **Redeploy**합니다.

브이월드 도메인 설정에는 실제 사용할 배포 주소를 적용합니다. Preview 주소도 사용할 경우 제공기관의 허용 도메인 조건을 확인합니다.

## 배포 뒤 확인

아래 경로는 **실제 배포 주소** 뒤에 붙입니다. 기존 서구온의 주소는 `https://seogu-on.vercel.app`입니다.

1. Deployments에서 배포 성공을 확인하고, `/data/release.json`의 `version`·`builtAt`·`codeSha256`을 해당 빌드 기록과 대조합니다.
2. `/api/city-config`의 `configured`를 확인합니다. `true`는 설정값 존재 여부이며 외부서비스 인증·실제 응답 성공은 별도로 확인합니다.
3. 동 선택 → 공원 질문 → 지도 위치·출처·기준일 확인 → 검토메모 저장을 실행합니다. 이어서 **폭염 대응계획 → 두 안 비교하기 → 보고서 저장**을 확인하고 내려받은 파일을 다시 엽니다.
4. 브이월드 3D 지도, 기온·강수, AI 답변을 실제 접속환경에서 확인합니다. 미수신·규칙 기반 대체를 정상 외부 응답으로 기록하지 않고, 원인과 확인 범위를 남깁니다.

## 배포·연결이 실패할 때

- **빌드 실패:** Build Logs를 확인합니다. 엔진 파일 누락은 전체 소스 구성을, 문법 오류는 해당 변경을 점검하고 수정 후 재배포합니다.
- **3D 지도 미표시:** 키·서비스 승인·등록 도메인·WebGL·외부 통신을 확인합니다. 경계도로 자료를 볼 수 있어도 3D 연결 성공을 뜻하지 않습니다.
- **AI·자료 미수신:** 환경변수 적용 범위, 제공기관 승인·응답과 호출 제한을 [API 설정 안내](API_SETUP.md)에 따라 확인합니다.
