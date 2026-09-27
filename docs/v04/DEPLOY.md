# 서구온 v0.4 적용 안내

작성: 2026-09-27 · 기존 저장소 `kebong-3/seogu-on` / 기존 Vercel 프로젝트 유지

## 이번 전달 상태

이 ZIP에는 v0.3을 기반으로 완성한 v0.4 소스와 실제 공개자료 일부, 시험 및 문서가 들어 있습니다. 운영 사이트에 자동 반영한 파일이 아닙니다. 이번 이어서 작업에서는 GitHub 읽기와 이전 조사 산출물 다운로드만 수행했으며 앱 전체 push, main 병합, Vercel 배포, 환경변수 변경은 하지 않았습니다. 기존 `feature/city-infrastructure-v0.4` 브랜치에는 앞선 조사용 워크플로만 있습니다. 그 브랜치가 앱 전체 v0.4라고 생각하고 바로 병합하지 마세요.

사용자가 보여준 화면에서는 브이월드가 표시되고 있습니다. 기존에 작동하는 키를 삭제하거나 새로 발급할 필요는 없습니다. 먼저 그대로 유지해 적용합니다.

## 1. 파일 반영

기존 파일을 백업/비교한 뒤 압축 안 파일·폴더를 저장소 최상위에 반영합니다. ZIP 자체를 올리는 것이 아닙니다. 최상위는 `index.html`, `classic.html`, `package.json`, `vercel.json`, `src/`, `api/`, `server/`, `public/`, `scripts/`입니다. 특히 `public/vendor/cesium/`의 Assets, Workers, Widgets, ThirdParty를 빠뜨리지 마세요. 밝은 도시모형용 라이브러리와 실행 자원이 함께 있어야 합니다.

파일 수가 많으므로 GitHub Desktop이나 로컬 Git으로 폴더 전체 변경사항을 검토한 뒤 커밋하는 방법이 편합니다. 실제 비밀값이 든 `.env.local`은 반영하지 않습니다. 압축 안 `.env.example`은 값이 비어 있는 양식입니다.

안전한 작업 흐름은 ‘v0.4 검토용 브랜치에 파일 반영 → 화면 확인 → main 반영’입니다. Preview 임의 도메인은 브이월드에 등록된 Production 도메인과 다를 수 있어 인증 결과를 별도로 확인해야 합니다.

## 2. Vercel 빌드

| 항목 | 값 |
|---|---|
| Framework | Other |
| Root directory | 저장소 최상위 |
| Build command | npm run build |
| Output directory | dist |
| Node.js | 22.x |

기존 자동 배포가 연결되어 있으면 최신 커밋이 배포되는지 확인합니다. 환경변수 변경은 새 배포에 적용되므로 저장 후 재배포합니다. 공식 안내: https://vercel.com/docs/environment-variables

## 3. 버전과 파일 확인

`/api/city-config`에서 `version`이 `0.4.0`인지 확인합니다. 설정 플래그는 키가 존재한다는 뜻이며 인증 성공을 보장하지 않습니다. `/model.html`과 `/vendor/cesium/Cesium.js`, `/data/city/coverage.json`이 404이면 파일을 누락했을 수 있습니다.

새 화면 왼쪽의 **인프라 찾기 / 그래픽 / 기후·그늘**을 확인합니다. 기존 시간축·통계·사업·주소 검수 화면은 `/classic.html`에 남겨 두었습니다.

## 4. 그래픽 확인 순서

먼저 ‘그래픽 → 브이월드 → 균형 / 선명’을 비교합니다. 화질 진단에서 실제 캔버스 크기와 적용/미지원 항목을 확인합니다. 선명 설정은 GPU 부하가 커질 수 있으므로 느려지면 균형·절약으로 되돌립니다. 경계 면 농도, 주변 어둡기, 동 이름 표시도 따로 조절합니다.

다음으로 ‘그래픽 → 밝은 도시모형’을 확인합니다. 이 모드는 **브이월드가 아닌 독립 Cesium + OSM 부분 도형**입니다. 사진 질감을 없앤 단순 입체 건물이며 지형 높낮이가 없습니다. 원본 높이가 없는 건물은 표시용 6m로 그리고 그늘 계산에서 제외합니다. 빈 곳을 임의 건물로 채우지 않았습니다.

이번 제작환경은 WebGL을 구동하지 못했으므로 위 두 모드의 최종 화질·프레임률·건물 렌더링을 실제 PC에서 비교해야 합니다. 경계도 시험 사진은 3D 화질 개선 전후 사진이 아닙니다.

## 5. 우선 확인할 사용 장면

학교 단독 선택 → 서구 전체의 학교 위치/도형 확인 → 치평동 선택 → 해당 동만 남는지 확인 → 체육시설 선택 → 학교가 숨는지 확인 → ‘여러 종류 겹쳐 보기’로 함께 보기 → 시설 선택/단독 보기/목록/CSV 비교 순서로 확인합니다.

기후·그늘에서는 날짜와 한국시간을 선택하고 ‘그늘 계산’을 실행합니다. 기본 계산은 원본 height 태그가 있는 52개 건물 도형만 대상으로 하므로 서구 전체 그늘이 아닙니다. 층수×3m 추정 높이는 별도 체크했을 때만 포함됩니다. 제설지도는 실제 운영자료를 추가하기 전까지 경로·완료 현황이 나오지 않는 것이 정상입니다.

## 6. 날씨와 미세먼지

기존 `VWORLD_BROWSER_KEY`, `VWORLD_DOMAIN`, `VWORLD_API_KEY`는 유지합니다. 필요한 서비스를 활용신청한 뒤 `KMA_SERVICE_KEY`, `AIRKOREA_SERVICE_KEY`를 Production 환경에 추가하고 재배포합니다. 자세한 서비스·필드 매핑은 `docs/v04/API_SETUP.md`를 참고합니다.

## 7. 로컬 시험

```bash
npm run check
npm test
npm run build
npm run test:deployment
npm run dev
```

UI 시험은 Python+Playwright가 필요합니다. Chromium 경로는 `CHROMIUM_PATH`로 설정할 수 있습니다. `npm run test:city-ui`는 외부 API 대신 시험용 응답과 경계도 렌더러를 사용합니다. 실지도 시험이 아닙니다.

일반 PC에서 별도로 실행할 선택적 실브라우저 점검 스크립트는 다음과 같습니다. 이 스크립트는 제작환경에서 실지도 검증을 완료한 것이 아닙니다.

```bash
python -m pip install playwright
python -m playwright install chromium
python tests/live-v04.py https://seogu-on.vercel.app --headed
```

실지형·모델 정확성, 가독성, 그림자, 현재 API 제공범위는 사람이 화면과 원자료를 함께 검수해야 합니다.
