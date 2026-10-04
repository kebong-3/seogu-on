# Vercel 배포

GitHub 저장소 `main`에 파일이 올라가면 Vercel이 자동으로 다시 배포합니다. 따로 누를 것은 없습니다.

## 프로젝트 설정(바꾸지 않습니다)

| 항목 | 값 |
|---|---|
| Framework Preset | Other |
| Root Directory | 저장소 최상위 |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

`vendor/cesium-1.121.0.tar.gz`는 빌드할 때 풀어서 쓰는 3D 엔진 파일입니다. **지우거나 빼고 올리면 빌드가 실패합니다.**

## 환경변수를 바꿨을 때

Settings → Environment Variables에서 값을 저장한 뒤 Deployments → 맨 위 배포의 ⋯ → **Redeploy**를 눌러야 반영됩니다.
Preview에만 넣은 값은 실제 사이트(Production)에 적용되지 않습니다.

## 배포 뒤 확인

1. `https://seogu-on.vercel.app/data/release.json`의 `builtAt`이 방금 시각인지 봅니다.
2. `https://seogu-on.vercel.app/api/city-config`의 `configured`에서 필요한 항목이 `true`인지 봅니다. `true`는 "변수가 있다"는 뜻이지 인증 성공이 아닙니다.
3. 첫 화면 상단의 기온·강수·PM10이 숫자로 나오는지 봅니다. "미수신"이면 값을 눌러 원인 코드를 확인합니다(`docs/API_SETUP.md`).
4. 실제 브이월드 3D 화면에서 서구 전체 → 동 선택 → "폭염 그늘 살펴보기"를 눌러 봅니다.

## 배포가 실패했을 때

Deployments에서 실패한 배포를 눌러 Build Logs의 마지막 붉은 줄을 봅니다.

- `vendor` 파일이 없다는 내용: `vendor/cesium-1.121.0.tar.gz`가 저장소에 있는지 확인합니다.
- 문법 오류: 방금 올린 파일을 이전 것으로 되돌립니다(GitHub의 History에서 Revert).

브이월드 키가 있어도 지도가 뜨지 않으면 브이월드 계정의 서비스 승인·등록 도메인(`https://seogu-on.vercel.app`)을 확인합니다. Preview 배포의 긴 자동 주소는 등록 도메인과 다르므로 3D 지도가 뜨지 않는 것이 정상입니다.
